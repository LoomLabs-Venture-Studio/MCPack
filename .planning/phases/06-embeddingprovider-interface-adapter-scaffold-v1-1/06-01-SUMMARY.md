---
phase: 06-embeddingprovider-interface-adapter-scaffold-v1-1
plan: 01
subsystem: api
tags: [typescript, types, public-api, semantic-search, embeddings, vitest, esm]

# Dependency graph
requires:
  - phase: 05-publish-and-launch
    provides: v1.0 public type surface (MCPackConfig, mcpack(), createMCPackServer()) and locked package.json deps baseline at git ref 22d7d98
provides:
  - Public `EmbeddingProvider` type alias re-exported from `@llvs/mcpack` package entry
  - Optional `MCPackConfig.embeddings` field with `{ provider, weights? }` shape
  - Core package version bumped 1.0.0 → 1.1.0 so sibling adapter peer-dep `@llvs/mcpack ^1.1.0` resolves locally
  - Mock-provider type-contract test fixture verifying batch-in / parallel-array-out invariant
affects: [06-02 mcpack-embeddings-package-scaffold, 07 semantic-index-build, 08 hybrid-ranking-query, 09 analytics]

# Tech tracking
tech-stack:
  added: []  # Zero new deps — REQ-v11-zero-core-deps / DEC-BOARD-04 invariant preserved
  patterns:
    - "Type-only public API additions — additive-only, byte-identical v1.0 export surface preserved (REQ-v11-public-api-lock)"
    - "Adapter-isolation enforced via static grep gate — core src/ + test/ never reference adapter-package names or model deps"
    - "Test-from-package-entry pattern — type-contract tests import from '../src/index.js' to verify the export wiring, not just the underlying types module"
    - "Version-in-development pattern — repo HEAD claims 1.1.0 while phases 6–9 build; npm publish remains a Phase 10 concern"

key-files:
  created:
    - test/types.test.ts (7 tests, 2 describe blocks; pins EmbeddingProvider batch contract + MCPackConfig.embeddings shape)
  modified:
    - src/types.ts (added EmbeddingProvider type alias above MCPackConfig; appended optional embeddings field on MCPackConfig)
    - src/index.ts (added EmbeddingProvider to type re-export list, position last per plan; v1.0 12 entries verbatim)
    - package.json (version 1.0.0 → 1.1.0; ZERO other changes — no new dependencies, peerDependencies, scripts, exports)

key-decisions:
  - "DEC-v11-01 honored: EmbeddingProvider type signature is locked verbatim — `(texts: string[]) => Promise<number[][]>`; agents/operators import from `@llvs/mcpack` core, not from the adapter package"
  - "DEC-v11-02 + DEC-BOARD-04 honored: MCPackConfig.embeddings is optional — when omitted, search code path is byte-identical to v1.0 (zero new branches in this plan; types-only plumbing)"
  - "DEC-v11-03b honored: core version bumped 1.0.0 → 1.1.0 in this phase; npm publish deferred to Phase 10 (version-in-development pattern)"
  - "JSDoc comment on EmbeddingProvider rewritten to reference 'the sibling adapter package' instead of the literal package name, to honor the static-grep adapter-isolation gate (Gate 3) which scans src/ and test/ for the literal string"

patterns-established:
  - "Additive-only public API evolution: every v1.1 export is a new symbol, never a modification to a v1.0 symbol; verified by declaration-file diff against git ref 22d7d98"
  - "Static-grep gates for cross-package isolation: Gate 3 is a `grep -rE` over src/ + test/ that catches both imports AND comment references to adapter-package names — drives even doc text to stay generic in core"
  - "TDD via plan-level RED/GREEN ordering: Task 1 lands the type contract (GREEN — types exist, 100/100 v1.0 tests still pass), Task 2 lands the contract-pinning tests (atomic test commit, 7 new passing tests on top of v1.0 baseline)"

requirements-completed:
  - REQ-v11-semantic-provider-interface
  - REQ-v11-embeddings-optional-config
  - REQ-v11-public-api-lock
  - REQ-v11-esm-only
  - REQ-v11-zero-core-deps

# Metrics
duration: 9min
completed: 2026-04-26
---

# Phase 06 Plan 01: EmbeddingProvider Interface + Adapter Scaffold Summary

**Public `EmbeddingProvider` type and optional `MCPackConfig.embeddings` field added to `@llvs/mcpack`; core version bumped 1.0.0 → 1.1.0; zero new dependencies; v1.0 public API and 100/100 v1.0 tests preserved byte-for-byte; 7 new type-contract tests pin the batch-in / parallel-array-out invariant.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-04-26T16:03:33Z
- **Completed:** 2026-04-26T16:13:12Z
- **Tasks:** 2 / 2 completed
- **Files modified:** 4 (3 modified, 1 created)
- **Test count delta:** 100 → 107 (added 7 new, all passing; v1.0 100 baseline unchanged)
- **Coverage:** 99.56% statement coverage preserved (v1.0 baseline match)

