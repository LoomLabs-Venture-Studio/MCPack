import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { MCPackConfig, MCPackHandle } from './types.js';
import { MCPackEngine } from './core.js';
import { isToolAllowed } from './roles.js';

// ─── Types ──────────────────────────────────────────────────────────────────────

type RawHandler = (request: any, extra: any) => Promise<any>;

// ─── Entry Point ────────────────────────────────────────────────────────────────

/**
 * Wrap an existing MCP Server with MCPack's lazy tool discovery.
 *
 * Captures the server's existing tools/list and tools/call handlers,
 * replaces them with MCPack interceptors, and returns a control handle.
 *
 * Must be called BEFORE `server.connect(transport)`.
 *
 * @param server - An MCP SDK Server instance with tools capability
 * @param config - Optional MCPack configuration (roles, index, session settings)
 * @returns MCPackHandle for lifecycle management (destroy, stats)
 */
export async function mcpack(
  server: Server,
  config: MCPackConfig = {},
): Promise<MCPackHandle> {
  // 1. Capture original handlers before overwriting
  const handlers = (server as any)._requestHandlers as
    | Map<string, RawHandler>
    | undefined;
  if (!handlers) {
    throw new Error(
      'MCPack: server._requestHandlers not found. Ensure you are passing an MCP SDK Server instance.',
    );
  }

  const originalCallHandler = handlers.get('tools/call');
  const originalListHandler = handlers.get('tools/list');

  // 2. Call-and-capture tool definitions via original tools/list handler
  let tools: Tool[] = [];
  if (originalListHandler) {
    try {
      const fakeExtra = {
        signal: new AbortController().signal,
        requestId: 0,
        sendNotification: async () => {},
        sendRequest: async () => {
          throw new Error('not available');
        },
      };
      const result = await originalListHandler(
        { method: 'tools/list', params: {} },
        fakeExtra,
      );
      tools = result?.tools ?? [];
    } catch {
      // Fall back to config tools if provided (handled below)
    }
  }

  // 3. Fallback + empty warning
  if (tools.length === 0 && (config as any).tools) {
    tools = (config as any).tools;
  }
  if (tools.length === 0) {
    console.warn(
      'MCPack: no tools found on server at setup time. search_tools will return empty results.',
    );
  }

  // 4. Create engine
  const engine = new MCPackEngine(tools, config);

  // 5. Replace tools/list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return engine.handleToolsList();
  });

  // 6. Replace tools/call handler
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    // Route search_tools to engine
    if (name === 'search_tools') {
      const sessionId = (extra as any).sessionId as string | undefined;
      return engine.handleSearchTools(args, sessionId);
    }

    // Defense-in-depth: role check before proxying
    const role = config.defaultRole;
    if (!isToolAllowed(name, role, config.roles)) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    // Proxy to original handler
    if (!originalCallHandler) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    try {
      return await originalCallHandler(request, extra);
    } catch (err: any) {
      return {
        content: [
          { type: 'text', text: err.message ?? 'Tool execution failed' },
        ],
        isError: true,
      };
    }
  });

  // 7. Return MCPackHandle
  return {
    destroy: () => engine.destroy(),
    stats: () => engine.stats(),
  };
}
