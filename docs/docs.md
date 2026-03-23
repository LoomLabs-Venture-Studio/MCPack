# MCPack

Lazy, queryable, session-aware tool discovery for MCP servers.

MCP clients receive full tool schemas at connection time via `tools/list`. For servers with 20+ tools, this dumps thousands of tokens into context before a single tool is called. MCPack replaces this with on-demand, query-based discovery -- a single `search_tools` tool that returns only the schemas an agent actually needs, when it needs them.

## Install

```
npm install @llvs/mcpack
```

Peer dependency: `@modelcontextprotocol/sdk ^1.0.0`

## Wrap Mode

Wrap any existing MCP server with one function call. MCPack intercepts `tools/list` and injects `search_tools` automatically.

```typescript
import { mcpack } from '@llvs/mcpack';

// your existing MCP server
const server = createMyServer();

const handle = await mcpack(server, {
  roles: {
    default: ['create_payment', 'list_customers', 'get_invoice', 'create_refund', 'list_subscriptions'],
    admin: ['*'],
  },
  defaultRole: 'default',
});

// connect transport as usual
server.connect(transport);
```

The agent now sees a single tool -- `search_tools` -- and discovers schemas on demand:

```json
{
  "name": "search_tools",
  "arguments": { "query": "create a payment", "limit": 3 }
}
```

Response:

```json
{
  "content": [{
    "type": "text",
    "text": {
      "tools": [
        {
          "name": "create_payment",
          "loaded": false,
          "schema": {
            "name": "create_payment",
            "description": "Create a new payment intent",
            "inputSchema": {
              "type": "object",
              "properties": {
                "amount": { "type": "number", "description": "Amount in cents" },
                "currency": { "type": "string", "description": "ISO currency code" }
              },
              "required": ["amount", "currency"]
            }
          }
        },
        {
          "name": "get_invoice",
          "loaded": true
        }
      ],
      "total_available": 5,
      "showing": 2,
      "session_id": "sess_abc123"
    }
  }]
}
```

Tools with `loaded: false` include the full schema (first time this session). Tools with `loaded: true` were already surfaced -- the agent has the schema in context, so MCPack returns a reference only.

## Build Mode

Build a new MCP server from scratch with tools, handlers, and lazy discovery baked in.

```typescript
import { createMCPackServer } from '@llvs/mcpack';

const { server, handle } = createMCPackServer({
  name: 'payments-server',
  version: '1.0.0',
  tools: [
    {
      name: 'create_payment',
      description: 'Create a new payment intent',
      inputSchema: {
        type: 'object',
        properties: {
          amount: { type: 'number', description: 'Amount in cents' },
          currency: { type: 'string', description: 'ISO currency code' },
        },
        required: ['amount', 'currency'],
      },
      handler: async (args, ctx) => {
        return { id: 'pi_123', amount: args.amount, currency: args.currency };
      },
    },
    // ... more tools
  ],
});

server.connect(transport);
```

The `search_tools` interface works identically to wrap mode -- same request format, same response shape, same session-aware behavior.

## Before / After

**Before (vanilla MCP):** Agent connects, receives all 28 tool schemas, 8,315 tokens in context.

**After (MCPack):** Agent connects, receives 1 tool (`search_tools`), searches "create a payment", receives 5 relevant schemas, 1,040 tokens.

## Token Reduction

Reduces tool discovery tokens by ~80% (60-90% depending on query breadth).

Measured on Stripe MCP (28 tools). Real measurement output:

```
=== MCPack Token Reduction Report ===

Stripe MCP tools discovered: 28

Query: "create a payment"
  Tools: 28 vanilla -> 5 MCPack
  Chars: 33258 -> 4158 (87.5% reduction)
  Est. tokens: 8315 -> 1040 (saved ~7275)

Query: "manage customers"
  Tools: 28 vanilla -> 3 MCPack
  Chars: 33258 -> 7933 (76.1% reduction)
  Est. tokens: 8315 -> 1984 (saved ~6331)

Query: "subscription billing"
  Tools: 28 vanilla -> 5 MCPack
  Chars: 33258 -> 13115 (60.6% reduction)
  Est. tokens: 8315 -> 3279 (saved ~5036)

Query: "issue refund"
  Tools: 28 vanilla -> 3 MCPack
  Chars: 33258 -> 3196 (90.4% reduction)
  Est. tokens: 8315 -> 799 (saved ~7516)

Query: "list invoices"
  Tools: 28 vanilla -> 5 MCPack
  Chars: 33258 -> 3650 (89% reduction)
  Est. tokens: 8315 -> 913 (saved ~7402)

--- Aggregate ---
Total chars: 166290 -> 32052
Overall reduction: 80.7%
Total est. tokens saved: 33560
```

| Query | Vanilla Tokens | MCPack Tokens | Reduction |
|-------|---------------|---------------|-----------|
| create a payment | 8,315 | 1,040 | 87.5% |
| manage customers | 8,315 | 1,984 | 76.1% |
| subscription billing | 8,315 | 3,279 | 60.6% |
| issue refund | 8,315 | 799 | 90.4% |
| list invoices | 8,315 | 913 | 89.0% |
| **Aggregate** | **41,575** | **8,015** | **80.7%** |

Results vary by server size and query breadth -- larger tool surfaces see greater reduction.

Numbers represent character counts of serialized JSON payloads, not actual LLM tokens. Estimated tokens use chars/4 approximation.

## Roadmap

- **v1.0:** Keyword search, session tracking, role filtering (this release)
- **v1.1:** Semantic search, tool usage analytics
- **v2.0:** Binary encoding layer

## Specification

See the [full specification](spec/mcpack-spec-v1.md) for protocol details, architecture, and configuration reference.

## License

MIT
