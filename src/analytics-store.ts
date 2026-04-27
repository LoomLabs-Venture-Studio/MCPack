import type {
  AnalyticsEvent,
  AnalyticsSnapshot,
  AnalyticsOptions,
  AnalyticsByRoleSummary,
  RoleConfig,
  ToolIndexEntry,
} from './types.js';
import { isToolAllowed, resolveRoleAccess } from './roles.js';

/**
 * In-memory bounded store for tool-usage analytics events.
 *
 * Captures four event types — `search`, `call`, `denial`, `miss` — at decision
 * points inside MCPackEngine (wired in Plan 09-02). Resets on process restart;
 * never persisted to disk or sent over the network (REQ-v11-analytics-storage).
 *
 * Internal to the package — NOT exported from src/index.ts (Phase 02 DEC: engine
 * internals stay internal). Phase 9 surfaces snapshots via MCPackHandle.getAnalytics,
 * which delegates to MCPackEngine.getAnalytics, which calls this.snapshot(...).
 *
 * Sibling-module pattern matches src/session.ts (SessionRegistry), src/semantic-index-builder.ts,
 * and src/hybrid-scoring.ts — pure storage + computation, no engine state, no MCP knowledge.
 *
 * @internal Phase 9 — package-internal helper consumed by core.ts.
 * @since v1.1 (Phase 9)
 */
export class AnalyticsStore {
  /** Bounded shared array of all event types (discriminated union). */
  private events: AnalyticsEvent[] = [];
  /** Maximum number of events retained. Default 10000 per CONTEXT/PRD lock. */
  private readonly maxEvents: number;

  /**
   * @param maxEvents - Bounded retention limit. Default 10000. Non-positive
   *                    inputs clamp to 1 (defensive).
   */
  constructor(maxEvents: number = 10000) {
    // Defensive: clamp non-positive maxEvents to 1 to avoid degenerate behavior
    // (zero or negative would break the pre-push check). Math.floor handles
    // accidental float input from JS callers.
    this.maxEvents = Math.max(1, Math.floor(maxEvents));
  }

  /**
   * Record an event.
   *
   * O(1) amortized; O(n) during eviction when at capacity (Array.shift).
   * Pre-push check guarantees `events.length <= maxEvents` always (Pitfall 4
   * mitigation — no transient overshoot).
   *
   * @param event - One of the four AnalyticsEvent variants.
   */
  record(event: AnalyticsEvent): void {
    if (this.events.length >= this.maxEvents) {
      this.events.shift();
    }
    this.events.push(event);
  }

