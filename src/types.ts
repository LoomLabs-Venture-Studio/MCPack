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
  /**
   * Operator-only analytics snapshot (Phase 9 — REQ-v11-analytics-api).
   *
   * Architectural boundary (REQ-v11-analytics-rbac-integrity): this method is
   * callable only from host-process Node.js code that holds a reference to the
   * handle. There is no MCP wire surface exposing analytics — `getAnalytics`
   * is never wire-protocol exposed, never appears in `tools/list`, never
   * reachable via JSON-RPC. An agent calling `tools/call` with name
   * `getAnalytics` receives the standard `"Unknown tool: getAnalytics"` error.
   *
   * - No `options` (or `options.role` undefined): operator-unscoped — full event
   *   data including tool names from all roles' denials. Use this for diagnostic
   *   sweeps ("which tools is role X being denied?").
   * - `options.role` provided: role-scoped — events EXCLUDED if they involve a
   *   tool outside that role's allowed set (no string redaction; entire events
   *   are dropped per DEC-v11-09-02). Filter uses CURRENT role-config state,
   *   not historical: a denial recorded BEFORE the role gained tool Y will
   *   still be filtered out if Y is currently in the role's allowed set
   *   (DEC-v11-09-02 edge case 5).
   *
   * @since v1.1 (Phase 9)
   */
  getAnalytics?(options?: AnalyticsOptions): AnalyticsSnapshot;
}

/**
 * Return value from createMCPackServer() containing the server and control handle.
 */
export interface MCPackServer {
  server: Server;
  handle: MCPackHandle;
}

// ─── Public Analytics Types (Phase 9 — additive) ──────────────────────────

/**
 * A single captured analytics event. Discriminated union by `type`.
 * Stored in-memory only; resets on process restart (REQ-v11-analytics-storage).
 *
 * - `search`: a `search_tools` invocation (carries query, role, returned tool names, ts).
 * - `call`: a successful `tools/call` for a non-search tool (carries tool, role, ts).
 * - `denial`: a `tools/call` rejected by RBAC or missing handler — opaque "Unknown tool"
 *   was returned to the caller (carries tool, role, ts).
 * - `miss`: a `search_tools` call whose ranked-and-filtered results were empty
 *   (carries query, role, ts). Coexists with a `search` event for the same call.
 *
 * `role` is always a string — empty string `''` represents "undefined role"
 * to match the SessionRegistry convention at src/core.ts (`role ?? ''` on line 178).
 *
 * @since v1.1 (Phase 9)
 */
export type AnalyticsEvent =
  | { type: 'search'; query: string; role: string; tools: string[]; ts: number }
  | { type: 'call';   tool: string;  role: string; ts: number }
  | { type: 'denial'; tool: string;  role: string; ts: number }
  | { type: 'miss';   query: string; role: string; ts: number };

/**
 * Per-role aggregated summary for a snapshot.
 *
 * - `searchCount`/`callCount`/`denialCount`/`missCount` — number of role-scoped
 *   events of each type (after the privacy filter has been applied).
 * - `topTools` — top-5 tools by call count for this role, name strings only,
 *   descending; empty when zero call events for the role.
 * - `deadTools` — tools the role can SEE but has NEVER called (process-lifetime
 *   aggregate per DEC-v11-09-03). Computed as
 *   `resolveRoleAccess(role, rolesConfig, index).map(e => e.name) ∖ tools-with-≥1-call-event-by-role`.
 *   Search-emitted tools without a `call` event REMAIN in deadTools (Pitfall 5).
 *
 * @since v1.1 (Phase 9)
 */
export interface AnalyticsByRoleSummary {
  searchCount: number;
  callCount: number;
  denialCount: number;
  missCount: number;
  topTools: string[];   // up to 5 tool names, ordered by call count descending
  deadTools: string[];  // tools-visible-to-role minus tools-with-≥1-call-by-role
}

/**
 * Snapshot returned by `MCPackHandle.getAnalytics(options?)`.
 *
 * Operator-unscoped (`options?.role === undefined`): full event data; every
 * recorded event appears in its respective array; `summary.byRole` is computed
 * for every role appearing in any event PLUS every role in `rolesConfig`.
 *
 * Role-scoped (`options.role: string`): only events involving tools that role
 * can see (call/denial via `isToolAllowed`) OR events authored by that role
 * (search/miss via `event.role === options.role`). Out-of-role events are
 * EXCLUDED — entire event dropped, no string redaction (DEC-v11-09-02).
 *
 * @since v1.1 (Phase 9)
 */
export interface AnalyticsSnapshot {
  searches: Array<{ query: string; role: string; tools: string[]; ts: number }>;
  calls:    Array<{ tool: string;  role: string; ts: number }>;
  denials:  Array<{ tool: string;  role: string; ts: number }>;
  misses:   Array<{ query: string; role: string; ts: number }>;
  summary: {
    byRole: Record<string, AnalyticsByRoleSummary>;
  };
}

/**
 * Options accepted by `MCPackHandle.getAnalytics()`.
 *
 * - `role`: when provided, scopes the snapshot to that role's view. Non-string
 *   inputs are coerced to undefined (operator-unscoped) at runtime — no silent
 *   NaN-style failures (WR-02 carry-forward).
 *
 * @since v1.1 (Phase 9)
 */
export interface AnalyticsOptions {
  role?: string;
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
