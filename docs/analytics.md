# Tool Usage Analytics (v1.1)

MCPack v1.1 captures four event types — `search`, `call`, `denial`, `miss` — into an in-memory, bounded-retention store and exposes them via the operator-only `MCPackHandle.getAnalytics()` method. Use the snapshot to spot dead tools (visible to a role but never called), hot tools (top-5 by call count), and under-served queries (search-misses).

> **Architectural invariant — never on the wire.** `getAnalytics()` lives on the returned server handle, NOT as a callable MCP tool. There is no JSON-RPC surface, no `tools/list` entry, no `tools/call` route. Agents that try `tools/call` with name `getAnalytics` receive the standard opaque-denial `"Unknown tool: getAnalytics"`. This is Phase 9 Gate 5; verified by `grep -E "setRequestHandler.*[Aa]nalytics" src/` returning zero matches.

## Why server-handle analytics (vs MCP wire)

Analytics surface is operator-only. Co-founders, partners, and other agents must NEVER be able to enumerate the call/denial history of other roles, learn the names of tools their role can't see, or use analytics as a side channel around RBAC. Putting `getAnalytics()` on the host-process handle (rather than `tools/list`) reduces the attack surface to "code with a reference to the handle" — the same trust boundary as your MCP server's transport setup, your DB credentials, and your env vars.

The PRD requirement REQ-v11-analytics-rbac-integrity is therefore implemented as an architectural ban, not a runtime check. There is no `analytics_get` tool; there is no `tools/call` dispatch entry; there is no JSON-RPC method handler.

## The `getAnalytics(options?)` API

```ts
interface MCPackHandle {
  getAnalytics(options?: { role?: string }): AnalyticsSnapshot;
  // ... other handle methods
}
```

**Operator-unscoped (no `options`):** returns the full event log including events from every role. Use for diagnostic sweeps ("which tools is role X being denied?").

```ts
const snap = handle.getAnalytics();
console.log(snap.summary.byRole);  // every role that has events
```

**Role-scoped (`options.role` provided):** returns a snapshot filtered to events that role is allowed to see. Out-of-role events are dropped entirely (no string redaction; entire events are removed per DEC-v11-09-02).

```ts
const cofounderView = handle.getAnalytics({ role: 'cofounder' });
console.log(cofounderView.summary.byRole.cofounder.deadTools);
```

## `AnalyticsSnapshot` shape

```ts
interface AnalyticsSnapshot {
  searches: Array<{ query: string; role: string; tools: string[]; ts: number }>;
  calls:    Array<{ tool: string;  role: string; ts: number }>;
  denials:  Array<{ tool: string;  role: string; ts: number }>;
  misses:   Array<{ query: string; role: string; ts: number }>;
  summary: {
    byRole: Record<string, AnalyticsByRoleSummary>;
  };
}

interface AnalyticsByRoleSummary {
  searchCount: number;
  callCount: number;
  denialCount: number;
  missCount: number;
  topTools: string[];   // up to 5 tool names, ordered by call count desc
  deadTools: string[];  // tools-visible-to-role minus tools-with-≥1-call-by-role
}
```

The empty-string role `""` represents "undefined role" — the SessionRegistry coerces `role ?? ''` for events emitted before any role is bound to the session. Empty-string roles are excluded from `summary.byRole` keys (WR-04 fix), so role-scoped consumers don't have to special-case them.

## The four event types

Each of the four event types fires at exactly one site in the engine.

### `search` events

Fire on **every** `search_tools` invocation. Record `{ query, role, tools, ts }` where:

- `query`: the caller-provided query string (truncation policy: documented as v1.2 concern WR-06).
- `role`: the session's bound role at call time, or `""` if undefined.
- `tools`: the array of tool names returned to the caller (post role-filter, post limit). Snapshot-aliased on read — `record()` copies the array (WR-03 fix).
- `ts`: `Date.now()` at emission.

### `call` events

Fire on **every successful** non-`search_tools` `tools/call`. Record `{ tool, role, ts }`. A "successful" call is one whose handler did not return `{ isError: true }` and did not throw. The MCP convention is clean-error returns (not throws); per WR-02, `wrap.ts` and `build.ts` both skip `call` emission when `result.isError === true`.

### `denial` events

Fire on **every** `tools/call` that fails RBAC or routes to an unknown tool name. The caller receives `"Unknown tool: {name}"` — opaque denial; restricted tools are invisible. Record `{ tool, role, ts }`.

