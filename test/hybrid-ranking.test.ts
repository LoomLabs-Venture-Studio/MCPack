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

// Deterministic 8-dim mock provider (mirrors test/semantic-index-build.test.ts).
const mockProvider: EmbeddingProvider = async (texts) =>
  texts.map((t) => {
    let hash = 0;
    for (let i = 0; i < t.length; i++) hash = (hash * 31 + t.charCodeAt(i)) | 0;
    return Array.from({ length: 8 }, (_, i) => ((hash + i * 17) % 1000) / 1000);
  });

// Helper: parse the JSON envelope returned by handleSearchTools.
function parseSearchResponse(result: { content: Array<{ text: string }> }): {
  tools: Array<{ name: string; loaded: boolean; schema?: object }>;
  total_available: number;
  showing: number;
  session_id: string;
} {
  return JSON.parse(result.content[0]!.text);
}

// ─── Test suite ───────────────────────────────────────────────────────────

describe('MCPackEngine — Phase 8 hybrid ranking query path', () => {
  let engine: MCPackEngine | undefined;

  afterEach(() => {
    engine?.destroy();
    engine = undefined;
    vi.restoreAllMocks();
  });

  // ─── Group 1: hasVectors gate semantics ────────────────────────────────

  describe('hasVectors gate (DEC-v11-08-03 — distinguishes from isIndexReady)', () => {
    it('returns false when embeddings is absent', () => {
      engine = new MCPackEngine([makeTool('a', 'd')], {});
      expect(engine.hasVectors()).toBe(false);
    });

    it('returns false while build is in flight (slow provider)', () => {
      const slowProvider: EmbeddingProvider = (texts) =>
        new Promise((resolve) =>
          setTimeout(() => resolve(texts.map(() => [1])), 200),
        );
      engine = new MCPackEngine([makeTool('a', '')], {
        embeddings: { provider: slowProvider },
      });
      // Sync read immediately after construction — build is in flight.
      expect(engine.hasVectors()).toBe(false);
      expect(engine.isIndexReady()).toBe(false);
    });

    it('returns false when build failed', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const rejectingProvider: EmbeddingProvider = async () => {
        throw new Error('build failure');
      };
      engine = new MCPackEngine([makeTool('a', '')], {
        embeddings: { provider: rejectingProvider },
      });
      await (engine as any).indexBuildPromise;
      expect(engine.hasVectors()).toBe(false);
      expect(engine.isIndexReady()).toBe(false);
    });

    it('returns false when build succeeded with empty tool surface (Phase 7 WR-01 fix)', async () => {
      // Direct MCPackEngine construction permits empty tools; wrap.ts and build.ts
      // both throw on empty at their entry points. Empty surface → semanticIndex
      // is `new Map()` (size 0). Phase 7's isIndexReady returns true here (locked
      // semantics); Phase 8's hasVectors returns false because there are no
      // vectors to query semantically.
      engine = new MCPackEngine([], {
        embeddings: { provider: mockProvider },
      });
      await (engine as any).indexBuildPromise;
      expect(engine.isIndexReady()).toBe(true); // Phase 7 — UNCHANGED
      expect(engine.hasVectors()).toBe(false); // Phase 8 — NEW (DEC-v11-08-03)
    });

    it('returns true when build succeeded with at least one vector', async () => {
      engine = new MCPackEngine([makeTool('a', 'd')], {
        embeddings: { provider: mockProvider },
      });
      await (engine as any).indexBuildPromise;
      expect(engine.isIndexReady()).toBe(true);
      expect(engine.hasVectors()).toBe(true);
    });
  });

  // ─── Group 2: query-path routing ────────────────────────────────────────

  describe('handleSearchTools — query-path routing', () => {
    it('routes to hybrid path when hasVectors() is true and embedQuery succeeds', async () => {
      const tools = [
        makeTool('create_customer', 'Create a new customer'),
        makeTool('list_payments', 'List payment history'),
        makeTool('unrelated_tool', 'Does something else'),
      ];
      engine = new MCPackEngine(tools, {
        embeddings: { provider: mockProvider },
      });
      await (engine as any).indexBuildPromise;
      expect(engine.hasVectors()).toBe(true);

      const result = await engine.handleSearchTools(
        { query: 'customer' },
        'sess-1',
      );
      const response = parseSearchResponse(result);
      // Hybrid scoring: 'create_customer' has both semantic + keyword signal.
      expect(response.tools.map((t) => t.name)).toContain('create_customer');
    });

    it('routes to keyword-with-role-after-rank when hasVectors() is false', async () => {
      // No embeddings → hasVectors() returns false → keyword fallback path.
      const tools = [
        makeTool('create_customer', 'Create a new customer'),
        makeTool('list_payments', 'List payments'),
      ];
      engine = new MCPackEngine(tools, {});
      const result = await engine.handleSearchTools(
        { query: 'customer' },
        'sess-2',
      );
      const response = parseSearchResponse(result);
      expect(response.tools.map((t) => t.name)).toContain('create_customer');
      expect(response.tools.map((t) => t.name)).not.toContain('list_payments');
    });

    it('routes to keyword fallback when hasVectors() is true but embedQuery fails', async () => {
      // Counter-based provider: succeeds on first call (build), rejects after.
      let callCount = 0;
      const counterProvider: EmbeddingProvider = async (texts) => {
        callCount++;
        if (callCount === 1) {
          // First call is the build — succeed.
          return texts.map(() => [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
        }
        throw new Error('query embedding failure');
      };
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const tools = [
        makeTool('create_customer', 'Create a new customer'),
        makeTool('list_payments', 'List payments'),
      ];
      engine = new MCPackEngine(tools, {
        embeddings: { provider: counterProvider },
      });
      await (engine as any).indexBuildPromise;
      expect(engine.hasVectors()).toBe(true);

      const result = await engine.handleSearchTools(
        { query: 'customer' },
        'sess-3',
      );
      const response = parseSearchResponse(result);
      // Hybrid path attempted, embedQuery failed, fell through to keyword path.
      expect(response.tools.map((t) => t.name)).toContain('create_customer');
    });
  });

  // ─── Group 3: hybrid output — role-filter-after-rank pivot ─────────────

  describe('hybrid ranking — role-filter-after-rank pivot (REQ-v11-role-filter-after-rank)', () => {
    it('role-filtered tools never appear in hybrid output regardless of score', async () => {
      const tools = [
        makeTool('allowed_one', 'allowed customer tool'),
        makeTool('allowed_two', 'allowed payment tool'),
        makeTool('blocked_three', 'blocked customer tool'),
        makeTool('blocked_four', 'blocked payment tool'),
      ];
      engine = new MCPackEngine(tools, {
        embeddings: { provider: mockProvider },
        roles: { restricted: ['allowed_one', 'allowed_two'] },
        defaultRole: 'restricted',
      });
      await (engine as any).indexBuildPromise;

      const result = await engine.handleSearchTools(
        { query: 'customer payment' },
        'sess-rbac-1',
      );
      const response = parseSearchResponse(result);
      // WR-03 rename-safe pattern: iterate ACTUAL fixture names.
      const blockedNames = ['blocked_three', 'blocked_four'];
      const returnedNames = response.tools.map((t) => t.name);
      for (const blocked of blockedNames) {
        expect(returnedNames).not.toContain(blocked);
      }
      // Allowed tools should be in the response (at least one).
      const anyAllowedReturned = ['allowed_one', 'allowed_two'].some((n) =>
        returnedNames.includes(n),
      );
      expect(anyAllowedReturned).toBe(true);
    });

    it('rank reflects FULL tool surface but output is role-filtered (rank-then-filter)', async () => {
      // 5 tools, role 'restricted' allows 3 of them. Hybrid path scores all 5,
      // sorts, then filters to allowed surface. Demonstrates: a role-blocked
      // tool's high hybrid score does NOT push role-allowed tools out of the limit.
      const tools = [
        makeTool('allowed_alpha', 'customer query target'),
        makeTool('blocked_beta', 'customer query target'), // would also rank high
        makeTool('allowed_gamma', 'payment query target'),
        makeTool('blocked_delta', 'unrelated'),
        makeTool('allowed_epsilon', 'unrelated'),
      ];
      engine = new MCPackEngine(tools, {
        embeddings: { provider: mockProvider },
        roles: {
          restricted: ['allowed_alpha', 'allowed_gamma', 'allowed_epsilon'],
        },
        defaultRole: 'restricted',
      });
      await (engine as any).indexBuildPromise;

      const result = await engine.handleSearchTools(
        { query: 'customer' },
        'sess-rbac-2',
      );
      const response = parseSearchResponse(result);
      // No blocked tools in output regardless of their hybrid score.
      const returnedNames = response.tools.map((t) => t.name);
      const blockedFixtureNames = tools
        .filter((t) => t.name.startsWith('blocked_'))
        .map((t) => t.name);
      for (const blocked of blockedFixtureNames) {
        expect(returnedNames).not.toContain(blocked);
      }
      // total_available reflects role-allowed surface count, NOT full surface.
      expect(response.total_available).toBe(3);
    });
  });

  // ─── Group 4: query-embedding failure (P8 + P9 negative controls + WR-03) ─

  describe('query-embedding failure (P8 + P9 negative controls)', () => {
    it('P8 negative control: query-embedding failure does NOT propagate as unhandled rejection', async () => {
      const handler = vi.fn();
      process.on('unhandledRejection', handler);
      try {
        let callCount = 0;
        const counterProvider: EmbeddingProvider = async (texts) => {
          callCount++;
          if (callCount === 1) {
            return texts.map(() => [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
          }
          throw new Error('query embedding rejected');
        };
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const tools = [makeTool('a', 'first'), makeTool('b', 'second')];
        engine = new MCPackEngine(tools, {
          embeddings: { provider: counterProvider },
        });
        await (engine as any).indexBuildPromise;

        await engine.handleSearchTools({ query: 'first' }, 'sess-p8-1');
        await engine.handleSearchTools({ query: 'second' }, 'sess-p8-2');
        await engine.handleSearchTools({ query: 'third' }, 'sess-p8-3');

        // Drain microtasks AND macrotasks twice (WR-02 pattern from 08-RESEARCH).
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));

        expect(handler).not.toHaveBeenCalled();
      } finally {
        process.off('unhandledRejection', handler);
      }
    });

    it('P8 negative control: query-embedding failure warn fires EXACTLY ONCE per engine instance', async () => {
      let callCount = 0;
      const counterProvider: EmbeddingProvider = async (texts) => {
        callCount++;
        if (callCount === 1) {
          return texts.map(() => [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
        }
        throw new Error('query rejected');
      };
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const tools = [makeTool('a', 'first'), makeTool('b', 'second')];
      engine = new MCPackEngine(tools, {
        embeddings: { provider: counterProvider },
      });
      await (engine as any).indexBuildPromise;

      await engine.handleSearchTools({ query: 'q1' }, 'sess-p8-warn-1');
      await engine.handleSearchTools({ query: 'q2' }, 'sess-p8-warn-2');
      await engine.handleSearchTools({ query: 'q3' }, 'sess-p8-warn-3');
      await engine.handleSearchTools({ query: 'q4' }, 'sess-p8-warn-4');
      await engine.handleSearchTools({ query: 'q5' }, 'sess-p8-warn-5');

      // hasWarnedQueryEmbeddingFailure flag → warn fires EXACTLY ONCE per instance.
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const message = warnSpy.mock.calls[0]![0] as string;
      expect(message).toMatch(/^MCPack: query embedding failed: /);
      expect(message).toContain('query rejected');
    });

    it('embedQuery: defensive null when config.embeddings is missing (white-box, simulates drift)', async () => {
      // White-box test for the defensive guard inside embedQuery:
      //   `if (!this.config.embeddings) return null;`
      // By the engine's invariants, hasVectors() being true implies embeddings was
      // configured. The guard protects against future refactors where the two could
      // drift. We simulate that drift here by deleting embeddings post-build and
      // calling embedQuery directly.
      const tools = [makeTool('a', 'first'), makeTool('b', 'second')];
      engine = new MCPackEngine(tools, {
        embeddings: { provider: mockProvider },
      });
      await (engine as any).indexBuildPromise;
      expect(engine.hasVectors()).toBe(true);

      // Simulate drift: clear embeddings on the snapshotted config.
      (engine as any).config.embeddings = undefined;

      // Call private embedQuery directly via the bracket-access escape hatch.
      const result = await (engine as any).embedQuery('anything');
      expect(result).toBeNull();
    });

    it('hybrid path: tool missing from semanticIndex Map scores semantic 0 (defensive fallback)', async () => {
      // White-box test: deliberately mutate internal semanticIndex to remove one
      // tool's vector AFTER build, then query. Exercises the defensive `: 0`
      // fallback at scoreAndRankHybrid:
      //   `semanticScores.push(toolVec ? cosineSimilarity(queryVec, toolVec) : 0);`
      // This branch protects against drift between buildIndex and buildSemanticIndex
      // tool surfaces.
      const tools = [
        makeTool('alpha', 'first thing'),
        makeTool('beta', 'second thing'),
      ];
      engine = new MCPackEngine(tools, {
        embeddings: { provider: mockProvider },
      });
      await (engine as any).indexBuildPromise;
      expect(engine.hasVectors()).toBe(true);

      // Drop one tool's vector to simulate index/vector-store drift.
      const internalMap = (engine as any).semanticIndex as Map<string, Float32Array>;
      internalMap.delete('alpha');
      // hasVectors still true because beta's vector remains.
      expect(engine.hasVectors()).toBe(true);

      const result = await engine.handleSearchTools(
        { query: 'first' },
        'sess-defensive-1',
      );
      const response = parseSearchResponse(result);
      // Path executed without crash; query returns SOMETHING (alpha keyword score
      // dominates if normalized signal exists).
      expect(response.session_id).toBe('sess-defensive-1');
    });

    it('embedQuery: non-Error rejection (string thrown) coerces via String(err) in warn message', async () => {
      // Provider rejects with a non-Error value — exercises the
      // `err instanceof Error ? err.message : String(err)` else-branch.
      let callCount = 0;
      const stringRejecter: EmbeddingProvider = async (texts) => {
        callCount++;
        if (callCount === 1) {
          return texts.map(() => [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
        }
        // eslint-disable-next-line no-throw-literal
        throw 'string-thrown-non-error';
      };
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const tools = [makeTool('a', 'first'), makeTool('b', 'second')];
      engine = new MCPackEngine(tools, {
        embeddings: { provider: stringRejecter },
      });
      await (engine as any).indexBuildPromise;

      await engine.handleSearchTools({ query: 'first' }, 'sess-non-error');

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const message = warnSpy.mock.calls[0]![0] as string;
      expect(message).toMatch(/^MCPack: query embedding failed: /);
      expect(message).toContain('string-thrown-non-error');
    });

    it('embedQuery: malformed provider result (non-array, wrong length, non-array element) is caught and warns once', async () => {
      // Provider succeeds on build, returns malformed shape on query.
      // Exercises the parallel-array contract validation in embedQuery.
      let callCount = 0;
      const malformedProvider: EmbeddingProvider = async (texts) => {
        callCount++;
        if (callCount === 1) {
          // Build succeeds.
          return texts.map(() => [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
        }
        // Query returns wrong-shape result: empty array (length 0 ≠ 1).
        return [];
      };
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const tools = [makeTool('a', 'first'), makeTool('b', 'second')];
      engine = new MCPackEngine(tools, {
        embeddings: { provider: malformedProvider },
      });
      await (engine as any).indexBuildPromise;
      expect(engine.hasVectors()).toBe(true);

      const result = await engine.handleSearchTools(
        { query: 'first' },
        'sess-malformed-1',
      );
      const response = parseSearchResponse(result);
      // Fell through to keyword path — keyword score for 'first' matches 'first' description.
      expect(response.tools.map((t) => t.name)).toContain('a');

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const message = warnSpy.mock.calls[0]![0] as string;
      expect(message).toMatch(/^MCPack: query embedding failed: /);
      expect(message).toContain('malformed');
    });

    it('P9 negative control: query-embedding failure warn message contains NO tool names (RBAC + WR-03)', async () => {
      const tools = [
        makeTool('create_customer', 'Create a customer'),
        makeTool('list_payments', 'List payments'),
        makeTool('refund_charge', 'Refund a charge'),
        makeTool('get_balance', 'Get account balance'),
      ];
      let callCount = 0;
      const counterProvider: EmbeddingProvider = async (texts) => {
        callCount++;
        if (callCount === 1) {
          return texts.map(() => [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
        }
        // Adversarial: error message attempts to leak tool names. Engine must NOT
        // include err.message contents in any way that reveals tool surface.
        // Locked format: `MCPack: query embedding failed: ${err.message}` — the
        // err.message IS included, so an adversarial caller could embed names there.
        // Mitigation: the format is what is — the RBAC invariant is that the engine
        // does not ITERATE this.index/tools to assemble the warn. Provider-controlled
        // err.message is a separate concern (the provider is operator-controlled).
        // This test asserts the engine's contribution is fixed-format (no tool list).
        throw new Error('benign error code 42'); // benign — no fixture names embedded
      };
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      engine = new MCPackEngine(tools, {
        embeddings: { provider: counterProvider },
      });
      await (engine as any).indexBuildPromise;

      await engine.handleSearchTools({ query: 'anything' }, 'sess-p9-1');

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const fullLog = warnSpy.mock.calls[0]!.join(' ');
      expect(fullLog).toMatch(/^MCPack: query embedding failed: /);
      // WR-03 rename-safe iteration: assert NO fixture name appears in the warn log.
      for (const name of tools.map((t) => t.name)) {
        expect(fullLog).not.toContain(name);
      }
    });
  });

  // ─── Group 5: build-pending fallback (P7 carry-forward) ────────────────

  describe('build-pending fallback (P7 negative control carry-forward)', () => {
    it('P7 carry-forward: build-pending queries emit ZERO new console.warn from query path', async () => {
      const slowProvider: EmbeddingProvider = (texts) =>
        new Promise((resolve) =>
          setTimeout(() => resolve(texts.map(() => [1])), 200),
        );
      const tools = [
        makeTool('create_customer', 'Create a customer'),
        makeTool('list_payments', 'List payments'),
      ];
      engine = new MCPackEngine(tools, {
        embeddings: { provider: slowProvider },
      });
      // Spy AFTER construction so the constructor's success path (no warn anyway)
      // is not observed. We isolate the warn surface of handleSearchTools alone.
      // Build is still in flight at this point (slowProvider has 200ms delay).
      expect(engine.hasVectors()).toBe(false);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Multiple queries during build-pending state — none should warn.
      await engine.handleSearchTools({ query: 'customer' }, 'sess-pending-1');
      await engine.handleSearchTools({ query: 'payments' }, 'sess-pending-2');
      await engine.handleSearchTools({ query: 'unrelated' }, 'sess-pending-3');

      expect(engine.hasVectors()).toBe(false); // still pending
      // The negative invariant: zero new warn calls during build-pending queries.
      expect(warnSpy).toHaveBeenCalledTimes(0);
    });
  });

  // ─── Group 6: backward-compat (P10 negative control) ───────────────────

  describe('backward-compat (P10 — REQ-v11-backward-compat)', () => {
    it('P10 negative control: when embeddings is absent, no provider invoked and no new console.warn fires', async () => {
      let callCount = 0;
      const countingProvider: EmbeddingProvider = async (texts) => {
        callCount++;
        return texts.map(() => [0]);
      };
      void countingProvider; // declared but intentionally NOT passed — we're proving the negative.

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const tools = [
        makeTool('create_customer', 'Create a customer'),
        makeTool('list_payments', 'List payments'),
      ];
      engine = new MCPackEngine(tools, {}); // NO embeddings configured

      await engine.handleSearchTools({ query: 'customer' }, 'sess-p10-1');
      await engine.handleSearchTools({ query: 'payment' }, 'sess-p10-2');
      await engine.handleSearchTools({ query: 'foo' }, 'sess-p10-3');

      expect(callCount).toBe(0);
      expect(warnSpy).toHaveBeenCalledTimes(0);
      expect(engine.hasVectors()).toBe(false);
      expect(engine.isIndexReady()).toBe(false);
    });

    it('P10 negative control: no-embeddings query results match v1.0 keyword tier ordering', async () => {
      // 5 tools matching scoreAndRank's 5-tier ordering for query 'customer':
      //   EXACT_NAME (10): name === 'customer'
      //   PARTIAL_NAME (5): name includes 'customer'
      //   DESCRIPTION (3): description includes 'customer'
      //   KEYWORD (2): keywords match — Phase 1 buildIndex extracts these from name
      //   SCHEMA_PROPERTY (1): schemaKeywords match — extracted from inputSchema.properties
      const tools = [
        makeTool('customer', 'unrelated'), // EXACT_NAME=10
        makeTool('getCustomer', 'unrelated'), // PARTIAL_NAME=5
        makeTool('tool1', 'manages customer records'), // DESCRIPTION=3
        makeTool('tool2', 'unrelated', { customer_id: { type: 'string' } }), // SCHEMA_PROPERTY=1 (via schemaKeywords from inputSchema)
        makeTool('unmatched', 'has nothing relevant'), // 0 — excluded
      ];
      engine = new MCPackEngine(tools, {});
      const result = await engine.handleSearchTools(
        { query: 'customer' },
        'sess-p10-tier',
      );
      const response = parseSearchResponse(result);
      const returnedNames = response.tools.map((t) => t.name);
      // 'customer' (10) ranks first; 'getCustomer' (5) second.
      expect(returnedNames[0]).toBe('customer');
      expect(returnedNames[1]).toBe('getCustomer');
      // 'unmatched' is NEVER in results.
      expect(returnedNames).not.toContain('unmatched');
    });
  });

  // ─── Group 7: session invariants (REQ-v11-session-invariants) ──────────

  describe('session invariants — schemas-loaded references', () => {
    it('first call loads schemas (schema present); second call returns {loaded: true} (schema absent) — hybrid path', async () => {
      // Two tools give min-max normalization a range to discriminate (single-tool
      // surface degenerates to all-zero hybrid score per DEC-v11-08-02 — see
      // hybrid-scoring.test.ts minMaxNormalize single-element case).
      const tools = [
        makeTool('create_customer', 'Create a customer'),
        makeTool('unrelated_tool', 'Does something unrelated'),
      ];
      engine = new MCPackEngine(tools, {
        embeddings: { provider: mockProvider },
      });
      await (engine as any).indexBuildPromise;

      const r1 = await engine.handleSearchTools(
        { query: 'customer' },
        'sess-loaded-hybrid',
      );
      const resp1 = parseSearchResponse(r1);
      // Find the create_customer entry — top-ranked since it has both semantic + keyword signal.
      const entry1 = resp1.tools.find((t) => t.name === 'create_customer');
      expect(entry1).toBeDefined();
      expect(entry1!.loaded).toBe(false);
      expect(entry1!.schema).toBeDefined();

      const r2 = await engine.handleSearchTools(
        { query: 'customer' },
        'sess-loaded-hybrid',
      );
      const resp2 = parseSearchResponse(r2);
      const entry2 = resp2.tools.find((t) => t.name === 'create_customer');
      expect(entry2).toBeDefined();
      expect(entry2!.loaded).toBe(true);
      expect(entry2!.schema).toBeUndefined();
    });

    it('first call loads schemas; second call returns {loaded: true} — keyword fallback path (no embeddings)', async () => {
      const tools = [makeTool('create_customer', 'Create a customer')];
      engine = new MCPackEngine(tools, {});

      const r1 = await engine.handleSearchTools(
        { query: 'customer' },
        'sess-loaded-keyword',
      );
      const resp1 = parseSearchResponse(r1);
      expect(resp1.tools[0]!.loaded).toBe(false);
      expect(resp1.tools[0]!.schema).toBeDefined();

      const r2 = await engine.handleSearchTools(
        { query: 'customer' },
        'sess-loaded-keyword',
      );
      const resp2 = parseSearchResponse(r2);
      expect(resp2.tools[0]!.loaded).toBe(true);
      expect(resp2.tools[0]!.schema).toBeUndefined();
    });

    it('total_available reflects role-allowed surface count, NOT full surface', async () => {
      const tools = [
        makeTool('a', 'aa'),
        makeTool('b', 'bb'),
        makeTool('c', 'cc'),
        makeTool('d', 'dd'),
        makeTool('e', 'ee'),
      ];
      engine = new MCPackEngine(tools, {
        roles: { restricted: ['a', 'b'] },
        defaultRole: 'restricted',
      });
      const result = await engine.handleSearchTools(
        { query: 'a' },
        'sess-total-1',
      );
      const response = parseSearchResponse(result);
      // 2 of 5 tools allowed.
      expect(response.total_available).toBe(2);
      // total_available is NOT 5 (full surface).
      expect(response.total_available).not.toBe(tools.length);
    });
  });

  // ─── Group 7b: CR-01 regression — rank-then-filter must score full surface ─

  describe('CR-01 regression — keyword fallback rank-then-filter against full surface', () => {
    it('CR-01: with >10 keyword matches where top-10 are role-blocked, role-allowed lower-scored tools STILL appear', async () => {
      // Reproduces the exact CR-01 scenario from REVIEW.md:
      //   - 10 tools with HIGH keyword score, ALL role-blocked
      //   - 1 tool with LOW keyword score, role-allowed
      //
      // Pre-fix behavior (broken): scoreAndRank internally clamped at MAX_LIMIT=10
      //   regardless of caller's Infinity. allRanked was top-10 (all blocked) →
      //   filter → []. Caller saw 0 results — silent correctness regression vs v1.0.
      //
      // Post-fix behavior: scoreAndRank honors Infinity sentinel — returns full
      //   ranked surface. Role filter then keeps the 1 allowed tool. Caller
      //   sees 1 result.
      //
      // No embeddings configured → keyword fallback path (the path with the bug).

      // 10 tools with EXACT_NAME match on token "customer" (each scores 10).
      // Names are role-blocked.
      const blockedTools = Array.from({ length: 10 }, (_, i) =>
        makeTool(`customer${i}`, 'unrelated description'),
      );
      // 1 tool with a low keyword score: SCHEMA_PROPERTY=1 (schemaKeywords-only
      // match via inputSchema.properties.customer_id). Description does NOT
      // contain "customer" so it doesn't earn DESCRIPTION=3. Name is also
      // unrelated so no NAME match. Only the schemaKeyword "customer_id"
      // contains "customer" → SCHEMA_PROPERTY=1.
      const allowedLowScore = makeTool(
        'lowscore_allowed',
        'unrelated description',
        { customer_id: { type: 'string' } },
      );
      const tools = [...blockedTools, allowedLowScore];

      // Restricted role allows ONLY the low-score tool.
      const allowedNames = ['lowscore_allowed'];
      engine = new MCPackEngine(tools, {
        roles: { restricted: allowedNames },
        defaultRole: 'restricted',
      });

      const result = await engine.handleSearchTools(
        { query: 'customer' },
        'sess-cr01-1',
      );
      const response = parseSearchResponse(result);
      const returnedNames = response.tools.map((t) => t.name);

      // The CR-01 invariant: the role-allowed lower-scored tool MUST appear
      // in results despite the top-10 keyword matches all being role-blocked.
      expect(returnedNames).toContain('lowscore_allowed');

      // None of the role-blocked tools may appear (RBAC opaque-denial invariant).
      // WR-03 rename-safe iteration over actual fixture names.
      for (const blocked of blockedTools.map((t) => t.name)) {
        expect(returnedNames).not.toContain(blocked);
      }

      // total_available reflects role-allowed surface count (1, not 11).
      expect(response.total_available).toBe(1);
    });

    it('CR-01: scoreAndRank honors Infinity sentinel and returns full ranked surface beyond MAX_LIMIT=10', async () => {
      // Direct test of the search.ts contract change: passing Infinity opts out
      // of the MAX_LIMIT=10 cap. Finite limits still get clamped (v1.0 contract).
      // This is exercised end-to-end via the keyword fallback path: with 15 tools
      // all matching the query, keyword fallback (which calls scoreAndRank with
      // Infinity) must rank ALL 15 internally so role filter sees them all.
      const tools = Array.from({ length: 15 }, (_, i) =>
        makeTool(`tool_match_${i}`, 'matches the customer query'),
      );
      // No role config → all tools allowed.
      engine = new MCPackEngine(tools, {});

      // Without explicit limit arg → defaults to 5 (v1.0 default).
      const result = await engine.handleSearchTools(
        { query: 'customer' },
        'sess-cr01-2',
      );
      const response = parseSearchResponse(result);
      // 5 results returned (default limit), but total_available reflects the
      // full role-allowed surface (15) — not the keyword-match cap.
      expect(response.tools).toHaveLength(5);
      expect(response.total_available).toBe(15);
    });
  });

  // ─── Group 8: WR-02 unhandled-rejection regression ──────────────────────

  describe('WR-02 unhandled-rejection regression (carry-forward — covers BOTH Phase 7 build path AND Phase 8 query path)', () => {
    it('WR-02 fix: build path failure produces ZERO unhandled rejections', async () => {
      const handler = vi.fn();
      process.on('unhandledRejection', handler);
      try {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const rejecter: EmbeddingProvider = async () => {
          throw new Error('build always rejects');
        };
        engine = new MCPackEngine([makeTool('a', '')], {
          embeddings: { provider: rejecter },
        });
        // Phase 7's build promise rejects — handled by .catch in core.ts constructor.
        await (engine as any).indexBuildPromise;
        // hasVectors() is false because build failed → query path falls through to keyword.
        expect(engine.hasVectors()).toBe(false);
        await engine.handleSearchTools({ query: 'x' }, 'sess-wr02-build-1');
        await engine.handleSearchTools({ query: 'y' }, 'sess-wr02-build-2');
        // Drain microtasks AND macrotasks twice.
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));
        expect(handler).not.toHaveBeenCalled();
      } finally {
        process.off('unhandledRejection', handler);
      }
    });

    it('WR-02 fix: build SUCCEEDS but query embedding FAILS — no unhandled rejection from query path', async () => {
      const handler = vi.fn();
      process.on('unhandledRejection', handler);
      try {
        // Counter-based: first call (build) succeeds; subsequent calls (queries) reject.
        let callCount = 0;
        const counterProvider: EmbeddingProvider = async (texts) => {
          callCount++;
          if (callCount === 1) {
            return texts.map(() => [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
          }
          throw new Error('query rejects');
        };
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        engine = new MCPackEngine([makeTool('a', ''), makeTool('b', '')], {
          embeddings: { provider: counterProvider },
        });
        await (engine as any).indexBuildPromise;
        expect(engine.hasVectors()).toBe(true);

        await engine.handleSearchTools({ query: 'q1' }, 'sess-wr02-query-1');
        await engine.handleSearchTools({ query: 'q2' }, 'sess-wr02-query-2');
        await engine.handleSearchTools({ query: 'q3' }, 'sess-wr02-query-3');

        // Drain twice.
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));

        expect(handler).not.toHaveBeenCalled();
        // Sanity check: warn fired exactly once (Group 4's P8 invariant).
        expect(warnSpy).toHaveBeenCalledTimes(1);
      } finally {
        process.off('unhandledRejection', handler);
      }
    });
  });
});
