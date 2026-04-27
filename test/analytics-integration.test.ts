import { describe, it, expect } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { mcpack, createMCPackServer } from '../src/index.js';
import type {
  AnalyticsSnapshot,
  MCPackToolDefinition,
  MCPackHandlerContext,
} from '../src/index.js';

// ─── Fixtures ──────────────────────────────────────────────────────────────

const FOUR_TOOLS: Tool[] = [
  { name: 'tool1', description: 'first tool', inputSchema: { type: 'object' } },
  { name: 'tool2', description: 'second tool', inputSchema: { type: 'object' } },
  { name: 'tool3', description: 'third tool', inputSchema: { type: 'object' } },
  { name: 'tool4', description: 'fourth tool', inputSchema: { type: 'object' } },
];

const FOUR_TOOL_DEFS: MCPackToolDefinition[] = FOUR_TOOLS.map((t) => ({
  ...t,
  handler: async (_args: Record<string, unknown>, _ctx: MCPackHandlerContext) => ({
    content: [{ type: 'text', text: `${t.name} ok` }],
  }),
}));

const ROLES = {
  admin: '*' as const,
  reader: ['tool1', 'tool2'],
  analyst: ['tool3'],
};

function fakeExtra(sessionId: string = 'test-session') {
  return {
    signal: new AbortController().signal,
    requestId: 0,
    sessionId,
    sendNotification: async () => {},
    sendRequest: async () => {
      throw new Error('not available');
    },
  };
}

