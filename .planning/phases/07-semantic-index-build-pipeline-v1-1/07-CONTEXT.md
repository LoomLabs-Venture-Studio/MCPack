# Phase 7: Semantic Index Build Pipeline (v1.1) — Context

**Gathered:** 2026-04-26
**Status:** Ready for planning
**Source:** Synthesized from PRD ingest (`.planning/intel/`) + Phase 6 delivered foundation
**Milestone:** v1.1 — Search & Observability
**Depends on:** Phase 6 (shipped 2026-04-26 — EmbeddingProvider type + adapter scaffold)

<domain>
## Phase Boundary

Phase 7 adds the **runtime mechanism** that turns the Phase 6 type contract into actual work: when an operator configures `MCPackConfig.embeddings.provider`, MCPack's engine builds a semantic index at startup by:

1. For every tool the wrapped/built server exposes, concatenating `name + description + parameter names` into a single indexing string.
2. Passing the entire batch of indexing strings to the configured `EmbeddingProvider` in **one call**.
3. Storing the resulting vectors in-memory, keyed by tool name.

The build runs **async, non-blocking**: `tools/list` MUST keep returning the single `search_tools` tool with no v1.1-added latency. If a query arrives before the index is ready, search **falls back to keyword scoring** and logs a warning — never blocks.

What Phase 7 does NOT do:
- No semantic *query* path (Phase 8 — embed the query, cosine similarity, hybrid scoring)
- No analytics (Phase 9)
- No publishing / harness regression / 50-query benchmark (Phase 10)

Phase 7 is **build-side only** — given the right config, vectors land in memory. Consumption is Phase 8.

</domain>

<decisions>
## Implementation Decisions (LOCKED — from board-approved PRD ingest + Phase 6 delivery)

### Indexing String Composition (REQ-v11-semantic-index-build)
- **Per-tool indexing string format:** concatenate `tool.name + " " + tool.description + " " + parameter-names-joined-by-space`. The exact separator is `<space>` (single space). No additional weighting at this stage — that's Phase 8's hybrid-scoring concern.
- **Parameter names** come from each tool's `inputSchema.properties` keys (matches the v1.0 keyword-extraction pattern in `src/index-builder.ts` — see Phase 1 SUMMARY for the precedent).
- **Single batch call** to `EmbeddingProvider`: pass an array of N indexing strings (one per tool), expect an array of N vectors back. The `EmbeddingProvider` type contract (DEC-v11-01, locked Phase 6) guarantees parallel-array semantics.
- **Empty tool surface:** if the wrapped server has zero tools, the build is a no-op. No error, no warning — just an empty vector map. Edge case but worth handling.

### Build Lifecycle (REQ-v11-tools-list-no-regression)
- **Build runs at engine startup**, not at first query. Specifically: when `MCPackEngine` is constructed and `embeddings` is configured in the config, kick off the build immediately and store a `Promise<VectorIndex>` (or equivalent) on the engine instance.
- **`tools/list` MUST NOT await the index build.** It returns the single `search_tools` tool with v1.0 latency. The build runs in the background.
- **`search_tools` queries arriving before the index is ready** fall back to v1.0 keyword scoring AND log a warning. Implementation: check if the index promise is fulfilled; if not, route to the v1.0 keyword path. This is a build-time concern (Phase 7), not a query-time concern (Phase 8).
- **Post-fulfilment**, the index is available for Phase 8's hybrid query path. Phase 8 can assume the index is either fulfilled (use it) or fulfilled-empty (fall back) — no third state.
- **Build failure handling:** if the `EmbeddingProvider` rejects (e.g., model load fails, network error during one-time download), log a clear error and leave the index in a "failed" state. Future queries fall back to v1.0 keyword. The MCP server stays up — semantic-search degradation is preferable to gateway crash. The PRD's risk register flags exactly this scenario.

### Storage Shape
- **In-memory only** (DEC-v11-09 carries forward — analytics-only, but applies here too: no disk persistence, no network egress for vectors). Rebuilds on every process restart.
- **Vector storage shape:** `Map<string, Float32Array>` keyed by tool name, OR a parallel-array structure `{ toolNames: string[]; vectors: Float32Array[] }`. The planner picks the exact structure based on what Phase 8's cosine-similarity path needs. The constraint is: O(1) lookup by tool name, dense storage to keep memory in budget.
- **Vector dimension** is provider-determined (MiniLM = 384). The engine MUST NOT assume 384 — read the dim from the first batch result. Future providers (e.g., bigger MiniLM, OpenAI ada) may produce different dims.

