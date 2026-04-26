# Phase 6: EmbeddingProvider Interface + Adapter Scaffold (v1.1) — Context

**Gathered:** 2026-04-25
**Status:** Ready for planning
**Source:** Synthesized from PRD ingest (`.planning/intel/`) — board-approved 2026-04-25
**Milestone:** v1.1 — Search & Observability

<domain>
## Phase Boundary

Phase 6 delivers the **type-level + package-level scaffolding** for v1.1 semantic search. Three concrete outputs:

1. **`EmbeddingProvider` type** — exported from `@llvs/mcpack` package entry. Signature locked: `(texts: string[]) => Promise<number[][]>`. Batch-in / parallel-vectors-out.
2. **Optional `embeddings` field on `MCPackConfig`** — the only config-shape change in this phase. When absent, all v1.1 code paths must be byte-identical to v1.0 at the function level.
3. **`@llvs/mcpack-embeddings` sibling package** — scaffolded with a local MiniLM adapter using `@xenova/transformers` as a peer dep. This is a NEW package in the repository; v1.0 was a single-package layout.

What Phase 6 does NOT do:
- No semantic index build (Phase 7)
- No semantic query / hybrid scoring (Phase 8)
- No analytics (Phase 9)
- No publishing to npm (Phase 10)

The phase is intentionally narrow because every later v1.1 phase depends on the type contract and the package boundary that Phase 6 establishes. Get those wrong here and every subsequent phase pays the cost.

</domain>

<decisions>
## Implementation Decisions (LOCKED — from board-approved PRD ingest)

### Type Contract (REQ-v11-semantic-provider-interface)
- **DEC-v11-01:** Public API of v1.0 is byte-for-byte identical going forward. `mcpack(server, config)` and `createMCPackServer(config)` signatures **MUST NOT** change in this phase. Only `MCPackConfig` gains optional fields.
- **EmbeddingProvider signature is locked:** `type EmbeddingProvider = (texts: string[]) => Promise<number[][]>`
  - Batch in (array of strings), parallel array out (array of vectors).
  - No streaming. No per-call options. No metadata return.
  - Order of input → order of output is contractual.
- **Type is exported from `@llvs/mcpack` package entry point** (`src/index.ts`) — agents/operators import it from core, not from the adapter package.
- **Mock provider in tests verifies batch-call contract** (input N strings → output N vectors of consistent dimensionality).

### Optional Config (REQ-v11-embeddings-optional-config)
- New optional field: `MCPackConfig.embeddings?: { provider: EmbeddingProvider; weights?: { semanticWeight: number; keywordWeight: number } }`.
  - Phase 6 wires the field through types only — actual consumption lands in Phase 7 (build) and Phase 8 (query).
  - Default weights are NOT set in Phase 6 (those are Phase 8 hybrid-ranking concern). Phase 6 just makes the field exist on the type.
