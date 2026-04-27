---
phase: 9
slug: tool-usage-analytics-v1-1
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-27
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Promoted from `09-RESEARCH.md §"Validation Architecture"` per workflow step 5.5.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest@^4.1.5` (carry-forward from v1.0 + Phases 6/7/8) |
| **Config file** | None — relies on vitest defaults |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test && npm run test:coverage` |
| **Per-task feedback** | `npm run typecheck && npm test -- analytics-store.test.ts analytics-integration.test.ts` (~3–5s) |
| **Estimated runtime** | ~7–11s (root suite, including new Phase 9 tests) |

---

## Sampling Rate

- **After every task commit:** `npm run typecheck && npm test`
- **After every plan wave:** `npm test && npm run test:coverage` — coverage must hold ≥99% statement
- **Before `/gsd-verify-work`:** Full suite must be green; all 5 BLOCKING gates must pass against baseline
- **Max feedback latency:** ~10s

---

## Wave 0 Empirical Check (BLOCKING — runs before any new tests in Plan 09-02)

Phase 9 introduces event emission inside existing methods (`handleSearchTools`, `wrap.ts` dispatch, `build.ts` dispatch). Even though no async signature changes, the emission itself could regress baseline tests if the engine's `analyticsStore` is null/undefined at call sites or if event emission throws.

**Wave 0 commands (Plan 09-02 Task 1):**
```bash
git checkout -b phase-09-wave-0-spike  # disposable spike
# Apply minimal event-emission wiring in core.ts/wrap.ts/build.ts (read AnalyticsStore from Plan 09-01)
npm test              # MUST stay 187/187 green (Phase 8 baseline) + Plan 09-01 tests if any
git checkout main && git branch -D phase-09-wave-0-spike  # discard
```

**Pass criterion:** All 187 baseline tests + Plan 09-01 unit tests pass byte-identically. If ANY fail, the planner halts Plan 09-02 and surfaces a re-design proposal.

---

## Per-Task Verification Map

| Task | Plan | Wave | Requirement | Test Type | Automated Command |
|------|------|------|-------------|-----------|-------------------|
| 09-01-01 | 01 | 1 | REQ-v11-analytics-events | unit | `npm test -- analytics-store.test.ts` |
| 09-01-02 | 01 | 1 | REQ-v11-analytics-storage | unit | `npm test -- analytics-store.test.ts` |
| 09-01-03 | 01 | 1 | REQ-v11-analytics-privacy + REQ-v11-analytics-role-scoped-query + REQ-v11-dead-tool-detection | unit | `npm test -- analytics-store.test.ts` |
| 09-02-01 | 02 | 2 | Wave 0 empirical check | regression | `git diff baseline -- src/ \| wc -l == 0` after spike deletion |
| 09-02-02 | 02 | 2 | REQ-v11-analytics-events (event-emission wiring) | integration | `npm test -- analytics-integration.test.ts` |
| 09-02-03 | 02 | 2 | REQ-v11-analytics-api + REQ-v11-analytics-rbac-integrity | integration | `npm test -- analytics-integration.test.ts` |
| 09-02-04 | 02 | 2 | Privacy Pr1–Pr6 + Gate 5 architectural | integration + grep | `npm test -- analytics-integration.test.ts && grep -E "setRequestHandler.*[Aa]nalytics" src/ \| wc -l == 0` |

---

## Wave 0 Requirements

- [ ] `src/analytics-store.ts` — sibling module (matches `session.ts`/`hybrid-scoring.ts` pattern)
- [ ] `test/analytics-store.test.ts` — unit tests for AnalyticsStore mechanics (~14–18 tests)
- [ ] `test/analytics-integration.test.ts` — integration + privacy + RBAC architectural (~12–18 tests)
- [ ] No new framework install — vitest already in place

---

## Coverage Targets

