import type { RoleConfig, ToolIndexEntry } from './types.js';

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Resolve which tools a role can access from the index.
 *
 * - No roles config (undefined or empty) -> all tools visible
 * - No role on session (undefined) -> nothing visible (secure default)
 * - Wildcard '*' -> all tools visible
 * - Otherwise -> filter index to only allowed tool names
 *
 * Supports role inheritance with cycle protection.
 */
export function resolveRoleAccess(
  role: string | undefined,
  roles: RoleConfig | undefined,
  index: ToolIndexEntry[],
): ToolIndexEntry[] {
  // No roles config = all tools visible
  if (!roles || Object.keys(roles).length === 0) return index;

  // No role on session = nothing visible (secure default)
  if (!role) return [];

  const allowed = getAllowedTools(role, roles, new Set());
  if (allowed === '*') return index;
  return index.filter((entry) => allowed.has(entry.name));
}

/**
 * Check if a specific tool is accessible to a role.
 * Used for defense-in-depth enforcement at tools/call time (Phase 2).
 */
export function isToolAllowed(
  toolName: string,
  role: string | undefined,
  roles: RoleConfig | undefined,
): boolean {
  if (!roles || Object.keys(roles).length === 0) return true;
  if (!role) return false;

  const allowed = getAllowedTools(role, roles, new Set());
  if (allowed === '*') return true;
  return allowed.has(toolName);
}

// ─── Internal ──────────────────────────────────────────────────────────────────

/**
 * Recursively resolve the set of allowed tool names for a role.
 *
 * Role definitions can reference other roles (inheritance).
 * A visited set prevents infinite cycles.
 *
 * Returns '*' sentinel if any role in the chain has wildcard access.
 */
function getAllowedTools(
  role: string,
  roles: RoleConfig,
  visited: Set<string>,
): Set<string> | '*' {
  // Cycle protection
  if (visited.has(role)) return new Set();
  visited.add(role);

  const definition = roles[role];

  // Unknown role -> no tools (secure default)
  if (!definition) return new Set();

  // Wildcard
  if (definition === '*') return '*';

  const result = new Set<string>();
  for (const item of definition) {
    if (roles[item] !== undefined) {
      // It's a role reference -> recurse
      const inherited = getAllowedTools(item, roles, visited);
      if (inherited === '*') return '*'; // Wildcard propagates
      for (const t of inherited) result.add(t);
    } else {
      // It's a tool name
      result.add(item);
    }
  }

  return result;
}
