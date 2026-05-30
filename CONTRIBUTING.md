<div align="center">

# Contributing to skill-to-workflow

**Compile a Claude Agent Skill into a multi-agent Workflow.**

[![License: MIT](https://img.shields.io/badge/License-MIT-6e40c9.svg)](./LICENSE)
[![Node >=18](https://img.shields.io/badge/node-%3E%3D18-8a63f4.svg)](https://nodejs.org/)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-6e40c9.svg)](#opening-a-pr)

</div>

Thanks for helping out! This is the contributor's guide — short, practical, and focused on getting a green PR merged. New here? Skim the [README](./README.md) for what the project does and why, or just read the 30-second version below.

> **Heads-up:** skill-to-workflow is an independent community project. It is **not affiliated with, sponsored by, or endorsed by Anthropic.** Its sibling, [claude-workflow-viz](https://github.com/democra-ai/claude-workflow-viz), visualizes the very workflows this project generates — the two pair nicely.

## What this project is (the 30-second version)

A **Skill** is one agent following a procedure sequentially in a single context window. A **Workflow** is deterministic JavaScript orchestration of many subagents — fan-out, pipelines, adversarial verification, typed hand-offs. skill-to-workflow is a *meta-workflow*: it reads a `SKILL.md`, recovers the dependency structure hidden in its prose, and re-expresses it as orchestration, adding three upgrades — **parallelisation, adversarial verification, and typed (JSON-Schema) hand-offs.**

The engine itself (`workflows/skill-to-workflow.js`) runs in five phases: **Ingest → Decompose → Synthesize → Verify → Emit.**

## Project layout

```
skill-to-workflow/
├── workflows/   the meta-workflow engine (skill-to-workflow.js) + any helpers
├── bin/         install/CLI entrypoints (e.g. install.mjs)
├── docs/        design notes, the authoring spec, phase write-ups
├── examples/    sample skills to convert + their generated workflows
└── assets/      branding (logo, badges) shared with claude-workflow-viz
```

## Local development

You need **Node >= 18**. There's no build step — workflows are plain JS that the Claude Code Workflow runtime executes.

```bash
git clone https://github.com/democra-ai/skill-to-workflow
cd skill-to-workflow
npm install          # only if a package.json with deps exists

npm run check        # the canonical syntax gate — run this before every push
```

`npm run check` is what CI runs, so make it pass locally first. The installer is an ordinary ES module, so you can fast-check it directly:

```bash
node --check bin/install.mjs
```

> **Gotcha — don't `node --check` a workflow body directly.** Both the engine (`workflows/skill-to-workflow.js`) and any generated workflow (e.g. `examples/input-skill/doc-audit.workflow.js`) are *workflow bodies*: they end in a top-level `return`, which is only legal inside the Workflow runtime. A bare `node --check` on them reports `Illegal return statement` — that's expected, not a bug you introduced. The engine verifies the file it *generates* by wrapping it during the Emit phase; you verify by running the conversion (below) and reading the `CONVERSION-REPORT.md`. CI's syntax-check step globs `examples/output-workflow/*.js` and passes when that dir is empty, so don't rely on it to catch a malformed workflow body — run the conversion.

Run `npm run check` after **every** edit — it's the cheapest way to catch the constraint violations below before CI does.

### Testing a conversion end-to-end

```bash
node bin/install.mjs --project     # installs the workflow into this project
```

Then, in **Claude Code**, invoke the **Workflow** tool on a skill — point it at `examples/input-skill/` or any local `SKILL.md`:

```
Workflow({ name: "skill-to-workflow", args: { skillPath: "/abs/path/to/skill-dir", outDir: "/abs/out" } })
# or resolve by name under ~/.claude/skills/<name>:
Workflow({ name: "skill-to-workflow", args: { skillName: "doc-audit" } })
```

The engine writes the generated workflow file plus a `CONVERSION-REPORT.md`. Sanity-check the output by:

1. reading `CONVERSION-REPORT.md` — it records the Emit-phase `node --check` result for the generated file and what each verification lens found,
2. eyeballing the generated `.js` against the conventions below, and
3. (optional) loading the result into [claude-workflow-viz](https://github.com/democra-ai/claude-workflow-viz) to see the orchestration graph.

Claude Code dynamic workflows are a [research preview](https://code.claude.com/docs/en/workflows); the Agent Skills format is documented in the [overview](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview).

## Coding conventions for workflow scripts

Generated workflows — and the engine — **must** obey the runtime's hard constraints. The verifier enforces these, so match them in any script you write or in the templates the engine emits:

- **Pure-literal `meta`.** The file starts with `export const meta = { name, description, phases }` — a plain object literal, no computation, no references.
- **Plain JavaScript only.** No TypeScript, no type annotations.
- **No nondeterministic built-ins.** `Date.now()`, `Math.random()`, and arg-less `new Date()` are unavailable and **throw** — they'd break workflow resume. (`new Date('2026-01-01')` with an explicit arg is fine.)
- **No filesystem / Node APIs in the script body.** Only the spawned agents do I/O, through their own tools.
- **Return a summary object** at the end of the async body.
- **Default to `pipeline()`.** Use a barrier — `parallel()` *between* stages — only when a stage needs *all* prior results at once (dedup / merge / count, or a zero-count early exit). Always `.filter(Boolean)` the result of `parallel()`.

Globals available in the body: `agent(prompt, opts?)`, `parallel(thunks)`, `pipeline(items, ...stages)`, `phase(title)`, `log(msg)`, `args`, `budget`, `workflow()`. `agent()` resolves to the agent's text, or to a validated object when you pass `opts.schema` (a JSON Schema). Other `opts`: `label`, `phase`, `model`, `isolation:'worktree'`, `agentType`.

## Extending the engine

**Add a verification lens.** Phase 4 runs adversarial lenses in `parallel()` (currently: convention/syntax, fidelity, parallel-soundness). Each lens is an `agent()` call constrained by the shared `VERDICT_SCHEMA` near the top of the engine — `{ lens, pass, issues: [{ severity: 'blocker'|'major'|'minor', where, problem, fix }] }`. To add one:

1. Write the lens as a thunk that spawns an `agent({ schema: VERDICT_SCHEMA, ... })` with a focused, adversarial critique prompt (prompt it to *refute*, and to default `pass:false` on any blocker).
2. Add the thunk to the `parallel([...])` array in phase 4, and remember to `.filter(Boolean)`.
3. The existing repair loop already collects `blocker`/`major` issues across all lenses and feeds them to the repair agent (up to 3 rounds, stopping when a round surfaces nothing new) — so a well-formed verdict plugs in automatically.
4. Document the lens in `docs/CONVERSION-MODEL.md` and add an example under `examples/` that exercises the failure it catches.

**Add or change a schema / hand-off type.** The typed hand-offs are explicit JSON Schemas near the top of the engine: `SKILL_IR_SCHEMA`, `FILE_DIGEST_SCHEMA`, `PLAN_SCHEMA` (its `kind` enum is `sequential | parallel | pipeline-stage | verify | reduce`), `SYNTH_SCHEMA`, `VERDICT_SCHEMA`, `EMIT_SCHEMA`. When you extend one, update the schema *and* the prompt that produces it, then add a small fixture under `examples/` so the round-trip stays covered. Remember the engine **embeds the authoring spec into its synthesize/verify/repair agent prompts verbatim** (subagents don't carry the Workflow tool description), so if you change the target workflow format, update that embedded spec in the engine too.

## Opening a PR

- **Small and focused.** One lens, one fix, one doc improvement per PR beats a mega-change.
- **CI green.** `npm run check` and `node --check bin/install.mjs` must pass — run them locally first. (Remember: a bare `node --check` on a workflow *body* is expected to fail; verify those by running a conversion.)
- **Show your work.** If you add/change a lens or schema, include a before/after `CONVERSION-REPORT.md` snippet or a sample conversion in the PR description.
- **Match the house style.** Branding follows the sibling repo — centered hero, shields.io badges, purple accent (`#6e40c9` / `#8a63f4`). Keep the "not affiliated with Anthropic" disclaimer intact wherever it appears.
- **Be kind in review.** Assume good intent; we're all here to make skill-to-workflow better.

By contributing, you agree your work is licensed under the project's MIT license.

---

<div align="center">

MIT © <a href="https://github.com/democra-ai">democra.ai</a> · independent community project, not affiliated with or endorsed by Anthropic

</div>
