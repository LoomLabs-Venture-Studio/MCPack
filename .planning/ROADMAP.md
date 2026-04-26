# Roadmap: MCPack

## Milestones

- ✅ **v1.0 MCPack** — Phases 1-5 (shipped 2026-03-23)
- 🚧 **v1.1 Search & Observability** — PRD ingested 2026-04-25, planning
- ⏸ **v1.2 Partner Hub** — PRD ingested 2026-04-25, DEFERRED until v1.1 ships

## Phases

<details>
<summary>✅ v1.0 MCPack (Phases 1-5) — SHIPPED 2026-03-23</summary>

- [x] Phase 1: Foundation and Leaf Modules (2/2 plans) — completed 2026-03-20
- [x] Phase 2: Core Engine and Wrap Mode (2/2 plans) — completed 2026-03-20
- [x] Phase 3: Build Mode (2/2 plans) — completed 2026-03-21
- [x] Phase 4: Testing and Integration Harness (2/2 plans) — completed 2026-03-22
- [x] Phase 5: Documentation and Release Prep (2/2 plans) — completed 2026-03-22
- [x] Phase 5.1: Landing Page (inserted) — completed 2026-03-22

</details>

### v1.1 — Search & Observability (active)

**Source PRD:** `.planning/inbox/mcpack-prd-v1.1-gsd.md`
**Board decisions:** DEC-BOARD-01 (v1.1 slot), DEC-BOARD-03 (semantic ships v1.1), DEC-BOARD-04 (zero-dep core), DEC-BOARD-05 (adapter pattern)
**GA gate:** Phase 5 complete with all v1.1 Success Criteria passing (see REQUIREMENTS.md → Success Criteria — v1.1)

- [ ] **Phase 6: EmbeddingProvider Interface + Adapter Scaffold** — Define `EmbeddingProvider` type, wire optional `embeddings` config, scaffold `@llvs/mcpack-embeddings` package with MiniLM adapter
- [ ] **Phase 7: Semantic Index Build Pipeline** — Async, non-blocking startup index build; concatenated indexing string per tool; in-memory vector map
- [ ] **Phase 8: Hybrid Ranking Query Path** — Query embedding + cosine similarity; hybrid score (0.7 semantic / 0.3 keyword default); role filter applied AFTER ranking
- [ ] **Phase 9: Tool Usage Analytics** — `AnalyticsStore` (search/call/denial/miss events), `getAnalytics()` API on server handle, role-scoped queries, dead-tool detection
- [ ] **Phase 10: Harness Verification, Coverage, Docs, npm publish** — ≥120 tests / ≥99% coverage, Stripe harness ≥80.7%, 50-query intent benchmark ≥15% recall, docs update, publish `@llvs/mcpack@1.1.0` and `@llvs/mcpack-embeddings@1.1.0`

### v1.2 — Partner Hub (DEFERRED)

**Source PRD:** `.planning/inbox/mcpack-prd-v1.1-final.md` (board-overridden from PRD-claimed v1.1)
**Status:** DEFERRED — do not open until v1.1 ships
**Board decisions:** DEC-BOARD-02 (v1.2 slot + version override 1.1.0 → 1.2.0), DEC-BOARD-04 (zero-dep core), DEC-BOARD-05 (adapter pattern)
**Pre-Phase-1 requirement:** Author v1.2 ADR for `REQ-v12-search-engine-direction` (decide whether the keyword leg of the hybrid ranker swaps to the inverted index, runs side-by-side, or stays on the v1.0 5-tier scorer). Phase plans cannot start until this ADR is accepted.
**Non-goals re-evaluation flag:** PRD §9 non-goals were authored against the original v1.1 framing. Items needing explicit in-scope-vs-slip-to-v1.3 decisions before phase planning: WorkOS resolver, Auth0 resolver, audit log endpoint, rate limiting per role, per-project role scoping, token expiry/refresh automation. The "semantic search deferred" non-goal is stale (board moved it to v1.1) and should be dropped.
**GA gate:** PRD §12 Definition of Done with versions corrected to 1.2.0.

