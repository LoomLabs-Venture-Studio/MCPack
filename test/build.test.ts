import { describe, it, expect, afterEach, vi } from 'vitest';
import { createMCPackServer } from '../src/build.js';
import type {
  MCPackServerConfig,
  MCPackServer,
  MCPackHandlerContext,
  MCPackToolDefinition,
  ToolCallResult,
} from '../src/types.js';

// ─── Test Helpers ──────────────────────────────────────────────────────────────

function makeExtra(sessionId?: string) {
  return {
    signal: new AbortController().signal,
    requestId: 1,
    ...(sessionId !== undefined ? { sessionId } : {}),
    sendNotification: async () => {},
    sendRequest: async () => {
      throw new Error('not available');
    },
  };
}

type RawHandler = (request: any, extra: any) => Promise<any>;

function getHandler(server: any, method: string): RawHandler {
  const handler = (server as any)._requestHandlers?.get(method);
  if (!handler) throw new Error(`No handler for ${method}`);
  return handler;
}

const MOCK_TOOLS: MCPackToolDefinition[] = [
  {
    name: 'create_customer',
    description: 'Create a new customer record',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, email: { type: 'string' } },
      required: ['name', 'email'],
    },
    handler: async (args) => {
      return `created:${args.name}`;
    },
  },
  {
    name: 'list_payments',
    description: 'List all payments for a customer',
    inputSchema: {
      type: 'object',
      properties: { customerId: { type: 'string' } },
      required: ['customerId'],
    },
    handler: async (args) => {
      return { payments: [{ id: 'p1', amount: 100 }], customerId: args.customerId };
    },
  },
  {
    name: 'delete_account',
    description: 'Delete a user account permanently',
    inputSchema: {
      type: 'object',
      properties: { accountId: { type: 'string' } },
      required: ['accountId'],
    },
    handler: async () => {
      return { content: [{ type: 'text', text: 'deleted' }] } as ToolCallResult;
    },
  },
];

