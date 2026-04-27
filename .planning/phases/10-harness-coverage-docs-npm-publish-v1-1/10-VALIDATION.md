---
phase: 10
slug: harness-coverage-docs-npm-publish-v1-1
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-27
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for the v1.1 GA gate.
> Promoted from `10-RESEARCH.md §"Validation Architecture"` per workflow step 5.5.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest@^4.1.5` (carry-forward; coverage already met at 234/99.78%) |
| **Harness runner** | `npx tsx test/harness/*.ts` (Phase 10 adds `intent-benchmark.ts` sibling) |
| **Quick run** | `npm test` |
| **Full suite** | `npm test && npm run test:coverage` |
| **Stripe harness** | `npm run harness` (existing — Plan 10-01 reruns with hybrid ON) |
| **Intent benchmark** | `npm run benchmark` (NEW — Plan 10-01 adds this script) |
| **Estimated runtime** | ~7-11s tests; ~30-60s for harness with real MiniLM |

---

## Sampling Rate

- **After every task commit:** `npm run typecheck && npm test`
- **Plan 10-01 close:** harness + benchmark + perf measurements all green; release report committed
- **Plan 10-02 close:** README/CHANGELOG/docs updates committed; `npm pack --dry-run` reviewed (preview only)
- **Plan 10-03 pre-publish:** all 7 BLOCKING gates pass; full test suite green; pre-publish checklist verified
- **Plan 10-03 publish:** BOARD APPROVAL CHECKPOINT (`autonomous: false`) — orchestrator pauses here
- **Plan 10-03 post-publish:** Gate 7 registry resolution proof in fresh temp dir

---

## Per-Plan Verification Map

| Plan | Wave | Tasks | Autonomous | Key Gates |
|------|------|-------|-----------|-----------|
| 10-01 Measurement | 1 | Stripe harness rerun, 50-query intent benchmark, real-MiniLM perf measurement, release report | yes | Gate 6 (PRD success criteria) |
| 10-02 Docs | 2 | README v1.1 quick-start, CHANGELOG.md (NEW), docs/semantic-search.md (NEW), docs/analytics.md (NEW), adapter README | yes | Docs-only; gates 1-5 trivially preserved |
| 10-03 Pre-Publish + Publish | 3 | LICENSE/README packaging fix, pre-publish checklist, BOARD CHECKPOINT, sequential publish (core → adapter), registry smoke test, git tag | **NO** (checkpoint) | All 7 gates incl. Gate 6 + Gate 7 |

---

## 7 BLOCKING Gates (5 carry-forward + 2 NEW)

| # | Gate | Command | Pass criterion |
|---|------|---------|----------------|
| 1 | Zero new core deps | `git diff d732eaa..HEAD -- package.json package-lock.json \| jq` | `dependencies` and `peerDependencies` UNCHANGED for core. Adapter package allowed to bump devDeps if needed. |
| 2 | Public API additive-only | `git diff d732eaa..HEAD -- src/index.ts` | empty diff (no source changes in Phase 10) |
| 3 (REVISED for Phase 10) | Adapter isolation EXCEPT in test/harness/ | `grep -rE "@llvs/mcpack-embeddings\|@huggingface/transformers\|@xenova/transformers" src/ test/ --exclude-dir=harness` | zero matches (harness is allowed to import the adapter for measurement; src/ + non-harness test/ stay isolated) |
| 4 | Baseline tests byte-identical | `git diff d732eaa..HEAD -- test/*.test.ts` (NOT `test/harness/`) | empty diff (Phase 10 adds new harness files only; never edits existing tests) |
| 5 | Wire-protocol exposure ban | `grep -E "setRequestHandler.*[Aa]nalytics\|tools[/\\.]list.*[Aa]nalytics" src/` | zero matches |
| **6 (NEW)** | **PRD success criteria met** | See "Gate 6 sub-checks" below | All 4 numerical targets hold |
| **7 (NEW)** | **Registry resolution proof** | Fresh temp dir + `npm install @llvs/mcpack @llvs/mcpack-embeddings` + 5-line smoke test | Both packages resolve from registry; engine instantiates with MiniLM; `search_tools` and `getAnalytics` execute without error |

**Baseline ref:** `d732eaa` (Phase 9 close-out commit). Planner pins exact SHA at plan-time.

### Gate 6 sub-checks (PRD numerical targets)

| Sub-check | Source | Threshold |
|-----------|--------|-----------|
| 6a | `npm run harness` token-reduction report (hybrid ON) | ≥80.7% aggregate token reduction |
| 6b | `npm run benchmark` recall@5 report | hybrid recall@5 ≥ v1.0 keyword recall@5 + 15% absolute |
| 6c | search_tools p99 measurement (with local MiniLM) | within 50ms of v1.0 baseline |
| 6d | Index build measurement (50 tools, MiniLM) | ≤5s |

### Gate 3 adjustment rationale (DEC-v11-10-05 — introduced by RESEARCH)

Carry-forward Gate 3 (`adapter-isolation`) would FAIL in Phase 10 because Plan 10-01's intent benchmark must import `createMiniLMProvider` from `@llvs/mcpack-embeddings` inside `test/harness/intent-benchmark.ts` — that's the whole point of measuring real-MiniLM perf. The adjustment: scope the grep to `src/` + non-harness `test/` only. The architectural intent (core stays isolated from adapter) is preserved; only harness measurement code is allowed to import the adapter.

This is a Phase 10-specific adjustment. Phases 11+ (v1.2 onward) inherit the corrected form.

---

## Critical Findings From Research (must address in plans)

### Pitfall A: Packaging gap (BLOCKING for Plan 10-03)
`npm pack --dry-run` on the root currently emits NO LICENSE and NO README — only `dist/*` and `package.json`. The adapter package has no LICENSE file at all and no README. **Plan 10-03 MUST fix this before publish:**
- Add `"LICENSE", "README.md"` to `files:` array in BOTH `package.json` files
- `cp LICENSE packages/mcpack-embeddings/LICENSE` (adapter inherits root license)
- Adapter README is created in Plan 10-02; verified present before Plan 10-03 publish

### Pitfall B: Gate 3 grep adjustment (DEC-v11-10-05)
See above. Without this adjustment, Plan 10-01's harness work auto-fails Gate 3.

### Pitfall C: Board approval cannot auto-approve
Plan 10-03's checkpoint MUST NOT auto-approve under `_auto_chain_active` flag. Board approval is mandatory per `governance.md`. The plan's checkpoint task must encode this restriction explicitly (`auto_approve_safe: false` or equivalent).

### Pitfall D: Publish ordering
`@llvs/mcpack` MUST publish first. The adapter's `peerDependencies: { "@llvs/mcpack": "^1.1.0" }` cannot resolve from registry until core lands. Orchestrator-level: tasks must be sequential, not parallel.

### Pitfall E: `--access public` flag for first-time scoped publish
First-time publish of `@llvs/mcpack-embeddings` may default to `private` because of the `@llvs/` scope. Recommended: `npm publish --access public` defensively on BOTH packages even though `@llvs/mcpack` was already public from v1.0.

---

## Coverage Targets (no regression — Phase 10 makes ZERO source changes)

| File | Phase 9 baseline | Phase 10 target |
|------|------------------|-----------------|
| Project-wide | 99.78% statement | ≥99.73% (no regression — should hold trivially since no src changes) |

---

## Manual-Only Verifications

| Behavior | Why Manual | Test Instructions |
|----------|------------|-------------------|
| Board approval at publish step | Governance gate — humans only | Plan 10-03 pauses; orchestrator surfaces pre-publish checklist; board responds with "approved" or rejection reason |
| Real-MiniLM perf measurements | Requires loading transformers model (~25 MB download on first run) | Run `npm run benchmark` and `npm run harness` locally; record numbers in release report |
| Registry resolution smoke test | Cannot mock registry; needs real npm install in clean dir | Plan 10-03 final task creates temp dir, runs `npm install`, executes 5-line script |
| `npm publish` itself | OTP / 2FA prompts; cannot automate without secrets | Board operator runs publish locally with OTP; orchestrator only runs the pre/post verifications |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify (or `manual` annotation for board steps)
- [ ] Plan 10-03 has `autonomous: false` frontmatter
- [ ] Plan 10-03 has `<task type="checkpoint:human-verify" gate="blocking">` for board approval
- [ ] Gate 3 grep uses `--exclude-dir=harness` form (DEC-v11-10-05)
- [ ] Pitfall A (packaging gap) addressed in Plan 10-03 BEFORE publish step
- [ ] Pitfall E (`--access public`) included in publish commands
- [ ] All 7 BLOCKING gates encoded in plans with grep/test-verifiable commands
- [ ] Gate 6 sub-checks (6a/6b/6c/6d) all encoded with source + threshold
- [ ] Gate 7 registry resolution proof scripted as a real test (not just a doc note)
- [ ] No watch-mode flags
- [ ] `nyquist_compliant: true` set in frontmatter once plans pass plan-checker

**Approval:** pending
