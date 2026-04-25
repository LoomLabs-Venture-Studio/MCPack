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

### Sprint: (none active — v1.0 shipped 2026-03-23)
**Type:** —
**Priority:** —
**PRD Status:** —
**Harness:** GSD (v2 skills installed; `.planning/` artifacts present from v1.0)

### Candidate Next Work
- **Phase 999.1 (backlog):** CI/CD pipeline — GitHub Actions for lint/typecheck/vitest on PRs. Requirements TBD. Promote via `/gsd-review-backlog`.
- **v1.1 milestone:** semantic search, tool usage analytics. No PRD yet.

### Acceptance Criteria
- [ ] [criterion]
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes, coverage ≥ 99%
- [ ] `npm run build` passes
- [ ] No new runtime/peer deps without board approval

### Implementation Plan
[CTO fills this with ordered task list and file references when a sprint starts]

### Harness Integration
Harness active: **GSD v2**. Drive work via `/gsd-new-milestone` → `/gsd-plan-phase` → `/gsd-execute-phase`. The Current Sprint section above feeds the harness as the high-level spec; GSD artifacts in `.planning/phases/<phase>/` are the detailed contract.
