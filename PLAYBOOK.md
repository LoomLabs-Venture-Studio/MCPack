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

### Sprint: v1.1 Ingest — Search & Observability
**Type:** milestone bootstrap (PRD ingest → roadmap)
**Priority:** P0
**PRD Status:** `.planning/inbox/mcpack-prd-v1.1-gsd.md` — approved as v1.1 (board, 2026-04-25)
**Harness:** GSD v2

### Board Decision (2026-04-25)
- **v1.1 = Search & Observability** (PRD B): semantic search via `EmbeddingProvider` hook + `getAnalytics()` API. Adapter package `@llvs/mcpack-embeddings`.
- **v1.2 = Partner Hub** (PRD A): multi-source, dynamic role resolution, Google OAuth, HTTP/SSE transport. Deferred — PRD stays in inbox until v1.1 ships.
- **Pre-approved dep:** `@xenova/transformers` as peer dep of `@llvs/mcpack-embeddings` only. Core `@llvs/mcpack` stays zero-dep — non-negotiable.
- **Rationale:** lower blast radius than Partner Hub, no new auth/transport surface, exercises the adapter-package pattern before we reuse it for `mcpack-google` in v1.2.

### Candidate Next Work
- **In-flight:** `/gsd-ingest-docs` to formalize both PRDs in `.planning/inbox/` and produce `INGEST-CONFLICTS.md`
- **After ingest:** open v1.1 milestone via `/gsd-new-milestone`, then phase planning per PRD B's 5-phase breakdown
- **Phase 999.1 (backlog):** CI/CD pipeline — still parked, promote post-v1.1 unless dep-vuln pressure returns

### Acceptance Criteria (Ingest Sprint)
- [ ] `/gsd-ingest-docs` runs cleanly against both PRDs in `.planning/inbox/`
- [ ] `INGEST-CONFLICTS.md` produced with v1.1.0 version-collision flagged and resolved (PRD B wins v1.1, PRD A → v1.2)
- [ ] `ROADMAP.md` updated with v1.1 milestone (5 phases per PRD B §"Phase Breakdown")
- [ ] `REQUIREMENTS.md` extended with v1.1 requirements (R1.x semantic search, R2.x analytics, R3.x cross-cutting)
- [ ] `PROJECT.md` "Current State" reflects v1.1 in flight
- [ ] PRD A preserved in inbox or moved to a `deferred/` subfolder — not deleted
- [ ] No code changes in this sprint — planning artifacts only

### Implementation Plan
1. Run `/gsd-ingest-docs` — synthesizer classifies both PRDs, detects v1.1.0 collision
2. Review `INGEST-CONFLICTS.md`; confirm PRD B → v1.1, PRD A → v1.2 holds
3. `/gsd-new-milestone` to open v1.1 with PRD B as the source of truth
4. Phase plan per PRD B §"Phase Breakdown":
   - Phase 1: `EmbeddingProvider` interface + `@llvs/mcpack-embeddings` adapter scaffold
   - Phase 2: Semantic index build pipeline (async, non-blocking)
   - Phase 3: Hybrid ranking query path
   - Phase 4: Tool usage analytics (`AnalyticsStore` + `getAnalytics()`)
   - Phase 5: Harness verification, ≥120 tests at ≥99% coverage, docs, npm publish
5. Per-phase delegation to engineer via `/gsd-execute-phase`

---

## Recent Sprints (Log)

### DEPS-1 — Dependabot vuln cleanup ✓ (2026-04-25)
- **Type:** chore (security)
- **Outcome:** All 6 transitive CVEs resolved via `npm audit fix` (no `--force`)
- **Engineer:** delivered commit `08d6bfa`
- **Result:** `npm audit` → 0 vulns | 100/100 tests pass | 99.56% statement coverage (baseline match) | `package.json` unchanged | 256 lines of `package-lock.json` churn, net -6
- **Lesson:** Phase 999.1 (CI/CD) should add `npm audit` as a PR gate to catch these at submit time, not via post-push Dependabot

### Harness Integration
Harness active: **GSD v2**. Drive work via `/gsd-new-milestone` → `/gsd-plan-phase` → `/gsd-execute-phase`. The Current Sprint section above feeds the harness as the high-level spec; GSD artifacts in `.planning/phases/<phase>/` are the detailed contract.
