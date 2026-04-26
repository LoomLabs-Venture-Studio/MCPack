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

### Sprint: Phase 8 — Hybrid Ranking Query Path (v1.1) — UNPLANNED
**Type:** v1.1 milestone phase 3 of 5
**Priority:** P0
**PRD Status:** `.planning/inbox/processed/mcpack-prd-v1.1-gsd.md` — board-approved 2026-04-25
**Harness:** GSD v2
**Status:** Phase 7 SHIPPED 2026-04-26 — Phase 8 needs `/gsd-plan-phase 8`

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

### Next Sprint — Phase 8 Plan Phase
- **Goal:** Combine semantic and keyword scoring into a single ranked output. Per-query embedding → cosine similarity → hybrid score (0.7·semantic + 0.3·keyword default) → role filter applied AFTER ranking.
- **Requirements:** REQ-v11-semantic-query-path, REQ-v11-hybrid-ranking, REQ-v11-role-filter-after-rank, REQ-v11-backward-compat, REQ-v11-session-invariants
- **Open question:** OQ2 — hybrid weights configurable per-query vs config-only — Phase 8 decision
- **Pre-plan asks for the engineer/researcher:**
  1. Backward-compat invariant: when `embeddings` is unset, scoring path must remain byte-identical to v1.0 (Gate 1 still applies).
  2. Role filter ordering: rank semantic+keyword across the FULL tool set first, THEN drop role-blocked tools — never blend filtered + unfiltered ranks.
  3. Carry forward Phase 7's locked warn message format for any new failure paths.

### Acceptance Criteria (Phase 8 — to be locked during plan-phase)
Will be authored by `/gsd-plan-phase 8`. Provisional must-haves:
- [ ] Per-query embedding produces cosine similarity scores in [-1, 1] (unit-tested utility)
- [ ] Hybrid score formula uses 0.7 semantic + 0.3 keyword default (configurable hook TBD per OQ2)
- [ ] Role filter applied strictly AFTER ranking, never before
- [ ] When `embeddings` unset → query path byte-identical to v1.0
- [ ] All 3+ [BLOCKING] gates pass against `bec3f6f` baseline (zero-dep, public-API additive-only, adapter-isolation)
- [ ] Coverage stays ≥99% statement
- [ ] No regression on the 124-test baseline

### Implementation Plan
1. `/gsd-plan-phase 8` — author plans + plan-checker verification cycle
2. `/gsd-execute-phase 8` — wave-based execution
3. After Phase 8 ships → Phase 9 (Tool Usage Analytics)
4. Phase 10 = npm publish + harness verification + 50-query intent benchmark

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
