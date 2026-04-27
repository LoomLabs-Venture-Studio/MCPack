# Phase 9: Tool Usage Analytics (v1.1) — Context

**Gathered:** 2026-04-27
**Status:** Ready for planning
**Source:** /gsd-discuss-phase 9

<domain>
## Phase Boundary

Give operators in-process visibility into search/call/denial/miss patterns and dead tools without exposing analytics over the MCP wire.

Add `AnalyticsStore` (in-memory, bounded) that captures four event types at the correct decision points inside `MCPackEngine`. Add `getAnalytics(options?): AnalyticsSnapshot` to the handle returned by `mcpack()` and `createMCPackServer()`. Role-scoped queries filter events down to that role's allowed surface — restricted tools never appear in role-scoped output. `getAnalytics()` is NEVER exposed as an MCP tool — it's a host-process surface only.

**Phase 9 does NOT:**
- Persist analytics to disk or send over the network (REQ-v11-analytics-storage — in-memory only, resets on process restart)
- Add a new MCP tool, request handler, or wire-protocol surface (REQ-v11-analytics-rbac-integrity — agent attempts return `"Unknown tool"`)
- Add per-query analytics caching, OTEL/file/webhook export (deferred to v1.2 per PRD non-goals)
- Add multi-tenant operator isolation (host-level concern, out of library scope)
- Touch the hybrid query path (Phase 8 work — Phase 9 only ADDS event emission inside `handleSearchTools` after the existing logic completes)

</domain>

<decisions>
## Implementation Decisions (LOCKED — from board PRD ingest + Phase 6/7/8 carry-forward + this discussion)

### `getAnalytics()` Handle Shape (DEC-v11-09-01 — resolves OQ1)
**Flat on `MCPackHandle`.** New method `getAnalytics(options?: { role?: string }): AnalyticsSnapshot`.

Mirrors the existing handle methods:
```typescript
interface MCPackHandle {
  destroy(): void;                                              // existing
  stats(): { sessions: number; tools: number };                 // existing
  getAnalytics(options?: { role?: string }): AnalyticsSnapshot; // NEW Phase 9
}
```

**Rationale:**
- Smallest API surface — additive only.
- Matches PRD literally (REQ-v11-analytics-api: "Add `getAnalytics(options?)` to handle returned by `mcpack()` and `createMCPackServer()`").
- If v1.2 introduces analytics-related methods (clear, export, subscribe), revisit nesting then. For v1.1 there is exactly one analytics method.
- Same access pattern as `destroy()` / `stats()` — operator-only by virtue of living on the handle.

### Operator vs Agent Boundary — Architectural, Not Authenticated (informational, no decision required)
There is no runtime "is this caller the operator?" check anywhere in MCPack. The boundary is structural:
- **Handle methods** (Node.js TypeScript surface): callable from any code that has a reference to the handle. By definition that's host-process code — there is no protocol wrapping these calls.
- **MCP wire** (JSON-RPC over stdio/SSE): only exposes handlers registered via `setRequestHandler()`. MCPack registers exactly two: `tools/list` and `tools/call`. `getAnalytics` is NOT a registered handler and NOT a tool — it doesn't exist on the wire.

The agent literally cannot reach `getAnalytics()` via the MCP protocol. Calling it would fail at JSON-RPC parsing, not at auth. This is the same architectural pattern as `handle.destroy()` today.

REQ-v11-analytics-rbac-integrity is satisfied by architecture: never call `setRequestHandler()` for any analytics method, never include analytics in the `tools/list` response. The planner MUST encode a test that proves an agent attempting `tools/call analytics/get` (or similar) returns `"Unknown tool"`.

### Denial Event Storage Model + Role-Scoped Filtering (DEC-v11-09-02 — resolves OQ5)
**Store full event data (`tool` + `role` + `ts`); role-scoped queries filter out entire events whose tool isn't in that role's allowed set.** No string redaction.

Internal storage shape (per event):
```typescript
type DenialEvent = { type: 'denial'; tool: string; role: string; ts: number };
type SearchEvent = { type: 'search'; query: string; role: string; tools: string[]; ts: number };
type CallEvent   = { type: 'call';   tool: string; role: string; ts: number };
type MissEvent   = { type: 'miss';   query: string; role: string; ts: number };
```

Query semantics:
- `handle.getAnalytics()` (no role) — operator-unscoped — returns full event arrays. Operator sees every tool name in every event.
- `handle.getAnalytics({ role: 'X' })` — role-scoped — returns ONLY events where the event's tool name is allowed for role X. For `search`/`miss` events (no tool field), filter on the event's `role` field equaling `X`. For `denial` events involving a tool not in X's allowed set: the entire event is EXCLUDED, not redacted.

