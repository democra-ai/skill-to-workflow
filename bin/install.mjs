#!/usr/bin/env node
// install.mjs — drop the skill-to-workflow meta-workflow where Claude Code can
// find it by name. Default: ~/.claude/workflows/ (global). --project: ./.claude/workflows/.
//
//   npx skill-to-workflow            # install globally
//   npx skill-to-workflow --project  # install into the current project
//   npx skill-to-workflow --help

import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { existsSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const src = join(repoRoot, 'workflows', 'skill-to-workflow.js')

const args = process.argv.slice(2)
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  purple: '\x1b[38;5;99m', green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m',
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
${C.bold}${C.purple}skill-to-workflow${C.reset} — compile a Claude Agent Skill into a Workflow

${C.bold}Install${C.reset}
  npx skill-to-workflow              install to ~/.claude/workflows/ (global)
  npx skill-to-workflow --project    install to ./.claude/workflows/ (this repo)

${C.bold}Then, inside Claude Code${C.reset}, run the Workflow tool:
  ${C.dim}Workflow({ name: "skill-to-workflow",${C.reset}
  ${C.dim}           args: { skillName: "doc-audit" } })${C.reset}
  ${C.dim}# or: args: { skillPath: "/abs/path/to/skill", outDir: "/abs/out" }${C.reset}

Docs: https://github.com/democra-ai/skill-to-workflow#readme
`)
  process.exit(0)
}

const isProject = args.includes('--project') || args.includes('-p')
const destDir = isProject
  ? join(process.cwd(), '.claude', 'workflows')
  : join(homedir(), '.claude', 'workflows')
const dest = join(destDir, 'skill-to-workflow.js')

if (!existsSync(src)) {
  console.error(`${C.yellow}✗ Could not find the workflow at ${src}${C.reset}`)
  process.exit(1)
}

mkdirSync(destDir, { recursive: true })
copyFileSync(src, dest)

const version = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version

console.log(`
${C.green}✓${C.reset} Installed ${C.bold}skill-to-workflow${C.reset} ${C.dim}v${version}${C.reset}
  ${C.dim}→${C.reset} ${dest}

${C.bold}Run it inside Claude Code:${C.reset}
  ${C.cyan}Workflow({ name: "skill-to-workflow", args: { skillName: "doc-audit" } })${C.reset}

  ${C.dim}args.skillName  resolve a skill under ~/.claude/skills/<name>${C.reset}
  ${C.dim}args.skillPath  absolute path to a skill directory${C.reset}
  ${C.dim}args.outDir     where to write the generated workflow (default: skill dir)${C.reset}

${C.dim}The generated workflow lands next to the skill (or in outDir), with a${C.reset}
${C.dim}CONVERSION-REPORT.md explaining what was parallelised and verified.${C.reset}
`)
