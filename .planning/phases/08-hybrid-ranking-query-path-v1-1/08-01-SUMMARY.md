---
phase: 08-hybrid-ranking-query-path-v1-1
plan: 01
subsystem: search
tags: [hybrid-ranking, cosine-similarity, min-max-normalization, pure-functions, vitest, typescript]

# Dependency graph
requires:
  - phase: 06-embedding-provider-interface-v1-1
    provides: "MCPackConfig.embeddings.weights typed (semanticWeight, keywordWeight)"
  - phase: 07-semantic-index-build-pipeline-v1-1
    provides: "semanticIndex Map<toolName, Float32Array> and isIndexReady() lifecycle"
provides:
  - "src/hybrid-scoring.ts pure-function module: cosineSimilarity, minMaxNormalize, combineHybrid"
  - "src/search.ts additive export keywordScoreForEntry(query, entry) for per-tool keyword scores"
  - "Regression invariant test: keywordScoreForEntry matches scoreAndRank inner-loop sum (Plan 08-02 contract)"
affects: [08-02 (hybrid query path), Phase 9 analytics, Phase 10 perf harness]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure scoring kernel sibling pattern (mirrors Phase 7 src/semantic-index-builder.ts)"
    - "Additive helper alongside untouched function (keywordScoreForEntry alongside scoreAndRank) — preserves baseline test byte-identicality"
    - "Module-private helpers (NOT re-exported from src/index.ts) — engine internals stay internal per Phase 02 DEC"
    - "Locked error-message format with sizes for diagnosability without RBAC leakage (no tool names)"
    - "Defensive zero-magnitude guard in cosineSimilarity (return 0 instead of NaN)"
    - "DEC-v11-08-02 degenerate min-max behavior: max === min → all zeros (no discriminating signal → drop track)"

key-files:
  created:
    - "src/hybrid-scoring.ts"
    - "test/hybrid-scoring.test.ts"
  modified:
    - "src/search.ts"

key-decisions:
  - "Pure-function kernel lives in dedicated src/hybrid-scoring.ts file (Phase 7 sibling-helper precedent) — keeps src/search.ts focused on keyword-only path"
  - "scoreAndRank function body left byte-identical (no helper extraction); keywordScoreForEntry duplicates inner-loop logic to avoid changing scoreAndRank's allocation pattern and risking test/search.test.ts behavior drift (T-08-04 disposition: accept duplication)"
  - "All four helpers are package-internal (not re-exported from src/index.ts) — public API surface unchanged"
  - "Added one extra test (non-monotonic input for minMaxNormalize) above plan's ≥14 floor to keep coverage ≥99.61% Phase 7 baseline (covers `if (s < min) min = s` branch)"

patterns-established:
  - "Pattern: Pure scoring math in dedicated module — testable in isolation without engine construction or session lifecycle"
  - "Pattern: Locked error-message regex assertions (`/^MCPack: cosine similarity dimension mismatch \\(a\\.length=\\d+, b\\.length=\\d+\\)$/`) — diagnosability contract for caller bugs"
  - "Pattern: REGRESSION INVARIANT test marker — explicitly labels tests that lock a contract for downstream plans (08-02 hybrid path)"

requirements-completed:
  - REQ-v11-semantic-query-path
  - REQ-v11-hybrid-ranking
  - REQ-v11-backward-compat

# Metrics
duration: 14min
completed: 2026-04-27
---

# Phase 8 Plan 1: Hybrid Scoring Kernel Summary

