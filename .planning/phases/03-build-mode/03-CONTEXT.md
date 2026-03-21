# Phase 3: Build Mode - Context

**Gathered:** 2026-03-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Create the `createMCPackServer(config)` entry point that builds a new MCP Server from scratch with tools, handlers, and lazy discovery. Also apply correctness fixes to wrap.ts and update types for the v1 API. Build mode is a thin layer on the proven MCPackEngine core from Phase 2.

</domain>

<decisions>
## Implementation Decisions

### Handler Routing (Build Mode)
- Dispatch map: `Map<string, handler>` built from `config.tools` at setup. O(1) lookup by tool name.
- Dispatch map lives in `build.ts` only — MCPackEngine stays mode-agnostic.
- Duplicate tool names: log `console.warn('MCPack: duplicate tool name "${tool.name}" in config.tools. Last definition wins.')`.
- Handler returns `undefined`/`null`: return `{ content: [{ type: 'text', text: '' }] }` rather than serializing undefined.
- Unknown tool in `tools/call`: return `isError: true` with `'Unknown tool: {name}'` (same as wrap mode role-check pattern).

### MCPackHandlerContext (New Exported Type)
- `export interface MCPackHandlerContext { toolName: string; sessionId: string; role: string | undefined }`.
- Handler signature on MCPackToolDefinition: `handler: (args: Record<string, unknown>, ctx: MCPackHandlerContext) => Promise<unknown>`.
- Context is required (not optional) — handlers always receive it.
- Extensible for future versions (requestId, timestamp, retryCount as optional fields later).
- This is a v1 API decision — no existing consumers, no backward compatibility concern.

### Handler Return Normalization
- Handlers return `Promise<unknown>`. build.ts normalizes into ToolCallResult:
  - String → `{ content: [{ type: 'text', text: str }] }`
  - Has `content` array (ToolCallResult shape) → use as-is (passthrough)
  - Object → `{ content: [{ type: 'text', text: JSON.stringify(obj) }] }`
  - null/undefined → `{ content: [{ type: 'text', text: '' }] }`

### Error Handling (Both Modes)
- Tool name in error messages for BOTH wrap and build mode: `Tool "${name}" failed: ${error.message}`.
- Update wrap.ts existing catch block to include tool name.
- build.ts uses same pattern.

### Server Creation
- Uses low-level `Server` class (not McpServer) — same as wrap mode. MCPack needs `setRequestHandler` for handler interception.
- Add deprecation-awareness comment in both build.ts and wrap.ts.
- Constructor: `new Server({ name: config.name, version: config.version }, { capabilities: { tools: {} } })`.
- Capabilities hardcoded to `{ tools: {} }` — not configurable.
- Runtime validation: throw if `config.name` or `config.version` are empty/missing.
- Strip handler property from tool definitions before passing to MCPackEngine (engine expects `Tool[]`, not `MCPackToolDefinition[]`).
- Same MCPackConfig options apply: roles, defaultRole, index, session.

### Return Value
- `createMCPackServer(config)` is synchronous — returns `MCPackServer`.
- New exported type: `export interface MCPackServer { server: Server; handle: MCPackHandle }`.
- User gets `server` to connect transport, `handle` for lifecycle management.

### Empty Tools Validation (BOTH Modes — Revises Phase 2 Decision)
- Throw on empty tools in BOTH wrap and build mode. Replaces Phase 2's warn-and-proceed.
- Wrap mode: `throw new Error('MCPack: no tools found on server. Ensure tools are registered before calling mcpack()')`.
- Build mode: `throw new Error('MCPack: config.tools is empty. Provide at least one tool definition.')`.
- Rationale: MCPack builds a static index at setup time. Dynamic tool registration after setup never appears in search results. Empty = developer mistake.

### Correctness Fixes (BOTH Modes — Phase 3 Scope)
- **Null arguments guard**: Replace `request.params.arguments ?? {}` with `(request.params.arguments == null ? {} : request.params.arguments)` in both wrap.ts and build.ts.
- **Config snapshot at setup**: Snapshot `config.roles` and `config.defaultRole` at setup using spread. Use snapshots throughout, not live config reference.
- **defaultRole validation**: At setup, if `config.defaultRole` is set AND `config.roles` is set, check `config.roles[config.defaultRole]` exists. If not, `console.warn('MCPack: defaultRole "${config.defaultRole}" is not defined in roles config. Sessions will see no tools.')`.
- **Mark tools as loaded on direct tools/call**: After successful `tools/call` execution, resolve session via `extra.sessionId ?? STDIO_SESSION_ID` and call `session.loadedTools.add(name)`. Keeps session registry accurate when agents bypass search_tools.
- **Update wrap.test.ts**: Replace console.warn-on-empty test with throw-on-empty test.

