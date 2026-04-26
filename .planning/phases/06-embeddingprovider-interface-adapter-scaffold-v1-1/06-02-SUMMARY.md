---
phase: 06-embeddingprovider-interface-adapter-scaffold-v1-1
plan: 02
subsystem: adapter
tags: [typescript, package-scaffold, embeddings, minilm, huggingface-transformers, vitest, esm, sibling-package]

# Dependency graph
requires:
  - phase: 06-embeddingprovider-interface-adapter-scaffold-v1-1
    plan: 01
    provides: Public `EmbeddingProvider` type re-exported from `@llvs/mcpack`; root version bumped 1.0.0 → 1.1.0 so adapter peer-dep `@llvs/mcpack ^1.1.0` resolves locally
provides:
  - Brand-new sibling package `@llvs/mcpack-embeddings@1.1.0` at `packages/mcpack-embeddings/`
  - `createMiniLMProvider(opts?)` factory returning an `EmbeddingProvider` backed by `Xenova/all-MiniLM-L6-v2` via `@huggingface/transformers ^4.0.0`
  - Closure-scoped pipeline singleton + mean-pooled / L2-normalized 384-dim vectors
  - Adapter test suite (5 tests; 3 always-on contract + 2 gated model-integration via `RUN_MODEL_TESTS=1`)
  - ESM-only adapter build pipeline (typecheck + build + test, no `.cjs` output)
affects: [07 semantic-index-build, 08 hybrid-ranking-query, 10 publish-and-launch]

# Tech tracking
tech-stack:
  added:
    - "@huggingface/transformers ^4.0.0 (adapter-package runtime dep — ZERO leak into core; DEC-v11-03 clerical-correction + DEC-BOARD-04)"
  patterns:
    - "Sibling-directory package layout (packages/mcpack-embeddings/) — no monorepo tooling, no workspaces field; resolved via npm link during local development per DEC-v11-03a"
    - "Closure-scoped singleton for ML model loading — extractor cache lives inside factory return value, NOT at module scope; avoids vitest module-scope leak (research Pitfall 2)"
    - "Type-only import of EmbeddingProvider from peer dep — `import type { EmbeddingProvider } from '@llvs/mcpack'` honors verbatimModuleSyntax (research Pitfall 4); adapter does NOT re-export the type (research Pitfall 1)"
    - "Test gating via runtime env-var early-return — `RUN_MODEL_TESTS=1` opt-in for the ~25 MB model download; default test runs verify factory contract + type-conformance only"
    - "tsconfig.json byte-identical to root (no extends) — mirrors strict + NodeNext + verbatimModuleSyntax + ES2022 settings without coupling published package to repo layout"

key-files:
  created:
    - packages/mcpack-embeddings/package.json (name @llvs/mcpack-embeddings@1.1.0, type module, peer @llvs/mcpack ^1.1.0, dep @huggingface/transformers ^4.0.0)
    - packages/mcpack-embeddings/tsconfig.json (byte-identical to root)
    - packages/mcpack-embeddings/.gitignore (node_modules/, dist/, *.log)
    - packages/mcpack-embeddings/src/index.ts (re-exports createMiniLMProvider + MiniLMOptions; does NOT re-export EmbeddingProvider)
    - packages/mcpack-embeddings/src/minilm.ts (factory with closure-scoped pipeline singleton, mean+normalize, empty-input fast path; 76 lines)
    - packages/mcpack-embeddings/test/minilm.test.ts (5 vitest tests across 2 describe blocks; 60 lines)
  modified: []