| File | Target | Floor |
|------|--------|-------|
| `src/analytics-store.ts` (new) | 100% statement | ≥99% |
| `src/core.ts` (additive event emission + getAnalytics method) | 100% on new lines | ≥99% on file |
| `src/wrap.ts` (additive event emission) | 100% on new lines | ≥99% on file |
| `src/build.ts` (additive event emission) | 100% on new lines | ≥99% on file |
| `src/types.ts` (additive type exports) | n/a (types) | n/a |
| **Project-wide** | ≥99.73% (Phase 8 baseline) | ≥99% statement |

Coverage MUST NOT regress below Phase 8's 99.73% baseline.

---

## 5 BLOCKING Gates (4 carry-forward + 1 NEW)

| # | Gate | Command | Pass criterion |
|---|------|---------|----------------|
| 1 | Zero new core deps | `git diff 0a1759f..HEAD -- package.json package-lock.json \| jq` | `dependencies` and `peerDependencies` UNCHANGED |
| 2 | Public API additive-only | `git diff 0a1759f..HEAD -- src/index.ts` | additive ONLY (every removal balanced by an equivalent addition; net new lines allowed for new analytics types) |
| 3 | Adapter isolation | `grep -rE "@llvs/mcpack-embeddings\|@huggingface/transformers\|@xenova/transformers" src/ test/` | zero matches |
| 4 | Baseline tests byte-identical | `git diff 0a1759f..HEAD -- test/index-builder.test.ts test/search.test.ts test/session.test.ts test/roles.test.ts test/core.test.ts test/wrap.test.ts test/build.test.ts test/semantic-index-build.test.ts test/hybrid-scoring.test.ts test/hybrid-ranking.test.ts` | empty diff (Phase 9 only adds new test files) |
| **5 (NEW)** | **Wire-protocol exposure ban** | `grep -E "setRequestHandler.*[Aa]nalytics\|tools[/\\.]list.*[Aa]nalytics" src/` | **zero matches — `getAnalytics` MUST NOT be reachable via JSON-RPC** |

**Baseline ref:** `0a1759f` (Phase 8 close-out). Planner pins exact SHA at plan-time.

---

## Privacy Test Coverage (REQUIRED — Phase 9 plans must encode each)

| # | Privacy invariant | Test |
|---|---|---|
| Pr1 | Role-scoped query for role X excludes denial events involving tools not in X's allowed set | 4-tool engine, role X allowed 2 tools; emit denials for 4 tools across 2 roles; assert `getAnalytics({role:'X'}).denials` contains zero events whose `tool` isn't in X's allowed set |
| Pr2 | Role-scoped query for role X excludes search/call/miss events not authored by role X | Emit events from multiple roles; `getAnalytics({role:'X'})` returns ONLY events with `event.role === 'X'` |
| Pr3 | Operator unscoped query returns full data | `getAnalytics()` (no arg) returns ALL events; tool names visible in denials |
| Pr4 | Wildcard role (`'*'`) sees full universe | Configure role with `*`; role-scoped query returns full event set |
| Pr5 | `getAnalytics` is unreachable via MCP wire | Construct engine, register on Server, call `tools/call` with name `'getAnalytics'` → returns `"Unknown tool: getAnalytics"` |
| Pr6 | `tools/list` returns exactly one tool, name `search_tools` | Pre-existing v1.0 invariant; Phase 9 adds an explicit guard |

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-deployment analytics signal value | Phase 10 (operator UAT) | Requires real MCP integration | Phase 10 harness validates — out of Phase 9 scope |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 empirical check passes (187 baseline tests + Plan 09-01 unit tests against new event-emission wiring)
- [ ] Wave 0 file list created (analytics-store.ts + 2 test files)
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] All 5 BLOCKING gates encoded in plans with grep-verifiable commands
- [ ] All 6 privacy tests (Pr1–Pr6) present in `test/analytics-integration.test.ts`
- [ ] WR-03 rename-safe pattern: ≥4 occurrences of `tools.map((t) => t.name)` in new test files
- [ ] `nyquist_compliant: true` set in frontmatter once plans pass plan-checker

**Approval:** pending
