# Requirements: MCPack

**Defined:** 2026-03-19
**Last ingest:** 2026-04-25 (v1.1 + v1.2 PRDs)
**Core Value:** Agents discover only the tool schemas they need, when they need them — reducing token waste by 90%+

## v1 Requirements

### Discovery Interception

- [x] **DISC-01**: `tools/list` on a wrapped or built server returns exactly one tool: `search_tools`
- [x] **DISC-02**: `search_tools` accepts a natural language query and returns matching tool schemas ranked by relevance
- [x] **DISC-03**: All `tools/call` requests for non-`search_tools` tools pass through to the underlying server unchanged (wrap mode)
- [x] **DISC-04**: All `tools/call` requests for non-`search_tools` tools route to the correct registered handler (build mode)
- [x] **DISC-05**: Previously loaded schemas are returned as `loaded: true` with no schema payload on subsequent `search_tools` calls within the same session

### Search Engine

- [x] **SRCH-01**: Keyword-based scoring ranks results by: exact name match > partial name match > description match > extracted keyword match
- [x] **SRCH-02**: Result limit is configurable (default 5, max 10) via config and per-query `limit` parameter

### Session Management

- [x] **SESS-01**: Each session tracks which tool schemas have been loaded via a `loadedTools` set
- [x] **SESS-02**: Sessions expire after a configurable TTL (default 2 hours) and are cleaned up automatically
- [x] **SESS-03**: Cleanup timer uses `.unref()` to avoid blocking Node.js process exit
- [x] **SESS-04**: Public `destroy()` method stops cleanup timer and clears all sessions for clean shutdown

### Role-Based Access

- [x] **ROLE-01**: Roles are defined as a config map of role name to array of allowed tool names
- [x] **ROLE-02**: Wildcard `'*'` grants a role access to all tools
- [x] **ROLE-03**: `search_tools` results and `total_available` count reflect only tools the caller's role can access

### Entry Points

- [x] **ENTRY-01**: `mcpack(server, config)` wraps an existing MCP `Server` instance with lazy discovery
- [x] **ENTRY-02**: `createMCPackServer(config)` creates a new MCP `Server` with tools, handlers, and lazy discovery
- [x] **ENTRY-03**: Both entry points share the same core engine (index, search, sessions, roles)

### Testing

- [x] **TEST-01**: Unit tests exist for each module: index-builder, search, session, roles, server-builder
- [x] **TEST-02**: Integration test harness runs against real Stripe MCP and produces a token reduction comparison report
- [x] **TEST-03**: All tests pass with `vitest`

### Package & Documentation

- [x] **PKG-01**: Package compiles with `tsc` and exports TypeScript type definitions
- [x] **PKG-02**: No runtime dependencies beyond `@modelcontextprotocol/sdk` as peer dependency
- [x] **PKG-03**: README documents wrap mode usage with code example
- [x] **PKG-04**: README documents build mode usage with code example
- [x] **PKG-05**: README includes token reduction numbers from the test harness
- [x] **PKG-06**: Spec document from `mcpack-spec-v1.md` (repo root) committed to `/spec/mcpack-spec-v1.md` and referenced in README

## v1.1 Requirements

**Source PRD:** `.planning/inbox/mcpack-prd-v1.1-gsd.md`
**Milestone:** v1.1.0 — Search & Observability (board-confirmed 2026-04-25)
**Intel:** `.planning/intel/requirements.md`, `.planning/intel/decisions.md`

### Semantic Search (R1)

