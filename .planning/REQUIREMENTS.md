# Requirements: MCPack

**Defined:** 2026-03-19
**Core Value:** Agents discover only the tool schemas they need, when they need them — reducing token waste by 90%+

## v1 Requirements

### Discovery Interception

- [x] **DISC-01**: `tools/list` on a wrapped or built server returns exactly one tool: `search_tools`
- [x] **DISC-02**: `search_tools` accepts a natural language query and returns matching tool schemas ranked by relevance
- [x] **DISC-03**: All `tools/call` requests for non-`search_tools` tools pass through to the underlying server unchanged (wrap mode)
- [x] **DISC-04**: All `tools/call` requests for non-`search_tools` tools route to the correct registered handler (build mode)
- [x] **DISC-05**: Previously loaded schemas are returned as `loaded: true` with no schema payload on subsequent `search_tools` calls within the same session

### Search Engine

- [x] **SRCH-01**: Keyword-based scoring ranks results by: exact name match > partial name match > description match > extracted keyword match
- [x] **SRCH-02**: Result limit is configurable (default 5, max 10) via config and per-query `limit` parameter

### Session Management

- [x] **SESS-01**: Each session tracks which tool schemas have been loaded via a `loadedTools` set
- [x] **SESS-02**: Sessions expire after a configurable TTL (default 2 hours) and are cleaned up automatically
- [x] **SESS-03**: Cleanup timer uses `.unref()` to avoid blocking Node.js process exit
- [x] **SESS-04**: Public `destroy()` method stops cleanup timer and clears all sessions for clean shutdown

### Role-Based Access

- [x] **ROLE-01**: Roles are defined as a config map of role name to array of allowed tool names
- [x] **ROLE-02**: Wildcard `'*'` grants a role access to all tools
- [x] **ROLE-03**: `search_tools` results and `total_available` count reflect only tools the caller's role can access

### Entry Points

- [x] **ENTRY-01**: `mcpack(server, config)` wraps an existing MCP `Server` instance with lazy discovery
- [x] **ENTRY-02**: `createMCPackServer(config)` creates a new MCP `Server` with tools, handlers, and lazy discovery
- [x] **ENTRY-03**: Both entry points share the same core engine (index, search, sessions, roles)

### Testing

- [ ] **TEST-01**: Unit tests exist for each module: index-builder, search, session, roles, server-builder
- [ ] **TEST-02**: Integration test harness runs against real Stripe MCP and produces a token reduction comparison report
- [ ] **TEST-03**: All tests pass with `vitest`

### Package & Documentation

- [x] **PKG-01**: Package compiles with `tsc` and exports TypeScript type definitions
- [x] **PKG-02**: No runtime dependencies beyond `@modelcontextprotocol/sdk` as peer dependency
- [ ] **PKG-03**: README documents wrap mode usage with code example
- [ ] **PKG-04**: README documents build mode usage with code example
- [ ] **PKG-05**: README includes token reduction numbers from the test harness
- [ ] **PKG-06**: Spec document from `mcpack-spec-v1.md` (repo root) committed to `/spec/mcpack-spec-v1.md` and referenced in README

## v2 Requirements

### Role Enhancements

- **ROLE-04**: Role inheritance — roles can extend other roles
- **ROLE-05**: Custom `resolveRole(session)` function for dynamic role assignment

### Search Enhancements

- **SRCH-03**: Semantic/embedding-based search as optional upgrade to keyword scoring (v1.1)

### Protocol Integration

- **PROT-01**: `notifications/tools/list_changed` support when schemas are loaded
- **PROT-02**: Tool usage event tracking for analytics

## Out of Scope

| Feature | Reason |
|---------|--------|
| Binary encoding / MessagePack | Planned for v2.0, not needed for token reduction proof |
| Standalone proxy server process | MCPack is a library, not a daemon |
| CLI tooling | No user-facing CLI needed for a wrapper library |
| Dashboard or analytics UI | Library scope, not product scope |
| Persistent session storage | In-memory sufficient for v1; adds database dependency |
| Changes to MCP client behavior | MCPack is server-side only |
| npm publish / GitHub repo creation | Build only; publishing is a separate manual step |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DISC-01 | Phase 2 | Complete |
| DISC-02 | Phase 2 | Complete |
| DISC-03 | Phase 2 | Complete |
| DISC-04 | Phase 3 | Complete |
| DISC-05 | Phase 2 | Complete |
| SRCH-01 | Phase 1 | Complete |
| SRCH-02 | Phase 1 | Complete |
| SESS-01 | Phase 1 | Complete |
| SESS-02 | Phase 1 | Complete |
| SESS-03 | Phase 1 | Complete |
| SESS-04 | Phase 1 | Complete |
| ROLE-01 | Phase 1 | Complete |
| ROLE-02 | Phase 1 | Complete |
| ROLE-03 | Phase 1 | Complete |
| ENTRY-01 | Phase 2 | Complete |
| ENTRY-02 | Phase 3 | Complete |
| ENTRY-03 | Phase 2 | Complete |
| TEST-01 | Phase 4 | Pending |
| TEST-02 | Phase 4 | Pending |
| TEST-03 | Phase 4 | Pending |
| PKG-01 | Phase 1 | Complete |
| PKG-02 | Phase 1 | Complete |
| PKG-03 | Phase 5 | Pending |
| PKG-04 | Phase 5 | Pending |
| PKG-05 | Phase 5 | Pending |
| PKG-06 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 26 total
- Mapped to phases: 26
- Unmapped: 0

---
*Requirements defined: 2026-03-19*
*Last updated: 2026-03-19 after roadmap creation*