### Performance Budget (REQ-v11-perf-budget)
**Hard targets, must hold on commodity hardware (Apple Silicon / Linux x64):**
- **Index build:** ≤ 5 seconds for a 50-tool server with the local MiniLM adapter.
- **`tools/list` latency:** within v1.0 noise floor (no v1.1-added latency). Measured by a benchmark comparing v1.0 path vs v1.1 path with `embeddings` configured.
- **Memory:** ≤ 2 MB for a 50-tool server with 384-dim float32 vectors. (50 tools × 384 dims × 4 bytes = 76.8 KB — tons of headroom; this is the budget for the index map *plus* any auxiliary structures.)
- **Build mode:** non-blocking — `mcpack(server, config)` and `createMCPackServer(config)` MUST return synchronously even when `embeddings` is configured. The build runs in the background.

These targets are validated in Phase 10's harness, but Phase 7's PLAN.md must encode acceptance criteria that *bound* the build latency and memory at the unit-test level (e.g., "50-tool mock test asserts build completes in ≤5s, vector map size ≤ 2 MB").

### Engine Surface (REQ-v11-tools-list-no-regression)
- **No public API changes.** `mcpack(server, config)`, `createMCPackServer(config)`, and the returned handle keep their v1.0+v1.1-Phase-6 signatures. Phase 7 adds *internal* engine state, not new exports.
- **Internal `MCPackEngine` gains:**
  - A method/field for kicking off the build (e.g., `private async buildSemanticIndex()`)
  - A field for the vector store (`private semanticIndex: ... | null`)
  - A field for the build state (`private indexState: 'idle' | 'building' | 'ready' | 'failed'` or equivalent)
- **`MCPackEngine` is internal** (not exported from package entry per Phase 02's DEC). Phase 7 changes stay internal.

### Backward Compatibility (REQ-v11-tools-list-no-regression carries DEC-v11-02 + DEC-v11-09)
- **When `MCPackConfig.embeddings` is absent**, the engine code path is byte-identical to v1.0. No new fields read, no new branches taken, no new resources allocated. The existing v1.0 test surface (107/107 from Phase 6) MUST continue to pass unmodified.
- **Existing v1.0 deployments upgrading to v1.1 with no config changes** observe zero behavioral or perf delta. This is the test the regression gate enforces.

### Three [BLOCKING] Phase Gates (carried forward from Phase 6, applied to Phase 7's deliverable)
Phase 7 modifies `src/` (engine) AND adds tests. The board-locked invariants from Phase 6 still apply:
- **Gate 1 (zero-new-core-deps):** root `package.json` `dependencies` and `peerDependencies` UNCHANGED from baseline (now reference is post-Phase-6 = `bec3f6f` or equivalent).
- **Gate 2 (public-API additive-only):** `dist/index.d.ts` declarations show no changes from Phase 6's output. Phase 7 doesn't add any new exports — only internal engine state.
- **Gate 3 (adapter-isolation):** `grep -rE "@llvs/mcpack-embeddings|@huggingface/transformers|@xenova/transformers" src/ test/` continues to return ZERO matches. The engine consumes the `EmbeddingProvider` type abstraction — it MUST NOT import the concrete adapter or its transitive deps.

### Open Question — OQ3 stays deferred to v1.2
- **Index rebuild on `notifications/tools/list_changed`:** the synthesizer's INFO entry deferred this to v1.2. Phase 7 MUST NOT add notification-driven rebuild logic. The index is built once at startup; that's the v1.1 contract. If an MCP server's tool list changes mid-session, semantic search reflects the startup snapshot; keyword still works (it operates on the underlying server's `tools/list` response per-call).