## Accomplishments

- `EmbeddingProvider = (texts: string[]) => Promise<number[][]>` exported from `@llvs/mcpack` package entry (`import type { EmbeddingProvider } from '@llvs/mcpack'` resolves at compile time)
- `MCPackConfig.embeddings?: { provider: EmbeddingProvider; weights?: { semanticWeight: number; keywordWeight: number } }` available on the config interface; v1.0 callsites with no `embeddings` field continue to compile unmodified
- Core `package.json` version bumped 1.0.0 → 1.1.0 with **zero** changes to `dependencies`, `peerDependencies`, `devDependencies`, `scripts`, `exports`, `files`, `engines`, `main`, `types`, or `type` — sibling adapter package's peer-dep `@llvs/mcpack ^1.1.0` will now resolve in plan 06-02
- Mock-provider type-contract tests pin the batch invariants: parallel-array length contract, consistent dimensionality across the batch, and the empty-input edge case
- All three [BLOCKING] phase gates pass: zero-new-core-deps, public-API additive-only, adapter-isolation

## Task Commits

Each task committed atomically per CLAUDE.md `type(scope): description` convention:

1. **Task 1 — Add EmbeddingProvider type + MCPackConfig.embeddings field; bump core to 1.1.0** — `e10e25c` (feat)
2. **Task 2 — Add EmbeddingProvider batch-contract + MCPackConfig.embeddings shape tests** — `20cf3b7` (test)

**Plan metadata commit:** to follow (this SUMMARY.md + STATE.md + ROADMAP.md updates committed together as `docs(06-01): complete plan 01`).

## Files Created/Modified

- `src/types.ts` — added `EmbeddingProvider` type alias (locked signature per DEC-v11-01) immediately above `MCPackConfig`; appended optional `embeddings` field on `MCPackConfig` after the `session?: SessionConfig` line. All 14 v1.0 exported symbols preserved byte-identically.
- `src/index.ts` — added `EmbeddingProvider` to the type re-export list (last entry; v1.0 12 entries unchanged in name, order, and position). Two value re-exports (`mcpack`, `createMCPackServer`) untouched.
- `package.json` — `version` field changed `"1.0.0"` → `"1.1.0"`. **Zero** other changes — confirmed by jq-sorted diff vs git ref 22d7d98 returning empty for `dependencies` and `peerDependencies` keys.
- `test/types.test.ts` (NEW) — 7 vitest `it(...)` blocks across 2 `describe` blocks: `EmbeddingProvider type contract` (4 tests covering signature, parallel-array, dimensionality, empty input) and `MCPackConfig.embeddings shape` (3 tests covering omitted, provider-only, provider+weights). Imports types from package entry `'../src/index.js'` (NOT from `'../src/types.js'`) to verify the export wiring done in Task 1.

## Decisions Made

- **JSDoc text adjustment.** The plan prescribed verbatim JSDoc text on the `EmbeddingProvider` type that included the literal string ``@llvs/mcpack-embeddings``. That literal also matched the adapter-isolation gate's grep pattern. To honor BOTH the prescribed JSDoc spirit (point readers at the adapter package) AND the gate's literal pass criterion (zero matches in src/ + test/), the comment was rewritten to reference "the sibling adapter package" without naming it. Documented as a Rule 1 deviation below — not a contract change, just a doc-vs-gate reconciliation.
- **No other deviations.** Task 1's three steps (types.ts edit, index.ts edit, package.json version bump) and Task 2's test file content followed the plan's prescribed text verbatim apart from the above.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] JSDoc text rewrite to honor adapter-isolation gate**
- **Found during:** Task 1 (Step 5 — running [BLOCKING] Gate 3 inline before commit)
- **Issue:** The plan prescribed JSDoc text on `EmbeddingProvider` containing the literal string ``@llvs/mcpack-embeddings``. Gate 3's grep (`grep -rE "@llvs/mcpack-embeddings|@huggingface/transformers|@xenova/transformers" src/ test/`) returned that comment as a match — failing the "zero matches" requirement even though the JSDoc is not an import. The plan as written contradicted its own gate.
- **Fix:** Rewrote the JSDoc comment from "See `@llvs/mcpack-embeddings` for a local MiniLM adapter, or implement against this signature for hosted providers." to "See the sibling adapter package for a local MiniLM implementation, or implement against this signature for hosted providers." Same intent, no literal string match for the grep.
- **Files modified:** src/types.ts (one comment block, two lines)
- **Verification:** Re-ran Gate 3 grep — zero matches. Re-ran `npm run typecheck && npm run build && npm test` — all green, 100/100 v1.0 tests still passing. The rewrite is a pure doc/comment change with zero compiled-output effect.
- **Committed in:** `e10e25c` (Task 1 commit; the rewrite happened before the commit landed, so the bad text is never in the git history)

