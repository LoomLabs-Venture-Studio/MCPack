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
 * @param query - Search query string (case-insensitive)
 * @param index - Tool index entries to search
 * @param limit - Maximum results to return (default 5, capped at 10)
 * @returns Ranked array of matching ToolIndexEntry objects
 */
export function scoreAndRank(
  query: string,
  index: ToolIndexEntry[],
  limit?: number,
): ToolIndexEntry[] {
  const effectiveLimit = Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT);
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

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, effectiveLimit)
    .map((s) => s.entry);
}
