# Roadmap: MCPack

## Overview

MCPack goes from zero to npm-publishable library in five phases. Phase 1 scaffolds the project and builds all leaf modules (search, sessions, roles, index) as independent, testable units. Phase 2 wires them into a core engine and delivers wrap mode -- the higher-value entry point. Phase 3 adds build mode as a thin layer on the proven core. Phase 4 validates everything with unit tests and the Stripe MCP integration harness. Phase 5 writes documentation with real token reduction numbers from the harness.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation and Leaf Modules** - Project scaffolding, types, and all independent modules (index-builder, search, sessions, roles)
- [ ] **Phase 2: Core Engine and Wrap Mode** - Wire modules into core engine, deliver complete wrap mode with search_tools meta-tool
- [ ] **Phase 3: Build Mode** - Build mode entry point with handler routing, public API exports
- [x] **Phase 4: Testing and Integration Harness** - Unit tests for all modules, Stripe MCP integration harness with token comparison (completed 2026-03-22)
- [ ] **Phase 5: Documentation and Release Prep** - README with examples, spec commit, token reduction numbers

## Phase Details

### Phase 1: Foundation and Leaf Modules
**Goal**: All independent modules exist, compile, and can be tested in isolation -- the building blocks for both modes
**Depends on**: Nothing (first phase)
**Requirements**: SRCH-01, SRCH-02, SESS-01, SESS-02, SESS-03, SESS-04, ROLE-01, ROLE-02, ROLE-03, PKG-01, PKG-02
**Success Criteria** (what must be TRUE):
  1. Project compiles with `tsc` and produces ESM output with type declarations
  2. `package.json` declares `@modelcontextprotocol/sdk` as peer dependency with zero runtime dependencies
  3. Search engine scores and ranks tool definitions by keyword relevance (name > description > keyword), respecting configurable result limits
  4. Session registry tracks loaded tools per session, expires sessions after TTL, and exposes a `destroy()` method that stops the cleanup timer
  5. Role filter restricts tool visibility to a caller's role, with wildcard support granting access to all tools
**Plans**: 2 plans

Plans:
- [ ] 01-01-PLAN.md — Project scaffolding, types, and index-builder module
- [ ] 01-02-PLAN.md — Search engine, session registry, and role filter modules

### Phase 2: Core Engine and Wrap Mode
**Goal**: A developer can wrap any existing MCP server with `mcpack(server, config)` and get lazy tool discovery working end-to-end
**Depends on**: Phase 1
**Requirements**: DISC-01, DISC-02, DISC-03, DISC-05, ENTRY-01, ENTRY-03
**Success Criteria** (what must be TRUE):
  1. `tools/list` on a wrapped server returns exactly one tool: `search_tools`
  2. Calling `search_tools` with a query returns matching tool schemas ranked by relevance
  3. Previously loaded schemas return as `loaded: true` with no schema payload on subsequent calls within the same session
  4. All `tools/call` requests for non-discovery tools pass through to the underlying server unchanged
  5. Wrap mode and (future) build mode share the same core engine instance
**Plans**: 2 plans

Plans:
- [ ] 02-01-PLAN.md — MCPackEngine core class, MCPackHandle type, session size getter
- [ ] 02-02-PLAN.md — mcpack() wrap mode entry point, handler interception, package exports

### Phase 3: Build Mode
**Goal**: A developer can create a new MCP server from scratch with tools, handlers, and lazy discovery using `createMCPackServer(config)`
**Depends on**: Phase 2
**Requirements**: DISC-04, ENTRY-02
**Success Criteria** (what must be TRUE):
  1. `createMCPackServer(config)` returns an MCP Server instance with `search_tools` as the only listed tool
  2. `tools/call` requests route to the correct registered handler based on tool name
  3. Build mode shares the same core engine, search, session, and role behavior as wrap mode
**Plans**: 2 plans

Plans:
- [ ] 03-01-PLAN.md — Type updates (MCPackHandlerContext, MCPackServer) and correctness fixes to wrap.ts
- [ ] 03-02-PLAN.md — createMCPackServer build mode entry point, tests, and package exports

### Phase 4: Testing and Integration Harness
**Goal**: All modules have unit test coverage and the Stripe MCP integration harness proves real-world token reduction
**Depends on**: Phase 3
**Requirements**: TEST-01, TEST-02, TEST-03
**Success Criteria** (what must be TRUE):
  1. Unit tests exist for each module: index-builder, search, session, roles, server-builder
  2. Integration test harness runs against real Stripe MCP server and produces a token reduction comparison report (vanilla vs MCPack)
  3. All tests pass with `vitest` in a single `npm test` command
**Plans**: 2 plans

Plans:
- [x] 04-01-PLAN.md — Unit test audit, coverage config, gap-filling for all modules
- [x] 04-02-PLAN.md — Stripe MCP integration harness with token reduction report

### Phase 5: Documentation and Release Prep
**Goal**: The package is ready for npm publishing with complete documentation showing real token savings
**Depends on**: Phase 4
**Requirements**: PKG-03, PKG-04, PKG-05, PKG-06
**Success Criteria** (what must be TRUE):
  1. README documents wrap mode usage with a complete code example
  2. README documents build mode usage with a complete code example
  3. README includes token reduction numbers from the Stripe MCP integration harness
  4. Spec document is committed to `/spec/mcpack-spec-v1.md` and referenced in README
**Plans**: TBD

Plans:
- [ ] 05-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation and Leaf Modules | 0/2 | Not started | - |
| 2. Core Engine and Wrap Mode | 0/2 | Not started | - |
| 3. Build Mode | 0/2 | Not started | - |
| 4. Testing and Integration Harness | 2/2 | Complete   | 2026-03-22 |
| 5. Documentation and Release Prep | 0/1 | Not started | - |
