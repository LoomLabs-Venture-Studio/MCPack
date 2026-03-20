# Pitfalls Research

**Domain:** MCP server wrapper / lazy tool discovery middleware
**Researched:** 2026-03-19
**Confidence:** HIGH (verified against MCP SDK source and specification)

## Critical Pitfalls

### Pitfall 1: Agents Cannot Call Tools Not Returned by tools/list

**What goes wrong:**
MCPack replaces `tools/list` to return only `search_tools`. The agent discovers a tool via `search_tools`, receives its schema, and attempts to call it via `tools/call`. But many MCP clients validate tool names against the `tools/list` response before sending `tools/call` to the server. If the client caches the initial `tools/list` (which only contains `search_tools`), the client may refuse to send the `tools/call` request for any other tool -- the call never reaches the server.

This is the single most dangerous pitfall for MCPack. The entire product premise depends on agents being able to call tools that were NOT in the `tools/list` response.

**Why it happens:**
The MCP specification does not explicitly forbid clients from calling tools not in `tools/list`, but it strongly implies a discovery-then-call flow. Client implementations (Claude Desktop, Cursor, OpenAI Agents SDK) may enforce this at the client layer. The spec says servers return `-32602 Unknown tool` for invalid tool names, which implies clients expect servers to reject unknown tools -- and some clients pre-validate to avoid the round trip.

**How to avoid:**
1. Test with every major MCP client (Claude Desktop, Claude Code, Cursor, OpenAI Agents SDK) in Phase 1 to verify pass-through `tools/call` works for tools not in `tools/list`.
2. If clients block this: MCPack must dynamically update `tools/list` after `search_tools` returns schemas. Use `notifications/tools/list_changed` to signal the client to re-fetch `tools/list`, which now includes the discovered tools. This is the fallback architecture and must be designed for from day one.
3. Consider a hybrid approach: `tools/list` returns `search_tools` plus previously-discovered tool names (without full schemas) so clients see them as "known."

**Warning signs:**
- `tools/call` for a discovered tool returns no response (client swallowed it)
- Agent says "I don't have access to that tool" after receiving its schema from `search_tools`
- Works in unit tests (no client validation) but fails with real MCP clients

**Phase to address:**
Phase 1 (Core). This must be validated before any other feature work. If client validation blocks this pattern, the entire architecture needs to pivot to the `listChanged` notification approach.

---

### Pitfall 2: Capturing the Original Handler Before Replacement

**What goes wrong:**
The wrap mode needs to capture the original `tools/call` handler so it can pass through non-`search_tools` calls. The MCP SDK's `Server.setRequestHandler()` overwrites the previous handler in its internal `_requestHandlers` Map. There is no public API to read the existing handler before replacement. If you call `setRequestHandler` without first capturing the original, the original handler is lost permanently.

Worse: if the wrapped server uses `McpServer` (the high-level API), it calls `assertCanSetRequestHandler()` internally which checks if a handler is already registered. Calling `setRequestHandler` on a `McpServer`-managed `Server` instance may conflict with this guard -- or the guard may already have been triggered, meaning `setRequestHandler` silently overwrites while `McpServer` still thinks it owns the handler.

**Why it happens:**
The SDK was not designed for middleware/wrapper patterns. `setRequestHandler` is a setter, not middleware registration. There is no `getRequestHandler`, no `wrapRequestHandler`, and no middleware chain.

**How to avoid:**
1. Access the `_requestHandlers` Map directly (it is a private property) to read the existing handler before overwriting. This couples MCPack to SDK internals -- document the SDK version dependency.
2. Alternatively, use a capture pattern: call the original `tools/list` handler programmatically at setup time to snapshot tool definitions, then replace handlers. Do NOT try to call the original handler at runtime -- capture the data, not the function.
3. Never wrap a `McpServer` instance directly -- always wrap the underlying `Server`. Document this clearly: `mcpack()` accepts `Server`, not `McpServer`.
4. Pin `@modelcontextprotocol/sdk` peer dependency to a specific major version range.

**Warning signs:**
- `tools/call` for non-search_tools throws "Unknown tool" despite the underlying server having the tool
- TypeScript errors accessing private properties
- SDK version upgrade breaks handler capture silently

**Phase to address:**
Phase 1 (Core). The handler capture mechanism is the foundation of wrap mode. Must be proven with a working prototype against a real MCP server before building anything else.

---

### Pitfall 3: McpServer vs Server Class Confusion

**What goes wrong:**
The MCP SDK exposes two server classes: `Server` (low-level, uses `setRequestHandler`) and `McpServer` (high-level, uses `registerTool`). MCPack's wrap mode assumes it receives a `Server` instance. If a user passes a `McpServer` instance (which wraps a `Server` internally), MCPack cannot safely intercept handlers because `McpServer` maintains its own internal tool registry (`_registeredTools`) separate from the request handler. Overwriting the `Server`'s handler disconnects it from `McpServer`'s registry.

