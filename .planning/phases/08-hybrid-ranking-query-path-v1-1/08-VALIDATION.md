---
phase: 8
slug: hybrid-ranking-query-path-v1-1
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-26
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Promoted from `08-RESEARCH.md §"Validation Architecture"` per workflow step 5.5.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest@^4.1.0` (carry-forward from v1.0 + Phase 6 + Phase 7) |
| **Config file** | None — relies on vitest defaults (matches project convention) |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test && npm run test:coverage` |
| **Per-task feedback** | `npm run typecheck && npm test -- hybrid-scoring.test.ts hybrid-ranking.test.ts` (~3–5s) |
| **Estimated runtime** | ~6–10s (root suite, including new Phase 8 tests) |

---

## Sampling Rate

- **After every task commit:** Run `npm run typecheck && npm test`
- **After every plan wave:** Run `npm test && npm run test:coverage` — coverage must hold ≥99% statement
- **Before `/gsd-verify-work`:** Full suite must be green; all 4 BLOCKING gates must pass against baseline
- **Max feedback latency:** ~10s

---

## Wave 0 Empirical Check (BLOCKING — runs before any new tests)

Before writing any new tests for Phase 8, verify all 124 baseline tests (107 v1.0 + 17 Phase 7) pass against a unified rank-then-filter pipeline. Rationale: REQ-v11-role-filter-after-rank says "score full surface, then filter," but REQ-v11-backward-compat says "byte-identical to v1.0." These are compatible IFF the keyword scorer is deterministic per-tool (the score doesn't depend on candidate-set composition) — which it is. Empirical verification still required.

**Wave 0 commands:**
```bash
git checkout -b phase-08-wave-0-spike  # disposable spike branch
# Apply minimal handleSearchTools refactor (filter→rank → rank→filter) ON v1.0 keyword path only
npm test              # MUST stay 124/124 green
git checkout main && git branch -D phase-08-wave-0-spike  # discard spike
```

**Pass criterion:** 124/124 baseline tests pass byte-identically. If ANY fail, the planner must split the path (preserve v1.0's filter→rank order on the no-embeddings path; only the hybrid path uses rank→filter).

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 1 | REQ-v11-semantic-query-path | unit | `npm test -- hybrid-scoring.test.ts` | ❌ W0 | ⬜ pending |
| 08-01-02 | 01 | 1 | REQ-v11-hybrid-ranking | unit | `npm test -- hybrid-scoring.test.ts` | ❌ W0 | ⬜ pending |
| 08-01-03 | 01 | 1 | (paired tests for Plan 01) | unit | `npm test -- hybrid-scoring.test.ts` | ❌ W0 | ⬜ pending |
| 08-02-01 | 02 | 2 | REQ-v11-role-filter-after-rank | integration | `npm test -- hybrid-ranking.test.ts` | ❌ W0 | ⬜ pending |
| 08-02-02 | 02 | 2 | REQ-v11-backward-compat | regression | `git diff bec3f6f..HEAD -- test/` | n/a | ⬜ pending |
| 08-02-03 | 02 | 2 | REQ-v11-session-invariants | integration | `npm test -- hybrid-ranking.test.ts` | ❌ W0 | ⬜ pending |
| 08-02-04 | 02 | 2 | (paired tests for Plan 02) | integration | `npm test -- hybrid-ranking.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Plan-level task IDs are placeholders — real IDs assigned by the planner.*

---

## Wave 0 Requirements

- [ ] `src/hybrid-scoring.ts` — pure function module (cosineSimilarity, minMaxNormalize, combineHybrid)
- [ ] `test/hybrid-scoring.test.ts` — unit tests for pure scoring functions (~10–15 tests)
- [ ] `test/hybrid-ranking.test.ts` — integration tests for handleSearchTools end-to-end (~10–15 tests)
- [ ] No new framework install — vitest already in place

---

## Coverage Targets

| File | Target | Floor |
|------|--------|-------|
| `src/hybrid-scoring.ts` (new) | 100% statement | ≥99% |
| `src/search.ts` (additive: `keywordScoreForEntry`) | 100% statement | ≥99% |
| `src/core.ts` (additive: `hasVectors()`, async `handleSearchTools`) | 100% statement on new lines | ≥99% on file |
| **Project-wide** | ≥99.61% (Phase 7 baseline) | ≥99% statement |

Coverage MUST NOT regress below Phase 7's 99.61% baseline.

---

## BLOCKING Gates (carry forward from Phase 7, baseline advanced to current main HEAD)

| # | Gate | Command | Pass criterion |
|---|------|---------|----------------|
| 1 | Zero new core deps | `git diff cd1fc52..HEAD -- package.json package-lock.json \| jq` | `dependencies` and `peerDependencies` UNCHANGED |
| 2 | Public API additive-only | `git diff cd1fc52..HEAD -- src/index.ts` | empty diff (no new exports from core entry) |
| 3 | Adapter isolation | `grep -rE "@llvs/mcpack-embeddings\|@huggingface/transformers\|@xenova/transformers" src/ test/` | zero matches |
| 4 | Baseline tests byte-identical | `git diff cd1fc52..HEAD -- test/index-builder.test.ts test/search.test.ts test/session.test.ts test/roles.test.ts test/core.test.ts test/wrap.test.ts test/build.test.ts test/semantic-index-build.test.ts` | empty diff (Phase 8 only adds new test files; never edits existing) |

**Baseline ref:** `cd1fc52` (Phase 7 close-out commit). The planner pins the exact SHA at plan-time; a more recent post-Phase-7 commit is acceptable as long as it's a docs/state commit only with no `src/` or `test/` changes.

---

## Pitfall Negative Controls (REQUIRED — Phase 8 must encode each)

| # | Pitfall | Negative Control Test |
|---|---------|----------------------|
| P7 | Build-pending fallback emits warns (carry from Phase 7) | Construct engine with `embeddings` configured + slow provider; query `search_tools` 3× before build resolves; assert `console.warn` was called zero times |
| P8 | Query-embedding-failure not caught → unhandled rejection | Register `process.on('unhandledRejection', listener)`; configure provider that rejects on `embed([query])`; query 3×; assert listener never fired AND `console.warn` fired EXACTLY ONCE per process |
| P9 | Query-embedding-failure leaks tool names in warn (RBAC) | Provider rejection error message contains tool fixture names; assert warn message matches `/^MCPack: query embedding failed: /` and contains NO substring from `tools.map(t => t.name)` (iterate ACTUAL fixture names — WR-03 fix) |
| P10 | Hybrid scoring backward-compat regression | Configure engine WITHOUT `embeddings`; assert all 124 baseline tests still pass byte-identically (Gate 4) |

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real MiniLM 50ms p99 query embedding | REQ-v11-perf-budget (Phase 10) | Requires real provider load | Phase 10 harness validates — out of Phase 8 scope |
| 50-query intent benchmark ≥15% recall | Phase 10 success criteria | Requires curated query set | Phase 10 harness validates — out of Phase 8 scope |

*Phase 8 unit/integration tests use sync mock providers — algorithmic complexity bounds only, real-provider budgets validated downstream in Phase 10.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 empirical check passes (124 baseline tests against rank-then-filter)
- [ ] Wave 0 file list created (hybrid-scoring.ts + 2 test files)
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] All 4 BLOCKING gates encoded in plans with grep-verifiable commands
- [ ] All 4 pitfall negative controls present in test files
- [ ] `nyquist_compliant: true` set in frontmatter once plans pass plan-checker

**Approval:** pending
