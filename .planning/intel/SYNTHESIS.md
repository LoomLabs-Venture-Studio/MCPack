# Synthesis Summary

**Generated:** 2026-04-25
**Mode:** merge (existing v1.0 `.planning/` directory)
**Operation noun:** ingest

This file is the entry point for `gsd-roadmapper` and any downstream consumer. All per-type intel and the conflicts report are referenced below.

---

## Doc Counts

| Type | Count | Sources |
|------|-------|---------|
| ADR  | 0     | — |
| SPEC | 0     | — |
| PRD  | 2     | `mcpack-prd-v1.1-gsd.md`, `mcpack-prd-v1.1-final.md` |
| DOC  | 0     | — |
| **Total** | **2** | |

Both classifications are `confidence: high`, manifest-overridden (`MANIFEST_TYPE=PRD`). No `UNKNOWN` low-confidence docs. No SPECs or formal ADRs in the ingest set; PRD-level locked decisions captured separately under `intel/decisions.md`.

---

## Decisions

**Total decisions extracted:** 33
- v1.1 PRD locked decisions: 15 (DEC-v11-01 → DEC-v11-15)
- v1.2 PRD locked decisions: 12 (DEC-v12-01 → DEC-v12-12)
- Cross-milestone board locks: 5 (DEC-BOARD-01 → DEC-BOARD-05)

**Board-locked items (cannot be auto-overridden downstream):**
- DEC-v11-01: Public API byte-for-byte identical to v1.0 (carried forward)
- DEC-v11-02: Core stays zero runtime dependencies
- DEC-v11-03: Adapter package pattern (model deps live outside core)
- DEC-v12-01: Auth resolution at transport layer BEFORE source composition
- DEC-v12-02: resolveRole(session) provider-agnostic extension point
- DEC-v12-10: Public API of v1.0 byte-for-byte identical through v1.2
- DEC-BOARD-01: v1.1 milestone slot belongs to Search & Observability PRD
- DEC-BOARD-02: v1.2 milestone slot belongs to Partner Hub PRD (version override)
- DEC-BOARD-03: Semantic search ships in v1.1, not v1.2
- DEC-BOARD-04: Core zero-dep invariant carries forward through both milestones
- DEC-BOARD-05: Adapter package pattern is the v1.1+ contract

**File:** `intel/decisions.md`

---

## Requirements

**Total requirements extracted:** 38

| Milestone | REQ IDs | Count |
|-----------|---------|-------|
| v1.1 | REQ-v11-semantic-provider-interface, REQ-v11-embeddings-optional-config, REQ-v11-mcpack-embeddings-package, REQ-v11-semantic-index-build, REQ-v11-semantic-query-path, REQ-v11-hybrid-ranking, REQ-v11-role-filter-after-rank, REQ-v11-perf-budget, REQ-v11-backward-compat, REQ-v11-analytics-events, REQ-v11-analytics-storage, REQ-v11-analytics-privacy, REQ-v11-analytics-api, REQ-v11-analytics-role-scoped-query, REQ-v11-analytics-rbac-integrity, REQ-v11-dead-tool-detection, REQ-v11-zero-core-deps, REQ-v11-public-api-lock, REQ-v11-esm-only, REQ-v11-test-coverage-floor, REQ-v11-tools-list-no-regression, REQ-v11-session-invariants | 22 |
| v1.2 | REQ-v12-sources-array, REQ-v12-collision-prefixing, REQ-v12-call-routing, REQ-v12-namespace-wildcard-roles, REQ-v12-resolve-role-hook, REQ-v12-static-resolver, REQ-v12-google-resolver-package, REQ-v12-sse-transport, REQ-v12-bearer-extraction, REQ-v12-graceful-shutdown, REQ-v12-public-api-unchanged, REQ-v12-zero-core-deps, REQ-v12-all-v10-tests-pass, REQ-v12-new-test-suite, REQ-v12-search-engine-direction, REQ-v12-publish-versions | 16 |

