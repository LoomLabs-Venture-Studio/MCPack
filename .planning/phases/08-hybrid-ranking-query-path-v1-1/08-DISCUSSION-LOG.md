# Phase 8: Hybrid Ranking Query Path (v1.1) — Discussion Log

**Date:** 2026-04-26
**Mode:** Standard discuss-phase (single-pass batch question form via AskUserQuestion)
**Participants:** Board (zmarji@gmail.com), Claude

This log is for human reference only — audits, retrospectives. It is NOT consumed by downstream agents (researcher, planner, executor). The canonical record is `08-CONTEXT.md`.

---

## Phase 8 framing presented to user

**Domain:** Per-query embedding → cosine similarity → hybrid score `(0.7·semantic) + (0.3·keyword)` → role filter applied AFTER ranking. Modifies `src/core.ts handleSearchTools()` and extends `src/search.ts` with cosine + hybrid combine.

**Carrying forward (no re-discussion):**
- EmbeddingProvider type contract (DEC-v11-01) and adapter-isolation gate from Phase 6
- Hybrid formula default `(0.7·semantic) + (0.3·keyword)`; weights field already typed in Phase 6
- Role filter AFTER ranking; opaque denial preserved
- Backward compat: `embeddings` absent → byte-identical to v1.0
- Build-pending → v1.0 keyword fallback (Phase 7 contract); `isIndexReady()` gates query path
- Three [BLOCKING] gates: zero-new-core-deps, public-API additive-only, adapter-isolation
- Coverage ≥99%, tests must grow

---

## Question 1: OQ2 — Hybrid weight configuration scope

**Question:** Per-query weight overrides via `search_tools` args, or config-only?

**Options presented:**
- Config-only (Recommended)
- Config + per-query override
- Defer per-query to v1.2

**User answer:** Config-only (Recommended)

**Captured as:** DEC-v11-08-01 — config-only resolves OQ2

**Rationale:** Smallest API surface, matches PRD literally, agents tune at deploy-time. Per-query revisited in v1.2 if real users ask for it.

---

## Question 2: Score normalization

**Question:** Cosine is [-1,1], keyword sums are unbounded. Hybrid combine requires comparable scales — which normalization approach?

**Options presented:**
- Per-query min-max normalize both to [0,1] (Recommended)
- Fixed-scale normalization (semantic·0.5+0.5, keyword/MAX_KEYWORD)
- Rank-based reciprocal-rank-fusion (RRF)

**User answer:** Per-query min-max normalize both to [0,1] (Recommended)

**Captured as:** DEC-v11-08-02 — per-query min-max to [0,1]

**Rationale:** Query-local, no calibration constants, simplest defensible default. RRF rejected because it changes weight semantics from score-influence to rank-influence — would subtly break the PRD's literal `0.7·semantic + 0.3·keyword` formula.

**Edge cases captured for the planner:**
- All keyword scores zero → keyword normalized = 0 (short-circuit on `max == min`)
- All semantic scores identical → semantic normalized = 0
- Empty candidate set → return `[]` immediately
- Single-tool surface → trivially `[1.0]` for any track with signal

---

## Question 3: WR-01 fix (Phase 7 carry-forward)

**Question:** `isIndexReady()` returns true for empty no-op. Which fix?

**Options presented (initial):**
- Gate on `semanticIndex.size > 0` inside Phase 8 router (Recommended)
- Refactor to `indexBuildState` enum
- Add `hasVectors()` helper, leave `isIndexReady()` alone

**User pushback:** "why not add hasvector()?"

**Claude reconsidered honestly:** Initial "Recommended" was lazy minimal-change bias. Option A papers over the misleading semantics at the call site instead of fixing them. `hasVectors()` and `isIndexReady()` answer two different questions — empty-no-op is a real third state that deserves a name. Cost is roughly equal to inline gating. No "redundancy" cost — that was overstated.

**User answer (after re-frame):** Add `hasVectors()` helper

**Captured as:** DEC-v11-08-03 — `hasVectors()` helper, `isIndexReady()` API stays unchanged

---

## Question 4: Plan structure

**Question:** How to slice Phase 8's wider code surface (cosine util + hybrid combiner + normalization + handleSearchTools rewire + query-time embedding + build-pending fallback + hasVectors helper + tests)?

**Options presented:**
- 2 plans: scoring kernel + query path (Recommended) — each plan ships its own tests, no coverage trough
- 3 plans: kernel + query path + tests (Phase 7 mirror) — predictable wave timing, has temporary coverage drop
- 1 plan, single wave — smallest GSD overhead but most executor risk

**User answer:** 2 plans: scoring kernel + query path (Recommended)

**Captured as:** DEC-v11-08-04 (process decision, not behavioral) — 2-plan slicing with paired tests in each plan, eliminating Phase 7's mid-phase coverage trough.

---

## Scope creep redirected

None during this session — discussion stayed within Phase 8's boundary.

---

## Deferred ideas captured

- Per-query weight overrides (DEC-v11-08-01) — revisit in v1.2 if needed
- RRF hybrid scoring — v2.0 candidate if score-based proves insufficient
- Query-embedding caching — Phase 10 benchmark candidate; design deferred
- `notifications/tools/list_changed` rebuild — already deferred to v1.2 (Phase 7)
- Tightening Phase 7's WR-03 RBAC test — optional in Phase 8, planner's call

---

## Claude's discretion items (planner picks)

- Exact function names in `src/search.ts` or new sibling file
- Whether to add new file `src/hybrid-scoring.ts` (matches Phase 7's sibling pattern) or extend `src/search.ts`
- Over-fetch-then-filter vs filter-with-rank-preserved for role filter post-rank
- Warned-once mechanism for query-embedding-failure (instance flag, WeakSet, etc.)
- Whether build-pending fallback emits a query-time warning (recommendation: stay silent, preserve Pitfall 7 negative control)

---

## Outcome

CONTEXT.md written. Ready for `/gsd-plan-phase 8` (which will trigger researcher → planner → plan-checker pipeline).
