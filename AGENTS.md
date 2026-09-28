# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## Project Status

"From GenAI to Agentic AI": an engineering guide / curriculum for building, evaluating, and deploying production-grade AI agents. Milestone 1 implementation is underway: the root pnpm workspace, Turborepo graph, mise task interface, Biome/TypeScript policy, root Vitest/Stryker configuration, and the `@platform/ai-core` workspace scaffold (Vitest config, `PlatformError`) now exist; the remaining application and package source code is added by subsequent tasks. The finalized Japanese curriculum lives under `specs/curriculum/`, and requirements are split by milestone: `specs/001-agentic-ai-platform/` (platform foundation + M1, and the source of truth for shared constraints, test strategy and NFRs), `002-rag-and-workflows/` (M2), `003-domain-agents/` (M3), `004-harness-evals-safety/` (M4). The `001` requirements, plan, and tasks are approved and split by implementation wave (`tasks.md` holds the index and current wave; `tasks-w3.md`〜`tasks-w5.md` hold upcoming waves; W1 is complete in `tasks-comp-w1.md` and W2 is current; completed waves move to `tasks-comp-w*.md`). A successor spec is approved only after the previous milestone is implemented. The original design drafts have been removed; `specs/curriculum/changes-from-drafts.md` records what changed.

## Governance

`.sdd/memory/constitution.md` holds the non-negotiable principles (workflow vs. agent split, mandatory stop conditions, deterministic non-vacuous gate, test-first, sandboxed execution of LLM-generated code, milestone gates with human approval). Check designs and tasks against it; the specs remain the source of truth for individual requirements and numbers.

`.sdd/steering/` holds condensed, persistent project knowledge distilled from the specs and `001` plan: `product.md` (purpose, personas), `tech.md` (stack, key decisions, conventions, constraints), `structure.md` (code organization, naming, import rules, "where things go"). Read these first for a quick orientation; update them when an approved plan or implementation changes a decision. Review reports go in `.sdd/reviews/`.

## Tooling

- `mise.toml` pins Node.js 26.10.0, pnpm 12.6.0, and gitleaks 8.30.1; run tools through `mise` / `pnpm exec`.
- The mise task interface is defined. The current W1 `gate` runs Biome lint/format with a non-empty scan check, model-ID validation, the four W1 repository rules, and mock-mode tests for the root and each workspace with a `test` script (currently `@platform/ai-core`); later stages are connected at the wave-closing tasks listed in `001` `tasks.md`.
- Planned tasks (`001` plan C1): `mise run gate` runs `lint` (`biome ci`) → `check:model-ids` → `check:repo-rules` → `typecheck` (`turbo run typecheck`) → `test` (`turbo run test`, `mock` mode) → `docs:check`; every stage fails if it scanned or ran 0 items, so stages and `check:repo-rules` rules are wired into `gate` wave by wave (see "gate と CI の段階的な結線" in `001` `tasks.md`; CI jobs are added the same way). Other tasks: `setup` (`pnpm install --frozen-lockfile`), `lint:fix`, `test:local` (Ollama), `test:db` (Docker Postgres), `test:e2e` (Playwright, 3 engines), `test:mutation` (Stryker), `test:coverage`, `gate:repeat` (10 runs, same verdict), `services:up[:db]` / `services:down`, `secret-scan`, `audit`, `outdated`.
- The test file suffix decides where a test runs: `*.test.ts` (gate, `mock`), `*.local.test.ts` (only when Ollama is reachable, otherwise skipped with a reason), `*.db.test.ts` (in-process DB, part of gate), `*.pg.test.ts` (only via `mise run test:db`). Tests block `fetch` / `node:net` / `node:dns`; an unmocked connection fails the test.
- Run mode is chosen by env var without code changes: `AI_RUN_MODE` (`mock` / `local` / `live`, default `local`) and, inside Vitest, `AI_TEST_RUN_MODE` (default `mock`). `mock` resolves scenario (predicate match) → cassette (key match) → error, and never falls back to the network.

## Curriculum (`specs/curriculum/`)

The curriculum ports three Python / LangChain / LangGraph books to a TypeScript / Vercel AI SDK stack, then adds agent engineering material (4 phases / 19 modules). `specs/curriculum/` is the finalized version, rewritten from the drafts to match the specs and `001`'s plan / research:

