---
name: doc-audit
description: Audit a documentation folder for quality problems across multiple dimensions (broken links, stale code examples, missing sections, readability) and produce a prioritized report with suggested fixes. Use when asked to "audit the docs", "check documentation quality", or before a docs release.
---

# Doc Audit

## Overview

This skill audits a documentation folder and produces a single prioritized
report of quality problems. It checks four independent dimensions, confirms each
finding is real, and groups the results by severity.

## When to use

Use when the user asks to audit documentation, check docs quality, or do a
pre-release docs pass on a folder of Markdown/MDX files.

## Procedure

### Step 1 — Inventory

List every documentation file under the target folder (default: `./docs`).
Record the relative path and size of each `.md` / `.mdx` file. If there are no
docs, stop and report that.

### Step 2 — Audit the four dimensions

For the inventory, check these four dimensions. They are independent — none of
them depends on the result of another:

1. **Broken links** — find internal links that point to missing files/anchors
   and external links that look dead or malformed.
2. **Stale code examples** — find fenced code blocks that reference APIs,
   flags, or file paths that no longer exist in the project.
3. **Missing sections** — compare each page against the expected shape for its
   type (a how-to needs prerequisites + steps; a reference needs a parameter
   table) and list missing sections.
4. **Readability** — flag pages with overlong paragraphs, undefined jargon, or
   a reading level inappropriate for the audience.

For each dimension, produce a list of findings. Each finding has: file, a short
title, a severity (blocker / major / minor), and a suggested fix.

### Step 3 — Verify each finding

Documentation audits produce false positives (a "broken" link that is actually
valid, a "stale" example that still works). Before reporting, confirm each
finding is real by re-checking it against the actual files. Drop findings that
do not hold up.

### Step 4 — Prioritize and report

Merge the confirmed findings from all four dimensions, de-duplicate any that
overlap, sort by severity (blockers first), and write a single
`DOC-AUDIT.md` report grouped by dimension with a summary count at the top.

## Notes

- Treat `README.md` as a how-to for the "missing sections" check.
- Never edit the docs themselves — this skill only reports.
