# Project Research Summary

**Project:** MCPack
**Domain:** MCP server wrapper / lazy tool discovery middleware (npm package)
**Researched:** 2026-03-19
**Confidence:** HIGH

## Executive Summary

MCPack is an in-process TypeScript library that wraps MCP servers to replace bulk tool listings with a single `search_tools` meta-tool, reducing token consumption by 90%+ through lazy, on-demand schema delivery. The established pattern in this space (MCPProxy, Lazy MCP, Speakeasy) is to intercept `tools/list` and return one or a few meta-tools instead of the full catalog, then serve complete schemas only when an agent searches for them. MCPack follows this pattern but differentiates through session-aware schema deduplication (schemas delivered at most once per session) and role-based tool filtering -- neither of which any competitor offers at the wrapper level. The library-not-daemon architecture is also unique: competitors are standalone binaries or desktop apps, while MCPack runs in-process with zero runtime dependencies beyond the MCP SDK peer dep.

The recommended approach is to build on the MCP SDK v1.27.x `Server` class (not `McpServer`), using `setRequestHandler()` to intercept `tools/list` and `tools/call`. The core engine -- keyword index, search scoring, session registry, role filter -- is shared between two entry points: wrap mode (`mcpack(server, config)`) for existing servers and build mode (`createMCPackServer(config)`) for new servers. TypeScript 5.8, ESM-only output via `tsc`, and vitest for testing. The stack is deliberately minimal: no bundler, no runtime deps, no build complexity.

The primary risk is that MCP clients may block `tools/call` for tools not returned by `tools/list`. If Claude Desktop, Cursor, or other clients validate tool names against the cached `tools/list` response, MCPack's entire premise breaks. This must be validated in Phase 1 before any other work proceeds. The fallback is a `listChanged` notification architecture that dynamically adds discovered tools to `tools/list`. The secondary risk is capturing original handlers from the MCP SDK `Server` class, which has no public `getRequestHandler()` API. Both risks are well-understood and have concrete mitigation strategies, but they require early validation spikes.

## Key Findings

### Recommended Stack

The stack is intentionally minimal for a zero-dependency library targeting Node.js ESM. TypeScript 5.8 compiles via `tsc` to ES2022 with `NodeNext` module resolution, producing `.d.ts` files for consumers. The MCP SDK v1.27.x is a peer dependency only -- never bundled. Vitest 4.1 handles testing with native ESM/TypeScript support.

**Core technologies:**
- **TypeScript 5.8.x**: Language and type generation -- stable GA, proven with MCP SDK
- **Node.js >=18 (target 22 LTS)**: Runtime -- floor at 18 for `globalThis.crypto` (MCP SDK requirement), develop against 22 LTS
- **`@modelcontextprotocol/sdk` ^1.27.x (peer dep)**: MCP protocol primitives -- use `Server` class directly for `setRequestHandler()` access
- **`tsc` for build**: No bundler needed -- ESM-only library with declaration output
- **Vitest 4.1**: Testing -- native ESM, fast, PRD-mandated

**Critical version note:** Do NOT target MCP SDK v2 (pre-alpha). Build on v1.27.x. Plan a separate MCPack v2 release after SDK v2 stabilizes.

### Expected Features

**Must have (table stakes):**
- Single `search_tools` meta-tool on `tools/list` -- the defining pattern of the category
- Keyword-based search with scoring (name > description > keywords)
- Auto-built tool index from definitions (zero-config)
- Wrap mode for existing servers (`mcpack(server, config)`)
- Build mode for new servers (`createMCPackServer(config)`)
- Full schema return on match with configurable result limit
- Pass-through for all non-discovery `tools/call` requests
- Zero runtime dependencies, exported TypeScript types

**Should have (differentiators):**
- Session-aware schema deduplication -- MCPack's strongest unique feature vs all competitors
- Role-based tool filtering -- hierarchical roles with inheritance
- Dual mode (wrap + build) -- doubles the addressable audience
- Token reduction proof via Stripe MCP test harness

**Defer (v2+):**
- Semantic/embedding-based search (v1.1 with optional peer dep)
- `listChanged` notification support (v1.1, unless needed for Pitfall 1 fallback)
- Binary encoding / MessagePack (v2.0)
- Pluggable session storage (v1.x if demand materializes)
- Multi-server federation (out of scope -- gateway concern)

### Architecture Approach

MCPack is a flat ~10-module TypeScript package. Both entry points (wrap and build) share a core engine that wires together four independent leaf modules: tool index builder, keyword search, session registry, and role filter. The core engine is a factory function, not a class. Entry points are thin shells that set up MCP Server handlers and delegate to core. The tool index is built once at startup and is immutable. Sessions are tracked in-memory with TTL-based expiry.

