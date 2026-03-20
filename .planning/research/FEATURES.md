# Feature Research

**Domain:** MCP lazy tool discovery wrapper / middleware
**Researched:** 2026-03-19
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Single meta-tool on `tools/list` | Every competitor (MCPProxy, Lazy MCP, Speakeasy, Claude Code itself) replaces bulk tool lists with 1-3 meta-tools. This is the defining pattern of the category. | LOW | MCPack exposes `search_tools`. MCPProxy exposes `retrieve_tools`. Speakeasy exposes 2-3 meta-tools. One meta-tool is the simplest valid approach. |
| Query-based tool search | Agents need to describe what they want in natural language. All competitors support this. Without it, you have a category browser, not a search tool. | MEDIUM | Keyword scoring (name > description > keywords) is the v1 baseline. BM25 (MCPProxy) and embeddings (Speakeasy semantic mode) are upgrades. Keyword is sufficient for v1 given servers typically have <100 tools. |
| Full schema return on match | The entire point is deferred schema loading. When a tool matches, the agent needs the complete inputSchema to call it. Every solution returns full schemas on demand. | LOW | Straightforward -- just return the `ToolDefinition` from the index. |
| Configurable result limit | All competitors support `top_k` / `limit` parameters. Agents and users need control over how many tools come back per query. | LOW | Default 5, max 10. MCPProxy defaults to 5 with `top_k` config. Standard pattern. |
| Pass-through for non-discovery calls | The wrapper must not break actual tool execution. Every proxy/wrapper in the space passes `tools/call` requests through to upstream servers unchanged. This is non-negotiable. | LOW | Intercept only `search_tools` calls; everything else goes to the original handler or upstream server. |
| TypeScript/ESM package | The MCP SDK is TypeScript. The ecosystem is TypeScript-first. Server authors expect `npm install` and TypeScript types. | LOW | Sole peer dependency: `@modelcontextprotocol/sdk`. No runtime deps. |
| Wrap existing server (no modifications) | MCPProxy, Lazy MCP, and the proxy pattern all work without modifying the upstream server. Server-agnostic wrapping is the core value proposition -- "drop-in" is expected. | MEDIUM | `mcpack(server, config)` wraps any MCP `Server` instance. Must capture original handlers before replacing them. |
| Exported TypeScript types | MCP ecosystem is strongly typed. Server authors expect full type exports for config, results, tool definitions. | LOW | Export all public interfaces from `types.ts`. |
| Zero runtime dependencies | Lightweight is a selling point. MCPack and competitors emphasize minimal footprint. Adding deps beyond the MCP SDK would be a red flag for adoption. | LOW | Peer dep on `@modelcontextprotocol/sdk` only. |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but valuable.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Session-aware deduplication | MCPack tracks which schemas have been loaded per session and returns `loaded: true` with no schema on subsequent calls. No competitor does this at the wrapper level. MCPProxy and Lazy MCP re-return full schemas every time. This is MCPack's strongest unique feature -- it guarantees token cost never exceeds vanilla MCP's ceiling while being strictly better for partial sessions. | MEDIUM | Requires in-memory session registry with `loadedTools: Set<string>`. Session keyed by MCP session ID from initialize handshake. TTL-based expiry with periodic cleanup. |
| Role-based tool filtering | Tools outside the caller's role are invisible in search results. MCPProxy has quarantine (security), but not role-based visibility scoping. Speakeasy has no built-in RBAC. This matters for multi-tenant and enterprise deployments. | MEDIUM | Hierarchical role resolution (write inherits read, admin gets all). Configured via `RoleConfig`. Filters at the index level so unauthorized tools never appear. |
| Dual mode: wrap + build | Most competitors are proxy-only (Lazy MCP, MCPProxy) or SDK-only (Speakeasy). MCPack serves both server authors (build mode with `createMCPackServer`) and integrators (wrap mode with `mcpack(server)`). This doubles the addressable audience. | MEDIUM | Build mode creates a fresh `Server`, registers tool handlers in a map, and wires up the same core engine. Wrap mode intercepts an existing server's handlers. Shared core means the two modes are thin entry points. |
| Library, not a daemon | MCPProxy is a standalone desktop app with system tray. Lazy MCP is a Go binary you run as a separate process. MCPack runs in-process as a library. No extra infrastructure, no sidecar, no Docker. This is simpler for server authors who just want to add lazy discovery to their existing server. | LOW | Architecture decision, not a feature to build. But it informs the DX story significantly. |
| Token reduction proof via test harness | Real numbers from a real MCP server (Stripe, 47 tools). Most competitors claim "99% reduction" without reproducible benchmarks. A published, runnable test harness with a comparison report is a trust signal and marketing asset. | MEDIUM | Proxy server wraps Stripe MCP, runs vanilla vs MCPack-wrapped comparisons, outputs a formatted report. Needs Stripe MCP access for integration tests. |
| Auto-keyword extraction from tool definitions | MCPack builds the search index automatically from tool names and descriptions at setup time. No manual annotation, no external embedding model, no JSON hierarchy files. Lazy MCP requires hand-built JSON hierarchies. Speakeasy requires tool metadata annotation. Zero-config indexing is a real DX advantage. | LOW | Tokenize tool name (split on `_`, `-`, camelCase) + significant words from description (stop words removed). Already specified in the PRD. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Semantic/embedding-based search in v1 | Better search quality, natural language understanding. Speakeasy offers it. | Adds a dependency on an embedding model (local or API). Breaks the "zero runtime deps" promise. Increases package size dramatically. Keyword search is sufficient for <100 tools -- the sweet spot for v1. | Ship keyword search for v1. Plan semantic search as v1.1 with an optional peer dependency on an embedding provider. Let users opt in. |
| Standalone proxy server / daemon | MCPProxy runs as a desktop app. Some users want a persistent process they can point multiple clients at. | Fundamentally changes the architecture from library to service. Adds process management, health checks, networking concerns. Out of scope for a wrapper package. Competes with established gateway products (Composio, TrueFoundry, Gravitee). | Stay a library. Users who need a proxy server can wrap MCPack in a thin server process themselves, or use MCPProxy/gateways for that use case. |
| CLI tooling / dashboard / analytics UI | MCPProxy has a system tray app. Gateways have dashboards. Looks polished. | Massive scope increase for marginal value. Server authors want a function call, not a GUI. Analytics can be added later via events/hooks without building a UI. | Emit structured events (tool searched, tool loaded, session created) that users can pipe to their own observability stack. Defer UI indefinitely. |
| Multi-server federation / aggregation | MCPProxy federates hundreds of servers. MetaMCP aggregates servers. Users managing many servers want one endpoint. | Federation is a gateway concern, not a wrapper concern. MCPack wraps one server at a time. Adding multi-server routing changes the architecture entirely and puts MCPack in competition with full gateway products. | Document how to use MCPack with gateway products. Each upstream server in a gateway can be individually wrapped with MCPack. Composition over aggregation. |
| Persistent session storage (database) | Long-running agents across process restarts want session continuity. | Adds database dependency, serialization complexity, migration concerns. In-memory sessions are sufficient for v1 -- MCP sessions are per-connection, and connections are ephemeral. | In-memory only for v1. If demand materializes, add pluggable session storage in v1.x with a `SessionStore` interface. |
| Binary encoding / MessagePack | Reduces payload size beyond JSON. Planned for v2.0. | Requires codec negotiation, client support, format compatibility testing. The token reduction from lazy loading dwarfs encoding savings. Premature optimization. | Defer to v2.0 as planned. Focus v1 on the 90%+ reduction from lazy loading alone. |
| Response truncation / output limiting | MCPProxy auto-truncates responses at 20,000 characters. Prevents context overflow from large tool outputs. | Not a discovery concern. MCPack handles which tools get discovered, not what tool outputs look like. Adding output interception changes the pass-through guarantee. | Out of scope. Tool output management is the server's or gateway's responsibility. MCPack's pass-through for `tools/call` should remain clean. |
| Tool poisoning / quarantine system | MCPProxy quarantines new servers. Security is important. | MCPack wraps a server the user already trusts and controls. The threat model is different from a public proxy. Adding quarantine implies MCPack manages server trust, which it does not. | Document that MCPack trusts the wrapped server's tool definitions. Security at the server level is the server author's responsibility. Role-based filtering provides authorization, not trust management. |

