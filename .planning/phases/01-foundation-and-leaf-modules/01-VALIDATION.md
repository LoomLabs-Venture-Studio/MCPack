---
phase: 1
slug: foundation-and-leaf-modules
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-20
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts (Wave 0 installs) |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --coverage` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --coverage`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | PKG-01 | build | `npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 1 | PKG-02 | config | `grep peerDependencies package.json` | ❌ W0 | ⬜ pending |
| 01-02-01 | 02 | 1 | SRCH-01 | unit | `npx vitest run src/search.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-02 | 02 | 1 | SRCH-02 | unit | `npx vitest run src/search.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-03 | 02 | 1 | SESS-01 | unit | `npx vitest run src/session.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-04 | 02 | 1 | SESS-02 | unit | `npx vitest run src/session.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-05 | 02 | 1 | SESS-03 | unit | `npx vitest run src/session.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-06 | 02 | 1 | SESS-04 | unit | `npx vitest run src/session.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-07 | 02 | 1 | ROLE-01 | unit | `npx vitest run src/roles.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-08 | 02 | 1 | ROLE-02 | unit | `npx vitest run src/roles.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-09 | 02 | 1 | ROLE-03 | unit | `npx vitest run src/roles.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest` dev dependency installed
- [ ] `vitest.config.ts` created
- [ ] `tsconfig.json` configured for ESM + strict mode
- [ ] `package.json` with type: "module" and peer deps

*Wave 0 is scaffolding — handled by Plan 01.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
