---
phase: 7
plan: 2
subsystem: tests
tags: [v1.1, semantic-search, test-coverage, validation, additive]
requires:
  - Plan 07-01 (MCPackEngine.semanticIndex + indexBuildPromise + isIndexReady() + buildSemanticIndex())
provides:
  - test/semantic-index-build.test.ts (17 tests across 7 describe groups)
  - Programmatic acceptance for REQ-v11-semantic-index-build, REQ-v11-tools-list-no-regression, REQ-v11-perf-budget
  - Pitfall 7 negative-control (zero console.warn during handleSearchTools build-pending)
  - RBAC-invariant test (no tool names in build-failure warn)
affects:
  - test/ (new file only — 8 baseline test files byte-identical)
tech-stack:
  added: []          # zero new dependencies — Gate 1 enforced
  patterns:
    - "Inline deterministic mock provider (8-dim hashed vectors), offline + reproducible"
    - "(engine as any).indexBuildPromise test-synchronization escape hatch (RESEARCH §Pattern 2)"
    - "vi.spyOn(console, 'warn').mockImplementation() + restoreAllMocks in afterEach"
    - "Inline makeTool helper mirrors test/core.test.ts:6-19 (self-contained-test-files convention)"
key-files:
  created:
    - test/semantic-index-build.test.ts (363 lines, 17 tests)
  modified: []
decisions:
  - "Deterministic 8-dim hash mock keeps tests sub-ms — fast, offline, reproducible"
  - "Test-sync via await (engine as any).indexBuildPromise — never setTimeout polls (Don't-Hand-Roll test-timing row)"
  - "Group 5 spies AFTER engine construction so success-path warns aren't observed; isolates handleSearchTools warn-surface only (Pitfall 7 negative control)"
  - "Inline mock provider — zero adapter package imports preserves Gate 3"
  - "50ms timing assertion (not 10ms) per CONTEXT §Build Lifecycle; the slow-provider 50ms is a synchronization marker, not a perf budget"
metrics:
  duration: "~10m (read context → write tests → verify gates → commit → summary)"
  completed: "2026-04-26T22:16:28Z"
  baseline_tests_preserved: "107/107 byte-identical"
  new_tests: 17
  total_tests: 124
  statement_coverage_post_07_02: "99.61%"
  statement_coverage_post_07_01: "89.18%"
  statement_coverage_phase_6_baseline: "99.56%"
  lines_added_test: 363
  lines_added_src: 0
---

# Phase 7 Plan 2: Phase 7 Test Suite Summary

Wave 2 of Phase 7. Added comprehensive test coverage for Plan 07-01's
semantic index build pipeline. 17 tests across 7 describe groups exercise
every must-have truth declared in 07-01 and provide programmatic acceptance
for all three Phase 7 requirement IDs. Coverage restored from 89.18%
(post-Wave-1 intermediate) to 99.61% — exceeds the ≥99% floor and the
99.56% Phase 6 baseline.

## What Was Added

### New file: `test/semantic-index-build.test.ts` (363 lines, 17 tests)

| Group | Tests | What it asserts |
|-------|------:|-----------------|
| 1. build kickoff | 3 | embeddings absent → no kickoff; embeddings.provider set → kickoff + ready; empty tool surface → no-op (provider not invoked, semanticIndex.size === 0) |
| 2. indexing string composition | 2 | single-batch locked format `name + " " + description + " " + paramNames.join(" ")`; bare tool collapses to just the name via .trim() |
| 3. storage shape & dim-consistency | 3 | Float32Array vectors keyed by tool name; provider returning inconsistent dims → isIndexReady false; provider returning wrong vector count → isIndexReady false |
| 4. non-blocking constructor + tools/list | 3 | constructor returns < 50ms even with 50ms-slow provider; handleToolsList works while build is in flight; handleSearchTools falls back to keyword scoring when isIndexReady is false |
| 5. build-failure semantics + warning-surface negative control | 3 | provider rejection → console.warn(`MCPack: semantic index build failed: ...`); RBAC invariant — NO tool names in warn text; Pitfall 7 — handleSearchTools during build-pending emits ZERO warnings |
| 6. performance bounds (mock-level) | 2 | 50-tool mock build < 1s wall-clock; 50-tool 384-dim Float32Array storage = exactly 76,800 bytes (< 2 MB ceiling) |
| 7. regression: byte-identical v1.0 path when embeddings absent | 1 | engine without embeddings → 0 provider calls, isIndexReady false, semanticIndex null, indexBuildPromise undefined |

Mock provider is inline (8-dim, hash-derived), offline, deterministic, and
sub-millisecond — zero adapter imports, zero network, zero model load.

## Test Run Output

### Targeted run

```
$ npm test -- semantic-index-build.test.ts
 Test Files  1 passed (1)
      Tests  17 passed (17)
   Duration  103ms
```

### Full suite run

```
$ npm test
 Test Files  9 passed (9)
      Tests  124 passed (124)
   Duration  185ms
```

