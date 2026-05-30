// doc-audit.workflow.js
//
// Compiled from the `doc-audit` skill (SKILL.md) into a deterministic Workflow.
//
// What the original single-agent skill did sequentially, this workflow
// orchestrates as subagents:
//   1. Inventory the docs folder (typed) and short-circuit if it is empty.
//   2. Fan the four INDEPENDENT dimensions (broken links, stale code, missing
//      sections, readability) out as items flowing through a pipeline so each
//      dimension streams straight into its own verification with NO barrier
//      between dimensions.
//   3. Adversarially verify every finding: N independent skeptics per finding,
//      each prompted to REFUTE it against the real files; a finding survives
//      only if a MAJORITY fail to refute it. This is the false-positive screen
//      the skill's Step 3 demands but the single-agent version only gestured at.
//   4. The single true barrier: merge every confirmed finding, de-duplicate
//      overlaps (logging anything dropped), severity-sort, and write ONE
//      DOC-AUDIT.md grouped by dimension with a summary count at the top.
//
// The workflow ONLY reports. It never edits the docs (skill Notes).

export const meta = {
  name: 'doc-audit',
  description:
    'Audit a documentation folder for quality problems across four independent dimensions (broken links, stale code examples, missing sections, readability), adversarially verify every finding to strip false positives, then merge, de-duplicate, and severity-sort the survivors into a single prioritized DOC-AUDIT.md report. Report-only: the docs are never edited.',
  whenToUse:
    'When asked to "audit the docs", "check documentation quality", or to do a pre-release docs pass on a folder of Markdown/MDX files.',
  phases: [
    {
      title: 'Inventory',
      detail:
        'Discover all .md/.mdx files under the target folder (default ./docs), record relative path + size, and short-circuit the whole run with a clear message if no docs exist. Sequential gate; emits a typed inventory consumed by every dimension stage.',
    },
    {
      title: 'Audit the four dimensions',
      detail:
        'Fan out the four independent checks — broken links, stale code examples, missing sections, readability — each producing a list of {file, title, severity, suggestedFix} findings. Modeled as the first stage of a per-dimension pipeline so each dimension flows straight into its own verification without a barrier.',
    },
    {
      title: 'Verify each finding',
      detail:
        'Adversarial false-positive screen: for each finding, N independent skeptics (default 3) re-check it against the real files and try to refute it; the finding survives only if a majority fail to refute. Runs as the second pipeline stage per dimension, with no barrier across dimensions.',
    },
    {
      title: 'Prioritize and report',
      detail:
        'The single barrier: merge all confirmed findings, de-duplicate overlaps (logging anything dropped), sort by severity (blockers first), and write one DOC-AUDIT.md grouped by dimension with a summary count at the top. Report only — never edits the docs.',
    },
  ],
};

// ---- Inputs (with safe defaults so the workflow runs with no args) ----------
const folder = (args && args.folder) || './docs';
const reportPath = (args && args.reportPath) || 'DOC-AUDIT.md';
const verifiers =
  args && Number.isFinite(args.verifiers) && args.verifiers > 0
    ? Math.floor(args.verifiers)
    : 3;
const severityOrder =
  args && Array.isArray(args.severityOrder) && args.severityOrder.length
    ? args.severityOrder
    : ['blocker', 'major', 'minor'];
const readmeAsHowTo = !(args && args.readmeAsHowTo === false); // default true

// Majority threshold: a finding is kept only if MORE THAN HALF of the skeptics
// fail to refute it. With verifiers=3 (odd, so "majority" is unambiguous) that
// means >=2 must fail to refute.
const keepThreshold = Math.floor(verifiers / 2) + 1;

// ---- Shared schemas --------------------------------------------------------
const inventorySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['count', 'files'],
  properties: {
    count: {
      type: 'integer',
      description: 'Total number of .md/.mdx files found under the target folder.',
    },
    files: {
      type: 'array',
      description: 'Every documentation file discovered.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'sizeBytes'],
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file relative to the target folder.',
          },
          sizeBytes: { type: 'integer', description: 'File size in bytes.' },
        },
      },
    },
  },
};

const findingsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'findings'],
  properties: {
    dimension: {
      type: 'string',
      description: 'The audit dimension that produced these findings.',
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'title', 'severity', 'suggestedFix'],
        properties: {
          file: {
            type: 'string',
            description: 'Path (relative to the docs folder) the finding is about.',
          },
          title: {
            type: 'string',
            description: 'Short one-line title of the problem.',
          },
          severity: {
            type: 'string',
            enum: ['blocker', 'major', 'minor'],
            description: 'blocker > major > minor.',
          },
          suggestedFix: {
            type: 'string',
            description: 'Concrete suggested fix. Advice only — never applied.',
          },
          evidence: {
            type: 'string',
            description:
              'Exact quote / link target / line reference that makes the finding checkable by a skeptic.',
          },
        },
      },
    },
  },
};

const verifiedSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'confirmed'],
  properties: {
    dimension: { type: 'string' },
    confirmed: {
      type: 'array',
      description:
        'Only the findings that survived the adversarial majority-refute screen.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'title', 'severity', 'suggestedFix', 'refuteFails', 'verifiers'],
        properties: {
          file: { type: 'string' },
          title: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          suggestedFix: { type: 'string' },
          evidence: { type: 'string' },
          refuteFails: {
            type: 'integer',
            description: 'How many skeptics FAILED to refute (i.e. confirmed it).',
          },
          verifiers: {
            type: 'integer',
            description: 'Total skeptics that examined this finding.',
          },
        },
      },
    },
    droppedCount: {
      type: 'integer',
      description: 'How many findings were dropped as false positives.',
    },
  },
};

// ---- The four independent dimension descriptors ----------------------------
// These are the UNIT OF WORK that flows through the pipeline. The skill states
// the four dimensions are independent — none depends on another's result — so
// they fan out, and each dimension's two operations (audit -> verify) run as
// pipeline stages with NO barrier between them.
const dimensions = [
  {
    id: 'broken-links',
    label: 'Broken links',
    instruction:
      'BROKEN LINKS. Find internal links that point to missing files or missing anchors/headings, ' +
      'and external links that look dead or malformed. For internal links, resolve them relative to ' +
      'the file they appear in and confirm the target file (and #anchor, if any) actually exists. ' +
      'Treat both Markdown links [text](url) and MDX/HTML <a href> and image sources.',
    refuteLens:
      'Re-resolve the link target relative to the offending file. The finding is WRONG (refuted) if ' +
      'the target file/anchor actually exists, if the link is a valid external URL, or if it is an ' +
      'intentional placeholder/anchor that resolves at build time.',
  },
  {
    id: 'stale-code',
    label: 'Stale code examples',
    instruction:
      'STALE CODE EXAMPLES. Find fenced code blocks (```...```) that reference APIs, CLI flags, ' +
      'environment variables, or file paths that no longer exist in the project. Cross-check each ' +
      'referenced symbol/flag/path against the actual project source outside the docs folder.',
    refuteLens:
      'Re-check the referenced API/flag/path against the live project surface. The finding is WRONG ' +
      '(refuted) if the symbol/flag/path still exists, if it is pseudo-code/illustrative and not meant ' +
      'to be literal, or if it lives in a dependency that is genuinely present.',
  },
  {
    id: 'missing-sections',
    label: 'Missing sections',
    instruction:
      'MISSING SECTIONS. Compare each page against the expected shape for its type: a how-to needs ' +
      'prerequisites + steps; a reference needs a parameter table. List sections that are missing. ' +
      (readmeAsHowTo
        ? 'IMPORTANT (skill Note): treat README.md as a how-to for this check. '
        : '') +
      'Infer the page type from its filename, location, and headings.',
    refuteLens:
      'Re-read the document structure. The finding is WRONG (refuted) if the "missing" section is ' +
      'actually present under a differently-worded heading, if the page type was misclassified ' +
      '(so the section is not expected), or if the content is covered inline without a dedicated heading.',
  },
  {
    id: 'readability',
    label: 'Readability',
    instruction:
      'READABILITY. Flag pages with overlong paragraphs, undefined jargon (terms used before they are ' +
      'defined or linked), or a reading level inappropriate for the audience. Identify the intended ' +
      'audience from context before judging reading level.',
    refuteLens:
      'Re-assess against the intended audience. The finding is WRONG (refuted) if the paragraph length ' +
      'is acceptable for the audience, if the jargon is in fact defined/linked nearby, or if the ' +
      'reading level is appropriate for the stated/implied readership.',
  },
];

// ===========================================================================
// PHASE 1 — Inventory (sequential gate + zero-count early-exit)
// ===========================================================================
phase('Inventory');
log(`Inventorying .md/.mdx files under ${folder} ...`);

const inventory = await agent(
  `You are auditing the documentation folder "${folder}".

TASK: Inventory every documentation file under "${folder}".
- Recurse into subfolders.
- Include only files ending in ".md" or ".mdx".
- For each file record its path RELATIVE to "${folder}" and its size in bytes.
- Use your Read/Bash tools (e.g. find/ls) to discover and stat files. Do NOT edit anything.

If the folder does not exist or contains zero .md/.mdx files, return count: 0 and an empty files array.

Return the typed inventory.`,
  {
    label: 'inventory',
    phase: 'Inventory',
    schema: inventorySchema,
  }
);

