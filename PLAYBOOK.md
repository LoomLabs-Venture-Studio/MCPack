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

### Sprint: Phase 9 — Tool Usage Analytics (v1.1) — UNPLANNED
**Type:** v1.1 milestone phase 4 of 5
**Priority:** P0
**PRD Status:** `.planning/inbox/processed/mcpack-prd-v1.1-gsd.md` — board-approved 2026-04-25
**Harness:** GSD v2
**Status:** Phase 8 SHIPPED 2026-04-27 — Phase 9 needs `/gsd-discuss-phase 9` then `/gsd-plan-phase 9`

### Board Locks (still active across all v1.1 phases)
- **v1.1 = Search & Observability** (PRD B): semantic search via `EmbeddingProvider` hook + `getAnalytics()` API. Adapter package `@llvs/mcpack-embeddings`.
- **v1.2 = Partner Hub** (PRD A): multi-source, dynamic role resolution, Google OAuth, HTTP/SSE transport. **Deferred** — locked at the planning artifact level; do not start until v1.1 ships.
- **Embedding library:** `@huggingface/transformers ^4.0.0` (DEC-v11-03 clerical-correction; `@xenova/transformers` was renamed and frozen).
- **Core stays zero-dep** through both milestones — non-negotiable. Three [BLOCKING] gates enforce this on every phase.

### What's Done in v1.1 So Far
- ✅ **Phase 6 — EmbeddingProvider Interface + Adapter Scaffold** (2026-04-26): types + version bump 1.0.0→1.1.0 + sibling package `@llvs/mcpack-embeddings`. 11/11 verification dimensions PASS.
- ✅ **Phase 7 — Semantic Index Build Pipeline** (2026-04-26): non-blocking startup index build, `isIndexReady()`, RBAC-safe failure path. 11/11 verification dimensions PASS, 124/124 tests, 99.61% coverage.
- ✅ **Phase 8 — Hybrid Ranking Query Path** (2026-04-27): per-query embedding + cosine similarity + hybrid scoring (0.7·sem + 0.3·kw) + role-filter-after-rank pivot + `hasVectors()` helper. 11/11 verification dimensions PASS, 187/187 tests, 99.73% coverage. Code review surfaced 1 BLOCKER (CR-01 — Infinity-clamp bug in v1.0 keyword-fallback path); auto-fix loop resolved with 13 net new regression tests.

### Open Code Review Items (carry forward to Phase 8)
- **WR-01** — `isIndexReady()` returns `true` for empty-tools no-op path. Phase 8's hybrid router must not treat `isIndexReady() === true` as "vectors are present" — gate on `semanticIndex.size > 0` instead, or refactor to an `indexBuildState` enum during Phase 8 planning.
- **WR-02** — No regression test asserts the unhandled-rejection invariant (removing the `.catch` in `core.ts:74-80` would silently pass current suite). Add an `unhandledRejection` listener test in Phase 8 or as a tiny standalone fix.
- **WR-03** — RBAC "no tool names in warn" test is fixture-name-coupled; tighten to assert locked warn format directly + iterate actual fixture names.

### Open Code Review Items from Phase 8 (advisory, IN-scope deferred)
Phase 8 fix-loop closed all critical+warnings (5/5). Three INFOs were OUT of fix scope:
- **IN-01** — keyword fallback called from two sites in `core.ts`; could be centralized to a single helper.
- **IN-02** — `scoreAndRank` and `keywordScoreForEntry` duplicate the 5-tier loop; extract into a shared helper to keep them in sync.
- **IN-03** — P9 RBAC test passes by construction (test-controlled error message); the truly adversarial provider-error-contains-tool-names case isn't tested.

Promote any of these to a Phase 999.x backlog item if they accumulate weight before v1.1 ships.

### Next Sprint — Phase 9 Discuss + Plan Phase
- **Goal:** `AnalyticsStore` (search/call/denial/miss events), `getAnalytics()` API on server handle, role-scoped queries, dead-tool detection.
- **Requirements:** REQ-v11-analytics-events, REQ-v11-analytics-storage, REQ-v11-analytics-privacy, REQ-v11-analytics-api, REQ-v11-analytics-role-scoped-query, REQ-v11-analytics-rbac-integrity, REQ-v11-dead-tool-detection
- **Open questions to resolve in discuss-phase:**
  - **OQ1** — `getAnalytics()` flat on handle vs separate `analytics` property
  - **OQ5** — denial events record tool name even for operators (RBAC-sensitive)
- **Pre-plan asks for the engineer/researcher:**
  1. Storage shape: in-memory only, configurable `maxEvents` cap, oldest-dropped on overflow.
  2. `getAnalytics()` is a server-handle API, NEVER an MCP tool — direct call from the host process.
  3. Role-scoped queries respect RBAC: callers see only events from sessions they have role visibility into.
  4. Dead-tool detection: tools with zero `call` events over a window → flag for removal.

