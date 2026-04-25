# Project Onboarding — MCPack

**Date:** 2026-04-23
**Initialized by:** Loom Labs Agent Kit (loom-labs skill)

## Synopsis

- **Stack:** TypeScript (strict, NodeNext ESM, ES2022) • Node ≥18 • Vitest 4 + v8 coverage • `@modelcontextprotocol/sdk` peer dep (sole runtime dep) • MkDocs Material for docs • npm registry + GitHub Pages
- **Architecture:** Single library with two public entry points (`mcpack` wrap mode, `createMCPackServer` build mode) sharing one `MCPackEngine` core. Clean module split: `index-builder`, `search`, `session`, `roles`, `core`, `wrap`, `build`, `types`. Tests mirror 1:1.
- **State:** **Healthy.** v1.0 shipped 2026-03-23 as `@llvs/mcpack@1.0.0`. 946 LOC src, 1,846 LOC tests, 100 tests @ 99.56% statement coverage, 80.7% token reduction proven on real Stripe MCP (28 tools).
- **Test coverage:** Excellent (99.56% statements). Every src module has a dedicated test file plus a real-integration harness against Stripe MCP.
- **Documentation:** Complete. README is canonical; `docs/index.md` mirrors it. Full spec at `spec/mcpack-spec-v1.md`. GSD planning tree under `.planning/` captures every phase decision.

## Files Generated/Updated

| File | Action |
|------|--------|
| `CLAUDE.md` | **Rewritten** — was an unfilled placeholder template; now reflects real stack, architecture, patterns, commands |
| `PLAYBOOK.md` | **Rewritten** — was an unfilled placeholder template; now has real build commands and quality gates |
| `.claude/agents/` | **Created** — cto, engineer, qa, devops, heartbeat agent definitions copied from `~/.claude/skills/loom-labs/agents/` |
| `.gitignore` | **Updated** — added `.claude/agents/` and `.loom/local.yml` |
| `.loom/config.yml` | **Updated** — tooling manifest + harness list populated; `last_setup` refreshed |
| `docs/ONBOARDING.md` | **Created** — this file |

## Pre-Onboarding Repair

Local `main` was **88 commits behind `origin/main`** with only `LICENSE` tracked at HEAD. Untracked working-tree files included a wrong `package.json` referencing `luisbs/mcpack` (a Minecraft-datapack helper — unrelated) plus placeholder CLAUDE.md/PLAYBOOK.md from an aborted earlier run. All untracked local files were backed up to `/tmp/mcpack-preonboard-backup-20260423-222636/` then the colliding wrong files were removed and `git pull --ff-only` brought local in sync with the real project.

## Harness

- **Detected:**
  - GSD v2 — via `~/.claude/skills/gsd-*` skills (and the repo already has active `.planning/` artifacts from v1.0)
  - Ruflo — at `/opt/homebrew/bin/ruflo`
- **Selected:** **GSD v2** (already in use; `.planning/` tree holds v1.0 history and a Phase 999.1 CI/CD backlog item). Recorded in `PLAYBOOK.md` Current Sprint and `.loom/config.yml`.

## Tooling Manifest

| Service | Tool | Status |
|---------|------|--------|
| GitHub | `gh` | ✓ `/opt/homebrew/bin/gh` |
| npm registry | `npm`, `node`, `npx` | ✓ |
| Runtime alt | `bun` | ✓ `/Users/zaid/.bun/bin/bun` (project uses npm; bun available if needed) |
| Git | `git` | ✓ |
| Railway hosting | `railway` | ✓ (unused by MCPack — library only) |
| Supabase | `supabase` | ✓ (unused by MCPack) |
| Stripe | `stripe` | ✓ (used indirectly via Stripe MCP server in harness) |
| Redis | `redis-cli` | ✓ (unused by MCPack) |
| TypeScript runner | `tsx` | ✗ not global — not needed, harness uses `npx tsx` |
| Clerk | Clerk CLI | ✗ not installed — not used |

## Known Issues

None outstanding. Per `.planning/STATE.md` and `.planning/RETROSPECTIVE.md`:

- v1.0 shipped clean with no open bugs
- **Backlog Phase 999.1:** GitHub Actions CI pipeline (lint/typecheck/vitest on PRs) — requirements TBD
- **Retro lessons** for next milestones: verify MCP-SDK env var conventions up front; audit peer deps against actual imports before publishing

## Recommended First Actions

1. **Decide next milestone.** v1.0 is shipped; v1.1 (semantic search, tool usage analytics) and v2.0 (binary encoding) are on the roadmap but have no PRD. Board picks direction or promotes Phase 999.1 from backlog.
2. **Promote Phase 999.1 if CI is the priority.** Run `/gsd-review-backlog` then `/gsd-plan-phase 999.1` to scope the GitHub Actions pipeline.
3. **Run `npm install && npm test`** to confirm the local toolchain still reproduces the 100/100 green baseline before any new work begins.
