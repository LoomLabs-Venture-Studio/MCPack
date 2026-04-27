---
phase: 09-tool-usage-analytics-v1-1
verified: 2026-04-26T03:00:00Z
status: passed
score: 11/11 dimensions verified
overrides_applied: 0
gates_passed:
  - "Gate 1: zero-new-core-deps vs Phase 8 baseline 0a1759f (broadened jq selector — empty diff)"
  - "Gate 2: public-API src/index.ts strictly additive (zero removed lines vs 0a1759f; +5 additive lines for the four analytics type re-exports)"
  - "Gate 3: adapter-isolation (grep src/ test/ for @llvs/mcpack-embeddings|@huggingface/transformers|@xenova/transformers returns zero matches; exit 1)"
  - "Gate 4: regression — all 11 v1.0+Phase-7+Phase-8 baseline test files byte-identical to 0a1759f (zero-line diff across test/build.test.ts test/core.test.ts test/index-builder.test.ts test/roles.test.ts test/search.test.ts test/session.test.ts test/types.test.ts test/wrap.test.ts test/semantic-index-build.test.ts test/hybrid-scoring.test.ts test/hybrid-ranking.test.ts)"
  - "Gate 5 (NEW — wire-protocol exposure ban): grep -E 'setRequestHandler.*[Aa]nalytics|tools[/.]list.*[Aa]nalytics' src/ returns zero matches"
  - "Gate 6 (implicit): src/analytics-store.ts has zero imports from node:fs|net|http|https|dgram|tls (in-memory only — REQ-v11-analytics-storage)"
  - "Gate 7 (implicit): zero NEW console.* sites in src/wrap.ts, src/build.ts, src/core.ts (analytics emission is private state mutation only). Pre-existing 6 console.warn sites unchanged."
requirements_satisfied:
  - REQ-v11-analytics-events
  - REQ-v11-analytics-storage
  - REQ-v11-analytics-privacy
  - REQ-v11-analytics-api
  - REQ-v11-analytics-role-scoped-query
  - REQ-v11-analytics-rbac-integrity
  - REQ-v11-dead-tool-detection
re_verification: false
review_carry_forward_resolved:
  - id: WR-01 (Phase 9 review)
    summary: "Operator-unscoped per-role summary silently zeroed denialCount for non-wildcard roles"
    resolution: "Resolved at src/analytics-store.ts:260-267 (commit f6753b8). summarizeForRole denial branch now counts on event.role === role (denials authored by this role) instead of isToolAllowed(event.tool, role, ...). Without the fix, denialCount was forced to 0 for every non-wildcard role since denials are emitted precisely when the tool is NOT in the role's allowed set. Regression test test/analytics-store.test.ts:271-289 emits 3 reader denials + 1 analyst denial and asserts byRole.reader.denialCount===3 and byRole.analyst.denialCount===1."
  - id: WR-02 (Phase 9 review)
    summary: "wrap.ts/build.ts emitted call events on isError:true clean-error returns"
    resolution: "Resolved at src/wrap.ts:152-166 and src/build.ts:174-188 (commit 98f50ec). Both adapters now check result.isError===true BEFORE markToolLoaded AND BEFORE the call emission. wrap.ts inspects raw result; build.ts inspects normalized result. Two regression tests in test/analytics-integration.test.ts:186-249: build mode confirms snap.calls===[] AND that markToolLoaded was NOT called (subsequent search_tools delivers the schema with loaded:false instead of loaded:true)."
  - id: WR-03 (Phase 9 review)
    summary: "Snapshot leaked event-internal tools[] array by reference"
    resolution: "Resolved at src/analytics-store.ts:128 (commit a08f0b9). One-liner fix: tools: e.tools.slice() so external mutation of snap.searches[i].tools cannot corrupt the stored event. Regression test test/analytics-store.test.ts:174-189 mutates snap.searches[0].tools (push + sort) and re-snapshots to confirm the second snapshot is unaffected."
  - id: WR-04 (Phase 9 review)
    summary: "Empty-string role '' silently surfaced in summary.byRole keys"
    resolution: "Resolved at src/analytics-store.ts:307-318 (commit 64db82d). collectRoles() now skips '' when aggregating byRole keys. Raw event arrays still preserve role:'' verbatim; role-scoped queries with getAnalytics({role:''}) honored verbatim (operator intent unambiguous). Regression test test/analytics-store.test.ts:135-156."
  - id: WR-05 (Phase 9 review)
    summary: "Test-only clear() public-vs-@internal hygiene mismatch"
    resolution: "Resolved at src/analytics-store.ts:154-178 (commit db05308). JSDoc-only fix: removed @internal tag, clarified that clear() IS public and callable from any host-process holder of AnalyticsStore reference; MCP wire still cannot reach it (architectural boundary). No source logic changed."
  - id: WR-06 (Phase 9 review)
    summary: "Unbounded query/tool-name lengths can balloon analytics memory beyond maxEvents"
    resolution: "Documentation-only fix per scope decision (commit 089b3b8). Added extended JSDoc to record() at src/analytics-store.ts:45-66 documenting maxEvents-bounds-count-not-size constraint, OOM scenario (1MB query × 10000 events ≈ 10GB), and v1.2 followup plan (per-field truncation tool.slice(0,256), query.slice(0,1024) at emission time)."
