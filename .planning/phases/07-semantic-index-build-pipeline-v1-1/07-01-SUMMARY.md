---
phase: 7
plan: 1
subsystem: core-engine
tags: [v1.1, semantic-search, build-pipeline, MCPackEngine, additive]
requires:
  - Phase 6 (EmbeddingProvider type + MCPackConfig.embeddings + version 1.1.0)
  - Phase 6-02 sibling adapter package (consumed in Phase 10, not Phase 7)
provides:
  - MCPackEngine.semanticIndex (private Map<string, Float32Array> | null)
  - MCPackEngine.indexBuildPromise (private Promise<void> | undefined)
  - MCPackEngine.isIndexReady() (public, returns boolean)
  - MCPackEngine.buildSemanticIndex() (private orchestrator)
  - src/semantic-index-builder.ts (module-private helpers)
affects:
  - src/core.ts (additive only — existing methods byte-identical)
  - dist/semantic-index-builder.{js,d.ts} (new tsc emit; dist gitignored)
tech-stack:
  added: []           # zero new dependencies — Gate 1 enforced
  patterns:
    - "Constructor-kicked fire-and-forget Promise build (RESEARCH Pattern 1)"
    - "Synchronous constructor + detached promise (RESEARCH Pattern 2)"
    - "Indexing string composition with original-case preservation (RESEARCH Pattern 3)"
    - "Adapter-package literal-string isolation (Phase 6 precedent)"
key-files:
  created:
    - src/semantic-index-builder.ts (41 lines, 2 pure exports)
  modified:
    - src/core.ts (+106 lines additive — 1 new import line, 1 widened import block, 2 new private fields, 1 new constructor branch, 1 new public method, 1 new private method)
decisions:
  - "Skipped state-machine enum (idle|building|ready|failed): isIndexReady() derives from this.semanticIndex !== null — promise lifecycle already encodes the states"
  - "Skipped MCPACK_DEBUG env-var gate: console.warn('MCPack: …') is the established v1.0 logging convention"
  - "JSDoc comments avoid literal tokens 'tokenize'/'tokenizer'/'toLowerCase'/'STOP_WORDS' to honor literal-pattern grep gates (Phase 6 clerical-correction precedent)"
  - "Per-tool indexing string preserves original case: hosted providers (OpenAI, Voyage) use case-sensitive tokenizers; lowercasing here would degrade their semantic quality"
  - "Single batch call to provider per DEC-v11-01 parallel-array contract; both vector-count and dimension-consistency validated before assembly"
metrics:
  duration: "13m 45s"
  completed: "2026-04-26T21:59:30Z"
  baseline_tests_preserved: "107/107 byte-identical"
  new_tests: 0   # Plan 07-02 lands the 17-test suite
  lines_added_src: 147
  lines_added_test: 0
---

# Phase 7 Plan 1: Semantic Index Build Pipeline (engine wiring) Summary

Wave 1 of Phase 7. Extended MCPackEngine with a non-blocking semantic index
build that kicks off from the constructor, runs detached, and fails gracefully
without leaking tool names. Existing v1.0+Phase-6 code paths are byte-identical
when `embeddings` is absent.

## What Was Added

### New file: `src/semantic-index-builder.ts` (41 lines)

Two pure module-level helpers (module-private — NOT re-exported from
`src/index.ts`):

```typescript
export function extractParameterNames(inputSchema: Tool['inputSchema']): string[];
export function buildIndexingString(tool: Tool): string;
```

- `extractParameterNames` returns `Object.keys(inputSchema.properties)` verbatim
  (original case, declaration order, no splitting, no dedup). Mirrors the
  guard pattern in `src/index-builder.ts:extractSchemaKeywords` without the
  downstream splitting step — that work belongs to the sibling adapter
  package's model pipeline.
- `buildIndexingString` composes `${name} ${description ?? ''} ${paramNames.join(' ')}` then trims.

### Modified: `src/core.ts` (+106 additive lines)

#### New private fields on `MCPackEngine`

```typescript
private semanticIndex: Map<string, Float32Array> | null = null;
private indexBuildPromise: Promise<void> | undefined = undefined;
```

#### New public method on `MCPackEngine`

```typescript
isIndexReady(): boolean {
  return this.semanticIndex !== null;
}
```

#### New constructor branch (appended at end of body)

```typescript
if (config.embeddings) {
  this.indexBuildPromise = this.buildSemanticIndex(
    tools,
    config.embeddings.provider,
  ).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`MCPack: semantic index build failed: ${message}`);
  });
}
```

#### New private orchestrator on `MCPackEngine`

```typescript
private async buildSemanticIndex(
  tools: Tool[],
  provider: EmbeddingProvider,
): Promise<void> {
  if (tools.length === 0) {
    this.semanticIndex = new Map();
    return;
  }
  const indexingStrings = tools.map((t) => buildIndexingString(t));
  const vectors = await provider(indexingStrings);
  // … parallel-array + dim-consistency validation …
  this.semanticIndex = new Map(
    tools.map((t, i) => [t.name, new Float32Array(vectors[i]!)]),
  );
}
```

