# Decisions (Synthesized Intel)

> Extracted from PRD `locked_decisions` blocks. These are PRD-level locked decisions, NOT Accepted ADRs — they carry PRD precedence (3) unless promoted. Board overrides are flagged inline.

---

## v1.1 Milestone — Search & Observability

Source: `/Users/zaid/Projects/MCPack/.planning/inbox/mcpack-prd-v1.1-gsd.md`
Target milestone (board-confirmed): **v1.1.0**

### DEC-v11-01 — Public API byte-for-byte identical to v1.0
- source: `mcpack-prd-v1.1-gsd.md` (Goals + R3.2)
- scope: `mcpack()`, `createMCPackServer()` signatures
- statement: Public entry-point signatures unchanged from v1.0. `MCPackConfig` only gains optional fields (`embeddings`, `analytics`).
- board-locked: yes (carried forward from v1.0 invariant)

### DEC-v11-02 — Core stays zero runtime dependencies
- source: `mcpack-prd-v1.1-gsd.md` (Goals + R3.1)
- scope: `@llvs/mcpack` package
- statement: `@llvs/mcpack` adds zero new runtime dependencies in v1.1. Only peer dep remains `@modelcontextprotocol/sdk`.
- board-locked: yes (non-negotiable v1.0 invariant)

### DEC-v11-03 — Adapter package pattern: model deps live outside core
- source: `mcpack-prd-v1.1-gsd.md` (R3.1)
- scope: `@llvs/mcpack-embeddings`
- statement: `@huggingface/transformers` and any other model deps live exclusively in `@llvs/mcpack-embeddings`. Core ships no embedding implementation.
- board-locked: yes
- clerical-correction (board 2026-04-25, post-research): PRD body cites `@xenova/transformers`. That npm package was renamed to `@huggingface/transformers` in October 2024 and the legacy name is frozen at v2.17.2 (May 2024). Successor is at v4.x, actively maintained by HuggingFace (same repo). API-compatible for our pipeline('feature-extraction', ...) usage. Board approved switch 2026-04-25 — no scope change, just current-name correction.

### DEC-v11-03a — Phase 6 package layout: sibling directory under packages/
- source: board decision 2026-04-25 (post-research, Phase 6 planning gate)
- scope: repository layout
- statement: `@llvs/mcpack-embeddings` lives at `packages/mcpack-embeddings/` as a sibling directory. No monorepo tooling (no npm/pnpm/yarn workspaces) in v1.1. Existing `src/` and root `package.json` are unchanged — `npm run build`, `npm test`, `npm run harness`, `npm run test:coverage` continue to work without script changes. Migrate to npm workspaces in v1.2 when `@llvs/mcpack-google` arrives as the third package.
- rationale: Lowest-risk path for v1.1. Workspace tooling pays for itself at 3+ packages, not 2.
- board-locked: yes (revisit at v1.2 milestone open)

### DEC-v11-03b — Core package version bumps to 1.1.0 in Phase 6 (publish at Phase 10)
- source: board decision 2026-04-25 (post-research, Phase 6 planning gate)
- scope: `@llvs/mcpack` package.json version field
- statement: Phase 6 bumps core `package.json` from `1.0.0` to `1.1.0`. This satisfies the adapter's peer-dep declaration (`@llvs/mcpack-embeddings` peer-deps `^1.1.0`) so local install/test resolves cleanly during phases 6–9. The actual `npm publish @llvs/mcpack@1.1.0` happens in Phase 10. Standard "version-in-development" pattern.
- board-locked: yes

### DEC-v11-04 — ESM-only with NodeNext, TypeScript strict + verbatimModuleSyntax
- source: `mcpack-prd-v1.1-gsd.md` (R3.3)
- scope: build output
- statement: v1.1 remains ESM-only. No CommonJS output.

### DEC-v11-05 — Role filtering applied AFTER ranking
- source: `mcpack-prd-v1.1-gsd.md` (R1.7)
- scope: search pipeline
- statement: Full tool surface is scored, then results filtered to session role's permitted tools. Preserves opaque denial.

### DEC-v11-06 — Opaque denial preserved
- source: `mcpack-prd-v1.1-gsd.md` (R3.6)
- scope: tools/call error path
- statement: Out-of-role `tools/call` continues to return `"Unknown tool: {name}"`.

### DEC-v11-07 — tools/list always returns exactly one tool with no v1.1 added latency
- source: `mcpack-prd-v1.1-gsd.md` (R3.5)
- scope: tools/list path
- statement: Index build is async, non-blocking. `tools/list` returns one tool (`search_tools`) with no v1.1 latency added.

### DEC-v11-08 — Session schema-loaded references preserved
- source: `mcpack-prd-v1.1-gsd.md` (R3.6)
- scope: session caching
- statement: Schemas loaded once per session still return as `{loaded: true}` references — v1.0 invariant unchanged.

