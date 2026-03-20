# Architecture Research

**Domain:** MCP server wrapper / lazy tool discovery middleware
**Researched:** 2026-03-19
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     MCP Client (Agent)                       │
│         Connects, calls tools/list, calls tools/call         │
└──────────────────────────┬──────────────────────────────────┘
                           │ JSON-RPC over stdio / HTTP
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    MCPack Wrapper Layer                       │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ Handler  │  │  Search  │  │ Session  │  │  Role    │    │
│  │Intercept │  │  Engine  │  │ Registry │  │  Filter  │    │
│  └─────┬────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘    │
│        │            │             │              │           │
│  ┌─────┴────────────┴─────────────┴──────────────┴─────┐    │
│  │                    Core Engine                        │    │
│  │   Wires index, sessions, roles, search together       │    │
│  └──────────────────────┬───────────────────────────────┘    │
│                         │                                    │
│  ┌──────────────────────┴───────────────────────────────┐    │
│  │                   Tool Index                          │    │
│  │   In-memory keyword index of all tool definitions     │    │
│  └──────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────┤
│                     Entry Points                             │
│  ┌─────────────┐              ┌──────────────────┐          │
│  │  mcpack()   │              │createMCPackServer()│          │
│  │ Wrap Mode   │              │  Build Mode       │          │
│  └─────────────┘              └──────────────────┘          │
└──────────────────────────┬──────────────────────────────────┘
                           │ Pass-through (all non-search calls)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Underlying MCP Server (or handlers)             │
│         Unchanged. Handles actual tool/call execution.       │
└─────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Handler Intercept (`wrapper.ts` / `server-builder.ts`) | Replaces `tools/list` and `tools/call` handlers on the MCP Server instance | Calls `server.setRequestHandler()` to overwrite existing handlers |
| Core Engine (`core.ts`) | Wires index, sessions, roles, and search together; shared between both modes | Factory function `setupCore()` returns a core object with `searchToolDefinition` and `handleSearch()` |
| Tool Index (`index-builder.ts`) | Builds keyword-searchable index from tool definitions at startup | `buildIndex()` extracts keywords from name/description, assigns role tiers |
| Search Engine (`search.ts`) | Scores and ranks index entries against a natural language query | `scoreAndRank()` with weighted keyword matching (name > description > keyword) |
| Session Registry (`session.ts`) | Tracks per-session loaded tools, enforces TTL, deduplicates schema delivery | `SessionRegistry` class with Map-based storage, periodic cleanup via setInterval |
| Role Filter (`roles.ts`) | Resolves hierarchical role permissions, filters tool visibility | `resolveRoleAccess()` with recursive role inheritance and wildcard support |
| Search Tool Definition (`search-tool.ts`) | Defines the `search_tools` tool schema and its handler logic | `SEARCH_TOOLS_DEFINITION` constant + `handleSearchTools()` function |
| Types (`types.ts`) | All shared TypeScript interfaces | Pure type file, no runtime code |

## Recommended Project Structure

```
src/
├── index.ts              # Public exports: mcpack(), createMCPackServer(), types
├── wrapper.ts            # Wrap mode: intercepts existing server handlers
├── server-builder.ts     # Build mode: creates new MCP server with handlers
├── core.ts               # Shared engine: wires index + sessions + roles + search
├── index-builder.ts      # Builds ToolIndex from tool definitions
├── search.ts             # Keyword scoring and result ranking
├── session.ts            # Session registry with loaded-tool tracking
├── roles.ts              # Role resolution and permission filtering
├── search-tool.ts        # search_tools definition and handler
└── types.ts              # All TypeScript interfaces
test/
├── unit/
│   ├── index-builder.test.ts
│   ├── search.test.ts
│   ├── session.test.ts
│   ├── roles.test.ts
│   ├── wrapper.test.ts
│   └── server-builder.test.ts
└── integration/
    └── harness.test.ts   # Full test against real Stripe MCP
```

### Structure Rationale

- **Flat src/ directory:** The package has ~10 focused modules. Sub-directories add navigation overhead for no benefit at this scale. Each file maps to one responsibility.
- **core.ts as the seam:** Both modes (wrap and build) share identical search/session/role logic. `core.ts` is the only place that wires these together. This prevents duplication and ensures behavioral parity between modes.
- **Two entry points, not one polymorphic function:** `wrapper.ts` and `server-builder.ts` are separate files because they have fundamentally different inputs (existing Server vs. tool definition array). Forcing them into one function would create confusing overloads.
- **Types isolated:** `types.ts` has zero runtime code. This keeps the type surface clean for consumers who import types only.

## Architectural Patterns

### Pattern 1: Handler Replacement (Decorator Pattern)

