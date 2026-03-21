# Phase 2: Core Engine and Wrap Mode - Research

**Researched:** 2026-03-21
**Domain:** MCP server handler interception, core engine assembly, wrap mode entry point
**Confidence:** HIGH

## Summary

Phase 2 wires the four Phase 1 leaf modules (index-builder, search, session, roles) into a class-based `MCPackEngine` and delivers the `mcpack(server, config)` wrap mode entry point. The primary technical challenge is handler capture -- reading the existing `tools/list` and `tools/call` handlers from an MCP `Server` instance before replacing them. The MCP SDK has no public `getRequestHandler()` API, but `_requestHandlers` is a plain JavaScript `Map` property (not a `#private` field), making it accessible at runtime via type assertion.

The CONTEXT.md decisions are comprehensive and prescriptive. The call-and-capture strategy (simulate internal `tools/list` to snapshot tool definitions, capture original `tools/call` handler reference before overwriting) is locked. The engine is class-based (`MCPackEngine`), internal (not exported), and instantiated by `mcpack()` which returns `MCPackHandle`. Session ID comes from `RequestHandlerExtra.sessionId` with fallback to `STDIO_SESSION_ID`.

**Primary recommendation:** Build `core.ts` (MCPackEngine class) first, then `wrap.ts` (mcpack function). Test against a mock Server instance that has registered tools/list and tools/call handlers. Use `(server as any)._requestHandlers.get('tools/call')` to capture the original handler reference, and `(server as any)._requestHandlers.get('tools/list')` to invoke the original tools/list handler for tool definition capture.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Handler Capture:** Call-and-capture at setup. `mcpack()` simulates internal `tools/list` request to snapshot tool definitions before replacing handlers. Use MCP SDK request handling mechanism -- not private API access for the call itself.
- **Handler Capture Fallback:** Capture original `tools/call` handler reference before replacing. If internal `tools/list` returns empty or throws, fall back to requiring explicit `tools` array in config.
- **Empty Tools:** Zero tools = console.warn + proceed normally. Do not throw.
- **Async API:** `mcpack()` is async, returns `Promise<MCPackHandle>`.
- **Handler Wiring:** Single interceptor pattern. One `setRequestHandler(CallToolRequestSchema, ...)` replaces original. Branch on tool name.
- **Role Enforcement:** Role filtering applies to both search results AND `tools/call` execution (defense-in-depth).
- **tools/list Replacement:** Returns exactly one tool: `search_tools` with its input schema.
- **MCPackHandle:** `{ destroy(): void, stats(): { sessions: number, tools: number } }`. Server modified in place. Handle is separate.
- **Session ID:** From `RequestHandlerExtra.sessionId`. Fallback to `STDIO_SESSION_ID` (`'__stdio__'`).
- **Role Resolution:** `defaultRole` only for v1. No per-session role resolution.
- **Engine Structure:** Class-based `MCPackEngine`, internal (not exported). File structure: `core.ts` + `wrap.ts`.
- **Index Init:** Eagerly built after call-and-capture. Errors surface at `mcpack()` call time.
- **search_tools Schema:** `{ query: string (required), limit?: number (optional) }`. Limit capped at `config.index.maxResults`.
- **Error Handling:** All errors use `{ content: [{ type: 'text', text: message }], isError: true }`. Never throw from tool handler.
- **Response Format:** JSON string in text content. Loaded tools: `{ name, loaded: true }` only -- no schema, no description.

### Claude's Discretion
- Exact search_tools tool description text
- Internal helper functions within core.ts
- Exact console.warn message format
- How to handle edge cases in RequestHandlerExtra (e.g., malformed sessionId)