**Rationale:**
- Cleanest data model: one storage shape, one filter predicate, no string redaction logic to maintain.
- Reuses Phase 8's `isToolAllowed(role, toolName, rolesConfig)` helper from `src/roles.ts` for the filter — proven correct, no new RBAC logic.
- Operator unscoped view preserves diagnostic value (e.g., "role `analyst` was denied for tool `export_csv` 47 times → I forgot to grant that").
- Role-scoped view satisfies REQ-v11-analytics-privacy by EXCLUSION (events involving out-of-role tools never appear in scoped output) — strictly stronger than redaction (which leaks "denial happened").

**Edge cases the planner must encode in tests:**
- Operator unscoped query on a fresh engine returns empty arrays (`searches: []`, etc.) — no errors, no nulls.
- Role-scoped query for a role with no events returns empty arrays AND `summary.byRole[role]` populated with zeros (deadTools = all tools that role can see).
- Role-scoped query for a non-existent role: returns empty arrays AND `summary.byRole[role] = {searchCount: 0, callCount: 0, denialCount: 0, missCount: 0, topTools: [], deadTools: []}`. Do NOT throw — undefined role is treated as "role with no permissions", per Phase 1+ convention.
- Wildcard role (`'*'`): role-scoped query for a wildcard role sees all events whose tool is in the universe.
- A `denial` event for a tool that is later granted to the role mid-process: the historical denial still exists in storage but is filtered out of role-scoped queries because the filter uses CURRENT role-config state, not historical. Document this in the API JSDoc.

### Dead-Tool Detection Scope (DEC-v11-09-03)
**Process-lifetime aggregate per role.** `summary.byRole[role].deadTools` lists tools that role can see AND have zero `call` events from any session of that role since process start.

Computation (pseudocode):
```
deadTools(role) = tools-visible-to-role  ∖  tools-with-≥1-call-event-by-role
```

**Rationale:**
- Matches REQ-v11-analytics-storage ("resets on process restart") — process lifetime is the natural boundary.
- Matches operator use case: "What tools did NOBODY playing role X ever call this entire run? Candidates for removal."
- Per-session view would be ambiguous (which session does `summary.byRole[role]` reflect?) and noisy (5-second-old sessions show everything as dead).
- The PRD wording "current session" was loose; this decision tightens to process-lifetime which is consistent with the rest of REQ-v11-analytics-* (storage scope = process).

**Edge cases the planner must encode in tests:**
- Tool granted to role but never called → in `deadTools`.
- Tool granted to role and called via `tools/call` (direct invocation) → NOT in `deadTools` (the `call` event lands in the store).
- Tool returned in a `search_tools` result but never actually invoked via `tools/call` → STILL in `deadTools` (`search` events do not count as `call` events).
- Wildcard role (`'*'`) with no `call` events → `deadTools` includes ALL tools.
- Role with `*` access: `deadTools` is computed against the full tool universe, not the wildcard token itself.