**What:** MCPack intercepts an existing MCP Server by overwriting its `tools/list` and `tools/call` request handlers using `server.setRequestHandler()`. The original handlers are captured first, then replaced with MCPack handlers that delegate non-search calls to the originals.

**When to use:** Wrap mode -- wrapping any third-party MCP server without modifying its source.

**Trade-offs:**
- Pro: Zero changes to the underlying server. Drop-in. No proxy process.
- Pro: Same process, no IPC overhead.
- Con: Depends on MCP SDK allowing handler overwrite (confirmed: it does -- `setRequestHandler` replaces any previous handler for the same method, documented in SDK source).
- Con: Must capture original handler reference before overwriting. If the original server has not registered a `tools/call` handler yet (unlikely but possible), the fallback must handle this gracefully.

**Critical SDK detail (verified HIGH confidence):**
```typescript
// From @modelcontextprotocol/core Protocol class:
// _requestHandlers is a Map<string, handler>
// setRequestHandler() calls Map.set() -- replaces silently.
// Comment in source: "Note that this will replace any previous request handler"
// removeRequestHandler() calls Map.delete()
// assertCanSetRequestHandler() throws if handler exists -- but setRequestHandler does NOT call it

// The Server class (deprecated, but what MCPack targets) extends Protocol.
// McpServer (high-level) wraps Server and calls assertCanSetRequestHandler before
// registering tools/list and tools/call. This means:
// - If wrapping a Server: setRequestHandler works, replaces silently.
// - If wrapping a McpServer's .server property: same behavior.
// - If wrapping a McpServer directly: won't work (wrong class). MCPack must
//   accept Server instances, not McpServer instances.
```

**Example:**
```typescript
// Capture original handler before overwriting
const originalListHandler = captureHandler(server, 'tools/list');

server.setRequestHandler('tools/list', async () => {
  return { tools: [core.searchToolDefinition] };
});

server.setRequestHandler('tools/call', async (request, ctx) => {
  if (request.params.name === 'search_tools') {
    return core.handleSearch(request, ctx);
  }
  return originalCallHandler(request, ctx);
});
```

### Pattern 2: Handler Map Routing (Build Mode)

**What:** MCPack creates a fresh MCP Server, accepts tool definitions with attached handler functions, and routes `tools/call` to the correct handler using a `Map<string, handler>`.

**When to use:** Build mode -- new server projects that want lazy discovery from the start.

**Trade-offs:**
- Pro: Clean setup, no handler capture complexity.
- Pro: Tool definitions and handlers are co-located in user code.
- Con: Users must adopt MCPack's API instead of the standard McpServer/Server API.

**Example:**
```typescript
const handlerMap = new Map(config.tools.map(t => [t.name, t.handler]));

server.setRequestHandler('tools/call', async (request) => {
  if (request.params.name === 'search_tools') {
    return core.handleSearch(request);
  }
  const handler = handlerMap.get(request.params.name);
  if (!handler) throw new Error(`Unknown tool: ${request.params.name}`);
  return handler(request.params.arguments ?? {});
});
```

### Pattern 3: Session-Gated Schema Delivery

**What:** Tool schemas are returned at most once per session. Subsequent requests for the same tool return `{ name, loaded: true }` with no schema payload. The session registry tracks which schemas have been surfaced.

**When to use:** Always -- this is core to the token reduction mechanism.

**Trade-offs:**
- Pro: Guarantees token cost ceiling equals vanilla MCP (never worse).
- Pro: Long sessions with many searches benefit most.
- Con: If the agent's context window resets (e.g., conversation truncation), the session still thinks schemas are loaded. The agent would need to start a new session. This is an inherent limitation of server-side session state vs. client-side context state.

## Data Flow

### Request Flow: tools/list (Connect)

```
Agent connects
    │
    ▼
tools/list request arrives
    │
    ▼
MCPack handler intercepts (replaces original)
    │
    ▼
Returns: { tools: [search_tools] }    ← 1 tool, ~140 tokens
    │
    ▼
Agent sees search_tools as only available tool
```

### Request Flow: search_tools Call

```
Agent calls search_tools({ query: "list customers", limit: 3 })
    │
    ▼
MCPack tools/call handler intercepts (name === 'search_tools')
    │
    ├──► SessionRegistry.getOrCreate(ctx.sessionId, role)
    │         │
    │         ▼
    │    Session { id, role, loadedTools: Set<string> }
    │
    ├──► resolveRoleAccess(session.role, config.roles, index)
    │         │
    │         ▼
    │    Filtered index (only tools this role can see)
    │
    ├──► scoreAndRank(query, filteredIndex, limit)
    │         │
    │         ▼
    │    Top N matching ToolIndexEntry[]
    │
    ├──► For each match: check session.loadedTools
    │         │
    │         ├── Not loaded → return full schema, mark as loaded
    │         └── Already loaded → return { name, loaded: true }
    │
    ▼
Return SearchToolResponse to agent
```

