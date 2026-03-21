# Phase 3: Build Mode - Research

**Researched:** 2026-03-21
**Domain:** MCP Server construction, handler routing, result normalization
**Confidence:** HIGH

## Summary

Phase 3 creates the `createMCPackServer(config)` entry point and applies correctness fixes to wrap.ts. The scope is well-defined: build.ts is a thin module that constructs an MCP SDK `Server`, builds a dispatch map from `config.tools`, and delegates all search/session/role behavior to the existing `MCPackEngine`. The correctness fixes (null argument guard, config snapshot, defaultRole validation, mark-loaded-on-direct-call, error messages with tool names) affect wrap.ts and core.ts.

The CONTEXT.md decisions are detailed and complete -- covering handler routing, return normalization, error patterns, server creation, validation, and file structure. Research confirms all decisions are sound and implementable with the current codebase.

**Primary recommendation:** Implement in two waves -- Wave 1 for correctness fixes and type updates (affects existing code), Wave 2 for build.ts entry point (new code). This matches the plan structure specified in CONTEXT.md.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Dispatch map: `Map<string, handler>` built from `config.tools` at setup. O(1) lookup by tool name.
- Dispatch map lives in `build.ts` only -- MCPackEngine stays mode-agnostic.
- Duplicate tool names: log `console.warn('MCPack: duplicate tool name "${tool.name}" in config.tools. Last definition wins.')`.
- Handler returns undefined/null: return `{ content: [{ type: 'text', text: '' }] }`.
- Unknown tool in tools/call: return `isError: true` with `'Unknown tool: {name}'`.
- MCPackHandlerContext: `{ toolName: string; sessionId: string; role: string | undefined }`.
- Handler signature: `handler: (args: Record<string, unknown>, ctx: MCPackHandlerContext) => Promise<unknown>`.
- Handler return normalization: String -> text content, has content array -> passthrough, Object -> JSON.stringify, null/undefined -> empty text.
- Tool name in error messages for BOTH wrap and build mode.
- Uses low-level `Server` class (not McpServer). Constructor: `new Server({ name, version }, { capabilities: { tools: {} } })`.
- Capabilities hardcoded to `{ tools: {} }` -- not configurable.
- Runtime validation: throw if `config.name` or `config.version` are empty/missing.
- Strip handler property from tool definitions before passing to MCPackEngine.
- `createMCPackServer(config)` is synchronous -- returns `MCPackServer`.
- MCPackServer type: `{ server: Server; handle: MCPackHandle }`.
- Throw on empty tools in BOTH wrap and build mode (replaces Phase 2 warn-and-proceed).
- Null arguments guard: `(request.params.arguments == null ? {} : request.params.arguments)` in both modes.
- Config snapshot at setup: snapshot `config.roles` and `config.defaultRole` using spread.
- defaultRole validation: warn if defaultRole not in roles config.
- Mark tools as loaded on direct tools/call (session.loadedTools.add).
- Update wrap.test.ts: replace console.warn-on-empty test with throw-on-empty test.
- Plan 03-01 (Wave 1): Correctness fixes + type updates.
- Plan 03-02 (Wave 2): build.ts entry point + tests + exports.

### Claude's Discretion
- Internal helper functions in build.ts (e.g., normalizeResult)
- Exact test case names and structure
- Whether to extract shared handler logic between wrap.ts and build.ts into a helper

### Deferred Ideas (OUT OF SCOPE)
- Multi-MCP server wrapping
- `resolveRole(session)` custom function (ROLE-05)
- Additional MCPackHandlerContext fields (requestId, timestamp, retryCount)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DISC-04 | All `tools/call` requests for non-`search_tools` tools route to the correct registered handler (build mode) | Dispatch map pattern in build.ts with O(1) lookup. Handler stripping for engine, normalization of return values. |
| ENTRY-02 | `createMCPackServer(config)` creates a new MCP `Server` with tools, handlers, and lazy discovery | Synchronous entry point returning `MCPackServer { server, handle }`. Uses low-level Server class with same MCPackEngine core. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @modelcontextprotocol/sdk | ^1.27.1 (peer) | Server class, request schemas, Tool type | Only MCP implementation; already in use |
| vitest | ^4.1.0 | Test runner | Already configured in project |
| typescript | ~5.8.3 | Type checking | Already configured |

No new dependencies needed. Phase 3 uses only existing project dependencies.

## Architecture Patterns

### File Structure (from CONTEXT.md)
```
src/
  build.ts          # NEW - createMCPackServer() entry point
  core.ts           # MCPackEngine - needs markToolLoaded() method added
  types.ts          # Updated - MCPackHandlerContext, MCPackServer, handler signature
  wrap.ts           # Updated - correctness fixes, error messages
  index.ts          # Updated - new exports
test/
  build.test.ts     # NEW - build mode tests
  wrap.test.ts      # Updated - throw-on-empty, tool name in errors
```

