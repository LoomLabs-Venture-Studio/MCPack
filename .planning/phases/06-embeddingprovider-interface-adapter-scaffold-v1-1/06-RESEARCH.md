# Phase 6: EmbeddingProvider Interface + Adapter Scaffold (v1.1) — Research

**Researched:** 2026-04-26
**Domain:** TypeScript ESM library type plumbing + sibling adapter package + sentence-embedding model integration
**Confidence:** HIGH (type plumbing, package layout, code patterns); MEDIUM with one flagged discussion point (`@xenova/transformers` dep choice — see Discussion Points below)

## Summary

Phase 6 is the smallest possible v1.1 phase by construction: it ships three artifacts (one type, one optional config field, one new package skeleton) and zero behavior changes to v1.0 code paths. The hard part is not the code — it is keeping the v1.0 byte-identical-when-unconfigured invariant intact while introducing a sibling package, and choosing a package layout that does not break any of the v1.0 npm scripts the harness and CI depend on.

Three landmines surfaced during research:

1. **`@xenova/transformers` was renamed to `@huggingface/transformers` in October 2024.** The legacy npm name (v2.17.2, last published May 2024) is the one the PRD/CONTEXT cite, but it is two major versions and ~2 years behind. The current package is `@huggingface/transformers@4.2.0` (April 2026). [VERIFIED: npm registry] This is a board-level discussion point that the planner must surface — it does not block Phase 6, but pinning the wrong dep here forces a rip-and-replace in Phase 7.
2. **`@huggingface/transformers` carries a hard `sharp` dependency** (image processing library with native binaries). [VERIFIED: npm view] For text-only feature extraction this is dead weight, but it is a hard install dep, not optional. Adapter-package consumers will pull it in. Acceptable but should be documented.
3. **The "byte-identical search code path when no embeddings configured" invariant** (DEC-v11-02 / DEC-BOARD-04) is much easier to preserve at the type level if the new field is added as a single additive property on the existing `MCPackConfig` interface (vs a discriminated union). The existing v1.0 type structure supports this with one extra optional property.

**Primary recommendation:** Use **Option C — sibling directory in same repo, no monorepo tooling** for the package layout. It is the only option that preserves every v1.0 npm script verbatim (`npm run build`, `npm test`, `npm run harness`, `npm run test:coverage`) without churning paths. Convert to npm workspaces later if/when a third package (`@llvs/mcpack-google` in v1.2) makes the convenience worth the migration. For the dep, surface the `@xenova/transformers` vs `@huggingface/transformers` choice to the board before plan execution and document the recommendation: pin `@huggingface/transformers ^4.0.0` and treat the PRD's `@xenova/transformers` reference as historical naming.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `EmbeddingProvider` type definition | `@llvs/mcpack` core (`src/types.ts`) | — | Locked by DEC-v11-01: type lives in core entry, agents import from core |
| Optional `embeddings` field on `MCPackConfig` | `@llvs/mcpack` core (`src/types.ts`) | — | Same rationale; type-only wiring |
| MiniLM model loading + tokenization + ONNX inference | `@llvs/mcpack-embeddings` adapter package | — | DEC-v11-03 / DEC-BOARD-05: model deps live ONLY in sibling |
| Adapter factory that returns `EmbeddingProvider` | `@llvs/mcpack-embeddings` (`src/index.ts` + `src/minilm.ts`) | — | Adapter is the single integration point |
| Engine consumption of `embeddings` | NONE in Phase 6 | core (Phase 7+) | Phase 6 is type-only; consumption is Phases 7–8 |
| Test coverage for type contract | `test/types.test.ts` (new) or extend `test/core.test.ts` | adapter package's own `test/` | Mock provider in core tests verifies batch contract; adapter has its own tests |

**Why this matters for the planner:** The Phase 6 work is split across two packages and two test directories. Misassigning a task — e.g., placing a MiniLM-specific helper in `src/` instead of the adapter package — silently violates DEC-v11-02 (zero new core deps) because the type system would force the import. Every Phase 6 task must declare its tier explicitly.

## User Constraints (from CONTEXT.md)

### Locked Decisions

From `.planning/phases/06-embeddingprovider-interface-adapter-scaffold-v1-1/06-CONTEXT.md`:

**Type Contract (REQ-v11-semantic-provider-interface)**
- DEC-v11-01: Public API of v1.0 is byte-for-byte identical going forward. `mcpack(server, config)` and `createMCPackServer(config)` signatures MUST NOT change in this phase. Only `MCPackConfig` gains optional fields.
- EmbeddingProvider signature is locked: `type EmbeddingProvider = (texts: string[]) => Promise<number[][]>`
  - Batch in (array of strings), parallel array out (array of vectors).
  - No streaming. No per-call options. No metadata return.
  - Order of input → order of output is contractual.
- Type is exported from `@llvs/mcpack` package entry point (`src/index.ts`) — agents/operators import it from core, not from the adapter package.
- Mock provider in tests verifies batch-call contract (input N strings → output N vectors of consistent dimensionality).

**Optional Config (REQ-v11-embeddings-optional-config)**
- New optional field: `MCPackConfig.embeddings?: { provider: EmbeddingProvider; weights?: { semanticWeight: number; keywordWeight: number } }`.
  - Phase 6 wires the field through types only — actual consumption lands in Phase 7 (build) and Phase 8 (query).
  - Default weights are NOT set in Phase 6 (those are Phase 8 hybrid-ranking concern). Phase 6 just makes the field exist on the type.
- DEC-v11-02 + DEC-BOARD-04: When `embeddings` is absent, search code path is byte-identical to v1.0 at the function level. No new code branches execute. No new dependencies imported. No regression possible by definition.
- OQ1 still open — whether `getAnalytics()` lives flat on the handle or under a separate `.analytics` property. Phase 6 does NOT decide this. Picking it up in Phase 9.

**Adapter Package — `@llvs/mcpack-embeddings` (REQ-v11-mcpack-embeddings-package)**
- DEC-v11-03 + DEC-BOARD-05: All model dependencies live in `@llvs/mcpack-embeddings`. Core ships zero embedding implementation, zero model deps, zero loaders.
- Peer dependency: `@llvs/mcpack ^1.1.0`.
- Runtime dependency: `@xenova/transformers` (board pre-approved 2026-04-25). Confined to this package only.
- MiniLM is the v1.1 default model. 384-dim float32 vectors. ~50MB model size — to be documented in the adapter README.
- Adapter exports a factory function that returns an `EmbeddingProvider` (batch-in / vectors-out). Exact name/shape is the planner's call, but it MUST conform to the locked `EmbeddingProvider` type from core.
- No hosted adapter (OpenAI / Voyage) in v1.1. OQ6 is decided: hosted adapters defer to v1.2.

**Zero-Dep Core (REQ-v11-zero-core-deps + DEC-v11-02 + DEC-BOARD-04)**
- `@llvs/mcpack` package.json shows zero new `dependencies` entries vs v1.0.
- No `peerDependencies` additions to core — `@modelcontextprotocol/sdk` remains the only peer dep.
- Hard gate. Adding `@xenova/transformers` (or anything else) to core's `package.json` fails the phase outright.

**Public API Lock (REQ-v11-public-api-lock + DEC-v11-01 + DEC-v12-10)**
- Existing v1.0 calling code MUST compile unmodified against the new types.
- TypeScript signature diff vs v1.0 = zero changes to existing fields. Only additions of optional new fields.
- Plan-checker will verify with concrete comparisons.

**Build Output (REQ-v11-esm-only + DEC-v11-04)**
- ESM-only, NodeNext, TypeScript strict, `verbatimModuleSyntax`. Carries forward from v1.0.
- New adapter package follows the same conventions.
- No CommonJS output. No dual-publish. No `.cjs` files.

**Quality Gates Carried From v1.0** (from `PLAYBOOK.md`)
- After every code change: `npm run typecheck`, `npm run build`, `npm test` must all pass before commit.
- Coverage must not drop below 99% statement coverage (v1.0 baseline = 99.56% / 100 tests).
- Phase 6 doesn't have to hit 120 tests on its own, but the new-code paths must be tested.

