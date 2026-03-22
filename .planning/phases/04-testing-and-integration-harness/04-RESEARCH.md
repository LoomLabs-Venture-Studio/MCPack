# Phase 4: Testing and Integration Harness - Research

**Researched:** 2026-03-22
**Domain:** Vitest unit testing, MCP Client SDK, Stripe MCP integration harness
**Confidence:** HIGH

## Summary

Phase 4 has two distinct workstreams: (1) auditing and filling unit test gaps to reach 75% coverage, and (2) building a Stripe MCP integration harness that proves real-world token reduction.

The unit test workstream is straightforward. The project already has 7 test files with 1,567 lines and 91 passing tests at 98.25% statement coverage. The 75% target is already exceeded. The work is to audit for edge case gaps and ensure all modules listed in TEST-01 are covered (they are -- the mapping is 1:1 with `build.test.ts` serving as the "server-builder" test per D-03).

The harness workstream requires spawning the Stripe MCP server (`npx @stripe/mcp --api-key=$STRIPE_API_KEY`) as a child process, connecting via `StdioClientTransport` from `@modelcontextprotocol/sdk`, calling `tools/list` to get vanilla tool schemas, then wrapping those same tools through MCPack's engine and comparing payload sizes. The official Stripe MCP server exposes approximately 18 tools covering payments, customers, subscriptions, invoices, and refunds.

**Primary recommendation:** Focus harness implementation on the MCP Client SDK's `StdioClientTransport` to spawn and connect to Stripe MCP, then use MCPack's `MCPackEngine` directly (not wrap/build mode) to produce the comparison data. Unit test work is primarily gap-filling since coverage already exceeds 75%.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Target 75% code coverage across all modules.
- **D-02:** Audit existing tests (7 files, ~1,567 lines) for gaps. Fill gaps -- don't rewrite from scratch.
- **D-03:** "server-builder" in TEST-01 maps to `build.ts` / `build.test.ts`. No separate server-builder module exists.
- **D-04:** Introduce test utilities (factories, fixtures) where they reduce duplication. Fall back to plain vitest direct calls otherwise.
- **D-05:** Run coverage with `vitest run --coverage` (v8 provider already in devDependencies).
- **D-06:** Stripe API key provided via `STRIPE_API_KEY` environment variable. No dotenv dependency.
- **D-07:** Harness runs separately from unit tests via `npm run harness`. Not part of `npm test`.
- **D-08:** Harness measures both character count (JSON.stringify length of schema payloads) and tool count for vanilla vs MCPack.
- **D-09:** Multiple queries to demonstrate reduction across different use cases (not a single query).
- **D-10:** Harness skips gracefully with a clear message if `STRIPE_API_KEY` is not set.
- **D-11:** Report output: JSON file at `test/harness/report.json` + console summary printed when harness runs.
- **D-12:** Report includes both per-query breakdown AND aggregate summary.
- **D-13:** Per-query: query string, vanilla tool count, MCPack tool count, vanilla chars, MCPack chars, char reduction %, estimated token reduction.
- **D-14:** Aggregate: total vanilla chars, total MCPack chars, overall % reduction, total estimated tokens saved.
- **D-15:** "Tokens" estimated as `chars / 4` alongside raw character counts. Both shown in report.
- **D-16:** Report includes a note: "Numbers represent character counts of serialized JSON payloads, not actual LLM tokens. Estimated tokens use chars/4 approximation."
- **D-17:** Harness code lives in `test/harness/` directory alongside the report output.

### Claude's Discretion
- Which specific queries to use in the harness (should cover diverse Stripe tool categories)
- Exact test utility patterns (factories vs builders vs fixtures)
- Which edge cases to prioritize when filling coverage gaps
- Console report formatting (table vs structured text)