key-decisions:
  - "DEC-v11-03 clerical-correction honored: runtime dep is `@huggingface/transformers ^4.0.0`, NOT the frozen `@xenova/transformers`. Lock applied verbatim with no substitution."
  - "DEC-v11-03a honored: sibling-directory layout at `packages/mcpack-embeddings/`. No `workspaces:` field added to root `package.json`; no pnpm/yarn/turbo config introduced."
  - "DEC-BOARD-05 / Pitfall 1 honored: adapter exports ONLY the factory + options; consumers import `EmbeddingProvider` type from `@llvs/mcpack` core. Verified by grep — `EmbeddingProvider` literal does not appear in `packages/mcpack-embeddings/src/index.ts`."
  - "Closure-scoped singleton for the MiniLM pipeline (research Pattern 2 / Pitfall 2). Module-scope `let` was deliberately avoided to prevent vitest test-file leakage in non-isolation mode."
  - "Local dependency resolution via `npm link` (NOT `npm install`). The adapter's `peerDependencies` and `devDependencies` declare `@llvs/mcpack ^1.1.0`, which the npm registry cannot satisfy until Phase 10 publishes. The plan's documented Step 2 fallback (`npm link`) was applied; recorded for Phase 7+ executors."
  - "No `package-lock.json` committed for the adapter package. `npm install` was not run successfully (registry resolution failed); `npm link` does not generate a lockfile. Phase 10 (publish) will run `npm install` cleanly once `@llvs/mcpack@1.1.0` is on the registry, generating the lockfile then."

patterns-established:
  - "Adapter-package boundary: each new adapter (mcpack-embeddings now, mcpack-google in v1.2) is a sibling under packages/, with its own package.json declaring @llvs/mcpack as a peer + dev dep, and its own tsconfig mirroring root."
  - "Local dev resolution via npm link: when peer-dep version exceeds the published version on the registry (the standard 'version-in-development' pattern from DEC-v11-03b), use npm link from root + npm link <name> from the adapter directory. Documented for future phases."
  - "ML-model adapter pattern: factory async + closure-scoped singleton + lazy load on first non-empty call + empty-input fast path. Reusable for any adapter that wraps a heavy model loader (HuggingFace, OpenAI client SDK, Voyage, etc.)."

requirements-completed:
  - REQ-v11-mcpack-embeddings-package
  - REQ-v11-zero-core-deps
  - REQ-v11-esm-only

# Metrics
duration: 12min
completed: 2026-04-26
---

# Phase 06 Plan 02: @llvs/mcpack-embeddings Sibling Package Scaffold Summary

**New sibling package `@llvs/mcpack-embeddings@1.1.0` scaffolded at `packages/mcpack-embeddings/` with a local MiniLM adapter (`createMiniLMProvider`) backed by `@huggingface/transformers ^4.0.0` and `Xenova/all-MiniLM-L6-v2`; zero leakage into core (`@llvs/mcpack`); 5 adapter tests (3 always-on contract + 2 gated model-integration); all three [BLOCKING] phase gates pass against v1.0 baseline `22d7d98`.**

## Performance

- **Duration:** ~12 min (706 seconds, 2026-04-26T16:27:17Z → 16:39:03Z; SUMMARY/STATE/ROADMAP commit follows)
- **Tasks:** 2 / 2 completed
- **Files created:** 6 (all under `packages/mcpack-embeddings/`)
- **Files modified:** 0 in core (`src/`, `test/`, root `package.json`, root `tsconfig.json` all byte-identical to post-06-01 state)
- **Adapter test count:** 5 (3 always-on contract tests pass; 2 model-integration tests pass via early-return without `RUN_MODEL_TESTS=1`)
- **Root test count:** 107 / 107 (preserved from 06-01 baseline)
- **Adapter pipeline runtime:** typecheck instant, build instant, test ~1.4 s

## Accomplishments