### Claude's Discretion
- Exact location of new types in `src/types.ts` (top-of-file vs grouped with related types).
- Adapter package's internal file layout (`src/index.ts` + `src/minilm.ts` is reasonable starting point but planner can split further).
- Naming of the adapter factory function (`createMiniLMProvider` / `miniLMEmbeddings` / etc.).
- Whether to add a `.npmignore` or use `package.json` `files:` for the new package.
- Test framework convention — keep using `vitest` to match v1.0.

### Deferred Ideas (OUT OF SCOPE)
- Semantic index build → Phase 7
- Semantic query / hybrid scoring → Phase 8
- Analytics → Phase 9
- npm publishing → Phase 10
- Multi-source / OAuth / HTTP-SSE → v1.2
- Hosted adapters (OpenAI/Voyage) → v1.2
- Default embedding model inside `@llvs/mcpack` core → never (DEC-BOARD-05)
- CommonJS output → never (DEC-v11-04)

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-v11-semantic-provider-interface | Define `EmbeddingProvider = (texts: string[]) => Promise<number[][]>`. Type exported from `@llvs/mcpack` entry; mock provider in tests verifies batch-call contract. | Type-Only Plumbing section + Code Examples §"Locked EmbeddingProvider type" + Test Patterns §"Mock provider for type-contract validation" |
| REQ-v11-embeddings-optional-config | Optional `embeddings` field on `MCPackConfig`. With no `embeddings`, v1.0 search code path is byte-identical. | Architecture Patterns §"Pattern 1: Single additive optional property" + Code Examples §"MCPackConfig extension" |
| REQ-v11-mcpack-embeddings-package | Sibling adapter package `@llvs/mcpack-embeddings` with `@xenova/transformers` (or `@huggingface/transformers` — see Discussion Points) and a local MiniLM adapter. | Standard Stack §`@huggingface/transformers` + Architecture Patterns §"Sibling-directory layout" + Code Examples §"MiniLM adapter factory" |
| REQ-v11-zero-core-deps | `@llvs/mcpack` package.json shows zero new `dependencies` entries vs v1.0. Peer dep stays only `@modelcontextprotocol/sdk`. | Validation Architecture §"Dep-isolation validation" + Common Pitfalls §"Pitfall 1: Accidental core import of adapter" |
| REQ-v11-public-api-lock | `mcpack(server, config)` and `createMCPackServer(config)` signatures byte-identical to v1.0. | Code Examples §"v1.0 signature reference" + Validation Architecture §"Type-contract validation" |
| REQ-v11-esm-only | ESM-only, NodeNext, strict, verbatimModuleSyntax. New adapter package follows same conventions. | Standard Stack §"TypeScript config carry-forward" + Code Examples §"Adapter `tsconfig.json` template" |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | `~5.8.3` (matches v1.0) | Strict types, NodeNext, verbatimModuleSyntax | Carried forward from v1.0 — same toolchain across both packages [VERIFIED: package.json] |
| `@modelcontextprotocol/sdk` | `^1.0.0` peer (only for core) | MCP types/Server/transport | Already the sole peer dep of `@llvs/mcpack`; adapter does NOT depend on it [VERIFIED: package.json] |
| Vitest | `^4.1.0` (matches v1.0) | Test runner, coverage | Already used by v1.0; reuse for both packages — avoids second runner [VERIFIED: package.json] |
| `@vitest/coverage-v8` | `^4.1.0` | v8 statement coverage | Carried forward; same reporter for the 99% gate [VERIFIED: package.json] |

### Supporting (adapter package only)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@huggingface/transformers` | `^4.0.0` (board-locked 2026-04-25) | ONNX-runtime sentence embedding via `pipeline('feature-extraction', ...)` | Use in `@llvs/mcpack-embeddings` only. `^4.0.0` matches the latest stable; v3 line is frozen. Board approved this pin per DEC-v11-03 clerical-correction. [VERIFIED: npm view @huggingface/transformers, dist-tags latest=4.2.0] |
| `Xenova/all-MiniLM-L6-v2` | model on Hugging Face Hub | 384-dim sentence embeddings | The default v1.1 model; ~90MB ONNX model file (CONTEXT says "~50MB" — actual non-quantized is 90.4MB, quantized is smaller; document accurately) [VERIFIED: HF model page, see Sources] |
| `vitest` (peer in adapter) | `^4.1.0` | Tests inside adapter package | Same runner for both packages |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@huggingface/transformers` (current) | `@xenova/transformers@2.17.2` (legacy) | Legacy name was renamed Oct 2024. Last publish: May 2024. PRD/CONTEXT cite the legacy name. Pinning legacy = locked into a frozen 2-year-old library and inconsistent with v3+ docs. Pinning current name = rejecting a board-pre-approved dep name verbatim. **This is a board discussion point, not a unilateral decision.** [CITED: HF blog announcement Oct 2024 + GitHub issue #1484] |
| local MiniLM | hosted OpenAI/Voyage adapter | OUT OF SCOPE for v1.1 (OQ6 decided — defer to v1.2). Don't research. |
| sentence-transformers/all-MiniLM-L6-v2 (original PyTorch) | `Xenova/all-MiniLM-L6-v2` (ONNX port) | Original is PyTorch — won't run in transformers.js. ONNX-converted Xenova mirror is the correct choice for transformers.js. [CITED: HF model card] |
| Manual ONNX runtime integration (`onnxruntime-node` directly) | `@huggingface/transformers` pipeline API | Direct ONNX would skip tokenization, mean-pooling, normalization — adapter would have to reimplement all of those. Pipeline API gives them via one call (`{ pooling: 'mean', normalize: true }`). Manual integration is a Phase 7+ optimization at best. |
| npm workspaces / pnpm / Turborepo | sibling directory in same repo | See Architecture Patterns §"Package Layout decision" — sibling-directory has lowest blast radius for v1.1; workspaces appropriate when 3rd package arrives in v1.2. |

**Installation (adapter package only):**
```bash
# In packages/mcpack-embeddings/ (or sibling dir per package layout)
npm install --save @huggingface/transformers
# Note: pulls onnxruntime-node, sharp, @huggingface/jinja, @huggingface/tokenizers transitively
# Confirmed deps of @huggingface/transformers@4.2.0: onnxruntime-node 1.24.3, onnxruntime-web 1.26.0-dev, sharp ^0.34.5, @huggingface/jinja ^0.5.6, @huggingface/tokenizers ^0.1.3 [VERIFIED: npm view]
```

**Version verification commands (the planner must run these in Wave 0):**
```bash
npm view @huggingface/transformers version       # latest stable
npm view @huggingface/transformers dist-tags     # confirm latest vs next
npm view @xenova/transformers version            # confirm legacy name still resolves
npm view onnxruntime-node version                # transitive — for documentation
```

Verified at research time (2026-04-26):
- `@huggingface/transformers@4.2.0` (published 2026-04-22) — current stable, dist-tag `latest`
- `@xenova/transformers@2.17.2` (published 2024-05-29) — legacy name, NOT updated since rename
- `onnxruntime-node@1.24.3` — pulled transitively, supports darwin/linux/win32 [VERIFIED: npm view os field]

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ User code (agent / operator)                                                │
│                                                                             │
│   import { mcpack, createMCPackServer, type EmbeddingProvider }             │
│     from '@llvs/mcpack'                                                     │
│   import { createMiniLMProvider }                                           │
│     from '@llvs/mcpack-embeddings'                                          │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ wires provider into config
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ @llvs/mcpack (core, zero deps)                                              │
│                                                                             │
│   src/index.ts ── exports: mcpack, createMCPackServer,                      │
│                            EmbeddingProvider (TYPE), MCPackConfig, ...      │
│   src/types.ts ── adds:    type EmbeddingProvider                           │
│                            MCPackConfig.embeddings?: { provider, weights? } │
│   src/wrap.ts  ── unchanged from v1.0 (signature locked)                    │
│   src/build.ts ── unchanged from v1.0 (signature locked)                    │
│   src/core.ts  ── unchanged from v1.0 (Phase 7 will consume the field)      │
│                                                                             │
│   package.json ── DELTA: zero new deps, zero new peerDeps                   │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ peer dep: @llvs/mcpack ^1.1.0
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ @llvs/mcpack-embeddings (sibling package, NEW in v1.1)                      │
│                                                                             │
│   src/index.ts  ── exports: createMiniLMProvider (factory)                  │
│   src/minilm.ts ── pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')│
│                    + singleton pipeline cache                               │
│                    + batch wrapper conforming to EmbeddingProvider          │
│                    + mean-pool + L2-normalize via { pooling, normalize }    │
│                                                                             │
│   peerDependencies: { "@llvs/mcpack": "^1.1.0" }                            │
│   dependencies:     { "@huggingface/transformers": "^4.0.0" }               │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ runtime
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ @huggingface/transformers (transitively pulls)                              │
│   onnxruntime-node ── native ONNX inference on Node                         │
│   sharp ── transitive (image lib; unused for text-only but unavoidable)     │
│   @huggingface/jinja, @huggingface/tokenizers ── tokenization               │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key flow:** Phase 6 wires the type-and-package boundary only. No data flows through this stack at runtime in Phase 6 — `MCPackConfig.embeddings` is accepted but never read by `MCPackEngine` until Phase 7.

### Recommended Project Structure (Option C — sibling directory)

```
MCPack/                          # repo root (unchanged path layout)
├── src/                         # @llvs/mcpack core (UNCHANGED location)
│   ├── index.ts                 # ADD: export EmbeddingProvider type
│   ├── types.ts                 # ADD: EmbeddingProvider, MCPackConfig.embeddings
│   ├── core.ts, wrap.ts, build.ts, ... (unchanged)
├── test/                        # core tests (UNCHANGED location)
│   ├── *.test.ts (all v1.0 tests pass unmodified)
│   └── types.test.ts            # NEW: type-contract tests via mock provider
├── package.json                 # @llvs/mcpack (UNCHANGED scripts, UNCHANGED deps)
├── tsconfig.json                # UNCHANGED
│
├── packages/                    # NEW directory (only the embeddings package lives here for now)
│   └── mcpack-embeddings/
│       ├── package.json         # name: @llvs/mcpack-embeddings, version 1.1.0
│       ├── tsconfig.json        # mirrors root (NodeNext, strict, verbatimModuleSyntax)
│       ├── src/
│       │   ├── index.ts         # exports createMiniLMProvider
│       │   └── minilm.ts        # pipeline singleton + batch wrapper
│       └── test/
│           └── minilm.test.ts   # vitest: factory contract + smoke
│
└── (everything else unchanged)
```

**Why the `packages/` parent directory:** It signals the layout to humans and to a future `npm workspaces` migration. Even without enabling workspaces in Phase 6, the directory name is the standard convention. When Phase 11 (v1.2) adds `@llvs/mcpack-google` as a third package, flipping to npm workspaces is a single `package.json` edit (`"workspaces": ["packages/*"]`) plus a path rewrite for the core package — at that point, the convenience overhead is justified.

### Pattern 1: Single Additive Optional Property (preserves byte-identical behavior)

**What:** Add `embeddings?` as a single optional field on the existing `MCPackConfig` interface — NOT a discriminated union, NOT a new exported type that wraps the old one.

**When to use:** When the requirement says "with X absent, behavior is byte-identical to v1.0". Optional properties on TS interfaces are erased at runtime — there is no compiled-in branch.

**Example:**
```typescript
// src/types.ts — DIFF from v1.0

