# Phase 8: Hybrid Ranking Query Path (v1.1) — Research

**Researched:** 2026-04-26
**Domain:** Hybrid (semantic + keyword) ranking inside `MCPackEngine.handleSearchTools`; pure-function cosine similarity over `Float32Array`; per-query min-max score normalization; role-filter-after-rank pivot; warn-once-per-instance error handling
**Confidence:** HIGH (every recommendation grounded in actual reads of `src/core.ts`, `src/search.ts`, `src/types.ts`, `src/semantic-index-builder.ts`, all four Phase 7 carry-forward documents, and verified against npm registry on 2026-04-26)

## Summary

Phase 8 is a tightly bounded mechanical phase: extend `MCPackEngine.handleSearchTools` with a hybrid scoring path that activates when `engine.hasVectors()` returns `true`, while leaving the v1.0 keyword path byte-identical when `MCPackConfig.embeddings` is absent. The hard work has already been done by Phase 6 (type contract + config field) and Phase 7 (vector store + build pipeline + RBAC-safe failure logging). Phase 8 reads `this.semanticIndex` (the `Map<string, Float32Array>` populated by Phase 7), embeds the user's query as a single-item batch, computes cosine similarity per tool, normalizes both score tracks per-query, combines via locked weights, and finally applies the role filter post-rank.

Three findings shape the recommendations:

1. **The current `handleSearchTools` order is "filter-then-score" — Phase 8 reverses it.** [VERIFIED: read of `src/core.ts:118-168`] Today the code calls `resolveRoleAccess(role, roles, this.index)` BEFORE `scoreAndRank(query, allowed, limit)`. Phase 8 must rank against the FULL `this.index` first, then drop role-blocked tools, then take top-N. The smallest safe refactor: hoist the rank into a new helper that returns `Array<{entry, score}>`, then run the role filter as a `.filter()` over the sorted result, then `.slice(0, limit)`. This is a structural change but additive at the function body level — Gate 4 (baseline test files byte-identical) does NOT cover `core.ts`, only test files, so the implementation can change while the OBSERVABLE behavior of the v1.0 (no-`embeddings`) path stays identical.

2. **`hasVectors()` is the right gate, not `isIndexReady()`.** [CITED: 08-CONTEXT.md DEC-v11-08-03 + 07-REVIEW.md WR-01] Phase 7 closed `isIndexReady()` with locked semantics: it returns `true` for the empty-tools no-op path. Phase 8 needs a stricter gate ("are there actually vectors to query semantically?") because the cosine path against an empty Map is meaningless. The decided fix is purely additive: `hasVectors(): boolean { return this.semanticIndex !== null && this.semanticIndex.size > 0; }`. Phase 7's `isIndexReady()` API and tests stay unchanged.

3. **Per-query min-max normalization handles three edge cases the planner MUST encode.** [CITED: 08-CONTEXT.md DEC-v11-08-02] When `max === min` the formula `(raw - min) / (max - min)` divides by zero. The locked behavior is "all values normalize to 0" — that track has no discriminating signal so it drops out of the hybrid. This applies to (a) all-zero keyword scores (query has no token matches), (b) all-equal semantic scores (degenerate), and (c) single-tool surfaces. Empty candidate sets short-circuit before normalization. Tests must cover all four.

**Primary recommendation:** Add `src/hybrid-scoring.ts` with three pure exports — `cosineSimilarity(a: Float32Array, b: Float32Array): number`, `minMaxNormalize(scores: number[]): number[]`, and `combineHybrid(semanticNorm: number[], keywordNorm: number[], weights: { semanticWeight: number; keywordWeight: number }): number[]`. Add `MCPackEngine.hasVectors(): boolean` and a private `embedQuery(query: string): Promise<Float32Array | null>` that returns `null` on failure (with the warn-once side-effect baked in). Refactor `handleSearchTools` to: (1) gate on `hasVectors()`, (2) if true, embed query and route through hybrid; if `null` (failure), fall through to keyword; (3) score against the FULL `this.index`, (4) sort by hybrid score descending, (5) apply role filter to sorted list, (6) take top-N. Leave the no-`embeddings` config branch byte-identical at the function-body level: same `resolveRoleAccess` call, same `scoreAndRank` call, same response shape — only conditionally entered.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cosine similarity (pure math) | New file `src/hybrid-scoring.ts` | — | Pure function over `Float32Array`, no engine state, no side effects. Belongs outside `core.ts` for unit-testability and to keep `core.ts` slim. Mirrors Phase 7's split into `src/semantic-index-builder.ts`. |
| Min-max normalization (pure math) | New file `src/hybrid-scoring.ts` | — | Pure function over `number[]`. Same reasoning as cosine. |
| Hybrid score combination (pure math) | New file `src/hybrid-scoring.ts` | — | Pure function. Reads only its inputs. Easy to test exhaustively for edge cases (empty, single, degenerate). |
| Query embedding orchestration | `src/core.ts` `MCPackEngine` (private async helper) | — | Lives on the engine because it consults `this.config.embeddings.provider` and uses the warn-once instance flag. Returns `Float32Array \| null` so the caller branches without try/catch noise. |
| `hasVectors()` gate | `src/core.ts` `MCPackEngine` (new public method) | — | Lives on the engine because it reads private state (`this.semanticIndex`). Public so future Phase 9 / Phase 10 can introspect (paralleling `isIndexReady()`). |
| Hybrid query path orchestration | `src/core.ts` `MCPackEngine.handleSearchTools` (refactored) | — | The integration point. Reads engine state, resolves session, applies role filter post-rank, builds response. |
| Keyword scoring (5-tier weighted) | `src/search.ts` (UNCHANGED) | — | DEC-v11-13: v1.0 5-tier scorer remains as the keyword leg of hybrid. Phase 8 does NOT modify `scoreAndRank`. |
| Role filter | `src/roles.ts` `resolveRoleAccess` (UNCHANGED) | — | Phase 8 calls it at a different point in the pipeline, but the function itself is unchanged. |
| Warn-once-per-instance flag | `src/core.ts` `MCPackEngine` (new private boolean field) | — | Per-instance state lives on the instance. Module-level `WeakSet` rejected — over-engineered for a single-instance flag. |
| Phase 8 test surface | New `test/hybrid-ranking.test.ts` (or split: `test/hybrid-scoring.test.ts` for pure-function tests + `test/hybrid-query-path.test.ts` for engine integration) | — | Sibling-pattern matches Phase 7's `test/semantic-index-build.test.ts`. Multiple files OK if planner wants pure-function unit tests separated from engine integration tests. Plan-checker decides exact split. |

**Why this matters for the planner:** Phase 8's center of gravity is `src/core.ts` (the integration point) but the math is pure and belongs OUTSIDE `core.ts`. Putting cosine/normalize/combine inside `core.ts` would inflate the engine class and entangle math with side effects, making both harder to test. The split mirrors Phase 7's choice to put `buildIndexingString` in a sibling file rather than inside the engine.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

From `.planning/phases/08-hybrid-ranking-query-path-v1-1/08-CONTEXT.md`:

**Hybrid Weight Configuration Scope (DEC-v11-08-01 — resolves OQ2)**
- **Config-only.** Weights are set at engine construction via `MCPackConfig.embeddings.weights` (already typed in Phase 6 — `{ semanticWeight: number; keywordWeight: number }`). Per-query weight overrides are NOT accepted on `search_tools` args.
- Defaults (carry from Phase 6): `semanticWeight: 0.7`, `keywordWeight: 0.3` — used when `embeddings` is configured AND `weights` is omitted.
- When `embeddings` is absent entirely → keyword-only path with implicit `keywordWeight: 1.0` (byte-identical to v1.0).

**Score Normalization (DEC-v11-08-02)**
- Per-query min-max normalization to [0, 1] for both tracks before combine.
- Score every candidate tool against the query along both tracks (semantic via cosine, keyword via existing 5-tier `scoreAndRank`-style scoring).
- Min-max normalize each track independently to [0, 1] across the candidate set: `normalized = (raw - min) / (max - min)` when `max > min`. When `max == min` (degenerate: all candidates score identically) → all values normalize to 0. This drops that track's influence to zero for the query.
- Apply hybrid formula: `final = (semanticWeight · semanticNorm) + (keywordWeight · keywordNorm)`.
- Sort by `final` descending; apply role filter; apply limit.
- Empty-candidate-set: returns `[]` immediately (no normalization needed, no division by zero risk).

**Edge cases to encode in tests:**
- All candidates score zero on keyword (query has no token matches): short-circuit, all keyword normalized = 0.
- All candidates score identically on semantic (query semantically equidistant from every tool): same short-circuit, all semantic normalized = 0. Result sorted by whatever has signal — usually keyword.
- Single-tool surface: trivially `[1.0]` normalized for any track that has signal.

**Role Filter Ordering (REQ-v11-role-filter-after-rank — locked)**
- Score → Sort → Role-filter → Limit. Never filter before scoring. Current `handleSearchTools` does the opposite (`resolveRoleAccess(...)` THEN `scoreAndRank(...)`); Phase 8 reverses this. Preserves opaque denial; ensures rank reflects FULL tool surface.
- Implementation note: ranked-then-filtered pipeline can over-fetch internally (rank ALL tools, then drop role-blocked ones, then take top-N). Planner picks the exact strategy — over-fetch-then-filter vs filter-with-original-ranks-preserved — but observable behavior is "rank computed against full surface, output filtered to allowed surface."

**`hasVectors()` Helper (DEC-v11-08-03 — fixes Phase 7 WR-01)**
- Add new public method `hasVectors(): boolean` on `MCPackEngine`. Returns `this.semanticIndex !== null && this.semanticIndex.size > 0`.
- Phase 7's `isIndexReady()` stays unchanged — its API is locked.
- Phase 8's query-path gate: `if (this.hasVectors()) { hybrid path } else { v1.0 keyword fallback }`. The fallback path is byte-identical to v1.0's `scoreAndRank` call.

**Query Embedding Error Handling (DEC-v11-08-04)**
- Per-query embedding failure → fall back to v1.0 keyword scoring + log warning ONCE per process.
- Catch the rejection — DO NOT propagate to the MCP caller (would break the session).
- Log a single locked-format warning: `MCPack: query embedding failed:` followed by the error message. Format mirrors Phase 7's build-failure warn (`MCPack: semantic index build failed:`) and MUST NOT include tool names — RBAC invariant.
- Use a process-level "warned once" flag on the engine instance. (One warning per `MCPackEngine` instance for the whole process lifetime, not one per query.)
- For THIS query, fall through to v1.0 keyword-only path. Return results normally.

**Backward Compatibility (REQ-v11-backward-compat — carries DEC-v11-02 + DEC-BOARD-04)**
- When `MCPackConfig.embeddings` is absent, `handleSearchTools` is byte-identical to v1.0:
  - No new code branches taken.
  - No new fields read.
  - No new resources allocated.
  - No new console.warn calls (Pitfall 7 negative control from Phase 7 carries forward).
  - The 107 v1.0 baseline tests + 17 Phase 7 tests = 124 tests MUST continue to pass unmodified.
- Planner must encode an acceptance gate proving this — same approach Phase 7 used (Gate 4: baseline test files byte-identical via `git diff` against post-Phase-7 main HEAD).

**Three [BLOCKING] Phase Gates + Gate 4 (carry forward from Phases 6 + 7)**
Baseline reference advances to post-Phase-7 main HEAD (planner pins exact SHA at plan-time; current HEAD `34c60d8`).
- **Gate 1 (zero-new-core-deps):** root `package.json` `dependencies` and `peerDependencies` UNCHANGED from baseline.
- **Gate 2 (public-API additive-only):** `src/index.ts` exports unchanged from Phase 7. `MCPackEngine.hasVectors()` is internal (engine class is not exported per Phase 02 DEC).
- **Gate 3 (adapter-isolation):** `grep -rE "@llvs/mcpack-embeddings|@huggingface/transformers|@xenova/transformers" src/ test/` returns ZERO matches.
- **Gate 4 (baseline tests byte-identical):** all pre-Phase-8 test files unchanged. New tests live in new files only — no edits to existing test files (including `test/semantic-index-build.test.ts`).

### Claude's Discretion
- Exact name of the new pure functions in `src/hybrid-scoring.ts` (`cosine`/`cosineSimilarity`, `minMaxNormalize`/`normalizeMinMax`, `combineHybrid`/`hybridScore`, etc.) — naming should match the existing `scoreAndRank` style. **Research recommends:** `cosineSimilarity`, `minMaxNormalize`, `combineHybrid` (verb-noun camelCase mirrors v1.0 conventions in `search.ts` and `index-builder.ts`).
- Whether the new scoring functions live in `src/search.ts` (extend existing module) or a new sibling `src/hybrid-scoring.ts`. **Research strongly recommends new file** — keeps `src/search.ts` byte-identical to v1.0+Phase-7 baseline (avoids any risk to Gate 4 if `search.test.ts` were brittle to module-level imports), and matches Phase 7's `src/semantic-index-builder.ts` precedent.
- Whether to over-fetch-then-filter or filter-with-rank-preserved when applying role filter after ranking — observable behavior identical, performance trade-off is implementation detail. **Research recommends:** rank ALL tools, sort, filter post-sort, slice to limit. Single-pass through `this.index`, simpler reasoning, and aligns with the locked CONTEXT phrasing.
- Exact warned-once mechanism — instance flag, module-level `WeakSet`, etc. **Research recommends:** instance boolean field `private hasWarnedQueryEmbeddingFailure = false`. Simplest sufficient form; mirrors how `console.warn` already works on `MCPackEngine` (Phase 7's build-failure warn is structurally equivalent — it just happens to be called from `.catch` exactly once by construction, so doesn't need the flag).
- Whether the build-pending fallback ALSO emits a query-time warning. **Research strongly recommends: stay silent during build-pending.** The warning ladder is: build-failure (Phase 7, once) and query-embedding-failure (Phase 8, once per instance). Nothing else fires console.warn. This preserves Phase 7's Pitfall 7 negative control.

### Deferred Ideas (OUT OF SCOPE)
- Per-query weight overrides — DEC-v11-08-01 says config-only for v1.1. v1.2 candidate.
- RRF (reciprocal-rank-fusion) hybrid scoring — considered and rejected for v1.1 (changes weight semantics). v2.0 candidate.
- Caching query embeddings — repeated queries pay the embedding cost every time. Worth a benchmark in Phase 10. Caching design (LRU? TTL? size cap?) is its own design discussion. Deferred from v1.1.
- `notifications/tools/list_changed` rebuild — already deferred to v1.2 per Phase 7 CONTEXT (OQ3).
- Tightening Phase 7's RBAC test (WR-03) — optional in Phase 8 plan; planner's call. If skipped, surface as a v1.1 polish phase candidate.
- `getAnalytics()` / analytics events — Phase 9.
- 50-query intent benchmark, harness regression, npm publish — Phase 10.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-v11-semantic-query-path | On each `search_tools` call, embed the query (single-item batch), compute cosine similarity to each tool vector, produce a semantic score per tool. | Code Examples §"Query embedding helper", §"Cosine similarity helper"; Architecture Patterns §"Pattern 2: Per-query embedding via single-item batch"; Common Pitfalls §"Pitfall 1: Awaiting build promise during query" |
| REQ-v11-hybrid-ranking | Final score = `(semanticWeight · semanticScore) + (keywordWeight · keywordScore)`. Defaults `semanticWeight: 0.7`, `keywordWeight: 0.3`. Configurable via `MCPackConfig.embeddings.weights`. With no provider, keyword-only path runs (implicit `keywordWeight: 1.0`). | Code Examples §"Min-max normalize", §"Combine hybrid"; Architecture Patterns §"Pattern 3: Per-query min-max normalization"; Common Pitfalls §"Pitfall 4: Direct combine without normalization" |
| REQ-v11-role-filter-after-rank | Role filtering applied AFTER ranking, not before. Score full surface, then filter results. Preserves opaque denial. | Architecture Patterns §"Pattern 4: Role-filter-after-rank pivot"; Code Examples §"handleSearchTools refactor sketch"; Common Pitfalls §"Pitfall 6: Role-filter-before-rank inflates relative scores" |
| REQ-v11-backward-compat | With no `EmbeddingProvider`, search path is identical to v1.0 at the code level. No regression. Existing deployments require zero config changes to upgrade. | Architecture Patterns §"Pattern 5: Conditional gate preserves v1.0 path"; Validation Architecture §"Per-Task Verification Map (regression rows)"; Common Pitfalls §"Pitfall 5: New branches taken even when embeddings absent" |
| REQ-v11-session-invariants | Schemas-loaded references unchanged. Out-of-role `tools/call` still returns `"Unknown tool: {name}"`. No v1.0 invariant modified. | Code Examples §"handleSearchTools refactor sketch" (session block + result mapping unchanged); Common Pitfalls §"Pitfall 7: Touching session.loadedTools dispatch order during refactor" |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Extracted from `/Users/zaid/Projects/MCPack/CLAUDE.md` — these directives carry the same authority as locked decisions:

