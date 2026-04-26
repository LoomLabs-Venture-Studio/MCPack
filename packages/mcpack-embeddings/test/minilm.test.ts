import { describe, it, expect } from 'vitest';
import { createMiniLMProvider } from '../src/index.js';
import type { MiniLMOptions } from '../src/index.js';
import type { EmbeddingProvider } from '@llvs/mcpack';

describe('createMiniLMProvider — factory contract (always-on)', () => {
  it('returns a function conforming to EmbeddingProvider', async () => {
    const provider = await createMiniLMProvider();
    expect(typeof provider).toBe('function');
    expect(provider.length).toBe(1);
    // Compile-time assignment also asserts the locked signature.
    const typed: EmbeddingProvider = provider;
    expect(typeof typed).toBe('function');
  });

  it('returns empty array for empty input without loading the model', async () => {
    // Critical: this exercises the texts.length === 0 early-return path
    // inside the provider closure — proves the factory does not eagerly
    // download the ~90MB ONNX model.
    const provider = await createMiniLMProvider();
    const out = await provider([]);
    expect(out).toEqual([]);
  });

  it('accepts MiniLMOptions with model and cacheDir without throwing at construction', async () => {
    const opts: MiniLMOptions = {
      model: 'Xenova/all-MiniLM-L6-v2',
      cacheDir: '/tmp/mcpack-embeddings-cache-test',
    };
    const provider = await createMiniLMProvider(opts);
    expect(typeof provider).toBe('function');
    // Confirm empty-input fast path still works under custom options.
    expect(await provider([])).toEqual([]);
  });
});

// Smoke tests below gate model download (~90MB) and inference (multi-second
// first run). Default `npm test` skips these. CI in Phase 10 sets
// RUN_MODEL_TESTS=1 explicitly. The gating uses runtime conditional skip
// (rather than `it.runIf`) for portability across vitest minor versions.
const runModelTests = process.env.RUN_MODEL_TESTS === '1';

describe('createMiniLMProvider — model integration (RUN_MODEL_TESTS=1)', () => {
  it('returns 384-dim vectors for a batch of two strings', async () => {
    if (!runModelTests) return;
    const provider = await createMiniLMProvider();
    const out = await provider(['hello world', 'embedding test']);
    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(384);
    expect(out[1]).toHaveLength(384);
  }, 60_000);

  it('produces consistent vectors for identical inputs (singleton + determinism)', async () => {
    if (!runModelTests) return;
    const provider = await createMiniLMProvider();
    const a = await provider(['determinism test']);
    const b = await provider(['determinism test']);
    expect(a[0]).toEqual(b[0]);
  }, 60_000);
});