**Pure-function hybrid scoring kernel (`cosineSimilarity`, `minMaxNormalize`, `combineHybrid`) plus additive `keywordScoreForEntry` helper, validated by 25 unit tests (incl. scoreAndRank regression invariant) — zero new deps, baseline byte-identical, coverage 99.68% (above Phase 7's 99.61%).**

## Performance

- **Duration:** 14 min
- **Started:** 2026-04-27T01:08:25Z
- **Completed:** 2026-04-27T01:22:25Z
- **Tasks:** 3 (all atomic, all committed)
- **Files modified:** 3 (1 modified, 2 created)
- **Tests:** 124 → 149 (+25 new); all 4 BLOCKING gates PASS against baseline `cd1fc52`

## Accomplishments

- **Pure scoring kernel shipped** — `src/hybrid-scoring.ts` (116 lines, zero imports) with 3 exports: `cosineSimilarity` (Float32Array, defensive zero-magnitude guard, throws on dim mismatch), `minMaxNormalize` (DEC-v11-08-02 all-zeros on `max === min` degenerate), `combineHybrid` (element-wise weighted, throws on length mismatch).
- **Additive `keywordScoreForEntry` export added to `src/search.ts`** — extracts the per-tool inner-loop sum that `scoreAndRank` already computes. `scoreAndRank` body byte-identical; `test/search.test.ts` baseline preserved; new helper not re-exported from `src/index.ts`.
- **25 unit tests in new `test/hybrid-scoring.test.ts` file** — 4 describe groups (cosineSimilarity 6, minMaxNormalize 7, combineHybrid 6, keywordScoreForEntry 6) plus the locked REGRESSION INVARIANT test (`keywordScoreForEntry` matches `scoreAndRank` ranking) that Plan 08-02's hybrid path will rely on as a contract.
- **Coverage went UP**, not down: 99.61% → 99.68% statement (above Phase 7 baseline). `src/hybrid-scoring.ts` and `src/search.ts` both 100% across stmts/branches/funcs/lines.
- **All 4 BLOCKING gates PASS** against baseline `cd1fc52`: zero new deps, `src/index.ts` unchanged, zero adapter literals in src/+test/, 9 baseline test files byte-identical.

## Task Commits

Each task was committed atomically with `--no-verify` (parallel-executor protocol):

1. **Task 1: Create src/hybrid-scoring.ts with three pure-function exports** — `83e8225` (feat)
2. **Task 2: Add additive `keywordScoreForEntry` export to src/search.ts** — `2ecf6f8` (feat)
3. **Task 3: Create test/hybrid-scoring.test.ts with 25 unit tests** — `9363a06` (test)

_All tasks were `tdd="true"` in the plan but the planner authored RED+GREEN as a single commit per task: Tasks 1+2 ship implementation, Task 3 ships the comprehensive test suite. Both Task 1 and Task 2 verifications confirmed `npm test` reported 124 (baseline preserved at impl-only step), and Task 3 verification confirmed 149 (124 + 25 new). Coverage and BLOCKING gates re-verified at plan close._

## Files Created/Modified

- **`src/hybrid-scoring.ts`** (created, 116 lines) — Three pure-function exports for hybrid ranking math. Module-private. Zero imports.
- **`src/search.ts`** (modified, 76 → 143 lines, additive only) — `scoreAndRank` and 5 score-weight constants byte-identical; new `keywordScoreForEntry` export appended at EOF.
- **`test/hybrid-scoring.test.ts`** (created, 301 lines, 25 tests) — Unit tests for the four new helpers, including the REGRESSION INVARIANT contract for Plan 08-02.

## Decisions Made

- **Followed plan's recommended file split:** new `src/hybrid-scoring.ts` for pure math (Phase 7 sibling precedent), additive helper in `src/search.ts` for keyword scoring. Rejected alternatives: extending `src/search.ts` with all four exports (mixed concerns), refactoring `scoreAndRank` to call `keywordScoreForEntry` (would change allocation pattern, risk subtle baseline drift — T-08-04 accept).
- **Locked-error-message format includes sizes:** `MCPack: cosine similarity dimension mismatch (a.length=2, b.length=3)` — diagnosable, no RBAC-sensitive content (T-08-06 accept).
- **Added one above-plan test (the 25th):** non-monotonic input `[10, 5, 15]` for `minMaxNormalize` to exercise the `if (s < min) min = s` branch — without it, coverage dropped to 99.36% (below Phase 7's 99.61% floor). With it, 99.68%. Documented as deviation Rule 2 below.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added one extra `minMaxNormalize` test for non-monotonic input to keep coverage ≥99.61%**

- **Found during:** Task 3 (after writing the planned ≥14 tests, ran `npm run test:coverage`)
- **Issue:** With the planned test set, `src/hybrid-scoring.ts` line 73 (`if (s < min) min = s;`) was uncovered because all minMaxNormalize fixtures (`[5]`, `[0, 10]`, `[5, 10, 15]`, `[7, 7, 7]`, `[-1, 0, 1]`) were ascending or constant — none had a value smaller than `scores[0]`. Result: file 97.29% statement, project 99.36% — below the 99.61% Phase 7 baseline that the plan's Coverage Targets table mandates ("Coverage MUST NOT regress below Phase 7's 99.61% baseline").
- **Fix:** Added one more test in the `minMaxNormalize` describe block: `'handles non-monotonic input where later values are smaller than earlier'` — input `[10, 5, 15]`, expected `[0.5, 0, 1]`. Exercises the descending-min branch.
- **Files modified:** `test/hybrid-scoring.test.ts`
- **Verification:** Re-ran `npm run test:coverage` — `hybrid-scoring.ts` 100% across all metrics, project 99.68% statement (above Phase 7 baseline). Total tests: 25 (one above the planned 24).
- **Committed in:** `9363a06` (Task 3 commit, alongside the planned 24 tests)

---

**Total deviations:** 1 auto-fixed (Rule 2 — missing critical test for coverage gate)
**Impact on plan:** Tiny additive — one extra test (25 vs planned 24, both ≥ floor of 14). Coverage requirement met. No scope creep, no API change, no extra files.

## Issues Encountered

- **None significant.** Worktree base required hard-reset from `f1072921` to `2c97e75` at startup (worktree was created off the wrong commit) — handled per `<worktree_branch_check>` protocol with no impact on plan execution.
- **Pre-existing dirty state on `.planning/STATE.md`** observed in `git status`. Not modified by this plan (parallel-executor rule: orchestrator owns STATE.md). Left as-is in the worktree.

## Verification Output (literal — pasted to prove gates)

**Gate 1 — Zero new core deps (broadened jq selector):**
```
$ diff <(jq -S '{deps:(.dependencies // {}), peers:(.peerDependencies // {}), optional:(.optionalDependencies // {}), bundled:(.bundledDependencies // [])}' package.json) \
       <(git show cd1fc52:package.json | jq -S '{deps:(.dependencies // {}), peers:(.peerDependencies // {}), optional:(.optionalDependencies // {}), bundled:(.bundledDependencies // [])}')
(empty diff)
```

**Gate 2 — `src/index.ts` byte-identical to baseline:**
```
$ git diff cd1fc52 -- src/index.ts
(empty diff — 0 lines)
```

**Gate 3 — Adapter isolation (zero matches in src/ + test/):**
```
$ grep -rE "@llvs/mcpack-embeddings|@huggingface/transformers|@xenova/transformers" src/ test/
(zero matches)
```

**Gate 4 — Baseline test files byte-identical (9 files):**
```
$ git diff cd1fc52 -- test/build.test.ts test/core.test.ts test/index-builder.test.ts test/roles.test.ts test/search.test.ts test/session.test.ts test/types.test.ts test/wrap.test.ts test/semantic-index-build.test.ts
(empty diff — 0 lines)
```

**Test summary:**
```
Test Files  10 passed (10)
     Tests  149 passed (149)
   Duration  ~200ms
```

**Coverage summary (vs Phase 7 baseline 99.61%):**
```
File               | % Stmts | % Branch | % Funcs | % Lines
All files          |   99.68 |    95.87 |   96.77 |   99.64
 hybrid-scoring.ts |     100 |      100 |     100 |     100
 search.ts         |     100 |      100 |     100 |     100
 ...other files unchanged from Phase 7 baseline
```

## Requirements Coverage

| Req ID | Tests Mapped | Status |
|--------|--------------|--------|
| REQ-v11-semantic-query-path | Group 1 (cosineSimilarity, 6 tests including 384-dim MiniLM-shape vector test) | PASS |
| REQ-v11-hybrid-ranking | Group 2 (minMaxNormalize, 7 tests inc. DEC-v11-08-02 all-zeros degenerate) + Group 3 (combineHybrid, 6 tests inc. locked formula 0.7·sem + 0.3·kw) | PASS |
| REQ-v11-backward-compat | Group 4 REGRESSION INVARIANT (keywordScoreForEntry matches scoreAndRank inner-loop sum) + Gate 4 (9 baseline test files byte-identical to cd1fc52) | PASS |

## User Setup Required

None — no external service configuration required. Plan 08-01 ships pure-function math + unit tests only.

## Next Phase Readiness

**Plan 08-02 (Wave 2) can begin immediately.** Its hybrid path will import the four new helpers — `cosineSimilarity`, `minMaxNormalize`, `combineHybrid` from `src/hybrid-scoring.ts` and `keywordScoreForEntry` from `src/search.ts` — and consume the keyword-score regression invariant as a contract.

**Forward links to Plan 08-02:**
- 08-02 will use these helpers inside `MCPackEngine.handleSearchTools` to wire the hybrid query path.
- 08-02 will add `MCPackEngine.hasVectors()` (DEC-v11-08-03) to gate hybrid vs v1.0-keyword fallback.
- 08-02 will encode the four pitfall negative controls (P7, P8, P9, P10) and the WR-02 unhandled-rejection regression test.

## Self-Check: PASSED

- [x] `src/hybrid-scoring.ts` exists (verified `test -f`)
- [x] `src/search.ts` modified additively (verified diff starts at line 74; existing scoreAndRank unchanged)
- [x] `test/hybrid-scoring.test.ts` exists (verified `test -f`)
- [x] Task 1 commit `83e8225` exists in `git log --oneline`
- [x] Task 2 commit `2ecf6f8` exists in `git log --oneline`
- [x] Task 3 commit `9363a06` exists in `git log --oneline`
- [x] All 4 BLOCKING gates PASS (re-verified at plan close)
- [x] `npm run typecheck && npm run build && npm test && npm run test:coverage` all green
- [x] Coverage 99.68% statement (above Phase 7 baseline 99.61%)
- [x] 149 tests pass (124 baseline + 25 new) — baseline byte-identical
- [x] Three new exports module-private (NOT in `src/index.ts`)

---
*Phase: 08-hybrid-ranking-query-path-v1-1*
*Completed: 2026-04-27*
