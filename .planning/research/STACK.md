# Stack Research

**Domain:** MCP server wrapper/middleware npm package (TypeScript)
**Researched:** 2026-03-19
**Confidence:** HIGH

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| TypeScript | 5.8.x (latest 5.8.3) | Language, type safety, exported .d.ts | Stable GA release with conditional return type inference improvements. 5.9 and 6.0 RC exist but 5.8 is the proven stable line. Project constraint mandates TypeScript. |
| Node.js | >=18.0.0 (target 22 LTS) | Runtime | Node 22 LTS (Jod) is the current active LTS through April 2027. MCP SDK requires Node 18+ for `globalThis.crypto`. Develop against 22, set engine floor at 18 for maximum compatibility with MCP server hosts. |
| `@modelcontextprotocol/sdk` | ^1.27.1 (peer dep) | MCP protocol primitives: `Server`, `Client`, request schemas, transport types | The sole runtime dependency per project constraints. v1.27.1 is latest stable. v2 is pre-alpha with Q1 2026 stable target -- do NOT target v2 yet; v1.x will receive security fixes for 6+ months after v2 ships. Use `Server` class directly (not `McpServer`) because MCPack needs raw `setRequestHandler()` access for handler interception. |
| `zod` | ^3.25.0 | Schema validation (transitive via MCP SDK) | MCP SDK v1.27.x has zod as a peer dependency. SDK imports from `zod/v4` internally but maintains backwards compat with zod >=3.25. MCPack does not use zod directly but must declare it as a peer dep to match MCP SDK's requirement. |

### Build Tools

| Tool | Version | Purpose | Why Recommended |
|------|---------|---------|-----------------|
| `tsc` (via TypeScript) | 5.8.x | Compilation and .d.ts generation | MCPack is a pure library with no bundling needs -- no React, no browser target, no tree-shaking requirement. `tsc` produces clean ESM output with declaration files. tsup adds unnecessary complexity for a zero-dep library that only targets Node.js ESM. Using `tsc` directly keeps the build chain minimal and matches the project's "no unnecessary deps" philosophy. |
| `vitest` | ^4.1.0 | Unit and integration testing | Latest stable (4.1.0, released 2026-03-13). Native ESM support, TypeScript support out of the box, fast execution via Vite. The PRD already mandates vitest. v4.0 added stable Browser Mode and visual regression but MCPack only needs the core test runner. |
| ESLint | ^9.x | Linting | ESLint 9 with flat config (`eslint.config.ts`) is the standard. Use `typescript-eslint` for TypeScript rules. Flat config is now the default and only supported format going forward. |
| `typescript-eslint` | ^8.x | TypeScript-specific lint rules | Companion to ESLint 9 flat config. Provides type-aware linting rules. |

### Supporting Libraries (Dev Only)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@modelcontextprotocol/sdk` | ^1.27.1 | Dev dependency for testing (Client class, transports) | Used in integration tests to create test clients that connect to MCPack-wrapped servers. Listed as both peerDep (for consumers) and devDep (for testing). |
| `@vitest/coverage-v8` | ^4.1.0 | Code coverage | Run with `vitest --coverage`. Use v8 provider, not istanbul -- faster and no extra native deps. |
| `prettier` | ^3.x | Code formatting | Optional but recommended. Keeps code consistent. Run via `npm run format`. |

## Installation

```bash
# Dev dependencies (everything is dev -- MCPack has zero runtime deps)
npm install -D typescript@~5.8.3 vitest@^4.1.0 @vitest/coverage-v8@^4.1.0
npm install -D eslint@^9.0.0 typescript-eslint@^8.0.0
npm install -D @modelcontextprotocol/sdk@^1.27.1 zod@^3.25.0

# No runtime dependencies. MCP SDK and zod are peer dependencies only.
```

## Package Configuration

### package.json (key fields)

```json
{
  "name": "mcpack",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "engines": {
    "node": ">=18.0.0"
  },
  "peerDependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.25.0"
  },
  "peerDependenciesMeta": {
    "zod": {
      "optional": false
    }
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest",
    "test:coverage": "vitest --coverage",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit"
  }
}
```

