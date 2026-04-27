# Phase 9: Tool Usage Analytics (v1.1) — Discussion Log

**Date:** 2026-04-27
**Mode:** Standard discuss-phase (single-pass batch question form via AskUserQuestion)
**Participants:** Board (zmarji@gmail.com), Claude

This log is for human reference only — audits, retrospectives. It is NOT consumed by downstream agents (researcher, planner, executor). The canonical record is `09-CONTEXT.md`.

---

## Phase 9 framing presented to user

**Domain:** Server-handle analytics — capture 4 event types (search/call/denial/miss) into in-memory `AnalyticsStore`, expose `getAnalytics()` on the handle (NEVER over MCP wire), role-scoped queries with privacy guarantees, dead-tool detection per role.

**Carrying forward (no re-discussion):**
- 4 BLOCKING gates (zero-deps, public-API additive, adapter-isolation, baseline tests byte-identical)
- In-memory only; `maxEvents: 10000` default; oldest-dropped on overflow
- AnalyticsSnapshot shape locked by PRD
- `getAnalytics()` NEVER exposed as MCP tool (REQ-v11-analytics-rbac-integrity)
- Phase 8 patterns: rename-safe RBAC tests, warn-once-per-instance, `// LOCKED` comments

---

## Question 1: OQ1 — getAnalytics() handle shape

**Question:** Where does `getAnalytics()` live on the handle?

**Options presented:**
- Flat on handle (Recommended)
- Nested under `analytics` property
- Single method that takes options

**User answer:** Flat on handle (Recommended)

**Captured as:** DEC-v11-09-01 — flat on `MCPackHandle`, mirrors `destroy()`/`stats()`

---

## Vocabulary clarification — what is an "operator"?

User asked to clarify the term "operator" used throughout the OQ5 framing. Claude provided a structured explanation:

- **Operator** = the human/process that runs the MCP server (host process owner). Has direct code access to the handle returned by `mcpack()` / `createMCPackServer()`.
- **Agent** = MCP client connecting over the wire protocol. Constrained by role config; only sees tools their role allows.

User followed up: "how do we determine that an operator is running not any other type?"

Claude explained the boundary is **architectural, not authenticated**:
- No runtime check for "operator-ness."
- The handle methods are TypeScript surface — only callable from Node.js host code.
- The MCP wire only exposes handlers registered via `setRequestHandler()`. MCPack registers exactly two: `tools/list` and `tools/call`. `getAnalytics` is NEVER registered as a handler or tool.
- An agent literally cannot reach `getAnalytics()` over the protocol. Calling `tools/call` with name `getAnalytics` would return the v1.0 `"Unknown tool"` error path.
- Same architectural pattern as `handle.destroy()` today — no auth needed because it's not on the wire.

This boundary is now documented in CONTEXT.md under "Operator vs Agent Boundary — Architectural, Not Authenticated."

---

## Question 2: OQ5 — Denial event storage model

User asked for clarification with concrete examples. Claude reframed with three options spelled out using specific tool/role fixtures:

- **Option A (two-tier):** store full event; operator unscoped sees full; role-scoped REDACTS tool name with placeholder.
- **Option B (strict):** never store tool name in denial events; operator can't see it either; dead-tool detection breaks.
- **Option C (filter-by-role):** store full event; operator unscoped sees full; role-scoped EXCLUDES events involving tools not in that role's allowed set.

**User answer:** Option C — Store full, filter by role at query (Recommended)

**Captured as:** DEC-v11-09-02 — store full event data; role-scoped queries filter out entire events whose tool isn't in that role's allowed set; reuses Phase 8's `isToolAllowed` helper

**Rationale highlights captured in CONTEXT:**
- Cleanest data model (one storage shape, one filter predicate, no string redaction).
- Reuses Phase 8's `isToolAllowed(role, tool, rolesConfig)` — proven correct.
- Operator unscoped view preserves diagnostic value ("role X was denied for tool Y 47 times → I forgot to grant").
- Role-scoped view satisfies REQ-v11-analytics-privacy by EXCLUSION (strictly stronger than redaction).

**Edge cases captured for the planner:**
- Empty engine → operator query returns empty arrays (no nulls)
- Non-existent role → returns empty arrays + zeroed summary (no throw)
- Role granted post-denial → historical denial filtered out (filter uses CURRENT role config)
- Wildcard role (`*`) → sees full universe

---

## Question 3: Dead-tool detection scope

**Question:** Process-lifetime aggregate or per-session?

**Options presented:**
- Process-lifetime aggregate per role (Recommended)
- Per-session per role
- Configurable via `getAnalytics({ scope: 'session' | 'lifetime' })`

**User answer:** Process-lifetime aggregate per role (Recommended)

**Captured as:** DEC-v11-09-03 — `summary.byRole[role].deadTools` = tools role can see ∖ tools-with-≥1-call-event-by-role since process start

**Rationale captured in CONTEXT:**
- Matches REQ-v11-analytics-storage ("resets on process restart") — process lifetime is the natural boundary.
- PRD wording "current session" was loose; tightened to process-lifetime which is consistent with the rest of REQ-v11-analytics-*.
- Per-session view would be ambiguous (which session?) and noisy.

---

## Question 4: Plan slicing

**Question:** How to slice Phase 9's surface?

**Options presented:**
- 2 plans: AnalyticsStore + Engine integration (Recommended)
- 3 plans: Store + Engine + API/handle
- 1 plan, single wave

**User answer:** 2 plans (Recommended)

**Captured as:** DEC-v11-09-04 — Plan 09-01 = AnalyticsStore module + unit tests; Plan 09-02 = engine event emission + handle API + integration/privacy/RBAC architectural tests

---

## Scope creep redirected

None during this session — discussion stayed within Phase 9's boundary.

---

## Deferred ideas captured

- Persistent storage (disk, network, OTEL, export, webhooks) — already deferred to v1.2 per PRD non-goals
- Per-query analytics caching — Phase 10 benchmark candidate; design deferred
- Analytics subscription / streaming — v1.2 candidate
- Multi-tenant operator isolation — host-level concern, out of library scope
- Configurable session/lifetime scope — DEC-v11-09-03 locks lifetime; revisit in v1.2 OQ if requested
- Phase 8 INFO finding fixes (IN-01/02/03) — Phase 9 should NOT introduce new instances; existing instances stay for v1.1 polish or v1.2

---

## Claude's discretion items (planner picks)

- Exact `AnalyticsStore` method names (`record` vs `capture` vs `emit`; `snapshot` vs `getSnapshot`)
- Internal storage shape: shared bounded array with discriminated union vs four typed bounded arrays
- Bounded array implementation: Array.shift vs ring buffer (negligible at 10k cap)
- `topTools[5]` computation: snapshot-time vs maintained incrementally
- `clear()` method visibility (public test-only with note vs private)

---

## NEW Gate 5 introduced

To enforce REQ-v11-analytics-rbac-integrity at the structural level, CONTEXT introduces a new BLOCKING gate beyond the 4 carry-forward Phase 8 gates:

**Gate 5 (wire-protocol exposure ban):** `grep -E "setRequestHandler.*[Aa]nalytics|tools[/\\.]list.*[Aa]nalytics" src/` returns ZERO matches. Belt-and-suspenders enforcement of the architectural boundary.

This gate must be encoded in each Phase 9 plan's `<acceptance_criteria>`.

---

## Outcome

CONTEXT.md written. Ready for `/gsd-plan-phase 9` (which will trigger researcher → planner → plan-checker pipeline).
