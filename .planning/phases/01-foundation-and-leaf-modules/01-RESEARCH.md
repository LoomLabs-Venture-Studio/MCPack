# Phase 1: Foundation and Leaf Modules - Research

**Researched:** 2026-03-20
**Domain:** TypeScript project scaffolding + four independent leaf modules (index-builder, search engine, session registry, role filter)
**Confidence:** HIGH

## Summary

Phase 1 is a greenfield scaffolding phase plus four independent leaf modules with zero internal dependencies beyond shared types. The project is an ESM-only TypeScript npm package targeting Node.js 18+. The sole peer dependency is `@modelcontextprotocol/sdk@^1.27.1` (which itself requires `zod` and `@cfworker/json-schema` as peers). All four leaf modules are pure logic -- no MCP SDK wiring happens until Phase 2.

The CONTEXT.md decisions are highly specific: exact score weights, exact session ID strategy, exact cleanup behavior, exact role defaults. This eliminates ambiguity for the planner. The key risk for this phase is getting the project structure and types right since all subsequent phases build on them.

**Primary recommendation:** Build types.ts first (all interfaces), then the four leaf modules in parallel (search.ts, session.ts, roles.ts, index-builder.ts), each with unit tests. Ship with `tsc --noEmit` green and all unit tests passing.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Keep PRD algorithm as-is: camelCase splitting, underscore splitting, stop word removal. No stemming in v1.
- Add schema `inputSchema.properties` names as a third keyword source, tokenized the same way as tool names (camelCase/underscore split). Weighted lowest at 1.
- Internal named constants for score weights -- not user-configurable in v1:
  - `EXACT_NAME = 10`
  - `PARTIAL_NAME = 5`
  - `DESCRIPTION = 3`
  - `KEYWORD = 2`
  - `SCHEMA_PROPERTY = 1`
- Case-insensitive matching everywhere (lowercase all inputs).
- Zero matches returns empty `tools` array. No fallback to "top N" or suggestions.
- `includes()` for substring matching (PRD behavior).
- Session ID strategy: use `'__stdio__'` constant for stdio transport (single session per process). HTTP/SSE transports use `ctx.sessionId` from the MCP SDK.
- Sliding TTL: `lastActiveAt` resets on every `search_tools` call. Default 2 hours.
- Dual cleanup strategy: lazy expiry check on every `getOrCreate()` call (if expired, delete and create fresh) PLUS `setInterval` every 15 minutes with `.unref()` as backstop for abandoned sessions.
- `destroy()` clears everything: stops timer AND clears all session data. Clean slate. Intended for shutdown and testing.
- Query log on Session: `queryLog: Array<{ query: string, results: string[], timestamp: number }>`. Appended on every `search_tools` call. Server-side only -- never included in `SearchToolResponse`.
- No roles config provided -> all tools visible (no filtering). Simplest default for users who don't need RBAC.
- Roles configured but session's role doesn't match any defined role -> no tools visible. Secure by default.
- Drop `tier` field from `ToolIndexEntry`. Role filtering happens at query time, not at index time.
- Role filtering applies to BOTH `search_tools` results AND `tools/call` execution (defense in depth). Designed here but enforced in Phase 2/3.
- `defaultRole` field on `MCPackConfig` -- all sessions get this role unless overridden.
- Own types that extend MCP SDK types where needed (e.g., `MCPackToolDefinition extends Tool` with `handler` added for build mode).
- Public API exports only: `MCPackConfig`, `MCPackServerConfig`, `MCPackToolDefinition`, `RoleConfig`, `IndexConfig`, `SessionConfig`, `SearchToolResponse`, `SearchResult`, `ToolCallResult`.
- Keep private (not exported from package entry point): `ToolIndexEntry`, `Session` (including queryLog), score weight constants.
- `SearchToolResponse` stays minimal: `{ tools, total_available, showing, session_id }`. No query echo.

### Claude's Discretion
- Exact stop words list for keyword extraction
- package.json metadata (author, repository fields)
- tsconfig.json strictness settings (recommend strict: true)
- File organization within src/ (one file per module as PRD suggests, or split if a module grows)

