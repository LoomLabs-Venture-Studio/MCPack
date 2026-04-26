---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: search-and-observability
status: in-progress
stopped_at: Phase 06 complete + verified (11/11 dimensions PASS); ready for /gsd-plan-phase 7
last_updated: "2026-04-26T17:00:00.000Z"
progress:
  total_phases: 8
  completed_phases: 6
  total_plans: 12
  completed_plans: 12
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-25)

**Core value:** Agents discover only the tool schemas they need, when they need them — reducing token waste from bulk tool discovery by 80%+ on servers with large tool surfaces.
**Current focus:** Phase 06 — embeddingprovider-interface-adapter-scaffold-v1-1

## Current Position

Phase: 06 (embeddingprovider-interface-adapter-scaffold-v1-1) — EXECUTING
Plan: 2 of 2
Active milestone: v1.1.0 Search & Observability (PRD ingested 2026-04-25 from `.planning/inbox/mcpack-prd-v1.1-gsd.md`)

## Performance Metrics

**v1.0 milestone summary (historical):**

- 7 phases, 10 plans, 21 tasks across 4 days (2026-03-19 → 2026-03-23)
- 100 tests, 99.56% statement coverage
- 80.7% aggregate token reduction on real Stripe MCP (28 tools)
- 946 LOC src / 1,846 LOC tests
- Docs site live at loomlabs-venture-studio.github.io/MCPack/

**By Phase (v1.0):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| Phase 01 P01 | 1 | 5min | 2 tasks, 8 files |
| Phase 01 P02 | 1 | 5min | 3 tasks, 8 files |
| Phase 02 P01 | 1 | 2min | 2 tasks, 4 files |
| Phase 02 P02 | 1 | 2min | 2 tasks, 3 files |
| Phase 03 P01 | 1 | 2min | 2 tasks, 4 files |
| Phase 03 P02 | 1 | 2min | 2 tasks, 3 files |
| Phase 04 P01 | 1 | 2min | 2 tasks, 5 files |
| Phase 04 P02 | 1 | 2min | 2 tasks, 3 files |
| Phase 05 P01 | 1 | 1min | 2 tasks, 2 files |
| Phase 05 P02 | 1 | 1min | 2 tasks, 3 files |
| Phase 06 P01 | 9min | 2 tasks | 4 files |
| Phase 06 P02 | 12min | 2 tasks | 6 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md "Key Decisions" table. v1.0 phase-level decisions (historical):

- [Roadmap]: Handler replacement over proxy pattern — use `setRequestHandler()` to intercept tools/list and tools/call
- [Roadmap]: Keyword search only for v1 — semantic search deferred to v1.1
- [Roadmap]: Phase 1 validates critical risks (client tool validation, handler capture) before feature investment
- [Phase 01]: Import Tool type from @modelcontextprotocol/sdk/types.js for NodeNext resolution
- [Phase 01]: Export tokenize() and STOP_WORDS from index-builder for reuse by search module
- [Phase 02]: MCPackEngine is internal — not exported from package entry point
- [Phase 02]: Handler capture via _requestHandlers Map with defensive check and clear error
- [Phase 02]: Fallback to config.tools when original handler throws or returns empty
- [Phase 03]: MCPackHandlerContext required on handler — handlers always receive context
- [Phase 03]: Throw on empty tools replaces console.warn — empty is developer mistake
- [Phase 03]: Config snapshot at setup prevents external mutation after mcpack() call
- [Phase 04]: Harness uses npx tsx for direct TS execution, separate from vitest
- [Phase 05]: Lean README structure with no badges, logos, or contributing section
- [Phase 05]: Copy README.md to docs/index.md (not symlink) for CI and MkDocs compatibility

v1.1 + v1.2 ingest decisions (2026-04-25, board-locked):

- DEC-BOARD-01: v1.1 slot = Search & Observability PRD
- DEC-BOARD-02: v1.2 slot = Partner Hub PRD (version override 1.1.0 → 1.2.0)
- DEC-BOARD-03: Semantic search ships in v1.1
- DEC-BOARD-04: Core stays zero-dep through both milestones
- DEC-BOARD-05: Adapter package pattern is the v1.1+ contract

