import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type {
  MCPackServerConfig,
  MCPackServer,
  MCPackHandlerContext,
  ToolCallResult,
} from './types.js';
import { MCPackEngine } from './core.js';
import { isToolAllowed } from './roles.js';

// NOTE: Uses low-level Server class. The SDK marks Server as @deprecated
// in favor of McpServer, but MCPack requires setRequestHandler() for
// handler interception, which McpServer does not expose.

// ─── Helpers ────────────────────────────────────────────────────────────────────

function normalizeResult(value: unknown): any {
  if (value == null) {
    return { content: [{ type: 'text', text: '' }] };
  }
  if (typeof value === 'string') {
    return { content: [{ type: 'text', text: value }] };
  }
  if (
    typeof value === 'object' &&
    'content' in value &&
    Array.isArray((value as any).content)
  ) {
    return value as ToolCallResult;
  }
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

// ─── Entry Point ────────────────────────────────────────────────────────────────

/**
 * Create a new MCP Server with lazy tool discovery.
 *
 * Builds an MCP SDK Server from scratch, registers tool handlers via a
 * dispatch map, and wraps them with MCPack's search-first discovery layer.
 *
 * @param config - Server identity, tool definitions, and optional MCPack settings
 * @returns MCPackServer with `server` (connect to transport) and `handle` (lifecycle)
 */
export function createMCPackServer(config: MCPackServerConfig): MCPackServer {
  // 1. Runtime validation
  if (!config.name) {
    throw new Error('MCPack: config.name is required');
  }
  if (!config.version) {
    throw new Error('MCPack: config.version is required');
  }
  if (!config.tools || config.tools.length === 0) {
    throw new Error(
      'MCPack: config.tools is empty. Provide at least one tool definition.',
    );
  }

  // 2. Snapshot mutable config
  const roles = config.roles ? { ...config.roles } : undefined;
  const defaultRole = config.defaultRole;

  // 3. defaultRole validation
  if (defaultRole && roles && !roles[defaultRole]) {
    console.warn(
      `MCPack: defaultRole "${defaultRole}" is not defined in roles config. Sessions will see no tools.`,
    );
  }

  // 4. Build dispatch map
  const dispatch = new Map<
    string,
    (
      args: Record<string, unknown>,
      ctx: MCPackHandlerContext,
    ) => Promise<unknown>
  >();
  for (const tool of config.tools) {
    if (dispatch.has(tool.name)) {
      console.warn(
        `MCPack: duplicate tool name "${tool.name}" in config.tools. Last definition wins.`,
      );
    }
    dispatch.set(tool.name, tool.handler);
  }

  // 5. Strip handlers and create engine
  const tools: Tool[] = config.tools.map(({ handler, ...tool }) => tool);
  const engine = new MCPackEngine(tools, config);

  // 6. Create Server
  const server = new Server(
    { name: config.name, version: config.version },
    { capabilities: { tools: {} } },
  );

  // 7. Set tools/list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return engine.handleToolsList();
  });

  // 8. Set tools/call handler
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const name = request.params.name;
    const args = (request.params.arguments == null
      ? {}
      : request.params.arguments) as Record<string, unknown>;

    // Route search_tools to engine
    if (name === 'search_tools') {
      const sessionId = (extra as any).sessionId as string | undefined;
      return engine.handleSearchTools(args, sessionId);
    }

    // Role check
    if (!isToolAllowed(name, defaultRole, roles)) {
      // Phase 9: emit denial event BEFORE the opaque "Unknown tool" return
      // (REQ-v11-analytics-events — capture denials at the rejection branch).
      engine.analytics.record({
        type: 'denial',
        tool: name,
        role: defaultRole ?? '',
        ts: Date.now(),
      });
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    // Dispatch to handler
    const handler = dispatch.get(name);
    if (!handler) {
      // Phase 9: emit denial event here too — user-facing message is identical
      // "Unknown tool" (this branch is reached when build mode has no dispatch
      // entry for the named tool — semantically equivalent to a denial).
      engine.analytics.record({
        type: 'denial',
        tool: name,
        role: defaultRole ?? '',
        ts: Date.now(),
      });
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    try {
      const sessionId = (extra as any).sessionId as string | undefined;
      const sid = sessionId ?? '__stdio__';
      const ctx: MCPackHandlerContext = {
        toolName: name,
        sessionId: sid,
        role: defaultRole,
      };
      const result = await handler(args, ctx);
      engine.markToolLoaded(name, sessionId);
      // Phase 9: emit call event AFTER markToolLoaded, BEFORE return
      // (success path only — failures in the catch branch DO NOT emit per CONTEXT.md).
      engine.analytics.record({
        type: 'call',
        tool: name,
        role: defaultRole ?? '',
        ts: Date.now(),
      });
      return normalizeResult(result);
    } catch (err: any) {
      return {
        content: [
          {
            type: 'text',
            text: `Tool "${name}" failed: ${err.message ?? 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  });

  // 9. Return MCPackServer
  return {
    server,
    handle: {
      destroy: () => engine.destroy(),
      stats: () => engine.stats(),
      // Phase 9: operator-only analytics surface — REQ-v11-analytics-api.
      // Architectural boundary: never wire-protocol exposed, never appears in
      // tools/list. The closure here delegates to engine.getAnalytics(options)
      // which composes config.roles + index + analytics.snapshot() — see core.ts.
      getAnalytics: (options) => engine.getAnalytics(options),
    },
  };
}
