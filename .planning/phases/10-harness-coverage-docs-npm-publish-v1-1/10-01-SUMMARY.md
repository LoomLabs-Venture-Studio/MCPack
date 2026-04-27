---
phase: 10-harness-coverage-docs-npm-publish-v1-1
plan: 10-01
subsystem: testing
tags: [harness, benchmark, perf, recall, minilm, stripe-mcp, hybrid-ranking, v1.1-ga]

requires:
  - phase: 06-embedding-provider-interface-v1-1
    provides: EmbeddingProvider interface + adapter package layout
  - phase: 07-semantic-index-build-pipeline-v1-1
    provides: build lifecycle + hasVectors() + handleToolsList no-block invariant
  - phase: 08-hybrid-ranking-query-path-v1-1
    provides: hybrid scoring + role-filter-after-rank pivot
  - phase: 09-tool-usage-analytics-v1-1
    provides: 234-test floor + 99.78% statement coverage + Phase 9 close-out (d732eaa)

provides:
  - Canonical v1.1-release-report.md (4 PRD numerical targets, downstream Plans 10-02 + 10-03 quote)
  - 50-query intent benchmark corpus + runner (Gate 6b — recall@5 +15pp)
  - Real-MiniLM perf bench + tools/list no-regression microbench (Gates 6c, 6d, perf-memory, REQ-v11-tools-list-no-regression)
  - Stripe harness extended additively with hybrid measurement (Gate 6a)
  - npm run benchmark + npm run perf-bench scripts

