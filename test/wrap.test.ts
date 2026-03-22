import { describe, it, expect, afterEach, vi } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { mcpack } from '../src/wrap.js';
import type { MCPackHandle, MCPackConfig } from '../src/types.js';

// ─── Test Helpers ──────────────────────────────────────────────────────────────

const MOCK_TOOLS: Tool[] = [
  {
    name: 'create_customer',
    description: 'Create a new customer record',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, email: { type: 'string' } },
      required: ['name', 'email'],
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
  },
  {
    name: 'delete_account',
    description: 'Delete a user account permanently',
    inputSchema: {
      type: 'object',
      properties: { accountId: { type: 'string' } },
      required: ['accountId'],
    },
  },
];

function createMockServer(): Server {
  const server = new Server(
    { name: 'test-server', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: MOCK_TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return {
      content: [{ type: 'text', text: `original:${request.params.name}` }],
    };
  });

  return server;
}

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

function getHandler(server: Server, method: string): RawHandler {
  const handler = (server as any)._requestHandlers?.get(method);
  if (!handler) throw new Error(`No handler for ${method}`);
  return handler;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('mcpack() wrap mode', () => {
  let handle: MCPackHandle | undefined;

  afterEach(() => {
    handle?.destroy();
    handle = undefined;
  });

  it('returns MCPackHandle with destroy() and stats() methods', async () => {
    const server = createMockServer();
    handle = await mcpack(server);

    expect(typeof handle.destroy).toBe('function');
    expect(typeof handle.stats).toBe('function');
  });

  it('tools/list returns exactly one tool named search_tools', async () => {
    const server = createMockServer();
    handle = await mcpack(server);

    const listHandler = getHandler(server, 'tools/list');
    const result = await listHandler(
      { method: 'tools/list', params: {} },
      makeExtra(),
    );

    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe('search_tools');
    expect(result.tools[0].inputSchema.properties).toHaveProperty('query');
    expect(result.tools[0].inputSchema.properties).toHaveProperty('limit');
  });

  it('tools/call with search_tools invokes engine and returns SearchToolResponse JSON', async () => {
    const server = createMockServer();
    handle = await mcpack(server);

    const callHandler = getHandler(server, 'tools/call');
    const result = await callHandler(
      {
        method: 'tools/call',
        params: { name: 'search_tools', arguments: { query: 'customer' } },
      },
      makeExtra('session-1'),
    );

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    const response = JSON.parse(result.content[0].text);
    expect(response.tools).toBeDefined();
    expect(response.total_available).toBeGreaterThan(0);
    expect(response.session_id).toBe('session-1');
  });

  it('tools/call with non-search_tools forwards to original handler', async () => {
    const server = createMockServer();
    handle = await mcpack(server);

    const callHandler = getHandler(server, 'tools/call');
    const result = await callHandler(
      {
        method: 'tools/call',
        params: { name: 'create_customer', arguments: { name: 'Alice', email: 'a@b.com' } },
      },
      makeExtra('session-1'),
    );

    expect(result.content[0].text).toBe('original:create_customer');
  });

  it('role check blocks tools/call for disallowed tool', async () => {
    const server = createMockServer();
    const config: MCPackConfig = {
      defaultRole: 'reader',
      roles: { reader: ['list_payments'] },
    };
    handle = await mcpack(server, config);

    const callHandler = getHandler(server, 'tools/call');
    const result = await callHandler(
      {
        method: 'tools/call',
        params: { name: 'delete_account', arguments: { accountId: '123' } },
      },
      makeExtra('session-1'),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Unknown tool: delete_account');
  });

  it('all tools/call pass through when no roles configured', async () => {
    const server = createMockServer();
    handle = await mcpack(server); // no roles in config

    const callHandler = getHandler(server, 'tools/call');
    const result = await callHandler(
      {
        method: 'tools/call',
        params: { name: 'delete_account', arguments: { accountId: '123' } },
      },
      makeExtra('session-1'),
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe('original:delete_account');
  });

  it('throws when original tools/list returns empty array', async () => {
    const server = new Server(
      { name: 'empty-server', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: [] };
    });
    server.setRequestHandler(CallToolRequestSchema, async () => {
      return { content: [{ type: 'text', text: 'ok' }] };
    });

    await expect(mcpack(server)).rejects.toThrow('no tools found on server');
  });

  it('falls back to config.tools when original tools/list throws', async () => {
    const server = new Server(
      { name: 'broken-server', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
    // Register a tools/list handler that throws
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      throw new Error('handler broken');
    });
    server.setRequestHandler(CallToolRequestSchema, async () => {
      return { content: [{ type: 'text', text: 'ok' }] };
    });

    handle = await mcpack(server, { tools: MOCK_TOOLS } as any);

    const stats = handle.stats();
    expect(stats.tools).toBe(3);
  });

  it('stats() returns correct session and tool counts', async () => {
    const server = createMockServer();
    handle = await mcpack(server);

    const stats = handle.stats();
    expect(stats.tools).toBe(3);
    expect(stats.sessions).toBe(0);

    // Trigger a search to create a session
    const callHandler = getHandler(server, 'tools/call');
    await callHandler(
      {
        method: 'tools/call',
        params: { name: 'search_tools', arguments: { query: 'customer' } },
      },
      makeExtra('new-session'),
    );

    const updatedStats = handle.stats();
    expect(updatedStats.sessions).toBe(1);
  });

  it('destroy() cleans up session registry', async () => {
    const server = createMockServer();
    handle = await mcpack(server);

    // Create a session
    const callHandler = getHandler(server, 'tools/call');
    await callHandler(
      {
        method: 'tools/call',
        params: { name: 'search_tools', arguments: { query: 'customer' } },
      },
      makeExtra('session-cleanup'),
    );

    expect(handle.stats().sessions).toBe(1);
    handle.destroy();
    expect(handle.stats().sessions).toBe(0);
    handle = undefined; // already destroyed
  });

  it('session ID falls back to STDIO_SESSION_ID when absent from extra', async () => {
    const server = createMockServer();
    handle = await mcpack(server);

    const callHandler = getHandler(server, 'tools/call');
    // No sessionId in extra
    const result = await callHandler(
      {
        method: 'tools/call',
        params: { name: 'search_tools', arguments: { query: 'customer' } },
      },
      makeExtra(), // no sessionId
    );

    const response = JSON.parse(result.content[0].text);
    expect(response.session_id).toBe('__stdio__');
  });

  it('includes tool name in error message when original handler throws', async () => {
    const server = new Server(
      { name: 'error-server', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: MOCK_TOOLS };
    });
    server.setRequestHandler(CallToolRequestSchema, async () => {
      throw new Error('connection refused');
    });

    handle = await mcpack(server);
    const callHandler = getHandler(server, 'tools/call');
    const result = await callHandler(
      {
        method: 'tools/call',
        params: { name: 'create_customer', arguments: { name: 'Alice', email: 'a@b.com' } },
      },
      makeExtra('session-1'),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Tool "create_customer" failed');
    expect(result.content[0].text).toContain('connection refused');
  });

  it('throws when server has no _requestHandlers', async () => {
    const fakeServer = {} as any;
    await expect(mcpack(fakeServer)).rejects.toThrow(
      'server._requestHandlers not found',
    );
  });

  it('returns Unknown tool error when no original call handler exists', async () => {
    const server = new Server(
      { name: 'no-call-server', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
    // Register tools/list but NOT tools/call
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: MOCK_TOOLS };
    });

    handle = await mcpack(server);
    const callHandler = getHandler(server, 'tools/call');
    const result = await callHandler(
      {
        method: 'tools/call',
        params: { name: 'create_customer', arguments: { name: 'Alice', email: 'a@b.com' } },
      },
      makeExtra('session-1'),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Unknown tool: create_customer');
  });

  it('warns when defaultRole is not defined in roles config', async () => {
    const server = createMockServer();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    handle = await mcpack(server, {
      defaultRole: 'nonexistent',
      roles: { admin: '*' },
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('defaultRole "nonexistent" is not defined in roles config'),
    );
    warnSpy.mockRestore();
  });
});
