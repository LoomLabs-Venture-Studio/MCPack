# Milestones

## v1.0 MCPack (Shipped: 2026-03-23)

**Phases completed:** 7 phases, 10 plans, 21 tasks

**Key accomplishments:**

- ESM TypeScript scaffold with zero runtime deps, all shared types, and index-builder module converting MCP Tool definitions into keyword-searchable ToolIndexEntry arrays
- Search engine with 5-tier weighted keyword scoring, session registry with dual TTL cleanup and sliding expiry, and role filter with hierarchical inheritance and cycle protection
- MCPackEngine class composing index-builder, search, session, and roles into single integration point with session-gated schema delivery
- mcpack() wraps MCP Server with handler interception -- tools/list returns search_tools only, tools/call routes search to engine and proxies all other calls with role checking
- MCPackHandlerContext/MCPackServer types, markToolLoaded method, and 6 correctness fixes to wrap mode
- createMCPackServer() with dispatch map routing, result normalization, and full package exports
- V8 coverage config added to vitest, edge case audit brought test count from 91 to 100 with 99.56% statement coverage
- Stripe MCP integration harness connecting to real Stripe MCP server, running 5 queries through MCPack index/search, producing JSON report with per-query and aggregate token reduction metrics
- README with wrap/build mode TypeScript examples and real Stripe MCP token reduction numbers (80.7% aggregate)
- MkDocs Material docs site with GitHub Actions auto-deploy from README.md as single source of truth

---