### Deferred Ideas (OUT OF SCOPE)
- `resolveRole(session)` custom function for per-session role resolution (v2, ROLE-05)
- Build mode entry point `createMCPackServer()` (Phase 3)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DISC-01 | `tools/list` returns exactly one tool: `search_tools` | Handler replacement via `server.setRequestHandler(ListToolsRequestSchema, ...)`. Server must have `tools: {}` capability. |
| DISC-02 | `search_tools` accepts NL query and returns matching schemas ranked by relevance | Compose `scoreAndRank()` from Phase 1 search module. Session-gated schema delivery per PRD pseudocode. |
| DISC-03 | All `tools/call` for non-`search_tools` tools pass through unchanged | Capture original handler via `_requestHandlers.get('tools/call')` before replacement. Forward with original request + extra args. |
| DISC-05 | Previously loaded schemas returned as `loaded: true` with no schema payload | Session `loadedTools` Set tracks seen tool names. Check before building response. |
| ENTRY-01 | `mcpack(server, config)` wraps existing MCP Server with lazy discovery | `wrap.ts` exports async `mcpack()` that captures tools, builds engine, replaces handlers, returns `MCPackHandle`. |
| ENTRY-03 | Both entry points share the same core engine | `MCPackEngine` class in `core.ts` used by wrap mode now and build mode in Phase 3. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | ^1.27.1 (peer dep) | MCP Server class, request schemas, types | The only MCP SDK. Provides `Server`, `ListToolsRequestSchema`, `CallToolRequestSchema`, `RequestHandlerExtra`. |
| TypeScript | ~5.8.3 | Type safety, NodeNext module resolution | Already configured in project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | ^4.1.0 | Unit testing | All test files for core.ts and wrap.ts |

No new dependencies needed. Phase 2 composes existing Phase 1 modules + MCP SDK types.

**Installation:** No new packages to install. All dependencies already in place from Phase 1.

## Architecture Patterns

### Recommended File Structure
```
src/
├── core.ts              # MCPackEngine class (NEW)
├── wrap.ts              # mcpack() entry point (NEW)
├── index.ts             # Updated: add mcpack + MCPackHandle exports
├── types.ts             # Updated: add MCPackHandle type
├── index-builder.ts     # Phase 1 (unchanged)
├── search.ts            # Phase 1 (unchanged)
├── session.ts           # Phase 1 (unchanged)
└── roles.ts             # Phase 1 (unchanged)
test/
├── core.test.ts         # MCPackEngine unit tests (NEW)
├── wrap.test.ts         # mcpack() integration tests (NEW)
├── index-builder.test.ts
├── search.test.ts
├── session.test.ts
└── roles.test.ts
```

### Pattern 1: Handler Capture via _requestHandlers Map

**What:** Read the existing handler function from the Server's internal `_requestHandlers` Map before overwriting with `setRequestHandler`. The Map key is the method string (e.g., `'tools/list'`, `'tools/call'`).

**When to use:** Wrap mode -- capturing the original `tools/call` handler to proxy non-search calls.

**Critical SDK details (verified HIGH confidence from SDK source v1.27.1):**
- `_requestHandlers` is `Map<string, handler>` initialized in `Protocol` constructor
- `setRequestHandler(schema, handler)` calls `getMethodLiteral(schema)` to extract method string, then `_requestHandlers.set(method, wrappedHandler)`
- The stored handler is a **wrapped** version: it parses the request through the schema before calling the user handler
- `_requestHandlers` is TypeScript `private` but plain JS property (not `#private`), accessible via `(server as any)._requestHandlers`
- `Server.setRequestHandler` calls `assertRequestHandlerCapability(method)` which checks `this._capabilities.tools` exists for `tools/call` and `tools/list`

**Example (verified against SDK source):**
```typescript
// Capture the WRAPPED original handler (already does schema parsing)
const originalCallHandler = (server as any)._requestHandlers.get('tools/call');

// For tools/list capture: invoke it to get tool definitions
const originalListHandler = (server as any)._requestHandlers.get('tools/list');
```

### Pattern 2: Call-and-Capture for Tool Definitions

**What:** Invoke the original `tools/list` handler programmatically at setup time to snapshot tool definitions. This avoids needing the server to be connected to a transport.

