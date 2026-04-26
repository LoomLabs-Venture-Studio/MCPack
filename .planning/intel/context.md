# Context (Synthesized Intel)

> Background, problem framing, user personas, deployment patterns, and risk notes from the ingest set. Captured as topical notes for downstream consumption.

---

## Topic: v1.0 Recap (existing context)
source: `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`

- v1.0 shipped 2026-03-23 as `@llvs/mcpack@1.0.0` on npm
- 100 tests, 99.56% statement coverage, 80.7% aggregate token reduction on real Stripe MCP (28 tools)
- Two entry points: `mcpack(server, config)` (wrap) and `createMCPackServer(config)` (build)
- Single discovery tool pattern: `tools/list` always returns one tool (`search_tools`), schemas delivered on demand
- Handler replacement architecture: walks SDK `Server`'s `_requestHandlers` Map, swaps `tools/list` and `tools/call` handlers
- Opaque denial: out-of-role `tools/call` returns `"Unknown tool: {name}"`
- 5-tier weighted keyword scorer: exact name → partial name → description → param-name → token match
- Session tracking: sliding TTL (default 2h), dual cleanup, `.unref()`-ed timer
- Role config: wildcard `'*'`, hierarchical inheritance, cycle protection
- Zero core runtime deps; sole peer dep is `@modelcontextprotocol/sdk`

---

## Topic: v1.1 Problem Framing
source: `mcpack-prd-v1.1-gsd.md` Problem section

- Keyword scoring has a fundamental ceiling: it matches on surface form, not meaning. An agent querying "show outstanding invoices" misses a tool named `list_unpaid_bills` even though intent is identical.
- Beyond a handful of well-named tools — especially in enterprise wrappers with opaque naming — keyword recall degrades and agents are forced into broader, less efficient queries.
- v1.0 has zero observability. Operators cannot see which tools are searched, called, denied, or never touched. Dead tools inflate the index and consume schema budget silently. Misconfigured roles surface only when partners complain.
- v1.1 closes both gaps while preserving every v1.0 invariant.

---

## Topic: v1.1 User Personas
source: `mcpack-prd-v1.1-gsd.md` Users & Use Cases

- **MCP server authors (build mode)**: Build new MCP servers from scratch with MCPack baked in. Benefit: semantic search compensates for non-keyword-optimized descriptions. Analytics surface dead-weight tools and denial-heavy roles.
- **MCP integrators (wrap mode)**: Retrofit MCPack onto third-party / vendor / internal servers. Benefit: tool names/descriptions written for developers, not agents — semantic search bridges the gap. Analytics justify the wrapping investment.
- **Agent developers**: Consume MCPack-wrapped servers via `search_tools`. Benefit: natural-language queries find tools without exact keyword match.
- **Operators (deployers)**: Run the MCPack-wrapped server in production. `getAnalytics()` provides runtime view without external tooling — identify misconfigured roles, dead tools, hotspots from within the same process.

---

## Topic: v1.2 Problem Framing — Loom Labs Partner Access
source: `mcpack-prd-v1.1-final.md` §2.1, §2.2, §2.3

- Every Loom Labs project has co-founders and partners who need operational access to a shared stack — deal data, user management, payments, analytics. Today's bad options: build a custom admin dashboard (weeks of work, per project) or share database credentials (security nightmare).
- v1.0 solved guardrails (role-based filtering) but had two gaps:
    1. Single server only — a real partner hub composes multiple upstream MCPs (data APIs, third-party MCPs, custom logic) behind one entry.
    2. Static role assignment — `defaultRole` gives every session the same role. Real access needs per-identity role mapping (Brian → cofounder, Smush → partner, external client → read-only) without per-connection manual config.
- The Generic Partner Hub Pattern: each Loom Labs project deploys its own MCPack instance on Railway. Partners authenticate with existing Google accounts (no new accounts, no Loom Labs email required). MCPack resolves role from verified Google JWT and exposes only role-permitted tools across composed sources.
- The Circular Dependency (solved): earlier iterations considered Clerk both as auth provider AND as a source MCP. That creates circularity — MCPack must validate auth before composing sources, but if the auth provider is itself a source, the auth layer depends on something it is supposed to gatekeep. **Fix:** auth validation happens at the transport layer, before source composition runs. Auth provider is never a source.