// NEW: Locked signature per DEC-v11-01
export type EmbeddingProvider = (texts: string[]) => Promise<number[][]>;

// EXTENDED: only one new optional field added
export interface MCPackConfig {
  roles?: RoleConfig;
  defaultRole?: string;
  index?: IndexConfig;
  session?: SessionConfig;
  // NEW v1.1 (Phase 6 wires the type only; Phases 7-8 consume it):
  embeddings?: {
    provider: EmbeddingProvider;
    weights?: {
      semanticWeight: number;
      keywordWeight: number;
    };
  };
}
```

**Why this works:** `MCPackConfig` already has four optional properties (`roles`, `defaultRole`, `index`, `session`). Adding a fifth optional property is structurally identical to the v1.0 pattern. The `core.ts` engine reads `config.session`, `config.roles`, etc. via property access — adding a new property that nothing reads has zero runtime effect. [VERIFIED: read of `src/core.ts` lines 30-58]

### Pattern 2: Adapter Factory Returns the Locked Type

**What:** Adapter package exports a single async factory that returns a value typed exactly as `EmbeddingProvider`. The factory absorbs all the model-loading complexity; the returned function is pure batch-in / vectors-out.

**When to use:** Whenever a sibling package needs to plug into a core type contract. Keeps the adapter swappable — any future adapter (OpenAI in v1.2, Voyage, custom) follows the same factory shape.

**Example:**
```typescript
// packages/mcpack-embeddings/src/minilm.ts
import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import type { EmbeddingProvider } from '@llvs/mcpack';

interface MiniLMOptions {
  model?: string;        // default: 'Xenova/all-MiniLM-L6-v2'
  cacheDir?: string;     // proxied to env.cacheDir
}

