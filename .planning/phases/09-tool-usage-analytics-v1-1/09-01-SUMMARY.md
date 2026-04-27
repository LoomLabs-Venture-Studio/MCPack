---
phase: 9
plan: 1
plan_id: 09-01
subsystem: analytics
tags: [phase-09, analytics, store, types, unit-tests, additive]
status: complete
completed: 2026-04-27
duration_minutes: 20
baseline_ref: 0a1759f

# Dependency graph
requires:
  - "src/roles.ts (isToolAllowed, resolveRoleAccess — read-only reuse)"
  - "src/types.ts (RoleConfig, ToolIndexEntry — pre-existing)"
provides:
  - "src/analytics-store.ts (AnalyticsStore class — package-internal)"
  - "AnalyticsEvent type (discriminated union)"
  - "AnalyticsByRoleSummary type"
  - "AnalyticsSnapshot type"
  - "AnalyticsOptions type"
  - "MCPackHandle.getAnalytics?(options?) — OPTIONAL until Plan 09-02 Task 5"
affects:
  - "Plan 09-02: will consume AnalyticsStore inside MCPackEngine + tighten getAnalytics? to required"

# Tech-stack
tech_stack:
  added: []
  patterns:
    - "sibling-module storage: AnalyticsStore mirrors src/session.ts SessionRegistry shape (class + private state + public methods + JSDoc)"
    - "two-predicate role-scoped filter: event.role for search/miss; isToolAllowed for call/denial (Pattern 4)"
    - "pre-push eviction at maxEvents: events.length never exceeds maxEvents (Pitfall 4)"
    - "WR-02 runtime input validation: non-string options.role coerced to undefined"
    - "package-internal class: AnalyticsStore NOT re-exported from src/index.ts"

# Key files
key_files:
  created:
    - src/analytics-store.ts
    - test/analytics-store.test.ts
  modified:
    - src/types.ts
    - src/index.ts

# Decisions
decisions:
  - "DEC-v11-09-02 implementation: tool-visibility filter applies to call/denial events via isToolAllowed; event.role filter applies to search/miss events. No string redaction — full event drop on out-of-role tool."
  - "DEC-v11-09-03 implementation: deadTools = resolveRoleAccess(role).names ∖ called-tools-set. ONLY 'call' events count — search-emitted tool names without an actual call STAY in deadTools."
  - "Constructor maxEvents clamp: Math.max(1, Math.floor(maxEvents)) handles non-positive and float input defensively."
  - "[Rule 1 deviation - Test fix] Plan scaffold's topTools test asserted reader's topTools=[] after admin called tool1+tool2. Per locked DEC-v11-09-02 the role-scoped call filter uses tool-visibility (not author-role) — so reader (which sees tool1+tool2) WOULD include those calls. Fix: switched the empty-topTools assertion to a 'ghost' (unknown role) which sees zero tools, preserving the test's intent while matching the locked spec."

# Metrics
metrics:
  tasks_completed: 5
  commits: 4
  files_created: 2
  files_modified: 2
  loc_added: 671
  tests_added: 20
  tests_total: 207
  baseline_tests_unchanged: 187
  coverage_statement_pct: 99.77
  coverage_floor_pct: 99.73
  coverage_delta_pct: +0.04
---

# Phase 9 Plan 1: AnalyticsStore Module + Unit Tests Summary

Ship a standalone in-memory bounded `AnalyticsStore` with role-aware snapshot computation, additive analytics type surface on `MCPackHandle`, and 20 unit tests covering record/snapshot/filter/summary/deadTools/clear semantics — all 5 BLOCKING gates green against baseline `0a1759f`, 207 tests passing at 99.77% statement coverage.

## Files Created/Modified

| File | Action | Lines | Purpose |
|------|--------|-------|---------|
| `src/types.ts` | modified (+107 / -0) | 270 | Additive `AnalyticsEvent` discriminated union, `AnalyticsByRoleSummary`, `AnalyticsSnapshot`, `AnalyticsOptions`; `MCPackHandle.getAnalytics?:` (OPTIONAL — Plan 09-02 Task 5 tightens to required). All pre-existing types byte-identical. |
| `src/index.ts` | modified (+5 / -0) | 23 | Additive re-export of the four new analytics types. Strictly additive diff (Gate 2). `AnalyticsStore` class is intentionally NOT re-exported — package-internal per Phase 02 DEC. |
| `src/analytics-store.ts` | created | 250 | `AnalyticsStore` class with public `record(event)`, `snapshot(rolesConfig, index, options?)`, `clear()` + private helpers `eventVisibleTo`, `summarizeForRole`, `collectRoles`. Reuses `isToolAllowed` and `resolveRoleAccess` from `src/roles.ts`. Sibling-module shape mirrors `src/session.ts`. |
| `test/analytics-store.test.ts` | created | 309 | 20 unit tests across 7 describe blocks (constructor / record / snapshot operator-unscoped / role-scoped filtering / summary / deadTools / clear). |

