import type { Session, SessionConfig } from './types.js';

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Session ID constant for stdio transport (single session per process). */
export const STDIO_SESSION_ID = '__stdio__';

const DEFAULT_TTL = 7200000; // 2 hours
const CLEANUP_INTERVAL = 900000; // 15 minutes

// ─── Session Registry ──────────────────────────────────────────────────────────

/**
 * Registry for managing sessions with TTL-based expiration.
 *
 * Features:
 * - Tracks loaded tool schemas per session via a Set
 * - Dual cleanup: lazy expiry on access + periodic interval sweep
 * - Sliding TTL resets lastActiveAt on every access
 * - destroy() stops timer and clears all sessions for clean shutdown
 */
export class SessionRegistry {
  private sessions: Map<string, Session>;
  private timer: NodeJS.Timeout;
  private ttl: number;

  constructor(config?: SessionConfig) {
    this.ttl = config?.ttl ?? DEFAULT_TTL;
    this.sessions = new Map();
    this.timer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL);
    this.timer.unref(); // CRITICAL: don't block Node.js process exit
  }

  /**
   * Get an existing session or create a new one.
   *
   * If the session exists but has expired (lastActiveAt + TTL < now),
   * it is deleted and a fresh session is created (lazy expiry).
   *
   * If the session exists and is not expired, lastActiveAt is updated
   * (sliding TTL) and the session is returned.
   */
  getOrCreate(id: string, role: string): Session {
    const existing = this.sessions.get(id);

    if (existing) {
      // Lazy expiry check
      if (Date.now() - existing.lastActiveAt > this.ttl) {
        this.sessions.delete(id);
        // Fall through to create fresh session
      } else {
        // Sliding TTL: reset lastActiveAt
        existing.lastActiveAt = Date.now();
        return existing;
      }
    }

    // Create new session
    const session: Session = {
      id,
      role,
      loadedTools: new Set(),
      queryLog: [],
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    this.sessions.set(id, session);
    return session;
  }

  /**
   * Stop the cleanup timer and clear all sessions.
   * Intended for shutdown and testing.
   */
  destroy(): void {
    clearInterval(this.timer);
    this.sessions.clear();
  }

  /**
   * Number of active sessions in the registry.
   */
  get size(): number {
    return this.sessions.size;
  }

  /**
   * Remove all expired sessions from the registry.
   * Called periodically by the cleanup interval timer.
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastActiveAt > this.ttl) {
        this.sessions.delete(id);
      }
    }
  }
}
