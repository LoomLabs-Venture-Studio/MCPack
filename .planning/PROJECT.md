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

**v1.1 in flight** — Search & Observability milestone, PRD ingested 2026-04-25 (`.planning/inbox/mcpack-prd-v1.1-gsd.md`). 22 requirements / 5 phases. Adds optional `EmbeddingProvider` hook, `@llvs/mcpack-embeddings` adapter package, hybrid semantic+keyword ranking, and `getAnalytics()` server-handle API. Public API stays byte-identical to v1.0; core stays zero-dep.

**v1.2 queued (DEFERRED)** — Partner Hub milestone, PRD ingested 2026-04-25 (`.planning/inbox/mcpack-prd-v1.1-final.md`, version-rewritten 1.1.0 → 1.2.0 by board). 16 requirements / 5 phases. Adds multi-source composition, provider-agnostic `resolveRole(session)` hook, HTTP/SSE transport, and `@llvs/mcpack-google` resolver package. Will not open until v1.1 ships and a v1.2 search-engine-direction ADR is accepted.

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

**v1.1 — Search & Observability** (in flight, planning post-ingest):

- Optional `EmbeddingProvider` hook on `MCPackConfig`; v1.0 keyword-only behavior preserved when absent
- Sibling adapter package `@llvs/mcpack-embeddings` shipping with a local MiniLM adapter
- Hybrid ranking pipeline (default 0.7 semantic / 0.3 keyword); v1.0 5-tier scorer remains as the keyword leg
- Async, non-blocking semantic index build at startup; `tools/list` adds zero v1.1 latency
- Tool usage analytics: in-memory `AnalyticsStore` for `search` / `call` / `denial` / `miss` events
- `getAnalytics(options?)` on the server handle (never exposed as an MCP tool); role-scoped queries; dead-tool detection
- Coverage floor lifted to ≥120 tests at ≥99% statement coverage
- Stripe harness ≥80.7% token reduction with hybrid ranking; 50-query intent benchmark ≥15% recall over v1.0

See `REQUIREMENTS.md` (`## v1.1 Requirements` and `## Success Criteria — v1.1`) and `ROADMAP.md` (v1.1 phases 1-5) for the full scope.

### Out of Scope

- Binary encoding or MessagePack — planned for v2.0
- Persistent session storage — in-memory through v1.2; v2.0 candidate
- Standalone proxy server process — MCPack is a library
- CLI tooling, dashboard, or analytics UI
- OTEL exporter / file export / webhook for analytics — deferred from v1.1 to v1.2 candidate set
- Default embedding model inside `@llvs/mcpack` core — never (adapter pattern, DEC-BOARD-05)
- CommonJS build output — never (ESM-only)

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
- **Adapter packages**: All model and auth dependencies live in sibling packages (`@llvs/mcpack-embeddings` v1.1, `@llvs/mcpack-google` v1.2). Never in core.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Handler replacement over proxy pattern | Simpler architecture, no extra server layer | ✓ Good — clean implementation |
| Two modes: wrap + build | Serves both server authors and integrators | ✓ Good — both modes share engine |
| Keyword search only for v1 | Avoids embedding dependencies, keeps lightweight | ✓ Good — 80.7% reduction without embeddings |
| Real Stripe MCP for test harness | Community-recognized server, proves real-world value | ✓ Good — credible numbers |
| In-memory sessions only | Simplicity for v1 | ✓ Good — no complaints |
| @llvs/mcpack scoped package | mcpack taken on npm (Minecraft datapacks) | ✓ Good — professional org scope |
| DEC-BOARD-01: v1.1 milestone slot = Search & Observability PRD (`mcpack-prd-v1.1-gsd.md`) | Two PRDs claimed v1.1; the search/analytics PRD aligns with the milestone slot and has the smaller blast radius | Pending — v1.1 in flight |
| DEC-BOARD-02: v1.2 milestone slot = Partner Hub PRD (`mcpack-prd-v1.1-final.md`), version override 1.1.0 → 1.2.0 | Partner Hub introduces multi-source + transport changes — sequenced after the v1.1 search overlay; version rewritten everywhere in the PRD | Pending — DEFERRED until v1.1 ships |
| DEC-BOARD-03: Semantic search ships in v1.1, not v1.2 | Closes the keyword-recall ceiling earliest; isolates the model dep behind an adapter package | Pending — v1.1 Phase 1-3 |
| DEC-BOARD-04: `@llvs/mcpack` core stays zero-dep through v1.1 and v1.2 | Non-negotiable v1.0 invariant; protects upgrade path and install footprint | Locked through v1.2 |
| DEC-BOARD-05: Adapter package pattern is the v1.1+ contract (model deps in `@llvs/mcpack-embeddings`, auth deps in `@llvs/mcpack-google`) | Keeps core lean; lets each provider package version independently | Locked — applies to all sibling packages |

---
*Last updated: 2026-04-25 after v1.1 PRD ingest*
