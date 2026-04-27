import { describe, it, expect } from 'vitest';
import {
  cosineSimilarity,
  minMaxNormalize,
  combineHybrid,
} from '../src/hybrid-scoring.js';
import { keywordScoreForEntry, scoreAndRank } from '../src/search.js';
import type { ToolIndexEntry } from '../src/types.js';

// ─── Test fixtures ────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<ToolIndexEntry> = {}): ToolIndexEntry {
  return {
    name: overrides.name ?? 'defaultTool',
    description: overrides.description ?? 'A default tool',
    keywords: overrides.keywords ?? [],
    schemaKeywords: overrides.schemaKeywords ?? [],
    schema: overrides.schema ?? {
      name: overrides.name ?? 'defaultTool',
      inputSchema: { type: 'object' },
    },
  };
}

// ─── Group 1: cosineSimilarity ────────────────────────────────────────────

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const v = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 6);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 6);
  });

  it('returns -1 for opposite vectors', () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([-1, -2, -3]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 6);
  });

  it('returns 0 (defensive guard) when either vector has zero magnitude', () => {
    const zero = new Float32Array([0, 0, 0]);
    const nonZero = new Float32Array([1, 2, 3]);
    // Both orderings: zero on left, zero on right.
    expect(cosineSimilarity(zero, nonZero)).toBe(0);
    expect(cosineSimilarity(nonZero, zero)).toBe(0);
    // Both zero (would be 0/0 = NaN without guard).
    expect(cosineSimilarity(zero, zero)).toBe(0);
  });

  it('throws on dimension mismatch with descriptive error', () => {
    const a = new Float32Array([1, 2]);
    const b = new Float32Array([1, 2, 3]);
    expect(() => cosineSimilarity(a, b)).toThrow(
      /^MCPack: cosine similarity dimension mismatch \(a\.length=2, b\.length=3\)$/,
    );
  });

  it('handles realistic 384-dim vectors (MiniLM size) without overflow or precision loss', () => {
    // 384-dim Float32Array filled with small floats — matches MiniLM output shape.
    const a = new Float32Array(384);
    const b = new Float32Array(384);
    for (let i = 0; i < 384; i++) {
      a[i] = (i % 7) * 0.01;
      b[i] = (i % 11) * 0.01;
    }
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeGreaterThan(-1);
    expect(sim).toBeLessThan(1);
    expect(Number.isFinite(sim)).toBe(true);
  });
});

// ─── Group 2: minMaxNormalize ─────────────────────────────────────────────

describe('minMaxNormalize', () => {
  it('returns empty array for empty input', () => {
    expect(minMaxNormalize([])).toEqual([]);
  });

  it('returns [0] for single-element input (max === min degenerate)', () => {
    // Single element: max === min → all-zeros per DEC-v11-08-02.
    expect(minMaxNormalize([5])).toEqual([0]);
    expect(minMaxNormalize([0])).toEqual([0]);
    expect(minMaxNormalize([-3])).toEqual([0]);
  });

  it('normalizes [0, 10] to [0, 1]', () => {
    expect(minMaxNormalize([0, 10])).toEqual([0, 1]);
  });

  it('normalizes [5, 10, 15] to [0, 0.5, 1]', () => {
    const result = minMaxNormalize([5, 10, 15]);
    expect(result).toHaveLength(3);
    expect(result[0]).toBeCloseTo(0, 9);
    expect(result[1]).toBeCloseTo(0.5, 9);
    expect(result[2]).toBeCloseTo(1, 9);
  });

  it('returns all zeros when all values equal (DEC-v11-08-02 degenerate)', () => {
    // Locked behavior: max === min → no discriminating signal → all zeros.
    expect(minMaxNormalize([7, 7, 7])).toEqual([0, 0, 0]);
    expect(minMaxNormalize([0, 0, 0, 0])).toEqual([0, 0, 0, 0]);
    expect(minMaxNormalize([-2, -2])).toEqual([0, 0]);
  });

  it('supports negative inputs (cosine output range [-1, 1])', () => {
    const result = minMaxNormalize([-1, 0, 1]);
    expect(result[0]).toBeCloseTo(0, 9);
    expect(result[1]).toBeCloseTo(0.5, 9);
    expect(result[2]).toBeCloseTo(1, 9);
  });

  it('handles non-monotonic input where later values are smaller than earlier', () => {
    // Exercises the `if (s < min) min = s` branch — needs a value smaller than scores[0].
    // Input: [10, 5, 15] → min=5, max=15, range=10 → [(10-5)/10, 0, 1] = [0.5, 0, 1].
    const result = minMaxNormalize([10, 5, 15]);
    expect(result[0]).toBeCloseTo(0.5, 9);
    expect(result[1]).toBeCloseTo(0, 9);
    expect(result[2]).toBeCloseTo(1, 9);
  });
});