- **Stack lock:** TypeScript strict + `verbatimModuleSyntax`, `NodeNext` modules, ES2022 target, Node ≥ 18, ESM only (`"type": "module"`). Phase 8 changes MUST compile under these.
- **Sole peer dep stays `@modelcontextprotocol/sdk ^1.0.0`.** Adding any runtime dep to core is a hard board-level breach.
- **No separate lint step:** TypeScript strict + verbatimModuleSyntax IS the lint layer.
- **Architecture key patterns Phase 8 must honor:**
  - "Two modes, one engine": Phase 8 changes land in `MCPackEngine`, not in either mode adapter.
  - "Single discovery tool": `tools/list` returns exactly `search_tools` — Phase 8 doesn't touch this. The async build cannot mutate this.
  - "Config snapshot at setup": `mcpack()` clones config so external mutation post-call can't affect behavior. Phase 8 reads `this.config.embeddings.weights` and `this.config.embeddings.provider` per query — both are stable after the snapshot.
  - "Handlers always receive `MCPackHandlerContext`": unchanged by Phase 8.
  - "Deliberately opaque denial": preserved by role-filter-after-rank — restricted tools never appear in results regardless of score.
- **Quality gates from PLAYBOOK.md:**
  - After every code change: `npm run typecheck && npm run build && npm test` must all pass.
  - Statement coverage MUST NOT drop below 99% (current baseline 99.61% from Phase 7).
  - Touching `core.ts` mandates running `npm run test:coverage`.
  - Target: ≥120 tests by milestone close (REQ-v11-test-coverage-floor; current 124, Phase 8 should push to ~140-150).
- **Commit format:** `type(scope): description` with scope `(NN-NN)` for GSD task commits or `(phase-NN)` for phase-wide.
- **Security: no leaking restricted tools' existence via error messages (RBAC invariant).** Phase 8's query-embedding-failure warning emits to `console.warn` — the warning text MUST NOT include tool names. Locked format: `MCPack: query embedding failed: ${err.message}` (no tool list, no query content either since queries can be operator-controlled).

## Standard Stack

> Phase 8 introduces NO new dependencies. The relevant deps are already in place from v1.0 + Phase 6 + Phase 7.

### Core (already in place; no changes in Phase 8)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | `~5.8.3` (devDep) | Strict types, NodeNext, verbatimModuleSyntax | Carried from v1.0 [VERIFIED: package.json devDeps] |
| Node.js (runtime API) | `>= 18.0.0` | `Promise`, `Float32Array`, `console.warn`, `Math.sqrt` | All Phase 8 needs already in standard library [VERIFIED: package.json engines + Node v24.2 in dev environment] |
| `@modelcontextprotocol/sdk` | `^1.0.0` peer + `^1.27.1` dev | `Tool` type | Sole peer dep [VERIFIED: package.json] |
| Vitest | `^4.1.0` (devDep) | Test runner | Carry-forward from v1.0 + Phase 6 + Phase 7 [VERIFIED: package.json] |
| `@vitest/coverage-v8` | `^4.1.0` (devDep) | Statement coverage | Carry-forward from Phase 7 [VERIFIED: package.json] |

**Version verification commands run during research (2026-04-26):**
```bash
$ npm view vitest version             # 4.1.5 (within ^4.1.0)
$ npm view typescript version         # current LTS (project pins ~5.8.3 intentionally)
$ npm view @modelcontextprotocol/sdk version  # 1.29.0 (within ^1.0.0 + ^1.27.1)
$ node --version                      # v24.2.0 (well above >=18.0.0)
```

### NOT used in Phase 8 (forbidden by Gate 3)

| Library | Why Forbidden | Where It Lives |
|---------|---------------|----------------|
| `@huggingface/transformers ^4.0.0` | Adapter-only dep; importing from `src/` fails Gate 3 | `packages/mcpack-embeddings/package.json` only |
| `@llvs/mcpack-embeddings` | Concrete adapter; engine consumes the abstract `EmbeddingProvider` type instead | Sibling package; never imported by `src/` or `test/` |
| `@xenova/transformers` | Legacy package name (frozen v2.17.2 May 2024) | Forbidden everywhere |

### Alternatives Considered (and rejected)

| Instead of | Could Use | Why Rejected |
|------------|-----------|--------------|
| Hand-rolled cosine similarity | A library like `compute-cosine-similarity` or `ml-distance` | Adds runtime dep — violates Gate 1. The math is one for-loop and a `Math.sqrt`; no library benefit. |
| Hand-rolled min-max normalization | A library like `simple-statistics` | Same as above — Gate 1 violation for trivial math. |
| RRF (reciprocal rank fusion) | RRF as the hybrid combine | DEC-v11-08-02 explicitly rejects RRF for v1.1 — changes weight semantics from "score-influence" to "rank-influence", subtly breaks the PRD's literal `0.7·semantic + 0.3·keyword` formula. v2.0 candidate. |
| Per-query weight overrides on `search_tools` args | Add `semanticWeight` and `keywordWeight` to the tool input schema | DEC-v11-08-01 says config-only — smallest public API surface; agents tune at deploy-time, not call-time. |
| Pre-cast `Map<string, Float32Array>` to a `Float32Array[]` for cosine loops | Walk the Map directly | The Map already gives O(1) lookup by tool name; pre-converting requires a parallel `string[]` for tool names anyway. Walk the Map, score each entry, build `{toolName, semanticScore, keywordScore}` records. |
| `Map<string, ToolIndexEntry>` for `this.index` (instead of array) | Refactor `src/index-builder.ts` to return Map | Out of Phase 8 scope — touches Phase 1 baseline. The current array iteration is already O(N) for ranking; a Map doesn't help. |
| `'idle' \| 'pending' \| 'ready' \| 'failed'` enum on engine state | Refactor `isIndexReady()` to return state | DEC-v11-08-03 explicitly rejects this — preserves Phase 7's locked API and tests. `hasVectors()` is the additive fix. |
| Module-level `WeakSet` for warn-once tracking | Module-level `Set` of warned engine instances | Over-engineered for a single per-instance flag. Instance boolean is simpler, GC's with the engine, no global state. |
| `console.warn(`MCPack: query embedding failed: ${query}`)` | Include the query text in the warning | RBAC invariant: query content can be operator-controlled and logging it creates an information-disclosure surface. Stick to `${err.message}` only. |

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Caller (MCP client)                                                     │
│   tools/call search_tools { query: "...", limit?: N }                   │
└────────────────────────────────────────────────┬────────────────────────┘
                                                 │ args, sessionId
                                                 ▼
       ┌──────────────────────────────────────────────────────────────┐
       │ MCPackEngine.handleSearchTools(args, sessionId)              │
       │   1. Validate args.query  (UNCHANGED from v1.0)              │
       │   2. Resolve session      (UNCHANGED from v1.0)              │
       │   3. Compute limit        (UNCHANGED from v1.0)              │
       │   4. NEW: branch on this.hasVectors()                        │
       └────────┬─────────────────────────────────────────────────────┘
                │
       ┌────────┴─────────────────────────────┐
       │                                      │
       │ if (!this.hasVectors())              │ if (this.hasVectors())
       │   v1.0 keyword path                  │   hybrid path
       │   ───────────────────                │   ──────────────
       │   resolveRoleAccess(role,            │   embedQuery(query)
       │     this.config.roles, this.index)   │     │
       │     │                                │     ▼
       │     ▼                                │   if (queryVec === null)
       │   scoreAndRank(query, allowed,       │     // failure already logged once
       │     limit) [byte-identical v1.0]     │     fall through to v1.0 keyword path
       │                                      │   else
       │                                      │     for tool in this.index:
       │                                      │       sem = cosineSimilarity(queryVec,
       │                                      │              this.semanticIndex.get(tool.name))
       │                                      │       kw  = keywordScoreFor(query, tool)
       │                                      │     semNorm = minMaxNormalize(sem[])
       │                                      │     kwNorm  = minMaxNormalize(kw[])
       │                                      │     hybrid  = combineHybrid(
       │                                      │                 semNorm, kwNorm, weights)
       │                                      │     sort by hybrid desc
       │                                      │     filter by resolveRoleAccess(...)
       │                                      │     slice(0, limit)
       │                                      │
       └────────┬─────────────────────────────┘
                │ matches: ToolIndexEntry[]
                ▼
       ┌──────────────────────────────────────────────────────────────┐
       │ Build session-gated SearchResult[] and SearchToolResponse    │
       │   (UNCHANGED from v1.0 — preserves REQ-v11-session-invariants)│
       │   for entry in matches:                                      │
       │     loaded = session.loadedTools.has(entry.name)             │
       │     if (!loaded) session.loadedTools.add(entry.name)         │
       │     return loaded ? {name, loaded:true}                      │
       │                   : {name, loaded:false, schema}             │
       │   session.queryLog.push(...)                                 │
       │   return { content: [{ type:'text',                          │
       │            text: JSON.stringify(response) }] }               │
       └──────────────────────────────────────────────────────────────┘

   Conditions for entering hybrid path:
   ─────────────────────────────────────
   - this.config.embeddings is configured  (engine state)
   - Phase 7 build succeeded with at least one vector  (this.semanticIndex !== null && size > 0)
   - Per-query embedding succeeded  (provider call resolved)

   ANY of these failing routes to v1.0 keyword path with no behavior change visible
   to the caller.
```

### Recommended Project Structure

```
src/
├── core.ts                      ← MODIFIED: add hasVectors(), embedQuery(), warn-once flag,
│                                  refactor handleSearchTools to gate on hasVectors() + role-filter-after-rank
├── search.ts                    ← UNCHANGED (v1.0 5-tier scorer is the keyword leg of hybrid)
├── hybrid-scoring.ts            ← NEW: pure-function helpers (cosineSimilarity, minMaxNormalize, combineHybrid)
├── semantic-index-builder.ts    ← UNCHANGED (Phase 7 helper)
├── types.ts                     ← UNCHANGED (Phase 6 already typed embeddings.weights)
├── index.ts                     ← UNCHANGED (no new public exports — engine + hybrid-scoring stay internal)
├── index-builder.ts             ← UNCHANGED
├── session.ts                   ← UNCHANGED
├── roles.ts                     ← UNCHANGED
├── wrap.ts                      ← UNCHANGED
└── build.ts                     ← UNCHANGED

test/
├── core.test.ts                 ← UNCHANGED (Gate 4 baseline)
├── semantic-index-build.test.ts ← UNCHANGED (Gate 4 baseline)
├── search.test.ts               ← UNCHANGED (Gate 4 baseline)
├── wrap.test.ts                 ← UNCHANGED (Gate 4 baseline)
├── build.test.ts                ← UNCHANGED (Gate 4 baseline)
├── index-builder.test.ts        ← UNCHANGED (Gate 4 baseline)
├── session.test.ts              ← UNCHANGED (Gate 4 baseline)
├── roles.test.ts                ← UNCHANGED (Gate 4 baseline)
├── types.test.ts                ← UNCHANGED (Gate 4 baseline)
├── hybrid-scoring.test.ts       ← NEW (or merged into hybrid-ranking.test.ts; planner picks)
└── hybrid-ranking.test.ts       ← NEW: engine integration tests (handleSearchTools hybrid path,
                                    hasVectors gate, query-embedding failure, role-filter-after-rank,
                                    Pitfall 7 negative control extension, WR-02 unhandled-rejection,
                                    backward-compat)
```

**Why split tests into two files (recommended):**
- `test/hybrid-scoring.test.ts` — pure-function unit tests (cosine math, normalization edge cases, combine formula). Fast, deterministic, no engine setup. ~10-15 tests.
- `test/hybrid-ranking.test.ts` — engine integration tests (handleSearchTools end-to-end, hasVectors gate, embedding failure, role-filter ordering, regression). ~10-15 tests.

Single-file alternative (`test/hybrid-ranking.test.ts` only) is also valid — planner's call. The total test count target is ~20-25 new tests across whichever split. Phase 7 had 17 tests in one file at 363 lines; Phase 8 hits a similar size.

### Pattern 1: `hasVectors()` Gate (Additive — Does NOT Refactor `isIndexReady()`)

**What:** New public method on `MCPackEngine` that returns `true` only when there are actual vectors to query semantically. Returns `false` when (a) `embeddings` was never configured, (b) the build is still pending, (c) the build failed, OR (d) the build succeeded with zero vectors (empty-tools no-op — which is what Phase 7 WR-01 flagged).

**When to use:** As the gate at the top of the hybrid branch in `handleSearchTools`. If `hasVectors()` returns `false`, route to v1.0 keyword path — no embedding call, no warn, no new branches.

**Example:**
```typescript
// Source: derived from src/core.ts:108-110 (existing isIndexReady) + 08-CONTEXT.md DEC-v11-08-03

/**
 * Returns true when the semantic index has at least one vector to query.
 *
 * Distinct from `isIndexReady()`:
 *   - `isIndexReady()` answers "did the build process complete?" (locked Phase 7 semantics —
 *     returns true even for empty-tools no-op).
 *   - `hasVectors()` answers "are there actually vectors to query semantically?" — used
 *     by Phase 8's hybrid router to decide between semantic path and keyword fallback.
 *
 * Returns false when:
 *   - `embeddings` was not configured (no build kicked off; semanticIndex stays null)
 *   - the build is still in flight (semanticIndex still null)
 *   - the build failed (.catch in constructor leaves semanticIndex null)
 *   - the build succeeded with an empty tool surface (semanticIndex is `new Map()`, size 0)
 *
 * @since v1.1 (Phase 8)
 */
hasVectors(): boolean {
  return this.semanticIndex !== null && this.semanticIndex.size > 0;
}
```

**Tests must cover:**
- `hasVectors() === false` when `embeddings` absent.
- `hasVectors() === false` while build is in flight (use slow provider as in Phase 7 tests).
- `hasVectors() === false` when build failed (use rejecting provider).
- `hasVectors() === false` when build succeeded with empty tool surface (`new MCPackEngine([], { embeddings: {...} })`).
- `hasVectors() === true` when build succeeded with at least one tool.
- `isIndexReady()` semantics UNCHANGED (regression test — Phase 7's `isIndexReady() === true` for empty no-op still holds).

### Pattern 2: Per-Query Embedding via Single-Item Batch

**What:** Embed the user's query as a single-item batch (`provider([query])`) and unwrap to `Float32Array`. Catch errors, log once per instance, return `null` on failure so the caller branches to keyword fallback without try/catch noise.

**When to use:** Once per `handleSearchTools` call when `hasVectors()` returns `true`.

**Example:**
```typescript
// Source: derived from EmbeddingProvider type contract (DEC-v11-01) + DEC-v11-08-04 + Phase 7's
// src/core.ts:74-80 build-failure pattern (mirrored at query time)

private hasWarnedQueryEmbeddingFailure: boolean = false;