affects:
  - 10-02-docs (CHANGELOG quotes the headline numbers)
  - 10-03-publish (pre-publish checklist re-runs harness with operator's STRIPE_SECRET_KEY)

tech-stack:
  added: []  # ZERO new dependencies — Gate 1 trivially preserved
  patterns:
    - "Dynamic adapter import in harness (defer @huggingface/transformers resolution past API-key skip gate)"
    - "Engine-internals access via narrow type cast (offline measurement infrastructure — DEC-v11-10-05)"
    - "Three-report pattern (Stripe + intent + perf) feeding one canonical release report"
    - "tools/list no-regression microbench measured BEFORE semantic build resolves"

key-files:
  created:
    - test/harness/intent-benchmark-queries.json
    - test/harness/intent-benchmark.ts
    - test/harness/perf-bench.ts
    - .planning/phases/10-harness-coverage-docs-npm-publish-v1-1/v1.1-release-report.md
    - .planning/phases/10-harness-coverage-docs-npm-publish-v1-1/10-01-PLAN.md  (canonical, restored)
    - .planning/phases/10-harness-coverage-docs-npm-publish-v1-1/10-02-PLAN.md  (canonical, restored)
    - .planning/phases/10-harness-coverage-docs-npm-publish-v1-1/10-03-PLAN.md  (canonical, restored)
  modified:
    - test/harness/stripe-harness.ts  (ADDITIVE — measureHybrid block; not in Gate 4 protected list)
    - package.json  (scripts only; deps + peers UNCHANGED — Gate 1 preserved)
    - .gitignore  (ignore intent + perf report.json output artefacts)

key-decisions:
  - "Use relative + dynamic import for adapter from harness (worktree has no adapter node_modules; main repo does). Keeps Gate 1 trivially preserved and lets the v1.0 keyword harness path remain runnable when STRIPE_SECRET_KEY or @huggingface/transformers is absent."
  - "Add tools/list no-regression microbench INSIDE perf-bench.ts (REQ-v11-tools-list-no-regression — plan must_haves line 30). Measured BEFORE the semantic build resolves to verify Phase 7's locked invariant (handleToolsList never blocks on in-flight build)."
  - "Defer Gates 6a + 6b measurement to Plan 10-03 pre-publish (no STRIPE_SECRET_KEY in this execution env). The release report explicitly tags both as SKIPPED with re-run commands; Plan 10-03's pre-publish checklist is the canonical re-measurement point before BOARD APPROVAL."

patterns-established:
  - "Dynamic-import-after-skip-gate: load heavy provider only after the early-exit checks pass. Keeps cheap commits cheap and avoids spurious ERR_MODULE_NOT_FOUND in environments without adapter deps."
  - "Three-report → one-report pattern: each measurement runner writes its own gitignored JSON report; one committed Markdown report references all three with reproducible re-run commands."

requirements-completed:
  - REQ-v11-perf-budget          # measured: index_build_ms 216.6, p99 delta 3.057, vector_bytes 76,800 — all PASS
  - REQ-v11-tools-list-no-regression  # measured: tools_list_delta_ms 0.000 — PASS

duration: 54 min
completed: 2026-04-27
---

# Phase 10 Plan 10-01: Harness, Intent Benchmark & Perf Measurement Summary

**Authored 50-query intent benchmark + real-MiniLM perf bench + Stripe-harness hybrid extension; produced the canonical v1.1-release-report.md that Plans 10-02 and 10-03 quote. Three perf gates and the test-floor PASS locally; Stripe-dependent gates DEFERRED to Plan 10-03 pre-publish re-run with operator's STRIPE_SECRET_KEY.**

## Performance

- **Duration:** 54 min
- **Started:** 2026-04-27T16:26:58Z
- **Completed:** 2026-04-27T17:21:17Z
- **Tasks:** 3 + 2 setup commits (canonical PLAN.md restoration; alignment fixes)
- **Files modified:** 11 (4 source created, 1 source extended, 2 config edited, 4 PLAN.md/REPORT created)

## Accomplishments

- **Three-report measurement infrastructure shipped.** `test/harness/intent-benchmark.ts` (recall@5 vs Stripe MCP), `test/harness/perf-bench.ts` (real-MiniLM index build + p99 + tools/list no-regression), and the additively-extended `test/harness/stripe-harness.ts` (hybrid token-reduction). All three gracefully skip when STRIPE_SECRET_KEY is unset; perf-bench runs offline once MiniLM is cached.
- **Canonical v1.1-release-report.md committed.** Quotes every measured number from a JSON report on disk. Stripe-dependent gates (6a + 6b) are explicitly marked SKIPPED with re-run commands so Plan 10-03's pre-publish task knows exactly what to update.
- **All 5 carry-forward BLOCKING gates PASS.** Phase 10 maintained zero source/test changes outside `test/harness/`. Gate 3 used the REVISED `--exclude-dir=harness` form (DEC-v11-10-05). 234/234 tests still pass at HEAD vs `d732eaa` baseline.

## Task Commits

Each task was committed atomically (all with `--no-verify` per parallel-execution convention):

1. **Setup: Restore Plan 10-01 placeholder** — `357ed66` (docs) — initial author of 10-01-PLAN.md before discovering the canonical was on disk in main repo.
2. **Task 1: 50-query intent benchmark + runner + npm run benchmark** — `4173fb3` (feat) — corpus, runner, package.json + .gitignore.
3. **Task 2: Real-MiniLM perf benchmark + npm run perf-bench** — `d34b1c9` (feat) — 50-tool synthetic corpus, p99 measurement, vector-byte audit.
4. **Setup: Land canonical Phase 10 plans** — `33dfafd` (docs) — supersedes 357ed66 with the planner's canonical 10-01/10-02/10-03 PLAN.md files (Rule 3).
5. **Alignment: category rename + tools/list microbench** — `da9bc22` (fix) — rename `easy` → `easy_keyword` in queries; add tools/list no-regression microbench to perf-bench (Rule 2 — missing critical functionality per plan must_haves line 30).
6. **Task 3: v1.1-release-report.md** — `a2e5215` (docs) — canonical report with all measured numbers + SKIPPED tags for Stripe gates + reproducibility runbook.

## Files Created/Modified

- `test/harness/intent-benchmark-queries.json` — 50-query corpus (10 easy_keyword + 20 paraphrased + 10 abbreviation + 10 typo_or_partial). Each entry: `{ category, query, expectedTool }`.
- `test/harness/intent-benchmark.ts` — recall@5 runner. Spawns `@stripe/mcp`, builds keyword + hybrid `MCPackEngine`, drives `search_tools` through both, computes recall with zero-information exclusion. Writes `intent-benchmark-report.json`.
- `test/harness/perf-bench.ts` — perf runner. 50-tool synthetic corpus, real MiniLM via `createMiniLMProvider()`, index_build_ms + p99 search delta + vector_bytes + tools/list no-regression microbench. Writes `perf-bench-report.json`.
- `test/harness/stripe-harness.ts` — EXTENDED additively with `measureHybrid(tools, vanillaChars)`. Dynamic-imports the adapter inside the function (post-API-key-check) so the v1.0 keyword block is byte-identical to baseline behaviour.
- `package.json` — added `npm run benchmark` and `npm run perf-bench` scripts. `dependencies` + `peerDependencies` UNCHANGED (Gate 1).
- `.gitignore` — added `test/harness/intent-benchmark-report.json` and `test/harness/perf-bench-report.json` (output artefacts, not source).
- `.planning/phases/10-harness-coverage-docs-npm-publish-v1-1/v1.1-release-report.md` — canonical release measurement report.
- `.planning/phases/10-harness-coverage-docs-npm-publish-v1-1/10-01-PLAN.md`, `10-02-PLAN.md`, `10-03-PLAN.md` — canonical plans restored from main repo (the planning commit message claimed they were authored, but the files were never committed; restored as Rule 3 fixes).

## Decisions Made

1. **Adapter import via dynamic + relative path** — `await import('../../packages/mcpack-embeddings/src/index.js')` inside the runtime branches that actually need MiniLM. Resolves cleanly in main repo (where adapter has its own `node_modules`); falls through gracefully in worktree (no adapter deps installed) and in environments without `STRIPE_SECRET_KEY`. Keeps Gate 1 (zero new core deps) and Gate 3 REVISED (no `@llvs/mcpack-embeddings` literal outside harness) trivially preserved.
2. **Engine-internals via narrow type cast** — `(engine as unknown as { hasVectors(): boolean })`. Phase 10 makes ZERO source changes (Gate 2), so the harness cannot rely on the public `MCPackHandle` for measurement (the public handle does not expose `hasVectors`). The cast is harness-local convention; the underlying API is `MCPackEngine.hasVectors()` which is locked by Phase 7/8 tests.
3. **Stripe gates DEFERRED to Plan 10-03 pre-publish re-run** — STRIPE_SECRET_KEY not present in execution env. Gates 6a + 6b explicitly tagged SKIPPED in the release report with re-run commands. Plan 10-03's pre-publish checklist re-runs `npm run harness` and `npm run benchmark` with the operator's key and updates the report inline before BOARD APPROVAL.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking issue] Missing PLAN.md files**
- **Found during:** Setup (load_plan).
- **Issue:** The Phase 10 planning commit `6c34a92` claimed plans were authored ("Phase 10 plans authored + verified, ready for execute") but only updated `PLAYBOOK.md`. The actual `10-01-PLAN.md`, `10-02-PLAN.md`, `10-03-PLAN.md` were authored on disk in the main repo but never committed. Worktree had no plans to execute.
- **Fix:** Authored a placeholder `10-01-PLAN.md` from the orchestrator's prompt success criteria + CONTEXT/RESEARCH/VALIDATION (commit `357ed66`). Then on discovering the canonical plans existed in main repo as untracked files, replaced the placeholder with the canonical version and added 10-02/10-03 (commit `33dfafd`). Subsequent alignment adjustments made in commit `da9bc22`.
- **Files modified:** `.planning/phases/10-harness-coverage-docs-npm-publish-v1-1/{10-01,10-02,10-03}-PLAN.md`.
- **Verification:** All three canonical plans now committed at `33dfafd`. `wc -l` confirms 659 + 511 + 922 lines.

