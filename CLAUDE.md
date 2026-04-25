# MCPack — Project Context

## What This Is
MCPack is a TypeScript library (`@llvs/mcpack`) that provides RBAC + lazy, queryable, session-aware tool discovery for MCP servers. Instead of dumping every tool schema on connect, MCPack exposes a single `search_tools` tool that returns only schemas the caller's role permits, ranked by relevance. Ships in two modes: **wrap** (retrofit an existing MCP server in one call) and **build** (construct a new server with RBAC baked in). Published v1.0 to npm on 2026-03-23; on a real Stripe MCP (28 tools) it produced 80.7% aggregate token reduction.

**Site:** https://loomlabs-venture-studio.github.io/MCPack/
**Repo:** LoomLabs-Venture-Studio/MCPack
**Revenue:** Pre-revenue OSS library. Monetization potential flagged in PROJECT.md; public-facing assets (README, docs site, landing page) optimized for visual impact.

## Stack
- **Language:** TypeScript (strict, `verbatimModuleSyntax`, `NodeNext` modules, ES2022 target)
- **Runtime:** Node.js >= 18, ESM only (`"type": "module"`)
- **Peer dependency:** `@modelcontextprotocol/sdk ^1.0.0` (sole runtime dep)
- **Testing:** Vitest 4.x with v8 coverage; real Stripe MCP integration harness via `npx tsx`
- **Docs:** MkDocs Material, deployed to GitHub Pages via `.github/workflows/docs.yml`
- **Package Manager:** npm (package-lock.json committed). `bun` available locally but the project ships via npm.
- **Hosting:** npm registry (`@llvs/mcpack`) + GitHub Pages for docs. No application server — library only.

## Architecture
```
src/
├── index.ts            # public entry: mcpack(), createMCPackServer(), types
├── wrap.ts             # wrap mode — intercept setRequestHandler on existing Server
├── build.ts            # build mode — construct new Server with dispatch map
├── core.ts             # MCPackEngine — composes index/search/session/roles
├── index-builder.ts    # Tool → ToolIndexEntry (tokenize + STOP_WORDS)
├── search.ts           # 5-tier weighted keyword scoring
├── session.ts          # session registry, sliding TTL, dual cleanup
├── roles.ts            # role filter, wildcard + hierarchical inheritance, cycle protection
└── types.ts            # shared types, public type exports

test/                   # 8 test files, 100 tests @ 99.56% statement coverage
├── harness/
│   └── stripe-harness.ts   # real Stripe MCP → token-reduction JSON report
└── *.test.ts               # one per src module

spec/mcpack-spec-v1.md  # protocol + architecture reference
docs/                   # MkDocs site (index.md mirrors README)
.planning/              # GSD artifacts (phases, plans, verifications, retro)
```

## Key Patterns
- **Handler replacement over proxy.** Wrap mode walks the SDK `Server`'s private `_requestHandlers` Map and swaps the `tools/list` and `tools/call` handlers — no extra server layer. Defensive check with a clear error if the shape ever changes.
- **Two modes, one engine.** `wrap.ts` and `build.ts` both construct a single `MCPackEngine` (core.ts). All RBAC + search + session logic lives there; the mode files are thin adapters.
- **Single discovery tool.** `tools/list` always returns exactly one tool: `search_tools`. Callers query by keywords; engine returns role-filtered, relevance-ranked schema matches.
- **Deliberately opaque denial.** Out-of-role `tools/call` returns `"Unknown tool: {name}"` — restricted tools are invisible, not just blocked.
- **Session-gated schema delivery.** Schemas loaded once per session return as `{loaded: true}` references on subsequent calls. In-memory only by design (v1.0).
- **Config snapshot at setup.** `mcpack()` clones config so external mutation after the call can't affect behavior.
- **Handlers always receive `MCPackHandlerContext`** — not optional. Empty tools array throws (developer mistake), doesn't warn.

## People
- **Org:** LoomLabs Venture Studio (GitHub: LoomLabs-Venture-Studio)
- **Board:** zmarji@gmail.com — approves merges, env vars, new deps, schema changes
- v1.0 delivered via GSD-driven phases (5 phases, 10 plans, 21 tasks, 4 days). All decisions logged in `.planning/PROJECT.md` "Key Decisions" table.

## Build Commands
```bash
npm install                  # install deps
npm run build                # tsc → dist/
npm run typecheck            # tsc --noEmit
npm test                     # vitest run --reporter=verbose
npm run test:coverage        # vitest + v8 coverage
npm run test:watch           # vitest watch
npm run harness              # npx tsx test/harness/stripe-harness.ts (needs STRIPE_SECRET_KEY)
```
No separate lint step — TypeScript `strict` + `verbatimModuleSyntax` is the lint layer.

## Git Rules
- Feature branches from `main`
- One commit per logical change
- Format: `type(scope): description` — scope commonly `(NN-NN)` or `(phase-NN)` for GSD-driven work, or `(harness)`, `(docs)`, etc.
- Draft PRs. Board approval to merge to `main`.
- Never force push `main` or shared branches.

## Known Issues
- v1.0 shipped clean; no outstanding bugs in `.planning/STATE.md`.
- **Backlog (Phase 999.1):** GitHub Actions CI/CD pipeline — lint, typecheck, vitest on PRs. Not yet scoped.
- **v1.1 on deck:** semantic/embedding search, tool usage analytics.
- **v2.0 future:** binary encoding layer.
- Retro (`.planning/RETROSPECTIVE.md`) flagged: check MCP SDK env-var conventions upfront; audit peer deps against actual imports before v1 cuts.

## Environment Variables
Runtime: **none required** by the library itself.
Harness: `STRIPE_SECRET_KEY` (passed through to spawned Stripe MCP process).
Docs deploy: `GITHUB_TOKEN` (provided by GitHub Actions).

Do NOT create, modify, or expose env vars without documenting in the PR and getting board approval.
