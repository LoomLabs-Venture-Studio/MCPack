# MCPack — Playbook

## Project Standards (Permanent)

### Development Protocol

Before ANY code change:
1. Read the target file(s) completely
2. Understand current behavior
3. Identify all callers/consumers (grep `src/` and `test/`)
4. Check `.planning/` phase artifacts for prior decisions on this module

After EVERY code change:
1. `npm run typecheck` — must pass
2. `npm run build` — must pass (tsc emits to `dist/`)
3. `npm test` — must pass, no regressions (100 tests baseline, 99.56% coverage)
4. If touching search/index/roles/session/core/wrap/build: `npm run test:coverage` — don't let statement coverage regress
5. All green → commit
6. Any red → fix before continuing

This protocol applies whether using a harness or not.

### Commit Messages
```
type(scope): description
type: fix | feat | refactor | test | docs | chore
scope: (NN-NN) for GSD plans, (phase-NN) for phase-wide commits, or a module/area name
```

### Quality Gates
1. Typecheck passes (`tsc --noEmit`)
2. Build passes (`tsc` emits dist/)
3. No test regressions; coverage does not drop below 99%
4. Scope check: only change what's assigned
5. Security: no secrets committed, no new peer/runtime deps without board approval, no leaking of restricted tools' existence via error messages (RBAC invariant)
6. Public API: any change to `src/index.ts` exports or `src/types.ts` public types is a breaking-change review point

### Rollback Protocol
1. `git stash` current changes
2. Verify clean state: `npm run typecheck && npm test`
3. Report failure
4. Do NOT retry same approach
5. Propose alternative, wait for approval

---

## Current Sprint (CTO Updates This Section)

### Sprint: Phase 8 — Hybrid Ranking Query Path (v1.1)
**Type:** v1.1 milestone phase 3 of 5
**Priority:** P0
**PRD Status:** `.planning/inbox/processed/mcpack-prd-v1.1-gsd.md` — board-approved 2026-04-25
**Harness:** GSD v2
**Status:** PLANNED + VERIFIED, ready for `/gsd-execute-phase 8`

### Board Locks (still active across all v1.1 phases)
- **v1.1 = Search & Observability** (PRD B): semantic search via `EmbeddingProvider` hook + `getAnalytics()` API. Adapter package `@llvs/mcpack-embeddings`.
- **v1.2 = Partner Hub** (PRD A): multi-source, dynamic role resolution, Google OAuth, HTTP/SSE transport. **Deferred** — locked at the planning artifact level; do not start until v1.1 ships.
- **Embedding library:** `@huggingface/transformers ^4.0.0` (DEC-v11-03 clerical-correction; `@xenova/transformers` was renamed and frozen).
- **Core stays zero-dep** through both milestones — non-negotiable. Three [BLOCKING] gates enforce this on every phase.

### What's Done in v1.1 So Far
- ✅ **Phase 6 — EmbeddingProvider Interface + Adapter Scaffold** (2026-04-26): types + version bump 1.0.0→1.1.0 + sibling package `@llvs/mcpack-embeddings`. 11/11 verification dimensions PASS.
- ✅ **Phase 7 — Semantic Index Build Pipeline** (2026-04-26): non-blocking startup index build, `isIndexReady()`, RBAC-safe failure path. 11/11 verification dimensions PASS, 124/124 tests, 99.61% coverage.

### Open Code Review Items (carry forward to Phase 8)
- **WR-01** — `isIndexReady()` returns `true` for empty-tools no-op path. Phase 8's hybrid router must not treat `isIndexReady() === true` as "vectors are present" — gate on `semanticIndex.size > 0` instead, or refactor to an `indexBuildState` enum during Phase 8 planning.
- **WR-02** — No regression test asserts the unhandled-rejection invariant (removing the `.catch` in `core.ts:74-80` would silently pass current suite). Add an `unhandledRejection` listener test in Phase 8 or as a tiny standalone fix.
- **WR-03** — RBAC "no tool names in warn" test is fixture-name-coupled; tighten to assert locked warn format directly + iterate actual fixture names.

