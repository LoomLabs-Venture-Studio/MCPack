# MCPack — Product Requirements Document v1.1

**Project:** MCPack  
**Owner:** Loom Labs  
**Version:** 1.1.0  
**Date:** 2026-03-28  
**Status:** Ready for Development  
**Target System:** GSD / Claude Code

---

## 1. What We Are Building

MCPack v1.1 adds three major capabilities on top of the v1.0 foundation:

1. **Multi-source mode** — compose multiple MCP servers behind a single MCPack instance with a merged, namespace-prefixed index and per-source call routing
2. **Dynamic role resolution** — resolve partner roles from real session context using a provider-agnostic resolver hook. v1.1 ships with Google OAuth as the default resolver and a static config fallback
3. **Token-based deterministic search** — replace the v1.0 5-tier keyword scorer with a weighted inverted index built at startup for fast, testable, zero-dependency search

The output of this build is:

1. Updated `@llvs/mcpack` package with multi-source support, upgraded search, and provider-agnostic resolver hook
2. New `@llvs/mcpack-google` package for Google OAuth JWT role resolution
3. HTTP/SSE transport support for remote Railway deployment
4. A working Loom Labs partner hub deployable per project

---

## 2. The Problem Being Solved

### 2.1 The Loom Labs Partner Access Problem

Every Loom Labs project has co-founders and partners who need operational access to the shared stack — deal data, user management, payments, analytics. Today there are two bad options:

- Build a custom admin dashboard (weeks of work, per project)
- Give partners direct database credentials (security nightmare)

MCPack v1.0 solved the guardrails problem with role-based filtering. But it had two gaps:

**Gap 1 — Single server only.** A real partner hub needs to compose multiple upstream MCP servers — internal data APIs, third-party MCPs, custom business logic — behind one entry point. v1.0 wraps one server at a time.

**Gap 2 — Static role assignment.** v1.0's `defaultRole` gives every session the same role. Real partner access needs Brian to connect and automatically get co-founder permissions, Smush to get Virtus partner permissions, and an external client to get read-only access — without manual configuration per connection.

### 2.2 The Generic Partner Hub Pattern

Each Loom Labs project deploys its own MCPack instance on Railway. Partners authenticate with their existing Google account — no new accounts, no Loom Labs email required. MCPack resolves their role from their verified Google JWT and exposes only the tools that role permits across however many source MCPs are composed.

No admin dashboard. No credential sharing. No per-project manual role configuration.

### 2.3 The Circular Dependency Problem (Solved)

In earlier design iterations, Clerk was considered both as an auth provider AND as a source MCP server. This creates a circular dependency — MCPack needs to validate the auth token before it can compose sources, but if the auth provider is itself a source, the auth layer depends on something it is supposed to be gatekeeping.

The fix: auth validation happens at the transport layer, before source composition runs. The auth provider is never a source. Sources are the downstream MCP servers partners access after authentication.

---

## 3. The Solution

### 3.1 Multi-Source Mode

`createMCPackServer` accepts a `sources` array. Each source is a named MCP server instance. MCPack:

- Spawns each source as a stdio child process at startup
- Pulls all tool definitions via `tools/list` from each source
- Prefixes tool names by source name only on collision (`crm.get_deals` vs `billing.get_deals`)
- Builds a merged inverted index across all sources
- Routes `tools/call` to the correct source server by tool name prefix
- Applies role filtering across the full merged surface using namespace-aware wildcard syntax (`crm.*`, `billing.list_invoices`)

**Why stdio child processes are cheap:**

Most MCP servers run as stdio processes. A stdio child process sitting idle costs ~30-50MB RAM, 3 file descriptors, no network connections, no heartbeat, no reconnection logic. At the scale of a partner hub (3-5 sources), that is 100-200MB total — one Railway service at the $5-10/mo tier.

| Setup | Tools on connect | Per-query cost |
|-------|----------------|----------------|
| 3 raw upstream MCPs | ~51 tools, ~20k tokens | Already loaded |
| 3 MCPack wrappers | 3 search_tools, ~300 tokens | 3-5 schemas per server |
| 1 MCPack multi-source gateway | 1 search_tools, ~100 tokens | 3-5 schemas total |

The more sources, the bigger the win. 10 servers with 200 tools still shows as 1 tool to the agent.

### 3.2 Dynamic Role Resolution — Provider-Agnostic

`resolveRole(session)` is a function on config that receives the MCP session context and returns a role string. MCPack calls it at the transport layer on every incoming connection, before source composition runs.

