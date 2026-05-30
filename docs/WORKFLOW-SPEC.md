<div align="center">

# What is a Workflow?

### The target format `skill-to-workflow` compiles to

[![format](https://img.shields.io/badge/format-Claude_Workflow-6e40c9)](https://code.claude.com/docs/en/workflows)
[![language](https://img.shields.io/badge/language-plain_JS-8a63f4)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![status](https://img.shields.io/badge/Claude_Workflows-research_preview-8a63f4)](https://code.claude.com/docs/en/workflows)
[![license](https://img.shields.io/badge/license-MIT-6e40c9)](../README.md)

</div>

> A **Workflow** is deterministic JavaScript that orchestrates many subagents — fan-out,
> pipeline, adversarial verify, typed hand-offs. This is the format this project compiles
> **to**. For *how* a Skill becomes one, see [./CONVERSION-MODEL.md](./CONVERSION-MODEL.md).
> For the project itself, see [../README.md](../README.md).

---

## Workflow vs. Skill

A [Skill](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview) is a
procedure in prose for **one** agent to follow top-to-bottom in a single context window. A
[Workflow](https://code.claude.com/docs/en/workflows) is a program that *drives* agents: it
decides who runs, in what order, in parallel or sequence, and passes typed results between
them.

| Axis | Skill (`SKILL.md`) | Workflow (`*.js`) |
| --- | --- | --- |
| Authored in | Markdown prose | Plain JavaScript |
| Executor | one agent, one context | many subagents, orchestrated |
| Order | implicit in the prose | explicit in code |
| Concurrency | none (sequential) | `parallel()` / `pipeline()` |
| Hand-offs | text carried in context | typed objects via JSON-Schema |
| Verification | self-review, best-effort | adversarial subagents |
| Determinism | not guaranteed | required (resumable) |

The converter recovers the dependency structure hidden in a skill's prose and re-expresses
it as orchestration, adding three upgrades: **parallelisation**, **adversarial
verification**, and **typed hand-offs**.

---

## The `meta` block (must be a pure literal)

Every Workflow file **starts** with a single exported object literal. It is parsed
statically before the body runs, so it must contain **no** function calls, variables, or
expressions — string/array/object literals only.

```js
export const meta = {
  name: 'release-notes',
  description: 'Generate release notes from a set of merged PRs.',
  phases: ['collect', 'summarize', 'verify'],
};
```

After `meta`, the rest of the file is an `async` body that runs against a set of injected
globals (below). The body **must return a summary object**.

---

## Primitives

These are global in the workflow body — do not import them.

### `agent(prompt, opts?)`
Spawn one subagent. Resolves to its **text**, or to a **validated object** when
`opts.schema` (a JSON-Schema) is supplied. Other `opts`: `label`, `phase`, `model`,
`isolation:'worktree'`, `agentType`.

```js
const plan = await agent('Draft a 3-step plan for: ' + args.goal,
  { label: 'planner', schema: { type: 'object', properties: { steps: { type: 'array' } } } });
```

### `parallel(thunks)`
A **barrier**: runs an array of zero-arg functions concurrently and resolves once **all**
finish. Always `.filter(Boolean)` the result to drop empties.

```js
const reviews = (await parallel(files.map(f => () => agent('Review ' + f)))).filter(Boolean);
```

### `pipeline(items, ...stages)`
Streams `items` through stages with **no barrier** between them — each stage runs as soon as
its input is ready. Each stage receives `(prev, original, index)`.

```js
const out = await pipeline(urls,
  (url)   => agent('Fetch + extract: ' + url),
  (text)  => agent('Summarize:\n' + text));
```

### `phase(title)`
Mark a phase boundary (groups subsequent work for logs/observability).

```js
phase('verify');
```

### `log(msg)`
Emit a progress line.

```js
log('collected ' + reviews.length + ' reviews');
```

---

## Globals

- **`args`** — the workflow's typed input arguments.
- **`budget`** — the run's resource/cost budget; check it before large fan-outs.
- **`workflow()`** — handle to the running workflow (metadata, controls).

```js
if (budget.exhausted) return { ok: false, reason: 'budget' };
log('running ' + workflow().name + ' for ' + args.repo);
```

---

## Hard constraints

These are not style preferences — violating them breaks execution or resume.

1. **Plain JavaScript only.** No TypeScript syntax (no type annotations, `interface`, `as`, etc.).
2. **No nondeterministic built-ins.** `Date.now()`, `Math.random()`, and the **arg-less**
   `new Date()` are unavailable and **throw** — they would break workflow resume. (Pass an
   explicit argument to `new Date(...)` if you must construct a fixed date.)
3. **No filesystem / Node APIs in the script body.** No `fs`, `path`, `process`, network
   calls, etc. Only the **spawned agents** do I/O, through their own tools.
4. **Return a value.** The script body must `return` a summary object.
5. **`.filter(Boolean)` after every barrier.** `parallel()` results may contain empties;
   drop them before use.

---

## Pipeline by default; barrier only when a stage needs *all* prior results

Reach for `pipeline()` first — it keeps the line moving with no barrier between stages. Use
a barrier (`parallel()` between stages) **only** when a stage must see **every** prior
result at once: a dedup/merge/count, or a zero-count early exit.

```js
// DEFAULT — streamed, no barrier: each item flows stage→stage independently.
const summaries = await pipeline(items, fetchStage, summarizeStage);

// BARRIER — needed: dedup must see ALL fetched items before it can run.
const deduped = dedup((await parallel(items.map(i => () => fetchStage(i)))).filter(Boolean));
```

If a stage only needs *its own* input, never collect the whole batch first — that just
serializes work that could overlap.

---

<div align="center">

Part of **skill-to-workflow** · companion to
[**claude-workflow-viz**](https://github.com/democra-ai/claude-workflow-viz),
which visualizes the very workflows this project generates.
Built on Claude Code [dynamic workflows](https://code.claude.com/docs/en/workflows) (research preview).

MIT © democra.ai

*Independent community project. Not affiliated with, sponsored by, or endorsed by Anthropic.*

</div>
