---
phase: 02
slug: core-engine-and-wrap-mode
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-21
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.0 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run test/core.test.ts test/wrap.test.ts --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~3 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run test/core.test.ts test/wrap.test.ts --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | ENTRY-03 | unit | `npx vitest run test/core.test.ts -t "engine" -x` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 1 | DISC-02 | unit | `npx vitest run test/core.test.ts -t "search" -x` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 1 | DISC-05 | unit | `npx vitest run test/core.test.ts -t "loaded" -x` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 2 | ENTRY-01 | unit | `npx vitest run test/wrap.test.ts -t "mcpack" -x` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 2 | DISC-01 | unit | `npx vitest run test/wrap.test.ts -t "tools/list" -x` | ❌ W0 | ⬜ pending |
| 02-02-03 | 02 | 2 | DISC-03 | unit | `npx vitest run test/wrap.test.ts -t "pass-through" -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/core.test.ts` — MCPackEngine unit tests (DISC-02, DISC-05, ENTRY-03)
- [ ] `test/wrap.test.ts` — mcpack() wrap mode tests (DISC-01, DISC-03, ENTRY-01)
- [ ] Test helpers: mock Server factory that creates a Server with registered tools/list and tools/call handlers

*Existing test infrastructure (vitest, vitest.config.ts) covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Console warning on empty tools | ENTRY-01 | Console output verification | Call mcpack() on server with no tools, verify console.warn message |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
