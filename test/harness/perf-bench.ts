/**
 * Performance Benchmark — real-MiniLM perf measurement.
 *
 * Measures the four numerical perf gates for v1.1 GA against a synthetic
 * 50-tool corpus (no Stripe required — runs offline once the MiniLM model
 * is cached):
 *
 *   - Gate 6d: index_build_ms ≤ 5000ms (50-tool MiniLM)
 *   - Gate 6c: search_p99_delta_ms ≤ 50ms (hybrid p99 vs keyword p99)
 *   - REQ-v11-perf-budget: vector_bytes ≤ 2,097,152 (2 MiB)
 *
 * Methodology (per CONTEXT.md "Performance measurement methodology" §):
 *   - Synthetic 50 tools with realistic name/description/inputSchema shapes
 *     generated from a deterministic seed for reproducibility.
 *   - Build keyword engine; warm-cache 100 search_tools calls; p99.
 *   - Build hybrid engine with createMiniLMProvider(); wait for hasVectors();
 *     warm-cache 100 search_tools calls; p99.
 *   - First MiniLM call downloads ~90MB to the @huggingface/transformers
 *     cache. Subsequent runs are warm.
 *
 * Usage: npm run perf-bench
 *
 * Phase 10 — Plan 10-01.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { MCPackEngine } from '../../src/core.js';
// Relative import — see intent-benchmark.ts for rationale (Gate 1 + Gate 3 REVISED).
import { createMiniLMProvider } from '../../packages/mcpack-embeddings/src/index.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface PerfReport {
  generated_at: string;
  tool_count: number;
  index_build_ms: number;
  keyword_p99_ms: number;
  keyword_median_ms: number;
  hybrid_p99_ms: number;
  hybrid_median_ms: number;
  search_p99_delta_ms: number;
  vector_bytes: number;
  vector_count: number;
  vector_dim: number;
  search_iterations: number;
  gate_6c_passed: boolean; // search_p99_delta_ms ≤ 50
  gate_6d_passed: boolean; // index_build_ms ≤ 5000
  gate_perf_memory_passed: boolean; // vector_bytes ≤ 2,097,152
  thresholds: {
    index_build_ms_max: number;
    search_p99_delta_ms_max: number;
    vector_bytes_max: number;
  };
  passed: boolean;
  note: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = join(__dirname, 'perf-bench-report.json');

const TOOL_COUNT = 50;
const SEARCH_ITERATIONS = 100;
const INDEX_BUILD_MS_MAX = 5000;
const SEARCH_P99_DELTA_MS_MAX = 50;
const VECTOR_BYTES_MAX = 2_097_152; // 2 MiB

// ─── Synthetic tool corpus ──────────────────────────────────────────────────

const RESOURCES = [
  'customer', 'invoice', 'subscription', 'payment', 'product', 'price',
  'refund', 'coupon', 'transfer', 'payout', 'charge', 'dispute',
  'session', 'webhook', 'token', 'method', 'plan', 'usage',
  'discount', 'event', 'capability', 'order', 'tax', 'shipping', 'document',
];
const ACTIONS = ['create', 'list', 'retrieve', 'update', 'delete', 'cancel'];

/**
 * Deterministic synthetic 50-tool corpus. Each tool has a name like
 * `<action>_<resource>`, a realistic description, and a small inputSchema
 * with 1-3 properties. Cycles through the resource/action grid for stable
 * ordering.
 */
function buildSyntheticTools(count: number): Tool[] {
  const tools: Tool[] = [];
  let i = 0;
  while (tools.length < count) {
    const resource = RESOURCES[i % RESOURCES.length]!;
    const action = ACTIONS[Math.floor(i / RESOURCES.length) % ACTIONS.length]!;
    const name = `${action}_${resource}`;
    const description = `${action[0]!.toUpperCase()}${action.slice(1)} a ${resource} record. Useful when working with Stripe-style ${resource} resources for billing, subscription management, or transactional flows.`;
    const inputSchema: Tool['inputSchema'] = {
      type: 'object',
      properties: {
        [`${resource}_id`]: { type: 'string', description: `${resource} identifier` },
        amount: { type: 'number', description: 'Amount in smallest currency unit' },
        currency: { type: 'string', description: 'ISO 4217 currency code' },
      },
      required: action === 'create' ? ['amount', 'currency'] : [`${resource}_id`],
    };
    tools.push({ name, description, inputSchema });
    i++;
  }
  return tools;
}

