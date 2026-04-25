---
phase: 01
phase_name: "foundation-and-leaf-modules"
project: "MCPack"
generated: "2026-04-25"
counts:
  decisions: 12
  lessons: 6
  patterns: 7
  surprises: 3
missing_artifacts: []
---

# Phase 01 Learnings: foundation-and-leaf-modules

## Decisions

### Import Tool type from MCP SDK deep subpath
Imported `Tool` type from `@modelcontextprotocol/sdk/types.js` despite it not being in the SDK's exports map.

**Rationale:** Works with `NodeNext` module resolution because tsc resolves through .d.ts files; required because the SDK does not surface `Tool` through its package-level exports.
**Source:** 01-01-SUMMARY.md

---

### Export tokenize() and STOP_WORDS from index-builder
Both `tokenize()` and the `STOP_WORDS` set are named exports from `src/index-builder.ts`.

**Rationale:** `search.ts` must reuse identical tokenization logic to keep query and index tokenization aligned (per Pitfall 6 in 01-RESEARCH.md). Sharing the same function avoids divergence between two tokenization paths.
**Source:** 01-01-SUMMARY.md

---

### Add @types/node as dev dependency for NodeJS.Timeout
Installed `@types/node` to type the session cleanup timer field as `NodeJS.Timeout`.

**Rationale:** Without Node types, `ReturnType<typeof setInterval>` resolves to `number`, which lacks `.unref()`. Required for type-safe access to `.unref()` on the cleanup timer per SESS-03.
**Source:** 01-02-SUMMARY.md

---

### Drop tier field from ToolIndexEntry
`ToolIndexEntry` does NOT have a `tier` field; role filtering happens at query time, not index time.

**Rationale:** Keeps the index immutable to role config; a single index serves all roles. Role filtering is recomputed per request, simplifying both the index shape and any future config-mutation behavior.
**Source:** 01-CONTEXT.md

---

### Separate schemaKeywords from keywords on ToolIndexEntry
`ToolIndexEntry` carries `keywords: string[]` (name + description tokens) and `schemaKeywords: string[]` (schema property tokens) as distinct fields.

**Rationale:** The two sources are scored at different weights (KEYWORD=2 vs SCHEMA_PROPERTY=1). Storing them separately keeps the scoring logic clean instead of mixing tokens and applying weights via different match paths at search time.
**Source:** 01-RESEARCH.md (Open Question 1 recommendation), 01-01-PLAN.md

---

### Locked five-tier score weights as internal constants
`EXACT_NAME=10, PARTIAL_NAME=5, DESCRIPTION=3, KEYWORD=2, SCHEMA_PROPERTY=1` as named non-exported constants in `src/search.ts`.

**Rationale:** Easily tunable before v1.1 if Stripe harness reveals poor relevance, but not user-configurable in v1 to keep the API surface minimal. Named constants improve readability over magic numbers.
**Source:** 01-CONTEXT.md, 01-02-PLAN.md

---

### Substring matching with includes(), no stemming or fuzzy matching
Search uses `String.prototype.includes()` for substring detection only; no Porter stemming, no Levenshtein, no regex.

**Rationale:** PRD-aligned simplicity for v1. Substring matching is also resilient against tokenization divergence between query and index (Pitfall 6 sidestepped).
**Source:** 01-CONTEXT.md, 01-RESEARCH.md (Pitfall 6)

---

### Zero-match returns empty array, not top-N fallback
If no tool scores > 0 for a query, `scoreAndRank` returns `[]`.

**Rationale:** No noisy "best guess" results polluting agent reasoning. Empty is honest signal.
**Source:** 01-CONTEXT.md

---

### Dual session cleanup: lazy + interval
Sessions are reaped via lazy expiry on every `getOrCreate()` call AND a 15-minute `setInterval` backstop with `.unref()`.

**Rationale:** Lazy alone misses abandoned sessions that never get queried again; interval alone delays reclaim of expired-but-just-accessed sessions. Combined, both abandoned and active sessions are cleaned within bounded time. `.unref()` ensures the interval does not block process exit.
**Source:** 01-CONTEXT.md, 01-RESEARCH.md (Pitfall 1)

---

### STDIO_SESSION_ID = '__stdio__' constant
Stdio transport sessions use a fixed `'__stdio__'` ID exported from `src/session.ts`.

