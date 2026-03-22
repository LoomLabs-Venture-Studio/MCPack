import { describe, it, expect } from 'vitest';
import type { ToolIndexEntry } from '../src/types.js';
import { scoreAndRank } from '../src/search.js';

function makeEntry(overrides: Partial<ToolIndexEntry> = {}): ToolIndexEntry {
  return {
    name: overrides.name ?? 'defaultTool',
    description: overrides.description ?? 'A default tool',
    keywords: overrides.keywords ?? [],
    schemaKeywords: overrides.schemaKeywords ?? [],
    schema: overrides.schema ?? { name: overrides.name ?? 'defaultTool', inputSchema: { type: 'object' } },
  };
}

describe('scoreAndRank', () => {
  it('ranks exact name match above partial name match (SRCH-01 ranking)', () => {
    const index = [
      makeEntry({ name: 'listCustomers', description: 'List all customers' }),
      makeEntry({ name: 'createPayment', description: 'Create a payment' }),
      makeEntry({ name: 'getCustomer', description: 'Get a single customer' }),
    ];

    const results = scoreAndRank('customer', index);

    // getCustomer should not be exact (name is 'getCustomer', not 'customer')
    // but both getCustomer and listCustomers contain 'customer' in name (PARTIAL_NAME)
    // Both also have 'customer' in description (DESCRIPTION)
    // createPayment has no 'customer' match -> excluded
    expect(results.length).toBe(2);
    expect(results.map(r => r.name)).not.toContain('createPayment');
    expect(results.map(r => r.name)).toContain('getCustomer');
    expect(results.map(r => r.name)).toContain('listCustomers');
  });

  it('respects weight ordering: EXACT_NAME=10 > PARTIAL_NAME=5 > DESCRIPTION=3 > KEYWORD=2 > SCHEMA_PROPERTY=1 (SRCH-01)', () => {
    const index = [
      makeEntry({ name: 'customer', description: 'unrelated' }),                             // EXACT_NAME=10
      makeEntry({ name: 'getCustomer', description: 'unrelated' }),                           // PARTIAL_NAME=5
      makeEntry({ name: 'tool1', description: 'manages customer records' }),                  // DESCRIPTION=3
      makeEntry({ name: 'tool2', description: 'unrelated', keywords: ['customer'] }),         // KEYWORD=2
      makeEntry({ name: 'tool3', description: 'unrelated', schemaKeywords: ['customer'] }),   // SCHEMA_PROPERTY=1
    ];

    const results = scoreAndRank('customer', index);

    expect(results.length).toBe(5);
    expect(results[0].name).toBe('customer');       // 10
    expect(results[1].name).toBe('getCustomer');    // 5
    expect(results[2].name).toBe('tool1');           // 3
    expect(results[3].name).toBe('tool2');           // 2
    expect(results[4].name).toBe('tool3');           // 1
  });

  it('scores description match at DESCRIPTION=3 (SRCH-01)', () => {
    const index = [
      makeEntry({ name: 'tool1', description: 'manages customer records' }),
      makeEntry({ name: 'tool2', description: 'unrelated tool' }),
    ];

    const results = scoreAndRank('customer', index);

    expect(results.length).toBe(1);
    expect(results[0].name).toBe('tool1');
  });

  it('scores keyword match at KEYWORD=2 (SRCH-01)', () => {
    const index = [
      makeEntry({ name: 'tool1', description: 'unrelated', keywords: ['customer', 'billing'] }),
      makeEntry({ name: 'tool2', description: 'unrelated', keywords: ['payment'] }),
    ];

    const results = scoreAndRank('customer', index);

    expect(results.length).toBe(1);
    expect(results[0].name).toBe('tool1');
  });

  it('scores schema property match at SCHEMA_PROPERTY=1 (SRCH-01)', () => {
    const index = [
      makeEntry({ name: 'tool1', description: 'unrelated', schemaKeywords: ['customerid'] }),
      makeEntry({ name: 'tool2', description: 'unrelated', schemaKeywords: ['amount'] }),
    ];

    const results = scoreAndRank('customer', index);

    expect(results.length).toBe(1);
    expect(results[0].name).toBe('tool1');
  });

  it('returns at most 5 results by default (SRCH-02)', () => {
    const index = Array.from({ length: 8 }, (_, i) =>
      makeEntry({ name: `tool${i}`, description: 'customer related' })
    );

    const results = scoreAndRank('customer', index);

    expect(results.length).toBe(5);
  });

  it('respects custom limit parameter (SRCH-02)', () => {
    const index = Array.from({ length: 8 }, (_, i) =>
      makeEntry({ name: `tool${i}`, description: 'customer related' })
    );

    const results = scoreAndRank('customer', index, 3);

    expect(results.length).toBe(3);
  });

  it('caps limit at MAX_LIMIT=10 (SRCH-02)', () => {
    const index = Array.from({ length: 15 }, (_, i) =>
      makeEntry({ name: `tool${i}`, description: 'customer related' })
    );

    const results = scoreAndRank('customer', index, 20);

    expect(results.length).toBe(10);
  });

  it('returns empty array when no tools match (zero matches)', () => {
    const index = [
      makeEntry({ name: 'toolA', description: 'does something' }),
      makeEntry({ name: 'toolB', description: 'does something else' }),
    ];

    const results = scoreAndRank('zzzznotfound', index);

    expect(results).toEqual([]);
  });

  it('matches case-insensitively (case insensitive)', () => {
    const index = [
      makeEntry({ name: 'listCustomers', description: 'List all customers' }),
    ];

    const results = scoreAndRank('CUSTOMER', index);

    expect(results.length).toBe(1);
    expect(results[0].name).toBe('listCustomers');
  });

  it('accumulates scores from multiple query tokens (multi-token query)', () => {
    const index = [
      makeEntry({ name: 'listCustomers', description: 'List all customer records' }),
      makeEntry({ name: 'getPayment', description: 'Get a payment' }),
      makeEntry({ name: 'findCustomer', description: 'Find something' }),
    ];

    // 'list customers' -> tokens: ['list', 'customers']
    // listCustomers: 'list' PARTIAL_NAME=5 + 'list' DESCRIPTION=3 + 'customers' PARTIAL_NAME=5 + 'customers' DESCRIPTION=3 = 16
    // findCustomer: 'customer' in name via includes -> 'customers' does not include 'customers' directly...
    // Actually: 'findCustomer'.includes('customers') -> false, 'findCustomer'.includes('list') -> false
    // But description: 'Find something'.includes('list') -> false, 'Find something'.includes('customers') -> false
    // So findCustomer scores 0 for these tokens

    const results = scoreAndRank('list customers', index);

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toBe('listCustomers');
  });

  it('returns empty array for empty string query', () => {
    const index = [
      makeEntry({ name: 'toolA', description: 'customer stuff' }),
    ];

    const results = scoreAndRank('', index);
    expect(results).toEqual([]);
  });

  it('returns empty array for whitespace-only query', () => {
    const index = [
      makeEntry({ name: 'toolA', description: 'customer stuff' }),
    ];

    const results = scoreAndRank('   ', index);
    expect(results).toEqual([]);
  });

  it('returns empty array when searching empty index', () => {
    const results = scoreAndRank('customer', []);
    expect(results).toEqual([]);
  });

  it('does not mutate the input index array', () => {
    const index = [
      makeEntry({ name: 'toolC', description: 'customer stuff' }),
      makeEntry({ name: 'toolA', description: 'customer stuff' }),
      makeEntry({ name: 'toolB', description: 'customer stuff' }),
    ];

    const originalOrder = index.map(e => e.name);
    scoreAndRank('customer', index);

    expect(index.map(e => e.name)).toEqual(originalOrder);
  });
});