107 baseline + 17 new = 124, exactly per plan. All 9 test files green.

## Three [BLOCKING] Gates — Output

### Gate 1 — Zero-new-core-deps (broadened selector)

```bash
$ diff <(jq -S '{deps:(.dependencies // {}), peers:(.peerDependencies // {}), \
                 optional:(.optionalDependencies // {}), \
                 bundled:(.bundledDependencies // [])}' package.json) \
       <(git show bec3f6f:package.json | jq -S '{deps:(.dependencies // {}), \
                 peers:(.peerDependencies // {}), \
                 optional:(.optionalDependencies // {}), \
                 bundled:(.bundledDependencies // [])}')
$ echo "exit=$?"
exit=0
```

Empty diff. PASS.

### Gate 2 — Public-API src unchanged

```bash
$ git diff bec3f6f -- src/index.ts
$ echo "lines=$(git diff bec3f6f -- src/index.ts | wc -l)"
lines=       0
```

Empty diff. PASS.

### Gate 3 — Adapter isolation across BOTH src/ and test/

```bash
$ grep -rE "@llvs/mcpack-embeddings|@huggingface/transformers|@xenova/transformers" src/ test/
$ echo "exit=$?"
exit=1
```

Zero matches (grep exit 1 = no match). PASS.

### Gate 4 — Regression: v1.0 + Phase 6 test files byte-identical

```bash
$ git diff bec3f6f -- test/build.test.ts test/core.test.ts test/index-builder.test.ts \
                       test/roles.test.ts test/search.test.ts test/session.test.ts \
                       test/types.test.ts test/wrap.test.ts
$ echo "lines=$(git diff bec3f6f -- ... | wc -l)"
lines=       0
```

Empty diff. PASS.

## Coverage Delta

```
$ npm run test:coverage
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-------------------|---------|----------|---------|---------|-------------------
All files          |   99.61 |    95.18 |   96.29 |   99.57 |
 build.ts          |     100 |    94.73 |     100 |     100 | 110,153
 core.ts           |     100 |    93.75 |     100 |     100 | 78,238
 index-builder.ts  |     100 |      100 |     100 |     100 |
 roles.ts          |     100 |      100 |     100 |     100 |
 search.ts         |     100 |      100 |     100 |     100 |
 ...dex-builder.ts |     100 |      100 |     100 |     100 |
 session.ts        |     100 |      100 |     100 |     100 |
 types.ts          |       0 |        0 |       0 |       0 |
 wrap.ts           |   97.61 |    86.66 |   71.42 |   97.61 | 59
```

| Metric | Phase 6 baseline | Post-07-01 (intermediate) | Post-07-02 (this plan) |
|--------|------------------|---------------------------|------------------------|
| Statement coverage | 99.56% | 89.18% | **99.61%** |
| `core.ts` stmt coverage | ~98% | 62.26% | **100%** |
| `semantic-index-builder.ts` | n/a | 0% | **100%** |

Coverage exceeds the ≥99% floor AND the Phase 6 99.56% baseline. The two
remaining uncovered statements in `core.ts` (lines 78, 238) are pre-existing
defensive paths from baseline (line 78 is the `.catch` `String(err)` branch
when err is not an Error instance — a defensive cast that no realistic test
provider triggers). `types.ts` 0% is the pre-existing baseline pattern
(types-only file, no executable statements).

## Static-Check Receipts (Plan 07-02 Verify Block)

| Check | Expected | Actual |
|-------|----------|--------|
| `test -f test/semantic-index-build.test.ts` | exit 0 | exit 0 |
| `wc -l test/semantic-index-build.test.ts` | ≥ 200 | 363 |
| `grep -c "^    it(" test/semantic-index-build.test.ts` | ≥ 17 | 17 |
| `npm test -- semantic-index-build.test.ts` | exit 0, 17 tests | exit 0, 17 tests |
| `npm test` total tests | ≥ 124 | 124 |
| `npm run test:coverage` statement % | ≥ 99% | 99.61% |
| Gate 1 `package.json` deps diff vs bec3f6f | empty | empty |
| Gate 2 `src/index.ts` diff vs bec3f6f | empty | empty |
| Gate 3 adapter literals in src/+test/ | 0 | 0 |
| Gate 4 baseline test files diff vs bec3f6f | empty | empty |
| `grep -cE "MCPack: semantic index build failed:" test/semantic-index-build.test.ts` | ≥ 1 | 1 |
| `grep -cE "(create_customer|list_payments|refund_charge)" test/semantic-index-build.test.ts` | ≥ 4 | 16 |
| `grep -cE "setTimeout.*resolve" test/semantic-index-build.test.ts` | ≤ 4 | 4 |
| `grep -cE "indexBuildPromise" test/semantic-index-build.test.ts` | ≥ 8 | 16 |
| `grep -cE "toHaveBeenCalledTimes\(0\)" test/semantic-index-build.test.ts` | ≥ 1 | 1 |
| `grep -cE "toBeLessThan\(50\)" test/semantic-index-build.test.ts` | ≥ 1 | 1 |
| `grep -cE "toBeLessThan\(10\)" test/semantic-index-build.test.ts` | 0 | 0 |