### Claude's Discretion
- Exact name of internal methods/fields (`buildSemanticIndex` vs `loadSemanticIndex` vs `indexTools`, etc.).
- Promise vs state-machine for the build state.
- Whether to expose internal build-state via a debug log or just track silently (recommend: structured log with `MCPACK_DEBUG=1` env-var gate, matching v1.0 conventions).
- Where exactly in `MCPackEngine`'s constructor flow to kick off the build.

</decisions>

<canonical_refs>
## Canonical References

### Phase 6 outputs (Phase 7 builds on these)
- `/Users/zaid/Projects/MCPack/src/types.ts` — `EmbeddingProvider` type definition + `MCPackConfig.embeddings` optional field. Phase 7's engine consumes both.
- `/Users/zaid/Projects/MCPack/src/index.ts` — confirms the public re-export shape; Phase 7 doesn't change exports.
- `/Users/zaid/Projects/MCPack/test/types.test.ts` — type-contract test patterns Phase 7's new tests should mirror (mock-provider style).
- `/Users/zaid/Projects/MCPack/.planning/phases/06-embeddingprovider-interface-adapter-scaffold-v1-1/06-01-SUMMARY.md` — what Phase 6 delivered + the version bump.

### Synthesizer Intel (board-approved decisions and requirements)
- `.planning/intel/SYNTHESIS.md` — milestone routing
- `.planning/intel/decisions.md` — DEC-v11-01..15 + DEC-BOARD-01..05 (relevant: DEC-v11-01 public API lock, DEC-v11-02 zero-dep core, DEC-v11-04 ESM-only)
- `.planning/intel/requirements.md` — REQ-v11-semantic-index-build, REQ-v11-tools-list-no-regression, REQ-v11-perf-budget full text

### Existing v1.0 / v1.1-Phase-6 Code (planner + executor MUST inspect)
- `/Users/zaid/Projects/MCPack/src/core.ts` — `MCPackEngine`. **This is where Phase 7's primary work lands.** Read in full before planning.
- `/Users/zaid/Projects/MCPack/src/index-builder.ts` — v1.0 keyword index build pattern. Phase 7's semantic build runs *in addition to* (not in place of) this. Reference for naming conventions and concatenation patterns.
- `/Users/zaid/Projects/MCPack/src/search.ts` — v1.0 keyword search. Phase 7 doesn't modify this; Phase 8 will. But the planner needs to know the search call site so Phase 7's "fall back to keyword if index not ready" path routes to the right function.
- `/Users/zaid/Projects/MCPack/src/wrap.ts`, `/Users/zaid/Projects/MCPack/src/build.ts` — both call into `MCPackEngine`. Verify Phase 7's engine changes don't break either entry point.
- `/Users/zaid/Projects/MCPack/test/core.test.ts` — engine unit tests. Phase 7 adds new tests here (or in a sibling file like `test/semantic-index-build.test.ts` — planner picks).

### Project Standards
- `/Users/zaid/Projects/MCPack/CLAUDE.md` — stack, architecture, key patterns. Specifically the "Architecture" + "Key Patterns" sections describe `MCPackEngine` as the composition point.
- `/Users/zaid/Projects/MCPack/PLAYBOOK.md` — Development Protocol, Quality Gates.
- `/Users/zaid/Projects/MCPack/spec/mcpack-spec-v1.md` — protocol + architecture reference.

### Phase 6 lessons forward
- `/Users/zaid/Projects/MCPack/.planning/phases/06-embeddingprovider-interface-adapter-scaffold-v1-1/06-02-SUMMARY.md` — documents the `npm link` workaround for adapter peer-dep resolution. Phase 7 doesn't need to re-link (the engine doesn't import the adapter), but if the planner adds a test that exercises a concrete provider, the link state matters.
- `/Users/zaid/Projects/MCPack/PLAYBOOK.md` Recent Sprints "Phase 6" entry — the `@xenova/transformers` → `@huggingface/transformers` clerical-correction lesson.

</canonical_refs>

<specifics>
## Specific Ideas (planner-relevant concrete items)

