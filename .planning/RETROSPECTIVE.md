# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MCPack

**Shipped:** 2026-03-23
**Phases:** 5 | **Plans:** 10 | **Timeline:** 4 days (Mar 19-22)

### What Was Built
- Complete lazy tool discovery library with keyword search, session tracking, and role-based access
- Two entry points: wrap mode (existing servers) and build mode (new servers) sharing same engine
- 100 tests at 99.56% coverage, Stripe MCP harness proving 80.7% token reduction
- Product landing page with LoomLabs branding, published to npm as @llvs/mcpack@1.0.0

### What Worked
- Phase-by-phase approach kept scope tight — each phase built on the last without rework
- Real Stripe MCP harness gave credible, specific numbers (not estimates)
- Existing test coverage was already high (98%) before the testing phase — TDD during earlier phases paid off
- AgentWatch pattern reuse for docs site saved significant design time

### What Was Inefficient
- Stripe harness env var mismatch (STRIPE_API_KEY vs STRIPE_SECRET_KEY) — could have checked Stripe MCP docs upfront
- StdioClientTransport env inheritance issue required a second fix — should have tested harness end-to-end before committing
- zod and @cfworker/json-schema listed as peer deps unnecessarily — caught at publish time, should have audited earlier

### Patterns Established
- LoomLabs brand tokens (CSS custom properties) reusable across projects
- MkDocs Material + overrides pattern for product landing pages
- Harness pattern: real MCP server → buildIndex → scoreAndRank → JSON report

### Key Lessons
- Test with real credentials before declaring a harness "complete"
- Audit peer dependencies against actual imports before v1 — don't carry SDK transitive deps
- Package name availability check should happen at project start, not publish time

## Cross-Milestone Trends

| Milestone | Phases | Plans | Days | LOC (src) | Tests |
|-----------|--------|-------|------|-----------|-------|
| v1.0 | 5 | 10 | 4 | 946 | 100 |
