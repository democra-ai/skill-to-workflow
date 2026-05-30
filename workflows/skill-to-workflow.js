// ============================================================================
// skill-to-workflow — the meta-workflow that compiles an Agent Skill into a
// multi-agent Workflow.
//
// A Skill encodes a procedure for ONE agent to follow sequentially (model-
// driven, single context). A Workflow re-expresses that same procedure as
// DETERMINISTIC multi-agent orchestration: independent steps fan out, per-item
// work pipelines, claims get adversarially verified, and hand-offs are typed.
//
// This file is itself a Workflow. Run it with the Claude Code `Workflow` tool:
//
//   Workflow({ name: "skill-to-workflow",
//              args: { skillPath: "/abs/path/to/skill", outDir: "/abs/out" } })
//
// or by name resolution:
//
//   Workflow({ name: "skill-to-workflow",
//              args: { skillName: "doc-audit" } })
//
// args:
//   skillPath  absolute path to a skill directory (contains SKILL.md)   [either this
//   skillName  a skill name resolved under ~/.claude/skills/<name>       or this]
//   outDir     where to write the generated workflow (default: skill dir)
//   model      optional model override for all stages
// ============================================================================

export const meta = {
  name: 'skill-to-workflow',
  description:
    'Compile a Claude Agent Skill into a multi-agent Workflow. Reads SKILL.md plus its references, scripts and examples, decomposes the skill procedure into steps, maps each step onto agent()/parallel()/pipeline(), then adversarially verifies the result (with a real parse gate) and emits a ready-to-run workflow script with a conversion report.',
  phases: [
    { title: 'Ingest', detail: 'Read SKILL.md + references + scripts → structured Skill IR' },
    { title: 'Decompose', detail: 'Classify every step: sequential / parallel / pipeline / verify' },
    { title: 'Synthesize', detail: 'Write the workflow .js from the plan + self parse-check' },
    { title: 'Verify', detail: 'Parse gate + three adversarial lenses (fidelity · parallel · convention) + repair loop' },
    { title: 'Emit', detail: 'Confirm placement + write the conversion report' },
  ],
}

// ----------------------------------------------------------------------------
// Embedded authoring spec.
//
// Subagents do NOT carry the Workflow tool description in their context, so the
// meta-workflow ships its own knowledge of the target format and hands it to
// the synthesize / verify / repair agents verbatim. This is what makes the
// conversion produce *correct* workflow code instead of plausible-looking code.
// ----------------------------------------------------------------------------
const WORKFLOW_SPEC = `
================= WORKFLOW AUTHORING SPEC (target format) =================
A Workflow is ONE JavaScript file run by the Claude Code "Workflow" tool. It
orchestrates subagents deterministically (loops, conditionals, fan-out).

REQUIRED SHAPE
- The file MUST begin with: export const meta = { name, description, phases }
- meta MUST be a PURE LITERAL — no variables, function calls, spreads, or
  template interpolation inside it. Required: name, description. Optional:
  whenToUse, phases (array of { title, detail? }). phase() titles in the body
  should match meta.phases titles exactly.
- After meta, the script body runs in an async context. Use await directly.

PRIMITIVES (available as globals — do NOT import them)
- agent(prompt, opts?) => Promise. Spawns one subagent.
    opts: { label?, phase?, schema?, model?, isolation?, agentType? }
    * Without schema: resolves to the agent's final TEXT (string).
    * With schema (a JSON Schema object): the agent is forced to return a
      validated object — no parsing needed. Returns null if the user skips it.
    * label overrides the display name; phase assigns it to a progress group
      (set phase explicitly inside parallel()/pipeline() stages).
    * isolation:'worktree' gives the agent its own git worktree — EXPENSIVE,
      use ONLY when agents mutate files in parallel and would conflict.
- parallel(thunks) => Promise<any[]>. Runs () => Promise thunks concurrently.
    This is a BARRIER: it awaits ALL of them. A thunk that throws resolves to
    null (the call never rejects) — always .filter(Boolean) the result.
- pipeline(items, stage1, stage2, ...) => Promise<any[]>. Runs each item
    through all stages independently with NO barrier between stages (item A can
    be in stage 3 while item B is still in stage 1). Each stage callback gets
    (prevResult, originalItem, index). A stage that throws drops that item to
    null and skips its remaining stages.
- phase(title): start a progress group. log(message): narrator line to the user.
- Globals: args (the args value passed in), budget ({ total, spent(),
    remaining() }), workflow(nameOrRef, args?) (run another workflow inline —
    one level of nesting only).

HARD CONSTRAINTS
- Plain JavaScript, NOT TypeScript. No type annotations, interfaces, generics.
- Date.now(), Math.random(), and argless new Date() THROW — never call them.
  For per-item variety, vary the agent prompt/label by index instead.
- No filesystem / Node APIs in the script body. Only the spawned AGENTS can
  read/write files (via their Read/Write/Bash tools). The script only
  orchestrates and passes strings/objects between agents.
- The script should return a value (object) summarising the run.

CHOOSING PRIMITIVES (this is the whole point of converting a skill)
- DEFAULT to pipeline(). Use a barrier (parallel between stages) ONLY when a
  stage genuinely needs ALL prior results at once (dedup/merge across the set,
  a zero-count early-exit, or "compare against the other findings").
- A step that operates on EACH item independently → pipeline stage.
- Steps with NO data dependency on each other → parallel() fan-out.
- A claim/finding/output that could be wrong → add an adversarial verify stage
  (N skeptics prompted to REFUTE; keep only if a majority fail to refute).
- A hand-off between stages that must be machine-read → give that agent a schema.

QUALITY PATTERNS (apply when the skill's procedure calls for them)
- Adversarial verify: spawn N independent skeptics per finding; drop it if the
  majority refute it. Diversify lenses when failure modes differ.
- Loop-until-dry: for unknown-size discovery, keep spawning finders until K
  consecutive rounds surface nothing new. Dedup against a "seen" set.
- Multi-modal sweep: parallel finders that each search a different way.
- Completeness critic: a final agent that asks "what did we miss?".
- No silent caps: log() anything dropped by a top-N or sampling bound.
==========================================================================
`.trim()