// Zero-count early-exit: a sanctioned barrier-like short-circuit. Do not emit a
// misleading empty report when there is nothing to audit.
if (!inventory || !inventory.count || inventory.count === 0) {
  log(
    `No .md/.mdx documentation files found under "${folder}". Nothing to audit — stopping without writing a report.`
  );
  return {
    workflow: 'doc-audit',
    folder,
    audited: false,
    reason: 'no-docs-found',
    fileCount: 0,
    reportPath: null,
  };
}

log(
  `Found ${inventory.count} documentation file(s). Auditing ${dimensions.length} dimensions with ${verifiers} skeptic(s) per finding (keep if >= ${keepThreshold} fail to refute).`
);

// A compact, machine-passable manifest every downstream agent can rely on.
const manifest = inventory.files
  .map((f) => `- ${f.path} (${f.sizeBytes} bytes)`)
  .join('\n');

// ===========================================================================
// PHASE 2 + 3 — Per-dimension pipeline: audit  ->  adversarial verify
// No barrier between dimensions: a fast dimension (readability) can reach
// verification while a slow one (external-link liveness) is still auditing.
// ===========================================================================
const verifiedPerDimension = await pipeline(
  dimensions,

  // ----- Stage A: AUDIT one dimension across the whole inventory -----------
  async (_prev, dim) => {
    return await agent(
      `You are a documentation auditor checking ONE dimension of the docs in "${folder}".

DIMENSION: ${dim.instruction}

These are the documentation files (path relative to "${folder}", with size):
${manifest}

INSTRUCTIONS:
- Read whatever files you need with your tools. You MAY also inspect the surrounding
  project (source code, config) when the dimension requires it (e.g. stale code).
- This dimension is INDEPENDENT of the other audit dimensions — do not worry about them.
- Produce a list of findings. Each finding MUST have:
    file         — the doc path (relative to "${folder}") it is about
    title        — a short one-line description of the problem
    severity     — one of: blocker, major, minor
    suggestedFix — a concrete fix (ADVICE ONLY; you must NOT edit any file)
    evidence     — the exact quote / link target / symbol / line ref that makes
                   the finding independently checkable by someone else
- Be precise: a later skeptic will try to REFUTE each finding against the real files,
  so include enough evidence to make a true finding survive and a guess get dropped.
- If you find nothing for this dimension, return an empty findings array.
- NEVER edit the docs. This is a read-only audit.

Return the typed findings for dimension "${dim.id}".`,
      {
        label: `audit:${dim.id}`,
        phase: 'Audit the four dimensions',
        schema: findingsSchema,
      }
    );
  },

  // ----- Stage B: VERIFY this dimension's findings (adversarial, N skeptics) -
  async (auditResult, dim) => {
    const findings =
      auditResult && Array.isArray(auditResult.findings)
        ? auditResult.findings
        : [];

    if (findings.length === 0) {
      log(`[${dim.id}] no findings to verify.`);
      return { dimension: dim.id, confirmed: [], droppedCount: 0 };
    }

    log(
      `[${dim.id}] verifying ${findings.length} finding(s) with ${verifiers} skeptic(s) each ...`
    );

    // For EACH finding, fan out N independent skeptics that try to REFUTE it.
    // Keep the finding only if a MAJORITY fail to refute.
    const confirmedNested = await Promise.all(
      findings.map(async (finding, fIdx) => {
        const findingJson = JSON.stringify(finding, null, 2);

        const verdicts = await parallel(
          Array.from({ length: verifiers }, (_unused, sIdx) => () =>
            agent(
              `You are skeptic #${sIdx + 1} of ${verifiers}, independently fact-checking a single ` +
                `documentation audit finding. Your job is to REFUTE it if you can.\n\n` +
                `Docs folder: "${folder}"\n` +
                `Dimension: ${dim.id}\n\n` +
                `THE FINDING UNDER REVIEW:\n${findingJson}\n\n` +
                `HOW TO REFUTE THIS DIMENSION:\n${dim.refuteLens}\n\n` +
                `INSTRUCTIONS:\n` +
                `- Re-open the actual file(s) named in the finding (and the surrounding project if relevant) with your tools.\n` +
                `- Try hard to PROVE THE FINDING WRONG. Doc audits produce false positives — a "broken" link that actually resolves, a "stale" example that still works, a "missing" section that exists under another heading, a readability complaint that is fine for the audience.\n` +
                `- Decide: is the finding REAL (a genuine problem) or REFUTED (a false positive)?\n` +
                `- Do NOT edit any file. Read-only.\n\n` +
                `Answer on the FIRST line with exactly one token: REAL or REFUTED.\n` +
                `Then one sentence explaining why.`,
              {
                label: `verify:${dim.id}#${fIdx + 1}.${sIdx + 1}`,
                phase: 'Verify each finding',
              }
            )
          )
        );

        // parallel() never rejects; a thrown/empty skeptic resolves to null.
        // Treat a non-answering skeptic conservatively as a refutation (it did
        // NOT confirm the finding), so weak findings are not kept by default.
        const answers = verdicts.map((v) =>
          typeof v === 'string' ? v.trim().toUpperCase() : ''
        );
        const refuteFails = answers.filter((a) => a.startsWith('REAL')).length;
        const kept = refuteFails >= keepThreshold;

        if (!kept) {
          log(
            `[${dim.id}] dropped false positive: "${finding.title}" (${finding.file}) — only ${refuteFails}/${verifiers} skeptics confirmed.`
          );
          return null;
        }
        return {
          file: finding.file,
          title: finding.title,
          severity: finding.severity,
          suggestedFix: finding.suggestedFix,
          evidence: finding.evidence || '',
          refuteFails,
          verifiers,
        };
      })
    );

    const confirmed = confirmedNested.filter(Boolean);
    const droppedCount = findings.length - confirmed.length;
    log(
      `[${dim.id}] verified: ${confirmed.length} confirmed, ${droppedCount} dropped as false positives.`
    );
    return { dimension: dim.id, confirmed, droppedCount };
  }
);