All static checks pass.

## Requirements Coverage

| Req ID | Tests Mapped | Status |
|--------|--------------|--------|
| REQ-v11-semantic-index-build | Group 1 (kickoff), Group 2 (indexing strings), Group 3 (storage shape + dim-consistency), Group 5 (failure path + warning-surface negative control) | PASS |
| REQ-v11-tools-list-no-regression | Group 4 (non-blocking constructor + tools/list works during build) + Group 7 (regression: zero provider calls when embeddings absent) + 107-baseline regression gate | PASS |
| REQ-v11-perf-budget | Group 6 (50-tool mock build < 1s; 50-tool 384-dim storage = 76,800 bytes < 2 MB) — mock-level only; real-MiniLM 5s deferred to Phase 10's harness | PASS |

Every Phase 7 requirement now has at least one programmatic acceptance test.

## Pitfall 7 Negative Control (Programmatic Enforcement of Must-Have Truth #14)

Group 5's third test (`handleSearchTools during build-pending state emits NO
warnings`) spies on `console.warn` AFTER engine construction (so the
constructor's success path is not observed), then issues 3 queries while
`isIndexReady()` is false. The assertion `expect(warnSpy).toHaveBeenCalledTimes(0)`
guards against a future regression where an executor reads CONTEXT.md's
"fallback to keyword + log warning" phrasing literally and adds a per-query
warn inside `handleSearchTools` — which would flood Phase 10's real-MiniLM
harness logs and violate the warning-surface invariant captured in 07-01's
must_haves truth #14.

## RBAC Invariant Test

Group 5's second test (`build-failure log message contains NO tool names`)
constructs an engine with three named tools (`create_customer`,
`list_payments`, `refund_charge`), forces a provider rejection, and asserts
NONE of those names appear in the captured warn text. This is the
programmatic counterpart to Threat T-07-01 (Information Disclosure via warn).
The 07-01 implementation already enforces this — the warn line is `${err.message}`
only — but the test locks in the contract for future maintenance.

## Deviations from Plan

None. The plan provided exact test-file content; the executor wrote it
verbatim and ran the full verify block. All 4 [BLOCKING] gates passed on
first attempt. Coverage exceeded floor on first run (99.61% vs ≥99% target).
17/17 tests passed on first run.

## Threat Surface Scan

Reviewed Plan 07-02's `<threat_model>` (T-07-09 through T-07-12) against the
delivered test file:

| Threat | Status | Notes |
|--------|--------|-------|
| T-07-09 (bracket-access leaks `semanticIndex` shape) | accept | Pattern documented in RESEARCH §Pattern 2; future Phase 8 can refactor if it wants — these inspections aren't part of the public contract. |
| T-07-10 (failure-message string codified in tests) | mitigate | Group 5's RBAC-invariant test asserts NO tool names appear → strengthens security posture. The `MCPack: semantic index build failed:` prefix is intentionally public. |
| T-07-11 (perf test flakes under heavy CI load) | accept | 1000ms budget is 1000× the mock's actual sub-ms runtime; 50ms sync-return budget is 5× headroom on cold V8 caches. |
| T-07-12 (future executor adds per-query warn) | mitigate | Group 5's Pitfall 7 negative control test asserts `console.warn` called 0 times during handleSearchTools build-pending queries. |

No new threat surface discovered beyond the plan's existing `<threat_model>`.
No `## Threat Flags` section added.

## Self-Check: PASSED

Files claimed:
- FOUND: `/Users/zaid/Projects/MCPack/.claude/worktrees/agent-a490bd5db4704844d/test/semantic-index-build.test.ts`

Commits claimed:
- FOUND: `6d4f208` — `test(07-02): add Phase 7 semantic-index-build test suite`

All baseline tests still passing: 107/107.
17 new Phase 7 tests passing: 17/17.
Total tests passing: 124/124.
All four [BLOCKING] gates pass against bec3f6f.
Statement coverage 99.61% (≥99% floor; ≥99.56% Phase 6 baseline).

## Forward Link

Phase 7 complete. Phase 8 will consume `engine.isIndexReady()` and
`engine['semanticIndex']` to wire the hybrid query path:
- Embed the user query through `config.embeddings.provider`
- Compute cosine similarity against `semanticIndex` (parallel-array dense Float32Array)
- Combine semantic score with v1.0 keyword score per DEC-v11-12 (default weights 0.7 semantic / 0.3 keyword)
- Apply role-filter after rank (Phase 8 ranking-layer concern)
- Route to v1.0 keyword path when `isIndexReady()` returns false (build still in flight or failed)

The 17 tests in this plan validate the contract Phase 8 will rely on.