### Plan Slicing (DEC-v11-09-04)
**2 plans, each ships its own tests** (mirrors Phase 8's discipline — no coverage trough mid-phase).

- **Plan 09-01: AnalyticsStore Module + Unit Tests** (Wave 1)
  - New `src/analytics-store.ts` (sibling module — matches `session.ts`/`semantic-index-builder.ts`/`hybrid-scoring.ts` pattern).
  - Public surface: `AnalyticsStore` class with methods `record(event)`, `snapshot(rolesConfig, opts?): AnalyticsSnapshot`, `clear()` for tests.
  - Bounded ring-buffer-style retention: `maxEvents: 10000` default (PRD-locked), oldest dropped when capacity reached. Each event type gets its own bounded array OR shared bounded array — planner picks (recommendation: shared array, easier overflow accounting).
  - New types in `src/types.ts` (additive only): `AnalyticsSnapshot`, `AnalyticsEvent` union, `AnalyticsByRoleSummary`, `AnalyticsOptions`.
  - Unit tests for store mechanics: capture all 4 event types, overflow eviction, role-scoped filtering using `isToolAllowed`, dead-tool computation, snapshot shape integrity, undefined-role/wildcard-role edge cases.

- **Plan 09-02: Engine Integration + Handle API + Integration Tests** (Wave 2)
  - Wire event emission inside `MCPackEngine` at four decision points:
    1. `handleSearchTools` → emit `search` event after results computed
    2. `handleSearchTools` → emit `miss` event when search returns zero matches (ALSO emits `search` — they coexist, miss is a subset signal)
    3. `wrap.ts` non-search-tools dispatch path → emit `call` event after handler runs (success only — failures don't count as calls)
    4. `wrap.ts` role-blocked tool path AND `build.ts` role-blocked tool path → emit `denial` event before returning the opaque "Unknown tool" error
  - Add `MCPackEngine.getAnalytics(options?)` private surface used by the handle.
  - Extend `MCPackHandle` interface (additive) with `getAnalytics(options?)`.
  - Update `wrap.ts` and `build.ts` handle return to include `getAnalytics: () => engine.getAnalytics(...)`.
  - Integration tests covering all 5 PRD success criteria + RBAC integrity tests (agent CANNOT reach getAnalytics via MCP wire).

### `getAnalytics()` Cannot Be a Tool — Architectural Lock (informational, locked by PRD)
The planner MUST NOT register any new request handler via `setRequestHandler()` for analytics. The `tools/list` handler MUST continue to return EXACTLY one tool (`search_tools`). Verifying this:
- Test 1: `tools/list` response contains exactly one tool, name === `search_tools`.
- Test 2: `tools/call` with `{ name: 'getAnalytics' }` (or any analytics-flavored name) returns the v1.0 `"Unknown tool: {name}"` error path.
- Test 3 (acceptance gate): `grep -E "setRequestHandler.*[Aa]nalytics" src/wrap.ts src/build.ts` returns zero matches.

### Five [BLOCKING] Phase Gates (carry-forward + ONE addition)
Baseline reference advances to current `main` HEAD post-Phase-8 (`0a1759f` or current HEAD; planner pins exact SHA at plan-time). Gates remain:

- **Gate 1 (zero-new-core-deps):** root `package.json` `dependencies` and `peerDependencies` UNCHANGED from baseline (broadened jq selector matching `dependencies`, `peerDependencies`, `optionalDependencies`, `bundledDependencies`).
- **Gate 2 (public-API additive-only):** `src/index.ts` exports — Phase 9 MAY add new type exports (`AnalyticsSnapshot`, `AnalyticsEvent`, etc. for users who want to type the return value of `getAnalytics()`). The diff against baseline must be ADDITIVE only — no removals or signature changes to existing exports. The plan-checker should verify this with a strict additive diff (every line removed must have an equivalent line added; net new lines allowed).
- **Gate 3 (adapter-isolation):** `grep -rE "@llvs/mcpack-embeddings|@huggingface/transformers|@xenova/transformers" src/ test/` returns ZERO matches. Phase 9 has no embedding work; this gate is trivially preserved but enforced.
- **Gate 4 (baseline tests byte-identical):** all pre-Phase-9 test files unchanged. Phase 9 only adds new test files (`test/analytics-store.test.ts` and `test/analytics-integration.test.ts` — names are planner's discretion). Updated 9+1 = 10-file explicit list to include `test/hybrid-scoring.test.ts` and `test/hybrid-ranking.test.ts` from Phase 8.
- **Gate 5 (NEW — wire-protocol exposure ban):** `grep -E "setRequestHandler.*[Aa]nalytics|tools[/\\.]list.*[Aa]nalytics" src/` returns ZERO matches. Belt-and-suspenders enforcement of REQ-v11-analytics-rbac-integrity. The planner MUST encode this as a [BLOCKING] gate in each plan.

### Carry-Forward Code Review Items From Phase 8
- **WR-01 fix pattern (per-tool try/catch):** any external surface Phase 9 introduces that could throw should follow the Phase 8 pattern — catch and degrade gracefully rather than propagate to MCP caller. This is unlikely to apply since Phase 9 is read-only computation, but worth flagging if e.g. `isToolAllowed` ever throws.
- **WR-02 fix pattern (runtime validation at boundaries):** the new `AnalyticsOptions` type should validate at runtime if `options.role` is provided — coerce non-string to undefined or throw cleanly. No silent NaN-style failures.
- **WR-03 rename-safe RBAC pattern:** all NEW Phase 9 RBAC tests MUST iterate `tools.map((t) => t.name)` rather than hardcoding fixture names. ≥4 occurrences in the new test file (mirroring Phase 8's enforcement).
- **Phase 8 lesson logged:** "Plan-checker can verify async signatures are 'callable' (callers await) but can't catch BREAK on sync test assertions." Phase 9 is fully sync (no new async surfaces), so this lesson doesn't apply directly — but the planner should still encode an empirical "all baseline tests pass with the new event-emission wiring" check, ideally as the first task of Plan 09-02 (Wave 0 pattern from Phase 8).

### Privacy Test Coverage (REQUIRED — Phase 9 plans must encode each)
| # | Privacy invariant | Test |
|---|---|---|
| Pr1 | Role-scoped query for role X excludes denial events involving tools not in X's allowed set | Configure 4-tool engine, role X with 2 tools allowed; emit denials for 4 tools across 2 roles; assert `getAnalytics({role:'X'}).denials` contains zero events whose `tool` isn't in X's allowed set |
| Pr2 | Role-scoped query for role X excludes search/call/miss events not authored by role X | Emit events from multiple roles; `getAnalytics({role:'X'})` returns ONLY events with `event.role === 'X'` |
| Pr3 | Operator unscoped query returns full data | `getAnalytics()` (no arg) returns ALL events; tool names visible in denials |
| Pr4 | Wildcard role (`'*'`) sees full universe | Configure role with `*`; role-scoped query returns full event set |
| Pr5 | `getAnalytics` is unreachable via MCP wire | Construct engine, register on Server, call `tools/call` with name `'getAnalytics'` → returns `"Unknown tool: getAnalytics"` |
| Pr6 | `tools/list` returns exactly one tool, name `search_tools` | Pre-existing v1.0 invariant; Phase 9 adds an explicit guard |

### RBAC Architectural Test (REQUIRED)
The planner MUST encode a test asserting that no `setRequestHandler` call references analytics anywhere in src/. This is structural, not behavioral:
```bash
grep -E "setRequestHandler.*[Aa]nalytics" src/wrap.ts src/build.ts
# Expected: zero output, exit 1 (no match)
```

### Claude's Discretion
- Exact name of the `AnalyticsStore` class methods (`record` vs `capture` vs `emit`; `snapshot` vs `getSnapshot`) — planner picks. Convention: match the existing `SessionRegistry`'s verbosity.
- Internal event storage shape: shared bounded array vs four typed bounded arrays. Recommendation: shared array with discriminated union, easier overflow accounting; planner can argue either way.
- Whether `clear()` is a public test-only method or a private state mutation. Recommendation: public, prefixed with documentation note "for test fixtures only."
- Whether `summary.byRole[role].topTools` is computed at snapshot time (cheap) or maintained incrementally (more state). Recommendation: snapshot-time computation — keeps `record()` O(1).
- Whether the bounded array uses Array.shift (O(n) eviction) or a proper ring buffer (O(1)). For maxEvents=10000 the practical difference is negligible; planner picks the simpler reading.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project foundation
- `.planning/PROJECT.md`
- `.planning/REQUIREMENTS.md` (R2 block — REQ-v11-analytics-events through REQ-v11-dead-tool-detection)
- `.planning/ROADMAP.md` (Phase 9 goal + Success Criteria — 6 enumerated)
- `./CLAUDE.md` (quality gates: typecheck/build/test all green; ≥99% coverage; ESM-only; commit format `type(scope): description`)
- `./PLAYBOOK.md` (current sprint, acceptance criteria)

### Phase 6 + 7 + 8 carry-forward (lock points + patterns)
- `.planning/phases/06-embedding-provider-interface-v1-1/06-CONTEXT.md` (zero-dep gate, adapter-isolation, ESM-only, public-API additive lock)
- `.planning/phases/07-semantic-index-build-pipeline-v1-1/07-CONTEXT.md` (locked warn format pattern, in-memory storage convention, RBAC invariants)
- `.planning/phases/08-hybrid-ranking-query-path-v1-1/08-CONTEXT.md` (rename-safe RBAC test pattern, 4 BLOCKING gates with corrected forms, Wave 0 empirical check pattern)
- `.planning/phases/08-hybrid-ranking-query-path-v1-1/08-VERIFICATION.md` (11/11 dimensions reference Phase 9 must match)
- `.planning/phases/08-hybrid-ranking-query-path-v1-1/08-REVIEW.md` + `08-REVIEW-FIX.md` (3 deferred INFOs — Phase 9 should not introduce regressions on the 5-tier loop duplication observed there)

### Source code Phase 9 modifies / extends
- `src/core.ts` (`MCPackEngine` — Phase 9 adds private `analyticsStore` field, event emission inside `handleSearchTools` + `markToolLoaded` + denial paths, new `getAnalytics()` method)
- `src/wrap.ts` (handle return shape — additive; non-search-tool `tools/call` dispatch — emit `call` event on success, `denial` event on role-block)
- `src/build.ts` (handle return shape — additive; tool dispatch — emit `call`/`denial` events)
- `src/types.ts` (additive — `AnalyticsSnapshot`, `AnalyticsEvent` union, `AnalyticsByRoleSummary`, `AnalyticsOptions`, extended `MCPackHandle` interface)
- `src/index.ts` (additive — re-export new analytics types so consumers can type the snapshot)
- `src/roles.ts` (read-only — Phase 9 reuses `isToolAllowed` for role-scoped filtering)
- `src/session.ts` (read-only — Phase 9 reads sessions to determine tool visibility per role)

### NEW files Phase 9 creates
- `src/analytics-store.ts` (new — `AnalyticsStore` class, sibling module pattern matching `session.ts`)
- `test/analytics-store.test.ts` (new — Plan 09-01 unit tests)
- `test/analytics-integration.test.ts` (new — Plan 09-02 integration + privacy + RBAC architectural tests)

### Test surface
- All 9+ Phase 8 baseline test files PLUS Phase 8's new `test/hybrid-scoring.test.ts` and `test/hybrid-ranking.test.ts` — Phase 9 must NOT edit any of these (Gate 4)

### Inbound PRD (board-locked)
- `.planning/inbox/processed/mcpack-prd-v1.1-gsd.md` (R2 block — 7 analytics requirements; PROT-02 retained as v2 candidate per PRD non-goals)

</canonical_refs>

<specifics>
## Specific Ideas

### Event emission decision points (planner should encode as concrete tasks)

| Event | Site | Trigger | Already-existing code |
|-------|------|---------|----------------------|
| `search` | `MCPackEngine.handleSearchTools` end-of-method | After `buildSearchResponse` completes successfully | `src/core.ts ~line 168-200` |
| `miss` | `MCPackEngine.handleSearchTools` | When ranked+filtered results are empty | Same site as `search`; MISS is a SUBSET signal — both events emit when results are empty |
| `call` | `wrap.ts` non-search dispatch path AND `build.ts` dispatch path | After handler returns successfully (failures don't count) | `src/wrap.ts ~line 100-130`, `src/build.ts ~line 100-130` |
| `denial` | `wrap.ts` role-blocked tool path AND `build.ts` role-blocked tool path | Before returning opaque `"Unknown tool: {name}"` error | Same files; existing role check via `isToolAllowed` |

The planner must NOT create new abstraction layers around event emission — direct method calls (e.g., `engine.recordAnalyticsEvent({...})`) at the four sites is sufficient. Each site adds 1-3 lines.

### Test fixture conventions (carry from Phases 1 + 7 + 8)
- 3-tool minimum for ranking ordering tests; 4-tool for RBAC tests (allows a tool to be in some-but-not-all roles); 50-tool for stress (matches PRD perf budget reference); zero-tool for edge case.
- Mock roles: `admin` (sees all via `*`), `assistant` (subset), `reader` (smaller subset), `none`/`undefined` (no permissions).
- Time fixtures: `Date.now()` mock or pass timestamp explicitly. Phase 8 used real `Date.now()` — Phase 9 should follow the same convention (no fake timers).
- Session fixtures: explicit `sessionId` strings (`'session-1'`, etc.) rather than relying on `STDIO_SESSION_ID` for clarity.

### Performance assertions (algorithmic, not real-clock)
- Phase 9 unit tests assert algorithmic complexity (e.g., "snapshot computation completes in < 100ms with 10,000 events"), NOT real-provider budgets. Same pattern Phase 7/8 used.

</specifics>

<deferred>
## Deferred Ideas

- **Persistent analytics storage** (disk, network, OTEL, file export, webhooks) — already deferred to v1.2 per PRD non-goals. Phase 9 ships in-memory only.
- **Per-query analytics caching** — repeated `getAnalytics()` calls recompute summary every time. If this becomes a perf concern in real deployments, add a snapshot cache invalidated on `record()`. Worth a benchmark in Phase 10. Deferred from v1.1.
- **Analytics subscription / streaming** — `handle.onAnalyticsEvent(callback)` for real-time monitoring. v1.2 candidate if operators ask for it.
- **Multi-tenant operator isolation** — different host-process consumers seeing different subsets. Out of library scope; host-level concern.
- **Cross-session aggregation knobs** — `getAnalytics({ scope: 'session' | 'lifetime' })` was raised and rejected for v1.1 (DEC-v11-09-03 locks process-lifetime). Add to v1.2 OQ list if real users ask.
- **Tightening Phase 8's INFO findings (IN-01/02/03)** — keyword-fallback centralization, 5-tier loop extraction, P9 RBAC adversarial test. Phase 9 should NOT introduce new instances of the same patterns; existing instances stay for v1.1 polish or v1.2.

</deferred>

---

*Phase: 09-tool-usage-analytics-v1-1*
*Context gathered: 2026-04-27 via /gsd-discuss-phase*