function makeConfig(overrides: Partial<MCPackServerConfig> = {}): MCPackServerConfig {
  return {
    name: 'test-server',
    version: '1.0.0',
    tools: MOCK_TOOLS,
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('createMCPackServer() build mode', () => {
  let result: MCPackServer | undefined;

  afterEach(() => {
    result?.handle.destroy();
    result = undefined;
  });

  it('returns MCPackServer with server and handle properties', () => {
    result = createMCPackServer(makeConfig());

    expect(result.server).toBeDefined();
    expect(result.handle).toBeDefined();
    expect(typeof result.handle.destroy).toBe('function');
    expect(typeof result.handle.stats).toBe('function');
  });

  it('tools/list returns exactly one tool named search_tools', async () => {
    result = createMCPackServer(makeConfig());

    const listHandler = getHandler(result.server, 'tools/list');
    const listResult = await listHandler(
      { method: 'tools/list', params: {} },
      makeExtra(),
    );

    expect(listResult.tools).toHaveLength(1);
    expect(listResult.tools[0].name).toBe('search_tools');
    expect(listResult.tools[0].inputSchema.properties).toHaveProperty('query');
  });

  it('tools/call with search_tools returns search results', async () => {
    result = createMCPackServer(makeConfig());

    const callHandler = getHandler(result.server, 'tools/call');
    const callResult = await callHandler(
      {
        method: 'tools/call',
        params: { name: 'search_tools', arguments: { query: 'customer' } },
      },
      makeExtra('session-1'),
    );

    expect(callResult.isError).toBeUndefined();
    expect(callResult.content).toHaveLength(1);
    const response = JSON.parse(callResult.content[0].text);
    expect(response.tools).toBeDefined();
    expect(response.total_available).toBeGreaterThan(0);
    expect(response.session_id).toBe('session-1');
  });

  it('tools/call routes to correct handler by tool name', async () => {
    result = createMCPackServer(makeConfig());

    const callHandler = getHandler(result.server, 'tools/call');
    const callResult = await callHandler(
      {
        method: 'tools/call',
        params: { name: 'create_customer', arguments: { name: 'Alice', email: 'a@b.com' } },
      },
      makeExtra('session-1'),
    );

    expect(callResult.isError).toBeUndefined();
    expect(callResult.content[0].text).toBe('created:Alice');
  });

  it('handler receives MCPackHandlerContext with toolName, sessionId, role', async () => {
    let capturedCtx: MCPackHandlerContext | undefined;
    const tools: MCPackToolDefinition[] = [
      {
        name: 'ctx_tool',
        description: 'Tool to capture context',
        inputSchema: { type: 'object', properties: {} },
        handler: async (_args, ctx) => {
          capturedCtx = ctx;
          return 'ok';
        },
      },
    ];

    result = createMCPackServer(makeConfig({ tools, defaultRole: 'admin' }));

    const callHandler = getHandler(result.server, 'tools/call');
    await callHandler(
      {
        method: 'tools/call',
        params: { name: 'ctx_tool', arguments: {} },
      },
      makeExtra('session-ctx'),
    );

    expect(capturedCtx).toBeDefined();
    expect(capturedCtx!.toolName).toBe('ctx_tool');
    expect(capturedCtx!.sessionId).toBe('session-ctx');
    expect(capturedCtx!.role).toBe('admin');
  });

  it('string return from handler becomes text content', async () => {
    result = createMCPackServer(makeConfig());

    const callHandler = getHandler(result.server, 'tools/call');
    const callResult = await callHandler(
      {
        method: 'tools/call',
        params: { name: 'create_customer', arguments: { name: 'Bob' } },
      },
      makeExtra('session-1'),
    );

    expect(callResult.content[0].type).toBe('text');
    expect(callResult.content[0].text).toBe('created:Bob');
  });

  it('object return from handler becomes JSON.stringify text content', async () => {
    result = createMCPackServer(makeConfig());

    const callHandler = getHandler(result.server, 'tools/call');
    const callResult = await callHandler(
      {
        method: 'tools/call',
        params: { name: 'list_payments', arguments: { customerId: 'c1' } },
      },
      makeExtra('session-1'),
    );

    expect(callResult.content[0].type).toBe('text');
    const parsed = JSON.parse(callResult.content[0].text);
    expect(parsed.payments).toBeDefined();
    expect(parsed.customerId).toBe('c1');
  });

  it('ToolCallResult-shaped return passes through as-is', async () => {
    result = createMCPackServer(makeConfig());

    const callHandler = getHandler(result.server, 'tools/call');
    const callResult = await callHandler(
      {
        method: 'tools/call',
        params: { name: 'delete_account', arguments: { accountId: '123' } },
      },
      makeExtra('session-1'),
    );

    expect(callResult.content[0].text).toBe('deleted');
  });

  it('null/undefined return from handler becomes empty text content', async () => {
    const tools: MCPackToolDefinition[] = [
      {
        name: 'null_tool',
        description: 'Returns null',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => null,
      },
    ];

    result = createMCPackServer(makeConfig({ tools }));

    const callHandler = getHandler(result.server, 'tools/call');
    const callResult = await callHandler(
      {
        method: 'tools/call',
        params: { name: 'null_tool', arguments: {} },
      },
      makeExtra('session-1'),
    );

    expect(callResult.content[0].text).toBe('');
  });

  it('unknown tool returns isError true with "Unknown tool: {name}"', async () => {
    result = createMCPackServer(makeConfig());

    const callHandler = getHandler(result.server, 'tools/call');
    const callResult = await callHandler(
      {
        method: 'tools/call',
        params: { name: 'nonexistent_tool', arguments: {} },
      },
      makeExtra('session-1'),
    );

    expect(callResult.isError).toBe(true);
    expect(callResult.content[0].text).toBe('Unknown tool: nonexistent_tool');
  });

  it('handler throwing returns isError true with Tool failed message', async () => {
    const tools: MCPackToolDefinition[] = [
      {
        name: 'error_tool',
        description: 'Throws error',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          throw new Error('connection refused');
        },
      },
    ];

    result = createMCPackServer(makeConfig({ tools }));

    const callHandler = getHandler(result.server, 'tools/call');
    const callResult = await callHandler(
      {
        method: 'tools/call',
        params: { name: 'error_tool', arguments: {} },
      },
      makeExtra('session-1'),
    );

    expect(callResult.isError).toBe(true);
    expect(callResult.content[0].text).toBe('Tool "error_tool" failed: connection refused');
  });

  it('duplicate tool names warn and last definition wins', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const tools: MCPackToolDefinition[] = [
      {
        name: 'dupe_tool',
        description: 'First definition',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => 'first',
      },
      {
        name: 'dupe_tool',
        description: 'Second definition',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => 'second',
      },
    ];

    result = createMCPackServer(makeConfig({ tools }));

    expect(warnSpy).toHaveBeenCalledWith(
      'MCPack: duplicate tool name "dupe_tool" in config.tools. Last definition wins.',
    );

    const callHandler = getHandler(result.server, 'tools/call');
    const callResult = await callHandler(
      {
        method: 'tools/call',
        params: { name: 'dupe_tool', arguments: {} },
      },
      makeExtra('session-1'),
    );

    expect(callResult.content[0].text).toBe('second');
    warnSpy.mockRestore();
  });

  it('empty config.tools throws Error', () => {
    expect(() => createMCPackServer(makeConfig({ tools: [] }))).toThrow(
      'MCPack: config.tools is empty',
    );
  });

  it('missing config.name throws Error', () => {
    expect(() => createMCPackServer(makeConfig({ name: '' }))).toThrow(
      'MCPack: config.name is required',
    );
  });

  it('missing config.version throws Error', () => {
    expect(() => createMCPackServer(makeConfig({ version: '' }))).toThrow(
      'MCPack: config.version is required',
    );
  });

  it('role check blocks disallowed tools', async () => {
    const config = makeConfig({
      defaultRole: 'reader',
      roles: { reader: ['list_payments'] },
    });

    result = createMCPackServer(config);

    const callHandler = getHandler(result.server, 'tools/call');
    const callResult = await callHandler(
      {
        method: 'tools/call',
        params: { name: 'delete_account', arguments: { accountId: '123' } },
      },
      makeExtra('session-1'),
    );

    expect(callResult.isError).toBe(true);
    expect(callResult.content[0].text).toBe('Unknown tool: delete_account');
  });

  it('successful tools/call marks tool as loaded in session', async () => {
    result = createMCPackServer(makeConfig());

    const callHandler = getHandler(result.server, 'tools/call');

    // First, search to create a session
    await callHandler(
      {
        method: 'tools/call',
        params: { name: 'search_tools', arguments: { query: 'customer' } },
      },
      makeExtra('session-load'),
    );

    // Then call a tool directly
    await callHandler(
      {
        method: 'tools/call',
        params: { name: 'create_customer', arguments: { name: 'Alice' } },
      },
      makeExtra('session-load'),
    );

    // Search again -- the tool should now be marked as loaded
    const searchResult = await callHandler(
      {
        method: 'tools/call',
        params: { name: 'search_tools', arguments: { query: 'customer' } },
      },
      makeExtra('session-load'),
    );

    const response = JSON.parse(searchResult.content[0].text);
    const customerTool = response.tools.find((t: any) => t.name === 'create_customer');
    expect(customerTool?.loaded).toBe(true);
  });

  it('stats() returns correct session and tool counts', async () => {
    result = createMCPackServer(makeConfig());

    expect(result.handle.stats().tools).toBe(3);
    expect(result.handle.stats().sessions).toBe(0);

    // Trigger a search to create a session
    const callHandler = getHandler(result.server, 'tools/call');
    await callHandler(
      {
        method: 'tools/call',
        params: { name: 'search_tools', arguments: { query: 'customer' } },
      },
      makeExtra('new-session'),
    );

    expect(result.handle.stats().sessions).toBe(1);
  });

  it('destroy() cleans up session registry', async () => {
    result = createMCPackServer(makeConfig());

    const callHandler = getHandler(result.server, 'tools/call');
    await callHandler(
      {
        method: 'tools/call',
        params: { name: 'search_tools', arguments: { query: 'customer' } },
      },
      makeExtra('session-cleanup'),
    );

    expect(result.handle.stats().sessions).toBe(1);
    result.handle.destroy();
    expect(result.handle.stats().sessions).toBe(0);
    result = undefined; // already destroyed
  });

  it('warns when defaultRole is not defined in roles config', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    result = createMCPackServer(makeConfig({
      defaultRole: 'nonexistent',
      roles: { admin: '*' },
    }));

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('defaultRole "nonexistent" is not defined in roles config'),
    );
    warnSpy.mockRestore();
  });

  it('session ID falls back to __stdio__ when absent from extra', async () => {
    let capturedCtx: MCPackHandlerContext | undefined;
    const tools: MCPackToolDefinition[] = [
      {
        name: 'sid_tool',
        description: 'Captures session ID',
        inputSchema: { type: 'object', properties: {} },
        handler: async (_args, ctx) => {
          capturedCtx = ctx;
          return 'ok';
        },
      },
    ];

    result = createMCPackServer(makeConfig({ tools }));

    const callHandler = getHandler(result.server, 'tools/call');
    await callHandler(
      {
        method: 'tools/call',
        params: { name: 'sid_tool', arguments: {} },
      },
      makeExtra(), // no sessionId
    );

    expect(capturedCtx!.sessionId).toBe('__stdio__');
  });
});
