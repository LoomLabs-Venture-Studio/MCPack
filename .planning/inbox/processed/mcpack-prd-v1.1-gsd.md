# PRD: MCPack v1.1

## Problem

MCPack v1.0 ships a 5-tier weighted keyword scorer that matches tool schemas against agent queries by token overlap. While this produced an 80.7% aggregate token reduction on the Stripe MCP harness (28 tools, 5 queries), keyword scoring has a fundamental ceiling: it matches on surface form, not meaning. An agent querying "show outstanding invoices" will miss a tool named `list_unpaid_bills` even though the intent is identical. As server tool surfaces grow beyond a handful of well-named tools — especially in enterprise deployments wrapping internal APIs with opaque naming conventions — keyword recall degrades and the agent is forced to make broader, less efficient queries.

v1.0 also has no observability. Once MCPack is deployed, the operator has no way to know which tools are being searched, which are being called, which are being denied by role, or which are never touched at all. Dead tools inflate the index, slow search, and consume schema budget silently. Over-denied tools indicate misconfigured roles that nobody catches until a partner complains. Without analytics, the operator is flying blind.

v1.1 addresses both gaps while preserving every v1.0 design invariant: zero core runtime dependencies, the single `search_tools` entry point, opaque denial semantics, session-aware schema caching, ESM-only output, and a fully locked public API.

## Goals

- Search recall on a held-out benchmark of 50 intent-diverse queries improves by at least 15% over v1.0 keyword baseline when an embedding provider is configured
- Hybrid ranking (semantic + keyword) never regresses below v1.0 keyword-only performance on the existing Stripe MCP harness (floor: 80.7% aggregate token reduction)
- Embedding indexing adds no latency to `tools/list` response — index is built asynchronously at startup before first query
- Embedding query latency adds at most 50ms to `search_tools` response time (p99) on a local MiniLM adapter
- `getAnalytics()` returns accurate per-role search counts, call counts, and denial counts within the current process session
- Analytics never expose the existence of tools outside the querying session's role
- Test count reaches at least 120 with at least 99% statement coverage (up from 100 tests / 99.56%)
- Public API (`mcpack()`, `createMCPackServer()` signatures) is byte-for-byte identical to v1.0 — zero breaking changes
- `@llvs/mcpack` core package adds zero new runtime dependencies

## Non-Goals

- Binary encoding or MessagePack layer (v2.0)
- Persistent session storage — v1.1 stays fully in-memory (v2.0)
- Standalone proxy server process — MCPack remains a library (v2.0)
- OTEL exporter or structured log output for analytics (v1.2)
- File export of analytics data (v1.2)
- Webhook or callback hook for analytics events (v1.2)
- Multi-source / multi-MCP gateway mode (tracked separately in multi-source PRD)
- Google OAuth or any auth resolver (tracked separately in partner hub PRD)
- HTTP/SSE transport (tracked separately in partner hub PRD)
- Shipping a default embedding model inside `@llvs/mcpack` core
- CommonJS build output
- Analytics persistence across process restarts

## Users & Use Cases

**MCP server authors (build mode — `createMCPackServer`)**
These developers are building new MCP servers from scratch with MCPack baked in. They benefit from semantic search because their tool descriptions may not be perfectly keyword-optimized. Analytics tell them which tools are dead weight in the index and which roles are hitting denials — actionable feedback for refining their tool surface before production.

**MCP integrators (wrap mode — `mcpack`)**
These developers are retrofitting MCPack onto an existing MCP server they do not control — a third-party server like Stripe MCP, a vendor-provided server, or an internal server with opaque naming. Semantic search is especially valuable here because tool names and descriptions were written for developers, not agents. Analytics surface which wrapped tools are actually being used, justifying the wrapping investment.

**Agent developers consuming MCPack-wrapped servers**
These developers write agents that query MCPack via `search_tools`. They benefit indirectly — semantic search means their natural-language queries find the right tools without requiring exact keyword matches. They do not interact with analytics directly.

**MCPack operators (deployers)**
Operators run the MCPack-wrapped server in production. `getAnalytics()` gives them a runtime view of tool usage without external tooling. They identify misconfigured roles, dead tools, and usage hotspots from within the same process.

