---
template: home.html
title: MCPack — Intelligent Tool Discovery for MCP Servers
hide:
  - navigation
  - toc
---

<div class="mp-features">
  <div class="mp-card">
    <div class="mp-card__icon mp-card__icon--search">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M9.5 3A6.5 6.5 0 0 1 16 9.5c0 1.61-.59 3.09-1.56 4.23l.27.27h.79l5 5-1.5 1.5-5-5v-.79l-.27-.27A6.52 6.52 0 0 1 9.5 16 6.5 6.5 0 0 1 3 9.5 6.5 6.5 0 0 1 9.5 3m0 2C7 5 5 7 5 9.5S7 14 9.5 14 14 12 14 9.5 12 5 9.5 5"/></svg>
    </div>
    <h3 class="mp-card__title">Intelligent Discovery</h3>
    <p class="mp-card__text">Agents search for tools with natural language instead of receiving every schema upfront. 5-tier keyword scoring surfaces the most relevant results first.</p>
  </div>
  <div class="mp-card">
    <div class="mp-card__icon mp-card__icon--session">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9m0 16c-3.86 0-7-3.14-7-7s3.14-7 7-7 7 3.14 7 7-3.14 7-7 7m.5-11H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
    </div>
    <h3 class="mp-card__title">Session Memory</h3>
    <p class="mp-card__text">Schemas loaded once are never sent again. Subsequent calls return lightweight references. Zero duplicate payloads across the session lifetime.</p>
  </div>
  <div class="mp-card">
    <div class="mp-card__icon mp-card__icon--roles">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5zm0 6c1.4 0 2.8 1.1 2.8 2.5V11c.6 0 1.2.6 1.2 1.3v3.5c0 .6-.6 1.2-1.3 1.2H9.2c-.6 0-1.2-.6-1.2-1.3v-3.5c0-.6.6-1.2 1.2-1.2V9.5C9.2 8.1 10.6 7 12 7m0 1.2c-.8 0-1.5.5-1.5 1.3V11h3V9.5c0-.8-.7-1.3-1.5-1.3"/></svg>
    </div>
    <h3 class="mp-card__title">Role-Based Access</h3>
    <p class="mp-card__text">Define roles with granular tool permissions. Agents only discover what their role allows. Wildcard grants full access for admin contexts.</p>
  </div>
  <div class="mp-card">
    <div class="mp-card__icon mp-card__icon--modes">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6z"/></svg>
    </div>
    <h3 class="mp-card__title">Wrap or Build</h3>
    <p class="mp-card__text">Wrap any existing MCP server in one line, or build a new one from scratch with handlers. Same engine, same protocol, your choice.</p>
  </div>
</div>

---

## How It Works

<div class="mp-how">
  <div class="mp-step">
    <h4 class="mp-step__title">Connect</h4>
    <p class="mp-step__text"><code>tools/list</code> returns one tool: <code>search_tools</code>. No schema dump. No wasted tokens. The agent knows how to search.</p>
  </div>
  <div class="mp-step">
    <h4 class="mp-step__title">Search</h4>
    <p class="mp-step__text">Agent queries <code>search_tools</code> with natural language. MCPack returns the top matching schemas ranked by relevance, scoped to the agent's role.</p>
  </div>
  <div class="mp-step">
    <h4 class="mp-step__title">Execute</h4>
    <p class="mp-step__text">Agent calls discovered tools normally. MCPack routes to the right handler and tracks the session. Loaded schemas are cached automatically.</p>
  </div>
</div>

---

## Measured on Real Infrastructure

Tested against **Stripe MCP** — 28 production tools. Not simulated.

| Query | Without MCPack | With MCPack | Saved |
|-------|---------------|-------------|-------|
| create a payment | 8,315 tokens | 1,040 tokens | **87.5%** |
| manage customers | 8,315 tokens | 1,984 tokens | **76.1%** |
| subscription billing | 8,315 tokens | 3,279 tokens | **60.6%** |
| issue refund | 8,315 tokens | 799 tokens | **90.4%** |
| list invoices | 8,315 tokens | 913 tokens | **89.0%** |
| **Aggregate (5 queries)** | **41,575** | **8,015** | **80.7%** |

<small>Results vary by server size and query breadth. Larger tool surfaces see greater reduction.</small>

---

## Quick Start

```bash
npm install @llvs/mcpack
```

```typescript
import { mcpack } from '@llvs/mcpack';

const handle = await mcpack(server, {
  roles: { default: ['create_payment', 'list_customers'], admin: ['*'] },
  defaultRole: 'default',
});
```

One function call. Your server now exposes `search_tools` instead of dumping every schema.

<div class="mp-footer-cta">
  <a href="docs/" class="mp-btn mp-btn--primary">
    <span>Read the Docs</span>
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </a>
  <a href="https://github.com/LoomLabs-Venture-Studio/mcpack" class="mp-btn mp-btn--ghost">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
    <span>View on GitHub</span>
  </a>
</div>