  /**
   * Compute a snapshot of recorded events.
   *
   * @param rolesConfig - Engine's role config; consumed by isToolAllowed for
   *                      role-scoped filtering and resolveRoleAccess for deadTools.
   * @param index       - Engine's full tool index; consumed by resolveRoleAccess
   *                      to compute the role's visible tool surface.
   * @param options     - Optional `{ role?: string }`.
   *
   * Operator-unscoped (no `options.role`): returns ALL events; `summary.byRole`
   * is populated for every role appearing in any event PLUS every role in
   * `rolesConfig` (so an operator sees zero-counts for under-used roles).
   *
   * Role-scoped (string `options.role`): returns ONLY events whose tool is allowed
   * for that role (call/denial via isToolAllowed) OR whose author role matches
   * (search/miss via event.role === options.role). `summary.byRole` only contains
   * the requested role.
   *
   * Filter uses CURRENT rolesConfig state — historical denials for tools later
   * granted to the role are filtered out of the role-scoped query (DEC-v11-09-02
   * edge case 5; documented as the contract).
   *
   * @returns Snapshot — JSON-shaped (plain objects, no class instances, no
   *          discriminator fields on payloads).
   */
  snapshot(
    rolesConfig: RoleConfig | undefined,
    index: ToolIndexEntry[],
    options?: AnalyticsOptions,
  ): AnalyticsSnapshot {
    // WR-02 carry-forward: runtime input validation. Coerce non-string options.role
    // to undefined (operator-unscoped) rather than throwing or NaN-style failure.
    const scopeRole =
      typeof options?.role === 'string' ? options.role : undefined;

    // Build the visible-event set: full slice when unscoped, filtered when scoped.
    const filtered =
      scopeRole === undefined
        ? this.events.slice() // copy for stability against further records during snapshot
        : this.events.filter((e) =>
            this.eventVisibleTo(e, scopeRole, rolesConfig),
          );

    // Bucketize events into snapshot arrays (drops the `type` discriminator).
    const searches: AnalyticsSnapshot['searches'] = [];
    const calls: AnalyticsSnapshot['calls'] = [];
    const denials: AnalyticsSnapshot['denials'] = [];
    const misses: AnalyticsSnapshot['misses'] = [];
    for (const e of filtered) {
      if (e.type === 'search') {
        // WR-03 fix: copy tools[] so external mutation of snap.searches[i].tools
        // (push/sort/length-assign) cannot corrupt the stored event. O(k) where
        // k is search result count (≤ maxResults, typically ≤ 10) — negligible.
        searches.push({ query: e.query, role: e.role, tools: e.tools.slice(), ts: e.ts });
      } else if (e.type === 'call') {
        calls.push({ tool: e.tool, role: e.role, ts: e.ts });
      } else if (e.type === 'denial') {
        denials.push({ tool: e.tool, role: e.role, ts: e.ts });
      } else if (e.type === 'miss') {
        misses.push({ query: e.query, role: e.role, ts: e.ts });
      }
    }

    // Compute summary.byRole.
    const byRole: Record<string, AnalyticsByRoleSummary> = {};
    const rolesToSummarize =
      scopeRole !== undefined ? [scopeRole] : this.collectRoles(rolesConfig);
    for (const r of rolesToSummarize) {
      // Each role's summary uses the FULL event log so unscoped operators see
      // accurate per-role counts even when an event's role mismatches its tool's
      // visibility for some other role. (For role-scoped queries the filter has
      // already pruned events; summarizeForRole still re-applies role predicates
      // for safety — same predicate twice is idempotent.)
      byRole[r] = this.summarizeForRole(r, rolesConfig, index, this.events);
    }

    return { searches, calls, denials, misses, summary: { byRole } };
  }

  /**
   * Test-only: reset the event log.
   *
   * Public per Claude's discretion (research recommends; matches Phase 7/8
   * conventions where test fixtures need a way to reset state for sequential
   * scenarios). Production code does not call this.
   *
   * @internal For test fixtures only.
   */
  clear(): void {
    this.events = [];
  }

  // ─── Internal helpers ───────────────────────────────────────────────────

  /**
   * Two-predicate privacy filter (Pattern 4 / Pitfall 1 mitigation).
   *
   * - search/miss events: match on `event.role === role` (no tool field exists).
   * - call/denial events: match on `isToolAllowed(event.tool, role, rolesConfig)`.
   *
   * Excludes entire events for out-of-role tools — does NOT redact tool names
   * (DEC-v11-09-02). Reuses src/roles.ts isToolAllowed for the call/denial
   * predicate, which correctly handles wildcard, undefined role, unknown role,
   * inheritance with cycle protection.
   */
  private eventVisibleTo(
    event: AnalyticsEvent,
    role: string,
    rolesConfig: RoleConfig | undefined,
  ): boolean {
    if (event.type === 'search' || event.type === 'miss') {
      return event.role === role;
    }
    // call/denial — filter on tool visibility for the role
    return isToolAllowed(event.tool, role, rolesConfig);
  }