### Phase 8 Locked Decisions (from /gsd-discuss-phase 8)
- **DEC-v11-08-01** — Hybrid weights = config-only (no per-query overrides on `search_tools` args). Resolves OQ2.
- **DEC-v11-08-02** — Score normalization = per-query min-max to [0,1] for both tracks before combine. Degenerate `max == min` → all zeros.
- **DEC-v11-08-03** — WR-01 fix = additive `hasVectors(): boolean` helper on `MCPackEngine`. Phase 7's `isIndexReady()` API stays unchanged.
- **DEC-v11-08-04** — Plan structure = 2 plans, each ships its own tests (no coverage trough mid-phase).

### Active Sprint — Phase 8 plans authored + verified
- **08-01 (Wave 1)** — Scoring kernel + unit tests: pure functions in `src/hybrid-scoring.ts` (`cosineSimilarity`, `minMaxNormalize`, `combineHybrid`) + additive `keywordScoreForEntry` in `src/search.ts` + 24 unit tests in `test/hybrid-scoring.test.ts`.
- **08-02 (Wave 2)** — Query path integration + integration tests: Wave 0 empirical check (BLOCKING) → async refactor of `handleSearchTools` → `hasVectors()` gate → per-query embedding with warn-once-per-instance error handling → role-filter-after-rank pivot → 21 integration tests in `test/hybrid-ranking.test.ts` (incl. P7 + P8 + P9 + P10 negative controls + WR-02 unhandled-rejection regression).
- **Plan-checker iter 1:** 0 BLOCKERS + 2 WARNINGS (RESEARCH `## Open Questions` missing RESOLVED markers; Wave 0 verify was placeholder echo).
- **Plan-checker iter 2:** VERIFICATION PASSED — all 12 dimensions clean.
- **Carry-forward fixes encoded:** WR-01 → `hasVectors()` (DEC-v11-08-03); WR-02 → `process.on('unhandledRejection', listener)` regression covers BOTH Phase 7 build path AND Phase 8 query path; WR-03 → rename-safe `tools.map(t => t.name)` pattern at all NEW Phase 8 RBAC test sites.
- **4 BLOCKING gates (carry-forward, baseline advanced to `cd1fc52`):** zero-new-core-deps (broadened jq), public-API additive-only (src-based), adapter-isolation (src+test), baseline tests byte-identical (9-file explicit list).

### Acceptance Criteria (Phase 8 execution)
- [ ] All 5 phase REQ-IDs delivered (`semantic-query-path`, `hybrid-ranking`, `role-filter-after-rank`, `backward-compat`, `session-invariants`)
- [ ] 124 baseline tests pass byte-identically; +45 new tests (24 unit + 21 integration) → ~169 total
- [ ] Coverage ≥99.61% statement maintained
- [ ] All 4 [BLOCKING] gates pass against `cd1fc52` baseline
- [ ] `npm run typecheck && npm run build && npm test` all green
- [ ] `MCPackEngine.hasVectors()` exists; `isIndexReady()` API unchanged from Phase 7
- [ ] `handleSearchTools` async signature change does not affect public API (wrap.ts/build.ts already await — verified empirically by plan-checker)
- [ ] Wave 0 empirical check passes: 124 baseline tests pass against unified rank-then-filter pipeline (or paths split if any fail)
- [ ] Query-embedding-failure: single locked-format warn `^MCPack: query embedding failed: `, no tool names leaked, fallback to v1.0 keyword
- [ ] All 4 pitfall negative controls (P7, P8, P9, P10) pass

### Implementation Plan
1. `/gsd-execute-phase 8` — Wave 1 (08-01) lands first; Wave 2 (08-02) after, with Task 1 = Wave 0 empirical check (BLOCKING — halts on any baseline-test failure)
2. After both waves: spawn gsd-verifier for goal-backward verification (target: 11/11 dimensions like Phase 6/7)
3. Update ROADMAP.md / STATE.md / PLAYBOOK Recent Sprints with Phase 8 close-out
4. Plan Phase 9 next (Tool Usage Analytics — `getAnalytics()`, AnalyticsStore)

---

## Recent Sprints (Log)