### Request Flow: Regular tools/call (Pass-Through)

```
Agent calls tools/call({ name: "create_customer", arguments: {...} })
    │
    ▼
MCPack tools/call handler checks: name !== 'search_tools'
    │
    ├──[Wrap mode]──► Delegate to captured original handler
    │                      │
    │                      ▼
    │                 Original MCP server processes call
    │
    └──[Build mode]──► Look up handler in handlerMap
                           │
                           ▼
                      Registered handler processes call
    │
    ▼
Return result to agent (unchanged)
```

### Key Data Flows

1. **Index build (startup only):** Tool definitions are extracted from the underlying server (wrap mode) or from config (build mode), then tokenized into keyword-searchable `ToolIndexEntry[]`. This happens once at initialization and the index is immutable after that.

2. **Search query (per request):** Query string is tokenized, scored against every index entry, filtered by role, sorted by score, capped at limit. Scoring is O(tools * query_tokens) -- trivial for <100 tools.

3. **Session tracking (per request):** Session ID comes from `ctx.sessionId` provided by the MCP SDK transport layer. Each search call reads and writes the session's `loadedTools` Set. Session cleanup runs on a 15-minute interval.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1-50 tools | Default configuration. Linear search is instant. No concerns. |
| 50-200 tools | Still fine with keyword search. Consider increasing `maxResults` default. Index build takes milliseconds. |
| 200+ tools | Keyword search may return too many low-quality matches. This is where semantic search (v1.1) becomes important. Consider pre-computed TF-IDF weights instead of raw keyword counts. |

### Scaling Priorities

1. **First concern (not bottleneck): Search quality at 50+ tools.** Keyword matching works well for <50 tools because tool names are usually descriptive. At 50+ tools, queries like "manage payments" may match too many tools with "manage" or "payment" in the name. Mitigation: good scoring weights and appropriate `maxResults` cap.

2. **Second concern: Session memory at high concurrency.** Each session stores a Set of loaded tool names. At 1000 concurrent sessions with 50 tools each, that is ~50K string entries in memory -- negligible. The 15-minute cleanup interval with 2-hour TTL is appropriate.

## Anti-Patterns

### Anti-Pattern 1: Wrapping McpServer Instead of Server

**What people do:** Accept an `McpServer` instance and try to call `setRequestHandler` on it.
**Why it's wrong:** `McpServer` is the high-level API. It does not expose `setRequestHandler` directly. It internally calls `assertCanSetRequestHandler` before registering `tools/list` and `tools/call`, which would throw if handlers already exist. The low-level `Server` is the correct target.
**Do this instead:** Accept `Server` instances. If users have a `McpServer`, they access the underlying server via `mcpServer.server`. Document this clearly.

### Anti-Pattern 2: Capturing Original Handlers via Private Property Access

**What people do:** Access `server._requestHandlers` (private Map) to read original handlers before overwriting.
**Why it's wrong:** Private properties are not part of the public API. They can change between SDK versions without notice. TypeScript will also error on private access.
**Do this instead:** There are two viable approaches:
1. Call the original handler before overwriting by creating a synthetic request and invoking it, then cache the tool list result. (Brittle -- requires a connected transport.)
2. Ask the user to pass original tool definitions separately in config. (Clean but requires user effort.)
3. Use `server.setRequestHandler` to register a temporary handler that captures the tools, then overwrite again. (Requires the server to be connected already.)

The PRD specifies `captureOriginalTools(server)` as a function -- this is an implementation detail that needs careful design. The safest approach: MCPack's wrap function should accept the server **before** it connects to a transport. MCPack registers its own handlers, and when the first `tools/list` arrives, it delegates to the original handler (which MCPack captured a reference to before overwriting). Since `setRequestHandler` replaces the handler in a Map, MCPack can read the existing handler by storing a reference to the handler function before calling `setRequestHandler`.

**Critical insight:** The `_requestHandlers` Map is private, but we do not need to access it. We need to capture the original handler **function reference** before overwriting. The challenge: the SDK does not expose a `getRequestHandler()` method. Options:
- Accept tool definitions as a parameter alongside the server (avoids the problem entirely)
- Use `fallbackRequestHandler` on the Protocol class (public property) as a catch-all
- Accept that accessing internals may be necessary and pin to a compatible SDK version range

This is the single hardest architecture decision in the project. Recommend resolving during Phase 1 implementation with a spike.

### Anti-Pattern 3: Stateful Search Tool Definition