- **DEC-v11-02 + DEC-BOARD-04:** When `embeddings` is absent, search code path is **byte-identical to v1.0 at the function level**. No new code branches execute. No new dependencies imported. No regression possible by definition.
- **OQ1 still open** — whether `getAnalytics()` lives flat on the handle or under a separate `.analytics` property. Phase 6 does NOT decide this. Picking it up in Phase 9. (Flagged so the planner doesn't accidentally ship a partial type for it here.)

### Adapter Package — `@llvs/mcpack-embeddings` (REQ-v11-mcpack-embeddings-package)
- **DEC-v11-03 + DEC-BOARD-05:** All model dependencies live in `@llvs/mcpack-embeddings`. Core ships zero embedding implementation, zero model deps, zero loaders.
- **Peer dependency:** `@llvs/mcpack ^1.1.0` (the sibling package this adapter plugs into).
- **Runtime dependency:** `@huggingface/transformers ^4.0.0` (board-approved 2026-04-25 — clerical correction from PRD-cited `@xenova/transformers` which has been frozen since May 2024). Confined to this package only.
- **MiniLM** is the v1.1 default model. The de-facto choice is `Xenova/all-MiniLM-L6-v2` (384-dim float32 vectors, ~25 MB). The planner can confirm and lock the exact model identifier.
- **Adapter exports a factory function** that returns an `EmbeddingProvider` (batch-in / vectors-out). Exact name/shape is the planner's call, but it MUST conform to the locked `EmbeddingProvider` type from core.
- **No hosted adapter (OpenAI / Voyage) in v1.1.** OQ6 is decided: hosted adapters defer to v1.2.

### Package Layout — LOCKED: Sibling Directory (DEC-v11-03a)
**Board decision 2026-04-25:** `@llvs/mcpack-embeddings` lives at `packages/mcpack-embeddings/` as a sibling directory. **No monorepo tooling in v1.1** (no npm/pnpm/yarn workspaces).

```
MCPack/
├── src/                            ← @llvs/mcpack source — UNCHANGED from v1.0
├── test/                           ← @llvs/mcpack tests — UNCHANGED from v1.0
├── package.json                    ← @llvs/mcpack — version bumps 1.0.0 → 1.1.0
├── tsconfig.json                   ← unchanged
├── vitest.config.ts                ← unchanged
└── packages/
    └── mcpack-embeddings/          ← NEW sibling
        ├── src/
        ├── test/
        ├── package.json            ← @llvs/mcpack-embeddings @ 1.1.0
        └── tsconfig.json           ← extends or mirrors root strict + NodeNext
```

**Why sibling directory (vs workspaces or separate repo):** Existing v1.0 npm scripts (`npm run build`, `npm test`, `npm run harness`, `npm run test:coverage`) all reference current `src/` and `test/` paths. Workspaces would force every script to be rewritten. Separate repo creates high friction for parallel development. Sibling-directory adds the new package with **zero changes to existing scripts** — the lowest-risk path for a feature milestone.

**Migrate to npm workspaces in v1.2** when `@llvs/mcpack-google` arrives as the third package. That's when the workspace tooling overhead pays for itself.

### Core Version Bump — LOCKED: 1.0.0 → 1.1.0 in Phase 6 (DEC-v11-03b)
**Board decision 2026-04-25:** Phase 6 bumps `@llvs/mcpack`'s `package.json` version from `1.0.0` to `1.1.0`. This satisfies the adapter's `peerDependencies: { "@llvs/mcpack": "^1.1.0" }` declaration so local `npm install` and tests resolve cleanly during phases 6–9.

**The version bump and the actual `npm publish` are SEPARATE OPERATIONS.** Phase 6 does the bump; Phase 10 does the publish. This is the standard "version-in-development" pattern — the repo's HEAD already says `1.1.0` while the work is in flight, and `npm publish` is what makes that real to the registry.

### Zero-Dep Core (REQ-v11-zero-core-deps + DEC-v11-02 + DEC-BOARD-04)
- **`@llvs/mcpack` package.json shows zero new `dependencies` entries vs v1.0.**
- **No `peerDependencies` additions to core** — `@modelcontextprotocol/sdk` remains the only peer dep.
- This is a hard gate. Adding `@xenova/transformers` (or anything else) to core's `package.json` fails the phase outright. The planner must include an acceptance check for this.

### Public API Lock (REQ-v11-public-api-lock + DEC-v11-01 + DEC-v12-10)
- Existing v1.0 calling code MUST compile unmodified against the new types.
- TypeScript signature diff vs v1.0 = zero changes to existing fields. Only additions of optional new fields.
- The plan-checker will verify this with concrete comparisons (read v1.0 type definitions, diff against post-phase types, assert added-only).

### Build Output (REQ-v11-esm-only + DEC-v11-04)
- ESM-only, NodeNext, TypeScript strict, `verbatimModuleSyntax`. Carries forward from v1.0.
- New adapter package follows the same conventions.
- No CommonJS output. No dual-publish. No `.cjs` files.

### Quality Gates Carried From v1.0
From `PLAYBOOK.md` (project-permanent):
- After every code change: `npm run typecheck`, `npm run build`, `npm test` must all pass before commit.
- Coverage must not drop below 99% statement coverage (v1.0 baseline = 99.56% / 100 tests).
- Phase 6 adds new types and a new package — coverage of the new code paths counts toward the v1.1 floor (≥99%, ≥120 tests by end of milestone). Phase 6 doesn't have to hit 120 tests on its own, but the new-code paths must be tested.

### Claude's Discretion
- Exact location of new types in `src/types.ts` (top-of-file vs grouped with related types) — planner picks.
- Adapter package's internal file layout — `src/index.ts` + `src/minilm.ts` is a reasonable starting point but the planner can split further.
- Naming of the adapter factory function — `createMiniLMProvider` / `miniLMEmbeddings` / etc. are all acceptable as long as the return type conforms to `EmbeddingProvider`.
- Whether to add a `.npmignore` or use `package.json` `files:` for the new package — both work.
- Test framework convention — keep using `vitest` to match v1.0; no need to introduce a separate test runner for the adapter package.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents (researcher, planner, executor) MUST read these before working.**

### Synthesizer Intel (board-approved decisions and requirements)
- `.planning/intel/SYNTHESIS.md` — entry point: doc counts, decision counts, milestone routing
- `.planning/intel/decisions.md` — all 33 decisions: DEC-v11-01..15 (this phase scope), DEC-v12-* (NOT this phase), DEC-BOARD-01..05 (cross-milestone locks)
- `.planning/intel/requirements.md` — all 38 requirements with acceptance criteria. The 6 phase-mapped REQ-IDs are listed under "v1.1 Milestone — Search & Observability"
- `.planning/intel/constraints.md` — NFRs, API contracts, schema, protocol constraints
- `.planning/intel/context.md` — narrative context (problem framing, user personas, risk register)
- `.planning/INGEST-CONFLICTS.md` — five INFO entries documenting how PRD-A vs PRD-B conflicts were resolved by board

### Source PRDs (preserved post-ingest)
- `.planning/inbox/processed/mcpack-prd-v1.1-gsd.md` — v1.1 PRD (this milestone). §R1.1, §R1.2, §R1.3, §R3.1, §R3.2, §R3.3 are the sections most relevant to Phase 6
- `.planning/inbox/processed/mcpack-prd-v1.1-final.md` — v1.2 PRD (deferred), Partner Hub. NOT in this phase's scope but useful for confirming what is NOT shipping in Phase 6

### Existing v1.0 Code (planner + executor MUST inspect before adding types)
- `src/index.ts` — package entry point. New `EmbeddingProvider` export goes here.
- `src/types.ts` — existing public types. New `EmbeddingProvider` type and `MCPackConfig.embeddings` optional field land here.
- `src/core.ts` — `MCPackEngine`. Phase 6 does NOT change behavior, but the type plumbing must compile against existing engine usage.
- `src/wrap.ts`, `src/build.ts` — entry points whose signatures (`mcpack`, `createMCPackServer`) are LOCKED.
- `package.json` — current v1.0 dependency declarations. Phase 6 must NOT add to `dependencies` or `peerDependencies`.
- `tsconfig.json` — strict mode + verbatimModuleSyntax + NodeNext settings. New adapter package follows the same.

### Project Standards (read before writing code)
- `CLAUDE.md` (project root) — stack, architecture, key patterns, env var rules. Specifically the "Architecture" and "Key Patterns" sections.
- `PLAYBOOK.md` (project root) — Development Protocol section (read before any change), Quality Gates, Rollback Protocol.
- `spec/mcpack-spec-v1.md` — protocol + architecture reference.

### Test Patterns (planner must mirror)
- `test/index-builder.test.ts`, `test/search.test.ts`, `test/session.test.ts`, `test/roles.test.ts`, `test/wrap.test.ts`, `test/build.test.ts` — v1.0 test patterns. Mock-based, vitest, one test file per src module. New tests for `EmbeddingProvider` follow the same convention.

</canonical_refs>

<specifics>
## Specific Ideas (planner-relevant concrete items)

### Type sketch (locked from PRD)
```typescript
// In @llvs/mcpack/src/types.ts
export type EmbeddingProvider = (texts: string[]) => Promise<number[][]>

export interface MCPackConfig {
  // ... existing v1.0 fields unchanged ...
  embeddings?: {
    provider: EmbeddingProvider
    weights?: {
      semanticWeight: number   // default 0.7 (consumed in Phase 8)
      keywordWeight: number    // default 0.3 (consumed in Phase 8)
    }
  }
  // analytics?: ... (Phase 9, NOT here)
}
```

### Adapter package skeleton (planner picks exact layout)
```
packages/mcpack-embeddings/  (or sibling-dir / separate-repo per package-layout decision)
├── package.json             # name: @llvs/mcpack-embeddings, version: 1.1.0
│                            # peerDeps: @llvs/mcpack ^1.1.0
│                            # deps: @xenova/transformers ^X
├── tsconfig.json            # extends or mirrors v1.0 strict + NodeNext
├── src/
│   ├── index.ts             # exports the factory
│   └── minilm.ts            # MiniLM-specific loading + batch encoding
└── test/
    └── minilm.test.ts       # vitest: known-input → consistent vectors
```

### Acceptance bar (from PRD §"Success Criteria" for Phase 6)
1. `EmbeddingProvider = (texts: string[]) => Promise<number[][]>` exported from `@llvs/mcpack` entry. Mock provider in test verifies batch contract.
2. `MCPackConfig` accepts an optional `embeddings` field. With no `embeddings` configured, search code path is byte-identical to v1.0.
3. `@llvs/mcpack-embeddings` package scaffolded with MiniLM adapter using `@xenova/transformers` as optional peer dep — never required by core.
4. `@llvs/mcpack` package.json shows zero new `dependencies` entries vs v1.0.
5. Existing v1.0 calling code compiles unmodified against new types.

### Verification commands the plan-checker / verifier will run
```bash
npm run typecheck                       # must pass; no new errors
npm run build                           # tsc emits dist/
npm test                                # 100/100 v1.0 tests still pass + new adapter tests
npm run test:coverage                   # ≥ 99% statement coverage
diff <(jq -S '.dependencies' package.json) <(git show HEAD~N:package.json | jq -S '.dependencies')
                                        # zero core dep additions
```

</specifics>

<deferred>
## Deferred Ideas

These are explicitly OUT of Phase 6 scope. Recorded so they don't accidentally land here.

### Punted to later v1.1 phases
- Async semantic-index build pipeline → **Phase 7**
- Hybrid score combination, cosine similarity, role-filter-after-rank → **Phase 8**
- AnalyticsStore + `getAnalytics()` API + dead-tool detection → **Phase 9**
- 50-query intent benchmark, harness regression check, npm publish → **Phase 10**

### Punted to v1.2 (Partner Hub)
- Multi-source composition, `resolveRole(session)`, Google OAuth, HTTP/SSE transport, `@llvs/mcpack-google` adapter package, deterministic inverted-index search engine

### Open questions deferred to later v1.1 phases
- **OQ1** (Phase 9): `getAnalytics()` flat on handle vs separate `.analytics` property
- **OQ2** (Phase 8): Hybrid weights config-only vs per-query overrideable
- **OQ3** (v1.2): Index rebuild on `notifications/tools/list_changed`
- **OQ4** (Phase 10): 50-query benchmark source — Stripe-derived, synthetic, or community
- **OQ5** (Phase 9): Whether denial events record restricted tool names for operator-scope queries

### Punted explicitly to v2.0
- Binary encoding / MessagePack
- Persistent session storage (cross-restart sessions)
- Standalone proxy server process
- Analytics persistence across process restarts

</deferred>

---

*Phase: 06-embeddingprovider-interface-adapter-scaffold-v1-1*
*Context gathered: 2026-04-25 (composed from `.planning/intel/` synthesizer output — board-approved PRD ingest)*
