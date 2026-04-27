export { mcpack } from './wrap.js';
export { createMCPackServer } from './build.js';

export type {
  MCPackConfig,
  MCPackServerConfig,
  MCPackToolDefinition,
  MCPackHandlerContext,
  MCPackServer,
  RoleConfig,
  IndexConfig,
  SessionConfig,
  SearchToolResponse,
  SearchResult,
  ToolCallResult,
  MCPackHandle,
  EmbeddingProvider,
  // NEW Phase 9 — additive analytics types (REQ-v11-analytics-api):
  AnalyticsEvent,
  AnalyticsByRoleSummary,
  AnalyticsSnapshot,
  AnalyticsOptions,
} from './types.js';
