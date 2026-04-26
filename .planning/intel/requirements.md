# Requirements (Synthesized Intel)

> Per-PRD requirements extracted from the inbox. Each entry has a stable REQ ID derived from the PRD topic + numbering. Milestone routing is set per the board decision (2026-04-25).

---

## v1.1 Milestone — Search & Observability
Source PRD: `/Users/zaid/Projects/MCPack/.planning/inbox/mcpack-prd-v1.1-gsd.md`
Target milestone: **v1.1.0**

### R1: Semantic Search

#### REQ-v11-semantic-provider-interface (R1.1)
- source: `mcpack-prd-v1.1-gsd.md` §R1.1
- scope: src/types.ts (new EmbeddingProvider type)
- description: Define `EmbeddingProvider = (texts: string[]) => Promise<number[][]>`. Batch-in, parallel-array-out. Core ships no implementation.
- acceptance: Type exported from package entry point. Mock provider in tests verifies batch call contract.

#### REQ-v11-embeddings-optional-config (R1.2)
- source: `mcpack-prd-v1.1-gsd.md` §R1.2
- scope: MCPackConfig
- description: `EmbeddingProvider` is passed via optional `embeddings` field on `MCPackConfig`. If absent, v1.0 keyword-only behavior is preserved exactly with no performance penalty.
- acceptance: With no `embeddings` configured, search code path is byte-identical to v1.0 at the function level.

#### REQ-v11-mcpack-embeddings-package (R1.3)
- source: `mcpack-prd-v1.1-gsd.md` §R1.3
- scope: separate package `@llvs/mcpack-embeddings`
- description: Ship a separate adapter package using `@xenova/transformers` as optional peer dep, exposing a local MiniLM adapter. Never required by core.
- acceptance: `@llvs/mcpack-embeddings@1.1.0` published. MiniLM adapter produces consistent vectors for known inputs in integration tests.

#### REQ-v11-semantic-index-build (R1.4)
- source: `mcpack-prd-v1.1-gsd.md` §R1.4
- scope: index-builder.ts
- description: When `EmbeddingProvider` is configured, build a semantic index at startup. Concatenate each tool's name + description + parameter names into a single indexing string. Pass all in a single batch call. Store vectors in-memory keyed by tool name. Async — does not delay `tools/list`.
- acceptance: Mock provider integration test asserts batch call shape and resulting index map. Fallback to keyword scoring if first query arrives before index ready.

#### REQ-v11-semantic-query-path (R1.5)
- source: `mcpack-prd-v1.1-gsd.md` §R1.5
- scope: search.ts
- description: On each `search_tools` call, embed the query (single-item batch), compute cosine similarity to each tool vector, produce a semantic score per tool.
- acceptance: Cosine similarity utility unit-tested. Semantic score path returns scores in [-1, 1].

#### REQ-v11-hybrid-ranking (R1.6)
- source: `mcpack-prd-v1.1-gsd.md` §R1.6
- scope: search.ts
- description: Final score = `(semanticWeight * semanticScore) + (keywordWeight * keywordScore)`. Defaults `semanticWeight: 0.7`, `keywordWeight: 0.3`. Configurable via `MCPackConfig.embeddings.weights`. With no provider, keyword-only path runs (implicit `keywordWeight: 1.0`).
- acceptance: Hybrid ranking ordering test with mock provider. Keyword-only path unchanged from v1.0.

#### REQ-v11-role-filter-after-rank (R1.7)
- source: `mcpack-prd-v1.1-gsd.md` §R1.7
- scope: search.ts
- description: Role filtering applied AFTER ranking, not before. Score full surface, then filter results. Preserves opaque denial.
- acceptance: Test verifies role-restricted tools never appear in ranked output regardless of score.

#### REQ-v11-perf-budget (R1.8)
- source: `mcpack-prd-v1.1-gsd.md` §R1.8
- scope: performance NFR
- description: Index build at most 5s for 50-tool server with local MiniLM. Query embedding adds at most 50ms p99. Memory at most 2MB for 50-tool MiniLM (384-dim float32).
- acceptance: Bench harness asserts these bounds on commodity hardware.

#### REQ-v11-backward-compat (R1.9)
- source: `mcpack-prd-v1.1-gsd.md` §R1.9
- scope: backward compatibility
- description: With no `EmbeddingProvider`, search path is identical to v1.0 at the code level. No regression. Existing deployments require zero config changes to upgrade.
- acceptance: Existing v1.0 tests pass unmodified. No-embeddings perf test matches v1.0 baseline within noise.

