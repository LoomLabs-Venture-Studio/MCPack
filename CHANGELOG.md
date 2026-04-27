# Changelog

All notable changes to `@llvs/mcpack` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-04-27

### Added

- **`EmbeddingProvider` interface** (`(texts: string[]) => Promise<number[][]>`) on `MCPackConfig.embeddings.provider` — opt-in hook for semantic search. Core ships zero embedding implementation; the sibling adapter package [`@llvs/mcpack-embeddings`](./packages/mcpack-embeddings/README.md) provides a local MiniLM implementation via `@huggingface/transformers ^4.0.0`.
- **Hybrid ranking query path** — when `embeddings` is configured, `search_tools` returns results ranked by `final = 0.7 * normalize(semantic) + 0.3 * normalize(keyword)`. Weights are configurable via `MCPackConfig.embeddings.weights` (`{ semanticWeight, keywordWeight }`).
- **Non-blocking startup index build** — semantic vectors are computed asynchronously after construction; `tools/list` returns within v1.0 noise floor regardless of build state. Poll `handle.isIndexReady()` if you need to wait for vectors. New `handle.hasVectors()` reports vector availability for diagnostics.
- **Build-pending fallback** — queries arriving before vectors are ready fall through to v1.0 keyword scoring with a single warn-once-per-instance log line. `search_tools` is never blocked on the in-flight build.
- **Locked error format for query-embedding failures:** `MCPack: query embedding failed: ${err.message}` — warn-once-per-instance, falls through to keyword path. Restricted tool names never appear in warn messages (RBAC invariant preserved).
- **`MCPackHandle.getAnalytics(options?)`** — operator-only analytics snapshot. Accepts `{ role?: string }`; returns `AnalyticsSnapshot { searches, calls, denials, misses, summary.byRole[role]: { searchCount, callCount, denialCount, missCount, topTools, deadTools } }`.
- **Four analytics event types** — `search` (every `search_tools` invocation), `call` (every successful non-`search_tools` `tools/call`), `denial` (every RBAC-blocked or unknown-name `tools/call`), `miss` (every `search_tools` query returning zero results).
- **Role-scoped privacy semantics** — when `getAnalytics({ role })` is called, events involving tools outside that role's allowed set are dropped entirely (no string redaction). Operator-unscoped queries see everything. Documented in [`docs/analytics.md`](./docs/analytics.md).
- **Dead-tool detection** — `summary.byRole[role].deadTools` lists tools the role can see but has zero recorded `call` events for in the current process lifetime. Useful for trimming role configs.
- **Bounded analytics retention** — `MCPackConfig.analytics.maxEvents` defaults to `10000`; oldest events drop on overflow. In-memory only; resets on process restart.
- **Sibling adapter package `@llvs/mcpack-embeddings@1.1.0`** — local MiniLM (`Xenova/all-MiniLM-L6-v2`) embedding factory. Peer-dep `@llvs/mcpack ^1.1.0`. 384-dim float32 vectors. Opt-in; not a runtime dependency of core.
- New documentation pages: [`docs/semantic-search.md`](./docs/semantic-search.md) and [`docs/analytics.md`](./docs/analytics.md).

### Performance

Measured at Phase 10 close (`.planning/phases/10-harness-coverage-docs-npm-publish-v1-1/v1.1-release-report.md`):

- `search_tools` p99 latency delta vs v1.0 baseline: **3.057 ms** (≤ 50 ms target — PASS).
- Semantic index build for 50-tool MiniLM engine: **216.6 ms** (≤ 5,000 ms target — PASS).
- 50-tool MiniLM vector store memory footprint: **76,800 bytes** (50 vectors × 384 dims × 4 bytes/Float32; ≤ 2 MiB budget — PASS).
- `tools/list` no-regression microbench (median delta, hybrid build-in-flight vs keyword baseline): **0.000 ms** (≤ 5 ms noise floor — PASS).
- Test floor: **234/234 tests passing**, **99.78%** statement coverage.