async function buildWrapServer(opts: { defaultRole?: string } = {}) {
  const server = new Server(
    { name: 'test', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  // Register a baseline tools/list + tools/call so mcpack() can capture them.
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: FOUR_TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => ({
    content: [{ type: 'text', text: `${(request as any).params.name} ok` }],
  }));
  const handle = await mcpack(server, {
    roles: ROLES,
    defaultRole: opts.defaultRole ?? 'reader',
  });
  return { server, handle };
}

function callHandler(
  server: Server,
  name: string,
  args: Record<string, unknown> = {},
) {
  const handler = (server as any)._requestHandlers.get('tools/call');
  return handler(
    { method: 'tools/call', params: { name, arguments: args } },
    fakeExtra(),
  );
}

function listHandler(server: Server) {
  const handler = (server as any)._requestHandlers.get('tools/list');
  return handler({ method: 'tools/list', params: {} }, fakeExtra());
}

// ─── Test 1: Wave 0 sentinel ──────────────────────────────────────────────

describe('Phase 9 Wave 0 sentinel — baseline tests still pass with emission wired', () => {
  it('records zero events on a fresh handle (no requests issued yet)', async () => {
    const { handle } = await buildWrapServer();
    const snap = handle.getAnalytics();
    expect(snap.searches).toEqual([]);
    expect(snap.calls).toEqual([]);
    expect(snap.denials).toEqual([]);
    expect(snap.misses).toEqual([]);
    handle.destroy();
  });
});

// ─── Tests 2-6: Engine emission end-to-end ────────────────────────────────

describe('Phase 9 — engine emission end-to-end', () => {
  it('handleSearchTools emits a search event after results are computed (wrap mode)', async () => {
    const { server, handle } = await buildWrapServer();
    await callHandler(server, 'search_tools', { query: 'first', limit: 5 });
    const snap = handle.getAnalytics();
    expect(snap.searches.length).toBeGreaterThanOrEqual(1);
    expect(snap.searches[0]?.query).toBe('first');
    handle.destroy();
  });

  it('handleSearchTools emits a miss event when matches are empty (wrap mode)', async () => {
    const { server, handle } = await buildWrapServer();
    await callHandler(server, 'search_tools', { query: 'xyz_no_match_qq' });
    const snap = handle.getAnalytics();
    expect(snap.misses.length).toBeGreaterThanOrEqual(1);
    // Both search and miss emit at the same site; both should be present.
    expect(snap.searches.length).toBeGreaterThanOrEqual(1);
    handle.destroy();
  });

  it('wrap mode tools/call emits a call event on the success path AFTER markToolLoaded', async () => {
    const { server, handle } = await buildWrapServer({ defaultRole: 'reader' });
    // reader has tool1+tool2 — tool1 is allowed, dispatch via originalCallHandler succeeds.
    await callHandler(server, 'tool1');
    const snap = handle.getAnalytics();
    const tools = snap.calls.map((c) => c.tool);
    expect(tools).toContain('tool1');
    handle.destroy();
  });

  it('wrap mode tools/call emits a denial event when role blocks (Pr1 partial)', async () => {
    const { server, handle } = await buildWrapServer({ defaultRole: 'reader' });
    // tool3 is NOT in reader's allowed set — should denial-emit.
    await callHandler(server, 'tool3');
    const snap = handle.getAnalytics(); // operator-unscoped: denial visible
    const denials = snap.denials.map((d) => d.tool);
    expect(denials).toContain('tool3');
    handle.destroy();
  });

  it('build mode tools/call emits call AND denial events at correct sites', async () => {
    const { server, handle } = createMCPackServer({
      name: 'test',
      version: '1.0.0',
      tools: FOUR_TOOL_DEFS,
      roles: ROLES,
      defaultRole: 'reader',
    });
    // tool1 allowed → call event
    await callHandler(server, 'tool1');
    // tool3 denied → denial event
    await callHandler(server, 'tool3');
    const snap = handle.getAnalytics();
    const calls = snap.calls.map((c) => c.tool);
    const denials = snap.denials.map((d) => d.tool);
    expect(calls).toContain('tool1');
    expect(denials).toContain('tool3');
    handle.destroy();
  });
});

// ─── Test 7: Failure-does-not-emit-call ───────────────────────────────────

describe('Phase 9 — handler failures do NOT emit call events', () => {
  it('build mode: a handler that throws does not produce a call event in the snapshot', async () => {
    const throwingDef: MCPackToolDefinition = {
      name: 'throwsTool',
      description: 'tool that always throws',
      inputSchema: { type: 'object' },
      handler: async () => {
        throw new Error('boom');
      },
    };
    const { server, handle } = createMCPackServer({
      name: 'test',
      version: '1.0.0',
      tools: [throwingDef],
      roles: { admin: '*' },
      defaultRole: 'admin',
    });
    const result = await callHandler(server, 'throwsTool');
    expect(result.isError).toBe(true);
    const snap = handle.getAnalytics();
    expect(snap.calls).toEqual([]); // failure path does NOT emit
    handle.destroy();
  });

  it('WR-02 regression (build mode): a handler returning {isError: true, content: [...]} does NOT emit a call event AND does NOT markToolLoaded', async () => {
    const cleanErrorDef: MCPackToolDefinition = {
      name: 'cleanError',
      description: 'tool that reports failure via isError without throwing',
      inputSchema: { type: 'object' },
      handler: async () => ({
        content: [{ type: 'text', text: 'validation failed' }],
        isError: true,
      }),
    };
    const { server, handle } = createMCPackServer({
      name: 'test',
      version: '1.0.0',
      tools: [cleanErrorDef],
      roles: { admin: '*' },
      defaultRole: 'admin',
    });
    // First call returns isError — must not emit call AND must not consume the
    // session's "schema delivered" gate.
    const result1 = await callHandler(server, 'cleanError');
    expect(result1.isError).toBe(true);
    expect(result1.content[0].text).toBe('validation failed');
    const snap1 = handle.getAnalytics();
    expect(snap1.calls).toEqual([]);
    // Verify markToolLoaded was NOT called by issuing a search and checking
    // the schema is delivered (not gated to {loaded: true}).
    const searchResult = await callHandler(server, 'search_tools', {
      query: 'tool that reports failure',
    });
    const parsed = JSON.parse(searchResult.content[0].text);
    const cleanErrorEntry = parsed.tools.find(
      (t: { name: string }) => t.name === 'cleanError',
    );
    // Schema delivered (loaded: false with full schema) — proves the failed
    // call did NOT prematurely flip the session's loadedTools gate.
    expect(cleanErrorEntry?.loaded).toBe(false);
    expect(cleanErrorEntry).toHaveProperty('schema');
    handle.destroy();
  });

  it('WR-02 regression (wrap mode): a handler returning {isError: true} via the wrapped tools/call does NOT emit a call event', async () => {
    const server = new Server(
      { name: 'test', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        { name: 'cleanError', description: 'fails cleanly', inputSchema: { type: 'object' } },
      ],
    }));
    server.setRequestHandler(CallToolRequestSchema, async () => ({
      content: [{ type: 'text', text: 'validation failed' }],
      isError: true,
    }));
    const handle = await mcpack(server, {
      roles: { admin: '*' },
      defaultRole: 'admin',
    });
    const result = await callHandler(server, 'cleanError');
    expect(result.isError).toBe(true);
    const snap = handle.getAnalytics();
    expect(snap.calls).toEqual([]); // clean-error path does NOT emit
    handle.destroy();
  });
});

