import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type {
  EmbeddingProvider,
  MCPackConfig,
  ToolIndexEntry,
  ToolCallResult,
  SearchToolResponse,
  SearchResult,
  Session,
  AnalyticsOptions,
  AnalyticsSnapshot,
} from './types.js';
import { buildIndex } from './index-builder.js';
import { scoreAndRank, keywordScoreForEntry } from './search.js';
import { SessionRegistry, STDIO_SESSION_ID } from './session.js';
import { resolveRoleAccess } from './roles.js';
import { AnalyticsStore } from './analytics-store.js';
import { buildIndexingString } from './semantic-index-builder.js';
import {
  cosineSimilarity,
  minMaxNormalize,
  combineHybrid,
} from './hybrid-scoring.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function errorResult(message: string): ToolCallResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

// ─── MCPackEngine ───────────────────────────────────────────────────────────

/**
 * Core engine that composes all four leaf modules (index-builder, search,
 * session, roles) into a single integration point.
 *
 * Internal to the package -- not exported from src/index.ts.
 * Used by both wrap mode (Phase 2) and build mode (Phase 3).
 */
export class MCPackEngine {
  private readonly config: MCPackConfig;
  private readonly index: ToolIndexEntry[];
  private readonly sessions: SessionRegistry;
  private readonly searchToolDefinition: Tool;
  // ─── Phase 9: analytics state (additive — bounded in-memory event log) ───
  /**
   * In-memory analytics store capturing search/call/denial/miss events.
   * Public read-only access so wrap.ts/build.ts can call `engine.analytics.record(...)`
   * directly at the four decision points (Pattern 2 — no abstraction layer).
   * MCPackEngine itself is internal (Phase 02 DEC), so this is not a public-API change.
   *
   * @since v1.1 (Phase 9)
   */
  public readonly analytics: AnalyticsStore;
  // ─── Phase 7: semantic index build state (additive — null/undefined when embeddings absent) ───
  /** Vector store keyed by tool name. `null` until the build completes successfully (or as no-op for empty tool surface). */
  private semanticIndex: Map<string, Float32Array> | null = null;
  /** Promise tracking the in-flight build. `undefined` if `embeddings` was not configured. Test fixtures may await this. */
  private indexBuildPromise: Promise<void> | undefined = undefined;
  // ─── Phase 8: query-path warn-once state ───
  /** Set to true after the first query-embedding-failure warning is logged. Prevents log-spam if the provider is consistently broken (DEC-v11-08-04 — warn once per engine instance for the whole process lifetime). */
  private hasWarnedQueryEmbeddingFailure: boolean = false;