### R2: Tool Usage Analytics

#### REQ-v11-analytics-events (R2.1)
- source: `mcpack-prd-v1.1-gsd.md` §R2.1
- scope: AnalyticsStore
- description: Capture four event types per session: `search` (query, role, returned tools, ts), `call` (tool, role, ts), `denial` (tool, role, ts), `miss` (query, role, ts).
- acceptance: Each event captured at the correct decision point in MCPackEngine. Integration test asserts counts match a known call sequence.

#### REQ-v11-analytics-storage (R2.2)
- source: `mcpack-prd-v1.1-gsd.md` §R2.2
- scope: AnalyticsStore lifecycle
- description: Storage is in-memory only. No disk, no network, resets on process restart.
- acceptance: No filesystem or network calls in analytics code paths (verified via test or static check).

#### REQ-v11-analytics-privacy (R2.3)
- source: `mcpack-prd-v1.1-gsd.md` §R2.3
- scope: getAnalytics() return shape
- description: Role-scoped analytics responses must not expose tools outside that role. Denial events record only that a denial happened — never reveal restricted tool names to a role-scoped query.
- acceptance: Integration test: query analytics as role 'partner', assert zero references to admin-only tool names.

#### REQ-v11-analytics-api (R2.4)
- source: `mcpack-prd-v1.1-gsd.md` §R2.4
- scope: server handle API
- description: Add `getAnalytics(options?)` to handle returned by `mcpack()` and `createMCPackServer()`. Returns `AnalyticsSnapshot { searches[], calls[], denials[], misses[], summary.byRole[role]: { searchCount, callCount, denialCount, missCount, topTools[5], deadTools[] } }`.
- acceptance: Type exported. Integration test verifies snapshot shape.

#### REQ-v11-analytics-role-scoped-query (R2.5)
- source: `mcpack-prd-v1.1-gsd.md` §R2.5
- scope: getAnalytics(options)
- description: `getAnalytics({ role: 'cofounder' })` returns only that role's events. No-arg form returns all (operator view).
- acceptance: Integration test verifies role filter.

#### REQ-v11-analytics-rbac-integrity (R2.6)
- source: `mcpack-prd-v1.1-gsd.md` §R2.6
- scope: API surface
- description: `getAnalytics()` is on the server handle, NOT exposed as an MCP tool. Not callable by agents.
- acceptance: Integration test attempts to call `getAnalytics` as an MCP agent → returns "Unknown tool".

#### REQ-v11-dead-tool-detection (R2.7)
- source: `mcpack-prd-v1.1-gsd.md` §R2.7
- scope: AnalyticsSnapshot.summary
- description: `summary.byRole[role].deadTools` lists tools with zero `call` events for that role in the current session, scoped to tools that role can actually see.
- acceptance: Integration test seeds role with 5 visible tools, calls 2, asserts deadTools = remaining 3.

### R3: Cross-Cutting

#### REQ-v11-zero-core-deps (R3.1)
- source: `mcpack-prd-v1.1-gsd.md` §R3.1
- scope: package.json of @llvs/mcpack
- description: Zero new runtime deps in core. `@xenova/transformers` confined to `@llvs/mcpack-embeddings`. Auth deps confined to resolver packages. Peer dep stays only `@modelcontextprotocol/sdk`.
- acceptance: package.json shows zero new `dependencies` entries vs v1.0.

#### REQ-v11-public-api-lock (R3.2)
- source: `mcpack-prd-v1.1-gsd.md` §R3.2
- scope: API surface
- description: `mcpack(server, config)` and `createMCPackServer(config)` signatures byte-identical to v1.0. `MCPackConfig` gains optional `embeddings` and `analytics` fields only.
- acceptance: TypeScript signature diff vs v1.0 = zero changes to existing fields. Existing v1.0 calling code compiles unmodified.

#### REQ-v11-esm-only (R3.3)
- source: `mcpack-prd-v1.1-gsd.md` §R3.3
- scope: build output
- description: ESM-only, NodeNext, strict, verbatimModuleSyntax. No CommonJS.
- acceptance: tsconfig + package.json unchanged from v1.0 module settings.

#### REQ-v11-test-coverage-floor (R3.4)
- source: `mcpack-prd-v1.1-gsd.md` §R3.4
- scope: testing
- description: At least 120 tests at at least 99% statement coverage. New tests cover embedding interface, hybrid ranking, semantic index build, query path, analytics events, analytics API, role-scoped analytics, dead tool detection, RBAC integrity.
- acceptance: vitest run reports >= 120 tests at >= 99% statement coverage.