## Feature Dependencies

```
[Search Engine (keyword scoring)]
    └──requires──> [Tool Index (auto-built from definitions)]
                       └──requires──> [Keyword Extraction]

[Session Deduplication]
    └──requires──> [Session Registry]
                       └──requires──> [Session ID from MCP initialize]

[Role-Based Filtering]
    └──requires──> [Tool Index]
    └──requires──> [Role Config + Resolution]

[Wrap Mode]
    └──requires──> [Handler Capture (original tools/list, tools/call)]
    └──requires──> [Core Engine (index, search, sessions, roles)]

[Build Mode]
    └──requires──> [Core Engine (index, search, sessions, roles)]
    └──requires──> [Handler Map (tool name -> handler function)]

[Test Harness]
    └──requires──> [Wrap Mode (fully working)]
    └──requires──> [Stripe MCP access]

[Build Mode] ──independent of──> [Wrap Mode]
    (both share Core Engine but neither depends on the other)
```

### Dependency Notes

- **Search Engine requires Tool Index:** Cannot score queries without an indexed set of tool entries with extracted keywords.
- **Session Deduplication requires Session Registry:** The loaded-tool tracking is the session registry's core responsibility. Without it, dedup has no state.
- **Both modes require Core Engine:** The core engine (index builder, search, sessions, roles) is the shared foundation. Modes are thin entry points over it.
- **Test Harness requires Wrap Mode:** The harness wraps Stripe MCP via wrap mode. Build mode is not exercised in the harness.
- **Wrap Mode and Build Mode are independent:** They share the core engine but do not depend on each other. Could ship one without the other.