// ----------------------------------------------------------------------------
// Self-contained syntax gate.
//
// A workflow script is NOT a standalone module — the runtime wraps the body in
// an async function and injects the primitives as globals, so a valid workflow
// uses `export const meta` AND top-level await/return. Plain `node --check`
// parses it as a module and rejects those with "Illegal return statement" — a
// FALSE POSITIVE. So agents validate by normalizing the file into the runtime's
// shape and parsing it with vm.Script (a real V8 parse, no execution). This
// also catches the truncation garbage LLMs sometimes emit (markdown fences,
// "omitted for brevity", bare `...`), which would otherwise slip through.
//
// String.raw keeps the regex backslashes (\s, \n) intact through this template.
// ----------------------------------------------------------------------------
const PARSE_CHECK_CMD = String.raw`node -e 'const fs=require("fs"),vm=require("vm");const f=process.argv[1];const s=fs.readFileSync(f,"utf8").replace(/export\s+const\s+meta/,"const meta");try{new vm.Script("async function _(agent,parallel,pipeline,phase,log,workflow,args,budget){\n"+s+"\n}",{filename:f});console.log("PARSE_OK")}catch(e){console.log("PARSE_FAIL: "+e.message);process.exit(1)}'`

const validateInstructions = (file) =>
  `VALIDATE the file you just wrote, then only report syntaxOk:true if it passes.

A workflow is run inside an async wrapper, so top-level \`await\`/\`return\` and a
leading \`export const meta\` are CORRECT — do not "fix" them. Validate with a
real parse (not \`node --check\`, which false-positives on top-level return):

  ${PARSE_CHECK_CMD} "${file}"

It must print exactly PARSE_OK. If it prints PARSE_FAIL, the file has a real
syntax error (often a Markdown code fence, a stray prose sentence, or a \`...\`
placeholder that leaked into the file) — open the file, FIX it so it is complete
raw JavaScript, and re-run until it prints PARSE_OK. Capture the final result in
syntaxOk / syntaxError.`

// ----------------------------------------------------------------------------
// Schemas — typed hand-offs between phases.
// ----------------------------------------------------------------------------
const SKILL_IR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    resolved: { type: 'boolean', description: 'true if the skill directory was found and SKILL.md read' },
    skillDir: { type: 'string', description: 'absolute path to the skill directory (empty if not resolved)' },
    name: { type: 'string', description: 'skill name from SKILL.md frontmatter' },
    description: { type: 'string', description: 'skill description from frontmatter' },
    body: { type: 'string', description: 'the full SKILL.md markdown body (instructions), verbatim' },
    files: {
      type: 'array',
      description: 'every non-SKILL.md file bundled with the skill',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', description: 'absolute path' },
          kind: { type: 'string', enum: ['reference', 'script', 'asset', 'example', 'other'] },
          bytes: { type: 'integer' },
        },
        required: ['path', 'kind', 'bytes'],
      },
    },
    error: { type: 'string', description: 'human-readable reason if not resolved' },
  },
  required: ['resolved', 'skillDir', 'name', 'description', 'body', 'files', 'error'],
}