export async function createMiniLMProvider(
  opts: MiniLMOptions = {},
): Promise<EmbeddingProvider> {
  const modelName = opts.model ?? 'Xenova/all-MiniLM-L6-v2';
  // Singleton: load the pipeline once, reuse across calls
  let extractor: FeatureExtractionPipeline | undefined;
  const ensure = async () => {
    if (!extractor) {
      // Optional: env.cacheDir = opts.cacheDir
      extractor = await pipeline('feature-extraction', modelName);
    }
    return extractor;
  };

  // Conform to EmbeddingProvider exactly
  const provider: EmbeddingProvider = async (texts: string[]) => {
    const ext = await ensure();
    const tensor = await ext(texts, { pooling: 'mean', normalize: true });
    // tensor.dims = [N, 384] for MiniLM-L6-v2; convert to number[][]
    return tensor.tolist() as number[][];
  };

  return provider;
}
```

[CITED: https://huggingface.co/docs/transformers.js/tutorials/node — singleton pattern]
[CITED: https://huggingface.co/Xenova/all-MiniLM-L6-v2 — pipeline + pooling/normalize options]

### Pattern 3: Sibling Package `tsconfig.json` That Mirrors Root

**What:** The adapter package's tsconfig extends nothing — it copies the root's compiler options verbatim. Avoids cross-package config dependency.

**Why:** With no workspace tool, there is no clean way to do `extends: "../../tsconfig.json"` if the package will eventually be published independently. Copy is easier to reason about and version-control.

**Example:**
```json
// packages/mcpack-embeddings/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": false,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "test"]
}
```

[VERIFIED: matches root /Users/zaid/Projects/MCPack/tsconfig.json byte-for-byte]

### Anti-Patterns to Avoid
- **Discriminated union for `embeddings` config.** Tempting because "v1.0 vs v1.1 mode" feels like a tagged variant — but a plain optional field is structurally identical to the existing four optional fields and lets `MCPackEngine` read `config.embeddings` via the same property-access pattern as `config.session`, `config.roles`. Discriminated unions force consumers to narrow before access — breaks byte-identical-when-absent.
- **Re-exporting `EmbeddingProvider` from `@llvs/mcpack-embeddings`.** Tempting for ergonomics ("import everything from one place"). But CONTEXT locks the type at the core entry — agents must import from `@llvs/mcpack`. Re-exporting from the adapter creates two import sites for the same type and confuses type-identity in TS.
- **Putting `@xenova/transformers` (or `@huggingface/transformers`) in core's `package.json` `peerDependencies` "to be safe."** Hard fail. Core has zero new deps and zero new peer deps — period. Both go in the adapter only.
- **`extends` chain for the adapter `tsconfig.json` pointing at the root config.** Works locally but breaks when the adapter is published independently — published packages don't ship their parent's tsconfig.
- **Symlink the adapter's `node_modules/@llvs/mcpack` to the root `src/`.** Tempting for local dev iteration. Breaks the type identity check the verifier runs (verifier compares the published `dist/` types). Use `npm link` or workspace install instead, AFTER deciding on layout.
- **Adding model files (the actual `.onnx` blob) into the published adapter package.** Bypasses the `@huggingface/transformers` cache mechanism. Model is downloaded on first use to `node_modules/@huggingface/transformers/.cache/` (or `env.cacheDir`) — let it. Adapter ships code only.

### Package Layout Decision (planner picks; recommend Option C)

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **A — npm workspaces monorepo** | Standard pattern; cross-package dev with shared install; future-proof for Phase 11 (`@llvs/mcpack-google`); TypeScript Project References give incremental builds | Requires moving `src/` → `packages/mcpack/src/`; rewrites every `import` path in test fixtures; rewrites every npm script; rewrites tsconfig `rootDir`/`include`; harness expects current paths; git history shows large rename diff; converts a "small phase" into a layout migration phase. Existing `npm test`, `npm run harness`, `npm run test:coverage` all reference the current path layout. | DEFERRED — appropriate when v1.2 adds 3rd package. |
| **B — Two separate repositories** | Adapter publishes independently; clean dep boundary; core repo stays untouched | Two PRs for any v1.1 change touching both; cross-repo testing requires `npm link` dance; doubles CI surface area; harder for the engineer to keep contracts in sync; v1.1 is one milestone — splitting it across repos creates a synchronization tax with zero benefit | REJECTED — high friction for a single milestone. |
| **C — Sibling directory in same repo, no monorepo tooling** | Zero changes to v1.0 npm scripts; zero changes to v1.0 file paths; harness keeps working; new directory `packages/mcpack-embeddings/` has its own `package.json` and `tsconfig.json` and is published independently via `cd packages/mcpack-embeddings && npm publish`; trivial to convert to workspaces later (one `package.json` edit) | Two `npm install` commands during local dev (root + adapter); two `npm test` invocations; no automatic dep-graph linking — manual `npm link` if you want adapter-vs-local-core; CI has to know about both directories | **RECOMMENDED.** Lowest blast radius; preserves every v1.0 invariant. The "two install/test commands" cost is small and the planner can add a top-level `package.json` script `"test:all": "npm test && cd packages/mcpack-embeddings && npm test"` if the engineer wants single-command parity. |

**Recommendation rationale:** The phase's hardest constraint is *do not break v1.0*. The harness (`test/harness/stripe-harness.ts`) is a 488-line integration script that spawns the Stripe MCP and counts tokens — it is ground truth for the `≥80.7%` regression gate. Any layout change that perturbs `npm run harness` is a Phase 6 → Phase 10 risk. Option C touches zero existing files outside `src/types.ts` and `src/index.ts`. Options A and B both require coordinated changes across the harness, the docs site, and the v1.0 test suite. Defer the layout migration to v1.2 Phase 11 where `@llvs/mcpack-google` provides the third package that justifies workspace tooling.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sentence embedding from scratch | A custom tokenizer + embedding lookup + mean pooling | `pipeline('feature-extraction', model, { pooling: 'mean', normalize: true })` from `@huggingface/transformers` | Tokenization edge cases (BERT WordPiece, special tokens, padding, attention masks) are notoriously easy to get wrong. The pipeline handles all of it. |
| Pipeline lifecycle / caching | Module-level `let` plus ad-hoc memoization | Static-class singleton pattern from HF Node tutorial | The HF tutorial explicitly recommends the singleton class pattern; copying it avoids re-loading the 90MB model on every call. [CITED: HF transformers.js Node tutorial] |
| Cosine similarity | Phase 6 doesn't need it | (Phase 8 concern) | Out of scope for Phase 6. |
| Mean-pooling token vectors | A loop that averages last-hidden-state vectors per sentence | `{ pooling: 'mean' }` option on the pipeline call | One option flag vs ~20 lines of tensor manipulation. [CITED: Xenova/all-MiniLM-L6-v2 model card] |
| L2 normalization of vectors | Math.sqrt + division loop | `{ normalize: true }` option | Same — the pipeline does it. [CITED: same] |
| Model file download/caching | Custom `fetch` + filesystem cache | `@huggingface/transformers` env.cacheDir (default `node_modules/@huggingface/transformers/.cache/`) | Library handles it correctly with content hashing; do not reinvent. [CITED: HF Node tutorial §"Model caching"] |
| Tensor → JS array conversion | Manual `Float32Array` slicing into nested arrays | `tensor.tolist()` returns a properly-shaped `number[][]` for batched output | One method call. [CITED: Xenova model card example output] |
| Workspaces tooling (yarn / pnpm / Turborepo) | Setting up a workspace orchestrator | Sibling directory + manual scripts (Option C) | v1.1 has exactly two packages; tooling overhead exceeds benefit until v1.2. |

**Key insight:** `@huggingface/transformers` exists specifically to make local sentence embeddings a one-liner in JS. Phase 6 is creating a glue layer over that one-liner — under 30 lines of code in the adapter. Any temptation to add abstraction or "clever" caching is misallocated complexity for v1.1.

## Common Pitfalls

### Pitfall 1: Accidentally importing from the adapter into core
**What goes wrong:** A developer wires up `core.ts` to call `provider(...)` in Phase 7 and absent-mindedly imports `EmbeddingProvider` *from `@llvs/mcpack-embeddings`* instead of from `./types.js`. Core now has a dep on the adapter, violating DEC-v11-02.
**Why it happens:** IDE auto-imports pick whichever path is shorter; if both packages export `EmbeddingProvider` (anti-pattern above), the IDE may pick the adapter.
**How to avoid:** (a) Adapter MUST NOT re-export `EmbeddingProvider`. (b) Add an explicit lint/grep check in Phase 6 verification: `grep -r '@llvs/mcpack-embeddings' src/` must return zero matches. (c) Add to `package.json`: a script that asserts core has zero new deps (see Validation Architecture).
**Warning signs:** New entry in `package.json` `dependencies`; type alias collision in `tsc --noEmit`; verifier grep fails.

### Pitfall 2: Singleton pipeline lives at module scope and leaks across tests
**What goes wrong:** `minilm.ts` declares `let extractor` at module scope. Vitest in non-isolation mode reuses the same module across test files — a previous test's loaded pipeline holds 90MB of memory and corrupts later tests if they expect a fresh load. CI memory limit hit.
**Why it happens:** Module-scope singletons leak in test runners. The HF Node tutorial uses a static class — slightly more boilerplate but encapsulates correctly.
**How to avoid:** Use the static-class singleton pattern from the HF tutorial, OR make the singleton scoped to the factory (closure inside `createMiniLMProvider` — what Pattern 2 above shows). Vitest's default isolation re-imports modules per file but not per test; closure-scoped is safest.
**Warning signs:** Test runner OOM; "model already loaded" warnings on a clean test run; tests pass in isolation but fail when run together.

### Pitfall 3: The PRD/CONTEXT specifies `@xenova/transformers`, but the canonical docs are for `@huggingface/transformers`
**What goes wrong:** Engineer follows the PRD literally and pins `@xenova/transformers@^2.17.2`. The library works (it loaded models in 2024 and still does), but: (a) every web search result, every model README example, and every Stack Overflow answer references `@huggingface/transformers`; (b) any v1.1.x bug fix in upstream lands in `@huggingface/transformers` only — `@xenova/transformers` is frozen at 2.17.2 since May 2024; (c) when v1.2 wants a newer model, the migration is forced anyway.
**Why it happens:** Board pre-approved `@xenova/transformers` on 2026-04-25 (CONTEXT line 49). The decision predates this research. The board may not have been aware of the rename.
**How to avoid:** Surface the discrepancy to the board BEFORE Phase 6 plan generation. The choice belongs to the board, not the planner. If the board confirms `@xenova/transformers`, plan with that and document the freeze. If the board flips to `@huggingface/transformers`, update CONTEXT.md and plan with the current package. **Either is plannable — but the planner should not silently substitute.**
**Warning signs:** Adapter test fails because a model file format changed between transformers.js v2 and v3; user-reported issues that match GitHub issues already-fixed in v3+; documentation drift between adapter README and HF docs.

### Pitfall 4: `verbatimModuleSyntax` + missing `type` modifier on imports
**What goes wrong:** The adapter package imports `import { EmbeddingProvider } from '@llvs/mcpack'` (without `type`) — `tsc` errors `"EmbeddingProvider" is a type and cannot be imported as a value when verbatimModuleSyntax is enabled.`
**Why it happens:** v1.0 uses `verbatimModuleSyntax: true` which forces explicit `import type` for type-only imports. Adapter package mirrors this — same gotcha.
**How to avoid:** Always use `import type { EmbeddingProvider } from '@llvs/mcpack'` in the adapter. v1.0 source already follows this discipline in 13 of 15 files. [VERIFIED: grep `^import type` count]
**Warning signs:** `tsc --noEmit` error TS1484 at any new import line; build fails with `verbatimModuleSyntax`-related diagnostic.

### Pitfall 5: Adapter package not isolated for `npm test` / `npm run typecheck`
**What goes wrong:** Engineer runs `npm test` from repo root expecting it to also run adapter tests. Vitest only runs `test/` (root) per `vitest.config` defaults — adapter tests sit unseen until publish.
**Why it happens:** Vitest discovers test files via the cwd of the invoking script. Two packages = two runs.
**How to avoid:** Add explicit test scripts at root: `"test:all": "npm test && npm --prefix packages/mcpack-embeddings test"`. Document in PLAYBOOK / phase plan. The phase verifier should run both.
**Warning signs:** Adapter test files exist but coverage report shows 0% on adapter; CI passes but `dist/` of adapter is wrong on publish.

### Pitfall 6: `sharp` install fails on the developer's box (Apple Silicon, AIX, alpine, etc.)
**What goes wrong:** `npm install` in the adapter package fails because `sharp` (transitively pulled by `@huggingface/transformers`) doesn't have a prebuilt binary for the platform, or the prebuilt download is firewalled.
**Why it happens:** `sharp` is a hard transitive dep of `@huggingface/transformers@4.2.0`. It's image processing — completely unused for text feature extraction — but you can't opt out without forking. [VERIFIED: npm view shows `sharp ^0.34.5` in dependencies, NOT in optionalDependencies]
**How to avoid:** Document in adapter README. Pin sharp version compatible with target platforms. If a developer is blocked, fall back to `--ignore-scripts` install + manual prebuild. Note: the legacy `@xenova/transformers@2.17.2` had `sharp ^0.32.0` as a hard dep too — same pitfall. [VERIFIED: npm view both]
**Warning signs:** `npm install` exits with sharp/install errors; `node-gyp` errors; "ELIFECYCLE" during postinstall.

## Code Examples

Verified patterns from official sources.

### v1.0 entry exports (REFERENCE — DO NOT CHANGE)
```typescript
// /Users/zaid/Projects/MCPack/src/index.ts (current v1.0 — Phase 6 ADDS to this list)
export { mcpack } from './wrap.js';
export { createMCPackServer } from './build.js';