### tsconfig.json (key settings)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": false,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "test"]
}
```

**Key decisions:**
- `module: "NodeNext"` + `moduleResolution: "NodeNext"` -- required for proper ESM with `.js` extensions in imports. This is the standard for Node.js ESM packages in 2025/2026.
- `target: "ES2022"` -- supports top-level await, private class fields, `Array.at()`. Node 18+ supports ES2022 fully.
- `verbatimModuleSyntax: true` -- enforces explicit `type` imports, preventing accidental runtime imports of type-only modules.
- `declaration: true` + `declarationMap: true` -- generates `.d.ts` files and source maps for go-to-definition in consumers' IDEs.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `tsc` for build | `tsup` (esbuild-based bundler) | If you need CJS+ESM dual output, tree-shaking, or browser targets. MCPack is ESM-only for Node.js, so tsc is simpler and sufficient. tsup adds a dep and a config file for no benefit here. |
| `tsc` for build | `tsdown` (Rolldown-based successor to tsup) | Emerging tool, not yet mature enough for production libraries. Revisit if tsc becomes a bottleneck (unlikely for a small library). |
| `vitest` for testing | `jest` | Never for this project. Jest has poor native ESM support, requires transformers for TypeScript, and is slower. Vitest is the standard for ESM TypeScript projects. |
| `Server` class (low-level) | `McpServer` class (high-level) | `McpServer` auto-handles tool listing, routing, and validation. MCPack CANNOT use `McpServer` because it needs to intercept `tools/list` and `tools/call` handlers directly via `setRequestHandler()`. The high-level class hides the handler registration MCPack needs to override. |
| ESLint 9 flat config | Biome | Biome is faster but has less TypeScript rule coverage than typescript-eslint. ESLint 9 + typescript-eslint is the established standard with the broadest rule set. |
| Peer dep for MCP SDK | Bundling MCP SDK | Never bundle the MCP SDK. Consumers already have it installed (they're building MCP servers). Bundling would cause version conflicts and duplicate code. Peer dep is the only correct approach. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `McpServer` (high-level class) | Abstracts away `setRequestHandler()` which MCPack must intercept. Cannot replace tools/list or tools/call handlers on a McpServer instance. | `Server` class from `@modelcontextprotocol/sdk/server/index.js` |
| MCP SDK v2 (pre-alpha) | Pre-alpha, not stable, breaking changes ongoing, Q1 2026 stable target not yet met. Building on v2 now means constant churn. | MCP SDK v1.27.x. Plan a v2 migration after v2 goes stable and has 1-2 patch releases. |
| CommonJS (`"type": "commonjs"`) | MCP SDK is ESM. The Node.js ecosystem is ESM-first in 2026. CJS adds dual-package hazard complexity with zero benefit for MCP server packages. | ESM only (`"type": "module"`) |
| Jest | Poor ESM support, slow, requires ts-jest or swc transformers, heavy configuration. | Vitest |
| `.eslintrc` (legacy config) | Deprecated in ESLint 9. Will be removed entirely in ESLint 10. | `eslint.config.ts` (flat config) |
| Zod v4 as direct dependency | MCP SDK already depends on zod. Adding it as a direct dep creates version coupling. MCPack doesn't need zod for its own logic (keyword search, session management). | Declare zod as peer dep only. If schema validation is needed internally, use MCP SDK's re-exported types. |
| `ts-node` for running tests/scripts | Slow startup, compatibility issues with ESM. | `vitest` for tests. For scripts, use `tsx` or Node.js native TypeScript stripping (Node 22.6+ with `--experimental-strip-types`). |

## Stack Patterns by Variant

**For wrap mode (`mcpack(server, config)`):**
- Import `Server` type from `@modelcontextprotocol/sdk/server/index.js`
- Import `ListToolsRequestSchema`, `CallToolRequestSchema` from `@modelcontextprotocol/sdk/types.js`
- Use `server.setRequestHandler()` to replace existing handlers
- Critical: must capture original handlers before overwriting (SDK may or may not expose these -- needs investigation during implementation)

**For build mode (`createMCPackServer(config)`):**
- Instantiate `new Server(serverInfo, { capabilities: { tools: {} } })`
- Register handlers directly -- no capture needed since this is a fresh server
- Handler map routes `tools/call` to user-provided handler functions

**For integration testing (Stripe MCP harness):**
- Import `Client` from `@modelcontextprotocol/sdk/client/index.js`
- Use `StdioClientTransport` or `InMemoryTransport` depending on test type
- `InMemoryTransport` for unit/fast integration tests (no subprocess overhead)
- `StdioClientTransport` for real Stripe MCP harness (spawns actual server process)

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@modelcontextprotocol/sdk@^1.27.1` | `zod@^3.25.0` | SDK v1.27 uses zod/v4 subpath internally but accepts zod >=3.25. Both must be declared as peer deps. |
| `@modelcontextprotocol/sdk@^1.27.1` | Node.js >=18 | Requires `globalThis.crypto` (available natively in Node 18+). |
| TypeScript 5.8 | `@modelcontextprotocol/sdk@^1.27.1` | SDK ships .d.ts files, fully compatible with TS 5.8. |
| Vitest 4.1 | TypeScript 5.8 | Native TypeScript support, no additional transformer needed. |
| ESLint 9 | `typescript-eslint@^8.x` | Flat config format required. Use `defineConfig()` from typescript-eslint. |