---

**Total deviations:** 1 auto-fixed (1 doc-vs-gate reconciliation; Rule 1)
**Impact on plan:** Zero scope creep. The fix preserves the JSDoc's purpose (point readers at the adapter package) while honoring the literal blocking gate. No other files touched. No additional tests required because the change is comment-only.

## Issues Encountered

None outside the doc-vs-gate reconciliation above.

## Phase Gate Results

All three [BLOCKING] phase gates from `06-VALIDATION.md` pass:

| Gate | Description | Command | Result |
|------|-------------|---------|--------|
| 1 | Zero-new-core-deps vs v1.0 baseline (22d7d98) | `diff <(jq -S '{deps:(.dependencies // {}), peers:.peerDependencies}' package.json) <(git show 22d7d98:package.json \| jq -S '{deps:(.dependencies // {}), peers:.peerDependencies}')` | PASS — empty diff |
| 2 | Public-API additive-only vs v1.0 baseline | `diff <(git show 22d7d98:src/index.ts) <(cat src/index.ts) \| grep -E '^[<>]'` | PASS — single line addition `>   EmbeddingProvider,`, zero removals |
| 3 | Adapter-isolation (no adapter-package or model-dep references in core) | `grep -rE "@llvs/mcpack-embeddings\|@huggingface/transformers\|@xenova/transformers" src/ test/` | PASS — zero matches |

ESM-only invariant preserved: `ls dist/*.cjs` returns no matches (REQ-v11-esm-only / DEC-v11-04).

## Regression Gate Results

All v1.0 test files byte-identical to git ref 22d7d98 (REQ-v11-backward-compat verified):

```
test/build.test.ts         — unchanged
test/core.test.ts          — unchanged
test/index-builder.test.ts — unchanged
test/roles.test.ts         — unchanged
test/search.test.ts        — unchanged
test/session.test.ts       — unchanged
test/wrap.test.ts          — unchanged
```

100/100 v1.0 tests pass unmodified. New file `test/types.test.ts` adds 7 passing tests on top, for a total of 107 tests. Statement coverage 99.56% (matches v1.0 baseline; `types.ts` is type-only and contributes no runtime statements to the coverage denominator).

## User Setup Required

None — no external service configuration required. Type-only public-API change with no runtime behavior shift.

## Next Phase Readiness

- **Plan 06-02 (mcpack-embeddings package scaffold) UNBLOCKS as of this commit.** The adapter package's `peerDependencies: { "@llvs/mcpack": "^1.1.0" }` will now resolve against the working tree, and `import type { EmbeddingProvider } from '@llvs/mcpack'` from inside `packages/mcpack-embeddings/` will compile.
- **Phase 7 (semantic index build) inherits the type contract.** The `MCPackConfig.embeddings.provider` field is the hook Phase 7 reads when constructing the async index builder.
- **Phase 8 (hybrid ranking) inherits the weights contract.** `MCPackConfig.embeddings.weights` is in place; default values (semantic 0.7, keyword 0.3 per DEC-v11-12) are NOT applied here — Phase 8 owns that.
- **Phase 9 (analytics) is unaffected.** OQ1 (`getAnalytics()` flat-on-handle vs `.analytics` property) was deliberately NOT decided in this plan; no `analytics` field, no `AnalyticsSnapshot` type added.

## Self-Check: PASSED

Verified post-write:

- [x] `src/types.ts` contains `export type EmbeddingProvider = (texts: string[]) => Promise<number[][]>;`
- [x] `src/types.ts` contains `provider: EmbeddingProvider;` inside MCPackConfig block
- [x] `src/index.ts` contains `EmbeddingProvider,` in the type re-export list AND retains all 12 v1.0 type re-exports
- [x] `package.json` `.version` equals `"1.1.0"`
- [x] `test/types.test.ts` exists, imports from `'../src/index.js'`, has 7 `it(...)` blocks
- [x] Commit `e10e25c` (feat) exists in `git log --oneline`
- [x] Commit `20cf3b7` (test) exists in `git log --oneline`
- [x] `npm run typecheck && npm run build && npm test` — all exit 0; 107/107 tests pass
- [x] Gate 1 (zero-new-core-deps): empty diff vs 22d7d98 baseline
- [x] Gate 2 (public-API additive-only): only `EmbeddingProvider,` added
- [x] Gate 3 (adapter-isolation): zero grep matches in src/ + test/
- [x] All 7 v1.0 test files byte-identical to 22d7d98 baseline

---

*Phase: 06-embeddingprovider-interface-adapter-scaffold-v1-1*
*Plan: 01*
*Completed: 2026-04-26*
