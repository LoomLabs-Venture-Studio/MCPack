# MCPack

RBAC for MCP servers. Drop-in role-based access control for any MCP server — agents only see the tools their role permits.

Built for a venture studio that needed to give co-founders and partners agent-level access to a shared stack without building another admin dashboard. Their Claude session becomes a terminal into the shared venture, scoped to what they should actually be able to touch.

## Install

```
npm install @llvs/mcpack
```

Peer dependency: `@modelcontextprotocol/sdk ^1.0.0`

## What's New in v1.1 (Search & Observability)

v1.1 is fully backward compatible: `v1.0 → v1.1 requires zero config changes`. The new features are opt-in; with no `embeddings` configured, the search code path is byte-identical to v1.0 keyword-only behavior.

### Semantic search (opt-in)

Pair MCPack with [`@llvs/mcpack-embeddings`](./packages/mcpack-embeddings/README.md) to enable hybrid semantic + keyword ranking:

```ts
import { mcpack } from '@llvs/mcpack';
import { createMiniLMProvider } from '@llvs/mcpack-embeddings';

const handle = await mcpack(server, {
  embeddings: { provider: await createMiniLMProvider() },
});
```

Default hybrid weights: `0.7` semantic + `0.3` keyword (configurable via `MCPackConfig.embeddings.weights`). When the semantic index is still building, queries fall back to v1.0 keyword scoring — `search_tools` is never blocked. See [`docs/semantic-search.md`](./docs/semantic-search.md) for the full reference.

### Tool usage analytics (in-process)

Inspect search / call / denial / miss patterns and dead tools without exposing analytics over the MCP wire:

```ts
const snap = handle.getAnalytics({ role: 'cofounder' });
console.log(snap.summary.byRole.cofounder.deadTools);
```

`getAnalytics()` lives on the returned server handle, NOT as a callable MCP tool. Operator-only by architecture — agents calling `tools/call` with name `getAnalytics` receive the standard `"Unknown tool: getAnalytics"` opaque-denial response. See [`docs/analytics.md`](./docs/analytics.md) for the API reference.

### Measured v1.1 results

Measured against v1.0 baseline. Two of the four PRD targets are re-verified at publish time with the operator's `STRIPE_SECRET_KEY` (the headline targets restate v1.0's anchor on the same 28-tool surface; see CHANGELOG.md for measurement state).

| Target | Threshold | v1.1 status |
|--------|-----------|-------------|
| Stripe MCP token reduction (hybrid ON, 28-tool surface) | ≥ **80.7%** aggregate (v1.0 anchor) | re-verified at publish (Plan 10-03) |
| 50-query intent benchmark recall@5 delta | hybrid ≥ keyword + 15 pp | re-verified at publish (Plan 10-03) |
| `search_tools` p99 latency delta vs v1.0 | ≤ 50 ms | **3.057 ms** PASS |
| Semantic index build for 50-tool MiniLM engine | ≤ 5,000 ms | **216.6 ms** PASS |

Full release-measurement report: [`.planning/phases/10-harness-coverage-docs-npm-publish-v1-1/v1.1-release-report.md`](./.planning/phases/10-harness-coverage-docs-npm-publish-v1-1/v1.1-release-report.md).

## Quick Start

```typescript
import { mcpack } from '@llvs/mcpack';

// your existing MCP server
const server = createMyServer();

const handle = await mcpack(server, {
  roles: {
    cofounder: ['get_deals', 'update_deal_status', 'list_payments'],
    advisor:   ['get_deals'],
    admin:     ['*']
  },
  defaultRole: 'advisor'
});

server.connect(transport);
```

That's it. Your server now enforces role-based access at both layers:

- **Discovery:** `tools/list` returns a single `search_tools` tool. Agents search by keyword and only see tools their role permits.
- **Execution:** `tools/call` is blocked for out-of-role tools — even if the agent somehow knows the name. The error is deliberately opaque: `"Unknown tool: {name}"`. Restricted tools are invisible, not just blocked.

## How It Works

**1. Agent connects.** `tools/list` returns one tool: `search_tools`. No schema dump.

**2. Agent searches.** Calls `search_tools` with a natural language query. MCPack returns matching schemas, filtered by role, ranked by relevance.

