---
template: home.html
title: MCPack — Lazy Tool Discovery for MCP Servers
hide:
  - navigation
  - toc
---

<div class="mp-features">
  <div class="mp-card">
    <div class="mp-card__icon mp-card__icon--search">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28"><path fill="currentColor" d="M9.5 3A6.5 6.5 0 0 1 16 9.5c0 1.61-.59 3.09-1.56 4.23l.27.27h.79l5 5-1.5 1.5-5-5v-.79l-.27-.27A6.52 6.52 0 0 1 9.5 16 6.5 6.5 0 0 1 3 9.5 6.5 6.5 0 0 1 9.5 3m0 2C7 5 5 7 5 9.5S7 14 9.5 14 14 12 14 9.5 12 5 9.5 5"/></svg>
    </div>
    <h3 class="mp-card__title">Lazy Discovery</h3>
    <p class="mp-card__text">Agents search for tools by keyword instead of receiving every schema upfront. Only the relevant schemas are loaded into context.</p>
  </div>
  <div class="mp-card">
    <div class="mp-card__icon mp-card__icon--session">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28"><path fill="currentColor" d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9m0 16c-3.86 0-7-3.14-7-7s3.14-7 7-7 7 3.14 7 7-3.14 7-7 7m.5-11H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
    </div>
    <h3 class="mp-card__title">Session Tracking</h3>
    <p class="mp-card__text">Schemas loaded once per session are returned as references on subsequent calls. No duplicate payloads, ever.</p>
  </div>
  <div class="mp-card">
    <div class="mp-card__icon mp-card__icon--roles">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28"><path fill="currentColor" d="M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5zm0 6c1.4 0 2.8 1.1 2.8 2.5V11c.6 0 1.2.6 1.2 1.3v3.5c0 .6-.6 1.2-1.3 1.2H9.2c-.6 0-1.2-.6-1.2-1.3v-3.5c0-.6.6-1.2 1.2-1.2V9.5C9.2 8.1 10.6 7 12 7m0 1.2c-.8 0-1.5.5-1.5 1.3V11h3V9.5c0-.8-.7-1.3-1.5-1.3"/></svg>
    </div>
    <h3 class="mp-card__title">Role-Based Access</h3>
    <p class="mp-card__text">Define roles with allowed tool lists. Agents only see and search tools their role permits. Wildcard for admin access.</p>
  </div>
  <div class="mp-card">
    <div class="mp-card__icon mp-card__icon--modes">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28"><path fill="currentColor" d="M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6z"/></svg>
    </div>
    <h3 class="mp-card__title">Two Modes</h3>
    <p class="mp-card__text">Wrap any existing MCP server, or build a new one from scratch. Same engine, same search, same session behavior.</p>
  </div>
</div>

---

## How It Works

<div class="mp-how">
  <div class="mp-step">
    <h4 class="mp-step__title">Agent Connects</h4>
    <p class="mp-step__text"><code>tools/list</code> returns a single tool: <code>search_tools</code>. No schema dump. No token waste.</p>
  </div>
  <div class="mp-step">
    <h4 class="mp-step__title">Agent Searches</h4>
    <p class="mp-step__text">Agent calls <code>search_tools</code> with a natural language query. MCPack returns the top matching schemas, ranked by relevance.</p>
  </div>
  <div class="mp-step">
    <h4 class="mp-step__title">Agent Calls</h4>
    <p class="mp-step__text">Agent uses the discovered tools normally. MCPack routes calls to the right handler. Session tracks what's loaded.</p>
  </div>
</div>

---

## Real Performance

Measured on **Stripe MCP** (28 tools). Not simulated — real harness output:

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

| Query | Vanilla | MCPack | Reduction |
|-------|---------|--------|-----------|
| create a payment | 8,315 | 1,040 | **87.5%** |
| manage customers | 8,315 | 1,984 | **76.1%** |
| subscription billing | 8,315 | 3,279 | **60.6%** |
| issue refund | 8,315 | 799 | **90.4%** |
| list invoices | 8,315 | 913 | **89.0%** |
| **Aggregate** | **41,575** | **8,015** | **80.7%** |

---

## Quick Start

```bash
npm install mcpack
```

```typescript
import { mcpack } from 'mcpack';

const handle = await mcpack(server, {
  roles: { default: ['create_payment', 'list_customers'], admin: ['*'] },
  defaultRole: 'default',
});
```

That's it. Your server now exposes `search_tools` instead of dumping every schema.

<div class="mp-footer-cta">
  <a href="docs/" class="md-button md-button--primary">Read the Docs</a>
  <a href="https://github.com/LoomLabs-Venture-Studio/mcpack" class="md-button">View on GitHub</a>
</div>
