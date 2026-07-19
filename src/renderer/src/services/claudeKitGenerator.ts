// ── Claude Kit Generator ─────────────────────────────────────────────────────
// Builds a ready-to-use Claude Code starter kit (CLAUDE.md, AGENTS.md/agent
// definition, a plugin, and skills) from a short user brief, then bundles it
// into a ZIP via the existing file:saveZip IPC.
//
// Layout of the produced archive (user-approved):
//   <request-name>.zip
//   ├── claude.md
//   ├── agent.md
//   ├── plugin/
//   │   ├── .claude-plugin/plugin.json
//   │   └── commands/<command>.md
//   └── .claude/
//       └── skills/<skill-name>/SKILL.md     (one folder per skill)
//
// Every file's content is produced by the configured AI provider (same
// ai:chat chain the extension generator uses); if the model is unavailable
// or returns junk, a deterministic local template keeps the kit usable.

export interface KitSkill {
  name: string
  description: string
}

export interface KitRequest {
  requestName: string     // becomes the zip filename
  projectDesc: string     // what the project is — drives claude.md
  agentDesc: string       // what the agent should do — drives agent.md
  pluginName: string
  pluginDesc: string
  pluginCommands: string  // comma/newline-separated command names
  skills: KitSkill[]
}

export interface KitFile {
  path: string
  content: string
}