## All 5 BLOCKING Gates — Results

| # | Gate | Command | Result |
|---|------|---------|--------|
| 1 | Zero new core deps | `diff <(jq -S '{dependencies, peerDependencies, optionalDependencies, bundledDependencies}' package.json) <(git show 0a1759f:package.json | jq -S ...)` | **PASS** — empty output (deps unchanged) |
| 2 | Public API additive-only (`src/index.ts`) | `git diff 0a1759f -- src/index.ts \| grep -c "^-[^-]"` | **PASS** — `0` removed lines |
| 3 | Adapter isolation | `grep -rE "@llvs/mcpack-embeddings\|@huggingface/transformers\|@xenova/transformers" src/ test/` | **PASS** — zero matches |
| 4 | Baseline tests byte-identical (11-file list) | `git diff 0a1759f -- test/build.test.ts test/core.test.ts test/index-builder.test.ts test/roles.test.ts test/search.test.ts test/session.test.ts test/types.test.ts test/wrap.test.ts test/semantic-index-build.test.ts test/hybrid-scoring.test.ts test/hybrid-ranking.test.ts \| wc -l` | **PASS** — `0` diff lines |
| 5 | Wire-protocol exposure ban (NEW) | `grep -rE "setRequestHandler.*[Aa]nalytics\|tools[/\\.]list.*[Aa]nalytics" src/` | **PASS** — zero matches |

## Test Count + Coverage Delta

- **Baseline (Phase 8 close-out, `0a1759f`):** 187 tests across 11 files at 99.73% statement coverage.
- **Plan 09-01 close:** 207 tests across 12 files (187 baseline + 20 new) at **99.77% statement coverage** (+0.04 above floor).
- **Floor target:** ≥14 new tests — delivered 20 (143% of floor).
- **Branch / function / line coverage on `src/analytics-store.ts`:** 95.12% / 100% / 100% (statements: 100%). Two uncovered lines (116, 211) are defensive type-guard fallthroughs in the `for-loop` discriminator dispatch — TypeScript's exhaustive-check renders them logically dead but they remain at runtime for safety.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | `396c298` | `feat(09-01): add additive analytics type surface to src/types.ts` |
| 2 | `92d9554` | `feat(09-01): re-export analytics types from src/index.ts (additive only)` |
| 3 | `4c4a95a` | `feat(09-01): create AnalyticsStore (in-memory bounded event store)` |
| 4 | `254c380` | `test(09-01): add 20 unit tests for AnalyticsStore (≥14 floor)` |

Task 5 (acceptance gate sweep) was a verification-only task with no file changes; results captured in this SUMMARY.

## Decisions Made

1. **Tool-visibility filter for role-scoped call/denial (DEC-v11-09-02 implementation).** The role-scoped path applies a two-predicate filter (`Pattern 4`): `event.role === scope` for `search`/`miss` events; `isToolAllowed(event.tool, scope, rolesConfig)` for `call`/`denial`. Critical implication: a call event authored by role `admin` for tool `tool1` IS visible in a role-scoped query for `reader` if `reader` is allowed `tool1`. This matches the locked spec literally — the privacy invariant is "no tool name leaks across role boundaries", not "no event leaks across author boundaries."

2. **Constructor `Math.max(1, Math.floor(maxEvents))` clamp.** Non-positive and float `maxEvents` would break the pre-push check (`events.length >= maxEvents`) at degenerate boundaries (zero capacity → infinite loop) or produce off-by-one drift (3.7 capacity → behaves like 3 or 4 inconsistently). The clamp ensures `maxEvents >= 1` and integer-typed for stable FIFO arithmetic.

3. **`AnalyticsStore` NOT re-exported from `src/index.ts`.** Per Phase 02 DEC, engine internals stay package-internal. Consumers reach analytics only via `MCPackHandle.getAnalytics()` (Plan 09-02). The TYPES are re-exported (so consumers can type the snapshot return value) but the CLASS is not.

4. **`MCPackHandle.getAnalytics?:` is OPTIONAL at this plan close.** Plan 09-02 Tasks 3–4 wire the method into both `wrap.ts` and `build.ts` handle constructions; Plan 09-02 Task 5 tightens the marker to required (`getAnalytics(...)`). The OPTIONAL marker keeps `wrap.ts`/`build.ts` constructions type-valid through the wave 2 transition.

