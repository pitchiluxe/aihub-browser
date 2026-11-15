import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, Award, Check, ChevronRight, Download, ExternalLink, FlaskConical, Plus, RefreshCw, Search, Sparkles, Terminal } from 'lucide-react'
import type { DeskResult } from '../../../../shared/news'
import { TECH_NEWS_TOPICS, type TechNewsTopic } from '../../../../shared/techNews'
import Markdown from '../ai/MarkdownRenderer'
import AiTutor, { type QuizRecord } from './AiTutor'
import { CERTS, CORE_SKILLS, RESOURCES, TUTOR_TOPICS, type ResourceKind } from './catalog'
import { careerPrompt, IAM_LAB, readLabs, TRACKS, type CareerMode } from './careerContent'
import DevToolbox, { type ToolId } from './DevToolbox'
import Finder, { type FinderAction } from './Finder'
import InterviewCoach, { type InterviewRecord } from './InterviewCoach'
import ResumeBuilder from './ResumeBuilder'
import { isSectionId, SECTION_GROUPS, SECTIONS, sectionById, type SectionId } from './sections'
import TechHubVideos from './TechHubVideos'
import { isStringArray, isStringRecord, providerLabel, useAiRequest, usePersistentState, type AiDraft } from './useTechHubState'
import './tech-hub.css'

type Lab = { title: string; content: string; files?: { path: string; content: string }[] }
type Profile = { track: number; role: string; experience: string; context: string }

const EXPERIENCE = ['Starting out', 'Changing careers', 'Working in IT', 'Experienced in this role']
const DEFAULT_PROFILE: Profile = { track: 0, role: TRACKS[0].roles[0], experience: EXPERIENCE[0], context: '' }
const isProfile = (value: unknown): value is Profile => {
  const v = value as Profile
  return !!v && typeof v === 'object' && Number.isInteger(v.track) && v.track >= 0 && v.track < TRACKS.length
    && typeof v.role === 'string' && v.role.length <= 100 && EXPERIENCE.includes(v.experience) && typeof v.context === 'string' && v.context.length <= 1400
}
const isQuizLog = (value: unknown): value is QuizRecord[] => Array.isArray(value) && value.every(item =>
  item && typeof item.topic === 'string' && Number.isFinite(item.score) && Number.isFinite(item.total) && Number.isFinite(item.at))
const isInterviewLog = (value: unknown): value is InterviewRecord[] => Array.isArray(value) && value.every(item =>
  item && typeof item.kind === 'string' && typeof item.question === 'string' && Number.isFinite(item.score) && Number.isFinite(item.at))

const SHOWS = [
  { title: 'Darknet Diaries', description: 'True stories about breaches, cybercrime, and security investigations.', url: 'https://darknetdiaries.com/episode/' },
  { title: 'Security Now', description: 'Weekly discussion of vulnerabilities, privacy, and security news.', url: 'https://twit.tv/shows/security-now' },
  { title: 'Changelog Interviews', description: 'Conversations about open source and software development.', url: 'https://changelog.com/podcast' },
]

const AI_SECTIONS: Partial<Record<SectionId, { mode: CareerMode; action: string }>> = {
  roadmap: { mode: 'roadmap', action: 'Generate roadmap' },
  labs: { mode: 'labs', action: 'Generate three labs' },
  portfolio: { mode: 'portfolio', action: 'Draft profile updates' },
  news: { mode: 'news', action: 'Brief me on these' },
  skills: { mode: 'skills', action: 'Plan my gaps' },
  certs: { mode: 'certs', action: 'Build study plan' },
}

function webUrl(url: string) {
  try { return ['https:', 'http:'].includes(new URL(url).protocol) } catch { return false }
}

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