### Deferred Ideas (OUT OF SCOPE)
- Role enforcement at `tools/call` level -- designed here but enforced in Phase 2/3 when entry points are built.
- Query log size limits or rotation -- not needed for v1 session lifetimes.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SRCH-01 | Keyword-based scoring ranks results by: exact name match > partial name match > description match > extracted keyword match | Score weight constants defined in CONTEXT.md. Search engine module is a pure function with no external deps. PRD pseudocode provides base algorithm; CONTEXT.md adds schema property matching at weight 1. |
| SRCH-02 | Result limit is configurable (default 5, max 10) via config and per-query `limit` parameter | `IndexConfig.maxResults` defaults to 5. Per-query `limit` param capped at 10 via `Math.min()`. Both values flow into `scoreAndRank()` limit parameter. |
| SESS-01 | Each session tracks which tool schemas have been loaded via a `loadedTools` set | `Session` interface includes `loadedTools: Set<string>`. SessionRegistry exposes `getOrCreate()` which returns session with this set. |
| SESS-02 | Sessions expire after a configurable TTL (default 2 hours) and are cleaned up automatically | CONTEXT.md specifies dual cleanup: lazy check on `getOrCreate()` + `setInterval` every 15 min. Default TTL 7200000ms. Sliding TTL resets `lastActiveAt` on access. |
| SESS-03 | Cleanup timer uses `.unref()` to avoid blocking Node.js process exit | Explicit in CONTEXT.md and PITFALLS.md. `setInterval(...).unref()` on the backstop timer. |
| SESS-04 | Public `destroy()` method stops cleanup timer and clears all sessions for clean shutdown | CONTEXT.md: `destroy()` clears everything -- stops timer AND clears all session data. Essential for test teardown. |
| ROLE-01 | Roles are defined as a config map of role name to array of allowed tool names | `RoleConfig` type: `{ [roleName: string]: string[] \| '*' }`. PRD pseudocode for `resolveRoleAccess()` with recursive role inheritance. |
| ROLE-02 | Wildcard `'*'` grants a role access to all tools | `getAllowedTools()` returns `'*'` sentinel when role definition is `'*'`. `resolveRoleAccess()` returns full index when wildcard detected. |
| ROLE-03 | `search_tools` results and `total_available` count reflect only tools the caller's role can access | Role filter is applied before search scoring. `total_available` = length of role-filtered index. Implementation is in the role filter module; wiring happens in Phase 2. |
| PKG-01 | Package compiles with `tsc` and exports TypeScript type definitions | tsconfig.json with `declaration: true`, `module: "NodeNext"`, `target: "ES2022"`. Build script: `tsc`. Output: `dist/` with `.js` + `.d.ts` files. |
| PKG-02 | No runtime dependencies beyond `@modelcontextprotocol/sdk` as peer dependency | Zero `dependencies` in package.json. MCP SDK, zod, and @cfworker/json-schema as `peerDependencies`. All other packages are `devDependencies`. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | ~5.8.3 | Language, type safety, .d.ts generation | Stable GA. STACK.md recommends 5.8.x line. 5.9.3 exists but 5.8 is the proven stable line per project research. |
| Node.js | >=18.0.0 (dev on 22 LTS) | Runtime | MCP SDK requires Node 18+ for `globalThis.crypto`. |
| `@modelcontextprotocol/sdk` | ^1.27.1 (peer dep) | MCP type imports only in Phase 1 (`Tool` type) | Sole runtime peer dependency. v1.27.1 is current latest. |
| `zod` | ^3.25.0 \|\| ^4.0.0 | Peer dep (transitive via MCP SDK) | MCP SDK 1.27.1 declares `zod: "^3.25 \|\| ^4.0"` as peer dep. |
| `@cfworker/json-schema` | ^4.1.1 | Peer dep (transitive via MCP SDK) | MCP SDK 1.27.1 declares this as a peer dep for JSON Schema validation. |