// ─── Group 3: combineHybrid ───────────────────────────────────────────────

describe('combineHybrid', () => {
  const defaultWeights = { semanticWeight: 0.7, keywordWeight: 0.3 };

  it('applies default 0.7/0.3 weights — pure semantic signal', () => {
    expect(combineHybrid([1.0], [0.0], defaultWeights)).toEqual([0.7]);
  });

  it('applies default 0.7/0.3 weights — pure keyword signal', () => {
    expect(combineHybrid([0.0], [1.0], defaultWeights)).toEqual([0.3]);
  });

  it('applies custom weights element-wise', () => {
    const equal = { semanticWeight: 0.5, keywordWeight: 0.5 };
    expect(combineHybrid([1, 0], [0, 1], equal)).toEqual([0.5, 0.5]);
  });

  it('throws on length mismatch with descriptive error', () => {
    expect(() =>
      combineHybrid([1, 2, 3], [1, 2], defaultWeights),
    ).toThrow(
      /^MCPack: hybrid combine length mismatch \(semantic=3, keyword=2\)$/,
    );
  });

  it('returns empty array for empty inputs', () => {
    expect(combineHybrid([], [], defaultWeights)).toEqual([]);
  });

  it('combines a 3-element candidate set with default weights', () => {
    // semNorm = [1.0, 0.5, 0.0]; kwNorm = [0.0, 0.5, 1.0]
    // result[0] = 0.7*1.0 + 0.3*0.0 = 0.7
    // result[1] = 0.7*0.5 + 0.3*0.5 = 0.5
    // result[2] = 0.7*0.0 + 0.3*1.0 = 0.3
    const result = combineHybrid([1.0, 0.5, 0.0], [0.0, 0.5, 1.0], defaultWeights);
    expect(result[0]).toBeCloseTo(0.7, 9);
    expect(result[1]).toBeCloseTo(0.5, 9);
    expect(result[2]).toBeCloseTo(0.3, 9);
  });
});

// ─── Group 4: keywordScoreForEntry + regression invariant ─────────────────