- [ ] **REQ-v11-semantic-provider-interface** (R1.1): Define `EmbeddingProvider = (texts: string[]) => Promise<number[][]>`. Batch-in, parallel-array-out. Core ships no implementation.
- [ ] **REQ-v11-embeddings-optional-config** (R1.2): `EmbeddingProvider` passed via optional `embeddings` field on `MCPackConfig`. With no `embeddings`, v1.0 keyword-only behavior preserved exactly with no performance penalty.
- [ ] **REQ-v11-mcpack-embeddings-package** (R1.3): Ship a separate adapter package using `@xenova/transformers` as optional peer dep, exposing a local MiniLM adapter. Never required by core.
- [ ] **REQ-v11-semantic-index-build** (R1.4): When `EmbeddingProvider` is configured, build a semantic index at startup. Concatenate `name + description + param-names` per tool. Single batch call. Store vectors in-memory keyed by tool name. Async — does not delay `tools/list`.
- [ ] **REQ-v11-semantic-query-path** (R1.5): On each `search_tools` call, embed the query (single-item batch), compute cosine similarity to each tool vector, produce a semantic score per tool.
- [ ] **REQ-v11-hybrid-ranking** (R1.6): Final score = `(semanticWeight * semanticScore) + (keywordWeight * keywordScore)`. Defaults `semanticWeight: 0.7`, `keywordWeight: 0.3`. Configurable via `MCPackConfig.embeddings.weights`. With no provider, keyword-only path runs (implicit `keywordWeight: 1.0`).
- [ ] **REQ-v11-role-filter-after-rank** (R1.7): Role filtering applied AFTER ranking, not before. Score full surface, then filter results. Preserves opaque denial.
- [ ] **REQ-v11-perf-budget** (R1.8): Index build ≤5s for 50-tool server with local MiniLM. Query embedding adds ≤50ms p99. Memory ≤2MB for 50-tool MiniLM (384-dim float32).
- [ ] **REQ-v11-backward-compat** (R1.9): With no `EmbeddingProvider`, search path is identical to v1.0 at the code level. No regression. Existing deployments require zero config changes to upgrade.

### Tool Usage Analytics (R2)

- [ ] **REQ-v11-analytics-events** (R2.1): Capture four event types per session: `search` (query, role, returned tools, ts), `call` (tool, role, ts), `denial` (tool, role, ts), `miss` (query, role, ts).
- [ ] **REQ-v11-analytics-storage** (R2.2): Storage is in-memory only. No disk, no network, resets on process restart.
- [ ] **REQ-v11-analytics-privacy** (R2.3): Role-scoped analytics responses must not expose tools outside that role. Denial events record only that a denial happened — never reveal restricted tool names to a role-scoped query.
- [ ] **REQ-v11-analytics-api** (R2.4): Add `getAnalytics(options?)` to handle returned by `mcpack()` and `createMCPackServer()`. Returns `AnalyticsSnapshot { searches[], calls[], denials[], misses[], summary.byRole[role]: { searchCount, callCount, denialCount, missCount, topTools[5], deadTools[] } }`.
- [ ] **REQ-v11-analytics-role-scoped-query** (R2.5): `getAnalytics({ role: 'cofounder' })` returns only that role's events. No-arg form returns all (operator view).
- [ ] **REQ-v11-analytics-rbac-integrity** (R2.6): `getAnalytics()` is on the server handle, NOT exposed as an MCP tool. Not callable by agents.
- [ ] **REQ-v11-dead-tool-detection** (R2.7): `summary.byRole[role].deadTools` lists tools with zero `call` events for that role in the current session, scoped to tools that role can actually see.

### Cross-Cutting (R3)

- [ ] **REQ-v11-zero-core-deps** (R3.1): Zero new runtime deps in core. `@xenova/transformers` confined to `@llvs/mcpack-embeddings`. Auth deps confined to resolver packages. Peer dep stays only `@modelcontextprotocol/sdk`.
- [ ] **REQ-v11-public-api-lock** (R3.2): `mcpack(server, config)` and `createMCPackServer(config)` signatures byte-identical to v1.0. `MCPackConfig` gains optional `embeddings` and `analytics` fields only.
- [ ] **REQ-v11-esm-only** (R3.3): ESM-only, NodeNext, strict, verbatimModuleSyntax. No CommonJS.
- [ ] **REQ-v11-test-coverage-floor** (R3.4): ≥120 tests at ≥99% statement coverage. New tests cover embedding interface, hybrid ranking, semantic index build, query path, analytics events, analytics API, role-scoped analytics, dead tool detection, RBAC integrity.
- [ ] **REQ-v11-tools-list-no-regression** (R3.5): `tools/list` always returns one tool with no v1.1-added latency. Index build is async, non-blocking.
- [ ] **REQ-v11-session-invariants** (R3.6): Schemas-loaded references unchanged. Out-of-role `tools/call` still returns `"Unknown tool: {name}"`. No v1.0 invariant modified.