const FILE_DIGEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string' },
    role: { type: 'string', description: 'what this file contributes to the skill (reference data, executable step, template, example)' },
    digest: { type: 'string', description: 'concise summary of the content the workflow may need to embed or call' },
    referencedBySteps: { type: 'string', description: 'which parts of the procedure use this file' },
  },
  required: ['path', 'role', 'digest', 'referencedBySteps'],
}

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    suggestedName: { type: 'string', description: 'kebab-case name for the generated workflow' },
    summary: { type: 'string', description: 'one-paragraph description of what the workflow will do' },
    steps: {
      type: 'array',
      description: 'the skill procedure decomposed into ordered steps',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          description: { type: 'string', description: 'what this step does, taken from the skill' },
          kind: {
            type: 'string',
            enum: ['sequential', 'parallel', 'pipeline-stage', 'verify', 'reduce'],
            description: 'sequential=must run in order; parallel=independent fan-out; pipeline-stage=per-item; verify=adversarial check; reduce=merge across items',
          },
          perItem: { type: 'boolean', description: 'true if this step runs once per input item (map-style)' },
          dependsOn: { type: 'array', items: { type: 'string' }, description: 'ids of steps that must complete first' },
          needsSchema: { type: 'boolean', description: 'true if the output is consumed by a later step and should be typed' },
          rationale: { type: 'string', description: 'why this classification (especially why parallel is safe, or why a barrier is required)' },
        },
        required: ['id', 'description', 'kind', 'perItem', 'dependsOn', 'needsSchema', 'rationale'],
      },
    },
    phases: {
      type: 'array',
      description: 'the phase() groups the workflow will use, in order',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { title: { type: 'string' }, detail: { type: 'string' } },
        required: ['title', 'detail'],
      },
    },
    inputs: { type: 'string', description: 'what the generated workflow takes via `args` (and sensible defaults)' },
    parallelismNotes: { type: 'string', description: 'where pipeline vs parallel(barrier) is used and why' },
    verificationNotes: { type: 'string', description: 'which outputs get adversarial verification and how' },
  },
  required: ['suggestedName', 'summary', 'steps', 'phases', 'inputs', 'parallelismNotes', 'verificationNotes'],
}

// Synthesize/repair WRITE the file and self-check; they return metadata, NOT the
// script body. (Returning a 500-line string in a JSON field is what tempts an
// agent to truncate it with "...omitted" — writing via the Write tool avoids it.)
const SYNTH_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', description: 'absolute path the workflow file was written to (must equal the requested path)' },
    syntaxOk: { type: 'boolean', description: 'true iff the parse check printed PARSE_OK' },
    syntaxError: { type: 'string', description: 'the PARSE_FAIL message if not ok, else empty' },
    rationale: { type: 'string', description: 'one or two lines on the orchestration choices / what was fixed' },
  },
  required: ['path', 'syntaxOk', 'syntaxError', 'rationale'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    lens: { type: 'string' },
    pass: { type: 'boolean', description: 'true only if the workflow is correct under this lens' },
    issues: {
      type: 'array',
      description: 'concrete, actionable problems found (empty if pass)',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          where: { type: 'string', description: 'line/section of the workflow' },
          problem: { type: 'string' },
          fix: { type: 'string', description: 'how to fix it' },
        },
        required: ['severity', 'where', 'problem', 'fix'],
      },
    },
  },
  required: ['lens', 'pass', 'issues'],
}

const EMIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    workflowPath: { type: 'string' },
    reportPath: { type: 'string' },
    syntaxOk: { type: 'boolean', description: 'final parse-check result on the written file' },
    note: { type: 'string' },
  },
  required: ['workflowPath', 'reportPath', 'syntaxOk', 'note'],
}

// ----------------------------------------------------------------------------
// Inputs
// ----------------------------------------------------------------------------
const skillPath = (args && args.skillPath) || ''
const skillName = (args && args.skillName) || ''
const outDir = (args && args.outDir) || ''
const modelOverride = (args && args.model) || undefined
const agentOpts = (extra) => (modelOverride ? { ...extra, model: modelOverride } : extra)

