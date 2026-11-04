import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  RefreshCw, Loader2, Globe2, Landmark, Briefcase, Cpu, FlaskConical, HeartPulse, Trophy,
  Sparkles, UtensilsCrossed, Clapperboard, Newspaper, MapPin, ShieldCheck, ChefHat, PlayCircle,
  X, Clock, ExternalLink, Wand2, Youtube, Flame,
} from 'lucide-react'
import { COUNTRIES, type DeskId, type DeskResult, type NewsStory, type Recipe } from '../../../../shared/news'

/**
 * AIHub World News — aihub://news.
 *
 * A newsroom, not a feed reader: a breaking ticker, the world's clocks, one
 * desk per beat and a country desk. Every story is read from several
 * independent outlets in main (src/main/news) and folded together, and the
 * page shows how many carried it — the plainest honest signal of how solid a
 * story is. The Kitchen desk adds daily recipes with their videos and dishes
 * invented by the local model.
 */

type Tab = DeskId | 'countries' | 'kitchen'

const DESKS: { id: Tab; label: string; color: string; icon: React.ComponentType<any> }[] = [
  { id: 'top',        label: 'Top Stories',    color: '#ef4444', icon: Flame },
  { id: 'politics',   label: 'Elections & Politics', color: '#6366f1', icon: Landmark },
  { id: 'countries',  label: 'Countries',      color: '#14b8a6', icon: MapPin },
  { id: 'africa',     label: 'Africa',         color: '#f59e0b', icon: Globe2 },
  { id: 'americas',   label: 'Americas',       color: '#3b82f6', icon: Globe2 },
  { id: 'europe',     label: 'Europe',         color: '#8b5cf6', icon: Globe2 },
  { id: 'asia',       label: 'Asia',           color: '#ec4899', icon: Globe2 },
  { id: 'middleeast', label: 'Middle East',    color: '#eab308', icon: Globe2 },
  { id: 'business',   label: 'Business',       color: '#22c55e', icon: Briefcase },
  { id: 'tech',       label: 'Tech',           color: '#06b6d4', icon: Cpu },
  { id: 'science',    label: 'Science',        color: '#a855f7', icon: FlaskConical },
  { id: 'health',     label: 'Health',         color: '#10b981', icon: HeartPulse },
  { id: 'sports',     label: 'Sports',         color: '#f97316', icon: Trophy },
  { id: 'lifestyle',  label: 'Lifestyle',      color: '#f472b6', icon: Sparkles },
  { id: 'kitchen',    label: 'Kitchen & Restaurants', color: '#fb923c', icon: UtensilsCrossed },
  { id: 'culture',    label: 'Culture',        color: '#c084fc', icon: Clapperboard },
]

const CLOCKS: { city: string; tz: string }[] = [
  { city: 'New York', tz: 'America/New_York' },
  { city: 'São Paulo', tz: 'America/Sao_Paulo' },
  { city: 'London', tz: 'Europe/London' },
  { city: 'Kinshasa', tz: 'Africa/Kinshasa' },
  { city: 'Lagos', tz: 'Africa/Lagos' },
  { city: 'Nairobi', tz: 'Africa/Nairobi' },
  { city: 'Dubai', tz: 'Asia/Dubai' },
  { city: 'New Delhi', tz: 'Asia/Kolkata' },
  { city: 'Beijing', tz: 'Asia/Shanghai' },
  { city: 'Tokyo', tz: 'Asia/Tokyo' },
]

const LAST_TAB_KEY = 'aihub-news-tab'
const LAST_COUNTRY_KEY = 'aihub-news-country'

function readPref(key: string, fallback: string): string {
  try { return localStorage.getItem(key) || fallback } catch { return fallback }
}
function writePref(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* private storage: just forget */ }
}

