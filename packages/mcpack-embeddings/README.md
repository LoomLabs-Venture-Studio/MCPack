# @llvs/mcpack-embeddings

Local MiniLM embedding adapter for [`@llvs/mcpack`](https://github.com/LoomLabs-Venture-Studio/MCPack).

`@llvs/mcpack-embeddings` provides a single factory — `createMiniLMProvider()` — that returns an `EmbeddingProvider` backed by the locally-cached `Xenova/all-MiniLM-L6-v2` ONNX model via `@huggingface/transformers ^4.0.0`. Pair it with `@llvs/mcpack` to enable hybrid semantic + keyword ranking on `search_tools`.

## Install

```bash
npm install @llvs/mcpack @llvs/mcpack-embeddings
```

`@llvs/mcpack` is declared as a peer dependency at `^1.1.0`. Install both packages together; the adapter is opt-in and is NOT a runtime dependency of core.

## Usage

```ts
import { mcpack } from '@llvs/mcpack';
import { createMiniLMProvider } from '@llvs/mcpack-embeddings';

const handle = await mcpack(server, {
  embeddings: { provider: await createMiniLMProvider() },
});
```

That's the full surface. `createMiniLMProvider()` returns a function typed as `EmbeddingProvider`: `(texts: string[]) => Promise<number[][]>`. Pass it to `MCPackConfig.embeddings.provider` and `@llvs/mcpack` handles the rest — startup index build, hybrid scoring, build-pending fallback, error handling.

## Performance characteristics

- **Model:** `Xenova/all-MiniLM-L6-v2` (default; configurable via `createMiniLMProvider({ model })`).
- **Library:** `@huggingface/transformers ^4.0.0`. The `@xenova/transformers` package was renamed and is no longer maintained — DEC-v11-03 locks `@huggingface/transformers` as the canonical replacement.
- **Embedding dimension:** 384 (float32). Each tool vector is 1,536 bytes (`Float32Array(384)`); a 50-tool engine occupies ~75 KB of vector store memory.
- **First-run cost:** one-time ~25–90 MB ONNX model download to `node_modules/@huggingface/transformers/.cache/`. Approximately 30 seconds on cold cache; instant on subsequent loads.
- **Warm-cache embedding:** sub-second per batch on commodity hardware. Plan 10-01's perf bench measured a 50-tool batched index build at 216.6 ms.
- **Output:** mean-pooled and L2-normalized. Cosine similarity reduces to dot product, and MCPack's hybrid scorer uses min-max normalization across the candidate set per query.

## Notes

- **Pipeline singleton scoped inside the factory return.** The cached extractor is closure-scoped — re-calling `createMiniLMProvider()` returns a new closure (and a new singleton), so module-scope leaks across vitest test files are avoided.
- **Type re-export policy.** The `EmbeddingProvider` type is exported from `@llvs/mcpack` only. Do NOT import the type from this adapter package — keeping the type's source-of-truth in the core package preserves the locked v1.1 contract.
- **Adapter is opt-in.** Without configuring `embeddings`, `@llvs/mcpack` runs the v1.0 keyword-only path unchanged. The MiniLM model is downloaded only when the operator opts in.
- **Optional `cacheDir` override:** `createMiniLMProvider({ cacheDir: '/path/to/cache' })` forwards the path to `@huggingface/transformers`'s global `env.cacheDir`. Useful for containerized deployments that want a writable, predictable cache location.
- **No persistent vector cache yet** — vectors are recomputed on every process start. v1.2 candidate per the project roadmap.

## License

MIT (same license as `@llvs/mcpack`).
