# Phase 10: Harness, Coverage, Docs, npm Publish (v1.1) — Context

**Gathered:** 2026-04-27
**Status:** Ready for planning
**Source:** /gsd-discuss-phase 10

<domain>
## Phase Boundary

Ship v1.1 with measurable regression-free upgrades and the dual-package release.

This is the **v1.1 GA gate** — the milestone close. Phase 10 produces three artifacts and one outcome:
1. **Measurement report:** Stripe MCP harness rerun with hybrid ranking ON, plus a 50-query intent benchmark proving ≥15% recall improvement over v1.0 keyword-only, plus perf-budget verification (search_tools p99 within 50ms of v1.0 + index build ≤5s for 50-tool MiniLM).
2. **Docs delta:** README v1.1 quick-start, CHANGELOG.md (v1.0 + v1.1 entries), 2 new docs pages (`docs/semantic-search.md` + `docs/analytics.md`), adapter package's README updated.
3. **Pre-publish checklist verified:** `npm pack --dry-run` clean for both packages, package.json `files:` accurate, version verified at 1.1.0 in both, README synced, license headers, peer-dep declarations.
4. **Outcome:** `@llvs/mcpack@1.1.0` AND `@llvs/mcpack-embeddings@1.1.0` published to npm registry, `latest` tag, BOARD-APPROVED. v1.1 milestone closed; v1.2 (Partner Hub) opens.

**Phase 10 does NOT:**
- Add or modify product behavior — Phase 9 was the last code phase
- Bump versions (already at 1.1.0 in both `package.json` files post-Phase-6)
- Restructure the docs site (deferred to v1.2 when multi-version content justifies the effort)
- Land RC/beta prerelease tags (DEC-v11-10-04 — direct to `latest`)
- Deprecate v1.0 (v1.0 stays on registry; consumers upgrade by SemVer)
- Touch `src/`, `test/`, or any analytics/embeddings/hybrid logic — gated by 5 BLOCKING gates

</domain>

<decisions>
## Implementation Decisions (LOCKED — from board PRD ingest + Phase 6/7/8/9 carry-forward + this discussion)

### 50-Query Intent Benchmark Source (DEC-v11-10-01 — resolves OQ4)
**Stripe-derived.** Take the real Stripe MCP tools (28 tools, the same surface the v1.0 80.7% token-reduction number was measured on), hand-author 50 realistic intent queries spanning Stripe's product domains (auth, payments, subscriptions, customers, products, prices, refunds, invoices, etc.), and measure recall@5 for v1.0 keyword vs v1.1 hybrid.

**Rationale:**
- Reuses existing harness infrastructure (`test/harness/stripe-harness.ts`) — same surface PRD's 80.7% number was measured on.
- Real tools, real ranking — no synthetic risk of tuning queries to favor semantic search.
- Reproducible: single `npm run` command produces the report.
- 50-query corpus is small enough to hand-author with care, large enough to produce a meaningful recall delta.

**Deliverable shape:**
- Author the 50 queries in `test/harness/intent-benchmark-queries.json` (or similar) — committed to repo, reviewable.
- Author or extend `test/harness/intent-benchmark.ts` (sibling to existing stripe-harness.ts) that loads the queries, runs both v1.0 keyword path and v1.1 hybrid path against the Stripe MCP, measures recall@5 for each, and writes a comparison report to `test/harness/intent-benchmark-report.json` (gitignored — output artifact, not source).
- `npm run benchmark` script added to `package.json`.
- Threshold: hybrid recall@5 must be ≥15% above v1.0 keyword recall@5 (PRD §"Success Criteria — v1.1").

**Edge cases:**
- Queries that match no tool in EITHER ranking → exclude from recall computation (zero-information case).
- Queries where v1.0 already finds the tool at rank 1 → trivial; hybrid can't improve beyond perfect. Mix the corpus to ensure ~30-50% of queries are hard-for-keyword (e.g., paraphrased intents, synonyms, abbreviations).

### Plan Slicing (DEC-v11-10-02)
**3 plans:** Measurement, Docs, Publish. Only Plan 10-03 (Publish) is board-gated.