export function timeAgo(ts: number, now = Date.now()): string {
  if (!ts) return ''
  const m = Math.max(0, Math.round((now - ts) / 60_000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hr ago`
  return `${Math.round(h / 24)} d ago`
}

const api = () => (window as any).electronAPI

export default function NewsPage({ onOpen }: { onOpen: (url: string) => void }) {
  const [tab, setTab] = useState<Tab>(() => {
    const saved = readPref(LAST_TAB_KEY, 'top')
    return DESKS.some(d => d.id === saved) ? (saved as Tab) : 'top'
  })
  const [country, setCountry] = useState(() => readPref(LAST_COUNTRY_KEY, 'us'))
  const [results, setResults] = useState<Record<string, DeskResult>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [now, setNow] = useState(Date.now())

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t) }, [])

  // Editorial headline face, once per app session.
  useEffect(() => {
    if (document.getElementById('aihub-news-font')) return
    const link = document.createElement('link')
    link.id = 'aihub-news-font'
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,800&display=swap'
    document.head.appendChild(link)
  }, [])

  const keyFor = (t: Tab, c = country) => (t === 'countries' ? `country:${c}` : t === 'kitchen' ? 'desk:food' : `desk:${t}`)

  const load = useCallback(async (t: Tab, c: string, force = false) => {
    const key = keyFor(t, c)
    if (!force && results[key]) return
    setLoading(l => ({ ...l, [key]: true }))
    try {
      if (force) await api()?.news?.refresh?.()
      const res: DeskResult = t === 'countries'
        ? await api().news.country(c)
        : await api().news.desk(t === 'kitchen' ? 'food' : t)
      setResults(r => ({ ...r, [key]: res }))
    } catch (e: any) {
      setResults(r => ({ ...r, [key]: { ok: false, stories: [], fetchedAt: Date.now(), sources: [], error: e?.message || 'Could not load the news.' } }))
    } finally {
      setLoading(l => ({ ...l, [key]: false }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results])

  useEffect(() => { void load(tab, country) }, [tab, country]) // eslint-disable-line react-hooks/exhaustive-deps
  // The ticker always runs on Top Stories, whatever desk is open.
  useEffect(() => { void load('top', country) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (t: Tab) => { setTab(t); writePref(LAST_TAB_KEY, t) }
  const pickCountry = (c: string) => { setCountry(c); writePref(LAST_COUNTRY_KEY, c) }

  const desk = DESKS.find(d => d.id === tab) || DESKS[0]
  const current = results[keyFor(tab)]
  const busy = !!loading[keyFor(tab)]
  const ticker = results['desk:top']?.stories.slice(0, 14) || []

  return (
    <div className="aihub-news" style={{ '--desk': desk.color } as React.CSSProperties}>
      <style>{NEWS_CSS}</style>

      {/* ── Masthead ── */}
      <header className="nr-mast">
        <div className="nr-mast-left">
          <span className="nr-live"><span className="nr-live-dot" />LIVE</span>
          <span className="nr-date">{new Date(now).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
        </div>
        <h1 className="nr-title">The World Desk</h1>
        <div className="nr-mast-right">
          {current?.fetchedAt ? <span className="nr-updated">Updated {timeAgo(current.fetchedAt, now)}</span> : null}
          <button className="nr-icon-btn" title="Refresh this desk" onClick={() => void load(tab, country, true)}>
            {busy ? <Loader2 size={14} className="nr-spin" /> : <RefreshCw size={14} />}
          </button>
        </div>
      </header>

      {/* ── Breaking ticker ── */}
      <div className="nr-ticker" aria-label="Breaking headlines">
        <span className="nr-ticker-tag">Breaking</span>
        <div className="nr-ticker-track">
          {ticker.length ? (
            <div className="nr-ticker-run">
              {[...ticker, ...ticker].map((s, i) => (
                <button key={`${s.id}-${i}`} className="nr-ticker-item" onClick={() => onOpen(s.url)}>
                  <span className="nr-ticker-src">{s.source}</span>{s.title}
                </button>
              ))}
            </div>
          ) : <span className="nr-ticker-wait">Gathering the headlines from newsrooms worldwide…</span>}
        </div>
      </div>

      {/* ── World clocks ── */}
      <div className="nr-clocks">
        {CLOCKS.map(c => (
          <div key={c.city} className="nr-clock">
            <span className="nr-clock-city">{c.city}</span>
            <span className="nr-clock-time">
              {new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: c.tz })}
            </span>
          </div>
        ))}
      </div>

      {/* ── Desk navigation ── */}
      <nav className="nr-desks">
        {DESKS.map(d => {
          const Icon = d.icon
          return (
            <button key={d.id} onClick={() => pick(d.id)} className="nr-desk"
              data-active={d.id === tab} style={{ '--c': d.color } as React.CSSProperties}>
              <Icon size={13} />{d.label}
            </button>
          )
        })}
      </nav>

      <main className="nr-body">
        {tab === 'countries' && (
          <div className="nr-countries">
            {COUNTRIES.map(c => (
              <button key={c.code} className="nr-country" data-active={c.code === country} onClick={() => pickCountry(c.code)}>
                <span className="nr-flag">{c.flag}</span>{c.name}
              </button>
            ))}
          </div>
        )}

        {tab === 'kitchen' && <Kitchen onOpen={onOpen} />}

        {tab === 'kitchen' && <h2 className="nr-section-h"><UtensilsCrossed size={16} />Restaurants & food news</h2>}

        <DeskView
          result={current}
          busy={busy && !current}
          deskLabel={tab === 'countries' ? (COUNTRIES.find(c => c.code === country)?.name || 'Country') : desk.label}
          compact={tab === 'kitchen'}
          now={now}
          onOpen={onOpen}
          onRetry={() => void load(tab, country, true)}
        />
      </main>
    </div>
  )
}

// ── A desk: lead story, most-covered rail, then the grid ──────────────────────

function DeskView({ result, busy, deskLabel, compact, now, onOpen, onRetry }: {
  result?: DeskResult; busy: boolean; deskLabel: string; compact: boolean; now: number
  onOpen: (url: string) => void; onRetry: () => void
}) {
  if (busy) return <SkeletonDesk />
  if (!result) return null
  if (!result.ok) {
    return (
      <div className="nr-empty">
        <Newspaper size={28} />
        <p>{result.error || 'Nothing came back from the newsrooms.'}</p>
        <button className="nr-btn" onClick={onRetry}><RefreshCw size={13} /> Try again</button>
      </div>
    )
  }
  const stories = result.stories
  const withImage = stories.find(s => s.image) || stories[0]
  const lead = compact ? null : withImage
  const rest = stories.filter(s => s !== lead)
  const mostCovered = [...rest].filter(s => s.coverage > 1).sort((a, b) => b.coverage - a.coverage).slice(0, 5)
  const answered = result.sources.filter(s => s.ok).length

  return (
    <>
      {lead && (
        <section className="nr-front">
          <article className="nr-lead" onClick={() => onOpen(lead.url)}>
            {lead.image && <img src={lead.image} alt="" referrerPolicy="no-referrer" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />}
            <div className="nr-lead-shade" />
            <div className="nr-lead-body">
              <span className="nr-kicker">{deskLabel}</span>
              <h2>{lead.title}</h2>
              {lead.summary && <p>{lead.summary}</p>}
              <StoryMeta s={lead} now={now} light />
            </div>
          </article>
          <aside className="nr-rail">
            <h3><ShieldCheck size={14} /> Most covered</h3>
            {(mostCovered.length ? mostCovered : rest.slice(0, 5)).map((s, i) => (
              <button key={s.id} className="nr-rail-item" onClick={() => onOpen(s.url)}>
                <span className="nr-rail-n">{i + 1}</span>
                <span>
                  <span className="nr-rail-title">{s.title}</span>
                  <StoryMeta s={s} now={now} />
                </span>
              </button>
            ))}
          </aside>
        </section>
      )}

      <div className="nr-grid">
        {rest.map(s => <StoryCard key={s.id} s={s} now={now} onOpen={onOpen} />)}
      </div>

      <p className="nr-sources">
        Read from {answered} of {result.sources.length} newsrooms: {result.sources.map(s => s.name + (s.ok ? '' : ' (no answer)')).join(' · ')}.
        Stories carried by several outlets are folded together and marked with how many reported them.
      </p>
    </>
  )
}

function StoryMeta({ s, now, light }: { s: NewsStory; now: number; light?: boolean }) {
  return (
    <span className="nr-meta" data-light={light ? 'true' : 'false'}>
      <span className="nr-meta-src">{s.source}</span>
      {s.publishedAt ? <><span>·</span><Clock size={10} /><span>{timeAgo(s.publishedAt, now)}</span></> : null}
      {s.coverage > 1 && (
        <span className="nr-coverage" title={`Also reported by ${s.alsoBy.join(', ')}`}>
          <ShieldCheck size={10} /> {s.coverage} outlets
        </span>
      )}
    </span>
  )
}

function StoryCard({ s, now, onOpen }: { s: NewsStory; now: number; onOpen: (url: string) => void }) {
  const [imgOk, setImgOk] = useState(!!s.image)
  return (
    <article className="nr-card" onClick={() => onOpen(s.url)}>
      {imgOk ? (
        <div className="nr-card-img">
          <img src={s.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImgOk(false)} />
        </div>
      ) : (
        <div className="nr-card-img nr-card-noimg"><span>{s.source.slice(0, 1)}</span></div>
      )}
      <div className="nr-card-body">
        <h3>{s.title}</h3>
        {s.summary && <p>{s.summary}</p>}
        <StoryMeta s={s} now={now} />
      </div>
    </article>
  )
}

function SkeletonDesk() {
  return (
    <div className="nr-skeleton">
      <div className="nr-sk nr-sk-lead" />
      <div className="nr-grid">{Array.from({ length: 8 }, (_, i) => <div key={i} className="nr-sk nr-sk-card" />)}</div>
    </div>
  )
}

// ── Kitchen: recipes of the day + the local chef ─────────────────────────────

interface DishIdea { name: string; cuisine: string; description: string; minutes: number; ingredients: string[]; steps: string[] }

const IDEA_SCHEMA = {
  type: 'object',
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          cuisine: { type: 'string' },
          description: { type: 'string' },
          minutes: { type: 'number' },
          ingredients: { type: 'array', items: { type: 'string' } },
          steps: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'cuisine', 'description', 'minutes', 'ingredients', 'steps'],
      },
    },
  },
  required: ['ideas'],
}

const CUISINES = ['Surprise me', 'Congolese', 'West African', 'Italian', 'Mexican', 'Indian', 'Japanese', 'Middle Eastern', 'French', 'Healthy & light', 'Vegetarian']

export function parseIdeas(content: string): DishIdea[] {
  try {
    const text = String(content || '').replace(/^```(?:json)?\s*|\s*```$/g, '')
    const start = text.indexOf('{')
    const data = JSON.parse(start > 0 ? text.slice(start) : text)
    const list = Array.isArray(data?.ideas) ? data.ideas : []
    return list
      .filter((d: any) => d && typeof d.name === 'string' && d.name.trim())
      .slice(0, 4)
      .map((d: any) => ({
        name: String(d.name).trim(),
        cuisine: String(d.cuisine || '').trim(),
        description: String(d.description || '').trim(),
        minutes: Math.max(0, Math.round(Number(d.minutes) || 0)),
        ingredients: (Array.isArray(d.ingredients) ? d.ingredients : []).map(String).filter(Boolean).slice(0, 16),
        steps: (Array.isArray(d.steps) ? d.steps : []).map(String).filter(Boolean).slice(0, 10),
      }))
  } catch {
    return []
  }
}

function Kitchen({ onOpen }: { onOpen: (url: string) => void }) {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<Recipe | null>(null)

  const deal = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await api().news.recipes(4)
      if (res?.ok) setRecipes(res.recipes)
      else setError(res?.error || 'No recipes came back.')
    } catch (e: any) { setError(e?.message || 'No recipes came back.') }
    setLoading(false)
  }, [])
  useEffect(() => { void deal() }, [deal])

  return (
    <>
      <section className="nr-kitchen-hero">
        <div>
          <span className="nr-kicker" style={{ color: '#fdba74' }}>Today in the kitchen</span>
          <h2 className="nr-kitchen-title">Dishes of the day</h2>
          <p className="nr-kitchen-sub">Real recipes from kitchens around the world, each with a video to cook along to. Deal again for a new table.</p>
        </div>
        <button className="nr-btn nr-btn-warm" onClick={() => void deal()} disabled={loading}>
          {loading ? <Loader2 size={13} className="nr-spin" /> : <RefreshCw size={13} />} Deal new dishes
        </button>
      </section>

      {error && !loading && (
        <div className="nr-empty">
          <p>{error}</p>
          <button className="nr-btn" onClick={() => void deal()}><RefreshCw size={13} /> Try again</button>
        </div>
      )}
      <div className="nr-recipes">
        {(loading && !recipes.length ? Array.from({ length: 4 }, () => null) : recipes).map((r, i) => r ? (
          <article key={r.id} className="nr-recipe" onClick={() => setOpen(r)}>
            <div className="nr-recipe-img">
              {r.image && <img src={r.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
              {r.youtubeId && <span className="nr-play"><PlayCircle size={30} /></span>}
            </div>
            <div className="nr-recipe-body">
              <span className="nr-recipe-tags">{[r.area, r.category].filter(Boolean).join(' · ')}</span>
              <h3>{r.name}</h3>
              <span className="nr-recipe-count">{r.ingredients.length} ingredients{r.youtubeId ? ' · video' : ''}</span>
            </div>
          </article>
        ) : <div key={i} className="nr-sk nr-sk-recipe" />)}
      </div>

      <ChefIdeas onOpen={onOpen} />

      {open && <RecipeModal recipe={open} onClose={() => setOpen(null)} onOpen={onOpen} />}
    </>
  )
}

function RecipeModal({ recipe, onClose, onOpen }: { recipe: Recipe; onClose: () => void; onOpen: (url: string) => void }) {
  // youtube-nocookie first; the ordinary host when a video refuses to play there.
  const [altHost, setAltHost] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const steps = recipe.instructions.split(/\n+|(?<=\.)\s+(?=STEP|\d+\.)/).map(s => s.trim()).filter(s => s.length > 2)

  return (
    <div className="nr-modal-back" onClick={onClose}>
      <div className="nr-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label={recipe.name}>
        <button className="nr-modal-x" onClick={onClose} aria-label="Close"><X size={16} /></button>
        <div className="nr-modal-media">
          {recipe.youtubeId ? (
            <>
              <iframe
                key={altHost ? 'yt' : 'nc'}
                src={`https://${altHost ? 'www.youtube.com' : 'www.youtube-nocookie.com'}/embed/${recipe.youtubeId}?rel=0&modestbranding=1`}
                title={recipe.name}
                allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
              <div className="nr-modal-media-bar">
                <button onClick={() => setAltHost(a => !a)}>Video won't play? Try the other player</button>
                <button onClick={() => onOpen(`https://www.youtube.com/watch?v=${recipe.youtubeId}`)}><Youtube size={12} /> Open on YouTube</button>
              </div>
            </>
          ) : recipe.image ? <img src={recipe.image} alt="" referrerPolicy="no-referrer" /> : null}
        </div>
        <div className="nr-modal-body">
          <span className="nr-kicker" style={{ color: '#fdba74' }}>{[recipe.area, recipe.category].filter(Boolean).join(' · ')}</span>
          <h2 className="nr-modal-title">{recipe.name}</h2>
          <div className="nr-modal-cols">
            <div>
              <h4>Ingredients</h4>
              <ul className="nr-ingredients">
                {recipe.ingredients.map((g, i) => <li key={i}><span>{g.name}</span><em>{g.measure}</em></li>)}
              </ul>
            </div>
            <div>
              <h4>Method</h4>
              <ol className="nr-steps">{steps.map((s, i) => <li key={i}>{s.replace(/^(STEP\s*\d+|\d+\.)\s*/i, '')}</li>)}</ol>
            </div>
          </div>
          {recipe.source && <button className="nr-link" onClick={() => onOpen(recipe.source)}><ExternalLink size={12} /> Original recipe</button>}
        </div>
      </div>
    </div>
  )
}

