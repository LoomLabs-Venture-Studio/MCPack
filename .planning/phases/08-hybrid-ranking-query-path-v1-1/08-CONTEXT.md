# Phase 8: Hybrid Ranking Query Path (v1.1) — Context

**Gathered:** 2026-04-26
**Status:** Ready for planning
**Source:** /gsd-discuss-phase 8

<domain>
## Phase Boundary

Combine semantic and keyword scoring into a single ranked output for each `search_tools` call. Per-query embedding (single-item batch) → cosine similarity per tool vector → hybrid score `(0.7·semantic) + (0.3·keyword)` against per-query min-max normalized scores → role filter applied AFTER ranking. Backward-compat invariant: when `MCPackConfig.embeddings` is absent, the search code path is byte-identical to v1.0.

Modifies `src/core.ts handleSearchTools()` (reverses current "filter-then-score" ordering to "score-then-filter") and extends `src/search.ts` with three new pure functions (cosine similarity, min-max normalize, hybrid combine).

**Phase 8 does NOT:**
- Add new public API surface (no exports change in `src/index.ts`)
- Add a build-time index rebuild path (deferred to v1.2 per Phase 7 CONTEXT — `notifications/tools/list_changed`)
- Add hosted embedding adapters (deferred to v1.2 per Phase 6 CONTEXT — OQ6)
- Touch `getAnalytics()` (Phase 9)
- Configure per-query weight overrides (DECIDED: config-only — see DEC-v11-08-01)

</domain>

<decisions>
## Implementation Decisions (LOCKED — from board PRD ingest + Phase 6/7 carry-forward + this discussion)

### Hybrid Weight Configuration Scope (DEC-v11-08-01 — resolves OQ2)
**Config-only.** Weights are set at engine construction via `MCPackConfig.embeddings.weights` (already typed in Phase 6 — `{ semanticWeight: number; keywordWeight: number }`). Per-query weight overrides are NOT accepted on `search_tools` args.

**Rationale:**
- Smallest public API surface — `search_tools` schema gains zero new fields.
- Matches the PRD literally (`REQ-v11-hybrid-ranking`: "Configurable via `MCPackConfig.embeddings.weights`").
- Agents tune at deploy-time (config), not call-time (args). Mismatched per-call weights would be a footgun.
- If real users ask for per-query weights post-v1.1, revisit in v1.2 — not blocked by this decision.

**Defaults (carry from Phase 6 CONTEXT, REQ-v11-hybrid-ranking):**
- `semanticWeight: 0.7`, `keywordWeight: 0.3` — used when `embeddings` is configured AND `weights` is omitted.
- When `embeddings` is absent entirely → keyword-only path with implicit `keywordWeight: 1.0` (byte-identical to v1.0).

### Score Normalization (DEC-v11-08-02)
**Per-query min-max normalization to [0, 1] for both tracks before combine.**

For each query:
1. Score every candidate tool against the query along both tracks (semantic via cosine, keyword via the existing 5-tier `scoreAndRank`-style scoring).
2. Min-max normalize each track independently to [0, 1] across the candidate set:
   - `normalized = (raw - min) / (max - min)` when `max > min`
   - When `max == min` (degenerate: all candidates score identically on this track) → all values normalize to 0. This drops that track's influence to zero for the query, which is the right behavior — the track has no discriminating signal.
3. Apply hybrid formula: `final = (semanticWeight · semanticNorm) + (keywordWeight · keywordNorm)`.
4. Sort by `final` descending; apply role filter; apply limit.

**Rationale:**
- Cosine is bounded [-1, 1], keyword sums are unbounded. Direct combine is meaningless without normalization.
- Per-query (vs global) normalization is query-local, requires no calibration constant, no global tuning loop.
- Min-max is the simplest defensible default. RRF was considered and rejected for v1.1 — it changes weight semantics from "score-influence" to "rank-influence", which subtly breaks the PRD's literal `0.7·semantic + 0.3·keyword` formula.
- Empty-candidate-set: returns `[]` immediately (no normalization needed, no division by zero risk).

**Edge cases the planner must encode in tests:**
- All candidates score zero on keyword (e.g., query has no token matches anywhere): `(0 - 0) / 0` is undefined — implementation must short-circuit (all keyword normalized = 0).
- All candidates score identically on semantic (e.g., query semantically equidistant from every tool): same short-circuit, all semantic normalized = 0. Result is sorted by whatever has signal — usually keyword.
- Single-tool surface: trivially `[1.0]` normalized for any track that has signal.

