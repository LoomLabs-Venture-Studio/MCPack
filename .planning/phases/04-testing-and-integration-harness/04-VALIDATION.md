---
phase: 04
slug: testing-and-integration-harness
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-22
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x |
| **Config file** | vitest inferred from package.json |
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
| 04-01-01 | 01 | 1 | TEST-01 | unit | `npx vitest run --coverage` | ✅ | ⬜ pending |
| 04-02-01 | 02 | 2 | TEST-02 | integration | `npm run harness` | ❌ W0 | ⬜ pending |
| 04-02-02 | 02 | 2 | TEST-03 | unit | `npx vitest run` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/harness/` directory — harness code location
- [ ] `test/harness/stripe-harness.ts` — integration harness entry point

*Existing test infrastructure covers unit test requirements. Only harness scaffolding needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Stripe MCP token reduction | TEST-02 | Requires STRIPE_API_KEY and network access | Set STRIPE_API_KEY env var, run `npm run harness`, verify report.json is created |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
