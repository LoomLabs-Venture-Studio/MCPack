---
phase: 08-hybrid-ranking-query-path-v1-1
fixed_at: 2026-04-26T21:36:00Z
review_path: .planning/phases/08-hybrid-ranking-query-path-v1-1/08-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 8: Code Review Fix Report

**Fixed at:** 2026-04-26T21:36:00Z
**Source review:** `.planning/phases/08-hybrid-ranking-query-path-v1-1/08-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 5 (1 Critical / 4 Warnings; Info findings deferred per `fix_scope=critical_warning`)
- Fixed: 5 (4 commits + 1 auto-resolved)
- Skipped: 0

**Quality gates (all green post-fix):**
- `npm run typecheck` — PASS
- `npm run build` — PASS
- `npm test` — PASS, 187/187 tests (174 baseline → 187 with +13 new regression tests)
- `npm run test:coverage` — 99.73% statement (above Phase 7 baseline 99.61%, slight improvement over Phase 8 close-out 99.72%)

**4 BLOCKING gates against `cd1fc52` baseline (all PASS):**
- Gate 1 (zero new core deps): PASS — `package.json` deps/peers/optional/bundled diff empty
- Gate 2 (public-API additive-only): PASS — `git diff cd1fc52 -- src/index.ts` = 0 lines
- Gate 3 (adapter isolation): PASS — zero `@llvs/mcpack-embeddings` / `@huggingface/*` / `@xenova/*` matches in `src/` + `test/`
- Gate 4 (baseline tests byte-identical): PASS — all 9 baseline test files unchanged. New regression tests added ONLY to Phase 8 files (`test/hybrid-ranking.test.ts`, `test/hybrid-scoring.test.ts`).

## Fixed Issues

### CR-01 (BLOCKER): Rank-then-filter pivot — `scoreAndRank` ignores `Infinity` and caps at `MAX_LIMIT=10`

**Files modified:** `src/search.ts`, `test/hybrid-ranking.test.ts`
**Commit:** `4566261`
**Approach:** Option B from REVIEW.md (preferred — minimal-surface change).

**Applied fix:**
- `src/search.ts`: extended `scoreAndRank`'s limit handling to honor `Infinity` as an explicit opt-out sentinel. Existing finite-number callers remain clamped to `MAX_LIMIT=10` (v1.0 contract preserved). Updated JSDoc to document the three-way limit semantics (omitted/finite/Infinity).
- `test/hybrid-ranking.test.ts`: added two regression tests in a new `Group 7b: CR-01` describe block:
  1. Reproduces the exact REVIEW.md scenario: 10 high-keyword-scoring tools all role-blocked + 1 low-keyword-scoring tool role-allowed. Asserts the role-allowed tool appears in results despite the top-10 keyword matches all being filtered out by RBAC. Pre-fix this returned 0 results; post-fix returns 1 result.
  2. End-to-end test: 15 keyword-matching tools, default limit (5). Asserts `total_available === 15` (full role-allowed surface ranked internally) and `tools.length === 5` (limit honored at the slice).

**Why option B over option A:**
The prompt offered both options. Option B was chosen because:
- Minimal-surface change — extends existing `scoreAndRank` rather than adding a new sibling function.
- `test/search.test.ts` (a Gate 4 baseline file) passes `limit=20` (finite) and asserts `length === 10` — that test stays byte-identical because the cap still applies for finite limits.
- The `Infinity` sentinel is a well-defined opt-in (caller writes `Infinity` explicitly), not a silent semantics change for any existing caller.

**Verification:** Tier 2 (typecheck PASS + 17 hybrid-ranking + 15 search.test tests PASS). Tier 3 (full suite 187/187 + Gate 4 byte-identical confirmed).

---

### WR-01: Dimension-mismatch in hybrid path throws and propagates to MCP caller

**Files modified:** `src/core.ts`, `test/hybrid-ranking.test.ts`
**Commit:** `072af42`
**Approach:** Option (b) from REVIEW.md (defensive try/catch around `cosineSimilarity` per-tool — matches the prompt's stated preference).

**Applied fix:**
- `src/core.ts`: wrapped the per-tool `cosineSimilarity(queryVec, toolVec)` call in `scoreAndRankHybrid` with a `try/catch`. On any throw (dimension mismatch, future invariant violations), the tool's semantic score is set to 0 and the loop continues. Comment block documents:
  - Why graceful fallback (consistency with `embedQuery`'s "never propagate to MCP caller" philosophy).
  - Why no `console.warn` here (RBAC invariant — per-tool warns would require logging tool names; warn-once surface is owned by `embedQuery`).
- `test/hybrid-ranking.test.ts`: added two regression tests in a new `Group 7a: WR-01` describe block:
  1. Counter-based provider where build returns 8-dim vectors and query returns 16-dim. Asserts the MCP call resolves successfully (no propagated rejection) and produces results — the throw was caught silently per-tool.
  2. Verifies that when all tools score semantic 0 (uniform → all-zeros after min-max), the keyword tier ordering still produces correct output — `'customer'` (EXACT_NAME=10) > `'getCustomer'` (PARTIAL_NAME=5) > `'unrelated_tool'` (filtered by `score>0`).

**Verification:** Tier 2 (typecheck PASS + hybrid-ranking 27 → 29 tests PASS). Tier 3 (full suite 178/178 PASS).

---

### WR-02: `combineHybrid` does not validate weights at runtime — partial weights produce silent NaN scores

**Files modified:** `src/hybrid-scoring.ts`, `src/core.ts`, `test/hybrid-scoring.test.ts`, `test/hybrid-ranking.test.ts`
**Commit:** `f144588`
**Approach:** Two-layer fix per the prompt's "pick one and add a unit test" directive — both layers were applied for defense-in-depth (the two layers are complementary, not duplicative).

**Applied fix:**
- `src/hybrid-scoring.ts` (canonical contract boundary): `combineHybrid` now validates that `weights.semanticWeight` and `weights.keywordWeight` are each `typeof 'number'` AND `Number.isFinite()`. Throws a descriptive error pinpointing the malformed field on missing/NaN/Infinity/non-number values. Any caller that bypasses the engine (e.g., direct tests, future module consumers) gets validated.
- `src/core.ts` (engine ergonomic boundary): replaced the original `weights ?? { 0.7, 0.3 }` pattern (which only defaulted when `weights` was wholly absent) with per-field default coercion:
  ```
  const userWeights = this.config.embeddings?.weights;
  const weights = {
    semanticWeight: userWeights?.semanticWeight ?? 0.7,
    keywordWeight: userWeights?.keywordWeight ?? 0.3,
  };
  ```
  Partial weight configs from JS callers now silently fall back to defaults per-field. `combineHybrid`'s strict validation remains as a defense-in-depth boundary that partial configs no longer reach via the engine but still catch direct test/library consumers.
- `test/hybrid-scoring.test.ts`: added 7 validation tests:
  - Missing `keywordWeight` (throws — exact regex on field name + value)
  - Missing `semanticWeight` (throws)
  - NaN `semanticWeight` (throws)
  - Infinity `keywordWeight` (throws)
  - Non-number string `keywordWeight` (throws)
  - Both-zero weights (accepted — finite, returns all zeros)
  - Negative weights (accepted — finite, contract is "finiteness only" not range-checked)
- `test/hybrid-ranking.test.ts`: added 2 engine-level coercion tests (`Group 6b: WR-02`):
  - Partial weights `{ semanticWeight: 0.5 }` (missing keyword) — engine produces non-empty results with default 0.3 keyword weight.
  - Partial weights `{ keywordWeight: 0.5 }` (missing semantic) — engine produces non-empty results with default 0.7 semantic weight.

**Verification:** Tier 2 (typecheck PASS + 25 hybrid-scoring → 32 tests PASS + 29 hybrid-ranking → 31 tests PASS). Tier 3 (full suite 187/187 PASS, coverage 99.73%).

---

### WR-03: Hybrid path filters `score > 0` AFTER min-max normalization — single/two-tool surface degenerates

**Files modified:** `src/core.ts`
**Commit:** `8f5361e`
**Approach:** Per the prompt's preferred fix: "add `// LOCKED: per DEC-v11-08-02` comment above the `score > 0` filter so it's not 'fixed' by a future contributor." Comment-only fix.

**Applied fix:**
- `src/core.ts`: added a multi-line `// LOCKED: per DEC-v11-08-02` block above the `withSignal = indexed.filter((x) => x.score > 0)` line. The comment explains:
  - Why min-max normalization sends the per-query MINIMUM raw score to 0 even when non-zero.
  - Why `max === min` (single-tool / all-equal-on-track) yields all-zeros.
  - That the strict `> 0` filter therefore drops entries with real raw signal — by design, not by bug.
  - That relaxing to `>= 0` or replacing with a pre-normalization signal indicator changes the observable contract for every existing test and consumer, requiring a board-approved DEC update.

**Why comment-only and not an algorithmic fix:**
REVIEW.md's "cleanest semantic fix" suggestion (track `hadSignal` pre-normalization, prune by that) is a behavior-changing refactor that would alter the output for the single-tool degenerate case (currently empty → would return the tool). That observable change requires a DEC update under `<critical_rules>` ("DO respect CLAUDE.md project conventions", DEC-v11-08-02 is locked per CONTEXT.md). The comment lock is the prompt-specified scope of WR-03.

**Verification:** Tier 1 (re-read confirms comment block present, surrounding code intact) + Tier 2 (typecheck PASS, 187/187 tests still PASS — no behavioral change).

---

### WR-04: `scoreAndRankHybrid` / `scoreAndRankKeywordWithRoleAfter` symmetry — keyword path was broken by CR-01

**Files modified:** none (auto-resolved)
**Commit:** `4566261` (the CR-01 commit also resolves WR-04)
**Approach:** Per the prompt's instruction: "WR-04 — auto-resolves once CR-01 is fixed. Should not need separate work but verify after CR-01 fix." Verification only.

**Verification:**
- The CR-01 fix made `scoreAndRank(query, this.index, Infinity)` actually return the full ranked surface. Both the hybrid path (`scoreAndRankHybrid`) and the keyword fallback path (`scoreAndRankKeywordWithRoleAfter`) now apply `resolveRoleAccess` AFTER ranking against the full surface.
- The CR-01 regression test (`Group 7b: CR-01: with >10 keyword matches where top-10 are role-blocked, role-allowed lower-scored tools STILL appear`) directly proves the keyword fallback now produces the same observable output a hybrid-with-zero-semantic would: rank then filter.
- Build-pending consistency: a query during the build-pending window now goes through the same rank-then-filter pivot as a query after build completes (assuming embedQuery succeeds in the post-build case). The transient inconsistency REVIEW.md described is resolved.

No separate commit. WR-04 status: RESOLVED.

## Skipped Issues

None.

## Info Findings (Out of Scope)

The 3 Info findings (IN-01, IN-02, IN-03) are out of scope for this fix iteration per `fix_scope=critical_warning`:
- **IN-01:** Centralize keyword fallback (refactor — `runHybridQuery` else-branch could be merged with `handleSearchTools` no-vectors branch). Optional.
- **IN-02:** Extract shared 5-tier scoring loop between `scoreAndRank` and `keywordScoreForEntry`. The plan author explicitly accepted the duplication (T-08-04 disposition: keep `scoreAndRank` byte-identical to avoid `test/search.test.ts` Gate 4 risk). Optional.
- **IN-03:** Tighten P9 negative control test comment to clarify the engine's contribution vs provider-controlled error message content. Cosmetic.

These can be addressed in a follow-up polish phase if desired.

## Fix Summary Table

| Finding | Severity | Status | Files Modified | Commit |
|---------|----------|--------|----------------|--------|
| CR-01 | BLOCKER | fixed | `src/search.ts`, `test/hybrid-ranking.test.ts` | `4566261` |
| WR-01 | WARNING | fixed | `src/core.ts`, `test/hybrid-ranking.test.ts` | `072af42` |
| WR-02 | WARNING | fixed | `src/hybrid-scoring.ts`, `src/core.ts`, `test/hybrid-scoring.test.ts`, `test/hybrid-ranking.test.ts` | `f144588` |
| WR-03 | WARNING | fixed | `src/core.ts` (comment-only) | `8f5361e` |
| WR-04 | WARNING | fixed (auto) | (none — auto-resolved by CR-01) | `4566261` |

## Test Surface Delta

| Metric | Pre-fix (Phase 8 close-out) | Post-fix |
|--------|------------------------------|----------|
| Total tests | 174 | 187 (+13) |
| `test/hybrid-scoring.test.ts` | 25 | 32 (+7 WR-02 validation) |
| `test/hybrid-ranking.test.ts` | 25 | 31 (+2 CR-01, +2 WR-01, +2 WR-02 engine-level) |
| Coverage (statement) | 99.72% | 99.73% (+0.01) |
| Coverage (branch) | 96.27% | 96.47% (+0.20) |
| Coverage (functions) | 97.36% | 97.36% (unchanged) |
| Coverage (lines) | 99.69% | 99.70% (+0.01) |

All Phase 7 baseline coverage gates (≥99.61% statement) maintained.

---

_Fixed: 2026-04-26T21:36:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
