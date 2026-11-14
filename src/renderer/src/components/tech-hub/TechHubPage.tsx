import { useState } from 'react'
import { ArrowUpRight, Briefcase, Download, FileText, FlaskConical, Github, Headphones, Map, Newspaper, Sparkles, Terminal, Youtube } from 'lucide-react'
import type { DeskResult } from '../../../../shared/news'
import { TECH_NEWS_TOPICS, type TechNewsTopic } from '../../../../shared/techNews'
import Markdown from '../ai/MarkdownRenderer'
import ResumeBuilder from './ResumeBuilder'
import { useTechHubStream } from './useTechHubStream'
import TechHubVideos from './TechHubVideos'
import { careerPrompt, IAM_LAB, readLabs, TRACKS } from './careerContent'
import './tech-hub.css'

const SECTIONS = [
  { id: 'roadmap', label: 'Roadmap', icon: Map, action: 'Generate roadmap' },
  { id: 'labs', label: 'Lab studio', icon: FlaskConical, action: 'Generate three labs' },
  { id: 'portfolio', label: 'Portfolio', icon: Github, action: 'Draft profile updates' },
  { id: 'resume', label: 'Résumé builder', icon: FileText, action: '' },
  { id: 'jobs', label: 'Jobs', icon: Briefcase, action: '' },
  { id: 'news', label: 'Tech news', icon: Newspaper, action: 'Explain these headlines' },
  { id: 'podcasts', label: 'Podcasts', icon: Headphones, action: '' },
  { id: 'youtube', label: 'YouTube', icon: Youtube, action: '' },
] as const
type Section = typeof SECTIONS[number]['id']
type Mode = Exclude<Section, 'jobs' | 'podcasts' | 'resume' | 'youtube'>
type Draft = { content: string; model: string; provider: string }
type Lab = { title: string; content: string; files?: { path: string; content: string }[] }

const SHOWS = [
  { title: 'Darknet Diaries', description: 'True stories about breaches, cybercrime, and security investigations.', url: 'https://darknetdiaries.com/episode/' },
  { title: 'Security Now', description: 'Weekly discussion of vulnerabilities, privacy, and security news.', url: 'https://twit.tv/shows/security-now' },
  { title: 'Changelog Interviews', description: 'Conversations about open source and software development.', url: 'https://changelog.com/podcast' },
]

function webUrl(url: string) {
  try { return ['https:', 'http:'].includes(new URL(url).protocol) } catch { return false }
}