  constructor(tools: Tool[], config: MCPackConfig) {
    this.config = config;
    this.index = buildIndex(tools);
    this.sessions = new SessionRegistry(config.session);
    this.analytics = new AnalyticsStore();
    this.searchToolDefinition = {
      name: 'search_tools',
      description:
        'Search available tools by capability. Returns matching tool schemas ranked by relevance. Call this to discover what tools are available before attempting any operation.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Natural language description of what you want to do',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return',
          },
        },
        required: ['query'],
      },
    };

    // ─── Phase 7: kick off semantic index build if configured ───
    // CRITICAL: do NOT await — constructor MUST return synchronously per
    // REQ-v11-tools-list-no-regression and REQ-v11-public-api-lock.
    // The .catch attached in the same statement prevents unhandledRejection.
    if (config.embeddings) {
      this.indexBuildPromise = this.buildSemanticIndex(
        tools,
        config.embeddings.provider,
      ).catch((err: unknown) => {
        // Failure path: leave this.semanticIndex as null; isIndexReady() returns false;
        // future queries fall back to v1.0 keyword scoring automatically.
        // RBAC invariant: log the provider's error message only — NEVER tool names.
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`MCPack: semantic index build failed: ${message}`);
      });
    }
  }

  /**
   * Returns the tools/list response containing exactly one tool: search_tools.
   */
  handleToolsList(): { tools: Tool[] } {
    return { tools: [this.searchToolDefinition] };
  }

  /**
   * Returns true when the semantic index is fully built and ready for use.
   *
   * Returns false when:
   *   - `embeddings` was not configured (no build kicked off; semanticIndex stays null)
   *   - the build is still in flight (Promise pending)
   *   - the build failed (rejection caught; semanticIndex stays null; warning logged)
   *
   * Phase 8's hybrid query path SHOULD route to v1.0 keyword scoring when
   * this returns false. The query path MUST NOT await the build promise —
   * that would violate REQ-v11-perf-budget (50ms p99) and REQ-v11-tools-list-no-regression.
   *
   * Internal to the package — `MCPackEngine` is not exported from `src/index.ts`
   * (Phase 02 DEC). Phase 8 consumes this from inside the same engine class.
   *
   * @since v1.1 (Phase 7)
   */
  isIndexReady(): boolean {
    return this.semanticIndex !== null;
  }

  /**
   * Returns true when the semantic index has at least one vector available
   * for hybrid query scoring.
   *
   * Distinct from `isIndexReady()`:
   *   - `isIndexReady()` answers "did the build process complete?" — locked Phase 7
   *     semantics, returns true even for empty-tools no-op (empty Map).
   *   - `hasVectors()` answers "are there actually vectors to query semantically?"
   *     Used by Phase 8's hybrid query path to decide between the hybrid path
   *     and the v1.0 keyword fallback.
   *
   * Returns false when:
   *   - `embeddings` was not configured (no build kicked off; semanticIndex stays null)
   *   - the build is still in flight (semanticIndex still null)
   *   - the build failed (.catch in constructor leaves semanticIndex null)
   *   - the build succeeded with an empty tool surface (semanticIndex is `new Map()`, size 0)
   *
   * Internal to the package — `MCPackEngine` is not exported from `src/index.ts`
   * (Phase 02 DEC). Phase 8 consumes this from inside the same engine class.
   *
   * @since v1.1 (Phase 8)
   */
  hasVectors(): boolean {
    return this.semanticIndex !== null && this.semanticIndex.size > 0;
  }

  /**
   * Handle a search_tools invocation.
   *
   * Validates args, resolves session and role, ranks the tool surface
   * (hybrid scoring when vectors are available; v1.0 keyword scoring otherwise,
   * with role-filter applied AFTER ranking per REQ-v11-role-filter-after-rank),
   * and returns results with session-gated schema delivery.
   *
   * Return type is union `ToolCallResult | Promise<ToolCallResult>`:
   *   - SYNC return when `hasVectors()` is false (no embeddings, build pending,
   *     build failed, or empty no-op) — preserves byte-identical v1.0 sync
   *     contract for callers that destructure `result.content[0].text` directly.
   *     Required by Gate 4 (baseline test files byte-identical).
   *   - ASYNC return (Promise) when `hasVectors()` is true — needed because
   *     `embedQuery` is async. Callers in wrap.ts and build.ts already invoke
   *     this from inside async arrows, so awaiting the Promise is transparent.
   *
   * @since v1.0 — extended to optionally-async in v1.1 Phase 8 (REQ-v11-semantic-query-path).
   */
  handleSearchTools(
    args: Record<string, unknown>,
    sessionId: string | undefined,
  ): ToolCallResult | Promise<ToolCallResult> {
    // 1. Validate query parameter (UNCHANGED from v1.0)
    if (!args.query || typeof args.query !== 'string') {
      return errorResult('search_tools requires a "query" string parameter');
    }

    // 2. Resolve session (UNCHANGED from v1.0)
    const sid = sessionId ?? STDIO_SESSION_ID;
    const role = this.config.defaultRole;
    const session = this.sessions.getOrCreate(sid, role ?? '');

    // 3. Compute limit (UNCHANGED from v1.0)
    const maxResults = this.config.index?.maxResults ?? 10;
    const limit = Math.min(
      typeof args.limit === 'number' ? args.limit : 5,
      maxResults,
    );

    // 4. NEW (Phase 8): route to hybrid path or keyword-with-role-after-rank fallback
    if (this.hasVectors()) {
      // Async hybrid path — embedQuery is async; return a Promise.
      return this.runHybridQuery(args.query, role, limit, session);
    }

    // No vectors: v1.0 keyword path with role-filter-after-rank pivot
    // (Wave 0 empirical check verified byte-identical observable behavior to v1.0).
    // SYNC return — preserves Gate 4 baseline test compatibility (no `await` needed).
    const matches = this.scoreAndRankKeywordWithRoleAfter(args.query, role, limit);
    return this.buildSearchResponse(args.query, matches, role, session);
  }

  /**
   * Async wrapper for the hybrid query path. Awaits `embedQuery`, then either
   * runs the hybrid scoring path (when query embedding succeeds) or falls
   * through to the keyword path (when query embedding fails — warn already
   * logged at most once by embedQuery).
   *
   * Internal helper extracted from `handleSearchTools` so the public method
   * can return synchronously when `hasVectors()` is false (Gate 4 baseline
   * compatibility) and asynchronously when it's true.
   *
   * @internal Phase 8 — only invoked from `handleSearchTools` when `hasVectors()` returns true.
   * @since v1.1 (Phase 8)
   */
  private async runHybridQuery(
    query: string,
    role: string | undefined,
    limit: number,
    session: Session,
  ): Promise<ToolCallResult> {
    const queryVec = await this.embedQuery(query);
    let matches: ToolIndexEntry[];
    if (queryVec !== null) {
      // Hybrid path: rank-then-filter against full surface (REQ-v11-hybrid-ranking).
      matches = this.scoreAndRankHybrid(query, queryVec, role, limit);
    } else {
      // Query embedding failed — fall through to keyword (warn already logged at most once by embedQuery).
      matches = this.scoreAndRankKeywordWithRoleAfter(query, role, limit);
    }
    return this.buildSearchResponse(query, matches, role, session);
  }

  /**
   * Build the final search-tools response from a matches list.
   *
   * Encapsulates the session-loadedTools mutation block + queryLog push +
   * response envelope construction so both sync and async paths in
   * handleSearchTools share identical mutation semantics. The block is
   * byte-identical to v1.0 (REQ-v11-session-invariants + Pitfall 7
   * carry-forward — same has/add ordering on session.loadedTools, same
   * map iteration, no buffering).
   *
   * @internal Phase 8 — extracted from handleSearchTools without changing observable behavior.
   * @since v1.1 (Phase 8)
   */
  private buildSearchResponse(
    query: string,
    matches: ToolIndexEntry[],
    role: string | undefined,
    session: Session,
  ): ToolCallResult {
    // 5. Build session-gated SearchResult[] (UNCHANGED from v1.0 — Pitfall 7 carry-forward demands byte-identical mutation order)
    const results: SearchResult[] = matches.map((entry) => {
      const loaded = session.loadedTools.has(entry.name);
      if (!loaded) session.loadedTools.add(entry.name);
      return loaded
        ? { name: entry.name, loaded: true }
        : { name: entry.name, loaded: false, schema: entry.schema };
    });

    // 6. Log query to session (UNCHANGED from v1.0)
    session.queryLog.push({
      query,
      results: results.map((r) => r.name),
      timestamp: Date.now(),
    });

    // Phase 9: emit `search` event AFTER queryLog.push but BEFORE response build.
    // Both sync (no-vectors) and async (hybrid) paths funnel through this method,
    // so emission is exactly once per search_tools invocation.
    // `miss` event is a subset signal — emitted at the SAME site, conditional on empty matches.
    const analyticsTs = Date.now();
    this.analytics.record({
      type: 'search',
      query,
      role: role ?? '',
      tools: results.map((r) => r.name),
      ts: analyticsTs,
    });
    if (matches.length === 0) {
      this.analytics.record({
        type: 'miss',
        query,
        role: role ?? '',
        ts: analyticsTs,
      });
    }

    // 7. Build response (UNCHANGED from v1.0 — total_available reflects role-allowed surface count per REQ-v11-session-invariants)
    const allowed = resolveRoleAccess(role, this.config.roles, this.index);
    const response: SearchToolResponse = {
      tools: results,
      total_available: allowed.length,
      showing: results.length,
      session_id: session.id,
    };

    return { content: [{ type: 'text', text: JSON.stringify(response) }] };
  }

  /**
   * Stop the session registry timer and clear all sessions.
   */
  destroy(): void {
    this.sessions.destroy();
  }

  /**
   * Return current engine statistics.
   */
  stats(): { sessions: number; tools: number } {
    return { sessions: this.sessions.size, tools: this.index.length };
  }

  /**
   * Mark a tool as loaded in the given session.
   * Called by both wrap and build mode when tools/call is invoked directly.
   */
  markToolLoaded(toolName: string, sessionId: string | undefined): void {
    const sid = sessionId ?? STDIO_SESSION_ID;
    const role = this.config.defaultRole;
    const session = this.sessions.getOrCreate(sid, role ?? '');
    session.loadedTools.add(toolName);
  }

  /**
   * Compute an analytics snapshot from recorded events (Phase 9 — REQ-v11-analytics-api).
   *
   * Operator-only entry point. Reachable only from `MCPackHandle.getAnalytics`,
   * which is callable from host-process code that holds the handle. Never
   * wire-protocol exposed; never appears in tools/list (Gate 5 enforcement
   * of REQ-v11-analytics-rbac-integrity).
   *
   * @param options - Optional `{ role?: string }`:
   *   - undefined or `options.role` undefined: operator-unscoped (full event data).
   *   - `options.role` provided: role-scoped — events EXCLUDED if they involve a
   *     tool outside the role's allowed set (per DEC-v11-09-02).
   *
   * @returns A JSON-shaped AnalyticsSnapshot. Computed on each call (no caching);
   *   for 10,000-event budgets the cost is sub-millisecond.
   *
   * @since v1.1 (Phase 9)
   */
  getAnalytics(options?: AnalyticsOptions): AnalyticsSnapshot {
    return this.analytics.snapshot(this.config.roles, this.index, options);
  }

  /**
   * Embed the user's query as a single-item batch and return the resulting
   * Float32Array. Returns null on any failure (provider rejection, malformed
   * result, contract violation), with the caller falling through to the v1.0
   * keyword fallback path.
   *
   * Failure semantics (DEC-v11-08-04):
   *   - Catch all rejections internally — DO NOT propagate to the MCP caller
   *     (would break the session). Same principle as Phase 7's build-failure handling.
   *   - Log a single locked-format warning: `MCPack: query embedding failed: ${err.message}`.
   *     Format mirrors Phase 7's build-failure warn and MUST NOT include tool names,
   *     query text, or role information (RBAC invariant + WR-03 fix).
   *   - Use `hasWarnedQueryEmbeddingFailure` flag for warn-once-per-engine-instance.
   *     One warning per engine instance for the whole process lifetime, NOT one per query.
   *   - Return null so the caller branches to keyword fallback without try/catch noise.
   *
   * @internal Phase 8 — called from handleSearchTools when hasVectors() is true.
   * @since v1.1 (Phase 8)
   */
  private async embedQuery(query: string): Promise<Float32Array | null> {
    // Defensive: this method is only called when hasVectors() is true, which
    // implies config.embeddings is set. Re-check defensively so a future refactor
    // letting hasVectors() and embeddings drift doesn't trigger a NullPointerException.
    if (!this.config.embeddings) return null;

    try {
      // Single-item batch per DEC-v11-01 + REQ-v11-semantic-query-path.
      const vectors = await this.config.embeddings.provider([query]);

      // Validate parallel-array contract for single-item batch.
      if (
        !Array.isArray(vectors) ||
        vectors.length !== 1 ||
        !Array.isArray(vectors[0])
      ) {
        throw new Error(
          `provider returned malformed result for single-item batch`,
        );
      }

      return new Float32Array(vectors[0]);
    } catch (err: unknown) {
      if (!this.hasWarnedQueryEmbeddingFailure) {
        this.hasWarnedQueryEmbeddingFailure = true;
        const message = err instanceof Error ? err.message : String(err);
        // RBAC invariant: locked format `MCPack: query embedding failed:` followed
        // by err.message ONLY. NEVER include tool names, query text, or role info.
        console.warn(`MCPack: query embedding failed: ${message}`);
      }
      return null; // caller falls through to keyword path
    }
  }

  /**
   * Hybrid scoring path: rank the FULL index along both tracks (semantic via
   * cosineSimilarity, keyword via keywordScoreForEntry), per-query min-max
   * normalize each track to [0,1], combine via the locked formula, sort by
   * hybrid score descending, drop zero-score entries, apply role filter
   * (rank-then-filter pivot — REQ-v11-role-filter-after-rank), slice to limit.
   *
   * Caller (handleSearchTools) only invokes this when hasVectors() returned true
   * AND embedQuery returned a non-null Float32Array. Inside this method,
   * this.semanticIndex is therefore non-null and non-empty by precondition.
   *
   * @internal Phase 8 — uses Plan 08-01's pure helpers and Plan 07's semanticIndex.
   * @since v1.1 (Phase 8)
   */
  private scoreAndRankHybrid(
    query: string,
    queryVec: Float32Array,
    role: string | undefined,
    limit: number,
  ): ToolIndexEntry[] {
    // Precondition guaranteed by hasVectors() check at the call site.
    const vectors = this.semanticIndex!;

    // Score each entry along both tracks. Iterate this.index (the keyword index
    // built by Phase 1 buildIndex) — this is the FULL tool surface, NOT
    // role-filtered. Role filter applies AFTER ranking per REQ-v11-role-filter-after-rank.
    const semanticScores: number[] = [];
    const keywordScores: number[] = [];
    for (const entry of this.index) {
      // Semantic: pull the tool's vector from the build map. If a tool somehow
      // isn't in the map (defensive — should not happen if buildSemanticIndex
      // and buildIndex were given the same tool surface), score 0.
      const toolVec = vectors.get(entry.name);
      // WR-01 fix: graceful fallback if cosineSimilarity throws on dimension
      // mismatch (e.g., provider returned a query vector of a different
      // dimension than the build vectors — provider misbehavior, model swap,
      // or version drift). Score this tool as 0 on the semantic track so it
      // falls through to keyword-only ranking via min-max normalization,
      // rather than propagating the throw to the MCP caller (which would fail
      // the tools/call request — inconsistent with embedQuery's failure
      // philosophy: "never propagate to the MCP caller — would break the
      // session", core.ts ~309).
      let semScore = 0;
      if (toolVec) {
        try {
          semScore = cosineSimilarity(queryVec, toolVec);
        } catch {
          // Dimension mismatch (or any other cosine throw) → score 0 silently.
          // No console.warn here: the warn-once surface for query-path issues
          // is owned by embedQuery, and a per-tool dim-mismatch in the hybrid
          // path is the same class of provider misbehavior. RBAC invariant
          // also forbids logging tool names, which would be required to make
          // a per-tool warn meaningful.
          semScore = 0;
        }
      }
      semanticScores.push(semScore);
      // Keyword: per-tool deterministic score via Plan 08-01's helper.
      keywordScores.push(keywordScoreForEntry(query, entry));
    }

    // Per-query min-max normalize each track to [0, 1] (DEC-v11-08-02).
    const semanticNorm = minMaxNormalize(semanticScores);
    const keywordNorm = minMaxNormalize(keywordScores);

    // Apply hybrid formula: (semanticWeight·semNorm) + (keywordWeight·kwNorm).
    // Defaults 0.7/0.3 when weights omitted (REQ-v11-hybrid-ranking + DEC-v11-08-01).
    //
    // WR-02 fix: per-field defaults — the original `?? { 0.7, 0.3 }` only
    // defaulted when `weights` was wholly absent. A partial object like
    // `{ semanticWeight: 0.5 }` would pass through with `keywordWeight =
    // undefined`, producing silent NaN scores in combineHybrid. Defaulting
    // each field individually makes partial-weights ergonomic from JS callers
    // and keeps the engine resilient. combineHybrid still validates finiteness
    // as a defense-in-depth boundary check (caught at call site here, not
    // surfaced to MCP caller).
    const userWeights = this.config.embeddings?.weights;
    const weights = {
      semanticWeight: userWeights?.semanticWeight ?? 0.7,
      keywordWeight: userWeights?.keywordWeight ?? 0.3,
    };
    const hybridScores = combineHybrid(semanticNorm, keywordNorm, weights);

    // Build (entry, score) pairs, sort descending by hybrid score.
    const indexed = this.index.map((entry, i) => ({
      entry,
      score: hybridScores[i]!,
    }));
    indexed.sort((a, b) => b.score - a.score);

    // Drop zero-score entries (no signal at all on either track after normalization).
    //
    // LOCKED: per DEC-v11-08-02 — single/two-tool surface degenerates
    // intentionally. Min-max normalization sends the per-query MINIMUM raw
    // score to 0 even when that score was non-zero, and `max === min`
    // (single-tool / all-equal-on-track) yields all-zeros. The strict `> 0`
    // filter therefore drops entries that had real raw signal but were the
    // per-query minimum on both tracks. This is documented behavior, not a
    // bug — see CONTEXT.md DEC-v11-08-02 + REVIEW.md WR-03. Do NOT relax to
    // `>= 0` or change to a pre-normalization signal indicator without a
    // board-approved DEC update; doing so changes the observable contract for
    // every existing test and consumer.
    const withSignal = indexed.filter((x) => x.score > 0);

    // Apply role filter AFTER ranking (rank-then-filter pivot — REQ-v11-role-filter-after-rank).
    const allowed = resolveRoleAccess(role, this.config.roles, this.index);
    const allowedNames = new Set(allowed.map((e) => e.name));

    return withSignal
      .filter((x) => allowedNames.has(x.entry.name))
      .slice(0, limit)
      .map((x) => x.entry);
  }

  /**
   * Keyword-only scoring path with role-filter-after-rank pivot.
   *
   * Used for:
   *   (1) the no-vectors branch (embeddings absent OR build pending OR build failed
   *       OR build succeeded with empty tool surface), AND
   *   (2) the query-embedding-failure fallback (embedQuery returned null).
   *
   * Wave 0 empirical check verified that rank-then-filter produces byte-identical
   * observable behavior to v1.0's filter-then-rank for all 124 baseline tests +
   * Plan 08-01's ≥14 tests. The keyword scorer is deterministic per-tool — its
   * score for tool X depends only on (query, X), not on what other tools are in
   * the candidate set. So the role-allowed subset's ordering is the same either way.
   *
   * @internal Phase 8 — replaces the v1.0 inline `scoreAndRank(query, allowed, limit)`
   *   call site with a unified rank-then-filter implementation.
   * @since v1.1 (Phase 8)
   */
  private scoreAndRankKeywordWithRoleAfter(
    query: string,
    role: string | undefined,
    limit: number,
  ): ToolIndexEntry[] {
    // Score the FULL surface (rank-then-filter pivot — REQ-v11-role-filter-after-rank).
    // Pass Infinity as limit so scoreAndRank doesn't truncate before role filter applies.
    const allRanked = scoreAndRank(query, this.index, Infinity);
    const allowed = resolveRoleAccess(role, this.config.roles, this.index);
    const allowedNames = new Set(allowed.map((e) => e.name));
    return allRanked.filter((e) => allowedNames.has(e.name)).slice(0, limit);
  }

  /**
   * Build the semantic index by composing per-tool indexing strings, batching
   * them through the configured EmbeddingProvider, and storing the resulting
   * vectors as Float32Array keyed by tool name.
   *
   * Single batch call (per DEC-v11-01 + 07-CONTEXT.md §"Indexing String Composition"):
   * pass N strings, expect N vectors, parallel-array semantics.
   *
   * Validates:
   *   - vectors.length === tools.length (parallel-array contract)
   *   - all vectors share the same dimensionality (provider contract)
   *
   * Empty tool surface is a no-op (assigns empty Map, returns).
   *
   * Throws on contract violation. Caller (constructor kickoff) attaches `.catch`
   * to log the failure and leave `semanticIndex` null.
   *
   * @internal Phase 7 — Phase 8 consumes the resulting `semanticIndex` for cosine similarity.
   */
  private async buildSemanticIndex(
    tools: Tool[],
    provider: EmbeddingProvider,
  ): Promise<void> {
    if (tools.length === 0) {
      // Empty surface: build is a no-op. Mark "ready" with empty map.
      // Defense-in-depth: both wrap.ts and build.ts throw on empty tools at
      // their entry points, so this branch is unreachable in practice — but
      // direct MCPackEngine construction (e.g., in tests) may exercise it.
      this.semanticIndex = new Map();
      return;
    }

    const indexingStrings = tools.map((t) => buildIndexingString(t));
    const vectors = await provider(indexingStrings);

    // Validate parallel-array contract.
    if (vectors.length !== tools.length) {
      throw new Error(
        `MCPack: provider returned ${vectors.length} vectors for ${tools.length} tools (parallel-array contract violation)`,
      );
    }

    // Validate dimension consistency across the batch.
    if (vectors.length > 0) {
      const dim = vectors[0]!.length;
      for (let i = 1; i < vectors.length; i++) {
        if (vectors[i]!.length !== dim) {
          throw new Error(
            `MCPack: provider returned vectors of inconsistent dimensions (vector[0]=${dim}, vector[${i}]=${vectors[i]!.length})`,
          );
        }
      }
    }

    // Assemble vector store. Wrap each number[] in Float32Array for dense
    // contiguous storage (Phase 8 cosine-similarity will want this).
    this.semanticIndex = new Map(
      tools.map((t, i) => [t.name, new Float32Array(vectors[i]!)]),
    );
  }
}