The two Stripe-dependent PRD targets — Stripe MCP aggregate token reduction (≥ **80.7%**) and 50-query intent benchmark recall@5 delta (≥ 15 pp) — are re-verified during the Plan 10-03 pre-publish step with the operator's `STRIPE_SECRET_KEY`. The `80.7%` figure is the v1.0 anchor measured on the same 28-tool Stripe MCP surface (see v1.0 entry below).

### Compatibility

- **Backward-compatible by construction.** When `embeddings` is unset, the search code path is byte-identical to v1.0 keyword-only behavior (DEC-v11-02; verified by 234/234 tests passing against the Phase 9 baseline `d732eaa`).
- **Public API additive only.** New exports: `EmbeddingProvider`, `AnalyticsEvent`, `AnalyticsByRoleSummary`, `AnalyticsSnapshot`, `AnalyticsOptions`. New `MCPackHandle.getAnalytics()` method. No existing types modified.
- **Zero new core dependencies.** `@llvs/mcpack` `dependencies` and `peerDependencies` unchanged from v1.0. The MiniLM model weights are downloaded by `@huggingface/transformers` only when the operator opts in via the adapter package.
- **Wire-protocol exposure ban.** `getAnalytics()` is reachable only from host-process Node.js code that holds the handle reference. There is no JSON-RPC surface, no `tools/list` entry, no `tools/call` route. Agents invoking `tools/call` with name `getAnalytics` receive the standard opaque-denial `"Unknown tool: getAnalytics"`.
- **Node.js >= 18, ESM only** (unchanged from v1.0).

### Migration

`v1.0 → v1.1 requires zero config changes.` Upgrading is a SemVer-compatible bump; existing wrap-mode and build-mode call sites continue to work unchanged. To enable the new opt-in features:

```ts
// Before (v1.0 — keyword-only, still works in v1.1)
const handle = await mcpack(server, { roles, defaultRole: 'advisor' });

// After (v1.1 — hybrid semantic + keyword ranking)
import { createMiniLMProvider } from '@llvs/mcpack-embeddings';
const handle = await mcpack(server, {
  roles,
  defaultRole: 'advisor',
  embeddings: { provider: await createMiniLMProvider() },
});

// Operator-only analytics (any v1.1 install)
const snap = handle.getAnalytics({ role: 'cofounder' });
```

First-run cost for the adapter: a one-time ~25–90 MB ONNX model download to `node_modules/@huggingface/transformers/.cache/`. Warm-cache embedding calls are sub-second.

## [1.0.0] - 2026-03-23

### Added

- Initial public release of `@llvs/mcpack` to npm.
- **Wrap mode** — retrofit any existing `@modelcontextprotocol/sdk` server with one function call: `mcpack(server, config)`. Intercepts `tools/list` and `tools/call` via in-place handler replacement.
- **Build mode** — construct a new MCP server with RBAC baked in: `createMCPackServer({ name, version, roles, defaultRole, tools })`.
- **RBAC** — role-to-tool allowlists with wildcard `'*'` support and hierarchical inheritance; cycle protection in role resolution.
- **Single discovery tool** — `tools/list` always returns exactly one tool (`search_tools`). Agents query by keyword and receive role-filtered, relevance-ranked schema matches.
- **5-tier weighted keyword scoring** — name exact match, name prefix, description, params, schema-keywords; STOP_WORDS-aware tokenization.
- **Session tracking** — sliding TTL with dual cleanup (interval + on-access). Schemas loaded once per session return as `{ loaded: true }` references on subsequent calls.
- **Opaque denial** — out-of-role `tools/call` returns `"Unknown tool: {name}"`. Restricted tools are invisible, not just blocked.
- Test floor: **100/100 tests passing**, **99.56%** statement coverage.
- Real Stripe MCP harness: **80.7%** aggregate token reduction across five representative queries against the 28-tool Stripe MCP surface.

[Unreleased]: https://github.com/LoomLabs-Venture-Studio/MCPack/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/LoomLabs-Venture-Studio/MCPack/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/LoomLabs-Venture-Studio/MCPack/releases/tag/v1.0.0