### Supporting (Dev Only)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | ^4.1.0 | Unit testing | All leaf module tests. Native ESM + TypeScript support. |
| `@vitest/coverage-v8` | ^4.1.0 | Code coverage | `vitest --coverage` for coverage reports. |
| `@modelcontextprotocol/sdk` | ^1.27.1 | Dev dep for `Tool` type import during development | Listed as both peerDep and devDep. |
| `zod` | ^3.25.76 | Dev dep matching MCP SDK peer | Install latest 3.x for dev. Consumers provide their own. |
| `@cfworker/json-schema` | ^4.1.1 | Dev dep matching MCP SDK peer | Install for dev. Consumers provide their own. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| TypeScript 5.8.x | TypeScript 5.9.3 | 5.9 is newest but 5.8 is the stable line per STACK.md. Stick with 5.8 for stability. |
| `tsc` for build | `tsup` | tsup adds bundling config complexity for no benefit on a pure ESM library. |
| `vitest` | `jest` | Jest has poor native ESM support. vitest is the standard for ESM TypeScript. |

**Installation:**
```bash
# Dev dependencies (MCPack has zero runtime deps)
npm install -D typescript@~5.8.3 vitest@^4.1.0 @vitest/coverage-v8@^4.1.0
npm install -D @modelcontextprotocol/sdk@^1.27.1 zod@^3.25.76 @cfworker/json-schema@^4.1.1
```

**Version verification (2026-03-20):**
- `typescript`: 5.8.3 (latest 5.8.x), 5.9.3 (absolute latest)
- `vitest`: 4.1.0 (latest)
- `@modelcontextprotocol/sdk`: 1.27.1 (latest)
- `zod`: 4.3.6 (latest overall), 3.25.76 (latest 3.x)
- `@cfworker/json-schema`: 4.1.1 (latest)

## Architecture Patterns

### Recommended Project Structure
```
src/
├── index.ts              # Public exports: types only in Phase 1 (entry points added Phase 2/3)
├── types.ts              # All TypeScript interfaces (public + internal)
├── index-builder.ts      # Builds ToolIndexEntry[] from tool definitions
├── search.ts             # Keyword scoring and result ranking
├── session.ts            # Session registry with loaded-tool tracking + TTL
└── roles.ts              # Role resolution and permission filtering
test/
├── index-builder.test.ts
├── search.test.ts
├── session.test.ts
└── roles.test.ts
```

**Rationale:** Flat structure per ARCHITECTURE.md. Each file = one responsibility. No sub-directories needed at this scale. Test files mirror source files 1:1.

### Pattern 1: Pure Function Modules (search.ts, roles.ts, index-builder.ts)
**What:** Stateless pure functions that take input and return output with no side effects. No classes, no state.
**When to use:** Search scoring, role filtering, index building -- all stateless transformations.
**Example:**
```typescript
// search.ts - pure function, no class
export function scoreAndRank(
  query: string,
  index: ToolIndexEntry[],
  limit: number
): ToolIndexEntry[] {
  // tokenize, score, filter, sort, slice
}
```

### Pattern 2: Stateful Registry Class (session.ts)
**What:** A class with internal Map storage, timer management, and lifecycle methods.
**When to use:** SessionRegistry -- needs mutable state (sessions Map), timer lifecycle (setInterval + destroy), and encapsulation.
**Example:**
```typescript
// session.ts - class with lifecycle
export class SessionRegistry {
  private sessions = new Map<string, Session>();
  private timer: ReturnType<typeof setInterval>;

  constructor(config?: SessionConfig) {
    this.ttl = config?.ttl ?? 7200000;
    this.timer = setInterval(() => this.cleanup(), 900000);
    this.timer.unref(); // CRITICAL: don't block process exit
  }

  destroy(): void {
    clearInterval(this.timer);
    this.sessions.clear();
  }
}
```

### Pattern 3: Named Constants for Score Weights
**What:** Internal named constants (not exported) for search scoring weights.
**When to use:** In search.ts. Makes tuning straightforward before v1.1.
**Example:**
```typescript
// search.ts - internal constants, not exported
const EXACT_NAME = 10;
const PARTIAL_NAME = 5;
const DESCRIPTION = 3;
const KEYWORD = 2;
const SCHEMA_PROPERTY = 1;
```