- **Plan 10-01: Harness + Benchmark + Perf Measurement** (Wave 1)
  - Run existing Stripe harness with hybrid ranking ON; verify ≥80.7% token reduction.
  - Author 50-query intent benchmark + `npm run benchmark` script + `intent-benchmark.ts` runner.
  - Measure search_tools p99 with local MiniLM via the adapter; verify within 50ms of v1.0 baseline.
  - Measure index build for 50-tool engine with MiniLM; verify ≤5s.
  - Produce `v1.1-release-report.md` artifact (committed to phase dir or `docs/release-reports/v1.1.md` — planner picks).
  - `autonomous: true`. No board gate.

- **Plan 10-02: Docs Update** (Wave 2 — depends on 10-01 for report numbers)
  - Update root `README.md` with v1.1 quick-start (EmbeddingProvider snippet, getAnalytics snippet, link to adapter package).
  - Create `CHANGELOG.md` at repo root with v1.0 + v1.1 entries. v1.1 entry includes: feature summary, migration note ("zero config changes required to upgrade; configure `embeddings` to enable hybrid ranking"), measurement numbers from Plan 10-01.
  - Add 2 new docs pages: `docs/semantic-search.md` (EmbeddingProvider interface, hybrid ranking explainer, weight tuning) and `docs/analytics.md` (getAnalytics API reference, role-scoping, dead-tool detection, privacy invariants).
  - Update adapter package's README at `packages/mcpack-embeddings/README.md` (currently TBD — verify exists or create).
  - `autonomous: true`. No board gate.

- **Plan 10-03: Pre-Publish Checklist + Publish** (Wave 3 — depends on 10-01 + 10-02; BOARD-APPROVED)
  - Pre-publish checklist (autonomous):
    - `npm pack --dry-run` for both packages — review the file list.
    - Verify `package.json` `files:` field accurately captures intended ship surface.
    - Verify both versions are exactly `1.1.0`.
    - Verify peer-dep declaration: `@llvs/mcpack-embeddings`'s `peerDependencies: { "@llvs/mcpack": "^1.1.0" }`.
    - Verify license headers / LICENSE file present in both packages.
    - Verify README in both packages is up-to-date (post-10-02).
    - Run final test suite (`npm test`) — must be 234+ passing, 99.78%+ coverage.
    - Run final typecheck + build for both packages.
    - All 5 BLOCKING gates pass against post-Phase-9 baseline.
  - **Board approval checkpoint** (`autonomous: false`):
    - Present pre-publish checklist results to the board.
    - Wait for explicit board approval to proceed with `npm publish`.
  - Publish (sequential, ordered):
    - `npm publish` from repo root → publishes `@llvs/mcpack@1.1.0` to `latest` tag.
    - Verify resolves: `npm view @llvs/mcpack@1.1.0 version` returns `1.1.0`.
    - `cd packages/mcpack-embeddings && npm publish` → publishes `@llvs/mcpack-embeddings@1.1.0` to `latest` tag.
    - Verify resolves: `npm view @llvs/mcpack-embeddings@1.1.0 version` returns `1.1.0`.
    - **End-to-end smoke test:** in a fresh temp dir, `npm install @llvs/mcpack @llvs/mcpack-embeddings`, write a 5-line script that imports both, instantiates the engine with MiniLM, calls `search_tools` and `getAnalytics`. Assert no errors. This is the registry-resolution proof.
  - Post-publish:
    - Tag the commit: `git tag v1.1.0 && git push origin v1.1.0`.
    - Update `.planning/STATE.md` and `ROADMAP.md` with v1.1 milestone close.

### Docs Scope (DEC-v11-10-03)
**Minimal deltas + CHANGELOG.** Defer full docs restructure to v1.2 when multi-version content justifies the effort.

