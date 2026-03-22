# MCPack Specification v1.0

**Status:** Draft  
**Author:** Loom Labs  
**Version:** 1.0.0  
**Date:** 2026-03-19

---

## Overview

MCPack is a lightweight wrapper protocol that sits in front of any MCP server and replaces the default full schema dump on connection with a lazy, queryable tool discovery model.

The core problem MCPack solves: MCP clients currently receive the full definition of every tool a server exposes at connection time. This creates token bloat proportional to the number of tools — before a single tool is called. In long-running agentic sessions with broad task scope, this overhead compounds significantly.

MCPack introduces a single injected tool — `search_tools` — that replaces bulk tool discovery with on-demand, query-based schema retrieval. Tool schemas are loaded into context only when needed, only in the quantity needed, and only once per session regardless of how many times they are queried.

MCPack requires no changes to the MCP client, no changes to the underlying MCP server, and no new protocol methods. It is a drop-in wrapper.

---

## Design Principles

**Backwards compatible.** An agent that has never heard of MCPack connects and sees a standard MCP tool called `search_tools`. No special client support required.

**Server agnostic.** MCPack wraps any MCP server regardless of what it does. The underlying server's tool definitions, resources, prompts, and auth are unchanged.

**Zero friction adoption.** Server authors add one function call. Agent users change nothing.

**Session-aware.** MCPack tracks which tool schemas have been surfaced per session and avoids re-loading them. Token cost is bounded.

**Role-scoped.** Tool visibility is filtered by caller role at the index level. Agents cannot discover tools they are not permitted to use.

---

## Architecture

```
Agent
  │
  ▼
MCPack Wrapper Layer
  │  - Intercepts tools/list
  │  - Intercepts tools/call where name === 'search_tools'
  │  - Maintains session registry
  │  - Applies role filtering
  │  - Passes everything else through
  │
  ▼
Underlying MCP Server
  │  - Unchanged
  │  - All tool logic lives here
  │  - Resources, prompts, auth unchanged
  │
  ▼
Backend Systems (Supabase, Clerk, APIs, etc.)
```

---

## Protocol Behavior

### Connection and tools/list

When an MCP client connects and calls `tools/list`, MCPack intercepts the response and returns exactly one tool: `search_tools`.

The underlying server's full tool list is never returned directly. It is held in MCPack's internal index.

**Standard MCP response (before MCPack):**
```json
{
  "tools": [
    { "name": "get_deals", "description": "...", "inputSchema": { ... } },
    { "name": "update_deal", "description": "...", "inputSchema": { ... } },
    { "name": "get_users", "description": "...", "inputSchema": { ... } },
    ... 17 more tools
  ]
}
```

**MCPack response:**
```json
{
  "tools": [
    {
      "name": "search_tools",
      "description": "Search available tools by capability. Returns full tool schemas matching your query. Call this before calling any other tool to discover what is available.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": {
            "type": "string",
            "description": "Natural language description of what you want to do"
          },
          "limit": {
            "type": "number",
            "description": "Maximum number of tools to return. Default 5, max 10."
          }
        },
        "required": ["query"]
      }
    }
  ]
}
```

---

### The Tool Index

At server startup, MCPack builds an in-memory index from the underlying server's tool definitions. Each entry in the index contains:

```typescript
interface ToolIndexEntry {
  name: string
  description: string
  keywords: string[]       // extracted from name + description
  tier: string             // permission tier e.g. 'read', 'write', 'admin'
  schema: ToolDefinition   // full schema, held server-side
  loaded: boolean          // whether this tool has been surfaced this session
}
```

The index is built automatically from the server's tool definitions. No manual annotation required for basic operation. Role tiers are provided via MCPack config.

---

### search_tools Behavior

When the agent calls `search_tools`, MCPack:

1. Checks the session registry for an existing session. Creates one if it does not exist.
2. Scores all index entries against the query using keyword matching.
3. Filters results by the caller's role tier.
4. For tools not yet loaded this session — returns the full schema.
5. For tools already loaded this session — returns name only with a `loaded: true` flag.
6. Updates the session registry with newly loaded tools.
7. Returns results to the agent.

**Example request:**
```json
{
  "name": "search_tools",
  "arguments": {
    "query": "get deals above a score threshold",
    "limit": 5
  }
}
```

**Example response — first call:**
```json
{
  "content": [{
    "type": "text",
    "text": {
      "tools": [
        {
          "name": "get_deals",
          "loaded": false,
          "schema": {
            "name": "get_deals",
            "description": "Retrieve deals filtered by score, status, or date",
            "inputSchema": {
              "type": "object",
              "properties": {
                "min_score": { "type": "number" },
                "status": { "type": "string" },
                "limit": { "type": "number" }
              }
            }
          }
        },
        {
          "name": "get_deal_by_id",
          "loaded": false,
          "schema": { ... }
        }
      ],
      "total_available": 12,
      "showing": 2,
      "session_id": "sess_abc123"
    }
  }]
}
```

**Example response — subsequent call for same tools:**
```json
{
  "content": [{
    "type": "text",
    "text": {
      "tools": [
        {
          "name": "get_deals",
          "loaded": true
        },
        {
          "name": "get_deal_by_id",
          "loaded": true
        }
      ],
      "total_available": 12,
      "showing": 2,
      "session_id": "sess_abc123"
    }
  }]
}
```

The agent already has these schemas in context from the first load. Returning them again would be redundant. MCPack returns a reference only.

---

### Session Management