### Pattern 4: Type Extension from MCP SDK
**What:** MCPack defines its own types that extend MCP SDK types where needed.
**When to use:** `MCPackToolDefinition` extends `Tool` (from SDK) adding a `handler` property. Other types are standalone.
**Example:**
```typescript
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export interface MCPackToolDefinition extends Tool {
  handler: (args: Record<string, unknown>) => Promise<ToolCallResult>;
}
```

### Anti-Patterns to Avoid
- **Exporting internal types:** `ToolIndexEntry`, `Session`, score constants must NOT appear in package exports. Keep them internal.
- **Tier field on ToolIndexEntry:** CONTEXT.md explicitly drops this. Role filtering is at query time, not index time.
- **Stemming or fuzzy matching:** CONTEXT.md explicitly says "No stemming in v1." Use `includes()` for substring matching.
- **Fallback to "top N" on zero matches:** CONTEXT.md: "Zero matches returns empty tools array."
- **User-configurable score weights:** CONTEXT.md: "not user-configurable in v1."

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Test framework | Custom test runner | vitest ^4.1.0 | Native ESM + TS, fast, standard |
| Type declarations | Manual .d.ts files | `tsc` with `declaration: true` | Automatic, accurate, maintained by build |
| Timer types | Custom timer abstractions | Node.js `setInterval` + `.unref()` | Built-in, well-understood, one line |
| JSON Schema types | Custom schema interfaces | Import `Tool` type from MCP SDK | SDK already defines the standard shapes |

**Key insight:** Phase 1 modules are pure logic. There are no complex external integrations. The main risk is getting types and interfaces right, not library selection.

## Common Pitfalls

### Pitfall 1: Forgetting .unref() on Session Cleanup Timer
**What goes wrong:** `setInterval` without `.unref()` keeps the Node.js event loop alive. Tests hang. Consumer processes won't exit.
**Why it happens:** Library authors test with explicit teardown and never notice the timer blocks natural exit.
**How to avoid:** Always call `.unref()` on the interval. Always call `destroy()` in test teardown (`afterEach`/`afterAll`).
**Warning signs:** Tests hang after completion. Process doesn't exit after server closes.

### Pitfall 2: ESM Import Extensions
**What goes wrong:** TypeScript files import from `'./types'` without `.js` extension. Compiles but fails at runtime with ESM.
**Why it happens:** `module: "NodeNext"` requires explicit `.js` extensions in import paths. TS resolves `.js` to `.ts` during compilation.
**How to avoid:** Always use `.js` extension in imports: `import { ... } from './types.js'`.
**Warning signs:** `ERR_MODULE_NOT_FOUND` at runtime despite successful `tsc` compilation.

### Pitfall 3: Mutating the Input Index in Search
**What goes wrong:** `scoreAndRank()` mutates or sorts the original index array, causing side effects between calls.
**Why it happens:** `Array.sort()` sorts in place. If the developer sorts `index` directly, subsequent calls see a pre-sorted array.
**How to avoid:** Always create a new array for scoring: `const scored = index.map(...)`. Never `index.sort()`.
**Warning signs:** Search results change after repeated calls with different queries.

### Pitfall 4: Role Inheritance Cycles
**What goes wrong:** `{ admin: ['write'], write: ['admin'] }` causes infinite recursion in `getAllowedTools()`.
**Why it happens:** Recursive role resolution without cycle detection.
**How to avoid:** PRD pseudocode already includes a `visited: Set<string>` parameter. Implement it exactly.
**Warning signs:** Stack overflow on role resolution.

### Pitfall 5: Session Lazy Expiry Not Creating Fresh Session
**What goes wrong:** `getOrCreate()` checks TTL, deletes expired session, but then returns `undefined` instead of creating a new one.
**Why it happens:** Code path splits: check existing -> expired -> delete, then falls through without hitting the create path.
**How to avoid:** After deleting an expired session, fall through to the "create new" path. Test explicitly: create session, advance time past TTL, call `getOrCreate()`, verify new session returned.
**Warning signs:** `getOrCreate()` returns undefined or throws after session expires.

