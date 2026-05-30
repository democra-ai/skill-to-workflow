# The Conversion Model

> How `skill-to-workflow` turns a single-agent **Skill** into a multi-agent **Workflow**.

A Skill and a Workflow are two different *execution models* for the same
procedural knowledge:

|                | **Agent Skill**                                  | **Workflow**                                              |
| -------------- | ------------------------------------------------ | -------------------------------------------------------- |
| Unit           | One agent, one context window                     | Many agents, orchestrated                                 |
| Control flow   | Model-driven (Claude decides as it reads)         | Deterministic JS (loops, conditionals, fan-out)          |
| Steps          | Run sequentially in one head                      | Fan out in parallel · pipeline per item · run in order   |
| Verification   | Whatever the agent thinks to check               | Explicit adversarial stages, N-vote, repair loops        |
| Hand-offs      | Prose in the same context                          | Typed JSON Schema between agents                          |
| Throughput     | One thing at a time                                | Slowest single chain, not sum of steps                   |
| Failure        | One context, one chance                           | Per-item isolation; a failed item drops to `null`        |

The skill already contains the *what*. The conversion's job is to recover the
**dependency structure** hidden inside the prose and re-express it as
orchestration. That recovered structure is where the value ("honey") comes from:
a skill that says "do A, then for each X do B, then check it" is secretly a
fan-out + pipeline + verify graph — it was just written as a flat list because
a single agent can only do one thing at a time.

## The mapping rules

The decompose phase reads the skill body as a procedure and tags every step.
Each tag maps to a concrete Workflow primitive:

| Step shape in the skill                                            | Tag             | Compiles to                                  |
| ----------------------------------------------------------------- | --------------- | -------------------------------------------- |
| "Do X. Then do Y." (Y needs X)                                    | `sequential`    | two awaited `agent()` calls in order         |
| "Check A, B, and C" (independent)                                 | `parallel`      | `parallel([() => agent(A), …])` + `filter`   |
| "For each item, do Z"                                             | `pipeline-stage`| a `pipeline(items, …)` stage, `perItem:true` |
| "Once you have all results, merge / dedup / count"               | `reduce`        | a barrier — `parallel()` then a merge agent  |
| "Make sure the finding is real / the output is correct"          | `verify`        | adversarial skeptics, majority-vote          |
| A bundled `reference.md` the skill leans on                       | —               | content embedded inline in the agent prompt  |
| A bundled `scripts/foo.py` the skill runs                        | —               | an agent step that invokes it via `Bash`     |

## The three upgrades

A faithful 1:1 translation would already run, but the point is to make the skill
*better*. Three upgrades happen during conversion:

1. **Parallelisation.** Independent steps that a single agent did one-at-a-time
   become a `parallel()` fan-out or a `pipeline()`. Wall-clock collapses from
   *sum of steps* to *slowest single chain*.

2. **Adversarial verification.** Skills written as advice rarely verify
   themselves. The converter looks for every claim, finding, or artifact that
   could be wrong and wraps it in N independent skeptics prompted to *refute* —
   keeping the result only if a majority fail to. This is the single biggest
   quality lift, so the decompose phase hunts for it aggressively.

3. **Typed hand-offs.** Prose passed between steps becomes JSON Schema, so the
   orchestration can branch, count, dedup, and loop on real data instead of
   re-parsing text.

## Soundness: what the converter must *not* do

The verify phase runs three adversarial lenses on every generated workflow:

- **Fidelity** — no skill step, threshold, or rule may be dropped. The workflow
  may *add* capability; it may never *lose* it.
- **Parallel-soundness** — no false parallelism (fanning out steps that share a
  data dependency) and no unjustified barriers (a `parallel()` that should be a
  `pipeline()`).
- **Syntax/convention** — pure-literal `meta`, matching `phase()` titles, no
  `Date.now`/`Math.random`/`new Date`, `.filter(Boolean)` after every barrier,
  a returned summary, plain JS.

If any lens finds a blocker or major issue, the issues are fed back to a repair
agent and the workflow is regenerated. The loop runs up to three rounds.

## Worked example

[`examples/input-skill/`](../examples/input-skill/) is a `doc-audit` skill — a
flat four-step procedure. After conversion ([`examples/output-workflow/`](../examples/output-workflow/))
it becomes:

```
Inventory ─▶ ┌ broken-links ┐                 ┌ verify ┐
             ├ stale-code   ┤─▶ (per finding) ─┤ verify ├─▶ dedup ─▶ report
             ├ missing-secs ┤                 └ verify ┘
             └ readability  ┘
             4 dimensions, parallel        adversarial, per-finding
```

The four dimensions — independent in the prose, sequential in a single agent —
run at once. Every finding is re-checked before it reaches the report. Same
procedure, fraction of the wall-clock, far fewer false positives.