// pipeline() drops a failed item to null — filter before reducing.
const dimensionResults = (verifiedPerDimension || []).filter(Boolean);

// ===========================================================================
// PHASE 4 — Prioritize and report (THE single true barrier)
// Merge across ALL dimensions, de-dup overlaps, severity-sort, write ONE file.
// ===========================================================================
phase('Prioritize and report');

const totalConfirmed = dimensionResults.reduce(
  (n, d) => n + (d.confirmed ? d.confirmed.length : 0),
  0
);
const totalDropped = dimensionResults.reduce(
  (n, d) => n + (d.droppedCount || 0),
  0
);

log(
  `Merging ${totalConfirmed} confirmed finding(s) across ${dimensionResults.length} dimension(s) (${totalDropped} dropped as false positives). Writing ${reportPath} ...`
);

if (totalConfirmed === 0) {
  log(
    `No confirmed problems survived verification. Writing a clean-bill-of-health ${reportPath}.`
  );
}

const reportResult = await agent(
  `You are writing the FINAL documentation audit report. This is the only barrier in the run:
you have EVERY confirmed finding from EVERY dimension at once.

Docs folder audited: "${folder}"
Files audited: ${inventory.count}
Skeptics per finding: ${verifiers} (a finding was kept only if >= ${keepThreshold} skeptics confirmed it)
Severity sort order (highest first): ${JSON.stringify(severityOrder)}

CONFIRMED FINDINGS BY DIMENSION (already passed the adversarial false-positive screen):
${JSON.stringify(dimensionResults, null, 2)}

YOUR TASK:
1. MERGE every confirmed finding from all dimensions into one population.
2. DE-DUPLICATE: if two findings describe the SAME underlying issue in the SAME file
   (e.g. flagged by two dimensions), keep one and note the overlap. For each duplicate
   you remove, emit a line to your prose under a "Merged duplicates" note so nothing
   disappears silently.
3. SORT by severity using the order above (${severityOrder.join(' > ')}).
4. WRITE a single Markdown file at "${reportPath}" with:
     - A title and a SUMMARY COUNT at the TOP: totals overall and per severity
       (blocker / major / minor) and per dimension.
     - The findings GROUPED BY DIMENSION (broken-links, stale-code, missing-sections,
       readability). Within each group, sort by severity. For each finding show:
       file, title, severity, and the suggested fix.
     - A short "Merged duplicates" section listing any overlaps you collapsed.
   ${totalConfirmed === 0
      ? 'There are NO confirmed findings — write a clean report stating the docs passed the audit, still including the (zero) summary counts.'
      : ''}

HARD RULES:
- Write ONLY the report file "${reportPath}". You MUST NOT edit, fix, or modify any
  documentation file or any project source. This skill only reports.

After writing the file, reply with a one-line confirmation of the path written and the
total number of findings in the report.`,
  {
    label: 'report',
    phase: 'Prioritize and report',
  }
);

log(`Report written to ${reportPath}.`);

// ---- Run summary -----------------------------------------------------------
return {
  workflow: 'doc-audit',
  folder,
  audited: true,
  fileCount: inventory.count,
  verifiersPerFinding: verifiers,
  keepThreshold,
  reportPath,
  totalConfirmed,
  totalDroppedAsFalsePositive: totalDropped,
  perDimension: dimensionResults.map((d) => ({
    dimension: d.dimension,
    confirmed: d.confirmed ? d.confirmed.length : 0,
    dropped: d.droppedCount || 0,
  })),
  reportAgentNote: typeof reportResult === 'string' ? reportResult : null,
};
