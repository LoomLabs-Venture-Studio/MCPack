---
phase: 05
phase_name: "documentation-and-release-prep"
project: "MCPack"
generated: "2026-04-25"
counts:
  decisions: 7
  lessons: 4
  patterns: 4
  surprises: 2
missing_artifacts:
  - "UAT.md"
---

# Phase 05 Learnings: documentation-and-release-prep

## Decisions

### Lean README structure with no badges, logos, or contributing section
The README was deliberately scoped to: title + motivation, install, wrap mode, build mode, before/after, token reduction, roadmap, spec link, license. No CI/coverage badges, no logo, no Contributing section.

**Rationale:** Per D-03 — keep the public-facing surface focused on what the package does and the proof numbers, not on project-management ornamentation typical of larger OSS projects.
**Source:** 05-01-PLAN.md, 05-01-SUMMARY.md, STATE.md

### Hardcode token reduction numbers from report.json rather than dynamically generate
README and the harness console-output block embed exact numbers (87.5%, 76.1%, 60.6%, 90.4%, 89%, aggregate 80.7%) copied directly from `test/harness/report.json` at write time, not regenerated.

**Rationale:** The numbers are a proof artifact, not live data. Hardcoding makes the README self-contained and verifiable by `diff`/`grep` without any runtime dependency on the harness.
**Source:** 05-01-SUMMARY.md, 05-01-PLAN.md (acceptance criteria)

### Spec lives at canonical /spec/mcpack-spec-v1.md, copied (not moved) from repo root
`mcpack-spec-v1.md` was copied from the repo root to `spec/mcpack-spec-v1.md` (per D-19). README links the canonical `spec/` location.

**Rationale:** Establishes a stable, conventional location (`spec/`) for protocol references that future versions (v2 binary encoding) can extend, while preserving git history at the original path during transition.
**Source:** 05-01-PLAN.md (Task 1)

### Copy README.md to docs/index.md instead of using a symlink
docs/index.md is a verbatim file copy of README.md, not a symlink.

**Rationale:** Per D-15 — symlinks break in CI runners and inside MkDocs build contexts. A copy guarantees consistent rendering regardless of platform. The CI workflow re-copies on every deploy to keep them synced.
**Source:** 05-02-PLAN.md, 05-02-SUMMARY.md, STATE.md

### README is the single source of truth; docs/index.md is a rendering copy
Per D-23, README.md is canonical. docs/index.md is regenerated from README on every CI deploy via a `cp README.md docs/index.md` step inside the workflow, before `mkdocs gh-deploy`.

**Rationale:** Avoids dual-source drift. Anyone editing the README does not have to remember to also edit docs — the CI guarantees sync.
**Source:** 05-02-PLAN.md (Task 2 action), 05-02-SUMMARY.md

### MkDocs Material theme with default palette and minimal nav
mkdocs.yml uses `theme.name: material`, `palette.scheme: default`, single-entry nav (`Home: index.md`), pointed at the LoomLabs GitHub Pages URL.

**Rationale:** Per D-14, D-16, D-18 — Material is the de-facto MkDocs theme; default palette avoids bikeshedding; single-page nav matches the README-as-source-of-truth model.
**Source:** 05-02-PLAN.md (Task 1 action)

### Three-block story pattern for each usage mode in README
Both wrap and build mode sections follow: Block 1 (TypeScript setup code), Block 2 (example `search_tools` request JSON), Block 3 (example response JSON showing `loaded: true`/`loaded: false` session behavior).

**Rationale:** Per D-04, D-05, D-06, D-07 — gives readers the full call/response loop in one scan, including the session-aware schema delivery that's the core novelty of the library.
**Source:** 05-01-PLAN.md (Task 2 action), 05-01-SUMMARY.md

---

## Lessons

### Audit peer dependencies against actual imports before publishing
zod and `@cfworker/json-schema` were listed as peer deps but not actually imported by the library. This was caught at npm publish time — too late.

**Context:** Phase 05 was the final phase before ship, so peer-dep hygiene fell to the release prep. The retrospective explicitly flags this as a forward-looking lesson: audit peer deps earlier (at v1 cut, not at publish).
**Source:** RETROSPECTIVE.md, CLAUDE.md (Known Issues / retro flag)