const QUERIES = [
  'create a new customer record',
  'list recent invoices',
  'cancel a subscription for a buyer',
  'issue a refund on a recent payment',
  'find products with a given price',
  'set up recurring billing',
  'show all coupons',
  'create a payment intent for a charge',
  'list all webhooks configured',
  'retrieve a single invoice by id',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computePercentile(samples: number[], pct: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((pct / 100) * sorted.length));
  return sorted[idx]!;
}

function computeMedian(samples: number[]): number {
  return computePercentile(samples, 50);
}

async function waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<number> {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return performance.now() - start;
}

async function timeSearch(engine: MCPackEngine, query: string, sessionId: string): Promise<number> {
  const start = performance.now();
  await Promise.resolve(engine.handleSearchTools({ query, limit: 5 }, sessionId));
  return performance.now() - start;
}

async function runSearchSweep(
  engine: MCPackEngine,
  sessionId: string,
  iterations: number,
): Promise<number[]> {
  // Warm-up — first 10 calls discarded to avoid cold-cache noise
  for (let i = 0; i < 10; i++) {
    await timeSearch(engine, QUERIES[i % QUERIES.length]!, sessionId);
  }
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t = await timeSearch(engine, QUERIES[i % QUERIES.length]!, sessionId);
    samples.push(t);
  }
  return samples;
}

