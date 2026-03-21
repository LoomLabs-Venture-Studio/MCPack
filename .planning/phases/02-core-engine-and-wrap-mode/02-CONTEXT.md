# Phase 2: Core Engine and Wrap Mode - Context

**Gathered:** 2026-03-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire the four leaf modules (index-builder, search, session, roles) into a core engine class and deliver the `mcpack(server, config)` wrap mode entry point. A developer can wrap any existing MCP server and get lazy tool discovery working end-to-end. Build mode (`createMCPackServer`) is Phase 3.

</domain>

<decisions>
## Implementation Decisions

### Handler Capture Strategy
- Call-and-capture at setup: `mcpack()` simulates an internal `tools/list` request against the server to snapshot all tool definitions before replacing the handler.
- Use the MCP SDK's request handling mechanism to invoke the existing handler — not private API access.
- Capture the original `tools/call` handler reference before replacing it, so non-`search_tools` calls can be proxied through.
- If the internal `tools/list` call returns empty or throws, fall back to requiring an explicit `tools` array in config with a clear error message.
- If captured tools list is empty (zero tools): log a console warning ("MCPack: no tools found on server at setup time. search_tools will return empty results.") but proceed normally. Do not throw.
- `mcpack()` is async — returns `Promise<MCPackHandle>`. Developer awaits it.

### Handler Wiring
- Single interceptor pattern: one `setRequestHandler(CallToolRequestSchema, ...)` call replaces the original `tools/call` handler.
- Handler branches on tool name: if `name === 'search_tools'` → handle internally (search, session update, query log). Otherwise → role check via `resolveRoleAccess`, then forward to captured original handler.
- Original handler is wrapped with a role-check layer (defense-in-depth from Phase 1 decision). Role filtering applies to both search results AND `tools/call` execution.
- `tools/list` handler replaced: returns exactly one tool — `search_tools` with its input schema.

### MCPackHandle Return Value
- `mcpack()` returns `MCPackHandle` — the control surface for MCPack lifecycle.
- Public type `MCPackHandle` exported from package: `{ destroy(): void, stats(): { sessions: number, tools: number } }`.
- `destroy()` stops the session registry timer and clears all sessions.
- `stats()` returns current session count and total tools indexed.
- Server instance is modified in place as a side effect. Handle is separate.

### Session ID Resolution
- Derived from `RequestHandlerExtra.sessionId`. If present → use it. If absent/undefined → fall back to `STDIO_SESSION_ID` (`'__stdio__'`).
- Session ID is never exposed in the `search_tools` input schema. Agents don't know about sessions.
- Session ID IS included in the `search_tools` response (already in `SearchToolResponse` type from Phase 1).

### Role Resolution
- `defaultRole` only for v1. All sessions get `config.defaultRole` if set.
- No roles config → all tools visible. Roles configured but no `defaultRole` → nothing visible (secure default).
- No per-session role resolution. `resolveRole(session)` is deferred to v2 (ROLE-05).

### Core Engine Structure
- Class-based `MCPackEngine` — holds index, session registry, config.
- Methods: `handleToolsList()`, `handleToolsCall()`, `destroy()`, `stats()`.
- `MCPackEngine` is internal — not exported from the package. Users interact through `mcpack()` → `MCPackHandle`.
- File structure: `core.ts` (MCPackEngine class) + `wrap.ts` (mcpack() entry point). Phase 3 adds `build.ts`.
- `src/index.ts` exports `mcpack` from `wrap.ts`. Engine stays internal.

### Tool Index Initialization
- Eagerly built in constructor after call-and-capture completes. Index is fully ready before any request arrives.
- Errors in tool definitions surface at `mcpack()` call time.

### search_tools Input Schema
- Parameters: `{ query: string (required), limit?: number (optional) }`.
- `limit` overrides default max results, capped at `config.index.maxResults`.