### Role Filter Ordering (REQ-v11-role-filter-after-rank — locked, no discussion needed)
**Score → Sort → Role-filter → Limit.** Never filter before scoring. The current `handleSearchTools` does the opposite (`resolveRoleAccess(...)` THEN `scoreAndRank(...)`); Phase 8 reverses this. This preserves opaque denial — restricted tools are never visible in results — while ensuring the rank reflects the FULL tool surface (so an operator-only tool never "boosts" other tools by being absent from the candidate set).

**Implementation note:** the ranked-then-filtered pipeline can over-fetch internally (rank ALL tools, then drop role-blocked ones, then take top-N) and still return the user-requested limit. Planner picks the exact strategy — over-fetch-then-filter vs filter-with-original-ranks-preserved — but the observable behavior is "rank computed against full surface, output filtered to allowed surface."

### `hasVectors()` Helper (DEC-v11-08-03 — fixes Phase 7 WR-01)
**Add new public method `hasVectors(): boolean` on `MCPackEngine`.** Returns `this.semanticIndex !== null && this.semanticIndex.size > 0`.

Phase 7's `isIndexReady()` stays unchanged — its API is locked. The two methods answer different questions:
- `isIndexReady()` — did the build complete (success-with-vectors OR success-no-op-empty OR pending OR failed)? Currently returns `true` for empty-no-op too. Used for "is the build process done?"
- `hasVectors()` — are there actually vectors to query semantically? Used by Phase 8's hybrid router to decide between semantic-path and keyword-fallback.

**Phase 8's query-path gate:** `if (this.hasVectors()) { hybrid path } else { v1.0 keyword fallback }`. The fallback path is byte-identical to v1.0's `scoreAndRank` call — same code path the no-`embeddings`-configured case takes.

**Why additive (not refactor isIndexReady to enum):** Refactoring `isIndexReady()` would churn Phase 7's tests and break the locked API. `hasVectors()` is purely additive — no Phase 7 test changes, no risk of regression on the 124-test baseline.

### Query Embedding Error Handling (DEC-v11-08-04)
**Per-query embedding failure → fall back to v1.0 keyword scoring + log warning ONCE per process.**

When `engine.config.embeddings.provider([query])` rejects (network blip, transient model error, etc.):
1. Catch the rejection — DO NOT propagate to the MCP caller (would break the session).
2. Log a single locked-format warning: `MCPack: query embedding failed:` followed by the error message. Format mirrors Phase 7's build-failure warn (`MCPack: semantic index build failed:`) and MUST NOT include tool names — RBAC invariant.
3. Use a process-level "warned once" flag on the engine instance to avoid log-spam if the provider is consistently broken. (One warning per `MCPackEngine` instance for the whole process lifetime, not one per query.)
4. For THIS query, fall through to v1.0 keyword-only path. Return results normally.

**Why fall back vs error:** The MCP server staying up with degraded search is preferable to a crashing gateway. Same principle as Phase 7's build-failure handling.

### Backward Compatibility (REQ-v11-backward-compat — carries DEC-v11-02 + DEC-BOARD-04)
**When `MCPackConfig.embeddings` is absent**, `handleSearchTools` is byte-identical to v1.0:
- No new code branches taken.
- No new fields read.
- No new resources allocated.
- No new console.warn calls (Pitfall 7 negative control from Phase 7 carries forward).
- The 107 v1.0 baseline tests + 17 Phase 7 tests = 124 tests MUST continue to pass unmodified.

The planner must encode an acceptance gate that proves this — the same approach Phase 7 used (Gate 4: 8 baseline test files byte-identical via `git diff` against `bec3f6f`).

### Three [BLOCKING] Phase Gates (carry forward from Phases 6 + 7, applied to Phase 8's deliverable)
Baseline reference now advances to the post-Phase-7 commit (current main HEAD; planner pins exact SHA at plan-time). Gates remain:
- **Gate 1 (zero-new-core-deps):** root `package.json` `dependencies` and `peerDependencies` UNCHANGED from baseline.
- **Gate 2 (public-API additive-only):** `src/index.ts` exports unchanged from Phase 7. Phase 8 is internal (engine and search.ts). `MCPackEngine.hasVectors()` is internal (engine class is not exported per Phase 02 DEC).
- **Gate 3 (adapter-isolation):** `grep -rE "@llvs/mcpack-embeddings|@huggingface/transformers|@xenova/transformers" src/ test/` returns ZERO matches. Engine consumes the `EmbeddingProvider` type abstraction only.
- **Gate 4 (baseline tests byte-identical):** all pre-Phase-8 test files unchanged. New tests live in new files only — no edits to existing test files.