export type {
  MCPackConfig,
  MCPackServerConfig,
  MCPackToolDefinition,
  MCPackHandlerContext,
  MCPackServer,
  RoleConfig,
  IndexConfig,
  SessionConfig,
  SearchToolResponse,
  SearchResult,
  ToolCallResult,
  MCPackHandle,
} from './types.js';
```
[VERIFIED: file read]

### Phase 6 DIFF on `src/index.ts` (ADD ONLY)
```typescript
// Add to the existing `export type { ... }` block:
export type {
  // ... existing exports unchanged ...
  EmbeddingProvider,   // NEW — locked signature per DEC-v11-01
} from './types.js';
```

### Phase 6 DIFF on `src/types.ts` (additive only)
```typescript
// Append near the top of "Public Types" section.
// Place AFTER the imports, BEFORE MCPackConfig — the type is referenced from MCPackConfig.

/**
 * EmbeddingProvider — semantic-search hook.
 *
 * Batch-in / parallel-array-out contract:
 *   input.length === output.length, and output[i] is the vector for input[i].
 * All vectors in a single call MUST have the same dimensionality.
 * Order is contractual: input order maps directly to output order.
 *
 * Core ships no implementation. See @llvs/mcpack-embeddings for a local
 * MiniLM adapter, or implement against this signature for hosted providers.
 *
 * @since v1.1
 */
export type EmbeddingProvider = (texts: string[]) => Promise<number[][]>;

// Then in MCPackConfig (extend the existing interface):
export interface MCPackConfig {
  roles?: RoleConfig;
  defaultRole?: string;
  index?: IndexConfig;
  session?: SessionConfig;
  /**
   * Optional semantic-search configuration.
   *
   * When omitted, the search code path is byte-identical to v1.0 keyword-only behavior.
   * When provided, the v1.1 hybrid ranker uses `provider` to embed tools and queries
   * (consumed in Phases 7–8). Default weights are applied in Phase 8 (semantic 0.7,
   * keyword 0.3 — see DEC-v11-12).
   *
   * @since v1.1
   */
  embeddings?: {
    provider: EmbeddingProvider;
    weights?: {
      semanticWeight: number;
      keywordWeight: number;
    };
  };
}
```

### Adapter `package.json` skeleton
```json
{
  "name": "@llvs/mcpack-embeddings",
  "version": "1.1.0",
  "description": "Local MiniLM embedding adapter for MCPack",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "engines": { "node": ">=18.0.0" },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --reporter=verbose",
    "test:coverage": "vitest run --coverage"
  },
  "peerDependencies": {
    "@llvs/mcpack": "^1.1.0"
  },
  "dependencies": {
    "@huggingface/transformers": "^4.0.0"
  },
  "devDependencies": {
    "@llvs/mcpack": "^1.1.0",
    "@types/node": "^25.5.0",
    "@vitest/coverage-v8": "^4.1.0",
    "typescript": "~5.8.3",
    "vitest": "^4.1.0"
  }
}
```

**Note on the peer-dep version:** This is the lifecycle question (#4 in research questions). With core still at v1.0.0 today, the adapter's `peerDependencies: { "@llvs/mcpack": "^1.1.0" }` cannot be satisfied until Phase 10 publishes `@llvs/mcpack@1.1.0`. Two valid sequences:
- **(i) Bump core's version-in-package.json early.** In Phase 6, change `@llvs/mcpack/package.json` from `1.0.0` to `1.1.0-alpha.0` (or just `1.1.0`). The version isn't published until Phase 10, but the in-repo `npm link` and `devDependencies: "^1.1.0"` resolve. **Recommended** — single source of truth for "what version is in flight".
- **(ii) Defer the peer-dep version to Phase 10.** Use `peerDependencies: { "@llvs/mcpack": "*" }` in Phase 6 as a placeholder; tighten before publish. Looser; harder to verify in tests; not recommended.

Surface this as a planner discussion point — it's a one-line decision.

### Adapter `src/index.ts`
```typescript
export { createMiniLMProvider } from './minilm.js';
export type { MiniLMOptions } from './minilm.js';
```

### Adapter `src/minilm.ts` (full implementation sketch)
```typescript
import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import type { EmbeddingProvider } from '@llvs/mcpack';

export interface MiniLMOptions {
  /** Model name on Hugging Face Hub. Default: 'Xenova/all-MiniLM-L6-v2' (384-dim). */
  model?: string;
  /** Optional cache directory override (forwarded to transformers.js env.cacheDir). */
  cacheDir?: string;
}

const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';

/**
 * Create an EmbeddingProvider backed by a local ONNX MiniLM model.
 *
 * The model loads lazily on first call (~90MB download to ~/node_modules cache
 * on first run; subsequent runs load from cache in <1s on commodity hardware).
 *
 * Returns mean-pooled, L2-normalized 384-dim float32 vectors per input string.
 */
export async function createMiniLMProvider(
  opts: MiniLMOptions = {},
): Promise<EmbeddingProvider> {
  const modelName = opts.model ?? DEFAULT_MODEL;
  // Closure-scoped singleton — load once, reuse forever.
  let extractor: FeatureExtractionPipeline | undefined;

  const ensureExtractor = async (): Promise<FeatureExtractionPipeline> => {
    if (extractor) return extractor;
    if (opts.cacheDir) {
      const { env } = await import('@huggingface/transformers');
      env.cacheDir = opts.cacheDir;
    }
    extractor = (await pipeline(
      'feature-extraction',
      modelName,
    )) as FeatureExtractionPipeline;
    return extractor;
  };

  const provider: EmbeddingProvider = async (texts: string[]) => {
    if (texts.length === 0) return [];
    const ext = await ensureExtractor();
    const tensor = await ext(texts, { pooling: 'mean', normalize: true });
    return tensor.tolist() as number[][];
  };

  return provider;
}
```
[CITED: https://huggingface.co/Xenova/all-MiniLM-L6-v2 (canonical example)]
[CITED: https://huggingface.co/docs/transformers.js/tutorials/node §"Server-side Inference in Node.js"]

### Mock provider for type-contract tests
```typescript
// test/types.test.ts (new file in core)
import { describe, it, expect } from 'vitest';
import type { EmbeddingProvider, MCPackConfig } from '../src/index.js';