- New package `@llvs/mcpack-embeddings@1.1.0` exists at `packages/mcpack-embeddings/` with all 6 required files (package.json, tsconfig.json, .gitignore, src/index.ts, src/minilm.ts, test/minilm.test.ts).
- `createMiniLMProvider(opts?: MiniLMOptions): Promise<EmbeddingProvider>` factory implemented per DEC-v11-01 contract — batch-in / parallel-array-out, mean-pooled + L2-normalized 384-dim vectors via `Xenova/all-MiniLM-L6-v2`.
- Closure-scoped pipeline singleton — `let extractor: FeatureExtractionPipeline | undefined` lives inside the factory's return value, not at module scope; lazy load fires on first non-empty call.
- Empty-input fast path `if (texts.length === 0) return [];` — exercised by always-on tests, proves the factory does not eagerly download the ~25 MB ONNX model.
- Adapter compiles with `tsc` against `verbatimModuleSyntax: true`; `import type { EmbeddingProvider } from '@llvs/mcpack'` resolves through the npm-linked peer dep.
- Adapter build emits `dist/index.js`, `dist/index.d.ts`, `dist/minilm.js`, `dist/minilm.d.ts` plus source maps. Zero `.cjs` files (REQ-v11-esm-only / DEC-v11-04 preserved).
- All three [BLOCKING] phase gates pass against v1.0 baseline `22d7d98`: zero-new-core-deps, public-API additive-only (only `EmbeddingProvider,` line added by 06-01), adapter-isolation grep returns zero matches in `src/` + `test/`.
- Root `npm run typecheck`, `npm run build`, `npm test` continue to pass — 107/107 tests, 99.56% statement coverage preserved.

## Task Commits

Each task committed atomically per CLAUDE.md `type(scope): description` convention:

1. **Task 1 — Scaffold the package skeleton (5 files)** — `c5d78ad` (feat)
2. **Task 2 — Add adapter test suite + verify install/build/test pipeline** — `5de626e` (test)

**Plan metadata commit:** to follow (this SUMMARY.md + STATE.md + ROADMAP.md updates committed together as `docs(06-02): complete @llvs/mcpack-embeddings sibling-package scaffold plan`).

## Files Created/Modified

### Created (6 files, all under `packages/mcpack-embeddings/`)

- **`packages/mcpack-embeddings/package.json`** — Manifest with `name: "@llvs/mcpack-embeddings"`, `version: "1.1.0"`, `type: "module"`, `peerDependencies: { "@llvs/mcpack": "^1.1.0" }`, `dependencies: { "@huggingface/transformers": "^4.0.0" }`. devDependencies (`@llvs/mcpack`, `@types/node`, `@vitest/coverage-v8`, `typescript`, `vitest`) pinned to versions matching root.
- **`packages/mcpack-embeddings/tsconfig.json`** — Byte-identical copy of root `tsconfig.json` (verified via `diff` returning empty). NodeNext + strict + verbatimModuleSyntax + ES2022 + declaration/declarationMap/sourceMap. No `extends` reference (research Pattern 3 — published packages do not ship parent configs).
- **`packages/mcpack-embeddings/.gitignore`** — Three-line ignore for `node_modules/`, `dist/`, `*.log`. Critical because adapter's `node_modules/` includes the ~25 MB ONNX model cache on first run with `RUN_MODEL_TESTS=1`.
- **`packages/mcpack-embeddings/src/index.ts`** — Two-line public entry point: `export { createMiniLMProvider } from './minilm.js';` and `export type { MiniLMOptions } from './minilm.js';`. Does NOT contain the literal string `EmbeddingProvider` (Pitfall 1 enforcement; verified by grep).
- **`packages/mcpack-embeddings/src/minilm.ts`** — 76-line factory implementation. Imports `pipeline` value + `FeatureExtractionPipeline` type from `@huggingface/transformers`; imports `EmbeddingProvider` as type-only from `@llvs/mcpack`. Defines `MiniLMOptions { model?, cacheDir? }` and `DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2'`. Factory returns a closure-scoped function with empty-input fast path + lazy `ensureExtractor` + `pooling: 'mean', normalize: true` extraction + `tensor.tolist() as number[][]` cast.
- **`packages/mcpack-embeddings/test/minilm.test.ts`** — 60-line vitest suite. 3 always-on contract tests (`returns a function conforming to EmbeddingProvider`; `returns empty array for empty input without loading the model`; `accepts MiniLMOptions with model and cacheDir without throwing at construction`); 2 gated model-integration tests (`returns 384-dim vectors for a batch of two strings`; `produces consistent vectors for identical inputs (singleton + determinism)`) with `RUN_MODEL_TESTS=1` env-var gate via runtime early-return + 60 s timeout.