function ChefIdeas({ onOpen }: { onOpen: (url: string) => void }) {
  const [fridge, setFridge] = useState('')
  const [cuisine, setCuisine] = useState(CUISINES[0])
  const [ideas, setIdeas] = useState<DishIdea[]>([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const started = useRef(0)

  useEffect(() => {
    if (!busy) return
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started.current) / 1000)), 1000)
    return () => clearInterval(t)
  }, [busy])

  const invent = async () => {
    setBusy(true); setNote(''); setElapsed(0); started.current = Date.now()
    const want = cuisine === CUISINES[0] ? 'any cuisine from anywhere in the world' : `${cuisine} cuisine`
    const have = fridge.trim() ? `Build around what I already have: ${fridge.trim()}.` : 'Use ingredients easy to find in a normal supermarket.'
    try {
      const res = await api().ai.json([
        { role: 'system', content: 'You are a creative, practical chef. Invent dishes a home cook can really make tonight. Keep steps short and concrete.' },
        // Kept deliberately compact: on a CPU-only machine every generated
        // token costs ~50 ms, so short ingredient lines and steps halve the wait.
        { role: 'user', content: `Invent 3 delicious, different dishes in ${want}. ${have} For each give: name, cuisine, one short mouth-watering sentence, total minutes, at most 7 ingredients with amounts, and 4-5 steps of at most 14 words each. Answer as JSON {"ideas":[...]}.` },
      ], IDEA_SCHEMA)
      const list = res?.ok ? parseIdeas(res.content) : []
      if (list.length) { setIdeas(list); setNote(res.provider === 'ollama' ? `Invented by your local Ollama model${res.model ? ` (${res.model})` : ''}` : `Invented by ${res.provider}`) }
      else setNote(res?.error ? `The chef could not answer: ${res.error}` : 'The chef came back empty-handed — try again.')
    } catch (e: any) {
      setNote(`The chef could not answer: ${e?.message || e}`)
    }
    setBusy(false)
  }

  return (
    <section className="nr-chef">
      <div className="nr-chef-head">
        <ChefHat size={22} />
        <div>
          <h2 className="nr-kitchen-title" style={{ fontSize: 24 }}>The AI Chef</h2>
          <p className="nr-kitchen-sub">Tell it what is in your fridge — your local model invents three dishes you can make tonight.</p>
        </div>
      </div>
      <div className="nr-chef-form">
        <input value={fridge} onChange={e => setFridge(e.target.value)} placeholder="e.g. chicken, rice, plantains, tomatoes…"
          onKeyDown={e => { if (e.key === 'Enter' && !busy) void invent() }} />
        <select value={cuisine} onChange={e => setCuisine(e.target.value)}>
          {CUISINES.map(c => <option key={c}>{c}</option>)}
        </select>
        <button className="nr-btn nr-btn-warm" onClick={() => void invent()} disabled={busy}>
          {busy ? <Loader2 size={13} className="nr-spin" /> : <Wand2 size={13} />} {busy ? `Cooking up ideas… ${elapsed}s` : 'Invent dishes'}
        </button>
      </div>
      {busy && <p className="nr-chef-note">Your own computer is cooking these up privately — on a machine without a graphics card this takes a minute or two.</p>}
      {note && <p className="nr-chef-note">{note}</p>}
      {busy && !ideas.length && <div className="nr-recipes">{Array.from({ length: 3 }, (_, i) => <div key={i} className="nr-sk nr-sk-recipe" />)}</div>}
      {!!ideas.length && (
        <div className="nr-ideas">
          {ideas.map((d, i) => (
            <article key={i} className="nr-idea">
              <span className="nr-recipe-tags">{[d.cuisine, d.minutes ? `${d.minutes} min` : ''].filter(Boolean).join(' · ')}</span>
              <h3>{d.name}</h3>
              <p className="nr-idea-desc">{d.description}</p>
              <h4>You need</h4>
              <ul className="nr-idea-list">{d.ingredients.map((g, j) => <li key={j}>{g}</li>)}</ul>
              <h4>Make it</h4>
              <ol className="nr-idea-steps">{d.steps.map((s, j) => <li key={j}>{s.replace(/^\d+[.)]\s*/, '')}</li>)}</ol>
              <button className="nr-link" onClick={() => onOpen(`https://www.youtube.com/results?search_query=${encodeURIComponent(`how to make ${d.name}`)}`)}>
                <Youtube size={12} /> Find a video of something similar
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

const NEWS_CSS = `
.aihub-news{--ink:#0a0c12;--paper:#11141c;--paper2:#161a24;--line:rgba(255,255,255,.07);--text:#e8eaf2;--muted:#9aa1b8;--faint:#6b7290;
  min-height:100%;background:radial-gradient(1200px 500px at 50% -200px, color-mix(in srgb, var(--desk) 22%, transparent), transparent 70%), var(--ink);
  color:var(--text);font-family:Inter,system-ui,sans-serif;padding-bottom:60px;transition:background .5s}
:where(.aihub-news) :where(button){font:inherit;color:inherit;background:none;border:none;cursor:pointer;text-align:left}
.nr-steps,.nr-idea-steps{list-style:decimal}
.nr-idea-list{list-style:disc}
.nr-mast{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:16px;padding:22px 28px 14px;border-bottom:1px solid var(--line)}
.nr-mast-left{display:flex;align-items:center;gap:12px}
.nr-mast-right{display:flex;align-items:center;justify-content:flex-end;gap:10px}
.nr-title{font-family:Fraunces,Georgia,'Times New Roman',serif;font-weight:800;font-size:clamp(28px,3.4vw,44px);letter-spacing:-.02em;margin:0;line-height:1;text-align:center}
.nr-live{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:4px;background:#dc2626;color:#fff;font-size:11px;font-weight:800;letter-spacing:.12em}
.nr-live-dot{width:6px;height:6px;border-radius:99px;background:#fff;animation:nrBlink 1.2s steps(2) infinite}
.nr-date{font-size:12.5px;color:var(--muted)}
.nr-updated{font-size:11.5px;color:var(--faint)}
.nr-icon-btn{width:30px;height:30px;border-radius:8px;display:flex!important;align-items:center;justify-content:center;border:1px solid var(--line)!important;color:var(--muted)!important}
.nr-icon-btn:hover{color:var(--text)!important;background:rgba(255,255,255,.05)!important}
.nr-ticker{display:flex;align-items:stretch;height:36px;background:#111;border-bottom:1px solid var(--line);overflow:hidden}
.nr-ticker-tag{display:flex;align-items:center;padding:0 14px;background:#dc2626;color:#fff;font-weight:800;font-size:11px;letter-spacing:.14em;text-transform:uppercase;flex-shrink:0;clip-path:polygon(0 0,100% 0,calc(100% - 10px) 100%,0 100%);padding-right:22px}
.nr-ticker-track{flex:1;overflow:hidden;position:relative;mask-image:linear-gradient(90deg,transparent,#000 30px,#000 calc(100% - 40px),transparent)}
.nr-ticker-run{display:flex;gap:36px;width:max-content;height:100%;align-items:center;animation:nrTicker 120s linear infinite}
.nr-ticker-track:hover .nr-ticker-run{animation-play-state:paused}
.nr-ticker-item{font-size:13px;white-space:nowrap;color:#f3f4f6!important}
.nr-ticker-item:hover{color:#fca5a5!important}
.nr-ticker-src{color:#f87171;font-weight:700;margin-right:8px;font-size:11px;text-transform:uppercase;letter-spacing:.06em}
.nr-ticker-wait{display:flex;align-items:center;height:100%;padding-left:16px;font-size:12.5px;color:var(--faint)}
.nr-clocks{display:flex;gap:4px;overflow-x:auto;padding:10px 28px;border-bottom:1px solid var(--line);scrollbar-width:none}
.nr-clock{display:flex;flex-direction:column;align-items:center;min-width:84px;padding:4px 8px;border-radius:8px}
.nr-clock-city{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint)}
.nr-clock-time{font-variant-numeric:tabular-nums;font-size:15px;font-weight:700;color:var(--text)}
.nr-desks{position:sticky;top:0;z-index:5;display:flex;gap:6px;overflow-x:auto;padding:12px 28px;background:color-mix(in srgb,var(--ink) 88%,transparent);backdrop-filter:blur(14px);border-bottom:1px solid var(--line);scrollbar-width:thin}
.nr-desk{display:inline-flex!important;align-items:center;gap:6px;white-space:nowrap;padding:7px 13px!important;border-radius:999px;font-size:12.5px;font-weight:600;color:var(--muted)!important;border:1px solid transparent!important;transition:all .2s}
.nr-desk:hover{color:var(--text)!important;background:color-mix(in srgb,var(--c) 12%,transparent)!important}
.nr-desk[data-active="true"]{color:#fff!important;background:var(--c)!important;box-shadow:0 6px 22px color-mix(in srgb,var(--c) 45%,transparent)}
.nr-body{max-width:1320px;margin:0 auto;padding:22px 28px}
.nr-countries{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px}
.nr-country{display:inline-flex!important;align-items:center;gap:7px;padding:7px 12px!important;border-radius:10px;background:var(--paper)!important;border:1px solid var(--line)!important;font-size:12.5px;font-weight:600;color:var(--muted)!important}
.nr-country[data-active="true"]{border-color:#14b8a6!important;color:#fff!important;background:rgba(20,184,166,.16)!important}
.nr-flag{font-size:16px}
.nr-front{display:grid;grid-template-columns:minmax(0,2fr) minmax(260px,1fr);gap:20px;margin-bottom:26px}
.nr-lead{position:relative;min-height:400px;border-radius:18px;overflow:hidden;cursor:pointer;background:linear-gradient(135deg,color-mix(in srgb,var(--desk) 40%,#111),#111);box-shadow:0 20px 60px rgba(0,0,0,.45)}
.nr-lead img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:transform 6s ease}
.nr-lead:hover img{transform:scale(1.05)}
.nr-lead-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 25%,rgba(0,0,0,.92))}
.nr-lead-body{position:absolute;left:0;right:0;bottom:0;padding:28px}
.nr-lead h2{font-family:Fraunces,Georgia,serif;font-weight:800;font-size:clamp(24px,2.6vw,36px);line-height:1.12;margin:8px 0 10px;color:#fff;text-wrap:balance}
.nr-lead p{color:#d1d5db;font-size:14.5px;line-height:1.55;margin:0 0 12px;max-width:760px}
.nr-kicker{display:inline-block;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--desk)}
.nr-rail{background:var(--paper);border:1px solid var(--line);border-radius:18px;padding:18px}
.nr-rail h3{display:flex;align-items:center;gap:7px;margin:0 0 10px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--desk)}
.nr-rail-item{display:flex!important;gap:12px;padding:11px 0!important;border-top:1px solid var(--line)!important;width:100%}
.nr-rail-item:first-of-type{border-top:none!important}
.nr-rail-n{font-family:Fraunces,Georgia,serif;font-size:26px;font-weight:800;color:color-mix(in srgb,var(--desk) 70%,#555);line-height:1;min-width:22px}
.nr-rail-title{display:block;font-size:14px;font-weight:600;line-height:1.35;margin-bottom:4px}
.nr-rail-item:hover .nr-rail-title{color:var(--desk)}
.nr-meta{display:inline-flex;flex-wrap:wrap;align-items:center;gap:5px;font-size:11.5px;color:var(--faint)}
.nr-meta[data-light="true"]{color:#cbd5e1}
.nr-meta-src{font-weight:700;color:var(--muted)}
.nr-meta[data-light="true"] .nr-meta-src{color:#fff}
.nr-coverage{display:inline-flex;align-items:center;gap:3px;margin-left:4px;padding:1px 7px;border-radius:99px;background:rgba(34,197,94,.14);color:#4ade80;font-weight:700;font-size:10.5px}
.nr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:16px}
.nr-card{display:flex;flex-direction:column;border-radius:14px;overflow:hidden;background:var(--paper);border:1px solid var(--line);cursor:pointer;transition:transform .25s,border-color .25s,box-shadow .25s}
.nr-card:hover{transform:translateY(-3px);border-color:color-mix(in srgb,var(--desk) 45%,transparent);box-shadow:0 14px 36px rgba(0,0,0,.4)}
.nr-card-img{aspect-ratio:16/9;overflow:hidden;background:#0d0f15}
.nr-card-img img{width:100%;height:100%;object-fit:cover;transition:transform .5s}
.nr-card:hover .nr-card-img img{transform:scale(1.06)}
.nr-card-noimg{display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,color-mix(in srgb,var(--desk) 30%,#151821),#0e1016)}
.nr-card-noimg span{font-family:Fraunces,Georgia,serif;font-size:46px;font-weight:800;color:rgba(255,255,255,.18)}
.nr-card-body{padding:14px 16px 16px;display:flex;flex-direction:column;gap:7px;flex:1}
.nr-card h3{font-family:Fraunces,Georgia,serif;font-size:17px;font-weight:600;line-height:1.28;margin:0;text-wrap:pretty}
.nr-card p{margin:0;font-size:13px;line-height:1.5;color:var(--muted);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.nr-card .nr-meta{margin-top:auto}
.nr-sources{margin:26px 0 0;font-size:11.5px;color:var(--faint);line-height:1.6}
.nr-section-h{display:flex;align-items:center;gap:8px;font-family:Fraunces,Georgia,serif;font-size:22px;margin:34px 0 14px}
.nr-empty{display:flex;flex-direction:column;align-items:center;gap:12px;padding:60px 20px;color:var(--muted);text-align:center}
.nr-btn{display:inline-flex!important;align-items:center;gap:7px;padding:9px 16px!important;border-radius:10px;font-weight:700;font-size:12.5px;background:rgba(255,255,255,.07)!important;border:1px solid var(--line)!important;white-space:nowrap}
.nr-btn:disabled{opacity:.6;cursor:default}
.nr-btn-warm{background:linear-gradient(135deg,#f97316,#ef4444)!important;color:#fff!important;border:none!important;box-shadow:0 8px 24px rgba(249,115,22,.35)}
.nr-link{display:inline-flex!important;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#fdba74!important;margin-top:8px}
.nr-link:hover{text-decoration:underline}
.nr-kitchen-hero{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;padding:26px;border-radius:20px;margin-bottom:18px;
  background:radial-gradient(600px 240px at 0% 0%,rgba(249,115,22,.28),transparent 70%),radial-gradient(500px 240px at 100% 100%,rgba(239,68,68,.2),transparent 70%),var(--paper);border:1px solid rgba(249,115,22,.2)}
.nr-kitchen-title{font-family:Fraunces,Georgia,serif;font-size:32px;font-weight:800;margin:6px 0 6px}
.nr-kitchen-sub{margin:0;color:var(--muted);font-size:13.5px;max-width:560px}
.nr-recipes{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px;margin-bottom:28px}
.nr-recipe{border-radius:16px;overflow:hidden;background:var(--paper);border:1px solid var(--line);cursor:pointer;transition:transform .25s,box-shadow .25s}
.nr-recipe:hover{transform:translateY(-4px) rotate(-.3deg);box-shadow:0 16px 40px rgba(249,115,22,.18)}
.nr-recipe-img{position:relative;aspect-ratio:4/3;background:#1a1410;overflow:hidden}
.nr-recipe-img img{width:100%;height:100%;object-fit:cover;transition:transform .6s}
.nr-recipe:hover .nr-recipe-img img{transform:scale(1.08)}
.nr-play{position:absolute;right:10px;bottom:10px;color:#fff;filter:drop-shadow(0 2px 8px rgba(0,0,0,.6))}
.nr-recipe-body{padding:12px 14px 14px}
.nr-recipe-tags{font-size:10.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#fdba74}
.nr-recipe h3,.nr-idea h3{font-family:Fraunces,Georgia,serif;font-size:19px;font-weight:600;margin:4px 0 4px}
.nr-recipe-count{font-size:11.5px;color:var(--faint)}
.nr-chef{padding:24px;border-radius:20px;background:linear-gradient(180deg,rgba(168,85,247,.12),transparent 60%),var(--paper);border:1px solid rgba(168,85,247,.22)}
.nr-chef-head{display:flex;gap:14px;align-items:flex-start;color:#d8b4fe}
.nr-chef-form{display:flex;gap:10px;margin:16px 0 8px;flex-wrap:wrap}
.nr-chef-form input,.nr-chef-form select{background:#0d0f15;border:1px solid var(--line);color:var(--text);border-radius:10px;padding:9px 12px;font-size:13px;outline:none}
.nr-chef-form input{flex:1;min-width:220px}
.nr-chef-form input:focus,.nr-chef-form select:focus{border-color:#a855f7}
.nr-chef-note{font-size:11.5px;color:var(--faint);margin:6px 0 12px}
.nr-ideas{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
.nr-idea{padding:18px;border-radius:16px;background:#0e1018;border:1px solid var(--line);animation:nrRise .5s ease both}
.nr-idea:nth-child(2){animation-delay:.08s}.nr-idea:nth-child(3){animation-delay:.16s}
.nr-idea-desc{color:var(--muted);font-size:13px;line-height:1.5;margin:0 0 10px}
.nr-idea h4,.nr-modal-body h4{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);margin:12px 0 6px}
.nr-idea-list,.nr-idea-steps{margin:0;padding-left:18px;font-size:13px;line-height:1.55;color:#d1d5db}
.nr-modal-back{position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.72);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:24px;animation:nrFade .2s}
.nr-modal{position:relative;width:min(1000px,100%);max-height:100%;overflow:auto;border-radius:20px;background:var(--paper);border:1px solid var(--line);box-shadow:0 30px 90px rgba(0,0,0,.6);animation:nrRise .25s ease}
.nr-modal-x{position:absolute;top:12px;right:12px;z-index:2;width:32px;height:32px;border-radius:99px;display:flex!important;align-items:center;justify-content:center;background:rgba(0,0,0,.55)!important;color:#fff!important}
.nr-modal-media{background:#000}
.nr-modal-media iframe{display:block;width:100%;aspect-ratio:16/9;border:0}
.nr-modal-media img{display:block;width:100%;max-height:420px;object-fit:cover}
.nr-modal-media-bar{display:flex;justify-content:space-between;gap:10px;padding:8px 14px;background:#0b0b0b}
.nr-modal-media-bar button{font-size:11.5px;color:var(--faint)!important;display:inline-flex!important;align-items:center;gap:5px}
.nr-modal-media-bar button:hover{color:var(--text)!important}
.nr-modal-body{padding:22px 26px 26px}
.nr-modal-title{font-family:Fraunces,Georgia,serif;font-size:30px;font-weight:800;margin:6px 0 4px}
.nr-modal-cols{display:grid;grid-template-columns:minmax(200px,1fr) 2fr;gap:26px}
.nr-ingredients{list-style:none;margin:0;padding:0}
.nr-ingredients li{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px dashed var(--line);font-size:13px}
.nr-ingredients em{font-style:normal;color:#fdba74;text-align:right}
.nr-steps{margin:0;padding-left:20px;font-size:13.5px;line-height:1.65;color:#d1d5db}
.nr-steps li{margin-bottom:8px}
.nr-sk{border-radius:14px;background:linear-gradient(90deg,var(--paper) 0%,var(--paper2) 50%,var(--paper) 100%);background-size:200% 100%;animation:nrShimmer 1.3s linear infinite}
.nr-sk-lead{height:400px;margin-bottom:24px;border-radius:18px}
.nr-sk-card{height:290px}
.nr-sk-recipe{height:260px}
.nr-spin{animation:nrSpin 1s linear infinite}
@keyframes nrSpin{to{transform:rotate(360deg)}}
@keyframes nrBlink{50%{opacity:.2}}
@keyframes nrTicker{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@keyframes nrShimmer{from{background-position:200% 0}to{background-position:-200% 0}}
@keyframes nrRise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes nrFade{from{opacity:0}to{opacity:1}}
@media (max-width:900px){.nr-front{grid-template-columns:1fr}.nr-modal-cols{grid-template-columns:1fr}.nr-mast{grid-template-columns:1fr;text-align:center}.nr-mast-left,.nr-mast-right{justify-content:center}}
@media (prefers-reduced-motion:reduce){.nr-ticker-run{animation-duration:400s}.nr-lead img,.nr-card-img img,.nr-recipe-img img{transition:none}}
`
