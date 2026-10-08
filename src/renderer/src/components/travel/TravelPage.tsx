/**
 * Travel the World — pick any country and see it: tourist videos from YouTube,
 * real facts (REST Countries + Wikipedia), and an AI travel guide with hotels,
 * Airbnb areas, car rental, geography, economy and politics. Every
 * recommendation links to a real site to check or book it.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Globe2, Search, Shuffle, Play, X, ExternalLink, Loader2, Sparkles, RefreshCw, MapPin, Plane, BedDouble, Home,
  Car, ShieldCheck, BookOpen, Clock, Users, Landmark, Coins, Languages, Navigation, Phone, Utensils, Mountain,
  Factory, Scale, HeartHandshake, Sun, Wallet, Bus, Stamp,
} from 'lucide-react'
import { COUNTRIES, REGIONS, matchCountry, type Country, type Region } from './countries'
import {
  VIDEO_TOPICS, cachedGuide, fetchFacts, fetchLeaders, fetchSummary, generateGuide, links, searchTravelVideos,
  type CountryFacts, type Leader, type TravelGuide, type TravelVideo, type WikiSummary,
} from './travelData'
import './travel.css'

const LAST_KEY = 'aihub-travel-last'
const FEATURED = ['JP', 'IT', 'KE', 'BR', 'TH', 'FR', 'MA', 'NZ', 'PE', 'GR', 'ZA', 'IS']

type Tab = 'videos' | 'guide' | 'stay'

export default function TravelPage({ onNavigate }: { onNavigate: (url: string) => void }) {
  const [query, setQuery] = useState('')
  const [region, setRegion] = useState<Region | 'All'>('All')
  const [country, setCountry] = useState<Country | null>(() => {
    try { const c = localStorage.getItem(LAST_KEY); return COUNTRIES.find(x => x.code === c) ?? null } catch { return null }
  })
  const [tab, setTab] = useState<Tab>('videos')

  const list = useMemo(() => COUNTRIES.filter(c => (region === 'All' || c.region === region) && matchCountry(c, query)), [query, region])

  const pick = (c: Country) => {
    setCountry(c)
    setTab('videos')
    try { localStorage.setItem(LAST_KEY, c.code) } catch { /* optional */ }
  }
  const surprise = () => pick(COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)])
  const open = (url: string) => onNavigate(url)

  return (
    <div className="travel">
      <aside className="travel-rail">
        <div className="travel-brand"><Globe2 size={18} /> <span>Travel the World</span></div>
        <div className="travel-search">
          <Search size={13} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search a country…" spellCheck={false} />
          {query && <button onClick={() => setQuery('')} aria-label="Clear"><X size={12} /></button>}
        </div>
        <div className="travel-regions">
          {(['All', ...REGIONS] as const).map(r => (
            <button key={r} className={region === r ? 'on' : ''} onClick={() => setRegion(r)}>{r}</button>
          ))}
        </div>
        <button className="travel-surprise" onClick={surprise}><Shuffle size={13} /> Surprise me</button>
        <div className="travel-list">
          {list.map(c => (
            <button key={c.code} className={`travel-country ${country?.code === c.code ? 'on' : ''}`} onClick={() => pick(c)}>
              <Flag code={c.code} className="travel-flag" />
              <span className="travel-cname">{c.name}</span>
              <small>{c.region}</small>
            </button>
          ))}
          {!list.length && <div className="travel-empty">No country matches “{query}”.</div>}
        </div>
      </aside>

      <main className="travel-main">
        {!country ? <Welcome onPick={pick} /> : (
          <CountryView key={country.code} country={country} tab={tab} setTab={setTab} open={open} />
        )}
      </main>
    </div>
  )
}