describe('EmbeddingProvider type contract', () => {
  it('accepts a function with the locked signature', () => {
    // Compile-time check: this assignment must typecheck.
    const mock: EmbeddingProvider = async (texts) => texts.map(() => [0.1, 0.2, 0.3]);
    expect(typeof mock).toBe('function');
  });

  it('returns one vector per input string (mock contract)', async () => {
    const mock: EmbeddingProvider = async (texts) =>
      texts.map((_, i) => [i, i + 1, i + 2]);
    const out = await mock(['a', 'b', 'c']);
    expect(out).toHaveLength(3);
    expect(out[0]).toHaveLength(3);
    expect(out[2]).toEqual([2, 3, 4]);
  });

  it('vectors have consistent dimensionality across the batch', async () => {
    const mock: EmbeddingProvider = async (texts) => texts.map(() => [0.5, 0.5]);
    const out = await mock(['x', 'y']);
    const dims = out.map((v) => v.length);
    expect(new Set(dims).size).toBe(1);
  });
});

describe('MCPackConfig.embeddings shape', () => {
  it('compiles when embeddings is omitted (v1.0 path)', () => {
    const cfg: MCPackConfig = {};
    expect(cfg).toEqual({});
  });

  it('compiles when embeddings is provided with provider only', () => {
    const provider: EmbeddingProvider = async (t) => t.map(() => [0]);
    const cfg: MCPackConfig = { embeddings: { provider } };
    expect(cfg.embeddings?.provider).toBe(provider);
  });

  it('compiles when embeddings includes weights', () => {
    const provider: EmbeddingProvider = async (t) => t.map(() => [0]);
    const cfg: MCPackConfig = {
      embeddings: { provider, weights: { semanticWeight: 0.7, keywordWeight: 0.3 } },
    };
    expect(cfg.embeddings?.weights?.semanticWeight).toBe(0.7);
  });
});
```

### Adapter integration test
```typescript
// packages/mcpack-embeddings/test/minilm.test.ts
import { describe, it, expect } from 'vitest';
import { createMiniLMProvider } from '../src/index.js';

