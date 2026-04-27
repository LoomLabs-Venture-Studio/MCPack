---
phase: 08-hybrid-ranking-query-path-v1-1
verified: 2026-04-26T22:00:00Z
status: passed
score: 11/11 dimensions verified
overrides_applied: 0
gates_passed:
  - "Gate 1: zero-new-core-deps vs Phase 7 baseline cd1fc52 (broadened jq selector — empty diff)"
  - "Gate 2: public-API src/index.ts unchanged from cd1fc52 (zero-line diff)"
  - "Gate 3: adapter-isolation (grep src/ test/ for @llvs/mcpack-embeddings|@huggingface/transformers|@xenova/transformers returns zero matches)"
  - "Gate 4: regression — all 9 v1.0+Phase-7 baseline test files byte-identical to cd1fc52 (zero-line diff)"
requirements_satisfied:
  - REQ-v11-semantic-query-path
  - REQ-v11-hybrid-ranking
  - REQ-v11-role-filter-after-rank
  - REQ-v11-backward-compat
  - REQ-v11-session-invariants
re_verification: false
review_carry_forward_resolved:
  - id: WR-01 (Phase 7 carry-forward)
    summary: "isIndexReady() returns true on empty-tools no-op"
    resolution: "Resolved by DEC-v11-08-03 — additive MCPackEngine.hasVectors(): boolean method (src/core.ts:143-145). Phase 8 query-path routes on hasVectors() instead of isIndexReady(); Phase 7's API stays locked. Test at test/hybrid-ranking.test.ts:86-100 enshrines the distinction (empty-no-op: isIndexReady()===true AND hasVectors()===false)."
  - id: WR-02 (Phase 7 carry-forward)
    summary: "No test asserts unhandled-rejection invariant"
    resolution: "Resolved with 3 dedicated unhandled-rejection regression tests (test/hybrid-ranking.test.ts:885-947) covering BOTH Phase 7 build-failure path AND Phase 8 query-embedding-failure path on the same engine instance. process.on('unhandledRejection', listener) registered; assertion: listener never fires."
  - id: WR-03 (Phase 7 carry-forward)
    summary: "RBAC log assertion fixture-coupled (hardcoded names)"
    resolution: "Resolved at all NEW Phase 8 RBAC test sites — 14 occurrences of rename-safe `tools.map((t) => t.name)` pattern in test/hybrid-ranking.test.ts. P9 negative control (test/hybrid-ranking.test.ts:437-475) iterates ACTUAL fixture names rather than hardcoding strings."
review_findings_resolved:
  - id: CR-01
    severity: BLOCKER
    summary: "Rank-then-filter pivot broken — scoreAndRank caps at MAX_LIMIT=10"
    fix_commit: 4566261
    fix_approach: "Option B — extended scoreAndRank to honor Infinity sentinel (src/search.ts:49-52). Finite limits remain clamped to MAX_LIMIT=10 (v1.0 contract preserved). Two regression tests added in test/hybrid-ranking.test.ts:797-883 reproducing the >10-tool role-blocked scenario."
  - id: WR-01
    severity: WARNING
    summary: "Cosine dimension-mismatch propagates to MCP caller"
    fix_commit: 072af42
    fix_approach: "Per-tool try/catch around cosineSimilarity (src/core.ts:400-410); on throw set semScore=0 and continue. Two regression tests in test/hybrid-ranking.test.ts:712-794 (counter-based provider returning mismatched dims; assertions: no propagated rejection, keyword tier ranking still produces correct output)."
  - id: WR-02
    severity: WARNING
    summary: "combineHybrid does not validate weights — partial weights produce silent NaN scores"
    fix_commit: f144588
    fix_approach: "Two-layer fix: (1) combineHybrid validates typeof + Number.isFinite on both weight fields with descriptive error pinpointing the malformed field (src/hybrid-scoring.ts:120-135); (2) per-field default coercion at engine boundary (src/core.ts:432-436). 7 unit tests + 2 engine-level coercion tests."
  - id: WR-03
    severity: WARNING
    summary: "Hybrid path filters score>0 AFTER min-max — single/two-tool surface degenerates"
    fix_commit: 8f5361e
    fix_approach: "Comment-only lock per DEC-v11-08-02 directive (src/core.ts:447-457). Multi-line `// LOCKED:` block above the `withSignal = indexed.filter((x) => x.score > 0)` line documents intentional behavior so future contributors don't 'fix' it without a board-approved DEC update."
  - id: WR-04
    severity: WARNING
    summary: "Symmetry between hybrid and keyword paths broken by CR-01"
    fix_commit: 4566261 (auto-resolved)
    fix_approach: "Auto-resolved by CR-01 fix. Both hybrid and keyword fallback paths now apply rank-then-filter against the full surface. CR-01 regression test directly verifies this on the keyword path; hybrid path test (test/hybrid-ranking.test.ts:217-256) verifies on the hybrid path."
