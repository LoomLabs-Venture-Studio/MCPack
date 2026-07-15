import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { MCPackConfig, MCPackHandle } from './types.js';
import { MCPackEngine } from './core.js';
import { isToolAllowed } from './roles.js';

// NOTE: Uses low-level Server class. The SDK marks Server as @deprecated
// in favor of McpServer, but MCPack requires setRequestHandler() for
// handler interception, which McpServer does not expose.

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

  // 3. Fallback to config.tools if original handler returned nothing
  if (tools.length === 0 && (config as any).tools) {
    tools = (config as any).tools;
  }
  // Throw if still empty -- MCPack requires tools
  if (tools.length === 0) {
    throw new Error('MCPack: no tools found on server. Ensure tools are registered before calling mcpack()');
  }

  // 4. Create engine
  const engine = new MCPackEngine(tools, config);

  // Snapshot mutable config at setup
  const roles = config.roles ? { ...config.roles } : undefined;
  const defaultRole = config.defaultRole;

  if (defaultRole && roles && !roles[defaultRole]) {
    console.warn(`MCPack: defaultRole "${defaultRole}" is not defined in roles config. Sessions will see no tools.`);
  }

  // 5. Replace tools/list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return engine.handleToolsList();
  });

  // 6. Replace tools/call handler
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const name = request.params.name;
    const args = (request.params.arguments == null ? {} : request.params.arguments) as Record<string, unknown>;

    // Route search_tools to engine
    if (name === 'search_tools') {
      const sessionId = (extra as any).sessionId as string | undefined;
      return engine.handleSearchTools(args, sessionId);
    }

    // Defense-in-depth: role check before proxying
    if (!isToolAllowed(name, defaultRole, roles)) {
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
      const result = await originalCallHandler(request, extra);
      const sessionId = (extra as any).sessionId as string | undefined;
      engine.markToolLoaded(name, sessionId);

      if (config.onToolCall){
        try {
          config.onToolCall(name, args, result, sessionId ?? '__stdio__');
        } catch {}
      }
      return result;
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Tool "${name}" failed: ${err.message ?? 'Unknown error'}` }],
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
