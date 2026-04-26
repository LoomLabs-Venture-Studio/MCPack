---
phase: 7
slug: semantic-index-build-pipeline-v1-1
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-26
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Promoted from `07-RESEARCH.md §"Validation Architecture"` per workflow step 5.5.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest@^4.1.0` (carry-forward from v1.0 + Phase 6) |
| **Config file** | None — relies on vitest defaults (matches Phase 6 convention) |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test && npm run test:coverage` |
| **Per-task feedback** | `npm run typecheck && npm test -- semantic-index-build.test.ts` (~3–5s) |
| **Estimated runtime** | ~5–8s (root suite, including new Phase 7 tests) |

---

## Sampling Rate

- **Per task commit:** `npm run typecheck && npm test -- semantic-index-build.test.ts` (~3–5s feedback latency)
- **Per wave merge:** `npm run typecheck && npm run build && npm test && npm run test:coverage` (~10–15s)
- **Phase gate (before `/gsd-verify-work`):** Full suite green (`npm test`), three [BLOCKING] gates run, regression gate (all v1.0 + Phase 6 test files byte-identical), coverage ≥ 99%
- **Max feedback latency:** 5 seconds per-task commit

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 07-01 | 1 | REQ-v11-semantic-index-build | Helper purity (indexing string composition + parameter extraction) | `npm run typecheck && npm test -- core.test.ts` (no regression) | ❌ Wave 0 — `src/semantic-index-builder.ts` | ⬜ pending |
| 07-01-02 | 07-01 | 1 | REQ-v11-semantic-index-build | Engine wires private `semanticIndex` field, kicks off build via fire-and-forget Promise in constructor when `embeddings` configured | `npm run typecheck && npm run build && npm test` (107 baseline preserved) | ❌ Wave 0 — modifications to `src/core.ts` | ⬜ pending |
| 07-01-02 | 07-01 | 1 | REQ-v11-tools-list-no-regression | Constructor returns synchronously even with `embeddings` configured; `handleToolsList()` body unchanged from v1.0 | `npm test` (107 baseline preserved) + grep for unchanged `handleToolsList` body | ❌ Wave 0 | ⬜ pending |
| 07-01-02 | 07-01 | 1 | REQ-v11-tools-list-no-regression | When `embeddings` absent, MCPackEngine code path is byte-identical to v1.0 (no new branches taken, zero provider calls) | `npm test` baseline preserved (regression gate) | ✅ existing v1.0 + Phase 6 tests | ⬜ pending |
| 07-02-01 | 07-02 | 2 | REQ-v11-semantic-index-build | Build kicks off at construction with single-batch provider call | `npm test -- semantic-index-build.test.ts -t "kicks off a build"` | ❌ Wave 0 — `test/semantic-index-build.test.ts` | ⬜ pending |
| 07-02-01 | 07-02 | 2 | REQ-v11-semantic-index-build | Indexing string is `name + " " + description + " " + paramNames.join(" ")` (single batch) | `npm test -- semantic-index-build.test.ts -t "passes \"name + description + param-names\""` | ❌ Wave 0 | ⬜ pending |
| 07-02-01 | 07-02 | 2 | REQ-v11-semantic-index-build | Vectors stored as `Map<string, Float32Array>` keyed by tool name | `npm test -- semantic-index-build.test.ts -t "stores Float32Array vectors keyed by tool name"` | ❌ Wave 0 | ⬜ pending |
| 07-02-01 | 07-02 | 2 | REQ-v11-semantic-index-build | Empty tool surface is a no-op (empty map, `isIndexReady` true) | `npm test -- semantic-index-build.test.ts -t "handles empty tool surface"` | ❌ Wave 0 | ⬜ pending |
| 07-02-01 | 07-02 | 2 | REQ-v11-semantic-index-build | Inconsistent vector dims rejected; build stays "failed" | `npm test -- semantic-index-build.test.ts -t "rejects when provider returns inconsistent dims"` | ❌ Wave 0 | ⬜ pending |
| 07-02-01 | 07-02 | 2 | REQ-v11-semantic-index-build | Wrong vector count rejected; build stays "failed" | `npm test -- semantic-index-build.test.ts -t "rejects when provider returns wrong vector count"` | ❌ Wave 0 | ⬜ pending |
| 07-02-01 | 07-02 | 2 | REQ-v11-tools-list-no-regression | Constructor returns synchronously even when embeddings configured (timing assertion) | `npm test -- semantic-index-build.test.ts -t "constructor returns synchronously"` | ❌ Wave 0 | ⬜ pending |
| 07-02-01 | 07-02 | 2 | REQ-v11-tools-list-no-regression | `handleToolsList()` works while build is in flight (no async dependency) | `npm test -- semantic-index-build.test.ts -t "handleToolsList\\(\\) works while build is in flight"` | ❌ Wave 0 | ⬜ pending |
| 07-02-01 | 07-02 | 2 | REQ-v11-tools-list-no-regression | Queries during build-pending state fall back to v1.0 keyword scoring | `npm test -- semantic-index-build.test.ts -t "falls back to keyword scoring when build is in flight"` | ❌ Wave 0 | ⬜ pending |
| 07-02-01 | 07-02 | 2 | REQ-v11-tools-list-no-regression | Engine without `embeddings` configured makes ZERO provider calls | `npm test -- semantic-index-build.test.ts -t "makes no provider calls"` | ❌ Wave 0 | ⬜ pending |
| 07-02-01 | 07-02 | 2 | REQ-v11-perf-budget | 50-tool mock build completes in < 1s (deterministic mock; real MiniLM 5s validated in Phase 10 harness) | `npm test -- semantic-index-build.test.ts -t "builds 50-tool index in < 1 second"` | ❌ Wave 0 | ⬜ pending |
| 07-02-01 | 07-02 | 2 | REQ-v11-perf-budget | 50-tool 384-dim vector storage ≤ 2 MB | `npm test -- semantic-index-build.test.ts -t "vector storage stays well under 2 MB"` | ❌ Wave 0 | ⬜ pending |
| (regression) | both | both | REQ-v11-tools-list-no-regression | All 107 v1.0 + Phase 6 tests still pass byte-identically | `npm test` exits 0 with 107+ tests passing; `test/core.test.ts`, `test/wrap.test.ts`, `test/build.test.ts`, `test/index-builder.test.ts`, `test/search.test.ts`, `test/session.test.ts`, `test/roles.test.ts`, `test/types.test.ts` byte-identical to baseline | ✅ existing | ⬜ pending |
| (cross-cutting) | both | both | REQ-v11-perf-budget | Coverage stays ≥ 99% statement | `npm run test:coverage` reports stmts ≥ 99% | ✅ existing | ⬜ pending |
| (cross-cutting) | both | both | REQ-v11-tools-list-no-regression | Typecheck passes (no new errors from Phase 7 code) | `npm run typecheck` exits 0 | ✅ existing | ⬜ pending |
| (cross-cutting) | both | both | REQ-v11-tools-list-no-regression | Build emits ESM-only (no `.cjs`) | `npm run build && (! ls dist/*.cjs 2>/dev/null)` | ✅ existing | ⬜ pending |
| (deferred) | — | — | REQ-v11-perf-budget | Real-MiniLM 50-tool build ≤ 5s on commodity hardware | Phase 10 harness assertion — NOT Phase 7 scope | ❌ Phase 10 | (deferred) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky · (deferred) Phase 10*