**2. [Rule 2 — Missing critical functionality] tools/list no-regression microbench**
- **Found during:** Task 2 close (after canonical plan landed and `must_haves` line 30 was visible).
- **Issue:** Original Task 2 implementation only measured `search_tools` p99 + index_build + vector_bytes. The canonical plan requires a tools/list no-regression microbench (REQ-v11-tools-list-no-regression) verifying `handleToolsList()` median latency does not regress when an in-flight semantic build is present.
- **Fix:** Added `timeToolsList` + `runToolsListSweep` helpers; integrated 100-call sweep on both keyword engine (baseline) and hybrid engine (BEFORE semantic build resolves). Extended report shape with `tools_list_keyword_median_ms`, `tools_list_hybrid_median_ms`, `tools_list_delta_ms`, `tools_list_iterations`, `gate_tools_list_no_regression_passed`, and `thresholds.tools_list_delta_ms_max` (set to 5 ms noise floor).
- **Files modified:** `test/harness/perf-bench.ts`.
- **Verification:** `npx tsx test/harness/perf-bench.ts` from main repo → tools_list_delta_ms = 0.000 ms PASS (≤ 5 ms threshold).
- **Committed in:** `da9bc22`.

**3. [Rule 1 — Bug] Eager adapter import broke graceful skip**
- **Found during:** Task 1 close (running stripe-harness without STRIPE_SECRET_KEY).
- **Issue:** Static import `import { createMiniLMProvider } from '../../packages/mcpack-embeddings/src/index.js'` triggers Node module resolution of `@huggingface/transformers` BEFORE the API-key skip check executes. In environments without that transitive dep installed (parallel-execution worktree), this produces `ERR_MODULE_NOT_FOUND` instead of the documented `STRIPE_SECRET_KEY not set` skip message.
- **Fix:** Switched all three harness scripts to dynamic adapter imports placed AFTER the API-key gate (or, for perf-bench, inside the hybrid-engine block which is the only path that needs MiniLM). Adds a typed `AdapterModule` interface so the dynamic import keeps full type safety.
- **Files modified:** `test/harness/stripe-harness.ts`, `test/harness/intent-benchmark.ts`, `test/harness/perf-bench.ts`.
- **Verification:** `env -u STRIPE_SECRET_KEY npx tsx test/harness/stripe-harness.ts` → graceful skip message, exit 0. Same for intent-benchmark.
- **Committed in:** Task 1 + Task 2 commits originally; refined in `da9bc22`.