### Pitfall 6: Query Tokenization Not Matching Index Tokenization
**What goes wrong:** Index builder tokenizes tool names with camelCase splitting, but search query tokenizer doesn't apply the same splitting. Query "listCustomers" doesn't match index token "list" + "customers".
**Why it happens:** Two separate tokenization paths diverge.
**How to avoid:** Extract a shared `tokenize()` function used by both index-builder and search. Or ensure the search uses `includes()` substring matching (CONTEXT.md decision) which sidesteps this for most cases.
**Warning signs:** Exact tool name queries return zero results.

## Code Examples

Verified patterns based on CONTEXT.md decisions and PRD pseudocode:

### Index Builder with Schema Property Keywords
```typescript
// Source: CONTEXT.md decisions
function extractKeywords(name: string, description: string, inputSchema?: JSONSchema): string[] {
  // Split name on underscores, hyphens, camelCase
  const nameTokens = name
    .replace(/([A-Z])/g, ' $1')
    .toLowerCase()
    .split(/[_\-\s]+/)
    .filter(Boolean);

  // Stop words (Claude's discretion per CONTEXT.md)
  const stopWords = new Set([
    'a', 'an', 'the', 'and', 'or', 'for', 'to', 'of',
    'in', 'on', 'at', 'by', 'with', 'from', 'is', 'are',
    'be', 'this', 'that', 'it', 'as', 'was', 'were', 'will',
    'can', 'has', 'have', 'had', 'do', 'does', 'did', 'not',
    'but', 'if', 'no', 'so', 'up', 'out', 'about', 'into',
    'than', 'then', 'each', 'which', 'their', 'there'
  ]);

  const descTokens = description
    .toLowerCase()
    .split(/\s+/)
    .map(w => w.replace(/[^a-z0-9]/g, ''))
    .filter(w => w.length > 2 && !stopWords.has(w));

  // Schema property names as keyword source (CONTEXT.md decision)
  const schemaTokens: string[] = [];
  if (inputSchema?.properties) {
    for (const propName of Object.keys(inputSchema.properties)) {
      schemaTokens.push(
        ...propName
          .replace(/([A-Z])/g, ' $1')
          .toLowerCase()
          .split(/[_\-\s]+/)
          .filter(Boolean)
      );
    }
  }

  return [...new Set([...nameTokens, ...descTokens, ...schemaTokens])];
}
```

### Search Scoring with Named Constants
```typescript
// Source: CONTEXT.md locked decisions
const EXACT_NAME = 10;
const PARTIAL_NAME = 5;
const DESCRIPTION = 3;
const KEYWORD = 2;
const SCHEMA_PROPERTY = 1;

export function scoreAndRank(
  query: string,
  index: ToolIndexEntry[],
  limit: number
): ToolIndexEntry[] {
  const queryTokens = query.toLowerCase().split(/\s+/).filter(Boolean);

  const scored = index.map(entry => {
    let score = 0;
    const nameLower = entry.name.toLowerCase();

    for (const token of queryTokens) {
      if (nameLower === token) score += EXACT_NAME;
      else if (nameLower.includes(token)) score += PARTIAL_NAME;
      if (entry.description.toLowerCase().includes(token)) score += DESCRIPTION;
      if (entry.keywords.some(k => k.includes(token))) score += KEYWORD;
      // Schema property tokens are already in keywords from index builder
      // but tracked separately in the index if needed for SCHEMA_PROPERTY weight
    }

    return { entry, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.entry);
}
```