- [ ] **Phase 11: Multi-Source Composition + Collision Handling + Routing** — `sources[]` config, stdio child spawn, merged index, `source.toolname` collision prefixing, namespace-wildcard role filtering, dispatch routing
- [ ] **Phase 12: `resolveRole` Hook + `staticResolver` in Core + Transport-Boundary Auth Extraction** — Provider-agnostic `resolveRole(session)` extension point, base64-payload-only `staticResolver`, auth runs at transport BEFORE source composition
- [ ] **Phase 13: HTTP/SSE Transport + Graceful Shutdown** — `transport: { type: 'sse', port?: 3000, path?: '/sse' }`, `Authorization: Bearer` header extraction, SIGTERM/2s/SIGKILL shutdown lifecycle
- [ ] **Phase 14: `@llvs/mcpack-google` Package + Google JWKS Verification + Railway Auth Page** — `googleResolver({ roles, fallbackRole, audience })`, JWKS cache + rotation refresh, lightweight Express/Hono auth page (`/auth`, `/auth/callback`)
- [ ] **Phase 15: Tests, Docs, Harness, npm Publish** — Multi-source/collision/SSE/Google JWT/static resolver/shutdown test suites, all v1.0 tests pass unmodified, docs update (multi-source + Google OAuth + gateway examples), README repositioning (RBAC + gateway primary, token reduction secondary), publish `@llvs/mcpack@1.2.0` and `@llvs/mcpack-google@1.2.0`

## Phase Details

### Phase 6: EmbeddingProvider Interface + Adapter Scaffold (v1.1)
**Goal**: Provide a zero-core-dep semantic-search hook plus a scaffolded sibling adapter package, so v1.0 deployments can opt in without changing core.
**Depends on**: v1.0 (shipped)
**Requirements**: REQ-v11-semantic-provider-interface, REQ-v11-embeddings-optional-config, REQ-v11-mcpack-embeddings-package, REQ-v11-zero-core-deps, REQ-v11-public-api-lock, REQ-v11-esm-only
**Success Criteria** (what must be TRUE):
  1. `EmbeddingProvider = (texts: string[]) => Promise<number[][]>` exported from `@llvs/mcpack` entry, mock provider verifies batch contract in tests
  2. `MCPackConfig` accepts an optional `embeddings` field; with no `embeddings` configured, search code path is byte-identical to v1.0
  3. `@llvs/mcpack-embeddings` package scaffolded with MiniLM adapter using `@xenova/transformers` as optional peer dep — never required by core
  4. `@llvs/mcpack` package.json shows zero new `dependencies` entries vs v1.0
  5. Existing v1.0 calling code compiles unmodified against new types
**Plans:** 2 plans

Plans:
- [x] 06-01-PLAN.md — Core type plumbing: add EmbeddingProvider type + MCPackConfig.embeddings field; bump @llvs/mcpack to 1.1.0; type-contract tests
- [ ] 06-02-PLAN.md — Adapter package scaffold: create packages/mcpack-embeddings/ with MiniLM factory against @huggingface/transformers ^4.0.0; gated smoke tests

### Phase 7: Semantic Index Build Pipeline (v1.1)
**Goal**: Build a non-blocking semantic index at startup so semantic queries have vectors available without any v1.1-added latency on `tools/list`.
**Depends on**: Phase 6
**Requirements**: REQ-v11-semantic-index-build, REQ-v11-tools-list-no-regression, REQ-v11-perf-budget
**Success Criteria** (what must be TRUE):
  1. When `EmbeddingProvider` is configured, index build runs async at startup with concatenated `name + description + param-names` per tool, single-batch call
  2. `tools/list` returns one tool with no v1.1-added latency (within v1.0 noise floor on benchmark)
  3. If a query arrives before the index is ready, search falls back to v1.0 keyword scoring and logs a warning — `search_tools` is never blocked
  4. 50-tool index builds within 5s on commodity hardware with local MiniLM, memory ≤ 2MB
**Plans**: TBD

