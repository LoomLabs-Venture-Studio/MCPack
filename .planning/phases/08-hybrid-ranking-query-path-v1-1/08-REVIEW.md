---
phase: 08-hybrid-ranking-query-path-v1-1
reviewed: 2026-04-26T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - src/core.ts
  - src/hybrid-scoring.ts
  - src/search.ts
  - test/hybrid-scoring.test.ts
  - test/hybrid-ranking.test.ts
findings:
  critical: 1
  warning: 4
  info: 3
  total: 8
status: issues_found
---

# Phase 8: Code Review Report

**Reviewed:** 2026-04-26
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Phase 8 wires hybrid ranking into the query path with mostly clean execution. The pure scoring helpers in `src/hybrid-scoring.ts` are tight (NaN-guarded cosine, locked min-max degenerate behavior, length-mismatch throws). The `embedQuery` failure path correctly catches all rejections, warns once per engine instance, and falls through to keyword fallback — the WR-02 unhandled-rejection regression test verifies this with `process.on('unhandledRejection', ...)`. The RBAC warn-message format is locked and the Phase 9 negative control verifies fixture names never leak. Tests are mostly behavioral; the rename-safe `tools.map(t => t.name)` pattern is applied consistently at the 9 RBAC sites.

The Phase 7 carry-forwards are real: WR-01 (`hasVectors()` distinct from `isIndexReady()`), WR-02 (cross-cutting unhandled-rejection regression covers BOTH paths), WR-03 (rename-safe RBAC iteration) all check out.

**However**, there is one **BLOCKER** in the keyword-fallback path: the rank-then-filter pivot is broken at scale because `scoreAndRank` internally caps results at `MAX_LIMIT=10` regardless of the `Infinity` limit passed by the caller. This produces an observable correctness regression vs v1.0 in any deployment with >10 keyword-matching tools where the top-10 overlap heavily with role-blocked tools — role-allowed-but-lower-scored tools become invisible. Wave 0's "byte-identical to v1.0" empirical check did not exercise this corner case.

Additional warnings cover dimension-mismatch crashes in the hybrid path, runtime weights validation gaps, and a Promise-handling micro-issue.

## Critical Issues

### CR-01: Rank-then-filter pivot is broken — `scoreAndRank` ignores the `Infinity` limit and caps at `MAX_LIMIT=10`

**File:** `src/core.ts:451` (the call site) + `src/search.ts:34` (the internal cap)
**Severity:** BLOCKER
**Issue:**

`scoreAndRankKeywordWithRoleAfter` was written to defer truncation until AFTER role filtering:

```ts
// src/core.ts:451
const allRanked = scoreAndRank(query, this.index, Infinity);
const allowed = resolveRoleAccess(role, this.config.roles, this.index);
const allowedNames = new Set(allowed.map((e) => e.name));
return allRanked.filter((e) => allowedNames.has(e.name)).slice(0, limit);
```

The comment claims:
> "Pass Infinity as limit so scoreAndRank doesn't truncate before role filter applies."

But `scoreAndRank` internally clamps the limit:

```ts
// src/search.ts:34
const effectiveLimit = Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT); // MAX_LIMIT = 10
```

`Math.min(Infinity, 10) === 10`. So `allRanked` is capped at the top 10 keyword-matching entries BEFORE the role filter. The role filter is then applied to that top-10 — exactly the bug rank-then-filter was supposed to fix.

**Concrete failure scenario** (correctness regression vs v1.0):

Configure 11 tools where:
- 10 tools have HIGH keyword scores but are role-blocked
- 1 tool has a LOW keyword score and is role-allowed

v1.0 (filter-then-rank): scores only the 1 allowed tool, returns it. Caller sees 1 result.
Phase 8 keyword-fallback path: `scoreAndRank` returns the top 10 (all blocked) → filter → []. Caller sees 0 results.

This is a silent correctness regression in any deployment with a non-trivial restricted role surface and a meaningful keyword index. The Wave 0 "byte-identical to v1.0" claim holds only because the existing test corpus doesn't exercise >10 keyword matches with the blocked majority pattern. The hybrid path (`scoreAndRankHybrid`) does NOT have this bug because it builds its own `indexed` array and applies role-filter against the full sorted list before slicing.

