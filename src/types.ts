import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

// ─── Public Types ───────────────────────────────────────────────────────────

/**
 * EmbeddingProvider — semantic-search hook (v1.1).
 *
 * Batch-in / parallel-array-out contract:
 *   input.length === output.length, and output[i] is the vector for input[i].
 * All vectors in a single call MUST have the same dimensionality.
 * Order is contractual: input order maps directly to output order.
 *
 * Core ships no implementation. See the sibling adapter package for a local
 * MiniLM implementation, or implement against this signature for hosted providers.
 *
 * @since v1.1
 */
export type EmbeddingProvider = (texts: string[]) => Promise<number[][]>;

/**
 * Configuration for MCPack wrap mode.
 */
export interface MCPackConfig {
  roles?: RoleConfig;
  defaultRole?: string;
  index?: IndexConfig;
  session?: SessionConfig;
  /**
   * Optional semantic-search configuration (v1.1).
   *
   * When omitted, the search code path is byte-identical to v1.0 keyword-only
   * behavior (per DEC-v11-02 / DEC-BOARD-04). When provided, Phases 7–8 use
   * `provider` to embed tools and queries; default weights (semantic 0.7,
   * keyword 0.3 — per DEC-v11-12) are applied in Phase 8.
   *
   * @since v1.1
   */
  embeddings?: {
    provider: EmbeddingProvider;
    weights?: {
      semanticWeight: number;
      keywordWeight: number;
    };
  };
}

/**
 * Configuration for MCPack build mode.
 * Extends MCPackConfig with server identity and tool definitions.
 */
export interface MCPackServerConfig extends MCPackConfig {
  name: string;
  version: string;
  tools: MCPackToolDefinition[];
}

/**
 * Context passed to every tool handler invocation.
 */
export interface MCPackHandlerContext {
  toolName: string;
  sessionId: string;
  role: string | undefined;
}

/**
 * A tool definition with an attached handler function for build mode.
 */
export interface MCPackToolDefinition extends Tool {
  handler: (args: Record<string, unknown>, ctx: MCPackHandlerContext) => Promise<unknown>;
}

/**
 * Role configuration mapping role names to allowed tool names or wildcard.
 */
export interface RoleConfig {
  [roleName: string]: string[] | '*';
}

/**
 * Index configuration.
 */
export interface IndexConfig {
  maxResults?: number;
}

/**
 * Session configuration.
 */
export interface SessionConfig {
  ttl?: number;
}

/**
 * Response shape returned by the search_tools tool.
 */
export interface SearchToolResponse {
  tools: SearchResult[];
  total_available: number;
  showing: number;
  session_id: string;
}

/**
 * A single search result entry.
 */
export interface SearchResult {
  name: string;
  loaded: boolean;
  schema?: object;
}

/**
 * Result of calling a tool handler.
 */
export interface ToolCallResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

/**
 * Control handle returned by mcpack() for lifecycle management.
 */
export interface MCPackHandle {
  destroy(): void;
  stats(): { sessions: number; tools: number };
}

/**
 * Return value from createMCPackServer() containing the server and control handle.
 */
export interface MCPackServer {
  server: Server;
  handle: MCPackHandle;
}

// ─── Internal Types ─────────────────────────────────────────────────────────

/**
 * An indexed tool entry used internally for search scoring.
 * NOT exported from the package entry point.
 */
export interface ToolIndexEntry {
  name: string;
  description: string;
  keywords: string[];
  schemaKeywords: string[];
  schema: Tool;
}

/**
 * An active session tracking loaded tools and query history.
 * NOT exported from the package entry point.
 */
export interface Session {
  id: string;
  role: string;
  loadedTools: Set<string>;
  queryLog: Array<{ query: string; results: string[]; timestamp: number }>;
  createdAt: number;
  lastActiveAt: number;
}