## MVP Definition

### Launch With (v1)

Minimum viable product -- what's needed to validate the concept.

- [x] **search_tools meta-tool** -- The single tool exposed on `tools/list`. Without this, there is no product.
- [x] **Keyword-based search with scoring** -- Name match > description match > keyword match. Sufficient for v1 tool counts.
- [x] **Auto-built tool index** -- Zero-config indexing from tool definitions. No manual annotation.
- [x] **Wrap mode (`mcpack(server, config)`)** -- Core adoption path for integrators wrapping existing servers.
- [x] **Build mode (`createMCPackServer(config)`)** -- Core adoption path for new server authors.
- [x] **Session-aware deduplication** -- The key differentiator. Schemas loaded once per session, `loaded: true` flag on repeats.
- [x] **Role-based filtering** -- Tool visibility scoped by caller role. Important for enterprise/multi-tenant use.
- [x] **Pass-through for all non-discovery calls** -- Non-negotiable. Breaking tool execution = dead product.
- [x] **Integration test harness with Stripe MCP** -- Proves real-world value with published numbers.

### Add After Validation (v1.x)

Features to add once core is working.

- [ ] **Semantic search (v1.1)** -- Optional embedding-based search for improved query matching. Requires pluggable embedding provider. Add when users report keyword search quality issues on large tool surfaces (100+ tools).
- [ ] **`listChanged` notification support (v1.1)** -- Re-index when the underlying server's tools change dynamically. The MCP spec supports `notifications/tools/list_changed`. Important for servers with dynamic tool sets.
- [ ] **Tool usage analytics / events (v1.1)** -- Emit structured events (tool searched, tool loaded, session created/expired). Let users pipe to observability. Precursor to any future dashboard.
- [ ] **Pluggable session storage interface (v1.x)** -- `SessionStore` interface for persistent sessions (Redis, SQLite). Add only if demand materializes from long-running agent deployments.
- [ ] **Progressive/hierarchical search mode (v1.x)** -- Speakeasy-style `list_tools` / `describe_tools` / `execute_tool` pattern for systematic tool browsing. Useful for very large tool surfaces (200+ tools). Add when MCPack targets servers beyond the 50-100 tool range.

### Future Consideration (v2+)

Features to defer until product-market fit is established.

