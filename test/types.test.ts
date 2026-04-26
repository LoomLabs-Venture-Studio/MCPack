import { describe, it, expect } from 'vitest';
import type { EmbeddingProvider, MCPackConfig } from '../src/index.js';

describe('EmbeddingProvider type contract', () => {
  it('accepts a function with the locked signature', () => {
    // Compile-time check: this assignment must typecheck under the locked signature
    // `(texts: string[]) => Promise<number[][]>` per DEC-v11-01.
    const mock: EmbeddingProvider = async (texts) =>
      texts.map(() => [0.1, 0.2, 0.3]);
    expect(typeof mock).toBe('function');
  });

  it('returns one vector per input string (parallel-array contract)', async () => {
    const mock: EmbeddingProvider = async (texts) =>
      texts.map((_, i) => [i, i + 1, i + 2]);
    const out = await mock(['a', 'b', 'c']);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual([0, 1, 2]);
    expect(out[2]).toEqual([2, 3, 4]);
  });

  it('vectors have consistent dimensionality across the batch', async () => {
    const mock: EmbeddingProvider = async (texts) => texts.map(() => [0.5, 0.5]);
    const out = await mock(['x', 'y', 'z']);
    const dims = out.map((v) => v.length);
    expect(new Set(dims).size).toBe(1);
    expect(dims[0]).toBe(2);
  });

  it('returns empty array for empty input', async () => {
    const mock: EmbeddingProvider = async (texts) => texts.map(() => [0]);
    const out = await mock([]);
    expect(out).toEqual([]);
  });
});

describe('MCPackConfig.embeddings shape', () => {
  it('compiles when embeddings is omitted (v1.0 callsite preserved)', () => {
    // REQ-v11-embeddings-optional-config + DEC-v11-02 + REQ-v11-backward-compat:
    // existing v1.0 callers MUST be able to construct an MCPackConfig with no embeddings field.
    const cfg: MCPackConfig = {};
    expect(cfg.embeddings).toBeUndefined();
  });

  it('compiles when embeddings is provided with provider only', () => {
    const provider: EmbeddingProvider = async (t) => t.map(() => [0]);
    const cfg: MCPackConfig = { embeddings: { provider } };
    expect(cfg.embeddings?.provider).toBe(provider);
    expect(cfg.embeddings?.weights).toBeUndefined();
  });

  it('compiles when embeddings includes weights', () => {
    const provider: EmbeddingProvider = async (t) => t.map(() => [0]);
    const cfg: MCPackConfig = {
      embeddings: {
        provider,
        weights: { semanticWeight: 0.7, keywordWeight: 0.3 },
      },
    };
    expect(cfg.embeddings?.weights?.semanticWeight).toBe(0.7);
    expect(cfg.embeddings?.weights?.keywordWeight).toBe(0.3);
  });
});
