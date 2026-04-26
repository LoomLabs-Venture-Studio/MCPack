# Constraints (Synthesized Intel)

> No SPECs in the ingest set. The two inbox docs are PRDs. PRD-level NFRs and API contracts captured here for downstream consumption.

---

## v1.1 — Search & Observability

### CON-v11-perf-index-build (NFR)
- source: `mcpack-prd-v1.1-gsd.md` §R1.8
- type: nfr
- statement: Semantic index build completes within 5 seconds for a 50-tool server using local MiniLM adapter on commodity hardware.

### CON-v11-perf-query-latency (NFR)
- source: `mcpack-prd-v1.1-gsd.md` §R1.8
- type: nfr
- statement: `search_tools` p99 latency adds at most 50ms above v1.0 baseline using local MiniLM. Mitigation: cache query embeddings for repeated identical queries within a session if budget exceeded on Railway free tier.

### CON-v11-perf-memory (NFR)
- source: `mcpack-prd-v1.1-gsd.md` §R1.8
- type: nfr
- statement: Semantic index adds at most 2MB for a 50-tool server (384-dim MiniLM vectors at float32).

### CON-v11-tools-list-no-regression (NFR)
- source: `mcpack-prd-v1.1-gsd.md` §R3.5
- type: nfr
- statement: `tools/list` always returns one tool with no v1.1-added latency.

### CON-v11-test-coverage (NFR)
- source: `mcpack-prd-v1.1-gsd.md` §R3.4
- type: nfr
- statement: At least 120 tests at at least 99% statement coverage. Up from v1.0 baseline 100/99.56%.

### CON-v11-token-reduction-floor (NFR)
- source: `mcpack-prd-v1.1-gsd.md` Goals + Success Criteria
- type: nfr
- statement: Stripe MCP harness reports at least 80.7% aggregate token reduction with hybrid ranking enabled.

### CON-v11-recall-improvement (NFR)
- source: `mcpack-prd-v1.1-gsd.md` Goals + Success Criteria
- type: nfr
- statement: Held-out 50-query intent benchmark shows at least 15% recall improvement over v1.0 keyword baseline when MiniLM adapter is configured.

### CON-v11-zero-core-deps (api-contract)
- source: `mcpack-prd-v1.1-gsd.md` §R3.1
- type: api-contract
- statement: `@llvs/mcpack` core package adds zero new runtime dependencies in v1.1. Peer dep stays only `@modelcontextprotocol/sdk`.

### CON-v11-public-api-bytewise-stable (api-contract)
- source: `mcpack-prd-v1.1-gsd.md` §R3.2
- type: api-contract
- statement: `mcpack(server, config)` and `createMCPackServer(config)` signatures byte-for-byte identical to v1.0. `MCPackConfig` only gains optional fields (`embeddings`, `analytics`).

### CON-v11-embedding-provider-interface (api-contract)
- source: `mcpack-prd-v1.1-gsd.md` §R1.1
- type: api-contract
- statement: `type EmbeddingProvider = (texts: string[]) => Promise<number[][]>`. Inputs and outputs are parallel arrays. Core ships no implementation.

### CON-v11-analytics-snapshot-shape (api-contract / schema)
- source: `mcpack-prd-v1.1-gsd.md` §R2.4
- type: schema
- statement: AnalyticsSnapshot includes `searches[]`, `calls[]`, `denials[]`, `misses[]`, plus `summary.byRole[role]: { searchCount, callCount, denialCount, missCount, topTools[5], deadTools[] }`.

### CON-v11-build-config (protocol)
- source: `mcpack-prd-v1.1-gsd.md` §R3.3
- type: protocol
- statement: ESM-only output; NodeNext module resolution; TypeScript strict + verbatimModuleSyntax. No CommonJS.

### CON-v11-analytics-storage (protocol)
- source: `mcpack-prd-v1.1-gsd.md` §R2.2
- type: protocol
- statement: All analytics data is in-memory. No disk writes. No network egress. Resets on process restart.

### CON-v11-analytics-rbac (protocol)
- source: `mcpack-prd-v1.1-gsd.md` §R2.3, §R2.6
- type: protocol
- statement: Role-scoped analytics never expose tools outside that role. `getAnalytics()` is on the server handle and never callable as an MCP tool.

### CON-v11-role-filter-after-rank (protocol)
- source: `mcpack-prd-v1.1-gsd.md` §R1.7
- type: protocol
- statement: Role filtering is applied after ranking, not before. Preserves opaque denial semantics.

### CON-v11-analytics-event-cap (protocol)
- source: `mcpack-prd-v1.1-gsd.md` Risks
- type: protocol
- statement: Analytics event arrays are capped at a configurable `maxEvents` (default 10,000). Oldest events dropped when cap is reached.

---

## v1.2 — Partner Hub

