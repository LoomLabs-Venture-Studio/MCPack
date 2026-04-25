---
phase: 04
phase_name: "testing-and-integration-harness"
project: "MCPack"
generated: "2026-04-25"
counts:
  decisions: 8
  lessons: 5
  patterns: 4
  surprises: 3
missing_artifacts:
  - "UAT.md"
---

# Phase 04 Learnings: testing-and-integration-harness

## Decisions

### Exclude `src/index.ts` Barrel from Coverage
The vitest coverage config explicitly excludes `src/index.ts` because it is a re-export barrel with no logic to test. Coverage `include` is scoped to `src/**/*.ts` with the barrel listed under `exclude`.

**Rationale:** Including the barrel would suppress aggregate coverage numbers without any test value — the file contains only re-exports.
**Source:** 04-01-PLAN.md, 04-01-SUMMARY.md

### Accept `types.ts` at 0% Coverage
The `src/types.ts` file is allowed to remain at 0% coverage and is not flagged as a gap.

**Rationale:** It contains only TypeScript type definitions with no runtime code, so there is nothing executable for v8 coverage to measure.
**Source:** 04-01-SUMMARY.md, 04-VERIFICATION.md

### Use v8 Coverage Provider
Coverage is configured with `provider: 'v8'`, leveraging the already-installed `@vitest/coverage-v8` devDependency.

**Rationale:** Per D-05, v8 was already in devDependencies and is the native vitest coverage provider — no extra deps needed.
**Source:** 04-01-PLAN.md

### Audit Existing Tests Rather Than Rewrite
Plan 01 mandated auditing the 7 existing test files for edge case gaps and adding only missing tests, rather than rewriting the suite from scratch.

**Rationale:** Coverage was already at 98.25% before Phase 04 began (TDD during earlier phases paid off). Rewriting would add risk without value.
**Source:** 04-01-PLAN.md (D-02), RETROSPECTIVE.md

### Harness Runs Outside Vitest via `npx tsx`
The Stripe harness is a standalone `tsx`-executed script at `test/harness/stripe-harness.ts`, deliberately not named `*.test.ts` so vitest does not pick it up. It runs only via `npm run harness`.

**Rationale:** Per D-07, integration harness needs network + external process and shouldn't run on every `npm test`. Keeping it separate avoids slowing or destabilizing the unit suite.
**Source:** 04-02-PLAN.md, 04-02-SUMMARY.md

### Token Estimation via `chars / 4` Approximation
Token counts in the harness report are computed as `Math.ceil(chars / 4)` rather than using a real tokenizer.

**Rationale:** Per D-15, no LLM tokenizer dependency was added. Per D-16, an explicit disclaimer note is included in both console output and the JSON report stating numbers are character counts, not real LLM tokens.
**Source:** 04-02-PLAN.md, 04-02-SUMMARY.md

### Five Queries Spanning Distinct Stripe API Domains
The harness ships 5 fixed queries: "create a payment", "manage customers", "subscription billing", "issue refund", "list invoices".

**Rationale:** Per D-09, queries deliberately span 5 different Stripe API domains (payments, customers, subscriptions, refunds, invoicing) to give credible diversity in the reduction numbers.
**Source:** 04-02-PLAN.md, 04-02-SUMMARY.md

### Graceful Skip on Missing API Key (Exit 0)
When `STRIPE_API_KEY` is unset, the harness prints a skip message and `process.exit(0)` rather than failing.

**Rationale:** Per D-10, the harness must be safe to invoke in environments without credentials (CI, fresh clones) without producing red errors. The generated `report.json` is also gitignored.
**Source:** 04-02-PLAN.md, 04-02-SUMMARY.md

---

## Lessons