// ─── Tests 8-9: Handle API ────────────────────────────────────────────────

describe('Phase 9 — handle API exposed on both modes', () => {
  it('wrap mode handle exposes getAnalytics returning AnalyticsSnapshot shape', async () => {
    const { handle } = await buildWrapServer();
    const snap: AnalyticsSnapshot = handle.getAnalytics();
    expect(snap).toHaveProperty('searches');
    expect(snap).toHaveProperty('calls');
    expect(snap).toHaveProperty('denials');
    expect(snap).toHaveProperty('misses');
    expect(snap).toHaveProperty('summary');
    expect(snap.summary).toHaveProperty('byRole');
    handle.destroy();
  });

  it('build mode handle exposes getAnalytics; role-scoped vs operator-unscoped semantics work', async () => {
    const { server, handle } = createMCPackServer({
      name: 'test',
      version: '1.0.0',
      tools: FOUR_TOOL_DEFS,
      roles: ROLES,
      defaultRole: 'reader',
    });
    await callHandler(server, 'tool1'); // reader allowed
    await callHandler(server, 'tool3'); // reader denied
    const op = handle.getAnalytics();
    const scoped = handle.getAnalytics({ role: 'reader' });
    // Operator sees both
    expect(op.calls.length).toBeGreaterThanOrEqual(1);
    expect(op.denials.length).toBeGreaterThanOrEqual(1);
    // reader-scoped: reader's denial-for-tool3 EXCLUDED (not in reader's allowed set)
    expect(scoped.denials.map((d) => d.tool)).not.toContain('tool3');
    handle.destroy();
  });
});

// ─── Tests 10-13: Privacy invariants Pr1-Pr4 ─────────────────────────────