### Pattern 1: Dispatch Map for Handler Routing
**What:** Build a `Map<string, handler>` from `config.tools` at creation time, look up handler by tool name at call time.
**When to use:** Build mode tools/call handling.
**Example:**
```typescript
// In build.ts
type NormalizedHandler = (args: Record<string, unknown>, ctx: MCPackHandlerContext) => Promise<unknown>;

const dispatch = new Map<string, NormalizedHandler>();
for (const tool of config.tools) {
  if (dispatch.has(tool.name)) {
    console.warn(`MCPack: duplicate tool name "${tool.name}" in config.tools. Last definition wins.`);
  }
  dispatch.set(tool.name, tool.handler);
}
```

### Pattern 2: Result Normalization
**What:** Convert arbitrary handler return values to MCP ToolCallResult shape.
**When to use:** Build mode after handler execution.
**Example:**
```typescript
function normalizeResult(value: unknown): ToolCallResult {
  if (value == null) {
    return { content: [{ type: 'text', text: '' }] };
  }
  if (typeof value === 'string') {
    return { content: [{ type: 'text', text: value }] };
  }
  if (typeof value === 'object' && 'content' in value && Array.isArray((value as any).content)) {
    return value as ToolCallResult;
  }
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}
```

### Pattern 3: Handler Stripping for Engine
**What:** Remove `handler` property from MCPackToolDefinition before passing Tool[] to MCPackEngine.
**When to use:** Build mode setup.
**Example:**
```typescript
// Strip handler from tool definitions - engine expects Tool[], not MCPackToolDefinition[]
const tools: Tool[] = config.tools.map(({ handler, ...tool }) => tool);
const engine = new MCPackEngine(tools, config);
```

### Pattern 4: MCPackEngine.markToolLoaded() Method
**What:** The "mark tools as loaded on direct tools/call" fix requires accessing the private sessions registry. Add a public method to MCPackEngine rather than exposing the sessions field.
**Why:** Both wrap.ts and build.ts need this. Adding a method keeps the sessions private and avoids duplicating session logic.
**Example:**
```typescript
// In core.ts - add to MCPackEngine class
markToolLoaded(toolName: string, sessionId: string | undefined): void {
  const sid = sessionId ?? STDIO_SESSION_ID;
  const role = this.config.defaultRole;
  const session = this.sessions.getOrCreate(sid, role ?? '');
  session.loadedTools.add(toolName);
}
```

### Pattern 5: Config Snapshot at Setup
**What:** Snapshot mutable config properties to prevent external mutation after setup.
**When to use:** Both wrap.ts and build.ts.
**Example:**
```typescript
// Snapshot at setup - prevents external mutation
const roles = config.roles ? { ...config.roles } : undefined;
const defaultRole = config.defaultRole;
// Use snapshots, not config reference, throughout handlers
```

### Anti-Patterns to Avoid
- **Exposing engine internals:** Don't make `sessions` public on MCPackEngine; add a method instead.
- **Sharing dispatch map:** Dispatch map is build-mode-only; don't add it to MCPackEngine.
- **Async createMCPackServer:** The function is synchronous (no handler capture like wrap mode). Don't make it async unnecessarily.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Request schema validation | Custom validator | MCP SDK's `ListToolsRequestSchema`, `CallToolRequestSchema` | SDK handles Zod schema validation |
| Session management | New session logic | Existing `SessionRegistry` via `MCPackEngine` | Already handles TTL, cleanup, getOrCreate |
| Role checking | New role logic | Existing `isToolAllowed()` from roles.ts | Already handles wildcards, inheritance |
| Tool indexing | New indexer | Existing `MCPackEngine.handleSearchTools()` | Already does buildIndex + scoreAndRank |

## Common Pitfalls

### Pitfall 1: Forgetting to Strip Handler from Tool Definitions
**What goes wrong:** MCPackEngine receives MCPackToolDefinition with handler functions, which get serialized in search results as `[Function]` or cause type errors.
**Why it happens:** MCPackToolDefinition extends Tool with a handler field. Engine expects pure Tool[].
**How to avoid:** Use destructuring rest: `const { handler, ...tool } = toolDef` to strip handler before passing to engine.
**Warning signs:** TypeScript may not catch this since MCPackToolDefinition extends Tool.

### Pitfall 2: Null vs Undefined Argument Handling
**What goes wrong:** `request.params.arguments ?? {}` only catches undefined and null, but `== null` is the safer guard documented in CONTEXT.md.
**Why it happens:** `??` and `== null` behave identically for null/undefined, but the explicit `== null` form communicates intent more clearly and matches the CONTEXT.md specification.
**How to avoid:** Use the exact pattern from CONTEXT.md: `(request.params.arguments == null ? {} : request.params.arguments)`.

