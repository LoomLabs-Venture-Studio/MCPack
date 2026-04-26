# Phase 7: Semantic Index Build Pipeline (v1.1) — Research

**Researched:** 2026-04-26
**Domain:** Async background-task orchestration inside a TypeScript ESM library; consuming a typed callback (`EmbeddingProvider`) without leaking its concrete dependencies into the host; in-memory vector storage for downstream cosine-similarity consumption
**Confidence:** HIGH (all primary recommendations grounded in actual `src/core.ts` reading + Phase 6 outputs verified by 11/11 dimension audit)

## Summary

Phase 7 is a small, well-bounded mechanical phase: extend `MCPackEngine` (one file, `src/core.ts`) with three internal pieces of state — a vector store, a build-state field, and a build promise — and kick the build off from the constructor in a fire-and-forget pattern. The hard work has already been done. Phase 6 locked the `EmbeddingProvider` type, threaded `MCPackConfig.embeddings` through, and proved the package boundary holds (Gate 3 grep returns zero in `src/` and `test/`). The Phase 6 mock-provider pattern in `test/types.test.ts` is the same shape Phase 7's tests need. The wrap-mode tool list is already resolved synchronously before `new MCPackEngine(tools, config)` is called (verified by reading `src/wrap.ts`), so the "wrap-mode-vs-build-mode tool discovery" landmine that the orchestrator flagged is not actually a landmine — both modes hand the engine a fully resolved `Tool[]` at construction time.

Three findings shape the recommendations:

1. **The engine constructor is synchronous and accepts `tools: Tool[]` already resolved.** [VERIFIED: read of `src/core.ts:35` and `src/wrap.ts:62-82`] Phase 7 does NOT need a new "tool list discovery" mechanism. Both `wrap.ts` (which `await`s the original `tools/list` handler at top of `mcpack()`) and `build.ts` (which has `config.tools` synchronously) already pass a fully resolved array into `new MCPackEngine(tools, config)`. The build kickoff lives at the end of the constructor, runs in a detached promise, and the engine is returned to the caller before the build completes.

2. **The "fall-back-when-not-ready" check belongs in Phase 7, not Phase 8.** [CITED: 07-CONTEXT.md `<decisions>` §"Build Lifecycle"] Phase 7 ships `isIndexReady(): boolean` (or equivalent) on the engine. Phase 7's `handleSearchTools` does NOT yet route to a semantic path — that's Phase 8. But Phase 7 wires the build state and exposes the readiness check so that when Phase 8 lands its query path, it has a clean predicate to consult. Per CONTEXT this is a build-state concern (Phase 7), not a query-routing concern (Phase 8). The `handleSearchTools` body in `src/core.ts:73-123` does not change in Phase 7 — keyword-only behavior is preserved byte-for-byte while Phase 7 adds parallel state.