```json
{
  "name": "search_tools",
  "arguments": { "query": "deals and payments", "limit": 3 }
}
```

**3. Agent sees only what their role allows.**

A `cofounder` searching "deals and payments" sees `get_deals`, `update_deal_status`, `list_payments`. An `advisor` searching the same query sees only `get_deals`. An `admin` with `'*'` sees everything.

**4. Execution is enforced.** If an `advisor` tries to call `update_deal_status` directly, MCPack returns `"Unknown tool: update_deal_status"` — not "access denied", not "insufficient permissions". The tool doesn't exist as far as that agent knows.

## Two Modes

### Wrap Mode

Wrap any existing MCP server with one function call. MCPack intercepts `tools/list` and `tools/call`, adds RBAC and lazy discovery on top.

```typescript
import { mcpack } from '@llvs/mcpack';

const handle = await mcpack(server, {
  roles: {
    cofounder: ['get_deals', 'update_deal_status', 'list_payments'],
    advisor:   ['get_deals'],
    admin:     ['*']
  },
  defaultRole: 'advisor'
});
```

### Build Mode

Build a new MCP server from scratch with RBAC baked in from the start.

```typescript
import { createMCPackServer } from '@llvs/mcpack';

const { server, handle } = createMCPackServer({
  name: 'venture-server',
  version: '1.0.0',
  roles: {
    cofounder: ['get_deals', 'update_deal_status', 'list_payments'],
    advisor:   ['get_deals'],
    admin:     ['*']
  },
  defaultRole: 'advisor',
  tools: [
    {
      name: 'get_deals',
      description: 'List all active deals in the pipeline',
      inputSchema: { type: 'object', properties: {} },
      handler: async (args, ctx) => {
        return { deals: await db.getDeals() };
      },
    },
    // ... more tools
  ],
});

server.connect(transport);
```

Both modes use the same engine. Same RBAC enforcement. Same `search_tools` interface. Same session-aware behavior.

## Session Tracking

Schemas loaded once per session are returned as lightweight references on subsequent calls. No duplicate payloads, ever.

```json
{
  "tools": [
    { "name": "get_deals", "loaded": false, "schema": { "..." } },
    { "name": "list_payments", "loaded": true }
  ]
}
```

`loaded: false` — full schema included (first time this session). `loaded: true` — agent already has it, MCPack sends a reference only.

## Token Reduction: A Side Effect Worth Measuring

RBAC is the primary value. But scoping what agents can see also dramatically cuts token usage — agents load only the schemas they need instead of the full tool surface.

Measured on Stripe MCP (28 tools). Real harness output:

```
=== MCPack Token Reduction Report ===

Stripe MCP tools discovered: 28

Query: "create a payment"
  Tools: 28 vanilla -> 5 MCPack
  Chars: 33258 -> 4158 (87.5% reduction)
  Est. tokens: 8315 -> 1040 (saved ~7275)

Query: "issue refund"
  Tools: 28 vanilla -> 3 MCPack
  Chars: 33258 -> 3196 (90.4% reduction)
  Est. tokens: 8315 -> 799 (saved ~7516)

--- Aggregate ---
Overall reduction: 80.7%
Total est. tokens saved: 33,560
```

| Query | Vanilla Tokens | MCPack Tokens | Reduction |
|-------|---------------|---------------|-----------|
| create a payment | 8,315 | 1,040 | 87.5% |
| manage customers | 8,315 | 1,984 | 76.1% |
| subscription billing | 8,315 | 3,279 | 60.6% |
| issue refund | 8,315 | 799 | 90.4% |
| list invoices | 8,315 | 913 | 89.0% |
| **Aggregate** | **41,575** | **8,015** | **80.7%** |

Results vary by server size and query breadth — larger tool surfaces see greater reduction.

Numbers represent character counts of serialized JSON payloads, not actual LLM tokens. Estimated tokens use chars/4 approximation.

## Roadmap

- **v1.0:** RBAC, keyword search, session tracking (this release)
- **v1.1:** Semantic search, tool usage analytics
- **v2.0:** Binary encoding layer

## Specification

See the [full specification](spec/mcpack-spec-v1.md) for protocol details, architecture, and configuration reference.

## License

MIT