**Major components:**
1. **Core Engine (`core.ts`)** -- wires index, sessions, roles, and search together; shared between both modes
2. **Tool Index (`index-builder.ts`)** -- builds keyword-searchable index from tool definitions at startup
3. **Search Engine (`search.ts`)** -- scores and ranks index entries against natural language queries
4. **Session Registry (`session.ts`)** -- tracks per-session loaded tools, enforces TTL, deduplicates schema delivery
5. **Role Filter (`roles.ts`)** -- resolves hierarchical role permissions, filters tool visibility
6. **Wrapper (`wrapper.ts`)** -- wrap mode handler interception via `setRequestHandler()`
7. **Server Builder (`server-builder.ts`)** -- build mode fresh server creation with handler map routing

### Critical Pitfalls

1. **Clients may block `tools/call` for undiscovered tools** -- MCP clients may validate tool names against the cached `tools/list`. If so, MCPack's entire pattern breaks. Validate with real clients in Phase 1. Fallback: `listChanged` notification architecture.
2. **No public API to capture original handlers** -- The SDK has no `getRequestHandler()`. Must access `_requestHandlers` private Map or snapshot tool data before replacing handlers. Spike this in Phase 1.
3. **McpServer vs Server confusion** -- Users will try to wrap `McpServer` instances. Add runtime type detection; accept only `Server`. Document the `mcpServer.server` escape hatch.
4. **Session ID is transport-dependent** -- stdio has no session concept; HTTP uses `Mcp-Session-Id` header. Generate synthetic IDs for stdio; extract from context for HTTP. Make resolution pluggable.
5. **setInterval leak in SessionRegistry** -- Must call `.unref()` on the cleanup timer and provide a `destroy()` method. One-line fix but causes confusing test hangs if missed.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Foundation and Risk Validation
**Rationale:** The two critical risks (client tool validation and handler capture) must be validated before investing in any other feature. This phase builds the leaf modules that have no internal dependencies and proves the wrap pattern works end-to-end.
**Delivers:** types.ts, index-builder, search engine, session registry, role filter, plus a working wrap-mode prototype that proves `tools/call` pass-through works with at least one real MCP client.
**Addresses:** Table stakes (tool index, keyword search, session tracking, role filtering as modules). Validates the core architectural bet.
**Avoids:** Pitfall 1 (client blocks tools/call), Pitfall 2 (handler capture), Pitfall 3 (McpServer confusion), Pitfall 4 (session ID), Pitfall 5 (timer leak).

### Phase 2: Core Engine and Wrap Mode
**Rationale:** With leaf modules proven and the handler capture pattern validated, wire everything together in `core.ts` and complete wrap mode. This is where the `search_tools` meta-tool comes alive.
**Delivers:** core.ts, wrapper.ts, search-tool.ts, complete wrap mode with `mcpack(server, config)` API. Unit tests for all modules.
**Addresses:** `search_tools` meta-tool, wrap mode, pass-through, session deduplication, role-based filtering -- all working together.
**Avoids:** Pitfall 6 (poor search results) -- tune keyword scoring with real tool names from Stripe MCP.

### Phase 3: Build Mode and Public API
**Rationale:** Build mode shares core engine but has a different entry point. With core proven in wrap mode, build mode is a thin layer. This phase also finalizes the public API surface and index.ts exports.
**Delivers:** server-builder.ts, index.ts (public exports), complete TypeScript type exports, package.json configuration for npm publishing.
**Addresses:** Build mode (`createMCPackServer`), exported types, package configuration.

### Phase 4: Integration Testing and Harness
**Rationale:** With both modes working, validate against a real MCP server (Stripe MCP, 47 tools). Produce the token reduction comparison report.
**Delivers:** Integration test harness, vanilla vs MCPack comparison report, published benchmarks.
**Addresses:** Token reduction proof, real-world validation, Stripe MCP harness.

### Phase 5: Polish and Release
**Rationale:** Final pass on documentation, error messages, edge cases, and npm publishing preparation.
**Delivers:** README, CHANGELOG, npm publish-ready package, CI configuration.

### Phase Ordering Rationale

