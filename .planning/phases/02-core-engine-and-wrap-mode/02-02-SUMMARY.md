---
phase: 02-core-engine-and-wrap-mode
plan: 02
subsystem: api
tags: [mcp, wrap-mode, handler-interception, server, typescript]

# Dependency graph
requires:
  - phase: 02-core-engine-and-wrap-mode
    plan: 01
    provides: "MCPackEngine class, MCPackHandle type"
  - phase: 01-leaf-modules
    provides: "index-builder, search, session, roles modules"
provides:
  - "mcpack() async wrap mode entry point"
  - "Handler interception for tools/list and tools/call"
  - "Package exports: mcpack function + MCPackHandle type"
affects: [03-build-mode, 04-packaging]

# Tech tracking
tech-stack:
  added: []
  patterns: ["call-and-capture for tool definition snapshot", "single interceptor with name-based routing", "defense-in-depth role check at tools/call level"]

key-files:
  created: [src/wrap.ts, test/wrap.test.ts]
  modified: [src/index.ts]

key-decisions:
  - "Handler capture via _requestHandlers Map with defensive check and clear error"
  - "Call-and-capture invokes original tools/list handler with synthetic extra object"
  - "Fallback to config.tools when original handler throws or returns empty"

patterns-established:
  - "Wrap pattern: capture original handlers, replace with interceptors, return control handle"
  - "Session ID resolution: extra.sessionId with STDIO_SESSION_ID fallback"
  - "Original handler proxying: forward request+extra as-is, catch errors into isError:true"

requirements-completed: [DISC-01, DISC-03, ENTRY-01]

# Metrics
duration: 2min
completed: 2026-03-21
---

# Phase 02 Plan 02: Wrap Mode Entry Point Summary

**mcpack() wraps MCP Server with handler interception -- tools/list returns search_tools only, tools/call routes search to engine and proxies all other calls with role checking**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-21T06:33:39Z
- **Completed:** 2026-03-21T06:35:37Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- mcpack() async entry point captures existing handlers via _requestHandlers Map and replaces with MCPack interceptors
- tools/list returns exactly one tool (search_tools); tools/call routes search queries to engine, proxies everything else
- Defense-in-depth role check blocks disallowed tools before forwarding to original handler
- Package entry point exports mcpack function and MCPackHandle type
- 11 new wrap mode tests, full suite at 68 tests all passing

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Failing wrap mode tests** - `2c692fa` (test)
2. **Task 1 GREEN: Implement mcpack() wrap mode** - `faedc6d` (feat)
3. **Task 2: Update package exports** - `a571281` (feat)

## Files Created/Modified
- `src/wrap.ts` - mcpack() async entry point with handler interception (107 lines)
- `test/wrap.test.ts` - 11 integration tests covering all wrap mode behavior
- `src/index.ts` - Added mcpack value export and MCPackHandle type export

## Decisions Made
- Handler capture uses (server as any)._requestHandlers Map access with defensive null check and clear error message
- Call-and-capture constructs synthetic extra object with AbortController signal for internal tools/list invocation
- Config.tools fallback provides recovery path when original handler fails

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Missing vi import in test file**
- **Found during:** Task 1 (TDD GREEN)
- **Issue:** Test used vi.spyOn but did not import vi from vitest
- **Fix:** Added vi to imports from vitest
- **Files modified:** test/wrap.test.ts
- **Verification:** All 11 tests pass
- **Committed in:** faedc6d (part of GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Trivial missing import. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Wrap mode is complete and fully tested
- Package exports mcpack function ready for consumer use
- Phase 2 complete -- ready for Phase 3 (build mode) or Phase 4 (packaging)
- All 68 tests green including Phase 1 regression

---
*Phase: 02-core-engine-and-wrap-mode*
*Completed: 2026-03-21*