In scope:
- `README.md` (root) — v1.1 quick-start additions; do NOT remove or rewrite v1.0 sections.
- `CHANGELOG.md` (root, NEW) — v1.0 entry (retroactive — published 2026-03-23, 100 tests, 99.56% coverage, 80.7% Stripe reduction) + v1.1 entry (29 tests added across phases 6-9, semantic search via EmbeddingProvider, hybrid ranking, getAnalytics, adapter package, byte-identical backward compat). Include migration note: "v1.0 → v1.1 requires zero config changes."
- `docs/semantic-search.md` (NEW) — EmbeddingProvider interface, locked weight defaults, hybrid score formula, `hasVectors()` semantics, build-pending fallback, error handling (warn-once-per-instance, locked format).
- `docs/analytics.md` (NEW) — `handle.getAnalytics(options?)` API, AnalyticsSnapshot shape, role-scoped queries with privacy semantics, dead-tool detection, RBAC integrity (Gate 5: never on MCP wire).
- `packages/mcpack-embeddings/README.md` — install, usage example, peer-dep note, performance characteristics.

Out of scope:
- Reorganizing existing `docs/index.md` / `docs/docs.md` / `docs/ONBOARDING.md` (carry forward unchanged).
- Multi-version navigation/sidebar.
- Migration guide page (covered by CHANGELOG note).

### Publish Strategy (DEC-v11-10-04)
**Direct to `latest` tag, no RC/beta dance.**

Both packages publish to `latest` directly. No `next` tag staging, no `beta` bake period.

