---
phase: 09-tool-usage-analytics-v1-1
reviewed: 2026-04-26T02:30:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - src/analytics-store.ts
  - src/core.ts
  - src/wrap.ts
  - src/build.ts
  - src/types.ts
  - src/index.ts
  - test/analytics-store.test.ts
  - test/analytics-integration.test.ts
findings:
  blocker: 0
  warning: 6
  info: 4
  total: 10
status: issues_found
---

# Phase 9: Code Review Report

**Reviewed:** 2026-04-26
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Phase 9 ships a clean, well-documented analytics module that satisfies the core RBAC integrity, privacy, and dead-tool requirements. Static checks confirm:

- `setRequestHandler` is never wired with `getAnalytics` (REQ-v11-analytics-rbac-integrity holds — `grep -E "setRequestHandler.*[Aa]nalytics" src/` returns zero matches).
- `tools/list` continues to return exactly one tool (`search_tools`) — verified by Pr6 test.
- `console.warn` site count is unchanged from the Phase 8 baseline (5 sites: 2 in build.ts, 1 in wrap.ts, 2 in core.ts) — no new operator-noise channels.
- Phase 8 carry-forward is intact: `hasVectors()`, `isIndexReady()`, and the WR-02 unhandled-rejection regression tests in `test/hybrid-ranking.test.ts` (lines 258, 885, 911) are present and unchanged.
- 229 tests pass under `npm test` (added 42 in Phase 9: 20 unit + 22 integration).

The findings below are correctness and robustness concerns. Two warnings (WR-01, WR-02) are behavioral defects that change the meaning of operator-facing analytics counters; the rest are robustness and reference-aliasing risks.

## Warnings

### WR-01: Operator-unscoped per-role summary silently zeros most denialCount values

**File:** `src/analytics-store.ts:131,186-216`
**Issue:** `snapshot()` claims per-role summaries in the operator-unscoped view use the FULL event log to give "accurate per-role counts" (comment at line 126-130), but the predicate inside `summarizeForRole` still applies `isToolAllowed(event.tool, role, rolesConfig)` to every `call`/`denial` event. By definition, a `denial` event is recorded **because** the tool was NOT allowed for the role (`!isToolAllowed(...)` is the trigger at `wrap.ts:109` and `build.ts:121`). So the same predicate that admits the event into role-scoped *queries* also rejects it from the per-role *summary*: the operator-unscoped `byRole.reader.denialCount` is mathematically forced to 0 for any non-wildcard role, even when `op.denials` clearly contains denial events for that role.

This contradicts the documented intent — operators reading `summary.byRole.reader.denialCount` will see zero and conclude the role experienced no denials, while `op.denials` simultaneously lists multiple denials with `role: 'reader'`. The mismatch is silent, undocumented, and not covered by any test (the existing summary test at line 220-234 only uses `admin` with wildcard, where the filter is a no-op).

**Fix:**

```ts
} else if (e.type === 'denial') {
  // Denials are emitted precisely BECAUSE the tool wasn't in the role's
  // allowed set — counting denials for role R requires matching event.role,
  // not isToolAllowed(event.tool, R, ...). Otherwise denialCount is forced
  // to zero for every non-wildcard role.
  if (e.role === role) {
    denialCount++;
  }
}
```

The same correction may apply to `callCount` if call events for *foreign* roles must be excluded from a per-role summary; currently the call branch is consistent with isToolAllowed semantics (a successful call implies the tool was allowed). The two branches should be reasoned about explicitly, not collapsed under one predicate. Decide whether `byRole.X` is "events authored by role X" (use `event.role === X`) or "events involving tools visible to X" (use `isToolAllowed`); the current code mixes them in a way that produces nonsense for the denial axis.

Add a regression test that asserts `op.summary.byRole.reader.denialCount > 0` when reader was denied a tool, and the matching role-scoped invariant.

---

### WR-02: `wrap.ts` and `build.ts` emit `call` events for clean-error returns (`isError: true`)

**File:** `src/wrap.ts:141-153`, `src/build.ts:154-172`
**Issue:** Both dispatch paths emit a `call` event whenever the underlying handler RETURNS (i.e., does not throw). The MCP convention is for handlers to return `{ isError: true, content: [...] }` for tool-level errors (validation failures, downstream API errors, etc.) without throwing — the SDK does not coerce these into rejections. The Phase 9 emission comment explicitly promises "success path only — failures in the catch branch DO NOT emit per CONTEXT.md", but in practice a handler that cleanly reports failure via `isError: true` is counted as a successful call AND the tool is `markToolLoaded`'d.

