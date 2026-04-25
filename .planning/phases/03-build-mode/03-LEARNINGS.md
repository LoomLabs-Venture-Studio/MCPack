---
phase: 03
phase_name: "build-mode"
project: "MCPack"
generated: "2026-04-25"
counts:
  decisions: 12
  lessons: 5
  patterns: 7
  surprises: 3
missing_artifacts: []
---

# Phase 03 Learnings: build-mode

## Decisions

### MCPackHandlerContext is required (not optional) on handler signature
Handlers always receive a `MCPackHandlerContext { toolName, sessionId, role }` as the second argument. The shape is locked at v1; the type is non-optional and the API has no backward-compatibility consumers to worry about.

**Rationale:** Required context simplifies handler implementations (no defensive `ctx?.` checks) and is forward-compatible for future additions (requestId, timestamp, retryCount) as optional fields. Captured verbatim in HANDOFF/STATE: "MCPackHandlerContext required on handler — handlers always receive context."
**Source:** 03-CONTEXT.md, 03-01-SUMMARY.md, STATE.md

### Handler returns `Promise<unknown>` (not `Promise<ToolCallResult>`)
The `MCPackToolDefinition.handler` signature is `(args, ctx) => Promise<unknown>`. `build.ts` normalizes whatever the handler returns into a ToolCallResult shape.

**Rationale:** Allows handlers to return strings, plain objects, null/undefined, or full ToolCallResult shapes — `build.ts` does the work of converting via `normalizeResult`. Handler authors don't have to construct MCP envelopes by hand.
**Source:** 03-01-PLAN.md, 03-01-SUMMARY.md, 03-CONTEXT.md

### Throw on empty tools (replaces Phase 2's console.warn-and-proceed)
Both modes now throw when no tools are present at setup. Wrap mode: `MCPack: no tools found on server. Ensure tools are registered before calling mcpack()`. Build mode: `MCPack: config.tools is empty. Provide at least one tool definition.`

**Rationale:** MCPack builds a static index at setup. Dynamic tool registration after setup never appears in search results, so an empty array at setup is unambiguously a developer mistake — fail loudly rather than ship a broken server.
**Source:** 03-CONTEXT.md, 03-01-SUMMARY.md, STATE.md

### Tool name embedded in error messages (`Tool "${name}" failed: ${message}`)
Both wrap and build mode catch handler exceptions and format `Tool "${name}" failed: ${err.message ?? 'Unknown error'}` in the error result.

**Rationale:** Generic "Tool execution failed" messages make debugging harder. Including the tool name in every error message gives operators an immediate hook for log searches and incident triage.
**Source:** 03-CONTEXT.md, 03-01-PLAN.md, 03-RESEARCH.md (Pitfall 5)

### Config snapshot at setup (`{ ...config.roles }` + capture `defaultRole`)
Both modes shallow-copy `config.roles` and capture `config.defaultRole` once at setup, then use the snapshots inside handler closures.

**Rationale:** JavaScript passes objects by reference. Without snapshotting, a user mutating `config.roles` post-setup silently changes runtime RBAC behavior. Defensive library code immutably snapshots external input.
**Source:** 03-CONTEXT.md, 03-01-SUMMARY.md, 03-RESEARCH.md (Pitfall 3), STATE.md

### Mark tools as loaded on direct `tools/call` (both modes)
After a successful (non-`search_tools`) `tools/call`, both wrap and build mode invoke `engine.markToolLoaded(name, sessionId)` to add the tool to the session's `loadedTools` set.

**Rationale:** Agents that bypass `search_tools` and call a tool directly would otherwise leave the session registry inaccurate. Tracking direct calls keeps the "loaded" state honest for follow-up `search_tools` responses.
**Source:** 03-CONTEXT.md, 03-RESEARCH.md, 03-01-PLAN.md

### `markToolLoaded` lives on MCPackEngine (not exposed sessions field)
Added a public `markToolLoaded(toolName, sessionId)` method to `MCPackEngine` rather than exposing the private `sessions` registry to wrap.ts/build.ts.

**Rationale:** Both modes need session tracking; exposing internals would duplicate session logic and break the engine's encapsulation. A single method keeps `sessions` private and the API surface clean.
**Source:** 03-RESEARCH.md (Pattern 4), 03-01-PLAN.md

### Dispatch map built once at setup (O(1) handler routing)
Build mode constructs a `Map<string, handler>` from `config.tools` at setup, not per-call. The map lives in `build.ts` only; `MCPackEngine` stays mode-agnostic.

**Rationale:** O(1) lookup beats per-call linear scans. Keeping dispatch out of the engine preserves the engine's single responsibility (search/session/role) and avoids leaking build-mode concerns into shared code.
**Source:** 03-CONTEXT.md, 03-02-SUMMARY.md, 03-RESEARCH.md (Pattern 1)

### `createMCPackServer` is synchronous
Build mode entry point is a synchronous function returning `MCPackServer { server, handle }` directly — not a Promise.

