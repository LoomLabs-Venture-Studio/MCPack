import { describe, it, expect } from 'vitest';
import { AnalyticsStore } from '../src/analytics-store.js';
import type {
  AnalyticsEvent,
  RoleConfig,
  ToolIndexEntry,
} from '../src/types.js';

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makeIndexEntry(name: string, description = 'a tool'): ToolIndexEntry {
  return {
    name,
    description,
    keywords: [],
    schemaKeywords: [],
    schema: { name, inputSchema: { type: 'object' } } as ToolIndexEntry['schema'],
  };
}

const FOUR_TOOL_INDEX: ToolIndexEntry[] = [
  makeIndexEntry('tool1'),
  makeIndexEntry('tool2'),
  makeIndexEntry('tool3'),
  makeIndexEntry('tool4'),
];

// admin sees all four (wildcard); reader sees tool1+tool2; analyst sees tool3.
const ROLES_CONFIG: RoleConfig = {
  admin: '*',
  reader: ['tool1', 'tool2'],
  analyst: ['tool3'],
};

function searchEvent(role: string, tools: string[] = [], query = 'q'): AnalyticsEvent {
  return { type: 'search', query, role, tools, ts: Date.now() };
}
function callEvent(tool: string, role: string): AnalyticsEvent {
  return { type: 'call', tool, role, ts: Date.now() };
}
function denialEvent(tool: string, role: string): AnalyticsEvent {
  return { type: 'denial', tool, role, ts: Date.now() };
}
function missEvent(role: string, query = 'q'): AnalyticsEvent {
  return { type: 'miss', query, role, ts: Date.now() };
}

// ─── Constructor + maxEvents bounds (3 tests) ──────────────────────────────

describe('AnalyticsStore — constructor', () => {
  it('defaults maxEvents to 10000 when no argument provided', () => {
    const store = new AnalyticsStore();
    // Indirect: record 10000 events then a 10001st; the first event evicts.
    for (let i = 0; i < 10000; i++) {
      store.record(callEvent(`t${i}`, 'admin'));
    }
    store.record(callEvent('overflow', 'admin'));
    const snap = store.snapshot(ROLES_CONFIG, FOUR_TOOL_INDEX);
    expect(snap.calls.length).toBe(10000); // capacity unchanged
    expect(snap.calls[0]?.tool).toBe('t1'); // index 0 was evicted
    expect(snap.calls[snap.calls.length - 1]?.tool).toBe('overflow');
  });

  it('accepts custom maxEvents and respects it as the bound', () => {
    const store = new AnalyticsStore(3);
    store.record(callEvent('a', 'admin'));
    store.record(callEvent('b', 'admin'));
    store.record(callEvent('c', 'admin'));
    store.record(callEvent('d', 'admin')); // evicts 'a'
    const snap = store.snapshot(undefined, FOUR_TOOL_INDEX);
    expect(snap.calls.map((c) => c.tool)).toEqual(['b', 'c', 'd']);
  });

  it('clamps non-positive maxEvents to 1 (defensive)', () => {
    const store = new AnalyticsStore(0);
    store.record(callEvent('a', 'admin'));
    store.record(callEvent('b', 'admin')); // evicts 'a'
    const snap = store.snapshot(undefined, FOUR_TOOL_INDEX);
    expect(snap.calls).toHaveLength(1);
    expect(snap.calls[0]?.tool).toBe('b');
  });
});

// ─── record() FIFO + eviction (3 tests) ────────────────────────────────────

