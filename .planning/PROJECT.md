# MCPack

## What This Is

MCPack is an npm package that provides lazy, queryable, session-aware tool discovery for MCP servers. Instead of dumping every tool schema on connect (which can cost thousands of tokens), MCPack exposes a single `search_tools` tool that returns only the schemas an agent actually needs, when it needs them. It supports two modes: wrapping an existing MCP server, or building a new server from scratch with tools and handlers passed explicitly.

## Core Value

Agents discover only the tool schemas they need, when they need them — reducing token waste from bulk tool discovery by 90%+ on servers with large tool surfaces.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] `mcpack(server, config)` wraps any existing MCP server with lazy discovery
- [ ] `createMCPackServer(config)` builds a new MCP server with tools, handlers, and lazy discovery baked in
- [ ] `tools/list` on any MCPack server returns exactly one tool: `search_tools`
- [ ] `search_tools` accepts a natural language query and returns matching tool schemas ranked by relevance
- [ ] Session tracking: schemas loaded once per session are returned as `loaded: true` with no schema on subsequent calls
- [ ] Role-based filtering: tools outside the caller's role are invisible in search results
- [ ] Wrap mode passes all non-discovery `tools/call` requests through to the underlying server unchanged
- [ ] Build mode routes `tools/call` requests to the correct registered handler
- [ ] Keyword-based search with scoring (name match > description match > keyword match)
- [ ] Integration test harness runs against real Stripe MCP and produces a token reduction comparison report
- [ ] README documents both usage modes with examples and token reduction numbers
- [ ] Published as TypeScript with exported types, no runtime deps beyond `@modelcontextprotocol/sdk`

### Out of Scope

- Semantic/embedding-based search — keyword only for v1, semantic planned for v1.1
- Binary encoding or MessagePack — planned for v2.0
- Persistent session storage — in-memory only, no database
- Standalone proxy server process — MCPack is a library, not a daemon
- CLI tooling, dashboard, or analytics UI
- Any changes to MCP client behavior
- npm publish or GitHub repo creation — build only, publishing is separate

## Context

- The MCP protocol requires `tools/list` on connect, returning all tool definitions upfront. On a server with 40+ tools (e.g., Stripe MCP), this can cost 8,000+ tokens before a single tool is called.
- No existing solution addresses this at the wrapper layer. Current approaches require rewriting the server or modifying the client.
- The MCP SDK's `Server` class uses `setRequestHandler()` for registering handlers. MCPack replaces these handlers to intercept discovery while preserving pass-through for actual tool calls.
- Primary users are both MCP server authors (adding lazy discovery to their servers) and MCP integrators (wrapping existing third-party servers without modification).
- PRD with full technical specification available at `mcpack-prd-v1.md` in repo root.
- Protocol spec available at `mcpack-spec-v1.md` in repo root.

## Constraints

- **Tech stack**: TypeScript, ESM modules, `@modelcontextprotocol/sdk` as sole peer dependency
- **Testing**: Vitest for unit/integration tests, real Stripe MCP for integration harness
- **Compatibility**: Must work with any MCP server without requiring server modifications
- **Package**: No runtime dependencies beyond the MCP SDK peer dep

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Handler replacement over proxy pattern | Simpler architecture, no extra server layer, works with MCP SDK's `setRequestHandler` | — Pending |
| Two modes: wrap + build | Serves both server authors (build mode) and integrators (wrap mode) equally | — Pending |
| Keyword search only for v1 | Avoids embedding dependencies, keeps package lightweight, semantic search planned for v1.1 | — Pending |
| Real Stripe MCP for test harness | Community-recognized server with large tool surface, proves real-world value | — Pending |
| In-memory sessions only | Simplicity for v1, persistent storage adds complexity without clear v1 need | — Pending |

---
*Last updated: 2026-03-19 after initialization*
