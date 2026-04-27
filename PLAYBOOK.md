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

### Sprint: Phase 10 — Harness, Coverage, Docs, npm Publish (v1.1 GA)
**Type:** v1.1 milestone phase 5 of 5 — **THE V1.1 GA GATE**
**Priority:** P0
**PRD Status:** `.planning/inbox/processed/mcpack-prd-v1.1-gsd.md` — board-approved 2026-04-25
**Harness:** GSD v2
**Status:** PLANNED + VERIFIED (plan-checker iter 1 PASSED — first-pass clean), ready for `/gsd-execute-phase 10`. **Plan 10-03 has BOARD APPROVAL CHECKPOINT before npm publish.**

### Board Locks (still active across all v1.1 phases)
- **v1.1 = Search & Observability** (PRD B): semantic search via `EmbeddingProvider` hook + `getAnalytics()` API. Adapter package `@llvs/mcpack-embeddings`.
- **v1.2 = Partner Hub** (PRD A): multi-source, dynamic role resolution, Google OAuth, HTTP/SSE transport. **Deferred** — locked at the planning artifact level; do not start until v1.1 ships.
- **Embedding library:** `@huggingface/transformers ^4.0.0` (DEC-v11-03 clerical-correction; `@xenova/transformers` was renamed and frozen).
- **Core stays zero-dep** through both milestones — non-negotiable. Three [BLOCKING] gates enforce this on every phase.

### What's Done in v1.1 So Far
- ✅ **Phase 6 — EmbeddingProvider Interface + Adapter Scaffold** (2026-04-26): types + version bump 1.0.0→1.1.0 + sibling package `@llvs/mcpack-embeddings`. 11/11 verification dimensions PASS.
- ✅ **Phase 7 — Semantic Index Build Pipeline** (2026-04-26): non-blocking startup index build, `isIndexReady()`, RBAC-safe failure path. 11/11 verification dimensions PASS, 124/124 tests, 99.61% coverage.
- ✅ **Phase 8 — Hybrid Ranking Query Path** (2026-04-27): per-query embedding + cosine similarity + hybrid scoring (0.7·sem + 0.3·kw) + role-filter-after-rank pivot + `hasVectors()` helper. 11/11 verification dimensions PASS, 187/187 tests, 99.73% coverage. Code review surfaced 1 BLOCKER (CR-01 — Infinity-clamp bug in v1.0 keyword-fallback path); auto-fix loop resolved with 13 net new regression tests.
- ✅ **Phase 9 — Tool Usage Analytics** (2026-04-27): `AnalyticsStore` (in-memory bounded), 4 event types (search/call/denial/miss), `handle.getAnalytics()` (NEVER over MCP wire — Gate 5 architectural ban), role-scoped privacy via event exclusion (reusing `isToolAllowed`), process-lifetime dead-tool detection per role. 11/11 verification dimensions PASS, 234/234 tests, 99.78% coverage. Code review surfaced 2 semantic warnings (WR-01: `denialCount` always 0 for non-wildcard roles; WR-02: `call` events emitted on `isError` returns) + 4 minor; auto-fix loop resolved with 5 net new regression tests.

### Open Code Review Items (carry forward to Phase 8)
- **WR-01** — `isIndexReady()` returns `true` for empty-tools no-op path. Phase 8's hybrid router must not treat `isIndexReady() === true` as "vectors are present" — gate on `semanticIndex.size > 0` instead, or refactor to an `indexBuildState` enum during Phase 8 planning.
- **WR-02** — No regression test asserts the unhandled-rejection invariant (removing the `.catch` in `core.ts:74-80` would silently pass current suite). Add an `unhandledRejection` listener test in Phase 8 or as a tiny standalone fix.
- **WR-03** — RBAC "no tool names in warn" test is fixture-name-coupled; tighten to assert locked warn format directly + iterate actual fixture names.

### Open Code Review Items (advisory, deferred to v1.1 polish or v1.2)
Phase 8 fix-loop closed all critical+warnings; 3 INFOs deferred:
- **08 IN-01** — keyword fallback called from two sites in `core.ts`; could be centralized to a single helper.
- **08 IN-02** — `scoreAndRank` and `keywordScoreForEntry` duplicate the 5-tier loop; extract into a shared helper.
- **08 IN-03** — P9 RBAC test passes by construction; the truly adversarial provider-error-contains-tool-names case isn't tested.