deferred:
  - truth: "Real-MiniLM 50ms p99 query-embedding budget"
    addressed_in: "Phase 10 (Harness Verification, Coverage, Docs, npm Publish)"
    evidence: "08-VALIDATION.md Manual-Only Verifications row 1: 'Real MiniLM 50ms p99 query embedding — Phase 10 harness validates — out of Phase 8 scope'. Phase 8 unit/integration tests use sync mock providers — algorithmic complexity bounds only."
  - truth: "50-query intent benchmark ≥15% recall over v1.0 baseline"
    addressed_in: "Phase 10 (Harness Verification, Coverage, Docs, npm Publish)"
    evidence: "08-VALIDATION.md Manual-Only Verifications row 2: 'Phase 10 success criteria. Requires curated query set'. ROADMAP.md Phase 10: '50-query intent benchmark recall up ≥15% over v1.0 keyword baseline'."
  - truth: "Stripe MCP harness aggregate token reduction with hybrid ranking"
    addressed_in: "Phase 10 (Harness Verification, Coverage, Docs, npm Publish)"
    evidence: "ROADMAP.md Phase 10 Success Criteria: 'Stripe MCP harness ≥80.7% aggregate token reduction with hybrid ranking'."
---

# Phase 08: Hybrid Ranking Query Path (v1.1) — Verification Report

**Phase Goal:** Combine semantic and keyword scoring into a single ranked output that preserves v1.0 keyword behavior when no embeddings are configured.

**Verified:** 2026-04-26T22:00:00Z
**Status:** PASSED
**Re-verification:** No — initial verification (matches Phase 6/7 11/11 dimension PASS bar)

---

## Goal Achievement Summary

The phase delivers exactly what it promised. With `MCPackConfig.embeddings.provider` configured AND vectors built, `MCPackEngine.handleSearchTools` now:

1. Routes on the additive `hasVectors()` gate (DEC-v11-08-03).
2. Embeds the user's query as a single-item batch via `embedQuery` (warn-once-per-instance on failure, never propagates to MCP caller).
3. Scores the FULL `this.index` along both tracks — semantic (cosine similarity per tool against `semanticIndex` Map) + keyword (per-tool `keywordScoreForEntry`).
4. Per-query min-max normalizes each track to [0, 1] (DEC-v11-08-02).
5. Combines via the locked formula `(semanticWeight·semNorm) + (keywordWeight·kwNorm)` with defaults 0.7/0.3.
6. Sorts by hybrid score descending, drops zero-score entries.
7. Applies the role filter AFTER ranking (REQ-v11-role-filter-after-rank), preserving opaque denial.
8. Slices to limit and returns the `SearchToolResponse` envelope.

When `embeddings` is absent OR the build hasn't completed OR query embedding fails, the engine falls back to v1.0 keyword scoring with role-filter-after-rank applied via `scoreAndRankKeywordWithRoleAfter`. Wave 0 empirical check (149 tests passed against unified rank-then-filter pipeline on a disposable spike branch) verified that this pivot is observably byte-identical to v1.0's filter-then-rank for the existing baseline test corpus.

The constructor and `tools/list` semantics from Phase 7 are unchanged. The async refactor of `handleSearchTools` was widened to a sync-or-async union return type (`ToolCallResult | Promise<ToolCallResult>`) at executor-discovery time so that baseline tests in `test/core.test.ts` and `test/semantic-index-build.test.ts` (which call the method synchronously and parse `result.content[0].text`) continue to pass byte-identically — Gate 4 enforced.