### Package name availability should be checked at project start, not publish time
The `mcpack` name was already taken on npm by a Minecraft datapack helper. The package was renamed to `@llvs/mcpack@1.0.0` to use the LoomLabs npm scope.

**Context:** Discovered during Phase 05 release prep, forcing a late rename. Cleaner to claim the namespace on day one of the project.
**Source:** RETROSPECTIVE.md, project context (rename note)

### Test harnesses end-to-end with real credentials before declaring "complete"
Two harness issues surfaced during release prep that should have been caught earlier: STRIPE_API_KEY vs STRIPE_SECRET_KEY env-var mismatch, and StdioClientTransport env inheritance — each required a separate fix.

**Context:** Phase 05 is downstream of the harness work but exposed it because release prep relies on the harness numbers being reproducible. Lesson generalizes: real-credential E2E is not optional before claiming a measurement artifact is final.
**Source:** RETROSPECTIVE.md ("What Was Inefficient")

### MkDocs gh-deploy success is unverifiable without live GitHub Pages setup
Codebase verification can confirm workflow shape, sync step, and theme config — but actually-deploys-and-renders requires a live repo with Pages enabled. Phase 05 verification explicitly noted this as out-of-scope.

**Context:** Important to call out the gap between "config looks right" and "site is live" so that v1.0 ship checklist includes a manual Pages-enabled visit.
**Source:** 05-VERIFICATION.md ("Human Verification Required")

---

## Patterns

### CI sync step ahead of doc-site build
The GitHub Actions docs workflow runs `cp README.md docs/index.md` as a step before `mkdocs gh-deploy --force`, so README edits flow into the docs site even if the human forgot to update docs/.

**When to use:** Any project where a README and a doc-site landing page should stay identical — preserves a single source of truth without enforcing manual discipline on every contributor.
**Source:** 05-02-PLAN.md (Task 2), 05-02-SUMMARY.md (patterns-established)

### README three-block story per usage mode
Each public-API mode is documented as setup code → example request → example response, with the response demonstrating the differentiating behavior (here: session-aware `loaded: true/false`).

**When to use:** Libraries with request/response semantics where the protocol surface is the key teaching moment. Reader sees the full loop without scrolling between sections.
**Source:** 05-01-SUMMARY.md (patterns-established)

### Path-scoped CI triggers for docs deploys
Workflow triggers only on push to main with paths matching `docs/**`, `mkdocs.yml`, or `README.md` — not every push.

**When to use:** Any docs/site CI that should not rebuild on unrelated source changes. Reduces queue noise and keeps gh-pages history meaningful.
**Source:** 05-02-PLAN.md (Task 2 workflow YAML)

### File copy over symlink for CI-rendered artifacts
Anywhere a build pipeline or static-site generator consumes a "shadow" of another file, prefer a real copy synced by CI rather than a symlink.

**When to use:** MkDocs, Jekyll, Docusaurus, any platform where symlink resolution differs across runners or generators. Pair with a CI sync step to avoid drift.
**Source:** 05-02-SUMMARY.md (Decisions Made)

---

## Surprises

### Phase 05 had no UAT and no research/validation phase
Phase 05 ships without a VALIDATION.md (Nyquist scan flagged it as "missing — no research phase, validation not created"). All other phases (01–04) at least produced a validation file; Phase 05 documentation work didn't fit the validation rubric.

**Impact:** Milestone audit recorded Phase 05 under "missing_phases" for Nyquist compliance, contributing to the milestone's overall "partial" Nyquist rating despite passing all functional requirements. Suggests doc/release-prep phases need a separate verification rubric or should be exempt.
**Source:** v1.0-MILESTONE-AUDIT.md (Nyquist Compliance table)

### Both Phase 05 plans completed in 1 minute each
05-01 (README + spec copy) ran 22:48:44Z → 22:49:52Z; 05-02 (MkDocs + workflow) ran 22:51:15Z → 22:52:05Z. Each plan finished with zero deviations and zero issues.

**Impact:** The lean structure (D-03), hardcoded numbers (no harness re-run needed), and copy-not-symlink decisions made the work mechanical. Validates that pre-decided structure (logged as D-01 through D-23 in PLAN context) collapses execution time — the planning artifacts are doing most of the work.
**Source:** 05-01-SUMMARY.md, 05-02-SUMMARY.md (Performance sections)