Phase 9 fix-loop closed all 6 warnings; 4 INFOs deferred:
- **09 IN-01** — `maxEvents = 10000` is a magic constant; consider a named export or config field.
- **09 IN-02** — `record()` JSDoc says "O(1)" but is amortized due to `Array.shift` eviction; doc inaccuracy (perf out of v1 scope).
- **09 IN-03** — denial emission duplicated between `wrap.ts` and `build.ts`; could share a helper.
- **09 IN-04** — `public readonly analytics` field surface on internal `MCPackEngine` class — visible in TS shape even though class isn't exported.

Promote any of these to Phase 999.x backlog if they accumulate weight before v1.1 ships.

### Phase 10 Locked Decisions (from /gsd-discuss-phase 10)
- **DEC-v11-10-01** — 50-query intent benchmark = Stripe-derived (28 real Stripe tools + 50 hand-authored queries: 10 easy / 20 paraphrased / 10 abbreviation / 10 typo-or-partial; recall@5 metric; ≥15% improvement target)
- **DEC-v11-10-02** — 3 plans (Measurement / Docs / Publish); only Plan 10-03 board-gated
- **DEC-v11-10-03** — Docs minimal deltas + CHANGELOG (NO full restructure — defer to v1.2)
- **DEC-v11-10-04** — Direct publish to `latest` tag, no RC/beta dance
- **DEC-v11-10-05** — Gate 3 REVISED for Phase 10 with `--exclude-dir=harness` (researcher caught: harness must import adapter for measurement; src/ + non-harness test/ stay isolated)

### Active Sprint — Phase 10 plans authored + verified
- **10-01 (Wave 1)** — Harness + Benchmark + Perf Measurement (autonomous): Stripe rerun with hybrid ON; 50-query intent benchmark; real-MiniLM perf measurement; release report. 3 tasks; 7 files (4 NEW under `test/harness/`).
- **10-02 (Wave 2)** — Docs Update (autonomous, depends on 10-01): README v1.1 quick-start, CHANGELOG.md NEW, docs/semantic-search.md NEW, docs/analytics.md NEW, adapter README. 2 tasks; 5 files.
- **10-03 (Wave 3)** — Pre-Publish + BOARD CHECKPOINT + Sequential Publish (**autonomous: false**, depends on 10-01 + 10-02): packaging fix (LICENSE + files: arrays) → 11-check pre-publish checklist → BOARD APPROVAL CHECKPOINT → root publish → adapter publish → Gate 7 registry smoke test → git tag v1.1.0 → state close. 7 tasks; 6 files.
- **Plan-checker:** iter 1 VERIFICATION PASSED — all 11 dimensions clean on first pass.
- **Researcher caught two pre-execution gaps:** (a) Pitfall A — root + adapter `npm pack --dry-run` missing LICENSE/README; Plan 10-03 Task 1 fixes BEFORE publish; (b) Pitfall B/DEC-v11-10-05 — Gate 3 grep needed `--exclude-dir=harness` to allow harness adapter imports.
- **7 BLOCKING gates encoded:** 5 carry-forward (zero-deps, public-API additive, Gate 3 REVISED, baseline tests byte-identical, wire-protocol exposure ban) + Gate 6 (PRD numerical targets, sub-checks 6a/6b/6c/6d) + Gate 7 (registry resolution proof).

### Acceptance Criteria (Phase 10 execution — v1.1 GA)
- [ ] All 3 phase REQ-IDs delivered (`test-coverage-floor`, `perf-budget`, `tools-list-no-regression`)
- [ ] Stripe harness ≥80.7% token reduction with hybrid ON (Gate 6a)
- [ ] 50-query intent benchmark ≥15% recall@5 improvement over v1.0 (Gate 6b)
- [ ] search_tools p99 within 50ms of v1.0 baseline with local MiniLM (Gate 6c)
- [ ] Index build ≤5s for 50-tool MiniLM (Gate 6d)
- [ ] All 7 BLOCKING gates pass against `d732eaa` baseline
- [ ] `npm run typecheck && npm run build && npm test` all green; **234+ tests passing, ≥99.73% coverage** (already exceeded; preserve)
- [ ] Phase 10 makes ZERO source/test changes (Gates 2/4 — only NEW files in `test/harness/` and docs)
- [ ] `package.json files:` arrays include LICENSE + README in BOTH packages
- [ ] Adapter has LICENSE file (currently missing — Plan 10-03 Task 1 fixes)
- [ ] **BOARD APPROVAL** received before `npm publish` (governance gate; checkpoint cannot auto-approve under `_auto_chain_active`)
- [ ] `@llvs/mcpack@1.1.0` published to `latest` (root first)
- [ ] `@llvs/mcpack-embeddings@1.1.0` published to `latest` (adapter second)
- [ ] Gate 7: fresh `npm install` in temp dir + 5-line smoke test resolves both packages, instantiates engine with MiniLM, runs `search_tools` + `getAnalytics` without error
- [ ] Git tag `v1.1.0` pushed to remote
- [ ] Both publish commands use `--access public` (Pitfall E)