**What people do:** Put session state into the `search_tools` definition (e.g., dynamic description mentioning session).
**Why it's wrong:** `tools/list` should return a static definition. The tool definition is cached by clients. Dynamic definitions per session would confuse clients.
**Do this instead:** Keep `SEARCH_TOOLS_DEFINITION` as a static constant. All dynamic behavior (session tracking, role filtering) happens in the `tools/call` handler, not the tool definition.

### Anti-Pattern 4: setInterval Leak in Session Cleanup

**What people do:** Start a `setInterval` for session cleanup in the `SessionRegistry` constructor with no way to stop it.
**Why it's wrong:** In test environments or when servers are created/destroyed, the interval keeps the Node.js process alive. This causes hanging tests.
**Do this instead:** Use `setInterval(...).unref()` so the timer does not prevent process exit. Or provide a `destroy()` / `close()` method on the registry. Or better: use lazy cleanup (check TTL on access) instead of periodic cleanup.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| MCP SDK `Server` class | Handler replacement via `setRequestHandler()` | MCPack's primary integration surface. Pin `@modelcontextprotocol/sdk` peer dep to `>=1.0.0` but test against latest. The SDK is evolving (v2 expected); `Server` is already marked `@deprecated` in favor of `McpServer`. Monitor for breaking changes. |
| MCP transports (stdio, HTTP) | No direct integration | MCPack is transport-agnostic. It operates at the handler layer above transport. Works with any transport the SDK supports. |
| Stripe MCP (test harness) | Client connection for integration tests | Used only in test/integration. Connect via MCP Client SDK, pull tool definitions, proxy calls. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Entry points → Core | Direct function call: `setupCore(tools, config)` returns core object | Core is a factory, not a class. Returns `{ searchToolDefinition, handleSearch }`. |
| Core → Index Builder | Direct call: `buildIndex(tools, config)` at init | One-time call. Index is immutable after creation. |
| Core → Session Registry | Instance method calls on `SessionRegistry` | Created once per core instance. Stateful (sessions Map). |
| Core → Role Filter | Pure function call: `resolveRoleAccess(role, roles, index)` | Stateless. Called on every search request. |
| Core → Search Engine | Pure function call: `scoreAndRank(query, index, limit)` | Stateless. Called on every search request. |
| Wrapper → Original Server | Captured handler function reference | The trickiest boundary. Must capture before overwriting. |

## Build Order (Dependencies)

The dependency graph dictates a clear build order:

```
Phase 1: Foundation (no internal dependencies)
├── types.ts             ← everything depends on this, build first
├── search.ts            ← pure function, depends only on types
├── session.ts           ← self-contained class, depends only on types
├── roles.ts             ← pure function, depends only on types
└── index-builder.ts     ← pure function, depends only on types

Phase 2: Assembly (depends on Phase 1)
├── search-tool.ts       ← depends on types, search
└── core.ts              ← depends on ALL Phase 1 modules + search-tool

Phase 3: Entry Points (depends on Phase 2)
├── wrapper.ts           ← depends on core, MCP SDK Server
├── server-builder.ts    ← depends on core, MCP SDK Server
└── index.ts             ← re-exports from wrapper, server-builder, types

Phase 4: Testing
├── unit tests           ← one per Phase 1 + Phase 3 module
└── integration harness  ← depends on everything + Stripe MCP
```

**Why this order:**
- Phase 1 modules are leaf nodes -- they depend only on types and can be built and tested independently.
- Core (`core.ts`) is the integration point that wires Phase 1 modules together. It cannot be built until all leaf modules exist.
- Entry points (`wrapper.ts`, `server-builder.ts`) are thin shells over `core.ts`. They add mode-specific handler setup but delegate all real logic to core.
- The handler capture problem (Anti-Pattern 2) should be spiked in Phase 3 as part of `wrapper.ts` implementation. This is the highest-risk architectural decision.

## Sources

- [MCP TypeScript SDK - GitHub](https://github.com/modelcontextprotocol/typescript-sdk) - Repository structure, package organization (HIGH confidence)
- [MCP SDK Protocol class source](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/core/src/shared/protocol.ts) - `setRequestHandler` implementation, `_requestHandlers` Map, handler replacement behavior (HIGH confidence - verified from source)
- [MCP SDK Server class source](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/server/src/server/server.ts) - `Server` extends `Protocol`, constructor registers initialize handler, `@deprecated` annotation (HIGH confidence - verified from source)
- [MCP SDK McpServer class source](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/server/src/server/mcp.ts) - High-level API, `assertCanSetRequestHandler` guard, `.server` property for low-level access (HIGH confidence - verified from source)
- [@modelcontextprotocol/sdk on npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk) - Current version 1.27.1, monorepo restructure to packages/ (MEDIUM confidence)

---
*Architecture research for: MCP server wrapper / lazy tool discovery middleware*
*Researched: 2026-03-19*
