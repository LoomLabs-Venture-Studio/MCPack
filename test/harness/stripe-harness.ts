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

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['-y', '@stripe/mcp', '--api-key', STRIPE_KEY!],
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
    console.log('--- Aggregate ---');
    console.log(`Total chars: ${aggregate.total_vanilla_chars} -> ${aggregate.total_mcpack_chars}`);
    console.log(`Overall reduction: ${aggregate.overall_reduction_pct}%`);
    console.log(`Total est. tokens saved: ${aggregate.total_estimated_tokens_saved}\n`);
    console.log(`Note: ${DISCLAIMER_NOTE}\n`);

    // Build and write report (D-11, D-12, D-16, D-17)
    const report: HarnessReport = {
      generated_at: new Date().toISOString(),
      stripe_tool_count: tools.length,
      queries: queryResults,
      aggregate,
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