**Rationale:**
- 234/234 tests, 99.78% statement coverage.
- 11/11 verification dimensions PASS across all 4 code phases (6/7/8/9).
- Code review clean: 0 critical / 1 BLOCKER caught and fixed (Phase 8 CR-01) / all warnings resolved.
- Backward compat invariant proven: when `embeddings` unset, search path is byte-identical to v1.0.
- Adapter is opt-in (sibling package, not a runtime dep of core).
- RC tags add friction without proportional value at this maturity level.
- Safety net: `npm unpublish` within 72h if a critical issue surfaces. (Practical only for first-publish; we'll be cautious for the first 72h post-publish.)

**Recovery plan (if catastrophic regression discovered post-publish):**
- Within 72h: `npm unpublish @llvs/mcpack@1.1.0` and `@llvs/mcpack-embeddings@1.1.0`. Authors can republish only after 24h cooling.
- After 72h: deprecate via `npm deprecate @llvs/mcpack@1.1.0 "<reason>"`. Cut a 1.1.1 patch. v1.0 stays available.
- Both options are post-incident — not a planned operation.

### Board Approval Gating (governance.md — billing/publish are board-locked)
Plan 10-03 includes a `autonomous: false` checkpoint task at the publish step. The orchestrator will pause Plan 10-03 mid-execution and surface the pre-publish checklist for board review. Board approval is required before any `npm publish` call executes.

If board rejects: Plan 10-03 halts, no publish happens, the issue is captured as a deferred item, plans can be re-cut to address it.

### Five [BLOCKING] Phase Gates (carry-forward; baseline advances to current main HEAD post-Phase-9)
Baseline reference: `d732eaa` (Phase 9 close-out commit). Planner pins exact SHA at plan-time.

- **Gate 1 (zero-new-core-deps):** root `package.json` `dependencies` and `peerDependencies` UNCHANGED from baseline. Phase 10 should NOT add deps to either package.
- **Gate 2 (public-API additive-only):** `src/index.ts` exports UNCHANGED from baseline. Phase 10 makes ZERO source code changes; this gate is trivially preserved.
- **Gate 3 (adapter-isolation):** `grep -rE "@llvs/mcpack-embeddings|@huggingface/transformers|@xenova/transformers" src/ test/` returns ZERO matches. Trivially preserved (no source changes).
- **Gate 4 (baseline tests byte-identical):** all pre-Phase-10 test files unchanged. Phase 10 may add NEW test files in `test/harness/` (e.g., the 50-query intent benchmark) but MUST NOT edit existing test files.
- **Gate 5 (wire-protocol exposure ban):** `grep -E "setRequestHandler.*[Aa]nalytics|tools[/\\.]list.*[Aa]nalytics" src/` returns ZERO matches. Trivially preserved.

### Phase 10 NEW Quality Gates
Two additional gates specific to Phase 10:

- **Gate 6 (PRD success criteria met):** the four numerical targets from PRD §"Success Criteria — v1.1" must hold:
  - Stripe harness: ≥80.7% aggregate token reduction with hybrid ranking
  - 50-query intent benchmark: ≥15% recall@5 improvement over v1.0
  - search_tools p99: within 50ms of v1.0 baseline (with local MiniLM)
  - Semantic index build: ≤5s for 50-tool server (with local MiniLM)
- **Gate 7 (registry resolution proof):** post-publish, a fresh `npm install @llvs/mcpack @llvs/mcpack-embeddings` in a temp dir resolves both packages, instantiates the engine with MiniLM, and runs a 5-line smoke test successfully.

### Carry-Forward Code Review Items (advisory, deferred to v1.1 polish or v1.2)
Phase 8 INFOs (3) and Phase 9 INFOs (4) remain deferred. They are NOT blockers for v1.1 GA. Document them in CHANGELOG under "Known limitations / future work" if any are user-visible (most are internal).

### Claude's Discretion
- Exact filename for the release report (`v1.1-release-report.md` vs `release-reports/v1.1.md` vs phase-dir-only). Recommendation: phase dir for canonical record + a short note in CHANGELOG with the headline numbers.
- Exact filename for benchmark queries JSON. Recommendation: `test/harness/intent-benchmark-queries.json` (sibling to `stripe-harness.ts`).
- Exact filename for benchmark runner. Recommendation: `test/harness/intent-benchmark.ts`.
- `npm run benchmark` script name. Alternative: `npm run intent-benchmark`. Either works.
- Whether to add a `prepublishOnly` script that runs typecheck/build/test before every publish. Recommendation: yes — defense in depth, prevents accidental publish of stale dist/.
- Adapter package's README content depth. Recommendation: install + usage + 1 working example + peer-dep note + perf characteristics. Don't duplicate core README content.
- Whether to publish from a clean CI runner vs locally. Recommendation: local first for v1.1 (operator owns publish creds anyway); migrate to CI-driven publish in v1.2 alongside Phase 999.1 CI/CD.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project foundation
- `.planning/PROJECT.md`
- `.planning/REQUIREMENTS.md` (R3 block — REQ-v11-test-coverage-floor; § "Success Criteria — v1.1")
- `.planning/ROADMAP.md` (Phase 10 goal + 6 Success Criteria)
- `./CLAUDE.md` (quality gates; commit format; ESM-only)
- `./PLAYBOOK.md` (current sprint, acceptance criteria, governance gates)
- `./governance.md` (board-locked operations — `npm publish` is board-locked)

### Phase 6 + 7 + 8 + 9 carry-forward (lock points + measurement baselines)
- `.planning/phases/06-embedding-provider-interface-v1-1/06-CONTEXT.md` (sibling-package layout, version bump 1.0.0→1.1.0)
- `.planning/phases/07-semantic-index-build-pipeline-v1-1/07-CONTEXT.md` (build lifecycle, build-pending fallback)
- `.planning/phases/08-hybrid-ranking-query-path-v1-1/08-CONTEXT.md` (hybrid scoring, role-filter-after-rank)
- `.planning/phases/09-tool-usage-analytics-v1-1/09-CONTEXT.md` (analytics, Gate 5 wire-protocol exposure ban)
- `.planning/phases/09-tool-usage-analytics-v1-1/09-VERIFICATION.md` (11/11 dimension Phase 9 reference)

### Existing harness infra (Plan 10-01 extends)
- `test/harness/stripe-harness.ts` — current Stripe MCP harness (v1.0; produces 80.7% token-reduction report). Phase 10 reruns this with hybrid enabled.
- `package.json` `npm run harness` script — invokes Stripe harness via `npx tsx`.
- `test/harness/intent-benchmark.ts` (NEW Phase 10) — sibling to stripe-harness; measures recall@5.
- `test/harness/intent-benchmark-queries.json` (NEW Phase 10) — 50 hand-authored queries.

### Source code (READ-ONLY in Phase 10)
- `src/` and `test/` are FROZEN for Phase 10 — no source changes. Gates 1-5 enforce this.

### Docs (Plan 10-02 modifies)
- `README.md` (root) — v1.1 quick-start additions
- `CHANGELOG.md` (NEW)
- `docs/semantic-search.md` (NEW)
- `docs/analytics.md` (NEW)
- `packages/mcpack-embeddings/README.md` — verify exists or create

### Inbound PRD (board-locked)
- `.planning/inbox/processed/mcpack-prd-v1.1-gsd.md` (§"Success Criteria — v1.1" — 4 numerical gates)

</canonical_refs>

<specifics>
## Specific Ideas

### Stripe MCP harness rerun
The existing harness measures token reduction by comparing the bytes returned from `tools/list` (full schema dump) vs the bytes returned from MCPack's `tools/list` (one tool, `search_tools`) plus a representative `search_tools` call. v1.0 produced 80.7%. Phase 10's measurement: rerun with `embeddings` configured (MiniLM via adapter) and verify the number is ≥80.7%. The hybrid ranker shouldn't change token count materially — it just reorders results. The 80.7% should hold trivially.

### 50-query intent benchmark structure
Hand-author queries with intent diversity:
- 10 "easy keyword match" queries (e.g., "create customer" → `customers.create`) — both v1.0 and hybrid should hit these.
- 20 "paraphrased intent" queries (e.g., "set up a new buyer" → `customers.create`) — hybrid should improve.
- 10 "domain abbreviation" queries (e.g., "revoke sub" → `subscriptions.cancel`) — hybrid should improve.
- 10 "tool-name typo or partial" queries (e.g., "stripe customer search" — multiple plausible tools) — hybrid should help disambiguate.

Recall@5 metric: for each query, the expected tool is in the top-5 results. v1.1 hybrid recall@5 must be ≥15% above v1.0 keyword recall@5.

### Pre-publish checklist (Plan 10-03 expansion)
- `npm pack --dry-run` for root package — review the included files. Should be: `dist/`, `LICENSE`, `README.md`, `package.json`. Should NOT include `src/`, `test/`, `.planning/`, `node_modules/`.
- `npm pack --dry-run` for adapter package — review the included files. Should be: `dist/`, `LICENSE`, `README.md`, `package.json`.
- Verify `package.json files:` matches actual ship surface.
- License: confirm both packages have `LICENSE` file at root. (Currently the root has license from v1.0; adapter may need to be added.)
- Repository, author, license fields populated in both `package.json`.
- README sync: both READMEs must reflect v1.1 features and not contradict each other.

### Performance measurement methodology
Phase 7's `5s for 50-tool MiniLM` and Phase 8's `50ms p99` are unit-test bounds against MOCK providers. Phase 10 measures against the REAL MiniLM via `@huggingface/transformers`. Methodology:
- Build the real engine with `embeddings: { provider: createMiniLMProvider() }`.
- Generate 50 mock tools with realistic name/description/params.
- Time the index build (constructor → isIndexReady() → hasVectors()).
- Time 100 search_tools calls (warm cache); compute p99.
- Compare to v1.0 path (no embeddings) p99 — must be within 50ms.

This measurement runs in CI / locally, not in production. Phase 10 records the numbers; Phase 999.1 (CI/CD) automates the gate.

</specifics>

<deferred>
## Deferred Ideas

- **Full docs site restructure** — multi-version navigation, sidebar reorg, migration guide page. v1.2 candidate when Partner Hub adds enough surface area.
- **Search engine direction ADR** (REQ-v12-search-engine-direction) — already deferred to v1.2 ADR; must be authored and accepted before v1.2 Phase 1.
- **CI-driven publish** — Phase 10 publishes locally. Phase 999.1 (CI/CD) would migrate to CI-runner publish with secrets management.
- **Persistent analytics export** — OTEL/file/webhook deferred from v1.1 to v1.2 candidate set per PRD non-goals.
- **Phase 8 INFOs (3) + Phase 9 INFOs (4)** — code-quality polish items. Promote to Phase 999.x backlog if they accumulate weight before v1.2 ships.
- **`npm unpublish` automation** — manual recovery operation for v1.1; not worth automating.

</deferred>

---

*Phase: 10-harness-coverage-docs-npm-publish-v1-1*
*Context gathered: 2026-04-27 via /gsd-discuss-phase*