### Session Registry with Dual Cleanup and Query Log
```typescript
// Source: CONTEXT.md locked decisions
export class SessionRegistry {
  private sessions = new Map<string, Session>();
  private timer: ReturnType<typeof setInterval>;
  private ttl: number;

  constructor(config?: SessionConfig) {
    this.ttl = config?.ttl ?? 7200000; // 2 hours default
    this.timer = setInterval(() => this.cleanup(), 900000); // 15 min
    this.timer.unref(); // CRITICAL: don't block process exit (SESS-03)
  }

  getOrCreate(id: string, role: string): Session {
    const existing = this.sessions.get(id);
    if (existing) {
      // Lazy expiry check (CONTEXT.md dual cleanup)
      if (Date.now() - existing.lastActiveAt > this.ttl) {
        this.sessions.delete(id);
        // Fall through to create fresh
      } else {
        existing.lastActiveAt = Date.now(); // Sliding TTL
        return existing;
      }
    }
    const session: Session = {
      id,
      role,
      loadedTools: new Set(),
      queryLog: [],
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    this.sessions.set(id, session);
    return session;
  }

  destroy(): void {
    clearInterval(this.timer);
    this.sessions.clear();
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastActiveAt > this.ttl) {
        this.sessions.delete(id);
      }
    }
  }
}
```

