---
phase: 01-foundation-and-leaf-modules
plan: 02
subsystem: api
tags: [search, session, roles, rbac, ttl, keyword-scoring]

# Dependency graph
requires:
  - "01-01: TypeScript types (ToolIndexEntry, Session, SessionConfig, RoleConfig)"
provides:
  - "Search engine with 5-tier weighted keyword scoring (scoreAndRank)"
  - "Session registry with dual TTL cleanup and loaded-tool tracking (SessionRegistry)"
  - "Role filter with hierarchical inheritance and cycle protection (resolveRoleAccess, isToolAllowed)"
affects: [02-core-wiring, 03-entry-points]

# Tech tracking
tech-stack:
  added: ["@types/node"]
  patterns: [stateful-registry-class, named-score-constants, recursive-role-resolution]

key-files:
  created: [src/search.ts, src/session.ts, src/roles.ts, test/search.test.ts, test/session.test.ts, test/roles.test.ts]
  modified: [package.json, package-lock.json]

key-decisions:
  - "Added @types/node for NodeJS.Timeout type on session cleanup timer"
  - "Session cleanup timer uses NodeJS.Timeout type (not ReturnType<typeof setInterval>) for .unref() access"

patterns-established:
  - "Stateful registry class: SessionRegistry with Map storage, timer lifecycle, destroy() for testing"
  - "Named score constants: EXACT_NAME=10, PARTIAL_NAME=5, DESCRIPTION=3, KEYWORD=2, SCHEMA_PROPERTY=1"
  - "Recursive role resolution: getAllowedTools with visited Set for cycle protection"
  - "Defense-in-depth: isToolAllowed helper for Phase 2 tools/call enforcement"

requirements-completed: [SRCH-01, SRCH-02, SESS-01, SESS-02, SESS-03, SESS-04, ROLE-01, ROLE-02, ROLE-03]

# Metrics
duration: 5min
completed: 2026-03-20
---

# Phase 01 Plan 02: Leaf Modules Summary

**Search engine with 5-tier weighted keyword scoring, session registry with dual TTL cleanup and sliding expiry, and role filter with hierarchical inheritance and cycle protection**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-20T06:33:14Z
- **Completed:** 2026-03-20T06:38:00Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments
- Search engine scores and ranks tools using 5 weighted tiers (EXACT_NAME=10, PARTIAL_NAME=5, DESCRIPTION=3, KEYWORD=2, SCHEMA_PROPERTY=1) with configurable limits capped at 10
- Session registry with dual cleanup (lazy expiry on access + 15-min interval sweep), sliding TTL, .unref() on timer, and destroy() for clean shutdown
- Role filter with recursive inheritance, wildcard propagation, cycle protection via visited set, and isToolAllowed helper for Phase 2 defense-in-depth
- 38 new unit tests (12 search + 11 session + 15 roles), 45 total across project

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Search engine tests** - `4dab743` (test)
2. **Task 1 GREEN: Search engine implementation** - `c588a04` (feat)
3. **Task 2 RED: Session registry tests** - `c33e970` (test)
4. **Task 2 GREEN: Session registry implementation** - `ecdac91` (feat)
5. **Task 3 RED: Role filter tests** - `3d63715` (test)
6. **Task 3 GREEN: Role filter implementation** - `e8ac501` (feat)

_TDD tasks had separate RED and GREEN commits._

## Files Created/Modified
- `src/search.ts` - Keyword scoring engine with scoreAndRank function
- `src/session.ts` - SessionRegistry class with TTL, dual cleanup, STDIO_SESSION_ID constant
- `src/roles.ts` - resolveRoleAccess, isToolAllowed, getAllowedTools (internal)
- `test/search.test.ts` - 12 unit tests for search scoring, limits, edge cases
- `test/session.test.ts` - 11 unit tests with fake timers for TTL, cleanup, destroy
- `test/roles.test.ts` - 15 unit tests for role filtering, inheritance, wildcard, cycles
- `package.json` - Added @types/node dev dependency
- `package-lock.json` - Lock file updated

## Decisions Made
- Added `@types/node` as dev dependency for `NodeJS.Timeout` type -- required for `.unref()` type safety on session cleanup timer
- Used `NodeJS.Timeout` instead of `ReturnType<typeof setInterval>` since the latter resolves to `number` without Node.js types

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added @types/node for NodeJS.Timeout type**
- **Found during:** Task 2 (Session registry implementation)
- **Issue:** `tsc --noEmit` failed: `.unref()` does not exist on type `number` -- `ReturnType<typeof setInterval>` resolves to `number` without Node.js type definitions
- **Fix:** Installed `@types/node` as dev dependency, used `NodeJS.Timeout` type for timer field
- **Files modified:** package.json, package-lock.json, src/session.ts
- **Verification:** `npx tsc --noEmit` passes, all tests pass
- **Committed in:** ecdac91 (Task 2 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential for TypeScript compilation. `@types/node` is standard for any Node.js TypeScript project. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All three leaf modules ready to wire into core engine in Phase 2
- scoreAndRank takes ToolIndexEntry[] and returns ranked results
- SessionRegistry.getOrCreate() returns Session with loadedTools Set
- resolveRoleAccess filters index by role permissions
- isToolAllowed ready for tools/call enforcement in Phase 2
- Full test suite (45 tests) passing, tsc clean

## Self-Check: PASSED

All 6 files verified present. All 6 commits verified in git log.

---
*Phase: 01-foundation-and-leaf-modules*
*Completed: 2026-03-20*
