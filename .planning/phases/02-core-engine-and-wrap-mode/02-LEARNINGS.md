---
phase: 02
phase_name: "core-engine-and-wrap-mode"
project: "MCPack"
generated: "2026-04-25"
counts:
  decisions: 8
  lessons: 4
  patterns: 7
  surprises: 2
missing_artifacts: []
---

# Phase 02 Learnings: core-engine-and-wrap-mode

## Decisions

### MCPackEngine is internal — not exported from package entry point
The `MCPackEngine` class composing all four leaf modules is kept module-internal; consumers interact only through the `mcpack()` handle.

**Rationale:** Users should not construct the engine directly — they go through `mcpack()` (and later `createMCPackServer()`), which guarantees lifecycle management via `MCPackHandle`. Hiding the class preserves freedom to refactor internals.
**Source:** 02-01-SUMMARY.md, STATE.md

### errorResult helper is a module-level function, not a class method
The `errorResult(message)` helper that produces `{ content: [{ type: 'text', text }], isError: true }` lives at module scope inside `src/core.ts` rather than as a static method on `MCPackEngine`.

**Rationale:** Simplicity — it's a pure shape-builder with no dependency on engine state, so a free function is lighter than a static method.
**Source:** 02-01-SUMMARY.md, 02-01-PLAN.md

### Handler capture via private `_requestHandlers` Map with defensive shape check
Wrap mode reaches into the SDK `Server`'s private `_requestHandlers: Map<string, RawHandler>` to capture the existing `tools/list` and `tools/call` handlers before replacing them. A defensive null check throws a clear error if the SDK shape changes.

**Rationale:** The MCP SDK exposes no public hook for intercepting handlers. Walking the private Map is the only way to wrap an existing server in one call. The defensive check yields an actionable error rather than a cryptic crash if the SDK ever changes its internals.
**Source:** 02-02-SUMMARY.md, 02-02-PLAN.md, STATE.md

### Call-and-capture invokes original `tools/list` handler with a synthetic `extra` object
Rather than asking the user to pass tool definitions, `mcpack()` calls the captured `tools/list` handler internally with a fabricated `extra` (AbortController signal, requestId 0, no-op `sendNotification`/`sendRequest`) to snapshot the tool set.

**Rationale:** Keeps the wrap API to a single call — no need for the user to duplicate their tool list at wrap time. The synthetic `extra` satisfies the SDK handler signature without needing a live transport.
**Source:** 02-02-SUMMARY.md, 02-02-PLAN.md

### Fallback to `config.tools` when original handler throws or returns empty
If the captured `tools/list` handler throws or returns an empty array, wrap mode falls back to `config.tools` if provided; otherwise it logs a console.warn and proceeds with an empty index.

**Rationale:** Recovery path for servers whose handler isn't safe to invoke pre-connect, while still failing visibly (warn) when no tools can be discovered at all.
**Source:** 02-02-SUMMARY.md, 02-02-PLAN.md, STATE.md

### Defense-in-depth role check at `tools/call`, not just `tools/list`
Even though `search_tools` already filters out disallowed tools by role, the `tools/call` interceptor re-invokes `isToolAllowed()` before proxying to the original handler.

**Rationale:** Defense in depth — a caller could guess a tool name that was never returned by search. Re-checking at the call site prevents bypass and matches the deliberately opaque `"Unknown tool: {name}"` denial style.
**Source:** 02-02-SUMMARY.md, 02-02-PLAN.md, 02-VERIFICATION.md

### Session ID resolution delegated to engine, not duplicated in wrap.ts
`wrap.ts` reads `extra.sessionId` and forwards it (possibly undefined) to `engine.handleSearchTools(args, sessionId)`. The fallback to `STDIO_SESSION_ID` (`'__stdio__'`) lives only in `core.ts`.

**Rationale:** Single owner of the fallback rule — both wrap and build modes will share the engine, so centralizing the fallback there avoids drift between modes.
**Source:** 02-VERIFICATION.md (note on STDIO_SESSION_ID)

### `SessionRegistry.size` getter rather than direct Map exposure
A `get size(): number` getter was added to `SessionRegistry` so `MCPackEngine.stats()` can report session count without exposing the internal `sessions` Map.

**Rationale:** Encapsulation — `stats()` needs only the count; exposing the Map would leak implementation details and let callers mutate the registry.
**Source:** 02-01-PLAN.md, 02-01-SUMMARY.md

---

## Lessons

### Internal classes are still testable
`MCPackEngine` is not exported from the package entry point but is fully unit-tested in `test/core.test.ts` by importing directly from `src/core.ts`. The plan explicitly notes: "Tests should instantiate MCPackEngine directly (it's internal but testable)."

**Context:** Public-API hygiene and test coverage are independent concerns — keeping a class out of the public surface doesn't preclude direct unit tests against it.
**Source:** 02-01-PLAN.md

### Vitest mocking helpers must be explicitly imported
Task 1 of Plan 02 used `vi.spyOn` in tests but missed importing `vi` from `vitest`. The mistake surfaced during the TDD GREEN run and was auto-fixed.