## Requirements

### R1: Semantic Search

**R1.1 — EmbeddingProvider interface**
MCPack core defines a single `EmbeddingProvider` type:
```
type EmbeddingProvider = (texts: string[]) => Promise<number[][]>
```
It accepts a batch of strings and returns a parallel array of embedding vectors. The interface is intentionally minimal — any embedding source (local model, API, custom function) can be adapted to it. MCPack core ships no implementation.

**R1.2 — Optional configuration**
`EmbeddingProvider` is passed via an optional `embeddings` field on `MCPackConfig`. If absent, v1.0 keyword-only behavior is preserved exactly with no performance penalty. The zero-dep constraint is maintained for the core package regardless of whether embeddings are configured.

**R1.3 — Separate adapter package**
A separate package `@llvs/mcpack-embeddings` ships a local MiniLM adapter using `@xenova/transformers` as an optional peer dependency. This package is not part of `@llvs/mcpack` core and is never a required dependency. Operators who want local embedding without an API key install this package separately.

**R1.4 — Index build pipeline**
When an `EmbeddingProvider` is configured, MCPack builds a semantic index at startup:
- Concatenate each tool's name, description, and parameter names into a single indexing string per tool
- Pass all indexing strings to `EmbeddingProvider` as a single batch call
- Store resulting vectors in-memory, keyed by tool name
- Index build happens asynchronously before the first `search_tools` query is accepted
- `tools/list` response is not delayed — if index is not yet ready, fall back to keyword scoring for that query

**R1.5 — Query path**
On each `search_tools` call:
- Embed the query string via `EmbeddingProvider` (single-item batch)
- Compute cosine similarity between query vector and each tool vector
- Produce a semantic score per tool

**R1.6 — Hybrid ranking**
Final tool ranking combines semantic score and v1.0 keyword score:
- `finalScore = (semanticWeight * semanticScore) + (keywordWeight * keywordScore)`
- Default weights: `semanticWeight: 0.7`, `keywordWeight: 0.3`
- Both weights are configurable via `MCPackConfig.embeddings.weights`
- If no `EmbeddingProvider` is configured, `keywordWeight` is implicitly 1.0 — exact v1.0 behavior

**R1.7 — Role filtering**
Role filtering is applied after ranking, not before. The full tool surface is scored, then results are filtered to the session role's permitted tools before returning. This preserves the opaque denial invariant — restricted tools are never visible in results regardless of their score.

**R1.8 — Performance budget**
- Index build: completes within 5 seconds for a 50-tool server using the local MiniLM adapter on commodity hardware
- Query embedding: adds at most 50ms p99 to `search_tools` response time using local MiniLM
- Memory: semantic index adds at most 2MB for a 50-tool server (384-dim MiniLM vectors at float32)

**R1.9 — Backward compatibility**
When no `EmbeddingProvider` is configured, the search path is identical to v1.0 at the code level. No performance regression. No behavior change. Existing MCPack deployments require zero config changes to upgrade to v1.1.

### R2: Tool Usage Analytics

**R2.1 — Captured events**
MCPack captures four event types per session:
- `search` — a `search_tools` call was made (query string, role, tools returned, timestamp)
- `call` — a `tools/call` was made (tool name, role, timestamp)
- `denial` — a `tools/call` was denied due to role (tool name, role, timestamp)
- `miss` — a `search_tools` call returned zero results (query string, role, timestamp)

**R2.2 — Storage**
All analytics data is stored in-memory within the MCPack server instance. No data is written to disk, sent over the network, or exposed outside the process. Analytics reset on process restart.

**R2.3 — Privacy constraint**
Analytics data for a given role must never expose the existence of tools outside that role. Denial events record only that a call was denied — they do not record the tool name in any externally queryable way that would reveal the tool exists to an observer who only has read access to role-scoped analytics. Internally, denial events record the tool name for operator use only.