The PRD references `Server` exclusively, but many MCP server tutorials and examples use `McpServer`. Users will inevitably try to wrap `McpServer` instances.

**Why it happens:**
`McpServer` is the recommended API for most developers. The PRD was written against the low-level `Server` API. Users will not read documentation carefully enough to know the difference.

**How to avoid:**
1. Add runtime type checking: detect if the passed object is a `McpServer` and either extract the underlying `Server` or throw a clear error with guidance.
2. If `McpServer` exposes its underlying `Server` (check SDK), extract it. If not, document that wrap mode requires `Server` instances.
3. Consider adding a `McpServer`-compatible wrap path that uses `McpServer`'s own APIs (if it exposes tool listing and handler routing).
4. Provide migration examples in README: "If you use McpServer, here's how to restructure for MCPack."

**Warning signs:**
- Users report "tools not found" when wrapping their server
- TypeScript type errors when passing `McpServer` to `mcpack()`
- GitHub issues asking "how do I wrap McpServer?"

**Phase to address:**
Phase 1 (Core). Type signatures and runtime detection must be in place from the start.

---

### Pitfall 4: Session ID Extraction Is Not Standardized

**What goes wrong:**
MCPack needs a session ID to track which tool schemas have been loaded. The MCP spec provides session IDs via `Mcp-Session-Id` headers in Streamable HTTP transport, but stdio transport has no session concept at the protocol level. The `initialize` handshake provides `clientInfo` but no unique session identifier. MCPack's session tracking assumes a reliable session ID source that may not exist across transports.

**Why it happens:**
MCP session management is transport-dependent. Streamable HTTP has explicit session headers. Stdio is inherently single-session (one client, one connection). The MCP SDK's `RequestHandlerExtra` parameter passed to handlers may or may not include session context depending on transport and SDK version.

**How to avoid:**
1. For stdio: treat the entire connection as one session. Generate a synthetic session ID at wrap time. This is correct because stdio is 1:1.
2. For Streamable HTTP: extract session ID from the `RequestHandlerExtra` context or request metadata.
3. Make session ID resolution pluggable via config: `resolveSessionId: (extra: RequestHandlerExtra) => string`. Provide sensible defaults for both transports.
4. Document transport-specific behavior explicitly.

**Warning signs:**
- All requests share the same session (every tool shows `loaded: true` after first search)
- Session deduplication tests pass in stdio but fail in HTTP
- `RequestHandlerExtra` does not contain expected session fields

**Phase to address:**
Phase 1 (Core). Session architecture must account for both transports from the start.

---

### Pitfall 5: setInterval Memory Leak in SessionRegistry

**What goes wrong:**
The PRD spec includes `setInterval(() => this.cleanup(), 900000)` in the `SessionRegistry` constructor for cleaning expired sessions. This creates an interval timer that keeps the Node.js process alive and is never cleared. If MCPack is used as a library (which it is), this timer prevents the process from exiting naturally. It also leaks if `SessionRegistry` is instantiated multiple times (e.g., in tests).

**Why it happens:**
`setInterval` without `unref()` keeps the Node.js event loop alive. Library authors frequently forget this because their tests use explicit process termination. The leak only manifests in consumers who expect graceful shutdown.

**How to avoid:**
1. Call `.unref()` on the interval timer so it does not keep the process alive: `const timer = setInterval(...); timer.unref()`.
2. Provide a `destroy()` or `close()` method on the wrapper that calls `clearInterval()`.
3. In tests, always call `destroy()` in afterEach/afterAll to prevent timer accumulation.
4. Consider lazy cleanup (clean on access) instead of periodic cleanup -- simpler and no timer needed.

**Warning signs:**
- Tests hang after completion (Jest/Vitest waits for timers)
- Node.js process does not exit after MCP server closes
- Memory usage grows in long-running test suites

**Phase to address:**
Phase 1 (Core). Must be correct from the first implementation. Timer hygiene is a one-line fix but causes confusing symptoms if missed.

---

### Pitfall 6: Keyword Search Returns Poor Results for Natural Language Queries

**What goes wrong:**
The v1 search algorithm uses exact keyword matching with simple scoring. Agents will send natural language queries like "I need to create a new customer and charge their card" but tool names are `create_customer` and `create_charge`. The gap between natural language and tool naming conventions causes irrelevant or empty results. The agent then cannot discover the tools it needs, defeating MCPack's purpose entirely.