### Open Questions Status
- **OQ2 (per-query vs config-only weights):** RESOLVED — config-only (DEC-v11-08-01).
- **OQ1 (`getAnalytics()` shape):** Still deferred to Phase 9.
- **OQ3 (index rebuild on `listChanged`):** Still deferred to v1.2.
- **OQ4 (50-query intent benchmark source):** Still deferred to Phase 10.
- **OQ5 (denial events record tool name even for operators):** Still deferred to Phase 9.
- **OQ6 (`@llvs/mcpack-embeddings` ship hosted adapter):** Still deferred to v1.2.

### Carry-Forward Code Review Items From Phase 7
- **WR-01** (isIndexReady semantics): RESOLVED in Phase 8 via `hasVectors()` helper (DEC-v11-08-03 above).
- **WR-02** (no unhandled-rejection regression test): Phase 8 SHOULD add this test as part of its query-path test suite. Suggested location: a top-level test that registers `process.on('unhandledRejection', listener)`, constructs an engine with a rejecting provider for both build AND query embedding, and asserts the listener is never called. Tests both Phase 7's build path and Phase 8's query path simultaneously.
- **WR-03** (RBAC test fixture-coupling): Phase 8 SHOULD tighten its own RBAC tests structurally (assert locked warn format directly via regex `^MCPack: query embedding failed: `, iterate actual fixture names) and OPTIONALLY tighten Phase 7's RBAC test in the same plan since the fix is one line per test. Planner's call.