### Modified (0 files)

This plan touched **zero** files in core. Confirmed by `git diff 53ddcfd HEAD -- src/ test/ package.json tsconfig.json` returning empty (53ddcfd = post-06-01 HEAD; the 06-02 commits c5d78ad + 5de626e only add files under `packages/mcpack-embeddings/`).

## Decisions Made

- **Adapter dependency resolution path:** `npm install` failed with `ETARGET No matching version found for @llvs/mcpack@^1.1.0` — expected, because v1.1.0 is not yet published to npm (Phase 10 owns publish). The plan's Step 2 documents this exact scenario and prescribes `npm link` as the local-development fallback. Applied:
  - `npm link` from `/Users/zaid/Projects/MCPack/` (root) — registers `@llvs/mcpack` globally
  - `npm link @llvs/mcpack` from `/Users/zaid/Projects/MCPack/packages/mcpack-embeddings/` — symlinks `node_modules/@llvs/mcpack` to the global registration AND, as a side effect, installs the rest of the adapter's deps (`@huggingface/transformers`, `vitest`, `typescript`, `@vitest/coverage-v8`, etc.)
  - Recorded for Phase 7+ executors: each developer machine needs the same `npm link` setup once until Phase 10 publishes `@llvs/mcpack@1.1.0` to the registry.
- **No `package-lock.json` for the adapter package:** the `npm link` path does NOT generate a lockfile (only `npm install` does). Phase 10 will run a clean `npm install` once the peer dep resolves from the registry, and that is when the lockfile will be generated and committed. Until then, the adapter directory has no lockfile, which is acceptable because:
  1. The adapter ships only `dist/` (the `files: ["dist"]` field), so consumers never see the lockfile anyway.
  2. Reproducibility for in-flight development is satisfied by the version pins in `package.json` + `npm link` resolution.
  3. The plan's gate set does not require a committed lockfile — only that `npm install`-equivalent resolution succeeds.
- **No README in this plan:** the env_notes block in the PLAN explicitly defers README to Phase 10. No `packages/mcpack-embeddings/README.md` was created. The `06-VALIDATION.md §"Manual-Only Verifications"` row for the README marker is therefore DEFERRED to Phase 10, not blocked.
- **Test file uses runtime early-return for gating, not `it.runIf`:** matches the research §"Adapter integration test" pattern verbatim. `it.runIf(condition)` exists in vitest but is unstable across minor versions; `if (!runModelTests) return;` is portable and produces a passing-but-fast-skipping test in default runs.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `npm install` registry resolution failure for `@llvs/mcpack@^1.1.0`**
- **Found during:** Task 2 (Step 2 — `cd packages/mcpack-embeddings && npm install`)
- **Issue:** `npm install` exited with `ETARGET No matching version found for @llvs/mcpack@^1.1.0`. The registry only has v1.0.0 (Phase 5 publish); v1.1.0 was bumped in 06-01 but won't reach the registry until Phase 10. This blocked the adapter's typecheck + build + test pipeline, which require `@llvs/mcpack` to resolve.
- **Fix:** Applied the plan's documented Step 2 fallback exactly as written — `npm link` from root, then `npm link @llvs/mcpack` from the adapter directory. The `npm link @llvs/mcpack` invocation also auto-installed the rest of the adapter's dependencies as a side effect (167 packages including `@huggingface/transformers`, `vitest`, `typescript`).
- **Files modified:** none (the side-effect `node_modules/` is gitignored)
- **Verification:** `cd packages/mcpack-embeddings && npm run typecheck && npm run build && npm test` all exit 0; `dist/` emits `index.js + index.d.ts + minilm.js + minilm.d.ts`; `dist/*.cjs` matches nothing.
- **Committed in:** `5de626e` (Task 2 commit message records the resolution path explicitly)

