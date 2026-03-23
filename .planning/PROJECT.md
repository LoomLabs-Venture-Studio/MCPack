# MCPack

## What This Is

MCPack is an npm package (`@llvs/mcpack`) that provides lazy, queryable, session-aware tool discovery for MCP servers. Instead of dumping every tool schema on connect (which can cost thousands of tokens), MCPack exposes a single `search_tools` tool that returns only the schemas an agent actually needs, when it needs them. It supports two modes: wrapping an existing MCP server, or building a new server from scratch with tools and handlers passed explicitly.

## Core Value

Agents discover only the tool schemas they need, when they need them — reducing token waste from bulk tool discovery by 80%+ on servers with large tool surfaces.

## Current State

**v1.0 shipped** — published as `@llvs/mcpack@1.0.0` on npm (2026-03-23)

- 946 LOC TypeScript, 1,846 LOC tests
- 100 tests, 99.56% statement coverage
- 80.7% token reduction proven on Stripe MCP (28 tools)
- Docs site: loomlabs-venture-studio.github.io/MCPack/
- Two entry points: `mcpack()` (wrap) and `createMCPackServer()` (build)

## Requirements

### Validated

- ✓ Keyword-based search with 5-tier weighted scoring — v1.0
- ✓ Session tracking with sliding TTL and dual cleanup — v1.0
- ✓ Role-based filtering with wildcard support — v1.0
- ✓ TypeScript with exported types, zero runtime deps — v1.0
- ✓ `mcpack(server, config)` wraps any existing MCP server — v1.0
- ✓ `tools/list` returns exactly one tool: `search_tools` — v1.0
- ✓ `search_tools` returns matching schemas ranked by relevance — v1.0
- ✓ Session-aware: loaded schemas returned as references — v1.0
- ✓ Role-based: tools outside caller's role are invisible — v1.0
- ✓ Wrap mode passes non-discovery calls through unchanged — v1.0
- ✓ `createMCPackServer(config)` builds server with lazy discovery — v1.0
- ✓ Build mode routes calls to correct handler — v1.0
- ✓ Unit tests for all modules (99.56% coverage) — v1.0
- ✓ Stripe MCP integration harness with token reduction report — v1.0
- ✓ README with usage examples and token reduction numbers — v1.0
- ✓ Spec committed and referenced — v1.0
- ✓ Published as `@llvs/mcpack@1.0.0` on npm — v1.0

### Active

(Awaiting v1.1 specs)

### Out of Scope

- Semantic/embedding-based search — planned for v1.1
- Binary encoding or MessagePack — planned for v2.0
- Persistent session storage — in-memory only
- Standalone proxy server process — MCPack is a library
- CLI tooling, dashboard, or analytics UI

## Context

- Published as `@llvs/mcpack` on npm under the LoomLabs Venture Studio org
- Docs site deployed via GitHub Pages with MkDocs Material + LoomLabs branding
- The MCP SDK's `Server` class uses `setRequestHandler()` — MCPack replaces these handlers to intercept discovery
- Primary users: MCP server authors (build mode) and MCP integrators (wrap mode)
- Monetization potential identified — public-facing assets optimized for visual impact

## Constraints

- **Tech stack**: TypeScript, ESM modules, `@modelcontextprotocol/sdk` as sole peer dependency
- **Testing**: Vitest for unit/integration tests, real Stripe MCP for integration harness
- **Compatibility**: Must work with any MCP server without requiring server modifications
- **Package**: No runtime dependencies beyond the MCP SDK peer dep

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Handler replacement over proxy pattern | Simpler architecture, no extra server layer | ✓ Good — clean implementation |
| Two modes: wrap + build | Serves both server authors and integrators | ✓ Good — both modes share engine |
| Keyword search only for v1 | Avoids embedding dependencies, keeps lightweight | ✓ Good — 80.7% reduction without embeddings |
| Real Stripe MCP for test harness | Community-recognized server, proves real-world value | ✓ Good — credible numbers |
| In-memory sessions only | Simplicity for v1 | ✓ Good — no complaints |
| @llvs/mcpack scoped package | mcpack taken on npm (Minecraft datapacks) | ✓ Good — professional org scope |

---
*Last updated: 2026-03-23 after v1.0 milestone completion*
