/**
 * Hybrid scoring math — pure functions used by Phase 8's hybrid query path.
 *
 * All exports are module-private to the package (NOT re-exported from
 * `src/index.ts` — these are internal helpers consumed by `src/core.ts`).
 *
 * @internal
 */

/**
 * Cosine similarity between two equal-dimension Float32Array vectors.
 *
 * Returns a value in [-1, 1]:
 *   -  1.0 → vectors point the same direction (most similar)
 *   -  0.0 → orthogonal (no similarity)
 *   - -1.0 → opposite direction (most dissimilar)
 *
 * Returns 0 when either vector has zero magnitude — defensive guard against
 * pathological provider outputs (all-zero vectors). A real embedding model
 * never produces zero vectors for non-empty input.
 *
 * Throws on dimension mismatch — this is a contract violation, not a runtime
 * recoverable state. Caller (engine) must ensure both vectors come from the
 * same provider so dims always match.
 *
 * @internal Module-private; not re-exported from `src/index.ts`.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(
      `MCPack: cosine similarity dimension mismatch (a.length=${a.length}, b.length=${b.length})`,
    );
  }

  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    magA += ai * ai;
    magB += bi * bi;
  }

  // Defensive: avoid NaN from 0/0 when either operand is the zero vector.
  if (magA === 0 || magB === 0) return 0;

  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Min-max normalize an array of scores to [0, 1].
 *
 * Formula: `normalized[i] = (scores[i] - min) / (max - min)` when `max > min`.
 *
 * When all scores are equal (`max === min`, the degenerate case), returns all
 * zeros — that track has no discriminating signal and drops out of the hybrid
 * combine. Locked behavior per DEC-v11-08-02. Single-element input returns
 * `[0]` (degenerate); empty input returns `[]`.
 *
 * Negative input values are supported (cosine similarity can produce values in
 * `[-1, 1]`).
 *
 * @internal Module-private; not re-exported from `src/index.ts`.
 */
export function minMaxNormalize(scores: number[]): number[] {
  if (scores.length === 0) return [];

  let min = scores[0]!;
  let max = scores[0]!;
  for (const s of scores) {
    if (s < min) min = s;
    if (s > max) max = s;
  }

  // Degenerate: all scores equal → no discriminating signal → drop track to zero.
  if (max === min) {
    return scores.map(() => 0);
  }

  const range = max - min;
  return scores.map((s) => (s - min) / range);
}

/**
 * Combine normalized semantic and keyword scores using the configured weights.
 *
 * Formula (per REQ-v11-hybrid-ranking + DEC-v11-08-02):
 *   `result[i] = weights.semanticWeight * semanticNorm[i]
 *             + weights.keywordWeight * keywordNorm[i]`
 *
 * Both inputs MUST be the same length (the candidate set's size). Throws on
 * length mismatch — caller bug. Empty inputs return empty output.
 *
 * @internal Module-private; not re-exported from `src/index.ts`.
 */
export function combineHybrid(
  semanticNorm: number[],
  keywordNorm: number[],
  weights: { semanticWeight: number; keywordWeight: number },
): number[] {
  if (semanticNorm.length !== keywordNorm.length) {
    throw new Error(
      `MCPack: hybrid combine length mismatch (semantic=${semanticNorm.length}, keyword=${keywordNorm.length})`,
    );
  }

  const result = new Array<number>(semanticNorm.length);
  for (let i = 0; i < semanticNorm.length; i++) {
    result[i] =
      weights.semanticWeight * semanticNorm[i]! +
      weights.keywordWeight * keywordNorm[i]!;
  }
  return result;
}