5. **WR-02 carry-forward pattern.** Non-string `options.role` is coerced to `undefined` (operator-unscoped) at the snapshot boundary — matches Phase 8 WR-02 fix pattern: external surface inputs validate at runtime rather than allowing silent NaN-style failures or throws.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test Bug] `topTools[5]` test second-half assertion conflicted with locked spec**

- **Found during:** Task 4 (running the new test file).
- **Issue:** The plan's test scaffold for `'topTools[5] sorts by call count descending and is empty when zero calls'` set up 6 admin-authored calls (tool1, tool2, tool3) and then asserted `readerSnap.summary.byRole.reader?.topTools` to equal `[]`. But per locked DEC-v11-09-02, role-scoped call filter uses TOOL-VISIBILITY (not author-role): since `reader` is allowed `tool1`+`tool2`, admin's calls to those tools ARE visible to a reader-scoped query → reader's `topTools` would correctly be `['tool2', 'tool1']`, NOT `[]`. The implementation correctly applied the locked spec; the plan's test was inconsistent.
- **Fix:** Switched the second-half assertion from `reader` to `ghost` (an unknown role with non-empty `rolesConfig` → tool-visibility predicate returns FALSE for every call → zero topTools). This preserves the test's stated intent ("empty topTools when no calls visible to the role") while honoring the locked DEC-v11-09-02 semantic. Renamed the test from "empty when zero calls" to "empty when zero **visible** calls" to make the contract explicit.
- **Files modified:** `test/analytics-store.test.ts` (test body lines ~196–215).
- **Commit:** `254c380` (the same Task 4 commit captures the fix in the docstring's `[Rule 1 - Test bug fix]` block).

### Other Deviations

**2. [Plan over-delivery] 20 tests vs ≥14 floor (143% of floor).**

- **Why:** The plan's recommended scaffold contained 19 numbered tests (3 constructor + 3 record + 3 snapshot operator-unscoped + 3 role-scoped filtering + 3 summary + 3 deadTools + 1 clear). I shipped exactly that scaffold plus the corrected `topTools` test, totaling 20 tests. This is the plan-author's recommended over-delivery — not a deviation from intent.

## Note on `MCPackHandle.getAnalytics?:` (OPTIONAL at this plan close)

The `getAnalytics` method is declared with the `?` optional marker on the `MCPackHandle` interface. This is intentional — `wrap.ts` and `build.ts` currently return handles that don't yet implement the method. The optional marker keeps those constructions type-valid until Plan 09-02 Tasks 3–4 wire the implementation. Plan 09-02 Task 5 will tighten the marker to required (`getAnalytics(options?: AnalyticsOptions): AnalyticsSnapshot`) AFTER both adapter files have been updated.

This staged tightening mirrors the iter-2 fix from the planner's plan-checker review (commit `e9f4a9b`).

## Confirmation: AnalyticsStore is NOT re-exported from `src/index.ts`

```
$ grep -c "AnalyticsStore" src/index.ts
0
```

The class is package-internal — only the four TYPES (`AnalyticsEvent`, `AnalyticsByRoleSummary`, `AnalyticsSnapshot`, `AnalyticsOptions`) are re-exported so consumers can type the eventual `getAnalytics()` return value.

## Phase 9 Progress

- 5/9 requirements covered at unit-level: `REQ-v11-analytics-events`, `REQ-v11-analytics-storage`, `REQ-v11-analytics-privacy`, `REQ-v11-analytics-role-scoped-query`, `REQ-v11-dead-tool-detection`.
- 2/9 still pending Plan 09-02: `REQ-v11-analytics-api` (handle method wiring), `REQ-v11-analytics-rbac-integrity` (architectural — agent CANNOT reach `getAnalytics` via MCP wire).

## Next Plan

Plan 09-02 (Wave 2) consumes `AnalyticsStore` from inside `MCPackEngine`, wires emission at four decision points (`handleSearchTools` → search + miss; `wrap.ts`/`build.ts` non-search dispatch → call; role-block paths → denial), surfaces `getAnalytics` on the handle (tightening the optional marker to required in Task 5), and ships integration + privacy + RBAC architectural tests in `test/analytics-integration.test.ts`.

## Self-Check: PASSED

- `src/types.ts` exists at 270 lines (additive analytics types present).
- `src/index.ts` exists at 23 lines (4 new type re-exports present).
- `src/analytics-store.ts` exists at 250 lines (AnalyticsStore class with record/snapshot/clear).
- `test/analytics-store.test.ts` exists at 309 lines (20 unit tests).
- Commits `396c298`, `92d9554`, `4c4a95a`, `254c380` all present in `git log`.
- All 5 BLOCKING gates pass against baseline `0a1759f`.
- `npm run typecheck && npm run build && npm test` all green; 207 tests passing at 99.77% statement coverage.