## Authentication Gates

**STRIPE_SECRET_KEY** — required by Stripe-dependent gates (6a + 6b). Not present in this execution env. Documented as DEFERRED in v1.1-release-report.md with re-run commands. Plan 10-03's pre-publish checklist re-runs `npm run harness` and `npm run benchmark` with the operator's key and updates the report's Gate 6a + 6b sections inline before BOARD APPROVAL CHECKPOINT.

This is the documented operator handoff, not a flow break — the release report explicitly anticipates and provides the re-run runbook.

## Verification at Plan Close

| Check | Command | Result |
|-------|---------|--------|
| 234 tests still pass | `npm test` | 234 passed (13 files) |
| Statement coverage | `npm run test:coverage` (not re-run; baseline 99.78% holds since src/ unchanged) | ≥99.73% (trivially preserved) |
| Typecheck clean | `npm run typecheck` | exit 0 |
| Gate 1 (deps unchanged) | `git diff d732eaa..HEAD -- package.json` shows scripts-only delta | PASS |
| Gate 2 (src/ unchanged) | `git diff d732eaa..HEAD -- src/` empty | PASS |
| Gate 3 REVISED | `grep -rE "@llvs/mcpack-embeddings|@huggingface/transformers|@xenova/transformers" src/ test/ --exclude-dir=harness` | 0 matches PASS |
| Gate 4 (existing tests byte-identical) | `git diff d732eaa..HEAD -- 'test/*.test.ts'` empty | PASS |
| Gate 5 (no analytics on wire) | `grep -nE "setRequestHandler.*[Aa]nalytics|tools[/\\.]list.*[Aa]nalytics" src/` | 0 matches PASS |
| Gate 6c (search p99 delta ≤ 50 ms) | `npx tsx test/harness/perf-bench.ts` from main repo | 3.057 ms PASS |
| Gate 6d (index build ≤ 5,000 ms) | same command | 216.6 ms PASS |
| Perf memory (vector_bytes ≤ 2 MiB) | same command | 76,800 bytes PASS |
| tools/list no-regression (≤ 5 ms delta) | same command | 0.000 ms PASS |
| Gate 6a (Stripe ≥ 80.7%) | `STRIPE_SECRET_KEY=... npm run harness` | DEFERRED to Plan 10-03 |
| Gate 6b (recall@5 +15 pp) | `STRIPE_SECRET_KEY=... npm run benchmark` | DEFERRED to Plan 10-03 |

## Self-Check: PASSED

All claimed files exist, all claimed commits are reachable in `git log`, all stated numerical thresholds match the perf-bench-report.json on disk in main repo.

```
git log --oneline 6c34a92..HEAD
a2e5215 docs(10-01): author canonical v1.1 release measurement report
da9bc22 fix(10-01): align harness with canonical plan (category names + tools/list microbench)
33dfafd docs(10): commit canonical Phase 10 PLAN.md files (10-01, 10-02, 10-03)
d34b1c9 feat(10-01): add real-MiniLM perf benchmark (Gates 6c, 6d, perf-memory)
4173fb3 feat(10-01): add 50-query intent benchmark + recall@5 runner (Gate 6b)
357ed66 docs(10-01): author Plan 10-01 (harness + benchmark + perf measurement)
```
