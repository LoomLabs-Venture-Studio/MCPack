import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolIndexEntry } from './types.js';

/**
 * Stop words filtered out during keyword extraction.
 */
export const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'to', 'of',
  'in', 'on', 'at', 'by', 'with', 'from', 'is', 'are',
  'be', 'this', 'that', 'it', 'as', 'was', 'were', 'will',
  'can', 'has', 'have', 'had', 'do', 'does', 'did', 'not',
  'but', 'if', 'no', 'so', 'up', 'out', 'about', 'into',
  'than', 'then', 'each', 'which', 'their', 'there',
]);

/**
 * Tokenize a string by splitting on camelCase boundaries, underscores,
 * hyphens, and whitespace. Returns lowercase tokens.
 */
export function tokenize(text: string): string[] {
  return text
    .replace(/([A-Z])/g, ' $1')
    .toLowerCase()
    .split(/[_\-\s]+/)
    .filter(Boolean);
}

/**
 * Extract keywords from a tool's name and description.
 * Deduplicates via Set.
 */
function extractKeywords(name: string, description: string): string[] {
  const nameTokens = tokenize(name);

  const descTokens = description
    .toLowerCase()
    .split(/\s+/)
    .map(w => w.replace(/[^a-z0-9]/g, ''))
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));

  return [...new Set([...nameTokens, ...descTokens])];
}

/**
 * Extract schema keywords from inputSchema property names.
 * Each property name is tokenized (camelCase/underscore split).
 */
function extractSchemaKeywords(inputSchema?: Tool['inputSchema']): string[] {
  if (!inputSchema || !('properties' in inputSchema) || !inputSchema.properties) {
    return [];
  }

  const tokens: string[] = [];
  for (const propName of Object.keys(inputSchema.properties)) {
    tokens.push(...tokenize(propName));
  }

  return [...new Set(tokens)];
}

/**
 * Build a searchable index from an array of MCP Tool definitions.
 * Each tool is mapped to a ToolIndexEntry with extracted keywords
 * for name/description and schema property names.
 */
export function buildIndex(tools: Tool[]): ToolIndexEntry[] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description ?? '',
    keywords: extractKeywords(tool.name, tool.description ?? ''),
    schemaKeywords: extractSchemaKeywords(tool.inputSchema),
    schema: tool,
  }));
}