This is the critical architectural constraint: **auth resolution happens before any source MCP is touched.** The auth provider is never a source. Sources are what partners access after they are authenticated.

Built-in resolvers ship in separate packages to keep core zero-dependency:

| Package | Provider | Use case |
|---------|----------|----------|
| `@llvs/mcpack-google` | Google OAuth | v1.1 default — partners use existing Google accounts |
| `@llvs/mcpack-workos` | WorkOS | Enterprise SSO — Okta, SAML, Active Directory |
| `@llvs/mcpack-auth0` | Auth0 | Alternative enterprise auth |
| Base `staticResolver` | Static config | Email to role mapping, no JWT required |

v1.1 ships `@llvs/mcpack-google` and `staticResolver`. WorkOS and Auth0 resolvers are v1.2.

### 3.3 Google OAuth Flow

Partners authenticate with their existing Google account. No new accounts. No Loom Labs email required. Brian uses `brian@gmail.com` or `brian@hiscompany.com` — any Google-authenticated email works.

**Auth flow:**

1. You deploy a lightweight auth page on Railway (one route, "Sign in with Google" button)
2. Brian signs in with his existing Google account
3. Google returns a signed JWT containing his email and sub
4. Brian puts that JWT as the Bearer token in his Claude Code MCP config
5. On connect, `@llvs/mcpack-google` verifies the JWT against Google's JWKS endpoint
6. Extracts Brian's email from the verified claims
7. Maps email to role via static config
8. MCPack session is created with that role — sources never touched until auth resolves

**Role config:**

```typescript
resolveRole: googleResolver({
  roles: {
    'brian@gmail.com':          'cofounder',
    'smush@virtusnba.com':      'partner',
    'advisor@theirdomain.com':  'advisor',
  },
  fallbackRole: 'read'
})
```

Any email address works — Gmail, personal domain, company email — as long as Google can authenticate it.

### 3.4 Token-Based Deterministic Search

Replaces v1.0's 5-tier keyword scorer with a proper weighted inverted index. Built once at startup, zero runtime overhead, fully deterministic, testable.

**At index build time:**
- Tokenize each tool's name, description, and parameter names
- Normalize tokens (lowercase, strip punctuation, simple suffix stripping)
- Build inverted index: `token → [(toolName, weight)]`
- Weight by field: tool name tokens score highest, description tokens lower, parameter name tokens lowest

**At query time:**
- Tokenize the query the same way
- Look up each token in the inverted index
- Score tools by sum of weighted token matches
- Filter to role-permitted tools only
- Return top N by score

Same query always returns same results. Fully testable with unit tests asserting exact expected outputs.

### 3.5 HTTP/SSE Transport

MCPack v1.1 adds HTTP/SSE server mode for remote Railway deployment. Partners configure a URL and Bearer token in their Claude Code MCP config. No local server process required on the partner's machine.

Auth resolution happens at the HTTP layer — the Authorization header is extracted from the incoming SSE request before the MCP session is established.

---

## 4. Architecture

### 4.1 Auth at Transport Layer (Critical)

```
Partner's Claude Code
        |
        | HTTPS + Bearer (Google JWT)
        |
Transport Layer (HTTP/SSE)
  - Extract Authorization header
  - Verify JWT via @llvs/mcpack-google (Google JWKS)
  - Extract email from verified claims
  - Map email to role via static config
  - Attach role to incoming session context
        |
MCPack Gateway (role now resolved)
  - Build merged index across sources
  - Apply role filtering
  - Return search_tools only
        |
        | stdio child processes (internal — never visible to partner)
        |
   ┌────┴────┬────────┬──────────────┐
  CRM     Billing  Analytics   Custom MCP
 stdio    stdio     stdio        stdio
~50MB    ~50MB     ~50MB        ~50MB
```

Auth resolves at the top. Sources compose below. No circular dependency possible.

### 4.2 Generic Per-Project Config

```typescript
import { createMCPackServer, staticResolver } from '@llvs/mcpack'
import { googleResolver } from '@llvs/mcpack-google'

const { server, handle } = createMCPackServer({
  name: 'w2exits-partner-hub',
  version: '1.1.0',
  sources: [
    { name: 'crm',      server: crmMCP },
    { name: 'billing',  server: billingMCP },
    { name: 'analytics',server: analyticsMCP },
  ],
  roles: {
    cofounder: ['crm.*', 'billing.list_payments', 'analytics.*'],
    advisor:   ['crm.get_deals'],
    admin:     ['*']
  },
  resolveRole: googleResolver({
    roles: {
      'brian@gmail.com':     'cofounder',
      'advisor@domain.com':  'advisor',
    },
    fallbackRole: 'read'
  }),
  transport: {
    type: 'sse',
    port: 3000
  }
})
```