MCPack maintains a server-side session registry keyed by session ID. The session ID is derived from the MCP initialize handshake.

```typescript
interface Session {
  id: string
  role: string
  loadedTools: Set<string>
  createdAt: number
  lastActiveAt: number
}
```

**Session lifecycle:**

- Created on first `search_tools` call if not already established
- Updated on every `search_tools` call — `lastActiveAt` refreshed, `loadedTools` extended
- Expired after configurable inactivity period (default: 2 hours)
- Destroyed on MCP connection close

**Token ceiling guarantee:**

Because each tool schema is returned at most once per session, the maximum token cost of tool discovery across any session — regardless of length or breadth — is equal to the cost of loading all tools once. This is the same ceiling as vanilla MCP. MCPack cannot be worse than vanilla MCP in total token cost. For narrow sessions it is significantly better.

---

### Role-Based Filtering

MCPack filters tool visibility at the index level based on the caller's role. Agents cannot discover, query, or call tools outside their permission tier.

Roles are defined in MCPack config:

```typescript
mcpack(server, {
  roles: {
    read:  ['get_deals', 'get_deal_by_id', 'search_listings'],
    write: ['read', 'update_deal_status', 'create_outreach'],
    admin: ['*']
  }
})
```

Role resolution is hierarchical — `write` inherits `read`. `admin` has access to everything.

The caller's role is resolved from the MCP session context — typically from a Clerk token or equivalent auth mechanism passed at initialize time.

A tool that does not exist in the caller's role simply does not appear in `search_tools` results. The `total_available` count reflects only tools the caller can access.

---

### Pass-Through Behavior

MCPack only intercepts:
- `tools/list` — replaced with `search_tools` only
- `tools/call` where `name === 'search_tools'` — handled by MCPack

Everything else passes through to the underlying server unchanged:
- All other `tools/call` requests
- `resources/list`, `resources/read`
- `prompts/list`, `prompts/get`
- `initialize` / `notifications`
- Auth middleware

---

## Configuration Reference

```typescript
import { mcpack } from 'mcpack'
import { myServer } from './server'

export default mcpack(myServer, {
  
  // Role definitions
  // String values inherit from named role
  // '*' grants access to all tools
  roles: {
    read: ['tool_a', 'tool_b'],
    write: ['read', 'tool_c'],
    admin: ['*']
  },

  // How to resolve caller role from session context
  // Default: reads from MCP initialize clientInfo.role
  resolveRole: (session) => session.clientInfo?.role ?? 'read',

  // Index configuration
  index: {
    // 'auto' builds index from tool definitions automatically
    // 'manual' requires explicit index entries
    mode: 'auto',
    
    // Max tools returned per search_tools call
    maxResults: 5,
  },

  // Session configuration  
  session: {
    // Inactivity timeout in milliseconds
    // Default: 2 hours
    ttl: 7200000,
  }

})
```

---

## Token Cost Comparison

| Scenario | Vanilla MCP | MCPack v1 |
|---|---|---|
| Connect, 20-tool server | 20 full schemas in context | 1 schema (search_tools) |
| Narrow task, uses 3 tools | 20 schemas | 3 schemas |
| Broad task, uses all 20 tools | 20 schemas | 20 schemas (loaded gradually) |
| Hour 3, 200 tool calls, 5 unique tools | 20 schemas + 200 call/response cycles | 5 schemas + 200 call/response cycles |
| Hour 3, 200 tool calls, 20 unique tools | 20 schemas + 200 call/response cycles | 20 schemas + 200 call/response cycles (same ceiling) |

MCPack is never worse than vanilla MCP. For any session where the agent does not use every tool — which is most sessions — MCPack reduces context cost.

---

## Search Algorithm (v1)

v1 uses keyword matching. Semantic search is planned for v1.1.

**Scoring:**
- Exact match on tool name: +10
- Partial match on tool name: +5
- Match in tool description: +3 per matching term
- Match in auto-extracted keywords: +2 per match

Results are ranked by score, filtered by role, capped at `limit`.

Keyword extraction at index build time: tokenize tool name (split on `_`, `-`, camelCase) plus significant words from description (stop words removed).

---

## Implementation Notes

**Language:** TypeScript. Published to npm as `mcpack`.

**Dependencies:** None beyond the MCP TypeScript SDK (`@modelcontextprotocol/sdk`).

**Transport:** MCPack is transport-agnostic. Works with stdio and SSE/HTTP.

**Hosting:** MCPack adds no infrastructure requirements. It runs in the same process as the MCP server. Deploy wherever you deploy your server.

---

## Versioning and Roadmap

**v1.0 — This document**
- `search_tools` injection
- Keyword-based index
- Session registry with loaded-tool tracking
- Role-based filtering
- Pass-through for all non-discovery calls

**v1.1 — Planned**
- Semantic search via lightweight embedding model
- Tool usage analytics (which tools get searched, which get called)
- Index refresh on server tool changes (`listChanged` capability)

**v2.0 — Planned**
- Binary encoding layer (MessagePack + zstd) for payload compression
- Handshake-negotiated encoding capability
- Encryption as optional capability tier
- Persistent codec manifest (local file cache)

---

## Contributing

MCPack is published and maintained by Loom Labs as an open source project.

Spec contributions, implementation PRs, and server compatibility reports welcome.

The goal is for MCPack to become a community standard for MCP server optimization — eventually contributed upstream to the MCP specification as a formal lazy discovery extension.

---

*MCPack v1.0 — Loom Labs — 2026*