const locator = skillPath
  ? `the skill directory at the absolute path: ${skillPath}`
  : skillName
    ? `the skill named "${skillName}" — look under ~/.claude/skills/${skillName} (it may be a symlink; resolve it), then under any plugins/marketplaces skills directories if not found there`
    : 'the skill — NO path or name was provided, so set resolved=false and explain in error'

// ============================================================================
// PHASE 1 — INGEST
// ============================================================================
phase('Ingest')
const ir = await agent(
  `You are ingesting a Claude Agent Skill so it can be compiled into a Workflow.

Locate ${locator}.

A Skill is a directory containing SKILL.md (YAML frontmatter with \`name\` and
\`description\`, then a markdown body of instructions) plus OPTIONAL bundled
files: reference.md / references/ (docs loaded on demand), scripts/ (executable
helpers), assets/ (templates), and sometimes examples/.

Do this:
1. Find the skill directory and confirm it contains SKILL.md. If it is a
   symlink, resolve to the real path. If you cannot find it, set resolved=false
   and write a clear error.
2. Read SKILL.md fully. Extract the frontmatter \`name\` and \`description\`, and
   capture the ENTIRE markdown body verbatim into \`body\`.
3. Inventory EVERY other file in the skill directory (recurse), classifying each
   as reference / script / asset / example / other, with its absolute path and
   byte size. Do NOT read their full contents yet — just inventory them.

Return the structured Skill IR.`,
  agentOpts({ schema: SKILL_IR_SCHEMA, label: 'ingest', phase: 'Ingest' })
)

if (!ir || !ir.resolved) {
  log(`Could not ingest skill: ${ir ? ir.error : 'ingest agent returned null'}`)
  return {
    ok: false,
    error: ir ? ir.error : 'ingest failed',
    hint: 'Pass args.skillPath (absolute) or args.skillName.',
  }
}
log(`Ingested skill "${ir.name}" — ${ir.files.length} bundled file(s)`)

// Fan-out: deep-read each bundled file in parallel (independent → barrier is fine,
// the decompose step needs all digests together).
const toRead = ir.files.filter((f) => f.kind === 'reference' || f.kind === 'script' || f.kind === 'example')
const digests = (
  await parallel(
    toRead.map((f) => () =>
      agent(
        `Deep-read this file bundled with the skill "${ir.name}" and report what it contributes to the skill's procedure.

File: ${f.path} (kind: ${f.kind})

Summarise the content the eventual Workflow may need to embed inline or invoke,
and note which part(s) of the skill procedure rely on it.`,
        agentOpts({ schema: FILE_DIGEST_SCHEMA, phase: 'Ingest', label: `read:${f.path.split('/').pop()}` })
      )
    )
  )
).filter(Boolean)

const digestBlock = digests.length
  ? digests.map((d) => `- ${d.path}\n  role: ${d.role}\n  digest: ${d.digest}\n  used by: ${d.referencedBySteps}`).join('\n')
  : '(none — this skill is a single SKILL.md with no bundled files)'

// ============================================================================
// PHASE 2 — DECOMPOSE
// ============================================================================
phase('Decompose')
const plan = await agent(
  `Decompose this Agent Skill's procedure into an orchestration plan for a Workflow.

${WORKFLOW_SPEC}

SKILL NAME: ${ir.name}
SKILL DESCRIPTION: ${ir.description}

SKILL.md BODY (the procedure to convert):
"""
${ir.body}
"""

BUNDLED FILES:
${digestBlock}

Your job: read the skill as a PROCEDURE and break it into ordered steps, then
classify each step so it maps cleanly onto Workflow primitives:
- Steps with no data dependency on each other → kind="parallel" (fan-out).
- A step applied to EACH input item → kind="pipeline-stage", perItem=true.
- A step that needs ALL prior results at once (dedup, merge, count) → kind="reduce".
- Any output that could be wrong and benefits from checking → add a kind="verify"
  step (adversarial). Skills written as single-agent advice usually have NO
  verification — adding it is a primary source of the "honey" upgrade, so look
  hard for where a claim/finding/artifact should be adversarially checked.
- Genuinely order-dependent work → kind="sequential".

Prefer pipeline over barriers. Only mark a step "reduce" when it truly needs the
whole set. Justify every parallel/verify classification in \`rationale\`.

Also define: the workflow's \`args\` inputs (with defaults), the phase() groups in
order, and notes on parallelism and verification. Return the structured plan.`,
  agentOpts({ schema: PLAN_SCHEMA, label: 'decompose', phase: 'Decompose' })
)
log(`Plan: ${plan.steps.length} steps across ${plan.phases.length} phases`)