### Phase 7 — Semantic Index Build Pipeline ✓ (2026-04-26)
- **Type:** v1.1 milestone phase 2 of 5
- **Outcome:** Non-blocking startup semantic-index build wired into `MCPackEngine`. Constructor returns synchronously; `tools/list` byte-identical to v1.0 when query path unchanged.
- **Engineer:** delivered 5 commits across 2 waves (972ad77, 61b5aea, f2df1f7 → Wave 1; 6d4f208, 2c9a249 → Wave 2)
- **Plans:** 07-01 (engine pipeline + helper file), 07-02 (17-test suite across 7 describe groups)
- **Result:** 124/124 tests pass (107 baseline + 17 new) | **99.61% statement coverage** (up from 99.56% Phase 6 baseline; `core.ts` and `semantic-index-builder.ts` both 100%) | All 4 [BLOCKING] gates pass against `bec3f6f` (zero-dep, public-API additive, adapter-isolation, baseline tests byte-identical) | 11/11 verification dimensions PASS | RBAC invariant proved via Pitfall 7 negative-control test (zero new `console.warn` during build-pending) | Build-failure path emits exactly one warn matching `^MCPack: semantic index build failed: ` with no tool names leaked
- **Notable observations:**
  - Wave 2 executor committed directly to `main` from inside its worktree rather than to the worktree branch — irregular but the commits landed correctly with no conflicts; cleanup needed only the stale branch
  - Wave 1 executor had to rewrite its own JSDoc to avoid tripping the plan's adapter-literals grep (clerical fix, behavior unchanged) — same pattern as Phase 6's adapter-isolation gate
- **Code review:** 0 critical, 3 warnings, 5 info — all carry forward to Phase 8 as guardrails (see Open Code Review Items above)
- **Lesson:** When orchestrator-owned files (STATE.md, ROADMAP.md) need to be re-protected during worktree merge, the snapshot-restore-amend dance works but adds noise to history; consider whether the orchestrator can write tracking updates AFTER all worktree merges land in a single commit instead of per-wave.

### Phase 6 — EmbeddingProvider Interface + Adapter Scaffold ✓ (2026-04-26)
- **Type:** v1.1 milestone phase 1 of 5
- **Outcome:** Type-only plumbing + new sibling package `@llvs/mcpack-embeddings` scaffolded
- **Engineer:** delivered 6 commits (e10e25c → 9571d8b)
- **Plans:** 06-01 (core types + version bump 1.0.0→1.1.0), 06-02 (adapter package + MiniLM via @huggingface/transformers ^4.0.0)
- **Result:** 107/107 root tests pass + 5 adapter tests pass | 99.56% statement coverage (v1.0 baseline preserved) | All 3 [BLOCKING] gates pass (zero-deps, public-API additive-only, adapter-isolation) | 11/11 verification dimensions PASS
- **Notable deviation:** `npm install` in adapter couldn't resolve `@llvs/mcpack@^1.1.0` from registry (not yet published) — used `npm link` per plan's documented fallback. Phase 10 publish resolves it. Recorded in 06-02-SUMMARY.md.
- **Lesson:** Pre-Phase-6 PRD ingest carried forward a stale `@xenova/transformers` reference (frozen since May 2024). Researcher caught it before plan execution; corrected to `@huggingface/transformers ^4.0.0` via DEC-v11-03 clerical-correction. Future PRD ingests should `npm view <pkg>` for active maintenance status before locking dep names.

### DEPS-1 — Dependabot vuln cleanup ✓ (2026-04-25)
- **Type:** chore (security)
- **Outcome:** All 6 transitive CVEs resolved via `npm audit fix` (no `--force`)
- **Engineer:** delivered commit `08d6bfa`
- **Result:** `npm audit` → 0 vulns | 100/100 tests pass | 99.56% statement coverage (baseline match) | `package.json` unchanged | 256 lines of `package-lock.json` churn, net -6
- **Lesson:** Phase 999.1 (CI/CD) should add `npm audit` as a PR gate to catch these at submit time, not via post-push Dependabot

### Harness Integration
Harness active: **GSD v2**. Drive work via `/gsd-new-milestone` → `/gsd-plan-phase` → `/gsd-execute-phase`. The Current Sprint section above feeds the harness as the high-level spec; GSD artifacts in `.planning/phases/<phase>/` are the detailed contract.