### File Structure
- `src/build.ts` — createMCPackServer() entry point (NEW).
- `src/types.ts` — Add MCPackHandlerContext, MCPackServer types. Update MCPackToolDefinition handler signature.
- `src/wrap.ts` — Apply correctness fixes. Update error messages with tool name.
- `src/index.ts` — Export createMCPackServer, MCPackHandlerContext, MCPackServer.
- `test/build.test.ts` — Build mode tests (NEW).
- `test/wrap.test.ts` — Update for correctness fix changes.

### Plan Structure
- Plan 03-01 (Wave 1): Correctness fixes to wrap.ts + type updates (MCPackHandlerContext, MCPackServer, MCPackToolDefinition handler signature).
- Plan 03-02 (Wave 2): build.ts entry point + build.test.ts + package exports.

### Claude's Discretion
- Internal helper functions in build.ts (e.g., normalizeResult)
- Exact test case names and structure
- Whether to extract shared handler logic between wrap.ts and build.ts into a helper

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Technical Specification
- `mcpack-prd-v1.md` — Full PRD with pseudocode for build mode, createMCPackServer flow, handler routing
- `mcpack-spec-v1.md` — Protocol specification. Add "Known Risks" section about Server class deprecation.

### Phase 2 Implementation (source of truth for engine and wrap mode)
- `src/core.ts` — MCPackEngine class (138 lines). Build mode reuses this unchanged.
- `src/wrap.ts` — mcpack() entry point (131 lines). Correctness fixes apply here.
- `src/types.ts` — Current types. MCPackServerConfig, MCPackToolDefinition already exist but handler signature needs update.
- `src/index.ts` — Current exports. Needs createMCPackServer, MCPackHandlerContext, MCPackServer added.
- `test/wrap.test.ts` — Existing wrap tests. console.warn test needs updating to throw test.

### Phase 1 Modules (unchanged)
- `src/index-builder.ts` — buildIndex()
- `src/search.ts` — scoreAndRank()
- `src/session.ts` — SessionRegistry, STDIO_SESSION_ID
- `src/roles.ts` — resolveRoleAccess(), isToolAllowed()

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `MCPackEngine` (src/core.ts): Shared core — build mode creates instance with stripped Tool[] from config.tools.
- `isToolAllowed()` (src/roles.ts): Role check for tools/call defense-in-depth — used in wrap.ts, reuse in build.ts.
- `errorResult()` helper pattern from core.ts — replicate or extract for build.ts.
- `MCPackServerConfig` type already exists in types.ts with name, version, tools fields.
- `MCPackToolDefinition` type already exists — handler signature needs updating.

### Established Patterns
- ESM modules with `.js` extension imports
- Single interceptor pattern for tools/call (wrap.ts:87-124)
- MCPackHandle return with destroy() and stats()
- Error shape: `{ content: [{ type: 'text', text }], isError: true }`
- TDD pattern: write tests first, then implementation

### Integration Points
- `build.ts` imports MCPackEngine from `./core.js` (same as wrap.ts)
- `build.ts` imports Server, schemas from MCP SDK (same as wrap.ts)
- `src/index.ts` exports createMCPackServer from `./build.js`
- MCPackHandlerContext passed to every handler invocation in dispatch

</code_context>

<specifics>
## Specific Ideas

- Add deprecation-awareness comment in both build.ts and wrap.ts about Server vs McpServer
- Add "Known Risks" section to spec document about Server class dependency
- Config snapshot prevents external mutation from affecting MCPack after setup — defensive pattern for library code
- Mark-loaded-on-direct-call keeps session registry accurate even when agents bypass search_tools

</specifics>

<deferred>
## Deferred Ideas

- Multi-MCP server wrapping — composing multiple MCP servers in one wrapper. MCPackHandlerContext is forward-compatible for this.
- `resolveRole(session)` custom function — v2 (ROLE-05)
- Additional MCPackHandlerContext fields (requestId, timestamp, retryCount) — future versions

</deferred>

---

*Phase: 03-build-mode*
*Context gathered: 2026-03-21*
