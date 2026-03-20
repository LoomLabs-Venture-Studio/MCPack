# Phase 1: Foundation and Leaf Modules - Context

**Gathered:** 2026-03-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Project scaffolding (package.json, tsconfig.json, types) and four independent leaf modules: index-builder, search engine, session registry, and role filter. All modules must compile and be testable in isolation. No MCP SDK wiring — that's Phase 2.

</domain>

<decisions>
## Implementation Decisions

### Search Scoring
- Keep PRD algorithm as-is: camelCase splitting, underscore splitting, stop word removal. No stemming in v1.
- Add schema `inputSchema.properties` names as a third keyword source, tokenized the same way as tool names (camelCase/underscore split). Weighted lowest at 1.
- Internal named constants for score weights — not user-configurable in v1:
  - `EXACT_NAME = 10`
  - `PARTIAL_NAME = 5`
  - `DESCRIPTION = 3`
  - `KEYWORD = 2`
  - `SCHEMA_PROPERTY = 1`
- Case-insensitive matching everywhere (lowercase all inputs).
- Zero matches returns empty `tools` array. No fallback to "top N" or suggestions.
- `includes()` for substring matching (PRD behavior).

### Session Management
- Session ID strategy: use `'__stdio__'` constant for stdio transport (single session per process). HTTP/SSE transports use `ctx.sessionId` from the MCP SDK.
- Sliding TTL: `lastActiveAt` resets on every `search_tools` call. Default 2 hours.
- Dual cleanup strategy: lazy expiry check on every `getOrCreate()` call (if expired, delete and create fresh) PLUS `setInterval` every 15 minutes with `.unref()` as backstop for abandoned sessions.
- `destroy()` clears everything: stops timer AND clears all session data. Clean slate. Intended for shutdown and testing.
- Query log on Session: `queryLog: Array<{ query: string, results: string[], timestamp: number }>`. Appended on every `search_tools` call. Server-side only — never included in `SearchToolResponse`. Gives developers a debug trail of agent search behavior per session.

### Role Defaults
- No roles config provided → all tools visible (no filtering). Simplest default for users who don't need RBAC.
- Roles configured but session's role doesn't match any defined role → no tools visible. Secure by default.
- Drop `tier` field from `ToolIndexEntry`. Role filtering happens at query time, not at index time.
- Role filtering applies to BOTH `search_tools` results AND `tools/call` execution (defense in depth). If an agent bypasses search and calls a tool directly, the role check blocks it. This is implemented in the role filter module but enforced in Phase 2/3 when the entry points wire it up.
- `defaultRole` field on `MCPackConfig` — all sessions get this role unless overridden by a future `resolveRole` function (v2).

### Types
- Own types that extend MCP SDK types where needed (e.g., `MCPackToolDefinition extends Tool` with `handler` added for build mode).
- Public API exports only: `MCPackConfig`, `MCPackServerConfig`, `MCPackToolDefinition`, `RoleConfig`, `IndexConfig`, `SessionConfig`, `SearchToolResponse`, `SearchResult`, `ToolCallResult`.
- Keep private (not exported from package entry point): `ToolIndexEntry`, `Session` (including queryLog), score weight constants.
- `SearchToolResponse` stays minimal: `{ tools, total_available, showing, session_id }`. No query echo.

### Claude's Discretion
- Exact stop words list for keyword extraction
- package.json metadata (author, repository fields)
- tsconfig.json strictness settings (recommend strict: true)
- File organization within src/ (one file per module as PRD suggests, or split if a module grows)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Technical Specification
- `mcpack-prd-v1.md` — Full PRD with pseudocode for all modules, type definitions, search algorithm, session registry, role resolution. Updated with dual-mode support (wrap + build).
- `mcpack-spec-v1.md` — Protocol specification defining MCPack's behavior at the protocol level.

### Research
- `.planning/research/STACK.md` — MCP SDK v1.27.1 target, Server vs McpServer decision, ESM-only build
- `.planning/research/ARCHITECTURE.md` — Component boundaries, data flow, handler capture approaches, build order
- `.planning/research/PITFALLS.md` — Session timer .unref(), handler capture risks, McpServer vs Server confusion

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield project. Only LICENSE, PRD, and spec exist.

### Established Patterns
- None yet. Phase 1 establishes the patterns all subsequent phases follow.

### Integration Points
- Leaf modules must expose clean interfaces that `core.ts` (Phase 2) can wire together.
- Search engine takes `ToolIndexEntry[]` and returns ranked results.
- Session registry takes session ID + role, returns/creates Session.
- Role filter takes role + config + index, returns filtered `ToolIndexEntry[]`.
- Index builder takes `ToolDefinition[]` and returns `ToolIndexEntry[]`.

</code_context>

<specifics>
## Specific Ideas

- Score weights as named constants in a dedicated file or section — easily tunable before v1.1 if the Stripe harness reveals poor relevance on real tool surfaces.
- `'__stdio__'` as session ID — immediately obvious in logs that it's a stdio session, not a missing HTTP session ID.
- Query log is a developer debugging tool, not an agent-facing feature. Keep it simple: append-only array, no size limits in v1.

</specifics>

<deferred>
## Deferred Ideas

- Role enforcement at `tools/call` level — designed here but enforced in Phase 2/3 when entry points are built.
- Query log size limits or rotation — not needed for v1 session lifetimes.

</deferred>

---

*Phase: 01-foundation-and-leaf-modules*
*Context gathered: 2026-03-20*
