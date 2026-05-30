# Launch notes — skill-to-workflow

The one-liner: **a workflow that compiles your Agent Skills into multi-agent Workflows.** `skill-creator` makes skills; this makes workflows — out of the skills you already have.

## The pitch (30 seconds)

There are thousands of Agent Skills, but a skill runs in one agent, one context, one step at a time. The parallelism is *in the prose* — "check A, B, and C, then verify each" — it's just flattened because a single agent can't fan out. `skill-to-workflow` reads a skill, recovers that hidden dependency structure, and emits a Workflow that runs the independent parts concurrently, adversarially verifies every finding, and types the hand-offs. Same procedure, a fraction of the wall-clock, far fewer false positives. And it verifies its own output with a real parse gate + three adversarial review lenses in a repair loop.

## What ships

- `workflows/skill-to-workflow.js` — the meta-workflow (the engine), zero runtime deps
- `bin/install.mjs` — `npx` installer (global or `--project`)
- `bin/check-workflow.mjs` — standalone, workflow-aware syntax checker (handles `export const meta` + top-level `return`; flags a file wrapped in a Markdown fence)
- `examples/` — a real `doc-audit` skill and the workflow compiled from it, with the auto-generated `CONVERSION-REPORT.md`
- `docs/` — SKILL-SPEC, WORKFLOW-SPEC, CONVERSION-MODEL, ARCHITECTURE
- CI (the workflow checker on every push)

## Why it's interesting

- **Meta on meta.** It's a workflow whose job is authoring workflows — and it dogfoods the very primitives it generates (fan-out reads, a verify-and-repair loop, typed schemas).
- **It catches its own mistakes.** The first end-to-end run emitted a workflow whose emit-agent ran plain `node --check` and reported a syntax failure — but the file was actually fine; `node --check` just false-positives on a workflow's legitimate top-level `return`. The hardened engine now validates with a real V8 parse *inside* the verify loop, so a genuine truncation triggers a repair round while a false positive no longer blocks a good file. The failure mode became a design fix.
- **It composes with [claude-workflow-viz](https://github.com/democra-ai/claude-workflow-viz).** Generate a workflow here, then watch it fan out there.

## Try it

```bash
npx github:democra-ai/skill-to-workflow            # install globally
# then, in Claude Code:
# Workflow({ name: "skill-to-workflow", args: { skillName: "doc-audit" } })
```

## Status

Independent / community project. Not affiliated with or endorsed by Anthropic. Targets the current Claude Code dynamic-workflow research-preview format; fails soft on format drift.