### Deferred Ideas (OUT OF SCOPE)
- Benchmark suite for search performance (latency, not just correctness) -- future phase or backlog
- CI integration for harness (run on PR with Stripe key in secrets) -- post-v1
- Coverage badge in README -- Phase 5 scope

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TEST-01 | Unit tests exist for each module: index-builder, search, session, roles, server-builder | All 7 test files exist and pass. Coverage at 98.25%. Gap audit needed per D-02, build.test.ts covers "server-builder" per D-03. |
| TEST-02 | Integration test harness runs against real Stripe MCP and produces token reduction comparison report | Harness uses `@modelcontextprotocol/sdk` Client + StdioClientTransport to spawn `npx @stripe/mcp`. Report format defined in D-11 through D-16. |
| TEST-03 | All tests pass with vitest in a single `npm test` command | 91 tests already pass. Harness runs separately via `npm run harness` (D-07), not part of `npm test`. |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | ^4.1.0 | Test runner | Already configured in project, ESM-native |
| @vitest/coverage-v8 | ^4.1.0 | Coverage provider | Already in devDependencies, uses V8's built-in coverage |
| @modelcontextprotocol/sdk | ^1.27.1 | MCP Client for harness | Already a peer dep; provides Client + StdioClientTransport |
| @stripe/mcp | 0.3.1 | Stripe MCP server binary | Official Stripe MCP server, run via `npx` (not installed as dep) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:child_process | built-in | Process spawning | StdioClientTransport handles this internally |
| node:fs/promises | built-in | Write report.json | Harness report output |
| node:path | built-in | Path resolution | Report file path construction |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| StdioClientTransport | Manual child_process spawn | SDK transport handles protocol framing, reconnection; no reason to hand-roll |
| vitest | jest | Project already uses vitest; switching would be gratuitous |

**Installation:**
```bash
# No new dependencies needed. Everything is already in devDependencies.
# @stripe/mcp is run via npx, not installed as a dependency.
```

## Architecture Patterns

### Recommended Project Structure
```
test/
  index-builder.test.ts   # existing - audit for gaps
  search.test.ts          # existing - audit for gaps
  session.test.ts         # existing - audit for gaps
  roles.test.ts           # existing - audit for gaps
  core.test.ts            # existing - audit for gaps
  wrap.test.ts            # existing - audit for gaps
  build.test.ts           # existing - audit for gaps (= "server-builder")
  harness/
    stripe-harness.ts     # Integration harness script
    report.json           # Output (gitignored)
```

### Pattern 1: Harness Architecture (Client-Side Comparison)
**What:** The harness acts as an MCP client connecting to the Stripe MCP server. It retrieves the full tool list (vanilla), then runs the same tools through MCPack's search engine to measure reduction.
**When to use:** This is the only pattern needed. The harness does NOT need to wrap the Stripe server with MCPack in a running server -- it just needs the tool definitions to feed into MCPack's engine for comparison.

**Example:**
```typescript
// Source: @modelcontextprotocol/sdk client docs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// 1. Connect to Stripe MCP server
const transport = new StdioClientTransport({
  command: 'npx',
  args: ['-y', '@stripe/mcp', '--api-key', process.env.STRIPE_API_KEY!],
});
const client = new Client({ name: 'mcpack-harness', version: '0.1.0' });
await client.connect(transport);

// 2. Get all tools (vanilla)
const { tools } = await client.listTools();
const vanillaChars = JSON.stringify(tools).length;

// 3. Build MCPack index and search
import { buildIndex } from '../../src/index-builder.js';
import { scoreAndRank } from '../../src/search.js';

const index = buildIndex(tools);
const results = scoreAndRank('payment', index, 5);
const mcpackChars = JSON.stringify(results.map(r => r.schema)).length;

// 4. Compare
console.log(`Vanilla: ${vanillaChars} chars, MCPack: ${mcpackChars} chars`);
console.log(`Reduction: ${((1 - mcpackChars / vanillaChars) * 100).toFixed(1)}%`);

// 5. Cleanup
await client.close();
```

### Pattern 2: Harness Query Set
**What:** Multiple diverse queries covering different Stripe API domains to demonstrate broad reduction.
**Recommended queries:**
```typescript
const queries = [
  'create a payment',           // Payments domain
  'manage customers',           // Customer domain
  'subscription billing',       // Subscriptions domain
  'issue refund',               // Refunds domain
  'list invoices',              // Invoicing domain
];
```
These span 5 different Stripe API domains. With ~18 total Stripe tools and a default limit of 5, each query should return a subset, demonstrating significant character reduction.

### Pattern 3: Test Factory Pattern (for gap-filling)
**What:** Reusable factory functions that create test fixtures with sensible defaults.
**When to use:** When multiple tests need similar objects with slight variations.
**Example:**
```typescript
// Already established in existing tests:
function makeTool(name: string, description: string, properties?: Record<string, object>): Tool {
  return {
    name,
    description,
    inputSchema: {
      type: 'object' as const,
      properties: properties ?? { id: { type: 'string' } },
    },
  };
}
```