**Rationale:** Stdio is single-session per process; needs a stable identifier. Using a recognizable sentinel string makes log inspection unambiguous (clearly a stdio session, not a missing HTTP session ID).
**Source:** 01-CONTEXT.md

---

### Secure-by-default role semantics
No `roles` config means all tools visible; roles configured but session role unknown means zero tools visible; no role on session with roles configured means zero tools visible.

**Rationale:** Asymmetric defaults — easy onboarding for users who don't need RBAC, fail-closed when RBAC is opted into. Wildcard `'*'` is the explicit opt-in for "all tools."
**Source:** 01-CONTEXT.md

---

### Public API exports nine types only
`src/index.ts` re-exports exactly: `MCPackConfig, MCPackServerConfig, MCPackToolDefinition, RoleConfig, IndexConfig, SessionConfig, SearchToolResponse, SearchResult, ToolCallResult`. `ToolIndexEntry`, `Session`, and score weight constants stay internal.

**Rationale:** Minimum public surface area reduces breakage risk on internal refactors. Internal types like `Session.queryLog` and `ToolIndexEntry` shape are implementation details that may change in v1.1+.
**Source:** 01-CONTEXT.md, 01-01-PLAN.md

---

## Lessons

### .gitignore is mandatory before first commit
First-commit blocking issue: `node_modules/` would have been tracked without `.gitignore`. Auto-fixed by creating `.gitignore` covering `node_modules/`, `dist/`, `coverage/` and folding into the Task 1 commit.

**Context:** Greenfield TypeScript project; not all phase planning templates list `.gitignore` as a Wave 0 artifact.
**Source:** 01-01-SUMMARY.md (Deviations from Plan)

---

### NodeJS.Timeout type requires @types/node even when only using setInterval
TypeScript compilation failed mid-Phase because `ReturnType<typeof setInterval>` resolves to `number` without Node type definitions, blocking access to `.unref()`.

**Context:** The plan did not call out `@types/node` in the dev-dep install list; this was discovered during implementation of `src/session.ts` and added as a deviation.
**Source:** 01-02-SUMMARY.md (Deviations from Plan)

---

### MCP SDK 1.27.1 declares peer deps not present in older STACK.md notes
`@cfworker/json-schema ^4.1.1` is required as a peer dep alongside `zod ^3.25 || ^4.0`; STACK.md did not list `@cfworker/json-schema` and listed only `zod ^3.25`.

**Context:** Pre-publish peer dep declaration must mirror the SDK's actual peers as of the targeted SDK version, not historical notes.
**Source:** 01-RESEARCH.md (State of the Art table)

---

### tsc resolves SDK deep subpaths via .d.ts even outside the exports map
`@modelcontextprotocol/sdk/types.js` is not in the SDK's package.json exports map but resolves successfully under `NodeNext` because tsc walks .d.ts files.

**Context:** Plan 01 anticipated this might be brittle; verified working at compile time.
**Source:** 01-01-SUMMARY.md (Decisions Made)

---

### ESM .js extensions on imports are non-negotiable under NodeNext
All intra-package imports use `.js` suffix (`from './types.js'`); without it, runtime fails with `ERR_MODULE_NOT_FOUND` despite a clean `tsc` build.

**Context:** Pitfall called out in research and enforced as an established pattern; no deviations occurred but it required explicit reminders in plan task instructions.
**Source:** 01-RESEARCH.md (Pitfall 2), 01-01-SUMMARY.md (patterns-established)

---

### ROLE-03 module-level satisfaction does not equal end-to-end satisfaction
The `total_available` count requirement was marked SATISFIED at module level (filtering logic is correct) but full enforcement requires the Phase 2 core engine to actually call `resolveRoleAccess` before computing the response.

**Context:** Verifier explicitly noted Phase 1 satisfies the contract for the role filter module only; the wire-up happens in a later phase. Important to distinguish module-correctness from system-correctness in verification reports.
**Source:** 01-VERIFICATION.md (Note on ROLE-03)

---

## Patterns

### Pure function modules
Stateless exports (no classes) for `index-builder.ts`, `search.ts`, `roles.ts`. Each module is a transformation: input -> output, no side effects.

