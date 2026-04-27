# Phase 9: Tool Usage Analytics (v1.1) — Research

**Researched:** 2026-04-26
**Domain:** In-process analytics capture inside `MCPackEngine` (event recording at decision points + bounded retention) + role-scoped privacy filtering + handle-only API surface (no MCP wire exposure)
**Confidence:** HIGH (every recommendation grounded in actual reads of `src/core.ts`, `src/wrap.ts`, `src/build.ts`, `src/types.ts`, `src/roles.ts`, `src/session.ts`, `src/search.ts`, `src/index.ts`, all four Phase 6/7/8 carry-forward documents, and verified against npm registry on 2026-04-26)

## Summary

Phase 9 is a **read-only-on-existing-paths, additive-on-the-engine** phase: introduce a new sibling module `src/analytics-store.ts` (pattern matches Phase 7's `src/semantic-index-builder.ts` and Phase 8's `src/hybrid-scoring.ts`), add 1-3 lines of event emission at four decision points already established in `src/core.ts` and the dispatch paths in `src/wrap.ts`/`src/build.ts`, and surface a single new method `getAnalytics(options?)` on the `MCPackHandle` interface. No request handler is added; no entry in `tools/list`; no protocol-level surface. The agent literally cannot reach `getAnalytics()` via JSON-RPC — the boundary is structural, not authenticated. [VERIFIED: read of `src/wrap.ts:93-135` and `src/build.ts:103-159` — only `tools/list` and `tools/call` are registered via `setRequestHandler`.]

Three findings shape the recommendations:

1. **The decision points are ALREADY in the codebase — Phase 9 only adds emission, not new branches.** [VERIFIED: read of `src/core.ts`, `src/wrap.ts`, `src/build.ts`] Phase 7 created `handleSearchTools` (now refactored by Phase 8 into `handleSearchTools` + `runHybridQuery` + `buildSearchResponse` + `scoreAndRankHybrid` + `scoreAndRankKeywordWithRoleAfter`). Phase 8 already pivoted role filtering to AFTER ranking. Phase 9 adds emission AT THE SAME POINTS the existing logic already runs:
   - `search` event: end of `buildSearchResponse` (line 275, just before `return { content: [...] }`) — this single site fires for BOTH the hybrid path (via `runHybridQuery`) AND the keyword fallback path (via the sync return in `handleSearchTools`).
   - `miss` event: same site as `search`, conditional on `matches.length === 0`.
   - `call` event: `wrap.ts:127-128` (after `engine.markToolLoaded`) AND `build.ts:146-147` (after `engine.markToolLoaded`), BOTH on the success path inside the existing `try` block.
   - `denial` event: `wrap.ts:109-114` (the `isToolAllowed` rejection branch) AND `build.ts:121-126` (the `isToolAllowed` rejection branch). Important: also `wrap.ts:117-122` (the "no original handler" branch — emit denial there too, since the user-facing message is identical "Unknown tool: {name}").

2. **`isToolAllowed` from `src/roles.ts` is the perfect privacy filter — Phase 9 reuses it without modification.** [VERIFIED: read of `src/roles.ts:35-46`] The function already handles all RBAC edge cases: undefined role (returns false → secure default), wildcard (`*`) role (returns true), unknown role (returns false), role inheritance with cycle protection. Role-scoped queries can call `isToolAllowed(event.tool, opts.role, this.config.roles)` for `call`/`denial` events and `event.role === opts.role` for `search`/`miss` events (which have no `tool` field). No new RBAC logic; no new policy code; reuses the proven Phase 1 implementation.