deferred:
  - truth: "Real-deployment analytics signal value (operator UAT)"
    addressed_in: "Phase 10 (Harness, Coverage, Docs, npm Publish)"
    evidence: "09-VALIDATION.md Manual-Only Verifications: 'Real-deployment analytics signal value — Requires real MCP integration. Phase 10 harness validates — out of Phase 9 scope.'"
  - truth: "≥120 tests at ≥99% statement coverage as a milestone-level acceptance gate"
    addressed_in: "Phase 10 (REQ-v11-test-coverage-floor)"
    evidence: "REQUIREMENTS.md REQ-v11-test-coverage-floor mapped to Phase 10. Phase 9 already exceeds the targets at 234 tests / 99.78% statement; Phase 10 confirms it as a milestone gate."
---

# Phase 09: Tool Usage Analytics (v1.1) — Verification Report

**Phase Goal:** Give operators in-process visibility into search/call/denial/miss patterns and dead tools without exposing analytics over the MCP wire.

**Verified:** 2026-04-26T03:00:00Z
**Status:** PASSED
**Re-verification:** No — initial verification (matches Phase 6/7/8 11/11 dimension PASS bar)

---

## Goal Achievement Summary

The phase delivers exactly what it promised. With or without `roles` configured, every `MCPackEngine` instance now:

1. Owns a `public readonly analytics: AnalyticsStore` field initialized by the constructor (`src/core.ts:54,68`).
2. Records a `search` event (and conditionally a `miss` event when `matches.length === 0`) inside `buildSearchResponse` — both sync (no-vectors) and async (hybrid) query paths funnel through this method, so emission is exactly once per `search_tools` invocation regardless of which scoring path the engine took (`src/core.ts:283-299`).
3. Records a `denial` event in `wrap.ts` at TWO sites (role-block at line 112 + missing-handler at line 129) and in `build.ts` at TWO sites (role-block at line 124 + missing-handler at line 142) BEFORE returning the opaque `"Unknown tool: {name}"` error, preserving the v1.0 deliberately-opaque-denial invariant.
4. Records a `call` event AFTER `engine.markToolLoaded(...)` on the success path in BOTH adapters (wrap.ts:160, build.ts:182) — but ONLY when `result.isError !== true` (WR-02 fix: clean-error returns do NOT emit, do NOT consume the session's schema-delivered gate).
5. Surfaces operator-only access via `MCPackHandle.getAnalytics(options?: { role?: string }): AnalyticsSnapshot` — wired into both adapters' handle returns (`src/wrap.ts:185`, `src/build.ts:214`) and the type is REQUIRED in `src/types.ts:150` (no `?`).
6. Computes role-scoped snapshots using a two-predicate filter: search/miss events on `event.role === role`, call/denial events on `isToolAllowed(event.tool, role, rolesConfig)` — DEC-v11-09-02. Out-of-role events are EXCLUDED, not redacted.
7. Computes `summary.byRole[role].deadTools` as `resolveRoleAccess(role).names ∖ called-tools-set` — search-emitted tool names without an actual call STAY in deadTools (Pitfall 5 / DEC-v11-09-03 edge case 3).

The architectural boundary (REQ-v11-analytics-rbac-integrity) is preserved structurally:
- `setRequestHandler.*[Aa]nalytics` returns ZERO matches in src/ (Gate 5 — verified at this verification timestamp).
- `tools/list` continues to return exactly one tool with name `search_tools` (Pr6 — invariant unchanged from v1.0; explicitly guarded by 4 WR-03 rename-safe tests).
- An agent calling `tools/call` with name `getAnalytics` receives the standard `"Unknown tool: getAnalytics"` error path in BOTH wrap and build modes (Pr5 verified by 2 dedicated tests).

A v1.0/v1.1-Phase-8 user upgrading to this commit can:
- Call `handle.getAnalytics()` to receive a fully-shaped `AnalyticsSnapshot` immediately (returns empty arrays + empty byRole on a fresh engine).
- Call `handle.getAnalytics({ role: 'reader' })` to receive a role-scoped view that excludes any event involving a tool reader cannot see.
- Inspect `summary.byRole[role].deadTools` to identify tools granted but never called by that role this process lifetime.
- Keep all existing v1.0 + v1.1 deployments working byte-identically — the public API surface (`mcpack`, `createMCPackServer`, all existing types) is unchanged; only NEW analytics types and ONE new method on `MCPackHandle` are added.

Phase 10 (Harness, Coverage, Docs, npm Publish) can now consume the new `getAnalytics` surface for the operator-UAT signal value verification.

---

## Observable Truths

| #   | Truth                                                                                                                                                            | Status     | Evidence                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `AnalyticsStore` captures four event types (`search`, `call`, `denial`, `miss`) at the correct decision points; counts match a known call sequence              | VERIFIED   | `src/analytics-store.ts:28-73` defines class with `record(event)`. `src/core.ts:285-299` emits `search` (and conditional `miss` when `matches.length === 0`) inside `buildSearchResponse`. `src/wrap.ts:112,129,160` + `src/build.ts:124,142,182` emit denial×2 + call. Tests at `test/analytics-integration.test.ts:99-160` verify all 4 event types in BOTH wrap and build modes. |
| 2   | Storage is in-memory only; resets on process restart; bounded ring-buffer at `maxEvents` (default 10000), oldest dropped on overflow                             | VERIFIED   | `src/analytics-store.ts:30,42,68-73` — `events: AnalyticsEvent[]` private field; constructor accepts `maxEvents` with `Math.max(1, Math.floor(...))` clamp; `record()` does pre-push eviction (`if (events.length >= maxEvents) shift(); push(event)`). Gate 6 grep `node:fs\|net\|http\|https\|dgram\|tls` returns zero matches. Tests at `test/analytics-store.test.ts:50-122`. |
| 3   | `MCPackHandle.getAnalytics(options?)` returns `AnalyticsSnapshot { searches, calls, denials, misses, summary.byRole[role]: { searchCount, callCount, denialCount, missCount, topTools[5], deadTools[] } }` from BOTH `mcpack()` and `createMCPackServer()` handles | VERIFIED   | `src/types.ts:125-151` — REQUIRED method (no `?`). `src/wrap.ts:185` + `src/build.ts:214` both wire `getAnalytics: (options) => engine.getAnalytics(options)`. `src/core.ts:356-358` engine method delegates to `analytics.snapshot(...)`. Tests at `test/analytics-integration.test.ts:254-289` verify shape on BOTH handles.                                                       |
| 4   | Role-scoped query (`getAnalytics({ role })`) returns zero references to tools outside that role's allowed set — denial events for restricted tools EXCLUDED entirely (no string redaction) — Pr1                                                                  | VERIFIED   | `src/analytics-store.ts:193-203` — two-predicate filter; call/denial use `isToolAllowed`, search/miss use `event.role === role`. Pr1 test at `test/analytics-integration.test.ts:291-314`: 4-tool engine with reader allowed [tool1,tool2]; emit denials for tool3+tool4+nonexistent; assert `denials` excludes them. Unit-level Pr1 + Pr2 + Pr4 at `test/analytics-store.test.ts:191-232`. |
| 5   | Operator unscoped query returns full data; tool names visible in denials (Pr3)                                                                                   | VERIFIED   | `src/analytics-store.ts:111-113` — when `scopeRole === undefined`, `filtered = this.events.slice()` (full copy). Pr3 test at `test/analytics-integration.test.ts:335-348`: emit out-of-role denial; assert `getAnalytics()` (no arg) returns full event with tool name visible. Pr3 unit-level at `test/analytics-store.test.ts:157-165`.                                            |
| 6   | Wildcard role (`'*'`) sees full universe of events (Pr4)                                                                                                         | VERIFIED   | `src/analytics-store.ts:202` delegates to `isToolAllowed`, which returns `true` for every tool when role has `'*'` (Phase 1 contract). Pr4 test at `test/analytics-integration.test.ts:350-370`: admin role with all 4 tool calls; admin-scoped snapshot returns all 4 in `calls`. Pr4 unit-level at `test/analytics-store.test.ts:221-232`.                                        |
| 7   | `getAnalytics` is NOT callable via the MCP wire protocol — agent attempt returns `"Unknown tool: getAnalytics"` (Pr5) — both wrap and build modes                | VERIFIED   | Two Pr5 tests at `test/analytics-integration.test.ts:373-415`. Build mode: `tools/call` with `name:'getAnalytics'` returns `{isError:true, content:[{text:'Unknown tool: getAnalytics'}]}` via the role-denial branch. Wrap mode: same outcome with `defaultRole:'reader'` driving the `!isToolAllowed` denial path. Architectural Gate 5 grep returns zero matches in src/.       |
| 8   | `tools/list` returns exactly one tool with name `search_tools` — v1.0 invariant preserved (Pr6); 4 rename-safe WR-03 tests guard the assertion                   | VERIFIED   | Pr6 test at `test/analytics-integration.test.ts:387-399` directly asserts `response.tools.length===1 && response.tools[0].name==='search_tools'`. WR-03 rename-safe pattern at `test/analytics-integration.test.ts:459-507` runs 4 occurrences of `response.tools.map((t) => t.name)` across (admin/reader) × (build/wrap). 10 total `tools.map((t) => t.name)` occurrences (≥4 floor). |
| 9   | `summary.byRole[role].deadTools` lists tools that role can see AND have zero `call` events for that role — search-only does not count (Pitfall 5)                | VERIFIED   | `src/analytics-store.ts:271-282` — `deadTools = resolveRoleAccess(role).names ∖ Set(callCountByTool.keys())`. Pitfall 5: only `call` events populate `callCountByTool` (line 252-258). Tests at `test/analytics-integration.test.ts:418-450` (integration: tools/call counts; search alone does NOT count) + `test/analytics-store.test.ts:305-352` (wildcard, unknown role).      |
| 10  | All 5 [BLOCKING] gates pass against `0a1759f` baseline + 2 implicit gates (Gate 6 fs/net imports, Gate 7 console hygiene)                                        | VERIFIED   | Re-verified at this verification timestamp: Gate 1 jq diff empty, Gate 2 `git diff -- src/index.ts \| grep -c "^-[^-]"` returns 0, Gate 3 `grep -rE "@llvs/mcpack-embeddings\|@huggingface/transformers\|@xenova/transformers" src/ test/` exit 1 (no matches), Gate 4 `git diff -- <11-file-list> \| wc -l` returns 0, Gate 5 `grep -E "setRequestHandler.*[Aa]nalytics\|tools[/\\.]list.*[Aa]nalytics" src/` returns 0 matches. |
| 11  | All 6 phase REVIEW WARNINGs (WR-01..WR-06) closed in fix-loop with 5 regression tests (1 WR-01 + 2 WR-02 + 1 WR-03 + 1 WR-04); 234 tests pass at 99.78% coverage  | VERIFIED   | `09-REVIEW-FIX.md:status=all_fixed`. Test sweep: `npm test` reports 13 test files / 234 tests passing. `npm run test:coverage` reports 99.78% statement coverage (≥99.73% Phase 8 floor). WR-01 fix at `src/analytics-store.ts:260-267`. WR-02 isError gate at `src/wrap.ts:152-166` + `src/build.ts:174-188`. WR-03 reference copy at `src/analytics-store.ts:128`. WR-04 empty-role skip at `src/analytics-store.ts:310-315`. WR-05 JSDoc at `src/analytics-store.ts:154-178`. WR-06 v1.2 doc note at `src/analytics-store.ts:45-66`. |

**Score:** 11/11 dimensions verified

---

## Required Artifacts

| Artifact                                  | Expected                                                                                                                                                                              | Status   | Details                                                                                                                                                                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/analytics-store.ts`                  | `AnalyticsStore` class with `record(event)`, `snapshot(rolesConfig, index, options?)`, `clear()`; reuses `isToolAllowed`+`resolveRoleAccess`; package-internal (NOT in `src/index.ts`) | VERIFIED | 319 lines. Class exported at line 28. Methods at lines 68 (record), 100 (snapshot), 176 (clear). Imports `isToolAllowed`, `resolveRoleAccess` from `./roles.js` at line 9. NOT re-exported from src/index.ts (`grep -c AnalyticsStore src/index.ts` returns 0).               |
| `src/core.ts` engine extensions           | `public readonly analytics: AnalyticsStore` field; constructor inits store; `getAnalytics(options?)` public method; search+miss emission inside `buildSearchResponse`                  | VERIFIED | Field at line 54, init at line 68, method at lines 356-358 (delegates to `this.analytics.snapshot(this.config.roles, this.index, options)`). Search emission at lines 285-291; miss emission at lines 292-299 (conditional on `matches.length === 0`).                       |
| `src/wrap.ts` emission + handle           | 2 denial sites + 1 call site (success path AFTER markToolLoaded, gated by !isError); handle return adds `getAnalytics`                                                                | VERIFIED | Denial at line 112 (`!isToolAllowed` branch) + line 129 (`!originalCallHandler` branch). Call at line 160 (inside `if (!isCleanError)` block, AFTER `engine.markToolLoaded(name, sessionId)`). Handle return at line 185.                                                    |
| `src/build.ts` emission + handle          | 2 denial sites + 1 call site (success path AFTER markToolLoaded, gated by !isError on NORMALIZED result); handle return adds `getAnalytics`                                            | VERIFIED | Denial at line 124 (`!isToolAllowed` branch) + line 142 (`!handler` branch). Call at line 182 (inside `if (!isCleanError)` block, AFTER `engine.markToolLoaded(name, sessionId)`). isError gate inspects normalized result. Handle return at line 214.                       |
| `src/types.ts` additive types             | `AnalyticsEvent` discriminated union, `AnalyticsByRoleSummary`, `AnalyticsSnapshot`, `AnalyticsOptions`; `MCPackHandle.getAnalytics:` REQUIRED (no `?`); existing types byte-identical | VERIFIED | 270 lines. Analytics types at lines 161-243. `MCPackHandle.getAnalytics(options?: AnalyticsOptions): AnalyticsSnapshot` at line 150 (REQUIRED — no `?`). Plan 09-01 set OPTIONAL `?`; Plan 09-02 Task 5 (commit `9f207f1`) tightened to required.                             |
| `src/index.ts` additive re-exports        | New analytics type re-exports (AnalyticsEvent, AnalyticsByRoleSummary, AnalyticsSnapshot, AnalyticsOptions); `AnalyticsStore` class NOT re-exported; existing exports byte-identical    | VERIFIED | 23 lines. 4 new type re-exports at lines 19-22. Gate 2 confirms strictly additive (`grep -c "^-[^-]"` returns 0). `grep -c AnalyticsStore src/index.ts` returns 0 (class is package-internal per Phase 02 DEC).                                                                |
| `test/analytics-store.test.ts`            | ≥14 unit tests across describe blocks for constructor, record, snapshot, role-scoped filtering, summary, deadTools, clear; ≥3 regression tests for WR-01, WR-03, WR-04                | VERIFIED | 363 lines. **23 it() tests** across 7 describe blocks (≥14 floor; 164% delivery). 1 WR-01 + 1 WR-03 + 1 WR-04 regression test. Includes Pr1 + Pr2 + Pr3 + Pr4 unit-level verification.                                                                                          |
| `test/analytics-integration.test.ts`      | ≥12 integration tests covering Wave 0 sentinel, engine emission (BOTH modes), handle API, Pr1-Pr6 privacy + RBAC architectural, dead-tool detection, WR-03 rename-safe pattern (≥4 occurrences) | VERIFIED | 507 lines. **24 it() tests** across 8 describe blocks (≥12 floor; 200% delivery). All 6 Pr1-Pr6 tests present (13 `Pr[1-6]` matches). 10 occurrences of `tools.map((t) => t.name)` (≥4 floor). 2 WR-02 regression tests (build mode + wrap mode).                                |

---

## Key Link Verification

| From                                            | To                                              | Via                                                                                                              | Status | Details                                                                                                                                                                                                                                              |
| ----------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core.ts` (MCPackEngine)                    | `src/analytics-store.ts` (AnalyticsStore)        | `import { AnalyticsStore } from './analytics-store.js'`                                                          | WIRED  | Import at `src/core.ts:17`. Field at `src/core.ts:54`. Constructor init at line 68.                                                                                                                                                                  |
| `src/core.ts` (buildSearchResponse)             | `src/analytics-store.ts` (record)               | `this.analytics.record({ type: 'search', ... })` and `this.analytics.record({ type: 'miss', ... })`              | WIRED  | 2 sites at `src/core.ts:285-299`. Search emission unconditional; miss emission gated by `matches.length === 0`. Both sync (no-vectors) and async (hybrid) paths funnel through buildSearchResponse so emission is exactly once per search invocation. |
| `src/wrap.ts` (denial branches)                 | `src/analytics-store.ts` (record via engine)    | `engine.analytics.record({ type: 'denial', ... })` — 2 sites                                                      | WIRED  | `src/wrap.ts:112-117` (`!isToolAllowed`) + `src/wrap.ts:129-134` (`!originalCallHandler`). Both BEFORE the opaque "Unknown tool" return.                                                                                                              |
| `src/wrap.ts` (success path)                    | `src/analytics-store.ts` (record via engine)    | `engine.analytics.record({ type: 'call', ... })` — 1 site, gated by `!isCleanError`                                | WIRED  | `src/wrap.ts:160-165` AFTER `engine.markToolLoaded(name, sessionId)` at line 157. WR-02 fix: `isCleanError` gate at lines 152-156 prevents emission for `result.isError === true` returns.                                                            |
| `src/build.ts` (denial branches)                | `src/analytics-store.ts` (record via engine)    | `engine.analytics.record({ type: 'denial', ... })` — 2 sites                                                      | WIRED  | `src/build.ts:124-129` (`!isToolAllowed`) + `src/build.ts:142-147` (`!handler`). Both BEFORE the opaque "Unknown tool" return.                                                                                                                       |
| `src/build.ts` (success path)                   | `src/analytics-store.ts` (record via engine)    | `engine.analytics.record({ type: 'call', ... })` — 1 site, gated by `!isCleanError`                                | WIRED  | `src/build.ts:182-187` AFTER `engine.markToolLoaded(name, sessionId)` at line 179. WR-02 fix: `isCleanError` gate at lines 174-178 inspects NORMALIZED result so detection is consistent regardless of how the handler returned.                       |
| `src/wrap.ts` (handle return)                   | `src/core.ts` (engine.getAnalytics)             | `getAnalytics: (options) => engine.getAnalytics(options)`                                                        | WIRED  | `src/wrap.ts:185`. Closure delegates to engine method which calls `analytics.snapshot(this.config.roles, this.index, options)`.                                                                                                                       |
| `src/build.ts` (handle return)                  | `src/core.ts` (engine.getAnalytics)             | `getAnalytics: (options) => engine.getAnalytics(options)`                                                        | WIRED  | `src/build.ts:214`. Same closure pattern as wrap.ts; appears inside the `MCPackServer.handle` object at line 206-215.                                                                                                                                |
| `src/index.ts` (public types)                   | `src/types.ts` (analytics types)                | additive re-export of AnalyticsEvent / AnalyticsByRoleSummary / AnalyticsSnapshot / AnalyticsOptions             | WIRED  | `src/index.ts:19-22`. Strictly additive (Gate 2). `MCPackHandle` already re-exported at line 16; AnalyticsStore CLASS intentionally NOT re-exported.                                                                                                  |
| `test/analytics-integration.test.ts`            | `src/index.ts` (mcpack, createMCPackServer, types) | `import { mcpack, createMCPackServer } from '../src/index.js'; import type { AnalyticsSnapshot, ... } from '../src/index.js'` | WIRED  | `test/analytics-integration.test.ts:8-13`. Verifies the public API path agents and operators consume.                                                                                                                                                |
| `test/analytics-store.test.ts`                  | `src/analytics-store.ts` (AnalyticsStore)        | `import { AnalyticsStore } from '../src/analytics-store.js'`                                                     | WIRED  | Direct import of the package-internal class for unit testing — bypasses the public API surface intentionally for store-mechanic isolation.                                                                                                          |

---

## Data-Flow Trace (Level 4)

| Artifact                | Data Variable                       | Source                                                                       | Produces Real Data | Status   |
| ----------------------- | ----------------------------------- | ---------------------------------------------------------------------------- | ------------------ | -------- |
| AnalyticsStore.events[] | `events: AnalyticsEvent[]`          | `record(event)` called from 6 emission sites in src/core.ts/wrap.ts/build.ts | Yes                | FLOWING  |
| AnalyticsSnapshot       | `snapshot()` return                 | filters/buckets `this.events` + summary computation via `summarizeForRole`    | Yes                | FLOWING  |
| MCPackHandle.getAnalytics | closure over `engine.getAnalytics`  | `engine.getAnalytics(options)` → `analytics.snapshot(roles, index, options)` | Yes                | FLOWING  |
| summary.byRole[role].deadTools | computed at snapshot time      | `resolveRoleAccess(role, rolesConfig, index).names ∖ callCountByTool.keys()` | Yes                | FLOWING  |
| summary.byRole[role].topTools  | computed at snapshot time      | sorted entries of `callCountByTool` Map (descending), sliced to 5            | Yes                | FLOWING  |
| summary.byRole[role].denialCount | computed at snapshot time   | counts events where `e.type === 'denial' && e.role === role`                | Yes                | FLOWING (post-WR-01 fix) |

All wired and producing real data. Pre-WR-01 fix the `denialCount` data flow was effectively HOLLOW (always 0 for non-wildcard roles); the fix at `src/analytics-store.ts:260-267` restores correct semantics — verified by regression test at `test/analytics-store.test.ts:271-289`.

---

## Behavioral Spot-Checks

| Behavior                                                                     | Command                                                                                                            | Result                                       | Status |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- | ------ |
| TypeScript build clean                                                       | `npm run typecheck`                                                                                                | exit 0, no output                             | PASS   |
| Build artifacts compile                                                      | `npm run build`                                                                                                    | exit 0, dist/ produced                       | PASS   |
| Full test suite passes                                                       | `npm test`                                                                                                         | 13 test files, **234 tests passed** (100%)   | PASS   |
| Statement coverage at or above floor                                         | `npm run test:coverage`                                                                                            | All files: 99.78% statement; ≥99.73% floor   | PASS   |
| Gate 1: deps unchanged                                                       | `diff <(jq -S '{deps,peerDeps,optionalDeps,bundledDeps}' package.json) <(git show 0a1759f:package.json \| jq ...)`  | empty diff                                    | PASS   |
| Gate 2: src/index.ts strictly additive                                       | `git diff 0a1759f -- src/index.ts \| grep -c "^-[^-]"`                                                              | 0 removed lines                               | PASS   |
| Gate 3: adapter isolation                                                    | `grep -rE "@llvs/mcpack-embeddings\|@huggingface/transformers\|@xenova/transformers" src/ test/`                    | exit 1 (no matches)                           | PASS   |
| Gate 4: 11 baseline test files byte-identical                                | `git diff 0a1759f -- <11-file-list> \| wc -l`                                                                       | 0 diff lines                                  | PASS   |
| Gate 5 (NEW): wire-protocol exposure ban                                     | `grep -nE "setRequestHandler.*[Aa]nalytics\|tools[/\\.]list.*[Aa]nalytics" src/`                                    | zero matches                                  | PASS   |
| Gate 6 (implicit): no fs/net imports in analytics-store                      | `grep -E "from ['\"]node:(fs\|net\|http\|https\|dgram\|tls)" src/analytics-store.ts`                                | exit 1 (no matches)                           | PASS   |
| Gate 7 (implicit): no NEW console.* in src/{core,wrap,build}.ts              | `grep -cE "console\\." src/core.ts src/wrap.ts src/build.ts`                                                        | 7 sites (3 core + 1 wrap + 2 build, +1 comment); all pre-existing Phase 7/8 sites unchanged | PASS   |
| Pr5 architectural: agent attempt returns "Unknown tool: getAnalytics"        | `grep -nE "Unknown tool: getAnalytics" test/analytics-integration.test.ts`                                          | 4 matches (2 test names + 2 assertions)      | PASS   |
| WR-03 rename-safe: ≥4 occurrences of `tools.map((t) => t.name)`              | `grep -c "tools\.map((t) => t\.name)" test/analytics-integration.test.ts`                                           | 10 (≥4 floor; 250% delivery)                  | PASS   |
| `getAnalytics` is REQUIRED on MCPackHandle (Plan 09-02 Task 5 tightened)     | `grep -nE "getAnalytics\(" src/types.ts`                                                                            | line 150 declares `getAnalytics(options?: ...)` (no `?`) | PASS |

All spot checks PASS. The full re-verification was performed at this verification timestamp against the committed tree at HEAD (`27d8615`).

---

## Requirements Coverage

| Requirement                              | Source Plan(s)         | Description                                                                                                                                                                                                                                              | Status     | Evidence                                                                                                                                                                                                                                                           |
| ---------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| REQ-v11-analytics-events (R2.1)          | 09-01, 09-02           | Capture four event types per session: `search` (query, role, returned tools, ts), `call` (tool, role, ts), `denial` (tool, role, ts), `miss` (query, role, ts).                                                                                          | SATISFIED  | `src/types.ts:179-183` discriminated union shape matches PRD literally. Emission at 6 sites in src/core.ts (search+miss) + src/wrap.ts (call+denial×2) + src/build.ts (call+denial×2). Verified by 5+ engine-emission tests at test/analytics-integration.test.ts:99-160. |
| REQ-v11-analytics-storage (R2.2)         | 09-01, 09-02           | Storage is in-memory only. No disk, no network, resets on process restart.                                                                                                                                                                               | SATISFIED  | `src/analytics-store.ts:30` — `events: AnalyticsEvent[] = []`. Gate 6 confirms no fs/net imports. State lives on the engine instance, garbage-collected with the engine on process exit. Bounded ring-buffer at `maxEvents` default 10000 (line 32-43, 68-73).      |
| REQ-v11-analytics-privacy (R2.3)         | 09-01, 09-02           | Role-scoped analytics responses must not expose tools outside that role. Denial events record only that a denial happened — never reveal restricted tool names to a role-scoped query.                                                                   | SATISFIED  | DEC-v11-09-02 implementation at `src/analytics-store.ts:193-203` — entire-event drop (no string redaction) when tool is not in role's allowed set. Pr1 + Pr2 + Pr4 tests at test/analytics-integration.test.ts:291-370 enforce the invariant in BOTH unit and integration. |
| REQ-v11-analytics-api (R2.4)             | 09-01, 09-02           | Add `getAnalytics(options?)` to handle returned by `mcpack()` and `createMCPackServer()`. Returns `AnalyticsSnapshot { searches, calls, denials, misses, summary.byRole[role]: {...} }`.                                                                  | SATISFIED  | `src/types.ts:150` declares method as REQUIRED. `src/wrap.ts:185` + `src/build.ts:214` wire it on both adapters. `src/types.ts:222-230` defines snapshot shape matching PRD. Tests at test/analytics-integration.test.ts:254-289 verify shape on BOTH handles.       |
| REQ-v11-analytics-role-scoped-query (R2.5) | 09-01, 09-02         | `getAnalytics({ role: 'X' })` returns only that role's events. No-arg form returns all (operator view).                                                                                                                                                  | SATISFIED  | `src/analytics-store.ts:107-116` — when `scopeRole === undefined`, full slice returned; when string, filtered by `eventVisibleTo`. Tests at test/analytics-integration.test.ts:267-289 verify role-scoped vs operator-unscoped semantics on BOTH modes.              |
| REQ-v11-analytics-rbac-integrity (R2.6)  | 09-02                  | `getAnalytics()` is on the server handle, NOT exposed as an MCP tool. Not callable by agents.                                                                                                                                                            | SATISFIED  | Gate 5 grep returns zero matches in src/. Pr5 tests at test/analytics-integration.test.ts:373-415 prove agent attempt yields `"Unknown tool: getAnalytics"` in BOTH wrap and build modes. Pr6 test at line 387-399 confirms `tools/list` returns exactly one tool. |
| REQ-v11-dead-tool-detection (R2.7)       | 09-01, 09-02           | `summary.byRole[role].deadTools` lists tools with zero `call` events for that role in the current session, scoped to tools that role can actually see.                                                                                                   | SATISFIED  | DEC-v11-09-03 implementation at `src/analytics-store.ts:271-282`. Process-lifetime aggregate (broader than "current session" per CONTEXT decision; matches REQ-v11-analytics-storage scope). Pitfall 5 verified at test/analytics-integration.test.ts:434-450 (search alone does NOT count). |

All 7 phase REQ-IDs SATISFIED. No orphaned requirements: REQUIREMENTS.md maps exactly the 7 IDs declared in the plans.

---

## Anti-Patterns Found

| File                              | Line  | Pattern                                                                  | Severity | Impact                                                                                                                                  |
| --------------------------------- | ----- | ------------------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `src/analytics-store.ts`          | 30    | `events: AnalyticsEvent[] = []` (initial empty state)                     | INFO     | NOT a stub — written to by `record()` from 6 emission sites; no other code path returns empty as a final state. Verified by data-flow trace. |
| `src/analytics-store.ts`          | 39-66 | "v1.2 will add per-field truncation..." JSDoc comment                     | INFO     | WR-06 documentation-only fix per scope decision — discoverable backlog marker; does NOT signal incomplete work for Phase 9.              |
| `src/wrap.ts:11`, `src/build.ts:16` | n/a | `// NOTE: Uses low-level Server class. The SDK marks Server as @deprecated` | INFO     | Pre-existing v1.0 comment; unchanged by Phase 9. Reflects an SDK migration upstream concern.                                              |

No BLOCKER or WARNING anti-patterns found in Phase 9 changes. All emission sites are wired to live `AnalyticsStore.record()` calls (no placeholder/TODO/coming-soon behavior). All 6 phase WARNINGs from the code review (WR-01..WR-06) were closed in the fix loop (commits `f6753b8`, `98f50ec`, `a08f0b9`, `64db82d`, `db05308`, `089b3b8`) with 5 regression tests added.

Phase 8 carry-forward INFOs (IN-01 keyword fallback centralization, IN-02 5-tier loop extraction, IN-03 P9 RBAC adversarial test) were intentionally NOT introduced as new instances by Phase 9 — confirmed via spot-check of new src/core.ts emission code (no new 5-tier loops; no new role-fixture-coupling).

---

## Human Verification Required

None. All 11 verification dimensions are programmatically verified. Phase 9's "operator UAT signal value" (whether the analytics surface is *useful* in real deployments) is explicitly deferred to Phase 10 per `09-VALIDATION.md` Manual-Only Verifications row 1.

---

## Gaps Summary

No gaps. Phase 9 achieves goal byte-for-byte:

- All 7 phase REQ-IDs SATISFIED with code + test evidence.
- All 5 BLOCKING gates + 2 implicit gates PASS against baseline `0a1759f`.
- All 6 privacy invariants Pr1-Pr6 verified by dedicated tests.
- All 6 phase REVIEW WARNINGs (WR-01..WR-06) closed with 5 regression tests.
- 234 tests pass at 99.78% statement coverage (≥99.73% Phase 8 floor; +5 over the 229 pre-fix-loop count).
- Wave 0 empirical sentinel passed (207 tests passed against new event-emission wiring on disposable spike, captured by `test/analytics-integration.test.ts:85-95` plus the implicit Gate 4 baseline-byte-identical guard).
- WR-03 rename-safe pattern: 10 occurrences of `tools.map((t) => t.name)` (≥4 floor; 250% delivery).
- `MCPackHandle.getAnalytics` is REQUIRED (Plan 09-02 Task 5 tightened from optional in commit `9f207f1`).
- `getAnalytics` is unreachable via the MCP wire (Pr5: `tools/call getAnalytics` returns `"Unknown tool: getAnalytics"` in BOTH wrap and build modes).
- `tools/list` returns exactly one tool, name `search_tools` (Pr6 — v1.0 invariant preserved with 4 explicit rename-safe guard tests).
- Architectural Gate 5: `grep -E "setRequestHandler.*[Aa]nalytics" src/` returns ZERO matches.

**Notable executor process observations** (not gaps; documented per orchestrator request):
- **Wave 1 test fixture deviation** (auto-fixed): The plan scaffold's `topTools[5]` test asserted `reader.topTools=[]` after admin called tool1+tool2. Per locked DEC-v11-09-02 the role-scoped call filter uses TOOL-VISIBILITY (not author-role) — so reader (which sees tool1+tool2) WOULD include those calls. Wave 1 executor caught this conflict during execution and switched the second-half assertion to a `ghost` (unknown role with non-empty `rolesConfig` → tool-visibility predicate returns false for every call → zero topTools). Preserved test intent ("empty topTools when no calls visible") while honoring the locked DEC. Documented in `09-01-SUMMARY.md` Deviations section. Verified at `test/analytics-store.test.ts:235-253`.
- **Wave 2 worktree branch rename**: The Wave 2 executor created the spike branch as `phase-09-wave-0-spike`, then renamed it to `phase-09-02-execute` after the spike was reset. Reason: the parallel-executor worktree could not check out main (held by the parent worktree at `/Users/zaid/Projects/MCPack`), so `git branch -D` would have failed; instead `git reset --hard 1289e6a` reverted the spike changes in-place. Net effect identical: Wave 0 changes never landed in any persistent commit; orchestrator merged the renamed branch cleanly at `8f7ebfa`.
- **Code review caught real semantic bugs (WR-01, WR-02)** — both auto-fix-loop resolved cleanly with regression tests:
  - **WR-01:** Operator-unscoped `byRole.X.denialCount` was forced to 0 for every non-wildcard role (the per-role summary used `isToolAllowed` for denials, but denials are emitted precisely when the tool is NOT allowed for the role). Fix at `src/analytics-store.ts:260-267` switches to `event.role === role` predicate. Regression test added.
  - **WR-02:** `wrap.ts`/`build.ts` emitted call events on `isError:true` clean-error returns — inflating `topTools`/`callCount` AND prematurely consuming the session's "schema delivered" gate. Fix at `src/wrap.ts:152-166` and `src/build.ts:174-188` adds an `isCleanError` gate before BOTH `markToolLoaded` AND the call emission. Two regression tests added (build mode + wrap mode).

Phase 9 is ready to close. Phase 10 (Harness, Coverage, Docs, npm Publish) can proceed.

---

_Verified: 2026-04-26T03:00:00Z_
_Verifier: Claude (gsd-verifier, Opus 4.7 1M context)_
_Model: claude-opus-4-7[1m]_