describe('keywordScoreForEntry', () => {
  it('scores all 5 tiers correctly: EXACT_NAME=10, PARTIAL_NAME=5, DESCRIPTION=3, KEYWORD=2, SCHEMA_PROPERTY=1', () => {
    // Exact name match: name lowercased equals query token.
    const exact = makeEntry({ name: 'customer', description: 'unrelated' });
    expect(keywordScoreForEntry('customer', exact)).toBe(10);

    // Partial name match: name lowercased contains token but not equal.
    const partial = makeEntry({ name: 'getCustomer', description: 'unrelated' });
    expect(keywordScoreForEntry('customer', partial)).toBe(5);

    // Description-only match.
    const desc = makeEntry({ name: 'tool1', description: 'manages customer records' });
    expect(keywordScoreForEntry('customer', desc)).toBe(3);

    // Keyword-only match.
    const kw = makeEntry({
      name: 'tool2',
      description: 'unrelated',
      keywords: ['customer'],
    });
    expect(keywordScoreForEntry('customer', kw)).toBe(2);

    // Schema property-only match.
    const schemaKw = makeEntry({
      name: 'tool3',
      description: 'unrelated',
      schemaKeywords: ['customerid'],
    });
    expect(keywordScoreForEntry('customer', schemaKw)).toBe(1);
  });

  it('returns 0 for empty or whitespace-only query', () => {
    const entry = makeEntry({ name: 'customer', description: 'unrelated' });
    expect(keywordScoreForEntry('', entry)).toBe(0);
    expect(keywordScoreForEntry('   ', entry)).toBe(0);
    expect(keywordScoreForEntry('\t\n', entry)).toBe(0);
  });

  it('is case-insensitive on both query and entry fields', () => {
    const entry = makeEntry({
      name: 'getCustomer',
      description: 'List CUSTOMER records',
      keywords: ['Billing'],
    });
    // Query lowercase vs uppercase — same score.
    const lower = keywordScoreForEntry('customer', entry);
    const upper = keywordScoreForEntry('CUSTOMER', entry);
    expect(lower).toBe(upper);
    // PARTIAL_NAME (5) for getCustomer + DESCRIPTION (3) for "List CUSTOMER records" = 8.
    expect(lower).toBe(8);
  });

  it('accumulates scores across multiple query tokens (matches scoreAndRank semantics)', () => {
    const entry = makeEntry({
      name: 'createCustomer',
      description: 'Create a new payment record',
      keywords: [],
    });
    // Query "customer payment":
    //   token "customer": PARTIAL_NAME(5) on name "createCustomer"
    //   token "payment":  DESCRIPTION(3) on description
    // Total: 5 + 3 = 8.
    expect(keywordScoreForEntry('customer payment', entry)).toBe(8);
  });

  it('REGRESSION INVARIANT: keywordScoreForEntry matches scoreAndRank inner-loop sum', () => {
    // This test ensures Phase 8's hybrid path will produce keyword scores
    // identical to v1.0's scoreAndRank inner-loop accumulation. Plan 08-02's
    // scoreAndRankHybrid relies on this invariant.
    const index: ToolIndexEntry[] = [
      makeEntry({ name: 'customer', description: 'unrelated' }), // 10
      makeEntry({ name: 'getCustomer', description: 'unrelated' }), // 5
      makeEntry({ name: 'tool1', description: 'manages customer records' }), // 3
      makeEntry({
        name: 'tool2',
        description: 'unrelated',
        keywords: ['customer'],
      }), // 2
      makeEntry({
        name: 'tool3',
        description: 'unrelated',
        schemaKeywords: ['customerid'],
      }), // 1
      makeEntry({ name: 'noMatch', description: 'unrelated' }), // 0 — excluded by scoreAndRank
    ];

    // scoreAndRank returns ranked entries (excludes score=0).
    const ranked = scoreAndRank('customer', index, 10);
    expect(ranked.map((e) => e.name)).toEqual([
      'customer',
      'getCustomer',
      'tool1',
      'tool2',
      'tool3',
    ]);

    // For each entry, keywordScoreForEntry must produce the exact value scoreAndRank
    // accumulated internally. We verify by reconstructing the same ordering.
    const scoresPerEntry = index.map((e) => ({
      name: e.name,
      score: keywordScoreForEntry('customer', e),
    }));
    expect(scoresPerEntry.find((s) => s.name === 'customer')!.score).toBe(10);
    expect(scoresPerEntry.find((s) => s.name === 'getCustomer')!.score).toBe(5);
    expect(scoresPerEntry.find((s) => s.name === 'tool1')!.score).toBe(3);
    expect(scoresPerEntry.find((s) => s.name === 'tool2')!.score).toBe(2);
    expect(scoresPerEntry.find((s) => s.name === 'tool3')!.score).toBe(1);
    expect(scoresPerEntry.find((s) => s.name === 'noMatch')!.score).toBe(0);

    // The scoreAndRank order matches keywordScoreForEntry descending order
    // for the score>0 subset (excluding noMatch).
    const sortedByHelper = scoresPerEntry
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((s) => s.name);
    expect(sortedByHelper).toEqual(ranked.map((e) => e.name));
  });

  it('does not mutate the input entry', () => {
    const entry = makeEntry({
      name: 'getCustomer',
      description: 'List customer records',
      keywords: ['billing'],
      schemaKeywords: ['customerid'],
    });
    const snapshot = JSON.stringify(entry);
    keywordScoreForEntry('customer', entry);
    expect(JSON.stringify(entry)).toBe(snapshot);
  });
});