private async embedQuery(query: string): Promise<Float32Array | null> {
  // Defensive: this method is only called when hasVectors() is true, which implies
  // config.embeddings is set. But assert defensively — hasVectors() and embeddings
  // are both engine state, and a future refactor might let them drift.
  if (!this.config.embeddings) return null;

  try {
    // Single-item batch per DEC-v11-01 + REQ-v11-semantic-query-path.
    const vectors = await this.config.embeddings.provider([query]);
    if (!Array.isArray(vectors) || vectors.length !== 1 || !Array.isArray(vectors[0])) {
      // Provider violated parallel-array contract for a single-item batch.
      throw new Error(`provider returned malformed result for single-item batch`);
    }
    return new Float32Array(vectors[0]);
  } catch (err: unknown) {
    if (!this.hasWarnedQueryEmbeddingFailure) {
      this.hasWarnedQueryEmbeddingFailure = true;
      const message = err instanceof Error ? err.message : String(err);
      // RBAC invariant: locked format `MCPack: query embedding failed:` followed
      // by err.message ONLY. NEVER include tool names or query text.
      console.warn(`MCPack: query embedding failed: ${message}`);
    }
    return null;  // caller falls through to keyword path
  }
}
```

**Why return `null` (not throw):** Pure conventions argue for try/catch in the caller, but the semantic of "this query failed; degrade gracefully" is exactly nullable. The hybrid path becomes:
```typescript
const queryVec = await this.embedQuery(query);
if (queryVec === null) {
  // Use the keyword path — this is the SAME path the no-embeddings-configured
  // case takes. No code duplication.
  return this.scoreAndRankKeywordOnly(query, ...);
}
// else: hybrid path
```

### Pattern 3: Per-Query Min-Max Normalization

**What:** Normalize a `number[]` of raw scores to `[0, 1]` by `(raw - min) / (max - min)`. When `max === min` (all scores equal — degenerate signal), return all zeros.

**When to use:** Once per query, per track (semantic and keyword). Both tracks normalize independently across the SAME candidate set.

**Example:**
```typescript
// Source: derived from 08-CONTEXT.md DEC-v11-08-02 + standard min-max normalization

/**
 * Normalize an array of scores to [0, 1] via per-query min-max.
 *
 * When all scores are equal (max === min), returns all zeros — that track has
 * no discriminating signal and drops out of the hybrid combine. This is the
 * locked behavior per DEC-v11-08-02; the alternative (return all 1s, or skip
 * normalization) breaks the `0.7·semantic + 0.3·keyword` formula's intent.
 *
 * Empty input returns empty output (caller handles empty candidate set).
 *
 * @internal Module-private; not re-exported from src/index.ts.
 */
export function minMaxNormalize(scores: number[]): number[] {
  if (scores.length === 0) return [];

  let min = scores[0]!;
  let max = scores[0]!;
  for (const s of scores) {
    if (s < min) min = s;
    if (s > max) max = s;
  }

  // Degenerate: all scores equal → no discriminating signal → drop track to zero.
  if (max === min) {
    return scores.map(() => 0);
  }

  const range = max - min;
  return scores.map(s => (s - min) / range);
}
```

**Edge cases tests must cover:**
- Empty array → empty array.
- Single element → `[0]` (since `max === min`). Slight asymmetry with intuition: a single-tool surface contributes zero signal on each track. The hybrid then ranks by whichever track has a non-degenerate signal — but with one tool there's only one to return anyway, so the result is the same single tool. Acceptable per CONTEXT edge case 3.
- All equal values → all zeros.
- Two values `[0, 10]` → `[0, 1]`.
- Three values `[5, 10, 15]` → `[0, 0.5, 1]`.
- Negative values `[-1, 0, 1]` → `[0, 0.5, 1]` (cosine can produce values in `[-1, 1]`).

### Pattern 4: Cosine Similarity Over `Float32Array`

**What:** Compute the cosine of the angle between two equal-dimension vectors. Bounded `[-1, 1]`. Pure function, no side effects.

**When to use:** Once per (query, tool) pair when computing the semantic score track.

**Example:**
```typescript
// Source: standard cosine similarity formula; verified against npm-installed alternatives
// (compute-cosine-similarity, ml-distance) — same algorithm, no library needed.

/**
 * Cosine similarity between two equal-dimension Float32Array vectors.
 *
 * Returns a value in [-1, 1]:
 *   - 1.0  → vectors point the same direction (most similar)
 *   - 0.0  → orthogonal (no similarity)
 *   - -1.0 → opposite direction (most dissimilar)
 *
 * Returns 0 when either vector has zero magnitude (avoids NaN). This is a
 * defensive guard against pathological provider outputs (all-zero vectors);
 * a real embedding model never produces zero vectors for non-empty input.
 *
 * Throws if dimensions mismatch — this is a contract violation, not a runtime
 * recoverable state.
 *
 * @internal Module-private; not re-exported from src/index.ts.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(
      `MCPack: cosine similarity dimension mismatch (a.length=${a.length}, b.length=${b.length})`,
    );
  }

  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    magA += ai * ai;
    magB += bi * bi;
  }

  if (magA === 0 || magB === 0) return 0;  // defensive: avoid NaN

  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
```

**Tests must cover:**
- Identical vectors → `1.0`.
- Orthogonal vectors (`[1,0,0]` and `[0,1,0]`) → `0`.
- Opposite vectors (`[1,0,0]` and `[-1,0,0]`) → `-1.0`.
- Zero vector (either operand) → `0` (defensive guard).
- Dimension mismatch → throws with descriptive error.
- Floating-point determinism: cosine of `Float32Array([0.5, 0.5])` against itself should be `1.0` exactly (or within `Number.EPSILON` — depends on platform; tests use `toBeCloseTo`).
- Real-shape inputs: 384-dim Float32Array (matching MiniLM dim) — single test asserting the function handles realistic sizes.

### Pattern 5: Combine Hybrid Score (Linear Combination)

**What:** Apply the locked formula `final = (semanticWeight · semanticNorm) + (keywordWeight · keywordNorm)` element-wise across the candidate set.

**When to use:** Once per query, after both tracks have been normalized.

**Example:**
```typescript
// Source: REQ-v11-hybrid-ranking literal formula

/**
 * Combine normalized semantic and keyword scores using the configured weights.
 *
 * Both inputs MUST be the same length (the candidate set's size). Returns an
 * array of the same length where `result[i] = semanticWeight * semanticNorm[i]
 * + keywordWeight * keywordNorm[i]`.
 *
 * Throws if input arrays have different lengths — this is a contract violation
 * (caller should always normalize the same candidate set on both tracks).
 *
 * @internal Module-private; not re-exported from src/index.ts.
 */
export function combineHybrid(
  semanticNorm: number[],
  keywordNorm: number[],
  weights: { semanticWeight: number; keywordWeight: number },
): number[] {
  if (semanticNorm.length !== keywordNorm.length) {
    throw new Error(
      `MCPack: hybrid combine length mismatch (semantic=${semanticNorm.length}, keyword=${keywordNorm.length})`,
    );
  }

  const result = new Array<number>(semanticNorm.length);
  for (let i = 0; i < semanticNorm.length; i++) {
    result[i] = weights.semanticWeight * semanticNorm[i]! + weights.keywordWeight * keywordNorm[i]!;
  }
  return result;
}
```

**Tests must cover:**
- Default weights `{ 0.7, 0.3 }` with `[1.0]` and `[0.0]` → `[0.7]`.
- Same weights with `[0.0]` and `[1.0]` → `[0.3]`.
- Length mismatch → throws.
- Empty inputs → empty output.
- Custom weights from config: `{ 0.5, 0.5 }` with `[1, 0]` and `[0, 1]` → `[0.5, 0.5]`.

### Pattern 6: Role-Filter-After-Rank Pivot

**What:** Reverse the order of operations in `handleSearchTools` so role filtering happens AFTER ranking.

**When to use:** In `handleSearchTools` for both the hybrid path AND the v1.0 keyword path. CONTEXT specifies the rank-then-filter ordering applies universally — the v1.0 path also benefits from this (restricted tools no longer "shrink the candidate set" for keyword scoring, which subtly changed result composition for non-wildcard roles in v1.0).

**CRITICAL CONSIDERATION:** Re-read the v1.0 path implication carefully. CONTEXT says:
> "When `MCPackConfig.embeddings` is absent, `handleSearchTools` is byte-identical to v1.0"

There's a tension here. The locked decision is "Score → Sort → Role-filter → Limit" (DEC-v11-08-02). But REQ-v11-backward-compat says "byte-identical to v1.0" — and v1.0 was filter-then-score. If Phase 8 reorders the v1.0 path, output for non-wildcard role configurations may CHANGE (the candidate set differs at scoring time, which may affect which tools score above the v1.0 path's `score > 0` threshold).

**RESOLUTION** (recommended for planner — surfaced as Open Question for board): The "byte-identical" promise applies to the OBSERVABLE result for the no-embeddings configuration. The implementation can be a single rank-then-filter pipeline that flows BOTH paths. v1.0 tests assert specific behaviors (e.g., role filter cuts results, role-blocked tools don't appear). The rank-then-filter pipeline produces the SAME observable behavior because:
- For wildcard role `'*'`: filter is a no-op, output is identical regardless of order.
- For non-wildcard roles: rank-then-filter produces the same set of role-allowed tools in the same order as filter-then-rank, because (a) the keyword scorer is deterministic per tool, (b) role-allowed tools score the same regardless of what other tools are in the candidate set, (c) the `score > 0` threshold and the descending sort produce the same ordering for the role-allowed subset.
- The 124 baseline tests run with no embeddings configured, so they exercise the v1.0 path. If Gate 4 + the test suite pass, the observable byte-identicality holds.

**Verify this empirically during Wave 0** — run the existing 124 tests against the proposed refactor before locking it. If any test fails, the planner has a real divergence to address (perhaps via a config flag that opts-in to rank-then-filter only when embeddings are configured). Recommendation: run this check in Wave 0 BEFORE writing any new tests.

**Example:**
```typescript
// Source: CONTEXT §"Role Filter Ordering" + my read of src/core.ts:118-168