## Success Criteria — v1.1

> Quantitative gates from `mcpack-prd-v1.1-gsd.md` Success Criteria. Distinct from requirements — these are the v1.1 GA verification matrix exercised in Phase 5.

- [ ] 120 tests at 99%+ coverage
- [ ] Stripe MCP harness ≥80.7% aggregate token reduction with hybrid ranking
- [ ] 50-query intent benchmark recall up ≥15% over v1.0 keyword baseline (when MiniLM configured)
- [ ] `search_tools` p99 within 50ms of v1.0 baseline (with local MiniLM)
- [ ] Semantic index build ≤5s for 50-tool server
- [ ] API signatures byte-identical to v1.0
- [ ] `@llvs/mcpack` package.json: zero new runtime deps
- [ ] `getAnalytics()` event counts match a known call sequence
- [ ] Role-scoped analytics: zero references to out-of-role tools
- [ ] `getAnalytics()` not callable as MCP tool

## v1.2 Requirements (DEFERRED)

> **DEFERRED until v1.1 ships.** Source PRD: `.planning/inbox/mcpack-prd-v1.1-final.md` (board-overridden from PRD-claimed v1.1 → v1.2). Milestone: **v1.2.0 Partner Hub**.
>
> **Pre-Phase-1 ADR required:** `REQ-v12-search-engine-direction` is a deferred decision, not a buildable task. Author and accept a v1.2 ADR resolving search-engine direction (swap keyword leg to inverted index / keep both side-by-side / leave 5-tier scorer untouched) BEFORE Phase 1 plans are authored.
>
> **Non-goals re-evaluation:** PRD §9 non-goals were authored against the original v1.1 framing. Items needing explicit in/out scoping for v1.2 vs slip-to-v1.3 (decisions deferred to phase planning): WorkOS resolver, Auth0 resolver, audit log endpoint, rate limiting per role, per-project role scoping, token expiry/refresh automation. The "semantic search deferred" non-goal is stale — board moved semantic search to v1.1.

### Multi-Source Mode

- [ ] **REQ-v12-sources-array** (§3.1, §8): `createMCPackServer` accepts `sources[]` of named MCP server instances. Each spawned as stdio child at startup. Pull tool definitions via `tools/list` from each source. Build merged inverted index across all sources.
- [ ] **REQ-v12-collision-prefixing** (§3.1, §5.3, §8): Build full name map first. Only prefix `source.toolname` when two sources share a tool name. Non-collisions keep original names. Warn explicitly on collision.
- [ ] **REQ-v12-call-routing** (§3.1, §8): Route `tools/call` to correct source server by tool name (with prefix lookup table).
- [ ] **REQ-v12-namespace-wildcard-roles** (§3.1, §5.2, §8): Role config supports `'*'`, `'crm.*'`, `'crm.get_deals'`. Filter applied across full merged surface at search and execution layers.

### Dynamic Role Resolution

- [ ] **REQ-v12-resolve-role-hook** (§3.2, §5.5, §8): `resolveRole(session) → string | Promise<string>` is provider-agnostic. Receives session with headers including Authorization. Called at the transport layer BEFORE source composition runs.
- [ ] **REQ-v12-static-resolver** (§5.6, §8): Built-in `staticResolver` ships in core. Base64 decodes JWT payload (no signature verification). Maps `email` (or `sub`/`id`) field to role string. `fallbackRole` configurable.
- [ ] **REQ-v12-google-resolver-package** (§3.3, §5.7, §8): `googleResolver({ roles, fallbackRole, audience })` verifies Google JWT against JWKS, extracts email, maps to role. Uses `google-auth-library ^9.0.0`. Peer-depends on `@llvs/mcpack ^1.2.0`. Caches JWKS keys, refreshes on rotation.

### HTTP/SSE Transport