### DEC-v11-09 — Analytics is in-memory only
- source: `mcpack-prd-v1.1-gsd.md` (R2.2)
- scope: AnalyticsStore
- statement: All analytics data stored in-memory within the MCPack server instance. No disk writes, no network egress, resets on process restart.

### DEC-v11-10 — Analytics never expose tools outside querying role
- source: `mcpack-prd-v1.1-gsd.md` (R2.3, R2.7)
- scope: getAnalytics() return values
- statement: Role-scoped analytics responses contain zero references to tools outside that role. `deadTools` only enumerates tools the role can see.

### DEC-v11-11 — getAnalytics() is on server handle, never exposed as MCP tool
- source: `mcpack-prd-v1.1-gsd.md` (R2.6)
- scope: API surface
- statement: `getAnalytics()` returns from `mcpack()` / `createMCPackServer()` handle. Never callable via the MCP wire protocol.

### DEC-v11-12 — Hybrid ranking default weights 0.7 semantic / 0.3 keyword
- source: `mcpack-prd-v1.1-gsd.md` (R1.6)
- scope: search scoring
- statement: Default `semanticWeight: 0.7`, `keywordWeight: 0.3`. When no `EmbeddingProvider` is configured, `keywordWeight` is implicitly 1.0 — exact v1.0 behavior.

