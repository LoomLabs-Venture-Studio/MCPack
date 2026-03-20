import type { Tool } from '@modelcontextprotocol/sdk/types.js';

// ─── Public Types ───────────────────────────────────────────────────────────

/**
 * Configuration for MCPack wrap mode.
 */
export interface MCPackConfig {
  roles?: RoleConfig;
  defaultRole?: string;
  index?: IndexConfig;
  session?: SessionConfig;
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
 * A tool definition with an attached handler function for build mode.
 */
export interface MCPackToolDefinition extends Tool {
  handler: (args: Record<string, unknown>) => Promise<ToolCallResult>;
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