- [ ] **REQ-v12-sse-transport** (§3.5, §5.5, §8): New `transport: { type: 'sse', port?: 3000, path?: '/sse' }`. SSE server starts on configured port. stdio remains valid.
- [ ] **REQ-v12-bearer-extraction** (§4.1, §5.5, §8): Extract `Authorization: Bearer <token>` from incoming SSE request headers at the transport boundary. Pass headers to `resolveRole(session)` before MCP session is established.
- [ ] **REQ-v12-graceful-shutdown** (§5.5, §8): Stop accepting new connections, SIGTERM all stdio children, wait up to 2s per process, SIGKILL stragglers, close SSE server.

### Cross-Cutting

- [ ] **REQ-v12-public-api-unchanged** (§8): `mcpack()` and `createMCPackServer()` signatures byte-identical to v1.0. `MCPackServerConfig` extends `MCPackConfig` with optional `name`, `version`, `tools[]`, `sources[]`, `transport`. Existing v1.0 calls compile unmodified.
- [ ] **REQ-v12-zero-core-deps**: `@llvs/mcpack` core stays zero-dep. Google auth lives in `@llvs/mcpack-google` only. (Carries DEC-BOARD-04.)
- [ ] **REQ-v12-all-v10-tests-pass** (§8): All v1.0 tests continue to pass unmodified.
- [ ] **REQ-v12-new-test-suite** (§8): Add tests for multi-source composition, collision handling, inverted index (if adopted), deterministic search, Google JWT resolution, static resolver, SSE transport, graceful shutdown.
- [ ] **REQ-v12-search-engine-direction** (§3.4, §5.4) — **DEFERRED DECISION / ADR PLACEHOLDER**: PRD proposes replacing v1.0 5-tier scorer with a deterministic weighted inverted index (TOOL_NAME=10, DESCRIPTION=5, PARAM_NAME=2). In v1.1, the 5-tier scorer remains as the keyword leg of the hybrid ranker (DEC-v11-13). v1.2 may (a) swap the keyword leg to the inverted index, (b) keep both side-by-side, or (c) keep the 5-tier scorer untouched. **Decision blocked on v1.2 ADR — must be authored and accepted before Phase 1 plan generation.**
- [ ] **REQ-v12-publish-versions**: Publish `@llvs/mcpack@1.2.0` and `@llvs/mcpack-google@1.2.0` to npm. (PRD originally wrote 1.1.0 — overridden by board.)

## v2 Requirements

### Role Enhancements

- **ROLE-04**: Role inheritance — roles can extend other roles
- **ROLE-05**: Custom `resolveRole(session)` function for dynamic role assignment — _Note: superseded by `REQ-v12-resolve-role-hook` in v1.2 milestone (Partner Hub PRD)._

### Search Enhancements

- **SRCH-03**: Semantic/embedding-based search as optional upgrade to keyword scoring — **MOVED TO v1.1** (board decision DEC-BOARD-03, 2026-04-25). See `REQ-v11-semantic-provider-interface`, `REQ-v11-hybrid-ranking`, and the rest of the v1.1 R1 block above.

### Protocol Integration

- **PROT-01**: `notifications/tools/list_changed` support when schemas are loaded
- **PROT-02**: Tool usage event tracking for analytics — _Note: in-process analytics shipping in v1.1 via `getAnalytics()`. PROT-02 retained as a v2 candidate for protocol-level event emission (OTEL / file export / webhooks deferred per v1.1 non-goals → v1.2 candidates)._

## Out of Scope

| Feature | Reason |
|---------|--------|
| Binary encoding / MessagePack | Planned for v2.0, not needed for token reduction proof |
| Standalone proxy server process | MCPack is a library, not a daemon |
| CLI tooling | No user-facing CLI needed for a wrapper library |
| Dashboard or analytics UI | Library scope, not product scope |
| Persistent session storage | In-memory sufficient through v1.2; v2.0 candidate |
| Changes to MCP client behavior | MCPack is server-side only |
| npm publish / GitHub repo creation | Build only; publishing is a separate manual step |
| Default embedding model inside `@llvs/mcpack` core | Never — adapter pattern (DEC-BOARD-05) |
| CommonJS build output | Never — ESM-only |
| Analytics persistence across process restarts | v2.0 candidate |
| OTEL exporter / file export / webhook for analytics | v1.2 candidate (deferred from v1.1) |
| Shared hosted gateway with team-management dashboard | Layer 3 future product |
| Cluster / multi-node deployment | v1.3+ |
| Commercial pricing model | Defined jointly with enterprise partners |