### Engine state sketch (planner picks exact shape)
```typescript
// Inside MCPackEngine class (src/core.ts), additive only:
private semanticIndex: Map<string, Float32Array> | null = null;
private indexState: 'idle' | 'building' | 'ready' | 'failed' = 'idle';
private indexBuildPromise: Promise<void> | null = null;

// Kicked off in constructor when config.embeddings is present:
if (config.embeddings) {
  this.indexState = 'building';
  this.indexBuildPromise = this.buildSemanticIndex(config.embeddings.provider)
    .then(() => { this.indexState = 'ready'; })
    .catch((err) => {
      console.warn('[mcpack] semantic index build failed:', err);
      this.indexState = 'failed';
    });
}

private async buildSemanticIndex(provider: EmbeddingProvider): Promise<void> {
  const tools = /* ... pull from underlying server or build-mode tools list ... */;
  if (tools.length === 0) { this.semanticIndex = new Map(); return; }
  const indexingStrings = tools.map(t => buildIndexingString(t));
  const vectors = await provider(indexingStrings);
  // Validate: vectors.length === tools.length
  this.semanticIndex = new Map(tools.map((t, i) => [t.name, new Float32Array(vectors[i])]));
}
```

### Mock provider for Phase 7 tests
Phase 7's tests use a deterministic mock provider — NOT the real MiniLM adapter. The mock returns vectors of a fixed dimension based on a simple hash of the input string. This keeps tests fast and offline.

```typescript
// test/semantic-index-build.test.ts (or wherever)
const mockProvider: EmbeddingProvider = async (texts) => {
  return texts.map(t => {
    const hash = /* simple deterministic hash */;
    return Array.from({ length: 8 }, (_, i) => (hash + i) / 100); // 8-dim mock
  });
};
```

### Acceptance bar (from PRD §"Success Criteria" for Phase 7)
1. When `EmbeddingProvider` is configured, index build runs async at startup with concatenated `name + description + param-names` per tool, single-batch call.
2. `tools/list` returns one tool with no v1.1-added latency (within v1.0 noise floor on benchmark).
3. If a query arrives before the index is ready, search falls back to v1.0 keyword scoring and logs a warning — `search_tools` is never blocked.
4. 50-tool index builds within 5s on commodity hardware with local MiniLM, memory ≤ 2MB.

### Verification commands the plan-checker / verifier will run
```bash
npm run typecheck                         # must pass; no new errors
npm run build                             # tsc emits dist/
npm test                                  # 107/107 baseline + new Phase 7 tests
npm run test:coverage                     # ≥99% statement coverage maintained

# Performance assertions in test (50-tool mock):
# - build completes in ≤5s wall-clock
# - vector map size ≤ 2 MB

# Three [BLOCKING] gates re-run:
diff <(jq -S '...' package.json) <(git show <ref-after-Phase-6>:package.json | jq -S '...')   # Gate 1
# Gate 2: dist/index.d.ts unchanged from Phase 6 output
grep -rE "@llvs/mcpack-embeddings|@huggingface/transformers|@xenova/transformers" src/ test/  # Gate 3
```

</specifics>

<deferred>
## Deferred Ideas

### Punted to later v1.1 phases
- **Semantic query path** (embed query, cosine similarity, top-N): **Phase 8**.
- **Hybrid score combination** (`0.7·semantic + 0.3·keyword`): **Phase 8**.
- **Role-filter-after-rank**: **Phase 8** (ranking layer is Phase 8's concern).
- **AnalyticsStore + getAnalytics() API**: **Phase 9**.
- **50-query intent benchmark, harness regression, npm publish**: **Phase 10**.

### Punted to v1.2 (Partner Hub)
- Multi-source merged index (Phase 11 in v1.2 milestone).
- Index rebuild on `notifications/tools/list_changed` (OQ3).

### Open questions deferred to later v1.1 phases
- **OQ1** (Phase 9): `getAnalytics()` flat on handle vs separate `.analytics` property.
- **OQ2** (Phase 8): Hybrid weights config-only vs per-query.
- **OQ4** (Phase 10): 50-query benchmark source.
- **OQ5** (Phase 9): denial events recording restricted tool names for operator-scope queries.

### Punted explicitly to v2.0
- Persistent semantic index (cross-restart cache).
- Disk-backed vector store.
- Notifications-driven index updates (`tools/list_changed`).

</deferred>

---

*Phase: 07-semantic-index-build-pipeline-v1-1*
*Context gathered: 2026-04-26 (composed from `.planning/intel/` + Phase 6 delivered foundation)*