**Why it happens:**
Keyword matching cannot handle synonyms ("charge" vs "payment"), verb forms ("creating" vs "create"), or conceptual queries ("manage billing" when tools are `create_invoice`, `send_invoice`, `void_invoice`). The PRD acknowledges this by planning semantic search for v1.1, but v1 must still work well enough.

**How to avoid:**
1. Stem or normalize query tokens before matching (e.g., "creating" -> "create", "customers" -> "customer"). Use a lightweight stemmer (Porter or similar), not a full NLP library.
2. Build a synonym map for common terms at index time from tool descriptions (not hardcoded).
3. Score partial matches more generously -- "pay" should match "payment" with decent score.
4. Add fuzzy matching for typos (Levenshtein distance <= 2).
5. Include a fallback: if zero results, return the top N tools by partial match score even if below threshold.
6. Test with real Stripe MCP tool names and realistic agent queries to calibrate scoring weights.

**Warning signs:**
- `search_tools` returns empty results for reasonable queries
- Agent calls `search_tools` repeatedly with rephrased queries (visible in logs)
- Integration tests show agents falling back to asking the user for tool names

**Phase to address:**
Phase 2 (Search). Keyword search must be tuned with real tool sets before release. The Stripe MCP harness is the right validation target.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Accessing `_requestHandlers` private Map | Only way to capture original handler | Breaks on SDK internal refactor | v1 only -- seek official API or contribute upstream |
| In-memory sessions only | No database dependency, simple | Lost on restart, no horizontal scaling | v1 -- acceptable for single-process library |
| Hardcoded stop words list | Quick implementation | Misses domain-specific terms, not localizable | v1 -- replace with configurable list in v1.1 |
| No `listChanged` notification support | Simpler initial implementation | Cannot dynamically reveal discovered tools to clients | Never -- must implement if client validation blocks pass-through (see Pitfall 1) |
| No `destroy()`/`close()` method | Fewer API surface decisions | Timer leaks, ungraceful shutdown | Never -- add from day one |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| MCP SDK `Server` | Wrapping `McpServer` instead of `Server` | Type-check at runtime, extract underlying `Server` or throw with clear message |
| MCP SDK `setRequestHandler` | Assuming you can read the existing handler | Access `_requestHandlers` Map directly, or snapshot tool data at setup time before replacing |
| Stripe MCP (test harness) | Assuming stable tool definitions across versions | Snapshot tool list at test setup, do not hardcode expected tool names in assertions |
| stdio transport | Assuming session headers exist | Generate synthetic session ID per connection |
| Streamable HTTP transport | Ignoring `Mcp-Session-Id` header | Extract from request context and use as session key |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Rebuilding index on every `search_tools` call | Slow responses, CPU spikes | Build index once at setup, cache in memory | Noticeable with 100+ tools |
| Linear scan of all tools for scoring | Slow for large tool sets | Acceptable for v1 (most servers have < 100 tools). Pre-filter by keyword set for v1.1 | 500+ tools |
| Storing full schemas in session `loadedTools` | Memory bloat per session | Store tool names only in `loadedTools` Set (PRD already does this correctly) | 1000+ sessions with 50+ tools each |
| `JSON.stringify` on every search response | GC pressure from large string allocations | Pre-serialize common response shapes or use streaming | Noticeable at 100+ concurrent sessions |
| Session cleanup scanning entire Map | Pauses on large session counts | Use a TTL-ordered queue instead of full scan | 10,000+ sessions |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Role bypass via direct `tools/call` | Agent calls a tool it should not have access to by guessing the tool name, bypassing `search_tools` filtering | Validate role permissions in the `tools/call` handler, not just in `search_tools`. Every `tools/call` must check the session's role against the tool name before passing through. |
| Leaking tool names in error messages | Error responses like "Unknown tool: admin_delete_user" reveal tool names to unauthorized roles | Return generic "Unknown tool" without the tool name for role-filtered tools |
| No rate limiting on `search_tools` | Enumeration attack -- caller queries repeatedly to map the entire tool surface | Implement per-session rate limiting on `search_tools` calls (optional for v1, important for multi-tenant) |
| Session ID spoofing | Caller provides a forged session ID to inherit another session's loaded tools | Derive session ID from transport-level context (connection identity), never from user-provided input |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Empty search results with no guidance | Agent gives up or asks user for tool names | Return "No exact matches. Try: [suggested query terms based on available tools]" |
| `loaded: true` without reminder of what the tool does | Agent forgets tool details in long conversations | Include tool name and one-line description even for loaded tools (schema omitted, description kept) |
| `search_tools` description too vague | Agent does not know to call it or what queries to use | Description must include examples: "Example queries: 'create a payment', 'list customers', 'manage subscriptions'" |
| `total_available` count confuses agents | Agent tries to load all tools to be thorough | Consider omitting or rephrasing as "X tools match your query" rather than "X total tools exist" |