// Resolve the absolute target path up-front so synth/repair/emit all agree on it.
const targetDir = outDir || ir.skillDir
const filename = `${plan.suggestedName || ir.name}.workflow.js`
const targetPath = `${targetDir}/${filename}`

// ============================================================================
// PHASE 3 — SYNTHESIZE
// ============================================================================
phase('Synthesize')
let synth = await agent(
  `Generate a COMPLETE, runnable Workflow JavaScript file that implements the
skill below, following the orchestration plan, and WRITE it to disk.

${WORKFLOW_SPEC}

SKILL NAME: ${ir.name}
SKILL DESCRIPTION: ${ir.description}

SKILL.md BODY (preserve its intent and any specific rules/thresholds verbatim):
"""
${ir.body}
"""

BUNDLED FILES (embed reference content inline where the skill relies on it; have
agents invoke scripts via Bash where the skill runs a script):
${digestBlock}

ORCHESTRATION PLAN:
${JSON.stringify(plan, null, 2)}

Rules for the file you generate:
- Start with a PURE-LITERAL \`export const meta = { name, description, phases }\`.
  Use the plan's suggestedName and phases.
- Read inputs from \`args\` exactly as the plan's \`inputs\` describes, with safe
  defaults (e.g. const target = (args && args.target) || '.').
- Use pipeline() for per-item work, parallel() only for true barriers, and add
  the adversarial verify stage(s) the plan calls for.
- Give every cross-stage hand-off a JSON-Schema via the schema option.
- Preserve the skill's domain rules, thresholds and wording inside agent prompts.
- The spawned agents do the file I/O and tool use; the script only orchestrates.
- Do NOT call Date.now/Math.random/new Date. End with a \`return\` summary object.
- Add a short header comment explaining the workflow was compiled from the skill.

CRITICAL OUTPUT RULES:
- WRITE the file with the Write tool to EXACTLY this absolute path, and nowhere
  else (do not nest it in a subdirectory, do not rename it):
      ${targetPath}
- The file content must be RAW JavaScript ONLY. Do NOT wrap it in Markdown code
  fences. Do NOT include any prose, explanation, or self-commentary in the file.
  Do NOT use "..." / "omitted for brevity" / partial placeholders — the file
  must be COMPLETE and runnable end to end.

${validateInstructions(targetPath)}

Return path, syntaxOk, syntaxError, and a one-line rationale.`,
  agentOpts({ schema: SYNTH_RESULT_SCHEMA, label: 'synthesize', phase: 'Synthesize' })
)
if (!synth) {
  return { ok: false, error: 'synthesize agent returned null', skill: ir.name }
}
log(`Synthesized → ${synth.path}${synth.syntaxOk ? ' (parses ✓)' : ' (PARSE_FAIL — will repair)'}`)

// ============================================================================
// PHASE 4 — VERIFY (parse gate + three adversarial lenses) + REPAIR LOOP
// ============================================================================
phase('Verify')
const LENSES = [
  {
    key: 'convention',
    prompt:
      'CONVENTION lens. Check the workflow against the spec for mechanical correctness EXCEPT raw parsing (a separate gate parses it): (a) file starts with a PURE-LITERAL export const meta with name+description; (b) phase() titles match meta.phases; (c) no Date.now/Math.random/new Date CALLS; (d) plain JS, no TypeScript types; (e) parallel() results are .filter(Boolean)-ed before use; (f) every cross-stage hand-off that is machine-read has a schema; (g) the script returns a value; (h) primitives are not imported. Default pass=false if any blocker exists.',
  },
  {
    key: 'fidelity',
    prompt:
      'FIDELITY lens. Does the workflow actually do everything the SKILL.md procedure does? Walk the skill step by step and confirm each is represented. List any DROPPED step, lost threshold/rule, or changed behaviour as an issue. The workflow may ADD verification/parallelism — that is good — but it must not LOSE any of the skill\'s capability.',
  },
  {
    key: 'parallel',
    prompt:
      'PARALLEL-SOUNDNESS lens. Inspect every parallel()/pipeline() use. Flag FALSE parallelism (steps that actually share a data dependency but were fanned out), UNJUSTIFIED barriers (a parallel() that should be a pipeline), and missing .filter(Boolean). Also flag any place the skill is inherently per-item but was written as a single agent call (a missed parallelisation opportunity).',
  },
]