### Anti-Patterns to Avoid
- **Running harness in `npm test`:** Harness requires STRIPE_API_KEY and network access. It MUST be a separate script (D-07). Mixing it into `npm test` would break CI and local dev.
- **Installing @stripe/mcp as a dependency:** Use `npx -y @stripe/mcp` to avoid adding it to package.json. It's a dev tool, not a project dependency.
- **Mocking in the harness:** The entire point of TEST-02 is to run against the REAL Stripe MCP server. No mocking.
- **Rewriting existing tests:** D-02 explicitly says audit and fill gaps, don't rewrite from scratch.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP client protocol | Custom stdio parser | `Client` + `StdioClientTransport` from SDK | Protocol framing, JSON-RPC, capability negotiation handled |
| Process lifecycle | Manual child_process spawn/kill | `StdioClientTransport` handles spawning | Transport manages process lifecycle, cleanup on close |
| Coverage reporting | Custom coverage tracker | `vitest run --coverage` with v8 | Already configured, produces standard Istanbul reports |
| Token estimation | Complex tokenizer | `chars / 4` approximation | D-15 specifies this simple formula; actual tokenization is out of scope |

**Key insight:** The harness is NOT a full MCP proxy. It's a comparison script that (a) gets tool definitions from Stripe MCP via the SDK client, (b) feeds them through MCPack's index/search, and (c) compares payload sizes. Keep it simple.

## Common Pitfalls

### Pitfall 1: StdioClientTransport Process Cleanup
**What goes wrong:** The npx process spawned by StdioClientTransport may not be killed cleanly, leaving zombie processes.
**Why it happens:** If the harness crashes before calling `client.close()`, the child process stays running.
**How to avoid:** Use try/finally to ensure `client.close()` is called. Also consider `process.on('exit', ...)` as a safety net.
**Warning signs:** Multiple `node` processes left running after harness exits.

### Pitfall 2: npx Download Delays
**What goes wrong:** First run of `npx -y @stripe/mcp` downloads the package, which can take 10+ seconds and may look like a hang.
**Why it happens:** npx downloads on first use when package is not cached.
**How to avoid:** Use `-y` flag (already planned). Document that first run may be slow. Consider a timeout on the client connection.
**Warning signs:** Harness appears to hang on first run.

### Pitfall 3: Stripe API Key Validation
**What goes wrong:** Harness fails with a cryptic error if the API key is invalid or has insufficient permissions.
**Why it happens:** Stripe MCP server may start but fail on first API call with authentication errors.
**How to avoid:** D-10 requires graceful skip if key is not set. Also catch connection errors and report clearly.
**Warning signs:** MCP connection succeeds but `listTools()` returns error or empty results.

### Pitfall 4: Coverage Configuration Missing Include Pattern
**What goes wrong:** Coverage reports include test files or exclude source files.
**Why it happens:** Default v8 coverage may need explicit `include` patterns in vitest config.
**How to avoid:** Add coverage config to `vitest.config.ts` if needed: `coverage: { include: ['src/**'] }`.
**Warning signs:** Coverage report shows test files or missing source files.

### Pitfall 5: Harness File Not in npm test Glob
**What goes wrong:** Vitest picks up `test/harness/stripe-harness.ts` as a test file.
**Why it happens:** Default glob `test/**/*.test.ts` won't match, but if the harness file is named `*.test.ts` it would.
**How to avoid:** Name the harness file `stripe-harness.ts` (not `*.test.ts`). The vitest config glob `test/**/*.test.ts` will not match it.
**Warning signs:** Harness runs during `npm test` and fails due to missing API key.

## Code Examples

### Harness Entry Point Script
```typescript
// test/harness/stripe-harness.ts
// Run via: npx tsx test/harness/stripe-harness.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { buildIndex } from '../../src/index-builder.js';
import { scoreAndRank } from '../../src/search.js';
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface QueryResult {
  query: string;
  vanilla_tool_count: number;
  mcpack_tool_count: number;
  vanilla_chars: number;
  mcpack_chars: number;
  char_reduction_pct: number;
  estimated_tokens_vanilla: number;
  estimated_tokens_mcpack: number;
  estimated_tokens_saved: number;
}

// Check for API key (D-10)
if (!process.env.STRIPE_API_KEY) {
  console.log('STRIPE_API_KEY not set. Skipping Stripe MCP harness.');
  console.log('Set STRIPE_API_KEY to run: STRIPE_API_KEY=sk_test_xxx npm run harness');
  process.exit(0);
}

// ... connect, query, report
```

### package.json Script Addition
```json
{
  "scripts": {
    "harness": "npx tsx test/harness/stripe-harness.ts"
  }
}
```