### Phase 8: Hybrid Ranking Query Path (v1.1)
**Goal**: Combine semantic and keyword scoring into a single ranked output that preserves v1.0 keyword behavior when no embeddings are configured.
**Depends on**: Phase 7
**Requirements**: REQ-v11-semantic-query-path, REQ-v11-hybrid-ranking, REQ-v11-role-filter-after-rank, REQ-v11-backward-compat, REQ-v11-session-invariants
**Success Criteria** (what must be TRUE):
  1. Per-query embedding produces semantic score in [-1, 1] via cosine similarity (unit-tested utility)
  2. Final score = `(semanticWeight * semanticScore) + (keywordWeight * keywordScore)` with defaults 0.7 / 0.3; v1.0 5-tier scorer remains as the keyword leg (DEC-v11-13)
  3. With no `EmbeddingProvider`, the keyword-only path runs unchanged (implicit `keywordWeight: 1.0`) and existing v1.0 tests pass unmodified
  4. Role filtering applied AFTER ranking — restricted tools never appear in output regardless of score; opaque denial preserved
  5. Schemas-loaded `{loaded: true}` references and `"Unknown tool: {name}"` denial behavior unchanged
**Plans**: TBD

### Phase 9: Tool Usage Analytics (v1.1)
**Goal**: Give operators in-process visibility into search/call/denial/miss patterns and dead tools without exposing analytics over the MCP wire.
**Depends on**: Phase 8
**Requirements**: REQ-v11-analytics-events, REQ-v11-analytics-storage, REQ-v11-analytics-privacy, REQ-v11-analytics-api, REQ-v11-analytics-role-scoped-query, REQ-v11-analytics-rbac-integrity, REQ-v11-dead-tool-detection
**Success Criteria** (what must be TRUE):
  1. `AnalyticsStore` captures four event types — `search`, `call`, `denial`, `miss` — at the correct decision points; counts match a known call sequence in integration test
  2. Storage is in-memory only (no disk, no network, resets on process restart); event arrays capped at configurable `maxEvents` (default 10,000), oldest dropped on overflow
  3. `getAnalytics(options?)` returns `AnalyticsSnapshot { searches, calls, denials, misses, summary.byRole[role]: { searchCount, callCount, denialCount, missCount, topTools[5], deadTools[] } }` from the server handle returned by `mcpack()` / `createMCPackServer()`
  4. Role-scoped query (`getAnalytics({ role })`) returns zero references to tools outside that role; denial events for a role-scoped query never reveal restricted tool names
  5. `getAnalytics` is NOT callable via the MCP wire protocol — agent attempt returns `"Unknown tool"`
  6. `summary.byRole[role].deadTools` lists tools that role can see but has zero `call` events for in the current session
**Plans**: TBD

### Phase 10: Harness, Coverage, Docs, npm Publish (v1.1)
**Goal**: Ship v1.1 with measurable regression-free upgrades and the dual-package release.
**Depends on**: Phase 9
**Requirements**: REQ-v11-test-coverage-floor, REQ-v11-perf-budget, REQ-v11-tools-list-no-regression
**Success Criteria** (what must be TRUE):
  1. `vitest run` reports ≥120 tests at ≥99% statement coverage
  2. Stripe MCP harness reports ≥80.7% aggregate token reduction with hybrid ranking enabled
  3. 50-query intent benchmark shows ≥15% recall improvement over v1.0 keyword baseline (with MiniLM configured)
  4. `search_tools` p99 within 50ms of v1.0 baseline using local MiniLM
  5. Docs site updated (semantic search hook, analytics, adapter package); README updated with v1.1 examples
  6. `@llvs/mcpack@1.1.0` and `@llvs/mcpack-embeddings@1.1.0` published to npm; existing v1.0 deployments upgrade with zero config changes
**Plans**: TBD

### Phase 11: Multi-Source Composition + Collision Handling + Routing (v1.2 — DEFERRED)
**Goal**: Compose multiple upstream MCPs behind one MCPack gateway with deterministic naming and dispatch.
**Depends on**: v1.1 ship + accepted v1.2 ADR for REQ-v12-search-engine-direction
**Requirements**: REQ-v12-sources-array, REQ-v12-collision-prefixing, REQ-v12-call-routing, REQ-v12-namespace-wildcard-roles, REQ-v12-public-api-unchanged, REQ-v12-zero-core-deps
**Success Criteria** (what must be TRUE):
  1. `createMCPackServer` accepts `sources[]` of named MCP server instances; each spawned as stdio child at startup; tools pulled via `tools/list` and merged into one index
  2. Collisions prefixed `source.toolname` with explicit warning; non-collisions keep original names
  3. `tools/call` routes to the correct source by tool name (with prefix lookup); collided tools require prefix
  4. `RoleConfig` supports `'*'`, `'crm.*'`, `'crm.get_deals'` patterns across the merged surface at search and execution layers
  5. v1.0 + v1.1 public API surface byte-identical; existing tests pass unmodified