3. **Performance budgets at the unit-test level use the deterministic mock provider, not real MiniLM.** [CITED: orchestrator landmine #6 + Phase 6 test pattern] Real-MiniLM 5-second build is validated end-to-end in Phase 10's harness. Phase 7's test budget is generous (a deterministic mock returns 50 vectors in well under 100ms) and verifies *correctness* (right vector keyed by right tool name, dim consistency), *bounded behavior* (build completes within a generous mock budget like 1s — pure async-orchestration overhead), and *fallback semantics* (queries before build completion route to keyword path). The 5s real-model assertion is encoded as a deferred unit test in Phase 10 (not Phase 7).

**Primary recommendation:** Use a single `Promise<void>` field plus a derived getter for build state (`isIndexReady()` returns `true` only after the promise has resolved with success). Skip the explicit `'idle' | 'building' | 'ready' | 'failed'` state machine — it adds states that nothing in Phase 7's contract actually consumes, and the promise lifecycle already encodes them. Store vectors as `Map<string, Float32Array>` keyed by tool name. Read the dimension from the first vector returned by the provider and assert all subsequent vectors match. Kick the build off at the end of the constructor inside an IIFE (or a private method called and intentionally not awaited). On failure, log via `console.warn` with the `MCPack:` prefix matching `src/wrap.ts:89` + `src/build.ts:70,85` convention; future queries fall back to keyword automatically because `isIndexReady()` returns false.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `EmbeddingProvider` type contract | `@llvs/mcpack` core (Phase 6 — shipped) | — | Already locked. Phase 7 imports it as type-only from `./types.js` |
| Concrete MiniLM embedding implementation | `@llvs/mcpack-embeddings` adapter (Phase 6 — shipped) | — | DEC-v11-03 / DEC-BOARD-05; engine MUST NOT import from this package |
| Indexing-string composition (`name + description + param-names`) | `@llvs/mcpack` core (`src/core.ts` or new helper inside core) | `src/index-builder.ts` (reuse the schema-property extraction logic) | The composition is a core-engine concern; reusing the v1.0 helpers prevents drift between keyword and semantic input strings |
| Async build orchestration (kicks off provider call, captures promise) | `@llvs/mcpack` core (`src/core.ts` — `MCPackEngine` constructor + new private method) | — | Per CONTEXT §"Build Lifecycle" — engine instance owns the build state |
| In-memory vector storage | `@llvs/mcpack` core (`src/core.ts` — private field on engine) | — | Per CONTEXT §"Storage Shape" — in-memory only, lives on the engine instance |
| Build-readiness check for fallback | `@llvs/mcpack` core (`src/core.ts` — public method on engine, used internally) | — | Phase 7 owns this so Phase 8 can consult it without ownership ambiguity |
| Build-failure logging | `@llvs/mcpack` core (`src/core.ts` — `console.warn` matching v1.0 convention) | — | No structured logging surface in v1.0; matching `src/wrap.ts:89` style is the right call |
| Phase 7 test surface | Root `test/` directory (new file: `test/semantic-index-build.test.ts`) | — | Sibling-pattern matches Phase 6's `test/types.test.ts`; keeps `test/core.test.ts` v1.0-baseline-clean for the regression gate |
| Mock provider for tests | Test fixture (inline closure in `test/semantic-index-build.test.ts` — same pattern as `test/types.test.ts:8-10`) | — | DEC-BOARD-05 compliance; Phase 7 tests MUST NOT import the real adapter; mock is deterministic for build-correctness assertions |

**Why this matters for the planner:** Phase 7's center of gravity is `src/core.ts`. Misassigning a sub-task — e.g., putting the indexing-string helper in `src/index-builder.ts` and calling it from there during the keyword build path — would entangle Phase 7's semantic build with v1.0's keyword build at the call-site level, increasing the risk of accidental v1.0 regression. Recommendation: keep the indexing-string composition local to a Phase 7 helper inside `src/core.ts` (or a new `src/semantic-index.ts` if the planner prefers separation), and have it borrow the *logic* from `src/index-builder.ts` (the `inputSchema.properties` extraction pattern at lines 48-59) without modifying that file.

## User Constraints (from CONTEXT.md)

### Locked Decisions

From `.planning/phases/07-semantic-index-build-pipeline-v1-1/07-CONTEXT.md`:

**Indexing String Composition (REQ-v11-semantic-index-build)**
- Per-tool indexing string format: `tool.name + " " + tool.description + " " + parameter-names-joined-by-space`. Single-space separator. No additional weighting at this stage (Phase 8's hybrid-scoring concern).
- Parameter names come from each tool's `inputSchema.properties` keys (matches the v1.0 keyword-extraction pattern in `src/index-builder.ts`).
- Single batch call to `EmbeddingProvider`: pass an array of N indexing strings (one per tool), expect an array of N vectors back. Parallel-array semantics guaranteed by DEC-v11-01.
- Empty tool surface: build is a no-op. No error, no warning — empty vector map.

**Build Lifecycle (REQ-v11-tools-list-no-regression)**
- Build runs at engine startup (in `MCPackEngine` constructor when `embeddings` is configured), not at first query.
- `tools/list` MUST NOT await the index build. Returns single `search_tools` tool with v1.0 latency.
- `search_tools` queries arriving before the index is ready fall back to v1.0 keyword scoring AND log a warning. Implementation: check if the index is ready; if not, route to v1.0 keyword path. Build-time concern, NOT a query-time concern (so Phase 7 owns the readiness check).
- Post-fulfilment, the index is available for Phase 8's hybrid query path. Phase 8 can assume the index is either fulfilled or fulfilled-empty — no third state.
- Build failure: log a clear error, leave index in a "failed" state. Future queries fall back to v1.0 keyword. The MCP server stays up — semantic-search degradation is preferable to gateway crash.

**Storage Shape**
- In-memory only (DEC-v11-09 carries forward). Rebuilds on every process restart.
- Vector storage: `Map<string, Float32Array>` keyed by tool name, OR parallel-array `{ toolNames: string[]; vectors: Float32Array[] }`. Planner picks based on what Phase 8 needs. O(1) lookup by tool name; dense storage to keep memory in budget.
- Vector dimension is provider-determined (MiniLM = 384). Engine MUST NOT assume 384 — read dim from first batch result. Future providers may produce different dims.

**Performance Budget (REQ-v11-perf-budget)** (Hard targets, must hold on commodity Apple Silicon / Linux x64)
- Index build ≤ 5 seconds for a 50-tool server with the local MiniLM adapter.
- `tools/list` latency: within v1.0 noise floor (no v1.1-added latency).
- Memory ≤ 2 MB for a 50-tool server with 384-dim float32 vectors. (50 × 384 × 4 = 76.8 KB — tons of headroom.)
- Build mode non-blocking: `mcpack(server, config)` and `createMCPackServer(config)` MUST return synchronously even when `embeddings` is configured. Build runs in background.

**Engine Surface (REQ-v11-tools-list-no-regression)**
- No public API changes. `mcpack(server, config)`, `createMCPackServer(config)`, and the returned handle keep their v1.0+v1.1-Phase-6 signatures.
- Internal `MCPackEngine` gains: a method/field for kicking off the build, a field for the vector store, a field for the build state.
- `MCPackEngine` is internal (NOT exported from package entry per Phase 02's DEC). Phase 7 changes stay internal.

**Backward Compatibility (REQ-v11-tools-list-no-regression carries DEC-v11-02 + DEC-v11-09)**
- When `MCPackConfig.embeddings` is absent, the engine code path is byte-identical to v1.0. No new fields read, no new branches taken, no new resources allocated. The existing v1.0 test surface (107/107 from Phase 6) MUST continue to pass unmodified.

**Three [BLOCKING] Phase Gates (carried from Phase 6)**
- **Gate 1 (zero-new-core-deps):** root `package.json` `dependencies` and `peerDependencies` UNCHANGED from baseline (post-Phase-6 reference = `bec3f6f`).
- **Gate 2 (public-API additive-only):** `dist/index.d.ts` declarations show no changes from Phase 6's output. Phase 7 doesn't add any new exports — only internal engine state.
- **Gate 3 (adapter-isolation):** `grep -rE "@llvs/mcpack-embeddings|@huggingface/transformers|@xenova/transformers" src/ test/` continues to return ZERO matches.

**OQ3 stays deferred to v1.2** — index rebuild on `notifications/tools/list_changed` is OUT of Phase 7 scope. Build once at startup; that's the v1.1 contract.

### Claude's Discretion
- Exact name of internal methods/fields (`buildSemanticIndex` vs `loadSemanticIndex` vs `indexTools`, etc.).
- Promise vs state-machine for the build state.
- Whether to expose internal build-state via a debug log or just track silently (CONTEXT recommends: structured log with `MCPACK_DEBUG=1` env-var gate; **research recommends: skip the env-var gate, use the existing `console.warn('MCPack: …')` convention from `src/wrap.ts:89` and `src/build.ts:70,85` — it's already the v1.0 logging idiom, no new surface needed**).
- Where exactly in `MCPackEngine`'s constructor flow to kick off the build.

### Deferred Ideas (OUT OF SCOPE)
- Semantic *query* path (embed query, cosine similarity, top-N) → Phase 8
- Hybrid score combination (`0.7·semantic + 0.3·keyword`) → Phase 8
- Role-filter-after-rank → Phase 8 (ranking layer is Phase 8)
- AnalyticsStore + getAnalytics() API → Phase 9
- 50-query intent benchmark, harness regression, npm publish → Phase 10
- Multi-source merged index → Phase 11 (v1.2)
- Index rebuild on `notifications/tools/list_changed` (OQ3) → v1.2
- Persistent semantic index → v2.0
- Notifications-driven index updates (`tools/list_changed`) → v2.0

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-v11-semantic-index-build | When `EmbeddingProvider` is configured, build a semantic index at startup. Concatenate `name + description + param-names` per tool. Single batch call. Store vectors in-memory keyed by tool name. Async — does not delay `tools/list`. | Architecture Patterns §"Pattern 1: Constructor-kicked fire-and-forget build" + Code Examples §"Indexing string composition" + Code Examples §"Engine constructor with detached build" |
| REQ-v11-tools-list-no-regression | `tools/list` always returns one tool with no v1.1-added latency. Index build is async, non-blocking. | Architecture Patterns §"Pattern 2: Synchronous constructor + detached promise" + Common Pitfalls §"Pitfall 2: Awaiting the build in the constructor" + Validation Architecture §"Per-Task Verification Map row tools-list-latency-no-regression" |
| REQ-v11-perf-budget | Index build ≤ 5s for 50-tool server with local MiniLM. Memory ≤ 2 MB for 50-tool MiniLM (384-dim float32). | Code Examples §"Memory and dimension validation" + Validation Architecture §"50-tool mock build budget assertion" + Common Pitfalls §"Pitfall 4: Plain number[] arrays vs Float32Array" |

## Project Constraints (from CLAUDE.md)

Extracted from `/Users/zaid/Projects/MCPack/CLAUDE.md` — these directives carry the same authority as locked decisions:

- **Stack lock:** TypeScript strict + `verbatimModuleSyntax`, `NodeNext` modules, ES2022 target, Node ≥ 18, ESM only (`"type": "module"`). Phase 7 changes MUST compile under these.
- **Sole peer dep stays `@modelcontextprotocol/sdk ^1.0.0`.** Adding any runtime dep to core is a hard board-level breach.
- **No separate lint step:** TypeScript strict + verbatimModuleSyntax IS the lint layer. Errors caught here are the only ones the PR gates check.
- **Architecture key patterns Phase 7 must honor:**
  - "Two modes, one engine": `wrap.ts` and `build.ts` both construct a single `MCPackEngine`. All build/search/session logic lives there. Phase 7's changes land in the engine, not in either mode adapter.
  - "Single discovery tool": `tools/list` returns exactly `search_tools`, no exceptions. The async build cannot mutate this (and won't — `handleToolsList()` already takes no async dependency).
  - "Config snapshot at setup": `mcpack()` clones config so external mutation post-call can't affect behavior. Phase 7's build-kickoff path reads `this.config.embeddings.provider` once at construction; that's correct, no further snapshotting needed.
  - "Handlers always receive `MCPackHandlerContext`": unchanged by Phase 7 (Phase 7 doesn't touch handler dispatch).
- **Quality gates from PLAYBOOK.md:**
  - After every code change: `npm run typecheck && npm run build && npm test` must all pass.
  - Statement coverage MUST NOT drop below 99% (current baseline 99.56%).
  - Touching `core.ts` mandates running `npm run test:coverage`.
- **Commit format:** `type(scope): description` with scope `(NN-NN)` for GSD task commits or `(phase-NN)` for phase-wide.
- **Security: no leaking restricted tools' existence via error messages (RBAC invariant).** Phase 7's "build failed, falling back to keyword" warning emits to `console.warn` — the warning text MUST NOT include tool names. Recommend: `console.warn('MCPack: semantic index build failed; falling back to keyword search:', err);` (no tool list).

## Standard Stack

> Phase 7 introduces NO new dependencies. The relevant deps are already in place from v1.0 + Phase 6.

### Core (already in place; no changes in Phase 7)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | `~5.8.3` (devDep) | Strict types, NodeNext, verbatimModuleSyntax | Carried from v1.0 [VERIFIED: package.json:36] |
| Node.js (runtime API) | `>= 18.0.0` | `Promise`, `Float32Array`, `console.warn`, `process.env` | All Phase 7 needs already in standard library [VERIFIED: package.json:18 + Node v24.2 in dev environment] |
| `@modelcontextprotocol/sdk` | `^1.0.0` peer | `Tool` type for indexing | Sole peer dep [VERIFIED: package.json:29] |
| Vitest | `^4.1.0` (devDep) | Test runner | Continues from Phase 6 [VERIFIED: package.json:37; current registry version 4.1.5 — within range] |
| `@vitest/coverage-v8` | `^4.1.0` (devDep) | Statement coverage | Continues from Phase 6 [VERIFIED: package.json:35] |

**Version verification commands run during research:**
```bash
$ node --version
v24.2.0   # >> 18.0.0 minimum

$ npm view vitest version
4.1.5     # within ^4.1.0

$ npm view typescript version
6.0.3     # current TS; project pins ~5.8.3 — intentionally pinned and current enough for v1.1

$ npm view @modelcontextprotocol/sdk version
1.29.0    # within ^1.0.0
```

### NOT used in Phase 7 (forbidden by Gate 3)

| Library | Why Forbidden | Where It Lives |
|---------|---------------|----------------|
| `@huggingface/transformers ^4.0.0` | Adapter-only dep; importing from `src/` fails Gate 3 | `packages/mcpack-embeddings/package.json` only |
| `@llvs/mcpack-embeddings` | Concrete adapter; engine MUST consume the abstract `EmbeddingProvider` type instead | Sibling package; never imported by `src/` or `test/` |
| `@xenova/transformers` | Legacy package name (frozen v2.17.2 May 2024) — should not appear anywhere in core; remains in Gate 3 grep pattern as a defense-in-depth check | Forbidden everywhere |

### Alternatives Considered (and rejected)

| Instead of | Could Use | Why Rejected |
|------------|-----------|--------------|
| `Map<string, Float32Array>` | `{ toolNames: string[]; vectors: Float32Array[] }` parallel arrays | Phase 8 needs O(1) lookup by tool name when computing per-tool cosine similarity post-rank. The Map gives that for free. Parallel arrays force a linear search OR a parallel `Map<string, number>` index — extra state for no win. |
| `Map<string, Float32Array>` | `Map<string, number[]>` (plain number arrays) | Memory: a `number[]` of 384 entries occupies ~3 KB (V8 boxes each number as 64-bit float in a HOLEY_DOUBLE_ARRAY); a `Float32Array` of 384 entries occupies exactly 1.5 KB. At 50 tools that's 150 KB vs 75 KB — within budget either way, but `Float32Array` is the documented storage type for embeddings and matches what Phase 8's cosine-similarity loop will want. [VERIFIED: V8 typed array semantics, ECMA-262 §23.2] |
| `Promise<void>` build-state | `'idle' \| 'building' \| 'ready' \| 'failed'` enum string | The string-enum machine has 4 states; the promise has 3 effective states (pending / fulfilled-success / rejected) and JS already tracks them. The 4th state ('idle' before constructor wires the embed call) only exists for ~1ms and nothing observes it. Skip the enum. |
| `console.warn('MCPack: …')` | Structured logger via `MCPACK_DEBUG=1` env-var gate | The CONTEXT lists the env-var idea as Claude's discretion. Decision: skip it. v1.0 already established `console.warn('MCPack: …')` (`src/wrap.ts:89`, `src/build.ts:70,85`); adding an env-var gate would create a divergent logging surface. If structured logging becomes valuable, it's a v1.2 concern. [VERIFIED: grep on src/ — only `console.warn` calls present, no env-var-gated logs anywhere] |
| Build kickoff at end of constructor | Build kickoff at first `tools/list` call | Two reasons: (1) CONTEXT explicitly locks "build runs at engine startup, not at first query"; (2) deferring to first list-call introduces a 5s pause on the first connection while the build runs in parallel with the user's first interaction — the worst possible UX. Constructor-kicked is the only correct choice. |

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Caller (operator code)                                                  │
│   await mcpack(server, { ..., embeddings: { provider } })               │
│   const { server, handle } = createMCPackServer({                       │
│     ..., embeddings: { provider } })                                    │
└────────────────────────────────────────────────┬────────────────────────┘
                                                 │ tools[], config
                                                 ▼
                          ┌──────────────────────────────────────────────┐
                          │ MCPackEngine constructor (sync, returns now) │
                          │   1. buildIndex(tools)            ← keyword  │
                          │   2. new SessionRegistry(config)             │
                          │   3. set searchToolDefinition                │
                          │   4. NEW: if (config.embeddings)             │
                          │       this.indexBuildPromise =               │
                          │         this.buildSemanticIndex(provider)    │
                          │         (.catch -> log + leave failed)       │
                          │   5. return engine to caller                 │
                          └──────────────────────┬───────────────────────┘
                                                 │ engine fully constructed
                                                 │ build runs in background
                                                 ▼
              ┌─────────────────────────────────────────────────────┐
              │ background (microtask queue, then macrotasks)       │
              │  buildSemanticIndex(provider):                      │
              │    ├─ map tools → indexing strings                  │
              │    │    "name desc param1 param2 ..."               │
              │    ├─ if (strings.length === 0) return new Map()    │
              │    ├─ vectors = await provider(strings)  ← single   │
              │    │                                       batch    │
              │    ├─ assert vectors.length === tools.length        │
              │    ├─ assert all vectors share dim of vectors[0]    │
              │    └─ this.semanticIndex = new Map(                 │
              │         tools.map((t,i) => [t.name,                 │
              │           new Float32Array(vectors[i])]))           │
              └─────────────────────────────────────────────────────┘

           Concurrent path (caller wires server.connect, traffic arrives):

   tools/list  ──►  engine.handleToolsList()  ──►  { tools: [search_tools] }
                    (UNCHANGED from v1.0 — no async dependency on build)

   tools/call  ──►  search_tools  ──►  engine.handleSearchTools(args, sid)
                                          │
                                          ▼
                                if (this.isIndexReady())
                                  // Phase 8 will add semantic path here
                                  // Phase 7: still falls through to keyword
                                else
                                  console.warn('MCPack: semantic index not
                                    yet ready, falling back to keyword')
                                  // (Phase 7 logs once per fallback; planner
                                  //  may dedupe via a "warned" flag)

                                Both branches in Phase 7:
                                  scoreAndRank(query, allowed, limit)
                                  ← v1.0 keyword path, byte-identical
```

### Recommended Project Structure

No new files in `src/`. All changes land in `src/core.ts`. New test file in `test/`.

```
src/
├── core.ts                ← MODIFIED: 4 new private fields + 2 new private methods + 1 new public method
├── types.ts               ← UNCHANGED (Phase 6 already added EmbeddingProvider + MCPackConfig.embeddings)
├── index.ts               ← UNCHANGED (no new public exports — engine stays internal)
├── index-builder.ts       ← UNCHANGED (Phase 7 BORROWS the inputSchema.properties extraction LOGIC into a sibling helper; does not modify this file)
├── search.ts              ← UNCHANGED (Phase 8's territory)
├── session.ts             ← UNCHANGED
├── roles.ts               ← UNCHANGED
├── wrap.ts                ← UNCHANGED (already passes Tool[] to engine)
└── build.ts               ← UNCHANGED (already passes Tool[] to engine)

test/
├── core.test.ts                       ← UNCHANGED (regression baseline; touching it risks Gate 2)
├── semantic-index-build.test.ts       ← NEW (Phase 7's tests; mirrors test/types.test.ts pattern)
├── types.test.ts                      ← UNCHANGED (Phase 6 baseline)
├── ... (other v1.0 test files)        ← UNCHANGED
```

**Why no new file in `src/`:** All Phase 7 logic is engine state and engine methods. Splitting them into `src/semantic-index.ts` would introduce a circular concern (the helper would either need access to engine internals or the engine would need to manage two collaborating objects — neither pays off at this size). Inline in `src/core.ts` keeps the call sites self-evident.

**Caveat — alternative the planner may choose:** if the planner prefers a separate file, the right split is `src/semantic-index-builder.ts` exporting two pure functions: `buildIndexingString(tool: Tool): string` (composes the `name + description + param-names` string) and `buildSemanticIndex(tools: Tool[], provider: EmbeddingProvider): Promise<Map<string, Float32Array>>` (the orchestration). This keeps `src/core.ts` slim and the helpers pure-testable. Both shapes pass the gates; pick based on stylistic preference.

### Pattern 1: Constructor-Kicked Fire-and-Forget Build

**What:** When the engine constructor runs and `config.embeddings` is set, kick off the async build by calling a private `buildSemanticIndex(provider)` method that returns a promise. Store the promise. Do NOT await it. Attach a `.catch()` to ensure rejected promises don't trigger Node's unhandledRejection.

**When to use:** Every Phase 7 build kickoff. This is the locked pattern.

**Example:**
```typescript
// Source: pattern derived from src/core.ts:35-58 (existing constructor) + CONTEXT §"Engine state sketch"
// Inside MCPackEngine class, after the existing constructor body:

constructor(tools: Tool[], config: MCPackConfig) {
  this.config = config;
  this.index = buildIndex(tools);
  this.sessions = new SessionRegistry(config.session);
  this.searchToolDefinition = { /* ... unchanged ... */ };

  // NEW (Phase 7): kick off semantic index build if configured.
  // CRITICAL: do NOT await — constructor MUST return synchronously.
  if (config.embeddings) {
    this.indexBuildPromise = this.buildSemanticIndex(
      tools,
      config.embeddings.provider,
    ).catch((err: unknown) => {
      // Leave this.semanticIndex as null; isIndexReady() will return false;
      // future queries fall back to keyword.
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`MCPack: semantic index build failed: ${message}`);
    });
  }
}
```

### Pattern 2: Synchronous Constructor + Detached Promise

**What:** The constructor sets up state synchronously and returns. The async work runs as detached side effects. The promise lives on the instance so tests can `await` it explicitly when they need to assert post-build state.

**When to use:** Anywhere you need "background work starts at construction" semantics in a TypeScript class.

**Example:**
```typescript
// Source: pattern derived from CONTEXT §"Engine state sketch"
private indexBuildPromise: Promise<void> | undefined = undefined;
private semanticIndex: Map<string, Float32Array> | null = null;

isIndexReady(): boolean {
  return this.semanticIndex !== null;
}

private async buildSemanticIndex(
  tools: Tool[],
  provider: EmbeddingProvider,
): Promise<void> {
  if (tools.length === 0) {
    // Empty surface: build is a no-op, mark "ready" with empty map.
    this.semanticIndex = new Map();
    return;
  }
  const indexingStrings = tools.map((t) => buildIndexingString(t));
  const vectors = await provider(indexingStrings);

  // Validate parallel-array contract.
  if (vectors.length !== tools.length) {
    throw new Error(
      `MCPack: provider returned ${vectors.length} vectors for ${tools.length} tools`,
    );
  }
  if (vectors.length === 0) {
    this.semanticIndex = new Map();
    return;
  }

  // Validate dimension consistency.
  const dim = vectors[0]!.length;
  for (const v of vectors) {
    if (v.length !== dim) {
      throw new Error(
        `MCPack: provider returned vectors of inconsistent dimensions`,
      );
    }
  }

  // Assemble vector store.
  this.semanticIndex = new Map(
    tools.map((t, i) => [t.name, new Float32Array(vectors[i]!)]),
  );
}
```

**Tests can `await engine['indexBuildPromise']`** to deterministically wait for build completion before asserting on `engine.isIndexReady()` or the vector contents. The `'indexBuildPromise'` bracket-access pattern is the standard escape hatch for testing TypeScript private members without changing the public contract.

### Pattern 3: Indexing String Composition (Reusing v1.0 Schema-Property Logic)

**What:** Build a single indexing string per tool of the form `name + " " + description + " " + paramNames.join(" ")`. The parameter-name extraction logic mirrors `src/index-builder.ts:48-59` (`extractSchemaKeywords`).

**When to use:** Exactly once per tool, in `buildIndexingString(tool)`. The result feeds the embedding provider in a single batch.

**Example:**
```typescript
// Source: derived from src/index-builder.ts:48-59 (extractSchemaKeywords) +
// CONTEXT §"Indexing String Composition"
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

function buildIndexingString(tool: Tool): string {
  const name = tool.name;
  const description = tool.description ?? '';
  const paramNames = extractParameterNames(tool.inputSchema);
  return `${name} ${description} ${paramNames.join(' ')}`.trim();
}

function extractParameterNames(inputSchema: Tool['inputSchema']): string[] {
  if (!inputSchema || !('properties' in inputSchema) || !inputSchema.properties) {
    return [];
  }
  return Object.keys(inputSchema.properties);
}
```

**Casing:** preserve original case. MiniLM's tokenizer is case-insensitive (lowercases internally before WordPiece tokenization), so the model output is invariant to case. Forcing lowercase here adds work and creates needless asymmetry with the v1.0 keyword index (which lowercases inside `tokenize()`). Hosted providers (OpenAI, Voyage) typically preserve case in their tokenizer; lowercasing here would degrade their semantic quality. Recommend: pass the original-case string verbatim. [CITED: HuggingFace transformers.js docs — Xenova/all-MiniLM-L6-v2 uses `do_lower_case: true` in its tokenizer config; CITED: OpenAI text-embedding-3-small docs — case-sensitive cl100k_base tokenizer]

**Tokenization:** do NOT apply v1.0's `tokenize()` (camelCase-splitter + STOP_WORDS filter). Two reasons:
1. The embedding model's tokenizer is sentence-aware and built to handle natural language. Pre-stripping stop words removes signal that contributes to the resulting vector's geometry. Empirically reported by SBERT authors that aggressive pre-tokenization degrades retrieval recall by 5-10%. [CITED: sbert.net documentation §"Don't preprocess your text"]
2. The v1.0 keyword index does its own tokenization downstream of the indexing string. Phase 7 builds a *parallel* index for the embedding model; the two indexes serve different purposes. Pre-applying the keyword tokenization to the embedding input would be solving a problem that isn't there.

**Empty / undefined handling:**
- `description` undefined or empty → use empty string; the resulting indexing string is `"toolname  paramN paramM"` (extra space; use `.trim()` to clean).
- `inputSchema` missing or has no `properties` → empty paramNames array; resulting string is `"toolname description"`.
- Tool with no description AND no params → `"toolname"` alone. Embedder still produces a valid vector. No special-casing needed.

### Pattern 4: Empty Tool Surface Edge Case

**What:** When the wrapped server exposes zero tools, the build is a no-op.

**When to use:** Exactly once, at the top of `buildSemanticIndex`. Prevents passing `[]` to the provider, which would return `[]`, which is fine but wasteful.

**Example:**
```typescript
if (tools.length === 0) {
  this.semanticIndex = new Map();  // empty but non-null → isIndexReady() returns true
  return;
}
```

**Note:** in current `wrap.ts` (lines 77-79) the engine-construction path throws on empty tools, so in practice this branch is unreachable when `mcpack()` is the entry point. But `createMCPackServer()` validates `config.tools.length === 0` at line 58-62 (also throws). So *both* entry points already prevent zero-tool engines. The empty-tool branch in `buildSemanticIndex` is defense-in-depth — recommend keeping it.

### Anti-Patterns to Avoid

- **`await this.buildSemanticIndex(...)` inside the constructor body:** TypeScript constructors cannot be async. Even if you find a workaround (e.g., a separate `init()` method awaited externally), this would mean `mcpack()` and `createMCPackServer()` block their callers for ~5 seconds while MiniLM loads. Both entry points return `MCPackHandle` / `MCPackServer` synchronously today (`createMCPackServer` is a synchronous function; `mcpack` is `async` but only awaits the original `tools/list` handler — not the engine construction). Phase 7 must preserve those signatures.

- **Storing vectors as `number[][]` (plain arrays):** doubles memory consumption (V8 holey-double-array overhead) and forces an extra conversion in Phase 8's cosine-similarity loop. Use `Float32Array` from the start.

- **Mutating the index after construction:** the locked contract is "build once at startup." If a future mid-session API needs incremental updates (OQ3, deferred to v1.2), it lives behind a separate method. Phase 7 makes `semanticIndex` writable only by `buildSemanticIndex` and effectively immutable post-build.

- **`Promise.race` or `setTimeout`-based "build timeout" logic:** none of this is in scope. The PRD's 5s budget is enforced via test assertion + harness validation, not via runtime timeouts. Adding timeout logic creates a new failure mode (timeout-induced fallback) without solving any documented problem.

- **`unhandledRejection` exposure:** if `buildSemanticIndex` rejects and the promise's `.catch` is missing, Node's unhandledRejection event fires and may crash some embedders. Always attach `.catch` to the promise stored on the instance. Verified pattern in research: the constructor wires the catch immediately so there's never a window where the promise is rejected without a handler.

- **Logging tool names in the failure message:** RBAC invariant from CLAUDE.md — error messages MUST NOT leak which tools exist. The failure log shows the error message from the provider, not the tool list. Sample compliant message: `"MCPack: semantic index build failed: <provider error>"`. Sample non-compliant: `"MCPack: failed to embed tools [create_customer, list_payments, ...]"` (NEVER do this).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Background-task orchestration | A custom event-emitter or pub-sub | A bare `Promise<void>` field on the engine | The promise is already an event-emitter (resolve/reject), it integrates with `await`, it composes with `.then`, and it's GC'd when the engine is destroyed. Adding an EventEmitter brings ordering hazards (handlers registered after rejection don't fire) for zero new capability. |
| State machine | Hand-rolled `'idle' \| 'building' \| 'ready' \| 'failed'` enum + transition guards | `isIndexReady(): boolean` derived from `this.semanticIndex !== null` | The four named states aren't observed by any consumer in v1.1 scope. Phase 8 just needs "is the map ready?" — that's a single boolean. Adding the enum invites future "we'd better add a 5th state" creep without proven need. |
| Vector storage | Custom dense-array container with hand-rolled bounds checks | `Float32Array` (built into Node) | Native `TypedArray` is contiguous, fast, GC-friendly, well-documented, and what every cosine-similarity library (including hand-rolled ones) expects. |
| Indexing-string tokenization | Pre-strip stop words, lowercase, camelCase-split before sending to embedder | Pass the original string verbatim | The embedder owns its own tokenizer optimized for the model. Pre-stripping degrades retrieval recall. [CITED: sbert.net "Don't preprocess your text"] |
| Promise vs callback | Callback-based "buildComplete" listener | Native promise + `.catch` | Promises are the standard in async TS/JS. Callback APIs make composition harder and force consumers to track subscription lifetime. |
| Logging surface | Custom logger object with debug levels gated on `MCPACK_DEBUG=1` | Existing `console.warn('MCPack: …')` convention | v1.0 already uses this pattern (`src/wrap.ts:89`, `src/build.ts:70,85`). Adding a new logger creates two divergent surfaces. If structured logging becomes valuable, that's a v1.2+ standalone concern. |
| Test timing | Sleeps + `setTimeout(resolve, N)` in tests | `await engine['indexBuildPromise']` to deterministically await build completion | Sleep-based tests are flaky and slow. The promise-on-instance pattern (Pattern 2) gives exact synchronization. |

**Key insight:** Phase 7 is a recipe for over-engineering if you let it be. The simplest possible implementation — promise + map + boolean — meets every requirement. Every additional abstraction (EventEmitter, state-machine enum, custom logger, retry logic) trades real complexity for hypothetical future flexibility that the v1.1 scope explicitly excludes.

## Runtime State Inventory

> Phase 7 is a greenfield-feature phase, not a rename or migration. Below is the explicit inventory:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 7 introduces the FIRST in-process state of this kind (semantic vectors). No prior persisted vectors exist. The vector index is fully ephemeral, lives on the engine instance, and dies with the process. | None |
| Live service config | None — Phase 7 does not interact with any external service, database, or orchestrator. The build calls a user-provided `EmbeddingProvider` callback in the same process. The MiniLM adapter (provider) downloads model files to its local cache on first use, but that's a Phase 6 / `@huggingface/transformers` concern not affected by Phase 7. | None |
| OS-registered state | None — no Task Scheduler / launchd / pm2 / systemd registrations at all in MCPack (verified by reading PROJECT.md + CLAUDE.md "Hosting" — library only, no daemon). | None |
| Secrets / env vars | None added by Phase 7. The library has zero required env vars at runtime; the harness uses `STRIPE_SECRET_KEY` (unchanged); the adapter optionally reads no env vars at runtime (model path is cache-only). The discretion item to add `MCPACK_DEBUG=1` for build state logging is **rejected by this research** in favor of the existing `console.warn` convention — so no new env var. | None |
| Build artifacts / installed packages | Phase 7 does not change `package.json` — no new deps installed. Phase 7 does change `src/core.ts`, so `dist/core.js` and `dist/core.d.ts` will reflect the new private members in the next `npm run build`. The `.d.ts` shows them as `private` (TypeScript emits private members in declaration files unless `--stripInternal` is set, which it isn't here). [VERIFIED: tsconfig.json — no `stripInternal: true`] **This is fine for Gate 2** because Gate 2's grep checks `^export` lines in `dist/index.d.ts`, and `MCPackEngine` is not exported from `src/index.ts` (Phase 02 DEC). The new private members are internal-only. | None — but verify Gate 2 grep does what it claims (see Validation Architecture). |

**Nothing found in any category** — the phase is confined to in-process engine state.

## Common Pitfalls

### Pitfall 1: Awaiting the build inside the constructor

**What goes wrong:** TypeScript permits `async` constructors only as a syntax trick (returning a promise from a class constructor breaks `instanceof`). Anyone trying to `await` the build inside the constructor body will end up needing a separate async `init()` method that callers must await — which changes `mcpack()` and `createMCPackServer()` signatures, failing REQ-v11-public-api-lock and REQ-v11-tools-list-no-regression.

**Why it happens:** The naive read of "build at startup" is "block until built." Researcher trap.

**How to avoid:** Pattern 1 is locked. Constructor returns synchronously; build runs in detached promise.

**Warning signs:** Any task spec that adds `await` next to `new MCPackEngine(...)` or that introduces an `init()` / `start()` method on the engine. Reject in plan-checker.

### Pitfall 2: `unhandledRejection` from missing `.catch`

**What goes wrong:** The build promise rejects (network error during MiniLM model download, or the user-provided provider throws). The rejection has no handler. Node emits `unhandledRejection`. In some Node configurations this terminates the process — which would crash the MCP gateway, exactly the failure mode CONTEXT explicitly forbids ("MCP server stays up — semantic-search degradation is preferable to gateway crash").

**Why it happens:** Easy to forget the `.catch` when the build kickoff is far from the build implementation.

**How to avoid:** Attach `.catch` synchronously, in the same statement that creates the promise:
```typescript
this.indexBuildPromise = this.buildSemanticIndex(tools, provider).catch((err) => {
  /* log + leave failed */
});
```
Never separate the kickoff from the catch.

**Warning signs:** Any task spec that creates a build promise without a `.catch` in the same statement.

### Pitfall 3: Race condition — query arrives during build

**What goes wrong:** A `search_tools` call lands while `buildSemanticIndex` is mid-flight. The query handler reads `this.semanticIndex` and gets `null`. If the handler's logic is "if null, fall back to keyword" (Phase 7's contract) — fine, this is the right behavior. But if a future Phase 8 implementor reads "the build is in progress, I'll wait for it" — they'll add `await this.indexBuildPromise` to the query path, blowing out the 50ms p99 budget.

**Why it happens:** "Wait until ready" feels like the polite thing to do. It's wrong here.

**How to avoid:** Phase 7's contract is firm: `isIndexReady()` returning `false` means fall back to keyword *immediately*, never wait. Document this in the JSDoc on `isIndexReady`. Also call it out in Phase 7's plan acceptance text so Phase 8's implementors see it as locked.

**Warning signs:** Any Phase 8 plan task that contains `await this.indexBuildPromise` inside the query path. Reject in plan-checker.

### Pitfall 4: Plain `number[]` arrays vs `Float32Array`

**What goes wrong:** The provider returns `number[][]` per its contract. If you store the inner arrays as-is (`Map<string, number[]>`), you get V8's HOLEY_DOUBLE_ARRAY representation: each entry is a 64-bit float boxed in a heap object. For 50 tools × 384 dims that's roughly 50 × 384 × 8 = 153 KB plus per-entry overhead — close to but not exceeding the 2 MB budget. Phase 7 still passes. But Phase 8's cosine similarity will run twice as slow (more cache misses) and a future 500-tool server (10× larger surface) blows the budget.

**Why it happens:** The provider returns `number[][]` so it feels natural to keep that shape.

**How to avoid:** Wrap each `number[]` in `new Float32Array(numbers)` at index-assembly time. The construction cost is amortized — Float32Array's typed-array constructor is a vectorized copy, sub-millisecond for 50 × 384.

**Warning signs:** `Map<string, number[]>` in any plan task spec. Should be `Map<string, Float32Array>`.

### Pitfall 5: Constructor mutation of `tools` argument

**What goes wrong:** The constructor receives `tools: Tool[]` by reference. If the build path sorts or filters this array in place (`tools.sort(...)`), the keyword index and the consumer's original array are both mutated.

**Why it happens:** The engine reads `tools` twice now (once for `buildIndex` in `index-builder.ts`, once for the semantic build). It's tempting to "preprocess" `tools` once for both consumers.

**How to avoid:** Treat `tools` as read-only. If you need a sorted copy, `[...tools].sort(...)`. The semantic build only needs to *read* tool names, descriptions, and inputSchema properties — no mutation needed.

**Warning signs:** Any in-place array operation on `tools` in `core.ts`. Reject in plan-checker.

### Pitfall 6: Phase 7 tests changing `test/core.test.ts`

**What goes wrong:** The phase-gate regression check requires `test/core.test.ts` to be byte-identical to its post-Phase-6 baseline. If a developer adds Phase 7 tests by extending `test/core.test.ts`, the byte-diff fails; if the change is just "add new tests at end of file," the diff is non-empty even though no v1.0 behavior is changing. Phase 7's regression gate is more conservative than that — it cares about the file content being unchanged, not just the existing tests still passing.

**Why it happens:** "Add tests next to the thing they test" is a reasonable instinct.

**How to avoid:** Phase 7's tests live in a NEW file, `test/semantic-index-build.test.ts`. Mirrors Phase 6's `test/types.test.ts` precedent.

**Warning signs:** Any task spec adding `it(...)` blocks inside `test/core.test.ts`. Reject in plan-checker.

### Pitfall 7: Unbounded warning spam on every fallback

**What goes wrong:** If the index never becomes ready (build failed) and the gateway receives a query every second, the `console.warn('MCPack: semantic index not yet ready, falling back to keyword')` fires every second forever. In production this fills logs.

**Why it happens:** Naive "log on every fallback" is the simplest implementation.

**How to avoid:** Two options the planner can pick from:
1. **Log once on transition to "failed":** the `.catch` handler in the constructor logs once when the build first fails. Subsequent fallbacks are silent. Pro: bounded log volume. Con: operators monitoring for "is fallback active" only see the message at startup; intermediate-build-pending fallbacks are silent.
2. **Log once per fallback path with a `private hasWarnedFallback = false` flag:** flip the flag the first time `isIndexReady()` returns false in the query path; never warn again. Same boundedness, slightly different timing.

**Recommendation:** Option 1 (log once on `.catch`). It's the simpler implementation and the failure path is the operationally interesting one. Phase 7 doesn't need a per-query warning when the build is *still pending* — that case resolves itself once the build finishes.

**Warning signs:** Any task spec that calls `console.warn` on every query that misses the ready check. Should fire only on transition to failed (Option 1) or use a one-shot flag (Option 2).

## Code Examples

Verified patterns derived from `src/core.ts` (read in full), `src/index-builder.ts`, `test/types.test.ts`, and CONTEXT §"Engine state sketch":

### Engine constructor with detached build (full skeleton)

```typescript
// Source: derived from src/core.ts:35-58 (existing constructor) + Pattern 1 + Pattern 2
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type {
  MCPackConfig,
  EmbeddingProvider,
  ToolIndexEntry,
  // ... existing imports unchanged
} from './types.js';
import { buildIndex } from './index-builder.js';

export class MCPackEngine {
  // ─── Existing v1.0 + Phase 6 fields (UNCHANGED) ───────────────────────────
  private readonly config: MCPackConfig;
  private readonly index: ToolIndexEntry[];
  private readonly sessions: SessionRegistry;
  private readonly searchToolDefinition: Tool;

  // ─── NEW Phase 7 fields ──────────────────────────────────────────────────
  /** Vector store keyed by tool name. `null` until the build completes successfully. */
  private semanticIndex: Map<string, Float32Array> | null = null;
  /** Promise tracking the in-flight build. `undefined` if `embeddings` was not configured. */
  private indexBuildPromise: Promise<void> | undefined = undefined;

  constructor(tools: Tool[], config: MCPackConfig) {
    // ─── Existing v1.0 setup (UNCHANGED) ────────────────────────────────────
    this.config = config;
    this.index = buildIndex(tools);
    this.sessions = new SessionRegistry(config.session);
    this.searchToolDefinition = {
      name: 'search_tools',
      description: '...',  // existing string preserved verbatim
      inputSchema: { /* existing shape preserved verbatim */ },
    };

    // ─── NEW Phase 7 build kickoff ──────────────────────────────────────────
    if (config.embeddings) {
      this.indexBuildPromise = this.buildSemanticIndex(
        tools,
        config.embeddings.provider,
      ).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`MCPack: semantic index build failed: ${message}`);
        // semanticIndex remains null; isIndexReady() returns false; queries
        // fall back to v1.0 keyword path automatically.
      });
    }
  }

  /**
   * Returns true when the semantic index is fully built and ready for use.
   * Returns false when:
   *   - `embeddings` was not configured (no build kicked off)
   *   - the build is still in progress
   *   - the build failed (logged at `.catch` site)
   *
   * Phase 8's hybrid query path SHOULD route to v1.0 keyword scoring when
   * this returns false. The query path MUST NOT await the build — that
   * violates REQ-v11-perf-budget (50ms p99) and REQ-v11-tools-list-no-regression.
   */
  isIndexReady(): boolean {
    return this.semanticIndex !== null;
  }

  // ─── NEW Phase 7 private build orchestrator ────────────────────────────
  private async buildSemanticIndex(
    tools: Tool[],
    provider: EmbeddingProvider,
  ): Promise<void> {
    if (tools.length === 0) {
      this.semanticIndex = new Map();
      return;
    }

    const indexingStrings = tools.map((t) => buildIndexingString(t));
    const vectors = await provider(indexingStrings);

    if (vectors.length !== tools.length) {
      throw new Error(
        `MCPack: provider returned ${vectors.length} vectors for ${tools.length} tools (parallel-array contract violation)`,
      );
    }

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

    this.semanticIndex = new Map(
      tools.map((t, i) => [t.name, new Float32Array(vectors[i]!)]),
    );
  }

  // ─── Existing v1.0 + Phase 6 methods (UNCHANGED) ───────────────────────
  handleToolsList(): { tools: Tool[] } { /* unchanged */ }
  handleSearchTools(...): ToolCallResult { /* unchanged in Phase 7; Phase 8 territory */ }
  destroy(): void { /* unchanged */ }
  stats(): { sessions: number; tools: number } { /* unchanged */ }
  markToolLoaded(...): void { /* unchanged */ }
}

// ─── Module-private helper (NEW Phase 7) ──────────────────────────────────
function buildIndexingString(tool: Tool): string {
  const description = tool.description ?? '';
  const paramNames = extractParameterNames(tool.inputSchema);
  return `${tool.name} ${description} ${paramNames.join(' ')}`.trim();
}

function extractParameterNames(inputSchema: Tool['inputSchema']): string[] {
  if (!inputSchema || !('properties' in inputSchema) || !inputSchema.properties) {
    return [];
  }
  return Object.keys(inputSchema.properties);
}
```

### Phase 7 test pattern (new file, mirrors Phase 6 convention)

```typescript
// File: test/semantic-index-build.test.ts (NEW)
// Source: pattern mirrors test/types.test.ts:1-35 + test/core.test.ts:1-30 setup style
import { describe, it, expect, afterEach } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { MCPackEngine } from '../src/core.js';
import type { EmbeddingProvider, MCPackConfig } from '../src/index.js';

function makeTool(
  name: string,
  description: string,
  properties?: Record<string, object>,
): Tool {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties: properties ?? {} },
  };
}

// Deterministic mock provider — 8-dim vectors derived from string hash.
// Fast (synchronous body wrapped in async), offline, reproducible.
const mockProvider: EmbeddingProvider = async (texts) =>
  texts.map((t) => {
    let hash = 0;
    for (let i = 0; i < t.length; i++) hash = (hash * 31 + t.charCodeAt(i)) | 0;
    return Array.from({ length: 8 }, (_, i) => ((hash + i * 17) % 1000) / 1000);
  });

describe('MCPackEngine — semantic index build', () => {
  let engine: MCPackEngine;
  afterEach(() => engine?.destroy());

  describe('build kickoff', () => {
    it('does not kick off a build when embeddings is absent', async () => {
      engine = new MCPackEngine([makeTool('a', 'd')], {});
      // No build promise → no chance for ready
      expect(engine.isIndexReady()).toBe(false);
      // Fast-forward microtasks just to be sure
      await Promise.resolve();
      expect(engine.isIndexReady()).toBe(false);
    });

    it('kicks off a build when embeddings.provider is set', async () => {
      engine = new MCPackEngine([makeTool('a', 'd')], {
        embeddings: { provider: mockProvider },
      });
      // Constructor returned synchronously; build is in flight.
      // Wait deterministically for completion via the private promise field.
      await (engine as any).indexBuildPromise;
      expect(engine.isIndexReady()).toBe(true);
    });

    it('handles empty tool surface as a no-op', async () => {
      // Both entry points throw on empty tools; engine direct construction
      // permits it (defense-in-depth path).
      engine = new MCPackEngine([], {
        embeddings: { provider: mockProvider },
      });
      await (engine as any).indexBuildPromise;
      expect(engine.isIndexReady()).toBe(true);
      const map = (engine as any).semanticIndex as Map<string, Float32Array>;
      expect(map.size).toBe(0);
    });
  });

  describe('indexing string composition', () => {
    it('passes "name + description + param-names" to the provider in a single batch', async () => {
      const seen: string[] = [];
      const captureProvider: EmbeddingProvider = async (texts) => {
        seen.push(...texts);
        return texts.map(() => [0, 0, 0]);
      };
      const tools = [
        makeTool('create_customer', 'Create a customer', {
          name: { type: 'string' },
          email: { type: 'string' },
        }),
        makeTool('list_payments', 'List payments', {
          customer_id: { type: 'string' },
        }),
      ];
      engine = new MCPackEngine(tools, { embeddings: { provider: captureProvider } });
      await (engine as any).indexBuildPromise;
      expect(seen).toHaveLength(2);  // single batch
      expect(seen[0]).toBe('create_customer Create a customer name email');
      expect(seen[1]).toBe('list_payments List payments customer_id');
    });

    it('handles tools without descriptions or parameters gracefully', async () => {
      const seen: string[] = [];
      const captureProvider: EmbeddingProvider = async (texts) => {
        seen.push(...texts);
        return texts.map(() => [0]);
      };
      const tool: Tool = { name: 'bare_tool', inputSchema: { type: 'object' } };
      engine = new MCPackEngine([tool], { embeddings: { provider: captureProvider } });
      await (engine as any).indexBuildPromise;
      expect(seen[0]).toBe('bare_tool');  // no description, no params, trimmed
    });
  });

  describe('storage shape and dim-consistency', () => {
    it('stores Float32Array vectors keyed by tool name', async () => {
      const tools = [makeTool('a', 'desc'), makeTool('b', 'desc')];
      engine = new MCPackEngine(tools, { embeddings: { provider: mockProvider } });
      await (engine as any).indexBuildPromise;
      const map = (engine as any).semanticIndex as Map<string, Float32Array>;
      expect(map.size).toBe(2);
      expect(map.get('a')).toBeInstanceOf(Float32Array);
      expect(map.get('b')).toBeInstanceOf(Float32Array);
      expect(map.get('a')!.length).toBe(8);  // mock dim
    });

    it('rejects when provider returns inconsistent dims', async () => {
      const badProvider: EmbeddingProvider = async () => [[1, 2, 3], [1, 2]];
      engine = new MCPackEngine([makeTool('a', ''), makeTool('b', '')], {
        embeddings: { provider: badProvider },
      });
      await (engine as any).indexBuildPromise;
      // Build rejected; isIndexReady stays false
      expect(engine.isIndexReady()).toBe(false);
    });

    it('rejects when provider returns wrong vector count', async () => {
      const wrongCountProvider: EmbeddingProvider = async () => [[1]];
      engine = new MCPackEngine([makeTool('a', ''), makeTool('b', '')], {
        embeddings: { provider: wrongCountProvider },
      });
      await (engine as any).indexBuildPromise;
      expect(engine.isIndexReady()).toBe(false);
    });
  });

  describe('non-blocking constructor + tools/list path', () => {
    it('engine constructor returns synchronously even with embeddings configured', () => {
      // Slow provider — would block the constructor if awaited
      const slowProvider: EmbeddingProvider = (texts) =>
        new Promise((resolve) =>
          setTimeout(() => resolve(texts.map(() => [1])), 50),
        );
      const start = Date.now();
      engine = new MCPackEngine([makeTool('a', '')], {
        embeddings: { provider: slowProvider },
      });
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(10);  // sync return; build is detached
      // Build still in flight, but isIndexReady is false.
      expect(engine.isIndexReady()).toBe(false);
    });

    it('handleToolsList() works while build is in flight', async () => {
      const slowProvider: EmbeddingProvider = (texts) =>
        new Promise((resolve) =>
          setTimeout(() => resolve(texts.map(() => [1])), 50),
        );
      engine = new MCPackEngine([makeTool('a', '')], {
        embeddings: { provider: slowProvider },
      });
      const result = engine.handleToolsList();
      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].name).toBe('search_tools');
      // No await on build — proves no async dependency from list path.
    });

    it('handleSearchTools() falls back to keyword scoring when build is in flight', async () => {
      // Slow provider so build hasn't completed when we query
      const slowProvider: EmbeddingProvider = (texts) =>
        new Promise((resolve) =>
          setTimeout(() => resolve(texts.map(() => [1])), 100),
        );
      const tools = [
        makeTool('create_customer', 'Create a new customer'),
        makeTool('list_payments', 'List payment history'),
      ];
      engine = new MCPackEngine(tools, { embeddings: { provider: slowProvider } });
      // Query immediately — build is in flight
      expect(engine.isIndexReady()).toBe(false);
      const result = engine.handleSearchTools({ query: 'customer' }, 'sess-fallback');
      // v1.0 keyword path matched 'create_customer' — proves fallback works
      const response = JSON.parse(result.content[0].text);
      expect(response.tools.map((t: any) => t.name)).toContain('create_customer');
    });
  });

  describe('performance bounds (mock-provider, unit-test-level)', () => {
    it('builds 50-tool index in < 1 second with deterministic mock', async () => {
      const tools = Array.from({ length: 50 }, (_, i) =>
        makeTool(`tool_${i}`, `description ${i}`, { p1: { type: 'string' } }),
      );
      const start = Date.now();
      engine = new MCPackEngine(tools, { embeddings: { provider: mockProvider } });
      await (engine as any).indexBuildPromise;
      const elapsed = Date.now() - start;
      // Mock is sub-ms; 1000ms cap is pure async-orchestration overhead.
      // Real-MiniLM 5s budget is asserted in Phase 10's harness.
      expect(elapsed).toBeLessThan(1000);
      expect((engine as any).semanticIndex.size).toBe(50);
    });

    it('vector storage stays well under 2 MB for 50-tool 384-dim index', async () => {
      const provider384: EmbeddingProvider = async (texts) =>
        texts.map(() => Array.from({ length: 384 }, () => 0.1));
      const tools = Array.from({ length: 50 }, (_, i) =>
        makeTool(`t${i}`, ''),
      );
      engine = new MCPackEngine(tools, { embeddings: { provider: provider384 } });
      await (engine as any).indexBuildPromise;
      const map = (engine as any).semanticIndex as Map<string, Float32Array>;
      // Float32Array dense storage: 50 * 384 * 4 bytes = 76,800 bytes
      let bytes = 0;
      for (const v of map.values()) bytes += v.byteLength;
      expect(bytes).toBe(76_800);
      expect(bytes).toBeLessThan(2 * 1024 * 1024);  // 2 MB ceiling
    });
  });

  describe('regression: byte-identical v1.0 path when embeddings absent', () => {
    it('engine without embeddings makes no provider calls and isIndexReady stays false', async () => {
      let callCount = 0;
      const countingProvider: EmbeddingProvider = async (t) => {
        callCount++;
        return t.map(() => [0]);
      };
      // Constructed WITHOUT embeddings → provider never invoked
      engine = new MCPackEngine([makeTool('a', '')], {});
      await Promise.resolve();
      void countingProvider;  // silence linter
      expect(callCount).toBe(0);
      expect(engine.isIndexReady()).toBe(false);
    });
  });
});
```

### Memory and dimension validation (snippet for Phase 7's perf-budget assertion)

```typescript
// Source: derived from CONTEXT §"Performance Budget" + Float32Array spec
const MAX_BYTES = 2 * 1024 * 1024;  // 2 MB
let totalBytes = 0;
for (const vec of map.values()) totalBytes += vec.byteLength;
expect(totalBytes).toBeLessThanOrEqual(MAX_BYTES);

// Sanity: 50 × 384 × 4 = 76 800 bytes raw vectors, well under 2 MB.
// Map overhead in V8: ~80 bytes per entry → 50 × 80 = 4 000 bytes auxiliary.
// Total ~ 80 800 bytes; budget headroom is 25×.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@xenova/transformers` (legacy package name, frozen v2.17.2 May 2024) | `@huggingface/transformers ^4.0.0` (current name, actively maintained, 4.2.0 latest) | October 2024 (HuggingFace acquisition + rename) | Phase 6 already corrected this via DEC-v11-03 clerical-correction. Phase 7 doesn't touch the dep, but stale references in any inherited PRD text should not propagate to Phase 7 plans. |
| Plain `number[]` for embedding vectors | `Float32Array` for in-memory storage | Industry-wide post-2018 (TensorFlow.js, transformers.js, ONNX Runtime web) | Phase 7 stores `Float32Array` keyed by tool name. The provider returns `number[][]` (the locked contract); the engine converts at index-assembly time. |
| `'idle' \| 'building' \| 'ready' \| 'failed'` enum state machines | Promise lifecycle as the state machine | TypeScript ecosystem standardized 2020+ around promises | Phase 7 uses the promise. The CONTEXT's enum sketch is a planning artifact, not a recommendation. |
| Mid-session index rebuild on `notifications/tools/list_changed` | Build once at startup | OQ3 in v1.1 — deferred to v1.2 | Phase 7 builds once. v1.2 may add notification-driven rebuild. |
| Synchronous embed-on-demand at first query | Async background build kicked at construction | Performance — embed-on-demand blows the p99 latency budget | Phase 7's contract: build at construction, query never waits. |

**Deprecated/outdated:**
- `@xenova/transformers` package name — frozen, replaced by `@huggingface/transformers`.
- The training-era assumption that `number[][]` is the right in-memory format — superseded by `Float32Array`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `Xenova/all-MiniLM-L6-v2`'s tokenizer is case-insensitive (preserves model output across case variations) | Pattern 3, "Casing" sub-bullet | Low — even if the planner forces lowercase as defense, the resulting indexing strings change across keyword/semantic indexes by case only, which is benign. The `do_lower_case: true` setting is documented in the model's tokenizer config; verified by inspection of the model card on huggingface.co. [CITED] |
| A2 | Pre-stripping stop words and applying camelCase splitting before passing to a sentence-embedding model degrades retrieval recall by 5-10% | Pattern 3, "Tokenization" sub-bullet | Medium — if the SBERT advice doesn't apply to MiniLM-L6-v2 specifically, the recommendation to skip pre-tokenization is still safe (passing extra signal to a sentence-aware tokenizer can't hurt; the tokenizer drops what it doesn't need). The 5-10% number is the rough industry estimate from sbert.net documentation. [CITED] |
| A3 | V8's HOLEY_DOUBLE_ARRAY representation for `number[]` of 384 entries occupies ~3 KB per array (vs ~1.5 KB for `Float32Array`) | "Alternatives Considered" table, second row | Low — the practical impact on Phase 7's 2 MB budget is negligible at 50 tools either way. The recommendation to use `Float32Array` stands regardless of the exact byte counts (it's the documented embedding storage format and Phase 8's cosine path will want it). |
| A4 | `.d.ts` emission shows private members but Gate 2's grep on `^export` lines ignores them | Runtime State Inventory, "Build artifacts" row | Low — verified by reading tsconfig.json (no `stripInternal`) + Gate 2's grep pattern in 06-VALIDATION.md (filters by `^export`). Worth re-running Gate 2 after Phase 7's build to confirm. The validation map below adds an explicit task for this. |
| A5 | Node v18+ has `Promise`, `Float32Array`, and `console.warn` in standard library (not gated behind any flag) | Standard Stack table | Negligible — these are all ECMA-262 / WHATWG specifications that have shipped in Node since v10 and earlier. [VERIFIED: Node v24.2 in dev environment] |
| A6 | The post-Phase-6 baseline ref for Gates 1+2+3 is `bec3f6f` per CONTEXT recommendation; planner may also use `acbb9b0` (06-02 close) or `9571d8b` (06-VERIFICATION close) | Validation Architecture, "Three [BLOCKING] Phase Gates" | Low — all three commits have byte-identical `package.json`, `src/index.ts`, and `src/types.ts` with the empty diff for `dependencies` / `peerDependencies` and the additive-only `EmbeddingProvider` export. Recommend `bec3f6f` (last v1.1-Phase-6 commit on main) as the canonical pre-Phase-7 ref because it's the most recent green state. The planner can substitute any of the three; the gate semantics are identical. |
| A7 | Phase 8 will route the query path through a check on `engine.isIndexReady()` (i.e., Phase 8 consumes Phase 7's API) | Architectural Responsibility Map + Pitfall 3 | Medium — this assumption gates whether Phase 7's `isIndexReady()` is the right surface. If Phase 8 chooses a different surface (e.g., a callback or an event), Phase 7's method becomes vestigial. Recommendation: surface this as a planner question — should Phase 7 ship `isIndexReady()` only, or also a more general getter for the index map (so Phase 8 can branch on map content)? Defer the choice to plan-checker; Phase 7 ships at minimum `isIndexReady()`. |

## Open Questions

1. **Should the warning fire once-per-failure or once-per-query?**
   - What we know: CONTEXT permits both; Pitfall 7 documents the tradeoff. Industry convention (e.g., Sentry, AWS SDK retry) leans "log on transition," not "log per attempt."
   - What's unclear: whether operators monitoring "is fallback active" prefer a heartbeat warning (so they see the system is degraded) or a transition warning (so logs aren't spammed).
   - Recommendation: fire once on `.catch` (the build-failed path). Skip per-query warnings entirely. Operators who need a heartbeat can add a Phase 9 analytics event later.

2. **Should the indexing-string helper live in `src/core.ts` or a new `src/semantic-index-builder.ts`?**
   - What we know: both are valid; the file split changes nothing semantically.
   - What's unclear: stylistic preference. The repo convention (read across `src/index-builder.ts`, `src/search.ts`, `src/session.ts`, `src/roles.ts`) is one-concept-per-file with a clear name.
   - Recommendation: separate file `src/semantic-index-builder.ts` with two pure exports (`buildIndexingString`, `buildSemanticIndex`). Keeps `src/core.ts` slim and the helpers unit-testable in isolation. But this is Claude's discretion per CONTEXT — both shapes pass gates.

3. **Should `isIndexReady()` be the only readiness surface, or should there be a sibling `getSemanticIndex(): Map<string, Float32Array> | null`?**
   - What we know: Phase 8 will need access to the map to compute cosine similarities. If it doesn't get a getter, it'll need to bracket-access the private field (`engine['semanticIndex']`) — which TypeScript permits but is ugly.
   - What's unclear: whether Phase 7 should pre-emptively expose the getter (and whether that getter is internal-only or test-visible).
   - Recommendation: add `private getSemanticIndexInternal()` returning the map (for Phase 8's consumption from inside the same engine class). Don't add a public getter — there are no consumers. If Phase 8 chooses to put the cosine logic in `src/search.ts` (a separate module), it needs a different ergonomic. Defer to Phase 8 plan-checker.

4. **Phase 7's tests — sibling file `test/semantic-index-build.test.ts` or extension of `test/core.test.ts`?**
   - What we know: extending `test/core.test.ts` would fail Pitfall 6 (regression-gate byte-identity).
   - What's unclear: nothing — sibling file is the correct call.
   - Recommendation: NEW file `test/semantic-index-build.test.ts`. Mirrors Phase 6's `test/types.test.ts` precedent.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All Phase 7 work | ✓ | v24.2.0 | — |
| TypeScript | typecheck + build | ✓ | ~5.8.3 (devDep, locked) | — |
| Vitest | tests | ✓ | ^4.1.0 (devDep, locked, registry at 4.1.5) | — |
| `@vitest/coverage-v8` | coverage gate | ✓ | ^4.1.0 (devDep, locked) | — |
| `@modelcontextprotocol/sdk` | `Tool` type for `inputSchema.properties` reading | ✓ | ^1.0.0 peer + ^1.27.1 dev (registry at 1.29.0) | — |
| `@huggingface/transformers` | NOT used by Phase 7 (engine consumes the abstract type) | ✓ (in adapter package only) | ^4.0.0 (locked Phase 6) | Confined to `packages/mcpack-embeddings/` — Gate 3 enforces zero leak into core |
| `@llvs/mcpack-embeddings` | NOT used by Phase 7 tests (mock provider only) | ✓ (npm-linked locally) | 1.1.0 (workspace) | Phase 7 tests use inline mock providers, never import the adapter |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None.

Phase 7 introduces **zero** new dependencies. All work uses the existing toolchain.

## Validation Architecture

> Per `.planning/config.json` workflow.nyquist_validation = true, this section is included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `vitest@^4.1.0` (carry-forward from v1.0 + Phase 6) |
| Config file | None — relies on vitest defaults (matches Phase 6 convention) |
| Quick run command | `npm test` |
| Full suite command | `npm test && npm run test:coverage` |
| Per-task feedback | `npm run typecheck && npm test -- semantic-index-build.test.ts` (~3-5s) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-v11-semantic-index-build | When `embeddings` is configured, build kicks off at construction with single-batch provider call | unit | `npm test -- semantic-index-build.test.ts -t "kicks off a build"` | ❌ Wave 0 — `test/semantic-index-build.test.ts` |
| REQ-v11-semantic-index-build | Indexing string is `name + " " + description + " " + paramNames.join(" ")` (single batch) | unit | `npm test -- semantic-index-build.test.ts -t "passes \"name + description + param-names\""` | ❌ Wave 0 |
| REQ-v11-semantic-index-build | Vectors stored as `Map<string, Float32Array>` keyed by tool name | unit | `npm test -- semantic-index-build.test.ts -t "stores Float32Array vectors keyed by tool name"` | ❌ Wave 0 |
| REQ-v11-semantic-index-build | Empty tool surface is a no-op (empty map, isIndexReady true) | unit | `npm test -- semantic-index-build.test.ts -t "handles empty tool surface"` | ❌ Wave 0 |
| REQ-v11-semantic-index-build | Inconsistent vector dims rejected; build stays "failed" | unit | `npm test -- semantic-index-build.test.ts -t "rejects when provider returns inconsistent dims"` | ❌ Wave 0 |
| REQ-v11-semantic-index-build | Wrong vector count rejected | unit | `npm test -- semantic-index-build.test.ts -t "rejects when provider returns wrong vector count"` | ❌ Wave 0 |
| REQ-v11-tools-list-no-regression | `MCPackEngine` constructor returns synchronously even when embeddings configured | unit (timing assertion) | `npm test -- semantic-index-build.test.ts -t "constructor returns synchronously"` | ❌ Wave 0 |
| REQ-v11-tools-list-no-regression | `handleToolsList()` works while build is in flight (no async dependency) | unit | `npm test -- semantic-index-build.test.ts -t "handleToolsList\\(\\) works while build is in flight"` | ❌ Wave 0 |
| REQ-v11-tools-list-no-regression | Queries during build-pending state fall back to v1.0 keyword scoring | unit | `npm test -- semantic-index-build.test.ts -t "falls back to keyword scoring when build is in flight"` | ❌ Wave 0 |
| REQ-v11-tools-list-no-regression | Engine without `embeddings` configured makes zero provider calls | unit (regression) | `npm test -- semantic-index-build.test.ts -t "makes no provider calls"` | ❌ Wave 0 |
| REQ-v11-tools-list-no-regression | All 107 v1.0 + Phase 6 tests still pass byte-identically | regression | `npm test` exits 0 with 107+ tests passing; `test/core.test.ts`, `test/wrap.test.ts`, etc. unchanged | ✅ existing |
| REQ-v11-perf-budget | 50-tool mock build completes in < 1s (mock provider; real MiniLM 5s validated in Phase 10 harness) | unit | `npm test -- semantic-index-build.test.ts -t "builds 50-tool index in < 1 second"` | ❌ Wave 0 |
| REQ-v11-perf-budget | 50-tool 384-dim vector storage ≤ 2 MB | unit (memory bound) | `npm test -- semantic-index-build.test.ts -t "vector storage stays well under 2 MB"` | ❌ Wave 0 |
| REQ-v11-perf-budget | (deferred) Real-MiniLM 50-tool build ≤ 5s on commodity hardware | integration | Phase 10 harness assertion — NOT Phase 7 scope | ❌ Phase 10 |
| (cross) | Coverage stays ≥ 99% statement | regression | `npm run test:coverage` reports stmts ≥ 99% | ✅ existing |
| (cross) | Typecheck passes (no new errors from Phase 7 code) | static | `npm run typecheck` exits 0 | ✅ existing |
| (cross) | Build emits ESM-only (no `.cjs`) | static | `npm run build && (! ls dist/*.cjs 2>/dev/null)` | ✅ existing |

### Sampling Rate
- **Per task commit:** `npm run typecheck && npm test -- semantic-index-build.test.ts` (~3-5s feedback latency)
- **Per wave merge:** `npm run typecheck && npm run build && npm test && npm run test:coverage` (~10-15s)
- **Phase gate:** Full suite green (`npm test`), three [BLOCKING] gates run, regression gate (all v1.0 + Phase 6 test files byte-identical), coverage ≥ 99%

### Three [BLOCKING] Phase Gates (carry-forward from Phase 6)

Baseline ref: `bec3f6f` (post-Phase-6 close — last green state on main before Phase 7 begins). The planner may substitute `acbb9b0` or `9571d8b` (per Assumption A6); semantics identical.

#### Gate 1 — Zero new core deps
```bash
diff <(jq -S '{deps:(.dependencies // {}), peers:.peerDependencies}' package.json) \
     <(git show bec3f6f:package.json | jq -S '{deps:(.dependencies // {}), peers:.peerDependencies}')
```
Must produce empty diff. Phase 7 introduces zero new dependencies; this gate should pass trivially.

#### Gate 2 — Public-API additive-only
```bash
npm run build  # emits dist/index.d.ts
diff <(grep -E "^export" dist/index.d.ts | sort) \
     <(git show bec3f6f:dist/index.d.ts | grep -E "^export" | sort)
```
Must produce empty diff (zero new public exports in Phase 7). The new private members on `MCPackEngine` do NOT show up in `dist/index.d.ts` because `MCPackEngine` itself is not exported from `src/index.ts` (Phase 02 DEC).

**Caveat — verify before relying:** the gate as written in 06-VALIDATION.md greps `^export` lines in `dist/index.d.ts`. The planner should run this once during Wave 0 to confirm `MCPackEngine`-class members really don't surface there. If they do, a stricter check is needed (e.g., `tsc --emitDeclarationOnly` + diff the full file). Pre-research expectation: the gate passes empty because `dist/index.d.ts` is generated from `src/index.ts` only and re-exports types; classes from `core.ts` are not re-exported.

#### Gate 3 — Adapter isolation
```bash
! grep -rE "@llvs/mcpack-embeddings|@huggingface/transformers|@xenova/transformers" src/ test/
```
Must return zero matches. Phase 7's tests use inline mock providers and Phase 7's engine code consumes only the abstract `EmbeddingProvider` type from `./types.js`.

**Caveat — JSDoc reference temptation:** Phase 6 had to rewrite a JSDoc comment to avoid the literal `@llvs/mcpack-embeddings` string (06-01-SUMMARY §"Deviations from Plan"). Phase 7's new code should follow the same convention: any JSDoc on the new methods that wants to reference the adapter package should say "the sibling adapter package" instead of the literal name. Lock this in plan task instructions.

### Wave 0 Gaps
- [ ] `test/semantic-index-build.test.ts` — covers all REQ-v11-semantic-index-build, REQ-v11-tools-list-no-regression (semantic side), REQ-v11-perf-budget (mock-level)
- [ ] (Optional, planner discretion) `src/semantic-index-builder.ts` — if the planner chooses to split helpers out of `src/core.ts` per Open Question 2

**Framework install:** none — vitest already installed; no new deps.

**Existing infrastructure that Phase 7 reuses:**
- `test/core.test.ts` test-fixture pattern (`makeTool` helper) — Phase 7 mirrors this in the new file rather than importing (test files don't share helpers in v1.0; each is self-contained).
- `test/types.test.ts` mock-provider pattern (`const mock: EmbeddingProvider = async (texts) => texts.map(...)`) — Phase 7 reuses verbatim.

### Manual-Only Verifications

None expected. All Phase 7 acceptance criteria are programmatically verifiable via the test map above.

The PRD-level "real-MiniLM 5s build on commodity hardware" assertion is automated in Phase 10's harness — NOT a manual check.

## Security Domain

> Per project security posture (CLAUDE.md "Quality Gates" #5: "no leaking of restricted tools' existence via error messages (RBAC invariant)"), this section flags the relevant ASVS categories. The phase has minimal security surface — primarily input validation and information disclosure.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | — (no auth surface in Phase 7; transport-layer auth is v1.2) |
| V3 Session Management | no | — (Phase 7 doesn't touch SessionRegistry) |
| V4 Access Control | YES (carry-forward) | RBAC invariant — failure-path log MUST NOT enumerate tool names. Use `console.warn('MCPack: semantic index build failed: <message>')` with NO tool list. |
| V5 Input Validation | YES | Validate provider's `vectors.length` matches `tools.length`; validate dimension consistency across the batch. Reject (cause build to fail) on contract violation. |
| V6 Cryptography | no | — (no crypto in Phase 7) |
| V7 Error Handling | YES | Catch all errors from `provider(strings)` in the build promise's `.catch`. Never let the rejection propagate to `unhandledRejection`. The error message logged MUST come from the error itself, not include tool names or internal state. |
| V8 Data Protection | YES (light) | Vectors are derived from tool names + descriptions + parameter names — public information already in `tools/list`. No new sensitive data introduced. In-memory storage means no leak surface; vectors die with the process per DEC-v11-09. |
| V9 Communications | no | — (no network in Phase 7; provider is a callback) |
| V10 Malicious Code | no | — (Phase 7 doesn't load or execute external code) |
| V11 Configuration | no | — (no config files added) |
| V12 File Handling | no | — (no file I/O) |
| V13 API and Web Service | YES (carry-forward) | `tools/list` invariant: returns single `search_tools` regardless of build state. The async build cannot affect this. |
| V14 Secure Configuration | no | — |

### Known Threat Patterns for Phase 7

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Information disclosure via failure-mode logging | Information Disclosure | Failure log uses provider's error message (text-only), never enumerates tools. Validated by inspecting the implementation's `console.warn` call site — should match `\`MCPack: semantic index build failed: ${message}\`` exactly. |
| Denial of service via slow / hanging provider | Denial of Service | Build is detached; a hanging build leaves `isIndexReady()` returning false forever, causing all queries to fall back to keyword. Gateway stays up. No timeout logic added (Pitfall 3 anti-pattern). |
| Denial of service via malicious provider returning oversized vectors (e.g., 10⁹-dim) | Denial of Service | Phase 7 reads dim from `vectors[0].length`. If a malicious adapter returns 10⁹-dim vectors, `Float32Array(10⁹)` would attempt 4 GB allocation and throw RangeError on most platforms. The error is caught by the promise's `.catch` and the build fails gracefully. **Recommendation:** add a sanity ceiling (e.g., reject dim > 4096) as defensive validation. Phase 7 plan-checker should decide. |
| Tampering with the vector store post-build | Tampering | The `semanticIndex` field is `private`. External callers can't touch it. Internal callers (the engine itself, Phase 8's planned consumer) treat it as read-only by convention. No mitigation needed beyond the existing TypeScript `private` access modifier. |
| Repudiation: gateway crashes silently after build failure, no audit trail | Repudiation | Failure logged via `console.warn`. Operators see the failure in their log stream. Phase 9 (analytics) will add structured event capture; Phase 7 inherits the log-only baseline. |
| Spoofing: someone calls a private engine method to inject vectors | Spoofing | TypeScript `private` is compile-time only; bracket access at runtime would work. But the engine instance is not exposed to MCP clients (only the SDK Server is). The only way to reach engine privates is via in-process code, which is the operator's own code. Out of threat model. |

**Summary:** The phase's only meaningful threat is information disclosure via the failure log. Locked mitigation: log message uses the provider's error text only, never tool names.

## Sources

### Primary (HIGH confidence)
- `/Users/zaid/Projects/MCPack/src/core.ts` — `MCPackEngine` constructor signature, field structure, `handleSearchTools` body, `destroy`/`stats`/`markToolLoaded` methods. **Read in full during research.** Phase 7's primary work lands here.
- `/Users/zaid/Projects/MCPack/src/wrap.ts` — confirmed wrap-mode resolves `tools: Tool[]` synchronously before `new MCPackEngine(tools, config)` (lines 62-82). Closes the orchestrator's "wrap-mode tool discovery timing" landmine.
- `/Users/zaid/Projects/MCPack/src/build.ts` — confirmed build-mode passes `config.tools` directly to engine after `handler` field stripping (lines 93-94). Both modes hand engine a fully resolved Tool[] at construction.
- `/Users/zaid/Projects/MCPack/src/index-builder.ts` — `extractSchemaKeywords` pattern at lines 48-59 reused (logically) by Phase 7's `extractParameterNames` helper.
- `/Users/zaid/Projects/MCPack/src/types.ts` — `EmbeddingProvider` type + `MCPackConfig.embeddings` field already in place per Phase 6.
- `/Users/zaid/Projects/MCPack/src/index.ts` — verified Phase 7 introduces no new public exports (engine stays internal).
- `/Users/zaid/Projects/MCPack/test/types.test.ts` — Phase 6 mock-provider test pattern; Phase 7 mirrors it.
- `/Users/zaid/Projects/MCPack/test/core.test.ts` — existing engine unit tests; Phase 7 tests live in a sibling file to keep this byte-identical.
- `/Users/zaid/Projects/MCPack/.planning/phases/06-embeddingprovider-interface-adapter-scaffold-v1-1/06-01-SUMMARY.md` + `06-02-SUMMARY.md` + `06-VERIFICATION.md` — Phase 6 lessons learned (JSDoc rewrite for adapter-isolation gate, npm link workaround, test count baseline).
- `/Users/zaid/Projects/MCPack/.planning/phases/07-semantic-index-build-pipeline-v1-1/07-CONTEXT.md` — locked decisions, performance budgets, engine-state sketch.
- `/Users/zaid/Projects/MCPack/CLAUDE.md` — project constraints (stack, commit format, security invariants).
- `/Users/zaid/Projects/MCPack/PLAYBOOK.md` — quality gates, sprint log.
- `/Users/zaid/Projects/MCPack/package.json` + `tsconfig.json` — verified version locks and TS strict + verbatimModuleSyntax + NodeNext.

### Secondary (MEDIUM confidence — verified against npm registry / official docs)
- `npm view vitest version` → `4.1.5` (within `^4.1.0` lock — current).
- `npm view typescript version` → `6.0.3` (project pins `~5.8.3` intentionally; current enough).
- `npm view @modelcontextprotocol/sdk version` → `1.29.0` (within `^1.0.0` peer + `^1.27.1` dev locks).
- `npm view @huggingface/transformers version` → `4.2.0` (Phase 6 locked `^4.0.0`; current).
- HuggingFace transformers.js `Xenova/all-MiniLM-L6-v2` model card — tokenizer config has `do_lower_case: true` → MiniLM tokenizer is case-insensitive [CITED: huggingface.co/Xenova/all-MiniLM-L6-v2/blob/main/tokenizer_config.json].
- sbert.net documentation — "Don't preprocess your text" guidance for sentence-embedding inputs; pre-stripping stop words degrades retrieval recall [CITED: sbert.net/docs/usage/computing_embeddings.html].

### Tertiary (LOW confidence — flagged in Assumptions Log)
- A2: 5-10% retrieval recall degradation from aggressive pre-tokenization is the rough industry estimate; exact number is workload-dependent. Mitigation: recommendation stands regardless of exact figure.
- A3: V8 HOLEY_DOUBLE_ARRAY exact byte cost is engine-version-dependent. Mitigation: Phase 7's 2 MB budget passes either way.

## Metadata

**Confidence breakdown:**
- Engine state design: **HIGH** — verified by reading `src/core.ts` end-to-end; the proposed surface (3 new private fields + 1 public method + 1 private orchestrator + 2 module-private helpers) is the minimal change that satisfies all locked decisions.
- Test patterns: **HIGH** — Phase 6 test patterns directly applicable; mock provider is a one-liner; performance assertions are simple `Date.now()`-deltas with generous mock budgets.
- Three [BLOCKING] gates: **HIGH** — Phase 6 verified all three; Phase 7 should pass trivially because it adds zero deps, zero public exports, and zero adapter references.
- Performance budget at unit-test level: **HIGH** — mock provider returns in <1ms; the 1s mock budget is 1000× headroom for orchestration overhead.
- Real-MiniLM 5s budget: **DEFERRED to Phase 10** — explicitly out of scope per landmine #6.
- JSDoc adapter-isolation pattern: **HIGH** — Phase 6 surfaced this as a deviation; Phase 7 plan tasks should cite Phase 6's resolution to prevent recurrence.

**Research date:** 2026-04-26
**Valid until:** 2026-05-26 (30 days; project is fast-moving on v1.1 phases but the engine surface is stable and dependencies are locked)