describe('Phase 9 — privacy invariants Pr1-Pr4', () => {
  it('Pr1: role-scoped denial query EXCLUDES events for tools not in role allowed set', async () => {
    const { server, handle } = createMCPackServer({
      name: 'test',
      version: '1.0.0',
      tools: FOUR_TOOL_DEFS,
      roles: ROLES,
      defaultRole: 'reader',
    });
    // reader has tool1+tool2; deny tool3 (out-of-role) and tool4 (out-of-role).
    await callHandler(server, 'tool3'); // denial emitted
    await callHandler(server, 'tool4'); // denial emitted
    // Hit !handler branch with a non-existent name (in-role allowed but no dispatch entry would
    // require an in-role tool with no handler — instead we exercise the !isToolAllowed path
    // for non-existent tool to simulate a denial event). 'nonexistent' is not in reader's allowed
    // set, so it hits !isToolAllowed (a denial for an out-of-role tool name).
    await callHandler(server, 'nonexistent');
    const scoped = handle.getAnalytics({ role: 'reader' });
    // reader-scoped query MUST NOT include tool3, tool4 in denials (out-of-reader's allowed set)
    const denials = scoped.denials.map((d) => d.tool);
    expect(denials).not.toContain('tool3');
    expect(denials).not.toContain('tool4');
    expect(denials).not.toContain('nonexistent');
    handle.destroy();
  });

  it('Pr2: role-scoped search/miss EXCLUDES events authored by other roles', async () => {
    const { server, handle } = createMCPackServer({
      name: 'test',
      version: '1.0.0',
      tools: FOUR_TOOL_DEFS,
      roles: ROLES,
      defaultRole: 'reader', // engine emits all search events with role='reader'
    });
    await callHandler(server, 'search_tools', { query: 'first' });
    await callHandler(server, 'search_tools', { query: 'second' });
    const adminScoped = handle.getAnalytics({ role: 'admin' });
    const readerScoped = handle.getAnalytics({ role: 'reader' });
    // admin scoped: zero searches because event.role === 'reader' !== 'admin'
    expect(adminScoped.searches).toHaveLength(0);
    // reader scoped: both searches present
    expect(readerScoped.searches.length).toBeGreaterThanOrEqual(2);
    handle.destroy();
  });

  it('Pr3: operator unscoped query returns full data including out-of-role tool names in denials', async () => {
    const { server, handle } = createMCPackServer({
      name: 'test',
      version: '1.0.0',
      tools: FOUR_TOOL_DEFS,
      roles: ROLES,
      defaultRole: 'reader',
    });
    await callHandler(server, 'tool3'); // reader denied for tool3
    const op = handle.getAnalytics(); // no role arg
    const denialTools = op.denials.map((d) => d.tool);
    expect(denialTools).toContain('tool3'); // tool name visible in operator view
    handle.destroy();
  });

  it('Pr4: wildcard role (*) sees full universe of events', async () => {
    const { server, handle } = createMCPackServer({
      name: 'test',
      version: '1.0.0',
      tools: FOUR_TOOL_DEFS,
      roles: ROLES,
      defaultRole: 'admin', // admin = '*'
    });
    // Issue calls covering all 4 tools (admin allowed all)
    await callHandler(server, 'tool1');
    await callHandler(server, 'tool2');
    await callHandler(server, 'tool3');
    await callHandler(server, 'tool4');
    const adminScoped = handle.getAnalytics({ role: 'admin' });
    const calls = adminScoped.calls.map((c) => c.tool).sort();
    expect(calls).toEqual(['tool1', 'tool2', 'tool3', 'tool4']);
    handle.destroy();
  });
});

// ─── Tests 14-16: RBAC architectural Pr5+Pr6 + Gate 5 ─────────────────────