**R2.4 — Public API**
A `getAnalytics(options?)` method is added to the server handle returned by both `mcpack()` and `createMCPackServer()`. It returns:
```typescript
interface AnalyticsSnapshot {
  searches:  { query: string; role: string; resultCount: number; timestamp: number }[]
  calls:     { tool: string; role: string; timestamp: number }[]
  denials:   { tool: string; role: string; timestamp: number }[]
  misses:    { query: string; role: string; timestamp: number }[]
  summary: {
    byRole: Record<string, {
      searchCount: number
      callCount: number
      denialCount: number
      missCount: number
      topTools: string[]         // top 5 called tools for this role
      deadTools: string[]        // tools never called in this session
    }>
  }
}
```

**R2.5 — Role-scoped query**
`getAnalytics({ role: 'cofounder' })` returns only events for that role. `getAnalytics()` with no argument returns all events (operator view).

**R2.6 — RBAC integrity**
The `getAnalytics()` method is on the server handle, not exposed as an MCP tool. It is not callable by agents connecting through MCPack. It is only accessible to the process that instantiated MCPack — the operator.

**R2.7 — Dead tool detection**
`summary.byRole[role].deadTools` lists tools that have zero `call` events for that role in the current session. This list is scoped to tools the role can actually see — it does not leak restricted tool names.

### R3: Cross-cutting

**R3.1 — Zero core dependencies**
`@llvs/mcpack` adds no new runtime dependencies in v1.1. `@xenova/transformers` and any other model dependencies live exclusively in `@llvs/mcpack-embeddings`. `google-auth-library` and any auth dependencies live in resolver packages. Core peer dependency remains `@modelcontextprotocol/sdk` only.

**R3.2 — Public API lock**
`mcpack(server, config)` and `createMCPackServer(config)` signatures are unchanged. `MCPackConfig` gains two new optional fields (`embeddings` and `analytics`) — both optional, both backward compatible. No existing config breaks.

**R3.3 — ESM-only**
v1.1 remains ESM-only, NodeNext module resolution, TypeScript strict + verbatimModuleSyntax. No CommonJS output.

**R3.4 — Test coverage**
v1.1 ships at least 120 tests with at least 99% statement coverage. New tests cover: embedding provider interface, hybrid ranking, semantic index build, query path, analytics event capture, analytics API, role-scoped analytics, dead tool detection, RBAC integrity of analytics.

**R3.5 — No latency regression on tools/list**
`tools/list` always returns exactly one tool (`search_tools`) with no latency added by v1.1 features. Index build is async and non-blocking.

**R3.6 — Session invariants preserved**
Schemas loaded once per session still return as `{loaded: true}` references. Out-of-role `tools/call` still returns `"Unknown tool: {name}"`. No v1.0 invariant is modified.

## Success Criteria

- Test count is at least 120 with at least 99% statement coverage
- Stripe MCP harness shows at least 80.7% aggregate token reduction with hybrid ranking enabled (no regression vs v1.0)
- Semantic search recall improves at least 15% on the held-out 50-query intent benchmark vs v1.0 keyword baseline when MiniLM adapter is configured
- `search_tools` p99 latency with local MiniLM adapter is at most 50ms above v1.0 baseline on commodity hardware
- Semantic index build completes within 5 seconds for a 50-tool server using local MiniLM adapter
- `mcpack()` and `createMCPackServer()` signatures are byte-for-byte identical to v1.0
- `@llvs/mcpack` package.json lists zero new runtime dependencies
- `getAnalytics()` returns accurate event counts matching a known call sequence in integration tests
- Analytics for a given role contain zero references to tools outside that role
- `getAnalytics()` is not callable via any MCP tool — verified by integration test attempting to call it as an agent

## Open Questions

