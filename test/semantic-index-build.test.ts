import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { MCPackEngine } from '../src/core.js';
import type { EmbeddingProvider } from '../src/index.js';

// ─── Test fixtures ────────────────────────────────────────────────────────

function makeTool(
  name: string,
  description: string,
  properties?: Record<string, object>,
): Tool {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties: properties ?? {},
    },
  };
}

// Deterministic mock provider — 8-dim vectors derived from a string hash.
// Fast (synchronous body wrapped in async), offline, reproducible.
// Pattern mirrors test/types.test.ts:8-10 (Phase 6 mock-provider convention).
const mockProvider: EmbeddingProvider = async (texts) =>
  texts.map((t) => {
    let hash = 0;
    for (let i = 0; i < t.length; i++) hash = (hash * 31 + t.charCodeAt(i)) | 0;
    return Array.from({ length: 8 }, (_, i) => ((hash + i * 17) % 1000) / 1000);
  });

// ─── Test suite ───────────────────────────────────────────────────────────

describe('MCPackEngine — semantic index build (Phase 7)', () => {
  let engine: MCPackEngine;

  afterEach(() => {
    engine?.destroy();
    vi.restoreAllMocks();
  });

  // ─── Group 1: build kickoff ────────────────────────────────────────────

  describe('build kickoff', () => {
    it('does not kick off a build when embeddings is absent', async () => {
      let callCount = 0;
      const countingProvider: EmbeddingProvider = async (t) => {
        callCount++;
        return t.map(() => [0]);
      };
      void countingProvider; // not passed — proving the negative

      engine = new MCPackEngine([makeTool('a', 'd')], {});
      expect(engine.isIndexReady()).toBe(false);
      await Promise.resolve(); // drain microtasks
      expect(engine.isIndexReady()).toBe(false);
      expect(callCount).toBe(0);
      // Private field check: indexBuildPromise should be undefined
      expect((engine as any).indexBuildPromise).toBeUndefined();
    });

    it('kicks off a build when embeddings.provider is set', async () => {
      engine = new MCPackEngine([makeTool('a', 'd')], {
        embeddings: { provider: mockProvider },
      });
      // Constructor returned synchronously; build is in flight.
      // indexBuildPromise is the deterministic synchronization handle.
      expect((engine as any).indexBuildPromise).toBeInstanceOf(Promise);
      await (engine as any).indexBuildPromise;
      expect(engine.isIndexReady()).toBe(true);
    });

    it('handles empty tool surface as a no-op (provider not invoked)', async () => {
      let callCount = 0;
      const countingProvider: EmbeddingProvider = async (t) => {
        callCount++;
        return t.map(() => [0]);
      };
      // Direct MCPackEngine construction permits empty tools (defense-in-depth path);
      // wrap.ts and build.ts both throw on empty at their entry points.
      engine = new MCPackEngine([], { embeddings: { provider: countingProvider } });
      await (engine as any).indexBuildPromise;
      expect(engine.isIndexReady()).toBe(true);
      expect(callCount).toBe(0); // provider NOT invoked for empty tool surface
      const map = (engine as any).semanticIndex as Map<string, Float32Array>;
      expect(map.size).toBe(0);
    });
  });

  // ─── Group 2: indexing string composition ──────────────────────────────

  describe('indexing string composition', () => {
    it('passes "name + description + param-names" to the provider in a single batch', async () => {
      const seen: string[] = [];
      const captureProvider: EmbeddingProvider = async (texts) => {
        seen.push(...texts);
        return texts.map(() => [0, 0, 0]);
      };
      const tools = [
        makeTool('create_customer', 'Create a customer', {
          name: { type: 'string' },
          email: { type: 'string' },
        }),
        makeTool('list_payments', 'List payments', {
          customer_id: { type: 'string' },
        }),
      ];
      engine = new MCPackEngine(tools, { embeddings: { provider: captureProvider } });
      await (engine as any).indexBuildPromise;
      // Single batch: provider received exactly N strings.
      expect(seen).toHaveLength(2);
      // Locked format: name + " " + description + " " + paramNames.join(" ")
      expect(seen[0]).toBe('create_customer Create a customer name email');
      expect(seen[1]).toBe('list_payments List payments customer_id');
    });

    it('handles tools without descriptions or parameters gracefully', async () => {
      const seen: string[] = [];
      const captureProvider: EmbeddingProvider = async (texts) => {
        seen.push(...texts);
        return texts.map(() => [0]);
      };
      const tool: Tool = { name: 'bare_tool', inputSchema: { type: 'object' } };
      engine = new MCPackEngine([tool], { embeddings: { provider: captureProvider } });
      await (engine as any).indexBuildPromise;
      // No description, no params; .trim() collapses to just the name.
      expect(seen[0]).toBe('bare_tool');
    });
  });

  // ─── Group 3: storage shape and dim-consistency ────────────────────────

  describe('storage shape and dim-consistency', () => {
    it('stores Float32Array vectors keyed by tool name', async () => {
      const tools = [makeTool('a', 'desc'), makeTool('b', 'desc')];
      engine = new MCPackEngine(tools, { embeddings: { provider: mockProvider } });
      await (engine as any).indexBuildPromise;
      const map = (engine as any).semanticIndex as Map<string, Float32Array>;
      expect(map.size).toBe(2);
      expect(map.get('a')).toBeInstanceOf(Float32Array);
      expect(map.get('b')).toBeInstanceOf(Float32Array);
      expect(map.get('a')!.length).toBe(8); // mock dim
      expect(map.get('b')!.length).toBe(8);
    });

    it('rejects when provider returns inconsistent dims (parallel-array contract violation)', async () => {
      // Suppress the expected console.warn for this failure path.
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const badProvider: EmbeddingProvider = async () => [
        [1, 2, 3],
        [1, 2], // dim mismatch
      ];
      engine = new MCPackEngine([makeTool('a', ''), makeTool('b', '')], {
        embeddings: { provider: badProvider },
      });
      await (engine as any).indexBuildPromise;
      expect(engine.isIndexReady()).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('rejects when provider returns wrong vector count', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const wrongCountProvider: EmbeddingProvider = async () => [[1]];
      engine = new MCPackEngine([makeTool('a', ''), makeTool('b', '')], {
        embeddings: { provider: wrongCountProvider },
      });
      await (engine as any).indexBuildPromise;
      expect(engine.isIndexReady()).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  // ─── Group 4: non-blocking constructor + tools/list path ───────────────

  describe('non-blocking constructor + tools/list path', () => {
    it('engine constructor returns synchronously even with embeddings configured', () => {
      // Slow provider — would block the constructor if awaited.
      const slowProvider: EmbeddingProvider = (texts) =>
        new Promise((resolve) =>
          setTimeout(() => resolve(texts.map(() => [1])), 50),
        );
      const start = Date.now();
      engine = new MCPackEngine([makeTool('a', '')], {
        embeddings: { provider: slowProvider },
      });
      const elapsed = Date.now() - start;
      // Sync return; build is detached. CONTEXT §"Build Lifecycle" budget is < 50ms.
      // The 50ms provider sleep is the synchronization marker (proves the constructor
      // returned before the provider resolved), NOT a perf budget. 50ms gives 5×
      // headroom on a heavily loaded CI host with cold V8 caches and GC pressure;
      // tightening to 10ms buys nothing and risks flakiness under CI load.
      expect(elapsed).toBeLessThan(50);
      // Build still in flight; isIndexReady is false until promise resolves.
      expect(engine.isIndexReady()).toBe(false);
    });

    it('handleToolsList() works while build is in flight', () => {
      const slowProvider: EmbeddingProvider = (texts) =>
        new Promise((resolve) =>
          setTimeout(() => resolve(texts.map(() => [1])), 50),
        );
      engine = new MCPackEngine([makeTool('a', '')], {
        embeddings: { provider: slowProvider },
      });
      // Sync call, no await on build — proves no async dependency from list path.
      const result = engine.handleToolsList();
      expect(result.tools).toHaveLength(1);
      expect(result.tools[0]!.name).toBe('search_tools');
    });

    it('handleSearchTools() falls back to keyword scoring when build is in flight', () => {
      // Slow provider so build hasn't completed when we query.
      const slowProvider: EmbeddingProvider = (texts) =>
        new Promise((resolve) =>
          setTimeout(() => resolve(texts.map(() => [1])), 100),
        );
      const tools = [
        makeTool('create_customer', 'Create a new customer'),
        makeTool('list_payments', 'List payment history'),
      ];
      engine = new MCPackEngine(tools, { embeddings: { provider: slowProvider } });
      // Query immediately — build is in flight.
      expect(engine.isIndexReady()).toBe(false);
      const result = engine.handleSearchTools(
        { query: 'customer' },
        'sess-fallback',
      );
      // v1.0 keyword path matched 'create_customer' — proves fallback works.
      const response = JSON.parse(result.content[0]!.text);
      expect(response.tools.map((t: { name: string }) => t.name)).toContain(
        'create_customer',
      );
    });
  });

  // ─── Group 5: build-failure semantics + warning-surface negative control ─

  describe('build-failure semantics + warning-surface negative control (RBAC + Pitfall 2 + Pitfall 7)', () => {
    it('build-failure path: provider rejection logs warning and leaves isIndexReady false', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const rejectingProvider: EmbeddingProvider = async () => {
        throw new Error('simulated embedding service unreachable');
      };
      engine = new MCPackEngine([makeTool('a', '')], {
        embeddings: { provider: rejectingProvider },
      });
      await (engine as any).indexBuildPromise;
      expect(engine.isIndexReady()).toBe(false);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const message = warnSpy.mock.calls[0]![0] as string;
      expect(message).toMatch(/^MCPack: semantic index build failed: /);
      expect(message).toContain('simulated embedding service unreachable');
    });

    it('build-failure log message contains NO tool names (RBAC invariant)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const rejectingProvider: EmbeddingProvider = async () => {
        throw new Error('provider error');
      };
      const tools = [
        makeTool('create_customer', 'Create a customer'),
        makeTool('list_payments', 'List payments'),
        makeTool('refund_charge', 'Refund a charge'),
      ];
      engine = new MCPackEngine(tools, {
        embeddings: { provider: rejectingProvider },
      });
      await (engine as any).indexBuildPromise;
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const fullLog = warnSpy.mock.calls[0]!.join(' ');
      // CLAUDE.md Quality Gate #5: failure-mode logging MUST NOT enumerate tool names.
      expect(fullLog).not.toContain('create_customer');
      expect(fullLog).not.toContain('list_payments');
      expect(fullLog).not.toContain('refund_charge');
    });

    it('handleSearchTools during build-pending state emits NO warnings (Pitfall 7 negative control)', () => {
      // Pitfall 7 enforcement: Phase 7 explicitly does NOT add per-query "build pending"
      // warnings — they would flood Phase 10's real-MiniLM harness logs. The only new
      // warn site introduced by Phase 7 is the constructor's `.catch` handler. This
      // test guards against future regressions where an executor could read
      // CONTEXT.md's "fallback to keyword + log warning" phrasing literally and add
      // a per-query warn inside handleSearchTools.
      const slowProvider: EmbeddingProvider = (texts) =>
        new Promise((resolve) =>
          setTimeout(() => resolve(texts.map(() => [1])), 200),
        );
      const tools = [
        makeTool('create_customer', 'Create a new customer'),
        makeTool('list_payments', 'List payment history'),
      ];
      engine = new MCPackEngine(tools, { embeddings: { provider: slowProvider } });
      // Spy AFTER construction so the constructor's success path (no warn here) is
      // not observed — we want to isolate the warn surface of handleSearchTools alone.
      // Build is still in flight at this point (slowProvider has 200ms timeout).
      expect(engine.isIndexReady()).toBe(false);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // Multiple queries during build-pending state — none should warn.
      engine.handleSearchTools({ query: 'customer' }, 'sess-1');
      engine.handleSearchTools({ query: 'payments' }, 'sess-2');
      engine.handleSearchTools({ query: 'unrelated' }, 'sess-3');
      expect(engine.isIndexReady()).toBe(false); // still pending
      // The negative invariant: zero new warn calls during build-pending queries.
      expect(warnSpy).toHaveBeenCalledTimes(0);
    });
  });

  // ─── Group 6: performance bounds (mock-level) ──────────────────────────

  describe('performance bounds (mock-provider, unit-test level)', () => {
    it('builds 50-tool index in < 1 second with deterministic mock', async () => {
      const tools = Array.from({ length: 50 }, (_, i) =>
        makeTool(`tool_${i}`, `description ${i}`, { p1: { type: 'string' } }),
      );
      const start = Date.now();
      engine = new MCPackEngine(tools, {
        embeddings: { provider: mockProvider },
      });
      await (engine as any).indexBuildPromise;
      const elapsed = Date.now() - start;
      // Mock is sub-ms; 1000ms cap is pure async-orchestration overhead.
      // Real-MiniLM 5s budget is asserted in Phase 10's harness, NOT here.
      expect(elapsed).toBeLessThan(1000);
      const map = (engine as any).semanticIndex as Map<string, Float32Array>;
      expect(map.size).toBe(50);
    });

    it('vector storage stays well under 2 MB for 50-tool 384-dim index', async () => {
      const provider384: EmbeddingProvider = async (texts) =>
        texts.map(() => Array.from({ length: 384 }, () => 0.1));
      const tools = Array.from({ length: 50 }, (_, i) => makeTool(`t${i}`, ''));
      engine = new MCPackEngine(tools, { embeddings: { provider: provider384 } });
      await (engine as any).indexBuildPromise;
      const map = (engine as any).semanticIndex as Map<string, Float32Array>;
      // Float32Array dense storage: 50 * 384 * 4 bytes = 76,800 bytes exact.
      let bytes = 0;
      for (const v of map.values()) bytes += v.byteLength;
      expect(bytes).toBe(76_800);
      expect(bytes).toBeLessThan(2 * 1024 * 1024); // 2 MB ceiling
    });
  });

  // ─── Group 7: regression — byte-identical v1.0 path when embeddings absent ─

  describe('regression: byte-identical v1.0 path when embeddings absent', () => {
    it('engine without embeddings makes no provider calls and isIndexReady stays false', async () => {
      let callCount = 0;
      const countingProvider: EmbeddingProvider = async (t) => {
        callCount++;
        return t.map(() => [0]);
      };
      void countingProvider; // declared but intentionally not passed to config
      // Constructed WITHOUT embeddings → provider never invoked.
      engine = new MCPackEngine([makeTool('a', '')], {});
      await Promise.resolve(); // drain any pending microtasks (defense)
      expect(callCount).toBe(0);
      expect(engine.isIndexReady()).toBe(false);
      expect((engine as any).semanticIndex).toBeNull();
      expect((engine as any).indexBuildPromise).toBeUndefined();
    });
  });
});
