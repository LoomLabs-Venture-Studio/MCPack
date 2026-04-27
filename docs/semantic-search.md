# Semantic Search (v1.1)

MCPack v1.1 adds an opt-in **semantic search** layer on top of v1.0's keyword scoring. When you provide an `EmbeddingProvider`, `search_tools` ranks results by a hybrid score that combines cosine similarity over learned tool embeddings with the v1.0 5-tier keyword score. The semantic layer is engineered to lift recall on paraphrased intents, domain abbreviations, and partial-name queries — cases where pure keyword matching misses obvious matches.

> **Backward compatibility.** With no `embeddings` configured, the search code path is byte-identical to v1.0 keyword-only behavior. The `v1.0 → v1.1` upgrade requires zero config changes.

## Why semantic search

The v1.0 5-tier weighted keyword scorer (name-exact, name-prefix, description, params, schema-keywords) ranks well when callers know the lexical surface of the tools. It misses on three patterns:

- **Paraphrased intent** — `"set up a new buyer"` should rank `customers.create` highly even though no token overlaps.
- **Domain abbreviation** — `"revoke sub"` should rank `subscriptions.cancel` highly even though `sub` does not appear in the schema.
- **Tool-name typo or partial match** — `"stripe customer search"` is ambiguous across multiple plausible tools and benefits from intent-aware disambiguation.

The PRD success criterion for v1.1 is **hybrid recall@5 ≥ keyword recall@5 + 15 percentage points** on the 50-query intent benchmark (`test/harness/intent-benchmark-queries.json`). That delta is re-measured at publish time with the operator's `STRIPE_SECRET_KEY`; see the Plan 10-01 release-measurement report.

## The `EmbeddingProvider` contract

The hook is a single function type, locked at v1.1:

```ts
export type EmbeddingProvider = (texts: string[]) => Promise<number[][]>;
```

**Batch-in / parallel-array-out:**

- `input.length === output.length`.
- `output[i]` is the vector for `input[i]`. Order is contractual.
- All vectors in a single call MUST have the same dimensionality.

Core ships zero implementation. You bring the provider — either by installing the sibling adapter package, or by implementing the type against a hosted embedding API.

## Quick-start with `@llvs/mcpack-embeddings`

The local-MiniLM adapter is a sibling package; it is NOT a runtime dependency of core.

```bash
npm install @llvs/mcpack @llvs/mcpack-embeddings
```

```ts
import { mcpack } from '@llvs/mcpack';
import { createMiniLMProvider } from '@llvs/mcpack-embeddings';

const handle = await mcpack(server, {
  embeddings: { provider: await createMiniLMProvider() },
});
```

`createMiniLMProvider()` returns an `EmbeddingProvider` that uses the locally-cached `Xenova/all-MiniLM-L6-v2` ONNX model via `@huggingface/transformers ^4.0.0`. First-run cost: ~25–90 MB ONNX download to `node_modules/@huggingface/transformers/.cache/`. Warm-cache embedding calls are sub-second.

## Hybrid score formula

When `embeddings` is configured AND the semantic index has finished building, every `search_tools` query computes:

```
final = semanticWeight * normalize(semanticScore) + keywordWeight * normalize(keywordScore)
```

where `normalize(...)` is a min-max normalization over the candidate set for that single query (so semantic and keyword scores share the [0, 1] range before they're combined).

**Default weights** (per DEC-v11-08):

- `semanticWeight: 0.7`
- `keywordWeight: 0.3`

**Tuning weights:**

```ts
const handle = await mcpack(server, {
  embeddings: {
    provider: await createMiniLMProvider(),
    weights: { semanticWeight: 0.6, keywordWeight: 0.4 },
  },
});
```

When `embeddings` is unset, the implicit weights are `semanticWeight: 0.0 / keywordWeight: 1.0` and the search path is byte-identical to v1.0. There is no `semanticOnly` mode by design — keyword scoring catches lexical matches that pure cosine similarity ranks lower than expected.

## Build lifecycle

Semantic vectors are computed **asynchronously after construction**. The `mcpack(server, { embeddings })` call returns synchronously; the index build runs in the background.

- `tools/list` returns within v1.0 noise floor regardless of build state. Phase 7's locked invariant: `handleToolsList()` always returns the synchronous single-tool synthetic response and never blocks on the in-flight build. Plan 10-01's `tools/list` no-regression microbench measured a median delta of `0.000 ms` (≤ 5 ms threshold) — the in-flight build does not slow `tools/list` calls.
- `handle.isIndexReady()` returns `true` once the build promise has settled (success OR failure path; "the build phase is over"). Poll this if your bootstrap needs to wait for a deterministic readiness signal.
- `handle.hasVectors()` returns `true` when the in-memory vector store is populated and usable for semantic ranking. Use this to verify hybrid ranking is active before benchmarking.

## Build-pending fallback

If a `search_tools` query arrives BEFORE vectors are ready, the engine falls through to v1.0 keyword scoring transparently and logs a single warn-once-per-instance line in the `MCPack: build pending` family. `search_tools` is never blocked on the in-flight build — the caller always gets results, just on the v1.0 path until the index resolves.

This is the same fall-through path used when:

1. The build promise rejected (provider error during indexing — also warn-once: `MCPack: semantic index build failed: ${err.message}`).
2. The runtime query embedding fails (provider rejected mid-query — see error handling below).

## Error handling

A query-embedding failure (provider throws or rejects) is contained:

```
MCPack: query embedding failed: ${err.message}
```

- Warn-once-per-instance — repeated failures from the same engine emit at most one log line.
- Falls through to keyword path for the failing query — the caller still gets results.
- Restricted tool names NEVER appear in warn messages (RBAC invariant; verified by Phase 7/8 fixture-name-decoupled negative-control tests).

Provider implementers SHOULD throw `Error` with a descriptive message and avoid embedding caller-controlled strings into the message — the warn line is a host-process log, not a user-facing surface, but defense-in-depth still applies.

## Memory budget

The vector store is a `Map<string, Float32Array>` keyed by tool name. Per-tool size for the default 384-dim MiniLM model:

- `Float32Array(384)` = 1,536 bytes per tool.
- 50-tool engine: 50 × 1,536 = 76,800 bytes (≈ 75 KB).

The PRD memory budget is ≤ 2 MiB (2,097,152 bytes) for a 50-tool MiniLM engine. Plan 10-01's perf bench measured **76,800 bytes** — well under budget (REQ-v11-perf-budget PASS). Larger embedding models (768-dim, 1024-dim) scale linearly; calculate as `vectorBytes ≈ toolCount × dim × 4`.

## Caveats and future work

- **No `listChanged`-driven rebuild yet.** When the underlying server emits `notifications/tools/list_changed`, MCPack does not currently re-embed the new tool surface. v1.2 candidate per OQ3.
- **No persistent vector cache yet.** Vectors are recomputed on every process start. v1.2 candidate.
- **No batched query support beyond what the provider does internally.** Each `search_tools` call embeds its single query; the adapter handles batching of *tool* embeddings during the startup index build.
- **Hosted providers (OpenAI, Cohere, etc.) not shipped.** Implement the `EmbeddingProvider` type against the hosted API of your choice; MCPack's hybrid pipeline is provider-agnostic.

For the canonical record of v1.1 measurement numbers and re-run commands, see `.planning/phases/10-harness-coverage-docs-npm-publish-v1-1/v1.1-release-report.md`.