describe('AnalyticsStore — record', () => {
  it('appends events in insertion order across all four event types', () => {
    const store = new AnalyticsStore();
    store.record(searchEvent('admin', ['tool1']));
    store.record(callEvent('tool1', 'admin'));
    store.record(denialEvent('tool2', 'reader'));
    store.record(missEvent('admin'));
    const snap = store.snapshot(ROLES_CONFIG, FOUR_TOOL_INDEX);
    expect(snap.searches).toHaveLength(1);
    expect(snap.calls).toHaveLength(1);
    expect(snap.denials).toHaveLength(1);
    expect(snap.misses).toHaveLength(1);
  });

  it('evicts oldest event FIFO at capacity (Pitfall 4 mitigation)', () => {
    const store = new AnalyticsStore(2);
    store.record(callEvent('first', 'admin'));
    store.record(callEvent('second', 'admin'));
    store.record(callEvent('third', 'admin')); // evicts 'first'
    const snap = store.snapshot(undefined, FOUR_TOOL_INDEX);
    expect(snap.calls.map((c) => c.tool)).toEqual(['second', 'third']);
  });

  it('events.length never exceeds maxEvents even momentarily (pre-push check)', () => {
    const store = new AnalyticsStore(5);
    for (let i = 0; i < 100; i++) {
      store.record(callEvent(`t${i}`, 'admin'));
      const snap = store.snapshot(undefined, FOUR_TOOL_INDEX);
      // Every iteration: total events <= 5
      expect(
        snap.calls.length + snap.searches.length + snap.denials.length + snap.misses.length,
      ).toBeLessThanOrEqual(5);
    }
  });
});

// ─── snapshot operator-unscoped (3 tests) ──────────────────────────────────

describe('AnalyticsStore — snapshot operator-unscoped', () => {
  it('returns empty arrays + empty byRole on a fresh store with no rolesConfig', () => {
    const store = new AnalyticsStore();
    const snap = store.snapshot(undefined, FOUR_TOOL_INDEX);
    expect(snap.searches).toEqual([]);
    expect(snap.calls).toEqual([]);
    expect(snap.denials).toEqual([]);
    expect(snap.misses).toEqual([]);
    expect(snap.summary.byRole).toEqual({});
  });

  it('returns full event data with tool names visible in denials (Pr3 unit-level)', () => {
    const store = new AnalyticsStore();
    store.record(denialEvent('tool3', 'reader')); // reader cannot see tool3
    store.record(denialEvent('tool4', 'analyst'));
    const snap = store.snapshot(ROLES_CONFIG, FOUR_TOOL_INDEX);
    expect(snap.denials.map((d) => d.tool)).toEqual(['tool3', 'tool4']);
    expect(snap.denials.map((d) => d.role)).toEqual(['reader', 'analyst']);
  });

  it('drops the type discriminator from snapshot payloads', () => {
    const store = new AnalyticsStore();
    store.record(searchEvent('admin', ['tool1']));
    const snap = store.snapshot(undefined, FOUR_TOOL_INDEX);
    expect(snap.searches[0]).not.toHaveProperty('type');
    expect(snap.searches[0]).toMatchObject({ query: 'q', role: 'admin', tools: ['tool1'] });
  });
});

// ─── role-scoped filtering — Pr1/Pr2/Pr4 unit-level (3 tests) ──────────────