**RBAC implication:** The bug doesn't leak data — out-of-role tools stay invisible — but it makes role-allowed tools INVISIBLE in a way v1.0 did not. A user with restricted role would see "no results" for queries that should have matched their allowed surface, masking real capabilities.

**Fix:**

Option A (preferred, minimal): introduce a separate raw-score helper that does not cap, mirroring `keywordScoreForEntry` but returning a sorted full-surface list. Use that in `scoreAndRankKeywordWithRoleAfter`.

Option B (small surface): extend `scoreAndRank` to honor `Infinity` (or `undefined`-meaning-unbounded) by skipping the `Math.min` clamp when the caller explicitly opts into no-limit. Document the semantics.

```ts
// src/search.ts — Option B
export function scoreAndRank(
  query: string,
  index: ToolIndexEntry[],
  limit?: number,
): ToolIndexEntry[] {
  // Resolve effective limit: only cap user-supplied finite limits.
  // Infinity is a sentinel for "rank the full surface; caller will slice."
  const effectiveLimit =
    limit === Infinity
      ? Number.POSITIVE_INFINITY
      : Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  // ... rest unchanged
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, effectiveLimit === Number.POSITIVE_INFINITY ? scored.length : effectiveLimit)
    .map((s) => s.entry);
}
```

After fixing, add a regression test in `test/hybrid-ranking.test.ts` (or `test/search.test.ts`) that constructs the >10 tools scenario above and asserts the role-allowed-but-low-scored tool appears in the keyword-fallback output.

---

## Warnings

### WR-01: Dimension-mismatch in hybrid path throws and propagates to MCP caller (no graceful fallback)

**File:** `src/core.ts:389` (the `cosineSimilarity` call), `src/hybrid-scoring.ts:29-33` (the throw)
**Severity:** WARNING
**Issue:**

`embedQuery` validates that the provider returns a single-element array of arrays — but it does NOT validate that the query vector's dimension matches the build vectors' dimension. If the embedding provider returns a vector of a different dimension on the query call than it did on the build call (provider misbehavior, model swap, version drift), `cosineSimilarity(queryVec, toolVec)` throws inside `scoreAndRankHybrid`. The throw escapes `runHybridQuery` (which has no try/catch) and propagates as a rejected Promise to the MCP request handler in `wrap.ts:105` / `build.ts:117`.

Result: the MCP `tools/call` request fails with an SDK-level error rather than gracefully falling through to keyword fallback. This is inconsistent with the embedQuery failure handling philosophy ("never propagate to the MCP caller — would break the session"; see `src/core.ts:309-310`).