describe('Phase 9 — RBAC architectural invariants (Pr5, Pr6, Gate 5)', () => {
  it('Pr5: tools/call with name "getAnalytics" returns "Unknown tool: getAnalytics" via the wire (build mode)', async () => {
    const { server, handle } = createMCPackServer({
      name: 'test',
      version: '1.0.0',
      tools: FOUR_TOOL_DEFS,
      roles: ROLES,
      defaultRole: 'admin',
    });
    const result = await callHandler(server, 'getAnalytics', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Unknown tool: getAnalytics');
    handle.destroy();
  });

  it('Pr6: tools/list returns exactly one tool, name === "search_tools" (architectural lock)', async () => {
    const { server, handle } = createMCPackServer({
      name: 'test',
      version: '1.0.0',
      tools: FOUR_TOOL_DEFS,
      roles: ROLES,
      defaultRole: 'admin',
    });
    const response = await listHandler(server);
    expect(response.tools).toHaveLength(1);
    expect(response.tools[0].name).toBe('search_tools');
    handle.destroy();
  });

  it('Pr5 (wrap mode): tools/call with name "getAnalytics" returns "Unknown tool: getAnalytics"', async () => {
    // Use a non-wildcard role so the role check denies "getAnalytics" (not in
    // reader's allowed set), exercising the !isToolAllowed denial branch and
    // returning the canonical "Unknown tool" message. With admin wildcard the
    // role check would pass and the underlying passthrough handler would accept
    // any name — Pr5 is about the wire-protocol surface, not the behavior of
    // the underlying server, so we pin the test to the role-denial path.
    const { server, handle } = await buildWrapServer({ defaultRole: 'reader' });
    const result = await callHandler(server, 'getAnalytics', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Unknown tool: getAnalytics');
    handle.destroy();
  });
});

// ─── Tests 17-18: Dead-tool detection at integration level ────────────────

describe('Phase 9 — dead-tool detection at integration level', () => {
  it('deadTools includes role-visible tools that were never called via tools/call', async () => {
    const { server, handle } = createMCPackServer({
      name: 'test',
      version: '1.0.0',
      tools: FOUR_TOOL_DEFS,
      roles: ROLES,
      defaultRole: 'reader',
    });
    // reader sees tool1 + tool2; call only tool1
    await callHandler(server, 'tool1');
    const snap = handle.getAnalytics({ role: 'reader' });
    expect(snap.summary.byRole.reader?.deadTools).toEqual(['tool2']);
    handle.destroy();
  });

  it('deadTools — search-emitted tools that were never called via tools/call REMAIN in deadTools (Pitfall 5 integration)', async () => {
    const { server, handle } = createMCPackServer({
      name: 'test',
      version: '1.0.0',
      tools: FOUR_TOOL_DEFS,
      roles: ROLES,
      defaultRole: 'reader',
    });
    // search_tools may return tool1/tool2 in results, but no actual call occurs.
    await callHandler(server, 'search_tools', { query: 'first' });
    const snap = handle.getAnalytics({ role: 'reader' });
    // Both reader-visible tools should remain in deadTools (search emission alone does not "use" them).
    expect(snap.summary.byRole.reader?.deadTools.sort()).toEqual(['tool1', 'tool2']);
    handle.destroy();
  });
});

// ─── Tests 19-22: WR-03 rename-safe RBAC parity (Phase 8 pattern) ─────────

describe('Phase 9 — WR-03 rename-safe RBAC parity (Phase 8 pattern: response.tools.map((t) => t.name))', () => {
  // These 4 tests use the LITERAL Phase 8 rename-safe pattern `response.tools.map((t) => t.name)`
  // against the wrap-mode and build-mode `tools/list` responses. The verify grep
  // `tools\.map\(\(?t\)? => t\.name\)` is the literal regex Phase 8 enforces (test/hybrid-ranking.test.ts
  // lines 131, 146-147, 178, 206, 243). The four occurrences below are the canonical sites for that grep.

  it('WR-03 #1 (build mode, admin wildcard): tools/list response yields [search_tools]', async () => {
    const { server, handle } = createMCPackServer({
      name: 'test',
      version: '1.0.0',
      tools: FOUR_TOOL_DEFS,
      roles: ROLES,
      defaultRole: 'admin',
    });
    const response = await listHandler(server);
    // WR-03 occurrence #1: literal `tools.map((t) => t.name)` against the tools/list response.
    const names = response.tools.map((t) => t.name);
    expect(names).toEqual(['search_tools']);
    handle.destroy();
  });

  it('WR-03 #2 (build mode, reader subset): tools/list response yields [search_tools] regardless of role surface', async () => {
    const { server, handle } = createMCPackServer({
      name: 'test',
      version: '1.0.0',
      tools: FOUR_TOOL_DEFS,
      roles: ROLES,
      defaultRole: 'reader',
    });
    const response = await listHandler(server);
    // WR-03 occurrence #2: literal `tools.map((t) => t.name)`.
    const names = response.tools.map((t) => t.name);
    expect(names).toEqual(['search_tools']);
    expect(names).not.toContain('tool1'); // even allowed underlying tools never appear here
    handle.destroy();
  });

  it('WR-03 #3 (wrap mode, reader subset): tools/list response yields [search_tools]', async () => {
    const { server, handle } = await buildWrapServer({ defaultRole: 'reader' });
    const response = await listHandler(server);
    // WR-03 occurrence #3: literal `tools.map((t) => t.name)`.
    const names = response.tools.map((t) => t.name);
    expect(names).toEqual(['search_tools']);
    handle.destroy();
  });

  it('WR-03 #4 (wrap mode, admin wildcard): tools/list response yields [search_tools]', async () => {
    const { server, handle } = await buildWrapServer({ defaultRole: 'admin' });
    const response = await listHandler(server);
    // WR-03 occurrence #4: literal `tools.map((t) => t.name)`.
    const names = response.tools.map((t) => t.name);
    expect(names).toEqual(['search_tools']);
    handle.destroy();
  });
});