### MCP SDK Env Var Conventions Need Up-Front Verification
The harness was initially built to pass `STRIPE_API_KEY` into the spawned Stripe MCP process, but the Stripe MCP server expects `STRIPE_SECRET_KEY` (matching Stripe's own convention). This required a fix after the fact.

**Context:** Discovered post-implementation; flagged in retrospective as a generalizable lesson — check the upstream MCP server's env var conventions before wiring spawn arguments.
**Source:** RETROSPECTIVE.md, STATE.md (Blockers/Concerns)

### `StdioClientTransport` Env Inheritance Required a Second Fix
A second bug surfaced because `StdioClientTransport` did not inherit the host process env to the spawned Stripe MCP child by default — credentials had to be passed explicitly through the transport's env option.

**Context:** Caught only when running end-to-end with a real key. Retrospective lesson: test harness end-to-end with real credentials before declaring it "complete."
**Source:** RETROSPECTIVE.md

### Pre-Existing Wrap Test Failure Surfaced Mid-Phase
While building the harness in Plan 02, a wrap.test.ts test failure was observed that was unrelated to the harness work. Per scope rules it was not fixed in this plan.

**Context:** The failure was tied to null-arguments handling in wrap mode — the MCP SDK validates arguments at the protocol level with Zod, rejecting null before MCPack's handler ever runs. Plan 01 had already removed an analogous test for the same reason.
**Source:** 04-02-SUMMARY.md, 04-01-SUMMARY.md

### Existing Coverage Was Already Above the Bar
Going into Phase 04, statement coverage was already 98.25% — well past the 75% target — because of TDD during Phases 01-03. The audit added only 9 tests to reach 99.56%.

**Context:** Validated the phase-by-phase TDD approach. Heavy testing infrastructure work in Phase 04 was unnecessary; the audit alone satisfied TEST-01.
**Source:** 04-01-SUMMARY.md, RETROSPECTIVE.md

### Some Uncovered Lines Are Intentionally Unreachable
`wrap.ts` line 59 (the `fakeExtra.sendRequest` throw path) cannot be exercised in tests because the SDK validates requests at the protocol level before they reach that branch. This was documented as an accepted gap, not a bug.

**Context:** Helped distinguish "missing test" from "intentionally defensive code path" during the audit, preventing wasted effort chasing 100% on `wrap.ts`.
**Source:** 04-01-SUMMARY.md, 04-VERIFICATION.md

---

## Patterns

### Real-Server Integration Harness (buildIndex → scoreAndRank → JSON Report)
A standalone TypeScript script that connects to a real upstream MCP server via `StdioClientTransport`, calls `client.listTools()` for the vanilla payload, runs a fixed query set through `buildIndex` + `scoreAndRank`, and writes a JSON report with per-query and aggregate metrics.

**When to use:** Whenever a token-reduction or filtering claim needs credible numbers from a real MCP server rather than a mocked tool list. Reusable across other MCP integrations (not just Stripe).
**Source:** 04-02-PLAN.md, 04-02-SUMMARY.md, RETROSPECTIVE.md

### Env-Gated Standalone Script with Clean Skip
Pattern for any optional integration script: check the required env var at start, print a clear "set X to run" message, and `process.exit(0)`. Combined with gitignoring the generated report, this lets the script live in the repo without breaking CI or fresh clones.

**When to use:** Integration scripts that need external credentials but should be safe to invoke unconditionally (`npm run harness` should never error in dev).
**Source:** 04-02-PLAN.md, 04-02-SUMMARY.md

### Coverage Config: v8 + `src/**/*.ts` Include + Barrel Exclude
The shape `{ provider: 'v8', include: ['src/**/*.ts'], exclude: ['src/index.ts'] }` produces clean coverage output focused on real production logic and is reusable for other TS library projects with a barrel entry point.

**When to use:** Any TypeScript library with a `src/index.ts` barrel where coverage should reflect logic-bearing modules only.
**Source:** 04-01-PLAN.md, 04-01-SUMMARY.md

### Per-Query + Aggregate Report Schema
The `HarnessReport` shape — a `queries[]` array of per-query records plus an `aggregate` summary, both denominated in chars and chars/4 token estimates with an explicit disclaimer note — is the canonical format for token-reduction reporting in MCPack.

**When to use:** Any future harness (e.g., another MCP target, alternative search algorithm benchmark) that needs to compare vanilla vs. filtered tool listing payloads.
**Source:** 04-02-PLAN.md, 04-02-SUMMARY.md

---

## Surprises

### Stripe MCP Uses `STRIPE_SECRET_KEY`, Not `STRIPE_API_KEY`
The plan and acceptance criteria all referenced `STRIPE_API_KEY`, matching Stripe Dashboard nomenclature, but the actual Stripe MCP server expects `STRIPE_SECRET_KEY`. The mismatch surfaced only when running with a real key.

**Impact:** Required a follow-up fix in the harness after the phase summary claimed "no deviations." Generalized into a retrospective rule: verify upstream MCP server env conventions before wiring spawn args.
**Source:** RETROSPECTIVE.md, STATE.md

### Zod Validation in the SDK Pre-empted Several Edge Case Tests
The intuitive "what if a caller sends `null` arguments?" test could not be written meaningfully because the MCP SDK rejects malformed payloads at the protocol layer with Zod before any MCPack handler runs. This was hit twice — once during the audit (test removed) and once as a pre-existing failure during Plan 02.

**Impact:** Reframed how MCPack thinks about input validation tests — only behaviors reachable past SDK validation are testable at the MCPack layer.
**Source:** 04-01-SUMMARY.md, 04-02-SUMMARY.md

### Audit Added Only 9 Tests but Lifted 4 Modules to 100%
Despite starting at 98.25% statements, the targeted edge-case audit (empty inputs, MAX_LIMIT, TTL boundaries, no-handler edge cases, direct `markToolLoaded` tests) was enough to bring `index-builder`, `search`, `session`, `roles`, and `core` to 100% across all metrics — not a uniform spread of small gains.

**Impact:** Confirms that residual coverage gaps tend to cluster in a few well-defined edge categories rather than being randomly distributed; future audits can target those categories first.
**Source:** 04-01-SUMMARY.md, 04-VERIFICATION.md