**Format note for v1.2:** Source PRD uses an unstructured §8 checklist instead of R-IDs. IDs synthesized as `REQ-v12-*` from PRD section anchors. Captured in `intel/requirements.md` "Acceptance criteria format note".

**Deferred decisions inside requirements:**
- REQ-v12-search-engine-direction — v1.2 ADR required before Phase 1 plan
- v1.1 Open Questions OQ1–OQ6 — phase-planning decisions
- v1.2 Non-Goals re-evaluation — items originally tagged "deferred to v1.2" now require explicit in/out scoping for the new (board-assigned) v1.2

**File:** `intel/requirements.md`

---

## Constraints

**Total constraints extracted:** 28

| Type | v1.1 | v1.2 | Total |
|------|------|------|-------|
| api-contract | 4 | 5 | 9 |
| schema       | 1 | 4 | 5 |
| nfr          | 6 | 1 | 7 |
| protocol     | 5 | 4 | 9 (v1.2 includes one deferred-adoption schema for the inverted index) |

**File:** `intel/constraints.md`

---

## Context Topics

**Total topics:** 13

- v1.0 Recap (existing context)
- v1.1 Problem Framing
- v1.1 User Personas
- v1.2 Problem Framing — Loom Labs Partner Access
- v1.2 Architecture — Auth at Transport Layer
- v1.2 Generic Per-Project Config Example
- v1.2 Partner Claude Code Config
- v1.2 Identity Model
- v1.2 Why stdio Children Are Cheap
- v1.2 Resolver Architecture — Provider Agnostic
- v1.1 Risks (with mitigations)
- v1.2 Risks
- v1.2 Railway Deployment Pattern + Auth Page + Future Roadmap
- Cross-PRD Relationship

**File:** `intel/context.md`

---

## Conflicts

| Bucket | Count |
|--------|-------|
| BLOCKERS | 0 |
| WARNINGS | 0 |
| INFO     | 5 |

All five INFO entries are board-pre-resolved (version collision, milestone reassignment, semantic-search timing, search-engine direction sequencing, mutual cross-ref cycle). No user input required.

**File:** `.planning/INGEST-CONFLICTS.md`

**Status:** READY — safe to route.

---

## Milestone Routing

This section tells `gsd-roadmapper` exactly which intel rows belong to which milestone. Both milestones append to the existing v1.0-shipped `.planning/ROADMAP.md`; nothing here mutates v1.0 history.

### v1.1.0 — Search & Observability (PRIMARY, board-approved)

**Source PRD:** `.planning/inbox/mcpack-prd-v1.1-gsd.md`
**Manifest precedence:** 0 (lower = higher priority)

**Decisions to load:** DEC-v11-01 → DEC-v11-15, plus DEC-BOARD-01, DEC-BOARD-03, DEC-BOARD-04, DEC-BOARD-05

**Requirements to schedule:** all REQ-v11-* (22 items)

**Constraints to enforce:** all CON-v11-*

**Non-goals to record:** v1.1 Non-Goals block in `intel/requirements.md` (binary encoding, persistent sessions, OTEL exporter, file export, webhooks, multi-source, OAuth, HTTP/SSE, default embedding model, CommonJS, analytics persistence)

**Open questions to surface in phase planning:** OQ1–OQ6 in `intel/requirements.md` v1.1 section

**Phase shape (from PRD §Phase Breakdown):** 5 phases — (1) EmbeddingProvider interface + adapter package, (2) Semantic index build pipeline, (3) Hybrid ranking query path, (4) Tool usage analytics, (5) Harness, coverage, docs, npm publish.

**v1.1 GA gate:** Phase 5 complete with all Success Criteria passing.

### v1.2.0 — Partner Hub (DEFERRED, board-reassigned from PRD-claimed v1.1)