1. Should `getAnalytics()` be on the server handle returned by `mcpack()` / `createMCPackServer()`, or on a separate `analytics` property of that handle? The separate property pattern is cleaner for tree-shaking but the flat handle is simpler.
2. Should hybrid ranking weights be configurable per-query or only at config time? Per-query is more flexible but adds API surface.
3. Should the semantic index be rebuilt if the upstream server's tool list changes at runtime (via `listChanged` notification)? v1.0 builds the keyword index once at startup — semantic index could follow the same pattern for v1.1 and defer dynamic rebuild to v1.2.
4. What is the target benchmark for the 50-query intent recall test — should it be built from Stripe MCP, a generic synthetic set, or contributed by the community?
5. Should denial events in analytics record the denied tool name at all, even for operators? If an operator queries `getAnalytics()` with no role filter they see all denial events including tool names. This is intentional for operator debugging but should be explicitly decided.
6. Should `@llvs/mcpack-embeddings` ship a hosted API adapter (OpenAI, Voyage) in addition to the local MiniLM adapter for v1.1, or defer all hosted adapters to v1.2?

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `@xenova/transformers` + MiniLM model weight adds significant install size to `@llvs/mcpack-embeddings` | Medium — operators installing the adapter package see a large download | Keep adapter in separate package so core users are unaffected. Document model size clearly in adapter README. |
| Embedding query latency exceeds 50ms budget on low-powered Railway instances | High — degrades `search_tools` UX | Benchmark on Railway free tier before GA. If latency exceeds budget, cache query embeddings for repeated identical queries within a session. |
| Semantic search quality regresses keyword baseline on tool surfaces with very short or cryptic names | Medium — hybrid ranking helps but short names have poor embedding signal | Hybrid ranking with 0.7/0.3 default weights preserves keyword floor. Operators can tune weights toward keyword-heavy if needed. |
| Analytics memory growth unbounded in long-running sessions with high call volume | Low for typical use, Medium for high-throughput production | Cap event arrays at a configurable `maxEvents` (default 10,000). Oldest events dropped when cap is reached. |
| MCP SDK internal `_requestHandlers` Map (used by wrap mode) changes in a future SDK release | High if it breaks wrap mode entirely | Already tracked in v1.0 known risks. v1.1 adds a startup assertion that verifies the handler map is accessible and throws a clear error if not. |
| Semantic index not ready when first query arrives | Low — startup is typically fast | Fall back to keyword scoring for queries that arrive before index is ready. Log a warning. Never block `search_tools` response. |

## Phase Breakdown

**Phase 1: EmbeddingProvider interface and adapter package**
1. Define `EmbeddingProvider` type and optional `embeddings` config field in `types.ts`
2. Write interface tests — mock provider, verify batch call contract
3. Scaffold `@llvs/mcpack-embeddings` package with MiniLM adapter using `@xenova/transformers`
4. Integration test: MiniLM adapter produces consistent vectors for known inputs

**Phase 2: Semantic index build pipeline**
1. Add async `buildSemanticIndex(tools, provider)` to `index-builder.ts`
2. Integrate into `MCPackEngine` startup — non-blocking, falls back to keyword if not ready
3. Add cosine similarity utility
4. Tests: index build with mock provider, fallback behavior when provider absent

**Phase 3: Hybrid ranking query path**
1. Add `semanticScore(query, index)` to `search.ts`
2. Implement hybrid score combining semantic and keyword with configurable weights
3. Verify role filtering still applied after ranking (not before)
4. Tests: hybrid ranking produces correct order, keyword-only path unchanged, role filter applied post-rank

**Phase 4: Tool usage analytics**
1. Add in-memory `AnalyticsStore` class — captures search, call, denial, miss events
2. Wire event capture into `MCPackEngine` at each decision point
3. Implement `getAnalytics(options?)` on server handle
4. Tests: event counts match known call sequences, role-scoped queries return correct subset, no restricted tool names leak into role-scoped analytics, `getAnalytics` not callable as MCP tool

**Phase 5: Harness, coverage, and docs**
1. Run Stripe MCP harness with hybrid ranking — verify no regression below 80.7%
2. Build 50-query intent recall benchmark — measure improvement over keyword baseline
3. Achieve at least 120 tests at at least 99% statement coverage
4. Update MkDocs docs site: semantic search setup guide, analytics API reference, adapter package guide
5. Publish `@llvs/mcpack@1.1.0` and `@llvs/mcpack-embeddings@1.1.0` to npm

**v1.1 GA gate: Phase 5 complete with all success criteria passing.**