### Pitfall 3: Config Mutation After Setup
**What goes wrong:** User modifies `config.roles` object after calling `mcpack()` or `createMCPackServer()`, causing runtime behavior to silently change.
**Why it happens:** JavaScript objects are passed by reference. Without snapshotting, the handler closure captures the live config reference.
**How to avoid:** Shallow-copy `config.roles` and capture `config.defaultRole` at setup time. Use the snapshots in all handler closures.

### Pitfall 4: Synchronous vs Async Entry Point Confusion
**What goes wrong:** Making `createMCPackServer` async when it doesn't need to be.
**Why it happens:** `mcpack()` (wrap mode) is async because it calls the original tools/list handler. Build mode has no handler to capture.
**How to avoid:** `createMCPackServer` is synchronous. It returns `MCPackServer` directly, not `Promise<MCPackServer>`.

### Pitfall 5: Missing Tool Name in Error Messages
**What goes wrong:** Generic "Tool execution failed" error without the tool name, making debugging difficult.
**Why it happens:** Existing wrap.ts catch block omits the tool name.
**How to avoid:** Always format as `Tool "${name}" failed: ${error.message}` in both wrap.ts and build.ts.

### Pitfall 6: Not Updating wrap.test.ts for Empty Tools Change
**What goes wrong:** Test expects `console.warn` but code now throws, causing test failure.
**Why it happens:** Phase 3 changes empty tools from warn-and-proceed to throw. The existing test at line 191-210 must be updated.
**How to avoid:** Update the test to `expect(mcpack(server)).rejects.toThrow(...)` with the new error message.

## Code Examples

### createMCPackServer Entry Point Structure
```typescript
// Source: CONTEXT.md decisions + existing wrap.ts pattern
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { MCPackServerConfig, MCPackServer, MCPackHandlerContext, ToolCallResult } from './types.js';
import { MCPackEngine } from './core.js';
import { isToolAllowed } from './roles.js';

// NOTE: Uses low-level Server class. The SDK marks Server as @deprecated
// in favor of McpServer, but MCPack requires setRequestHandler() for
// handler interception, which McpServer does not expose.

export function createMCPackServer(config: MCPackServerConfig): MCPackServer {
  // 1. Runtime validation
  if (!config.name) throw new Error('MCPack: config.name is required');
  if (!config.version) throw new Error('MCPack: config.version is required');
  if (!config.tools || config.tools.length === 0) {
    throw new Error('MCPack: config.tools is empty. Provide at least one tool definition.');
  }

  // 2. Snapshot mutable config
  const roles = config.roles ? { ...config.roles } : undefined;
  const defaultRole = config.defaultRole;

  // 3. defaultRole validation
  if (defaultRole && roles && !roles[defaultRole]) {
    console.warn(`MCPack: defaultRole "${defaultRole}" is not defined in roles config. Sessions will see no tools.`);
  }

  // 4. Build dispatch map
  const dispatch = new Map<string, (args: Record<string, unknown>, ctx: MCPackHandlerContext) => Promise<unknown>>();
  for (const tool of config.tools) {
    if (dispatch.has(tool.name)) {
      console.warn(`MCPack: duplicate tool name "${tool.name}" in config.tools. Last definition wins.`);
    }
    dispatch.set(tool.name, tool.handler);
  }

  // 5. Strip handlers and create engine
  const tools: Tool[] = config.tools.map(({ handler, ...tool }) => tool);
  const engine = new MCPackEngine(tools, config);

  // 6. Create Server
  const server = new Server(
    { name: config.name, version: config.version },
    { capabilities: { tools: {} } },
  );

  // 7. Set tools/list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return engine.handleToolsList();
  });

  // 8. Set tools/call handler
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const name = request.params.name;
    const args = (request.params.arguments == null ? {} : request.params.arguments) as Record<string, unknown>;

    // Route search_tools to engine
    if (name === 'search_tools') {
      const sessionId = (extra as any).sessionId as string | undefined;
      return engine.handleSearchTools(args, sessionId);
    }

    // Role check
    if (!isToolAllowed(name, defaultRole, roles)) {
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }

    // Dispatch to handler
    const handler = dispatch.get(name);
    if (!handler) {
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }

    try {
      const sessionId = (extra as any).sessionId as string | undefined;
      const ctx: MCPackHandlerContext = { toolName: name, sessionId: sessionId ?? '__stdio__', role: defaultRole };
      const result = await handler(args, ctx);
      engine.markToolLoaded(name, sessionId);
      return normalizeResult(result);
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Tool "${name}" failed: ${err.message ?? 'Unknown error'}` }], isError: true };
    }
  });

  // 9. Return MCPackServer
  return {
    server,
    handle: {
      destroy: () => engine.destroy(),
      stats: () => engine.stats(),
    },
  };
}
```

### Updated wrap.ts Error Pattern
```typescript
// Current (line 116-123):
catch (err: any) {
  return {
    content: [{ type: 'text', text: err.message ?? 'Tool execution failed' }],
    isError: true,
  };
}

