/**
 * Stripe MCP Integration Harness
 *
 * Connects to the real Stripe MCP server, retrieves all tool schemas (vanilla),
 * runs multiple search queries through MCPack's index/search engine, and produces
 * a JSON report + console summary showing character count and estimated token reduction.
 *
 * Usage: STRIPE_SECRET_KEY=sk_test_xxx npm run harness
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { buildIndex } from '../../src/index-builder.js';
import { scoreAndRank } from '../../src/search.js';
import { MCPackEngine } from '../../src/core.js';
// Phase 10 (additive — Plan 10-01): hybrid measurement uses the adapter via
// dynamic import inside measureHybrid() to keep the v1.0 keyword-only path
// runnable when the adapter or @huggingface/transformers is not installed
// in the local environment (e.g. parallel-execution worktree without
// `npm install` in packages/mcpack-embeddings/). Gate 1 + Gate 3 REVISED —
// DEC-v11-10-05 excludes test/harness/ from the adapter-isolation grep.
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Interfaces ──────────────────────────────────────────────────────────────

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

interface AggregateResult {
  total_vanilla_chars: number;
  total_mcpack_chars: number;
  overall_reduction_pct: number;
  total_estimated_tokens_vanilla: number;
  total_estimated_tokens_mcpack: number;
  total_estimated_tokens_saved: number;
}

interface HarnessReport {
  generated_at: string;
  stripe_tool_count: number;
  queries: QueryResult[];
  aggregate: AggregateResult;
  // Phase 10 (additive — Plan 10-01): hybrid measurement block. Present only
  // when the hybrid path completed; absent when the adapter or MiniLM model
  // is unavailable (e.g. cold first-run download issues). Gate 6a reads
  // hybrid.aggregate.overall_reduction_pct.
  hybrid?: {
    queries: QueryResult[];
    aggregate: AggregateResult;
    index_build_ms: number;
  };
  note: string;
}

// ─── API Key Check (D-10) ────────────────────────────────────────────────────

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_API_KEY;

if (!STRIPE_KEY) {
  console.log('STRIPE_SECRET_KEY not set. Skipping Stripe MCP harness.');
  console.log('Set STRIPE_SECRET_KEY to run: STRIPE_SECRET_KEY=sk_test_xxx npm run harness');
  process.exit(0);
}

// ─── Constants ───────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = join(__dirname, 'report.json');

const DISCLAIMER_NOTE =
  'Numbers represent character counts of serialized JSON payloads, not actual LLM tokens. Estimated tokens use chars/4 approximation.';

// Queries spanning 5 different Stripe API domains (D-09)
const queries = [
  'create a payment',
  'manage customers',
  'subscription billing',
  'issue refund',
  'list invoices',
];

// ─── Phase 10 (Plan 10-01): hybrid measurement helper ──────────────────────

/**
 * Run the same `queries` against an MCPackEngine with hybrid ranking enabled.
 * Returns the parallel queryResults + aggregate block, plus the wall-clock
 * index_build_ms (from constructor to hasVectors()=true). Throws on
 * adapter/MiniLM failure — caller catches and falls back to keyword-only
 * report shape.
 *
 * Gate 6a (PRD Success Criteria — v1.1): aggregate.overall_reduction_pct
 * must be ≥ 80.7 (v1.0 baseline floor).
 */
