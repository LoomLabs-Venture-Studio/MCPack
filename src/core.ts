import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type {
  MCPackConfig,
  ToolIndexEntry,
  ToolCallResult,
  SearchToolResponse,
  SearchResult,
} from './types.js';
import { buildIndex } from './index-builder.js';
import { scoreAndRank } from './search.js';
import { SessionRegistry, STDIO_SESSION_ID } from './session.js';
import { resolveRoleAccess } from './roles.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function errorResult(message: string): ToolCallResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

// ─── MCPackEngine ───────────────────────────────────────────────────────────

/**
 * Core engine that composes all four leaf modules (index-builder, search,
 * session, roles) into a single integration point.
 *
 * Internal to the package -- not exported from src/index.ts.
 * Used by both wrap mode (Phase 2) and build mode (Phase 3).
 */
export class MCPackEngine {
  private readonly config: MCPackConfig;
  private readonly index: ToolIndexEntry[];
  private readonly sessions: SessionRegistry;
  private readonly searchToolDefinition: Tool;

  constructor(tools: Tool[], config: MCPackConfig) {
    this.config = config;
    this.index = buildIndex(tools);
    this.sessions = new SessionRegistry(config.session);
    this.searchToolDefinition = {
      name: 'search_tools',
      description:
        'Search available tools by capability. Returns matching tool schemas ranked by relevance. Call this to discover what tools are available before attempting any operation.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Natural language description of what you want to do',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return',
          },
        },
        required: ['query'],
      },
    };
  }

  /**
   * Returns the tools/list response containing exactly one tool: search_tools.
   */
  handleToolsList(): { tools: Tool[] } {
    return { tools: [this.searchToolDefinition] };
  }

  /**
   * Handle a search_tools invocation.
   *
   * Validates args, resolves session and role, searches the index,
   * and returns results with session-gated schema delivery.
   */
  handleSearchTools(
    args: Record<string, unknown>,
    sessionId: string | undefined,
  ): ToolCallResult {
    // Validate query parameter
    if (!args.query || typeof args.query !== 'string') {
      return errorResult('search_tools requires a "query" string parameter');
    }

    // Resolve session
    const sid = sessionId ?? STDIO_SESSION_ID;
    const role = this.config.defaultRole;
    const session = this.sessions.getOrCreate(sid, role ?? '');

    // Role-filter the index
    const allowed = resolveRoleAccess(role, this.config.roles, this.index);

    // Search with limit
    const maxResults = this.config.index?.maxResults ?? 10;
    const limit = Math.min(
      typeof args.limit === 'number' ? args.limit : 5,
      maxResults,
    );
    const matches = scoreAndRank(args.query as string, allowed, limit);

    // Build response with session-gated schemas
    const results: SearchResult[] = matches.map((entry) => {
      const loaded = session.loadedTools.has(entry.name);
      if (!loaded) session.loadedTools.add(entry.name);
      return loaded
        ? { name: entry.name, loaded: true }
        : { name: entry.name, loaded: false, schema: entry.schema };
    });

    // Log query to session
    session.queryLog.push({
      query: args.query as string,
      results: results.map((r) => r.name),
      timestamp: Date.now(),
    });

    // Build and return response
    const response: SearchToolResponse = {
      tools: results,
      total_available: allowed.length,
      showing: results.length,
      session_id: session.id,
    };

    return { content: [{ type: 'text', text: JSON.stringify(response) }] };
  }

  /**
   * Stop the session registry timer and clear all sessions.
   */
  destroy(): void {
    this.sessions.destroy();
  }

  /**
   * Return current engine statistics.
   */
  stats(): { sessions: number; tools: number } {
    return { sessions: this.sessions.size, tools: this.index.length };
  }

  /**
   * Mark a tool as loaded in the given session.
   * Called by both wrap and build mode when tools/call is invoked directly.
   */
  markToolLoaded(toolName: string, sessionId: string | undefined): void {
    const sid = sessionId ?? STDIO_SESSION_ID;
    const role = this.config.defaultRole;
    const session = this.sessions.getOrCreate(sid, role ?? '');
    session.loadedTools.add(toolName);
  }
}