### Implementation Plan
1. `/gsd-execute-phase 10` — Wave 1 (10-01) measurement, then Wave 2 (10-02) docs, then Wave 3 (10-03) which **PAUSES at BOARD CHECKPOINT** before publish
2. Board responds with `approved` (or rejection rationale) at the checkpoint
3. Plan 10-03 resumes: sequential publish → smoke test → git tag → STATE close
4. After Phase 10 ships → **v1.1 milestone CLOSED** → v1.2 (Partner Hub) opens for planning

### Open Questions surfaced AT board checkpoint (RESEARCH §"Open Questions")
- **OQ-10-07** — Whether board (zmarji) executes publish directly OR delegates with OTP token
- **OQ-10-08** — Confirm `npm publish --access public` flag for first-time scoped publish of adapter

### Old "Next Sprint" notes (now active above) ↓
- **Goal:** Harness verification + coverage gate + docs update + npm publish for `@llvs/mcpack@1.1.0` and `@llvs/mcpack-embeddings@1.1.0`. This is the v1.1 GA cut.
- **Requirements:** REQ-v11-test-coverage-floor + harness/benchmark success criteria from PRD §"Success Criteria — v1.1"
- **Provisional success criteria (from PRD):**
  - ≥120 tests / ≥99% coverage (currently 234 / 99.78% — already exceeded)
  - Stripe MCP harness: ≥80.7% token reduction with hybrid ranking (v1.0 baseline)
  - 50-query intent benchmark: ≥15% recall improvement over v1.0 keyword-only
  - Docs site (MkDocs Material) updated with v1.1 features
  - `npm publish @llvs/mcpack@1.1.0` AND `@llvs/mcpack-embeddings@1.1.0`
- **Open questions to resolve in discuss-phase:**
  - **OQ4** — 50-query intent benchmark source (Stripe / synthetic / community-curated)
  - **Phase 6 OQ** — adapter package `@llvs/mcpack-embeddings@^1.1.0` couldn't resolve from registry during Phase 6 dev (used `npm link`); Phase 10 publish resolves it. Order matters: publish core first, then publish adapter.
- **Pre-plan asks for the engineer/researcher:**
  1. Run the existing Stripe harness against v1.1 and measure token reduction with embeddings ON vs OFF — confirm ≥80.7%.
  2. Author/source the 50-query intent benchmark; measure recall@5 for v1.0 keyword vs v1.1 hybrid.
  3. Docs deltas: new `EmbeddingProvider` section, hybrid ranking explainer, `getAnalytics()` API reference, adapter package README.
  4. Pre-publish checklist: version bump verification, package.json `files:` audit, README sync, CHANGELOG, license headers, `npm pack --dry-run` review.
  5. Board approval gate: npm publish is a board-locked operation per governance.md.

### Provisional Phase 10 acceptance criteria (locked during plan-phase)
- [ ] Coverage gate met: ≥120 tests / ≥99% statement (already passing — 234 / 99.78%)
- [ ] Stripe harness produces ≥80.7% token reduction report
- [ ] 50-query intent benchmark passes recall threshold
- [ ] Docs site updated and deployed
- [ ] `@llvs/mcpack@1.1.0` published to npm registry (board-approved)
- [ ] `@llvs/mcpack-embeddings@1.1.0` published to npm registry (board-approved)
- [ ] Adapter package's `peerDependencies: @llvs/mcpack@^1.1.0` resolves cleanly from registry post-publish
- [ ] All 5 BLOCKING gates pass against post-Phase-9 baseline
- [ ] No regression on the 234-test baseline

### Implementation Plan
1. `/gsd-discuss-phase 10` — lock OQ4 + benchmark source + docs scope + publish ordering
2. `/gsd-plan-phase 10` — author plans + plan-checker verification cycle
3. `/gsd-execute-phase 10` — wave-based execution (harness measurement, benchmark, docs, publish)
4. **Board approval required before `npm publish`** (governance.md — billing/publish gates)
5. After Phase 10 ships → v1.1 milestone closed; v1.2 (Partner Hub) opens for planning