### Provisional Phase 9 acceptance criteria (locked during plan-phase)
- [ ] `AnalyticsStore` captures 4 event types at correct decision points (search/call/denial/miss)
- [ ] In-memory only; resets on process restart; bounded by `maxEvents`
- [ ] `getAnalytics()` on server handle, role-scoped, NEVER exposed as an MCP tool
- [ ] RBAC integrity: out-of-role callers can't see other roles' events
- [ ] All 4 BLOCKING gates pass (zero-new-core-deps, public-API additive, adapter-isolation, baseline tests byte-identical)
- [ ] Coverage stays ≥99.61% (currently 99.73% post-Phase-8)
- [ ] No regression on the 187-test baseline

### Implementation Plan
1. `/gsd-discuss-phase 9` — lock OQ1 + OQ5 + storage shape decisions
2. `/gsd-plan-phase 9` — author plans + plan-checker verification cycle
3. `/gsd-execute-phase 9` — wave-based execution
4. After Phase 9 ships → Phase 10 (Harness Verification + Coverage + Docs + npm publish — the v1.1 GA gate)

---

## Recent Sprints (Log)

### Phase 8 — Hybrid Ranking Query Path ✓ (2026-04-27)
- **Type:** v1.1 milestone phase 3 of 5
- **Outcome:** Per-query embedding + cosine similarity + hybrid scoring (0.7·sem + 0.3·kw default) + role-filter-after-rank pivot. `MCPackEngine.hasVectors()` helper added; `isIndexReady()` API unchanged. `handleSearchTools` returns `ToolCallResult | Promise<ToolCallResult>` (sync on no-vectors path to preserve Gate 4 byte-identicality; Promise on hybrid path).
- **Engineer:** delivered 11 commits across 2 waves + 1 fix loop (08-01: 4 commits 83e8225/2ecf6f8/9363a06/5daea4e; 08-02: 3 commits c963cc5/4bf8a5e/a6c570b + 1 merge 059aaf4; fix loop: 4 commits 4566261/072af42/f144588/8f5361e)
- **Plans:** 08-01 (scoring kernel + 25 unit tests, including 1 deviation coverage test), 08-02 (engine integration + 25 integration tests, Wave 0 BLOCKING empirical check passed)
- **Result:** 187/187 tests pass (124 baseline + 63 new = 32 in `hybrid-scoring.test.ts` + 31 in `hybrid-ranking.test.ts`) | **99.73% statement coverage** (up from 99.61% Phase 7 baseline; `core.ts`/`hybrid-scoring.ts`/`search.ts` all 100%) | All 4 [BLOCKING] gates pass against `cd1fc52` (zero-deps, public-API additive, adapter-isolation, baseline tests byte-identical) | 11/11 verification dimensions PASS | Wave 0 empirical check passed (149 tests against unified rank-then-filter on disposable spike) | RBAC invariants proved across 14 RBAC sites using rename-safe `tools.map(t => t.name)` pattern
- **Code review:** 1 BLOCKER + 4 WARN + 3 INFO. Auto-fix loop closed all critical+warnings (5/5).
  - **CR-01 (BLOCKER):** `scoreAndRank(query, this.index, Infinity)` was clamped to MAX_LIMIT=10 — broke role-filter-after-rank for >10-tool servers where top-10 keyword matches are role-blocked. Fix: Infinity sentinel honored in `scoreAndRank` (preserves Gate 4 byte-identicality with `test/search.test.ts`'s `limit=20` clamp). +2 regression tests with ≥11-tool fixture.
  - **WR-01:** Cosine dimension mismatch propagated rejection → fixed with per-tool try/catch returning 0 (silent fall-through to keyword via min-max). +2 tests.
  - **WR-02:** `combineHybrid` didn't validate weights → fixed with two-layer defense (canonical contract + ergonomic boundary). +9 tests.
  - **WR-03:** Added `// LOCKED: per DEC-v11-08-02` comment above `score > 0` filter (algorithmic change would need board-approved DEC update).
  - **WR-04:** Auto-resolved by CR-01.
- **3 executor deviations (all auto-fixed, documented):**
  1. Plan's pure async signature broke 11 baseline tests (sync callers). Pivoted to union return type — sync on no-vectors, Promise on hybrid. Plan-checker missed this even with the wrap.ts/build.ts grep.
  2. Single-tool fixture in session-invariants test degenerated min-max (per DEC-v11-08-02 single-element returns [0]); fixed with 2-tool fixture.
  3. Coverage dipped to 99.45% from new defensive guards; added 4 white-box tests → 99.72% pre-fix-loop, 99.73% post.
- **Lesson:** Plan-checker can verify async signature is "callable" (callers await) but can't catch BREAK on sync test assertions. Future async-introduction phases need an explicit "all baseline tests pass with new signature" empirical check at planning time, not just plan-checker grep verification. Wave 0 caught this implicitly via test re-run, but at execution time. Cheaper to catch in plan-phase.

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
