<div align="center">

# What is an Agent Skill?

A reference for the **input** side of [`skill-to-workflow`](../README.md) — the artifact this project reads and compiles into a multi-agent workflow.

[![Spec](https://img.shields.io/badge/spec-Agent%20Skills-6e40c9)](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
[![Standard](https://img.shields.io/badge/standard-agentskills.io-8a63f4)](https://code.claude.com/docs/en/skills)
[![License](https://img.shields.io/badge/license-MIT-6e40c9)](../LICENSE)

</div>

> **Independent community project — not affiliated with, sponsored by, or endorsed by Anthropic.**
> This page summarizes Anthropic's public docs so the converter's behavior is auditable; the
> official docs are authoritative. Links throughout point to the canonical source.

---

## Definition

> **Agent Skills are modular capabilities that extend Claude's functionality. Each Skill packages instructions, metadata, and optional resources (scripts, templates) that Claude uses automatically when relevant.**
> — [Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)

A Skill is a **reusable, filesystem-based folder** that gives Claude domain-specific expertise — a
workflow, the context it needs, and the best practices to apply. Skills load **on demand** and are
**composable**. The same format works across [claude.ai](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview),
the Claude API, [Claude Code](https://code.claude.com/docs/en/skills), the Claude Platform on AWS,
and Microsoft Foundry.

In this project's terms: **a Skill is one agent following a procedure sequentially in a single
context window.** Everything below describes that artifact so the converter can recover the
dependency structure hidden in its prose (see [CONVERSION-MODEL.md](./CONVERSION-MODEL.md)).

---

## The `SKILL.md` file

A Skill is a **directory** whose entrypoint is a single `SKILL.md` — the **only required file**.
It has **YAML frontmatter** plus a **Markdown body**.

### Frontmatter

The required set **differs by surface**. On the **API / claude.ai** surface, exactly two fields are
required ([overview → Skill structure](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)):

| Field | Required (API/claude.ai) | Rules |
| --- | --- | --- |
| `name` | **Yes** | ≤64 chars; lowercase letters, numbers, hyphens only; no XML tags; not the reserved words `anthropic` / `claude`. |
| `description` | **Yes** | Non-empty; ≤**1024 chars**; no XML tags. Must state **what** it does **and when** to use it. |

In **[Claude Code](https://code.claude.com/docs/en/skills)** no field is strictly required — only
`description` is *recommended*. There `name` is just the **display label** (defaults to the
directory name) and does **not** set the `/command` you type (the directory name does, except for a
plugin-root `SKILL.md`); if `description` is omitted, the **first paragraph of the body** is used.
Claude Code also accepts a large **optional** set: `when_to_use`, `argument-hint`, `arguments`,
`disable-model-invocation`, `user-invocable`, `allowed-tools`, `disallowed-tools`, `model`,
`effort`, `context: fork`, `agent`, `hooks`, `paths`, `shell`
([Frontmatter reference](https://code.claude.com/docs/en/skills)).

```yaml
---
name: pdf-processor
description: >-
  Extract text and tables from PDF files, fill forms, and merge documents.
  Use when working with PDF files, or when the user mentions PDFs, forms,
  or document extraction.
# --- optional, Claude Code only ---
allowed-tools: Bash(pdftotext *), Read   # PRE-APPROVES these tools (does not restrict)
context: fork                            # run the Skill in an isolated subagent
agent: Explore                           # which subagent type when context: fork
---
```

> Note: in Claude Code `allowed-tools` **grants / pre-approves** tools (no per-use prompt while the
> Skill is active) — it does **not** restrict the tool set. Use `disallowed-tools` or permission
> deny-rules to actually block tools ([Pre-approve tools for a skill](https://code.claude.com/docs/en/skills)).

### The Markdown body

Below the frontmatter, write the instructions in the **imperative** ("Extract the tables,
then…"). Treat the body as a **table of contents**: keep the high-frequency procedure inline and
**point to bundled files** for the rest. Best practice is to **keep the body under 500 lines**,
splitting into separate files as you approach the limit, and to keep references **one level deep**
([best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)).

---

## Bundled files

A Skill can ship supporting files alongside `SKILL.md`. The body references them **by relative path**
so Claude loads each **only when needed**. The canonical layout (from Anthropic's
[`skill-creator`](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md))
uses three directories:

```text
pdf-processor/
├── SKILL.md            # REQUIRED — frontmatter + imperative instructions
├── scripts/            # executable code Claude RUNS via bash (output enters
│   └── fill_form.py    #   context; the code itself never does)
├── references/         # docs loaded INTO context as needed
│   ├── reference.md    #   (e.g. reference.md, FORMS.md, examples.md)
│   └── FORMS.md
└── assets/             # files used IN output: templates, icons, fonts
    └── template.pdf
```

The directory **names are conventions, not enforced** — what matters is that `SKILL.md` references
them. Add a table of contents to any reference file over ~100 lines.

---

## Progressive disclosure

Skills stay cheap because content loads in **three levels**
([overview → three levels of loading](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)):

| Level | What | When loaded | Token cost |
| --- | --- | --- | --- |
| **1 — Metadata** | `name` + `description` | **Always**, at startup, in the system prompt | **~100 tokens / Skill** |
| **2 — Instructions** | The `SKILL.md` body | **When the Skill is triggered** | **Under ~5k tokens** (`<500` lines ideal) |
| **3+ — Resources** | Bundled `scripts/` · `references/` · `assets/` | **As needed** | **Effectively unlimited** |

**Why it works:** Skills live as directories in a code-execution environment with a filesystem and
bash. At startup only Level-1 metadata sits in the system prompt — so you can install **many** Skills
**without a context penalty**. On a matching request Claude `bash`-reads `SKILL.md` (Level 2); if the
body points to other files, Claude `bash`-reads those (Level 3); when it points to a **script**,
Claude **runs** it and **only the output** consumes tokens — the code never enters context. Content
you never touch costs nothing.

> The figures above are often paraphrased as "~100 words / `<500` lines / unlimited"; the
> **official numbers are ~100 *tokens* of metadata and a `<5k`-token body** (in addition to the
> `<500`-line best practice). In Claude Code, an invoked body stays in context for the rest of the
> session, and the Level-1 *listing* itself is budgeted at ~1% of the context window — on overflow
> the least-used descriptions drop first (names are kept). Run `/doctor` to check.

---

## How triggering works

Skills are **model-invoked, not keyword-matched.** At startup every Skill's `name` + `description`
is injected into the system prompt; for each task, Claude reads those and **autonomously decides**
whether to load a given `SKILL.md`. The **description is the routing signal** — Anthropic calls it
*"the primary signal Claude uses to determine when to invoke a skill,"* used to pick from 100+
installed Skills ([best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)).
In Claude Code a Skill can **also** be invoked directly as `/skill-name`.

So the description must:

- **Be third person** — *"Processes Excel files and generates reports,"* never *"I can help you…"*.
  It is injected into the system prompt; an inconsistent point of view hurts discovery.
- **State what it does *and* concrete triggers.** Good: *"Extract text and tables from PDF files,
  fill forms, merge documents. Use when working with PDFs, forms, or document extraction."*
  Bad: *"Helps with documents."*
- **Be slightly "pushy."** Claude tends to **under-trigger** — it only consults a Skill for tasks it
  can't trivially do itself. The [`skill-creator`](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md)
  guidance is to **enumerate the situations where the Skill applies, even ones the user doesn't
  explicitly name.** If a Skill won't fire, fold the words users actually say into its description.

> **Security:** treat installing a Skill like installing software. Use Skills only from trusted
> sources and **audit every bundled file** — a malicious Skill can steer Claude into running code or
> calling tools outside its stated purpose, and Skills that fetch external URLs can carry injected
> instructions ([Security considerations](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)).
> This matters here because `skill-to-workflow` **ingests arbitrary Skills** as input.

---

## Why convert a Skill to a Workflow?

A Skill encodes a procedure as **prose for one agent to follow in one context window** — read,
think, act, sequentially. That is what makes Skills easy to author *and* easy to under-use: the
*dependency structure* (which steps are independent, which feed each other, which need a second pair
of eyes) is implicit in the writing. A [**dynamic workflow**](https://code.claude.com/docs/en/workflows)
makes that structure explicit and deterministic — a JavaScript script orchestrating **many**
subagents, where the *script* decides what runs next and intermediate results live in **script
variables** instead of one shared context. Anthropic's own docs frame the contrast directly (a Skill
is *"instructions Claude follows"*; a workflow is *"a script the runtime executes"*) and explicitly
endorse the upgrades this project applies — *"have independent agents adversarially review each
other's findings"* and *"draft a plan from several angles."*

That is exactly what `skill-to-workflow` does: it recovers the hidden dependency graph from a Skill's
prose and re-expresses it as orchestration, adding **parallelisation**, **adversarial verification**,
and **typed (JSON-Schema) hand-offs**. See the [**project README**](../README.md) for the
end-to-end pipeline and [**CONVERSION-MODEL.md**](./CONVERSION-MODEL.md) for how each step is
classified and emitted. The generated workflows render in the sibling project
[**claude-workflow-viz**](https://github.com/democra-ai/claude-workflow-viz), which visualizes the
very `.js` files this converter produces.

---

<div align="center">

MIT © [democra.ai](https://github.com/democra-ai) · an independent community project, not affiliated with or endorsed by Anthropic

</div>
