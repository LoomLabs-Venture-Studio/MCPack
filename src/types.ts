import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

// ─── Public Types ───────────────────────────────────────────────────────────

/**
 * Configuration for MCPack wrap mode.
 */
export interface MCPackConfig {
  roles?: RoleConfig;
  defaultRole?: string;
  index?: IndexConfig;
  session?: SessionConfig;
  onToolCall?: (toolName: string, args: Record<string, unknown>, result: unknown, sessionId: string) => void;
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