describe('createMiniLMProvider', () => {
  // Smoke tests gate model download (~90MB). Skip in fast unit-test mode.
  it.runIf(process.env.RUN_MODEL_TESTS === '1')(
    'returns 384-dim vectors for a batch',
    async () => {
      const provider = await createMiniLMProvider();
      const out = await provider(['hello world', 'embedding test']);
      expect(out).toHaveLength(2);
      expect(out[0]).toHaveLength(384);
      expect(out[1]).toHaveLength(384);
    },
    60_000, // generous timeout for first-run model download
  );

  it('returns empty array for empty input (no model load)', async () => {
    const provider = await createMiniLMProvider();
    const out = await provider([]);
    expect(out).toEqual([]);
  });

  it('produces consistent vectors for identical inputs', async () => {
    if (process.env.RUN_MODEL_TESTS !== '1') return;
    const provider = await createMiniLMProvider();
    const a = await provider(['determinism test']);
    const b = await provider(['determinism test']);
    expect(a[0]).toEqual(b[0]);
  });
});
```

**Why `RUN_MODEL_TESTS=1` gating:** Model download is 90MB and first-run inference is multi-second. CI in Phase 10 runs the full path; local `npm test` skips by default to keep the dev loop fast. Phase 6 itself doesn't run the harness — that's Phase 10.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@xenova/transformers` (npm name) | `@huggingface/transformers` (npm name) | October 2024 (v3.0.0 release; package moved to official HF org) | Legacy name still resolves on npm but is frozen at 2.17.2 (May 2024). New projects use the current name. **PRD/CONTEXT cite the legacy name — discussion point for the board.** [CITED: HF blog "Transformers.js v3", GitHub issue #1484] |
| transformers.js v2 (browser-first) | transformers.js v3+ (Node + browser parity, WebGPU) | v3.0.0, October 2024 | v3 added official Node ESM support, conditional exports for `transformers.node.mjs`, native ONNX runtime via `onnxruntime-node`. Pre-v3 was browser-WASM-only with optional Node support. v3+ is the right baseline for v1.1. [CITED: HF blog v3 announcement] |
| Manual ONNX integration | `pipeline('feature-extraction', model)` API | Stable since transformers.js v2.0.0 (March 2023) | The pipeline API is the canonical sentence-embedding entry point. Stable across v2 and v3. |

**Deprecated/outdated:**
- `@xenova/transformers@2.17.2`: not formally deprecated on npm (no `npm deprecate` flag set as of 2026-04-26 — issue #1484 is open and unresolved), but practically frozen since May 2024. Treat as legacy. [CITED: GitHub huggingface/transformers.js issue #1484]
- `onnxruntime-node@1.14.0` (legacy adapter version): now at 1.24.3 in current `@huggingface/transformers`. Performance and platform support improvements.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Board's 2026-04-25 pre-approval of `@xenova/transformers` was made before the rename to `@huggingface/transformers` was surfaced | Standard Stack + Pitfall 3 + Discussion Points | LOW — even if the board specifically intended the legacy name, planning against the current name is a one-line CONTEXT.md amendment. Worst case: legacy name was intentional → adapter pins `@xenova/transformers ^2.17.2` and works correctly but is on a frozen library. **Surface to board before plan execution.** |
| A2 | `npm test` from root will not discover tests in `packages/mcpack-embeddings/test/` without explicit config | Pitfall 5 | MEDIUM — vitest's default config is cwd-scoped; verified by reading existing `vitest.config` (none in root) and the `test` script (`vitest run`). Default behavior matches assumption. If wrong, both packages' tests run from root and the dual-test-script is unnecessary — harmless. |
| A3 | The MCP SDK's `Server` class will not change its `setRequestHandler` shape between v1.0 and v1.1 of MCPack (which is what enables Phase 7+ to consume `embeddings` via the same engine instance) | Architectural Responsibility Map | LOW — Phase 6 doesn't call `setRequestHandler`; this is a Phase 7+ concern. Listed only because the `MCPackEngine` constructor is the contract Phase 7 will extend. [CITED: PRD §10 risk on SDK low-level dep] |
| A4 | The `tensor.tolist()` method on transformers.js feature-extraction output for a batched input returns `number[][]` (not a flat `number[]` requiring reshape) | Code Examples §"Adapter src/minilm.ts" | LOW — model card output example explicitly shows `dims: [N, 384]` and `.tolist()` returning nested arrays for batched inputs. [CITED: Xenova/all-MiniLM-L6-v2 model card] |
| A5 | The default test isolation in vitest 4.x re-imports modules per test file, preventing cross-file singleton leak | Pitfall 2 | LOW — vitest 4.x default is `isolate: true` (vitest docs). Even so, recommendation is closure-scoped singleton (Pattern 2) which doesn't depend on isolation behavior. |

## Open Questions (RESOLVED)

All five questions resolved by board decision 2026-04-25 and locked in CONTEXT.md / decisions.md prior to plan-phase 6 spawn. Listed here for audit trail; the plan reflects the resolved values.

1. **`@xenova/transformers` vs `@huggingface/transformers` (highest priority).**
   - **RESOLVED:** `@huggingface/transformers ^4.0.0`. Board approved switch 2026-04-25 (DEC-v11-03 clerical-correction). Legacy `@xenova/transformers` is frozen at v2.17.2 since May 2024; current name at v4.2.0 is the active successor under HuggingFace org. API-compatible for our `pipeline('feature-extraction', ...)` usage. INFO entry added to `.planning/INGEST-CONFLICTS.md`.

2. **Peer-dep version sequencing for `@llvs/mcpack` ^1.1.0 in adapter.**
   - **RESOLVED:** Bump core `package.json` `1.0.0 → 1.1.0` in Phase 6 (DEC-v11-03b). Standard "version-in-development" pattern. Phase 10 still does the actual `npm publish`. The bump and the publish are separate operations.

3. **Where in `src/types.ts` to place the new types.**
   - **RESOLVED:** Place `EmbeddingProvider` immediately above `MCPackConfig` (it's referenced from there). Add a `// ─── v1.1 Public Types ────` divider comment to mirror the existing `// ─── Public Types ─────` and `// ─── Internal Types ─────` separators. Plan 06-01 Task 1 Step 1(a) implements this.

4. **Adapter factory naming.**
   - **RESOLVED:** `createMiniLMProvider`. Matches the v1.0 `createMCPackServer` pattern and HF's tutorial nomenclature. Plan 06-02 Task 1 implements this.

5. **Whether to add `vitest.config.ts` files to either package.**
   - **RESOLVED:** No `vitest.config.ts` in Phase 6. Both packages rely on vitest defaults (matches v1.0 convention). If coverage-floor tuning needs configuration in Phase 10, add it then.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Both packages (engines: ">=18.0.0") | ✓ | (planner verifies on dev box; no system call attempted in research) | — |
| npm | Both packages | ✓ | (planner verifies; `>=9` per HF Node tutorial) | — |
| Network access to npm registry | Install (`npm install`) | ✓ | — | — |
| Network access to Hugging Face Hub | Adapter integration tests (model download on first run) | ASSUMED-✓ | — | Bypass with `RUN_MODEL_TESTS=0` (default in Phase 6 test gating) |
| `onnxruntime-node` prebuilt binary | Adapter (transitive via `@huggingface/transformers`) | ASSUMED-✓ | 1.24.3 (current) | None — if prebuilt is missing for the platform, install fails. Apple Silicon, Linux x64, Win x64 all supported per `npm view os`. [VERIFIED: npm view os field for onnxruntime-node@1.24.3] |
| `sharp` prebuilt binary | Adapter (transitive, unused for text) | ASSUMED-✓ | 0.34.5 | None — sharp is a hard dep; install fails on unsupported platforms (AIX, IBM i). Acceptable for v1.1 target. |
| Vitest | Both packages | ✓ | ^4.1.0 (devDependency) | — |
| TypeScript ~5.8 | Both packages | ✓ | (devDependency) | — |

**Missing dependencies with no fallback:** None expected on standard dev environments (macOS, Linux, Windows). Document `sharp` install caveat in adapter README per Pitfall 6.

**Missing dependencies with fallback:** None — Phase 6 plan should not branch on environment availability.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `vitest@^4.1.0` (carry-forward from v1.0) [VERIFIED: package.json] |
| Config file | None — relies on defaults (matches v1.0). Add per-package `vitest.config.ts` only if coverage tuning needs it (don't in Phase 6). |
| Quick run command (core) | `npm test` (root) |
| Full suite command (core) | `npm test && npm run test:coverage` |
| Quick run command (adapter) | `cd packages/mcpack-embeddings && npm test` |
| Full suite command (adapter) | `cd packages/mcpack-embeddings && npm test && npm run test:coverage` |
| Combined gate | `npm test && cd packages/mcpack-embeddings && npm test && cd ../..` (or wrap as a root `test:all` script) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-v11-semantic-provider-interface | `EmbeddingProvider` type compiles for batch-in / parallel-array-out signature | type-contract (compile-time) + unit | `npm test -- types.test.ts` | ❌ Wave 0 — `test/types.test.ts` |
| REQ-v11-semantic-provider-interface | Mock provider returns parallel array of consistent-dim vectors | unit | `npm test -- types.test.ts` | ❌ Wave 0 (same file) |
| REQ-v11-embeddings-optional-config | `MCPackConfig` with no `embeddings` compiles unmodified from v1.0 callsite | type-contract | `npm run typecheck` + `npm test -- types.test.ts` | ❌ Wave 0 (same file) |
| REQ-v11-embeddings-optional-config | `MCPackConfig` with `embeddings` provided + weights compiles | type-contract | `npm test -- types.test.ts` | ❌ Wave 0 (same file) |
| REQ-v11-embeddings-optional-config | All v1.0 tests pass unmodified (no behavior delta when field absent) | regression | `npm test` | ✅ existing test/*.test.ts |
| REQ-v11-mcpack-embeddings-package | Adapter package builds and emits correct `dist/` | build | `cd packages/mcpack-embeddings && npm run build` | ❌ Wave 0 — entire package |
| REQ-v11-mcpack-embeddings-package | `createMiniLMProvider()` returns a function conforming to `EmbeddingProvider` (typecheck) | unit | `cd packages/mcpack-embeddings && npm run typecheck` | ❌ Wave 0 |
| REQ-v11-mcpack-embeddings-package | MiniLM adapter produces 384-dim vectors for known input | integration (gated) | `RUN_MODEL_TESTS=1 cd packages/mcpack-embeddings && npm test` | ❌ Wave 0 — `packages/mcpack-embeddings/test/minilm.test.ts` |
| REQ-v11-zero-core-deps | Core `package.json` has zero new `dependencies` entries vs v1.0 | static check | `diff <(jq -S '.dependencies // {}' package.json) <(echo '{}')` and `jq -S '.peerDependencies' package.json` matches v1.0 | ✅ scriptable; **add to phase verifier** |
| REQ-v11-zero-core-deps | Core `src/` does NOT import from `@llvs/mcpack-embeddings` | static check | `! grep -r '@llvs/mcpack-embeddings' src/` | ✅ scriptable |
| REQ-v11-zero-core-deps | Core `src/` does NOT import from `@huggingface/transformers` or `@xenova/transformers` | static check | `! grep -rE '@(huggingface\|xenova)/transformers' src/` | ✅ scriptable |
| REQ-v11-public-api-lock | `mcpack(server, config)` signature unchanged | type-contract diff | TS declaration diff: `tsc --emitDeclarationOnly` then diff `dist/index.d.ts` against v1.0 `dist/index.d.ts` for `mcpack` and `createMCPackServer` symbols only | ✅ scriptable; **add to phase verifier** |
| REQ-v11-public-api-lock | `MCPackConfig` only ADDS optional fields (no removed/renamed fields) | type-contract diff | Same as above | ✅ scriptable |
| REQ-v11-public-api-lock | All v1.0 tests pass against new types unmodified | regression | `npm test` | ✅ existing |
| REQ-v11-esm-only | Core builds with `module: NodeNext`, `verbatimModuleSyntax: true`, no `.cjs` output | build | `npm run build && ls dist/*.cjs` (must be empty) | ✅ existing tsconfig |
| REQ-v11-esm-only | Adapter builds with same settings | build | `cd packages/mcpack-embeddings && npm run build && ls dist/*.cjs` (must be empty) | ❌ Wave 0 |
| REQ-v11-esm-only | Adapter `package.json` has `"type": "module"` | static check | `jq '.type' packages/mcpack-embeddings/package.json` returns `"module"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run typecheck && npm test` (root) — fast (current v1.0 runs in seconds)
- **Per wave merge:** `npm run typecheck && npm test && npm run test:coverage && cd packages/mcpack-embeddings && npm run typecheck && npm test`
- **Phase gate (before `/gsd-verify-work`):** Full above + the dep-isolation greps + the API-lock declaration diff. Adapter integration tests with `RUN_MODEL_TESTS=1` (one-time model download).

### Wave 0 Gaps

The following files do NOT exist yet and the Phase 6 plan must create them in Wave 0:

- [ ] `test/types.test.ts` — covers REQ-v11-semantic-provider-interface, REQ-v11-embeddings-optional-config (type-contract tests via mock provider; pattern in Code Examples above).
- [ ] `packages/mcpack-embeddings/` — entire directory.
- [ ] `packages/mcpack-embeddings/package.json` — covers REQ-v11-mcpack-embeddings-package.
- [ ] `packages/mcpack-embeddings/tsconfig.json` — covers REQ-v11-esm-only.
- [ ] `packages/mcpack-embeddings/src/index.ts` — covers REQ-v11-mcpack-embeddings-package.
- [ ] `packages/mcpack-embeddings/src/minilm.ts` — covers REQ-v11-mcpack-embeddings-package.
- [ ] `packages/mcpack-embeddings/test/minilm.test.ts` — covers REQ-v11-mcpack-embeddings-package.
- [ ] (Optional) Top-level `npm run test:all` script wrapping both packages — covers test ergonomics.
- [ ] (Optional) Phase verifier helper script `scripts/verify-zero-deps.sh` running the dep-isolation greps + jq diff.

Framework install: none — vitest is already in v1.0 devDependencies. Adapter inherits its own copy via its own `package.json`.

### Key validation gates the planner must encode in tasks

1. **Zero new core deps gate.** Concrete script:
   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   # Compare current core deps to a baseline snapshot of v1.0
   CURRENT=$(jq -S '.dependencies // {}' package.json)
   BASELINE='{}'  # v1.0 had no dependencies (only peerDependencies)
   if [ "$CURRENT" != "$BASELINE" ]; then
     echo "FAIL: core package.json has new dependencies"; exit 1
   fi
   PEER=$(jq -S '.peerDependencies' package.json)
   EXPECTED='{"@modelcontextprotocol/sdk":"^1.0.0"}'
   if [ "$PEER" != "$EXPECTED" ]; then
     echo "FAIL: core peerDependencies changed from v1.0"; exit 1
   fi
   ```
   This is the verifier's hardest gate.

2. **Public API lock gate.** Capture the v1.0 `dist/index.d.ts` (already in git as the baseline) and compare against the post-Phase-6 `dist/index.d.ts` — assert that every line present in v1.0 is present in v1.1 (added-only, not modified-or-removed). The `mcpack`, `createMCPackServer`, and existing exported types must be byte-identical.

3. **Adapter-isolation gate.** Grep `src/` for any reference to the adapter or to `@huggingface/transformers` / `@xenova/transformers`. Zero matches required.

## Sources

### Primary (HIGH confidence)
- `/Users/zaid/Projects/MCPack/.planning/phases/06-embeddingprovider-interface-adapter-scaffold-v1-1/06-CONTEXT.md` — locked decisions, all DEC-v11-* and DEC-BOARD-* citations
- `/Users/zaid/Projects/MCPack/.planning/intel/decisions.md` — DEC-v11-01..15 + DEC-BOARD-01..05 source
- `/Users/zaid/Projects/MCPack/.planning/intel/requirements.md` — REQ-v11-* full text
- `/Users/zaid/Projects/MCPack/src/index.ts`, `src/types.ts`, `src/core.ts`, `src/wrap.ts`, `src/build.ts` — existing v1.0 surface (read in research)
- `/Users/zaid/Projects/MCPack/package.json`, `tsconfig.json` — current v1.0 dep + compiler settings (read in research)
- `/Users/zaid/Projects/MCPack/PLAYBOOK.md` — quality gates, development protocol
- `/Users/zaid/Projects/MCPack/.planning/STATE.md`, `.planning/ROADMAP.md` — phase boundary + success criteria
- npm registry via `npm view` — verified package versions, deps, engines, exports for `@huggingface/transformers@4.2.0`, `@xenova/transformers@2.17.2`, `onnxruntime-node@1.24.3`
- https://huggingface.co/docs/transformers.js/tutorials/node — official Node.js tutorial: minimum Node 18+, npm 9+, ESM/CJS pattern, singleton pattern, `env.cacheDir`, default cache location `node_modules/@huggingface/transformers/.cache/`
- https://huggingface.co/Xenova/all-MiniLM-L6-v2 — canonical pipeline + `{ pooling: 'mean', normalize: true }` example, confirms 384-dim output, `tensor.tolist()` returns `number[][]` for batches

### Secondary (MEDIUM confidence)
- https://huggingface.co/docs/transformers.js/en/api/pipelines — pipeline API reference (feature-extraction listed as supported task)
- https://github.com/huggingface/transformers.js/issues/1484 — open issue: "Should @xenova/transformers be deprecated?" (no maintainer answer as of research time)
- https://huggingface.co/blog/transformersjs-v3 — v3 release blog (Oct 2024; rename announcement)
- WebSearch result quoting Hugging Face announcement on the rename (Oct 2024 transition from `@xenova` org to official HF org on npm)
- https://2ality.com/2021/07/simple-monorepos.html — npm workspaces + TypeScript Project References reference (background for Option A consideration)

### Tertiary (LOW confidence — noted for completeness)
- WebSearch result claiming "ONNX model.onnx is 90.4 MB" for Xenova/all-MiniLM-L6-v2 (uncorroborated by direct page fetch; CONTEXT says "~50MB" — discrepancy could be quantized vs non-quantized version. Not load-bearing for Phase 6.)

## Discussion Points (for planner / board)

These are NOT decisions Claude can make unilaterally — they need the board's nod or a planner stance.

### DP1: `@xenova/transformers` vs `@huggingface/transformers`

**The discrepancy:** CONTEXT.md line 49 names `@xenova/transformers` as board-pre-approved. Research confirms this is the legacy name. The current name is `@huggingface/transformers` (renamed October 2024 per HF blog "Transformers.js v3"). The legacy package is frozen at v2.17.2 since May 2024. The current package is at v4.2.0 (April 2026).

**Why it matters:** Pinning the legacy name commits the adapter to a 2-year-old library with no upstream fixes. Most external docs reference the current name. New models published to the HF Hub may not work cleanly with v2-era loaders.

**What is NOT changing:** Either way, the dep lives ONLY in the adapter package. Either way, core stays zero-dep. The board's intent — "adapter package can take a model dep" — is preserved by either choice.

**Recommendation:** Surface to the board with a one-line question: *"CONTEXT.md cites `@xenova/transformers` (board-approved 2026-04-25). The package was renamed to `@huggingface/transformers` in Oct 2024 and the legacy name is frozen at 2.17.2. Confirm whether to (a) pin legacy as written, or (b) pin current `@huggingface/transformers ^4.0.0`."* If no answer in time for plan execution, default to (b) and document; the cost of switching back is one `package.json` edit.

### DP2: Bump core `@llvs/mcpack` package.json version to `1.1.0` in Phase 6?

**Why it matters:** Adapter peer-deps `@llvs/mcpack ^1.1.0`. If core stays at `1.0.0` in Phase 6, the adapter's peer dep is unsatisfiable in-repo (devDependencies install will warn). Bumping to `1.1.0` (or `1.1.0-alpha.0`) lets the adapter and integration tests resolve cleanly during v1.1 development. Actual npm publish doesn't happen until Phase 10.

**Recommendation:** Bump to `1.1.0` in Phase 6 plan. Surface as a planner decision; safe and reversible.

## Metadata

**Confidence breakdown:**
- Type plumbing on `src/types.ts` and `src/index.ts`: HIGH — read every relevant v1.0 file, additive change is structurally identical to existing optional fields.
- Package layout decision (Option C): HIGH — verified that v1.0 npm scripts and harness reference the current path layout; sibling-directory minimizes blast radius.
- `@huggingface/transformers` API for sentence embeddings: HIGH — canonical example fetched directly from HF model card and Node tutorial, both consistent.
- `@xenova/transformers` deprecation status: MEDIUM — confirmed library is frozen at 2.17.2 since May 2024 (npm registry) and rename was announced in HF blog (Oct 2024), but no formal `npm deprecate` flag set. Issue #1484 open without resolution.
- Adapter test patterns: HIGH — pattern follows v1.0 test conventions (vitest, mock-based, one file per src module) read directly from existing test files.
- Common pitfalls: HIGH — pitfalls 1, 2, 4, 5 derived from direct file inspection of v1.0; pitfalls 3, 6 derived from npm registry + GitHub issues.

**Research date:** 2026-04-26
**Valid until:** 2026-05-26 (`@huggingface/transformers` releases roughly monthly per its time history; check for v4.x notes before plan execution if more than 30 days elapse)

Sources cited as URLs above. Key external references for the planner to re-fetch if needed:
- [Transformers.js v3 blog](https://huggingface.co/blog/transformersjs-v3)
- [Transformers.js Node.js tutorial](https://huggingface.co/docs/transformers.js/tutorials/node)
- [Xenova/all-MiniLM-L6-v2 model card](https://huggingface.co/Xenova/all-MiniLM-L6-v2)
- [GitHub issue: should @xenova be deprecated?](https://github.com/huggingface/transformers.js/issues/1484)
- [npm workspaces TypeScript reference](https://2ality.com/2021/07/simple-monorepos.html)