For **role-scoped** `getAnalytics({ role })` queries: a denial event is included in the snapshot's `denialCount` only when `event.role === options.role` (denials authored BY this role, not denials AGAINST tools this role can see). This avoids leaking the names of restricted tools the role attempted to access. WR-01 fix: previously `denialCount` was always 0 for non-wildcard roles because the privacy filter excluded denials by definition.

For **operator-unscoped** queries: every denial event appears in `denials[]` and contributes to `summary.byRole[event.role].denialCount`.

### `miss` events

Fire on **every** `search_tools` query whose ranked-and-filtered results are empty. Record `{ query, role, ts }`. A `miss` event coexists with a `search` event for the same call (the search event records `tools: []`).

Use `summary.byRole[role].missCount` to spot under-served query patterns — common queries that consistently return zero results indicate a gap in tool surface or in role config.

## Operator-unscoped vs role-scoped — privacy semantics

REQ-v11-analytics-privacy: a role-scoped query MUST NOT expose tools outside that role's allowed set.

The implementation is an event-exclusion filter, not string redaction. A role-scoped `getAnalytics({ role })` call:

1. Drops `call`/`denial` events whose `tool` is not in the role's currently-allowed set (computed via `isToolAllowed(role, rolesConfig, index)`, the same helper Phase 8 hybrid-ranking uses).
2. Drops `search`/`miss` events authored by other roles (`event.role !== options.role`).
3. Recomputes `summary.byRole[role]` over the filtered event arrays.

Filtering uses **current** role-config state, not historical: a denial recorded BEFORE the role gained tool Y will still be filtered out if Y is currently in the role's allowed set (DEC-v11-09-02 edge case 5). This is intentional — the filter answers "what can this role see right now" rather than "what did this role's permissions look like at event time".

Operator-unscoped queries are unfiltered. Treat the operator-unscoped snapshot as a sensitive artifact: it contains tool names, queries, and the full denial pattern across every role.

## Dead-tool detection

`summary.byRole[role].deadTools` lists tools the role can SEE but has zero recorded `call` events for in the current process lifetime (DEC-v11-09-03). Computed as:

```
deadTools = resolveRoleAccess(role, rolesConfig, index).map(e => e.name)
            ∖ tools-with-≥1-call-event-by-role
```

Search-emitted tools without a `call` event REMAIN in `deadTools` (Pitfall 5 — being returned by `search_tools` doesn't promote a tool out of dead-tool status; only an actual `tools/call` does).

Use dead-tool reports to trim role configs:

```ts
const cofounderDead = handle.getAnalytics({ role: 'cofounder' }).summary.byRole.cofounder.deadTools;
if (cofounderDead.length > 0) {
  console.warn('cofounder role has unused tool grants:', cofounderDead);
}
```

## RBAC integrity invariant

`getAnalytics()` is unreachable via the MCP wire. Verified across both wrap and build modes by Phase 9's Pr5 invariant tests (`tools/call getAnalytics → "Unknown tool: getAnalytics"`):

- `getAnalytics` does not appear in `tools/list` — `tools/list` returns exactly one synthetic tool, `search_tools`.
- `tools/call` with name `getAnalytics` routes to the unknown-tool handler — same opaque-denial path as any other unknown name.
- The host-process method on `MCPackHandle` is the only entry point. Code that holds the handle reference can call it; code that only has the MCP wire cannot.

## In-memory only; resets on process restart

Per REQ-v11-analytics-storage. Events are stored in a single `AnalyticsStore` instance owned by the engine; no disk persistence, no OTEL export, no webhook in v1.1. On `handle.destroy()` or process exit, the event log is gone.

Persistence (file / OTEL / webhook) is a v1.2 candidate per the PRD non-goals. If you need durable analytics now, consume the snapshot synchronously and forward to your own observability pipeline:

```ts
setInterval(() => {
  const snap = handle.getAnalytics();
  myMetricsClient.publish(serializeForExport(snap));
}, 60_000);
```

## Bounded retention

`MCPackConfig.analytics.maxEvents` defaults to `10000` events across all four event types combined. On overflow, the oldest event is evicted via `Array.shift` (amortized — the JSDoc claim of "O(1)" is amortized rather than worst-case; documented as IN-02). Configure for high-traffic deployments:

```ts
const handle = await mcpack(server, {
  roles,
  defaultRole: 'advisor',
  analytics: { maxEvents: 50_000 },
});
```

The `10000` default is a magic constant inside the engine module; promoting it to a named export is tracked as IN-01. For most deployments it's the right floor — large enough to capture an hour of moderate traffic, small enough to bound process memory.