### Error Handling
- All tool handler errors use MCP tool result shape: `{ content: [{ type: 'text', text: message }], isError: true }`.
- Never throw from a tool handler — errors belong in the result object per MCP spec.
- Invalid `search_tools` args: `isError: true` with message like `'search_tools requires a "query" string parameter'`.
- Role check blocks `tools/call`: `isError: true` with `'Unknown tool: {name}'`. Do not reveal the tool exists but is restricted.
- Proxied `tools/call` throws: catch and wrap in `isError: true` with `error.message`. MCPack is the boundary layer.
- One consistent error shape throughout all MCPack tool responses.

### search_tools Response Format
- JSON string in text content: `{ content: [{ type: 'text', text: JSON.stringify(searchToolResponse) }] }`.
- `schema` field in `SearchResult` contains the full MCP `Tool` object (name, description, inputSchema).
- For loaded tools (already seen in session): `{ name: 'tool_name', loaded: true }` only. No schema, no description. Maximum token savings.

### Claude's Discretion
- Exact search_tools tool description text
- Internal helper functions within core.ts
- Exact console.warn message format
- How to handle edge cases in RequestHandlerExtra (e.g., malformed sessionId)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Technical Specification
- `mcpack-prd-v1.md` — Full PRD with pseudocode for wrap mode, handler interception flow, search_tools schema, response shapes
- `mcpack-spec-v1.md` — Protocol specification defining MCPack's behavior at the protocol level, architecture diagram, design principles

### Phase 1 Implementation (source of truth for module interfaces)
- `src/types.ts` — All type definitions including MCPackConfig, SearchToolResponse, SearchResult, ToolCallResult, ToolIndexEntry, Session
- `src/index-builder.ts` — buildIndex() function, tokenize(), STOP_WORDS
- `src/search.ts` — scoreAndRank() function with 5-tier weighted scoring
- `src/session.ts` — SessionRegistry class, STDIO_SESSION_ID constant
- `src/roles.ts` — resolveRoleAccess() function
- `src/index.ts` — Current public API exports (types only — will add mcpack function)

### Research
- `.planning/research/ARCHITECTURE.md` — Component boundaries, data flow, handler capture approaches
- `.planning/research/PITFALLS.md` — Handler capture risks, McpServer vs Server confusion

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `SessionRegistry` class (src/session.ts): Ready to use — `getOrCreate(id, role)`, `destroy()`, sliding TTL, STDIO_SESSION_ID
- `scoreAndRank()` (src/search.ts): Takes query + index + limit, returns ranked ToolIndexEntry[]
- `buildIndex()` (src/index-builder.ts): Takes Tool[] → ToolIndexEntry[]
- `resolveRoleAccess()` (src/roles.ts): Takes role + config + index → filtered ToolIndexEntry[]
- All types in `src/types.ts`: MCPackConfig, SearchToolResponse, SearchResult, ToolCallResult ready

### Established Patterns
- ESM modules with `.js` extension imports (`from './types.js'`)
- Named constant exports (STOP_WORDS, STDIO_SESSION_ID)
- Internal types not exported from package entry point
- Vitest for testing with 45 existing tests

### Integration Points
- `src/index.ts` needs to export `mcpack` function from `wrap.ts`
- `MCPackHandle` type needs to be added to `src/types.ts` and exported
- `core.ts` composes all four leaf modules — imports from index-builder, search, session, roles
- `wrap.ts` imports from MCP SDK for `Server`, `ListToolsRequestSchema`, `CallToolRequestSchema`

</code_context>

<specifics>
## Specific Ideas

- MCPackHandle.destroy() enables clean test isolation — `handle.destroy()` in afterEach without reaching into session registry directly
- MCPackHandle.stats() returns `{ sessions: number, tools: number }` — useful for debugging and monitoring
- The single interceptor in tools/call is also the correct insertion point for query logging to session registry
- Error shape `{ content: [{ type: 'text', text: msg }], isError: true }` established as THE error pattern for all MCPack tool responses

</specifics>

<deferred>
## Deferred Ideas

- Role enforcement at `tools/call` level designed here, enforced here — was deferred from Phase 1 context but implemented in Phase 2
- `resolveRole(session)` custom function for per-session role resolution — v2 (ROLE-05)
- Build mode entry point `createMCPackServer()` — Phase 3

</deferred>

---

*Phase: 02-core-engine-and-wrap-mode*
*Context gathered: 2026-03-21*