A v1.0/v1.1-Phase-7 user upgrading to this commit can:
- Pass `embeddings: { provider }` and observe hybrid ranking on every `search_tools` call once the build completes.
- Have queries arriving before the build is ready transparently fall back to keyword scoring (zero new console.warn — Pitfall 7 carry-forward).
- Recover gracefully from query-embedding-failures without a process crash; one warning per engine instance lifetime, no tool-name leakage.
- Keep all existing v1.0 deployments working byte-identically with `MCPackConfig.embeddings` absent (P10 carry-forward).

Phase 9 (Tool Usage Analytics) can now wire `AnalyticsStore` events into the existing decision points in `MCPackEngine`.

---

## Observable Truths

| #   | Truth                                                                                                         | Status     | Evidence                                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Per-query embedding produces semantic score in [-1, 1] via cosine similarity (unit-tested utility)            | VERIFIED   | `src/hybrid-scoring.ts:28-50` — `cosineSimilarity` returns `[-1, 1]` bounded; defensive 0 on zero magnitude. Tests at `test/hybrid-scoring.test.ts:27-79` cover identity (1.0), orthogonal (0), opposite (-1), zero-magnitude defense, dim-mismatch throw, 384-dim MiniLM realistic vectors.                            |
| 2   | Final score = `(semanticWeight * semanticScore) + (keywordWeight * keywordScore)`; defaults 0.7/0.3           | VERIFIED   | `src/hybrid-scoring.ts:105-144` — `combineHybrid` applies element-wise weighted sum. `src/core.ts:432-436` per-field defaults 0.7/0.3. Tests at `test/hybrid-scoring.test.ts:130-242` cover default + custom + zero + negative weights + missing-field throws (WR-02 fix).                                              |
| 3   | v1.0 5-tier scorer remains as the keyword leg (DEC-v11-13)                                                    | VERIFIED   | `src/search.ts:7-11` — 5 constants (EXACT_NAME=10, PARTIAL_NAME=5, DESCRIPTION=3, KEYWORD=2, SCHEMA_PROPERTY=1) byte-identical to v1.0. `keywordScoreForEntry` (lines 126-162) re-uses the same constants and tier ordering. Regression invariant test at `test/hybrid-scoring.test.ts:308` proves equivalence.        |
| 4   | With no `EmbeddingProvider`, the keyword-only path runs unchanged (implicit `keywordWeight: 1.0`)             | VERIFIED   | `src/core.ts:188-197` — `if (this.hasVectors())` gate skipped when `embeddings` absent; falls through to `scoreAndRankKeywordWithRoleAfter`. P10 negative controls at `test/hybrid-ranking.test.ts:512-567` (no provider invoked, no new warns, v1.0 tier ordering preserved). Gate 4 enforces baseline test files byte-identical. |
| 5   | Existing v1.0 tests pass unmodified (124 baseline byte-identical to cd1fc52)                                  | VERIFIED   | Gate 4: `git diff cd1fc52 -- test/build.test.ts test/core.test.ts test/index-builder.test.ts test/roles.test.ts test/search.test.ts test/session.test.ts test/types.test.ts test/wrap.test.ts test/semantic-index-build.test.ts` returns 0 lines.                                                                      |
| 6   | Role filtering applied AFTER ranking — restricted tools never appear in output regardless of score            | VERIFIED   | `src/core.ts:460-467` (hybrid path) and `src/core.ts:493-499` (keyword fallback) — both apply `resolveRoleAccess` AFTER ranking, slice to limit AFTER filter. Tests at `test/hybrid-ranking.test.ts:184-256` (rank-then-filter pivot) + `test/hybrid-ranking.test.ts:797-883` (CR-01 regression with >10 tools).         |
| 7   | Schemas-loaded `{loaded: true}` references unchanged (REQ-v11-session-invariants)                             | VERIFIED   | `src/core.ts:251-257` (`buildSearchResponse`) — session.loadedTools.has/add ordering byte-identical to v1.0 (matches.map → SearchResult). Tests at `test/hybrid-ranking.test.ts:570-624` (hybrid path AND keyword fallback path) cover first-call schema-present / second-call loaded-true.                              |
| 8   | "Unknown tool: {name}" denial behavior unchanged                                                              | VERIFIED   | `src/wrap.ts` and `src/build.ts` byte-identical to baseline (`git diff cd1fc52 -- src/wrap.ts src/build.ts \| wc -l == 0`). v1.0 denial messages flow unchanged. Test `test/hybrid-ranking.test.ts:626-651` checks `total_available` reflects role-allowed surface count.                                                |
| 9   | `MCPackEngine.hasVectors(): boolean` exists; `isIndexReady()` API unchanged from Phase 7                      | VERIFIED   | `src/core.ts:117-119` (`isIndexReady` body unchanged from Phase 7) and `src/core.ts:143-145` (additive `hasVectors`). Tests at `test/hybrid-ranking.test.ts:54-110` exercise both methods across all four lifecycle states (absent / pending / failed / empty-no-op / success).                                          |
| 10  | Query-embedding-failure: single locked-format warn `^MCPack: query embedding failed: `, no tool names         | VERIFIED   | `src/core.ts:344-353` — `try/catch` with `hasWarnedQueryEmbeddingFailure` flag; locked format `MCPack: query embedding failed: ${message}`. P9 negative control at `test/hybrid-ranking.test.ts:437-475` asserts warn matches `^MCPack: query embedding failed: ` AND contains no fixture tool names (rename-safe).      |
| 11  | All 4 [BLOCKING] gates pass against `cd1fc52` baseline                                                        | VERIFIED   | Gate 1 (deps diff empty), Gate 2 (`git diff cd1fc52 -- src/index.ts \| wc -l == 0`), Gate 3 (`grep -rE "@llvs/mcpack-embeddings\|@huggingface/transformers\|@xenova/transformers" src/ test/ \| wc -l == 0`), Gate 4 (9 baseline test files byte-identical). All re-verified at the verification timestamp.            |