## "Looks Done But Isn't" Checklist

- [ ] **Handler passthrough:** Verified that `tools/call` for wrapped server tools actually reaches the original server and returns its response unchanged -- test with tools that return errors, large payloads, and streaming content
- [ ] **Session isolation:** Verified that two concurrent sessions do not share `loadedTools` state -- test with parallel connections
- [ ] **Role inheritance:** Verified that `write: ['read', 'tool_c']` actually inherits all of `read`'s tools, not just the string "read" -- test with nested role hierarchies
- [ ] **Timer cleanup:** Verified that `SessionRegistry` interval does not keep the process alive -- test by importing MCPack and letting the process exit naturally
- [ ] **Empty server:** Verified behavior when wrapping a server with zero tools -- should still return `search_tools` with zero results gracefully
- [ ] **Schema fidelity:** Verified that tool schemas pass through byte-identical -- no accidental JSON serialization/deserialization that strips `undefined` fields or reorders keys
- [ ] **Pagination support:** The MCP spec supports pagination on `tools/list`. MCPack returns a single tool, so no pagination needed, but verify the response shape is still spec-compliant (no `nextCursor` field or `nextCursor: undefined` which might confuse clients)

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Client blocks non-listed tools/call | HIGH | Pivot to `listChanged` notification architecture -- requires adding discovered tools to `tools/list` dynamically and notifying clients |
| Original handler lost on wrap | MEDIUM | Re-initialize the wrapped server, or require users to pass tool definitions explicitly as a fallback |
| Session ID not available | LOW | Fall back to single-session mode (treat all requests as same session) -- functional but loses deduplication |
| Search returns poor results | MEDIUM | Ship with configurable scoring weights, let users tune. Add manual keyword annotations to tool index entries. |
| setInterval memory leak | LOW | Add `timer.unref()` and `destroy()` method -- one-line fixes, no architecture change |
| Role bypass via direct tools/call | MEDIUM | Add role validation to `tools/call` handler -- requires refactoring the pass-through to check permissions first |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Client blocks non-listed tools/call | Phase 1 (Core) | Integration test with Claude Desktop or Claude Code calling a discovered tool |
| Original handler capture | Phase 1 (Core) | Unit test: wrap a server, call a non-search tool, verify original handler response |
| McpServer vs Server confusion | Phase 1 (Core) | TypeScript compile test: passing McpServer to mcpack() produces clear error |
| Session ID extraction | Phase 1 (Core) | Integration test with both stdio and HTTP transports |
| setInterval memory leak | Phase 1 (Core) | Test: import MCPack, verify process exits within 1 second |
| Poor keyword search results | Phase 2 (Search) | Stripe MCP harness: 10 natural language queries, all return relevant tools |
| Role bypass via tools/call | Phase 2 (Roles/Sessions) | Security test: session with 'read' role calls an 'admin' tool, verify rejection |

## Sources

- [MCP Tools Specification (2025-06-18)](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) -- official protocol spec for tools/list, tools/call, error handling
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) -- `setRequestHandler` overwrites handlers, `assertCanSetRequestHandler` guard exists
- [MCP SDK source (unpkg)](https://unpkg.com/@modelcontextprotocol/sdk/dist/esm/shared/protocol.js) -- verified handler storage in `_requestHandlers` Map, overwrite behavior
- [MCP SDK McpServer source](https://unpkg.com/@modelcontextprotocol/sdk/dist/esm/server/mcp.js) -- verified separate `_registeredTools` registry, `assertCanSetRequestHandler` usage
- [NearForm: MCP Tips, Tricks, and Pitfalls](https://nearform.com/digital-community/implementing-model-context-protocol-mcp-tips-tricks-and-pitfalls/) -- session isolation, stdio logging, schema validation issues
- [MCP 2026 Roadmap](https://thenewstack.io/model-context-protocol-roadmap-2026/) -- gateway/proxy pattern gaps, session semantics evolution
- [Dynamic Tool Discovery in MCP](https://www.speakeasy.com/mcp/tool-design/dynamic-tool-discovery) -- listChanged notification pattern
- [MCP Lifecycle Specification](https://modelcontextprotocol.io/specification/2025-03-26/basic/lifecycle) -- session ID via Mcp-Session-Id header, initialize handshake
- [Node.js Timer Memory Leaks](https://lucumr.pocoo.org/2024/6/5/node-timeout/) -- unref() pattern for library timers

---
*Pitfalls research for: MCP server wrapper / lazy tool discovery middleware*
*Researched: 2026-03-19*
