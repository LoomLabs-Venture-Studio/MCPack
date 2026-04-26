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

### Sprint: Phase 7 — Semantic Index Build Pipeline (v1.1)
**Type:** v1.1 milestone phase 2 of 5
**Priority:** P0
**PRD Status:** `.planning/inbox/processed/mcpack-prd-v1.1-gsd.md` — board-approved 2026-04-25
**Harness:** GSD v2
**Status:** PLANNED, ready for `/gsd-execute-phase 7`

### Board Locks (still active across all v1.1 phases)
- **v1.1 = Search & Observability** (PRD B): semantic search via `EmbeddingProvider` hook + `getAnalytics()` API. Adapter package `@llvs/mcpack-embeddings`.
- **v1.2 = Partner Hub** (PRD A): multi-source, dynamic role resolution, Google OAuth, HTTP/SSE transport. **Deferred** — locked at the planning artifact level; do not start until v1.1 ships.
- **Embedding library:** `@huggingface/transformers ^4.0.0` (DEC-v11-03 clerical-correction; `@xenova/transformers` was renamed and frozen).
- **Core stays zero-dep** through both milestones — non-negotiable. Three [BLOCKING] gates enforce this on every phase.

### What's Done in v1.1 So Far
- ✅ **Phase 6 — EmbeddingProvider Interface + Adapter Scaffold** (2026-04-26): types + version bump 1.0.0→1.1.0 + sibling package `@llvs/mcpack-embeddings`. 11/11 verification dimensions PASS.

### Active Sprint — Phase 7 plans authored
- 07-01 (Wave 1) — engine pipeline: extend `MCPackEngine` with `private semanticIndex`, `isIndexReady()`, `private async buildSemanticIndex()`, constructor kickoff. New helper file `src/semantic-index-builder.ts`.
- 07-02 (Wave 2) — test coverage: new `test/semantic-index-build.test.ts` with 17 tests across 7 describe groups (incl. negative-control test for Pitfall 7 — proves `handleSearchTools` emits zero new console.warn calls during build-pending).
- Plan-checker iter 1: 2 BLOCKERS + 3 WARNINGs. Iter 2: VERIFICATION PASSED.
- Three [BLOCKING] gates corrected from Phase 6's inheritance — Gate 1 jq broadened, Gate 2 src-based (was broken — dist/ is gitignored).

### Acceptance Criteria (Phase 7 execution)
- [ ] All 3 phase REQ-IDs delivered (`semantic-index-build`, `tools-list-no-regression`, `perf-budget`)
- [ ] 107 v1.0+Phase-6 baseline tests pass byte-identically; +17 new tests (124 total)
- [ ] Coverage ≥99% statement coverage maintained
- [ ] All 3 [BLOCKING] gates pass against `bec3f6f` baseline
- [ ] `npm run typecheck && npm run build && npm test` all green
- [ ] `MCPackEngine.isIndexReady()` exists; constructor returns synchronously; `tools/list` latency unchanged
- [ ] Build-failure path: `console.warn` fires once with locked message format ("MCPack: semantic index build failed:"), no tool names leaked (RBAC invariant)

### Candidate Next Work
- **After Phase 7 ships:** `/gsd-plan-phase 8` (Hybrid Ranking Query Path — embed query, cosine similarity, hybrid score 0.7·semantic + 0.3·keyword, role-filter-after-rank)
- **Phase 999.1 (backlog):** CI/CD pipeline — still parked, promote post-v1.1

### Implementation Plan
1. `/gsd-execute-phase 7` — Wave 1 (07-01) lands first; Wave 2 (07-02) after 07-01 commits
2. After both waves: spawn gsd-verifier for goal-backward verification (target: 11/11 dimensions like Phase 6)
3. Update ROADMAP.md / STATE.md / PLAYBOOK Recent Sprints with Phase 7 close-out
4. Plan Phase 8 next

---

## Recent Sprints (Log)

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
