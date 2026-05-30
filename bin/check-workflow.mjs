#!/usr/bin/env node
// check-workflow.mjs — syntax-check a Workflow script the way the Workflow tool
// actually runs it.
//
// A workflow script is NOT a standalone module: the Workflow runtime wraps the
// body in an async function and injects agent()/parallel()/pipeline()/phase()/
// log()/args/budget/workflow() as globals. So a valid workflow legitimately:
//   - starts with `export const meta = {...}` (module syntax), and
//   - uses top-level `await` and top-level `return`.
// Plain `node --check` parses the file as a standalone ESM/CJS module and
// rejects BOTH of those with "Illegal return statement" — a false positive.
//
// This checker normalizes the script into the same shape the runtime uses, then
// parses it with vm.Script (a real V8 parse, no execution). The parse step is
// the reliable gate: genuinely truncated output (an LLM cutting off mid-file)
// almost always fails to parse on an unterminated string or bracket.
//
// It adds exactly ONE cheap heuristic on top: detecting a whole file that was
// accidentally wrapped in a Markdown ``` fence (a common LLM mistake when asked
// for "the code"). We deliberately do NOT keyword-scan for "omitted"/"..." —
// a real workflow can legitimately contain those tokens inside agent-prompt
// string literals (this very engine does), so scanning for them false-positives.
//
//   node bin/check-workflow.mjs <file.js> [<file2.js> ...]
//   node bin/check-workflow.mjs --json <file.js>
//
// Exit code 0 = all files OK, 1 = at least one problem.

import vm from 'node:vm'
import { readFileSync } from 'node:fs'

const C = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', dim: '\x1b[2m', yellow: '\x1b[33m' }

/**
 * Check one workflow source string. Returns { ok, errors: [{kind, message, line?}] }.
 * Pure function — no I/O — so the engine can reuse the logic if it wants.
 */
export function checkWorkflowSource(src, filename = 'workflow.js') {
  const errors = []

  // 1. Whole-file Markdown fence: if the FIRST non-blank line opens a ``` fence,
  //    the model handed us a fenced block instead of raw JS. (We only flag a
  //    leading fence — a ``` inside a string literal is fine and common.)
  const firstNonBlank = src.split('\n').find((l) => l.trim() !== '') || ''
  if (/^\s*```/.test(firstNonBlank)) {
    errors.push({ kind: 'fence', line: 1, message: 'File begins with a Markdown code fence (```), but a workflow file must be raw JavaScript only. Remove the surrounding fence.' })
  }

  // 2. meta presence + must be at the top.
  if (!/export\s+const\s+meta\b/.test(src)) {
    errors.push({ kind: 'meta', message: 'Missing `export const meta = {...}` — every workflow must begin with a pure-literal meta export.' })
  }

  // 3. Real parse, in the runtime's shape: strip the `export` keyword and wrap
  //    the body in an async function so top-level await/return are legal. This
  //    is the gate that catches genuine truncation (unterminated string/bracket).
  const normalized = src.replace(/export\s+const\s+meta/, 'const meta')
  const wrapped =
    'async function __workflow__(agent, parallel, pipeline, phase, log, workflow, args, budget) {\n' +
    normalized +
    '\n}'
  try {
    // vm.Script compiles (parses) without running. SyntaxError on bad syntax.
    new vm.Script(wrapped, { filename })
  } catch (e) {
    // Map the wrapped line number back to the source (we prepended 1 line).
    let line
    const m = /<anonymous>:(\d+)|:(\d+)\n/.exec(e.stack || '')
    if (m) line = Number(m[1] || m[2]) - 1
    errors.push({ kind: 'syntax', line, message: e.message })
  }

  return { ok: errors.length === 0, errors }
}

// ---- CLI ----
const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
const files = argv.filter((a) => !a.startsWith('--'))

if (files.length === 0) {
  console.error('usage: node bin/check-workflow.mjs [--json] <file.js> [...]')
  process.exit(2)
}

const results = files.map((file) => {
  let src
  try {
    src = readFileSync(file, 'utf8')
  } catch (e) {
    return { file, ok: false, errors: [{ kind: 'io', message: `cannot read: ${e.message}` }] }
  }
  return { file, ...checkWorkflowSource(src, file) }
})

if (asJson) {
  console.log(JSON.stringify(results, null, 2))
} else {
  for (const r of results) {
    if (r.ok) {
      console.log(`${C.green}✓${C.reset} ${r.file}`)
    } else {
      console.log(`${C.red}✗${C.reset} ${r.file}`)
      for (const err of r.errors) {
        const at = err.line ? `${C.dim}(line ${err.line})${C.reset} ` : ''
        console.log(`  ${C.yellow}${err.kind}${C.reset} ${at}${err.message}`)
      }
    }
  }
}

process.exit(results.every((r) => r.ok) ? 0 : 1)