Sources, roles, and resolvers are all project-specific config. The MCPack package is generic.

### 4.3 Partner Claude Code Config

Brian adds one entry to his Claude Code MCP config:

```json
{
  "mcpServers": {
    "w2exits": {
      "url": "https://w2exits-partner-hub.railway.app/sse",
      "headers": {
        "Authorization": "Bearer BRIANS_GOOGLE_JWT"
      }
    }
  }
}
```

Brian gets his JWT from the lightweight auth page you deploy. One-time setup. JWT refresh handled by the auth page when token expires.

### 4.4 Identity Model

**v1.1 — Google OAuth + static role config**

Partners authenticate with existing Google accounts. You maintain a static email-to-role mapping in config. Adding a new partner means adding one line to the config and redeploying. Simple, zero new vendor, works immediately.

**v1.2 — Enterprise SSO**

WorkOS resolver for Okta, SAML, Active Directory. Required for Blackstone, Moody's, or any enterprise target with an existing identity provider. Same resolver hook, different package.

---

## 5. Technical Specification

### 5.1 Package Structure

```
packages/
├── mcpack/                       # @llvs/mcpack (updated)
│   ├── src/
│   │   ├── index.ts              # exports
│   │   ├── types.ts              # updated types
│   │   ├── core.ts               # MCPackEngine (updated)
│   │   ├── wrap.ts               # mcpack() wrap mode (unchanged)
│   │   ├── build.ts              # createMCPackServer() (updated)
│   │   ├── multi-source.ts       # NEW: source composition layer
│   │   ├── transport.ts          # NEW: HTTP/SSE server + auth extraction
│   │   ├── resolvers.ts          # NEW: staticResolver built-in
│   │   ├── index-builder.ts      # UPDATED: inverted index
│   │   ├── search.ts             # UPDATED: token-based scorer
│   │   ├── session.ts
│   │   └── roles.ts
│   └── test/
│       ├── multi-source.test.ts
│       ├── transport.test.ts
│       ├── resolvers.test.ts
│       ├── search.test.ts
│       └── inverted-index.test.ts
│
└── mcpack-google/                # @llvs/mcpack-google (NEW)
    ├── src/
    │   ├── index.ts
    │   └── google-resolver.ts
    └── test/
        └── google-resolver.test.ts
```

### 5.2 Updated Types

```typescript
export interface MCPackSource {
  name: string                    // namespace prefix
  server: Server                  // MCP SDK Server instance
}

export interface MCPackServerConfig extends MCPackConfig {
  name: string
  version: string
  tools?: MCPackToolDefinition[]  // build mode (unchanged)
  sources?: MCPackSource[]        // NEW: multi-source mode
  transport?: MCPackTransportConfig
}

export interface MCPackTransportConfig {
  type: 'stdio' | 'sse'
  port?: number                   // default 3000
  path?: string                   // default '/sse'
}

export interface MCPackConfig {
  roles?: RoleConfig
  defaultRole?: string
  resolveRole?: (session: MCPackSession) => string | Promise<string>
  index?: IndexConfig
  session?: SessionConfig
}

export interface MCPackSession {
  id: string
  headers?: Record<string, string>
  clientInfo?: { name?: string; version?: string }
}

// Role config supports namespace wildcards
// 'crm.*'           — all crm tools
// 'crm.get_deals'   — specific tool
// '*'               — all tools (admin)
export type RoleConfig = Record<string, string[]>
```

### 5.3 Multi-Source Module

```typescript
export interface SourceEntry {
  sourceName: string
  originalName: string
  prefixedName: string          // source.tool only if collision exists
  schema: object
  tokens: string[]
}

export async function composeSources(
  sources: MCPackSource[]
): Promise<{
  entries: SourceEntry[],
  routing: Map<string, string>  // prefixedName -> sourceName
}>
```

**Collision handling:**
- Build full name map across all sources first
- Only prefix when two sources share a tool name — prefix both
- Non-colliding tools keep original names — no unnecessary noise
- Warn on collision: `MCPack: collision "get_users" in "crm" and "billing" — prefixed as crm.get_users and billing.get_users`

### 5.4 Token-Based Inverted Index