describe('AnalyticsStore — role-scoped filtering', () => {
  it('Pr1: role-scoped denials EXCLUDE tools not in role.allowed (full event dropped, no redaction)', () => {
    const store = new AnalyticsStore();
    // 4 denials across 2 roles; reader can see only tool1+tool2
    store.record(denialEvent('tool1', 'reader'));
    store.record(denialEvent('tool2', 'reader'));
    store.record(denialEvent('tool3', 'reader')); // out-of-role for reader
    store.record(denialEvent('tool4', 'reader')); // out-of-role for reader
    store.record(denialEvent('tool3', 'analyst')); // analyst can see tool3
    const scoped = store.snapshot(ROLES_CONFIG, FOUR_TOOL_INDEX, { role: 'reader' });
    // reader's role-scoped query MUST exclude tool3 + tool4 entirely
    const tools = scoped.denials.map((d) => d.tool);
    expect(tools).toContain('tool1');
    expect(tools).toContain('tool2');
    expect(tools).not.toContain('tool3');
    expect(tools).not.toContain('tool4');
  });

  it('Pr2: role-scoped search/miss events filtered on event.role (foreign roles excluded)', () => {
    const store = new AnalyticsStore();
    store.record(searchEvent('admin'));
    store.record(searchEvent('reader'));
    store.record(missEvent('admin'));
    store.record(missEvent('reader'));
    const scoped = store.snapshot(ROLES_CONFIG, FOUR_TOOL_INDEX, { role: 'reader' });
    expect(scoped.searches).toHaveLength(1);
    expect(scoped.searches[0]?.role).toBe('reader');
    expect(scoped.misses).toHaveLength(1);
    expect(scoped.misses[0]?.role).toBe('reader');
  });

  it('Pr4: wildcard role sees full universe of events (admin = *)', () => {
    const store = new AnalyticsStore();
    store.record(callEvent('tool1', 'admin'));
    store.record(callEvent('tool2', 'admin'));
    store.record(callEvent('tool3', 'admin'));
    store.record(callEvent('tool4', 'admin'));
    const scoped = store.snapshot(ROLES_CONFIG, FOUR_TOOL_INDEX, { role: 'admin' });
    expect(scoped.calls.map((c) => c.tool).sort()).toEqual(['tool1', 'tool2', 'tool3', 'tool4']);
  });
});

// ─── summary computation + topTools + WR-02 (3 tests) ──────────────────────

describe('AnalyticsStore — summary', () => {
  it('topTools[5] sorts by call count descending and is empty when zero visible calls', () => {
    const store = new AnalyticsStore();
    // tool2 called 3x, tool1 called 2x, tool3 called 1x by admin
    store.record(callEvent('tool2', 'admin'));
    store.record(callEvent('tool1', 'admin'));
    store.record(callEvent('tool2', 'admin'));
    store.record(callEvent('tool1', 'admin'));
    store.record(callEvent('tool2', 'admin'));
    store.record(callEvent('tool3', 'admin'));
    const snap = store.snapshot(ROLES_CONFIG, FOUR_TOOL_INDEX, { role: 'admin' });
    // admin = '*' → sees all called tools, sorted by call count desc
    expect(snap.summary.byRole.admin?.topTools).toEqual(['tool2', 'tool1', 'tool3']);
    // ghost is an unknown role with non-empty rolesConfig → sees zero tools →
    // tool-visibility predicate returns false for every call → zero topTools.
    // This exercises the "empty topTools when no calls visible to the role"
    // contract (DEC-v11-09-02 edge case 3 — undefined role does NOT throw).
    const ghostSnap = store.snapshot(ROLES_CONFIG, FOUR_TOOL_INDEX, { role: 'ghost' });
    expect(ghostSnap.summary.byRole.ghost?.topTools).toEqual([]);
  });

  it('searchCount/callCount/denialCount/missCount accurate per role-scoped view', () => {
    const store = new AnalyticsStore();
    store.record(searchEvent('admin'));
    store.record(searchEvent('admin'));
    store.record(callEvent('tool1', 'admin'));
    store.record(denialEvent('tool2', 'admin'));
    store.record(missEvent('admin'));
    const snap = store.snapshot(ROLES_CONFIG, FOUR_TOOL_INDEX, { role: 'admin' });
    expect(snap.summary.byRole.admin).toMatchObject({
      searchCount: 2,
      callCount: 1,
      denialCount: 1,
      missCount: 1,
    });
  });

  it('WR-01 regression: byRole[role].denialCount counts denials whose actor was THIS role (non-wildcard)', () => {
    // Reader (non-wildcard) gets denied 3 times: 2x for tool3 (out-of-role), 1x for tool4 (out-of-role).
    // Analyst gets denied 1x for tool1.
    // Operator-unscoped summary.byRole.reader.denialCount MUST be 3 — without the
    // WR-01 fix it would be 0, since denials are emitted only when the tool is NOT
    // in the actor's allowed set, so isToolAllowed(event.tool, 'reader', ...) is
    // always false for reader-actor denials.
    const store = new AnalyticsStore();
    store.record(denialEvent('tool3', 'reader'));
    store.record(denialEvent('tool3', 'reader'));
    store.record(denialEvent('tool4', 'reader'));
    store.record(denialEvent('tool1', 'analyst'));
    const op = store.snapshot(ROLES_CONFIG, FOUR_TOOL_INDEX);
    expect(op.summary.byRole.reader?.denialCount).toBe(3);
    expect(op.summary.byRole.analyst?.denialCount).toBe(1);
    // admin had no denial events authored by admin → 0
    expect(op.summary.byRole.admin?.denialCount).toBe(0);
  });

  it('WR-02: non-string options.role coerced to undefined (operator-unscoped, no throw)', () => {
    const store = new AnalyticsStore();
    store.record(callEvent('tool1', 'admin'));
    // Cast to bypass TS — exercising runtime input validation
    const snap = store.snapshot(ROLES_CONFIG, FOUR_TOOL_INDEX, {
      role: 123 as unknown as string,
    });
    // Treated as operator-unscoped — full event data
    expect(snap.calls).toHaveLength(1);
    expect(snap.calls[0]?.tool).toBe('tool1');
  });
});