let round = 0
let verdicts = []
const MAX_ROUNDS = 3
while (round < MAX_ROUNDS) {
  // The three LLM lenses read the file from disk (not an inline copy) and review.
  verdicts = (
    await parallel(
      LENSES.map((l) => () =>
        agent(
          `${l.prompt}

${WORKFLOW_SPEC}

ORIGINAL SKILL PROCEDURE:
"""
${ir.body}
"""

Read the workflow under review from this file: ${synth.path}

Return your verdict. Be strict: pass=true ONLY if there are no blocker/major issues under your lens.`,
          agentOpts({ schema: VERDICT_SCHEMA, phase: 'Verify', label: `verify:${l.key}` })
        )
      )
    )
  ).filter(Boolean)

  const lensIssues = verdicts
    .filter((v) => !v.pass)
    .flatMap((v) => (v.issues || []).map((i) => ({ lens: v.lens, ...i })))
    .filter((i) => i.severity === 'blocker' || i.severity === 'major')

  // The parse gate is a HARD blocker: a workflow that does not parse cannot ship,
  // no matter what the lenses say.
  const allIssues = synth.syntaxOk
    ? lensIssues
    : [
        {
          lens: 'parse-gate',
          severity: 'blocker',
          where: 'whole file',
          problem: `The file does not parse: ${synth.syntaxError || 'PARSE_FAIL'}`,
          fix: 'Rewrite the file as complete raw JavaScript with no Markdown fences, prose, or "..." placeholders, then re-run the parse check until it prints PARSE_OK.',
        },
        ...lensIssues,
      ]

  if (allIssues.length === 0) {
    log(`Verify round ${round + 1}: clean ✓ (parses + all lenses pass)`)
    break
  }
  log(`Verify round ${round + 1}: ${allIssues.length} blocker/major issue(s) → repair`)

  synth = await agent(
    `Repair the generated Workflow file so it parses and passes all three review
lenses. Apply EVERY fix below without regressing anything else, then WRITE the
corrected COMPLETE file back to the same path and re-validate.

${WORKFLOW_SPEC}

ORIGINAL SKILL PROCEDURE (must remain fully represented):
"""
${ir.body}
"""

FILE TO REPAIR (read it, fix it, write it back to this same absolute path):
${synth.path}

ISSUES TO FIX:
${JSON.stringify(allIssues, null, 2)}

CRITICAL OUTPUT RULES:
- Write the corrected file to EXACTLY ${synth.path} (same path), raw JavaScript
  ONLY — no Markdown fences, no prose, no "..."/"omitted" placeholders. The file
  must be COMPLETE and runnable.

${validateInstructions(synth.path)}

Return path, syntaxOk, syntaxError, and a one-line rationale of what you changed.`,
    agentOpts({ schema: SYNTH_RESULT_SCHEMA, phase: 'Verify', label: `repair:${round + 1}` })
  )
  if (!synth) {
    return { ok: false, error: `repair round ${round + 1} returned null`, skill: ir.name }
  }
  round++
}
const passed = synth.syntaxOk && verdicts.length > 0 && verdicts.every((v) => v.pass)

// ============================================================================
// PHASE 5 — EMIT
// ============================================================================
phase('Emit')
const emit = await agent(
  `The compiled workflow has already been written to:
  ${synth.path}

1. Confirm that file exists and re-run the parse check to capture the final
   result:
      ${PARSE_CHECK_CMD} "${synth.path}"
   (It should print PARSE_OK.)

2. Write a conversion report to: ${targetDir}/CONVERSION-REPORT.md
   The report should explain, for a human reader:
   - the source skill ("${ir.name}") and what it does
   - how the procedure was decomposed (the steps + their kinds)
   - what was parallelised vs pipelined and why
   - what adversarial verification was added (the "honey" upgrade)
   - verify outcome: ${passed ? 'passed parse + all lenses' : `completed after ${round} repair round(s); final parse ${synth.syntaxOk ? 'OK' : 'FAILED'}`}
   - how to run the generated workflow

Use this plan as the source for the report:
${JSON.stringify(plan, null, 2)}

Return the workflow path, the report path, the final parse result (syntaxOk), and a one-line note.`,
  agentOpts({ schema: EMIT_SCHEMA, label: 'emit', phase: 'Emit' })
)

return {
  ok: true,
  skill: ir.name,
  outputWorkflow: (emit && emit.workflowPath) || synth.path,
  conversionReport: emit && emit.reportPath,
  syntaxOk: emit ? emit.syntaxOk : synth.syntaxOk,
  verifyRounds: round,
  passedAllLenses: passed,
  steps: plan.steps.length,
}
