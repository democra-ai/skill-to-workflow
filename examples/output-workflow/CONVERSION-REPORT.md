# Conversion Report: `doc-audit` skill → Workflow

This report explains how the single-agent **`doc-audit`** skill (`SKILL.md`) was
compiled into the deterministic, multi-agent workflow
[`doc-audit.workflow.js`](./doc-audit.workflow.js).

---

## 1. Source skill: what `doc-audit` does

The original skill audits a folder of documentation (Markdown / MDX) for quality
problems and produces a single prioritized report. It works across **four
independent quality dimensions**:

1. **Broken links** — internal links to missing files/anchors, and dead or
   malformed external links.
2. **Stale code examples** — fenced code blocks referencing APIs, CLI flags,
   env vars, or file paths that no longer exist in the project.
3. **Missing sections** — pages that don't match the expected shape for their
   type (a how-to needs prerequisites + steps; a reference needs a parameter
   table; README.md is treated as a how-to).
4. **Readability** — overlong paragraphs, undefined jargon, or a reading level
   inappropriate for the audience.

The skill's **Step 3** explicitly warns that doc audits **produce false
positives** and instructs that each finding must be confirmed real (the broken
link actually resolves? the stale example actually still works? the missing
section actually present under another heading?) before it is reported. Its
**Notes** add a hard constraint: the skill **only reports — it never edits the
docs**.

As written, the skill is single-agent and sequential: one agent walks the four
dimensions, "re-checks itself," and writes `DOC-AUDIT.md`. That self-check is
the weak point this conversion hardens.

---

## 2. How the procedure was decomposed

The skill's procedure was broken into **7 steps** mapped onto **4 phases**.
Each step is tagged with its orchestration *kind*:

| Step | Kind | Per-item? | Depends on | Schema? |
|---|---|---|---|---|
| `inventory` | sequential (gate + early-exit) | no | — | yes |
| `audit-broken-links` | pipeline-stage A | yes | inventory | yes |
| `audit-stale-code` | pipeline-stage A | yes | inventory | yes |
| `audit-missing-sections` | pipeline-stage A | yes | inventory | yes |
| `audit-readability` | pipeline-stage A | yes | inventory | yes |
| `verify-findings` | verify (pipeline-stage B) | yes | the four audits | yes |
| `prioritize-and-report` | reduce (the one barrier) | no | verify-findings | no |

**Phases (what the candidate-facing run shows):**

1. **Inventory** — discover all `.md`/`.mdx` files under the target folder
   (default `./docs`), record relative path + size, and **short-circuit the
   whole run** with a clear message if no docs exist. Sequential gate; emits a
   typed inventory consumed by every dimension stage.
2. **Audit the four dimensions** — fan out the four independent checks, each
   producing a list of `{file, title, severity, suggestedFix}` findings. This is
   the first stage of a per-dimension pipeline.
3. **Verify each finding** — adversarial false-positive screen (the upgrade,
   see §4). Second stage of the per-dimension pipeline.
4. **Prioritize and report** — the single barrier: merge, de-duplicate, sort,
   write one `DOC-AUDIT.md`.

The `inventory` step is **sequential** (not parallel/pipeline) because it is a
single discovery + gate operation that everything else depends on, and because
the spec sanctions a **count-based early-exit** as a legitimate barrier-like
short-circuit: when there are zero docs, the workflow stops and returns
`audited: false` rather than emitting a misleading empty report.

---

## 3. What was parallelised vs pipelined, and why

**Backbone: `pipeline()`.** Following the spec's "default to pipeline" guidance,
the workflow's spine is a pipeline whose **unit of work is the *dimension***
(four descriptors: `broken-links`, `stale-code`, `missing-sections`,
`readability`) — **not** the individual doc file.

Why the dimension is the pipeline item:

- The skill states the four dimensions are **independent** — none consumes
  another's result — so they fan out with no cross-dependency.
- Each dimension has **two operations** that *are* ordered relative to each
  other: **audit → verify**. Modeling these as pipeline stages A and B means
  each dimension flows **straight into its own verification with no barrier
  between dimensions**. A fast dimension (e.g. readability) can reach
  verification while a slow one (e.g. external-link liveness checking) is still
  auditing. A single global `parallel()` "audit-all-then-verify-all" barrier
  would have forced every dimension to wait for the slowest auditor before any
  verification could start — strictly worse latency for no correctness gain.

**Nested parallelism inside the stages:**

- *Within* a single dimension's **audit**, the agent may internally parallelize
  across the inventoried files, but at the orchestration level the dimension is
  one pipeline item.
- The **verify** stage fans out **N skeptics per finding** via `parallel()`
  (independent skeptics, majority vote) — see §4.

**The one true barrier: `prioritize-and-report` (`reduce`).** De-duplicating
overlaps *across* dimensions, sorting the **whole** population by severity, and
emitting a single summary count all require **every confirmed finding from every
dimension at once**. This genuinely cannot operate per-item, so it is a `reduce`,
not a pipeline stage. It is the only place that legitimately awaits the complete
set.

**No worktree isolation needed.** Every agent except the final reduce is
read-only; the reduce writes exactly one new file (`DOC-AUDIT.md`). There are no
parallel file mutations that could conflict, so no per-agent worktree isolation
is required.

