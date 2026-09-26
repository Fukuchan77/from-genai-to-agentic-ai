# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## Project Status

"From GenAI to Agentic AI": an engineering guide / curriculum for building, evaluating, and deploying production-grade AI agents. The repository is **pre-implementation**: there is no source code, `package.json`, or test suite yet. The only content is design drafts (Japanese) under `specs/drafts/`.

## Tooling

- `mise.toml` pins `node` and `pnpm`; run tools through `mise` / `pnpm exec`.
- No mise tasks are defined yet — when scaffolding the project, add a `gate` task (lint + format + typecheck + test) to `mise.toml`.

## Design Drafts (`specs/drafts/`)

The curriculum ports three Python / LangChain / LangGraph books to a TypeScript / Vercel AI SDK stack, then adds agent engineering material:

| File                                     | Role                                                                                                                                                          |
| :--------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `1_llm-agent.md`                         | Port of a Streamlit + LangChain web book → Next.js App Router + AI SDK (LLM app basics)                                                                       |
| `2_ai-agent.md`                          | Port of a LangChain/LangGraph RAG & agent-design-patterns book → AI SDK                                                                                       |
| `3_genai-agent.md`                       | Port of a practical-agents book (helpdesk, data analysis, paper search, marketing) → AI SDK + MCP                                                             |
| `Agentic AI Development Guide.md`        | Concept modules based on Anthropic/IBM guidance: workflows vs. agents, ACI design, context engineering, long-running harnesses, evals, safety                 |
| `Next-Gen AgenticAI App Dev Learning.md` | **Integrating master curriculum** (4 phases / 16 modules) that merges the four documents above. It also defines the target repo layout and coding conventions |

When the drafts disagree, treat `Next-Gen AgenticAI App Dev Learning.md` as the source of truth.

## Planned Architecture (from the master curriculum §3)

A pnpm + Turborepo monorepo:

- `apps/web/`: Next.js (App Router, Turbopack, React Compiler). API routes under `app/api/` (`chat/`, `agent/helpdesk/`, `agent/analyst/`) stream agent output. UI components include plan-progress viewers and Human-in-the-Loop tool-approval modals, built with shadcn/ui.
- `packages/ai-core/`: pure-TypeScript agent logic, kept separate from the UI:
  - `workflows/`: Anthropic's five workflow patterns (chaining, routing, parallelization, orchestrator-workers, evaluator-optimizer)
  - `agents/`: domain agents (helpdesk Plan-and-Execute, data analyst using an E2B sandbox)
  - `aci/`: tool definitions and the MCP client
  - `harness/`: context compaction and the two-tier (initializer → worker) long-running harness
- `packages/eval-suite/`: Vitest-based agent evals, split into `capability/` and `regression/` tests (including LLM-as-a-Judge).

Planned conventions:

- Vercel AI SDK Core primitives (`generateText` / `streamText` / `generateObject` / tools) with Zod schemas, instead of LangChain/LangGraph abstractions. Control loops are plain TypeScript.
- Retrieval: pgvector + Reciprocal Rank Fusion.
- Observability: OpenTelemetry.
- Biome for lint/format: 2-space indent, line width 100, single quotes, semicolons, `noUnusedVariables` / `noUnusedImports` as errors.

## Writing Conventions

- Curriculum and spec prose is written in Japanese. Code, identifiers, and comments are in English.
