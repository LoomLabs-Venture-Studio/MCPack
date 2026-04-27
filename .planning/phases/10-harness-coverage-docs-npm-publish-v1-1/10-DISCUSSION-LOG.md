# Phase 10: Harness, Coverage, Docs, npm Publish (v1.1) — Discussion Log

**Date:** 2026-04-27
**Mode:** Standard discuss-phase (single-pass batch question form via AskUserQuestion)
**Participants:** Board (zmarji@gmail.com), Claude

This log is for human reference only — audits, retrospectives. Canonical record is `10-CONTEXT.md`.

---

## Phase 10 framing presented to user

**THE V1.1 GA GATE.** Phase 10 produces:
1. Measurement report (Stripe harness rerun + 50-query intent benchmark + perf budget)
2. Docs delta (README + CHANGELOG + 2 new doc pages)
3. Pre-publish checklist verified
4. Both packages published to npm with board approval

Coverage gate already exceeded: 234 tests / 99.78% (vs PRD ≥120 / ≥99%). Both packages already at version 1.1.0 in source — Phase 10 is the publish operation, not a version bump.

**Carrying forward:**
- 5 BLOCKING gates carry forward (zero-deps, public-API additive, adapter-isolation, baseline tests byte-identical, wire-protocol exposure ban)
- Publish ordering: core first, then adapter (peer-dep resolution)
- Backward compat invariant: zero config changes for v1.0 → v1.1 upgrade
- Board approval required before `npm publish` (governance.md)
- Add CHANGELOG.md (no current changelog)

---

## Question 1: OQ4 — 50-query intent benchmark source

**Options presented:**
- Stripe-derived (Recommended)
- Synthetic mixed-domain
- Community-curated dataset

**User answer:** Stripe-derived (Recommended)

**Captured as:** DEC-v11-10-01 — 50 hand-authored queries against real Stripe MCP tools (28); reuses existing harness infrastructure; recall@5 metric; ≥15% improvement target

**Deliverable shape captured:**
- `test/harness/intent-benchmark-queries.json` (committed — 50 queries with expected tools)
- `test/harness/intent-benchmark.ts` (committed — runner, sibling to stripe-harness.ts)
- `npm run benchmark` script
- `test/harness/intent-benchmark-report.json` (output, gitignored)
- Query mix: 10 easy / 20 paraphrased / 10 abbreviation / 10 typo-or-partial

---

## Question 2: Plan slicing

**Options presented:**
- 3 plans: Measurement, Docs, Publish (Recommended)
- 4 plans (split pre-publish from publish)
- 2 plans (combine measurement + docs)

**User answer:** 3 plans (Recommended)

**Captured as:** DEC-v11-10-02 — Plan 10-01 (measurement, autonomous) → Plan 10-02 (docs, autonomous, depends on 10-01) → Plan 10-03 (pre-publish + publish, BOARD-APPROVED, depends on 10-01 + 10-02)

Only Plan 10-03 has the `autonomous: false` checkpoint (board approval before npm publish executes).

---

## Question 3: Docs scope

**Options presented:**
- Minimal deltas + CHANGELOG (Recommended)
- Full docs restructure
- README + CHANGELOG only (skip doc pages)

**User answer:** Minimal deltas + CHANGELOG (Recommended)

**Captured as:** DEC-v11-10-03 — README updates, CHANGELOG.md (NEW), `docs/semantic-search.md` (NEW), `docs/analytics.md` (NEW), adapter package README. Full docs site restructure deferred to v1.2.

---

## Question 4: Publish strategy

**Options presented:**
- Direct to `latest` (Recommended)
- RC soft-launch (1.1.0-rc.1 → 1.1.0)
- Beta tag bake period

**User answer:** Direct to `latest` (Recommended)

**Captured as:** DEC-v11-10-04 — `npm publish` both packages directly to `latest` tag. No RC/beta dance. Recovery via `npm unpublish` within 72h or `npm deprecate` after.

**Rationale captured in CONTEXT:**
- 234/234 tests, 99.78% coverage, 11/11 verification dimensions PASS across 4 phases
- Code review: 0 critical, 1 BLOCKER caught and fixed (Phase 8), all warnings resolved
- Backward compat invariant proven byte-identical when embeddings unset
- Adapter is opt-in; no runtime risk for existing v1.0 users

---

## Scope creep redirected

None during this session — discussion stayed within Phase 10's boundary.

---

## Deferred ideas captured

- Full docs site restructure (v1.2)
- Search engine direction ADR (REQ-v12-search-engine-direction — already deferred per ROADMAP)
- CI-driven publish (Phase 999.1 / v1.2)
- Persistent analytics export (OTEL/file/webhook — v1.2 candidate)
- Phase 8/9 INFOs (7 total) — code-quality polish, promote to 999.x backlog if accumulating
- `npm unpublish` automation — manual recovery only

---

## Claude's discretion items (planner picks)

- Exact filename for release report (phase dir vs docs/release-reports/)
- `npm run benchmark` vs `npm run intent-benchmark` script name
- Whether to add `prepublishOnly` script (recommended yes)
- Adapter README depth (recommended: install + 1 example + peer-dep + perf characteristics)
- Local vs CI publish (recommended: local for v1.1; CI in v1.2)

---

## Phase 10 NEW gates added

Beyond the 5 carry-forward BLOCKING gates, Phase 10 adds two:

- **Gate 6 (PRD success criteria):** the 4 numerical targets must hold (80.7% Stripe, 15% recall, 50ms p99, 5s build)
- **Gate 7 (registry resolution proof):** post-publish, fresh `npm install` in temp dir + 5-line smoke test must succeed

---

## Outcome

CONTEXT.md written. Ready for `/gsd-plan-phase 10` (which will trigger researcher → planner → plan-checker pipeline). Plan 10-03 will encode the `autonomous: false` board-approval checkpoint before any `npm publish` executes.
