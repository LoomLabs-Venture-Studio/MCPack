---
phase: 09-tool-usage-analytics-v1-1
fixed_at: 2026-04-26T02:50:00Z
review_path: .planning/phases/09-tool-usage-analytics-v1-1/09-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 9: Code Review Fix Report

**Fixed at:** 2026-04-26
**Source review:** `.planning/phases/09-tool-usage-analytics-v1-1/09-REVIEW.md`
**Iteration:** 1
**Fix scope:** `critical_warning` (6 WARNINGs in scope; 4 INFOs out of scope by design)

## Summary

- Findings in scope: 6 (WR-01 through WR-06)
- Fixed: 6
- Skipped: 0
- Quality gates: typecheck PASS / build PASS / 234/234 tests PASS / 99.78% coverage (≥99.73% floor) / all 5 BLOCKING gates PASS against baseline `0a1759f`

## Fixed Issues

### WR-01: Operator-unscoped per-role summary silently zeros most denialCount values

**Files modified:** `src/analytics-store.ts`, `test/analytics-store.test.ts`
**Commit:** `f6753b8`
**Applied fix:** In `summarizeForRole`, the denial branch now counts on `event.role === role` ("denials authored by this role") instead of `isToolAllowed(event.tool, role, rolesConfig)`. Denials are emitted precisely when the tool is NOT in the actor's allowed set, so the previous `isToolAllowed` predicate forced `denialCount` to 0 for every non-wildcard role. The new semantic matches operator intent for `byRole[X].denialCount` ("how many times did role X try a tool and get denied").

Added an extended JSDoc note to `summarizeForRole` explaining the per-axis predicate split (search/miss = `event.role`, call = `isToolAllowed`, denial = `event.role`) and why this intentionally diverges from the role-scoped event-array filter (which uses tool-visibility per DEC-v11-09-02 privacy invariant — different purposes, not collapsible).

Added regression test `WR-01 regression: byRole[role].denialCount counts denials whose actor was THIS role (non-wildcard)` — emits 3 reader denials + 1 analyst denial and asserts `byRole.reader.denialCount === 3` and `byRole.analyst.denialCount === 1` (would be 0 + 0 without the fix).

### WR-02: `wrap.ts` and `build.ts` emit `call` events for clean-error returns (`isError: true`)

**Files modified:** `src/wrap.ts`, `src/build.ts`, `test/analytics-integration.test.ts`
**Commit:** `98f50ec`
**Applied fix:** Both adapters now check `result.isError === true` BEFORE emitting the `call` event AND BEFORE `markToolLoaded`, matching the catch-branch contract. `wrap.ts` inspects the raw `result`. `build.ts` inspects the NORMALIZED result so `isError` detection is consistent regardless of how the handler returned (string/object/null/etc.).

Without this fix:
1. `topTools` and `callCount` were inflated by clean-error returns.
2. `markToolLoaded` was called for failed invocations, prematurely consuming the session's "schema delivered" gate so the next successful call returned `{loaded: true}` without delivering the schema.

Added two regression tests in `test/analytics-integration.test.ts`:
- `WR-02 regression (build mode)`: handler returns `{ isError: true, content: [...] }` → `snap.calls === []` AND a subsequent `search_tools` call confirms the schema is delivered (`loaded: false` with full schema present), proving `markToolLoaded` was NOT prematurely called.
- `WR-02 regression (wrap mode)`: wrapped `tools/call` returns `{ isError: true }` → `snap.calls === []`.

### WR-03: Snapshot leaks event-internal `tools[]` array by reference

**Files modified:** `src/analytics-store.ts`, `test/analytics-store.test.ts`
**Commit:** `a08f0b9`
**Applied fix:** One-liner in `snapshot()` bucketize loop: `tools: e.tools.slice()` so external mutation of `snap.searches[i].tools` (push/sort/length-assign) cannot corrupt the stored event. O(k) where k is the search result count (≤ maxResults, typically ≤ 10) — negligible.

All other snapshot fields (`topTools`, `deadTools`) were already freshly computed and safe; only `searches[].tools` aliased the stored event.

Added regression test `WR-03 regression: mutating snap.searches[i].tools does NOT corrupt the stored event` — mutates `snap.searches[0].tools` (push + sort) and re-snapshots to confirm the second snapshot is unaffected.

### WR-04: Empty-string `role` ('') silently surfaces in `summary.byRole`

**Files modified:** `src/analytics-store.ts`, `test/analytics-store.test.ts`
**Commit:** `64db82d`
**Applied fix:** `collectRoles()` now skips empty-string roles when aggregating `summary.byRole` keys. The empty string is the `role ?? ''` normalization used at every emission site (core.ts, wrap.ts, build.ts) when `defaultRole` is unconfigured — it is NOT a real role name. Exposing it as `byRole[""]` produced non-obvious JSON output and polluted the role list when `rolesConfig` was undefined.

Raw event arrays still preserve `role: ''` verbatim so operators can inspect no-role-configured behavior. Role-scoped queries with `getAnalytics({ role: '' })` are still honored verbatim (operator intent unambiguous in that case). Documented the omission contract in `collectRoles()` JSDoc.

Added regression test `WR-04 regression: empty-string role is excluded from summary.byRole keys` — emits 4 events with `role: ''`, confirms raw event arrays preserve empty role, and confirms `byRole` keys exclude `''` (only `admin`/`reader`/`analyst` remain).