**Plans**: TBD

### Phase 12: resolveRole Hook + staticResolver + Transport-Boundary Auth (v1.2 — DEFERRED)
**Goal**: Provider-agnostic dynamic role resolution that runs at the transport layer before source composition (no circular dependency).
**Depends on**: Phase 11
**Requirements**: REQ-v12-resolve-role-hook, REQ-v12-static-resolver
**Success Criteria** (what must be TRUE):
  1. `resolveRole(session) → string | Promise<string>` invoked once per connection, role attached to session BEFORE source composition runs (test asserts ordering)
  2. Built-in `staticResolver({ roles, fallbackRole?, identifierField? })` ships in core; base64-decodes JWT payload only (no signature verification)
  3. Known email maps to configured role; unknown email maps to fallback role
  4. Auth provider is never a source — circular dependency rejected by design
**Plans**: TBD

### Phase 13: HTTP/SSE Transport + Graceful Shutdown (v1.2 — DEFERRED)
**Goal**: Add a remote-callable transport so partner Claude Code clients can connect over HTTPS, with a clean shutdown path for stdio children.
**Depends on**: Phase 12
**Requirements**: REQ-v12-sse-transport, REQ-v12-bearer-extraction, REQ-v12-graceful-shutdown
**Success Criteria** (what must be TRUE):
  1. `transport: { type: 'sse', port?: 3000, path?: '/sse' }` starts SSE server on configured port; stdio remains valid
  2. SSE client connects, exchanges `initialize` and `tools/list` in integration test
  3. `Authorization: Bearer <token>` extracted at transport boundary and present as `session.headers.authorization` when handler runs
  4. Shutdown flow: stop accepting connections → SIGTERM stdio children → wait up to 2s/process → SIGKILL stragglers → close SSE server (test asserts clean exit ≤ 2s, forced exit ≤ 4s)
**Plans**: TBD

### Phase 14: @llvs/mcpack-google Package + JWKS Verification + Auth Page (v1.2 — DEFERRED)
**Goal**: Ship the first real auth resolver for venture-studio partners using existing Google accounts.
**Depends on**: Phase 13
**Requirements**: REQ-v12-google-resolver-package
**Success Criteria** (what must be TRUE):
  1. `@llvs/mcpack-google@1.2.0` peer-depends on `@llvs/mcpack ^1.2.0`, runtime depends on `google-auth-library ^9.0.0`; core package.json gains zero new deps
  2. `googleResolver({ roles, fallbackRole, audience })` verifies Google JWT against JWKS, extracts email, maps to role; integration test verifies a recorded real Google JWT
  3. JWKS keys cached with refresh on rotation/verification failure
  4. Lightweight Express/Hono auth page deployed on Railway with `/auth` and `/auth/callback` routes — partner copies JWT and pastes into Claude Code config
**Plans**: TBD

### Phase 15: Tests, Docs, Harness, npm Publish at 1.2.0 (v1.2 — DEFERRED)
**Goal**: Close the v1.2 milestone with the full test matrix, docs repositioning, and the dual-package release.
**Depends on**: Phase 14
**Requirements**: REQ-v12-all-v10-tests-pass, REQ-v12-new-test-suite, REQ-v12-publish-versions
**Success Criteria** (what must be TRUE):
  1. All v1.0 tests pass unmodified (vitest run with zero edits to v1.0 test files); all v1.1 tests pass unmodified
  2. New test suites run and pass: multi-source composition, collision handling, deterministic search (per accepted ADR), Google JWT resolution, static resolver, SSE transport, graceful shutdown
  3. W2exits Partner Hub deployed on Railway using v1.2; Brian (cofounder) sees only co-founder-scoped tools across sources via Google JWT; Smush connects to Virtus hub and sees partner-scoped tools
  4. Docs site updated with multi-source, Google OAuth, gateway examples; README repositioned (RBAC + gateway primary, token reduction secondary)
  5. `@llvs/mcpack@1.2.0` and `@llvs/mcpack-google@1.2.0` published to npm
**Plans**: TBD

## Backlog

### Phase 999.1: CI/CD Pipeline (BACKLOG)

**Goal:** GitHub Actions workflow for automated quality gates on pull requests — lint, typecheck, vitest
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)