**Fix:** Either (a) validate query-vector dimension in `embedQuery` against `this.semanticIndex` (any vector's `.length` will do as the expected dim), returning `null` on mismatch and triggering the warn-once path; or (b) wrap `scoreAndRankHybrid` in a try/catch inside `runHybridQuery` that logs the warn and falls through to keyword path. Option (a) is more discoverable; (b) is more defensive.

```ts
// src/core.ts inside embedQuery, after the malformed-shape check
const queryVec = new Float32Array(vectors[0]);
// Defense: dimension must match the build vectors' dimension.
const expectedDim = this.semanticIndex?.values().next().value?.length;
if (expectedDim !== undefined && queryVec.length !== expectedDim) {
  throw new Error(
    `provider returned query vector of dimension ${queryVec.length}; expected ${expectedDim}`,
  );
}
return queryVec;
```

The existing try/catch in `embedQuery` will log this through the locked warn format, returning null and routing to keyword fallback.

---

### WR-02: `combineHybrid` does not validate weights at runtime — partial weights from JS callers produce silent NaN scores

**File:** `src/hybrid-scoring.ts:98-115` (combineHybrid), `src/core.ts:400-403` (default fallback)
**Severity:** WARNING
**Issue:**

The `weights` type requires both `semanticWeight` and `keywordWeight`, but TypeScript's type system is erased at runtime. A JS caller (or a TS caller using `as any`) passing `{ semanticWeight: 0.5 }` (omitting `keywordWeight`) results in:

```ts
result[i] = 0.5 * semanticNorm[i]! + undefined * keywordNorm[i]!; // → NaN
```

Every hybrid score becomes NaN. `NaN > 0` is `false`, so `withSignal` filters everything out, and the user gets zero results from a query that should have matched. No warning, no error — silent empty output.

The defaulting in `core.ts` uses `??` against the ENTIRE weights object:

```ts
const weights = this.config.embeddings?.weights ?? { semanticWeight: 0.7, keywordWeight: 0.3 };
```

This only defaults when `weights` is wholly absent. Partial objects pass through unchanged.

The same concern applies to negative weights, weights summing to >1, and non-finite weights (NaN, Infinity) — none are validated.

**Fix:** Either tighten the runtime guard at the engine boundary, or (lighter touch) per-field default in `core.ts`:

```ts
// src/core.ts replacing lines 400-403
const userWeights = this.config.embeddings?.weights;
const weights = {
  semanticWeight: userWeights?.semanticWeight ?? 0.7,
  keywordWeight: userWeights?.keywordWeight ?? 0.3,
};
// Optional: assert finite, non-negative.
if (!Number.isFinite(weights.semanticWeight) || !Number.isFinite(weights.keywordWeight)) {
  throw new Error(`MCPack: hybrid weights must be finite numbers`);
}
```

Add unit tests for each malformed-weights case.

---

### WR-03: Hybrid path filters `score > 0` AFTER min-max normalization, hiding non-zero raw signals when one track dominates

**File:** `src/core.ts:413-414` (the filter), `src/hybrid-scoring.ts:77-80` (degenerate behavior)
**Severity:** WARNING
**Issue:**

In `scoreAndRankHybrid`:

```ts
const withSignal = indexed.filter((x) => x.score > 0);
```

This drops entries whose normalized hybrid score is 0. But min-max normalization sends the MINIMUM raw score to 0 even when that score was non-zero. Consider 2 tools both keyword-matching with raw scores `[5, 10]`:

- keywordScores: `[5, 10]` → normalized: `[0, 1]`
- semanticScores: `[0.6, 0.6]` (same direction) → normalized: `[0, 0]` (degenerate)
- combined (0.7/0.3): `[0, 0.3]`

Tool 0 is filtered out despite having a real keyword match (raw score 5) and a real semantic similarity (0.6). It only gets dropped because it's the per-query minimum on both tracks. This creates surprising "missing" results — particularly with 2-tool surfaces.

The single-tool case is even starker: any single tool with both signals normalizes to `[0]` everywhere → hybrid `[0]` → filtered out → empty result. The session-invariants test (`test/hybrid-ranking.test.ts:574`) calls this out and adds a second tool just to avoid the degenerate case.

This is documented behavior per DEC-v11-08-02, but it is semantically jarring — a query that strictly matched returns nothing. Worth at minimum surfacing in a NOTE comment so future maintainers know this is intentional, and/or replacing the strict `> 0` with `>= 0` and using a different "no-signal" indicator (e.g., raw-score-zero tracking pre-normalization).

**Fix:** The cleanest semantic fix is to track "had any raw signal" pre-normalization separately, then prune by that — not by the post-normalization 0:

```ts
// Track which entries had ANY raw signal before normalization erases the floor.
const hadSignal = this.index.map(
  (_, i) => semanticScores[i]! > 0 || keywordScores[i]! > 0,
);
// ... after combineHybrid:
const indexed = this.index.map((entry, i) => ({
  entry,
  score: hybridScores[i]!,
  signal: hadSignal[i]!,
}));
indexed.sort((a, b) => b.score - a.score);
const withSignal = indexed.filter((x) => x.signal);
```

If keeping current behavior is intentional, add a `// LOCKED: per DEC-v11-08-02 — single/two-tool surface degenerates intentionally` comment at line 414 so this isn't "fixed" later by a maintainer who reads the bug differently.

---

### WR-04: `scoreAndRankHybrid`'s `scoreAndRankKeywordWithRoleAfter` symmetry is incomplete — only the keyword path was made to use rank-then-filter

**File:** `src/core.ts:188-198` (the routing), `src/core.ts:444-455` (keyword path), `src/core.ts:370-424` (hybrid path)
**Severity:** WARNING
**Issue:**

The hybrid path correctly applies the role filter AFTER ranking against the full surface. The keyword fallback path attempts the same but is broken by CR-01. Once CR-01 is fixed, both paths will share the rank-then-filter pivot semantics. Until then, the two paths produce DIFFERENT observable behavior for the same query+role+surface combination depending solely on whether `hasVectors()` is true or false (e.g., during a build-pending window).

This means the v1.0→v1.1 upgrade is NOT byte-identical when the user has embeddings configured but the build is still in flight: incoming queries during that window go through the keyword fallback (with the CR-01 bug), then queries after the build completes go through the hybrid path (without the bug). Same query, different results, no user-visible signal that the path changed.

**Fix:** This warning resolves automatically once CR-01 is fixed. Until then, document the transient inconsistency in `08-VALIDATION.md` so QA isn't surprised.

---

## Info

### IN-01: `runHybridQuery` `else` branch redundantly calls `scoreAndRankKeywordWithRoleAfter` — fall-through could be expressed without the second call site

**File:** `src/core.ts:213-229`
**Issue:**

```ts
if (queryVec !== null) {
  matches = this.scoreAndRankHybrid(query, queryVec, role, limit);
} else {
  matches = this.scoreAndRankKeywordWithRoleAfter(query, role, limit);
}
```

The keyword fallback is invoked from two locations: the no-vectors branch in `handleSearchTools` and this query-failure branch in `runHybridQuery`. Tightening to a single call site (e.g., have `runHybridQuery` return null on query-embedding failure and let `handleSearchTools` route) would centralize the keyword path. Minor — current structure is readable.

**Fix:** Optional refactor. If kept as-is, the duplicate-call comment (`// Query embedding failed — fall through to keyword`) is sufficient.

---

### IN-02: `scoreAndRank` and `keywordScoreForEntry` duplicate the 5-tier scoring loop — keep DRY in mind for future tier additions

**File:** `src/search.ts:39-69` (scoreAndRank inner loop), `src/search.ts:107-143` (keywordScoreForEntry)
**Issue:**

The two functions share the entire scoring loop (5 tiers, mutually-exclusive name match, all four `includes` checks). Any future tier addition (e.g., adding fuzzy matching) requires editing both. The hybrid path's regression-invariant test (`test/hybrid-scoring.test.ts:237-288`) is the only mechanism keeping them in sync; if a maintainer adds a tier to one and forgets the other, the test will catch it for the existing tiers but not for the new tier.

**Fix:** Extract the per-token-per-entry scoring into a private helper:

```ts
function tokenScore(token: string, entry: ToolIndexEntry, nameLower: string, descLower: string): number {
  let score = 0;
  if (nameLower === token) score += EXACT_NAME;
  else if (nameLower.includes(token)) score += PARTIAL_NAME;
  if (descLower.includes(token)) score += DESCRIPTION;
  if (entry.keywords.some((k) => k.includes(token))) score += KEYWORD;
  if (entry.schemaKeywords.some((k) => k.includes(token))) score += SCHEMA_PROPERTY;
  return score;
}
```

Both `scoreAndRank` and `keywordScoreForEntry` then call this. Same observable behavior, single source of truth.

---

### IN-03: P9 negative control test asserts a slightly weaker invariant than the contract claims

**File:** `test/hybrid-ranking.test.ts:437-475`
**Issue:**

The P9 test (RBAC + WR-03) throws an Error with message `'benign error code 42'` — a message the test author controls — and verifies fixture tool names don't appear in the warn output. The test passes by construction because the test's own provider doesn't embed fixture names in the error.

The truly adversarial case — provider whose error message DOES contain a tool name — is acknowledged in the test comment ("Provider-controlled err.message is a separate concern (the provider is operator-controlled)"). The locked format `MCPack: query embedding failed: ${err.message}` will faithfully echo any operator-controlled provider error message, including ones that happen to contain tool names. The actual RBAC invariant the engine enforces is narrower: "the engine itself does not iterate `this.index`/`tools` to assemble the warn message."

**Fix:** Optional — strengthen the test comment to make this distinction precise so future readers don't mistake the test for a stronger guarantee than the implementation provides. Or add a complementary test that verifies the engine's contribution: assert the warn message structure is exactly `^MCPack: query embedding failed: ` followed by `err.message`, and nothing the engine adds beyond that.

---

_Reviewed: 2026-04-26_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