### CON-v12-zero-core-deps (api-contract)
- source: `mcpack-prd-v1.1-final.md` §5.7 + DEC-BOARD-04
- type: api-contract
- statement: `@llvs/mcpack` core stays zero runtime dependencies. `google-auth-library` lives in `@llvs/mcpack-google` only.

### CON-v12-package-matrix (api-contract)
- source: `mcpack-prd-v1.1-final.md` §5.7
- type: api-contract
- statement: `@llvs/mcpack-google@1.2.0` peer-depends on `@llvs/mcpack ^1.2.0`, dependency `google-auth-library ^9.0.0`. (Versions corrected per board override.)

### CON-v12-source-config (schema)
- source: `mcpack-prd-v1.1-final.md` §5.2
- type: schema
- statement: `MCPackSource = { name: string, server: Server }`. `MCPackServerConfig` extends `MCPackConfig` with `name`, `version`, optional `tools[]`, optional `sources[]`, optional `transport`.

### CON-v12-transport-config (schema)
- source: `mcpack-prd-v1.1-final.md` §5.2
- type: schema
- statement: `MCPackTransportConfig = { type: 'stdio' | 'sse', port?: number = 3000, path?: string = '/sse' }`.

### CON-v12-session-shape (schema)
- source: `mcpack-prd-v1.1-final.md` §5.2
- type: schema
- statement: `MCPackSession = { id: string, headers?: Record<string, string>, clientInfo?: { name?: string, version?: string } }`.

### CON-v12-role-config-wildcards (protocol)
- source: `mcpack-prd-v1.1-final.md` §5.2
- type: protocol
- statement: `RoleConfig = Record<string, string[]>`. Permitted patterns: `'*'` (all tools), `'crm.*'` (namespace), `'crm.get_deals'` (exact).

### CON-v12-resolve-role-signature (api-contract)
- source: `mcpack-prd-v1.1-final.md` §5.2
- type: api-contract
- statement: `resolveRole?: (session: MCPackSession) => string | Promise<string>`. Provider-agnostic. Called at transport layer before source composition.

### CON-v12-static-resolver-signature (api-contract)
- source: `mcpack-prd-v1.1-final.md` §5.6
- type: api-contract
- statement: `staticResolver(config: { roles: Record<string,string>, fallbackRole?: string, identifierField?: 'email' | 'sub' | 'id' }): (session: MCPackSession) => string`. No JWT signature verification — base64 payload decode only.

### CON-v12-google-resolver-signature (api-contract)
- source: `mcpack-prd-v1.1-final.md` §5.7
- type: api-contract
- statement: `googleResolver(config: { roles: Record<string,string>, fallbackRole?: string, audience?: string }): (session: MCPackSession) => Promise<string>`. Verifies Google JWT against JWKS, extracts email, maps to role. Caches JWKS, refreshes on rotation.

### CON-v12-inverted-index-shape (schema) — DEFERRED ADOPTION
- source: `mcpack-prd-v1.1-final.md` §5.4
- type: schema
- statement: `InvertedIndex = { entries: Map<string, Array<{ toolName: string; weight: number }>> }`. Field weights `TOOL_NAME=10, DESCRIPTION=5, PARAM_NAME=2`. Tokenizer: lowercase, strip punctuation, length>1 filter. **Adoption deferred to a v1.2 ADR — see REQ-v12-search-engine-direction.**

### CON-v12-graceful-shutdown (protocol)
- source: `mcpack-prd-v1.1-final.md` §5.5
- type: protocol
- statement: Stop accepting new connections → SIGTERM all stdio children → wait up to 2s per process → SIGKILL stragglers → close SSE server.

### CON-v12-collision-prefixing (protocol)
- source: `mcpack-prd-v1.1-final.md` §3.1, §5.3
- type: protocol
- statement: Build full name map across all sources first. Prefix only when two sources share a tool name (`source.toolname`). Non-collisions keep original names. Emit explicit warning on collision.

### CON-v12-auth-before-composition (protocol)
- source: `mcpack-prd-v1.1-final.md` §2.3, §4.1
- type: protocol
- statement: Auth resolution runs at the transport layer BEFORE source composition. Auth provider is never a source. No circular dependency permitted.

### CON-v12-railway-memory-sizing (nfr)
- source: `mcpack-prd-v1.1-final.md` §6.3
- type: nfr
- statement: Memory sizing guide:
    - 1-3 sources: 100-200MB ($5/mo Railway)
    - 4-6 sources: 200-400MB ($10/mo)
    - 7-10 sources: 350-600MB ($20/mo)
    - 10+ sources: evaluate cluster approach in v1.3+

### CON-v12-required-env-vars (protocol)
- source: `mcpack-prd-v1.1-final.md` §6.2
- type: protocol
- statement: For Partner Hub Railway deployments — `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (auth page), source MCP credentials (e.g., `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `STRIPE_SECRET_KEY`), `PORT` (default 3000). MCPack core itself requires no env vars.