## Traceability

### v1.0 (board-locked history)

| Requirement | Phase | Status |
|-------------|-------|--------|
| DISC-01 | Phase 2 | Complete |
| DISC-02 | Phase 2 | Complete |
| DISC-03 | Phase 2 | Complete |
| DISC-04 | Phase 3 | Complete |
| DISC-05 | Phase 2 | Complete |
| SRCH-01 | Phase 1 | Complete |
| SRCH-02 | Phase 1 | Complete |
| SESS-01 | Phase 1 | Complete |
| SESS-02 | Phase 1 | Complete |
| SESS-03 | Phase 1 | Complete |
| SESS-04 | Phase 1 | Complete |
| ROLE-01 | Phase 1 | Complete |
| ROLE-02 | Phase 1 | Complete |
| ROLE-03 | Phase 1 | Complete |
| ENTRY-01 | Phase 2 | Complete |
| ENTRY-02 | Phase 3 | Complete |
| ENTRY-03 | Phase 2 | Complete |
| TEST-01 | Phase 4 | Complete |
| TEST-02 | Phase 4 | Complete |
| TEST-03 | Phase 4 | Complete |
| PKG-01 | Phase 1 | Complete |
| PKG-02 | Phase 1 | Complete |
| PKG-03 | Phase 5 | Complete |
| PKG-04 | Phase 5 | Complete |
| PKG-05 | Phase 5 | Complete |
| PKG-06 | Phase 5 | Complete |

### v1.1 (in flight)

| Requirement | Phase | Status |
|-------------|-------|--------|
| REQ-v11-semantic-provider-interface | v1.1 Phase 1 | Pending |
| REQ-v11-embeddings-optional-config | v1.1 Phase 1 | Pending |
| REQ-v11-mcpack-embeddings-package | v1.1 Phase 1 | Pending |
| REQ-v11-zero-core-deps | v1.1 Phase 1 | Pending |
| REQ-v11-public-api-lock | v1.1 Phase 1 | Pending |
| REQ-v11-esm-only | v1.1 Phase 1 | Pending |
| REQ-v11-semantic-index-build | v1.1 Phase 2 | Pending |
| REQ-v11-tools-list-no-regression | v1.1 Phase 2 | Pending |
| REQ-v11-perf-budget | v1.1 Phase 2 | Pending |
| REQ-v11-semantic-query-path | v1.1 Phase 3 | Pending |
| REQ-v11-hybrid-ranking | v1.1 Phase 3 | Pending |
| REQ-v11-role-filter-after-rank | v1.1 Phase 3 | Pending |
| REQ-v11-backward-compat | v1.1 Phase 3 | Pending |
| REQ-v11-session-invariants | v1.1 Phase 3 | Pending |
| REQ-v11-analytics-events | v1.1 Phase 4 | Pending |
| REQ-v11-analytics-storage | v1.1 Phase 4 | Pending |
| REQ-v11-analytics-privacy | v1.1 Phase 4 | Pending |
| REQ-v11-analytics-api | v1.1 Phase 4 | Pending |
| REQ-v11-analytics-role-scoped-query | v1.1 Phase 4 | Pending |
| REQ-v11-analytics-rbac-integrity | v1.1 Phase 4 | Pending |
| REQ-v11-dead-tool-detection | v1.1 Phase 4 | Pending |
| REQ-v11-test-coverage-floor | v1.1 Phase 5 | Pending |

**Coverage:**
- v1 requirements: 26 total / mapped to phases: 26 / unmapped: 0
- v1.1 requirements: 22 total / mapped to phases: 22 / unmapped: 0
- v1.2 requirements: 16 total / DEFERRED until v1.1 ships (phase mapping authored when milestone opens)

---
*Requirements defined: 2026-03-19*
*Last updated: 2026-04-25 after v1.1 + v1.2 PRD ingest*