#### REQ-v11-tools-list-no-regression (R3.5)
- source: `mcpack-prd-v1.1-gsd.md` §R3.5
- scope: tools/list latency
- description: `tools/list` always returns one tool with no v1.1-added latency. Index build is async, non-blocking.
- acceptance: tools/list latency benchmark within v1.0 noise floor.

#### REQ-v11-session-invariants (R3.6)
- source: `mcpack-prd-v1.1-gsd.md` §R3.6
- scope: session + denial behavior
- description: Schemas-loaded references unchanged. Out-of-role `tools/call` still returns `"Unknown tool: {name}"`. No v1.0 invariant modified.
- acceptance: Existing session and denial tests pass unmodified.

### v1.1 Success Criteria (gate)
- source: `mcpack-prd-v1.1-gsd.md` Success Criteria
- 120 tests at 99%+ coverage
- Stripe MCP harness >= 80.7% aggregate token reduction with hybrid ranking
- 50-query intent benchmark recall up >= 15% over v1.0 keyword baseline (when MiniLM configured)
- search_tools p99 within 50ms of v1.0 baseline (with local MiniLM)
- Semantic index build <= 5s for 50-tool server
- API signatures byte-identical to v1.0
- @llvs/mcpack package.json: zero new runtime deps
- getAnalytics() event counts match a known call sequence
- Role-scoped analytics: zero references to out-of-role tools
- getAnalytics() not callable as MCP tool

### v1.1 Non-Goals
- source: `mcpack-prd-v1.1-gsd.md` Non-Goals
- Binary encoding / MessagePack (→ v2.0)
- Persistent session storage (→ v2.0)
- Standalone proxy server process (→ v2.0)
- OTEL exporter / structured log output for analytics (→ v1.2)
- File export of analytics data (→ v1.2)
- Webhook/callback hook for analytics events (→ v1.2)
- Multi-source / multi-MCP gateway mode (→ v1.2 Partner Hub PRD)
- Google OAuth / any auth resolver (→ v1.2 Partner Hub PRD)
- HTTP/SSE transport (→ v1.2 Partner Hub PRD)
- Default embedding model inside @llvs/mcpack core (never)
- CommonJS build output (never)
- Analytics persistence across process restarts (→ v2.0)

### v1.1 Open Questions (deferred decisions)
- source: `mcpack-prd-v1.1-gsd.md` Open Questions
- OQ1: `getAnalytics()` flat on handle vs separate `analytics` property — defer to phase planning
- OQ2: Hybrid weights configurable per-query vs config-only — config-only proposed, confirm in phase
- OQ3: Index rebuild on `listChanged` — defer to v1.2
- OQ4: 50-query intent benchmark source (Stripe / synthetic / community) — pick before phase 5
- OQ5: Denial events record tool name even for operators — confirm in phase 4
- OQ6: `@llvs/mcpack-embeddings` ship hosted adapter (OpenAI/Voyage) in v1.1 or defer — defer all hosted adapters to v1.2

---

## v1.2 Milestone — Partner Hub
Source PRD: `/Users/zaid/Projects/MCPack/.planning/inbox/mcpack-prd-v1.1-final.md`
Target milestone: **v1.2.0** (board-overridden from PRD-claimed v1.1)

> **Acceptance criteria format note:** This PRD uses an unstructured §8 checklist instead of R-IDs. IDs below are synthesized as `REQ-v12-*` from PRD section anchors.

### Multi-Source Mode

#### REQ-v12-sources-array (§3.1, §8)
- source: `mcpack-prd-v1.1-final.md` §3.1, §5.3, §8
- scope: createMCPackServer, multi-source.ts
- description: `createMCPackServer` accepts `sources[]` of named MCP server instances. Each spawned as stdio child at startup. Pull tool definitions via `tools/list` from each source. Build merged inverted index across all sources.
- acceptance: Sources spawned, tools/list pulled, merged index built, integration test confirms.

#### REQ-v12-collision-prefixing (§3.1, §5.3, §8)
- source: `mcpack-prd-v1.1-final.md` §3.1, §5.3
- scope: composeSources()
- description: Build full name map first. Only prefix `source.toolname` when two sources share a tool name. Non-collisions keep original names. Warn explicitly on collision.
- acceptance: Collision test asserts both sources prefixed and warning emitted; non-collision test asserts unprefixed.