export default function TechHubPage({ onOpen }: { onOpen: (url: string) => void }) {
  const [section, setSection] = useState<Section>('roadmap')
  const [track, setTrack] = useState(0)
  const [role, setRole] = useState(TRACKS[0].roles[0])
  const [experience, setExperience] = useState('Starting out')
  const [context, setContext] = useState('')
  const [location, setLocation] = useState('')
  const [drafts, setDrafts] = useState<Partial<Record<Mode, Draft>>>({})
  const [busy, setBusy] = useState<Mode | null>(null)
  const stream = useTechHubStream()
  const [error, setError] = useState<{ mode: Mode; message: string }>()
  const [news, setNews] = useState<DeskResult>()
  const [newsLoading, setNewsLoading] = useState(false)
  const [newsTopic, setNewsTopic] = useState<TechNewsTopic>('all')
  const [newsView, setNewsView] = useState<'live' | 'archive'>('live')
  const [newsSearch, setNewsSearch] = useState('')
  const [expandedLab, setExpandedLab] = useState('')
  const [saving, setSaving] = useState(false)
  const [downloadMessage, setDownloadMessage] = useState('')
  const [audioError, setAudioError] = useState(false)
  const targetRole = role.trim()
  const activeSection = SECTIONS.find(item => item.id === section)!
  const mode = section === 'jobs' || section === 'podcasts' || section === 'resume' || section === 'youtube' ? undefined : section
  const draft = mode ? drafts[mode] : undefined
  const open = (url: string) => { if (webUrl(url)) onOpen(url) }

  function resetDrafts() {
    setDrafts({})
    setError(undefined)
    setExpandedLab('')
    setDownloadMessage('')
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

  async function generate(mode: Mode) {
    if (!targetRole || busy) return
    setBusy(mode)
    setError(undefined)
    const headlines = visibleStories.slice(0, 8).map((story, i) => `${i + 1}. ${story.title} (${story.source})`).join('\n')
    try {
      const result: Draft = await window.electronAPI.techHub.generate(careerPrompt(mode, targetRole, experience, context, headlines), stream.start(), mode)
      if (result.provider === 'none' || !result.content?.trim()) {
        throw new Error('No AI response. Check your Ollama model and OpenRouter fallback in Settings.')
      }
      setDrafts(current => ({ ...current, [mode]: result }))
    } catch (failure) {
      setError({ mode, message: failure instanceof Error ? failure.message : 'Could not generate a response.' })
    } finally {
      stream.finish()
      setBusy(null)
    }
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
      if (!result.canceled) setDownloadMessage(result.success ? 'Lab ZIP saved.' : result.error || 'Could not save the ZIP.')
    } catch {
      setDownloadMessage('Could not save the ZIP.')
    } finally {
      setSaving(false)
    }
  }

  const generatedLabs = drafts.labs ? readLabs(drafts.labs.content) : []
  const labs: Lab[] = [...(targetRole === 'IAM Analyst' ? [IAM_LAB] : []), ...generatedLabs]
  const jobQuery = new URLSearchParams({ keywords: targetRole, ...(location.trim() && { location: location.trim() }) })
  const indeedQuery = new URLSearchParams({ q: targetRole, ...(location.trim() && { l: location.trim() }) })

  return (
    <main className="tech-hub">
      <div className="tech-hub-shell">
        <header className="tech-hub-hero">
          <div>
            <h1><Terminal aria-hidden="true" /> Tech Hub</h1>
            <p>Choose an IT role, practice on realistic lab scenarios, and publish what you build.</p>
            <button className="tech-primary" onClick={() => setSection('labs')}><FlaskConical size={17} /> Open lab studio <ArrowUpRight size={15} /></button>
          </div>
          <div className="tech-workflow" aria-label="Career workflow">
            <button onClick={() => setSection('roadmap')}><Map size={18} /> Plan your roadmap <span aria-hidden="true">→</span></button>
            <button onClick={() => setSection('labs')}><FlaskConical size={18} /> Build a practice lab <span aria-hidden="true">→</span></button>
            <button onClick={() => setSection('portfolio')}><Github size={18} /> Document your work <span aria-hidden="true">→</span></button>
          </div>
        </header>
        <nav className="tech-hub-nav" aria-label="Tech Hub sections">
          {SECTIONS.map(({ id, label, icon: Icon }) => <button key={id} aria-pressed={section === id} onClick={() => {
            setSection(id)
            if (id === 'news' && !news && !newsLoading) void loadNews()
          }}><Icon size={17} /> {label}</button>)}
        </nav>
        <div className="tech-hub-workspace">
          <aside className="tech-hub-panel">
            <h2>Career focus</h2>
            <label>Field<select disabled={!!busy} value={track} onChange={event => {
              const index = Number(event.target.value)
              setTrack(index)
              setRole(TRACKS[index].roles[0])
              resetDrafts()
            }}>{TRACKS.map((item, index) => <option key={item.name} value={index}>{item.name}</option>)}</select></label>
            <label>Role<select disabled={!!busy} value={TRACKS[track].roles.includes(role) ? role : ''} onChange={event => { setRole(event.target.value); resetDrafts() }}>
              {TRACKS[track].roles.map(item => <option key={item}>{item}</option>)}<option value="">Other IT role</option>
            </select></label>
            {!TRACKS[track].roles.includes(role) && <label>Custom role<input disabled={!!busy} value={role} maxLength={100} onChange={event => { setRole(event.target.value); resetDrafts() }} placeholder="e.g. Digital Forensics Analyst" /></label>}
            <label>Experience<select disabled={!!busy} value={experience} onChange={event => { setExperience(event.target.value); resetDrafts() }}>
              <option>Starting out</option><option>Changing careers</option><option>Working in IT</option><option>Experienced in this role</option>
            </select></label>
            <label>Background and completed projects <span>(optional)</span><textarea disabled={!!busy} value={context} maxLength={1400} rows={4}
              onChange={event => { setContext(event.target.value); resetDrafts() }} placeholder="Skills, tools, projects and available practice time" /></label>
          </aside>
          <section className="tech-hub-panel tech-hub-content" aria-labelledby="tech-section-title">
            <header className="tech-section-heading"><h2 id="tech-section-title">{activeSection.label}</h2>
              {mode && <button className="tech-primary" disabled={!!busy || !targetRole || (section === 'news' && (newsLoading || !visibleStories.length))}
                onClick={() => void generate(mode)}><Sparkles size={16} /> {busy === section ? 'Generating…' : activeSection.action}</button>}
            </header>
            {section === 'roadmap' && <>
              <p>Get a role-specific learning plan, practice milestones, interview preparation, and search terms for relevant openings.</p>
              <div className="tech-role-grid" role="group" aria-label={`${TRACKS[track].name} roles`}>
                {TRACKS[track].roles.map(item => <button key={item} aria-pressed={role === item} disabled={!!busy} onClick={() => {
                  if (role === item) return
                  setRole(item)
                  resetDrafts()
                }}><Terminal size={15} aria-hidden="true" />{item}<ArrowUpRight size={14} aria-hidden="true" /></button>)}
              </div>
            </>}
            {section === 'labs' && <>
              <p>Practice with fictional workplace tickets, synthetic inputs, and clear checks for whether your solution worked.</p>
              {labs.map((lab, index) => {
                const key = `${index}-${lab.title}`
                return <article className="tech-lab" key={key}>
                  <div className="tech-section-heading"><button className="tech-text-button" aria-expanded={expandedLab === key} onClick={() => setExpandedLab(expandedLab === key ? '' : key)}>
                    <FlaskConical size={17} /> {lab.title}
                  </button><button disabled={saving} onClick={() => void saveLab(lab)}><Download size={16} /> Download ZIP</button></div>
                  {expandedLab === key && <Markdown content={lab.content} onNavigate={open} />}
                </article>
              })}
              {!!draft && !generatedLabs.length && <><p>The model didn’t separate its response into individual labs. You can still save the full guide.</p>
                <button disabled={saving} onClick={() => void saveLab({ title: `${targetRole} lab guide`, content: draft.content })}><Download size={16} /> Download guide ZIP</button></>}
              <p role="status">{downloadMessage}</p>
            </>}
            {section === 'portfolio' && <p>Get suggestions for what to put in your LinkedIn headline and About section, GitHub bio, and profile README.</p>}
            <div hidden={section !== 'resume'}><ResumeBuilder role={targetRole} onOpen={open} /></div>
            {section === 'jobs' && <>
              <p>Search current listings for <strong>{targetRole || 'your chosen role'}</strong>. Use the roadmap to prepare portfolio examples for requirements you see repeatedly.</p>
              <label>Location <span>(optional)</span><input value={location} onChange={event => setLocation(event.target.value)} maxLength={100} placeholder="City, region, or Remote" /></label>
              <div className="tech-links">
                <button disabled={!targetRole} onClick={() => open(`https://www.linkedin.com/jobs/search/?${jobQuery}`)}>Search LinkedIn Jobs <ArrowUpRight size={15} /></button>
                <button disabled={!targetRole} onClick={() => open(`https://www.indeed.com/jobs?${indeedQuery}`)}>Search Indeed <ArrowUpRight size={15} /></button>
              </div>
            </>}
            {section === 'news' && <>
              <div className="tech-news-controls">
                <input aria-label="Search tech news" placeholder="Search headlines or publishers" value={newsSearch} disabled={busy === 'news'} onChange={event => {
                  setNewsSearch(event.target.value)
                  setDrafts(current => ({ ...current, news: undefined }))
                }} />
                <button disabled={newsLoading || busy === 'news'} onClick={() => void loadNews(true)}>Refresh</button>
              </div>
              <div className="tech-links" role="group" aria-label="News topics">
                {TECH_NEWS_TOPICS.map(topic => <button key={topic.id} aria-pressed={topic.id === newsTopic} disabled={newsLoading || busy === 'news'}
                  onClick={() => { if (topic.id !== newsTopic) { setNewsTopic(topic.id); void loadNews(false, topic.id) } }}>{topic.label}</button>)}
              </div>
              <div className="tech-news-view" role="group" aria-label="Article age">
                {(['live', 'archive'] as const).map(view => <button key={view} aria-pressed={newsView === view} disabled={busy === 'news'}
                  onClick={() => { setNewsView(view); setDrafts(current => ({ ...current, news: undefined })) }}>{view === 'live' ? 'Live feed' : 'Archive'}</button>)}
                {news?.fetchedAt ? <small>{news.stale ? 'Cached · ' : 'Updated '}{new Date(news.fetchedAt).toLocaleString()}</small> : null}
              </div>
              {newsLoading ? <p role="status">Loading headlines…</p> : !visibleStories.length
                ? <p role="status">{news?.stories.length ? 'No articles match this view.' : 'No headlines are available. Try refreshing.'}</p>
                : <div className="tech-news-grid">{visibleStories.map(story => <article key={story.id}>
                  <small>{story.source}{story.publishedAt ? ` · ${new Date(story.publishedAt).toLocaleDateString()}` : ''}</small>
                  <h3>{story.title}</h3>
                  {story.summary && <p>{story.summary}</p>}
                  <button onClick={() => open(story.url)}>Read article <ArrowUpRight size={15} /></button>
                </article>)}</div>}
            </>}
            {section === 'youtube' && <TechHubVideos key={`${track}:${targetRole}`} field={TRACKS[track].name} role={targetRole} onOpen={open} />}
            {section === 'podcasts' && <>
              <article className="tech-lab tech-podcast">
                <h3>Listen in Tech Hub</h3>
                <p>Changelog Interviews · Haml, Sass, Compass</p>
                <audio controls preload="none" aria-label="Haml, Sass, Compass podcast episode"
                  src="https://cdn.changelog.com/uploads/podcast/1/the-changelog-1.mp3" onError={() => setAudioError(true)} />
                {audioError && <p role="status">Audio unavailable here. You can listen on the episode page.</p>}
                <button onClick={() => open('https://changelog.com/podcast/1')}>Episode page <ArrowUpRight size={15} /></button>
              </article>
              <article className="tech-lab tech-podcast">
                <h3>TWiT Live</h3>
                <p>Watch tech shows live during scheduled recordings.</p>
                <div className="tech-links">
                  <button onClick={() => open('https://twit.tv/live')}>Open live streams <ArrowUpRight size={15} /></button>
                  <button onClick={() => open('https://twit.tv/schedule')}>View schedule <ArrowUpRight size={15} /></button>
                </div>
              </article>
              <ul className="tech-headlines">{SHOWS.map(show => <li key={show.title}>
                <button className="tech-text-button" onClick={() => open(show.url)}>{show.title} <ArrowUpRight size={15} /></button>
                <small>{show.description}</small>
              </li>)}</ul>
            </>}
            {error?.mode === section && <p role="alert" className="tech-error">{error.message}</p>}
            {busy === section && stream.partial && <article className="tech-ai-result">
              <Markdown content={stream.partial} onNavigate={open} streaming />
            </article>}
            {draft && busy !== section && <article className="tech-ai-result">
              <small>{draft.provider === 'openrouter' ? 'OpenRouter' : 'Ollama'}{draft.model ? ` · ${draft.model}` : ''}</small>
              {(section !== 'labs' || !generatedLabs.length) && <Markdown content={draft.content} onNavigate={open} />}
            </article>}
          </section>
        </div>
      </div>
    </main>
  )
}