Consequences:
1. `topTools` and `callCount` are inflated by clean-error returns.
2. `markToolLoaded` is called for failed invocations, prematurely consuming the session's "schema delivered" gate, so the next successful call returns `{loaded: true}` without the schema.
3. The integration test at `test/analytics-integration.test.ts:163-184` only exercises the THROW path; it does not catch this clean-error case.

**Fix:**

```ts
const result = await originalCallHandler(request, extra);
const sessionId = (extra as any).sessionId as string | undefined;
const isCleanError =
  result &&
  typeof result === 'object' &&
  (result as any).isError === true;
if (!isCleanError) {
  engine.markToolLoaded(name, sessionId);
  engine.analytics.record({
    type: 'call',
    tool: name,
    role: defaultRole ?? '',
    ts: Date.now(),
  });
}
return result;
```

Apply the same guard in `build.ts` after `await handler(args, ctx)`. Add a regression test: a handler that returns `{ isError: true, content: [...] }` (without throwing) MUST NOT produce a `call` event AND MUST NOT mark the tool loaded.

---

### WR-03: Snapshot leaks event-internal `tools[]` array by reference

**File:** `src/analytics-store.ts:111`
**Issue:** When bucketizing search events into the snapshot, `searches.push({ query: e.query, role: e.role, tools: e.tools, ts: e.ts })` aliases the original `tools` array from the underlying stored event. A consumer that mutates the snapshot's `searches[i].tools` (e.g., `.push(...)`, `.sort()`, `.length = 0`) directly mutates the stored event. This breaks the documented "computed on each call" contract and creates a subtle state-leak vector across snapshot consumers. All other snapshot fields (`topTools`, `deadTools`) are freshly computed and safe; only this one leaks.

**Fix:**

```ts
searches.push({
  query: e.query,
  role: e.role,
  tools: e.tools.slice(),
  ts: e.ts,
});
```

A single `.slice()` is O(k) where k is the search result count (≤ maxResults, typically ≤ 10), negligible. Add a unit test that mutates `snap.searches[0].tools` and re-snapshots to confirm the second snapshot is unaffected.

---

### WR-04: Empty-string `role` ('') silently surfaces in `summary.byRole`

**File:** `src/analytics-store.ts:242-249`, `src/types.ts:174-175`
**Issue:** `collectRoles()` adds every event's `role` field — including `''` (the convention for "no defaultRole configured" at `core.ts:288,296`, `wrap.ts:115,132,150`, `build.ts:127,145,169`) — to the byRole summary set. Operator unscoped snapshots will therefore expose a `byRole[""]: {...}` key, which:

1. Is non-obvious to consumers — JSON serialization shows `"": {...}` which most JSON viewers render strangely.
2. Pollutes the role list when `rolesConfig` is undefined (every event has `role: ''` and the empty key is the only key).
3. Has no documented public name. The comment in `collectRoles` says "Empty-string role ... is included if any event used it — it represents 'no role configured.'" but `AnalyticsByRoleSummary` JSDoc and the integration tests are silent on this.

**Fix:** Either (a) skip empty-string roles in `collectRoles` and document the omission in the public JSDoc, (b) normalize empty-string to a sentinel like `'<no-role>'` at emission time so the byRole key is at least readable, or (c) explicitly document the empty-string convention in `AnalyticsSnapshot` JSDoc and add a test asserting `byRole[""]` exists when `defaultRole` is absent. Whatever the choice, the current behavior should be made explicit because operators will hit it in production any time `defaultRole` is omitted.

---

### WR-05: Test-only `clear()` is publicly callable from any holder of the engine reference

**File:** `src/analytics-store.ts:146-148`
**Issue:** `clear()` is documented `@internal For test fixtures only` but is a plain `public` method on `AnalyticsStore`. Combined with `MCPackEngine.analytics` being `public readonly` (`core.ts:54`), any host-process code that holds a `handle` and reaches into `engine.analytics.clear()` via internal access can wipe the audit log. There is no public way to do this through the documented API surface (`MCPackHandle` does not expose `analytics` or the engine), but the JSDoc and the `public` keyword are inconsistent.

This is not a security issue (the host process is trusted), but it is a TypeScript hygiene issue that masks the intent. If future refactors expose `engine` for any reason, `clear()` becomes a footgun.

**Fix:** Either rename to `_clearForTesting` (Hungarian-style internal marker), or guard with a runtime check, or accept the public surface and update the JSDoc to match. The simplest fix is to drop the comment "Production code does not call this." in favor of a clear "Public test hook; safe to call from host code if needed." The mismatch between `public` and `@internal` is the actual defect.

---

### WR-06: Unbounded query/tool-name lengths can balloon analytics memory beyond `maxEvents`