**Score:** 11/11 dimensions verified

---

## Required Artifacts

| Artifact                            | Expected                                                                            | Status     | Details                                                                                                                                                                            |
| ----------------------------------- | ----------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/hybrid-scoring.ts`             | Three pure-function exports (cosineSimilarity, minMaxNormalize, combineHybrid)       | VERIFIED   | 145 lines, zero imports, all three exports present + WR-02 weights validation in combineHybrid. Module-private (NOT in src/index.ts).                                             |
| `src/search.ts`                     | scoreAndRank unchanged + additive keywordScoreForEntry + Infinity sentinel for CR-01 | VERIFIED   | 163 lines (was 76 in v1.0). scoreAndRank inner-loop body byte-identical; effectiveLimit logic extended for Infinity (CR-01 fix lines 49-52). keywordScoreForEntry at lines 126-162. |
| `src/core.ts`                       | hasVectors + embedQuery + scoreAndRankHybrid + scoreAndRankKeywordWithRoleAfter + runHybridQuery + buildSearchResponse + refactored handleSearchTools | VERIFIED   | 562 lines (was 256 in Phase 7). All 6 helper methods present; handleSearchTools async-or-sync union return; exactly 2 console.warn sites (Phase 7 build + Phase 8 query).        |
| `test/hybrid-scoring.test.ts`       | ≥10 unit tests across 4 describe blocks (cosineSimilarity, minMaxNormalize, combineHybrid, keywordScoreForEntry) | VERIFIED   | 372 lines, **32 tests** across 4 describe blocks (6 + 7 + 13 + 6). Includes WR-02 weights-validation tests + REGRESSION INVARIANT for keywordScoreForEntry vs scoreAndRank.        |
| `test/hybrid-ranking.test.ts`       | ≥10 integration tests across 8 describe groups + P7/P8/P9/P10 negative controls + WR-02 unhandled-rejection regression | VERIFIED   | 947 lines, **31 tests** across 10 describe groups. All 4 pitfall negative controls (P7/P8/P9/P10) encoded; CR-01 regression block; WR-01 + WR-02 carry-forward fix tests.         |
| `src/index.ts`                      | Unchanged from Phase 7 (Gate 2)                                                     | VERIFIED   | `git diff cd1fc52 -- src/index.ts \| wc -l == 0`. Public API surface byte-identical.                                                                                                |
| `src/wrap.ts`, `src/build.ts`       | Unchanged from Phase 7                                                              | VERIFIED   | `git diff cd1fc52 -- src/wrap.ts src/build.ts \| wc -l == 0`. Both async setRequestHandler arrows accept the new sync-or-async union return transparently.                          |
| 9 baseline test files (Gate 4)      | Byte-identical to cd1fc52                                                           | VERIFIED   | `git diff cd1fc52 -- test/{build,core,index-builder,roles,search,session,types,wrap,semantic-index-build}.test.ts \| wc -l == 0`.                                                  |

---

## Key Link Verification

| From                                                | To                                                                  | Via                                                                | Status | Details                                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------- |
| `src/core.ts (handleSearchTools)`                   | `src/core.ts (private hasVectors gate)`                             | `if (this.hasVectors())`                                           | WIRED  | `src/core.ts:188` — exact pattern matched.                                                                            |
| `src/core.ts (runHybridQuery)`                      | `src/core.ts (private embedQuery)`                                  | `await this.embedQuery(query)`                                     | WIRED  | `src/core.ts:219` — `const queryVec = await this.embedQuery(query);`.                                                 |
| `src/core.ts (scoreAndRankHybrid)`                  | `src/hybrid-scoring.ts`                                             | `import { cosineSimilarity, minMaxNormalize, combineHybrid }`      | WIRED  | `src/core.ts:16-20` import block. Used at lines 401, 418-419, 437.                                                    |
| `src/core.ts (scoreAndRankHybrid)`                  | `src/search.ts (keywordScoreForEntry)`                              | `import { keywordScoreForEntry } from './search.js'`               | WIRED  | `src/core.ts:12` import. Used at line 414.                                                                            |
| `src/core.ts (scoreAndRankKeywordWithRoleAfter)`    | `src/search.ts (scoreAndRank)`                                      | `scoreAndRank(query, this.index, Infinity)`                        | WIRED  | `src/core.ts:495` — Infinity sentinel used to bypass MAX_LIMIT cap (CR-01 fix).                                       |
| `src/core.ts (scoreAndRankHybrid + Keyword)`        | `src/roles.ts (resolveRoleAccess)`                                  | `resolveRoleAccess(role, this.config.roles, this.index)`           | WIRED  | `src/core.ts:461` (hybrid) and `src/core.ts:496` (keyword) — both pass `this.index` (full surface) for rank-then-filter pivot. |
| `test/hybrid-scoring.test.ts`                       | `src/hybrid-scoring.ts`                                             | `import { cosineSimilarity, minMaxNormalize, combineHybrid }`      | WIRED  | `test/hybrid-scoring.test.ts` line 1-2 imports.                                                                       |
| `test/hybrid-scoring.test.ts`                       | `src/search.ts (keywordScoreForEntry + scoreAndRank)`               | `import { keywordScoreForEntry, scoreAndRank }`                    | WIRED  | Verified by REGRESSION INVARIANT test at `test/hybrid-scoring.test.ts:308`.                                           |
| `test/hybrid-ranking.test.ts`                       | `src/core.ts (MCPackEngine, hasVectors)`                            | `engine.hasVectors()`, `await engine.handleSearchTools(...)`        | WIRED  | 9+ usages of `engine.hasVectors()`, 30+ `await engine.handleSearchTools(...)`.                                        |
| `wrap.ts/build.ts setRequestHandler` (call site)    | `engine.handleSearchTools` (sync-or-async union return)             | `await engine.handleSearchTools(args, sessionId)` (already async)  | WIRED  | Existing call sites unchanged; sync-or-async union return is transparent — verified by Gate 4 (existing tests pass).  |

All 10 key links VERIFIED.

---

## Data-Flow Trace (Level 4)

| Artifact                              | Data Variable                          | Source                                                              | Produces Real Data | Status   |
| ------------------------------------- | -------------------------------------- | ------------------------------------------------------------------- | ------------------ | -------- |
| `handleSearchTools` (response.tools)  | `matches: ToolIndexEntry[]`            | `scoreAndRankHybrid` OR `scoreAndRankKeywordWithRoleAfter`           | YES                | FLOWING  |
| `scoreAndRankHybrid (semanticScores)` | `cosineSimilarity(queryVec, toolVec)`  | `embedQuery` (provider) → Float32Array; `semanticIndex.get(name)`    | YES                | FLOWING  |
| `scoreAndRankHybrid (keywordScores)`  | `keywordScoreForEntry(query, entry)`   | `entry` from `this.index` (built by `buildIndex(tools)` in constructor) | YES             | FLOWING  |
| `scoreAndRankHybrid (hybridScores)`   | `combineHybrid(...)`                   | minMaxNormalize(semanticScores) + minMaxNormalize(keywordScores)     | YES                | FLOWING  |
| `total_available`                     | `resolveRoleAccess(role, ...).length`  | `this.config.roles` + `this.index`                                   | YES                | FLOWING  |
| Session-gated `loaded: true` refs     | `session.loadedTools` Set              | `buildSearchResponse` mutation block                                 | YES                | FLOWING  |

All data flows traced from query input → real provider invocation → real Float32Array → real cosine math → real keyword scoring → real role filter → real session mutation → real JSON response. No hardcoded stubs at any layer.

---

## Behavioral Spot-Checks

| Behavior                                      | Command                                                                | Result                                | Status |
| --------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------- | ------ |
| TypeScript compilation                        | `npm run typecheck`                                                    | exit 0 (no errors)                    | PASS   |
| `tsc` build                                   | `npm run build`                                                        | exit 0 (no errors)                    | PASS   |
| Full test suite                               | `npm test`                                                             | 187/187 passed in 207ms               | PASS   |
| Coverage holds ≥99.61% Phase 7 baseline       | `npm run test:coverage`                                                | 99.73% statement (+0.12 vs Phase 7)   | PASS   |
| `core.ts` 100% statement coverage             | (coverage report)                                                      | 100% / 96.36% / 100% / 100%           | PASS   |
| `hybrid-scoring.ts` 100% across all metrics   | (coverage report)                                                      | 100% / 100% / 100% / 100%             | PASS   |
| `search.ts` 100% across all metrics           | (coverage report)                                                      | 100% / 100% / 100% / 100%             | PASS   |
| Gate 1 (deps unchanged)                       | `diff <(jq ... package.json) <(git show cd1fc52:package.json \| jq ...)` | empty diff                            | PASS   |
| Gate 2 (src/index.ts unchanged)               | `git diff cd1fc52 -- src/index.ts \| wc -l`                            | 0                                     | PASS   |
| Gate 3 (adapter isolation)                    | `grep -rE "@llvs/mcpack-embeddings\|@huggingface/transformers\|@xenova/transformers" src/ test/ \| wc -l` | 0 | PASS |
| Gate 4 (9 baseline test files byte-identical) | `git diff cd1fc52 -- test/{9 files} \| wc -l`                          | 0                                     | PASS   |
| `wrap.ts` + `build.ts` unchanged              | `git diff cd1fc52 -- src/wrap.ts src/build.ts \| wc -l`                | 0                                     | PASS   |
| Exactly 2 console.warn sites in core.ts       | `grep -c "console.warn" src/core.ts`                                   | 2 (Phase 7 build + Phase 8 query)     | PASS   |
| WR-03 rename-safe pattern occurrences         | `grep -c "tools.map((t) => t.name)" test/hybrid-ranking.test.ts`       | 14 (≥ plan floor of 4)                | PASS   |

All spot-checks PASS.

---

## Pitfall Negative Controls

| #  | Pitfall                                                                          | Encoded At                                                                  | Status   |
| -- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------- |
| P7 | Build-pending fallback emits zero new console.warn (carry from Phase 7)          | `test/hybrid-ranking.test.ts:481-510` (1 test in build-pending describe)     | VERIFIED |
| P8 | Query-embedding-failure does NOT propagate as unhandled rejection + warn-once    | `test/hybrid-ranking.test.ts:258-318` (2 tests + 4 defensive coverage tests) | VERIFIED |
| P9 | Query-embedding-failure warn message contains NO tool names (RBAC + WR-03)       | `test/hybrid-ranking.test.ts:437-475` (1 test, rename-safe iteration)       | VERIFIED |
| P10| Hybrid scoring backward-compat — when embeddings absent, baseline byte-identical | `test/hybrid-ranking.test.ts:512-567` (2 tests) + Gate 4                    | VERIFIED |

All 4 negative controls VERIFIED.

---

## Carry-Forward Code Review Items From Phase 7

| #     | Resolution                                                                                                                                                                                                                                                                                                                                                                                  | Status   |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| WR-01 | DEC-v11-08-03 — additive `MCPackEngine.hasVectors(): boolean` (src/core.ts:143-145). Phase 7's `isIndexReady()` API unchanged. Tests at `test/hybrid-ranking.test.ts:86-100` enshrine the empty-no-op distinction (`isIndexReady()===true` AND `hasVectors()===false`).                                                                                                                       | VERIFIED |
| WR-02 | 3 unhandled-rejection regression tests (`test/hybrid-ranking.test.ts:885-947`) — register `process.on('unhandledRejection', listener)`, drive BOTH Phase 7 build path AND Phase 8 query path on the same engine instance, assert listener never fires.                                                                                                                                       | VERIFIED |
| WR-03 | Rename-safe `tools.map((t) => t.name)` pattern at all NEW Phase 8 RBAC test sites — 14 occurrences in `test/hybrid-ranking.test.ts`. P9 negative control at `test/hybrid-ranking.test.ts:437-475` iterates ACTUAL fixture names rather than hardcoding three string literals.                                                                                                                  | VERIFIED |

---

## Phase 8 Code Review Resolution

| Finding | Severity | Status      | Files Modified                                                                                              | Commit    |
| ------- | -------- | ----------- | ----------------------------------------------------------------------------------------------------------- | --------- |
| CR-01   | BLOCKER  | FIXED       | `src/search.ts`, `test/hybrid-ranking.test.ts`                                                              | `4566261` |
| WR-01   | WARNING  | FIXED       | `src/core.ts`, `test/hybrid-ranking.test.ts`                                                                | `072af42` |
| WR-02   | WARNING  | FIXED       | `src/hybrid-scoring.ts`, `src/core.ts`, `test/hybrid-scoring.test.ts`, `test/hybrid-ranking.test.ts`        | `f144588` |
| WR-03   | WARNING  | FIXED       | `src/core.ts` (comment-only)                                                                                | `8f5361e` |
| WR-04   | WARNING  | FIXED (auto)| (none — auto-resolved by CR-01)                                                                             | `4566261` |
| IN-01   | INFO     | DEFERRED    | Out-of-scope per `fix_scope=critical_warning` (refactor opportunity for `runHybridQuery` else-branch)       | —         |
| IN-02   | INFO     | DEFERRED    | Out-of-scope (T-08-04 explicitly accepted scoreAndRank/keywordScoreForEntry duplication)                    | —         |
| IN-03   | INFO     | DEFERRED    | Out-of-scope (cosmetic test comment refinement)                                                             | —         |

5/5 in-scope findings FIXED; 3/3 INFO findings deferred per fix policy.

---

## Requirements Coverage

| Requirement                       | Source Plan(s) | Description                                                                                  | Status   | Evidence                                                                                                                                                  |
| --------------------------------- | -------------- | -------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-v11-semantic-query-path       | 08-01, 08-02   | Per-query embedding + cosine similarity per tool vector                                      | SATISFIED | `src/core.ts:322-354` (embedQuery) + `src/core.ts:401` (cosineSimilarity per tool). Tests across hybrid-scoring + hybrid-ranking suites.                  |
| REQ-v11-hybrid-ranking            | 08-01, 08-02   | Final score `(semanticWeight·sem) + (keywordWeight·kw)` defaults 0.7/0.3                     | SATISFIED | `src/hybrid-scoring.ts:105-144` (combineHybrid) + `src/core.ts:432-437` (defaults coercion). Tests for default + custom + WR-02 partial weights coercion. |
| REQ-v11-role-filter-after-rank    | 08-02          | Role filter applied AFTER ranking (rank-then-filter pivot)                                   | SATISFIED | `src/core.ts:460-467` (hybrid) + `src/core.ts:493-499` (keyword fallback). Tests at `test/hybrid-ranking.test.ts:184-256` + CR-01 regression.             |
| REQ-v11-backward-compat           | 08-01, 08-02   | When `EmbeddingProvider` absent, code path byte-identical to v1.0                            | SATISFIED | Gate 4 (9 baseline test files byte-identical to cd1fc52) + P10 negative controls + Wave 0 empirical check (149 baseline against rank-then-filter).        |
| REQ-v11-session-invariants        | 08-02          | Schemas-loaded refs unchanged; "Unknown tool" denial unchanged                               | SATISFIED | `src/core.ts:251-257` (`buildSearchResponse` mutation block byte-identical to v1.0). `wrap.ts/build.ts` unchanged. Tests `hybrid-ranking.test.ts:570-651`. |

All 5 phase REQ-IDs from PLAN frontmatter SATISFIED. No orphaned requirements detected — REQUIREMENTS.md maps these 5 IDs exclusively to Phase 8.

---

## Test Surface Delta

| Metric                              | Pre-Phase-8 (cd1fc52) | Post-Phase-8 (HEAD) | Delta            |
| ----------------------------------- | --------------------- | ------------------- | ---------------- |
| Total tests                         | 124                   | 187                 | +63              |
| `test/hybrid-scoring.test.ts`       | (did not exist)       | 32                  | +32              |
| `test/hybrid-ranking.test.ts`       | (did not exist)       | 31                  | +31              |
| Coverage (statement)                | 99.61%                | 99.73%              | +0.12            |
| Coverage (branch)                   | ~95.87%               | 96.47%              | +0.60            |
| Coverage (functions)                | ~96.77%               | 97.36%              | +0.59            |
| Coverage (lines)                    | 99.64%                | 99.70%              | +0.06            |
| Files: `src/hybrid-scoring.ts`      | (did not exist)       | 145 lines, 100%     | new              |
| Files: `src/search.ts`              | 76 lines              | 163 lines (+keywordScoreForEntry, +Infinity) | additive (100% coverage retained) |
| Files: `src/core.ts`                | 256 lines             | 562 lines           | +306 lines (100% statement coverage) |

**Acceptance criteria match:** PLAYBOOK targeted +45 new tests; final delivery is +63 (24 unit + 25 integration + 13 review-fix regression + 1 deviation = 63). The over-shoot is from auto-fixed CR-01/WR-01/WR-02 regression tests added during the code-review fix loop.

---

## Anti-Patterns Found

None. Anti-pattern grep on `src/hybrid-scoring.ts`, `src/search.ts`, `src/core.ts`, `test/hybrid-scoring.test.ts`, `test/hybrid-ranking.test.ts` returned:
- Zero TODO/FIXME/XXX/HACK/PLACEHOLDER comments outside intentional `// LOCKED:` blocks (DEC-v11-08-02)
- Zero `return null` / `return []` / `return {}` patterns outside legitimate empty-input early returns
- Zero `console.log`-only stubs
- All `=> {}` no-op handlers are intentional defensive guards (try/catch for cosine dim mismatch with documented rationale)

