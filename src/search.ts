import type { ToolIndexEntry } from './types.js';

// ─── Score Weight Constants ────────────────────────────────────────────────────
// Internal named constants — not user-configurable in v1.
// Ordering: exact name > partial name > description > keyword > schema property

const EXACT_NAME = 10;
const PARTIAL_NAME = 5;
const DESCRIPTION = 3;
const KEYWORD = 2;
const SCHEMA_PROPERTY = 1;

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Score and rank tool index entries against a search query.
 *
 * Uses substring matching (includes()) with 5-tier weighted scoring.
 * Returns a new array — never mutates the input index.
 *
 * Limit semantics:
 *   - omitted: defaults to DEFAULT_LIMIT=5, capped at MAX_LIMIT=10.
 *   - finite number: clamped to MAX_LIMIT=10 (v1.0 contract — keeps the
 *     user-facing slice bounded for callers that pass a user-supplied limit).
 *   - `Infinity` (sentinel): explicit opt-out of the cap — returns the FULL
 *     ranked list of score>0 entries. Used by Phase 8's
 *     `scoreAndRankKeywordWithRoleAfter` rank-then-filter path so that role
 *     filtering can be applied AFTER ranking against the full surface
 *     (REQ-v11-role-filter-after-rank). Without this opt-out, callers passing
 *     `Infinity` would silently get top-10 only — see CR-01 fix.
 *
 * @param query - Search query string (case-insensitive)
 * @param index - Tool index entries to search
 * @param limit - Maximum results: number (capped at 10), `Infinity` (no cap), or undefined (default 5)
 * @returns Ranked array of matching ToolIndexEntry objects
 */
export function scoreAndRank(
  query: string,
  index: ToolIndexEntry[],
  limit?: number,
): ToolIndexEntry[] {
  // Resolve effective limit. `Infinity` is a sentinel for "rank the full
  // surface; the caller will slice after applying role filter" — required by
  // the rank-then-filter pivot in src/core.ts (CR-01 fix). Any finite
  // user-supplied limit remains clamped to MAX_LIMIT=10 (v1.0 contract).
  const effectiveLimit =
    limit === Infinity
      ? Number.POSITIVE_INFINITY
      : Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const queryTokens = query.toLowerCase().split(/\s+/).filter(Boolean);

  if (queryTokens.length === 0) return [];

  const scored = index.map((entry) => {
    let score = 0;
    const nameLower = entry.name.toLowerCase();
    const descLower = entry.description.toLowerCase();

    for (const token of queryTokens) {
      // Name matching: exact vs partial (mutually exclusive)
      if (nameLower === token) {
        score += EXACT_NAME;
      } else if (nameLower.includes(token)) {
        score += PARTIAL_NAME;
      }

      // Description matching
      if (descLower.includes(token)) {
        score += DESCRIPTION;
      }

      // Keyword matching
      if (entry.keywords.some((k) => k.includes(token))) {
        score += KEYWORD;
      }

      // Schema property matching
      if (entry.schemaKeywords.some((k) => k.includes(token))) {
        score += SCHEMA_PROPERTY;
      }
    }

    return { entry, score };
  });

  const ranked = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  // `slice(0, Infinity)` returns all elements (verified) — no special-case needed.
  return ranked.slice(0, effectiveLimit).map((s) => s.entry);
}

/**
 * Score a SINGLE tool index entry against a query, returning the raw keyword
 * score (the same per-tool sum that `scoreAndRank`'s inner loop accumulates).
 *
 * Used by Phase 8's hybrid query path (`src/core.ts` `scoreAndRankHybrid`)
 * to feed raw per-tool keyword scores into `minMaxNormalize` BEFORE combining
 * with semantic scores. The hybrid path needs per-entry scores (not a ranked
 * subset), which is why we extract this from `scoreAndRank`'s inner loop.
 *
 * Formula identical to `scoreAndRank`:
 *   - EXACT_NAME=10 if entry.name (lowercased) === token
 *   - else PARTIAL_NAME=5 if entry.name (lowercased) includes token
 *   - +DESCRIPTION=3 if entry.description (lowercased) includes token
 *   - +KEYWORD=2 if any entry.keywords item includes token
 *   - +SCHEMA_PROPERTY=1 if any entry.schemaKeywords item includes token
 * Summed across all query tokens (split on whitespace, lowercased, non-empty).
 *
 * Returns 0 for empty query, all-whitespace query, or no-match cases.
 * Does NOT mutate the input entry.
 *
 * Regression invariant: for any (query, entry) pair, the value returned here
 * equals the value `scoreAndRank` computes for that entry inside its inner
 * loop (and which it then uses to filter `score > 0` and sort descending).
 *
 * @internal Phase 8 — used by `src/core.ts` hybrid scoring; NOT re-exported
 * from `src/index.ts` (engine internals stay internal per Phase 02 DEC).
 *
 * @since v1.1 (Phase 8)
 */
export function keywordScoreForEntry(
  query: string,
  entry: ToolIndexEntry,
): number {
  const queryTokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (queryTokens.length === 0) return 0;

  let score = 0;
  const nameLower = entry.name.toLowerCase();
  const descLower = entry.description.toLowerCase();

  for (const token of queryTokens) {
    // Name matching: exact vs partial (mutually exclusive — same as scoreAndRank).
    if (nameLower === token) {
      score += EXACT_NAME;
    } else if (nameLower.includes(token)) {
      score += PARTIAL_NAME;
    }

    // Description matching.
    if (descLower.includes(token)) {
      score += DESCRIPTION;
    }

    // Keyword matching.
    if (entry.keywords.some((k) => k.includes(token))) {
      score += KEYWORD;
    }

    // Schema property matching.
    if (entry.schemaKeywords.some((k) => k.includes(token))) {
      score += SCHEMA_PROPERTY;
    }
  }

  return score;
}