**File:** `src/analytics-store.ts:54-59`, `src/core.ts:284-298`, `src/wrap.ts:112-152`, `src/build.ts:124-171`
**Issue:** `maxEvents` bounds event COUNT but not event SIZE. An attacker (or a malformed agent) calling `tools/call` with a very long `name` argument or `search_tools` with a very long `query` argument creates events that retain those strings indefinitely until eviction. With `maxEvents=10000`, a 1MB query string in every event consumes ~10GB of resident memory. Standard memory-bound caps would either truncate inputs (`name.slice(0, 256)`, `query.slice(0, 1024)`) or use a byte-budget retention policy.

This is a defensive concern, not a correctness one — typical MCP traffic stays under reasonable lengths and trusted hosts won't see this — but it interacts badly with the "in-memory only" durability model: a single noisy day can OOM the host process even though `maxEvents` looks bounded.

**Fix:** Apply a reasonable per-field cap at emission time:

```ts
const TOOL_NAME_MAX = 256;
const QUERY_MAX = 1024;

engine.analytics.record({
  type: 'denial',
  tool: name.slice(0, TOOL_NAME_MAX),
  role: defaultRole ?? '',
  ts: Date.now(),
});
```

Apply the same cap to search/miss events for `query`. Document the cap in `AnalyticsEvent` JSDoc. This is defense-in-depth for hosts running MCPack against untrusted agent traffic.

---

## Info

### IN-01: Magic constant `10000` lives only in source comments, not in a named export

**File:** `src/analytics-store.ts:38,42`
**Issue:** The PRD-locked `maxEvents=10000` default is a constructor default and appears in JSDoc, but is not exposed as a named constant. A consumer wanting to check or test against the canonical default has to hardcode `10000`. Phase 9 tests do this at `test/analytics-store.test.ts:54-62`.

**Fix:** Export a `DEFAULT_MAX_EVENTS = 10000` named constant alongside the class, or attach it as `AnalyticsStore.DEFAULT_MAX_EVENTS`. Use it in tests and JSDoc to keep one source of truth.

---

### IN-02: `Array.shift()` eviction is O(n); ring-buffer would be O(1)

**File:** `src/analytics-store.ts:55-57`
**Issue:** `Array.shift()` re-indexes every element on each eviction. At steady-state (events at capacity), every `record()` is O(maxEvents). For `maxEvents=10000` this is microseconds — fine for this use case — but the JSDoc claim "O(1) amortized" at line 48 is incorrect: amortized cost at capacity is O(maxEvents) per push because every push triggers a shift. A circular buffer (`writeIdx % maxEvents`) is the canonical fix.

This is **out of scope for v1 review per `<review_scope>` (performance issues NOT in scope)** and is flagged here only because the JSDoc is wrong — the code says O(1) amortized, which is misleading.

**Fix:** Update the JSDoc to "O(maxEvents) at capacity due to Array.shift; acceptable for typical 10k bounds, swap to circular buffer if profiling shows hot-path cost." Or replace with a circular buffer (deferred, but should be in the v1.2 backlog).

---

### IN-03: Two duplicate denial-emission blocks in each of `wrap.ts` and `build.ts`

**File:** `src/wrap.ts:109-138`, `src/build.ts:120-152`
**Issue:** Each mode emits the denial event in two places: (a) the role-check failure branch, and (b) the missing-handler branch. The two `engine.analytics.record({ type: 'denial', ... })` blocks are byte-identical other than the surrounding return. This is mild duplication; if a future change adds a third metadata field to denial events, four call sites need updating consistently.

**Fix:** Extract a small helper inside each module:

```ts
function emitDenial(name: string, role: string | undefined) {
  engine.analytics.record({
    type: 'denial',
    tool: name,
    role: role ?? '',
    ts: Date.now(),
  });
}
```

Or pass through `engine.analytics` directly with a single helper. Low priority — the duplication is local and obvious.

---

### IN-04: `MCPackEngine.analytics` is `public readonly` but `MCPackEngine` is documented internal

**File:** `src/core.ts:46-54`
**Issue:** The comment explains the rationale ("Pattern 2 — no abstraction layer"), and the engine is in fact internal (not exported from `src/index.ts`). But TypeScript's `public` modifier with an `@internal` JSDoc tag is the same hygiene mismatch as WR-05. A reader of the class shape sees a public field on a class that's exported from the package internals; a consumer doing `import { MCPackEngine } from '@llvs/mcpack/core.js'` (deep import) gets full access.

**Fix:** Add a comment to `src/index.ts` stating that `core.js` and `analytics-store.js` are not part of the public API surface, and consider marking the field `@internal` in TSDoc to surface in IDE hover tooling.

---

_Reviewed: 2026-04-26_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
