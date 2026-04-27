/**
 * Intent Benchmark — recall@5 measurement.
 *
 * Spawns the live @stripe/mcp server, captures the live tool surface, and
 * drives 50 hand-authored intent queries through both:
 *   - v1.0 keyword-only path: `MCPackEngine` constructed without `embeddings`
 *   - v1.1 hybrid path:        `MCPackEngine` constructed with `embeddings.provider`
 *
 * For each query, computes whether the expectedTool appears in the top-5
 * returned by search_tools. Aggregate recall@5 = hits / valid_queries
 * where `valid_queries` excludes queries that NEITHER engine finds
 * (zero-information case per CONTEXT.md DEC-v11-10-01 edge case).
 *
 * Threshold: hybrid recall@5 must be ≥ keyword recall@5 + 15 percentage
 * points absolute (Gate 6b — PRD §"Success Criteria — v1.1").
 *
 * Usage: STRIPE_SECRET_KEY=sk_test_xxx npm run benchmark
 *
 * Phase 10 — Plan 10-01.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MCPackEngine } from '../../src/core.js';
// NOTE: adapter is loaded via dynamic import inside main() so the API-key
// pre-check (which exits 0 when STRIPE_SECRET_KEY is unset) runs without
// triggering eager module resolution of @huggingface/transformers — the
// transitive dep is only installed under packages/mcpack-embeddings/ in
// main repo, not in dev worktrees. Gate 1 (zero-new-core-deps) +
// Gate 3 REVISED (DEC-v11-10-05) trivially preserved.
type AdapterModule = {
  createMiniLMProvider: (opts?: { model?: string; cacheDir?: string }) => Promise<
    (texts: string[]) => Promise<number[][]>
  >;
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface BenchQuery {
  category: 'easy_keyword' | 'paraphrased' | 'abbreviation' | 'typo_or_partial';
  query: string;
  expectedTool: string;
}

interface QueryFile {
  _meta: Record<string, unknown>;
  queries: BenchQuery[];
}

interface PerQueryRow {
  query: string;
  category: BenchQuery['category'];
  expectedTool: string;
  matchedToolName: string | null;
  keywordHit: boolean;
  hybridHit: boolean;
  excluded: boolean;
}

interface CategorySummary {
  total: number;
  valid: number;
  keyword_recall_at_5: number;
  hybrid_recall_at_5: number;
  recall_improvement_pp: number;
}

interface BenchReport {
  generated_at: string;
  stripe_tool_count: number;
  total_queries: number;
  valid_queries: number;
  excluded_queries: number;
  keyword_recall_at_5: number;
  hybrid_recall_at_5: number;
  recall_improvement_pp: number;
  threshold_pp: number;
  passed: boolean;
  by_category: Record<BenchQuery['category'], CategorySummary>;
  per_query: PerQueryRow[];
  note: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUERIES_PATH = join(__dirname, 'intent-benchmark-queries.json');
const REPORT_PATH = join(__dirname, 'intent-benchmark-report.json');

const RECALL_THRESHOLD_PP = 15;
const TOP_K = 5;

// ─── API Key Check (mirrors stripe-harness.ts:55-59) ────────────────────────

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_API_KEY;

if (!STRIPE_KEY) {
  console.log('STRIPE_SECRET_KEY not set. Skipping intent benchmark.');
  console.log('Set STRIPE_SECRET_KEY to run: STRIPE_SECRET_KEY=sk_test_xxx npm run benchmark');
  process.exit(0);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Drive `search_tools` through the engine and return the ranked tool names.
 *
 * `handleSearchTools` returns either ToolCallResult or Promise<ToolCallResult>
 * depending on whether vectors are present. This helper normalises both paths
 * to an async return.
 */
async function searchTopK(
  engine: MCPackEngine,
  query: string,
  sessionId: string,
  k: number = TOP_K,
): Promise<string[]> {
  const result = await Promise.resolve(
    engine.handleSearchTools({ query, limit: k }, sessionId),
  );
  if (result.isError) {
    throw new Error(`search_tools failed: ${result.content[0]?.text ?? '(no content)'}`);
  }
  const text = result.content[0]?.text ?? '{}';
  const parsed = JSON.parse(text) as { tools: Array<{ name: string }> };
  return (parsed.tools ?? []).map((t) => t.name);
}