function measureVectorBytes(engine: MCPackEngine): { bytes: number; count: number; dim: number } {
  // Engine.semanticIndex is private but accessible for offline measurement
  // (harness convention — Phase 10 DEC-v11-10-05 allows this).
  const idx = (engine as unknown as { semanticIndex: Map<string, Float32Array> | null }).semanticIndex;
  if (!idx) return { bytes: 0, count: 0, dim: 0 };
  let bytes = 0;
  let dim = 0;
  for (const vec of idx.values()) {
    bytes += vec.byteLength;
    if (dim === 0) dim = vec.length;
  }
  return { bytes, count: idx.size, dim };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`Building synthetic ${TOOL_COUNT}-tool corpus...`);
  const tools = buildSyntheticTools(TOOL_COUNT);
  console.log(`Tools: ${tools.length}`);
  console.log(`Sample names: ${tools.slice(0, 3).map((t) => t.name).join(', ')}, ...`);

  // ─── Keyword engine (no embeddings) ────────────────────────────────────
  console.log('\n=== Keyword-only engine ===');
  const keywordEngine = new MCPackEngine(tools, {});
  console.log(`Running ${SEARCH_ITERATIONS} search calls (warm cache)...`);
  const keywordSamples = await runSearchSweep(keywordEngine, 'perf-keyword', SEARCH_ITERATIONS);
  const keywordP99 = computePercentile(keywordSamples, 99);
  const keywordMedian = computeMedian(keywordSamples);
  console.log(`  median: ${keywordMedian.toFixed(3)}ms, p99: ${keywordP99.toFixed(3)}ms`);

  // ─── Hybrid engine (with MiniLM provider) ──────────────────────────────
  console.log('\n=== Hybrid engine (MiniLM) ===');
  console.log('Loading MiniLM provider (first run downloads ~90MB)...');
  const provider = await createMiniLMProvider();
  console.log('Constructing hybrid engine + waiting for index build...');
  const buildStart = performance.now();
  const hybridEngine = new MCPackEngine(tools, { embeddings: { provider } });
  const indexBuildMs = await waitFor(
    () => (hybridEngine as unknown as { hasVectors(): boolean }).hasVectors(),
    300_000,
    'hybrid engine hasVectors()=true',
  );
  const wallBuildMs = performance.now() - buildStart;
  console.log(`  index_build_ms (poll-observed): ${indexBuildMs.toFixed(1)}`);
  console.log(`  index_build_ms (wall-clock):    ${wallBuildMs.toFixed(1)}`);

  console.log(`Running ${SEARCH_ITERATIONS} hybrid search calls (warm cache)...`);
  const hybridSamples = await runSearchSweep(hybridEngine, 'perf-hybrid', SEARCH_ITERATIONS);
  const hybridP99 = computePercentile(hybridSamples, 99);
  const hybridMedian = computeMedian(hybridSamples);
  console.log(`  median: ${hybridMedian.toFixed(3)}ms, p99: ${hybridP99.toFixed(3)}ms`);

  const { bytes: vectorBytes, count: vectorCount, dim: vectorDim } = measureVectorBytes(hybridEngine);
  console.log(`\nVector index: ${vectorCount} vectors × ${vectorDim} dims = ${vectorBytes} bytes (${(vectorBytes / 1024).toFixed(1)} KiB)`);

  // ─── Aggregate ─────────────────────────────────────────────────────────
  const searchP99Delta = hybridP99 - keywordP99;
  const gate6c = searchP99Delta <= SEARCH_P99_DELTA_MS_MAX;
  const gate6d = wallBuildMs <= INDEX_BUILD_MS_MAX;
  const gateMem = vectorBytes <= VECTOR_BYTES_MAX;
  const allPassed = gate6c && gate6d && gateMem;

  console.log('\n=== Perf Bench Report ===');
  console.log(`Gate 6d  index_build_ms:        ${wallBuildMs.toFixed(1)} ms  (≤ ${INDEX_BUILD_MS_MAX} ms)  ${gate6d ? 'PASS' : 'FAIL'}`);
  console.log(`Gate 6c  search_p99_delta_ms:   ${searchP99Delta.toFixed(3)} ms  (≤ ${SEARCH_P99_DELTA_MS_MAX} ms)  ${gate6c ? 'PASS' : 'FAIL'}`);
  console.log(`Memory   vector_bytes:          ${vectorBytes} bytes  (≤ ${VECTOR_BYTES_MAX})  ${gateMem ? 'PASS' : 'FAIL'}`);
  console.log(`Overall: ${allPassed ? 'PASS' : 'FAIL'}\n`);

  const report: PerfReport = {
    generated_at: new Date().toISOString(),
    tool_count: tools.length,
    index_build_ms: parseFloat(wallBuildMs.toFixed(2)),
    keyword_p99_ms: parseFloat(keywordP99.toFixed(3)),
    keyword_median_ms: parseFloat(keywordMedian.toFixed(3)),
    hybrid_p99_ms: parseFloat(hybridP99.toFixed(3)),
    hybrid_median_ms: parseFloat(hybridMedian.toFixed(3)),
    search_p99_delta_ms: parseFloat(searchP99Delta.toFixed(3)),
    vector_bytes: vectorBytes,
    vector_count: vectorCount,
    vector_dim: vectorDim,
    search_iterations: SEARCH_ITERATIONS,
    gate_6c_passed: gate6c,
    gate_6d_passed: gate6d,
    gate_perf_memory_passed: gateMem,
    thresholds: {
      index_build_ms_max: INDEX_BUILD_MS_MAX,
      search_p99_delta_ms_max: SEARCH_P99_DELTA_MS_MAX,
      vector_bytes_max: VECTOR_BYTES_MAX,
    },
    passed: allPassed,
    note:
      'Real-MiniLM perf measurement against a synthetic 50-tool corpus. ' +
      'index_build_ms is wall-clock from constructor to hasVectors()=true. ' +
      'p99 measured over 100 warm-cache search_tools calls (10-call warm-up discarded). ' +
      'First run downloads ~90MB MiniLM model to @huggingface/transformers cache; ' +
      'subsequent runs are warm.',
  };

  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`Report written to ${REPORT_PATH}`);

  keywordEngine.destroy();
  hybridEngine.destroy();

  if (!allPassed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Perf bench failed:', err);
  process.exit(1);
});