---

## Human Verification Required

None. All 11 verification dimensions pass programmatically. Real-MiniLM perf budgets and intent-recall benchmarks are explicitly deferred to Phase 10's harness per VALIDATION.md Manual-Only Verifications section.

---

## Gaps Summary

No gaps. Phase 8 delivers:
- All 5 REQ-IDs (REQ-v11-semantic-query-path, REQ-v11-hybrid-ranking, REQ-v11-role-filter-after-rank, REQ-v11-backward-compat, REQ-v11-session-invariants).
- All 4 BLOCKING gates passing against `cd1fc52` baseline.
- All 4 pitfall negative controls (P7/P8/P9/P10) encoded.
- All 3 Phase 7 carry-forward review items (WR-01/WR-02/WR-03) RESOLVED.
- All 5 in-scope Phase 8 review findings (CR-01 BLOCKER + WR-01 + WR-02 + WR-03 + WR-04) FIXED.
- 187/187 tests passing (124 baseline byte-identical + 63 new).
- 99.73% statement coverage (above Phase 7's 99.61% baseline).
- `npm run typecheck && npm run build && npm test && npm run test:coverage` all green.

Phase 8 is production-ready and matches the 11/11 verification dimension PASS bar set by Phases 6 and 7.

---

_Verified: 2026-04-26T22:00:00Z_
_Verifier: Claude (gsd-verifier)_