**Rationale:** Wrap mode is async because it must `await` the original `tools/list` to capture existing tools. Build mode constructs everything from config — no handler capture needed, so async would be ceremony without benefit.
**Source:** 03-CONTEXT.md, 03-02-SUMMARY.md, 03-RESEARCH.md (Pitfall 4)

### Strip `handler` property before passing tools to MCPackEngine
`config.tools.map(({ handler, ...tool }) => tool)` produces clean `Tool[]` for the engine. Handlers stay in the dispatch map.

**Rationale:** `MCPackEngine` expects `Tool[]`, not `MCPackToolDefinition[]`. Including handler functions would either serialize as `[Function]` in search responses or trip type errors. Destructuring rest is the cleanest mechanical fix.
**Source:** 03-CONTEXT.md, 03-RESEARCH.md (Pitfall 1, Pattern 3)

### `normalizeResult` returns `any` (not `ToolCallResult`)
Auto-fix discovered during execution: `normalizeResult` was typed as returning `ToolCallResult`, but the SDK's `setRequestHandler` callback expects a value compatible with `ServerResult` (which has an index signature). Changed return type to `any`.

**Rationale:** `ToolCallResult` lacks the `[x: string]: unknown` index signature SDK's `ServerResult` requires. Widening to `any` was the minimal fix; runtime behavior is unchanged. Keeps the type system happy without bloating the public type with SDK-internal shape requirements.
**Source:** 03-02-SUMMARY.md (Auto-fixed Issues #1)

### Explicit null guard `== null` over nullish coalescing `??`
Both modes use `(request.params.arguments == null ? {} : request.params.arguments)` for argument defaulting, not `request.params.arguments ?? {}`.

**Rationale:** Behaviorally identical for null/undefined, but the explicit `== null` form communicates intent more clearly in code review and matches the project's documented style for defensive guards.
**Source:** 03-CONTEXT.md, 03-RESEARCH.md (Pitfall 2)

---

## Lessons

### MCP SDK's `Server` is `@deprecated` but still required
`McpServer` is the high-level replacement, but it does not expose `setRequestHandler()` — the exact mechanism MCPack relies on for handler interception. Both wrap and build mode must continue using the low-level `Server` class.

**Context:** Discovered during research; addressed by adding deprecation-awareness comments in both `wrap.ts` and `build.ts` and a "Known Risks" note in the spec. The deprecation is informational, not blocking — both classes still work in v1.x of the SDK.
**Source:** 03-CONTEXT.md, 03-RESEARCH.md (State of the Art)

### Updating an existing test is part of "throw instead of warn" changes
When wrap mode's empty-tools handling changed from `console.warn` to `throw`, the existing test at `test/wrap.test.ts:191-210` had to be rewritten from a `console.warn` spy assertion to `expect(...).rejects.toThrow(...)`. Forgetting this would have produced a red test against correct code.

**Context:** Listed explicitly in 03-RESEARCH.md as Pitfall 6. Easy to miss when behavior changes are scoped narrowly. Plan 03-01 made the test update a first-class deliverable rather than a side effect.
**Source:** 03-RESEARCH.md (Pitfall 6), 03-01-PLAN.md

### Wrap mode does not directly use `MCPackHandlerContext` despite importing the type
Wrap mode proxies tool calls to the original handler unchanged — it never constructs an `MCPackHandlerContext` because the original server's handlers don't know about MCPack's type. Only build mode passes the context to user handlers.

**Context:** Surfaced in 03-VERIFICATION.md key-link review: the planned `types.ts -> wrap.ts` link via `MCPackHandlerContext` did not actually wire because wrap mode preserves original handler signatures. Verifier flagged it as CORRECT (not a defect) — wrap mode legitimately doesn't need it.
**Source:** 03-VERIFICATION.md (Key Link Verification table)

### Two MCPack modes share one engine, but only one uses normalization
`normalizeResult` is build-mode-only. Wrap mode's tools/call path always proxies to the original handler, which already returns a fully-formed MCP response — no normalization needed. Don't extract `normalizeResult` into a shared module just because both modes "feel similar."

**Context:** 03-RESEARCH.md "Open Question 2" considered extracting shared helpers. The recommendation was to keep `normalizeResult` build-mode-local; the error format `Tool "${name}" failed:` is a one-liner not worth extracting.
**Source:** 03-RESEARCH.md (Open Questions)

### Plan execution speed is real (2 minutes per plan, end-to-end)
Both Plan 03-01 (4 files modified, 6 correctness fixes + types) and Plan 03-02 (2 files created, 1 modified, full TDD red/green cycle) completed in ~2 minutes each. Tight CONTEXT.md decisions plus locked PLAN.md must-haves let the executor work without midstream design choices.

**Context:** Recorded in both summaries' Performance sections. Suggests the upfront cost of locking decisions in CONTEXT.md pays back many-fold during execution. Phase 03 totals ~4 minutes for 7 files modified/created.
**Source:** 03-01-SUMMARY.md, 03-02-SUMMARY.md (Performance sections)

---

## Patterns

### Config snapshot pattern
Snapshot mutable config (`config.roles`, `config.defaultRole`) at setup time using shallow spread; reference snapshots inside handler closures, never live config.

**When to use:** Any library entry point that takes user config containing objects that will be read on every request. Especially relevant when external mutation could silently change behavior (RBAC, routing tables, feature flags).
**Source:** 03-CONTEXT.md, 03-RESEARCH.md (Pattern 5), 03-01-SUMMARY.md (patterns-established)

### Tool name in error messages
Format all tool-execution error responses as `Tool "${name}" failed: ${err.message ?? 'Unknown error'}` — applied uniformly across wrap and build modes.

**When to use:** Any handler dispatch that can throw and produces user-facing error envelopes. Embed the dispatch key (tool name, route, command, etc.) so log search and incident triage have an immediate hook.
**Source:** 03-CONTEXT.md, 03-RESEARCH.md (Pitfall 5), 03-01-SUMMARY.md (patterns-established)

### Dispatch map for handler routing
Build a `Map<string, handler>` at construction time from a static config array; look up handlers by key at request time. Warn on duplicates, last-write-wins.

**When to use:** Any system that routes by string key from a config-supplied list. O(1) lookup, single allocation, dead simple to reason about. Keep the map module-private to preserve encapsulation.
**Source:** 03-RESEARCH.md (Pattern 1), 03-02-SUMMARY.md (patterns-established)

### Result normalization helper
A single `normalizeResult(value: unknown)` that maps null/undefined → empty text, string → text content, ToolCallResult-shaped (has `content` array) → passthrough, other object → JSON.stringify.

**When to use:** Any system whose user-supplied callbacks should be allowed to return arbitrary shapes that you then translate to a fixed wire envelope. Lowers user friction without coupling the public API to the wire format.
**Source:** 03-RESEARCH.md (Pattern 2), 03-02-SUMMARY.md (patterns-established)

### Engine method over exposed field for shared mutation
When two adapter modules (wrap.ts, build.ts) both need to mutate the same internal state (sessions), add a public method on the engine (`markToolLoaded`) rather than exposing the field.

**When to use:** Any time you'd be tempted to make a private collection public so two callers can poke at it. A method preserves encapsulation, centralizes the mutation logic (here: session resolution + role defaulting), and gives you one place to add invariants.
**Source:** 03-RESEARCH.md (Pattern 4), 03-01-SUMMARY.md

### Handler stripping via destructuring rest
Use `config.tools.map(({ handler, ...tool }) => tool)` to remove the `handler` field from each definition before passing the array to a downstream consumer that expects the parent type.

**When to use:** Whenever an enriched type extends a base type with extra fields (handlers, callbacks, metadata) and a downstream consumer wants the clean base. Clearer than manual property pickers; TypeScript-friendly.
**Source:** 03-CONTEXT.md, 03-RESEARCH.md (Pattern 3, Pitfall 1)

### Two-phase plan structure for entry-point work
Wave 1: foundation (types + correctness fixes to existing code). Wave 2: new entry point built on top. Each wave fully tested before the next starts.

**When to use:** When adding a new module that depends on type/contract changes in existing code. Doing both in one plan creates execution coupling and harder-to-review diffs; splitting lets Wave 1 verify independently before Wave 2 layers on.
**Source:** 03-CONTEXT.md (Plan Structure), 03-RESEARCH.md

---

## Surprises

### TypeScript compilation error from SDK type strictness on `normalizeResult`
The first cut of `normalizeResult` typed its return as `ToolCallResult`. `tsc --noEmit` then failed at the `setRequestHandler` callback site: SDK's `ServerResult` requires an index signature (`[x: string]: unknown`) that `ToolCallResult` lacks. Fixed by widening to `any`.

**Impact:** One auto-fixed issue logged in Plan 03-02. No behavioral change — the runtime envelope is correct; only the type system was unhappy. Lesson: SDK-facing callbacks may have stricter type contracts than your domain types; widening at the boundary is acceptable.
**Source:** 03-02-SUMMARY.md (Deviations from Plan / Auto-fixed Issues)

### Plan 03-01 had zero deviations and zero issues
Plan 03-01 (types + 6 correctness fixes to wrap.ts + test updates, across 4 files) executed exactly as planned with no auto-fixes, no deviations, and no issues encountered. Total elapsed time was ~2 minutes.

**Impact:** Validates the upfront investment in CONTEXT.md decisions and PLAN.md must-haves. The richer the lock-down before execution, the cleaner the run.
**Source:** 03-01-SUMMARY.md (Deviations from Plan, Issues Encountered)

### Full test suite jumped from 70 to 91 tests with one plan
Plan 03-02 added 21 new build-mode tests in a single TDD pass (RED commit `81e9864`, GREEN commit `167e6fa`). The suite jumped from 70 → 91 tests with no regressions in the existing 70.

**Impact:** Confirms the test infrastructure (vitest helpers, Server creation, getHandler, makeExtra) was reusable enough to scale build-mode testing without dedicated harness work. Reuse of `test/wrap.test.ts` patterns paid off immediately.
**Source:** 03-02-SUMMARY.md (Accomplishments, Task Commits)
