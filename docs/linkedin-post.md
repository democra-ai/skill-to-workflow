# LinkedIn post · skill-to-workflow

> Paste the body below into LinkedIn, then paste the repo link
> (https://github.com/democra-ai/skill-to-workflow) on its own line so the
> link preview (the social-preview card) unfurls. Optionally attach
> `assets/linkedin-poster-en.png`.

---

**Option A — story-led (recommended)**

There's a skill for making skills. So I built the workflow that makes workflows.

Claude Agent Skills are everywhere now — a SKILL.md that teaches an agent a procedure, sometimes with bundled references and scripts. They're great. But a skill runs in one agent, one context, one step at a time. The parallelism is sitting right there in the prose — "check A, B and C, then verify each" — flattened, because a single agent can't fan out.

skill-to-workflow is a meta-workflow that reads a skill and compiles it into a multi-agent Claude Code Workflow:

→ Parallelises independent steps (fan-out / pipeline) instead of running them in series
→ Adds adversarial verification — every finding gets N skeptics trying to refute it, kept only if a majority can't
→ Types the hand-offs between stages with JSON Schema

And it verifies its own output: a real parse gate plus three adversarial review lenses, in a repair loop.

Same procedure. A fraction of the wall-clock. Far fewer false positives.

Open source (MIT), zero runtime deps, one-line install:
npx github:democra-ai/skill-to-workflow

What's the first skill you'd compile?

https://github.com/democra-ai/skill-to-workflow

#ClaudeCode #AIAgents #Anthropic #OpenSource #DeveloperTools

---

**Option B — short & punchy**

A skill runs in one agent, one step at a time. A workflow fans out across many.

skill-to-workflow compiles the first into the second — automatically. It reads a Claude Agent Skill, recovers the parallelism hidden in its prose, and emits a multi-agent Workflow that runs concurrently, adversarially verifies every finding, and types its hand-offs. It even verifies its own output.

Open source, MIT, zero deps:
npx github:democra-ai/skill-to-workflow

https://github.com/democra-ai/skill-to-workflow

#ClaudeCode #AIAgents #OpenSource #Anthropic

---

## Notes on the link preview

- LinkedIn pulls the **Open Graph image** from the GitHub repo. We set a custom
  **social-preview card** (`assets/og-card.png`, 1280×640) so the unfurl shows the
  branded hero-style card instead of GitHub's default repo card.
- A link preview can't be an animated SVG — it must be a static PNG/JPG at ~2:1.
  That's exactly what `og-card.png` is (same visual language as the animated hero).
- If LinkedIn shows a stale/default preview, refresh it with the
  **LinkedIn Post Inspector**: https://www.linkedin.com/post-inspector/
  (paste the repo URL and click "Inspect" to bust the cache).