```typescript
export interface InvertedIndex {
  entries: Map<string, Array<{ toolName: string; weight: number }>>
}

export function buildInvertedIndex(tools: SourceEntry[]): InvertedIndex

const WEIGHTS = {
  TOOL_NAME:   10,
  DESCRIPTION:  5,
  PARAM_NAME:   2,
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1)
}
```

```typescript
export function searchIndex(
  index: InvertedIndex,
  query: string,
  allowedTools: Set<string>,
  topN: number = 5
): string[]
```

### 5.5 Transport Module

```typescript
export function startSSEServer(
  server: Server,
  config: MCPackTransportConfig,
  resolveRole: (session: MCPackSession) => string | Promise<string>
): { close(): void }
```

Auth extraction happens here — at the transport boundary before any MCP protocol handling:

1. Extract `Authorization: Bearer <token>` from incoming SSE request headers
2. Pass headers to `resolveRole(session)` — resolver verifies token and returns role
3. Attach resolved role to session context
4. Establish MCP session with that role already set
5. Source composition proceeds with role already known

**Graceful shutdown:**
1. Stop accepting new connections
2. Send SIGTERM to all stdio child processes
3. Wait up to 2 seconds per process
4. Send SIGKILL to any remaining
5. Close SSE server

### 5.6 Static Resolver

```typescript
export function staticResolver(config: {
  roles: Record<string, string>
  fallbackRole?: string
  identifierField?: 'email' | 'sub' | 'id'  // default 'email'
}): (session: MCPackSession) => string
```

Base64 decodes the JWT payload, extracts the identifier field, maps to role. No signature verification at this layer — use when the transport itself is trusted (local stdio, internal network).

### 5.7 @llvs/mcpack-google Package

```typescript
export function googleResolver(config: {
  roles: Record<string, string>   // email -> role name
  fallbackRole?: string
  audience?: string               // Google OAuth client ID for token validation
}): (session: MCPackSession) => Promise<string>
```

**What it does:**

1. Extracts Bearer token from `session.headers.authorization`
2. Fetches Google's JWKS from `https://www.googleapis.com/oauth2/v3/certs` (cached, refreshed on rotation)
3. Verifies JWT signature against Google's public keys
4. Extracts `email` claim from verified token payload
5. Maps email to role via config
6. Returns fallbackRole if email not in config
7. Throws if token is invalid or expired

**Package details:**

```json
{
  "name": "@llvs/mcpack-google",
  "version": "1.1.0",
  "peerDependencies": {
    "@llvs/mcpack": "^1.1.0"
  },
  "dependencies": {
    "google-auth-library": "^9.0.0"
  }
}
```

Keeps `@llvs/mcpack` core zero-dependency. Only projects using Google OAuth pull in the Google auth library.

**Lightweight auth page (Railway):**

A minimal Express or Hono server with one route:

```
GET /auth         → redirect to Google OAuth
GET /auth/callback → exchange code for JWT, display token to partner
```

Partners visit once, copy their JWT, paste into Claude Code config. JWT lifetime is typically 1 hour — refresh flow handled by re-visiting the auth page.

---

## 6. Railway Deployment

### 6.1 Per-Project Deployment Pattern

```
w2exits-partner-hub.railway.app     → W2exits MCPack gateway
w2exits-auth.railway.app            → W2exits Google OAuth page
virtus-partner-hub.railway.app      → Virtus MCPack gateway
virtus-auth.railway.app             → Virtus Google OAuth page
```

### 6.2 Required Environment Variables

```bash
# Google OAuth
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx

# Source MCP credentials (partners never see these)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=xxx
STRIPE_SECRET_KEY=sk_live_xxx

# MCPack
PORT=3000
```

### 6.3 Memory Sizing Guide

| Sources | Estimated RAM | Railway tier |
|---------|--------------|--------------|
| 1-3     | 100-200MB    | $5/mo        |
| 4-6     | 200-400MB    | $10/mo       |
| 7-10    | 350-600MB    | $20/mo       |
| 10+     | Evaluate cluster approach in v1.2 |

---

## 7. Resolver Architecture — Provider Agnostic

The `resolveRole` hook is the extension point. MCPack core does not care which provider verified the token. It receives a role string and proceeds. This means:

- Swapping auth providers requires changing one package import and config
- Enterprise targets get WorkOS or Auth0 resolver with no changes to MCPack core
- Custom resolvers can be written for any auth system

**Planned resolver packages:**

| Package | Provider | Target | Version |
|---------|----------|--------|---------|
| `@llvs/mcpack-google` | Google OAuth | Venture studio partners | v1.1 |
| `@llvs/mcpack-workos` | WorkOS | Enterprise SSO (Okta, SAML, AD) | v1.2 |
| `@llvs/mcpack-auth0` | Auth0 | Alternative enterprise auth | v1.2 |