**Source PRD:** `.planning/inbox/mcpack-prd-v1.1-final.md`
**Manifest precedence:** 1
**Doc-claimed milestone:** v1.1 (overridden — see INFO #2 in `INGEST-CONFLICTS.md`)

**Decisions to load:** DEC-v12-01 → DEC-v12-12, plus DEC-BOARD-02, DEC-BOARD-04, DEC-BOARD-05

**Requirements to schedule:** all REQ-v12-* (16 items), with these caveats:
- REQ-v12-search-engine-direction is a **deferred decision**, not a buildable task. Roadmapper must spawn a v1.2 ADR before Phase 1 plan generation.
- REQ-v12-publish-versions enforces 1.2.0 versioning (board-corrected).

**Constraints to enforce:** all CON-v12-*

**Non-goals — REQUIRES ROADMAPPER RE-EVALUATION:** The PRD §9 non-goals were authored against the original v1.1 framing. With the milestone reassignment to v1.2, these items need explicit in-scope vs slip-to-v1.3 decisions:
- WorkOS resolver — re-evaluate (originally "deferred to v1.2"; now this milestone IS v1.2)
- Auth0 resolver — re-evaluate (same reason)
- Audit log exposure endpoint — re-evaluate
- Rate limiting per role — re-evaluate
- Per-project role scoping — re-evaluate
- Token expiry / refresh automation — re-evaluate
- "Semantic / embedding-based search" — **already moved to v1.1 by board, this non-goal is stale and should be removed**

Definitively out of v1.2 (no re-evaluation needed):
- Shared hosted gateway dashboard (Layer 3 — future product)
- Cluster / multi-node deployment (v1.3+)
- Commercial pricing model (defined with enterprise partners)

**Phase shape (synthesized from PRD §5 Technical Spec):** likely 4-5 phases — (1) multi-source composition + collision handling + routing, (2) `resolveRole` hook + staticResolver in core + transport-boundary auth extraction, (3) HTTP/SSE transport + graceful shutdown, (4) `@llvs/mcpack-google` package + Google JWKS verification + Railway auth page, (5) Tests, docs, harness, npm publish at 1.2.0. Roadmapper will refine.

**v1.2 GA gate:** PRD §12 Definition of Done with versions corrected to 1.2.0.

### Cross-Milestone Carry-Forward

**Locked through both milestones (must hold for both v1.1 and v1.2):**
- v1.0 public API byte-for-byte stable (`mcpack()`, `createMCPackServer()`)
- @llvs/mcpack core: zero runtime deps
- Adapter package pattern (model + auth deps live in sibling packages)
- Opaque denial semantics (`"Unknown tool: {name}"` for out-of-role calls)
- ESM-only build (NodeNext, strict, verbatimModuleSyntax)
- Session-aware schema delivery ({loaded: true} on repeat in-session loads)

Any future PRD or ADR contradicting these is a hard BLOCKER.

---

## Pointers

| Artifact | Path |
|----------|------|
| Synthesis summary (this file) | `.planning/intel/SYNTHESIS.md` |
| Decisions intel | `.planning/intel/decisions.md` |
| Requirements intel | `.planning/intel/requirements.md` |
| Constraints intel | `.planning/intel/constraints.md` |
| Context intel | `.planning/intel/context.md` |
| Conflicts report | `.planning/INGEST-CONFLICTS.md` |
| Source PRD (v1.1) | `.planning/inbox/mcpack-prd-v1.1-gsd.md` |
| Source PRD (v1.2) | `.planning/inbox/mcpack-prd-v1.1-final.md` |
| Ingest manifest | `.planning/inbox/manifest.yaml` |
| Existing v1.0 PROJECT | `.planning/PROJECT.md` |
| Existing v1.0 REQUIREMENTS | `.planning/REQUIREMENTS.md` |
| Existing v1.0 ROADMAP | `.planning/ROADMAP.md` |
| Existing v1.0 STATE | `.planning/STATE.md` |
| Existing v1.0 RETROSPECTIVE | `.planning/RETROSPECTIVE.md` |
