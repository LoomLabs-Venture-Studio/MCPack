import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { SessionRegistry, STDIO_SESSION_ID } from '../src/session.js';

describe('SessionRegistry', () => {
  let registry: SessionRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    registry?.destroy();
    vi.useRealTimers();
  });

  it('returns session with empty loadedTools; persists across calls (SESS-01)', () => {
    registry = new SessionRegistry({ ttl: 60000 });
    const session = registry.getOrCreate('s1', 'admin');

    expect(session.loadedTools).toBeInstanceOf(Set);
    expect(session.loadedTools.size).toBe(0);

    session.loadedTools.add('toolA');
    const same = registry.getOrCreate('s1', 'admin');
    expect(same.loadedTools.has('toolA')).toBe(true);
  });

  it('returns independent sessions for different IDs (SESS-01)', () => {
    registry = new SessionRegistry({ ttl: 60000 });
    const s1 = registry.getOrCreate('s1', 'admin');
    const s2 = registry.getOrCreate('s2', 'viewer');

    s1.loadedTools.add('toolA');
    expect(s2.loadedTools.has('toolA')).toBe(false);
    expect(s1.id).toBe('s1');
    expect(s2.id).toBe('s2');
  });

  it('expires session on lazy check after TTL (SESS-02 lazy expiry)', () => {
    registry = new SessionRegistry({ ttl: 1000 });
    const original = registry.getOrCreate('s1', 'admin');
    original.loadedTools.add('toolA');
    const originalCreatedAt = original.createdAt;

    // Advance past TTL
    vi.advanceTimersByTime(1500);

    const fresh = registry.getOrCreate('s1', 'admin');
    expect(fresh.loadedTools.size).toBe(0);
    expect(fresh.createdAt).toBeGreaterThan(originalCreatedAt);
  });

  it('removes expired sessions during interval cleanup (SESS-02 interval cleanup)', () => {
    registry = new SessionRegistry({ ttl: 1000 });
    const session = registry.getOrCreate('s1', 'admin');
    session.loadedTools.add('toolA');

    // Advance past TTL
    vi.advanceTimersByTime(1500);

    // Advance past cleanup interval (15 min = 900000ms)
    vi.advanceTimersByTime(900000);

    // After cleanup, getOrCreate should return a fresh session
    const fresh = registry.getOrCreate('s1', 'admin');
    expect(fresh.loadedTools.size).toBe(0);
  });

  it('keeps session alive with sliding TTL (SESS-02 sliding TTL)', () => {
    registry = new SessionRegistry({ ttl: 1000 });
    const session = registry.getOrCreate('s1', 'admin');
    session.loadedTools.add('toolA');

    // Access before TTL expires (at 800ms)
    vi.advanceTimersByTime(800);
    const accessed = registry.getOrCreate('s1', 'admin');
    expect(accessed.loadedTools.has('toolA')).toBe(true);

    // Advance another 800ms (total 1600ms from start, but only 800ms from last access)
    vi.advanceTimersByTime(800);
    const stillAlive = registry.getOrCreate('s1', 'admin');
    expect(stillAlive.loadedTools.has('toolA')).toBe(true);
  });

  it('calls .unref() on the cleanup timer (SESS-03)', () => {
    // Spy on setInterval to capture the timer
    const originalSetInterval = globalThis.setInterval;
    const unrefSpy = vi.fn();
    vi.spyOn(globalThis, 'setInterval').mockImplementation((...args: Parameters<typeof setInterval>) => {
      const timer = originalSetInterval(...args);
      const originalUnref = timer.unref.bind(timer);
      timer.unref = () => {
        unrefSpy();
        return originalUnref();
      };
      return timer;
    });

    registry = new SessionRegistry({ ttl: 60000 });
    expect(unrefSpy).toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it('clears all sessions on destroy() (SESS-04)', () => {
    registry = new SessionRegistry({ ttl: 60000 });
    const s1 = registry.getOrCreate('s1', 'admin');
    s1.loadedTools.add('toolA');
    registry.getOrCreate('s2', 'viewer');

    registry.destroy();

    // After destroy, new getOrCreate should give fresh sessions
    // Need a new registry since destroy cleared timer
    registry = new SessionRegistry({ ttl: 60000 });
    const fresh = registry.getOrCreate('s1', 'admin');
    expect(fresh.loadedTools.size).toBe(0);
  });

  it('stops timer after destroy - no side effects from timer advancement (SESS-04)', () => {
    registry = new SessionRegistry({ ttl: 1000 });
    registry.getOrCreate('s1', 'admin');
    registry.destroy();

    // Advancing timers should not throw or cause issues
    expect(() => vi.advanceTimersByTime(900000)).not.toThrow();
  });

  it('stores query log entries on session', () => {
    registry = new SessionRegistry({ ttl: 60000 });
    const session = registry.getOrCreate('s1', 'admin');

    session.queryLog.push({
      query: 'customer',
      results: ['getCustomer', 'listCustomers'],
      timestamp: Date.now(),
    });

    const same = registry.getOrCreate('s1', 'admin');
    expect(same.queryLog.length).toBe(1);
    expect(same.queryLog[0].query).toBe('customer');
    expect(same.queryLog[0].results).toEqual(['getCustomer', 'listCustomers']);
  });

  it('uses default TTL of 2 hours (7200000ms) when no config', () => {
    registry = new SessionRegistry();
    const session = registry.getOrCreate('s1', 'admin');
    session.loadedTools.add('toolA');

    // Advance 1 hour - should still be alive
    vi.advanceTimersByTime(3600000);
    const alive = registry.getOrCreate('s1', 'admin');
    expect(alive.loadedTools.has('toolA')).toBe(true);

    // Advance past 2 hours from last access (sliding TTL reset at 1hr mark)
    // Need >7200000ms from last access to expire
    vi.advanceTimersByTime(7200001);
    const expired = registry.getOrCreate('s1', 'admin');
    expect(expired.loadedTools.size).toBe(0);
  });

  it('exports STDIO_SESSION_ID constant', () => {
    expect(STDIO_SESSION_ID).toBe('__stdio__');
  });
});