**When to use:** At `mcpack()` initialization to populate the tool index.

**Key insight:** The wrapped handler in `_requestHandlers` expects `(request: JSONRPCRequest, extra: RequestHandlerExtra)` -- but since we're calling it internally, we need to provide a synthetic extra object with at minimum an `AbortSignal`.

**Example:**
```typescript
// The handler stored in _requestHandlers is the SDK's wrapped version
// It takes (request, extra) and returns Promise<result>
const fakeExtra = {
  signal: new AbortController().signal,
  requestId: 0,
  sendNotification: async () => {},
  sendRequest: async () => { throw new Error('not available'); },
};

const result = await originalListHandler(
  { method: 'tools/list', params: {} },
  fakeExtra
);
// result.tools is Tool[]
```

### Pattern 3: MCPackEngine as Internal Composition Root

**What:** `MCPackEngine` holds the tool index, session registry, config, and exposes methods that the entry points call. It is the single integration point for all Phase 1 modules.

**When to use:** Always -- both wrap mode (Phase 2) and build mode (Phase 3) instantiate this class.

**Example:**
```typescript
class MCPackEngine {
  private index: ToolIndexEntry[];
  private sessions: SessionRegistry;
  private config: MCPackConfig;

  constructor(tools: Tool[], config: MCPackConfig) {
    this.config = config;
    this.index = buildIndex(tools);
    this.sessions = new SessionRegistry(config.session);
  }

  handleToolsList(): { tools: Tool[] } {
    return { tools: [this.searchToolDefinition()] };
  }

  handleToolsCall(
    name: string,
    args: Record<string, unknown>,
    sessionId: string | undefined
  ): ToolCallResult {
    // search_tools handling, session management, role filtering
  }

  destroy(): void { this.sessions.destroy(); }
  stats(): { sessions: number; tools: number } { ... }
}
```

### Pattern 4: Error Response Shape

**What:** All MCPack tool handler responses that indicate an error use `{ content: [{ type: 'text', text: message }], isError: true }`. Never throw from a tool handler.

**When to use:** All error paths in `handleToolsCall`: invalid search_tools args, role check failures, proxied handler errors.

**Example:**
```typescript
function errorResult(message: string): ToolCallResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}
```

### Anti-Patterns to Avoid
- **Wrapping McpServer directly:** `mcpack()` must accept `Server`, not `McpServer`. `McpServer` has a separate internal `_registeredTools` registry. Users with `McpServer` access `.server` property.
- **Accessing original handler at request time:** Capture the handler reference ONCE at setup, store it. Do not re-read `_requestHandlers` on every call.
- **Throwing from tool handlers:** MCP tool errors go in the result object, not as thrown exceptions. The SDK catches thrown errors but the behavior may differ from the `isError` pattern.
- **Dynamic search_tools definition:** The `search_tools` tool definition must be a static shape. Session state belongs in the handler, not the definition.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tool indexing | Custom index data structure | `buildIndex()` from Phase 1 | Already built and tested with 22 unit tests |
| Search scoring | New scoring algorithm | `scoreAndRank()` from Phase 1 | 5-tier weighted scoring already calibrated |
| Session tracking | Custom session map | `SessionRegistry` from Phase 1 | Handles TTL, cleanup, sliding window, timer.unref() |
| Role filtering | Custom permission logic | `resolveRoleAccess()` + `isToolAllowed()` from Phase 1 | Handles inheritance, wildcards, cycle protection |
| Request schema extraction | Manual method string matching | Import `ListToolsRequestSchema`, `CallToolRequestSchema` from SDK | SDK schemas have the method literal embedded |

**Key insight:** Phase 2 is pure composition. All leaf logic exists. The challenge is wiring and handler interception, not algorithm design.

## Common Pitfalls