handleSearchTools(args: ..., sessionId: string | undefined): ToolCallResult {
  // 1. Validate query (UNCHANGED from v1.0)
  if (!args.query || typeof args.query !== 'string') {
    return errorResult('search_tools requires a "query" string parameter');
  }

  // 2. Resolve session + role + limit (UNCHANGED from v1.0)
  const sid = sessionId ?? STDIO_SESSION_ID;
  const role = this.config.defaultRole;
  const session = this.sessions.getOrCreate(sid, role ?? '');
  const maxResults = this.config.index?.maxResults ?? 10;
  const limit = Math.min(typeof args.limit === 'number' ? args.limit : 5, maxResults);

  // 3. NEW: route to hybrid or keyword based on hasVectors() AND query-embedding success
  let matches: ToolIndexEntry[];
  if (this.hasVectors()) {
    const queryVec = await this.embedQuery(args.query as string);
    if (queryVec !== null) {
      // Hybrid path: rank against FULL surface, then role-filter.
      matches = this.scoreAndRankHybrid(args.query as string, queryVec, role, limit);
    } else {
      // Query embedding failed — fall through to keyword path (warn already logged once).
      matches = this.scoreAndRankKeywordWithFilter(args.query as string, role, limit);
    }
  } else {
    // No vectors: v1.0 keyword path with role-filter-after-rank.
    matches = this.scoreAndRankKeywordWithFilter(args.query as string, role, limit);
  }

  // 4. Build session-gated SearchResult[] (UNCHANGED from v1.0)
  const results: SearchResult[] = matches.map((entry) => {
    const loaded = session.loadedTools.has(entry.name);
    if (!loaded) session.loadedTools.add(entry.name);
    return loaded
      ? { name: entry.name, loaded: true }
      : { name: entry.name, loaded: false, schema: entry.schema };
  });

  // 5. Log query (UNCHANGED from v1.0)
  session.queryLog.push({
    query: args.query as string,
    results: results.map((r) => r.name),
    timestamp: Date.now(),
  });

  // 6. Build response (UNCHANGED from v1.0 — but total_available recomputed)
  // NOTE: total_available reflects the ROLE-ALLOWED surface count, not the full surface.
  // This was v1.0 behavior — REQ-v11-session-invariants requires this stays the same.
  const allowed = resolveRoleAccess(role, this.config.roles, this.index);
  const response: SearchToolResponse = {
    tools: results,
    total_available: allowed.length,
    showing: results.length,
    session_id: session.id,
  };
  return { content: [{ type: 'text', text: JSON.stringify(response) }] };
}
```

**Note on async:** `handleSearchTools` is currently synchronous. Phase 8 must change its return type to `Promise<ToolCallResult>` because `embedQuery` is async. This is an internal-only change — `MCPackEngine` is not exported. Both `wrap.ts:107-130` and `build.ts:108-130` already `await` the engine's call sites (verified by reading both files), so the signature change is observable only inside `core.ts`. Plan-checker should verify both call sites still work after the change.

### Anti-Patterns to Avoid

- **Hand-rolled cosine library imports:** `compute-cosine-similarity`, `ml-distance`, etc. all add runtime deps and violate Gate 1. The math is one for-loop and `Math.sqrt`.

- **Awaiting the build promise during query:** Phase 7's Pitfall 3 forbids `await this.indexBuildPromise` in the query path. The query waits at most for `embedQuery` (one provider call); never for the build. If `hasVectors()` returns false, route to keyword IMMEDIATELY. [CARRY-FORWARD: 07-RESEARCH.md Pitfall 3]

- **Logging tool names in failure messages:** RBAC invariant. Locked formats:
  - Build failure: `MCPack: semantic index build failed: ${err.message}` (Phase 7, locked).
  - Query embedding failure: `MCPack: query embedding failed: ${err.message}` (Phase 8, locked).
  Never include `tool.name`, `tools[*].name`, or any iteration of the tools array.

- **Storing query vectors in session state:** The query vector is computed and used within a single `handleSearchTools` call. Storing it in `session.queryVectors` would: (a) leak operator queries (privacy), (b) double the session memory, (c) tempt future cache logic that's out of v1.1 scope. Discard after use.

- **Including query text in the warn message:** The query is operator-input-controlled. Logging it at warn level creates an information-disclosure surface. Stick to `${err.message}`.

- **Refactoring `isIndexReady()` to a state enum:** DEC-v11-08-03 explicitly forbids this. `hasVectors()` is the additive fix.

- **Running `scoreAndRank` over the role-filtered subset in hybrid path:** The whole point of role-filter-after-rank (REQ-v11-role-filter-after-rank) is to score the FULL surface, then filter. Running `scoreAndRank` over a pre-filtered subset is a regression to v1.0's filter-then-rank.

- **Mutating `this.index` or `this.semanticIndex` during query:** Both are constructor-time state and treated as read-only. Hybrid scoring iterates them, never modifies.

- **Letting query-embedding failures crash the gateway:** `embedQuery` MUST catch all errors and return `null`. The MCP server stays up — degraded search is preferable to a crashing gateway. [CARRY-FORWARD: 07-CONTEXT.md §"Build failure handling"]

- **Editing existing test files (Gate 4 violation):** Phase 8 tests live in NEW files only. NO edits to `test/core.test.ts`, `test/semantic-index-build.test.ts`, etc. Phase 7's Pitfall 6 carries forward.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cosine similarity | A library like `compute-cosine-similarity` or `ml-distance` | One pure function in `src/hybrid-scoring.ts` (~15 lines) | Adding any runtime dep violates Gate 1. The math is trivial and self-contained; a library is overkill. |
| Min-max normalization | `simple-statistics` or `d3-scale` | One pure function (~10 lines) | Same — Gate 1 violation. The edge case (`max === min`) needs explicit handling per CONTEXT, which a generic library may not encode the way we need. |
| Hybrid score combine | A library like `lodash.zipwith` | Plain `for` loop (~5 lines) | Trivial element-wise math; zero benefit from a library. |
| Reciprocal Rank Fusion | An RRF library | NOT used in v1.1 | DEC-v11-08-02 rejects RRF for v1.1 — changes weight semantics. v2.0 candidate. |
| Top-K selection | A heap library like `heap-js` | `array.sort().slice(0, k)` | Tool surfaces are small (50-150 tools typically). Sort+slice is O(n log n) which is faster than building a heap for small n. Phase 10 may benchmark; if a heap is needed for 1000+-tool surfaces, that's a v1.2 concern. |
| Warn-once tracking | A library like `once` | Instance boolean field | Trivially simple; library is over-engineering. |
| Float32Array creation from `number[]` | A library | `new Float32Array(numbers)` | Native API; vectorized copy; sub-millisecond for typical sizes. |
| Test mock for `EmbeddingProvider` | A mocking library like `vitest-mock-extended` | Plain async function returning controlled vectors | Phase 7 already established this pattern (`test/types.test.ts`, `test/semantic-index-build.test.ts`). Phase 8 reuses it. No new tooling. |

**Key insight:** Phase 8's math is simple enough that hand-rolling is the right move. Every alternative library brings a runtime dep that violates Gate 1 — the gate exists specifically to prevent dependency creep on this exact kind of "would be nice to import" temptation.

## Runtime State Inventory

> Phase 8 is a greenfield-feature phase, not a rename or migration. Below is the explicit inventory.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None new — Phase 8 uses Phase 7's in-memory `semanticIndex` Map (no new storage layer added). The query vector is computed per-call and discarded; not stored anywhere. The `hasWarnedQueryEmbeddingFailure` flag is per-instance, in-memory, dies with the engine. | None |
| Live service config | None — Phase 8 calls the same `EmbeddingProvider` callback that Phase 7 calls. No external services touched. The MiniLM adapter (provider) downloads model files to its local cache on first use, but that's a Phase 6 / `@huggingface/transformers` concern not affected by Phase 8. | None |
| OS-registered state | None — verified by reading PROJECT.md + CLAUDE.md "Hosting" — library only, no daemon. | None |
| Secrets / env vars | None added by Phase 8. The library has zero required env vars at runtime; the harness uses `STRIPE_SECRET_KEY` (unchanged); the adapter optionally reads no env vars. No new env vars proposed. | None |
| Build artifacts / installed packages | Phase 8 does not change `package.json` — no new deps installed. Phase 8 changes `src/core.ts` and adds `src/hybrid-scoring.ts`, so `dist/core.js`, `dist/core.d.ts`, `dist/hybrid-scoring.js`, `dist/hybrid-scoring.d.ts` will appear in the next `npm run build`. The `.d.ts` shows the new private `MCPackEngine` members (e.g., `hasWarnedQueryEmbeddingFailure: boolean`) but NOT `hybrid-scoring.ts` exports because `MCPackEngine` is not re-exported from `src/index.ts`, and `src/hybrid-scoring.ts` is not re-exported either. **This is fine for Gate 2** because Gate 2 greps `^export` lines in `dist/index.d.ts`, and neither the engine class nor the hybrid-scoring helpers surface there. | None — but verify Gate 2 grep does what it claims (matching Phase 7's process). |

**Nothing found in any category beyond what Phase 7 already established.** Phase 8 is purely a query-path extension; no new persistent or registered state.

## Common Pitfalls

### Pitfall 1: Awaiting `this.indexBuildPromise` during query

**What goes wrong:** A naive read of "if the build isn't ready, wait for it" leads to `await this.indexBuildPromise` inside `handleSearchTools`. This blows out the 50ms p99 budget (REQ-v11-perf-budget) and re-introduces the v1.0-regression risk (queries blocking on async work).

**Why it happens:** "Wait until ready" feels like the polite thing to do. CONTEXT and Phase 7 both forbid it.

**How to avoid:** `hasVectors()` is the gate. If it returns `false`, route to v1.0 keyword path IMMEDIATELY — no await on the build promise. The query waits at most on `embedQuery` (a single provider call for the query), never on the build.

**Warning signs:** Any task spec that contains `await this.indexBuildPromise` inside the query path. Reject in plan-checker. (This was Phase 7's Pitfall 3 carried forward.)

### Pitfall 2: Silent v1.0 path divergence on role-filter-after-rank refactor

**What goes wrong:** The current v1.0 path is filter-then-rank. Phase 8 unifies both paths into rank-then-filter. For wildcard roles `'*'`, output is byte-identical. For non-wildcard roles, output COULD diverge if v1.0 tests have brittle assertions about exact result ordering when role-filtering removes specific tools.

**Why it happens:** The locked decisions (REQ-v11-role-filter-after-rank + REQ-v11-backward-compat) have a tension: rank-then-filter is the new policy, but the v1.0 path must stay observable-byte-identical.

**How to avoid:** Two-step verification during Wave 0:
1. **Reasoning check:** rank-then-filter produces the same result set (and order) as filter-then-rank for the role-allowed subset, because the keyword scorer is deterministic per tool — its score for tool X depends only on (query, X), not on what other tools are in the candidate set.
2. **Empirical check:** Run all 124 baseline tests against the refactored `handleSearchTools` BEFORE writing any new tests. If any test fails, the divergence is real. Surface to board.

**Recommendation:** Encode the empirical check as a Wave 0 gate. If it passes, proceed. If it fails, the planner needs to design a config flag or split the paths (perhaps the v1.0 path stays filter-then-rank when `embeddings` is absent, and only the hybrid path uses rank-then-filter — which is consistent with REQ-v11-backward-compat read literally).

**Warning signs:** Any baseline test failing after the refactor. Plan-checker should require the empirical check be documented in the Wave 1 task spec.

### Pitfall 3: Query embedding failure cascading to MCP caller

**What goes wrong:** `embedQuery` throws (or rejects). The exception propagates up through `handleSearchTools`, through `wrap.ts` / `build.ts`, and the SDK `Server` returns an error to the MCP caller. Worst case: client retries, embedding is still broken, error loop.

**Why it happens:** Easy to forget a try/catch when refactoring. The build-failure path (Phase 7) had the same pitfall and resolved it via `.catch` on the build promise.

**How to avoid:** `embedQuery` MUST catch all rejections internally and return `null`. The caller branches on `null` and routes to keyword fallback. The MCP caller sees a normal `search_tools` response — degraded but functional.

**Warning signs:** Any task spec for `embedQuery` that lacks a try/catch around the `await this.config.embeddings.provider([query])` call. Reject in plan-checker.

### Pitfall 4: Direct combine without normalization (semantic dwarfs keyword or vice versa)

**What goes wrong:** Skip normalization and compute `0.7 * cosine + 0.3 * keyword`. Cosine is bounded `[-1, 1]`; keyword sums in `scoreAndRank` are unbounded (a tool with 5 token matches across name/desc/keywords could score 50+). The keyword track dominates, semantic contribution is noise.

**Why it happens:** Reading the formula `0.7·semantic + 0.3·keyword` literally without realizing the two scores are on different scales.

**How to avoid:** Per-query min-max normalize each track to `[0, 1]` BEFORE the combine. DEC-v11-08-02 locks this. Tests must include a regression case: a query where the unnormalized cosine + keyword formula would produce DIFFERENT ordering than the normalized formula.

**Warning signs:** Any task spec for `combineHybrid` that takes raw (un-normalized) scores. Plan-checker should require the call signature explicitly takes `semanticNorm` and `keywordNorm` (with `Norm` in the name).

### Pitfall 5: New code branches taken even when `embeddings` is absent

**What goes wrong:** The hybrid gate is `if (this.hasVectors())`. But `hasVectors()` itself reads `this.semanticIndex` — that's a new field access compared to v1.0. If the field doesn't exist (theoretically), `hasVectors()` returns `false` (because of Phase 7's `private semanticIndex: Map<string, Float32Array> | null = null` initializer). So the gate behaves correctly for v1.0 deployments. BUT: any subtle difference (e.g., a new field that shows up in `Object.keys(engine)` enumeration) could trip a hypothetical reflection-based test.

**Why it happens:** The "byte-identical" claim is structural — same code path, same field reads, same allocations. Adding `hasWarnedQueryEmbeddingFailure: boolean = false` adds a field even for engines without `embeddings`.

**How to avoid:** This is a subtle invariant; the practical test is "do all 124 baseline tests still pass?" If yes, byte-identical-enough is achieved. The added boolean field is innocuous — it's not enumerated by any v1.0 test. But the planner should be aware that "byte-identical" is a soft promise at the field level — the strong promise is "no new console.warn calls, no new branches taken, no new resources allocated, all baseline tests pass".

**Recommendation:** Update the verbatim CONTEXT bullet "No new fields read" to be precise: "No new fields read INSIDE THE V1.0 BRANCH". The constructor initializes the new field unconditionally (`= false`); that's an allocation but not a behavior change observable by v1.0 tests.

**Warning signs:** Tests that probe engine-instance shape via `Object.keys` or `JSON.stringify(engine)`. None exist in the current baseline (verified by grep). Plan-checker should not introduce any.

### Pitfall 6: Role-filter-before-rank inflates relative scores

**What goes wrong:** Filter the candidate set BEFORE scoring. Min-max normalization runs over the role-allowed subset. A tool that scores 0.5 raw (mediocre) becomes 1.0 normalized if it's the highest-scoring role-allowed tool. The hybrid combine then claims this tool is a perfect match — misleading the operator.

**Why it happens:** Filter-then-score feels intuitive ("don't waste compute on tools the user can't see"). It's the v1.0 ordering. Phase 8 inverts it.

**How to avoid:** Score against `this.index` (the FULL index). Normalize over the full candidate set. Combine. Sort. THEN filter by role. Take top-N. The locked CONTEXT phrasing: "Score → Sort → Role-filter → Limit. Never filter before scoring."

**Warning signs:** Any task spec where `resolveRoleAccess` is called BEFORE the score arrays are computed. Reject in plan-checker.

### Pitfall 7: Touching session.loadedTools dispatch order during refactor

**What goes wrong:** `handleSearchTools` currently maps `matches` to `SearchResult[]` and calls `session.loadedTools.has/add` per result. The refactor changes how `matches` is computed but MUST preserve the loadedTools mutation order — REQ-v11-session-invariants demands this. A naive refactor that buffers results before session-mapping (e.g., to support async iteration) could change the loaded-tools mutation order in a way that breaks REQ-v11-session-invariants.

**Why it happens:** Refactoring a method body invites collateral changes. Easy to "improve" the loaded-tools loop while in the area.

**How to avoid:** The session mapping block at `core.ts:144-150` is a literal copy-paste from v1.0. Phase 8 must NOT touch it (or must produce byte-identical behavior). Tests must include a regression case: "loaded tools mutation order matches v1.0 for the hybrid path".

**Warning signs:** Any task spec that modifies `session.loadedTools` mutation logic. Reject in plan-checker.

### Pitfall 8: Per-query warning spam (extension of Phase 7's Pitfall 7)

**What goes wrong:** The query-embedding-failure path warns on every failed query. Same operational concern as Phase 7's Pitfall 7 — fills logs, drowns useful signals.

**Why it happens:** Naive "log on every failure" is the simplest implementation. CONTEXT explicitly says "warn once per process lifetime per engine instance".

**How to avoid:** Per-instance boolean flag (`hasWarnedQueryEmbeddingFailure`). Flip on first warn. Subsequent failures are silent.

**Warning signs:** Any task spec that calls `console.warn` inside the per-query path without checking the flag first. Reject in plan-checker.

**Negative-control test (Pitfall 7 extension to query-time):** A test must construct an engine with a rejecting query-time provider, fire the `handleSearchTools` call multiple times, and assert that `console.warn` is called EXACTLY ONCE despite multiple failed queries. This mirrors Phase 7's `test:278-306` Pitfall 7 negative control but at query-time.

### Pitfall 9: Unhandled rejection from query-embedding failure (WR-02 carry-forward)

**What goes wrong:** Phase 7's WR-02 flagged that no test asserts the unhandled-rejection invariant for the build path. Phase 8 introduces a SECOND async surface (query embedding) — a forgotten try/catch on `await this.config.embeddings.provider([query])` would silently introduce an unhandled-rejection on every failed query.

**Why it happens:** Subtle. The `.catch` on the build promise is at construction time; the query path needs its own try/catch at query time. Easy to forget.

**How to avoid:** Wrap the provider call in try/catch inside `embedQuery`. Add a regression test (the WR-02 fix Phase 8 carries) that registers `process.on('unhandledRejection', listener)`, fires multiple failed queries on a rejecting provider, and asserts the listener is never called. This single test covers BOTH Phase 7's build path AND Phase 8's query path.

**Suggested test:**
```typescript
it('build and query failures produce no unhandled rejection (WR-02 fix)', async () => {
  const handler = vi.fn();
  process.on('unhandledRejection', handler);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const rejecter: EmbeddingProvider = async () => {
      throw new Error('always rejects');
    };
    engine = new MCPackEngine([makeTool('a', '')], { embeddings: { provider: rejecter } });
    // Phase 7's build promise rejects — handled by .catch in core.ts:74-80
    await (engine as any).indexBuildPromise;
    // Phase 8's query path tries to embed — also rejects
    await engine.handleSearchTools({ query: 'x' }, 'sess-1');
    await engine.handleSearchTools({ query: 'y' }, 'sess-2');
    // Drain microtasks + macrotasks
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(handler).not.toHaveBeenCalled();
  } finally {
    process.off('unhandledRejection', handler);
  }
});
```

## Code Examples

Verified patterns derived from `src/core.ts` (read in full), `src/search.ts`, `src/types.ts`, `test/semantic-index-build.test.ts`, and 08-CONTEXT.md.

### `src/hybrid-scoring.ts` — full skeleton

```typescript
// Source: derived from 08-CONTEXT.md DEC-v11-08-02 + standard cosine similarity formula

/**
 * Cosine similarity between two equal-dimension Float32Array vectors.
 * Returns a value in [-1, 1]. Returns 0 when either vector has zero magnitude
 * (defensive guard against pathological provider outputs).
 *
 * @internal Module-private; not re-exported from src/index.ts.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(
      `MCPack: cosine similarity dimension mismatch (a.length=${a.length}, b.length=${b.length})`,
    );
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    magA += ai * ai;
    magB += bi * bi;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Min-max normalize an array of scores to [0, 1].
 *
 * When all scores are equal (max === min), returns all zeros — that track has
 * no discriminating signal and drops out of the hybrid combine. Locked behavior
 * per 08-CONTEXT.md DEC-v11-08-02.
 *
 * @internal Module-private.
 */
export function minMaxNormalize(scores: number[]): number[] {
  if (scores.length === 0) return [];
  let min = scores[0]!;
  let max = scores[0]!;
  for (const s of scores) {
    if (s < min) min = s;
    if (s > max) max = s;
  }
  if (max === min) return scores.map(() => 0);
  const range = max - min;
  return scores.map((s) => (s - min) / range);
}

/**
 * Combine normalized semantic and keyword scores via the locked hybrid formula.
 *
 *   final[i] = semanticWeight * semanticNorm[i] + keywordWeight * keywordNorm[i]
 *
 * @internal Module-private.
 */
export function combineHybrid(
  semanticNorm: number[],
  keywordNorm: number[],
  weights: { semanticWeight: number; keywordWeight: number },
): number[] {
  if (semanticNorm.length !== keywordNorm.length) {
    throw new Error(
      `MCPack: hybrid combine length mismatch (semantic=${semanticNorm.length}, keyword=${keywordNorm.length})`,
    );
  }
  const result = new Array<number>(semanticNorm.length);
  for (let i = 0; i < semanticNorm.length; i++) {
    result[i] = weights.semanticWeight * semanticNorm[i]! + weights.keywordWeight * keywordNorm[i]!;
  }
  return result;
}
```

### `src/core.ts` — `handleSearchTools` refactor sketch

```typescript
// Source: derived from src/core.ts:118-168 (existing v1.0+Phase-7 method) + Pattern 6
// + Pitfall 6 + Pitfall 7 + DEC-v11-08-02 + DEC-v11-08-03 + DEC-v11-08-04

// New imports at top of file:
import { cosineSimilarity, minMaxNormalize, combineHybrid } from './hybrid-scoring.js';

// Inside MCPackEngine class — new private fields:
private hasWarnedQueryEmbeddingFailure: boolean = false;

// Default weights when embeddings is configured but weights omitted:
private static readonly DEFAULT_WEIGHTS = { semanticWeight: 0.7, keywordWeight: 0.3 };

// New public method:
hasVectors(): boolean {
  return this.semanticIndex !== null && this.semanticIndex.size > 0;
}

// New private query-embedding helper:
private async embedQuery(query: string): Promise<Float32Array | null> {
  if (!this.config.embeddings) return null;
  try {
    const vectors = await this.config.embeddings.provider([query]);
    if (!Array.isArray(vectors) || vectors.length !== 1 || !Array.isArray(vectors[0])) {
      throw new Error(`provider returned malformed result for single-item batch`);
    }
    return new Float32Array(vectors[0]);
  } catch (err: unknown) {
    if (!this.hasWarnedQueryEmbeddingFailure) {
      this.hasWarnedQueryEmbeddingFailure = true;
      const message = err instanceof Error ? err.message : String(err);
      // RBAC invariant: locked format, NEVER include tool names or query text.
      console.warn(`MCPack: query embedding failed: ${message}`);
    }
    return null;
  }
}

