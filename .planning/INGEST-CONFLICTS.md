## Conflict Detection Report

### BLOCKERS (0)

(none)

### WARNINGS (0)

(none)

### INFO (6)

[INFO] Board-resolved version collision between sibling PRDs
  Found: Both `.planning/inbox/mcpack-prd-v1.1-gsd.md` (§1, §Phase 5) and `.planning/inbox/mcpack-prd-v1.1-final.md` (§1 frontmatter "Version: 1.1.0", §4.2 example "version: '1.1.0'", §5.7 package.json "version: 1.1.0", §12 DoD "@llvs/mcpack@1.1.0", "@llvs/mcpack-google@1.1.0") claim version 1.1.0 for the @llvs/mcpack package and its release artifacts.
  Note: Resolved by board decision 2026-04-25. The v1.1.0 npm slot is assigned to the Search & Observability PRD (`mcpack-prd-v1.1-gsd.md`). All `1.1.0` references in `mcpack-prd-v1.1-final.md` (Partner Hub) are rewritten to `1.2.0` in the synthesized intel — see `intel/decisions.md` DEC-v12-07, DEC-v12-12, DEC-BOARD-02 and `intel/requirements.md` REQ-v12-publish-versions. No further user action required.

[INFO] Board-resolved milestone reassignment for Partner Hub PRD
  Found: `.planning/inbox/mcpack-prd-v1.1-final.md` is internally titled and structured as the v1.1 milestone (frontmatter "Version: 1.1.0", §1 "MCPack v1.1 adds three major capabilities", §11 future roadmap places semantic search in v1.2). Sibling `.planning/inbox/mcpack-prd-v1.1-gsd.md` H1 is "PRD: MCPack v1.1" and explicitly targets the v1.1 milestone.
  Note: Resolved by board decision 2026-04-25. The v1.1 milestone slot is the Search & Observability PRD (`mcpack-prd-v1.1-gsd.md` → v1.1.0). The Partner Hub PRD (`mcpack-prd-v1.1-final.md`) is reassigned to the v1.2 milestone. Captured as DEC-BOARD-01 and DEC-BOARD-02 in `intel/decisions.md`. Non-goals authored against the original v1.1 framing in `mcpack-prd-v1.1-final.md` §9 require re-evaluation by the roadmapper — flagged inline in `intel/requirements.md` v1.2 Non-Goals.

[INFO] Board-resolved semantic-search timing override
  Found: `.planning/inbox/mcpack-prd-v1.1-final.md` §9 explicitly defers "Semantic / embedding-based search" to v1.2 ("inverted index sufficient for v1.1 tool surfaces"). `.planning/inbox/mcpack-prd-v1.1-final.md` §11 lists "Pluggable embedding provider for semantic search" under v1.2 future roadmap. Sibling `.planning/inbox/mcpack-prd-v1.1-gsd.md` targets semantic search overlay for v1.1 via R1.1–R1.9.
  Note: Resolved by board decision 2026-04-25. Per the milestone reassignment (Partner Hub → v1.2), semantic search ships in v1.1 via the EmbeddingProvider hook plus the `@llvs/mcpack-embeddings` adapter package. Captured as DEC-BOARD-03 in `intel/decisions.md`. The "semantic search" non-goal in `mcpack-prd-v1.1-final.md` §9 is now stale relative to the board-confirmed schedule.

[INFO] Auto-resolved: search-engine direction sequenced cleanly across milestones
  Found: `.planning/inbox/mcpack-prd-v1.1-gsd.md` §R1.6 + §R1.9 keep the v1.0 5-tier weighted keyword scorer in `src/search.ts` as the keyword leg of a hybrid (semantic + keyword) ranker, with default weights `semanticWeight: 0.7`, `keywordWeight: 0.3`. `.planning/inbox/mcpack-prd-v1.1-final.md` §3.4 + §5.4 propose REPLACING the v1.0 5-tier scorer with a deterministic weighted inverted index (TOOL_NAME=10, DESCRIPTION=5, PARAM_NAME=2) built at startup.
  Note: The two changes target the same module (`src/search.ts`) but in different milestones — board decision places the hybrid (5-tier-preserving) work in v1.1 and the inverted-index proposal in v1.2. Sequential resolution: v1.1 ships hybrid ranker with the v1.0 5-tier scorer untouched as the keyword leg (DEC-v11-13). v1.2 inherits that surface and may either (a) swap the keyword leg to the inverted index, (b) keep both side-by-side, or (c) leave the 5-tier scorer in place. The decision is explicitly **deferred to a v1.2 ADR before phase planning** — captured as REQ-v12-search-engine-direction in `intel/requirements.md` and DEC-v12-09 in `intel/decisions.md`. No contradiction at the v1.1 boundary; no synthesis-time pick required.

[INFO] Clerical correction post-research: @xenova/transformers → @huggingface/transformers
  Found: PRD body and synthesized intel originally cited `@xenova/transformers` as the v1.1 embedding library peer-dep (per `mcpack-prd-v1.1-gsd.md` §R1.3 and DEC-v11-03). Phase 6 researcher (2026-04-25) verified via npm registry that the package was renamed to `@huggingface/transformers` in October 2024. The legacy `@xenova/transformers` name is frozen at v2.17.2 (May 2024); the successor `@huggingface/transformers` is at v4.2.0 (April 2026), actively maintained by HuggingFace (same repository, same maintainer). API-compatible for MCPack's `pipeline('feature-extraction', ...)` usage.
  Note: Board approved the switch 2026-04-25. No scope change — this is a clerical correction reflecting the current state of the npm registry. DEC-v11-03 updated to reflect the current package name. Two new sub-decisions captured for Phase 6 planning gate: DEC-v11-03a (sibling-directory package layout) and DEC-v11-03b (core version bump 1.0.0 → 1.1.0 in Phase 6).

[INFO] Mutual cross-references between sibling PRDs (cycle present, not synthesis-blocking)
  Found: `.planning/inbox/mcpack-prd-v1.1-gsd.md` Non-Goals + cross_references reference the Partner Hub PRD (multi-source, OAuth, HTTP/SSE deferred to it). `.planning/inbox/mcpack-prd-v1.1-final.md` cross_references reference the Search & Observability PRD (semantic search deferred to it — note: this deferral was overridden by the board, see prior INFO entry). The cross-ref graph contains a length-2 cycle between the two PRDs.
  Note: The mutual references are scope-deferral pointers rather than decision dependencies — the board has explicitly partitioned the two PRDs by milestone (v1.1 vs v1.2), which breaks the cycle for synthesis purposes. Both docs synthesized cleanly under their assigned milestones. Per-doc precedence override (v1.1=0, v1.2=1) from the manifest preserved. No remediation required.