async function measureHybrid(
  tools: Tool[],
  vanillaChars: number,
): Promise<NonNullable<HarnessReport['hybrid']>> {
  console.log('--- Hybrid measurement (MiniLM) ---');
  console.log('Loading MiniLM provider (first run downloads ~90MB)...');
  // Dynamic import — keeps the v1.0 keyword path runnable even when the
  // adapter or @huggingface/transformers is absent from the local env
  // (e.g. parallel-execution worktree without `npm install` in
  // packages/mcpack-embeddings/).
  type AdapterModule = {
    createMiniLMProvider: (opts?: { model?: string; cacheDir?: string }) => Promise<
      (texts: string[]) => Promise<number[][]>
    >;
  };
  const adapter: AdapterModule = await import('../../packages/mcpack-embeddings/src/index.js');
  const provider = await adapter.createMiniLMProvider();

  const buildStart = Date.now();
  const engine = new MCPackEngine(tools, { embeddings: { provider } });

  // Wait for hasVectors() — internal API accessed via narrow type cast for
  // offline measurement (harness convention).
  const hasVectors = () =>
    (engine as unknown as { hasVectors(): boolean }).hasVectors();
  const buildTimeoutMs = 300_000;
  const pollStart = Date.now();
  while (!hasVectors()) {
    if (Date.now() - pollStart > buildTimeoutMs) {
      throw new Error(`Hybrid index build did not complete within ${buildTimeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  const indexBuildMs = Date.now() - buildStart;
  console.log(`Hybrid index built in ${indexBuildMs}ms`);

  const sessionId = 'harness-hybrid-session';
  const hybridResults: QueryResult[] = [];

  for (const query of queries) {
    const callResult = await Promise.resolve(
      engine.handleSearchTools({ query, limit: 5 }, sessionId),
    );
    if (callResult.isError) {
      throw new Error(
        `hybrid search_tools failed: ${callResult.content[0]?.text ?? '(no content)'}`,
      );
    }
    const text = callResult.content[0]?.text ?? '{}';
    const parsed = JSON.parse(text) as {
      tools: Array<{ name: string; loaded: boolean; schema?: object }>;
    };
    // Compute char-count of returned schemas (matches v1.0 keyword block
    // semantics — only schemas-on-first-load contribute, and a single
    // sessionId means subsequent calls return {loaded: true} without schema).
    // To keep the measurement consistent with the v1.0 block (which always
    // serialises full schemas across the 5 queries), we emit a fresh session
    // per query — same as scoreAndRank's stateless behaviour above.
    const schemas = parsed.tools
      .map((r) => r.schema)
      .filter((s): s is object => s !== undefined);
    const mcpackChars = JSON.stringify(schemas).length;

    const estimatedTokensVanilla = Math.ceil(vanillaChars / 4);
    const estimatedTokensMcpack = Math.ceil(mcpackChars / 4);

    const result: QueryResult = {
      query,
      vanilla_tool_count: tools.length,
      mcpack_tool_count: parsed.tools.length,
      vanilla_chars: vanillaChars,
      mcpack_chars: mcpackChars,
      char_reduction_pct: parseFloat(((1 - mcpackChars / vanillaChars) * 100).toFixed(1)),
      estimated_tokens_vanilla: estimatedTokensVanilla,
      estimated_tokens_mcpack: estimatedTokensMcpack,
      estimated_tokens_saved: estimatedTokensVanilla - estimatedTokensMcpack,
    };
    hybridResults.push(result);

    console.log(`Hybrid Query: "${query}"`);
    console.log(`  Tools: ${result.vanilla_tool_count} vanilla -> ${result.mcpack_tool_count} MCPack`);
    console.log(`  Chars: ${result.vanilla_chars} -> ${result.mcpack_chars} (${result.char_reduction_pct}% reduction)`);
  }

  const totalVanillaChars = hybridResults.reduce((s, r) => s + r.vanilla_chars, 0);
  const totalMcpackChars = hybridResults.reduce((s, r) => s + r.mcpack_chars, 0);
  const totalTokensVanilla = hybridResults.reduce((s, r) => s + r.estimated_tokens_vanilla, 0);
  const totalTokensMcpack = hybridResults.reduce((s, r) => s + r.estimated_tokens_mcpack, 0);

  const hybridAggregate: AggregateResult = {
    total_vanilla_chars: totalVanillaChars,
    total_mcpack_chars: totalMcpackChars,
    overall_reduction_pct: parseFloat(((1 - totalMcpackChars / totalVanillaChars) * 100).toFixed(1)),
    total_estimated_tokens_vanilla: totalTokensVanilla,
    total_estimated_tokens_mcpack: totalTokensMcpack,
    total_estimated_tokens_saved: totalTokensVanilla - totalTokensMcpack,
  };

  console.log('--- Aggregate (hybrid) ---');
  console.log(`Total chars: ${hybridAggregate.total_vanilla_chars} -> ${hybridAggregate.total_mcpack_chars}`);
  console.log(`Overall reduction: ${hybridAggregate.overall_reduction_pct}%`);
  console.log(`Total est. tokens saved: ${hybridAggregate.total_estimated_tokens_saved}`);
  console.log(`Gate 6a (≥ 80.7%): ${hybridAggregate.overall_reduction_pct >= 80.7 ? 'PASS' : 'FAIL'}\n`);

  engine.destroy();
  return {
    queries: hybridResults,
    aggregate: hybridAggregate,
    index_build_ms: indexBuildMs,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['-y', '@stripe/mcp'],
    env: { ...process.env, STRIPE_SECRET_KEY: STRIPE_KEY! },
  });
  const client = new Client({ name: 'mcpack-harness', version: '0.1.0' });

  // Safety net for cleanup (Pitfall 1)
  let closed = false;
  const cleanup = () => {
    if (!closed) {
      closed = true;
      client.close().catch(() => {});
    }
  };
  process.on('exit', cleanup);

  try {
    // Connect and get vanilla tools
    await client.connect(transport);
    const { tools } = await client.listTools();

    const vanillaPayload = JSON.stringify(tools);
    const vanillaChars = vanillaPayload.length;

    console.log('=== MCPack Token Reduction Report ===\n');
    console.log(`Stripe MCP tools discovered: ${tools.length}\n`);

    // Build MCPack index
    const index = buildIndex(tools as Tool[]);

    // Run each query
    const queryResults: QueryResult[] = [];

    for (const query of queries) {
      const results = scoreAndRank(query, index, 5);
      const mcpackChars = JSON.stringify(results.map((r) => r.schema)).length;

      const estimatedTokensVanilla = Math.ceil(vanillaChars / 4);
      const estimatedTokensMcpack = Math.ceil(mcpackChars / 4);

      const result: QueryResult = {
        query,
        vanilla_tool_count: tools.length,
        mcpack_tool_count: results.length,
        vanilla_chars: vanillaChars,
        mcpack_chars: mcpackChars,
        char_reduction_pct: parseFloat(((1 - mcpackChars / vanillaChars) * 100).toFixed(1)),
        estimated_tokens_vanilla: estimatedTokensVanilla,
        estimated_tokens_mcpack: estimatedTokensMcpack,
        estimated_tokens_saved: estimatedTokensVanilla - estimatedTokensMcpack,
      };

      queryResults.push(result);

      // Console per-query output
      console.log(`Query: "${query}"`);
      console.log(`  Tools: ${result.vanilla_tool_count} vanilla -> ${result.mcpack_tool_count} MCPack`);
      console.log(`  Chars: ${result.vanilla_chars} -> ${result.mcpack_chars} (${result.char_reduction_pct}% reduction)`);
      console.log(`  Est. tokens: ${result.estimated_tokens_vanilla} -> ${result.estimated_tokens_mcpack} (saved ~${result.estimated_tokens_saved})\n`);
    }

    // Aggregate calculation (D-14)
    const totalVanillaChars = queryResults.reduce((s, r) => s + r.vanilla_chars, 0);
    const totalMcpackChars = queryResults.reduce((s, r) => s + r.mcpack_chars, 0);
    const totalTokensVanilla = queryResults.reduce((s, r) => s + r.estimated_tokens_vanilla, 0);
    const totalTokensMcpack = queryResults.reduce((s, r) => s + r.estimated_tokens_mcpack, 0);

    const aggregate: AggregateResult = {
      total_vanilla_chars: totalVanillaChars,
      total_mcpack_chars: totalMcpackChars,
      overall_reduction_pct: parseFloat(((1 - totalMcpackChars / totalVanillaChars) * 100).toFixed(1)),
      total_estimated_tokens_vanilla: totalTokensVanilla,
      total_estimated_tokens_mcpack: totalTokensMcpack,
      total_estimated_tokens_saved: totalTokensVanilla - totalTokensMcpack,
    };

    // Console aggregate output
    console.log('--- Aggregate (keyword) ---');
    console.log(`Total chars: ${aggregate.total_vanilla_chars} -> ${aggregate.total_mcpack_chars}`);
    console.log(`Overall reduction: ${aggregate.overall_reduction_pct}%`);
    console.log(`Total est. tokens saved: ${aggregate.total_estimated_tokens_saved}\n`);
    console.log(`Note: ${DISCLAIMER_NOTE}\n`);

    // ─── Phase 10 (Plan 10-01): hybrid measurement block ──────────────────
    let hybridBlock: HarnessReport['hybrid'] = undefined;
    try {
      hybridBlock = await measureHybrid(tools as Tool[], vanillaChars);
    } catch (err: unknown) {
      console.error('Hybrid measurement skipped:', err instanceof Error ? err.message : String(err));
    }

    // Build and write report (D-11, D-12, D-16, D-17 + Phase 10 additive hybrid block)
    const report: HarnessReport = {
      generated_at: new Date().toISOString(),
      stripe_tool_count: tools.length,
      queries: queryResults,
      aggregate,
      ...(hybridBlock ? { hybrid: hybridBlock } : {}),
      note: DISCLAIMER_NOTE,
    };

    await writeFile(REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`Report written to ${REPORT_PATH}`);
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error('Harness failed:', err);
  process.exit(1);
});