---

## Recent Sprints (Log)

### Phase 9 — Tool Usage Analytics ✓ (2026-04-27)
- **Type:** v1.1 milestone phase 4 of 5
- **Outcome:** `AnalyticsStore` (sibling module mirroring `session.ts`/`hybrid-scoring.ts`) captures 4 event types (search/call/denial/miss) into in-memory bounded retention (`maxEvents: 10000` default, `Array.shift` eviction). `MCPackEngine.analytics` field; `MCPackHandle.getAnalytics(options?)` REQUIRED method (NEVER over MCP wire — Gate 5 architectural ban). Role-scoped privacy via event exclusion using Phase 8's `isToolAllowed` helper. Process-lifetime dead-tool detection per role.
- **Engineer:** delivered 14 commits across 2 waves + fix loop (09-01 W1: 5 commits 396c298/92d9554/4c4a95a/254c380/24787e9; 09-02 W2: 7 commits 15341dc/5383f42/26c2884/9f207f1/4a340da/fe617ff/bb7a641 + 2 merges; fix loop: 6 commits f6753b8/98f50ec/a08f0b9/64db82d/db05308/089b3b8)
- **Plans:** 09-01 (AnalyticsStore module + 20 unit tests), 09-02 (engine event emission at 4 sites + handle API + 22 integration tests with Pr1-Pr6 + Step Z 4-site WR-03 + Wave 0 BLOCKING empirical check)
- **Result:** 234/234 tests pass (187 baseline + 47 new = 23 unit + 24 integration) | **99.78% statement coverage** (up from Phase 8's 99.73%; `analytics-store.ts`/`build.ts`/`core.ts` all 100%) | All 5 [BLOCKING] gates pass against `0a1759f` (incl. NEW Gate 5: wire-protocol exposure ban) | 11/11 verification dimensions PASS | All 6 privacy invariants Pr1-Pr6 verified behaviorally (Pr5 in BOTH wrap and build modes asserting `tools/call getAnalytics → "Unknown tool"`) | Step Z: 10 occurrences of `tools.map((t) => t.name)` (250% over the ≥4 floor)
- **Code review:** 0 critical, 6 warnings, 4 info. Auto-fix loop closed all 6 warnings (5/5 in scope + 1 doc-only).
  - **WR-01 (semantic bug):** `summary.byRole[role].denialCount` was always 0 for non-wildcard roles because the role-tool-allowlist filter excluded denials by definition (denials are emitted BECAUSE the tool is not in the allowed set). Fix: count denials on `event.role === role` match (denials authored by this role) — separate semantic from privacy-filter event-array. +1 regression test that would have caught it.
  - **WR-02:** `call` events emitted on `{ isError: true }` returns from handlers — broke "success path only" promise. MCP convention is clean-error returns, not throws. Fix: `wrap.ts`/`build.ts` skip `call` emission + `markToolLoaded` when `result.isError === true`. +2 regression tests.
  - **WR-03:** Snapshot reference aliasing on `search.tools[]` — `record()` now copies the array. +1 test.
  - **WR-04:** Empty-string `byRole[""]` exposure — excluded from `summary.byRole` keys. +1 test.
  - **WR-05:** `clear()` JSDoc/visibility mismatch — added `@internal` JSDoc tag; kept public.
  - **WR-06:** Unbounded query/tool-name lengths in retention — documented as v1.2 concern (out of scope).
- **2 executor deviations during 09-01 (auto-fixed, documented):**
  1. Test fixture `topTools[5]` expectation conflicted with locked DEC-v11-09-02 (admin's calls visible to reader's role-scoped query because reader's allowed set covers tool1/tool2). Switched to `ghost` role with zero visible tools — the locked semantic was correct; the test was wrong.
  2. Wave 2 executor renamed worktree branch to `phase-09-02-execute` for clarity (instead of the original `worktree-agent-...`); orchestrator merged it cleanly via the renamed branch.
- **Lesson:** Phase 8 lesson reaffirmed — "plan-checker can verify literal patterns but can't catch semantic bugs at the role-filter intersection." WR-01 surfaced because the existing summary tests only used wildcard admin; non-wildcard role coverage was a gap. Future plans involving role-scoped aggregations should require explicit non-wildcard test coverage as an acceptance criterion.

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