#### REQ-v12-call-routing (§3.1, §8)
- source: `mcpack-prd-v1.1-final.md` §3.1, §5.3
- scope: tools/call dispatch
- description: Route `tools/call` to correct source server by tool name (with prefix lookup table).
- acceptance: Test calls collided tool by prefix, asserts correct source receives.

#### REQ-v12-namespace-wildcard-roles (§3.1, §5.2, §8)
- source: `mcpack-prd-v1.1-final.md` §3.1, §5.2
- scope: roles.ts
- description: Role config supports `'*'`, `'crm.*'`, `'crm.get_deals'`. Filter applied across full merged surface at search and execution layers.
- acceptance: `'crm.*'` matches all crm-prefixed tools; `'crm.get_deals'` matches exact; `'*'` matches all.

### Dynamic Role Resolution

#### REQ-v12-resolve-role-hook (§3.2, §5.5, §8)
- source: `mcpack-prd-v1.1-final.md` §3.2, §5.5
- scope: MCPackConfig.resolveRole
- description: `resolveRole(session) → string | Promise<string>` is provider-agnostic. Receives session with headers including Authorization. Called at the transport layer BEFORE source composition runs.
- acceptance: Resolver invoked once per connection; role attached to session before source composition; test asserts ordering.

#### REQ-v12-static-resolver (§5.6, §8)
- source: `mcpack-prd-v1.1-final.md` §5.6
- scope: src/resolvers.ts
- description: Built-in `staticResolver` ships in core. Base64 decodes JWT payload (no signature verification). Maps `email` (or `sub`/`id`) field to role string. `fallbackRole` configurable.
- acceptance: Test maps known email to role; unknown email → fallback role.

#### REQ-v12-google-resolver-package (§3.3, §5.7, §8)
- source: `mcpack-prd-v1.1-final.md` §3.3, §5.7
- scope: separate package `@llvs/mcpack-google`
- description: `googleResolver({ roles, fallbackRole, audience })` verifies Google JWT against JWKS, extracts email, maps to role. Uses `google-auth-library ^9.0.0`. Peer-depends on `@llvs/mcpack ^1.2.0`. Caches JWKS keys, refreshes on rotation.
- acceptance: `@llvs/mcpack-google@1.2.0` published. Integration test verifies real Google JWT (recorded fixture).

### HTTP/SSE Transport

#### REQ-v12-sse-transport (§3.5, §5.5, §8)
- source: `mcpack-prd-v1.1-final.md` §3.5, §5.5
- scope: src/transport.ts
- description: New `transport: { type: 'sse', port?: 3000, path?: '/sse' }`. SSE server starts on configured port. stdio remains valid.
- acceptance: Integration test connects SSE client, exchanges initialize and tools/list.

#### REQ-v12-bearer-extraction (§4.1, §5.5, §8)
- source: `mcpack-prd-v1.1-final.md` §4.1, §5.5
- scope: src/transport.ts
- description: Extract `Authorization: Bearer <token>` from incoming SSE request headers at the transport boundary. Pass headers to `resolveRole(session)` before MCP session is established.
- acceptance: Test asserts headers present in `session.headers.authorization` when handler runs.

#### REQ-v12-graceful-shutdown (§5.5, §8)
- source: `mcpack-prd-v1.1-final.md` §5.5
- scope: shutdown lifecycle
- description: Stop accepting new connections, SIGTERM all stdio children, wait up to 2s per process, SIGKILL stragglers, close SSE server.
- acceptance: Test spawns child, triggers shutdown, asserts child exits within 2s normally / 4s under SIGKILL.

### Cross-Cutting

#### REQ-v12-public-api-unchanged
- source: `mcpack-prd-v1.1-final.md` §8 ("All v1.0 wrap mode and build mode behavior unchanged")
- scope: API surface
- description: `mcpack()` and `createMCPackServer()` signatures byte-identical to v1.0. `MCPackServerConfig` extends `MCPackConfig` with optional `name`, `version`, `tools[]`, `sources[]`, `transport`. Existing v1.0 calls compile unmodified.
- acceptance: Existing v1.0 tests pass unmodified.

#### REQ-v12-zero-core-deps
- source: board decision (carried) + DEC-BOARD-04
- scope: package.json
- description: `@llvs/mcpack` core stays zero-dep. Google auth lives in `@llvs/mcpack-google` only.
- acceptance: package.json diff shows no new core `dependencies`.

