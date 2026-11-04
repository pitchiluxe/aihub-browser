import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  RefreshCw, Loader2, Globe2, Landmark, Briefcase, Cpu, FlaskConical, HeartPulse, Trophy,
  Sparkles, UtensilsCrossed, Clapperboard, Newspaper, MapPin, ShieldCheck, ChefHat, PlayCircle,
  X, Clock, ExternalLink, Wand2, Youtube, Flame, WifiOff,
} from 'lucide-react'
import { COUNTRIES, canResolveImage, type DeskId, type DeskResult, type NewsStory, type Recipe } from '../../../../shared/news'
import { faviconSourceUrl } from '../../../../shared/favicon'
import { NEWS_CSS } from './newsStyles'

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

  // When the newsrooms could not be reached — an empty desk, or the saved
  // copy standing in — keep trying quietly, so the page heals itself when the
  // connection comes back instead of waiting for someone to press retry.
  const needsRetry = !!current && (!current.ok || !!current.stale)
  useEffect(() => {
    if (!needsRetry || busy) return
    const t = setTimeout(() => void load(tab, country, true), 30_000)
    return () => clearTimeout(t)
  }, [needsRetry, busy, tab, country]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="aihub-news" style={{ '--desk': desk.color } as React.CSSProperties}>
      <style>{NEWS_CSS}</style>
      <div className="nr-shell">

      {/* ── Masthead ── */}
      <header className="nr-mast nr-panel">
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
      <div className="nr-ticker nr-panel" aria-label="Breaking headlines">
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
      <nav className="nr-desks nr-panel">
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
                {/* Windows has no flag emoji (it draws "CD"), so real flags;
                    the shared Israel & Palestine desk keeps its dove. */}
                {c.code === 'il'
                  ? <span className="nr-flag">{c.flag}</span>
                  : <img className="nr-flag-img" src={`https://flagcdn.com/w80/${c.code}.png`} alt="" loading="lazy" referrerPolicy="no-referrer" />}
                {c.name}
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
      {result.stale && (
        <div className="nr-stale" role="status">
          <WifiOff size={15} />
          <span>The newsrooms can't be reached right now — showing the headlines saved {timeAgo(result.fetchedAt, now)}. Retrying on its own.</span>
        </div>
      )}
      {lead && (
        <section className="nr-front">
          <article className="nr-lead" onClick={() => onOpen(lead.url)}>
            <StoryThumb s={lead} eager />
            <div className="nr-lead-shade" />
            <div className="nr-lead-body">
              <span className="nr-kicker">{deskLabel}</span>
              <h2>{lead.title}</h2>
              {lead.summary && <p>{lead.summary}</p>}
              <StoryMeta s={lead} now={now} light />
            </div>
          </article>
          <aside className="nr-rail nr-panel">
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

// ── Thumbnails ─────────────────────────────────────────────────────────────

/**
 * Share pictures found for stories whose feed carried none, kept for the
 * page's life so switching desks never asks twice. '' means "looked, none".
 */
const foundImages = new Map<string, string>()

function hueOf(text: string): number {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360
  return h
}

/**
 * The story's picture in HD. A story without one asks main for the article's
 * own share picture once it scrolls near the screen; while that runs the
 * frame shimmers, and if the article has none either, the publisher's card —
 * its logo on a colour of its own — stands in. Never a bare letter.
 */
function StoryThumb({ s, eager }: { s: NewsStory; eager?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const known = s.image || foundImages.get(s.url)
  const [src, setSrc] = useState<string>(known || '')
  const [state, setState] = useState<'photo' | 'looking' | 'publisher'>(
    known ? 'photo' : foundImages.has(s.url) || !canResolveImage(s.url) ? 'publisher' : 'looking',
  )
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (state !== 'looking') return
    const el = ref.current
    if (!el) return
    let cancelled = false
    const look = () => {
      void Promise.resolve(api()?.news?.image?.(s.url)).then((img: string) => {
        foundImages.set(s.url, img || '')
        if (cancelled) return
        if (img) { setSrc(img); setState('photo') } else setState('publisher')
      }).catch(() => { if (!cancelled) setState('publisher') })
    }
    if (eager) { look(); return () => { cancelled = true } }
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { io.disconnect(); look() }
    }, { rootMargin: '600px 0px' })
    io.observe(el)
    return () => { cancelled = true; io.disconnect() }
  }, [state, s.url, eager])

  return (
    <div ref={ref} className="nr-thumb">
      {state === 'photo' && src && (
        <img
          src={src} alt="" decoding="async" loading={eager ? 'eager' : 'lazy'} referrerPolicy="no-referrer"
          className={loaded ? 'is-loaded' : ''}
          onLoad={() => setLoaded(true)}
          onError={() => { foundImages.set(s.url, ''); setState('publisher') }}
        />
      )}
      {(state === 'looking' || (state === 'photo' && !loaded)) && <div className="nr-thumb-wait" />}
      {state === 'publisher' && <PublisherArt s={s} />}
    </div>
  )
}

function PublisherArt({ s }: { s: NewsStory }) {
  const [logoOk, setLogoOk] = useState(!!s.site)
  return (
    <div className="nr-pub" style={{ '--h': hueOf(s.site || s.source) } as React.CSSProperties}>
      <span className="nr-pub-logo">
        {logoOk
          ? <img src={faviconSourceUrl(s.site, 128)} alt="" referrerPolicy="no-referrer" onError={() => setLogoOk(false)} />
          : <b>{(s.source || '?').slice(0, 1).toUpperCase()}</b>}
      </span>
      <span className="nr-pub-name">{s.source}</span>
    </div>
  )
}

function StoryCard({ s, now, onOpen }: { s: NewsStory; now: number; onOpen: (url: string) => void }) {
  return (
    <article className="nr-card" onClick={() => onOpen(s.url)}>
      <StoryThumb s={s} />
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