export default function TechHubPage({ onOpen }: { onOpen: (url: string) => void }) {
  const [section, setSectionState] = usePersistentState<SectionId>('section', 'overview', isSectionId)
  const [profile, setProfile] = usePersistentState<Profile>('profile', DEFAULT_PROFILE, isProfile)
  const [skillsDone, setSkillsDone] = usePersistentState<Record<string, string[]>>('skills', {}, isStringRecord)
  const [certPlan, setCertPlan] = usePersistentState<string[]>('certPlan', [], isStringArray)
  const [quizLog, setQuizLog] = usePersistentState<QuizRecord[]>('quizzes', [], isQuizLog)
  const [interviewLog, setInterviewLog] = usePersistentState<InterviewRecord[]>('interviews', [], isInterviewLog)
  const [labsSaved, setLabsSaved] = usePersistentState<string[]>('labsSaved', [], isStringArray)
  const [tool, setTool] = useState<ToolId>('json')
  const [tutorTopic, setTutorTopic] = useState('')
  const [finderOpen, setFinderOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [location, setLocation] = useState('')
  const [drafts, setDrafts] = useState<Partial<Record<CareerMode, AiDraft>>>({})
  const [aiMode, setAiMode] = useState<CareerMode>()
  const ai = useAiRequest()
  const [news, setNews] = useState<DeskResult>()
  const [newsLoading, setNewsLoading] = useState(false)
  const [newsTopic, setNewsTopic] = useState<TechNewsTopic>('all')
  const [newsView, setNewsView] = useState<'live' | 'archive'>('live')
  const [newsSearch, setNewsSearch] = useState('')
  const [expandedLab, setExpandedLab] = useState('')
  const [saving, setSaving] = useState(false)
  const [downloadMessage, setDownloadMessage] = useState('')
  const [audioError, setAudioError] = useState(false)
  const [libraryKind, setLibraryKind] = useState<ResourceKind | 'All'>('All')
  const [libraryScope, setLibraryScope] = useState<'track' | 'all'>('track')
  const [librarySearch, setLibrarySearch] = useState('')
  const now = useClock()

  const track = TRACKS[profile.track]
  const targetRole = profile.role.trim()
  const active = sectionById(section)
  const aiSection = AI_SECTIONS[section]
  const draft = aiSection ? drafts[aiSection.mode] : undefined
  const busy = ai.busy
  const open = (url: string) => { if (webUrl(url)) onOpen(url) }

  const coreSkills = CORE_SKILLS[track.name]
  const known = (skillsDone[track.name] || []).filter(skill => coreSkills.includes(skill))
  const skillPct = Math.round((known.length / coreSkills.length) * 100)
  const trackCerts = CERTS.filter(cert => cert.tracks.includes(track.name))
  const plannedCerts = CERTS.filter(cert => certPlan.includes(cert.id))
  const bestQuiz = quizLog.reduce<QuizRecord | undefined>((best, item) => !best || item.score / item.total > best.score / best.total ? item : best, undefined)
  const interviewAvg = interviewLog.length ? interviewLog.reduce((sum, item) => sum + item.score, 0) / interviewLog.length : undefined

  function setSection(id: SectionId) {
    setSectionState(id)
    if (id === 'news' && !news && !newsLoading) void loadNews()
    document.querySelector('.tech-hub')?.scrollTo({ top: 0 })
  }

  function updateProfile(patch: Partial<Profile>) {
    setProfile(current => ({ ...current, ...patch }))
    setDrafts({})
    setExpandedLab('')
    setDownloadMessage('')
    ai.clearError()
  }

  useEffect(() => {
    if (section === 'news' && !news && !newsLoading) void loadNews()
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      event.preventDefault()
      setFinderOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function pickFinder(action: FinderAction) {
    setFinderOpen(false)
    if (action.kind === 'section') setSection(action.id)
    else if (action.kind === 'tool') { setTool(action.id); setSection('toolbox') }
    else if (action.kind === 'role') { updateProfile({ track: action.track, role: action.role }); setSection('roadmap') }
    else { setTutorTopic(action.topic); setSection('tutor') }
  }

  async function loadNews(refresh = false, topic = newsTopic) {
    setNewsLoading(true)
    try {
      setNews(await window.electronAPI.news.techHub(topic, refresh))
      setDrafts(current => ({ ...current, news: undefined }))
    } catch {
      setNews({ ok: false, stories: [], fetchedAt: 0, sources: [] })
    } finally {
      setNewsLoading(false)
    }
  }

  const visibleStories = (news?.stories || []).filter(story => {
    const recent = story.publishedAt >= Date.now() - 7 * 24 * 60 * 60 * 1000
    const search = newsSearch.trim().toLowerCase()
    return recent === (newsView === 'live') && `${story.title} ${story.summary} ${story.source}`.toLowerCase().includes(search)
  }).sort((a, b) => b.publishedAt - a.publishedAt)

  async function generate(mode: CareerMode) {
    if (!targetRole || busy) return
    setAiMode(mode)
    const extra = mode === 'news'
      ? visibleStories.slice(0, 8).map((story, i) => `${i + 1}. ${story.title} (${story.source})`).join('\n')
      : mode === 'skills'
        ? `Skills the user already has: ${known.join('; ') || 'none checked yet'}\nSkills still missing: ${coreSkills.filter(skill => !known.includes(skill)).join('; ')}`
        : mode === 'certs'
          ? `Selected certifications: ${(plannedCerts.length ? plannedCerts : trackCerts.filter(cert => cert.level === 'Entry')).map(cert => `${cert.name} (${cert.vendor}, ${cert.level})`).join('; ')}`
          : ''
    const result = await ai.run(careerPrompt(mode, targetRole, profile.experience, profile.context, extra), mode)
    if (result) setDrafts(current => ({ ...current, [mode]: result }))
  }

  async function saveLab(lab: Lab) {
    setSaving(true)
    setDownloadMessage('')
    try {
      const slug = lab.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 70).replace(/^-|-$/g, '') || 'tech-hub-lab'
      const result = await window.electronAPI.file.saveZip({
        filename: `${slug}.zip`,
        files: [{ path: 'README.md', content: lab.content }, ...(lab.files || [])],
      })
      if (!result.canceled) {
        setDownloadMessage(result.success ? 'Lab ZIP saved.' : result.error || 'Could not save the ZIP.')
        if (result.success) setLabsSaved(current => [...new Set([...current, lab.title])].slice(-50))
      }
    } catch {
      setDownloadMessage('Could not save the ZIP.')
    } finally {
      setSaving(false)
    }
  }

  async function saveDraft(mode: CareerMode, content: string) {
    try { await window.electronAPI.file.saveMd({ title: `${targetRole} ${mode}`, content }) } catch { /* the dialog reports its own failures */ }
  }

  function toggleSkill(skill: string) {
    setSkillsDone(current => {
      const list = current[track.name] || []
      return { ...current, [track.name]: list.includes(skill) ? list.filter(item => item !== skill) : [...list, skill] }
    })
    setDrafts(current => ({ ...current, skills: undefined }))
  }

  const generatedLabs = drafts.labs ? readLabs(drafts.labs.content) : []
  const labs: Lab[] = [...(targetRole === 'IAM Analyst' ? [IAM_LAB] : []), ...generatedLabs]
  const where = location.trim()
  const jobBoards = [
    { name: 'LinkedIn Jobs', note: 'Largest network; filter by Easy Apply and date posted.', url: `https://www.linkedin.com/jobs/search/?${new URLSearchParams({ keywords: targetRole, ...(where && { location: where }) })}` },
    { name: 'Indeed', note: 'Broadest listing volume across company sizes.', url: `https://www.indeed.com/jobs?${new URLSearchParams({ q: targetRole, ...(where && { l: where }) })}` },
    { name: 'Dice', note: 'Tech-only board, strong for contract and cleared roles.', url: `https://www.dice.com/jobs?${new URLSearchParams({ q: targetRole, ...(where && { location: where }) })}` },
    { name: 'Google Jobs', note: 'Aggregates listings from many boards at once.', url: `https://www.google.com/search?${new URLSearchParams({ q: `${targetRole} jobs${where ? ` ${where}` : ''}`, ibp: 'htl;jobs' })}` },
    { name: 'We Work Remotely', note: 'Remote-first roles worldwide.', url: `https://weworkremotely.com/remote-jobs/search?${new URLSearchParams({ term: targetRole })}` },
    { name: 'USAJOBS', note: 'US federal government IT and cyber roles.', url: `https://www.usajobs.gov/Search/Results?${new URLSearchParams({ k: targetRole, ...(where && { l: where }) })}` },
  ]
  const libraryItems = RESOURCES.filter(item => (libraryScope === 'all' || item.tracks === 'all' || item.tracks.includes(track.name))
    && (libraryKind === 'All' || item.kind === libraryKind)
    && `${item.name} ${item.description}`.toLowerCase().includes(librarySearch.trim().toLowerCase()))

  const nextSteps = useMemo(() => {
    const steps: { label: string; detail: string; id: SectionId }[] = []
    if (known.length < 3) steps.push({ label: 'Map what you already know', detail: `Check off skills for ${targetRole || track.name}.`, id: 'skills' })
    if (!drafts.roadmap) steps.push({ label: 'Generate your roadmap', detail: 'A dated plan built around your experience.', id: 'roadmap' })
    if (!labsSaved.length) steps.push({ label: 'Download your first lab', detail: 'Portfolio evidence beats certificates alone.', id: 'labs' })
    if (!quizLog.length) steps.push({ label: 'Take a 5-question quiz', detail: 'Find weak spots in under three minutes.', id: 'tutor' })
    if (!interviewLog.length) steps.push({ label: 'Answer one mock interview question', detail: 'Scored feedback with a model answer.', id: 'interview' })
    if (!certPlan.length) steps.push({ label: 'Pick a certification path', detail: 'Only the ones that matter for this role.', id: 'certs' })
    steps.push({ label: 'Search live openings', detail: 'Six boards, your role prefilled.', id: 'jobs' })
    return steps.slice(0, 3)
  }, [known.length, drafts.roadmap, labsSaved.length, quizLog.length, interviewLog.length, certPlan.length, targetRole, track.name])

  return (
    <main className="tech-hub">
      <div className="th-frame">
        <header className="th-titlebar">
          <span className="th-dots" aria-hidden="true"><i /><i /><i /></span>
          <span className="th-path"><Terminal size={14} aria-hidden="true" /> ~/tech-hub/<strong>{active.file}</strong></span>
          <button className="th-finder-trigger" onClick={() => setFinderOpen(true)} aria-label="Find anything (press slash)">
            <Search size={14} /> <span>Find a tool, role or topic</span> <kbd>/</kbd>
          </button>
        </header>

        <div className="th-body">
          <nav className="th-rail" aria-label="Tech Hub sections">
            {SECTION_GROUPS.map(group => <div key={group} className="th-rail-group">
              <p>{group}</p>
              {SECTIONS.filter(item => item.group === group).map(({ id, label, icon: Icon }) => <button key={id} aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}>
                <Icon size={16} aria-hidden="true" /><span>{label}</span>
              </button>)}
            </div>)}
          </nav>

          <div className="th-main">
            <section className={`th-profile${profileOpen ? ' is-open' : ''}`} aria-label="Career focus">
              <button className="th-profile-summary" aria-expanded={profileOpen} onClick={() => setProfileOpen(value => !value)}>
                <span className="th-prompt-glyph">❯</span>
                <span className="th-kv-inline"><em>field</em>{track.name}</span>
                <span className="th-kv-inline"><em>role</em>{targetRole || 'not set'}</span>
                <span className="th-kv-inline"><em>level</em>{profile.experience}</span>
                <span className="th-profile-edit">{profileOpen ? 'done' : 'edit'} <ChevronRight size={14} /></span>
              </button>
              {profileOpen && <div className="th-profile-form">
                <label>Field<select disabled={busy} value={profile.track} onChange={event => {
                  const index = Number(event.target.value)
                  updateProfile({ track: index, role: TRACKS[index].roles[0] })
                }}>{TRACKS.map((item, index) => <option key={item.name} value={index}>{item.name}</option>)}</select></label>
                <label>Role<select disabled={busy} value={track.roles.includes(profile.role) ? profile.role : ''} onChange={event => updateProfile({ role: event.target.value })}>
                  {track.roles.map(item => <option key={item}>{item}</option>)}<option value="">Other IT role…</option>
                </select></label>
                {!track.roles.includes(profile.role) && <label>Custom role<input disabled={busy} value={profile.role} maxLength={100}
                  onChange={event => updateProfile({ role: event.target.value })} placeholder="e.g. Digital Forensics Analyst" /></label>}
                <label>Experience<select disabled={busy} value={profile.experience} onChange={event => updateProfile({ experience: event.target.value })}>
                  {EXPERIENCE.map(item => <option key={item}>{item}</option>)}
                </select></label>
                <label className="th-wide">Background and projects <span>optional · used to personalise AI output</span><textarea disabled={busy} value={profile.context} maxLength={1400} rows={3}
                  onChange={event => updateProfile({ context: event.target.value })} placeholder="Skills, tools, projects and weekly practice time" /></label>
              </div>}
            </section>

            {section === 'overview' ? <>
              <section className="th-hero">
                <div className="th-hero-copy">
                  <p className="th-hero-cmd"><span>$</span> techhub --role {JSON.stringify(targetRole || 'any')} --level {JSON.stringify(profile.experience.toLowerCase())}<i className="th-caret" /></p>
                  <h1>Everything you need to <em>break into</em> tech — and keep leveling up.</h1>
                  <p>Plans, labs, an AI tutor, mock interviews, a dev toolbox and live job search. Local-first: your data stays on this device.</p>
                  <div className="th-actions">
                    <button className="th-btn th-btn-primary" onClick={() => setFinderOpen(true)}><Search size={15} /> What do you need?</button>
                    <button className="th-btn" onClick={() => setSection('labs')}><FlaskConical size={15} /> Open lab studio</button>
                  </div>
                </div>
                <dl className="th-stats" aria-label="Your progress">
                  <div><dt>skills</dt><dd>{known.length}<small>/{coreSkills.length}</small></dd><span className="th-bar"><i style={{ width: `${skillPct}%` }} /></span></div>
                  <div><dt>best quiz</dt><dd>{bestQuiz ? <>{bestQuiz.score}<small>/{bestQuiz.total}</small></> : '—'}</dd><small>{bestQuiz ? bestQuiz.topic : 'no quizzes yet'}</small></div>
                  <div><dt>interview avg</dt><dd>{interviewAvg !== undefined ? <>{interviewAvg.toFixed(1)}<small>/10</small></> : '—'}</dd><small>{interviewLog.length} graded</small></div>
                  <div><dt>labs saved</dt><dd>{labsSaved.length}</dd><small>{certPlan.length} cert{certPlan.length === 1 ? '' : 's'} planned</small></div>
                </dl>
              </section>

              <section className="th-next" aria-labelledby="th-next-title">
                <h2 id="th-next-title"><span>//</span> next best steps</h2>
                <ol>{nextSteps.map((step, index) => <li key={step.label}><button onClick={() => setSection(step.id)}>
                  <span className="th-step-n">0{index + 1}</span><span><strong>{step.label}</strong><small>{step.detail}</small></span><ArrowUpRight size={15} aria-hidden="true" />
                </button></li>)}</ol>
              </section>

              {SECTION_GROUPS.filter(group => group !== 'Start').map(group => <section key={group} className="th-launch" aria-label={group}>
                <h2><span>//</span> {group.toLowerCase()}</h2>
                <div className="th-launch-grid">
                  {SECTIONS.filter(item => item.group === group).map(({ id, label, blurb, icon: Icon, file }) => <button key={id} className="th-card" onClick={() => setSection(id)}>
                    <span className="th-card-head"><Icon size={18} aria-hidden="true" /><code>{file}</code></span>
                    <strong>{label}</strong><small>{blurb}</small>
                  </button>)}
                </div>
              </section>)}
            </> : <section className="th-pane" aria-labelledby="th-pane-title">
              <header className="th-pane-head">
                <div className="th-tabstrip" aria-hidden="true"><span>{active.file}</span></div>
                <div className="th-pane-title">
                  <div><h1 id="th-pane-title">{active.label}</h1><p>{active.blurb}</p></div>
                  {aiSection && <button className="th-btn th-btn-primary" disabled={busy || !targetRole || (section === 'news' && (newsLoading || !visibleStories.length))}
                    onClick={() => void generate(aiSection.mode)}><Sparkles size={15} /> {busy && aiMode === aiSection.mode ? 'Generating…' : aiSection.action}</button>}
                </div>
              </header>

              <div className="th-pane-body">
                {section === 'roadmap' && <>
                  <p className="th-lede">A role-specific learning plan with practice milestones, interview prep and job-search terms. Pick a role to compare:</p>
                  <div className="th-role-grid" role="group" aria-label={`${track.name} roles`}>
                    {track.roles.map(item => <button key={item} aria-pressed={profile.role === item} disabled={busy} onClick={() => { if (profile.role !== item) updateProfile({ role: item }) }}>
                      <Terminal size={14} aria-hidden="true" />{item}
                    </button>)}
                  </div>
                </>}

                {section === 'skills' && <>
                  <div className="th-progress-head">
                    <div className="th-ring" style={{ ['--p' as string]: skillPct }} aria-label={`${skillPct}% of core skills`}><span>{skillPct}%</span></div>
                    <p className="th-lede">Core skills employers expect for <strong>{track.name}</strong> roles. Check what you can already demonstrate; use “Plan my gaps” for a four-week plan, or quiz yourself on any skill.</p>
                  </div>
                  <ul className="th-checklist">{coreSkills.map(skill => {
                    const done = known.includes(skill)
                    return <li key={skill} data-done={done || undefined}>
                      <button className="th-check-toggle" role="checkbox" aria-checked={done} onClick={() => toggleSkill(skill)}>
                        <span className="th-box">{done && <Check size={13} />}</span>{skill}
                      </button>
                      <button className="th-btn th-btn-ghost" onClick={() => { setTutorTopic(skill); setSection('tutor') }}>Quiz me</button>
                    </li>
                  })}</ul>
                </>}

                {section === 'tutor' && <AiTutor role={targetRole} suggestions={TUTOR_TOPICS[track.name]} topic={tutorTopic} onTopic={setTutorTopic} onOpen={open}
                  onQuizDone={record => setQuizLog(current => [...current, record].slice(-50))} />}

                {section === 'library' && <>
                  <div className="th-filter-bar">
                    <label className="th-search"><Search size={15} aria-hidden="true" /><input value={librarySearch} onChange={event => setLibrarySearch(event.target.value)} placeholder="Filter resources" aria-label="Filter resources" /></label>
                    <div className="th-chip-row" role="group" aria-label="Resource type">
                      {(['All', 'Course', 'Practice', 'Docs', 'Reference'] as const).map(kind => <button key={kind} className="th-chip" aria-pressed={libraryKind === kind} onClick={() => setLibraryKind(kind)}>{kind}</button>)}
                    </div>
                    <div className="th-chip-row" role="group" aria-label="Scope">
                      <button className="th-chip th-chip-soft" aria-pressed={libraryScope === 'track'} onClick={() => setLibraryScope('track')}>{track.name}</button>
                      <button className="th-chip th-chip-soft" aria-pressed={libraryScope === 'all'} onClick={() => setLibraryScope('all')}>All fields</button>
                    </div>
                  </div>
                  <div className="th-resource-grid">{libraryItems.map(item => <button key={item.url} className="th-card" onClick={() => open(item.url)}>
                    <span className="th-card-head"><span className="th-tag" data-kind={item.kind}>{item.kind}</span><ExternalLink size={14} aria-hidden="true" /></span>
                    <strong>{item.name}</strong><small>{item.description}</small>
                    <code className="th-host">{new URL(item.url).hostname.replace(/^www\./, '')}</code>
                  </button>)}</div>
                  {!libraryItems.length && <p className="th-note">No resources match. Try “All fields”.</p>}
                </>}

                {section === 'certs' && <>
                  <p className="th-lede">Certifications open doors for some roles and are optional for others — portfolio evidence matters most. Add the ones you’re considering to your plan, then build a study plan. Always confirm exam versions and pricing on the official page.</p>
                  {(['Entry', 'Associate', 'Advanced'] as const).map(level => {
                    const items = trackCerts.filter(cert => cert.level === level)
                    return items.length ? <div key={level} className="th-cert-tier">
                      <h3><span data-level={level}>{level}</span></h3>
                      <div className="th-cert-grid">{items.map(cert => {
                        const planned = certPlan.includes(cert.id)
                        return <article key={cert.id} className="th-cert" data-planned={planned || undefined}>
                          <small>{cert.vendor}</small><h4>{cert.name}</h4><p>{cert.focus}</p>
                          <div className="th-actions">
                            <button className="th-btn" aria-pressed={planned} onClick={() => {
                              setCertPlan(current => planned ? current.filter(id => id !== cert.id) : [...current, cert.id])
                              setDrafts(current => ({ ...current, certs: undefined }))
                            }}>{planned ? <><Check size={14} /> In plan</> : <><Plus size={14} /> Add to plan</>}</button>
                            <button className="th-btn th-btn-ghost" onClick={() => open(cert.url)}>Official page <ArrowUpRight size={14} /></button>
                          </div>
                        </article>
                      })}</div>
                    </div> : null
                  })}
                  {!!plannedCerts.length && <p className="th-note"><Award size={14} /> Plan: {plannedCerts.map(cert => cert.name).join(' → ')}</p>}
                </>}

                {section === 'labs' && <>
                  <p className="th-lede">Fictional workplace tickets with synthetic data and clear pass/fail checks. Each lab downloads as a ZIP you can push to GitHub.</p>
                  {!labs.length && !draft && <div className="th-empty"><FlaskConical size={20} /><p>No labs yet for <strong>{targetRole || 'this role'}</strong>. Generate three to get started.</p></div>}
                  {labs.map((lab, index) => {
                    const key = `${index}-${lab.title}`
                    return <article className="th-lab" key={key}>
                      <div className="th-lab-head">
                        <button className="th-lab-title" aria-expanded={expandedLab === key} onClick={() => setExpandedLab(expandedLab === key ? '' : key)}>
                          <ChevronRight size={15} aria-hidden="true" /> <code>lab-{String(index + 1).padStart(2, '0')}</code> {lab.title}
                          {labsSaved.includes(lab.title) && <span className="th-tag" data-kind="Practice">saved</span>}
                        </button>
                        <button className="th-btn" disabled={saving} onClick={() => void saveLab(lab)}><Download size={14} /> ZIP</button>
                      </div>
                      {expandedLab === key && <div className="th-lab-body"><Markdown content={lab.content} onNavigate={open} /></div>}
                    </article>
                  })}
                  {!!draft && !generatedLabs.length && <><p className="th-note">The model didn’t split its response into separate labs. You can still save the full guide.</p>
                    <button className="th-btn" disabled={saving} onClick={() => void saveLab({ title: `${targetRole} lab guide`, content: draft.content })}><Download size={14} /> Download guide ZIP</button></>}
                  {downloadMessage && <p role="status" className="th-note">{downloadMessage}</p>}
                </>}

                {section === 'toolbox' && <DevToolbox tool={tool} onTool={setTool} />}

                {section === 'portfolio' && <p className="th-lede">Suggestions for your LinkedIn headline and About section, GitHub bio and profile README — grounded only in the background you entered above.</p>}

                <div hidden={section !== 'resume'}><ResumeBuilder role={targetRole} onOpen={open} /></div>

                {section === 'interview' && <InterviewCoach role={targetRole} experience={profile.experience} history={interviewLog} onOpen={open}
                  onRecord={record => setInterviewLog(current => [...current, record].slice(-50))} />}

                {section === 'jobs' && <>
                  <p className="th-lede">Live listings for <strong>{targetRole || 'your chosen role'}</strong>. When the same requirement shows up again and again, add it to your skill tracker.</p>
                  <label className="th-search th-search-wide"><span>location</span><input value={location} onChange={event => setLocation(event.target.value)} maxLength={100} placeholder="City, region, or Remote" aria-label="Location" /></label>
                  <div className="th-resource-grid">{jobBoards.map(board => <button key={board.name} className="th-card" disabled={!targetRole} onClick={() => open(board.url)}>
                    <span className="th-card-head"><code>{new URL(board.url).hostname.replace(/^www\./, '')}</code><ArrowUpRight size={14} aria-hidden="true" /></span>
                    <strong>{board.name}</strong><small>{board.note}</small>
                  </button>)}</div>
                  <p className="th-note">Tip: search “{targetRole || 'your role'}” plus a tool you know (e.g. “Splunk”, “Terraform”) to find roles that match your evidence.</p>
                </>}

                {section === 'news' && <>
                  <div className="th-filter-bar">
                    <label className="th-search"><Search size={15} aria-hidden="true" /><input aria-label="Search tech news" placeholder="Search headlines or publishers" value={newsSearch} disabled={busy && aiMode === 'news'} onChange={event => {
                      setNewsSearch(event.target.value)
                      setDrafts(current => ({ ...current, news: undefined }))
                    }} /></label>
                    <button className="th-btn" disabled={newsLoading || busy} onClick={() => void loadNews(true)}><RefreshCw size={14} /> Refresh</button>
                  </div>
                  <div className="th-chip-row" role="group" aria-label="News topics">
                    {TECH_NEWS_TOPICS.map(topic => <button key={topic.id} className="th-chip" aria-pressed={topic.id === newsTopic} disabled={newsLoading || busy}
                      onClick={() => { if (topic.id !== newsTopic) { setNewsTopic(topic.id); void loadNews(false, topic.id) } }}>{topic.label}</button>)}
                  </div>
                  <div className="th-chip-row" role="group" aria-label="Article age">
                    {(['live', 'archive'] as const).map(view => <button key={view} className="th-chip th-chip-soft" aria-pressed={newsView === view} disabled={busy}
                      onClick={() => { setNewsView(view); setDrafts(current => ({ ...current, news: undefined })) }}>{view === 'live' ? 'Last 7 days' : 'Archive'}</button>)}
                    {news?.fetchedAt ? <small className="th-note">{news.stale ? 'cached · ' : 'updated '}{new Date(news.fetchedAt).toLocaleString()}</small> : null}
                  </div>
                  {newsLoading ? <p role="status" className="th-note"><span className="th-pulse" /> Loading headlines…</p> : !visibleStories.length
                    ? <p role="status" className="th-note">{news?.stories.length ? 'No articles match this view.' : 'No headlines are available. Try refreshing.'}</p>
                    : <div className="th-news-grid">{visibleStories.map(story => <article key={story.id}>
                      <small>{story.source}{story.publishedAt ? ` · ${new Date(story.publishedAt).toLocaleDateString()}` : ''}</small>
                      <h3>{story.title}</h3>
                      {story.summary && <p>{story.summary}</p>}
                      <button className="th-btn th-btn-ghost" onClick={() => open(story.url)}>Read <ArrowUpRight size={14} /></button>
                    </article>)}</div>}
                </>}

                {section === 'youtube' && <TechHubVideos key={`${profile.track}:${targetRole}`} field={track.name} role={targetRole} onOpen={open} />}

                {section === 'podcasts' && <>
                  <article className="th-lab th-podcast">
                    <h3>Listen in Tech Hub</h3>
                    <p>Changelog Interviews · Haml, Sass, Compass</p>
                    <audio controls preload="none" aria-label="Haml, Sass, Compass podcast episode"
                      src="https://cdn.changelog.com/uploads/podcast/1/the-changelog-1.mp3" onError={() => setAudioError(true)} />
                    {audioError && <p role="status">Audio unavailable here. You can listen on the episode page.</p>}
                    <button className="th-btn" onClick={() => open('https://changelog.com/podcast/1')}>Episode page <ArrowUpRight size={14} /></button>
                  </article>
                  <article className="th-lab th-podcast">
                    <h3>TWiT Live</h3>
                    <p>Watch tech shows live during scheduled recordings.</p>
                    <div className="th-actions">
                      <button className="th-btn" onClick={() => open('https://twit.tv/live')}>Open live streams <ArrowUpRight size={14} /></button>
                      <button className="th-btn" onClick={() => open('https://twit.tv/schedule')}>View schedule <ArrowUpRight size={14} /></button>
                    </div>
                  </article>
                  <div className="th-resource-grid">{SHOWS.map(show => <button key={show.title} className="th-card" onClick={() => open(show.url)}>
                    <span className="th-card-head"><code>{new URL(show.url).hostname.replace(/^www\./, '')}</code><ArrowUpRight size={14} aria-hidden="true" /></span>
                    <strong>{show.title}</strong><small>{show.description}</small>
                  </button>)}</div>
                </>}

                {aiSection && ai.error && aiMode === aiSection.mode && <p role="alert" className="th-alert">{ai.error}</p>}
                {aiSection && busy && aiMode === aiSection.mode && <div className="th-output th-output-live">
                  <div className="th-output-bar"><span className="th-pulse" /> streaming · {aiSection.mode}.md</div>
                  {ai.partial ? <Markdown content={ai.partial} onNavigate={open} streaming /> : <p className="th-note">Waiting for the model…</p>}
                </div>}
                {aiSection && draft && !(busy && aiMode === aiSection.mode) && <article className="th-output">
                  <div className="th-output-bar"><span>{aiSection.mode}.md</span><small>{providerLabel(draft)}</small>
                    <button className="th-btn th-btn-ghost" onClick={() => void saveDraft(aiSection.mode, draft.content)}><Download size={14} /> Save .md</button></div>
                  {(section !== 'labs' || !generatedLabs.length) && <Markdown content={draft.content} onNavigate={open} />}
                  {section === 'labs' && !!generatedLabs.length && <p className="th-note">{generatedLabs.length} labs generated — expand them above.</p>}
                </article>}
              </div>
            </section>}
          </div>
        </div>

        <footer className="th-statusbar">
          <span className={busy ? 'is-busy' : ''}><i aria-hidden="true" /> {busy ? 'ai: generating' : 'ai: ready · local-first'}</span>
          <span>{track.name}</span>
          <span>skills {known.length}/{coreSkills.length}</span>
          <span className="th-status-push">press <kbd>/</kbd> to find anything</span>
          <span>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </footer>
      </div>
      {finderOpen && <Finder tracks={TRACKS} onPick={pickFinder} onClose={() => setFinderOpen(false)} />}
    </main>
  )
}