---

## 4. The adversarial verification added (the "honey" upgrade)

The central upgrade is the **`verify-findings`** stage, which implements the
skill's Step 3 false-positive warning that the single-agent version only
gestured at.

The original skill said, in effect, "re-check it yourself" — a single agent
grading its own homework, vulnerable to one verifier's blind spots. The workflow
replaces that with an **adversarial, multi-skeptic screen**:

- For **each finding**, spawn **N independent skeptics** (default
  `verifiers = 3`). Each skeptic is prompted to **REFUTE** the finding — to
  re-open the actual file(s) (and the surrounding project where relevant) and try
  hard to **prove the finding wrong**.
- A finding is **kept only if a majority of skeptics FAIL to refute it**
  (`keepThreshold = floor(verifiers/2) + 1`; with 3 skeptics, ≥2 must confirm).
  Everything else is **dropped as a false positive** before it can reach the
  report. `verifiers` defaults to an **odd** number so "majority" is unambiguous.
- **Lenses are diversified per dimension**, because the failure modes differ:
  - *broken-links* skeptic re-resolves the link target/anchor relative to the
    offending file;
  - *stale-code* skeptic re-checks the symbol/flag/path against the live project
    surface (and allows for deliberately illustrative pseudo-code);
  - *missing-sections* skeptic re-reads document structure (the section may exist
    under a differently-worded heading, or the page type was misclassified);
  - *readability* skeptic re-assesses against the **intended audience** (jargon
    may be defined nearby; the reading level may be fine for the readership).
- **Conservative tie-breaking:** `parallel()` never rejects; a skeptic that
  throws or returns empty resolves to a non-answer, which is treated as a
  refutation (it did *not* confirm), so weak findings are not kept by default.
- **Schema-typed hand-off:** confirmed findings carry `refuteFails` /
  `verifiers` counts so the downstream reduce can act on them deterministically.

A second, smaller integrity guard lives in the reduce: the **no-silent-caps
pattern**. Any finding removed during cross-dimension **de-duplication** is
**logged** (and surfaced in a "Merged duplicates" section of the report) so a
reviewer can see exactly what was merged away — nothing disappears silently.

Note that the inventory's zero-count check is a **correctness guard** (don't emit
an empty/misleading report when there's nothing to audit), not an adversarial
verification.

The report-only constraint from the skill's Notes is enforced end-to-end: every
audit and skeptic prompt says "read-only, never edit," and the final reduce is
instructed to write **only** `DOC-AUDIT.md` and to modify no documentation file
or project source.

---

## 5. Verify outcome

**Passed all lenses.**

- `node --check doc-audit.workflow.js` — parses cleanly (valid JS module syntax).
- **Structure lens:** exactly one true barrier (the final `reduce`); the four
  independent dimensions fan out with no barrier between audit and verify;
  inventory is a correct sequential predecessor + sanctioned zero-count
  early-exit.
- **Parallelism lens:** `pipeline()` backbone with the dimension as the unit of
  work; nested `parallel()` for the N-skeptic vote; no global audit/verify
  barrier; no conflicting parallel writes (read-only agents + single-file
  reduce).
- **Verification lens:** every finding faces N adversarial skeptics with
  per-dimension refute lenses and a majority-to-keep rule; dropped duplicates are
  logged (no silent caps).
- **Constraint lens:** report-only is enforced in every prompt and in the reduce;
  schemas use `additionalProperties: false` with explicit `required` fields for
  deterministic machine hand-off.

---

## 6. How to run the generated workflow

The workflow is a standard Workflow module exposing a `meta` export and a body
that uses the host's `agent()`, `pipeline()`, `parallel()`, `phase()`, `log()`,
and `args` primitives. Run it through your Workflow runner, pointing it at this
file.

**Defaults (runs with no args):** audits `./docs`, writes `DOC-AUDIT.md`, uses
3 skeptics per finding.

**Inputs (`args`):**

```js
args = {
  folder: './docs',            // target documentation folder to audit
  reportPath: 'DOC-AUDIT.md',  // output report path (report-only; docs never edited)
  verifiers: 3,                // independent skeptics per finding; kept only if a majority fail to refute
  severityOrder: ['blocker', 'major', 'minor'], // merged-report sort order (blockers first)
  readmeAsHowTo: true          // treat README.md as a how-to for the missing-sections check (skill Note)
}
```

- `verifiers` should be an **odd** number so "majority" is unambiguous.
- `severityOrder` is **data-driven** so the sort can be retuned without code edits.

**What you get back:**

- A single Markdown report at `reportPath` (default `DOC-AUDIT.md`): a summary
  count at the top (overall + per severity + per dimension), findings grouped by
  dimension and severity-sorted within each group, and a "Merged duplicates"
  section.
- A returned run-summary object: `{ workflow, folder, audited, fileCount,
  verifiersPerFinding, keepThreshold, reportPath, totalConfirmed,
  totalDroppedAsFalsePositive, perDimension[], reportAgentNote }`.
- If the folder has no `.md`/`.mdx` files, the run short-circuits and returns
  `{ audited: false, reason: 'no-docs-found', reportPath: null }` — **no report
  is written**.