### DEC-v11-13 — Hybrid ranker keeps v1.0 5-tier scorer as keyword leg
- source: `mcpack-prd-v1.1-gsd.md` (R1.6 + R1.9 backward compat)
- scope: src/search.ts
- statement: v1.1 hybrid ranker = semantic score + v1.0 5-tier keyword score combined via weights. The v1.0 scorer remains in place as the keyword leg. (Auto-resolved against v1.2 PRD's "replace 5-tier scorer with inverted index" — see INFO entry in CONFLICTS report; v1.2 may revisit the keyword leg in a separate ADR.)

### DEC-v11-14 — Stripe harness floor: at least 80.7% token reduction
- source: `mcpack-prd-v1.1-gsd.md` (Goals + Success Criteria)
- scope: regression gate
- statement: With hybrid ranking enabled, Stripe MCP harness must show at least 80.7% aggregate token reduction. No regression vs v1.0.

### DEC-v11-15 — Test floor: at least 120 tests at at least 99% statement coverage
- source: `mcpack-prd-v1.1-gsd.md` (R3.4)
- scope: testing
- statement: Up from 100/99.56% to at least 120/99%.

---

## v1.2 Milestone — Partner Hub (board-deferred from PRD-claimed v1.1)

Source: `/Users/zaid/Projects/MCPack/.planning/inbox/mcpack-prd-v1.1-final.md`
Target milestone (board-confirmed): **v1.2.0**
Doc-claimed milestone: v1.1 (overridden by board 2026-04-25 — see INFO conflict)

### DEC-v12-01 — Auth resolution at transport layer BEFORE source composition
- source: `mcpack-prd-v1.1-final.md` (§2.3, §4.1)
- scope: auth/transport boundary
- statement: Auth validation happens at the transport layer before source composition runs. Auth provider is never a source. Resolves circular dependency cleanly.
- board-locked: yes (architectural invariant)

### DEC-v12-02 — resolveRole(session) is the provider-agnostic extension point
- source: `mcpack-prd-v1.1-final.md` (§3.2, §7)
- scope: auth pluggability
- statement: `resolveRole(session) → string | Promise<string>` is the sole extension point. Built-in resolvers ship in separate packages (`@llvs/mcpack-google`, `@llvs/mcpack-workos`, `@llvs/mcpack-auth0`).
- board-locked: yes (adapter package pattern)

### DEC-v12-03 — @llvs/mcpack-google ships in v1.2 alongside core
- source: `mcpack-prd-v1.1-final.md` (§3.2, §5.7)
- scope: package matrix
- statement: `@llvs/mcpack-google` ships in v1.2. WorkOS and Auth0 deferred to a later milestone.

### DEC-v12-04 — Tool name collisions prefixed with source.toolname; non-collisions unchanged
- source: `mcpack-prd-v1.1-final.md` (§3.1, §5.3)
- scope: multi-source naming
- statement: Build full name map across all sources first. Only prefix when two sources share a tool name. Non-colliding tools keep original names. Warn explicitly on collision.

### DEC-v12-05 — Role config supports namespace wildcards
- source: `mcpack-prd-v1.1-final.md` (§5.2)
- scope: RoleConfig
- statement: Wildcards `'*'`, `'crm.*'`, `'crm.get_deals'` all valid.

### DEC-v12-06 — Graceful shutdown: SIGTERM, 2s wait per process, SIGKILL stragglers
- source: `mcpack-prd-v1.1-final.md` (§5.5)
- scope: stdio child lifecycle
- statement: Stop accepting connections, SIGTERM all stdio children, wait up to 2s per process, SIGKILL any remaining, close SSE server.

### DEC-v12-07 — @llvs/mcpack-google peer-depends on @llvs/mcpack ^1.2.0; uses google-auth-library ^9.0.0
- source: `mcpack-prd-v1.1-final.md` (§5.7) — VERSION REWRITTEN BY BOARD
- scope: dependency graph
- statement: `@llvs/mcpack-google` peer-depends on `@llvs/mcpack ^1.2.0` (PRD originally wrote ^1.1.0 — overridden by board milestone reassignment) and uses `google-auth-library ^9.0.0`. Core stays zero-dependency.
- doc-original-version: ^1.1.0 (rewritten to ^1.2.0 by board decision)

### DEC-v12-08 — Static resolver does NOT verify JWT signatures
- source: `mcpack-prd-v1.1-final.md` (§5.6)
- scope: staticResolver
- statement: Base64-decodes JWT payload only — no signature verification. Use only when transport is trusted (local stdio, internal network).

### DEC-v12-09 — Token-based deterministic inverted index for search (v1.2-only consideration)
- source: `mcpack-prd-v1.1-final.md` (§3.4, §5.4)
- scope: src/search.ts (v1.2 candidate)
- statement: PRD §3.4 proposes replacing v1.0 5-tier scorer with a deterministic weighted inverted index (TOOL_NAME=10, DESCRIPTION=5, PARAM_NAME=2). **Auto-resolved against v1.1 hybrid keyword leg:** v1.1 (DEC-v11-13) keeps the 5-tier scorer. v1.2 may swap the keyword leg to the inverted index OR keep both side-by-side. Decision deferred to a v1.2 ADR — not locked here. See INFO entry in conflicts report.

### DEC-v12-10 — Public API of v1.0 remains byte-for-byte identical through v1.2
- source: `mcpack-prd-v1.1-final.md` (§8 acceptance criteria — "All v1.0 wrap mode and build mode behavior unchanged")
- scope: `mcpack()`, `createMCPackServer()`
- statement: Public entry-point signatures unchanged. `MCPackServerConfig` extends `MCPackConfig` with new optional fields (`sources`, `transport`).
- board-locked: yes

### DEC-v12-11 — HTTP/SSE transport on configured port (default 3000, default path /sse)
- source: `mcpack-prd-v1.1-final.md` (§3.5, §5.5)
- scope: transport module
- statement: New transport mode `'sse'` with default `port: 3000` and `path: '/sse'`. stdio remains valid. Authorization Bearer header extracted at transport boundary.

### DEC-v12-12 — Definition of Done version numbers rewritten 1.1.0 → 1.2.0
- source: `mcpack-prd-v1.1-final.md` (§12 + board override 2026-04-25)
- scope: release artifacts
- statement: All `@llvs/mcpack@1.1.0` and `@llvs/mcpack-google@1.1.0` references in this PRD are rewritten to `1.2.0`. The v1.1.0 npm version belongs to the sibling PRD (Search & Observability).
- doc-original-version: 1.1.0 (rewritten to 1.2.0 by board)

---

## Cross-Milestone Locks (Board Decisions, 2026-04-25)

### DEC-BOARD-01 — v1.1 milestone slot belongs to Search & Observability PRD
- source: board decision 2026-04-25
- statement: `mcpack-prd-v1.1-gsd.md` is the v1.1 milestone (semantic search hook + getAnalytics + @llvs/mcpack-embeddings). Doc-internal version claim aligns with board decision.
- board-locked: yes

### DEC-BOARD-02 — v1.2 milestone slot belongs to Partner Hub PRD
- source: board decision 2026-04-25
- statement: `mcpack-prd-v1.1-final.md` is the v1.2 milestone (multi-source + dynamic role resolution + Google OAuth + HTTP/SSE + @llvs/mcpack-google). Doc body claims v1.1.0 — overridden to v1.2.0.
- board-locked: yes

### DEC-BOARD-03 — Semantic search ships in v1.1, not v1.2
- source: board decision 2026-04-25
- statement: Partner Hub PRD §11 defers semantic search to v1.2 — overridden. Per v1.1 milestone assignment, semantic search ships in v1.1 via the EmbeddingProvider hook + `@llvs/mcpack-embeddings`.
- board-locked: yes

### DEC-BOARD-04 — Core zero-dep invariant carries forward through both milestones
- source: board decision 2026-04-25 (carried from v1.0)
- statement: `@llvs/mcpack` core stays zero-dep through v1.1 and v1.2. Any incoming requirement that adds a runtime dep to core (vs an adapter package) is a hard BLOCKER.
- board-locked: yes

### DEC-BOARD-05 — Adapter package pattern is the v1.1+ contract
- source: board decision 2026-04-25
- statement: All model/auth dependencies live in sibling packages (`@llvs/mcpack-embeddings`, `@llvs/mcpack-google`, future `@llvs/mcpack-workos`, `@llvs/mcpack-auth0`). Never in core.
- board-locked: yes