### Claude's Discretion
- Exact name of the new pure functions in `src/search.ts` (`cosine`/`cosineSimilarity`, `minMaxNormalize`/`normalizeMinMax`, `combineHybrid`/`hybridScore`, etc.) — planner picks. Naming should match the existing `scoreAndRank` style.
- Whether the new scoring functions live in `src/search.ts` (extend existing module) or a new sibling `src/hybrid-scoring.ts` (matches Phase 7's `src/semantic-index-builder.ts` precedent). Recommendation: new file for the pure scoring math, keep `src/search.ts` for the keyword-only path. But planner can argue either way.
- Whether to over-fetch-then-filter or filter-with-rank-preserved when applying role filter after ranking — observable behavior identical, performance trade-off is implementation detail.
- Exact warned-once mechanism (instance flag, module-level `WeakSet`, etc.) — planner picks the simplest sufficient form.
- Whether the build-pending fallback ALSO emits a query-time warning (Phase 7's contract is silent — Pitfall 7 negative control). Recommendation: stay silent during build-pending. The warning ladder is: build-failure (Phase 7, once) and query-embedding-failure (Phase 8, once per instance). Nothing else fires console.warn.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project foundation
- `.planning/PROJECT.md` — project core value, constraints, evolution rules
- `.planning/REQUIREMENTS.md` — full v1.1 requirement traceability
- `.planning/ROADMAP.md` — Phase 8 goal + must-haves + downstream dependencies (Phases 9, 10)
- `./CLAUDE.md` — project quality gates, commit conventions, test/build protocol
- `./PLAYBOOK.md` — current sprint, acceptance criteria, carry-forward warnings

### Phase 6 + 7 lock-points (carry forward)
- `.planning/phases/06-embedding-provider-interface-v1-1/06-CONTEXT.md` — EmbeddingProvider type contract (DEC-v11-01), zero-dep gate, adapter-isolation gate, ESM-only
- `.planning/phases/06-embedding-provider-interface-v1-1/06-VERIFICATION.md` — Phase 6 11/11 dimensions + baseline reference
- `.planning/phases/07-semantic-index-build-pipeline-v1-1/07-CONTEXT.md` — build lifecycle, build-pending fallback, build-failure warn format, in-memory storage, performance budget
- `.planning/phases/07-semantic-index-build-pipeline-v1-1/07-RESEARCH.md` — Pitfall 7 (build-pending RBAC negative control), patterns to follow
- `.planning/phases/07-semantic-index-build-pipeline-v1-1/07-VERIFICATION.md` — 11/11 dimensions reference for Phase 8 to match
- `.planning/phases/07-semantic-index-build-pipeline-v1-1/07-REVIEW.md` — open warnings WR-01/02/03 carried forward into Phase 8

### Source code Phase 8 modifies / extends
- `src/core.ts` — `MCPackEngine` (handleSearchTools is the integration point; `hasVectors()` is added here)
- `src/search.ts` — current keyword-only `scoreAndRank` (Phase 8 EITHER extends this OR adds sibling)
- `src/semantic-index-builder.ts` — Phase 7 helper (Phase 8 reads vectors from `semanticIndex` Map this module populates)
- `src/types.ts` — `MCPackConfig.embeddings.weights` already typed in Phase 6 (Phase 8 reads only)

### Test surface
- `test/core.test.ts`, `test/search.test.ts`, `test/wrap.test.ts`, `test/build.test.ts` — baseline test files (Phase 8 must not edit)
- `test/semantic-index-build.test.ts` — Phase 7 baseline (must not edit)
- `test/hybrid-ranking.test.ts` (or similar) — NEW Phase 8 file(s)

### Inbound PRD (board-locked)
- `.planning/inbox/processed/mcpack-prd-v1.1-gsd.md` — `REQ-v11-hybrid-ranking`, `REQ-v11-semantic-query-path`, `REQ-v11-role-filter-after-rank`, `REQ-v11-backward-compat`, `REQ-v11-session-invariants` are the Phase 8 requirements

</canonical_refs>

<specifics>
## Specific Ideas

### From Phase 7 carry-forward (planner should encode as test cases)
- **Empty tool surface:** Phase 7 made build a no-op. Phase 8's hybrid router gates on `hasVectors()` → empty case routes to v1.0 keyword (which also returns `[]` for any query). Same observable behavior either way. Test: zero-tool engine + `embeddings` configured → search returns `[]` with no warnings, no errors, no async path entered.
- **Build-failed state:** Phase 7's contract = `semanticIndex` stays `null`, single locked warn, future queries fall back. Phase 8 inherits: `hasVectors()` returns `false` when build failed, fallback runs, no NEW warning emits per query.
- **Build-pending state:** Phase 7's contract = `hasVectors()` returns `false`, fallback runs, ZERO new console.warn (Pitfall 7 negative control). Phase 8 must preserve this — its tests must include a build-pending negative-control test that mirrors Phase 7's.
- **Backward-compat byte-identicality:** Phase 7 measured this with Gate 4 (`git diff` against baseline test files). Phase 8 inherits Gate 4 with the baseline advanced to current HEAD.

### Test fixture conventions (carry from Phases 1 + 7)
- Mock `EmbeddingProvider` for unit tests — fully synchronous resolution where possible (`Promise.resolve(...)`). Avoid `setTimeout` unless explicitly testing async timing.
- Tool fixtures: 3-tool minimum (covers ranking ordering), 50-tool stress (matches PRD perf budget assertions), zero-tool (edge case), single-tool (degenerate normalization).
- For RBAC tests: fixture roles include `admin` (sees all), `restricted` (sees subset), `none` (sees nothing). Reuses Phase 1's role test patterns.

### Performance assertions in tests
The 50ms p99 query-embedding budget (`REQ-v11-perf-budget`) is validated in Phase 10's harness with a real MiniLM provider. Phase 8's unit tests use a synchronous mock provider — they assert ALGORITHMIC complexity (e.g., "query path completes in < 50ms with 50 tools and a sync mock provider") to bound regression, NOT the real-provider budget. Same pattern Phase 7 used for the 5s build budget.

</specifics>

<deferred>
## Deferred Ideas

- **Per-query weight overrides** — DEC-v11-08-01 says config-only for v1.1. Add to v1.2 OQ list if real-world feedback warrants it.
- **RRF (reciprocal-rank-fusion) hybrid scoring** — considered and rejected for v1.1 (changes weight semantics). v2.0 candidate if score-based hybrid proves insufficient.
- **Caching query embeddings** — repeated queries pay the embedding cost every time. Worth a benchmark in Phase 10. Caching design (LRU? TTL? size cap?) is its own design discussion. Deferred from v1.1.
- **`notifications/tools/list_changed` rebuild** — already deferred to v1.2 per Phase 7 CONTEXT (OQ3).
- **Tightening Phase 7's RBAC test (WR-03)** — optional in Phase 8 plan; planner's call. If skipped, surface as a v1.1 polish phase candidate.

</deferred>

---

*Phase: 08-hybrid-ranking-query-path-v1-1*
*Context gathered: 2026-04-26 via /gsd-discuss-phase*