- Phase 1 before everything: the handler capture pattern and client tool validation are existential risks. If either fails, the architecture pivots.
- Phase 2 before Phase 3: wrap mode is the higher-value entry point (integrators with existing servers). Build mode can follow because it shares the core.
- Phase 4 after both modes: integration testing requires a complete product. The Stripe MCP harness specifically exercises wrap mode.
- Leaf modules (index, search, sessions, roles) are built first because they are pure functions with no internal dependencies -- easy to test in isolation, and they de-risk the core wiring.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1:** Needs a focused spike on handler capture (`_requestHandlers` access vs alternative approaches). Also needs client compatibility testing -- research which MCP clients validate `tools/list` before `tools/call`.
- **Phase 2:** Search scoring weights need calibration against real tool sets. The Stripe MCP tool list is the benchmark.

Phases with standard patterns (skip research-phase):
- **Phase 3:** Build mode is straightforward handler-map routing. Well-documented pattern.
- **Phase 4:** Integration testing with MCP Client SDK and `InMemoryTransport` is standard. Stripe MCP harness is a known integration.
- **Phase 5:** Standard npm package publishing workflow.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified against npm/GitHub. MCP SDK v1.27.x API confirmed from source. TypeScript 5.8, Vitest 4.1 are current stable releases. |
| Features | HIGH | Competitor analysis covers all major players (MCPProxy, Lazy MCP, Speakeasy, Claude Code). Feature differentiation is clear. PRD aligns well with research. |
| Architecture | HIGH | MCP SDK source code verified for `setRequestHandler` overwrite behavior, `_requestHandlers` Map, `McpServer` vs `Server` distinction. Handler replacement pattern confirmed. |
| Pitfalls | HIGH | Critical pitfalls verified against MCP specification and SDK source. Client validation behavior (Pitfall 1) is the one area with MEDIUM confidence -- must be validated empirically. |

**Overall confidence:** HIGH

### Gaps to Address

- **Client tool validation behavior:** No definitive documentation on whether Claude Desktop, Cursor, or OpenAI Agents SDK block `tools/call` for tools not in `tools/list`. Must test empirically in Phase 1. This is the biggest unknown.
- **Handler capture mechanism:** The exact approach (private Map access vs tool data snapshot) needs a spike. Both options are viable but have different trade-offs around SDK version coupling.
- **MCP SDK v2 timeline:** SDK v2 is pre-alpha with a slipping Q1 2026 target. The `Server` class is already marked `@deprecated`. Monitor for v2 stable release and plan migration path.
- **Keyword search quality ceiling:** No empirical data on how well simple keyword scoring performs with real agent queries against real tool sets. The Stripe MCP harness in Phase 4 is the validation point, but search tuning may need to happen earlier.

## Sources

### Primary (HIGH confidence)
- [MCP TypeScript SDK - GitHub](https://github.com/modelcontextprotocol/typescript-sdk) -- Server/McpServer class APIs, handler registration, SDK architecture
- [MCP SDK Protocol class source](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/core/src/shared/protocol.ts) -- `setRequestHandler` implementation, `_requestHandlers` Map
- [MCP Tools Specification (2025-06-18)](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) -- official protocol spec for tools/list, tools/call
- [MCP Lifecycle Specification](https://modelcontextprotocol.io/specification/2025-03-26/basic/lifecycle) -- session ID via Mcp-Session-Id header
- [@modelcontextprotocol/sdk on npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk) -- v1.27.1 latest, peer deps
- [TypeScript 5.8 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-8.html)
- [Vitest 4.0 announcement](https://vitest.dev/blog/vitest-4)
- [Node.js releases](https://nodejs.org/en/about/previous-releases) -- Node 22 LTS timeline

### Secondary (MEDIUM confidence)
- [MCPProxy (smart-mcp-proxy)](https://github.com/smart-mcp-proxy/mcpproxy-go) -- competitor analysis, BM25 search pattern
- [Lazy MCP (voicetreelab)](https://github.com/voicetreelab/lazy-mcp) -- competitor analysis, hierarchical tool routing
- [Speakeasy Dynamic Toolsets](https://www.speakeasy.com/blog/100x-token-reduction-dynamic-toolsets) -- progressive/semantic search approaches, token reduction benchmarks
- [Claude Code Tool Search](https://venturebeat.com/orchestration/claude-code-just-got-updated-with-one-of-the-most-requested-user-features/) -- client-side lazy loading pattern
- [NearForm: MCP Tips, Tricks, and Pitfalls](https://nearform.com/digital-community/implementing-model-context-protocol-mcp-tips-tricks-and-pitfalls/) -- session isolation, common mistakes

### Tertiary (LOW confidence)
- [MCP SDK v2 docs](https://ts.sdk.modelcontextprotocol.io/v2/) -- pre-alpha, subject to change
- [MCP 2026 Roadmap](https://thenewstack.io/model-context-protocol-roadmap-2026/) -- directional only

---
*Research completed: 2026-03-19*
*Ready for roadmap: yes*