---

## Wave 0 Requirements

The following files do NOT exist yet and Phase 7 plans must create them:

- [ ] **`src/semantic-index-builder.ts`** (new sibling helper file) — pure-function helpers `buildIndexingString(tool: Tool): string` and `extractParameterNames(tool: Tool): string[]`. Lives outside `core.ts` per planner's split decision (07-01 Task 1). Reuses parameter-extraction logic from `src/index-builder.ts` for keyword/semantic consistency.
- [ ] **`test/semantic-index-build.test.ts`** (new test file) — covers all 16 unit tests across 7 describe groups (kickoff, indexing strings, storage shape, non-blocking constructor, fallback semantics, build failure + RBAC invariant, performance bounds at mock level). Mirrors Phase 6's `test/types.test.ts` mock-provider pattern.

**Framework install:** none — vitest is already in v1.0 root devDependencies. Phase 7 introduces zero new deps.

**Existing infrastructure Phase 7 reuses:**
- `test/core.test.ts` test-fixture pattern (`makeTool` helper) — Phase 7 mirrors this in the new file rather than importing (test files don't share helpers in v1.0; each is self-contained).
- `test/types.test.ts` mock-provider pattern (`const mock: EmbeddingProvider = async (texts) => texts.map(...)`) — Phase 7 reuses verbatim.

---

## Three [BLOCKING] Phase Gates (carry forward from Phase 6)

These three gates enforce board-locked invariants. Phase 7 verification fails if any returns non-zero.

**Baseline ref:** `bec3f6f` (post-Phase-6 close — last green state on main before Phase 7 begins). Planner may substitute `acbb9b0` or `9571d8b` (Phase 6 close-out variants) — semantics identical.

### Gate 1 — Zero new core deps
```bash
diff <(jq -S '{deps:(.dependencies // {}), peers:.peerDependencies}' package.json) \
     <(git show bec3f6f:package.json | jq -S '{deps:(.dependencies // {}), peers:.peerDependencies}')
```
Must produce empty diff. Phase 7 introduces zero new dependencies; this gate should pass trivially.

### Gate 2 — Public-API additive-only / unchanged
```bash
npm run build  # emits dist/index.d.ts
diff <(grep -E "^export" dist/index.d.ts | sort) \
     <(git show bec3f6f:dist/index.d.ts | grep -E "^export" | sort)
```
Must produce empty diff. Phase 7 adds NO new public exports — `MCPackEngine`'s new private members do not surface in `dist/index.d.ts` because `MCPackEngine` is not re-exported from `src/index.ts` (Phase 02 decision). **Caveat:** the planner should run this gate once during Wave 0 to confirm `MCPackEngine` private members really don't surface there — if they do, a stricter check (full file diff) is needed.

### Gate 3 — Adapter isolation
```bash
! grep -rE "@llvs/mcpack-embeddings|@huggingface/transformers|@xenova/transformers" src/ test/
```
Must return zero matches. Phase 7's tests use inline mock providers; Phase 7's engine code consumes only the abstract `EmbeddingProvider` type from `./types.js`.

**Caveat — JSDoc reference temptation:** Phase 6 rewrote a JSDoc comment to avoid the literal `@llvs/mcpack-embeddings` string (per 06-01-SUMMARY §"Deviations from Plan"). Phase 7's new code follows the same convention: any JSDoc that wants to reference the adapter package says "the sibling adapter package" instead of the literal name.

---

## Manual-Only Verifications

None expected. All Phase 7 acceptance criteria are programmatically verifiable via the per-task verification map above.

The PRD-level "real-MiniLM 5s build on commodity hardware" assertion is automated in Phase 10's harness — NOT a manual check, NOT a Phase 7 acceptance criterion.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (`src/semantic-index-builder.ts`, `test/semantic-index-build.test.ts`)
- [ ] No watch-mode flags
- [ ] Feedback latency < 5 seconds per-task
- [ ] Three [BLOCKING] gates encoded in PLAN.md acceptance criteria
- [ ] `nyquist_compliant: true` set in frontmatter once execution proves the per-task map green

**Approval:** pending (awaiting Phase 7 plan-checker pass)