### Pitfall 1: The Wrapped Handler Signature Mismatch
**What goes wrong:** The handler stored in `_requestHandlers` is NOT the user's original handler. It is the SDK's wrapper that first parses the request through the Zod schema. This wrapped handler takes `(request: JSONRPCRequest, extra: RequestHandlerExtra)` -- the raw JSON-RPC request, not the parsed version. When invoking it for call-and-capture or proxying, you must pass the raw request shape.
**Why it happens:** `setRequestHandler` wraps the user handler: `_requestHandlers.set(method, (request, extra) => { const parsed = parseWithCompat(schema, request); return handler(parsed, extra); })`.
**How to avoid:** When proxying `tools/call`, pass the original `request` object and `extra` through as-is. The SDK's `_onrequest` method already passes the raw JSONRPCRequest and extra to the stored handler.
**Warning signs:** Type errors, double-parsing, arguments arriving nested incorrectly.

### Pitfall 2: Server Capabilities Check
**What goes wrong:** `Server.setRequestHandler` calls `assertRequestHandlerCapability(method)` which checks `this._capabilities.tools` for `tools/call` and `tools/list`. If the wrapped server was not created with `capabilities: { tools: {} }`, the replacement call throws.
**Why it happens:** The Server enforces capability declarations.
**How to avoid:** Before calling `setRequestHandler`, verify the server has tools capability. The wrapped server should already have it (it had tools registered), but if it was created without explicit capabilities, call `server.registerCapabilities({ tools: {} })` first. Note: `registerCapabilities` can only be called before connecting to a transport.
**Warning signs:** `Error: Server does not support tools (required for tools/call)`.

### Pitfall 3: RequestHandlerExtra Forwarding
**What goes wrong:** When proxying `tools/call` to the original handler, the `extra` parameter (containing `sessionId`, `signal`, `authInfo`, `requestId`) must be forwarded unchanged. Constructing a new `extra` object drops transport-level context.
**Why it happens:** Developer creates a new extra instead of forwarding the one received.
**How to avoid:** Always pass the `extra` parameter through to the original handler: `return originalHandler(request, extra)`.
**Warning signs:** Session ID lost, abort signals not propagated, auth context missing.

### Pitfall 4: Handling Non-Existent Original Handler
**What goes wrong:** If `_requestHandlers.get('tools/call')` returns `undefined` (server had no tools/call handler yet), proxying fails with null reference.
**Why it happens:** Some servers register handlers lazily or after transport connection.
**How to avoid:** The CONTEXT.md specifies: if `tools/list` capture fails, fall back to requiring explicit `tools` array in config. For `tools/call`, if no original handler exists, non-search_tools calls should return an error result since there is nothing to proxy to.

### Pitfall 5: Capability Registration Timing
**What goes wrong:** `server.registerCapabilities({ tools: {} })` throws after transport connection. If `mcpack()` is called after `server.connect()`, capabilities cannot be added.
**Why it happens:** The SDK enforces that `registerCapabilities` is called before `connect()`.
**How to avoid:** Document that `mcpack()` must be called BEFORE `server.connect(transport)`. The wrapped server should already have tools capability since it has tools registered. If not, this is a user error.

### Pitfall 6: Async mcpack() with Sync Handler Access
**What goes wrong:** `mcpack()` is async (returns `Promise<MCPackHandle>`). The handler capture and index build happen during the async call. If a request arrives before `mcpack()` resolves, the handlers are in an inconsistent state.
**Why it happens:** `setRequestHandler` is synchronous and takes effect immediately, but index building is sync too (after capture).
**How to avoid:** The entire operation is: (1) capture original handlers synchronously from `_requestHandlers`, (2) invoke original tools/list handler (async -- needs await), (3) build index synchronously, (4) replace handlers synchronously. Steps 1 and 4 are instantaneous. The async gap is step 2 only. Since `mcpack()` should be called before `server.connect()`, no requests can arrive during this gap.

## Code Examples