## Critical Implementation Note: Handler Capture in Wrap Mode

The biggest technical uncertainty in the stack is **how to capture existing handlers** from a `Server` instance before replacing them. The MCP SDK's `Server` class uses `setRequestHandler()` to register handlers, but there is no documented `getRequestHandler()` method.

**Options to investigate during implementation (in order of preference):**

1. **Check if Server exposes handlers via a public/protected property** -- look at the SDK source for a `_requestHandlers` map or similar.
2. **Call the original tools/list before wrapping** -- invoke the server's handler manually to capture tool definitions, then replace handlers.
3. **Monkey-patch `setRequestHandler`** -- intercept calls to `setRequestHandler` before tools are registered to capture handlers as they are set.
4. **Use `InMemoryTransport` to query the server** -- connect a client via in-memory transport, call `tools/list`, capture results, then rewire.

This is flagged as the primary technical risk in the stack. It must be resolved in the first implementation phase.

## MCP SDK v2 Migration Path

When MCP SDK v2 goes stable (expected Q1 2026, possibly slipping):

1. v2 may change the `Server` class API or handler registration pattern
2. MCPack should pin to `@modelcontextprotocol/sdk: "^1.0.0"` as peer dep for v1
3. Plan a separate MCPack v2 release that bumps the peer dep to `"^2.0.0"`
4. Do NOT try to support both v1 and v2 simultaneously -- the handler interception pattern is too tightly coupled to SDK internals

## Sources

- [MCP TypeScript SDK - npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk) -- v1.27.1 latest, peer deps, publication date
- [MCP TypeScript SDK - GitHub releases](https://github.com/modelcontextprotocol/typescript-sdk/releases) -- v1.27.1 changelog, v2 pre-alpha status
- [MCP TypeScript SDK - Official docs](https://ts.sdk.modelcontextprotocol.io/) -- Server vs McpServer, setRequestHandler API
- [MCP SDK v2 docs](https://ts.sdk.modelcontextprotocol.io/v2/) -- v2 pre-alpha reference (LOW confidence, subject to change)
- [Vitest 4.0 announcement](https://vitest.dev/blog/vitest-4) -- v4.0/4.1 features and release date
- [TypeScript 5.8 release](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-8.html) -- feature set and stability
- [typescript-eslint getting started](https://typescript-eslint.io/getting-started/) -- ESLint 9 flat config setup
- [Node.js releases](https://nodejs.org/en/about/previous-releases) -- Node 22 LTS timeline
- [MCP SDK zod compatibility issue #802](https://github.com/modelcontextprotocol/typescript-sdk/issues/802) -- zod peer dep requirements

---
*Stack research for: MCP server wrapper/middleware npm package*
*Researched: 2026-03-19*