- [ ] **Binary encoding layer (MessagePack + zstd)** -- Payload compression for high-throughput deployments. Requires codec negotiation. Defer until lazy loading alone is proven insufficient.
- [ ] **Handshake-negotiated encoding capability** -- Client-server capability negotiation for encoding format. Requires protocol extension. Far future.
- [ ] **Encryption as optional capability tier** -- End-to-end encryption for sensitive tool payloads. Enterprise feature, complex implementation.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| search_tools meta-tool | HIGH | LOW | P1 |
| Keyword-based search | HIGH | MEDIUM | P1 |
| Auto-built tool index | HIGH | LOW | P1 |
| Wrap mode | HIGH | MEDIUM | P1 |
| Pass-through for tools/call | HIGH | LOW | P1 |
| Session deduplication | HIGH | MEDIUM | P1 |
| Build mode | MEDIUM | MEDIUM | P1 |
| Role-based filtering | MEDIUM | MEDIUM | P1 |
| Exported TypeScript types | MEDIUM | LOW | P1 |
| Integration test harness | MEDIUM | MEDIUM | P1 |
| Semantic search | MEDIUM | HIGH | P2 |
| listChanged support | MEDIUM | LOW | P2 |
| Tool usage events | LOW | LOW | P2 |
| Pluggable session storage | LOW | MEDIUM | P3 |
| Progressive/hierarchical search | LOW | HIGH | P3 |
| Binary encoding | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | MCPProxy (Go desktop app) | Lazy MCP (Go binary) | Speakeasy Dynamic Toolsets | Claude Code Tool Search | MCPack (our approach) |
|---------|---------------------------|----------------------|----------------------------|-------------------------|----------------------|
| **Discovery approach** | Single `retrieve_tools` with BM25 search | `get_tools_in_category` + `execute_tool` hierarchy | Progressive (3 meta-tools) or Semantic (2 meta-tools) | Client-side threshold detection, builds search index | Single `search_tools` with keyword scoring |
| **Search algorithm** | BM25 full-text search | Category path navigation (no search) | BM25 or embeddings | Undocumented (client-internal) | Keyword scoring (name > desc > keywords) |
| **Session dedup** | No -- re-returns full schemas | No | No | Yes (client-side, implicit) | Yes -- `loaded: true` flag, schema omitted |
| **Role-based filtering** | No (has quarantine for security) | No | No | No | Yes -- hierarchical role config |
| **Architecture** | Standalone desktop app with system tray | Standalone Go binary (proxy process) | SDK integration (TypeScript) | Built into Claude Code client | In-process library (TypeScript) |
| **Multi-server** | Yes -- federates hundreds of servers | Yes -- aggregates via hierarchy config | No -- per-server | N/A (client-side) | No -- wraps one server |
| **Token reduction claim** | ~99% with 43% accuracy improvement | 95% context reduction | 96-160x reduction | 85% (77K to 8.7K) | 90%+ target (validated via harness) |
| **Dependencies** | Go binary, OS-native secrets | Go binary, JSON config files | Embedding model (semantic mode) | None (built into client) | Zero beyond MCP SDK |
| **Language** | Go | Go | TypeScript | TypeScript (client) | TypeScript |
| **Config complexity** | Server list + quarantine approval | JSON hierarchy files (hand-built or generated) | SDK config + optional embedding setup | Automatic (threshold-based) | `mcpack(server, config)` -- one function call |

### Competitive Positioning

MCPack occupies a unique niche: **in-process TypeScript library with session deduplication and role-based filtering**. The key differentiators vs each competitor:

- **vs MCPProxy:** MCPack is a library, not a desktop app. No sidecar process. Session dedup. Role filtering. TypeScript-native for the MCP ecosystem.
- **vs Lazy MCP:** MCPack has actual search (not just category browsing). TypeScript, not Go. No manual hierarchy config files. Auto-indexing.
- **vs Speakeasy:** MCPack is open source and standalone. No vendor dependency. Session dedup (unique). Wrap mode works with any existing server without SDK integration.
- **vs Claude Code Tool Search:** MCPack works server-side (any client benefits). Claude Code's approach is client-specific and only helps Claude Code users. MCPack is client-agnostic.

## Sources

- [MCPProxy (smart-mcp-proxy)](https://github.com/smart-mcp-proxy/mcpproxy-go) -- Go-based desktop proxy with BM25 search and quarantine
- [Lazy MCP (voicetreelab)](https://github.com/voicetreelab/lazy-mcp) -- Go-based hierarchical tool routing proxy
- [Speakeasy Dynamic Toolsets](https://www.speakeasy.com/blog/100x-token-reduction-dynamic-toolsets) -- Progressive and semantic search approaches
- [Speakeasy v2 Token Reduction](https://www.speakeasy.com/blog/how-we-reduced-token-usage-by-100x-dynamic-toolsets-v2) -- 100x token reduction benchmarks
- [Claude Code Tool Search](https://venturebeat.com/orchestration/claude-code-just-got-updated-with-one-of-the-most-requested-user-features/) -- Client-side lazy loading in Claude Code 2.1.7
- [MCP Proxy Pattern (DEV Community)](https://dev.to/algis/mcp-proxy-pattern-secure-retrieval-first-tool-routing-for-agents-247c) -- Retrieval-first tool routing architecture
- [MetaMCP](https://github.com/metatool-ai/metamcp) -- MCP aggregator/gateway
- [MCP listChanged notification](https://github.com/orgs/modelcontextprotocol/discussions/76) -- Dynamic tool update specification
- [MCP 2026 Roadmap](https://modelcontextprotocol.io/development/roadmap) -- Official roadmap priorities
- [MCP Token Bloat SEP-1576](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1576) -- Protocol-level discussion on schema redundancy

---
*Feature research for: MCP lazy tool discovery wrapper*
*Researched: 2026-03-19*