### Role Filter -- No Roles = All Visible, Unknown Role = Nothing
```typescript
// Source: CONTEXT.md locked decisions
export function resolveRoleAccess(
  role: string | undefined,
  roles: RoleConfig | undefined,
  index: ToolIndexEntry[]
): ToolIndexEntry[] {
  // No roles config -> all tools visible
  if (!roles || Object.keys(roles).length === 0) return index;

  // No role on session -> use defaultRole or empty
  if (!role) return [];

  const allowed = getAllowedTools(role, roles, new Set());
  if (allowed === '*') return index;
  return index.filter(entry => allowed.has(entry.name));
}

function getAllowedTools(
  role: string,
  roles: RoleConfig,
  visited: Set<string>
): Set<string> | '*' {
  if (visited.has(role)) return new Set(); // Cycle protection
  visited.add(role);

  const definition = roles[role];
  if (!definition) return new Set(); // Unknown role -> no tools (secure default)
  if (definition === '*') return '*'; // Wildcard

  const result = new Set<string>();
  for (const item of definition) {
    if (roles[item] !== undefined) {
      const inherited = getAllowedTools(item, roles, visited);
      if (inherited === '*') return '*';
      for (const t of inherited) result.add(t);
    } else {
      result.add(item);
    }
  }
  return result;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `zod ^3.25` only as MCP SDK peer | `zod ^3.25 \|\| ^4.0` | MCP SDK 1.27.1 | MCPack peer dep must use `"^3.25.0 \|\| ^4.0.0"` to match SDK |
| No `@cfworker/json-schema` peer | `@cfworker/json-schema ^4.1.1` required | MCP SDK 1.27.1 | MCPack must declare this as a peer dep to match SDK |
| SDK exports from `@modelcontextprotocol/sdk/types.js` | SDK exports from `@modelcontextprotocol/sdk/server` and subpaths | 1.27.x | Use `import { Server } from '@modelcontextprotocol/sdk/server'` not deep paths |

**Note on STACK.md vs current npm registry:**
- STACK.md says "zod ^3.25.0" as peer dep. The current MCP SDK 1.27.1 actually declares `zod: "^3.25 || ^4.0"`. MCPack should mirror this.
- STACK.md does not mention `@cfworker/json-schema`. It IS required as a peer dep of MCP SDK 1.27.1.

## Open Questions

1. **Schema property keyword weight separation**
   - What we know: CONTEXT.md says schema properties are weighted at 1 (`SCHEMA_PROPERTY = 1`). Keywords from name/description are weighted at 2 (`KEYWORD = 2`).
   - What's unclear: Should schema property tokens be stored separately in `ToolIndexEntry` (a `schemaKeywords: string[]` field) so they can be scored at a different weight than `keywords`? Or should they be mixed into the `keywords` array with the score applied at search time via a different matching path?
   - Recommendation: Add a `schemaKeywords: string[]` field to `ToolIndexEntry` (internal, not exported). This keeps the scoring logic clean -- `keywords` array scored at KEYWORD weight, `schemaKeywords` scored at SCHEMA_PROPERTY weight.

2. **`defaultRole` placement on config**
   - What we know: CONTEXT.md says `defaultRole` field on `MCPackConfig`.
   - What's unclear: PRD's `MCPackConfig` does not include this field. It needs to be added to the types.
   - Recommendation: Add `defaultRole?: string` to `MCPackConfig`. SessionRegistry uses it when no role is provided for a session.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.0 |
| Config file | `vitest.config.ts` (Wave 0 -- must be created) |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run --coverage` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SRCH-01 | Scoring ranks: exact name > partial name > description > keyword | unit | `npx vitest run test/search.test.ts -t "ranking"` | Wave 0 |
| SRCH-02 | Limit defaults to 5, capped at 10, per-query override works | unit | `npx vitest run test/search.test.ts -t "limit"` | Wave 0 |
| SESS-01 | Session tracks loadedTools set correctly | unit | `npx vitest run test/session.test.ts -t "loadedTools"` | Wave 0 |
| SESS-02 | Sessions expire after TTL, lazy + interval cleanup both work | unit | `npx vitest run test/session.test.ts -t "expiry"` | Wave 0 |
| SESS-03 | Timer uses .unref() (process exits naturally) | unit | `npx vitest run test/session.test.ts -t "unref"` | Wave 0 |
| SESS-04 | destroy() stops timer and clears all sessions | unit | `npx vitest run test/session.test.ts -t "destroy"` | Wave 0 |
| ROLE-01 | Roles defined as config map with tool name arrays | unit | `npx vitest run test/roles.test.ts -t "config"` | Wave 0 |
| ROLE-02 | Wildcard '*' grants access to all tools | unit | `npx vitest run test/roles.test.ts -t "wildcard"` | Wave 0 |
| ROLE-03 | Results and total_available reflect only role-visible tools | unit | `npx vitest run test/roles.test.ts -t "filtering"` | Wave 0 |
| PKG-01 | Project compiles with tsc, produces .js + .d.ts | smoke | `npx tsc --noEmit` | Wave 0 |
| PKG-02 | Zero runtime dependencies (peer deps only) | manual | Inspect package.json `dependencies` field is empty/absent | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run --coverage`
- **Phase gate:** Full suite green + `tsc --noEmit` passes before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `vitest.config.ts` -- test framework configuration
- [ ] `test/search.test.ts` -- covers SRCH-01, SRCH-02
- [ ] `test/session.test.ts` -- covers SESS-01, SESS-02, SESS-03, SESS-04
- [ ] `test/roles.test.ts` -- covers ROLE-01, ROLE-02, ROLE-03
- [ ] `test/index-builder.test.ts` -- covers index building + keyword extraction
- [ ] `package.json` -- project scaffolding
- [ ] `tsconfig.json` -- TypeScript configuration

## Sources

### Primary (HIGH confidence)
- npm registry -- verified versions: typescript@5.8.3, vitest@4.1.0, @modelcontextprotocol/sdk@1.27.1, zod@3.25.76/4.3.6, @cfworker/json-schema@4.1.1
- MCP SDK 1.27.1 peer deps -- verified: `zod: "^3.25 || ^4.0"`, `@cfworker/json-schema: "^4.1.1"`
- `.planning/research/STACK.md` -- project stack decisions, tsconfig, package.json structure
- `.planning/research/ARCHITECTURE.md` -- component boundaries, build order, data flow
- `.planning/research/PITFALLS.md` -- timer leaks, handler capture, session ID extraction

### Secondary (MEDIUM confidence)
- PRD pseudocode (mcpack-prd-v1.md) -- base algorithm implementations, type definitions
- CONTEXT.md user decisions -- locked scoring weights, session behavior, role defaults

### Tertiary (LOW confidence)
- None. All findings verified against primary sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- versions verified against npm registry on 2026-03-20
- Architecture: HIGH -- greenfield with clear CONTEXT.md decisions, no ambiguity
- Pitfalls: HIGH -- well-documented in prior research (PITFALLS.md), phase-specific risks are minimal (pure logic modules)

**Research date:** 2026-03-20
**Valid until:** 2026-04-20 (stable domain, 30-day validity)