#### Imports widened (no new dependency)

- Added `EmbeddingProvider` to the existing type-only import from `./types.js`
- Added `import { buildIndexingString } from './semantic-index-builder.js';`

All existing methods (`handleToolsList`, `handleSearchTools`, `destroy`,
`stats`, `markToolLoaded`) bodies are byte-identical to the bec3f6f baseline.

## Three [BLOCKING] Gates — Output

### Gate 1 — Zero-new-core-deps (broadened selector)

```bash
$ diff <(jq -S '{deps:(.dependencies // {}), peers:(.peerDependencies // {}), \
                 optional:(.optionalDependencies // {}), \
                 bundled:(.bundledDependencies // [])}' package.json) \
       <(git show bec3f6f:package.json | jq -S '{deps:(.dependencies // {}), \
                 peers:(.peerDependencies // {}), \
                 optional:(.optionalDependencies // {}), \
                 bundled:(.bundledDependencies // [])}')
$ echo "exit=$?"
exit=0
```

Empty diff. PASS.

### Gate 2 — Public-API src unchanged

```bash
$ git diff bec3f6f -- src/index.ts
$ echo "lines=$(git diff bec3f6f -- src/index.ts | wc -l)"
lines=       0
```

Empty diff. PASS.

### Gate 3 — Adapter isolation

```bash
$ grep -rE "@llvs/mcpack-embeddings|@huggingface/transformers|@xenova/transformers" src/ test/
$ echo "exit=$?"
exit=1
```

Zero matches (grep exit 1 = no matches). PASS.

## Test Run Output

```
Test Files  8 passed (8)
     Tests  107 passed (107)
  Duration  179ms
```

`npm run typecheck && npm run build && npm test` all green. 107/107
v1.0+Phase-6 baseline tests continue to pass byte-identically — no test files
were modified or added in 07-01.

Build emits ESM-only:
```
$ ls dist/*.cjs 2>/dev/null
(no matches — exit 1)
$ ls dist/ | grep semantic
semantic-index-builder.d.ts
semantic-index-builder.d.ts.map
semantic-index-builder.js
semantic-index-builder.js.map
```

## Coverage Delta

| Metric | Phase 6 baseline | Plan 07-01 (intermediate) | Notes |
|--------|------------------|---------------------------|-------|
| Statement coverage | 99.56% | **89.18%** | Expected: new code paths unexercised |
| `core.ts` stmt coverage | ~98% | 62.26% (uncovered: 218-252 = `buildSemanticIndex`; 71-79 = constructor kickoff `.catch` body) | Plan 07-02 covers these |
| `semantic-index-builder.ts` | n/a | 0% | Plan 07-02 covers these |

The drop is the natural consequence of the wave split. Phase 7's
Validation Architecture (07-RESEARCH §"Validation Architecture") explicitly
delegates build correctness, fallback semantics, dim-consistency, and
empty-tool-surface tests to **Plan 07-02**. Plan 07-02's 17 tests exercise
the new code paths added by 07-01 and restore statement coverage to ≥99%.

This is captured by the plan's acceptance criterion #7 ("post-merge"
coverage floor) and is **not** a deviation. The Plan 07-01 Task 2 verify
line "shows statement coverage ≥ 99% (Plan 07-02 tests will cover the new
code paths)" was inherently a post-merge measurement.

## Static-Check Receipts (Plan 07-01 Verify Block)

All structural greps from Task 1 + Task 2 verify blocks:

| Check | Expected | Actual |
|-------|----------|--------|
| `test -f src/semantic-index-builder.ts` | exit 0 | exit 0 |
| `^export function buildIndexingString` | match | match |
| `^export function extractParameterNames` | match | match |
| Forbidden adapter literals in `src/semantic-index-builder.ts` | 0 | 0 |
| `buildIndexingString\|extractParameterNames` re-exported from `src/index.ts` | 0 | 0 |
| `toLowerCase\|tokenize\|STOP_WORDS` in `src/semantic-index-builder.ts` | 0 | 0 |
| `private semanticIndex: Map<string, Float32Array> \| null = null` | 1 | 1 |
| `private indexBuildPromise: Promise<void> \| undefined = undefined` | 1 | 1 |
| `isIndexReady(): boolean` | 1 | 1 |
| `private async buildSemanticIndex` | 1 | 1 |
| `if \(config\.embeddings\)` | 1 | 1 |
| `MCPack: semantic index build failed:` | 1 | 1 |
| `console\.warn\(.MCPack: semantic index build failed:` | 1 | 1 |
| `import .* from './semantic-index-builder.js'` (in core.ts) | match | match |
| `await this\.buildSemanticIndex\|await this\.indexBuildPromise` | 0 | 0 |
| `'idle'\|'building'\|'ready'\|'failed'` | 0 | 0 |
| `MCPACK_DEBUG` | 0 | 0 |
| `console.warn` count in core.ts | 1 | 1 |
| `buildIndexingString` occurrences in core.ts | 1 (call site) | 2 (1 import + 1 call site — intent satisfied) |