**When to use:** Logic that doesn't manage lifecycle, timers, or persistent state. Default for transformation modules.
**Source:** 01-RESEARCH.md (Pattern 1), 01-01-SUMMARY.md (patterns-established)

---

### Stateful registry class
`SessionRegistry` class with private `Map<string, Session>` storage, owned timer, and `destroy()` for lifecycle/test teardown.

**When to use:** When a module owns mutable state plus a long-lived resource (timer, connection). The `destroy()` method is essential for clean test teardown and process shutdown.
**Source:** 01-RESEARCH.md (Pattern 2), 01-02-SUMMARY.md (patterns-established)

---

### Named score constants
Internal `const EXACT_NAME = 10` etc. instead of magic numbers in scoring logic.

**When to use:** Any weighted scoring or ranking where weights might be tuned. Keeps the algorithm readable and the weights co-located.
**Source:** 01-RESEARCH.md (Pattern 3), 01-02-SUMMARY.md (patterns-established)

---

### Recursive role resolution with visited Set
`getAllowedTools(role, roles, visited)` recurses through role inheritance; `visited.has(role)` short-circuits cycles. Wildcard `'*'` propagates up via early return.

**When to use:** Any hierarchical config resolution where users might create cycles (role inheritance, dependency graphs, includes). Always thread the visited set through recursion, never mutate a module-level set.
**Source:** 01-RESEARCH.md (Pitfall 4, Code Examples), 01-02-SUMMARY.md (patterns-established)

---

### Defense-in-depth helper
`isToolAllowed(toolName, role, roles)` — a separate helper used at the call site (Phase 2 `tools/call`) in addition to filtering at search time.

**When to use:** When filtering at one entry point isn't sufficient because callers can bypass it (e.g., directly invoking a tool by name without searching first). Pair list-filtering with per-call enforcement.
**Source:** 01-CONTEXT.md, 01-02-SUMMARY.md (patterns-established)

---

### Type separation: public vs internal
Public types re-exported from `src/index.ts`; internal types stay only in `src/types.ts`. Single source file for types, single re-export file for public surface.

**When to use:** Library projects with a stable public API and evolving internal types. Lets internal refactors proceed without semver consequences.
**Source:** 01-01-SUMMARY.md (patterns-established)

---

### Test directory mirrors src
`test/` directory with one `.test.ts` file per `src/` module (1:1).

**When to use:** Default for any module-per-file codebase. Discoverability is trivial — find tests by mirroring the source path.
**Source:** 01-01-SUMMARY.md (patterns-established)

---

## Surprises

### Two trivial-looking deviations were both blocking
Plan 01 (`.gitignore`) and Plan 02 (`@types/node`) each had one auto-fixed blocking deviation despite the phase being heavily pre-decided in CONTEXT.md.

**Impact:** Both were small additions with zero scope creep, but they confirm that even greenfield Wave-0 setup can miss table-stakes items. Future phases should explicitly checklist `.gitignore` and `@types/node` for any Node TypeScript project.
**Source:** 01-01-SUMMARY.md, 01-02-SUMMARY.md

---

### Extremely fast execution time
Plan 01 took 5 minutes (started 06:25:21Z, completed 06:30:12Z); Plan 02 took 5 minutes (06:33:14Z to 06:38:00Z). Together: ~10 minutes for the full foundation phase including 38 tests.

**Impact:** Highly-specified CONTEXT.md (locked decisions, exact constants, exact algorithms) collapses execution time to near-typing-speed. Suggests heavy pre-decision work pays off; under-specified phases will not be this fast.
**Source:** 01-01-SUMMARY.md, 01-02-SUMMARY.md (Performance sections)

---

### Substring includes() sidesteps tokenization-divergence pitfall
Pitfall 6 (query tokenizer diverging from index tokenizer producing zero results on exact name queries) is largely mooted because `includes()` matches substrings on the raw lowercased name even if tokenization paths differ.

**Impact:** A safety net the design didn't explicitly plan for. The locked CONTEXT.md decision to use `includes()` (chosen for simplicity) also reduced an entire class of bugs the research had flagged as a real risk.
**Source:** 01-RESEARCH.md (Pitfall 6 — "Or ensure the search uses includes() substring matching which sidesteps this for most cases")

---