---

## Topic: v1.2 Architecture — Auth at Transport Layer
source: `mcpack-prd-v1.1-final.md` §4.1

```
Partner's Claude Code
        |
        | HTTPS + Bearer (Google JWT)
        v
Transport Layer (HTTP/SSE)
  - Extract Authorization header
  - Verify JWT via @llvs/mcpack-google (Google JWKS)
  - Extract email from verified claims
  - Map email to role via static config
  - Attach role to incoming session context
        v
MCPack Gateway (role now resolved)
  - Build merged index across sources
  - Apply role filtering
  - Return search_tools only
        |
        | stdio child processes (internal — never visible to partner)
        v
   ┌────┴────┬────────┬──────────────┐
  CRM     Billing  Analytics   Custom MCP
 stdio    stdio     stdio        stdio
~50MB    ~50MB     ~50MB        ~50MB
```

Auth resolves at the top. Sources compose below. No circular dependency possible.

---

## Topic: v1.2 Generic Per-Project Config Example
source: `mcpack-prd-v1.1-final.md` §4.2

```typescript
import { createMCPackServer, staticResolver } from '@llvs/mcpack'
import { googleResolver } from '@llvs/mcpack-google'

const { server, handle } = createMCPackServer({
  name: 'w2exits-partner-hub',
  version: '1.2.0',                              // VERSION CORRECTED PER BOARD
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

Sources, roles, resolvers — all project-specific. The MCPack package stays generic.

---

## Topic: v1.2 Partner Claude Code Config
source: `mcpack-prd-v1.1-final.md` §4.3

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

Partner gets JWT from a lightweight auth page (Railway). One-time setup. JWT lifetime ~1h — refresh via re-visit to auth page.

---

## Topic: v1.2 Identity Model
source: `mcpack-prd-v1.1-final.md` §4.4

- **v1.2:** Google OAuth + static email-to-role config. Partners use existing Google accounts (Gmail, personal domain, company email). Adding a partner = adding one config line and redeploying.
- **Future (v1.3+):** Enterprise SSO via WorkOS resolver (Okta, SAML, AD). Required for enterprise targets like Blackstone or Moody's. Same hook, different package.

---

## Topic: v1.2 Why stdio Children Are Cheap
source: `mcpack-prd-v1.1-final.md` §3.1

- Most MCP servers run as stdio processes. An idle stdio child uses ~30-50MB RAM, 3 file descriptors, no network connections, no heartbeat, no reconnection logic.
- 3-5 sources at the partner-hub scale = 100-200MB total → fits one Railway service at the $5-10/mo tier.
- Tool surface comparison (3 sources / ~51 tools):
    - 3 raw upstream MCPs: ~20k tokens loaded on connect
    - 3 separate MCPack wrappers: ~300 tokens, but 3 search_tools surfaced
    - 1 MCPack multi-source gateway: ~100 tokens, 1 search_tools, schemas loaded on demand
- The more sources, the bigger the win. 10 servers / 200 tools still surfaces as 1 tool to the agent.

---

## Topic: v1.2 Resolver Architecture — Provider Agnostic
source: `mcpack-prd-v1.1-final.md` §7

`resolveRole(session) → string | Promise<string>` is the extension point. MCPack core does not care which provider verified the token. Receives a role string, proceeds. Implications:

- Swap auth providers = change one package import + config
- Enterprise targets get WorkOS/Auth0 with no core changes
- Custom resolvers can be written for any auth system

Planned resolver packages:
- `@llvs/mcpack-google` — Google OAuth — venture studio partners — **v1.2 (this milestone)**
- `@llvs/mcpack-workos` — WorkOS — enterprise SSO (Okta, SAML, AD) — v1.3+
- `@llvs/mcpack-auth0` — Auth0 — alternative enterprise auth — v1.3+

---

## Topic: v1.1 Risks (with mitigations)
source: `mcpack-prd-v1.1-gsd.md` Risks & Mitigations

- `@xenova/transformers` + MiniLM model adds significant install size to `@llvs/mcpack-embeddings` — adapter is in a separate package so core users unaffected; document model size in adapter README.
- Embedding query latency may exceed 50ms budget on low-powered Railway free tier — bench before GA; cache repeated query embeddings within session if needed.
- Semantic search may regress on tool surfaces with very short / cryptic names — hybrid 0.7/0.3 default preserves keyword floor; operators can tune toward keyword-heavy.
- Analytics memory growth unbounded in long-running high-throughput sessions — cap event arrays at configurable `maxEvents` (default 10,000).
- MCP SDK internal `_requestHandlers` Map (used by wrap mode) may change — v1.1 adds a startup assertion that throws clearly if handler map is inaccessible.
- Semantic index not ready when first query arrives — fall back to keyword scoring, log warning, never block `search_tools` response.

---

## Topic: v1.2 Risks
source: `mcpack-prd-v1.1-final.md` §10

- MCPack depends on MCP SDK's low-level `Server` class for `setRequestHandler` — monitor SDK releases for breaking changes
- Google JWKS keys rotate periodically — cache with TTL, refresh on verification failure
- Source MCP servers spawn at startup; post-startup source crash → return `isError: true` rather than crash gateway
- Graceful shutdown takes up to 4s per stdio process — 10+ sources may exceed Railway's shutdown timeout; document max recommended sources
- Google JWT lifetime ~1h — partners need re-authentication; mid-session expiry disconnects partner
- MCP protocol gateway patterns are actively being standardized — monitor SDK gateway-related updates that could improve or conflict with this approach

---

## Topic: v1.2 Railway Deployment Pattern
source: `mcpack-prd-v1.1-final.md` §6.1

```
w2exits-partner-hub.railway.app     → W2exits MCPack gateway
w2exits-auth.railway.app            → W2exits Google OAuth page
virtus-partner-hub.railway.app      → Virtus MCPack gateway
virtus-auth.railway.app             → Virtus Google OAuth page
```

Per-project deployment — gateway and auth page deployed as separate Railway services per project.

---

## Topic: v1.2 Auth Page (Lightweight)
source: `mcpack-prd-v1.1-final.md` §5.7

Minimal Express or Hono server with one route group:

```
GET /auth         → redirect to Google OAuth
GET /auth/callback → exchange code for JWT, display token to partner
```

Partners visit once, copy JWT, paste into Claude Code config. JWT lifetime ~1h — refresh by re-visiting the page.

---

## Topic: v1.2 Future Roadmap (v1.3+)
source: `mcpack-prd-v1.1-final.md` §11

> Note: PRD §11 was authored against the original v1.1 framing. Items marked there as "v1.2" should be re-evaluated by the roadmapper for inclusion in v1.2 scope vs slip to v1.3 — the synthesizer does NOT pre-decide.

PRD-original v1.2 candidates (now re-evaluation candidates for the actual v1.2):
- WorkOS resolver for enterprise SSO
- Auth0 resolver
- Token expiry / refresh handling
- Audit log exposure endpoint or webhook
- Rate limiting per role
- Per-project role scoping
- Pluggable embedding provider for semantic search — **already moved to v1.1 by board**

PRD-original v1.3+ candidates:
- Cluster / multi-node deployment for high availability
- Per-partner usage analytics
- Kill switch per partner or per role

Layer 3 — MCPack Platform (future product):
- Hosted gateway with web dashboard
- Team management, member invites, role assignment
- Audit logs, usage analytics
- Commercial pricing structure (defined with enterprise partners)

---

## Topic: Cross-PRD Relationship
sources: `mcpack-prd-v1.1-gsd.md` cross_references; `mcpack-prd-v1.1-final.md` cross_references

- The two PRDs are **sequential, not overlapping in feature surface**:
    - v1.1 covers semantic search overlay + analytics
    - v1.2 covers multi-source composition + auth resolver hook + Google OAuth + HTTP/SSE transport
- Each PRD's non-goals explicitly defer to the other (v1.1 non-goals defer multi-source / OAuth / SSE to v1.2; v1.2 non-goals defer semantic search to v1.2 — overridden by board to v1.1).
- Both PRDs explicitly affirm v1.0 public API stability — compounds to a hard lock through v1.2.
- Shared architectural commitment: model deps and auth deps live in sibling packages, never in core.