Full intel: `.planning/intel/decisions.md` (33 decisions); board-pre-resolved conflicts in `.planning/INGEST-CONFLICTS.md` (0 BLOCKERS / 0 WARNINGS / 5 INFO).

- [Phase ?]: [Phase 06-01]: EmbeddingProvider type signature locked verbatim per DEC-v11-01: (texts: string[]) => Promise<number[][]>
- [Phase ?]: [Phase 06-01]: MCPackConfig.embeddings is optional; when omitted, search code path byte-identical to v1.0 (DEC-v11-02 / DEC-BOARD-04)
- [Phase ?]: [Phase 06-01]: Core version bumped 1.0.0 -> 1.1.0 (DEC-v11-03b); npm publish remains a Phase 10 concern
- [Phase ?]: [Phase 06-01]: JSDoc comment on EmbeddingProvider rewritten to reference 'sibling adapter package' instead of literal name to honor static-grep adapter-isolation gate
- [Phase ?]: [Phase 06-02]: Sibling-package layout at packages/mcpack-embeddings/ honored (DEC-v11-03a) — no monorepo tooling, no workspaces field
- [Phase ?]: [Phase 06-02]: Adapter dep is @huggingface/transformers ^4.0.0 (DEC-v11-03 clerical-correction) — NOT @xenova/transformers
- [Phase ?]: [Phase 06-02]: Adapter does NOT re-export EmbeddingProvider (Pitfall 1) — consumers import the type from @llvs/mcpack core only
- [Phase ?]: [Phase 06-02]: Closure-scoped pipeline singleton (research Pattern 2 / Pitfall 2) — extractor cache lives inside factory return, NOT at module scope
- [Phase ?]: [Phase 06-02]: Local dependency resolution via npm link (NOT npm install) until Phase 10 publishes @llvs/mcpack@1.1.0 to the registry

### Pending Todos

- v1.1 Phase 1 plan generation: `/gsd-plan-phase 1`
- v1.1 Open Questions OQ1–OQ6 surface in phase planning (see `.planning/intel/requirements.md`):
  - OQ1: `getAnalytics()` flat on handle vs separate `analytics` property
  - OQ2: Hybrid weights configurable per-query vs config-only
  - OQ3: Index rebuild on `listChanged` (defer to v1.2)
  - OQ4: 50-query intent benchmark source (Stripe / synthetic / community) — pick before Phase 5
  - OQ5: Denial events record tool name even for operators — confirm in Phase 4
  - OQ6: `@llvs/mcpack-embeddings` ship hosted adapter (OpenAI/Voyage) in v1.1 or defer — defer to v1.2
- v1.2 (DEFERRED): author search-engine-direction ADR before Phase 1 plan; resolve PRD §9 non-goals re-evaluation (WorkOS, Auth0, audit log, rate limiting, per-project scoping, token expiry/refresh)

### Blockers/Concerns

None for v1.1. Retrospective lessons from v1.0 (`.planning/RETROSPECTIVE.md`) carry forward:

- Verify MCP SDK env var conventions up front before harness work
- Audit peer deps against actual imports before publishing

### Backlog & Roadmap

- **Phase 999.1 (backlog):** GitHub Actions CI/CD pipeline — lint/typecheck/vitest on PRs. Requirements TBD. Promote via `/gsd-review-backlog`.
- **v1.2 milestone:** PRD ingested, deferred until v1.1 ships. Partner Hub (multi-source + Google OAuth + HTTP/SSE + `@llvs/mcpack-google`). 16 requirements / 5 phases. Pre-Phase-1 ADR required for search-engine direction.
- **v2.0 milestone (idea):** Binary encoding layer. No PRD yet.

## Session Continuity

Last session: 2026-04-26T16:48:30.903Z
Stopped at: Completed 06-02-PLAN.md (plan 2 of 2 in Phase 06)
Resume file: None

**Next action when resuming:** `/gsd-plan-phase 1` to start v1.1 Phase 1 (EmbeddingProvider Interface + Adapter Scaffold).
