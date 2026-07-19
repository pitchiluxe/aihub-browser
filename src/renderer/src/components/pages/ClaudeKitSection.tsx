import React, { useState } from 'react'
import { Loader2, CheckCircle2, Plus, Trash2, Package } from 'lucide-react'
import { generateKitFiles, slugify, KitSkill } from '../../services/claudeKitGenerator'

// ── Claude Kit Generator — Settings section body ─────────────────────────────
// Collects a short brief (project, agent, plugin, skills), generates each
// file through the configured AI provider, and saves everything as one ZIP
// named after the request. Rendered inside SettingsPage's <Section>.

const INPUT = 'w-full bg-aihub-card border border-aihub-border/40 rounded-lg px-3 py-2 text-sm text-aihub-text outline-none focus:border-aihub-accent/60 transition-colors'
const LABEL = 'block text-xs font-semibold text-aihub-text mb-1 mt-3'

export default function ClaudeKitSection() {
  const [requestName,    setRequestName]    = useState('')
  const [projectDesc,    setProjectDesc]    = useState('')
  const [agentDesc,      setAgentDesc]      = useState('')
  const [pluginName,     setPluginName]     = useState('')
  const [pluginDesc,     setPluginDesc]     = useState('')
  const [pluginCommands, setPluginCommands] = useState('')
  const [skills,         setSkills]         = useState<KitSkill[]>([{ name: '', description: '' }])

  const [busy,     setBusy]     = useState(false)
  const [progress, setProgress] = useState('')
  const [result,   setResult]   = useState<{ ok: boolean; msg: string } | null>(null)

  const setSkill = (i: number, patch: Partial<KitSkill>) =>
    setSkills(ss => ss.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const addSkill = () => setSkills(ss => (ss.length >= 8 ? ss : [...ss, { name: '', description: '' }]))
  const removeSkill = (i: number) => setSkills(ss => (ss.length <= 1 ? ss : ss.filter((_, j) => j !== i)))

  const canGenerate = !busy && requestName.trim() && projectDesc.trim()

  const generate = async () => {
    if (!canGenerate) return
    setBusy(true); setResult(null); setProgress('Preparing…')
    try {
      const chat = async (prompt: string): Promise<string> => {
        // Same provider chain as the rest of the app (Ollama local or
        // OpenRouter cloud); preferCloud for reliable long-form markdown.
        const r = await window.electronAPI.ai.chat(
          [{ role: 'user', content: prompt }], undefined, { preferCloud: true },
        )
        if (!r || r.provider === 'error' || r.provider === 'none') throw new Error('ai unavailable')
        return r.content || ''
      }

      const files = await generateKitFiles(
        {
          requestName: requestName.trim(),
          projectDesc: projectDesc.trim(),
          agentDesc:   agentDesc.trim() || projectDesc.trim(),
          pluginName:  pluginName.trim(),
          pluginDesc:  pluginDesc.trim(),
          pluginCommands, skills,
        },
        chat,
        (label, done, total) => setProgress(`Generating ${label} (${done}/${total})…`),
      )

      setProgress('Saving ZIP…')
      const zipName = `${slugify(requestName, 'claude-kit')}.zip`
      const saved = await window.electronAPI.file.saveZip({ filename: zipName, files })
      if (saved?.success) {
        setResult({ ok: true, msg: `Saved ${zipName} (${files.length} files)` })
        // Fresh slate for the next kit — only after a confirmed save, so a
        // cancelled dialog or failure never throws away the user's input.
        setRequestName(''); setProjectDesc(''); setAgentDesc('')
        setPluginName(''); setPluginDesc(''); setPluginCommands('')
        setSkills([{ name: '', description: '' }])
      } else if (saved?.canceled) {
        setResult(null)
      } else {
        setResult({ ok: false, msg: saved?.error || 'Could not save the ZIP file' })
      }
    } catch (e: any) {
      setResult({ ok: false, msg: String(e?.message || e) })
    } finally {
      setBusy(false); setProgress('')
    }
  }

  return (
    <div>
      <div className="text-xs text-aihub-muted mb-1">
        Describe what you need and get a ready-to-use Claude Code starter kit: <b>claude.md</b>, <b>agent.md</b>,
        a <b>plugin</b> (manifest + commands) and your <b>skills</b> (each as <code>.claude/skills/&lt;name&gt;/SKILL.md</code>) — zipped under the name of your request.
      </div>

      <label className={LABEL}>Request name (becomes the ZIP name) *</label>
      <input className={INPUT} value={requestName} onChange={e => setRequestName(e.target.value)}
        placeholder="e.g. rental-pricing-ai-starter-kit" />

      <label className={LABEL}>Project description (for claude.md) *</label>
      <textarea className={INPUT} rows={3} value={projectDesc} onChange={e => setProjectDesc(e.target.value)}
        placeholder="What is the project? Stack, purpose, key conventions…" />

      <label className={LABEL}>Agent role (for agent.md)</label>
      <textarea className={INPUT} rows={2} value={agentDesc} onChange={e => setAgentDesc(e.target.value)}
        placeholder="What should the agent specialize in? Defaults to the project description." />

      <label className={LABEL}>Plugin</label>
      <div className="flex gap-2">
        <input className={INPUT} value={pluginName} onChange={e => setPluginName(e.target.value)} placeholder="Plugin name" />
        <input className={INPUT} value={pluginDesc} onChange={e => setPluginDesc(e.target.value)} placeholder="What the plugin does" />
      </div>
      <input className={`${INPUT} mt-2`} value={pluginCommands} onChange={e => setPluginCommands(e.target.value)}
        placeholder="Command names, comma-separated (e.g. deploy, review, sync)" />

      <label className={LABEL}>Skills</label>
      {skills.map((s, i) => (
        <div key={i} className="flex gap-2 mb-2">
          <input className={INPUT} style={{ maxWidth: 180 }} value={s.name}
            onChange={e => setSkill(i, { name: e.target.value })} placeholder="Skill name" />
          <input className={INPUT} value={s.description}
            onChange={e => setSkill(i, { description: e.target.value })} placeholder="When/what should this skill do?" />
          <button onClick={() => removeSkill(i)} disabled={skills.length <= 1}
            className="shrink-0 w-8 rounded-lg text-aihub-muted hover:text-red-400 disabled:opacity-30 transition-colors"
            title="Remove skill">
            <Trash2 size={13} className="mx-auto" />
          </button>
        </div>
      ))}
      <button onClick={addSkill} disabled={skills.length >= 8}
        className="flex items-center gap-1 text-xs text-aihub-accent hover:opacity-80 disabled:opacity-30 transition-opacity">
        <Plus size={12} /> Add another skill
      </button>

      <div className="flex items-center gap-3 mt-4">
        <button onClick={generate} disabled={!canGenerate}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-aihub-accent text-white text-sm font-medium disabled:opacity-40 transition-all">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Package size={13} />}
          {busy ? 'Generating…' : 'Generate Kit (.zip)'}
        </button>
        {busy && progress && <span className="text-xs text-aihub-muted">{progress}</span>}
        {result && (
          <span className={`flex items-center gap-1 text-xs ${result.ok ? 'text-green-400' : 'text-red-400'}`}>
            {result.ok && <CheckCircle2 size={12} />} {result.msg}
          </span>
        )}
      </div>
    </div>
  )
}
