import { describe, it, expect } from 'vitest';
import type { ToolIndexEntry, RoleConfig } from '../src/types.js';
import { resolveRoleAccess, isToolAllowed } from '../src/roles.js';

function makeIndex(names: string[]): ToolIndexEntry[] {
  return names.map((name) => ({
    name,
    description: `${name} description`,
    keywords: [],
    schemaKeywords: [],
    schema: { name, inputSchema: { type: 'object' as const } },
  }));
}

describe('resolveRoleAccess', () => {
  it('filters tools based on role config (ROLE-01)', () => {
    const roles: RoleConfig = {
      admin: ['toolA', 'toolB'],
      viewer: ['toolA'],
    };
    const index = makeIndex(['toolA', 'toolB', 'toolC']);

    const adminResults = resolveRoleAccess('admin', roles, index);
    expect(adminResults.map((r) => r.name).sort()).toEqual(['toolA', 'toolB']);

    const viewerResults = resolveRoleAccess('viewer', roles, index);
    expect(viewerResults.map((r) => r.name)).toEqual(['toolA']);
  });

  it('returns all tools when role has wildcard (ROLE-02)', () => {
    const roles: RoleConfig = {
      admin: '*',
      viewer: ['toolA'],
    };
    const index = makeIndex(['toolA', 'toolB', 'toolC']);

    const results = resolveRoleAccess('admin', roles, index);
    expect(results.length).toBe(3);
  });

  it('returns only allowed tools with correct count (ROLE-03)', () => {
    const roles: RoleConfig = {
      viewer: ['toolA', 'toolC'],
    };
    const index = makeIndex(['toolA', 'toolB', 'toolC', 'toolD', 'toolE']);

    const results = resolveRoleAccess('viewer', roles, index);
    expect(results.length).toBe(2);
    expect(results.map((r) => r.name).sort()).toEqual(['toolA', 'toolC']);
  });

  it('returns all tools when roles is undefined (no roles config)', () => {
    const index = makeIndex(['toolA', 'toolB']);

    const results = resolveRoleAccess('anyRole', undefined, index);
    expect(results.length).toBe(2);
  });

  it('returns all tools when roles is empty object (no roles config)', () => {
    const index = makeIndex(['toolA', 'toolB']);

    const results = resolveRoleAccess('anyRole', {}, index);
    expect(results.length).toBe(2);
  });

  it('returns empty array for unknown role (unknown role)', () => {
    const roles: RoleConfig = {
      admin: ['toolA'],
    };
    const index = makeIndex(['toolA', 'toolB']);

    const results = resolveRoleAccess('hacker', roles, index);
    expect(results).toEqual([]);
  });

  it('returns empty array when role is undefined (no role on session)', () => {
    const roles: RoleConfig = {
      admin: ['toolA'],
    };
    const index = makeIndex(['toolA', 'toolB']);

    const results = resolveRoleAccess(undefined, roles, index);
    expect(results).toEqual([]);
  });

  it('resolves role inheritance (role inheritance)', () => {
    const roles: RoleConfig = {
      admin: ['writer', 'toolC'],
      writer: ['toolA', 'toolB'],
    };
    const index = makeIndex(['toolA', 'toolB', 'toolC']);

    const results = resolveRoleAccess('admin', roles, index);
    expect(results.map((r) => r.name).sort()).toEqual(['toolA', 'toolB', 'toolC']);
  });

  it('handles role inheritance cycles without infinite loop (cycle protection)', () => {
    const roles: RoleConfig = {
      a: ['b'],
      b: ['a'],
    };
    const index = makeIndex(['toolA', 'toolB']);

    // Should not hang - should return empty since neither role has actual tools
    const results = resolveRoleAccess('a', roles, index);
    expect(results).toEqual([]);
  });

  it('propagates wildcard through inheritance (wildcard inheritance)', () => {
    const roles: RoleConfig = {
      admin: ['writer'],
      writer: '*',
    };
    const index = makeIndex(['toolA', 'toolB', 'toolC']);

    const results = resolveRoleAccess('admin', roles, index);
    expect(results.length).toBe(3);
  });
});

describe('isToolAllowed', () => {
  it('checks if specific tool is accessible to a role', () => {
    const roles: RoleConfig = {
      admin: ['toolA', 'toolB'],
      viewer: ['toolA'],
    };

    expect(isToolAllowed('toolA', 'admin', roles)).toBe(true);
    expect(isToolAllowed('toolB', 'admin', roles)).toBe(true);
    expect(isToolAllowed('toolC', 'admin', roles)).toBe(false);
    expect(isToolAllowed('toolA', 'viewer', roles)).toBe(true);
    expect(isToolAllowed('toolB', 'viewer', roles)).toBe(false);
  });

  it('returns true for all tools when no roles config', () => {
    expect(isToolAllowed('anything', 'admin', undefined)).toBe(true);
    expect(isToolAllowed('anything', 'admin', {})).toBe(true);
  });

  it('returns false when role is undefined', () => {
    const roles: RoleConfig = { admin: ['toolA'] };
    expect(isToolAllowed('toolA', undefined, roles)).toBe(false);
  });

  it('returns true for wildcard role', () => {
    const roles: RoleConfig = { admin: '*' };
    expect(isToolAllowed('anyTool', 'admin', roles)).toBe(true);
  });

  it('resolves inheritance for isToolAllowed', () => {
    const roles: RoleConfig = {
      admin: ['writer', 'toolC'],
      writer: ['toolA', 'toolB'],
    };
    expect(isToolAllowed('toolA', 'admin', roles)).toBe(true);
    expect(isToolAllowed('toolC', 'admin', roles)).toBe(true);
  });
});