  /**
   * Compute per-role summary including topTools[5] and deadTools.
   *
   * Counts walk the full event log applying the role predicate; topTools sorts
   * tools by call-count descending and slices to 5 names; deadTools subtracts
   * the called-tool Set from the role's visible-tool list.
   *
   * Pitfall 5 mitigation: deadTools reads ONLY `call` events — search-emitted
   * tools (in `event.tools[]` of a search event) without an actual `call` event
   * REMAIN in deadTools (CONTEXT.md DEC-v11-09-03 edge case 3).
   *
   * WR-01 fix: per-axis predicate semantics (see also `eventVisibleTo` for the
   * role-scoped EVENT-array filter, which uses the same axis split):
   *   - search/miss: `event.role === role` ("authored by this role")
   *   - call:        `isToolAllowed(event.tool, role, rolesConfig)` ("involves
   *     a tool visible to this role" — DEC-v11-09-02 — a successful call by ANY
   *     role for tool T is counted in role X's callCount if X can see T)
   *   - denial:      `event.role === role` ("THIS role tried and got denied")
   *     A denial event is recorded BECAUSE the tool was NOT in the actor's
   *     allowed set, so `isToolAllowed(event.tool, role, ...)` would force
   *     denialCount to 0 for any non-wildcard role. The diagnostic operators
   *     want from `byRole[X].denialCount` is "how many times did role X try a
   *     tool and get denied" — which is `event.role === role`.
   *
   * Note this DIFFERS intentionally from the role-scoped event-array filter for
   * denials (which uses tool-visibility per DEC-v11-09-02 privacy invariant):
   * the role-scoped EVENTS exclude denials whose tools the role cannot see, but
   * the role's COUNT still includes its own denials. The two semantics serve
   * different purposes (privacy vs operator diagnostics) and are not collapsible.
   */
  private summarizeForRole(
    role: string,
    rolesConfig: RoleConfig | undefined,
    index: ToolIndexEntry[],
    events: AnalyticsEvent[],
  ): AnalyticsByRoleSummary {
    let searchCount = 0;
    let callCount = 0;
    let denialCount = 0;
    let missCount = 0;
    const callCountByTool = new Map<string, number>();

    for (const e of events) {
      if (e.type === 'search') {
        if (e.role === role) searchCount++;
      } else if (e.type === 'miss') {
        if (e.role === role) missCount++;
      } else if (e.type === 'call') {
        if (isToolAllowed(e.tool, role, rolesConfig)) {
          callCount++;
          callCountByTool.set(
            e.tool,
            (callCountByTool.get(e.tool) ?? 0) + 1,
          );
        }
      } else if (e.type === 'denial') {
        // WR-01 fix: count denials whose ACTOR was this role, not denials
        // whose tool is in this role's allowed set (the latter is always 0
        // since denials are emitted precisely when the tool is NOT allowed).
        if (e.role === role) {
          denialCount++;
        }
      }
    }

    // topTools[5]: tool names sorted by call count desc, take 5.
    const topTools = Array.from(callCountByTool.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tool]) => tool);

    // deadTools: tools-visible-to-role minus tools-with-≥1-call-event-by-role
    // (Pitfall 5 — only `call` events count, NOT search-emitted tool names).
    const visibleNames = resolveRoleAccess(role, rolesConfig, index).map(
      (entry) => entry.name,
    );
    const calledTools = new Set(callCountByTool.keys());
    const deadTools = visibleNames.filter((name) => !calledTools.has(name));

    return { searchCount, callCount, denialCount, missCount, topTools, deadTools };
  }

  /**
   * Collect all known role names for the operator-unscoped summary.
   *
   * Union of: roles appearing in any event + roles defined in rolesConfig,
   * EXCLUDING the empty string. Empty-string role is the `role ?? ''`
   * normalization convention used at every emission site (core.ts, wrap.ts,
   * build.ts) when no `defaultRole` is configured. It is NOT a real role
   * name — exposing it as a `byRole[""]` key produces non-obvious JSON
   * output (`"": {...}`) and pollutes the role list when `rolesConfig` is
   * undefined (every event has `role: ''` and the empty key is the only key).
   *
   * WR-04 fix: skip empty-string roles in summary aggregation. Operator-
   * unscoped consumers who want to inspect no-role-configured behavior can
   * still read the raw events arrays (`searches`, `calls`, `denials`,
   * `misses`) where `event.role === ''` is preserved verbatim.
   *
   * Note this only affects `summary.byRole` keys. Role-scoped queries
   * (`getAnalytics({ role: '' })`) are still honored verbatim — operator
   * intent is unambiguous in that case.
   */
  private collectRoles(rolesConfig: RoleConfig | undefined): string[] {
    const set = new Set<string>();
    for (const e of this.events) {
      if (e.role !== '') set.add(e.role);
    }
    if (rolesConfig) {
      for (const k of Object.keys(rolesConfig)) {
        if (k !== '') set.add(k);
      }
    }
    return Array.from(set);
  }
}