**Context:** Vitest's `vi` namespace is not auto-imported. Each new test file that uses spies/mocks needs an explicit `import { vi } from 'vitest'`.
**Source:** 02-02-SUMMARY.md (Deviations from Plan)

### Real MCP SDK `Server` instances are usable in unit tests without a transport
`test/wrap.test.ts` constructs real SDK `Server` instances and exercises the replaced handlers by reaching into `(server as any)._requestHandlers` directly — no transport mock required.

**Context:** This shortcut means wrap-mode integration tests stay fast (~3s for the whole suite) and don't depend on stdio/HTTP plumbing.
**Source:** 02-VERIFICATION.md, 02-02-PLAN.md

### Plans this small executed in 2 minutes each, exactly as written
Both plans (02-01 and 02-02) shipped in 2 minutes each with zero deviations on Plan 01 and one trivial auto-fix on Plan 02.

**Context:** When the plan supplies the full code skeleton with imports, signatures, and step-by-step implementation, execution time collapses to type-and-verify. Heavy upfront planning paid off in execution speed.
**Source:** 02-01-SUMMARY.md, 02-02-SUMMARY.md

---

## Patterns

### Engine pattern: class composes leaf modules via constructor injection
A single class (`MCPackEngine`) holds references to all leaf modules (index, search, session, roles) created in its constructor, exposing high-level methods (`handleToolsList`, `handleSearchTools`, `destroy`, `stats`).

**When to use:** When multiple entry points (wrap mode + build mode) need to share the same orchestration logic — put the orchestration in a class and let each entry point be a thin adapter.
**Source:** 02-01-SUMMARY.md (patterns-established)

### Session-gated schema delivery
First call returns full schema with `loaded: false`; subsequent calls for the same `(session, tool)` return `{ loaded: true }` with no schema payload, after recording the tool in `session.loadedTools`.

**When to use:** Any discovery interface where the same client repeatedly searches for the same resource — return the heavyweight payload once, then return a lightweight reference.
**Source:** 02-01-SUMMARY.md (patterns-established), 02-01-PLAN.md

### Uniform error shape via helper
All tool errors return `{ content: [{ type: 'text', text }], isError: true }`. A module-level `errorResult(message)` helper produces this shape at every error site.

**When to use:** Any handler returning structured error responses — central a single shape-builder so callers can rely on the contract.
**Source:** 02-01-SUMMARY.md (patterns-established)

### Wrap pattern: capture original, replace with interceptor, return control handle
Three steps: (1) capture the original handler from a private registry, (2) replace it with an interceptor that may delegate to the original, (3) return a `Handle` object that can `destroy()` and report `stats()` later.

**When to use:** Retrofitting cross-cutting behavior (logging, RBAC, discovery) onto an existing object that exposes its handlers via a registry rather than via a public hook API.
**Source:** 02-02-SUMMARY.md (patterns-established)

### Call-and-capture for snapshotting state from existing handler
Invoke an existing handler with a fabricated context object (synthetic `extra` with AbortController signal, no-op send-fns) to capture its output without needing the live transport.

**When to use:** When you need to read the current return value of a handler at setup time but the handler signature requires a runtime-only context object. Provide minimal stubs that satisfy types without needing real transport.
**Source:** 02-02-SUMMARY.md (patterns-established), 02-02-PLAN.md

### Single interceptor with name-based routing
One `tools/call` handler branches on `request.params.name === 'search_tools'`: route to engine for search, otherwise role-check then proxy to the original.

**When to use:** When the new behavior introduces exactly one synthetic operation alongside the legacy set — a single dispatcher is simpler than registering separate per-name handlers.
**Source:** 02-02-SUMMARY.md (patterns-established)

### Session ID resolution: extra.sessionId with STDIO_SESSION_ID fallback
Read `extra.sessionId`; if absent, fall back to the constant `'__stdio__'` so single-process stdio servers still get a stable session.

**When to use:** Any per-request state that should bind to a session when one exists but degrade gracefully to a process-wide singleton when the transport doesn't supply one.
**Source:** 02-02-SUMMARY.md (patterns-established)

---

## Surprises

### `wrap.ts` does not need to import `STDIO_SESSION_ID` directly
The plan's `key_links` did not require wrap.ts to import `STDIO_SESSION_ID`; the verification report explicitly notes this is correct because the fallback is fully delegated to `engine.handleSearchTools`. Wrap.ts simply forwards a possibly-undefined sessionId.

**Impact:** Cleaner separation — wrap.ts has no dependency on the session-fallback constant. The verifier had to call this out explicitly because the absence of the import looked like a missed link at first glance.
**Source:** 02-VERIFICATION.md (note on STDIO_SESSION_ID)

### Zero anti-patterns and zero human verifications required across both plans
The verification scan found no TODO/FIXME/placeholder comments, no empty implementations, no stub returns, and concluded "Human Verification Required: None" — every observable behavior was exercised by automated tests.

**Impact:** All 11 must-have truths verified by the test suite alone (68 tests, 0 failures). Phase 02 reached PASSED status without manual checks, supporting the project pattern of treating types and tests as the lint layer.
**Source:** 02-VERIFICATION.md
