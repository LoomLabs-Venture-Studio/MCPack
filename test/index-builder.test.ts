import { describe, it, expect } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { buildIndex } from '../src/index-builder.js';

function makeTool(overrides: Partial<Tool> & { name: string }): Tool {
  return {
    inputSchema: { type: 'object' as const },
    ...overrides,
  };
}

describe('buildIndex', () => {
  it('returns ToolIndexEntry with correct name, description, and keywords from camelCase name', () => {
    const tools = [makeTool({ name: 'listCustomers', description: 'Lists all customers' })];
    const index = buildIndex(tools);

    expect(index).toHaveLength(1);
    expect(index[0].name).toBe('listCustomers');
    expect(index[0].description).toBe('Lists all customers');
    expect(index[0].keywords).toContain('list');
    expect(index[0].keywords).toContain('customers');
  });

  it('extracts keywords from underscore_separated names', () => {
    const tools = [makeTool({ name: 'list_customers', description: 'Get customers' })];
    const index = buildIndex(tools);

    expect(index[0].keywords).toContain('list');
    expect(index[0].keywords).toContain('customers');
  });

  it('extracts keywords from description, filtering stop words and short words', () => {
    const tools = [makeTool({ name: 'search', description: 'Find the relevant documents in a database' })];
    const index = buildIndex(tools);

    expect(index[0].keywords).toContain('relevant');
    expect(index[0].keywords).toContain('documents');
    expect(index[0].keywords).toContain('database');
    expect(index[0].keywords).toContain('find');
    // Stop words and short words should be filtered
    expect(index[0].keywords).not.toContain('the');
    expect(index[0].keywords).not.toContain('in');
    expect(index[0].keywords).not.toContain('a');
  });

  it('extracts schemaKeywords from inputSchema.properties names with camelCase splitting', () => {
    const tools = [makeTool({
      name: 'createUser',
      description: 'Creates a user',
      inputSchema: {
        type: 'object' as const,
        properties: {
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          email_address: { type: 'string' },
        },
      },
    })];
    const index = buildIndex(tools);

    expect(index[0].schemaKeywords).toContain('first');
    expect(index[0].schemaKeywords).toContain('name');
    expect(index[0].schemaKeywords).toContain('last');
    expect(index[0].schemaKeywords).toContain('email');
    expect(index[0].schemaKeywords).toContain('address');
  });

  it('returns empty array for empty tool array', () => {
    const index = buildIndex([]);
    expect(index).toEqual([]);
  });

  it('deduplicates keywords when same word appears in name and description', () => {
    const tools = [makeTool({ name: 'searchFiles', description: 'Search through files' })];
    const index = buildIndex(tools);

    const searchCount = index[0].keywords.filter(k => k === 'search').length;
    expect(searchCount).toBe(1);

    const filesCount = index[0].keywords.filter(k => k === 'files').length;
    expect(filesCount).toBe(1);
  });

  it('preserves the full Tool definition in the schema field', () => {
    const tool = makeTool({
      name: 'getTool',
      description: 'Gets a tool',
      inputSchema: {
        type: 'object' as const,
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    });
    const index = buildIndex([tool]);

    expect(index[0].schema).toBe(tool);
  });
});