function Welcome({ onPick }: { onPick: (c: Country) => void }) {
  return (
    <div className="travel-welcome">
      <div className="travel-welcome-hero">
        <Globe2 size={44} />
        <h1>Where do you want to go?</h1>
        <p>Pick any country to watch the best tourist videos, learn its geography, economy and politics, and get AI recommendations for hotels, Airbnb neighbourhoods and car rental — all before you ever book a flight.</p>
      </div>
      <div className="travel-featured">
        {FEATURED.map(code => {
          const c = COUNTRIES.find(x => x.code === code)!
          return (
            <button key={code} onClick={() => onPick(c)}>
              <Flag code={code} className="travel-flag-big" />
              <b>{c.name}</b>
              <small>{c.region}</small>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function CountryView({ country, tab, setTab, open }: { country: Country; tab: Tab; setTab: (t: Tab) => void; open: (u: string) => void }) {
  const [facts, setFacts] = useState<CountryFacts | null>(null)
  const [wiki, setWiki] = useState<WikiSummary | null>(null)
  const [leaders, setLeaders] = useState<Leader[] | null>(null)
  // The hero is a still from the country's top travel video — a real view of the place, not its flag.
  const [hero, setHero] = useState<TravelVideo | null>(null)
  useEffect(() => {
    let alive = true
    setHero(null)
    searchTravelVideos(country, 'drone').then(v => { if (alive) setHero(v[0] ?? null) }).catch(() => {})
    return () => { alive = false }
  }, [country])
  const [factsLoading, setFactsLoading] = useState(true)
  const [guide, setGuide] = useState<{ g: TravelGuide; provider: string } | null>(() => cachedGuide(country.code))
  const [guideBusy, setGuideBusy] = useState(false)
  const [guideErr, setGuideErr] = useState<string | null>(null)
  const asked = useRef(false)

  useEffect(() => {
    let alive = true
    setFactsLoading(true)
    setLeaders(null)
    void Promise.all([fetchFacts(country), fetchSummary(country)]).then(([f, w]) => {
      if (!alive) return
      setFacts(f); setWiki(w); setFactsLoading(false)
    })
    void fetchLeaders(country).then(l => { if (alive) setLeaders(l) })
    return () => { alive = false }
  }, [country])

  const runGuide = async (force = false) => {
    if (guideBusy || (!force && guide)) return
    setGuideBusy(true); setGuideErr(null)
    const who = (leaders ?? []).map(l => `${l.name}${l.office ? ` (${l.office})` : ''}`).join('; ')
    try { setGuide(await generateGuide(country, facts, `${wiki?.extract ?? ''}${who ? `
Current leaders: ${who}.` : ''}`)) }
    catch (e: any) { setGuideErr(e?.message || 'The guide could not be written.') }
    finally { setGuideBusy(false) }
  }
  // The guide is written once the facts are in (so the model is grounded on them), when it is first wanted.
  useEffect(() => {
    if ((tab === 'guide' || tab === 'stay') && !guide && !factsLoading && leaders !== null && !asked.current) { asked.current = true; void runGuide() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, factsLoading, leaders])

  const name = country.name
  const capital = facts?.capital[0] ?? ''

  return (
    <div className="travel-country-view">
      <header className="travel-hero" style={hero ? { backgroundImage: `linear-gradient(180deg, rgba(5,10,25,0.1), rgba(5,10,25,0.9)), url("https://i.ytimg.com/vi/${hero.id}/maxresdefault.jpg"), url("${hero.thumbnail}")` } : undefined}>
        <div className="travel-hero-title">
          <Flag code={country.code} className="travel-flag-hero" />
          <div>
            <h1>{name}</h1>
            <p>{facts?.official && facts.official !== name ? `${facts.official} · ` : ''}{facts?.subregion || country.region}</p>
          </div>
        </div>
        <div className="travel-facts">
          <Fact icon={<Landmark size={13} />} label="Capital" value={facts?.capital.join(', ')} />
          <Fact icon={<Users size={13} />} label="Population" value={facts?.population != null ? compact(facts.population) : undefined} />
          <Fact icon={<Mountain size={13} />} label="Area" value={facts?.areaKm2 != null ? `${compact(facts.areaKm2)} km²` : undefined} />
          <Fact icon={<Coins size={13} />} label="Currency" value={facts?.currencies.map(c => `${c.name}${c.symbol ? ` (${c.symbol})` : ''}`).join(', ')} />
          <Fact icon={<Languages size={13} />} label="Languages" value={facts?.languages.slice(0, 3).join(', ')} />
          <Fact icon={<Navigation size={13} />} label="Drives on" value={facts?.driveSide ? `the ${facts.driveSide}` : undefined} />
          <Fact icon={<Clock size={13} />} label="Time zone" value={facts?.timezones.length ? facts.timezones.length > 2 ? `${facts.timezones[0]} … (${facts.timezones.length})` : facts.timezones.join(', ') : undefined} />
          <Fact icon={<Phone size={13} />} label="Calling code" value={facts?.callingCode || undefined} />
        </div>
        <div className="travel-actions">
          <button onClick={() => open(links.flights(name))}><Plane size={13} /> Flights</button>
          <button onClick={() => open(links.booking(capital ? `${capital}, ${name}` : name))}><BedDouble size={13} /> Hotels</button>
          <button onClick={() => open(links.airbnb(name))}><Home size={13} /> Airbnb</button>
          <button onClick={() => open(links.carRental(capital || name))}><Car size={13} /> Car rental</button>
          <button onClick={() => open(links.advisory(country))}><ShieldCheck size={13} /> Travel advice</button>
          <button onClick={() => open(facts?.mapUrl ?? links.maps(name))}><MapPin size={13} /> Map</button>
          {wiki?.url && <button onClick={() => open(wiki.url)}><BookOpen size={13} /> Wikipedia</button>}
        </div>
      </header>

      <nav className="travel-tabs">
        <button className={tab === 'videos' ? 'on' : ''} onClick={() => setTab('videos')}><Play size={13} /> Videos</button>
        <button className={tab === 'guide' ? 'on' : ''} onClick={() => setTab('guide')}><Sparkles size={13} /> Travel guide</button>
        <button className={tab === 'stay' ? 'on' : ''} onClick={() => setTab('stay')}><BedDouble size={13} /> Stay & get around</button>
      </nav>

      {tab === 'videos' && <Videos country={country} open={open} />}
      {tab === 'guide' && (
        <GuideTab wiki={wiki} leaders={leaders} guide={guide} busy={guideBusy} err={guideErr} retry={() => void runGuide(true)} country={country} open={open} />
      )}
      {tab === 'stay' && (
        <StayTab guide={guide} busy={guideBusy} err={guideErr} retry={() => void runGuide(true)} country={country} facts={facts} open={open} />
      )}
    </div>
  )
}

/** Flag image (Windows has no flag emoji). */
function Flag({ code, className }: { code: string; className?: string }) {
  return <img className={`travel-flagimg ${className ?? ''}`} src={`https://flagcdn.com/w80/${code.toLowerCase()}.png`} alt="" loading="lazy" draggable={false} />
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value?: string }) {
  return (
    <div className="travel-fact">
      <small>{icon}{label}</small>
      <b>{value || '—'}</b>
    </div>
  )
}

function compact(n: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

// ── Videos ─────────────────────────────────────────────────────────────────

function Videos({ country, open }: { country: Country; open: (u: string) => void }) {
  const [topic, setTopic] = useState('top')
  const [videos, setVideos] = useState<TravelVideo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState<TravelVideo | null>(null)
  const [altHost, setAltHost] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true); setError(null)
    searchTravelVideos(country, topic)
      .then(v => { if (alive) { setVideos(v); if (!v.length) setError('No tourist videos found for this topic — try another one.') } })
      .catch(e => { if (alive) { setVideos([]); setError(e?.message || 'YouTube could not be reached') } })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [country, topic])

  return (
    <section className="travel-section">
      <div className="travel-topics">
        {VIDEO_TOPICS.map(t => <button key={t.id} className={topic === t.id ? 'on' : ''} onClick={() => setTopic(t.id)}>{t.label}</button>)}
      </div>

      {playing && (
        <div className="travel-player">
          <div className="travel-player-bar">
            <b>{playing.title}</b>
            <button onClick={() => setAltHost(h => !h)} title="If the video will not start, reload it on the other YouTube host"><RefreshCw size={12} /> Other player</button>
            <button onClick={() => open(links.youtube(playing.id))}><ExternalLink size={12} /> YouTube</button>
            <button onClick={() => setPlaying(null)} aria-label="Close"><X size={14} /></button>
          </div>
          <div className="travel-player-frame">
            <iframe
              key={`${playing.id}-${altHost}`}
              src={`https://${altHost ? 'www.youtube.com' : 'www.youtube-nocookie.com'}/embed/${playing.id}?autoplay=1&rel=0&modestbranding=1`}
              title={playing.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
        </div>
      )}

      {loading && <div className="travel-loading"><Loader2 size={16} className="travel-spin" /> Finding the best {VIDEO_TOPICS.find(t => t.id === topic)?.label.toLowerCase()} videos of {country.name}…</div>}
      {!loading && error && <div className="travel-note">{error}</div>}
      <div className="travel-videos">
        {videos.map(v => (
          <button key={v.id} className={`travel-video ${playing?.id === v.id ? 'on' : ''}`} onClick={() => { setPlaying(v); setAltHost(false) }}>
            <div className="travel-thumb">
              <img src={v.thumbnail} alt="" loading="lazy" />
              <span className="travel-dur">{v.duration}</span>
              <span className="travel-playicon"><Play size={18} fill="currentColor" /></span>
            </div>
            <b>{v.title}</b>
            <small>{v.channel}</small>
          </button>
        ))}
      </div>
    </section>
  )
}

// ── Guide ──────────────────────────────────────────────────────────────────

function AiStatus({ guide, busy, err, retry, country }: { guide: { provider: string } | null; busy: boolean; err: string | null; retry: () => void; country: Country }) {
  if (busy) return <div className="travel-loading"><Loader2 size={16} className="travel-spin" /> Your AI is writing the {country.name} guide — a local model can take a minute or two…</div>
  if (err) return <div className="travel-note travel-err">{err} <button onClick={retry}><RefreshCw size={12} /> Try again</button></div>
  if (!guide) return null
  return (
    <div className="travel-aibadge">
      <Sparkles size={12} /> Written by AI{guide.provider ? ` (${guide.provider})` : ''} from verified country facts — check prices, availability and entry rules on the linked sites before you book.
      <button onClick={retry}><RefreshCw size={11} /> Rewrite</button>
    </div>
  )
}

function GuideTab({ wiki, leaders, guide, busy, err, retry, country, open }: {
  wiki: WikiSummary | null; leaders: Leader[] | null; guide: { g: TravelGuide; provider: string } | null; busy: boolean; err: string | null; retry: () => void; country: Country; open: (u: string) => void
}) {
  const g = guide?.g
  return (
    <section className="travel-section">
      {wiki?.extract && (
        <div className="travel-card travel-wiki">
          <h3><BookOpen size={14} /> About {country.name}</h3>
          <p>{wiki.extract}</p>
          <button className="travel-link" onClick={() => open(wiki.url)}>Read more on Wikipedia <ExternalLink size={11} /></button>
        </div>
      )}
      <LeadersCard leaders={leaders} country={country} open={open} />
      <AiStatus guide={guide} busy={busy} err={err} retry={retry} country={country} />
      {g && (
        <>
          {g.overview && <div className="travel-card travel-overview"><p>{g.overview}</p></div>}
          <div className="travel-grid">
            <Section icon={<Sun size={14} />} title="Best time to go" text={g.bestTime} />
            <Section icon={<Mountain size={14} />} title="Geography & climate" text={g.geography} />
            <Section icon={<Factory size={14} />} title="Economy & resources" text={g.economy} />
            <Section icon={<Scale size={14} />} title="Politics & government" text={g.politics} />
            <Section icon={<HeartHandshake size={14} />} title="Culture & etiquette" text={g.culture} />
            <Section icon={<ShieldCheck size={14} />} title="Safety" text={g.safety} />
            <Section icon={<Stamp size={14} />} title="Visa & entry" text={g.visa} />
            <Section icon={<Wallet size={14} />} title="Money & costs" text={g.money} />
          </div>
          {g.mustSee.length > 0 && (
            <div className="travel-card">
              <h3><MapPin size={14} /> Must-see places</h3>
              <div className="travel-places">
                {g.mustSee.map((p, i) => (
                  <button key={i} className="travel-place" onClick={() => open(links.maps(`${p.name}, ${p.city || country.name}`))} title="Open in Google Maps">
                    <b>{p.name}</b><small>{p.city}</small><span>{p.why}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {g.food.length > 0 && (
            <div className="travel-card">
              <h3><Utensils size={14} /> Food to try</h3>
              <ul className="travel-food">{g.food.map((f, i) => <li key={i}>{f}</li>)}</ul>
            </div>
          )}
        </>
      )}
    </section>
  )
}

/** Who runs the country now — from Wikidata, with the Wikipedia photo and biography. */
function LeadersCard({ leaders, country, open }: { leaders: Leader[] | null; country: Country; open: (u: string) => void }) {
  if (leaders === null) return <div className="travel-loading"><Loader2 size={16} className="travel-spin" /> Looking up who leads {country.name}…</div>
  if (!leaders.length) return null
  const roleText = (l: Leader) => l.roles.length > 1 ? 'Head of state and government' : l.roles[0] === 'state' ? 'Head of state' : 'Head of government'
  return (
    <div className="travel-card">
      <h3><Landmark size={14} /> Who leads {country.name}</h3>
      <div className="travel-leaders">
        {leaders.map(l => (
          <div key={l.name} className="travel-leader">
            <div className="travel-leader-photo">{l.photo ? <img src={l.photo} alt={l.name} /> : <Users size={28} />}</div>
            <div className="travel-leader-body">
              <small>{roleText(l)}</small>
              <b>{l.name}</b>
              <span>{[l.office, l.since ? `in office since ${new Date(l.since).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })}` : ''].filter(Boolean).join(' · ')}</span>
              {l.bio && <p>{l.bio}</p>}
              {l.url && <button className="travel-link" onClick={() => open(l.url)}>Full biography on Wikipedia <ExternalLink size={11} /></button>}
            </div>
          </div>
        ))}
      </div>
      <p className="travel-source">Live from Wikidata and Wikipedia — community-maintained, so a very recent change of leader may take a few days to appear.</p>
    </div>
  )
}

function Section({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  if (!text) return null
  return (
    <div className="travel-card">
      <h3>{icon} {title}</h3>
      <p>{text}</p>
    </div>
  )
}

// ── Stay & get around ──────────────────────────────────────────────────────

const TIERS: { id: 'luxury' | 'mid' | 'budget'; label: string }[] = [
  { id: 'luxury', label: 'Luxury' }, { id: 'mid', label: 'Mid-range' }, { id: 'budget', label: 'Budget' },
]

function StayTab({ guide, busy, err, retry, country, facts, open }: {
  guide: { g: TravelGuide; provider: string } | null; busy: boolean; err: string | null; retry: () => void
  country: Country; facts: CountryFacts | null; open: (u: string) => void
}) {
  const g = guide?.g
  return (
    <section className="travel-section">
      <AiStatus guide={guide} busy={busy} err={err} retry={retry} country={country} />
      {g && (
        <>
          <div className="travel-card">
            <h3><BedDouble size={14} /> Recommended hotels</h3>
            <div className="travel-hotels">
              {TIERS.map(t => {
                const hs = g.hotels.filter(h => h.tier === t.id)
                if (!hs.length) return null
                return (
                  <div key={t.id} className="travel-tier">
                    <div className={`travel-tier-h travel-tier-${t.id}`}>{t.label}</div>
                    {hs.map((h, i) => (
                      <div key={i} className="travel-hotel">
                        <div><b>{h.name}</b><small>{h.city}</small><p>{h.why}</p></div>
                        <div className="travel-hotel-acts">
                          <button onClick={() => open(links.booking(`${h.name} ${h.city}`))}><ExternalLink size={11} /> Booking.com</button>
                          <button onClick={() => open(links.maps(`${h.name}, ${h.city || country.name}`))}><MapPin size={11} /> Map</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>

          {g.airbnbAreas.length > 0 && (
            <div className="travel-card">
              <h3><Home size={14} /> Best areas for an Airbnb</h3>
              <div className="travel-places">
                {g.airbnbAreas.map((a, i) => (
                  <button key={i} className="travel-place" onClick={() => open(links.airbnb(`${a.area}, ${a.city || country.name}`))} title="See homes on Airbnb">
                    <b>{a.area}</b><small>{a.city}</small><span>{a.why}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="travel-grid">
            <div className="travel-card">
              <h3><Car size={14} /> Car rental</h3>
              {facts?.driveSide && <p><b>Driving is on the {facts.driveSide}.</b></p>}
              {g.carRental.companies.length > 0 && (
                <div className="travel-chips">{g.carRental.companies.map(c => (
                  <button key={c} onClick={() => open(links.carRental(`${c} ${facts?.capital[0] ?? country.name}`))}>{c}</button>
                ))}</div>
              )}
              {g.carRental.tips && <p>{g.carRental.tips}</p>}
              <button className="travel-link" onClick={() => open(links.carRental(facts?.capital[0] ?? country.name))}>Compare car rental prices <ExternalLink size={11} /></button>
            </div>
            <Section icon={<Bus size={14} />} title="Getting around" text={g.gettingAround} />
          </div>
        </>
      )}
    </section>
  )
}