### MCPackHandle Type Addition (types.ts)
```typescript
// Source: CONTEXT.md locked decision
export interface MCPackHandle {
  destroy(): void;
  stats(): { sessions: number; tools: number };
}
```

### search_tools Definition
```typescript
// Source: PRD 4.8 + CONTEXT.md
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const SEARCH_TOOLS_DEFINITION: Tool = {
  name: 'search_tools',
  description: 'Search available tools by capability. Returns matching tool schemas for your query. Call this to discover what tools are available before attempting any operation. Example queries: "create customer", "list payments", "manage subscriptions".',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural language description of what you want to do',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return',
      },
    },
    required: ['query'],
  },
};
```

### Handler Capture Pattern (wrap.ts)
```typescript
// Source: MCP SDK Protocol class source (verified)
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

type RawHandler = (request: any, extra: any) => Promise<any>;

function captureHandler(server: Server, method: string): RawHandler | undefined {
  return (server as any)._requestHandlers?.get(method);
}
```

### search_tools Handler Logic (core.ts)
```typescript
// Source: PRD 4.8 handleSearchTools pseudocode
handleToolsCall(name: string, args: Record<string, unknown>, sessionId: string | undefined): ToolCallResult {
  if (name !== 'search_tools') {
    // This shouldn't happen -- wrap.ts routes non-search calls to original handler
    return errorResult(`Unknown tool: ${name}`);
  }

  if (!args.query || typeof args.query !== 'string') {
    return errorResult('search_tools requires a "query" string parameter');
  }

  const sid = sessionId ?? STDIO_SESSION_ID;
  const role = this.config.defaultRole;
  const session = this.sessions.getOrCreate(sid, role ?? '');

  // Role-filter the index
  const allowed = resolveRoleAccess(role, this.config.roles, this.index);

  // Search
  const maxResults = this.config.index?.maxResults ?? 10;
  const limit = Math.min(args.limit as number ?? 5, maxResults);
  const matches = scoreAndRank(args.query, allowed, limit);

  // Build response with session-gated schemas
  const results: SearchResult[] = matches.map(entry => {
    const loaded = session.loadedTools.has(entry.name);
    if (!loaded) session.loadedTools.add(entry.name);
    return loaded
      ? { name: entry.name, loaded: true }
      : { name: entry.name, loaded: false, schema: entry.schema };
  });

  // Log query
  session.queryLog.push({
    query: args.query,
    results: results.map(r => r.name),
    timestamp: Date.now(),
  });

  const response: SearchToolResponse = {
    tools: results,
    total_available: allowed.length,
    showing: results.length,
    session_id: session.id,
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(response) }],
  };
}
```

### Role Check at tools/call (wrap.ts)
```typescript
// Source: CONTEXT.md - role filtering at tools/call level
// In the CallToolRequest handler:
if (name !== 'search_tools') {
  // Defense-in-depth: check role before proxying
  if (!isToolAllowed(name, role, config.roles)) {
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
  // Proxy to original handler
  return originalCallHandler(request, extra);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `Server` as primary API | `McpServer` as recommended (Server @deprecated) | SDK v1.x | MCPack wraps `Server` (low-level). Users with `McpServer` use `.server` property. |
| No `sessionId` in handler extra | `sessionId` available via `RequestHandlerExtra.sessionId` | SDK v1.x (transport-dependent) | Stdio may not provide sessionId; fallback to `STDIO_SESSION_ID` |

**Deprecated/outdated:**
- `Server` class is `@deprecated` in favor of `McpServer`, but MCPack intentionally targets `Server` because handler interception requires low-level access. This is correct and deliberate.

## Open Questions

1. **Handler capture vs. SDK contract**
   - What we know: `_requestHandlers` is accessible at runtime. Works with SDK v1.27.1.
   - What's unclear: Whether future SDK versions will use `#private` fields, breaking access.
   - Recommendation: Pin peer dep to `^1.0.0`, document the internal access, add a defensive check (`if (!(server as any)._requestHandlers)`) with a clear error message.

