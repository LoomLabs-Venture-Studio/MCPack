---
phase: 6
slug: embeddingprovider-interface-adapter-scaffold-v1-1
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-25
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Promoted from `06-RESEARCH.md §"Validation Architecture"` per workflow step 5.5.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest@^4.1.0` (carry-forward from v1.0) |
| **Config file** | None — relies on vitest defaults (matches v1.0 convention). Per-package `vitest.config.ts` deferred unless coverage tuning needs it. |
| **Quick run command (core)** | `npm test` (root) |
| **Full suite command (core)** | `npm test && npm run test:coverage` |
| **Quick run command (adapter)** | `cd packages/mcpack-embeddings && npm test` |
| **Full suite command (adapter)** | `cd packages/mcpack-embeddings && npm test && npm run test:coverage` |
| **Combined gate** | `npm test && cd packages/mcpack-embeddings && npm test && cd ../..` (or wrapped as a root `test:all` script) |
| **Estimated runtime** | ~5–8 seconds for core (current v1.0 baseline); ~3–5 seconds for adapter (model tests gated off by default) |

---

## Sampling Rate

- **After every task commit:** Run `npm run typecheck && npm test` (root). Adds ~3–5s feedback latency.
- **After every plan wave:** Run `npm run typecheck && npm test && npm run test:coverage && cd packages/mcpack-embeddings && npm run typecheck && npm test`.
- **Before `/gsd-verify-work`:** Full suite + the three [BLOCKING] gates (zero-deps, API-lock, adapter-isolation). Adapter integration tests with `RUN_MODEL_TESTS=1` (one-time model download).
- **Max feedback latency:** 8 seconds (per-task commit gate).

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 06-01 | 1 | REQ-v11-semantic-provider-interface | — | EmbeddingProvider type batch contract (input N strings → output N vectors of consistent dim) | type-contract + unit | `npm test -- types.test.ts` | ❌ Wave 0 — `test/types.test.ts` | ⬜ pending |
| 06-01-01 | 06-01 | 1 | REQ-v11-embeddings-optional-config | — | MCPackConfig.embeddings absent ⇒ search code byte-identical to v1.0 | type-contract + regression | `npm run typecheck && npm test` | ✅ existing v1.0 tests + new `types.test.ts` | ⬜ pending |
| 06-01-01 | 06-01 | 1 | REQ-v11-public-api-lock | — | mcpack/createMCPackServer signatures byte-identical; only additive new symbols | declaration-file diff | `tsc --emitDeclarationOnly && diff dist/index.d.ts <(git show 22d7d98:dist/index.d.ts)` shows added-only changes | ✅ scriptable; baseline ref `22d7d98` | ⬜ pending |
| 06-01-01 | 06-01 | 1 | REQ-v11-zero-core-deps | — | Root package.json dependencies and peerDependencies unchanged from v1.0 | static check (jq diff) | `diff <(jq -S '{deps:.dependencies, peers:.peerDependencies}' package.json) <(git show 22d7d98:package.json | jq -S '{deps:.dependencies, peers:.peerDependencies}')` returns empty | ✅ scriptable | ⬜ pending |
| 06-01-01 | 06-01 | 1 | REQ-v11-zero-core-deps | — | src/ does NOT import @llvs/mcpack-embeddings or @huggingface/transformers | static check (grep) | `! grep -rE "@llvs/mcpack-embeddings\|@huggingface/transformers\|@xenova/transformers" src/ test/` returns no matches | ✅ scriptable | ⬜ pending |
| 06-01-02 | 06-01 | 1 | REQ-v11-esm-only | — | Core builds with NodeNext + verbatimModuleSyntax, no .cjs output | build | `npm run build && (! ls dist/*.cjs 2>/dev/null)` | ✅ existing tsconfig.json | ⬜ pending |
| 06-01-02 | 06-01 | 1 | REQ-v11-public-api-lock | — | Existing v1.0 callers compile unmodified | regression | `npm run build && npm test` | ✅ existing tests | ⬜ pending |
| 06-02-01 | 06-02 | 2 | REQ-v11-mcpack-embeddings-package | — | Adapter package.json declares peer-dep `@llvs/mcpack ^1.1.0` and dep `@huggingface/transformers ^4.0.0` | static check (jq) | `jq -e '.peerDependencies."@llvs/mcpack"=="^1.1.0" and .dependencies."@huggingface/transformers"=="^4.0.0"' packages/mcpack-embeddings/package.json` | ❌ Wave 0 — entire package | ⬜ pending |
| 06-02-01 | 06-02 | 2 | REQ-v11-esm-only | — | Adapter package.json has `"type": "module"`; tsconfig has NodeNext + verbatimModuleSyntax | static check | `jq -e '.type=="module"' packages/mcpack-embeddings/package.json && grep -q '"module": "NodeNext"' packages/mcpack-embeddings/tsconfig.json && grep -q '"verbatimModuleSyntax": true' packages/mcpack-embeddings/tsconfig.json` | ❌ Wave 0 | ⬜ pending |
| 06-02-02 | 06-02 | 2 | REQ-v11-mcpack-embeddings-package | — | `createMiniLMProvider()` returns a function conforming to `EmbeddingProvider` (typecheck) | type-contract | `cd packages/mcpack-embeddings && npm install && npm run typecheck` exits 0 | ❌ Wave 0 | ⬜ pending |
| 06-02-02 | 06-02 | 2 | REQ-v11-mcpack-embeddings-package | — | MiniLM adapter produces 384-dim vectors for known input (gated) | integration (gated) | `RUN_MODEL_TESTS=1 cd packages/mcpack-embeddings && npm test` exits 0 | ❌ Wave 0 — `packages/mcpack-embeddings/test/minilm.test.ts` | ⬜ pending |
| 06-02-02 | 06-02 | 2 | REQ-v11-zero-core-deps | — | Adapter-isolation grep still empty after adapter is built (no leak-back into core) | static check | `! grep -rE "@llvs/mcpack-embeddings\|@huggingface/transformers" src/ test/` returns no matches | ✅ scriptable | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Note on wave assignment:** This map shows 06-02 in Wave 2 per the plan-checker's BLOCKER-3 finding. Plan 06-02 has a hard ordering dependency on 06-01: the adapter's `npm install` and `npm run typecheck` cannot resolve `@llvs/mcpack ^1.1.0` until 06-01's version bump and `EmbeddingProvider` export land in the working tree. The planner revision will update 06-02's frontmatter accordingly.

---

## Wave 0 Requirements

The following files do NOT exist yet and Phase 6 plans must create them in Wave 0:

- [ ] `test/types.test.ts` — type-contract tests for `EmbeddingProvider` and `MCPackConfig.embeddings` via mock provider. Covers REQ-v11-semantic-provider-interface, REQ-v11-embeddings-optional-config.
- [ ] `packages/mcpack-embeddings/` — entire package directory.
- [ ] `packages/mcpack-embeddings/package.json` — declares peer-dep `@llvs/mcpack ^1.1.0`, dep `@huggingface/transformers ^4.0.0`, `"type": "module"`. Covers REQ-v11-mcpack-embeddings-package.
- [ ] `packages/mcpack-embeddings/tsconfig.json` — NodeNext + strict + verbatimModuleSyntax (mirrors root tsconfig). Covers REQ-v11-esm-only.
- [ ] `packages/mcpack-embeddings/src/index.ts` — exports `createMiniLMProvider`. Covers REQ-v11-mcpack-embeddings-package.
- [ ] `packages/mcpack-embeddings/src/minilm.ts` — implements MiniLM adapter wrapping `pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')`. Covers REQ-v11-mcpack-embeddings-package.
- [ ] `packages/mcpack-embeddings/test/minilm.test.ts` — vitest tests for the factory + (gated) integration test for actual model output. Covers REQ-v11-mcpack-embeddings-package.
- [ ] (Optional) Root `npm run test:all` script wrapping both packages — covers test ergonomics.
- [ ] (Optional) Helper script `scripts/verify-zero-deps.sh` running the dep-isolation greps + jq diff for the phase verifier.

**Framework install:** none — vitest is already in v1.0 root devDependencies. Adapter inherits its own copy via its own `package.json` devDependencies entry.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Adapter README documents the ~25 MB model download on first run + the `RUN_MODEL_TESTS` env-var gating convention | REQ-v11-mcpack-embeddings-package | README is consumed by humans, not test runners | Read `packages/mcpack-embeddings/README.md` and confirm both topics are present and the example code uses `createMiniLMProvider` correctly. (Stub README in Phase 6; full content in Phase 10 docs phase.) |

All other phase behaviors have automated verification per the Per-Task Verification Map above.

---

## Three [BLOCKING] Phase Gates (must pass before `/gsd-verify-work`)

These three gates enforce board-locked invariants. Phase 6 verification fails if any returns non-zero.

### Gate 1 — Zero new core deps
```bash
diff <(jq -S '{deps:(.dependencies // {}), peers:.peerDependencies}' package.json) \
     <(git show 22d7d98:package.json | jq -S '{deps:(.dependencies // {}), peers:.peerDependencies}')
```
Must produce empty diff (zero additions to root `@llvs/mcpack` `dependencies` or `peerDependencies`).
Baseline ref `22d7d98` = pre-Phase-6 cleanest commit.

### Gate 2 — Public-API additive-only
```bash
npm run build  # emits dist/index.d.ts and dist/types.d.ts
diff <(grep -E "^export" dist/index.d.ts | sort) \
     <(git show 22d7d98:dist/index.d.ts | grep -E "^export" | sort) | \
  grep -E "^<" | (! grep -qE "(MCPackConfig|RoleConfig|MCPackHandle|MCPackToolDefinition|SearchResult|ToolCallResult|MCPackServerConfig|MCPackToolHandler|MCPackHandlerContext|IndexConfig|SessionConfig|SearchToolResponse|mcpack |createMCPackServer )")
```
Must show only additive changes (new exported symbols). Zero modifications or removals to existing v1.0 exports.

### Gate 3 — Adapter isolation
```bash
! grep -rE "@llvs/mcpack-embeddings|@huggingface/transformers|@xenova/transformers" src/ test/
```
Must return zero matches.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (per Wave 0 Requirements above)
- [ ] No watch-mode flags
- [ ] Feedback latency < 8 seconds per-task
- [ ] Three [BLOCKING] gates encoded in PLAN.md acceptance criteria
- [ ] `nyquist_compliant: true` set in frontmatter once plans are revised

**Approval:** pending (awaiting Phase 6 plan revision per BLOCKER-3 — wave reassignment)
