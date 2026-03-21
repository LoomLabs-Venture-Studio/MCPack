import { describe, it, expect, afterEach } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { MCPackEngine } from '../src/core.js';
import type { SearchToolResponse, ToolCallResult, MCPackConfig } from '../src/types.js';

function makeTool(
  name: string,
  description: string,
  properties?: Record<string, object>,
): Tool {
  return {
    name,
    description,
    inputSchema: {
      type: 'object' as const,
      properties: properties ?? { id: { type: 'string' } },
    },
  };
}

const testTools: Tool[] = [
  makeTool('create_customer', 'Create a new customer record', { name: { type: 'string' }, email: { type: 'string' } }),
  makeTool('list_payments', 'List all payment transactions', { customer_id: { type: 'string' }, limit: { type: 'number' } }),
  makeTool('refund_charge', 'Refund a specific charge', { charge_id: { type: 'string' }, amount: { type: 'number' } }),
  makeTool('get_balance', 'Get account balance information', { account_id: { type: 'string' } }),
  makeTool('create_subscription', 'Create a recurring subscription for a customer', { customer_id: { type: 'string' }, plan_id: { type: 'string' } }),
];

function parseResponse(result: ToolCallResult): SearchToolResponse {
  return JSON.parse(result.content[0].text) as SearchToolResponse;
}

describe('MCPackEngine', () => {
  let engine: MCPackEngine;

  afterEach(() => {
    engine?.destroy();
  });

  it('constructor builds index from Tool[] and creates SessionRegistry', () => {
    engine = new MCPackEngine(testTools, {});
    const stats = engine.stats();
    expect(stats.tools).toBe(5);
    expect(stats.sessions).toBe(0);
  });

  it('handleToolsList() returns exactly one tool named "search_tools"', () => {
    engine = new MCPackEngine(testTools, {});
    const result = engine.handleToolsList();
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe('search_tools');
    expect(result.tools[0].inputSchema).toBeDefined();
    const schema = result.tools[0].inputSchema;
    expect(schema.properties).toHaveProperty('query');
    expect(schema.properties).toHaveProperty('limit');
    expect(schema.required).toEqual(['query']);
  });

  it('handleSearchTools() with valid query returns SearchToolResponse with ranked results', () => {
    engine = new MCPackEngine(testTools, {});
    const result = engine.handleSearchTools({ query: 'customer' }, undefined);
    expect(result.isError).toBeUndefined();
    const response = parseResponse(result);
    expect(response.tools.length).toBeGreaterThan(0);
    expect(response.total_available).toBe(5);
    expect(response.showing).toBeGreaterThan(0);
    expect(response.session_id).toBeDefined();
    // Should match tools with 'customer' in name/description
    const names = response.tools.map(t => t.name);
    expect(names).toContain('create_customer');
  });

  it('marks new tools as loaded:false with schema, then loaded:true with no schema on second call', () => {
    engine = new MCPackEngine(testTools, {});
    const sessionId = 'test-session-1';

    // First call - tools should be loaded:false with schema
    const first = parseResponse(engine.handleSearchTools({ query: 'customer' }, sessionId));
    const customerResult = first.tools.find(t => t.name === 'create_customer');
    expect(customerResult).toBeDefined();
    expect(customerResult!.loaded).toBe(false);
    expect(customerResult!.schema).toBeDefined();

    // Second call - same tools should be loaded:true without schema
    const second = parseResponse(engine.handleSearchTools({ query: 'customer' }, sessionId));
    const customerAgain = second.tools.find(t => t.name === 'create_customer');
    expect(customerAgain).toBeDefined();
    expect(customerAgain!.loaded).toBe(true);
    expect(customerAgain!.schema).toBeUndefined();
  });

  it('handleSearchTools() with missing query returns error result', () => {
    engine = new MCPackEngine(testTools, {});
    const result = engine.handleSearchTools({}, undefined);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('search_tools requires a "query" string parameter');
  });

  it('handleSearchTools() with non-string query returns error result', () => {
    engine = new MCPackEngine(testTools, {});
    const result = engine.handleSearchTools({ query: 123 }, undefined);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('search_tools requires a "query" string parameter');
  });

  it('handleSearchTools() with limit param caps at config.index.maxResults', () => {
    engine = new MCPackEngine(testTools, { index: { maxResults: 2 } });
    const result = parseResponse(engine.handleSearchTools({ query: 'customer', limit: 10 }, undefined));
    expect(result.showing).toBeLessThanOrEqual(2);
  });

  it('handleSearchTools() with roles configured filters results to allowed tools only', () => {
    const config: MCPackConfig = {
      roles: {
        viewer: ['get_balance', 'list_payments'],
      },
      defaultRole: 'viewer',
    };
    engine = new MCPackEngine(testTools, config);
    const result = parseResponse(engine.handleSearchTools({ query: 'customer payment balance', limit: 10 }, undefined));
    const names = result.tools.map(t => t.name);
    // Only allowed tools should appear
    expect(names.every(n => ['get_balance', 'list_payments'].includes(n))).toBe(true);
    expect(result.total_available).toBe(2);
  });

  it('handleSearchTools() with no roles config returns all matching tools', () => {
    engine = new MCPackEngine(testTools, {});
    const result = parseResponse(engine.handleSearchTools({ query: 'customer payment balance', limit: 10 }, undefined));
    expect(result.total_available).toBe(5);
  });

  it('destroy() calls session registry destroy', () => {
    engine = new MCPackEngine(testTools, {});
    // Create a session
    engine.handleSearchTools({ query: 'customer' }, 'session-1');
    expect(engine.stats().sessions).toBe(1);
    engine.destroy();
    expect(engine.stats().sessions).toBe(0);
  });

  it('stats() returns { sessions: number, tools: number }', () => {
    engine = new MCPackEngine(testTools, {});
    const stats = engine.stats();
    expect(stats).toEqual({ sessions: 0, tools: 5 });
    // Create sessions
    engine.handleSearchTools({ query: 'customer' }, 'session-a');
    engine.handleSearchTools({ query: 'payment' }, 'session-b');
    expect(engine.stats().sessions).toBe(2);
    expect(engine.stats().tools).toBe(5);
  });

  it('uses STDIO_SESSION_ID when sessionId is undefined', () => {
    engine = new MCPackEngine(testTools, {});
    const result = parseResponse(engine.handleSearchTools({ query: 'customer' }, undefined));
    expect(result.session_id).toBe('__stdio__');
  });
});
