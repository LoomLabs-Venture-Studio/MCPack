import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * Extract parameter names from a tool's inputSchema.properties keys.
 *
 * Returns the property names verbatim — original case, declaration order,
 * no splitting and no deduplication. The semantic embedding model owns its
 * own input pipeline; pre-splitting the names here would degrade retrieval
 * recall (per sbert.net "Don't preprocess your text" guidance).
 *
 * Mirrors the guard pattern in `src/index-builder.ts:extractSchemaKeywords`
 * (input-schema property-keys extraction) without the downstream splitting
 * step — that work belongs to the sibling adapter package's model pipeline.
 *
 * @internal Module-private; not re-exported from `src/index.ts`.
 */
export function extractParameterNames(inputSchema: Tool['inputSchema']): string[] {
  if (!inputSchema || !('properties' in inputSchema) || !inputSchema.properties) {
    return [];
  }
  return Object.keys(inputSchema.properties);
}

/**
 * Compose the per-tool indexing string used by the semantic index build.
 *
 * Format (locked by 07-CONTEXT.md decision §"Indexing String Composition" + DEC-v11-01):
 *   `tool.name + " " + (tool.description ?? "") + " " + parameter-names-joined-by-space`
 *
 * Trimmed to collapse trailing/leading spaces when description is empty or
 * the tool has no parameters. Original case preserved (no case-folding) — the
 * embedding model's input pipeline handles case as needed for its own model.
 *
 * @internal Module-private; not re-exported from `src/index.ts`.
 */
export function buildIndexingString(tool: Tool): string {
  const name = tool.name;
  const description = tool.description ?? '';
  const paramNames = extractParameterNames(tool.inputSchema);
  return `${name} ${description} ${paramNames.join(' ')}`.trim();
}