// kebab-case a user-typed name into something safe for folders/filenames
export function slugify(s: string, fallback: string): string {
  const slug = (s || '').toLowerCase().trim()
    .replace(/[^a-z0-9\s_-]/g, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-')
    .replace(/^-|-$/g, '').slice(0, 60)
  return slug || fallback
}

function parseCommands(raw: string): string[] {
  return (raw || '').split(/[,\n]/).map(c => slugify(c, '')).filter(Boolean).slice(0, 10)
}

// Strip a markdown code fence if the model wrapped the whole file in one
function unfence(raw: string): string {
  const m = raw.trim().match(/^```(?:markdown|md|json)?\s*\n([\s\S]*?)\n```$/)
  return (m ? m[1] : raw).trim() + '\n'
}

type ChatFn = (prompt: string) => Promise<string>

// One ai:chat round for one file. Returns '' on any failure so the caller
// falls back to the local template.
async function aiGen(chat: ChatFn, prompt: string): Promise<string> {
  try {
    const out = await chat(prompt)
    const clean = unfence(out || '')
    return clean.length > 40 ? clean : ''
  } catch { return '' }
}

const STYLE_RULES = `Write production-quality documentation. Respond with ONLY the file content — no preamble, no explanation, no code fence around the whole file.`

// ── Per-file prompts + local fallbacks ──────────────────────────────────────

function claudeMdPrompt(req: KitRequest): string {
  return `You are an expert at writing CLAUDE.md files for Claude Code (Anthropic's CLI coding agent). A CLAUDE.md sits at a repo root and gives the agent persistent project context: overview, architecture, conventions, commands, and development instructions.

Write a complete claude.md for this project:
"${req.projectDesc}"

Include sections: Project Overview, Architecture, Development Guidelines (code style, testing, security), Key Commands, and Do/Don't rules. Make it specific to the described project, not generic filler. ${STYLE_RULES}`
}

function claudeMdFallback(req: KitRequest): string {
  return `# CLAUDE.md

## Project Overview

${req.projectDesc || 'Describe your project here.'}

## Architecture

- Describe the main modules and how they fit together.
- List the primary technologies and frameworks.

## Development Guidelines

1. Write production-quality, maintainable code.
2. Follow the existing code style and naming conventions.
3. Add tests for new functionality.
4. Never commit secrets or API keys.

## Key Commands

- \`npm install\` — install dependencies
- \`npm run dev\` — start development
- \`npm test\` — run tests

## Rules

- Do: keep changes small and focused.
- Don't: introduce new dependencies without a reason.
`
}

function agentMdPrompt(req: KitRequest): string {
  return `You are an expert at writing agent definition files (agent.md) for Claude Code subagents. An agent.md starts with YAML frontmatter (name, description, tools) followed by the agent's system prompt in markdown.

Write a complete agent.md for this agent:
"${req.agentDesc}"

Format:
---
name: <kebab-case-name>
description: <one sentence: when to use this agent>
tools: Read, Grep, Glob, Bash, Edit, Write
---

<detailed system prompt: the agent's role, responsibilities, step-by-step approach, and quality rules>

Make the system prompt specific and actionable for the described role. ${STYLE_RULES}`
}

function agentMdFallback(req: KitRequest): string {
  const name = slugify(req.agentDesc.split(/\s+/).slice(0, 3).join(' '), 'custom-agent')
  return `---
name: ${name}
description: ${req.agentDesc || 'A specialized assistant agent.'}
tools: Read, Grep, Glob, Bash, Edit, Write
---

You are a specialized agent. Your mission: ${req.agentDesc || 'assist with the project tasks.'}

## Approach

1. Understand the request fully before acting.
2. Explore the relevant files first; never guess at code you can read.
3. Make small, verifiable changes.
4. Verify your work (run tests/builds where available) before reporting done.

## Quality rules

- Be precise and honest about what was done.
- Surface problems instead of hiding them.
- Follow the project's CLAUDE.md conventions.
`
}

function pluginJson(req: KitRequest): string {
  return JSON.stringify({
    name: slugify(req.pluginName, 'my-plugin'),
    description: req.pluginDesc || req.pluginName || 'Custom Claude Code plugin',
    version: '0.1.0',
  }, null, 2) + '\n'
}

function commandPrompt(req: KitRequest, cmd: string): string {
  return `You are an expert at writing Claude Code plugin command files. A command file is markdown with YAML frontmatter (description) followed by the instructions Claude follows when the user invokes /${cmd}.

The plugin: "${req.pluginName}" — ${req.pluginDesc}
Write the command file for the command "/${cmd}".

Format:
---
description: <one line describing what /${cmd} does>
---

<clear step-by-step instructions for what Claude should do when this command runs>

${STYLE_RULES}`
}

function commandFallback(req: KitRequest, cmd: string): string {
  return `---
description: ${cmd.replace(/-/g, ' ')} — part of the ${req.pluginName || 'plugin'} plugin
---

When the user invokes /${cmd}:

1. Understand what the user is asking for in the context of: ${req.pluginDesc || req.pluginName || 'this plugin'}.
2. Carry out the task step by step.
3. Report the result clearly.
`
}

function skillPrompt(skill: KitSkill): string {
  return `You are an expert at writing SKILL.md files for Claude Code agent skills. A SKILL.md starts with YAML frontmatter (name, description) followed by the skill's instructions in markdown. The description is critical: it tells the agent WHEN to invoke the skill.

Write a complete SKILL.md for this skill:
Name: "${skill.name}"
Purpose: "${skill.description}"

Format:
---
name: ${slugify(skill.name, 'my-skill')}
description: <when to use this skill — include concrete trigger phrases and situations>
---

<the skill's full instructions: what to do, step by step, with any checklists or rules>

${STYLE_RULES}`
}

function skillFallback(skill: KitSkill): string {
  return `---
name: ${slugify(skill.name, 'my-skill')}
description: ${skill.description || `Use when the task involves ${skill.name}.`}
---

# ${skill.name}

${skill.description || 'Describe what this skill does.'}

## Instructions

1. Identify what the user needs in the context of this skill.
2. Follow the project's conventions (see CLAUDE.md).
3. Execute the task step by step, verifying each stage.
4. Summarize what was done.
`
}

// ── Kit assembly ────────────────────────────────────────────────────────────

export interface KitProgress {
  (label: string, done: number, total: number): void
}

/** Generates every kit file (AI-first, template fallback). `chat` wraps
 *  ai:chat and returns raw model text for one prompt. */
export async function generateKitFiles(req: KitRequest, chat: ChatFn, onProgress?: KitProgress): Promise<KitFile[]> {
  const commands = parseCommands(req.pluginCommands)
  const skills = req.skills.filter(s => s.name.trim())
  const total = 2 + commands.length + skills.length
  let done = 0
  const tick = (label: string) => { done++; onProgress?.(label, done, total) }

  const files: KitFile[] = []

  const claudeMd = (await aiGen(chat, claudeMdPrompt(req))) || claudeMdFallback(req)
  files.push({ path: 'claude.md', content: claudeMd })
  tick('claude.md')

  const agentMd = (await aiGen(chat, agentMdPrompt(req))) || agentMdFallback(req)
  files.push({ path: 'agent.md', content: agentMd })
  tick('agent.md')

  files.push({ path: 'plugin/.claude-plugin/plugin.json', content: pluginJson(req) })
  for (const cmd of commands.length ? commands : ['run']) {
    const content = (await aiGen(chat, commandPrompt(req, cmd))) || commandFallback(req, cmd)
    files.push({ path: `plugin/commands/${cmd}.md`, content })
    tick(`plugin/commands/${cmd}.md`)
  }

  for (const skill of skills) {
    const folder = slugify(skill.name, 'skill')
    const content = (await aiGen(chat, skillPrompt(skill))) || skillFallback(skill)
    files.push({ path: `.claude/skills/${folder}/SKILL.md`, content })
    tick(`${folder}/SKILL.md`)
  }

  files.push({
    path: 'README.md',
    content: `# ${req.requestName || 'Claude Kit'}

Generated by AIHub Browser's Claude Kit Generator.

## How to use

1. Copy \`claude.md\` to your repository root (Claude Code reads it automatically — conventionally named \`CLAUDE.md\`).
2. Copy \`agent.md\` into \`.claude/agents/\` in your repo to register the subagent.
3. Copy the \`plugin/\` folder into your Claude Code plugins location to install the plugin.
4. The \`.claude/skills/\` folder drops straight into your repo — each skill folder contains its \`SKILL.md\`.
`,
  })

  return files
}