#### REQ-v12-all-v10-tests-pass (§8)
- source: `mcpack-prd-v1.1-final.md` §8
- scope: regression
- description: All v1.0 tests continue to pass unmodified.
- acceptance: vitest run on v1.0 test files succeeds with zero edits.

#### REQ-v12-new-test-suite (§8)
- source: `mcpack-prd-v1.1-final.md` §8
- scope: testing
- description: Add tests for multi-source composition, collision handling, inverted index (if adopted), deterministic search, Google JWT resolution, static resolver, SSE transport, graceful shutdown.
- acceptance: Each suite runs and passes.

#### REQ-v12-search-engine-direction (§3.4, §5.4) — DEFERRED DECISION
- source: `mcpack-prd-v1.1-final.md` §3.4, §5.4
- scope: src/search.ts
- description: PRD proposes replacing v1.0 5-tier scorer with a deterministic weighted inverted index (TOOL_NAME=10, DESCRIPTION=5, PARAM_NAME=2). **In v1.1 the 5-tier scorer remains in place as the keyword leg of the hybrid ranker (DEC-v11-13).** v1.2 may either (a) swap the keyword leg for the inverted index, (b) keep both side-by-side, or (c) keep the 5-tier scorer untouched. **Decision deferred to a v1.2 ADR before phase planning.**
- acceptance: ADR authored before v1.2 Phase 1 plan; phase tasks aligned with ADR outcome.

#### REQ-v12-publish-versions
- source: `mcpack-prd-v1.1-final.md` §12 (rewritten by board)
- scope: release
- description: Publish `@llvs/mcpack@1.2.0` and `@llvs/mcpack-google@1.2.0` to npm. (PRD originally wrote 1.1.0 — overridden by board.)
- acceptance: Both packages live on npm at 1.2.0.

### v1.2 Definition of Done (gate, version-corrected)
- source: `mcpack-prd-v1.1-final.md` §12 (with board version override)
- @llvs/mcpack@1.2.0 published
- @llvs/mcpack-google@1.2.0 published
- Lightweight Google OAuth auth page deployed on Railway
- W2exits partner hub deployed on Railway using v1.2
- Brian authenticates with Google account, connects via Claude Code, sees only co-founder scoped tools across all sources
- Smush connects to Virtus hub with Google account, sees partner-scoped tools
- All §8 acceptance criteria pass
- Docs site updated with multi-source, Google OAuth, gateway examples
- README repositioned: RBAC and gateway first, token reduction secondary

### v1.2 Non-Goals
- source: `mcpack-prd-v1.1-final.md` §9 (with synthesizer scope re-evaluation note)
- Token expiry / refresh automation (return clear error, partner re-visits auth page)
- Audit log exposure endpoint (deferred — re-evaluate for v1.2 inclusion vs v1.3)
- Rate limiting per role (deferred — re-evaluate for v1.2 inclusion vs v1.3)
- Per-project role scoping (deferred — re-evaluate for v1.2 inclusion vs v1.3)
- WorkOS and Auth0 resolvers (deferred — required for enterprise; re-evaluate for v1.2)
- Shared hosted gateway with team management dashboard (Layer 3 — future product)
- Cluster / multi-node deployment (single Railway instance sufficient)
- Semantic / embedding-based search — **OVERRIDDEN BY BOARD: ships in v1.1, not v1.2**
- Commercial pricing model (defined jointly with enterprise partners)

> **Synthesizer note on non-goals:** The v1.2 PRD's "deferred to v1.2" items (audit log, rate limiting, per-project scoping, WorkOS/Auth0 resolvers) were authored against the original v1.1 framing. With the board's milestone reassignment, the roadmapper must explicitly decide which of these items move INTO v1.2 scope and which slip to v1.3. Captured here for that downstream decision; not pre-resolved by synthesizer.

### v1.2 Risks
- source: `mcpack-prd-v1.1-final.md` §10
- MCP SDK `setRequestHandler` low-level dependency — monitor SDK releases for breaking changes
- Google JWKS keys rotate periodically — cache with TTL, refresh on verification failure
- Source MCP servers spawn at startup; post-startup source crash → return `isError: true`, do not crash gateway
- Graceful shutdown can take up to 4s per stdio process — 10+ sources may exceed Railway shutdown timeout; document max recommended sources
- Google JWT lifetime ~1 hour — partners need re-authentication; mid-session expiry disconnects partner
- MCP protocol gateway patterns being standardized — monitor SDK gateway-related updates