---

**Total deviations:** 1 auto-fixed (1 blocking-issue resolution via plan's documented fallback; Rule 3)
**Impact on plan:** Zero scope creep. The fallback is explicitly enumerated in the plan's Step 2 ("Optional one-time link (only if devDep resolution fails)") — applying it does not change what was built. No additional files touched. No additional tests required.

## Issues Encountered

None outside the deviation above. The `npm link` fallback was anticipated by the plan; applying it produced clean adapter pipeline runs on the first attempt.

## Phase Gate Results

All three [BLOCKING] phase gates from `06-VALIDATION.md` pass:

| Gate | Description | Command | Result |
|------|-------------|---------|--------|
| 1 | Zero-new-core-deps vs v1.0 baseline (22d7d98) | `diff <(jq -S '{deps:(.dependencies // {}), peers:.peerDependencies}' package.json) <(git show 22d7d98:package.json \| jq -S '{deps:(.dependencies // {}), peers:.peerDependencies}')` | PASS — empty diff |
| 2 | Public-API additive-only vs v1.0 baseline | `diff <(git show 22d7d98:src/index.ts) src/index.ts` | PASS — single addition `>   EmbeddingProvider,` from 06-01, zero removals or modifications, zero further changes from 06-02 |
| 3 | Adapter-isolation (no adapter-package or model-dep references in core) | `grep -rE "@llvs/mcpack-embeddings\|@huggingface/transformers\|@xenova/transformers" src/ test/` | PASS — zero matches |

**ESM-only invariant preserved on adapter:** `ls packages/mcpack-embeddings/dist/*.cjs` returns no matches (REQ-v11-esm-only / DEC-v11-04).

## Regression Gate Results

- Root `npm run typecheck` → exit 0 (no new errors)
- Root `npm run build` → exit 0 (`dist/` emits cleanly; ESM-only preserved)
- Root `npm test` → 107/107 passing (no regression from adapter package's existence; the `packages/` directory is excluded from root `tsconfig` `include: ["src"]` and root vitest `test/` glob)
- Adapter `npm run typecheck` → exit 0
- Adapter `npm run build` → exit 0 (4 emitted files in `dist/`, zero `.cjs`)
- Adapter `npm test` → 5 / 5 passing (3 always-on + 2 gated returning early without `RUN_MODEL_TESTS=1`)

## User Setup Required

For each developer machine, until Phase 10 publishes `@llvs/mcpack@1.1.0` to npm:

```bash
# Once per machine (registers @llvs/mcpack globally from working tree):
cd /Users/zaid/Projects/MCPack
npm link

# Once per fresh adapter-package clone (links the global @llvs/mcpack into the adapter's node_modules):
cd /Users/zaid/Projects/MCPack/packages/mcpack-embeddings
npm link @llvs/mcpack
```

Phase 10 owns the npm publish; after that, `cd packages/mcpack-embeddings && npm install` will resolve `@llvs/mcpack@^1.1.0` from the registry directly and the link step becomes optional.

The first run of `RUN_MODEL_TESTS=1 npm test` in the adapter directory downloads ~25 MB of ONNX model files to the `transformers.js` cache (under the adapter's `node_modules/`). Phase 6 verification does NOT require `RUN_MODEL_TESTS=1` — that is a Phase 10 concern.

## Next Phase Readiness

- **Phase 7 (semantic index build) is unblocked.** The `MCPackConfig.embeddings.provider` field on the locked `MCPackConfig` interface is the hook Phase 7 reads when constructing the async index builder. The first concrete provider implementation is now `createMiniLMProvider` from `@llvs/mcpack-embeddings` — Phase 7 integration tests can `import { createMiniLMProvider } from '@llvs/mcpack-embeddings'` against the npm-linked adapter.
- **Phase 8 (hybrid ranking) inherits the same hook.** No additional adapter work needed in Phase 8; the `provider: EmbeddingProvider` callback signature carries query-side embedding through.
- **Phase 9 (analytics) is independent.** This plan does not touch `MCPackConfig.analytics` or `getAnalytics()`.
- **Phase 10 (publish) has a new responsibility:** publish BOTH `@llvs/mcpack@1.1.0` and `@llvs/mcpack-embeddings@1.1.0`. Phase 10's harness will run `RUN_MODEL_TESTS=1 cd packages/mcpack-embeddings && npm test` to exercise the gated 384-dim + determinism tests against an actual model download.
- **`@llvs/mcpack-google` (v1.2 adapter) inherits this scaffold pattern verbatim.** When v1.2 lands the second adapter package at `packages/mcpack-google/`, it will use the same sibling-directory layout, the same `peerDependencies: { "@llvs/mcpack": "^1.x.0" }` declaration, the same byte-identical-to-root `tsconfig.json`, and the same `npm link` local-dev path until publish.

## Self-Check: PASSED

Verified post-write:

- [x] `packages/mcpack-embeddings/package.json` exists with name `@llvs/mcpack-embeddings`, version `1.1.0`, type `module`, peer-dep `@llvs/mcpack ^1.1.0`, runtime dep `@huggingface/transformers ^4.0.0`
- [x] `packages/mcpack-embeddings/tsconfig.json` exists and is byte-identical to root `tsconfig.json` (`diff` empty)
- [x] `packages/mcpack-embeddings/.gitignore` exists with `node_modules/`, `dist/`, `*.log`
- [x] `packages/mcpack-embeddings/src/index.ts` exists, exports `createMiniLMProvider` and `MiniLMOptions`, does NOT contain the literal string `EmbeddingProvider`
- [x] `packages/mcpack-embeddings/src/minilm.ts` exists with `import type { EmbeddingProvider } from '@llvs/mcpack'`, `import { pipeline ... } from '@huggingface/transformers'`, `Xenova/all-MiniLM-L6-v2` default model, closure-scoped extractor singleton
- [x] `packages/mcpack-embeddings/test/minilm.test.ts` exists with 5 `it(...)` blocks across 2 `describe` blocks; imports `EmbeddingProvider` as type-only
- [x] Commit `c5d78ad` (feat) exists in `git log --oneline`
- [x] Commit `5de626e` (test) exists in `git log --oneline`
- [x] Adapter `npm run typecheck && npm run build && npm test` — all exit 0; 5 / 5 tests pass; ESM-only (no `.cjs`)
- [x] Root `npm run typecheck && npm run build && npm test` — all exit 0; 107 / 107 tests pass
- [x] Gate 1 (zero-new-core-deps): empty diff vs 22d7d98 baseline
- [x] Gate 2 (public-API additive-only): only `>   EmbeddingProvider,` from 06-01 added vs 22d7d98; zero further changes from 06-02
- [x] Gate 3 (adapter-isolation): zero grep matches for adapter or transformer libs in `src/` + `test/`
- [x] Adapter test count: 5 (3 always-on + 2 gated, all pass)
- [x] Stub scan: no TODO/FIXME/placeholder/coming soon/not available patterns in adapter code
- [x] Threat surface scan: no new network/auth/file-access surface (the adapter is a pure library that wraps a local ONNX model loader; the model download path is a transformers.js library concern, not new MCPack surface)

---

*Phase: 06-embeddingprovider-interface-adapter-scaffold-v1-1*
*Plan: 02*
*Completed: 2026-04-26*