### WR-05: Test-only `clear()` is publicly callable from any holder of the engine reference

**Files modified:** `src/analytics-store.ts`
**Commit:** `db05308`
**Applied fix:** Aligned the `clear()` JSDoc with its `public` visibility modifier. Previous JSDoc claimed "Production code does not call this" with `@internal` tag while the method was declared `public` — a TypeScript hygiene mismatch.

New contract: `clear()` IS public, callable from any host-process holder of the `AnalyticsStore` reference. The MCP wire cannot reach it (not registered as a request handler, not in `tools/list`) so it is operator-only by the same architectural boundary that protects `getAnalytics`. Production callers MAY use it for meaningful checkpoints (per-deployment rollover); tests use it as the canonical reset hook for sequential scenarios. Removed the `@internal` tag.

No source code or test logic changed — JSDoc only. Existing `clear()` test still passes.

### WR-06: Unbounded query/tool-name lengths can balloon analytics memory beyond `maxEvents`

**Files modified:** `src/analytics-store.ts`
**Commit:** `089b3b8`
**Applied fix:** Documentation-only per scope decision (Phase 9 does NOT add truncation logic — typical MCP traffic stays under reasonable lengths and trusted hosts won't see this). Added an extended JSDoc note to `record()` documenting the `maxEvents`-bounds-count-not-size constraint, the OOM scenario (1MB query × 10000 events ≈ 10GB resident), and the v1.2 followup plan (per-field truncation: `tool.slice(0,256)`, `query.slice(0,1024)` at emission time). The followup is now discoverable in code search.

No source logic changed.

## Skipped Issues

None — all 6 in-scope WARNINGs were fixed.

## Out of Scope (per `fix_scope: critical_warning`)

The following INFOs were intentionally NOT addressed in this fix iteration:

- **IN-01:** Magic constant `10000` not exposed as a named export.
- **IN-02:** `record()` JSDoc claims "O(1) amortized" but `Array.shift` is O(n) at capacity.
- **IN-03:** Two duplicate denial-emission blocks in each of `wrap.ts` and `build.ts`.
- **IN-04:** `MCPackEngine.analytics` is `public readonly` but `MCPackEngine` is documented internal.

## Quality Gates — All PASS

| Gate | Command | Result |
|------|---------|--------|
| typecheck | `npm run typecheck` | PASS |
| build | `npm run build` | PASS |
| tests | `npm test` | **234/234** (was 229 baseline; +5 regression tests) |
| coverage | `npm run test:coverage` | **99.78%** statement (≥99.73% floor) |
| Gate 1 (deps) | `diff` against `0a1759f` | PASS — empty |
| Gate 2 (`src/index.ts` additive) | `git diff 0a1759f -- src/index.ts \| grep -c "^-[^-]"` | PASS — 0 removed lines |
| Gate 3 (adapter isolation) | `grep -rE "@llvs/mcpack-embeddings\|@huggingface/transformers\|@xenova/transformers" src/ test/` | PASS — zero matches |
| Gate 4 (11 baseline test files) | `git diff 0a1759f -- <11-file-list> \| wc -l` | PASS — 0 diff lines |
| Gate 5 (wire-protocol exposure) | `grep -rE "setRequestHandler.*[Aa]nalytics\|tools[/\\.]list.*[Aa]nalytics" src/` | PASS — zero matches |

## Test Count Delta

| Metric | Before fix iter | After fix iter | Delta |
|--------|-----------------|----------------|-------|
| Total tests | 229 | 234 | +5 (1 WR-01 + 2 WR-02 + 1 WR-03 + 1 WR-04) |
| analytics-store.test.ts | 20 | 23 | +3 |
| analytics-integration.test.ts | 22 | 24 | +2 |
| Coverage statement % | 99.78 | 99.78 | held |

## Files Modified (Summary)

| File | Findings |
|------|----------|
| `src/analytics-store.ts` | WR-01 (denialCount predicate + JSDoc), WR-03 (`e.tools.slice()`), WR-04 (`collectRoles` skip ''), WR-05 (`clear()` JSDoc), WR-06 (`record()` JSDoc) |
| `src/wrap.ts` | WR-02 (isError gate before call emit + markToolLoaded) |
| `src/build.ts` | WR-02 (isError gate before call emit + markToolLoaded, on normalized result) |
| `test/analytics-store.test.ts` | WR-01 + WR-03 + WR-04 regression tests |
| `test/analytics-integration.test.ts` | WR-02 regression tests (build mode + wrap mode) |

## Commits

| # | Commit | Finding | Description |
|---|--------|---------|-------------|
| 1 | `f6753b8` | WR-01 | count `byRole[role].denialCount` on `event.role` match |
| 2 | `98f50ec` | WR-02 | suppress call emission + `markToolLoaded` on `isError` returns |
| 3 | `a08f0b9` | WR-03 | copy `search.tools[]` on snapshot to prevent reference aliasing |
| 4 | `64db82d` | WR-04 | exclude empty-string role from `summary.byRole` keys |
| 5 | `db05308` | WR-05 | align `clear()` JSDoc with `public` visibility modifier |
| 6 | `089b3b8` | WR-06 | document v1.2 string-length truncation concern on `record()` |

---

_Fixed: 2026-04-26_
_Fixer: Claude (gsd-code-fixer, Opus 4.7 1M context)_
_Iteration: 1_