// ─── deadTools computation including Pitfall 5 control (4 tests) ───────────

describe('AnalyticsStore — deadTools', () => {
  it('includes tools the role can see but never called', () => {
    const store = new AnalyticsStore();
    // reader has tool1+tool2 visible; calls only tool1
    store.record(callEvent('tool1', 'reader'));
    const snap = store.snapshot(ROLES_CONFIG, FOUR_TOOL_INDEX, { role: 'reader' });
    expect(snap.summary.byRole.reader?.deadTools).toEqual(['tool2']);
  });

  it('Pitfall 5 control: search-emitted-but-not-called tools STAY in deadTools', () => {
    const store = new AnalyticsStore();
    // reader emits a search event whose results include tool1+tool2, but
    // never actually calls either tool. Both must remain in deadTools.
    store.record(searchEvent('reader', ['tool1', 'tool2']));
    const snap = store.snapshot(ROLES_CONFIG, FOUR_TOOL_INDEX, { role: 'reader' });
    expect(snap.summary.byRole.reader?.deadTools.sort()).toEqual(['tool1', 'tool2']);
  });

  it('wildcard role with no call events has all tools in deadTools', () => {
    const store = new AnalyticsStore();
    // admin = '*' → sees all four tools but never calls any
    const snap = store.snapshot(ROLES_CONFIG, FOUR_TOOL_INDEX, { role: 'admin' });
    expect(snap.summary.byRole.admin?.deadTools.sort()).toEqual([
      'tool1',
      'tool2',
      'tool3',
      'tool4',
    ]);
  });

  it('unknown role does NOT throw; returns empty deadTools (rolesConfig is non-empty)', () => {
    const store = new AnalyticsStore();
    expect(() =>
      store.snapshot(ROLES_CONFIG, FOUR_TOOL_INDEX, { role: 'ghost' }),
    ).not.toThrow();
    const snap = store.snapshot(ROLES_CONFIG, FOUR_TOOL_INDEX, { role: 'ghost' });
    expect(snap.summary.byRole.ghost).toEqual({
      searchCount: 0,
      callCount: 0,
      denialCount: 0,
      missCount: 0,
      topTools: [],
      deadTools: [], // resolveRoleAccess('ghost', non-empty config, ...) returns []
    });
  });
});

// ─── clear() resets state (1 test) ─────────────────────────────────────────

describe('AnalyticsStore — clear', () => {
  it('clear() resets the event log to empty', () => {
    const store = new AnalyticsStore();
    store.record(callEvent('tool1', 'admin'));
    store.record(callEvent('tool2', 'admin'));
    store.clear();
    const snap = store.snapshot(undefined, FOUR_TOOL_INDEX);
    expect(snap.calls).toEqual([]);
  });
});