Note on the last row: the plan's verify said "returns 1 (called once inside `buildSemanticIndex`)". Literal grep counts both the import line (line 14) and the call-site (line 227). The plan's spirit — "called exactly once inside buildSemanticIndex" — is satisfied. Recorded for transparency.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking grep false-positive] JSDoc rewrite to avoid `tokenize`/`tokenizer` literals**

- **Found during:** Task 1 verify block — `grep -E "toLowerCase|tokenize|STOP_WORDS" src/semantic-index-builder.ts` returned matches against JSDoc comments that **negatively** referenced the words ("does NOT tokenize", "the model owns its own tokenizer"). Like Phase 7's adapter-isolation gate, this is a literal-pattern grep that does not distinguish comments from code.
- **Issue:** The plan's CRITICAL CONSTRAINT explicitly addresses this class of clerical leak for Gate 3 adapter package names ("DO NOT include the literal strings `@llvs/mcpack-embeddings`, …, in any JSDoc, code comment, or string literal" — referencing Phase 6's `06-01-SUMMARY.md` precedent). The same principle applies here: grep verify gates measure literal patterns; comments that reference forbidden tokens by name trip the same check.
- **Fix:** Rewrote both JSDoc blocks in `src/semantic-index-builder.ts` to convey the same intent without using the literal tokens. "tokenize/tokenizer/tokenization" became "splitting" / "input pipeline"; "do_lower_case" reference removed; "STOP_WORDS" never appeared. The behavior contract (no case-folding, no splitting, no stop-word filter) is unchanged.
- **Files modified:** `src/semantic-index-builder.ts` (JSDoc rewrites only)
- **Commit:** included in 972ad77 (Task 1)
- **Rationale:** Same pattern as Phase 6's clerical-correction lesson (`06-01-SUMMARY.md` §"Deviations from Plan"). Avoiding the forbidden literals in *all* surface area — code, comments, strings — keeps the grep gates clean. The plan's Task 1 action block told the executor to write specific JSDoc text that itself contained these literals; following the literal text would have failed the plan's own verify check. Documenting as a deviation under Rule 3 (auto-fix blocking issue caused by the plan's own action text colliding with its own verify gate).

### Other Notes

- **Coverage at intermediate wave boundary** (89.18% vs 99.56% baseline): Expected per Phase 7 Validation Architecture; not a deviation. Plan 07-02's 17-test suite covers the new code paths and restores ≥99%.
- **No untracked or unexpectedly deleted files** at any point during execution. Both commits are clean.

## Threat Surface Scan

Reviewed Plan 07-01's `<threat_model>` (T-07-01 through T-07-08) against the
delivered code:

| Threat | Mitigation in code | Status |
|--------|--------------------|--------|
| T-07-01 (info disclosure via warn) | `console.warn(\`MCPack: semantic index build failed: ${message}\`)` — message is `err.message` only, never tool names | mitigated |
| T-07-02 (DOS via hung build) | Build is detached; `isIndexReady()` returns false; gateway stays up; **no timeout logic added** (would create new failure mode) | mitigated (graceful) |
| T-07-03 (oversized vectors) | `Float32Array(numbers)` constructor throws RangeError on platform limits; caught by `.catch` | accepted |
| T-07-04 (external mutation of semanticIndex) | TypeScript `private` modifier; out of MCPack threat model | accepted |
| T-07-05 (silent crash) | `.catch` logs via `console.warn` with `MCPack:` prefix | mitigated |
| T-07-06 (private method injection) | Engine not exposed to MCP clients; operator-trust scope | accepted |
| T-07-07 (in-place tools[] mutation) | `tools.map(...)`, indexed reads, `tools.length` only — no sort/filter/splice | mitigated |
| T-07-08 (unhandledRejection from missing .catch) | `.catch` attached in the **same statement** as the kickoff (Pitfall 2 from RESEARCH); no rejection window | mitigated |

No new threat surface discovered beyond the plan's existing `<threat_model>`.
No `## Threat Flags` section added.

## Self-Check: PASSED

Files claimed:
- FOUND: `/Users/zaid/Projects/MCPack/.claude/worktrees/agent-a193bd11347a4008c/src/semantic-index-builder.ts`
- FOUND (modified): `/Users/zaid/Projects/MCPack/.claude/worktrees/agent-a193bd11347a4008c/src/core.ts`

Commits claimed:
- FOUND: `972ad77` — `feat(07-01): add semantic-index-builder helpers`
- FOUND: `61b5aea` — `feat(07-01): extend MCPackEngine with non-blocking semantic index build`

All baseline tests still passing: 107/107.
All three [BLOCKING] gates pass against bec3f6f.
Build is ESM-only (no `.cjs` in dist/).

## Forward Link

Plan 07-02 will add `test/semantic-index-build.test.ts` covering the new
build pipeline (17 tests across 7 describe groups, including the negative-
control test for RESEARCH Pitfall 7 — proves `handleSearchTools` emits zero
new console.warn calls during build-pending state). Plan 07-02 restores
statement coverage to ≥99% and brings the test count from 107 → 124.