3. **The `tools/list` and `tools/call` boundary IS the architectural enforcement of Gate 5.** [VERIFIED: read of `src/wrap.ts:93-95` and `src/build.ts:103-105` — exactly one `tools/list` handler is registered, returning `engine.handleToolsList()` which calls only `{ tools: [this.searchToolDefinition] }` — locked since Phase 2.] The `tools/call` handler routes only `search_tools` to the engine; everything else is either dispatched to a registered handler (build mode) or proxied to the original handler (wrap mode). An agent calling `tools/call analytics/get` hits the role check first (returns false because `analytics/get` isn't in any role config), then the dispatch lookup (returns no handler), then the opaque `"Unknown tool: {name}"` path. There is no code path to reach `getAnalytics()` from JSON-RPC. Gate 5's grep enforcement (`grep -E "setRequestHandler.*[Aa]nalytics" src/`) is belt-and-suspenders.

**Primary recommendation:** Add `src/analytics-store.ts` (sibling pattern, ~150 LOC) with `AnalyticsStore` class exposing `record(event)`, `snapshot(rolesConfig, index, opts?): AnalyticsSnapshot`, and `clear()` (test fixtures only). Use a single shared bounded array with discriminated union events (`AnalyticsEvent = SearchEvent | CallEvent | DenialEvent | MissEvent`) — easier overflow accounting than four arrays. Use `Array.shift()` for eviction (O(n) but n=10000 is sub-millisecond on modern hardware; not worth the complexity of a ring buffer for v1.1). Add 1 private field on `MCPackEngine`: `private readonly analytics: AnalyticsStore`. Emit at four sites with direct `this.analytics.record({...})` calls (no abstraction layer). Add `getAnalytics(opts?)` to `MCPackHandle` interface in `src/types.ts`. Wire `getAnalytics: (opts) => engine.getAnalytics(opts)` into the handle returns of `wrap.ts:138-141` and `build.ts:163-167`. Re-export new analytics types from `src/index.ts` so consumers can type the snapshot. Compute `summary.byRole[role]` lazily at snapshot time (O(events) per call — keeps `record()` O(1) and avoids cache-invalidation bugs).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Event capture (4 types) | New file `src/analytics-store.ts` | — | Pure storage — no engine state, no MCP knowledge. Belongs outside `core.ts` for unit-testability (mirrors Phase 7's `src/semantic-index-builder.ts` and Phase 8's `src/hybrid-scoring.ts`). |
| Bounded retention (maxEvents=10000) | New file `src/analytics-store.ts` | — | Same reasoning. The store owns its overflow policy. |
| Role-scoped filtering at snapshot time | New file `src/analytics-store.ts` (calls `isToolAllowed` from `src/roles.ts`) | `src/roles.ts` (read-only — `isToolAllowed`) | The store knows the event shape; the roles module knows the RBAC predicate. The store imports the predicate. No new RBAC logic. |
| Dead-tool computation | New file `src/analytics-store.ts` | `src/roles.ts` (read-only — `resolveRoleAccess`) | Computed at snapshot time as `tools-visible-to-role ∖ tools-with-≥1-call-event-by-role`. Inputs: rolesConfig, full tool index (the engine's `this.index`), event log. |
| Top-tools[5] computation | New file `src/analytics-store.ts` | — | Snapshot-time aggregation over `call` events. O(events) per snapshot — keeps `record()` O(1). |
| Event emission at decision points | `src/core.ts` (handleSearchTools/buildSearchResponse for search+miss) + `src/wrap.ts` + `src/build.ts` (for call+denial) | — | Lives at the decision points because that's where the context (role, sessionId, tool name, query) is in scope. Direct `this.analytics.record({...})` calls — no abstraction layer per CONTEXT §"event emission decision points". |
| `getAnalytics(options?)` private method on engine | `src/core.ts` (additive `MCPackEngine.getAnalytics`) | — | Lives on the engine because it composes `this.analytics`, `this.config.roles`, and `this.index`. The handle delegates here. |
| `getAnalytics()` public method on handle | `src/wrap.ts` + `src/build.ts` (handle return shape) | `src/types.ts` (additive `MCPackHandle.getAnalytics`) | Handle is the operator-facing surface. The boundary between operator (Node.js TypeScript caller) and agent (JSON-RPC caller) is structural — handle methods are unreachable via the wire because they aren't `setRequestHandler`-registered. |
| Public type exports for snapshot shape | `src/types.ts` (additive — `AnalyticsSnapshot`, `AnalyticsEvent`, `AnalyticsByRoleSummary`, `AnalyticsOptions`) + `src/index.ts` (re-export) | — | Consumers calling `getAnalytics()` need types to bind the return value. Phase 6 set the precedent with `EmbeddingProvider`. Gate 2 explicitly allows new analytics type exports. |
| Wire-protocol exposure ban | NOTHING in `src/wrap.ts` or `src/build.ts` mentions analytics in setRequestHandler/tools/list (Gate 5 grep enforcement) | — | Architectural — the absence of code IS the enforcement. The plan must include a grep gate that proves no `setRequestHandler.*[Aa]nalytics` reference exists in `src/`. |
| Test surface | New `test/analytics-store.test.ts` (Plan 09-01) + new `test/analytics-integration.test.ts` (Plan 09-02) | — | Sibling-pattern matches Phase 7's `test/semantic-index-build.test.ts` and Phase 8's `test/hybrid-scoring.test.ts` + `test/hybrid-ranking.test.ts`. |

**Why this matters for the planner:** Phase 9 is a feature-add with a hard architectural constraint — `getAnalytics` is host-process surface, NOT MCP wire surface. The split between `analytics-store.ts` (pure storage + filtering math) and `core.ts`/`wrap.ts`/`build.ts` (emission orchestration) keeps the boundaries clean. The analytics types belong in `types.ts` because they're part of the public TypeScript surface for consumers. Gate 5 is the only really new gate vs Phase 8 — it's a structural grep that proves the absence of wire exposure, not a behavioral test.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

From `.planning/phases/09-tool-usage-analytics-v1-1/09-CONTEXT.md`:

**`getAnalytics()` Handle Shape (DEC-v11-09-01 — resolves OQ1)**
- **Flat on `MCPackHandle`.** New method `getAnalytics(options?: { role?: string }): AnalyticsSnapshot`.
- Mirrors existing handle methods (`destroy(): void`, `stats(): { sessions: number; tools: number }`).
- Smallest API surface — additive only.
- Matches PRD literally (REQ-v11-analytics-api).
- If v1.2 introduces analytics-related methods (clear, export, subscribe), revisit nesting then. For v1.1 there is exactly one analytics method.

**Operator vs Agent Boundary — Architectural, Not Authenticated (informational)**
- No runtime "is this caller the operator?" check anywhere in MCPack.
- Handle methods (Node.js TypeScript surface): callable from any code that has a reference to the handle. By definition that's host-process code — there is no protocol wrapping these calls.
- MCP wire (JSON-RPC over stdio/SSE): only exposes handlers registered via `setRequestHandler()`. MCPack registers exactly two: `tools/list` and `tools/call`. `getAnalytics` is NOT a registered handler and NOT a tool — it doesn't exist on the wire.
- The agent literally cannot reach `getAnalytics()` via the MCP protocol. Calling it would fail at JSON-RPC parsing, not at auth.
- REQ-v11-analytics-rbac-integrity is satisfied by architecture: never call `setRequestHandler()` for any analytics method, never include analytics in the `tools/list` response. The planner MUST encode a test that proves an agent attempting `tools/call analytics/get` (or similar) returns `"Unknown tool"`.

**Denial Event Storage Model + Role-Scoped Filtering (DEC-v11-09-02 — resolves OQ5)**
- **Store full event data (`tool` + `role` + `ts`); role-scoped queries filter out entire events whose tool isn't in that role's allowed set.** No string redaction.
- Internal storage shape (per event):
  ```typescript
  type DenialEvent = { type: 'denial'; tool: string; role: string; ts: number };
  type SearchEvent = { type: 'search'; query: string; role: string; tools: string[]; ts: number };
  type CallEvent   = { type: 'call';   tool: string; role: string; ts: number };
  type MissEvent   = { type: 'miss';   query: string; role: string; ts: number };
  ```
- Query semantics:
  - `handle.getAnalytics()` (no role) — operator-unscoped — returns full event arrays.
  - `handle.getAnalytics({ role: 'X' })` — role-scoped — returns ONLY events where the event's tool name is allowed for role X. For `search`/`miss` events (no tool field), filter on the event's `role` field equaling `X`. For `denial` events involving a tool not in X's allowed set: the entire event is EXCLUDED, not redacted.
- Reuses Phase 8's `isToolAllowed(role, toolName, rolesConfig)` helper from `src/roles.ts`.
- **Edge cases the planner must encode in tests:**
  - Operator unscoped query on a fresh engine returns empty arrays (`searches: []`, etc.) — no errors, no nulls.
  - Role-scoped query for a role with no events returns empty arrays AND `summary.byRole[role]` populated with zeros (deadTools = all tools that role can see).
  - Role-scoped query for a non-existent role: returns empty arrays AND `summary.byRole[role] = {searchCount: 0, callCount: 0, denialCount: 0, missCount: 0, topTools: [], deadTools: []}`. Do NOT throw.
  - Wildcard role (`'*'`): role-scoped query for a wildcard role sees all events whose tool is in the universe.
  - A `denial` event for a tool that is later granted to the role mid-process: the historical denial still exists in storage but is filtered out of role-scoped queries because the filter uses CURRENT role-config state, not historical. Document this in the API JSDoc.

**Dead-Tool Detection Scope (DEC-v11-09-03)**
- **Process-lifetime aggregate per role.** `summary.byRole[role].deadTools` lists tools that role can see AND have zero `call` events from any session of that role since process start.
- `deadTools(role) = tools-visible-to-role ∖ tools-with-≥1-call-event-by-role`
- Matches REQ-v11-analytics-storage ("resets on process restart") — process lifetime is the natural boundary.
- **Edge cases the planner must encode in tests:**
  - Tool granted to role but never called → in `deadTools`.
  - Tool granted to role and called via `tools/call` (direct invocation) → NOT in `deadTools`.
  - Tool returned in a `search_tools` result but never actually invoked via `tools/call` → STILL in `deadTools` (`search` events do not count as `call` events).
  - Wildcard role (`'*'`) with no `call` events → `deadTools` includes ALL tools.
  - Role with `*` access: `deadTools` is computed against the full tool universe, not the wildcard token itself.

**Plan Slicing (DEC-v11-09-04)**
- **2 plans, each ships its own tests** (mirrors Phase 8's discipline — no coverage trough mid-phase).
- **Plan 09-01: AnalyticsStore Module + Unit Tests** (Wave 1).
- **Plan 09-02: Engine Integration + Handle API + Integration Tests** (Wave 2).

**Five [BLOCKING] Phase Gates (4 carry-forward + 1 NEW Gate 5)**
Baseline reference advances to current `main` HEAD post-Phase-8 (planner pins exact SHA at plan-time; Phase 8 anchored on `cd1fc52`; Phase 9 anchors at current HEAD or post-Phase-8 commit).
- **Gate 1 (zero-new-core-deps):** root `package.json` `dependencies`, `peerDependencies`, `optionalDependencies`, `bundledDependencies` UNCHANGED from baseline (broadened jq selector).
- **Gate 2 (public-API additive-only):** `src/index.ts` exports — Phase 9 MAY add new type exports (`AnalyticsSnapshot`, `AnalyticsEvent`, `AnalyticsByRoleSummary`, `AnalyticsOptions`). The diff against baseline must be ADDITIVE only — no removals or signature changes to existing exports. The plan-checker should verify this with a strict additive diff (every line removed must have an equivalent line added; net new lines allowed).
- **Gate 3 (adapter-isolation):** `grep -rE "@llvs/mcpack-embeddings|@huggingface/transformers|@xenova/transformers" src/ test/` returns ZERO matches.
- **Gate 4 (baseline tests byte-identical):** all pre-Phase-9 test files unchanged. Phase 9 only adds new test files. **Updated 10-file explicit list** (9 v1.0+Phase-7 files + Phase 8's `test/hybrid-scoring.test.ts` and `test/hybrid-ranking.test.ts`):
  1. `test/build.test.ts`
  2. `test/core.test.ts`
  3. `test/index-builder.test.ts`
  4. `test/roles.test.ts`
  5. `test/search.test.ts`
  6. `test/session.test.ts`
  7. `test/types.test.ts`
  8. `test/wrap.test.ts`
  9. `test/semantic-index-build.test.ts`
  10. `test/hybrid-scoring.test.ts`
  11. `test/hybrid-ranking.test.ts`
  (11 files — list grew because Phase 8's two test files joined the baseline. Counted accurately as 11.)
- **Gate 5 (NEW — wire-protocol exposure ban):** `grep -E "setRequestHandler.*[Aa]nalytics|tools[/\\.]list.*[Aa]nalytics" src/` returns ZERO matches. Belt-and-suspenders enforcement of REQ-v11-analytics-rbac-integrity. The planner MUST encode this as a [BLOCKING] gate in each plan.

**Carry-Forward Code Review Items From Phase 8**
- **WR-01 fix pattern (per-tool try/catch):** any external surface Phase 9 introduces that could throw should follow the Phase 8 pattern — catch and degrade gracefully rather than propagate to MCP caller. Phase 9 is read-only computation (`getAnalytics` is host-process only), so this is mostly N/A — but the plan should still flag any thrown surface for graceful handling at the operator boundary.
- **WR-02 fix pattern (runtime validation at boundaries):** the new `AnalyticsOptions` type should validate at runtime if `options.role` is provided — coerce non-string to undefined or throw cleanly. No silent NaN-style failures.
- **WR-03 rename-safe RBAC pattern:** all NEW Phase 9 RBAC tests MUST iterate `tools.map((t) => t.name)` rather than hardcoding fixture names. ≥4 occurrences in the new test file (mirroring Phase 8's enforcement; Phase 8 hit 14 occurrences in `test/hybrid-ranking.test.ts`).
- **Phase 8 lesson logged:** "Plan-checker can verify async signatures are 'callable' (callers await) but can't catch BREAK on sync test assertions." Phase 9 is fully sync (no new async surfaces), so this lesson doesn't apply directly — but the planner should still encode an empirical "all baseline tests pass with the new event-emission wiring" check, ideally as the first task of Plan 09-02 (Wave 0 pattern from Phase 8).

**Privacy Test Coverage (REQUIRED — Phase 9 plans must encode each)**
| # | Privacy invariant | Test |
|---|---|---|
| Pr1 | Role-scoped query for role X excludes denial events involving tools not in X's allowed set | Configure 4-tool engine, role X with 2 tools allowed; emit denials for 4 tools across 2 roles; assert `getAnalytics({role:'X'}).denials` contains zero events whose `tool` isn't in X's allowed set |
| Pr2 | Role-scoped query for role X excludes search/call/miss events not authored by role X | Emit events from multiple roles; `getAnalytics({role:'X'})` returns ONLY events with `event.role === 'X'` |
| Pr3 | Operator unscoped query returns full data | `getAnalytics()` (no arg) returns ALL events; tool names visible in denials |
| Pr4 | Wildcard role (`'*'`) sees full universe | Configure role with `*`; role-scoped query returns full event set |
| Pr5 | `getAnalytics` is unreachable via MCP wire | Construct engine, register on Server, call `tools/call` with name `'getAnalytics'` → returns `"Unknown tool: getAnalytics"` |
| Pr6 | `tools/list` returns exactly one tool, name `search_tools` | Pre-existing v1.0 invariant; Phase 9 adds an explicit guard |

**RBAC Architectural Test (REQUIRED)**
- The planner MUST encode a test asserting that no `setRequestHandler` call references analytics anywhere in `src/`. Structural, not behavioral:
  ```bash
  grep -E "setRequestHandler.*[Aa]nalytics" src/wrap.ts src/build.ts
  # Expected: zero output, exit 1 (no match)
  ```

### Claude's Discretion

- **Method names:** `record` vs `capture` vs `emit`; `snapshot` vs `getSnapshot`. **Research recommends:** `record(event)` and `snapshot(...)`. `record` matches event-sourcing vocabulary (an event store records events); `snapshot` matches the type name `AnalyticsSnapshot` directly. Avoid `emit` because it suggests EventEmitter semantics (subscribers, listeners) that the v1.1 design does NOT provide — that's a v1.2 candidate per CONTEXT §Deferred.
- **Internal event storage shape:** shared bounded array vs four typed bounded arrays. **Research recommends:** SHARED array with discriminated union. Easier overflow accounting (single eviction policy across all event types — total event count never exceeds maxEvents). Filtering by type at snapshot time is `events.filter(e => e.type === 'search')` — O(events) but fine because snapshot is already O(events) for summary computation.
- **`clear()` access:** public test-only vs private state mutation. **Research recommends:** PUBLIC, prefixed with documentation note "for test fixtures only" — matches Phase 7/8 conventions. Test fixtures need a way to reset the store for sequential test scenarios; making it private forces tests to construct fresh engines, which is wasteful when only the analytics state needs resetting.
- **`summary.byRole[role].topTools[5]`:** computed at snapshot time vs maintained incrementally. **Research strongly recommends:** snapshot-time computation. Keeps `record()` O(1); avoids cache-invalidation bugs (e.g., role config changes mid-session); matches the dead-tools computation timing (also snapshot-time per CONTEXT). The cost is O(events) per `getAnalytics()` call — for 10000 events this is sub-millisecond.
- **Bounded array implementation:** `Array.shift()` (O(n) eviction) vs ring buffer (O(1)). **Research recommends:** `Array.shift()`. For maxEvents=10000 the practical difference is negligible (~150µs eviction on modern hardware vs the ring buffer's 50ns); ring buffer adds ~60 LOC and complicates iteration. The simpler reading wins for v1.1; if real-world deployments push past 100k events and overflow becomes the hot path, revisit in v1.2 with a benchmark.

### Deferred Ideas (OUT OF SCOPE)
- **Persistent analytics storage** (disk, network, OTEL, file export, webhooks) — already deferred to v1.2 per PRD non-goals. Phase 9 ships in-memory only.
- **Per-query analytics caching** — repeated `getAnalytics()` calls recompute summary every time. If this becomes a perf concern in real deployments, add a snapshot cache invalidated on `record()`. Worth a benchmark in Phase 10. Deferred from v1.1.
- **Analytics subscription / streaming** — `handle.onAnalyticsEvent(callback)` for real-time monitoring. v1.2 candidate if operators ask for it.
- **Multi-tenant operator isolation** — different host-process consumers seeing different subsets. Out of library scope; host-level concern.
- **Cross-session aggregation knobs** — `getAnalytics({ scope: 'session' | 'lifetime' })` was raised and rejected for v1.1 (DEC-v11-09-03 locks process-lifetime). Add to v1.2 OQ list if real users ask.
- **Tightening Phase 8's INFO findings (IN-01/02/03)** — keyword-fallback centralization, 5-tier loop extraction, P9 RBAC adversarial test. Phase 9 should NOT introduce new instances of the same patterns; existing instances stay for v1.1 polish or v1.2.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-v11-analytics-events | Capture four event types per session: `search` (query, role, returned tools, ts), `call` (tool, role, ts), `denial` (tool, role, ts), `miss` (query, role, ts). | Code Examples §"AnalyticsStore class skeleton" + §"Event emission sites — exact line annotations"; Architecture Patterns §"Pattern 1: Sibling module" + §"Pattern 2: Direct emission at decision points (no abstraction layer)". |
| REQ-v11-analytics-storage | Storage is in-memory only. No disk, no network, resets on process restart. | Architecture Patterns §"Pattern 3: Bounded shared array with maxEvents=10000"; Don't Hand-Roll §"Persistence" (deferred); Code Examples §"AnalyticsStore class skeleton" (no fs/net imports). |
| REQ-v11-analytics-privacy | Role-scoped analytics responses must not expose tools outside that role. Denial events record only that a denial happened — never reveal restricted tool names to a role-scoped query. | Architecture Patterns §"Pattern 4: Privacy filter via isToolAllowed exclusion"; Common Pitfalls §"Pitfall 1: Privacy filter applied to wrong field" + §"Pitfall 6: Implicit role filtering at operator boundary"; Validation Architecture §"Privacy invariants encoded as negative controls (Pr1-Pr6)". |
| REQ-v11-analytics-api | Add `getAnalytics(options?)` to handle returned by `mcpack()` and `createMCPackServer()`. Returns `AnalyticsSnapshot { searches[], calls[], denials[], misses[], summary.byRole[role]: { searchCount, callCount, denialCount, missCount, topTools[5], deadTools[] } }`. | Code Examples §"types.ts additions — full type surface" + §"Handle wiring in wrap.ts and build.ts"; Architecture Patterns §"Pattern 5: Handle delegation, not method addition on engine surface". |
| REQ-v11-analytics-role-scoped-query | `getAnalytics({ role: 'cofounder' })` returns only that role's events. No-arg form returns all (operator view). | Code Examples §"AnalyticsStore.snapshot() implementation sketch"; Architecture Patterns §"Pattern 4: Privacy filter via isToolAllowed exclusion"; Validation Architecture §Pr1-Pr4. |
| REQ-v11-analytics-rbac-integrity | `getAnalytics()` is on the server handle, NOT exposed as an MCP tool. Not callable by agents. | Architecture Patterns §"Pattern 6: Wire-protocol exposure ban (Gate 5)"; Common Pitfalls §"Pitfall 2: Accidentally registering an analytics request handler"; Validation Architecture §Pr5-Pr6 + §"RBAC architectural test (Gate 5 grep)". |
| REQ-v11-dead-tool-detection | `summary.byRole[role].deadTools` lists tools with zero `call` events for that role in the current session, scoped to tools that role can actually see. | Code Examples §"AnalyticsStore.snapshot() — deadTools computation"; Common Pitfalls §"Pitfall 5: Confusing search-emitted-tools with call events for dead-tool computation". |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Extracted from `/Users/zaid/Projects/MCPack/CLAUDE.md` — these directives carry the same authority as locked decisions:

- **Stack lock:** TypeScript strict + `verbatimModuleSyntax`, `NodeNext` modules, ES2022 target, Node >= 18, ESM only (`"type": "module"`). All Phase 9 changes MUST compile under these.
- **Sole peer dep stays `@modelcontextprotocol/sdk ^1.0.0`.** Adding any runtime dep to core is a hard board-level breach. Phase 9 introduces zero deps; Gate 1 enforces.
- **No separate lint step:** TypeScript strict + verbatimModuleSyntax IS the lint layer.
- **Architecture key patterns Phase 9 must honor:**
  - "Two modes, one engine": Phase 9 changes land in `MCPackEngine`, the analytics store, and the two mode adapters' handle return shapes ONLY. The engine method `getAnalytics(options?)` is shared by both modes.
  - "Single discovery tool": `tools/list` returns exactly `search_tools`. Phase 9 MUST NOT add a tool. Gate 5 grep enforces.
  - "Config snapshot at setup": `mcpack()` clones config so external mutation post-call can't affect behavior. Phase 9 reads `this.config.roles` at snapshot time — but the snapshot is taken at construction, so role-config mutation post-construction is already impossible. Document the implication: a denial event for role X recorded BEFORE role X gained tool Y will still be filtered OUT of role-scoped queries (because the filter uses the snapshotted current state, which now grants Y) — see CONTEXT §"Edge cases the planner must encode in tests" bullet 5.
  - "Handlers always receive `MCPackHandlerContext`": unchanged by Phase 9.
  - "Deliberately opaque denial": preserved by Phase 9. The `denial` event is emitted INSIDE the engine but the user-facing response is unchanged from v1.0 (`"Unknown tool: {name}"`). Operator can read the denial via `getAnalytics()`; agent never sees it.
- **Quality gates from PLAYBOOK.md:**
  - After every code change: `npm run typecheck && npm run build && npm test` must all pass.
  - Statement coverage MUST NOT drop below 99% (current baseline 99.73% from Phase 8).
  - Touching `core.ts`, `wrap.ts`, `build.ts` mandates running `npm run test:coverage`.
  - Target: ≥120 tests by milestone close (REQ-v11-test-coverage-floor; current 187, Phase 9 should push to ~210-225 — ~24-38 new tests across the two plans).
- **Commit format:** `type(scope): description` with scope `(NN-NN)` for GSD task commits or `(phase-NN)` for phase-wide.
- **Security: no leaking restricted tools' existence via error messages (RBAC invariant).** Phase 9 emits no new console.warn calls. The current `console.warn` sites (3 in core.ts: 2 are Phase 7+8 actual warns, 1 is a code comment; plus 3 in wrap.ts/build.ts for defaultRole-not-in-roles validation) are unchanged. [VERIFIED via `grep -n "console.warn" src/core.ts src/wrap.ts src/build.ts` returning exactly the existing 4 sites + 1 comment-line.]

## Standard Stack

> Phase 9 introduces NO new dependencies. The relevant deps are already in place from v1.0 + Phases 6-8.

### Core (already in place; no changes in Phase 9)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | `~5.8.3` (devDep) | Strict types, NodeNext, verbatimModuleSyntax | Carried from v1.0 [VERIFIED: package.json devDeps; npm view typescript version → 6.0.3 latest, project pins ~5.8.3 intentionally] |
| Node.js (runtime API) | `>= 18.0.0` | `Date.now`, `Array.shift`, `Map`, `Set` | All Phase 9 needs are standard library [VERIFIED: package.json engines + Node v24.2 in dev environment] |
| `@modelcontextprotocol/sdk` | `^1.0.0` peer + `^1.27.1` dev | `Tool` type | Sole peer dep [VERIFIED: package.json; npm view @modelcontextprotocol/sdk version → 1.29.0 latest, within ^1.0.0 + ^1.27.1] |
| Vitest | `^4.1.0` (devDep) | Test runner | Carry-forward from Phases 6-8 [VERIFIED: npm view vitest version → 4.1.5 latest, within ^4.1.0] |
| `@vitest/coverage-v8` | `^4.1.0` (devDep) | Statement coverage | Carry-forward from Phase 7 [VERIFIED: package.json] |

**Version verification commands run during research (2026-04-26):**
```bash
$ npm view vitest version             # 4.1.5 (within ^4.1.0)
$ npm view typescript version         # 6.0.3 latest (project pins ~5.8.3 intentionally)
$ npm view @modelcontextprotocol/sdk version  # 1.29.0 (within ^1.0.0 + ^1.27.1)
$ node --version                      # v24.2.0 (well above >=18.0.0)
```

### NOT used in Phase 9 (forbidden by Gate 3)

| Library | Why Forbidden | Where It Lives |
|---------|---------------|----------------|
| `@huggingface/transformers ^4.0.0` | Adapter-only dep; importing from `src/` fails Gate 3 | `packages/mcpack-embeddings/package.json` only |
| `@llvs/mcpack-embeddings` | Sibling adapter package; never imported from core | Sibling package; never imported by `src/` or `test/` |
| `@xenova/transformers` | Legacy package name (frozen v2.17.2 May 2024) | Forbidden everywhere |

### Alternatives Considered (and rejected)

| Instead of | Could Use | Why Rejected |
|------------|-----------|--------------|
| Hand-rolled bounded array | `lru-cache` or `quick-lru` library | Adds runtime dep — violates Gate 1. The bounded array is one `if (length >= max) shift()` line; no library benefit. |
| Hand-rolled snapshot summarization | A library like `lodash.groupby` | Adds runtime dep — violates Gate 1. The summarization is straight `Map`/`reduce`/`Set.has` operations. |
| OpenTelemetry export hook | `@opentelemetry/api` | Adds runtime dep — violates Gate 1. ALSO explicitly deferred to v1.2 per PRD non-goals. |
| EventEmitter for subscriptions | `node:events` (built-in, no dep) | Built-in is technically dep-free, BUT subscription semantics are explicitly deferred to v1.2 per CONTEXT §Deferred. Not a v1.1 surface. |
| Worker thread for snapshot computation | `node:worker_threads` (built-in) | Over-engineered for 10000-event budget. Snapshot is sub-millisecond on the main thread. Worker thread adds complexity for no measured benefit. |
| Persistent on-disk store | `node:fs` for ndjson append | Explicitly deferred to v1.2 per PRD non-goals. Phase 9 is in-memory only per REQ-v11-analytics-storage. |
| Ring buffer instead of `Array.shift` | Hand-rolled `private events: AnalyticsEvent[] = new Array(maxEvents); private head = 0; private size = 0;` | At maxEvents=10000, `Array.shift` overhead is ~150µs on modern V8 — sub-millisecond. Ring buffer adds ~60 LOC and complicates `snapshot()` iteration (must wrap around `head`). v1.1 keeps `Array.shift`; revisit in v1.2 with a benchmark if real workloads push past 100k events. |
| Four typed arrays (`searches: SearchEvent[]`, `calls: CallEvent[]`, etc.) | Single shared `events: AnalyticsEvent[]` (discriminated union) | Single array gives ONE eviction policy across all types. Four arrays would either need four separate maxEvents (more config knobs) or interlocked accounting (more bugs). At snapshot time, filter-by-type is `events.filter(e => e.type === 'search')` — O(events) which is already required for summary computation. |
| Maintaining `topTools` incrementally on each `record()` | Computing `topTools` at snapshot time | Incremental maintenance requires a `Map<role, Map<tool, count>>` updated on every `call` event AND walked at snapshot time. Snapshot-time computation walks events ONCE per snapshot — cheaper for low-snapshot-frequency operators. Also avoids cache-invalidation bugs when role config or tool index changes mid-session. |

## Architecture Patterns

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Operator (host-process Node.js code)                                     │
│   handle.getAnalytics({ role?: string })                                 │
└──────────────────────────────────────┬───────────────────────────────────┘
                                       │ Direct TypeScript method call
                                       │ (NEVER over JSON-RPC — structural boundary)
                                       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ MCPackHandle.getAnalytics  (wrap.ts:138-141 / build.ts:163-167)          │
│   → engine.getAnalytics(options)                                         │
└──────────────────────────────────────┬───────────────────────────────────┘
                                       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ MCPackEngine.getAnalytics(options)                                       │
│   → this.analytics.snapshot(this.config.roles, this.index, options)      │
└──────────────────────────────────────┬───────────────────────────────────┘
                                       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ AnalyticsStore.snapshot(rolesConfig, index, options)                     │
│   1. If options.role undefined → operator-unscoped: return all events    │
│   2. Else → role-scoped:                                                  │
│      - search/miss filter: event.role === options.role                   │
│      - call/denial filter: isToolAllowed(event.tool, options.role,...)   │
│   3. Compute summary.byRole[role] for the scoped event set:              │
│      - searchCount/callCount/denialCount/missCount: filter + length      │
│      - topTools[5]: sort by call-count desc, slice 5                      │
│      - deadTools: visible-tools(role) ∖ called-tools(role)               │
└──────────────────────────────────────────────────────────────────────────┘

  Event capture flow (asynchronous to snapshot — happens at decision points):
  ─────────────────────────────────────────────────────────────────────────

┌─ Caller (MCP wire — agent or operator) ─────────────────────────────────┐
│   tools/call search_tools { query, limit? }                             │
│   tools/call <other-tool> { args }                                      │
└────────────┬─────────────────────────────────────────────────────────────┘
             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ wrap.ts/build.ts setRequestHandler(CallToolRequestSchema)               │
│                                                                          │
│   if (name === 'search_tools')                                          │
│     return engine.handleSearchTools(args, sessionId);                   │
│        ────────────────────────                                          │
│        After buildSearchResponse computes matches:                       │
│        engine.analytics.record({ type:'search', query, role,            │
│                                  tools: matches.map(m=>m.name), ts })   │
│        if (matches.length === 0)                                        │
│          engine.analytics.record({ type:'miss', query, role, ts })      │
│                                                                          │
│   else if (!isToolAllowed(name, defaultRole, roles))                    │
│     ───────────────────────────────────────────                          │
│     engine.analytics.record({ type:'denial', tool: name,                │
│                               role: defaultRole, ts })                  │
│     return { content: [...'Unknown tool: name'...], isError: true };    │
│                                                                          │
│   else                                                                   │
│     try {                                                                │
│       result = await dispatch[name](args, ctx);                         │
│       engine.markToolLoaded(name, sessionId);                           │
│       engine.analytics.record({ type:'call', tool: name,                │
│                                 role: defaultRole, ts })                │
│       ──────────────────────────────────────                             │
│       return result;                                                     │
│     } catch (err) { return { isError: true, ... } }                     │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key architectural property visible in the diagram:** the operator path (top half) and the agent path (bottom half) NEVER intersect at the wire layer. The agent's only access to the engine is via `tools/list` and `tools/call` — `setRequestHandler`-registered handlers. `getAnalytics` is reachable only from the handle, which is a Node.js TypeScript object returned by `mcpack()`/`createMCPackServer()`. There is no JSON-RPC method that maps to it. Gate 5's grep enforcement is a structural assertion, not a behavioral one.

### Recommended Project Structure

```
src/
├── core.ts                      ← MODIFIED: add `private analytics: AnalyticsStore`,
│                                  emit `search`+`miss` events in handleSearchTools/buildSearchResponse,
│                                  add `getAnalytics(options?)` method
├── wrap.ts                      ← MODIFIED: emit `call` event after `engine.markToolLoaded` (line 127),
│                                  emit `denial` event before "Unknown tool" returns (lines 109, 117),
│                                  extend handle return with `getAnalytics`
├── build.ts                     ← MODIFIED: emit `call` event after `engine.markToolLoaded` (line 146),
│                                  emit `denial` event before "Unknown tool" returns (line 121),
│                                  extend handle return with `getAnalytics`
├── analytics-store.ts           ← NEW: AnalyticsStore class (record, snapshot, clear)
├── search.ts                    ← UNCHANGED
├── hybrid-scoring.ts            ← UNCHANGED (Phase 8 helper)
├── semantic-index-builder.ts    ← UNCHANGED (Phase 7 helper)
├── types.ts                     ← MODIFIED additive: AnalyticsSnapshot, AnalyticsEvent union,
│                                  AnalyticsByRoleSummary, AnalyticsOptions; extend MCPackHandle.getAnalytics
├── index.ts                     ← MODIFIED additive: re-export new analytics types
├── index-builder.ts             ← UNCHANGED
├── session.ts                   ← UNCHANGED (read-only — sibling-module reference for AnalyticsStore shape)
└── roles.ts                     ← UNCHANGED (read-only — Phase 9 imports `isToolAllowed` for filtering)

test/
├── core.test.ts                 ← UNCHANGED (Gate 4 baseline)
├── search.test.ts               ← UNCHANGED (Gate 4 baseline)
├── wrap.test.ts                 ← UNCHANGED (Gate 4 baseline)
├── build.test.ts                ← UNCHANGED (Gate 4 baseline)
├── index-builder.test.ts        ← UNCHANGED (Gate 4 baseline)
├── session.test.ts              ← UNCHANGED (Gate 4 baseline)
├── roles.test.ts                ← UNCHANGED (Gate 4 baseline)
├── types.test.ts                ← UNCHANGED (Gate 4 baseline)
├── semantic-index-build.test.ts ← UNCHANGED (Gate 4 baseline)
├── hybrid-scoring.test.ts       ← UNCHANGED (Gate 4 baseline — added in Phase 8)
├── hybrid-ranking.test.ts       ← UNCHANGED (Gate 4 baseline — added in Phase 8)
├── analytics-store.test.ts      ← NEW (Plan 09-01 — unit tests for AnalyticsStore mechanics)
└── analytics-integration.test.ts ← NEW (Plan 09-02 — engine emission, handle API, privacy, RBAC architectural)
```

### Pattern 1: Sibling Module (`src/analytics-store.ts`)

**What:** New module mirroring the structure of Phase 7's `src/semantic-index-builder.ts` and Phase 8's `src/hybrid-scoring.ts`. Pure storage + computation; no engine state, no MCP knowledge.

**When to use:** Whenever new functionality has a clean storage/computation boundary and would otherwise inflate `core.ts`.

**Why:** Mirrors Phase 7/8 precedent. Keeps `core.ts` slim (currently 562 lines post-Phase-8 — adding analytics inline would push it past 700). Easier to unit-test in isolation. The module's API surface is the only contract `core.ts` couples to — implementation can change.

**Module shape (from `src/session.ts`/`src/semantic-index-builder.ts` precedents):**

```typescript
// src/analytics-store.ts
import type { AnalyticsEvent, AnalyticsSnapshot, AnalyticsOptions, RoleConfig, ToolIndexEntry } from './types.js';
import { isToolAllowed, resolveRoleAccess } from './roles.js';

export class AnalyticsStore {
  // Sibling-module pattern from src/session.ts SessionRegistry:
  // private state field + public methods + JSDoc on class describing the role.
  private events: AnalyticsEvent[] = [];
  private readonly maxEvents: number;

  constructor(maxEvents: number = 10000) {
    this.maxEvents = maxEvents;
  }

  /** Record an event. O(1) amortized; O(n) worst case during eviction. */
  record(event: AnalyticsEvent): void { /* ... */ }

  /** Compute a snapshot. Optionally filtered to a single role. */
  snapshot(
    rolesConfig: RoleConfig | undefined,
    index: ToolIndexEntry[],
    options?: AnalyticsOptions,
  ): AnalyticsSnapshot { /* ... */ }

  /** Test-only: reset event log. */
  clear(): void { this.events = []; }
}
```

**Compared to `src/session.ts`:** the SessionRegistry has a similar shape — private `Map<string, Session>` + constructor with config + public `getOrCreate`/`destroy` + private `cleanup`. The AnalyticsStore parallels this with `events[]` + constructor with `maxEvents` + public `record`/`snapshot`/`clear`.

### Pattern 2: Direct Emission at Decision Points (No Abstraction Layer)

**What:** At each of the four decision points, the engine/adapter directly calls `engine.analytics.record({...})`. No `EventEmitter`, no `recordSearchEvent()` wrapper, no mediator pattern.

**When to use:** When the emission is a single line at a single site and the data needed is already in scope.

**Example:**
```typescript
// src/core.ts — inside buildSearchResponse, after computing results, before return:
session.queryLog.push({ query, results: results.map((r) => r.name), timestamp: Date.now() });

// NEW Phase 9 emission — directly inline:
const ts = Date.now();
this.analytics.record({
  type: 'search',
  query,
  role: role ?? '',
  tools: results.map((r) => r.name),
  ts,
});
if (matches.length === 0) {
  this.analytics.record({ type: 'miss', query, role: role ?? '', ts });
}
```

**Why direct (not abstracted):** CONTEXT §"Specific Ideas" explicitly forbids new abstraction layers: "The planner must NOT create new abstraction layers around event emission — direct method calls at the four sites is sufficient. Each site adds 1-3 lines." Adding `engine.recordAnalyticsEvent(...)` or `engine.emitSearch(...)` doesn't simplify anything — it just adds an indirection that obscures the call site.

**Note on `role ?? ''`:** Phase 1+ convention treats undefined role as "no permissions" — but in events we still need a string for filtering. Using `''` (empty string) is consistent with how `SessionRegistry.getOrCreate(sid, role ?? '')` already handles undefined role at the session boundary (see `src/core.ts:178`). Role-scoped queries for `role: ''` will match these events (which is the intended "no role configured" event view).

### Pattern 3: Bounded Shared Array with maxEvents=10000

**What:** Single `events: AnalyticsEvent[]` containing all four event types (discriminated union). On `record()`: if length >= maxEvents, `shift()` then `push()`. Snapshot filters by type at compute time.

**When to use:** When eviction policy is shared across types and overall event budget matters more than per-type budgets.

**Example:**
```typescript
record(event: AnalyticsEvent): void {
  if (this.events.length >= this.maxEvents) {
    this.events.shift();   // O(n) but n=10000 sub-millisecond on V8
  }
  this.events.push(event);
}
```

**Why shared (not four arrays):** Single eviction policy. Single overflow accounting. Filtering by type at snapshot is cheap (single linear pass already required for summary computation). Four arrays would require four separate maxEvents knobs (more config surface) or coordinated eviction (more bugs).

**Why `Array.shift` (not ring buffer):** At maxEvents=10000, `shift` overhead is ~150µs (V8 has fast-path for small array shift). A ring buffer is O(1) per record (~50ns) but adds ~60 LOC for the buffer + ~30 LOC for snapshot iteration with wrap-around. v1.1 picks the simpler reading; if real workloads push past 100k events, revisit in v1.2 with a benchmark.

### Pattern 4: Privacy Filter via `isToolAllowed` Exclusion

**What:** Role-scoped queries filter events using two predicates:
- `search`/`miss` events (no `tool` field): match on `event.role === options.role`.
- `call`/`denial` events: match on `isToolAllowed(event.tool, options.role, rolesConfig)` returning `true`.

**Crucially, the filter EXCLUDES entire events (no string redaction).** A denial event for tool X by role Y, when queried with `role: 'Z'`, is dropped entirely if Z can't see X — Z never learns the denial happened.

**Example:**
```typescript
private filterForRole(role: string, rolesConfig: RoleConfig | undefined): AnalyticsEvent[] {
  return this.events.filter((event) => {
    if (event.type === 'search' || event.type === 'miss') {
      // No tool field — filter on event.role
      return event.role === role;
    }
    // call/denial — filter on isToolAllowed
    return isToolAllowed(event.tool, role, rolesConfig);
  });
}
```

**Why exclusion (not redaction):** Strictly stronger privacy. Redaction (`{tool: '<redacted>', ...}`) leaks "a denial happened" to a role-scoped caller; exclusion makes it impossible to tell whether out-of-role denials exist at all. Matches REQ-v11-analytics-privacy literally: "must not expose tools outside that role" — exclusion satisfies this; redaction does not.

**Why reuse `isToolAllowed`:** The function already correctly handles wildcard (`*`), undefined role, unknown role, and role inheritance with cycle protection (see `src/roles.ts:35-46`). No new RBAC logic — Phase 9 does NOT define new policy.

### Pattern 5: Handle Delegation, Not Method Addition on Engine Surface

**What:** `MCPackHandle.getAnalytics` is a thin closure that calls `engine.getAnalytics(opts)`. The engine method is the implementation; the handle is the public access point.

**When to use:** Whenever a public-facing method needs operator-scope access to engine state.

**Example:**
```typescript
// src/wrap.ts — Phase 9 modification to handle return (lines 138-141):
return {
  destroy: () => engine.destroy(),
  stats: () => engine.stats(),
  getAnalytics: (options) => engine.getAnalytics(options), // NEW Phase 9
};
```

**Why delegate (not return engine directly):** Encapsulation. The handle is the v1.0+ public surface; the engine is internal (Phase 02 DEC). The handle exposes only the methods that are stable. Adding `getAnalytics` to the handle is the same pattern as `destroy`/`stats` (existing).

### Pattern 6: Wire-Protocol Exposure Ban (Gate 5)

**What:** `getAnalytics` is NEVER registered via `setRequestHandler`. Never appears in `tools/list`. Never reachable from `tools/call`. Architecturally invisible to the agent.

**Enforcement (structural, not behavioral):**
- Code review: NO `setRequestHandler(...analytics...)` line in `src/`.
- CI grep gate: `grep -E "setRequestHandler.*[Aa]nalytics|tools[/\\.]list.*[Aa]nalytics" src/` returns ZERO matches.
- Behavioral test (Pr5): construct an engine with analytics events recorded, register on `Server`, call `tools/call` with name `'getAnalytics'` → returns the standard `"Unknown tool: getAnalytics"` error path.
- Behavioral test (Pr6): construct an engine, call `tools/list` handler → response.tools.length === 1 && tools[0].name === 'search_tools'.

**Why this is the cleanest enforcement:** The boundary is a code-organization concern, not a runtime check. There is no `if (caller.isAgent) reject()` anywhere in the codebase. The enforcement is "we never wrote the line that would expose it." Gate 5's grep is the assertion that we never wrote it.

### Anti-Patterns to Avoid

- **Don't add an EventEmitter / pub-sub layer:** Subscriptions are explicitly v1.2-deferred per CONTEXT §Deferred. v1.1 ships pull-only (`getAnalytics()` on demand).
- **Don't redact tool names in role-scoped denial events:** Exclude the entire event. Redaction leaks "a denial happened." (Pattern 4 above.)
- **Don't compute `topTools` incrementally on each `record()`:** Snapshot-time computation is simpler and avoids cache-invalidation. Records stay O(1).
- **Don't add a request handler for analytics:** Use the handle. (Pattern 6 above. Gate 5 grep enforces.)
- **Don't store events keyed by session ID:** Per-process aggregation (DEC-v11-09-03) means sessions are not the boundary. Events carry `role` (filterable) but session correspondence is not a snapshot output.
- **Don't add fs/net imports:** In-memory only per REQ-v11-analytics-storage. The grep gate catches accidental persistence: `grep -E "import.*node:fs|import.*node:net|import.*node:http" src/analytics-store.ts` should return zero.
- **Don't re-implement RBAC predicates:** Reuse `isToolAllowed` and `resolveRoleAccess` from `src/roles.ts`. Phase 9 introduces zero RBAC logic.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Role-scoped predicate (allow/deny by role+tool) | A new `canRoleSeeTool(role, tool)` function | `isToolAllowed(tool, role, rolesConfig)` from `src/roles.ts` | Already handles wildcard, undefined role, unknown role, inheritance, cycle protection. Proven in 17 v1.0 RBAC tests + 14 Phase 8 RBAC tests. |
| Tools-visible-to-role (full list) | A new `getRoleVisibleTools(role)` function | `resolveRoleAccess(role, rolesConfig, index)` from `src/roles.ts` | Returns `ToolIndexEntry[]` for the role; map to `entry.name` for the deadTools input set. |
| Discriminated union narrowing | Manual `if (event.type === 'search') { ...event.query... }` blocks scattered everywhere | One filter helper inside `AnalyticsStore` returning the union, then narrow inside specific computations | Keeps narrowing colocated with the computation that needs it. Avoid hand-rolling type guards if TS already narrows on `type` field. |
| Bounded retention | A custom queue class | `Array.shift()`-on-overflow (Pattern 3) | At maxEvents=10000 the perf is fine. Custom queue adds ~60 LOC for sub-microsecond gain. |
| Snapshot caching | An LRU cache invalidated on `record()` | Recompute on each `getAnalytics()` call | Snapshot is O(events) which is sub-millisecond at 10k events. Caching adds invalidation bugs. v1.2 candidate if real workloads warrant. |
| Persistence layer | `node:fs` ndjson append, SQLite, leveldown, etc. | NOTHING — in-memory only | REQ-v11-analytics-storage explicitly forbids. v1.2 candidate. |
| Operator authentication / authorization | A new `isOperator(caller)` check | NOTHING — boundary is structural via handle | The handle IS the operator surface. There is no protocol path to it. |
| Top-N selection | A heap-based top-K library | `events.filter(...).reduce(toMap).entries().sort().slice(0,5)` | Linear pass + sort of small map. n=10000 events / max ~tools-count keys → microseconds. |

**Key insight:** Phase 9 is a feature add over a well-established codebase. EVERY new building block has an existing, proven analog in `src/roles.ts` (RBAC), `src/session.ts` (sibling-module shape), or `src/search.ts` (no need to redo scoring). The phase ships if it correctly composes existing primitives, not if it invents new ones.

## Runtime State Inventory

> Phase 9 is greenfield (additive only). No rename/refactor/migration. This section omitted per research protocol.

## Common Pitfalls

### Pitfall 1: Privacy Filter Applied to Wrong Field

**What goes wrong:** The naive filter `events.filter(e => e.role === options.role)` applied to `denial` events would incorrectly INCLUDE denials for restricted tools when the role-scoped caller doesn't have access. E.g., role X tried to call tool Y (X doesn't have Y access) → denial event `{type:'denial', tool:'Y', role:'X', ts}`. A scoped query for role X would include this — but role X shouldn't see Y in any output, including their own denial events for it.

**Why it happens:** Confusing "events authored by this role" with "events involving tools this role can see." For `search`/`miss` (no tool), the former is correct. For `call`/`denial` (have a tool), the latter is correct.

**How to avoid:** Two-predicate filter (Pattern 4 above). `isToolAllowed(event.tool, options.role, rolesConfig)` for tool-bearing events; `event.role === options.role` for query-bearing events.

**Warning signs:** A test for "role X scoped query returns role X's denial events" passes (correct) BUT a test for "role X scoped query EXCLUDES role X's denial events for tools X can't see" doesn't exist or fails.

### Pitfall 2: Accidentally Registering an Analytics Request Handler

**What goes wrong:** A reflexive copy-paste of the existing `setRequestHandler(ListToolsRequestSchema, ...)` pattern leads to a planner adding `setRequestHandler(SomeAnalyticsRequestSchema, ...)`. Now `getAnalytics` is reachable over the wire — REQ-v11-analytics-rbac-integrity violated.

**Why it happens:** Pattern-matching on existing code shape. The existing wire-handler registration is the most prominent code shape in `wrap.ts` and `build.ts`.

**How to avoid:** Gate 5 grep: `grep -E "setRequestHandler.*[Aa]nalytics" src/` returns ZERO. Run it as a [BLOCKING] gate in EACH plan. Pattern 6 above.

**Warning signs:** ANY edit to the `setRequestHandler` block in `wrap.ts:93` or `build.ts:103` outside of trivially adding a comment.

### Pitfall 3: Computing Snapshot from Mutated State

**What goes wrong:** `snapshot()` uses `this.config.roles` directly, but Phase 9 records events over time. If role config is somehow swappable mid-process (e.g., a future feature adds `engine.updateRoles()`), older events filter by the new config — historical denials for tools just granted to a role disappear from role-scoped queries.

**Why it happens:** Reasonable design choice — but worth documenting as a contract.

**How to avoid:** This is actually CORRECT behavior per CONTEXT (DEC-v11-09-02 edge case 5: "A `denial` event for a tool that is later granted to the role mid-process: the historical denial still exists in storage but is filtered out of role-scoped queries because the filter uses CURRENT role-config state, not historical."). Document in JSDoc on `getAnalytics()`. The pitfall here is FAILING TO DOCUMENT this — not the behavior itself.

**Warning signs:** A test for "role config mutation mid-process" doesn't exist. Add one as part of Plan 09-02's edge-case battery.

### Pitfall 4: maxEvents Boundary Off-By-One

**What goes wrong:** `if (events.length > maxEvents) shift()` fires AFTER push, leaving events.length = maxEvents+1 momentarily, then shift to maxEvents. OR `if (events.length >= maxEvents) shift()` fires BEFORE push, capping correctly at maxEvents. The two patterns produce different post-condition invariants (the first allows transient overshoot, the second doesn't).

**Why it happens:** Easy to get wrong on first pass.

**How to avoid:** Pre-push check: `if (this.events.length >= this.maxEvents) this.events.shift(); this.events.push(event);` — this guarantees `events.length <= maxEvents` always. Encode as a test invariant: after N+M `record()` calls where N >= maxEvents, `events.length === maxEvents`.

**Warning signs:** A test that records exactly maxEvents events doesn't assert `events.length === maxEvents`. A test that records maxEvents+1 events doesn't assert the SECOND event was the first to be evicted (preserving FIFO order).

### Pitfall 5: Confusing search-emitted-tools with call events for dead-tool computation

**What goes wrong:** `deadTools` reflects "tools never called." A naive impl might count tools that appeared in `search` event `tools[]` array as "used" — but per CONTEXT (DEC-v11-09-03 edge case 3: "Tool returned in a `search_tools` result but never actually invoked via `tools/call` → STILL in `deadTools`"). Counting search-emitted tools would mark them as alive when they're actually dead.

**Why it happens:** `search` events carry a `tools` array (the matched tools); `call` events carry a single `tool`. Easy to conflate.

**How to avoid:** `deadTools` computation reads ONLY `call` events. Filter `events.filter(e => e.type === 'call' && (role-scope-predicate))` then map to `tool` then put in a Set; subtract from `tools-visible-to-role`.

**Warning signs:** A test that emits a `search` event whose `tools[]` includes tool Y for role X, no `call` events for Y, queries `getAnalytics({role:'X'})`, and asserts Y IS in `deadTools` doesn't exist.

### Pitfall 6: Implicit Role Filtering at Operator Boundary

**What goes wrong:** Operator calls `getAnalytics()` (no role arg) and the implementation defaults to `options.role = config.defaultRole`. Operator sees only the default role's view, never the full operator view.

**Why it happens:** Reasonable-sounding default ("if no role, use defaultRole"). But it breaks the operator's diagnostic value (Pr3: "operator unscoped query returns full data").

**How to avoid:** `options?.role` undefined === unscoped (operator view). Empty string `''` === scoped to "no role" events. Don't conflate the two. Type the option as `{ role?: string | undefined }` and check `if (options?.role !== undefined)` to gate scoping.

**Warning signs:** A test for `engine.getAnalytics()` (no args) that asserts ALL events return AND the response surfaces tool names from cross-role denials doesn't exist.

### Pitfall 7: `role: undefined` vs `role: ''` Event Authorship

**What goes wrong:** v1.0 `MCPackEngine.handleSearchTools` calls `this.sessions.getOrCreate(sid, role ?? '')` — undefined role is normalized to empty string at the session boundary (see `src/core.ts:178`). But the `role` field on events COULD be either typed as `string | undefined` or always `string` (with `''` for undefined).

**Why it happens:** Inconsistent normalization across the codebase.

**How to avoid:** Match the existing convention. Events store `role: string` (always); use `''` for undefined role, matching how SessionRegistry already handles it. Role-scoped queries with `options.role === ''` match these events; queries with `options.role === undefined` are operator-unscoped (return all).

**Warning signs:** TypeScript type for `AnalyticsEvent.role` is `string | undefined` rather than `string`. Tests pass mixed `undefined`/`''` inputs without asserting normalization.

### Pitfall 8: Snapshot Computation Leaks Tool Names via Errors

**What goes wrong:** `getAnalytics({role: 'X'})` somehow throws an error containing a tool name from outside X's allowed set (e.g., `Error: tool 'admin_action' not in role X` thrown from a guard). The error message leaks the tool's existence.

**Why it happens:** Defensive guards that throw with descriptive messages.

**How to avoid:** Snapshot path MUST NOT throw on out-of-role tool encounters — it filters silently. The filter predicate is `isToolAllowed(...)` which returns boolean, never throws. The only legitimate snapshot throws are runtime validation (Pattern WR-02 carry-forward: bad `options.role` input — non-string when provided), and those throws contain the BAD INPUT, not internal data.

**Warning signs:** Any `throw new Error(...)` inside `AnalyticsStore.snapshot()` that interpolates a value from `events[]`. A test that verifies "snapshot throws an Error with NO interpolated tool names" doesn't exist.

### Pitfall 9: Coverage Trough Mid-Phase

**What goes wrong:** Plan 09-01 ships `analytics-store.ts` with no caller (engine doesn't emit yet). Coverage tool reports `analytics-store.ts` at low % because no integration test exercises the public methods through real engine paths.

**Why it happens:** Wave-based delivery means a module can land before its integrations.

**How to avoid:** DEC-v11-09-04 explicitly: "2 plans, each ships its own tests." Plan 09-01 includes its OWN unit tests for `AnalyticsStore` mechanics — coverage is achieved by DIRECT test invocation, not engine-driven. Plan 09-02 then adds integration tests. Coverage stays >=99% at every commit, not just at phase end. (Phase 8 used the same discipline; Phase 7 also did.)

**Warning signs:** Plan 09-01 lists "tests in Plan 09-02" instead of its own tests. The fix-loop is to move unit tests INTO Plan 09-01.

### Pitfall 10: Baseline Test Files Touched (Gate 4 Violation)

**What goes wrong:** Adding analytics emission inside `handleSearchTools` accidentally triggers a fail in `test/core.test.ts` (e.g., spying on `console.log` and seeing an unexpected emission, or asserting a specific behavior that the emission disrupts). Engineer "fixes" the test instead of the code → Gate 4 violation.

**Why it happens:** Existing tests may not anticipate the new side-effect surface.

**How to avoid:** Phase 9 should produce ZERO new console.warn / console.log / process.* side effects. The analytics emission is a private state mutation. If a baseline test fails, the BUG is in the emission (it has an unexpected observable side effect), not in the test. Plan-checker grep: `grep -E "console\\.|process\\." src/analytics-store.ts` must return zero matches.

**Warning signs:** A `git diff <baseline> -- test/<any-baseline-file>` returns nonzero lines after Plan 09-02's commit. Hard stop and revert; the emission is wrong.

## Code Examples

Verified patterns derived from `src/core.ts` (read in full), `src/wrap.ts`, `src/build.ts`, `src/types.ts`, `src/roles.ts`, `src/session.ts`, and `src/search.ts`.

### `src/types.ts` — additive type surface

```typescript
// ─── Public Analytics Types (Phase 9 — additive) ───────────────────────────

/**
 * A single captured analytics event. Discriminated union by `type`.
 * Stored in-memory only; resets on process restart (REQ-v11-analytics-storage).
 *
 * @since v1.1 (Phase 9)
 */
export type AnalyticsEvent =
  | { type: 'search'; query: string; role: string; tools: string[]; ts: number }
  | { type: 'call';   tool: string;  role: string; ts: number }
  | { type: 'denial'; tool: string;  role: string; ts: number }
  | { type: 'miss';   query: string; role: string; ts: number };

/**
 * Per-role aggregated summary for a snapshot.
 * `topTools` is the top-5 tools by call-count for this role.
 * `deadTools` is the set of tools the role can SEE but has never CALLED
 * (process-lifetime aggregate per DEC-v11-09-03).
 *
 * @since v1.1 (Phase 9)
 */
export interface AnalyticsByRoleSummary {
  searchCount: number;
  callCount: number;
  denialCount: number;
  missCount: number;
  topTools: string[];   // up to 5
  deadTools: string[];  // tools-visible-to-role ∖ tools-with-≥1-call-by-role
}

/**
 * Snapshot returned by `MCPackHandle.getAnalytics(options?)`.
 *
 * - When called without `options.role`: operator-unscoped — all events visible.
 * - When called with `options.role`: role-scoped — only events involving tools
 *   that role can see. Events for tools outside the role's allowed set are
 *   EXCLUDED entirely (no string redaction, no leakage).
 *
 * @since v1.1 (Phase 9)
 */
export interface AnalyticsSnapshot {
  searches: Array<{ query: string; role: string; tools: string[]; ts: number }>;
  calls:    Array<{ tool: string;  role: string; ts: number }>;
  denials:  Array<{ tool: string;  role: string; ts: number }>;
  misses:   Array<{ query: string; role: string; ts: number }>;
  summary: {
    byRole: Record<string, AnalyticsByRoleSummary>;
  };
}

/**
 * Options for `getAnalytics()`.
 * - `role`: when provided, scopes the snapshot to that role's view.
 *
 * @since v1.1 (Phase 9)
 */
export interface AnalyticsOptions {
  role?: string;
}

// ─── MCPackHandle (extended additively in Phase 9) ─────────────────────────

/**
 * Control handle returned by mcpack() for lifecycle management and analytics.
 */
export interface MCPackHandle {
  destroy(): void;
  stats(): { sessions: number; tools: number };
  /**
   * Operator-only analytics snapshot (Phase 9).
   *
   * Architectural boundary: this method is callable only from host-process
   * Node.js code that holds a reference to the handle. There is no MCP wire
   * surface exposing analytics — never registered via setRequestHandler, never
   * appears in tools/list (REQ-v11-analytics-rbac-integrity).
   *
   * - No `options` (or `options.role` undefined): operator-unscoped — full event
   *   data including tool names from all roles' denials. Use this for diagnostic
   *   sweeps ("which tools is role X being denied?").
   * - `options.role` provided: role-scoped — events EXCLUDED if they involve a
   *   tool outside that role's allowed set. Filter uses CURRENT role-config
   *   state, not historical: a denial recorded BEFORE the role gained tool Y
   *   will still be filtered out if Y is currently in the role's allowed set.
   *
   * @since v1.1 (Phase 9)
   */
  getAnalytics(options?: AnalyticsOptions): AnalyticsSnapshot;
}
```

### `src/index.ts` — additive re-exports

```typescript
export { mcpack } from './wrap.js';
export { createMCPackServer } from './build.js';

export type {
  MCPackConfig,
  MCPackServerConfig,
  MCPackToolDefinition,
  MCPackHandlerContext,
  MCPackServer,
  RoleConfig,
  IndexConfig,
  SessionConfig,
  SearchToolResponse,
  SearchResult,
  ToolCallResult,
  MCPackHandle,
  EmbeddingProvider,
  // NEW Phase 9 — additive only:
  AnalyticsEvent,
  AnalyticsByRoleSummary,
  AnalyticsSnapshot,
  AnalyticsOptions,
} from './types.js';
```

### `src/analytics-store.ts` — full skeleton

```typescript
// Source: derived from sibling-module pattern in src/session.ts SessionRegistry
// + DEC-v11-09-02 + DEC-v11-09-03 + Pattern 4 privacy filter.

import type {
  AnalyticsEvent,
  AnalyticsSnapshot,
  AnalyticsOptions,
  AnalyticsByRoleSummary,
  RoleConfig,
  ToolIndexEntry,
} from './types.js';
import { isToolAllowed, resolveRoleAccess } from './roles.js';

/**
 * In-memory bounded store for tool-usage analytics events.
 *
 * Captures four event types — `search`, `call`, `denial`, `miss` — at decision
 * points inside MCPackEngine. Resets on process restart (no persistence).
 *
 * Internal to the package — not exported from src/index.ts. Phase 9 surfaces
 * snapshots via MCPackHandle.getAnalytics, which delegates to MCPackEngine.
 *
 * @since v1.1 (Phase 9)
 */
export class AnalyticsStore {
  private events: AnalyticsEvent[] = [];
  private readonly maxEvents: number;

  constructor(maxEvents: number = 10000) {
    // Defensive: clamp non-positive maxEvents to 1 to avoid degenerate behavior.
    this.maxEvents = Math.max(1, Math.floor(maxEvents));
  }

  /**
   * Record an event. O(1) amortized; O(n) during eviction at capacity.
   * Pre-push check guarantees `events.length <= maxEvents` always (Pitfall 4).
   */
  record(event: AnalyticsEvent): void {
    if (this.events.length >= this.maxEvents) {
      this.events.shift();
    }
    this.events.push(event);
  }

  /**
   * Compute a snapshot of recorded events.
   *
   * @param rolesConfig - Engine's role config; used by isToolAllowed for filtering
   * @param index - Engine's tool index; used by resolveRoleAccess for deadTools
   * @param options - Optional `{ role?: string }` for role-scoping
   *
   * Operator-unscoped (no options.role): returns all events; summary.byRole
   * computed for every role that appears in any event + every role in rolesConfig.
   *
   * Role-scoped (options.role string): returns ONLY events whose tool is allowed
   * for that role (call/denial) OR whose author role matches (search/miss).
   * summary.byRole only contains the requested role.
   */
  snapshot(
    rolesConfig: RoleConfig | undefined,
    index: ToolIndexEntry[],
    options?: AnalyticsOptions,
  ): AnalyticsSnapshot {
    // WR-02 carry-forward: runtime input validation.
    const scopeRole = typeof options?.role === 'string' ? options.role : undefined;

    const filtered = scopeRole === undefined
      ? this.events.slice()  // unscoped — copy for stability against further records
      : this.events.filter((e) => this.eventVisibleTo(e, scopeRole, rolesConfig));

    // Bucket by type for the snapshot arrays (drops the `type` discriminator).
    const searches: AnalyticsSnapshot['searches'] = [];
    const calls:    AnalyticsSnapshot['calls']    = [];
    const denials:  AnalyticsSnapshot['denials']  = [];
    const misses:   AnalyticsSnapshot['misses']   = [];
    for (const e of filtered) {
      if (e.type === 'search')      searches.push({ query: e.query, role: e.role, tools: e.tools, ts: e.ts });
      else if (e.type === 'call')   calls.push({ tool: e.tool, role: e.role, ts: e.ts });
      else if (e.type === 'denial') denials.push({ tool: e.tool, role: e.role, ts: e.ts });
      else if (e.type === 'miss')   misses.push({ query: e.query, role: e.role, ts: e.ts });
    }

    // Compute summary.byRole.
    const byRole: Record<string, AnalyticsByRoleSummary> = {};
    const rolesToSummarize = scopeRole !== undefined
      ? [scopeRole]
      : this.collectRoles(rolesConfig);
    for (const r of rolesToSummarize) {
      byRole[r] = this.summarizeForRole(r, rolesConfig, index, filtered);
    }

    return { searches, calls, denials, misses, summary: { byRole } };
  }

  /** Test-only: reset event log. Public per Claude's discretion + JSDoc warning. */
  clear(): void {
    this.events = [];
  }

  // ─── Internal helpers ──────────────────────────────────────────────────

  /** Apply two-predicate privacy filter (Pattern 4 / Pitfall 1). */
  private eventVisibleTo(
    event: AnalyticsEvent,
    role: string,
    rolesConfig: RoleConfig | undefined,
  ): boolean {
    if (event.type === 'search' || event.type === 'miss') {
      return event.role === role;
    }
    // call/denial — must check tool against role's allowed set
    return isToolAllowed(event.tool, role, rolesConfig);
  }

  /** Compute per-role summary including deadTools (Pitfall 5). */
  private summarizeForRole(
    role: string,
    rolesConfig: RoleConfig | undefined,
    index: ToolIndexEntry[],
    visibleEvents: AnalyticsEvent[],
  ): AnalyticsByRoleSummary {
    let searchCount = 0;
    let callCount = 0;
    let denialCount = 0;
    let missCount = 0;
    const callCountByTool = new Map<string, number>();

    for (const e of visibleEvents) {
      if (e.type === 'search') {
        if (e.role === role) searchCount++;
      } else if (e.type === 'miss') {
        if (e.role === role) missCount++;
      } else if (e.type === 'call') {
        if (isToolAllowed(e.tool, role, rolesConfig)) {
          callCount++;
          callCountByTool.set(e.tool, (callCountByTool.get(e.tool) ?? 0) + 1);
        }
      } else if (e.type === 'denial') {
        if (isToolAllowed(e.tool, role, rolesConfig)) denialCount++;
      }
    }

    // topTools[5]: sort tools by call count desc, take 5 names.
    const topTools = Array.from(callCountByTool.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tool]) => tool);

    // deadTools = tools-visible-to-role ∖ tools-with-≥1-call-by-role (Pitfall 5).
    const visible = resolveRoleAccess(role, rolesConfig, index).map((entry) => entry.name);
    const calledTools = new Set(callCountByTool.keys());
    const deadTools = visible.filter((name) => !calledTools.has(name));

    return { searchCount, callCount, denialCount, missCount, topTools, deadTools };
  }

  /** Collect all known roles for unscoped summary.byRole. */
  private collectRoles(rolesConfig: RoleConfig | undefined): string[] {
    const set = new Set<string>();
    for (const e of this.events) set.add(e.role);
    if (rolesConfig) for (const k of Object.keys(rolesConfig)) set.add(k);
    return Array.from(set);
  }
}
```

### Event emission sites — exact line annotations

#### `src/core.ts` — `buildSearchResponse` (after Phase 8 refactor)

```typescript
// Existing code (src/core.ts:259-263):
session.queryLog.push({
  query,
  results: results.map((r) => r.name),
  timestamp: Date.now(),
});

// NEW Phase 9 emission — INSERT immediately after the queryLog push:
const ts = Date.now();
this.analytics.record({
  type: 'search',
  query,
  role: role ?? '',
  tools: results.map((r) => r.name),
  ts,
});
if (matches.length === 0) {
  this.analytics.record({
    type: 'miss',
    query,
    role: role ?? '',
    ts,
  });
}

// Existing code continues unchanged:
const allowed = resolveRoleAccess(role, this.config.roles, this.index);
const response: SearchToolResponse = { ... };
return { content: [{ type: 'text', text: JSON.stringify(response) }] };
```

**Why `buildSearchResponse` (not `handleSearchTools`):** Phase 8 extracted `buildSearchResponse` as the unified response-building helper invoked by BOTH the sync no-vectors path AND the async hybrid path. Emitting here means the search/miss event fires exactly once per `search_tools` invocation, regardless of which path the engine took. (Source: `src/core.ts:243-276` — Phase 8 verification confirmed this is the single response-building site.)

#### `src/wrap.ts` — `tools/call` dispatch

```typescript
// Existing code at src/wrap.ts:108-114 (denial branch):
if (!isToolAllowed(name, defaultRole, roles)) {
  // NEW Phase 9 — emit denial BEFORE the opaque "Unknown tool" return:
  engine.analytics.record({
    type: 'denial',
    tool: name,
    role: defaultRole ?? '',
    ts: Date.now(),
  });
  return {
    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
    isError: true,
  };
}

// Existing code at src/wrap.ts:117-122 (no-original-handler branch — also a "denial"-equivalent):
if (!originalCallHandler) {
  // NEW Phase 9 — emit denial here too (user-facing message is identical "Unknown tool"):
  engine.analytics.record({
    type: 'denial',
    tool: name,
    role: defaultRole ?? '',
    ts: Date.now(),
  });
  return {
    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
    isError: true,
  };
}

// Existing code at src/wrap.ts:124-128 (success path):
try {
  const result = await originalCallHandler(request, extra);
  const sessionId = (extra as any).sessionId as string | undefined;
  engine.markToolLoaded(name, sessionId);
  // NEW Phase 9 — emit call AFTER markToolLoaded but BEFORE return:
  engine.analytics.record({
    type: 'call',
    tool: name,
    role: defaultRole ?? '',
    ts: Date.now(),
  });
  return result;
} catch (err: any) {
  return { ... };  // No emission on failure — failures don't count as calls (CONTEXT specifics)
}
```

**Note on `engine.analytics`:** Phase 9 makes `analytics` a `public readonly` field on `MCPackEngine` (rather than calling `engine.recordCallEvent(...)` etc.) because (a) CONTEXT explicitly forbids new abstraction layers around emission and (b) `analytics` access from `wrap.ts`/`build.ts` mirrors how `markToolLoaded` is exposed today. Engine remains internal (Phase 02 DEC) — the field is internal-package, not exported.

#### `src/build.ts` — `tools/call` dispatch

```typescript
// Existing code at src/build.ts:121-126 (denial branch):
if (!isToolAllowed(name, defaultRole, roles)) {
  // NEW Phase 9 — emit denial BEFORE the opaque "Unknown tool" return:
  engine.analytics.record({
    type: 'denial',
    tool: name,
    role: defaultRole ?? '',
    ts: Date.now(),
  });
  return {
    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
    isError: true,
  };
}

// Existing code at src/build.ts:128-134 (no-handler branch):
const handler = dispatch.get(name);
if (!handler) {
  // NEW Phase 9 — emit denial here too:
  engine.analytics.record({
    type: 'denial',
    tool: name,
    role: defaultRole ?? '',
    ts: Date.now(),
  });
  return {
    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
    isError: true,
  };
}

// Existing code at src/build.ts:137-147 (success path):
try {
  const sessionId = (extra as any).sessionId as string | undefined;
  const sid = sessionId ?? '__stdio__';
  const ctx: MCPackHandlerContext = { toolName: name, sessionId: sid, role: defaultRole };
  const result = await handler(args, ctx);
  engine.markToolLoaded(name, sessionId);
  // NEW Phase 9 — emit call AFTER markToolLoaded but BEFORE return:
  engine.analytics.record({
    type: 'call',
    tool: name,
    role: defaultRole ?? '',
    ts: Date.now(),
  });
  return normalizeResult(result);
} catch (err: any) {
  return { ... };  // No emission on failure
}
```

### Handle wiring in `wrap.ts` and `build.ts`

```typescript
// src/wrap.ts:138-142 (handle return) — MODIFIED additively:
return {
  destroy: () => engine.destroy(),
  stats: () => engine.stats(),
  getAnalytics: (options) => engine.getAnalytics(options), // NEW Phase 9
};

// src/build.ts:163-167 (handle return) — MODIFIED additively:
return {
  server,
  handle: {
    destroy: () => engine.destroy(),
    stats: () => engine.stats(),
    getAnalytics: (options) => engine.getAnalytics(options), // NEW Phase 9
  },
};
```

### `MCPackEngine.getAnalytics` (new public method)

```typescript
// src/core.ts — new public method on MCPackEngine:

/**
 * Compute an analytics snapshot from recorded events.
 *
 * Operator-only entry point. Reachable from MCPackHandle.getAnalytics, which
 * is callable only from host-process code (no MCP wire surface). Never registered
 * via setRequestHandler; never appears in tools/list (Gate 5 enforcement).
 *
 * @param options - Optional `{ role?: string }` for role-scoping.
 *   - undefined or `options.role` undefined: operator-unscoped (full event data).
 *   - `options.role` provided: role-scoped — events EXCLUDED if they involve a
 *     tool outside the role's allowed set (per DEC-v11-09-02).
 *
 * @since v1.1 (Phase 9)
 */
getAnalytics(options?: AnalyticsOptions): AnalyticsSnapshot {
  return this.analytics.snapshot(this.config.roles, this.index, options);
}
```

### `MCPackEngine` constructor extension (1 field add)

```typescript
// Inside MCPackEngine class (src/core.ts ~line 50, after existing private fields):
public readonly analytics: AnalyticsStore;

// Inside constructor (src/core.ts ~line 55, before searchToolDefinition):
constructor(tools: Tool[], config: MCPackConfig) {
  this.config = config;
  this.index = buildIndex(tools);
  this.sessions = new SessionRegistry(config.session);
  this.analytics = new AnalyticsStore();  // NEW Phase 9 — uses default maxEvents=10000
  // ... rest of constructor unchanged
}
```

**Why `public readonly analytics`:** Mode adapters (`wrap.ts`/`build.ts`) need to call `engine.analytics.record(...)` directly (Pattern 2 — no abstraction layer). `public readonly` makes the field accessible from sibling adapter modules without exposing mutation. The `MCPackEngine` class itself is internal (not exported from `src/index.ts`), so this isn't a public-API surface change.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hand-rolled session tracking via session.queryLog | `AnalyticsStore` for global event aggregation | Phase 9 (this phase) | Per-session queryLog stays (existing v1.0 behavior); analytics adds aggregate process-lifetime view across sessions. Two surfaces, two purposes. |
| `engine.handleSearchTools` returns `ToolCallResult` synchronously | Returns `ToolCallResult \| Promise<ToolCallResult>` (Phase 8) | Phase 8 | Phase 9 doesn't add async surfaces. The sync-or-async union from Phase 8 is preserved. |
| Filter-then-rank in handleSearchTools | Rank-then-filter (Phase 8 pivot) | Phase 8 | Phase 9 doesn't touch the ranking pipeline. The role filter still applies AFTER ranking. |
| No analytics surface | `getAnalytics()` on MCPackHandle | Phase 9 (this phase) | Operator-only API, structural boundary, in-memory only. |

**Deprecated/outdated:**
- None. v1.1 is purely additive over v1.0. Phase 9 is the fourth additive phase in the milestone.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `Array.shift` overhead at maxEvents=10000 is sub-millisecond on modern V8 | Pattern 3 + Don't Hand-Roll | If perf is worse than expected, revisit ring buffer in v1.2. Negligible risk for v1.1 — the eviction frequency is bounded by record() rate. |
| A2 | snapshot O(events) computation is sub-millisecond at 10k events | Standard Stack §"Alternatives" | If snapshot is slower than expected, add caching in v1.2. Risk: getAnalytics becomes a perf hot path — but typical use is operator-driven (low frequency), not tight-loop. |
| A3 | `role: string` (always, with `''` for undefined) matches existing SessionRegistry convention without breaking type-checking | Pattern 2 + Pitfall 7 | If `role: string \| undefined` is preferred for type ergonomics, the filter logic adapts (extra `event.role === options.role` check stays safe with both). Low risk; convention choice. |

**If this table is empty:** All claims in this research were verified or cited — no user confirmation needed. (Three minor performance/convention assumptions logged here are flagged but low-risk; planner can proceed without confirmation.)

## Open Questions (RESOLVED)

> Plan-checker dimension 11 enforces inline `RESOLVED:` markers per Phase 8 convention.

1. **OQ1: getAnalytics() shape on handle (flat vs nested under `analytics` property)**
   - RESOLVED: DEC-v11-09-01 — flat method on `MCPackHandle.getAnalytics()`, mirroring `destroy()`/`stats()`. Smallest surface; matches PRD literally; revisitable in v1.2 if more analytics methods land.

2. **OQ5: Denial events record tool name even for operators (RBAC-sensitive)**
   - RESOLVED: DEC-v11-09-02 — store full `{tool, role, ts}` always; role-scoped queries EXCLUDE entire events whose tool isn't in the role's allowed set. Operator-unscoped queries see everything (full diagnostic value). Reuses Phase 8's `isToolAllowed` for the filter predicate. No string redaction.

3. **Dead-tool detection scope (per-session vs process-lifetime)**
   - RESOLVED: DEC-v11-09-03 — process-lifetime aggregate per role. Matches REQ-v11-analytics-storage's "resets on process restart" boundary. Per-session would be ambiguous (which session does `summary.byRole[role]` reflect?) and noisy.

4. **Plan slicing (1 plan vs 2 plans vs 3 plans)**
   - RESOLVED: DEC-v11-09-04 — 2 plans, each ships its own tests. Plan 09-01: AnalyticsStore module + unit tests. Plan 09-02: Engine integration + handle API + integration tests. Mirrors Phase 8's discipline (no coverage trough mid-phase).

5. **Internal event storage shape (shared array vs four typed arrays)**
   - RESOLVED: Claude's Discretion → research recommends SHARED array with discriminated union. Single eviction policy across all event types; filter-by-type at snapshot time is O(events) which is already required for summary computation.

6. **Bounded array implementation (Array.shift vs ring buffer)**
   - RESOLVED: Claude's Discretion → research recommends `Array.shift`. At maxEvents=10000, perf difference is negligible (~150µs vs 50ns per eviction); ring buffer adds ~60 LOC. Simpler reading wins for v1.1.

7. **`topTools` computation (snapshot-time vs incremental)**
   - RESOLVED: Claude's Discretion → research strongly recommends snapshot-time. Keeps `record()` O(1); avoids cache-invalidation bugs; matches dead-tools timing.

8. **`clear()` access (public vs private)**
   - RESOLVED: Claude's Discretion → research recommends PUBLIC with JSDoc warning "for test fixtures only." Matches Phase 7/8 conventions; tests need a way to reset state for sequential scenarios.

9. **AnalyticsStore method names (`record` vs `capture` vs `emit`; `snapshot` vs `getSnapshot`)**
   - RESOLVED: Claude's Discretion → research recommends `record(event)` and `snapshot(...)`. `record` matches event-sourcing vocabulary; avoid `emit` (suggests EventEmitter semantics that v1.1 doesn't provide).

10. **`engine.analytics` access modifier (public vs private)**
    - RESOLVED: Research recommends `public readonly` so `wrap.ts`/`build.ts` can call `engine.analytics.record(...)` directly without an abstraction layer (per CONTEXT §"Specific Ideas"). `MCPackEngine` is internal (Phase 02 DEC), so this isn't a public-API surface change.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime (Date.now, Map, Set, Array) | ✓ | v24.2.0 (>= 18.0.0 required) | — |
| TypeScript | Build (strict, NodeNext) | ✓ | 5.8.3 (project pin; npm-current 6.0.3) | — |
| Vitest | Test framework | ✓ | 4.1.5 (npm-current; satisfies ^4.1.0) | — |
| `@vitest/coverage-v8` | Statement coverage | ✓ | 4.1.0+ | — |
| `@modelcontextprotocol/sdk` | Tool type, Server type | ✓ | 1.27.1 (dev) / 1.29.0 (latest); satisfies ^1.0.0 peer | — |
| Git | Gate 1/4 baseline diffs | ✓ | (system) | — |
| jq | Gate 1 broadened deps selector | ✓ | (system) | — |
| grep | Gate 3, Gate 5 enforcement | ✓ | (system) | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

All Phase 9 work is in-tree TypeScript with the existing test framework. No external services, no model downloads, no network reachability required.

## Validation Architecture

> `workflow.nyquist_validation` is `true` in `.planning/config.json` (and absent === enabled). This section is REQUIRED.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 |
| Config file | `vitest.config.ts` (existing — no changes for Phase 9) |
| Quick run command | `npx vitest run test/analytics-store.test.ts test/analytics-integration.test.ts -- --reporter=verbose` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-v11-analytics-events | AnalyticsStore captures search/call/denial/miss with correct payload shape | unit | `npx vitest run test/analytics-store.test.ts -t "captures all four event types"` | ❌ Plan 09-01 (Wave 0) |
| REQ-v11-analytics-events | Engine emits search event after buildSearchResponse | integration | `npx vitest run test/analytics-integration.test.ts -t "emits search event"` | ❌ Plan 09-02 (Wave 0) |
| REQ-v11-analytics-events | Engine emits miss event when matches.length === 0 | integration | `npx vitest run test/analytics-integration.test.ts -t "emits miss event"` | ❌ Plan 09-02 (Wave 0) |
| REQ-v11-analytics-events | wrap.ts emits call event after markToolLoaded | integration | `npx vitest run test/analytics-integration.test.ts -t "wrap mode emits call event"` | ❌ Plan 09-02 (Wave 0) |
| REQ-v11-analytics-events | build.ts emits call event after markToolLoaded | integration | `npx vitest run test/analytics-integration.test.ts -t "build mode emits call event"` | ❌ Plan 09-02 (Wave 0) |
| REQ-v11-analytics-events | wrap.ts AND build.ts emit denial event before "Unknown tool" return | integration | `npx vitest run test/analytics-integration.test.ts -t "emits denial event"` | ❌ Plan 09-02 (Wave 0) |
| REQ-v11-analytics-storage | Bounded retention at maxEvents=10000 (default) | unit | `npx vitest run test/analytics-store.test.ts -t "bounded eviction"` | ❌ Plan 09-01 (Wave 0) |
| REQ-v11-analytics-storage | No fs/net imports in src/analytics-store.ts | structural | `grep -E "import.*node:(fs\|net\|http)" src/analytics-store.ts` exits 1 | ❌ Plan 09-01 acceptance gate |
| REQ-v11-analytics-storage | Resets on process restart (new engine = empty events) | unit | `npx vitest run test/analytics-store.test.ts -t "starts empty"` | ❌ Plan 09-01 (Wave 0) |
| REQ-v11-analytics-privacy (Pr1) | Role-scoped query EXCLUDES denials for tools not in role's allowed set | integration | `npx vitest run test/analytics-integration.test.ts -t "Pr1"` | ❌ Plan 09-02 (Wave 0) |
| REQ-v11-analytics-privacy (Pr2) | Role-scoped query EXCLUDES search/call/miss events not authored by role | integration | `npx vitest run test/analytics-integration.test.ts -t "Pr2"` | ❌ Plan 09-02 (Wave 0) |
| REQ-v11-analytics-privacy (Pr3) | Operator unscoped query returns full data | integration | `npx vitest run test/analytics-integration.test.ts -t "Pr3"` | ❌ Plan 09-02 (Wave 0) |
| REQ-v11-analytics-privacy (Pr4) | Wildcard role (`*`) sees full universe | integration | `npx vitest run test/analytics-integration.test.ts -t "Pr4"` | ❌ Plan 09-02 (Wave 0) |
| REQ-v11-analytics-api | getAnalytics returns AnalyticsSnapshot shape from handle | integration | `npx vitest run test/analytics-integration.test.ts -t "handle.getAnalytics returns snapshot"` | ❌ Plan 09-02 (Wave 0) |
| REQ-v11-analytics-api | Both wrap and build mode handles expose getAnalytics | integration | `npx vitest run test/analytics-integration.test.ts -t "wrap mode handle exposes getAnalytics"` AND `... -t "build mode handle exposes getAnalytics"` | ❌ Plan 09-02 (Wave 0) |
| REQ-v11-analytics-role-scoped-query | `getAnalytics({role:'X'})` filters events; no-arg returns all | integration | `npx vitest run test/analytics-integration.test.ts -t "role-scoped"` | ❌ Plan 09-02 (Wave 0) |
| REQ-v11-analytics-rbac-integrity (Pr5) | tools/call with name 'getAnalytics' returns "Unknown tool" | integration | `npx vitest run test/analytics-integration.test.ts -t "Pr5"` | ❌ Plan 09-02 (Wave 0) |
| REQ-v11-analytics-rbac-integrity (Pr6) | tools/list returns exactly one tool, name === 'search_tools' | integration | `npx vitest run test/analytics-integration.test.ts -t "Pr6"` | ❌ Plan 09-02 (Wave 0) |
| REQ-v11-analytics-rbac-integrity | Gate 5 grep finds zero setRequestHandler analytics references | structural | `grep -E "setRequestHandler.*[Aa]nalytics\|tools[/\\.]list.*[Aa]nalytics" src/` exits 1 | ❌ Phase 9 acceptance gate (both plans) |
| REQ-v11-dead-tool-detection | Tool granted to role + zero call events → in deadTools | unit + integration | `npx vitest run test/analytics-store.test.ts -t "deadTools includes never-called"` AND `npx vitest run test/analytics-integration.test.ts -t "deadTools — search-only does not count"` | ❌ Plan 09-01 + Plan 09-02 (Wave 0) |
| REQ-v11-dead-tool-detection | Tool returned in search results but never called → STILL in deadTools | unit | `npx vitest run test/analytics-store.test.ts -t "deadTools excludes search-emitted-but-not-called"` | ❌ Plan 09-01 (Wave 0) |
| REQ-v11-dead-tool-detection | Wildcard role with no call events → deadTools = ALL tools | integration | `npx vitest run test/analytics-integration.test.ts -t "deadTools wildcard role"` | ❌ Plan 09-02 (Wave 0) |

### Sampling Rate

- **Per task commit:** `npx vitest run test/analytics-store.test.ts test/analytics-integration.test.ts -- --reporter=verbose` (the new test files only — fastest signal of regression on the Phase 9 surface).
- **Per wave merge:** `npm test` (full suite — confirms baseline 187 tests + new Phase 9 tests all pass).
- **Phase gate:** `npm run typecheck && npm run build && npm test && npm run test:coverage` all green before `/gsd-verify-work`. Coverage stays >=99.73% (Phase 8 baseline).

### Wave 0 Gaps

- [ ] `test/analytics-store.test.ts` — covers REQ-v11-analytics-events (unit-level), REQ-v11-analytics-storage, REQ-v11-dead-tool-detection (unit-level)
- [ ] `test/analytics-integration.test.ts` — covers REQ-v11-analytics-privacy (Pr1-Pr4), REQ-v11-analytics-api, REQ-v11-analytics-role-scoped-query, REQ-v11-analytics-rbac-integrity (Pr5-Pr6), REQ-v11-dead-tool-detection (integration-level)
- [ ] (No conftest/fixture file gap — Vitest fixtures inline per existing conventions in `test/hybrid-ranking.test.ts`)
- [ ] (No framework install gap — Vitest 4.1.5 already configured)

### Test Pyramid Detail (per CONTEXT requirement)

**Unit tests (Plan 09-01 — `test/analytics-store.test.ts`, target ~14-18 tests):**
- AnalyticsStore mechanics:
  - constructor accepts maxEvents; default = 10000; clamps non-positive to 1
  - record() appends to internal array
  - record() evicts oldest at capacity (FIFO)
  - record() preserves order across all four event types
  - clear() resets to empty
- snapshot() shape:
  - snapshot() with no events returns empty arrays + summary.byRole = {} (or contains rolesConfig keys with zeros)
  - snapshot() bucketizes events into searches[]/calls[]/denials[]/misses[]
  - snapshot() unscoped returns full event data
- snapshot() role-scoped filtering (Pattern 4):
  - role-scoped query for role X: search/miss filtered by event.role === X
  - role-scoped query for role X: call/denial filtered by isToolAllowed(event.tool, X, ...)
  - role-scoped query for unknown role: empty arrays + zero summary
  - role-scoped query for wildcard role: all events visible
- summary computation:
  - searchCount/callCount/denialCount/missCount accurate
  - topTools[5]: sorted by call count desc, limited to 5
  - topTools[5]: empty when no calls
  - deadTools: includes role-visible-tools that have zero call events
  - deadTools: search-emitted tools without call events still in deadTools (Pitfall 5 control)
  - deadTools: wildcard role with no calls → all tools in deadTools

**Integration tests (Plan 09-02 — `test/analytics-integration.test.ts`, target ~12-18 tests):**
- Engine emission end-to-end:
  - constructing engine creates an empty analytics store
  - handleSearchTools (sync no-vectors path) emits search event
  - handleSearchTools (sync no-vectors path) emits miss event when matches=[]
  - handleSearchTools (async hybrid path) emits search event
  - handleSearchTools (async hybrid path) emits miss event when matches=[]
- Wrap mode emission:
  - successful tools/call emits call event
  - role-blocked tools/call emits denial event
  - "no original handler" tools/call emits denial event
  - failed handler does NOT emit call event (try/catch path)
- Build mode emission:
  - successful tools/call emits call event
  - role-blocked tools/call emits denial event
  - "no handler in dispatch" tools/call emits denial event
  - failed handler does NOT emit call event
- Handle API:
  - wrap mode handle.getAnalytics() returns snapshot
  - build mode handle.getAnalytics() returns snapshot
  - getAnalytics({role:'X'}) returns role-scoped snapshot
  - getAnalytics() (no args) returns operator-unscoped snapshot
- RBAC architectural (Pr5/Pr6 + Gate 5):
  - tools/list returns exactly one tool named search_tools (Pr6)
  - tools/call with name 'getAnalytics' returns "Unknown tool" (Pr5)
  - getAnalytics never registered via setRequestHandler (Gate 5 grep at acceptance time)

**Privacy negative controls (encoded in integration tests, Pr1-Pr4):**
- Pr1 — 4-tool engine, role X allowed 2 tools; emit denials for 4 tools across roles; assert role-scoped query for X has zero out-of-role denials
- Pr2 — emit search/call/miss events from multiple roles; assert role-scoped query returns ONLY events with event.role === X
- Pr3 — operator unscoped query returns full data; tool names visible in denials regardless of role
- Pr4 — wildcard role (`'*'`) role-scoped query returns full event set

**WR-03 rename-safe RBAC pattern (carry-forward):**
- All NEW Phase 9 RBAC tests MUST iterate `tools.map((t) => t.name)` rather than hardcoding fixture names. Acceptance: `grep -c "tools.map((t) => t.name)" test/analytics-integration.test.ts` >= 4.

### Coverage Targets per File

| File | Current | Phase 9 Target | Reasoning |
|------|---------|----------------|-----------|
| `src/analytics-store.ts` | (new) | 100% statement / 100% branch / 100% function / 100% line | New file with focused responsibilities; full coverage achievable via unit tests |
| `src/core.ts` | 100% / 96.36% / 100% / 100% (Phase 8) | maintain >= 99% statement | Adds 1 field + 1 method + 2 emission lines (search+miss); each line touched by integration tests |
| `src/wrap.ts` | (Phase 8 unchanged) | maintain >= 99% statement | Adds 4 emission lines (call success + 3 denial paths) + 1 handle field; each line touched by integration tests |
| `src/build.ts` | (Phase 8 unchanged) | maintain >= 99% statement | Same as wrap.ts but build mode |
| `src/types.ts` | 100% (types only) | 100% | Type-only file; covered by tsc compilation |
| `src/index.ts` | 100% | 100% | Re-export only |
| `src/roles.ts` | 100% (existing) | 100% (unchanged) | Read-only — Phase 9 imports `isToolAllowed` and `resolveRoleAccess` |
| `src/session.ts` | (existing) | (unchanged) | Read-only sibling-module reference |

**Project-level target:** statement coverage stays >= 99.73% (Phase 8 baseline). Phase 9 should push toward 99.80%+ by adding ~24-38 tests over the new analytics surface.

### Privacy Invariants Encoded as Negative Controls

| Invariant | Test Site | Negative Control |
|-----------|-----------|------------------|
| Pr1: role-scoped denials EXCLUDE out-of-role tool events | `test/analytics-integration.test.ts` | A 4-tool engine with role X allowed 2 tools; emit denials for ALL 4 tools across multiple roles; assert role-scoped query for X has `denials.every(d => isToolAllowed(d.tool, 'X', rolesConfig))` true |
| Pr2: role-scoped search/miss EXCLUDE foreign roles | `test/analytics-integration.test.ts` | Emit events with role 'admin' AND role 'reader'; query with role 'reader'; assert `searches.every(s => s.role === 'reader')` and same for misses |
| Pr3: operator unscoped sees full data | `test/analytics-integration.test.ts` | Emit denials with tool names from across roles; `getAnalytics()` no-args returns ALL of them with tool names visible |
| Pr4: wildcard role sees full universe | `test/analytics-integration.test.ts` | Configure role 'admin' = `'*'`; emit events touching all 4 tools; `getAnalytics({role:'admin'})` returns events for all 4 tool names |
| Pr5: getAnalytics unreachable via wire | `test/analytics-integration.test.ts` | Construct Server with engine; call the tools/call handler with `name: 'getAnalytics'`; assert response.content[0].text === `'Unknown tool: getAnalytics'` AND `isError: true` |
| Pr6: tools/list returns exactly search_tools | `test/analytics-integration.test.ts` | Construct Server with engine; call the tools/list handler; assert `response.tools.length === 1 && response.tools[0].name === 'search_tools'` |

### Acceptance Gates (BLOCKING, run at every plan boundary)

| Gate | Command | Expected |
|------|---------|----------|
| 1: Zero new core deps | `diff <(jq -S '{dependencies, peerDependencies, optionalDependencies, bundledDependencies}' package.json) <(git show <baseline>:package.json \| jq -S '{dependencies, peerDependencies, optionalDependencies, bundledDependencies}')` | Empty diff |
| 2: Public-API additive-only | `git diff <baseline> -- src/index.ts \| diff-stat` | Net new lines only; no removals or signature changes |
| 3: Adapter isolation | `grep -rE "@llvs/mcpack-embeddings\|@huggingface/transformers\|@xenova/transformers" src/ test/` | Exit 1 (no matches) |
| 4: Baseline tests byte-identical | `git diff <baseline> -- test/{build,core,index-builder,roles,search,session,types,wrap,semantic-index-build,hybrid-scoring,hybrid-ranking}.test.ts \| wc -l` | 0 |
| 5 (NEW): Wire-protocol exposure ban | `grep -E "setRequestHandler.*[Aa]nalytics\|tools[/\\.]list.*[Aa]nalytics" src/` | Exit 1 (no matches) |
| 6 (implicit): No fs/net imports in analytics-store | `grep -E "from ['\"]node:(fs\|net\|http\|https)" src/analytics-store.ts` | Exit 1 (no matches) |
| 7 (implicit): No new console.warn/log in src/ | `grep -c "console\\." src/analytics-store.ts src/wrap.ts src/build.ts` outside the existing 3 sites in core.ts + 3 in wrap/build (defaultRole + dispatch warnings) | Unchanged from baseline |

## Patterns to Follow (carry-forward from Phases 6 + 7 + 8)

### From Phase 6 (Adapter Scaffold)
- **Zero-dep gate.** `package.json` `dependencies` and `peerDependencies` UNCHANGED. Phase 9 introduces no deps; Gate 1 enforces.
- **Public-API additive-only.** New types may be added to `src/index.ts` re-exports; existing exports must not change. Gate 2 enforces with strict additive diff.

### From Phase 7 (Semantic Index Build Pipeline)
- **Sibling-module pattern.** New file at `src/<feature>.ts` (here: `src/analytics-store.ts`) for pure storage/computation; `core.ts` orchestrates. Mirrors `src/semantic-index-builder.ts`.
- **Locked warn format (RBAC invariant).** All console.warn calls follow `MCPack: <subject>: <err.message>` format with NO tool names, NO role information leaked. Phase 9 emits zero new warns; Gate 7 enforces.
- **In-memory storage convention.** No fs/net imports. Resets on process restart. Phase 9 inherits this.
- **Negative controls.** Each pitfall has a test that proves the bug DOESN'T manifest. Phase 9 encodes Pr1-Pr6 + Pitfall 1-10 controls.
- **Empirical Wave 0 check.** Plan 09-02 first task: empirically verify all 187 baseline tests pass with the new event-emission wiring (search/miss + call/denial sites populated). Catches the kind of bug Phase 8's CR-01 represented BEFORE plan-checker grep would catch it.

### From Phase 8 (Hybrid Ranking Query Path)
- **Rename-safe RBAC tests.** `tools.map((t) => t.name)` iteration rather than hardcoded fixture names. Acceptance: >= 4 occurrences in `test/analytics-integration.test.ts`. Mirrors Phase 8's 14-occurrence pattern.
- **Per-tool try/catch graceful degradation (WR-01).** Where Phase 9 introduces a thrown surface (e.g., `record()` validation), the engine layer should catch and log without propagating to MCP caller. Phase 9's surface is mostly read-only computation; this applies primarily to `snapshot()` input validation (WR-02 carry-forward).
- **Runtime validation at boundaries (WR-02).** `AnalyticsOptions.role` validated as `typeof === 'string'` at the snapshot entry point; non-string coerces to undefined (operator-unscoped) rather than silent NaN-style failure.
- **Sync where possible.** Phase 8 introduced async by necessity (embedding I/O). Phase 9 has no I/O — keep all surfaces sync. `record()` is sync; `snapshot()` is sync; `getAnalytics()` is sync. Easier to test, no Promise plumbing.
- **Pitfall negative controls (P7/P8/P9/P10).** Phase 8 encoded four. Phase 9 inherits the discipline: every pitfall in §"Common Pitfalls" has a corresponding negative-control test. P-numbering for Phase 9 starts at P11 if they need globally unique IDs (or planner picks Pr-numbering for privacy-specific controls).
- **Plan slicing for coverage stability.** 2 plans, each ships its own tests. Mirrors DEC-v11-09-04 explicitly.
- **Baseline reference advances.** Phase 9 anchors on post-Phase-8 main HEAD (current `5117f59` or planner-pinned SHA). Gate 4 baseline list is 11 files (the 9 v1.0+Phase-7 files PLUS Phase 8's two new test files).

## Pitfalls

> Numbered list with mitigations. See §"Common Pitfalls" above for full descriptions; this is the compact reference.

| # | Pitfall | Mitigation |
|---|---------|-----------|
| 1 | Privacy filter applied to wrong field (event.role for call/denial) | Two-predicate filter: event.role for search/miss, isToolAllowed for call/denial (Pattern 4) |
| 2 | Accidentally registering an analytics request handler | Gate 5 grep + plan-checker review of any setRequestHandler edit (Pattern 6) |
| 3 | Computing snapshot from mutated state (role config changes mid-process) | Documented behavior — JSDoc on getAnalytics; test for "role config mutation mid-process" (DEC-v11-09-02 edge case 5) |
| 4 | maxEvents boundary off-by-one | Pre-push check `if (events.length >= maxEvents) shift(); push()` — invariant test asserts `events.length <= maxEvents` always |
| 5 | Confusing search-emitted-tools with call events for dead-tool computation | Dead-tools reads ONLY call events; test that asserts search-emitted-but-not-called tools STAY in deadTools |
| 6 | Implicit role filtering at operator boundary (defaulting to defaultRole) | `options?.role` undefined === unscoped; test that asserts `getAnalytics()` no-args returns full data |
| 7 | `role: undefined` vs `role: ''` event authorship inconsistency | Always normalize to `string` with `''` for undefined; matches SessionRegistry's `role ?? ''` convention at `src/core.ts:178` |
| 8 | Snapshot computation leaks tool names via errors | Snapshot path doesn't throw on out-of-role encounters; only WR-02 input-validation throws (and those don't interpolate event data) |
| 9 | Coverage trough mid-phase | DEC-v11-09-04: 2 plans, each ships its own tests |
| 10 | Baseline test files touched (Gate 4 violation) | Phase 9 emits no new console.warn/log — analytics is private state mutation only; Gate 7 grep enforces |

## Sources

### Primary (HIGH confidence)
- `src/core.ts` (read in full, 561 lines, includes Phases 7+8 modifications) — engine integration point; `buildSearchResponse` is the search/miss emission site
- `src/wrap.ts` (read in full, 142 lines) — call/denial emission sites at lines 109, 117, 127; handle return at lines 138-141
- `src/build.ts` (read in full, 169 lines) — call/denial emission sites at lines 121, 130, 146; handle return at lines 163-167
- `src/types.ts` (read in full, 163 lines) — additive type extensions land here
- `src/index.ts` (read in full, 18 lines) — re-export module
- `src/roles.ts` (read in full, 89 lines) — `isToolAllowed` (line 35-46) is the privacy filter predicate; `resolveRoleAccess` (line 15-29) is the dead-tools input
- `src/session.ts` (read in full, 99 lines) — sibling-module precedent for `AnalyticsStore` shape
- `src/search.ts` (read in full, 162 lines) — Phase 8 modifications; not modified by Phase 9
- `.planning/phases/09-tool-usage-analytics-v1-1/09-CONTEXT.md` (read in full) — locked decisions DEC-v11-09-01..04, Gate 5, Pr1-Pr6 privacy table
- `.planning/phases/08-hybrid-ranking-query-path-v1-1/08-CONTEXT.md` (read in full) — Phase 8 carry-forward patterns
- `.planning/phases/08-hybrid-ranking-query-path-v1-1/08-VERIFICATION.md` (read in full) — 11/11 verification dimension reference
- `.planning/phases/08-hybrid-ranking-query-path-v1-1/08-REVIEW.md` (read in full) — 3 deferred INFOs (IN-01/02/03) Phase 9 must NOT introduce regressions on
- `.planning/phases/08-hybrid-ranking-query-path-v1-1/08-RESEARCH.md` (lines 1-400 + 800-1100 read) — Validation Architecture template
- `.planning/phases/07-semantic-index-build-pipeline-v1-1/07-CONTEXT.md` (read in full) — locked warn format pattern, in-memory storage convention
- `.planning/REQUIREMENTS.md` (read in full) — REQ-v11-analytics-* IDs and PRD source
- `.planning/STATE.md` (read in full) — current milestone position
- `.planning/PROJECT.md` (read in full) — board decisions DEC-BOARD-01..05
- `.planning/ROADMAP.md` (read in full) — Phase 9 success criteria (6 enumerated)
- `CLAUDE.md` (project root, read in full) — stack lock, architecture key patterns, security/RBAC invariant
- `PLAYBOOK.md` (project root, read in full) — Quality Gates, current sprint, post-Phase-8 baseline 187 tests at 99.73%

### Secondary (MEDIUM confidence)
- npm registry version verifications (2026-04-26):
  - `npm view vitest version` → 4.1.5 (within ^4.1.0)
  - `npm view typescript version` → 6.0.3 (project pins ~5.8.3 intentionally)
  - `npm view @modelcontextprotocol/sdk version` → 1.29.0 (within ^1.0.0 + ^1.27.1)
  - `node --version` → v24.2.0 (>= 18.0.0)

### Tertiary (LOW confidence)
- None. All findings cross-verified against codebase + CONTEXT.md + REQUIREMENTS.md.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dep versions verified against `package.json` and npm registry; zero new deps required.
- Architecture: HIGH — patterns derived from actual reads of `src/core.ts` (Phase 7+8), `src/session.ts` (sibling-module precedent), `src/roles.ts` (RBAC primitives); CONTEXT.md decisions locked.
- Pitfalls: HIGH — 10 pitfalls each grounded in observable failure mode + test mitigation; carries forward Phase 7's Pitfall 7 RBAC negative control discipline + Phase 8's CR-01 lesson.
- Test mapping: HIGH — every REQ-ID has at least one automated command + file; Wave 0 gaps explicitly flagged.
- Validation Architecture: HIGH — 5 BLOCKING gates documented (4 carry-forward + Gate 5 NEW); coverage targets per file traced to Phase 8 baseline.

**Research date:** 2026-04-26
**Valid until:** 2026-05-26 (30 days — stack stable, no major framework releases pending)