/**
 * Match a benchmark `expectedTool` (snake_case naming convention) against
 * actual returned tool names from the live Stripe surface. Tolerates naming
 * differences (snake_case, camelCase, dot-notation) by normalising to a
 * lowercased alphanumeric token sequence and checking substring containment.
 */
function normaliseName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

function expectedMatch(returned: string[], expected: string): { matched: boolean; matchedName: string | null } {
  const target = normaliseName(expected);
  // Try exact normalised match first
  for (const r of returned) {
    if (normaliseName(r) === target) return { matched: true, matchedName: r };
  }
  // Fall back to substring match (handles e.g. expected="create_customer", actual="customers_create")
  // — both directions checked because Stripe could use resource.action ordering.
  const targetTokens = target.split('_').filter(Boolean);
  for (const r of returned) {
    const rNorm = normaliseName(r);
    const allTokensPresent = targetTokens.every((t) => rNorm.includes(t));
    if (allTokensPresent) return { matched: true, matchedName: r };
  }
  return { matched: false, matchedName: null };
}

/** Wait up to `timeoutMs` for `predicate()` to return true. Polls every 100ms. */
async function waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // 1. Load queries
  const file = JSON.parse(await readFile(QUERIES_PATH, 'utf-8')) as QueryFile;
  const queries = file.queries;
  console.log(`Loaded ${queries.length} benchmark queries`);

  // 2. Spawn @stripe/mcp and capture tool surface
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['-y', '@stripe/mcp'],
    env: { ...process.env, STRIPE_SECRET_KEY: STRIPE_KEY! },
  });
  const client = new Client({ name: 'mcpack-intent-benchmark', version: '0.1.0' });

  let closed = false;
  const cleanup = () => {
    if (!closed) {
      closed = true;
      client.close().catch(() => {});
    }
  };
  process.on('exit', cleanup);

  let tools: Tool[];
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    tools = listed.tools as Tool[];
    console.log(`Stripe MCP tools discovered: ${tools.length}`);
  } finally {
    cleanup();
  }

  // 3. Build keyword-only engine (no embeddings)
  console.log('Building keyword engine...');
  const keywordEngine = new MCPackEngine(tools, {});

  // 4. Build hybrid engine (with MiniLM provider) and wait for vectors
  console.log('Building hybrid engine + loading MiniLM (~90MB on first run)...');
  const adapter: AdapterModule = await import('../../packages/mcpack-embeddings/src/index.js');
  const provider = await adapter.createMiniLMProvider();
  const hybridEngine = new MCPackEngine(tools, { embeddings: { provider } });

  // hasVectors() is internal but exposed via the engine instance — Phase 10
  // harness convention (intent-benchmark is offline measurement, not runtime).
  await waitFor(
    () => (hybridEngine as unknown as { hasVectors(): boolean }).hasVectors(),
    120_000,
    'hybrid engine hasVectors()=true',
  );
  console.log('Hybrid engine ready (semantic vectors built).');

  // 5. Drive each query through both engines
  const sessionKeyword = 'bench-keyword-session';
  const sessionHybrid = 'bench-hybrid-session';
  const perQuery: PerQueryRow[] = [];

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i]!;
    const kHits = await searchTopK(keywordEngine, q.query, sessionKeyword, TOP_K);
    const hHits = await searchTopK(hybridEngine, q.query, sessionHybrid, TOP_K);

    const kMatch = expectedMatch(kHits, q.expectedTool);
    const hMatch = expectedMatch(hHits, q.expectedTool);

    // Zero-information exclusion: neither finds it
    const excluded = !kMatch.matched && !hMatch.matched;

    perQuery.push({
      query: q.query,
      category: q.category,
      expectedTool: q.expectedTool,
      matchedToolName: hMatch.matchedName ?? kMatch.matchedName,
      keywordHit: kMatch.matched,
      hybridHit: hMatch.matched,
      excluded,
    });
  }

  // 6. Aggregate
  const valid = perQuery.filter((r) => !r.excluded);
  const validCount = valid.length;
  const keywordHits = valid.filter((r) => r.keywordHit).length;
  const hybridHits = valid.filter((r) => r.hybridHit).length;

  const keywordRecall = validCount === 0 ? 0 : keywordHits / validCount;
  const hybridRecall = validCount === 0 ? 0 : hybridHits / validCount;
  const recallDeltaPp = (hybridRecall - keywordRecall) * 100;

  // Per-category breakdown
  const categories: BenchQuery['category'][] = ['easy_keyword', 'paraphrased', 'abbreviation', 'typo_or_partial'];
  const byCategory = {} as Record<BenchQuery['category'], CategorySummary>;
  for (const cat of categories) {
    const rows = perQuery.filter((r) => r.category === cat);
    const validRows = rows.filter((r) => !r.excluded);
    const kH = validRows.filter((r) => r.keywordHit).length;
    const hH = validRows.filter((r) => r.hybridHit).length;
    const validN = validRows.length;
    const kR = validN === 0 ? 0 : kH / validN;
    const hR = validN === 0 ? 0 : hH / validN;
    byCategory[cat] = {
      total: rows.length,
      valid: validN,
      keyword_recall_at_5: parseFloat(kR.toFixed(4)),
      hybrid_recall_at_5: parseFloat(hR.toFixed(4)),
      recall_improvement_pp: parseFloat(((hR - kR) * 100).toFixed(2)),
    };
  }

  const passed = recallDeltaPp >= RECALL_THRESHOLD_PP;

  const report: BenchReport = {
    generated_at: new Date().toISOString(),
    stripe_tool_count: tools.length,
    total_queries: queries.length,
    valid_queries: validCount,
    excluded_queries: queries.length - validCount,
    keyword_recall_at_5: parseFloat(keywordRecall.toFixed(4)),
    hybrid_recall_at_5: parseFloat(hybridRecall.toFixed(4)),
    recall_improvement_pp: parseFloat(recallDeltaPp.toFixed(2)),
    threshold_pp: RECALL_THRESHOLD_PP,
    passed,
    by_category: byCategory,
    per_query: perQuery,
    note:
      'recall@5 measured over queries where at least one engine found the expectedTool ' +
      '(zero-information exclusion). expectedTool matched against returned tool names via ' +
      'case-insensitive normalisation + substring fallback to tolerate snake_case vs camelCase ' +
      'vs dot-notation. Threshold: hybrid_recall_at_5 ≥ keyword_recall_at_5 + 0.15 (Gate 6b).',
  };

  // 7. Console summary
  console.log('\n=== Intent Benchmark Report ===');
  console.log(`Total queries:      ${report.total_queries}`);
  console.log(`Valid (≥1 hit):     ${report.valid_queries}`);
  console.log(`Excluded (no hit):  ${report.excluded_queries}`);
  console.log(`Keyword recall@5:   ${(report.keyword_recall_at_5 * 100).toFixed(1)}%`);
  console.log(`Hybrid  recall@5:   ${(report.hybrid_recall_at_5 * 100).toFixed(1)}%`);
  console.log(`Improvement:        ${report.recall_improvement_pp.toFixed(2)} pp (threshold: +${RECALL_THRESHOLD_PP} pp)`);
  console.log(`Gate 6b: ${passed ? 'PASS' : 'FAIL'}\n`);
  console.log('By category:');
  for (const cat of categories) {
    const c = byCategory[cat];
    console.log(
      `  ${cat.padEnd(18)} valid=${c.valid}/${c.total}  ` +
        `keyword=${(c.keyword_recall_at_5 * 100).toFixed(1)}%  ` +
        `hybrid=${(c.hybrid_recall_at_5 * 100).toFixed(1)}%  ` +
        `Δ=${c.recall_improvement_pp.toFixed(2)} pp`,
    );
  }
  console.log('');

  // 8. Write report
  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`Report written to ${REPORT_PATH}`);

  // 9. Cleanup engines (stops session-registry timers)
  keywordEngine.destroy();
  hybridEngine.destroy();

  if (!passed) {
    console.error(`Gate 6b FAILED: recall improvement ${recallDeltaPp.toFixed(2)} pp < ${RECALL_THRESHOLD_PP} pp threshold`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Intent benchmark failed:', err);
  process.exit(1);
});