### Console Report Formatting
```typescript
// Simple structured text output (Claude's discretion)
function printReport(results: QueryResult[], aggregate: AggregateResult): void {
  console.log('\n=== MCPack Token Reduction Report ===\n');

  for (const r of results) {
    console.log(`Query: "${r.query}"`);
    console.log(`  Tools: ${r.vanilla_tool_count} vanilla -> ${r.mcpack_tool_count} MCPack`);
    console.log(`  Chars: ${r.vanilla_chars} -> ${r.mcpack_chars} (${r.char_reduction_pct.toFixed(1)}% reduction)`);
    console.log(`  Est. tokens: ${r.estimated_tokens_vanilla} -> ${r.estimated_tokens_mcpack} (saved ~${r.estimated_tokens_saved})`);
    console.log();
  }

  console.log('--- Aggregate ---');
  console.log(`Total chars: ${aggregate.total_vanilla_chars} -> ${aggregate.total_mcpack_chars}`);
  console.log(`Overall reduction: ${aggregate.overall_reduction_pct.toFixed(1)}%`);
  console.log(`Total est. tokens saved: ${aggregate.total_estimated_tokens_saved}`);
  console.log();
  console.log('Note: Numbers represent character counts of serialized JSON payloads,');
  console.log('not actual LLM tokens. Estimated tokens use chars/4 approximation.');
}
```

### Coverage Vitest Config Enhancement
```typescript
// vitest.config.ts - add coverage config if not present
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],  // re-export only, no logic
    },
  },
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| jest + ts-jest | vitest (ESM-native) | 2023+ | Already using vitest; no migration needed |
| istanbul coverage | v8 coverage | vitest default | Already using v8 provider |
| Manual MCP protocol | @modelcontextprotocol/sdk Client | 2024+ | SDK handles protocol framing, use Client class |

**Deprecated/outdated:**
- `@modelcontextprotocol/sdk` SSEClientTransport: Being replaced by StreamableHTTPClientTransport for HTTP scenarios. Not relevant here (we use stdio).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.x with @vitest/coverage-v8 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run --coverage` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TEST-01 | Unit tests exist for each module | unit | `npx vitest run --reporter=verbose` | Yes - all 7 files exist |
| TEST-02 | Integration harness produces token reduction report | integration (manual) | `npm run harness` (requires STRIPE_API_KEY) | No - Wave 0 |
| TEST-03 | All tests pass with vitest | unit | `npx vitest run` | Yes - 91 tests passing |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run --coverage`
- **Phase gate:** Full suite green + harness run produces report.json

### Wave 0 Gaps
- [ ] `test/harness/stripe-harness.ts` -- covers TEST-02 (harness script)
- [ ] `test/harness/report.json` -- added to `.gitignore` (generated artifact)
- [ ] `package.json` "harness" script -- entry point for `npm run harness`
- [ ] Coverage config in `vitest.config.ts` -- ensure `include: ['src/**/*.ts']` for clean reporting

## Open Questions

1. **Stripe MCP tool count may vary**
   - What we know: Search results indicate ~18 tools in the official Stripe MCP server
   - What's unclear: Exact count may depend on API key permissions (restricted keys see fewer tools)
   - Recommendation: Harness should log the actual tool count discovered. Use a test key with broad permissions.

2. **tsx vs ts-node for harness execution**
   - What we know: Project uses ESM (`"type": "module"`). tsx handles ESM TypeScript natively without config.
   - What's unclear: Whether tsx is already installed or needs to be added as devDependency.
   - Recommendation: Use `npx tsx` to avoid adding a dependency. If performance matters, consider adding tsx to devDependencies.

## Sources

### Primary (HIGH confidence)
- Project source code analysis: all 9 source files, all 7 test files, package.json, vitest.config.ts
- `npx vitest run --coverage` output: 98.25% statement coverage, 91 tests passing
- `@modelcontextprotocol/sdk` installed package: Client + StdioClientTransport at dist/esm/client/

### Secondary (MEDIUM confidence)
- [npm @stripe/mcp](https://www.npmjs.com/package/@stripe/mcp) - v0.3.1, official CLI for Stripe MCP server
- [MCP TypeScript SDK client docs](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/client.md) - Client usage patterns
- [Stripe MCP docs](https://docs.stripe.com/mcp) - Official Stripe MCP documentation

### Tertiary (LOW confidence)
- Stripe MCP tool count (~18) from web search - may vary by API key permissions

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - everything is already installed and configured
- Architecture: HIGH - patterns verified from existing code and SDK docs
- Pitfalls: HIGH - based on direct analysis of project structure and SDK behavior

**Research date:** 2026-03-22
**Valid until:** 2026-04-22 (stable project, no fast-moving dependencies)