---

## 8. Acceptance Criteria

- [ ] `createMCPackServer` accepts `sources` array and spawns stdio child processes at startup
- [ ] Tool name collisions prefixed with `source.toolname` — non-collisions keep original names
- [ ] `tools/call` routes to correct source via routing map
- [ ] Role filtering applies at both search and execution layers
- [ ] Namespace wildcard `crm.*` matches all crm tools
- [ ] Inverted index built at startup — not at query time
- [ ] Same query returns same results every time
- [ ] Auth resolution happens at transport layer before source composition
- [ ] `resolveRole(session)` receives headers including Authorization
- [ ] `@llvs/mcpack-google` verifies Google JWT and maps email to role
- [ ] Partners authenticate with existing Google accounts — no new accounts required
- [ ] `staticResolver` maps identifier to role from config object
- [ ] HTTP/SSE transport starts on configured port
- [ ] Bearer token from Authorization header passed to session context
- [ ] Partner connects via Claude Code URL config with Bearer token
- [ ] Graceful shutdown kills all child processes cleanly
- [ ] All v1.0 wrap mode and build mode behavior unchanged
- [ ] All v1.0 tests pass
- [ ] New tests: multi-source composition, collision handling, inverted index, deterministic search, Google JWT resolution, static resolver, SSE transport, graceful shutdown
- [ ] `@llvs/mcpack@1.1.0` and `@llvs/mcpack-google@1.1.0` published to npm

---

## 9. Out of Scope for v1.1

- Token expiry and refresh automation (return clear error, partner re-visits auth page)
- Audit log exposure endpoint (deferred to v1.2)
- Rate limiting per role (deferred to v1.2)
- Per-project role scoping (deferred to v1.2)
- WorkOS and Auth0 resolvers (deferred to v1.2 — required for enterprise targets)
- Shared hosted gateway with team management dashboard (Layer 3 — future product)
- Cluster / multi-node deployment (single Railway instance sufficient for v1.1)
- Semantic / embedding-based search (inverted index sufficient for v1.1 tool surfaces)
- Commercial pricing model (to be defined jointly with any enterprise partner)

---

## 10. Known Risks

- MCPack depends on MCP SDK's low-level `Server` class for `setRequestHandler`. Monitor SDK releases for breaking changes.
- Google JWKS keys rotate periodically. Cache with TTL and refresh on verification failure to handle rotation gracefully.
- Source MCP servers spawn at startup. If a source goes down post-startup, calls to that source's tools fail. Return `isError: true` with clear message rather than crashing the gateway.
- Graceful shutdown takes up to 4 seconds per stdio process. For 10+ sources this could exceed Railway's shutdown timeout. Document max recommended sources.
- Google JWT lifetime is ~1 hour. Partners need to re-authenticate when token expires. Auth page handles this but token expiry mid-session will disconnect the partner.
- MCP protocol gateway patterns are actively being standardized. MCPack sits above the protocol layer and consumes the SDK — monitor SDK releases for gateway-related updates that could improve or conflict with this approach.

---

## 11. Future Roadmap

### v1.2
- WorkOS resolver for enterprise SSO (Okta, SAML, Active Directory)
- Auth0 resolver
- Token expiry and refresh handling
- Audit log exposure endpoint or webhook
- Rate limiting per role
- Per-project role scoping
- Pluggable embedding provider for semantic search

### v1.3 and beyond
- Cluster / multi-node deployment for high availability
- Per-partner usage analytics
- Kill switch per partner or per role

### Layer 3 — MCPack Platform
Hosted gateway with web dashboard. Team management, invite members, assign roles. Audit logs, usage analytics. Commercial pricing and structure to be defined with enterprise partners.

---

## 12. Definition of Done

- `@llvs/mcpack@1.1.0` published to npm
- `@llvs/mcpack-google@1.1.0` published to npm
- Lightweight Google OAuth auth page deployed on Railway
- W2exits partner hub deployed on Railway using v1.1
- Brian authenticates with his Google account and connects via Claude Code
- Brian sees only co-founder scoped tools across all sources
- Smush connects to Virtus hub with his Google account and sees partner scoped tools
- All acceptance criteria pass
- Docs site updated with multi-source, Google OAuth, and gateway examples
- README repositioned: RBAC and gateway first, token reduction secondary

---

*MCPack PRD v1.1 — Loom Labs — 2026-03-28*