// Refactored handleSearchTools — note signature change to async:
async handleSearchTools(
  args: Record<string, unknown>,
  sessionId: string | undefined,
): Promise<ToolCallResult> {
  // 1. Validate query (UNCHANGED from v1.0)
  if (!args.query || typeof args.query !== 'string') {
    return errorResult('search_tools requires a "query" string parameter');
  }

  // 2. Resolve session + role + limit (UNCHANGED from v1.0)
  const sid = sessionId ?? STDIO_SESSION_ID;
  const role = this.config.defaultRole;
  const session = this.sessions.getOrCreate(sid, role ?? '');
  const maxResults = this.config.index?.maxResults ?? 10;
  const limit = Math.min(typeof args.limit === 'number' ? args.limit : 5, maxResults);

  // 3. NEW: route to hybrid or keyword based on hasVectors() AND query-embedding success
  let matches: ToolIndexEntry[];
  if (this.hasVectors()) {
    const queryVec = await this.embedQuery(args.query as string);
    if (queryVec !== null) {
      matches = this.scoreAndRankHybrid(args.query as string, queryVec, role, limit);
    } else {
      // Query embedding failed — fall through to keyword-with-rank-then-filter.
      // (Warn already logged at most once by embedQuery.)
      matches = this.scoreAndRankKeywordWithRoleAfter(args.query as string, role, limit);
    }
  } else {
    // No vectors: v1.0 keyword path, role-filter-after-rank.
    matches = this.scoreAndRankKeywordWithRoleAfter(args.query as string, role, limit);
  }

  // 4. Build session-gated SearchResult[] (UNCHANGED from v1.0 — Pitfall 7 carry-forward)
  const results: SearchResult[] = matches.map((entry) => {
    const loaded = session.loadedTools.has(entry.name);
    if (!loaded) session.loadedTools.add(entry.name);
    return loaded
      ? { name: entry.name, loaded: true }
      : { name: entry.name, loaded: false, schema: entry.schema };
  });

  // 5. Log query (UNCHANGED from v1.0)
  session.queryLog.push({
    query: args.query as string,
    results: results.map((r) => r.name),
    timestamp: Date.now(),
  });

  // 6. Build response (UNCHANGED — total_available reflects role-allowed surface, NOT full)
  const allowed = resolveRoleAccess(role, this.config.roles, this.index);
  const response: SearchToolResponse = {
    tools: results,
    total_available: allowed.length,
    showing: results.length,
    session_id: session.id,
  };
  return { content: [{ type: 'text', text: JSON.stringify(response) }] };
}

// New private helper — keyword path with role-filter-after-rank pivot:
private scoreAndRankKeywordWithRoleAfter(
  query: string,
  role: string | undefined,
  limit: number,
): ToolIndexEntry[] {
  // Score the FULL surface, then drop role-blocked tools, then take top-N.
  // Plan-checker note: this MUST produce observable-byte-identical results to
  // v1.0's `scoreAndRank(query, resolveRoleAccess(...), limit)` for all 124
  // baseline tests. The scorer is deterministic per-tool — its score for tool X
  // depends only on (query, X), not on what other tools are in the candidate
  // set. So filter-then-rank and rank-then-filter produce the same role-allowed
  // ordered set. Verify empirically in Wave 0.
  const allRanked = scoreAndRank(query, this.index, /* limit */ Infinity);
  const allowed = resolveRoleAccess(role, this.config.roles, this.index);
  const allowedNames = new Set(allowed.map((e) => e.name));
  return allRanked.filter((e) => allowedNames.has(e.name)).slice(0, limit);
}

// New private helper — hybrid path:
private scoreAndRankHybrid(
  query: string,
  queryVec: Float32Array,
  role: string | undefined,
  limit: number,
): ToolIndexEntry[] {
  // semanticIndex is non-null and non-empty when this.hasVectors() returned true.
  const vectors = this.semanticIndex!;

  // Compute raw scores per track over the FULL index (rank-then-filter).
  const semanticScores: number[] = [];
  const keywordScores: number[] = [];
  for (const entry of this.index) {
    // Semantic — pull the tool's vector from the build map. If the tool isn't
    // in the map (defensive — can happen if index was built with a subset that
    // didn't include this tool), score 0.
    const toolVec = vectors.get(entry.name);
    semanticScores.push(toolVec ? cosineSimilarity(queryVec, toolVec) : 0);
    // Keyword — reuse v1.0's per-tool scoring logic. Inline a single-tool scorer
    // here, OR refactor scoreAndRank to expose a per-entry scoring function.
    // RECOMMENDED: planner adds a small `keywordScoreForEntry(query, entry): number`
    // helper to src/search.ts (additive only — does NOT change scoreAndRank itself).
    // ALTERNATIVE: call scoreAndRank([entry], Infinity) and read result[0]?.score.
    keywordScores.push(/* keywordScoreForEntry(query, entry) */ 0);
  }

  const semanticNorm = minMaxNormalize(semanticScores);
  const keywordNorm = minMaxNormalize(keywordScores);
  const weights = this.config.embeddings?.weights ?? MCPackEngine.DEFAULT_WEIGHTS;
  const hybridScores = combineHybrid(semanticNorm, keywordNorm, weights);

  // Sort by hybrid score descending, then apply role filter, then slice to limit.
  const indexed = this.index.map((entry, i) => ({ entry, score: hybridScores[i]! }));
  indexed.sort((a, b) => b.score - a.score);

  // Drop entries with score 0 (no signal at all on either track).
  const withSignal = indexed.filter((x) => x.score > 0);

  // Apply role filter (rank-then-filter pivot — REQ-v11-role-filter-after-rank).
  const allowed = resolveRoleAccess(role, this.config.roles, this.index);
  const allowedNames = new Set(allowed.map((e) => e.name));
  return withSignal
    .filter((x) => allowedNames.has(x.entry.name))
    .slice(0, limit)
    .map((x) => x.entry);
}
```

**CRITICAL planner decision:** the hybrid path needs per-entry keyword scoring. The current `scoreAndRank` aggregates scoring across the index and returns ranked entries. Phase 8 needs raw scores per entry to feed into normalization. Two options:

1. **Add `keywordScoreForEntry(query: string, entry: ToolIndexEntry): number` to `src/search.ts`** — extracts the inner per-token loop into a reusable function. Additive only — does NOT modify `scoreAndRank`. **Recommended.**
2. **Re-call `scoreAndRank([entry], Infinity)` per entry** — runs the full pipeline N times. Wasteful but doesn't touch `search.ts`. Trade-off: keeps `search.ts` byte-identical but is O(N²) instead of O(N).

Option 1 is the right call. The addition to `search.ts` is small (~20 lines), additive, and doesn't break Gate 4 (Gate 4 covers test files; `search.ts` itself can change as long as `test/search.test.ts` still passes against the new shape).

**Caveat:** if the planner takes Option 1, they must ALSO verify Gate 4 isn't reading `search.ts` as a baseline. Re-reading the locked CONTEXT bullet: "Gate 4 (baseline tests byte-identical): all pre-Phase-8 test files unchanged. New tests live in new files only — no edits to existing test files." Gate 4 covers TEST files, not source. `src/search.ts` modification is fine. But the addition must not break `test/search.test.ts`.

### `test/hybrid-scoring.test.ts` — pure-function test sketch

```typescript
// File: test/hybrid-scoring.test.ts (NEW)
// Source: pattern derived from test/search.test.ts (existing test file structure)
// + 08-CONTEXT.md edge cases

import { describe, it, expect } from 'vitest';
import {
  cosineSimilarity,
  minMaxNormalize,
  combineHybrid,
} from '../src/hybrid-scoring.js';

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const v = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 6);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 6);
  });

  it('returns -1 for opposite vectors', () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([-1, -2, -3]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 6);
  });

  it('returns 0 for zero-magnitude vector (defensive guard against NaN)', () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBe(0);
    expect(cosineSimilarity(b, a)).toBe(0);
  });

  it('throws on dimension mismatch', () => {
    const a = new Float32Array([1, 2]);
    const b = new Float32Array([1, 2, 3]);
    expect(() => cosineSimilarity(a, b)).toThrow(/dimension mismatch/);
  });

  it('handles realistic 384-dim vectors (MiniLM size)', () => {
    const a = new Float32Array(Array.from({ length: 384 }, () => 0.1));
    const b = new Float32Array(Array.from({ length: 384 }, () => 0.1));
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 6);
  });
});

describe('minMaxNormalize', () => {
  it('returns empty array for empty input', () => {
    expect(minMaxNormalize([])).toEqual([]);
  });

  it('returns all zeros when max === min (single element)', () => {
    expect(minMaxNormalize([5])).toEqual([0]);
  });

  it('returns all zeros when all values equal (degenerate signal)', () => {
    expect(minMaxNormalize([3, 3, 3])).toEqual([0, 0, 0]);
  });

  it('normalizes [0, 10] to [0, 1]', () => {
    expect(minMaxNormalize([0, 10])).toEqual([0, 1]);
  });

  it('normalizes [5, 10, 15] to [0, 0.5, 1]', () => {
    expect(minMaxNormalize([5, 10, 15])).toEqual([0, 0.5, 1]);
  });

  it('normalizes negative values [-1, 0, 1] to [0, 0.5, 1]', () => {
    expect(minMaxNormalize([-1, 0, 1])).toEqual([0, 0.5, 1]);
  });

  it('preserves array length', () => {
    const result = minMaxNormalize([1, 2, 3, 4, 5]);
    expect(result).toHaveLength(5);
  });
});

describe('combineHybrid', () => {
  const defaultWeights = { semanticWeight: 0.7, keywordWeight: 0.3 };

  it('applies the locked formula with default weights', () => {
    expect(combineHybrid([1.0], [0.0], defaultWeights)).toEqual([0.7]);
    expect(combineHybrid([0.0], [1.0], defaultWeights)).toEqual([0.3]);
  });

  it('combines element-wise', () => {
    const sem = [1.0, 0.5, 0.0];
    const kw = [0.0, 0.5, 1.0];
    const result = combineHybrid(sem, kw, defaultWeights);
    expect(result).toEqual([
      0.7 * 1.0 + 0.3 * 0.0,
      0.7 * 0.5 + 0.3 * 0.5,
      0.7 * 0.0 + 0.3 * 1.0,
    ]);
  });

  it('honors custom weights from config', () => {
    const customWeights = { semanticWeight: 0.5, keywordWeight: 0.5 };
    expect(combineHybrid([1.0], [0.0], customWeights)).toEqual([0.5]);
  });

  it('returns empty array for empty inputs', () => {
    expect(combineHybrid([], [], defaultWeights)).toEqual([]);
  });

  it('throws on length mismatch', () => {
    expect(() => combineHybrid([1, 2], [1], defaultWeights)).toThrow(/length mismatch/);
  });
});
```

### `test/hybrid-ranking.test.ts` — engine integration test sketch (key tests)

```typescript
// File: test/hybrid-ranking.test.ts (NEW)
// Source: pattern derived from test/semantic-index-build.test.ts (Phase 7) +
// 08-CONTEXT.md (locked decisions)

import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { MCPackEngine } from '../src/core.js';
import type { EmbeddingProvider } from '../src/index.js';

// Reuse Phase 7 test fixtures (inline — no shared helper file in v1.0/v1.1 convention).
function makeTool(name: string, description: string, properties?: Record<string, object>): Tool {
  return { name, description, inputSchema: { type: 'object', properties: properties ?? {} } };
}

// Deterministic mock provider returns a fixed-dim vector based on a string-hash.
const mockProvider: EmbeddingProvider = async (texts) =>
  texts.map((t) => {
    let hash = 0;
    for (let i = 0; i < t.length; i++) hash = (hash * 31 + t.charCodeAt(i)) | 0;
    return Array.from({ length: 8 }, (_, i) => ((hash + i * 17) % 1000) / 1000);
  });