// Updated:
catch (err: any) {
  return {
    content: [{ type: 'text', text: `Tool "${name}" failed: ${err.message ?? 'Unknown error'}` }],
    isError: true,
  };
}
```

### Updated MCPackToolDefinition Handler Signature
```typescript
// Current:
export interface MCPackToolDefinition extends Tool {
  handler: (args: Record<string, unknown>) => Promise<ToolCallResult>;
}

// Updated:
export interface MCPackToolDefinition extends Tool {
  handler: (args: Record<string, unknown>, ctx: MCPackHandlerContext) => Promise<unknown>;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `McpServer` high-level API | `Server` low-level class | SDK marks Server as @deprecated | MCPack uses Server because McpServer doesn't expose `setRequestHandler`. Both classes still work. |
| `request.params.arguments ?? {}` | `request.params.arguments == null ? {} : ...` | Phase 3 decision | Explicit null guard, clearer intent |
| Empty tools: warn and proceed | Empty tools: throw error | Phase 3 decision (revises Phase 2) | Catches developer mistakes at setup |

**Deprecation note:**
- `Server` class is marked `@deprecated` in MCP SDK in favor of `McpServer`. However, `McpServer` does not expose `setRequestHandler()` needed for handler interception. Both wrap and build mode require the low-level `Server`. Add deprecation-awareness comments in both files.

## Open Questions

1. **Should `markToolLoaded` also be called on wrap mode direct calls?**
   - What we know: CONTEXT.md says "Mark tools as loaded on direct tools/call" and specifies both modes
   - What's unclear: Whether wrap mode's proxy path (line 114-123 in wrap.ts) should also call `markToolLoaded`
   - Recommendation: Yes -- apply to both modes. Wrap mode proxies to original handler on direct calls, and should mark the tool as loaded in the session. CONTEXT.md says "After successful tools/call execution" which applies to both modes.

2. **Should shared helpers be extracted?**
   - What we know: Both wrap.ts and build.ts will have similar error handling patterns
   - What's unclear: Whether to extract `normalizeResult` or error formatting into a shared module
   - Recommendation: Keep it simple. `normalizeResult` is build-mode-only (wrap mode passes through to original handler). The error format `Tool "${name}" failed:` is a one-liner -- inline it in both files rather than creating a shared module.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.0 |
| Config file | vitest auto-detection (package.json scripts) |
| Quick run command | `npx vitest run test/build.test.ts --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DISC-04 | tools/call routes to correct handler by name | unit | `npx vitest run test/build.test.ts -t "routes" -x` | No -- Wave 0 |
| DISC-04 | Unknown tool returns isError | unit | `npx vitest run test/build.test.ts -t "unknown" -x` | No -- Wave 0 |
| ENTRY-02 | createMCPackServer returns MCPackServer with server and handle | unit | `npx vitest run test/build.test.ts -t "returns" -x` | No -- Wave 0 |
| ENTRY-02 | tools/list returns search_tools only | unit | `npx vitest run test/build.test.ts -t "search_tools" -x` | No -- Wave 0 |
| N/A | wrap.ts throws on empty tools (correctness fix) | unit | `npx vitest run test/wrap.test.ts -t "empty" -x` | Yes -- needs update |
| N/A | wrap.ts error includes tool name (correctness fix) | unit | `npx vitest run test/wrap.test.ts -x` | Needs new test |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose` (full suite -- 68+ tests)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `test/build.test.ts` -- covers DISC-04, ENTRY-02 (new file)
- [ ] `test/wrap.test.ts` -- update existing "empty tools" test from warn to throw
- [ ] `test/wrap.test.ts` -- add test for tool name in error messages

## Sources

### Primary (HIGH confidence)
- Source code: `src/core.ts`, `src/wrap.ts`, `src/types.ts`, `src/index.ts` -- direct inspection of current implementation
- Source code: `test/wrap.test.ts` -- existing test patterns and helpers
- Source code: `node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.d.ts` -- Server class signature and deprecation status
- CONTEXT.md -- locked decisions defining all implementation details

### Secondary (MEDIUM confidence)
- MCP SDK deprecation of Server class -- confirmed via `.d.ts` `@deprecated` JSDoc tag

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all existing
- Architecture: HIGH -- CONTEXT.md provides complete design, confirmed against existing codebase
- Pitfalls: HIGH -- identified from direct code analysis (handler stripping, config mutation, empty tools test)

**Research date:** 2026-03-21
**Valid until:** 2026-04-21 (stable -- no external dependencies changing)
