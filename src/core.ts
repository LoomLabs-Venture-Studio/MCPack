import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type {
  EmbeddingProvider,
  MCPackConfig,
  ToolIndexEntry,
  ToolCallResult,
  SearchToolResponse,
  SearchResult,
} from './types.js';
import { buildIndex } from './index-builder.js';
import { scoreAndRank } from './search.js';
import { SessionRegistry, STDIO_SESSION_ID } from './session.js';
import { resolveRoleAccess } from './roles.js';
import { buildIndexingString } from './semantic-index-builder.js';

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
  // ─── Phase 7: semantic index build state (additive — null/undefined when embeddings absent) ───
  /** Vector store keyed by tool name. `null` until the build completes successfully (or as no-op for empty tool surface). */
  private semanticIndex: Map<string, Float32Array> | null = null;
  /** Promise tracking the in-flight build. `undefined` if `embeddings` was not configured. Test fixtures may await this. */
  private indexBuildPromise: Promise<void> | undefined = undefined;

  constructor(tools: Tool[], config: MCPackConfig) {
    this.config = config;
    this.index = buildIndex(tools);
    this.sessions = new SessionRegistry(config.session);
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
   * Handle a search_tools invocation.
   *
   * Validates args, resolves session and role, searches the index,
   * and returns results with session-gated schema delivery.
   */
  handleSearchTools(
    args: Record<string, unknown>,
    sessionId: string | undefined,
  ): ToolCallResult {
    // Validate query parameter
    if (!args.query || typeof args.query !== 'string') {
      return errorResult('search_tools requires a "query" string parameter');
    }

    // Resolve session
    const sid = sessionId ?? STDIO_SESSION_ID;
    const role = this.config.defaultRole;
    const session = this.sessions.getOrCreate(sid, role ?? '');

    // Role-filter the index
    const allowed = resolveRoleAccess(role, this.config.roles, this.index);

    // Search with limit
    const maxResults = this.config.index?.maxResults ?? 10;
    const limit = Math.min(
      typeof args.limit === 'number' ? args.limit : 5,
      maxResults,
    );
    const matches = scoreAndRank(args.query as string, allowed, limit);

    // Build response with session-gated schemas
    const results: SearchResult[] = matches.map((entry) => {
      const loaded = session.loadedTools.has(entry.name);
      if (!loaded) session.loadedTools.add(entry.name);
      return loaded
        ? { name: entry.name, loaded: true }
        : { name: entry.name, loaded: false, schema: entry.schema };
    });

    // Log query to session
    session.queryLog.push({
      query: args.query as string,
      results: results.map((r) => r.name),
      timestamp: Date.now(),
    });

    // Build and return response
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