| File                    | Role                                                                                                                                   |
| :---------------------- | :------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`             | Purpose, maturity model, 19-module roadmap, shared learning policy, and the source abbreviations used in the specs' "出典" columns     |
| `concepts.md`           | Concepts from Anthropic/IBM guidance: workflows vs. agents, ACI design, context engineering, long-running harnesses, evals, safety     |
| `phase-1.md`〜`phase-4.md` | Per-module syllabus (goals, topics, hands-on, mastery criteria) with requirement references                                          |
| `sources.md`            | Chapter-by-chapter mapping of the source books to modules, and the Python → TypeScript replacement table                               |
| `changes-from-drafts.md` | Contradictions resolved against the drafts (the basis for the per-module "移植時の変更点" sections, `001` Req 7.4)                                  |

Precedence: constitution → specs (`001` for shared constraints) → `001` plan / research → curriculum. When the curriculum disagrees with a spec, the spec wins and the curriculum is fixed. `001`'s Clarifications section records the decisions, and `001` also maps pre-split requirement numbers (used by `review-2026-09-26.md`) to the split specs.

## Planned Architecture (from `001` plan)

A pnpm workspaces + Turborepo monorepo, driven by mise tasks:

- `apps/web/`: Next.js (App Router, Turbopack, React Compiler). M1 routes: `app/api/chat/`, `app/api/agent/tools/`, `app/api/summarize/`, streaming AI SDK UI message streams. Server-only code lives in `lib/server/`. UI uses shadcn/ui base components plus hand-written chat, tool, and Generative UI components.
- `packages/ai-core/` (`@platform/ai-core`): pure-TypeScript agent logic, kept separate from the UI. M1 areas: `config`, `models` (model catalog + gateway), `mock`, `agents` (`createGuardedAgent`, the only place that constructs `ToolLoopAgent`), `aci` (`defineAciTool`), `ports`, `chat`, `summarize`, `testing`. Later milestones add areas such as `workflows/` (M2) and `harness/` (M4).
- `packages/eval-suite/` (`@platform/eval-suite`): Vitest-based agent evals, split into `capability/` and `regression/` tests (including LLM-as-a-Judge in M4).

Planned conventions:

- Vercel AI SDK v7 with Zod schemas, instead of LangChain/LangGraph abstractions. Agent loops use `ToolLoopAgent` (with `stopWhen` limits); workflow patterns are plain TypeScript composing `generateText` / `streamText`. Structured output uses `Output.object`, not the deprecated `generateObject` / `streamObject`. Tool inputs use `inputSchema`.
- TypeScript 7.1 prerelease across all workspaces, pinned to an exact build. Fall back to TypeScript 6.x only for the specific tool or workspace that is incompatible, and record why.
- Tests: `mise run gate` runs in `mock` mode, needs no Docker, and blocks unmocked network access. Comparison / quality-evaluation tests run only when `local` (Ollama) is available and are reported as skipped otherwise. Hands-on runs default to `local`.
- LLM-generated code (data-analysis code, harness code and test scripts) never runs on the host — only inside a sandbox or container.
- Retrieval: pgvector + Reciprocal Rank Fusion.
- Observability: OpenTelemetry.
- Dependency direction: `apps/web` and `packages/eval-suite` depend on `@platform/ai-core`, never the reverse; `ai-core` never imports React / Next.js / `@ai-sdk/react`, and consumers import only its `package.json#exports` subpaths (e.g. `@platform/ai-core/agents`). Features resolve models via `gateway.resolve({ purpose })`; model ID literals live only in `models/catalog.ts`; tools are defined with `defineAciTool` and a required `risk` (`read-only` / `write` / `destructive`). `structure.md`'s "Where Things Go" says where new code belongs.
- Biome for lint/format across all workspaces, with `noUnusedVariables` / `noUnusedImports` as errors. `001` research ADR-3 (adopted by the plan) sets tabs, double quotes, line width 100, and semicolons (the drafts' 2-space / single-quote proposal is not adopted).

## Writing Conventions

- Curriculum and spec prose is written in Japanese. Code, identifiers, and comments are in English.
