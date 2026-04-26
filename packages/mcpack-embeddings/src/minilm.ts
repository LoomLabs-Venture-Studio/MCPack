import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import type { EmbeddingProvider } from '@llvs/mcpack';

/**
 * Configuration options for createMiniLMProvider.
 *
 * @since v1.1
 */
export interface MiniLMOptions {
  /**
   * Model identifier on Hugging Face Hub.
   * Default: 'Xenova/all-MiniLM-L6-v2' (384-dim float32 sentence embeddings).
   */
  model?: string;
  /**
   * Optional cache directory override. When set, forwarded to the
   * @huggingface/transformers global env.cacheDir before model load.
   * When unset, the library defaults to node_modules/@huggingface/transformers/.cache/.
   */
  cacheDir?: string;
}

const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';

/**
 * Create an EmbeddingProvider backed by a local ONNX MiniLM model.
 *
 * The factory returns a function conforming to MCPack's locked
 * EmbeddingProvider contract: batch-in (string[]) / parallel-array-out
 * (number[][]). Each output vector is mean-pooled and L2-normalized.
 *
 * Model loading is lazy: the first call to the returned provider downloads
 * the ONNX model (~90MB to the transformers.js cache) and instantiates the
 * pipeline. Subsequent calls reuse the cached pipeline via a closure-scoped
 * singleton — safe across concurrent calls and isolated from module-scope
 * test-runner leaks.
 *
 * @param opts - Optional model + cache configuration.
 * @returns A function (texts: string[]) => Promise<number[][]> typed as EmbeddingProvider.
 *
 * @since v1.1
 */
export async function createMiniLMProvider(
  opts: MiniLMOptions = {},
): Promise<EmbeddingProvider> {
  const modelName = opts.model ?? DEFAULT_MODEL;

  // Closure-scoped singleton: the cached extractor lives only as long as
  // this factory's return value is reachable. Avoids module-scope leak
  // across vitest test files (research Pitfall 2).
  let extractor: FeatureExtractionPipeline | undefined;

  const ensureExtractor = async (): Promise<FeatureExtractionPipeline> => {
    if (extractor) return extractor;
    if (opts.cacheDir) {
      const { env } = await import('@huggingface/transformers');
      env.cacheDir = opts.cacheDir;
    }
    extractor = (await pipeline(
      'feature-extraction',
      modelName,
    )) as FeatureExtractionPipeline;
    return extractor;
  };

  const provider: EmbeddingProvider = async (texts: string[]) => {
    if (texts.length === 0) return [];
    const ext = await ensureExtractor();
    const tensor = await ext(texts, { pooling: 'mean', normalize: true });
    return tensor.tolist() as number[][];
  };

  return provider;
}