2. **Wrapped handler invocation shape for call-and-capture**
   - What we know: The stored handler takes `(request: JSONRPCRequest, extra: RequestHandlerExtra)`.
   - What's unclear: Exact minimal `extra` needed for a synthetic internal call.
   - Recommendation: Construct minimal extra with `signal`, `requestId`, `sendNotification`, `sendRequest`. Test that `tools/list` handler works with this synthetic extra.

3. **Capability registration for servers without tools capability**
   - What we know: `setRequestHandler` for `tools/call`/`tools/list` requires `_capabilities.tools` to exist.
   - What's unclear: Whether all real-world servers that have tools registered also have `capabilities: { tools: {} }`.
   - Recommendation: If `assertRequestHandlerCapability` throws, catch and call `registerCapabilities({ tools: {} })`. If that also fails (post-connect), throw a clear error from `mcpack()`.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.0 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run test/core.test.ts test/wrap.test.ts --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DISC-01 | tools/list returns exactly search_tools | unit | `npx vitest run test/wrap.test.ts -t "tools/list" -x` | No -- Wave 0 |
| DISC-02 | search_tools returns ranked matching schemas | unit | `npx vitest run test/core.test.ts -t "search" -x` | No -- Wave 0 |
| DISC-03 | Non-search tools/call passes through unchanged | unit | `npx vitest run test/wrap.test.ts -t "pass-through" -x` | No -- Wave 0 |
| DISC-05 | Loaded tools return loaded:true, no schema | unit | `npx vitest run test/core.test.ts -t "loaded" -x` | No -- Wave 0 |
| ENTRY-01 | mcpack() wraps Server with lazy discovery | unit | `npx vitest run test/wrap.test.ts -t "mcpack" -x` | No -- Wave 0 |
| ENTRY-03 | Wrap + build share same engine class | unit | `npx vitest run test/core.test.ts -t "engine" -x` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run test/core.test.ts test/wrap.test.ts --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `test/core.test.ts` -- MCPackEngine unit tests (covers DISC-02, DISC-05, ENTRY-03)
- [ ] `test/wrap.test.ts` -- mcpack() wrap mode tests (covers DISC-01, DISC-03, ENTRY-01)
- [ ] Test helpers: mock Server factory function that creates a Server with registered tools

## Sources

### Primary (HIGH confidence)
- MCP SDK `Protocol` class source (`node_modules/@modelcontextprotocol/sdk/dist/esm/shared/protocol.js`) -- verified `_requestHandlers` Map, `setRequestHandler` implementation, handler wrapping behavior
- MCP SDK `Server` class source (`node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js`) -- verified `assertRequestHandlerCapability`, `@deprecated` annotation, capabilities checking
- MCP SDK `protocol.d.ts` -- verified `RequestHandlerExtra` type with `sessionId?: string` field
- MCP SDK `types.js` -- verified `ListToolsRequestSchema`, `CallToolRequestSchema` schemas with method literals
- Phase 1 source files (`src/types.ts`, `src/index-builder.ts`, `src/search.ts`, `src/session.ts`, `src/roles.ts`) -- all module interfaces verified from actual code

### Secondary (MEDIUM confidence)
- `.planning/research/ARCHITECTURE.md` -- component boundaries, data flow, handler capture approaches (verified against current SDK)
- `.planning/research/PITFALLS.md` -- handler capture risks, McpServer vs Server confusion (still accurate)
- `mcpack-prd-v1.md` -- pseudocode for wrap mode, search_tools handler, setupCore

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all verified from installed packages
- Architecture: HIGH -- handler capture mechanism verified against actual SDK source code in node_modules
- Pitfalls: HIGH -- verified against SDK source, cross-referenced with PITFALLS.md research

**Research date:** 2026-03-21
**Valid until:** 2026-04-21 (stable -- MCP SDK peer dep pinned, Phase 1 modules frozen)