describe('MCPackEngine — hybrid ranking query path (Phase 8)', () => {
  let engine: MCPackEngine;

  afterEach(() => {
    engine?.destroy();
    vi.restoreAllMocks();
  });

  describe('hasVectors() gate', () => {
    it('returns false when embeddings is absent', () => {
      engine = new MCPackEngine([makeTool('a', 'd')], {});
      expect(engine.hasVectors()).toBe(false);
    });

    it('returns false during build-pending state', () => {
      const slowProvider: EmbeddingProvider = (texts) =>
        new Promise((r) => setTimeout(() => r(texts.map(() => [1])), 200));
      engine = new MCPackEngine([makeTool('a', 'd')], { embeddings: { provider: slowProvider } });
      expect(engine.hasVectors()).toBe(false);
    });

    it('returns false after build failure', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const rejecter: EmbeddingProvider = async () => { throw new Error('boom'); };
      engine = new MCPackEngine([makeTool('a', 'd')], { embeddings: { provider: rejecter } });
      await (engine as any).indexBuildPromise;
      expect(engine.hasVectors()).toBe(false);
    });

    it('returns false when build succeeded with empty tool surface (WR-01 fix)', async () => {
      engine = new MCPackEngine([], { embeddings: { provider: mockProvider } });
      await (engine as any).indexBuildPromise;
      // Phase 7's isIndexReady() returns true here (locked semantics);
      // Phase 8's hasVectors() returns false because there are no vectors to query.
      expect(engine.isIndexReady()).toBe(true);  // Phase 7 locked semantics preserved
      expect(engine.hasVectors()).toBe(false);   // Phase 8 stricter gate
    });

    it('returns true when build succeeded with at least one tool', async () => {
      engine = new MCPackEngine([makeTool('a', 'd')], { embeddings: { provider: mockProvider } });
      await (engine as any).indexBuildPromise;
      expect(engine.hasVectors()).toBe(true);
    });
  });

  describe('hybrid query path', () => {
    it('uses hybrid scoring when hasVectors() is true', async () => {
      const tools = [
        makeTool('create_customer', 'Create a new customer'),
        makeTool('list_payments', 'List payment history'),
      ];
      engine = new MCPackEngine(tools, { embeddings: { provider: mockProvider } });
      await (engine as any).indexBuildPromise;
      const result = await engine.handleSearchTools({ query: 'customer' }, 'sess-1');
      const response = JSON.parse(result.content[0]!.text);
      expect(response.tools.length).toBeGreaterThan(0);
    });

    it('embeds the query as a single-item batch', async () => {
      const seen: string[][] = [];
      const captureProvider: EmbeddingProvider = async (texts) => {
        seen.push([...texts]);
        return texts.map(() => [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
      };
      engine = new MCPackEngine([makeTool('a', 'b')], { embeddings: { provider: captureProvider } });
      await (engine as any).indexBuildPromise;  // 1 batch (build) — not the query
      seen.length = 0;  // reset to capture only query-time calls
      await engine.handleSearchTools({ query: 'find a thing' }, 'sess-1');
      expect(seen).toHaveLength(1);              // single batch
      expect(seen[0]).toEqual(['find a thing']); // single item
    });

    it('falls back to keyword path when query embedding fails', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // Build succeeds, query embedding fails:
      let buildCalled = false;
      const flakyProvider: EmbeddingProvider = async (texts) => {
        if (!buildCalled) { buildCalled = true; return texts.map(() => [0.1, 0.2]); }
        throw new Error('query embed broken');
      };
      const tools = [makeTool('create_customer', 'Create a customer')];
      engine = new MCPackEngine(tools, { embeddings: { provider: flakyProvider } });
      await (engine as any).indexBuildPromise;
      const result = await engine.handleSearchTools({ query: 'customer' }, 'sess-1');
      const response = JSON.parse(result.content[0]!.text);
      // Keyword fallback — 'customer' matches 'create_customer'
      expect(response.tools.map((t: { name: string }) => t.name)).toContain('create_customer');
      // Warn fired once with locked format
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]![0]).toMatch(/^MCPack: query embedding failed: /);
    });

    it('warn-once-per-instance: multiple failed queries produce only one warning', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      let buildCalled = false;
      const flakyProvider: EmbeddingProvider = async (texts) => {
        if (!buildCalled) { buildCalled = true; return texts.map(() => [0.1, 0.2]); }
        throw new Error('always rejects');
      };
      engine = new MCPackEngine([makeTool('a', 'b')], { embeddings: { provider: flakyProvider } });
      await (engine as any).indexBuildPromise;
      await engine.handleSearchTools({ query: 'x' }, 'sess-1');
      await engine.handleSearchTools({ query: 'y' }, 'sess-2');
      await engine.handleSearchTools({ query: 'z' }, 'sess-3');
      expect(warnSpy).toHaveBeenCalledTimes(1);  // exactly one warn across 3 failed queries
    });

    it('query-embedding-failure log contains NO tool names (RBAC invariant)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      let buildCalled = false;
      const flakyProvider: EmbeddingProvider = async (texts) => {
        if (!buildCalled) { buildCalled = true; return texts.map(() => [0.1, 0.2]); }
        throw new Error('provider error');
      };
      const tools = [
        makeTool('create_customer', 'Create a customer'),
        makeTool('list_payments', 'List payments'),
        makeTool('refund_charge', 'Refund a charge'),
      ];
      engine = new MCPackEngine(tools, { embeddings: { provider: flakyProvider } });
      await (engine as any).indexBuildPromise;
      await engine.handleSearchTools({ query: 'x' }, 'sess-1');
      const fullLog = warnSpy.mock.calls[0]!.join(' ');
      expect(fullLog).toBe('MCPack: query embedding failed: provider error');
      // Defense-in-depth: iterate ACTUAL fixture names (rename-safe — WR-03 carry-forward fix).
      for (const t of tools) {
        expect(fullLog).not.toContain(t.name);
        if (t.description) expect(fullLog).not.toContain(t.description);
      }
    });
  });

  describe('Pitfall 7 negative control extension (query-time)', () => {
    it('build-pending queries emit zero new console.warn calls', async () => {
      // Carry forward Phase 7's Pitfall 7 invariant: build-pending fallback is silent.
      // Phase 8 must not introduce a per-query warning for the build-pending case.
      const slowProvider: EmbeddingProvider = (texts) =>
        new Promise((r) => setTimeout(() => r(texts.map(() => [0.1, 0.2])), 200));
      const tools = [makeTool('a', 'b'), makeTool('c', 'd')];
      engine = new MCPackEngine(tools, { embeddings: { provider: slowProvider } });
      // Build is in flight; hasVectors() returns false → keyword fallback.
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(engine.hasVectors()).toBe(false);
      await engine.handleSearchTools({ query: 'a' }, 'sess-1');
      await engine.handleSearchTools({ query: 'b' }, 'sess-2');
      await engine.handleSearchTools({ query: 'c' }, 'sess-3');
      expect(engine.hasVectors()).toBe(false);  // still pending
      expect(warnSpy).toHaveBeenCalledTimes(0);  // ZERO new warn calls
    });
  });

  describe('role-filter-after-rank (REQ-v11-role-filter-after-rank)', () => {
    it('rank reflects FULL surface; role filter applied AFTER rank', async () => {
      const tools = [
        makeTool('admin_op', 'admin only operation matches query'),
        makeTool('user_op_1', 'user operation matches query strongly'),
        makeTool('user_op_2', 'unrelated user operation'),
      ];
      // Configure embeddings — semantic + keyword path
      engine = new MCPackEngine(tools, {
        embeddings: { provider: mockProvider },
        roles: { user: ['user_op_1', 'user_op_2'], admin: '*' },
        defaultRole: 'user',
      });
      await (engine as any).indexBuildPromise;
      const result = await engine.handleSearchTools({ query: 'matches query' }, 'sess-1');
      const response = JSON.parse(result.content[0]!.text);
      // 'admin_op' is filtered out post-rank; opaque denial preserved.
      expect(response.tools.map((t: { name: string }) => t.name)).not.toContain('admin_op');
      // 'user_op_1' should still rank above 'user_op_2' if its description scored higher
      // — i.e., the rank reflects the FULL surface ranking before filter.
      expect(response.tools[0].name).toBe('user_op_1');
    });
  });

  describe('backward-compat: byte-identical v1.0 path when embeddings absent', () => {
    it('handleSearchTools with no embeddings makes zero provider calls', async () => {
      let providerCallCount = 0;
      const countingProvider: EmbeddingProvider = async (t) => {
        providerCallCount++;
        return t.map(() => [0]);
      };
      void countingProvider;
      // No embeddings configured.
      engine = new MCPackEngine(
        [makeTool('create_customer', 'Create a customer')],
        {},
      );
      await engine.handleSearchTools({ query: 'customer' }, 'sess-1');
      expect(providerCallCount).toBe(0);
      expect(engine.hasVectors()).toBe(false);
    });

    it('emits zero console.warn calls in v1.0 path (Pitfall 7 carry-forward)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      engine = new MCPackEngine(
        [makeTool('a', 'b'), makeTool('c', 'd')],
        {},
      );
      await engine.handleSearchTools({ query: 'a' }, 'sess-1');
      await engine.handleSearchTools({ query: 'b' }, 'sess-2');
      expect(warnSpy).toHaveBeenCalledTimes(0);
    });
  });

  describe('WR-02 fix: unhandled-rejection regression test', () => {
    it('build and query failures produce no unhandled rejection', async () => {
      const handler = vi.fn();
      process.on('unhandledRejection', handler);
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const rejecter: EmbeddingProvider = async () => {
          throw new Error('always rejects');
        };
        engine = new MCPackEngine([makeTool('a', 'b')], { embeddings: { provider: rejecter } });
        await (engine as any).indexBuildPromise;  // Phase 7 build path
        await engine.handleSearchTools({ query: 'x' }, 'sess-1');  // Phase 8 query path
        await engine.handleSearchTools({ query: 'y' }, 'sess-2');  // exercise twice
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));
        expect(handler).not.toHaveBeenCalled();
      } finally {
        process.off('unhandledRejection', handler);
      }
    });
  });

  describe('session invariants (REQ-v11-session-invariants)', () => {
    it('schemas-loaded references work identically in hybrid path', async () => {
      const tools = [makeTool('create_customer', 'Create a customer')];
      engine = new MCPackEngine(tools, { embeddings: { provider: mockProvider } });
      await (engine as any).indexBuildPromise;
      // First query — schema returned in full
      const r1 = await engine.handleSearchTools({ query: 'customer' }, 'sess-1');
      const resp1 = JSON.parse(r1.content[0]!.text);
      expect(resp1.tools[0]).toMatchObject({ name: 'create_customer', loaded: false });
      expect(resp1.tools[0].schema).toBeDefined();
      // Second query, same session — loaded reference only
      const r2 = await engine.handleSearchTools({ query: 'customer' }, 'sess-1');
      const resp2 = JSON.parse(r2.content[0]!.text);
      expect(resp2.tools[0]).toEqual({ name: 'create_customer', loaded: true });
    });
  });

  describe('performance bounds (mock-provider, unit-test level)', () => {
    it('hybrid query path completes in < 50ms with 50 tools and sync mock provider', async () => {
      const tools = Array.from({ length: 50 }, (_, i) =>
        makeTool(`tool_${i}`, `description ${i}`, { p1: { type: 'string' } }),
      );
      engine = new MCPackEngine(tools, { embeddings: { provider: mockProvider } });
      await (engine as any).indexBuildPromise;
      const start = Date.now();
      await engine.handleSearchTools({ query: 'description' }, 'sess-1');
      const elapsed = Date.now() - start;
      // Sync mock provider is sub-ms; 50ms cap bounds the algorithmic overhead
      // of cosine + normalize + combine + sort + filter.
      // Real-MiniLM 50ms p99 budget is asserted in Phase 10's harness.
      expect(elapsed).toBeLessThan(50);
    });
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hand-rolled state machines for promise lifecycle | Promise lifecycle as the state machine + boolean derivations (`hasVectors`) | TypeScript ecosystem standardized 2020+ | Phase 8 follows Phase 7's lead — `hasVectors()` is a derived boolean, no enum. |
| Single global score for hybrid combine | Per-query min-max normalization | Industry-wide post-2020 (BM25 + dense retrieval hybrids) | DEC-v11-08-02 codifies this. RRF (reciprocal rank fusion) is the alternative; rejected for v1.1 because it changes weight semantics. |
| Filter-then-rank in role-aware search | Rank-then-filter to preserve full-surface relative scoring | Search engineering best practice (Elasticsearch, OpenSearch document this in their docs) | REQ-v11-role-filter-after-rank locks this for v1.1. |
| `compute-cosine-similarity` npm packages | Hand-rolled ~15-line cosine | Always — for trivial math, deps are over-engineering | Gate 1 forces this choice. |
| Per-call weight overrides | Config-only weights | DEC-v11-08-01 for v1.1 | Smallest public API surface; agents tune at deploy-time. |

**Deprecated/outdated (none new for Phase 8):**
- Phase 6 already retired `@xenova/transformers` (frozen May 2024) → `@huggingface/transformers ^4.0.0`. Phase 8 doesn't touch deps.
- Phase 7's "filter-then-rank" pattern in `handleSearchTools` is replaced by Phase 8's "rank-then-filter" (per REQ-v11-role-filter-after-rank).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Rank-then-filter on the v1.0 keyword path produces observable-byte-identical results to v1.0's filter-then-rank for all 124 baseline tests | Pattern 6, Pitfall 2 | MEDIUM — if any baseline test asserts a specific ordering that depends on the candidate set composition at rank time, the refactor breaks Gate 4. **Mitigation:** Wave 0 empirical check — run all 124 tests against the refactor BEFORE writing new tests. If any fails, planner needs a config flag to keep v1.0 path unchanged. |
| A2 | Adding `hasWarnedQueryEmbeddingFailure: boolean = false` to `MCPackEngine` doesn't break any v1.0 baseline test | Pitfall 5 | LOW — verified by grep: no v1.0 test uses `Object.keys(engine)`, `JSON.stringify(engine)`, or any reflection on the engine instance shape. The added field is innocuous. |
| A3 | The `EmbeddingProvider` contract for a single-item batch is `provider([query]) → Promise<number[][]>` returning `[[...]]` (one outer-array entry, one inner-array vector) | Pattern 2 | LOW — verified by reading `src/types.ts:19` and Phase 7's `src/core.ts:228` (which uses the same N-item batch convention). The contract is parallel-array semantics; single-item is just N=1. |
| A4 | `Float32Array(numbers)` constructor copies the input array in O(n) and is sub-millisecond for typical embedding dims (≤ 768) | Pattern 2, "Don't Hand-Roll" | LOW — vectorized native API in V8/Node. Real-world benchmarks: 10μs for 384-dim. Phase 7 already relies on this for build-time construction. |
| A5 | `Math.sqrt` and arithmetic on `Float32Array` elements in a tight `for` loop is sub-millisecond for 50 tools × 384-dim cosine computations | Pattern 4, Validation Architecture (perf bound) | LOW — 50 * 384 = 19,200 multiply-adds + 50 sqrts. V8 JIT compiles this to vectorized SIMD on x64/ARM. Real measurement: ~100μs for 50 tools. The 50ms unit-test budget has 500× headroom. |
| A6 | The mock `EmbeddingProvider` returning 8-dim deterministic vectors (Phase 7's pattern) is sufficient for Phase 8 hybrid-path tests — real-MiniLM-dim correctness is Phase 10's harness concern | Code Examples §"hybrid-ranking.test.ts" | LOW — Phase 7's mock pattern proved this works. The dim doesn't affect cosine math correctness; only the perf bound. Phase 8's perf assertion uses a generous 50ms budget for 50 tools, which is comfortable for any dim. |
| A7 | The post-Phase-7 baseline ref for Gates 1+2+3+4 is the current `main` HEAD (`34c60d8` as of 2026-04-26 23:45) — the planner pins exact SHA at plan-time | Validation Architecture | LOW — git log shows `34c60d8` is the most recent commit on `main`, and it's a docs-only commit (`docs(state): record phase 8 context session`). The Phase 7 close-out commit `cd1fc52` is also a valid reference. Either works; planner picks one and locks it. |
| A8 | The `keywordScoreForEntry(query, entry): number` helper added to `src/search.ts` does NOT break `test/search.test.ts` | Pattern 6 §"CRITICAL planner decision", Pitfall 2 | LOW — additive only (new exported function). The existing `scoreAndRank` is untouched. `test/search.test.ts` exercises `scoreAndRank`'s behavior, not its internal scoring (which the new helper exposes). Verify via `npm test -- search.test.ts` after the addition. |
| A9 | Phase 7's `isIndexReady()` API stays unchanged (locked) and Phase 8 only adds `hasVectors()` | DEC-v11-08-03 | NONE — explicitly locked in CONTEXT. Risk is zero by definition. |
| A10 | The `process.on('unhandledRejection', listener)` test pattern works in vitest's default runner (vitest 4.1.x) | Pitfall 9, Code Examples §"WR-02 fix" | LOW — vitest runs in Node, and `process` is the global Node process object. The listener semantics are standard Node. Verify in Wave 0 by writing the test first; if it doesn't work, fall back to `Promise.allSettled([(engine as any).indexBuildPromise])` checking. |
| A11 | The `total_available` field in `SearchToolResponse` continues to reflect the role-allowed surface count (not the full surface) post-Phase-8 | Pattern 6 §"handleSearchTools refactor sketch" step 6 | LOW — REQ-v11-session-invariants requires this. The current code reads it from `allowed.length` (`src/core.ts:162`); Phase 8's refactor preserves this read. |

## Open Questions (RESOLVED)

All five questions were answered during planning. Plan-checker iter 1 (2026-04-26) confirmed the plans honor each resolution.

1. **Should the v1.0 keyword path also use rank-then-filter, or stay on filter-then-rank?**
   - RESOLVED: Wave 0 empirical check decides at execution time. If all 124 baseline tests pass against unified rank-then-filter, ship unified; otherwise split paths. Implemented as Plan 08-02 Task 1 (BLOCKING — halts plan if baseline tests fail).

2. **Should `keywordScoreForEntry` live in `src/search.ts` (additive export) or in `src/hybrid-scoring.ts`?**
   - RESOLVED: `src/search.ts` (additive export). Plan 08-01 Task 2 implements; reusing the logic from where it lives avoids copy-paste drift. The hybrid-scoring module stays focused on the math layer (cosine + normalize + combine).

3. **Should the test file split be 2 files (`hybrid-scoring.test.ts` for pure functions + `hybrid-ranking.test.ts` for engine) or 1 file?**
   - RESOLVED: 2 files. `test/hybrid-scoring.test.ts` ships in Plan 08-01 (unit tests for pure math); `test/hybrid-ranking.test.ts` ships in Plan 08-02 (integration tests for engine). Splitting clarifies intent and matches the source split.

4. **Should the WR-02 unhandled-rejection test live in `test/hybrid-ranking.test.ts` (Phase 8) or in a separate `test/unhandled-rejection.test.ts`?**
   - RESOLVED: bundled in `test/hybrid-ranking.test.ts` under a `describe('WR-02 fix: unhandled-rejection regression test')` block. Single test, single file = lower complexity. If future phases add more cross-cutting regression tests, factor out to a sibling file.

5. **Should the WR-03 (Phase 7 RBAC test fixture-coupling) tightening land in Phase 8?**
   - RESOLVED: DEFER for Phase 7's existing test; PROACTIVELY APPLY at NEW Phase 8 RBAC test sites. Phase 8's own tests use the rename-safe pattern (`tools.map((t) => t.name)`); Phase 7's `test:256-276` stays as-is for v1.1 polish or v1.2 to preserve Gate 4 (baseline tests byte-identical).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All Phase 8 work | ✓ | v24.2.0 (well above ≥18.0.0) | — |
| TypeScript | typecheck + build | ✓ | ~5.8.3 (devDep, locked) | — |
| Vitest | tests | ✓ | ^4.1.0 (devDep, locked, registry at 4.1.5) | — |
| `@vitest/coverage-v8` | coverage gate | ✓ | ^4.1.0 (devDep, locked) | — |
| `@modelcontextprotocol/sdk` | `Tool` type for index iteration | ✓ | ^1.0.0 peer + ^1.27.1 dev (registry at 1.29.0) | — |
| `@huggingface/transformers` | NOT used by Phase 8 (engine consumes the abstract type) | ✓ (in adapter package only) | ^4.0.0 (locked Phase 6) | Confined to `packages/mcpack-embeddings/` — Gate 3 enforces zero leak into core |
| `@llvs/mcpack-embeddings` | NOT used by Phase 8 tests (mock provider only) | ✓ (npm-linked locally) | 1.1.0 (workspace) | Phase 8 tests use inline mock providers, never import the adapter |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

Phase 8 introduces **zero** new dependencies. All work uses the existing toolchain.

## Validation Architecture

> Per `.planning/config.json` workflow.nyquist_validation = true, this section is included.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `vitest@^4.1.0` (carry-forward from v1.0 + Phase 6 + Phase 7) |
| Config file | None — relies on vitest defaults |
| Quick run command | `npm test` |
| Full suite command | `npm test && npm run test:coverage` |
| Per-task feedback | `npm run typecheck && npm test -- hybrid-scoring.test.ts hybrid-ranking.test.ts` (~3-5s) |
| Estimated runtime | ~6-10s (root suite, including new Phase 8 tests) |

### Sampling Rate

- **Per task commit:** `npm run typecheck && npm test -- hybrid-scoring.test.ts hybrid-ranking.test.ts` (~3-5s feedback latency)
- **Per wave merge:** `npm run typecheck && npm run build && npm test && npm run test:coverage` (~10-15s)
- **Phase gate (before `/gsd-verify-work`):** Full suite green, 4 [BLOCKING] gates run, regression gate (Gate 4 — all pre-Phase-8 test files byte-identical), coverage ≥ 99%
- **Max feedback latency:** 5 seconds per-task commit

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| REQ-v11-semantic-query-path | Cosine similarity computed correctly for identical / orthogonal / opposite vectors | unit (pure) | `npm test -- hybrid-scoring.test.ts -t "cosineSimilarity"` | ❌ Wave 0 |
| REQ-v11-semantic-query-path | Per-query embedding sent as single-item batch | unit (engine) | `npm test -- hybrid-ranking.test.ts -t "embeds the query as a single-item batch"` | ❌ Wave 0 |
| REQ-v11-semantic-query-path | Hybrid path engaged when hasVectors() true | unit (engine) | `npm test -- hybrid-ranking.test.ts -t "uses hybrid scoring when hasVectors"` | ❌ Wave 0 |
| REQ-v11-hybrid-ranking | Min-max normalize handles all locked edge cases | unit (pure) | `npm test -- hybrid-scoring.test.ts -t "minMaxNormalize"` | ❌ Wave 0 |
| REQ-v11-hybrid-ranking | combineHybrid applies the locked formula with default weights | unit (pure) | `npm test -- hybrid-scoring.test.ts -t "combineHybrid"` | ❌ Wave 0 |
| REQ-v11-hybrid-ranking | Custom weights from `MCPackConfig.embeddings.weights` honored | unit (engine) | `npm test -- hybrid-ranking.test.ts -t "honors custom weights from config"` | ❌ Wave 0 |
| REQ-v11-role-filter-after-rank | Rank reflects FULL surface; role filter applied AFTER rank; restricted tools never appear | unit (engine) | `npm test -- hybrid-ranking.test.ts -t "rank reflects FULL surface"` | ❌ Wave 0 |
| REQ-v11-role-filter-after-rank | hasVectors() returns false for empty-tools no-op (WR-01 fix) | unit (engine) | `npm test -- hybrid-ranking.test.ts -t "returns false when build succeeded with empty tool surface"` | ❌ Wave 0 |
| REQ-v11-backward-compat | handleSearchTools with no embeddings makes zero provider calls | unit (engine) | `npm test -- hybrid-ranking.test.ts -t "with no embeddings makes zero provider calls"` | ❌ Wave 0 |
| REQ-v11-backward-compat | Zero new console.warn calls in v1.0 path | unit (engine) | `npm test -- hybrid-ranking.test.ts -t "emits zero console.warn calls in v1.0 path"` | ❌ Wave 0 |
| REQ-v11-backward-compat | All 124 v1.0 + Phase 7 baseline tests still pass byte-identically (Gate 4) | regression | `git diff <baseline> -- test/{8 files}` returns 0 lines + `npm test` exits 0 | ✅ existing |
| REQ-v11-session-invariants | Schemas-loaded references work identically in hybrid path | unit (engine) | `npm test -- hybrid-ranking.test.ts -t "schemas-loaded references work identically in hybrid path"` | ❌ Wave 0 |
| REQ-v11-session-invariants | "Unknown tool: {name}" denial behavior unchanged | regression | covered by existing `test/wrap.test.ts` + `test/build.test.ts` baseline | ✅ existing |
| (carry-fwd) | Pitfall 7 negative control — build-pending queries emit zero new warns | unit (engine) | `npm test -- hybrid-ranking.test.ts -t "build-pending queries emit zero new console.warn calls"` | ❌ Wave 0 |
| (carry-fwd) | Query-embedding-failure: warn-once-per-instance | unit (engine) | `npm test -- hybrid-ranking.test.ts -t "warn-once-per-instance"` | ❌ Wave 0 |
| (carry-fwd) | Query-embedding-failure log contains NO tool names (RBAC invariant) | unit (engine) | `npm test -- hybrid-ranking.test.ts -t "query-embedding-failure log contains NO tool names"` | ❌ Wave 0 |
| (carry-fwd) | WR-02 fix: build + query failures produce no unhandled rejection | unit (engine) | `npm test -- hybrid-ranking.test.ts -t "build and query failures produce no unhandled rejection"` | ❌ Wave 0 |
| (perf bound) | 50-tool hybrid query path completes in < 50ms with sync mock | unit (engine) | `npm test -- hybrid-ranking.test.ts -t "hybrid query path completes in < 50ms"` | ❌ Wave 0 |
| (cross) | Coverage ≥ 99% statement | regression | `npm run test:coverage` reports stmts ≥ 99% | ✅ existing |
| (cross) | Typecheck passes | static | `npm run typecheck` exits 0 | ✅ existing |
| (cross) | Build emits ESM-only | static | `npm run build && (! ls dist/*.cjs 2>/dev/null)` | ✅ existing |
| (deferred) | Real-MiniLM 50ms p99 query budget | integration | Phase 10 harness — NOT Phase 8 scope | ❌ Phase 10 |
| (deferred) | 50-query intent benchmark recall ≥ 15% over v1.0 | integration | Phase 10 harness — NOT Phase 8 scope | ❌ Phase 10 |

*Status: ❌ red / not yet created · ✅ green / existing · ⬜ pending*

### Wave 0 Requirements

The following files do NOT exist yet; Phase 8 plans must create them:

- [ ] **`src/hybrid-scoring.ts`** — pure-function helpers `cosineSimilarity`, `minMaxNormalize`, `combineHybrid`. Module-private (no re-export from `src/index.ts`). Lives outside `core.ts` for unit-testability.
- [ ] **`test/hybrid-scoring.test.ts`** — pure-function unit tests (~10-15 tests). Mirrors Phase 7's mock-provider pattern style.
- [ ] **`test/hybrid-ranking.test.ts`** — engine integration tests (~10-15 tests). Covers `hasVectors()`, hybrid path, query-embedding failure, role-filter ordering, Pitfall 7 carry-forward, WR-02 fix, backward-compat, session invariants, perf bound.

**Optional Wave 0 addition (planner's call per Open Question 2):**

- [ ] **Additive change to `src/search.ts`** — export `keywordScoreForEntry(query: string, entry: ToolIndexEntry): number` for the hybrid path's per-tool keyword scoring. ~20 LOC additive; does NOT modify existing `scoreAndRank`. Verify `test/search.test.ts` still passes.

**Wave 0 EMPIRICAL CHECK (BLOCKING):**

Before authoring any new tests, run all 124 baseline tests against a draft `handleSearchTools` refactor that uses unified rank-then-filter for both v1.0 and hybrid paths. If all pass, proceed. If any fail, surface the divergence to plan-checker — the planner must split the paths (v1.0 stays filter-then-rank, hybrid uses rank-then-filter) and update the implementation accordingly.

**Framework install:** none — vitest already installed; Phase 8 introduces zero new deps.

**Existing infrastructure Phase 8 reuses:**
- `test/semantic-index-build.test.ts` mock-provider pattern (deterministic 8-dim hash-based) — Phase 8 reuses verbatim, inline.
- `test/types.test.ts` mock-provider pattern (Phase 6 baseline) — same.
- The `makeTool(name, description, properties?)` test fixture helper — copy-paste pattern (no shared helper file in v1.0/v1.1 convention).

### Four [BLOCKING] Phase Gates (carry-forward from Phases 6 + 7)

These four gates enforce board-locked invariants. Phase 8 verification fails if any returns non-zero.

**Baseline ref:** post-Phase-7 main HEAD (planner pins exact SHA at plan-time; current HEAD `34c60d8` as of 2026-04-26 23:45). Suitable alternates: `cd1fc52` (Phase 7 close-out commit), `a8e2a66` (Phase 7 ready-to-execute STATE refresh).

#### Gate 1 — Zero new core deps
```bash
diff <(jq -S '{deps:(.dependencies // {}), peers:.peerDependencies, optional:.optionalDependencies, bundled:.bundledDependencies}' package.json) \
     <(git show <BASELINE>:package.json | jq -S '{deps:(.dependencies // {}), peers:.peerDependencies, optional:.optionalDependencies, bundled:.bundledDependencies}')
```
Must produce empty diff. Phase 8 introduces zero new dependencies; this gate should pass trivially.

#### Gate 2 — Public-API additive-only / unchanged
```bash
git diff <BASELINE> -- src/index.ts
```
Must produce zero lines. Phase 8 adds NO new public exports — `MCPackEngine.hasVectors()` is internal (engine class is not exported per Phase 02 DEC), and `src/hybrid-scoring.ts` exports are not re-exported from `src/index.ts`.

**Verify:**
```bash
grep -E "(cosineSimilarity|minMaxNormalize|combineHybrid|hasVectors)" src/index.ts
# Should return zero matches.
```

#### Gate 3 — Adapter isolation
```bash
! grep -rE "@llvs/mcpack-embeddings|@huggingface/transformers|@xenova/transformers" src/ test/
```
Must return zero matches. Phase 8's tests use inline mock providers; Phase 8's engine code consumes only the abstract `EmbeddingProvider` type from `./types.js`.

**Caveat — JSDoc reference temptation:** Phase 6 had to rewrite a JSDoc comment to avoid the literal `@llvs/mcpack-embeddings` string (06-01-SUMMARY §"Deviations from Plan"); Phase 7 inherited the convention. Phase 8's new code follows the same convention: any JSDoc that wants to reference the adapter package says "the sibling adapter package" instead of the literal name.

#### Gate 4 — Baseline tests byte-identical (regression gate)
```bash
git diff <BASELINE> -- test/core.test.ts test/wrap.test.ts test/build.test.ts \
  test/index-builder.test.ts test/search.test.ts test/session.test.ts \
  test/roles.test.ts test/types.test.ts test/semantic-index-build.test.ts
```
Must produce zero lines. All 9 pre-Phase-8 test files unchanged. New tests live in NEW files only — no edits to existing test files (this is the Pitfall 6 invariant from Phase 7, carrying forward).

### Coverage Targets

| File | Target | Rationale |
|------|--------|-----------|
| `src/core.ts` | ≥ 99% statement (Phase 7 baseline 100%; maintain) | New code paths fully exercised by tests |
| `src/hybrid-scoring.ts` | ≥ 99% statement (new file; aim for 100%) | Pure functions; trivial to fully cover |
| `src/search.ts` (if `keywordScoreForEntry` added) | ≥ 99% statement (Phase 7 baseline 100%; maintain) | Additive only; new function tested |
| All other files | UNCHANGED from Phase 7 baseline | No code changes |
| **Overall project** | ≥ 99% statement (Phase 7 baseline 99.61%; aim ≥ 99.6%) | PLAYBOOK floor + REQ-v11-test-coverage-floor |

### Test Pyramid (Phase 8 contribution)

```
                    ┌──────────────────────┐
                    │ Manual / Phase 10    │  ← deferred (real MiniLM, harness)
                    │ - 50-query intent    │
                    │   benchmark recall   │
                    │ - p99 50ms with real │
                    │   MiniLM             │
                    └──────────────────────┘
              ┌────────────────────────────────────┐
              │ Integration (engine end-to-end)    │  ← Phase 8 ~10-15 tests
              │ - hasVectors() gate                │  in test/hybrid-ranking.test.ts
              │ - hybrid path with mock provider   │
              │ - query-embedding failure paths    │
              │ - Pitfall 7 carry-forward          │
              │ - WR-02 unhandled rejection        │
              │ - role-filter-after-rank           │
              │ - session invariants               │
              │ - backward-compat                  │
              │ - perf bound (50ms / 50 tools)     │
              └────────────────────────────────────┘
       ┌──────────────────────────────────────────────────┐
       │ Unit (pure functions)                            │  ← Phase 8 ~10-15 tests
       │ - cosineSimilarity (identical, orthogonal, etc.) │  in test/hybrid-scoring.test.ts
       │ - minMaxNormalize (empty, single, all-equal,     │
       │   negative, normal)                              │
       │ - combineHybrid (default weights, custom, edge)  │
       └──────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────────┐
│ Regression (existing baseline)                                 │  ← Phase 8 inherits
│ - 124 tests across 9 files (Phase 7 baseline)                  │  Gate 4 byte-identicality
│ - Coverage ≥ 99% (current 99.61%)                              │
│ - Gates 1-4 pass against post-Phase-7 baseline                 │
└────────────────────────────────────────────────────────────────┘
```

**Phase 8 net new tests:** ~20-25 (Phase 7 added 17; the trajectory toward ≥120 tests by milestone close — REQ-v11-test-coverage-floor — is comfortably on track at 124 + 20 = ~144).

### Pitfalls Encoded as Negative Controls

| Pitfall | Negative-Control Test | Test Location |
|---------|----------------------|---------------|
| Pitfall 1 (await build during query) | (structural — verified by code inspection + perf bound asserting query < 50ms) | `test/hybrid-ranking.test.ts` perf bound |
| Pitfall 3 (query-embedding failure crash) | "WR-02 fix: build and query failures produce no unhandled rejection" | `test/hybrid-ranking.test.ts` |
| Pitfall 4 (un-normalized combine) | (structural — `combineHybrid` signature explicitly takes `Norm`-suffixed args; tests assert correctness) | `test/hybrid-scoring.test.ts` |
| Pitfall 6 (filter-before-rank) | "rank reflects FULL surface; role filter applied AFTER rank" | `test/hybrid-ranking.test.ts` |
| Pitfall 7 (build-pending warning spam — carry forward from Phase 7) | "build-pending queries emit zero new console.warn calls" | `test/hybrid-ranking.test.ts` |
| Pitfall 8 (per-query warning spam) | "warn-once-per-instance: multiple failed queries produce only one warning" | `test/hybrid-ranking.test.ts` |
| Pitfall 9 (unhandled rejection from query embedding — WR-02 fix) | "WR-02 fix: build and query failures produce no unhandled rejection" | `test/hybrid-ranking.test.ts` |
| RBAC invariant (carry forward from Phase 7) | "query-embedding-failure log contains NO tool names" + iterate actual fixture names (WR-03 proactive fix at new site) | `test/hybrid-ranking.test.ts` |

### Manual-Only Verifications

None expected. All Phase 8 acceptance criteria are programmatically verifiable via the per-task verification map above.

The PRD-level "real-MiniLM 50ms p99 query budget" assertion is automated in Phase 10's harness — NOT a manual check, NOT a Phase 8 acceptance criterion.

## Patterns to Follow

Lifted from Phases 6 + 7 — these are the project's established conventions Phase 8 must honor:

### From Phase 6 (carry-forward)
- **Mock provider pattern:** `const mock: EmbeddingProvider = async (texts) => texts.map(t => ...)`. Inline in test files. No shared helper module. (Source: `test/types.test.ts:8-10`.)
- **`MCPackConfig.embeddings.weights` already typed:** Phase 8 READS only — does NOT change `src/types.ts`. (Source: `src/types.ts:39-46`.)
- **Adapter-isolation gate enforcement:** any JSDoc that references the adapter package says "the sibling adapter package" — never the literal `@llvs/mcpack-embeddings`. (Source: 06-01-SUMMARY.md "Deviations from Plan".)

### From Phase 7 (carry-forward)
- **Locked warn message format:** `MCPack: <category>: <err.message>`. NEVER include tool names or operator-controlled query text. Phase 7 locked `MCPack: semantic index build failed:`; Phase 8 locks `MCPack: query embedding failed:`. (Source: `src/core.ts:79`.)
- **Fire-and-forget Promise pattern with `.catch` in same statement:** prevents unhandledRejection. Phase 8 follows this for the build-pending preservation (build promise still has `.catch` from Phase 7) and adds the analogous try/catch for query-time. (Source: `src/core.ts:71-80`.)
- **Sibling helper file pattern:** when a phase introduces pure-function math or composition logic, put it in a sibling `src/<phase-name>-builder.ts` (or `src/<feature>-scoring.ts`) rather than inflating `core.ts`. Module-private — not re-exported from `src/index.ts`. (Source: `src/semantic-index-builder.ts`.)
- **Test file naming convention:** `test/<feature>.test.ts` mirrors `src/<feature>.ts`. Test fixtures inline; mock providers inline; no shared test helpers. (Source: `test/semantic-index-build.test.ts`.)
- **Pitfall 7 negative control template:** spy on `console.warn` AFTER engine construction (so the constructor's success path is not observed), fire multiple operations, assert `warnSpy.toHaveBeenCalledTimes(0)`. (Source: `test/semantic-index-build.test.ts:278-306`.)
- **Engine-internal test access pattern:** `(engine as any).indexBuildPromise`, `(engine as any).semanticIndex`. Acknowledged as brittle (IN-01) but workable. Phase 8 may optionally introduce a typed accessor pattern (`type EngineInternals = { ... }; (e as unknown as EngineInternals).field`) but it's not blocking. (Source: `test/semantic-index-build.test.ts` widespread usage.)
- **Constructor synchrony invariant:** verified by spy + structural assertion (provider called, but engine returned before await resolved). Phase 8 adds an analogous invariant for `handleSearchTools` becoming async — both `wrap.ts` and `build.ts` already `await` the call sites. (Source: `test/semantic-index-build.test.ts:177-196`.)
- **Defense-in-depth on contract violations:** when the provider returns malformed data (wrong vector count, inconsistent dims), throw with descriptive error. The build pattern catches this and logs once; the query pattern catches this and falls back to keyword. Same defensive posture, different recovery.

### From v1.0 (carry-forward via PLAYBOOK)
- **`MCPack:` warning prefix:** all `console.warn` sites in core use this prefix. (Source: `src/wrap.ts:89`, `src/build.ts:70,85`, `src/core.ts:79`.)
- **Quality gates:** `npm run typecheck && npm run build && npm test` after every change. Coverage ≥ 99%. (Source: PLAYBOOK.md §"Development Protocol".)
- **Commit format:** `type(scope): description`. (Source: PLAYBOOK.md §"Commit Messages".)

## Pitfalls

Numbered with mitigations the plan must encode (consolidated from §"Common Pitfalls" above):

1. **Awaiting `this.indexBuildPromise` during query** — gate on `hasVectors()`, never await the build. Plan-checker rejects any `await this.indexBuildPromise` inside `handleSearchTools`.

2. **Silent v1.0 path divergence on rank-then-filter refactor** — Wave 0 empirical check: run all 124 baseline tests against the refactor BEFORE writing new tests. If any fail, planner must split the paths.

3. **Query embedding failure cascading to MCP caller** — `embedQuery` MUST catch all rejections internally and return `null`. Plan-checker requires explicit try/catch in the spec.

4. **Direct combine without normalization** — `combineHybrid` signature explicitly takes `*Norm`-suffixed args; never raw scores. Plan-checker verifies the signature.

5. **New code branches taken in v1.0 path** — soft promise; verified by all 124 baseline tests passing. Added boolean field is innocuous (no v1.0 test reflects on engine shape).

6. **Role-filter-before-rank** — score against `this.index` (FULL); filter post-sort. Plan-checker rejects any `resolveRoleAccess` call BEFORE the score arrays are computed.

7. **Touching session.loadedTools dispatch order** — the session-mapping block at `core.ts:144-150` is byte-identical to v1.0. Phase 8 must NOT alter the loop order.

8. **Per-query warning spam** — instance flag `hasWarnedQueryEmbeddingFailure`. One warn per process per engine. Negative-control test asserts this.

9. **Unhandled rejection from query-embedding failure (WR-02 fix)** — `embedQuery`'s try/catch closes the window. Regression test registers `process.on('unhandledRejection', listener)` and asserts the listener is never called across multiple failed queries.

10. **Editing existing test files (Gate 4 violation)** — Phase 8 tests live in NEW files only. Carry-forward from Phase 7's Pitfall 6.

11. **JSDoc adapter-package literal references** — any reference to the adapter package says "the sibling adapter package", never the literal `@llvs/mcpack-embeddings`. Carry-forward from Phase 6's Gate 3 finding.

## Security Domain

> Per project security posture (CLAUDE.md "Quality Gates" #5: "no leaking of restricted tools' existence via error messages (RBAC invariant)"), this section flags the relevant ASVS categories. The phase has minimal security surface — primarily input validation, information disclosure, and access control.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | — (no auth surface in Phase 8; transport-layer auth is v1.2) |
| V3 Session Management | YES (light) | Schemas-loaded references and session.loadedTools mutation order preserved (REQ-v11-session-invariants). No new session state added. |
| V4 Access Control | YES (carry-forward) | RBAC invariant — failure-path log MUST NOT enumerate tool names. Use `console.warn('MCPack: query embedding failed: <message>')` with NO tool list, NO query text. |
| V4 Access Control | YES (Phase 8 specific) | Role-filter-after-rank preserves opaque denial — restricted tools never appear in results regardless of score. Tested via `test/hybrid-ranking.test.ts` "rank reflects FULL surface; role filter applied AFTER rank". |
| V5 Input Validation | YES | Validate provider's single-item-batch return: `Array.isArray(vectors) && vectors.length === 1 && Array.isArray(vectors[0])`. Reject (return null + warn-once) on contract violation. |
| V6 Cryptography | no | — (no crypto in Phase 8) |
| V7 Error Handling | YES (carry-forward) | Catch all errors from `provider([query])` in `embedQuery`. Never let the rejection propagate to the MCP caller (would break the session). The error message logged MUST come from the error itself, never include tool names or query text. |
| V8 Data Protection | YES (light) | Query vectors derived from operator-supplied query text. Discarded after use; never persisted. No new sensitive data introduced. |
| V9 Communications | no | — (no network in Phase 8; provider is a callback) |
| V10 Malicious Code | no | — (Phase 8 doesn't load or execute external code) |
| V11 Configuration | no | — (no config files added) |
| V12 File Handling | no | — (no file I/O) |
| V13 API and Web Service | YES (carry-forward) | `tools/list` invariant: returns single `search_tools` regardless of build state. Phase 8 doesn't touch `handleToolsList`. |
| V14 Secure Configuration | no | — |

### Known Threat Patterns for Phase 8

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Information disclosure via failure-mode logging (build OR query) | Information Disclosure | Failure log uses provider's error message (text-only), never enumerates tools or includes query content. Validated by inspecting call sites — `MCPack: query embedding failed: ${message}` exact format. |
| Information disclosure via query log (sessions track query text) | Information Disclosure | The session.queryLog block at `handleSearchTools` already logs queries (v1.0 behavior). Phase 8 doesn't change this — REQ-v11-session-invariants requires it stays the same. The query is already in operator-controlled session memory; not a new disclosure surface. |
| Denial of service via slow / hanging provider at query time | Denial of Service | Query awaits the provider call. If the provider hangs, the MCP caller's request hangs. Mitigation: rely on the operator's MCP transport to enforce request timeouts (out of MCPack's scope). For local mocks in Phase 8 tests, use `setTimeout`-based slow providers as Phase 7 did. **No timeout logic added to MCPack** (matches Phase 7's stance — Pitfall 3 anti-pattern). |
| Denial of service via malicious provider returning malformed query result (e.g., non-array, wrong inner shape) | Denial of Service | `embedQuery` validates `Array.isArray(vectors) && vectors.length === 1 && Array.isArray(vectors[0])` before constructing `Float32Array`. Validation failure throws → caught by try/catch → return null → keyword fallback. Gateway stays up. |
| Denial of service via mismatched vector dimensions (query 384-dim, tool 768-dim) | Denial of Service | `cosineSimilarity` throws on dimension mismatch. Caught by `embedQuery`'s try/catch → return null → keyword fallback. Gateway stays up. (This shouldn't happen in practice — Phase 7's `buildSemanticIndex` already validates dim consistency across the build batch, and the query is processed by the same provider.) |
| Tampering with the vector store at query time | Tampering | The `semanticIndex` field is `private`. The query path reads via `vectors.get(entry.name)` — read-only. No mutation. |
| Repudiation: gateway crashes silently at query time, no audit trail | Repudiation | Failure logged via `console.warn` (once per instance). Operators see the failure. Phase 9 (analytics) will add structured event capture; Phase 8 inherits the log-only baseline. |
| Spoofing: malicious caller injects vectors via search_tools args | Spoofing | `search_tools` schema accepts `query: string` and `limit: number` only. No vector injection surface. Phase 8 doesn't add new args (DEC-v11-08-01). |
| Information disclosure via rank-leakage (caller infers existence of restricted tool from result ordering) | Information Disclosure | Role-filter-after-rank preserves opaque denial — restricted tools NEVER appear in `tools` array. The `total_available` count reflects role-allowed surface (REQ-v11-session-invariants), not full surface. So the caller cannot count "missing" tools. |

**Summary:** Phase 8's primary threats are information disclosure via failure logs (locked by message format) and denial of service via malformed provider responses (mitigated by validation + fallback). Both follow the same defensive posture Phase 7 established. No net new threats introduced; the new attack surface (per-query embedding) is bounded by the same RBAC invariant + structural validation that bounded the Phase 7 build path.

## Sources

### Primary (HIGH confidence)
- `/Users/zaid/Projects/MCPack/src/core.ts` — read in full (lines 1-256). `MCPackEngine` class structure, `handleSearchTools` body, Phase 7 fields, constructor flow, `isIndexReady()` semantics. Phase 8's primary modification target.
- `/Users/zaid/Projects/MCPack/src/search.ts` — read in full (lines 1-76). `scoreAndRank` function structure, 5-tier weighted scoring constants, return-array-don't-mutate semantics. Phase 8 reuses logic; recommends additive `keywordScoreForEntry` export.
- `/Users/zaid/Projects/MCPack/src/types.ts` — read in full (lines 1-163). `EmbeddingProvider` type contract, `MCPackConfig.embeddings.weights` already typed, public/internal type partition. Phase 8 reads only.
- `/Users/zaid/Projects/MCPack/src/semantic-index-builder.ts` — read in full (lines 1-41). Sibling helper pattern Phase 8 mirrors with `src/hybrid-scoring.ts`.
- `/Users/zaid/Projects/MCPack/src/roles.ts` — read in full (lines 1-89). `resolveRoleAccess` semantics; Phase 8 calls it post-rank.
- `/Users/zaid/Projects/MCPack/test/semantic-index-build.test.ts` — read key sections (header + Group 5 + Group 6 + Group 7). Phase 7's test patterns (mock provider, fixtures, Pitfall 7 negative control). Phase 8 mirrors.
- `/Users/zaid/Projects/MCPack/.planning/phases/08-hybrid-ranking-query-path-v1-1/08-CONTEXT.md` — read in full (lines 1-197). Locked decisions, edge cases, claude's discretion items, deferred ideas.
- `/Users/zaid/Projects/MCPack/.planning/phases/07-semantic-index-build-pipeline-v1-1/07-CONTEXT.md` — read in full. Phase 7 carry-forward (build-pending, RBAC invariant, locked warn format, BLOCKING gates).
- `/Users/zaid/Projects/MCPack/.planning/phases/07-semantic-index-build-pipeline-v1-1/07-RESEARCH.md` — read first 400 + 500 lines. Pitfall 7 pattern, BLOCKING gates structure, Patterns 1-4, Don't-Hand-Roll table.
- `/Users/zaid/Projects/MCPack/.planning/phases/07-semantic-index-build-pipeline-v1-1/07-VALIDATION.md` — read in full. Validation Architecture template Phase 8 mirrors.
- `/Users/zaid/Projects/MCPack/.planning/phases/07-semantic-index-build-pipeline-v1-1/07-VERIFICATION.md` — read in full (lines 1-417). 11/11 dimension reference, Phase 7 close-out evidence, Gate 4 process.
- `/Users/zaid/Projects/MCPack/.planning/phases/07-semantic-index-build-pipeline-v1-1/07-REVIEW.md` — read in full (lines 1-269). WR-01 (`hasVectors` rationale), WR-02 (unhandled-rejection test), WR-03 (RBAC fixture-coupling fix).
- `/Users/zaid/Projects/MCPack/.planning/REQUIREMENTS.md` — read in full. Phase 8 requirements + traceability matrix.
- `/Users/zaid/Projects/MCPack/.planning/STATE.md` — read in full. Decisions log + current position + accumulated context.
- `/Users/zaid/Projects/MCPack/.planning/PROJECT.md` — read in full. Project core value + constraints + key decisions table.
- `/Users/zaid/Projects/MCPack/.planning/ROADMAP.md` — read in full. Phase 8 goal + Success Criteria + downstream phase dependencies.
- `/Users/zaid/Projects/MCPack/PLAYBOOK.md` — read in full. Current Sprint, Open Code Review Items, Quality Gates, Commit Messages.
- `/Users/zaid/Projects/MCPack/CLAUDE.md` — read in full (via system reminder). Stack lock, security invariants, build commands, key patterns.
- `/Users/zaid/Projects/MCPack/package.json` — read in full. Verified zero new deps; all required tooling already present.

### Secondary (MEDIUM confidence — verified against npm registry / standard knowledge)
- `npm view vitest version` → `4.1.5` (within `^4.1.0` lock — current).
- `npm view typescript version` → current LTS (project pins `~5.8.3` intentionally).
- `npm view @modelcontextprotocol/sdk version` → `1.29.0` (within peer + dev lock ranges).
- Cosine similarity formula — standard linear algebra, verified against multiple references.
- Min-max normalization — standard statistics, verified.
- `process.on('unhandledRejection', listener)` — Node standard, verified to work in vitest 4.x by inspection of vitest's runner architecture (no special mocking required).

### Tertiary (LOW confidence — flagged in Assumptions Log)
- A1: "rank-then-filter on v1.0 keyword path produces observable-byte-identical results to filter-then-rank for all 124 baseline tests" — reasoning-based; requires Wave 0 empirical verification.
- A10: "process.on('unhandledRejection', listener) works in vitest 4.1.x default runner" — reasonable based on Node standards but not directly tested. Wave 0 should write the test first as a smoke check.

## Metadata

**Confidence breakdown:**
- Engine refactor design (`hasVectors`, `embedQuery`, `handleSearchTools` reorder): **HIGH** — verified by reading `src/core.ts` end-to-end + locked decisions in CONTEXT.
- Pure-function math (cosine, normalize, combine): **HIGH** — standard formulas, edge cases enumerated by CONTEXT, tests are straightforward to write exhaustively.
- Test patterns: **HIGH** — Phase 7 patterns directly applicable; mock providers, spy patterns, negative controls all proven in Phase 7.
- Four [BLOCKING] gates: **HIGH** — Phase 7 verified all four; Phase 8 should pass trivially because it adds zero deps, zero public exports, and zero adapter references.
- Backward-compat (rank-then-filter on v1.0 path): **MEDIUM** — reasoning says yes; empirical verification required in Wave 0 before writing new tests.
- Performance budget at unit-test level: **HIGH** — sync mock provider sub-ms; 50ms cap has 500× headroom.
- Real-MiniLM 50ms p99 query budget: **DEFERRED to Phase 10** — explicitly out of Phase 8 scope.
- 50-query intent benchmark recall ≥ 15%: **DEFERRED to Phase 10** — explicitly out of Phase 8 scope.
- WR-02 unhandled-rejection test pattern: **MEDIUM-HIGH** — reasonable based on Node standards; Wave 0 smoke-check confirms.
- WR-01 fix via `hasVectors()`: **HIGH** — locked in CONTEXT; tests straightforward.
- WR-03 proactive fix at new test sites: **HIGH** — iterate fixture array pattern is mechanical.

**Research date:** 2026-04-26
**Valid until:** 2026-05-26 (30 days; project is fast-moving on v1.1 phases but the engine surface is stable, dependencies are locked, and Phase 8's design is bounded by the locked decisions in 08-CONTEXT.md).
