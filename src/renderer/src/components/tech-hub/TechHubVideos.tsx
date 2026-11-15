import { useEffect, useState } from 'react'
import { ArrowUpRight, Play, RefreshCw, Search, X } from 'lucide-react'
type YouTubeVideo = { id: string; title: string; channel: string; duration?: string; views?: string; thumbnail?: string }

const networking = { id: 'qiQR5rTSshw', title: 'Computer Networking Course', channel: 'freeCodeCamp.org' }
const starterVideos: Record<string, YouTubeVideo[]> = {
  Cybersecurity: [{ id: 'UP2kzp14WA0', title: 'What Is Microsoft Entra ID and How Does It Work?', channel: "John Savill’s Technical Training" }, networking],
  'Cloud & infrastructure': [{ id: '7HKot-brXFE', title: 'AWS Certified Cloud Practitioner Course', channel: 'freeCodeCamp.org' }, networking],
  'Software & QA': [{ id: 'a_iQb1lnAEQ', title: 'Learn HTML & CSS', channel: 'freeCodeCamp.org' }],
  'Data & AI': [{ id: 'HXV3zeQKqGY', title: 'SQL Tutorial for Beginners', channel: 'freeCodeCamp.org' }],
  'IT support': [networking],
}

function VideoThumbnail({ video }: { video: YouTubeVideo }) {
  const base = `https://i.ytimg.com/vi/${video.id}`
  const primary = video.thumbnail?.startsWith(`${base}/`) ? video.thumbnail : `${base}/hqdefault.jpg`
  const [source, setSource] = useState(primary)
  return source ? <img src={source} alt="" loading="lazy" onError={() => {
    if (source === `${base}/mqdefault.jpg`) setSource('')
    else setSource(`${base}/mqdefault.jpg`)
  }} /> : null
}

const TOPICS = [
  { label: 'Hands-on labs', query: 'hands-on lab walkthrough' },
  { label: 'Career roadmap', query: 'career roadmap beginner' },
  { label: 'Interview prep', query: 'job interview questions practical examples' },
] as const

export default function TechHubVideos({ field, role, onOpen }: {
  field: string
  role: string
  onOpen: (url: string) => void
}) {
  const [topic, setTopic] = useState(0)
  const [filter, setFilter] = useState('')
  const [retry, setRetry] = useState(0)
  const [results, setResults] = useState<{ query: string; videos: YouTubeVideo[] }>()
  const [playing, setPlaying] = useState<YouTubeVideo>()
  const [alternate, setAlternate] = useState(false)
  const query = [role, field, TOPICS[topic].query].filter(Boolean).join(' ')
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
  const liveSearch = typeof window.electronAPI?.dj?.youtubeSearch === 'function'

  useEffect(() => {
    if (!liveSearch) return
    let current = true
    const timer = window.setTimeout(async () => {
      try {
        let result = await window.electronAPI.dj.youtubeSearch(query, 24)
        if (current && !result.videos.length && role && role !== field) {
          result = await window.electronAPI.dj.youtubeSearch(`${role} ${topic === 0 ? 'tutorial' : TOPICS[topic].query}`, 24)
        }
        if (current) setResults({
          query,
          videos: (result.videos as YouTubeVideo[]).filter(video => /^[A-Za-z0-9_-]{11}$/.test(video.id)),
        })
      } catch {
        if (current) setResults({ query, videos: [] })
      }
    }, 250)
    return () => { current = false; window.clearTimeout(timer) }
  }, [query, retry, liveSearch, role, field, topic])

  const matching = results?.query === query ? results : undefined
  const usingStarterVideos = !liveSearch || (matching !== undefined && !matching.videos.length)
  const available = usingStarterVideos ? starterVideos[field] || [] : matching?.videos || []
  const videos = available.filter(video =>
    `${video.title} ${video.channel}`.toLowerCase().includes(filter.trim().toLowerCase()),
  )
  const selected = available.some(video => video.id === playing?.id) ? playing : undefined
  function chooseTopic(index: number) {
    if (index === topic) return
    setTopic(index)
    setResults(undefined)
    setPlaying(undefined)
    setFilter('')
  }

  return <div className="th-videos">
    <p>Watch tutorials and lab walkthroughs for <strong>{role || field}</strong>.</p>
    <div className="th-chip-row" role="group" aria-label="Video topics">
      {TOPICS.map((item, index) => <button key={item.label} className="th-chip" aria-pressed={topic === index} onClick={() => chooseTopic(index)}>{item.label}</button>)}
      <button className="th-btn th-btn-ghost" onClick={() => onOpen(searchUrl)}>Search on YouTube <ArrowUpRight size={15} /></button>
    </div>
    {selected && <article className="th-video-player">
      <header>
        <div><small>Now playing</small><h3>{selected.title}</h3><p>{selected.channel}</p></div>
        <button className="th-btn th-btn-ghost" aria-label="Close player" onClick={() => setPlaying(undefined)}><X size={17} /></button>
      </header>
      <iframe key={`${selected.id}-${alternate}`}
        src={`https://${alternate ? 'www.youtube.com' : 'www.youtube-nocookie.com'}/embed/${selected.id}?autoplay=1&rel=0`}
        title={selected.title} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
      <footer className="th-actions">
        <button className="th-btn" onClick={() => setAlternate(value => !value)}>Switch player</button>
        <button className="th-btn" onClick={() => onOpen(`https://www.youtube.com/watch?v=${selected.id}`)}>Watch on YouTube <ArrowUpRight size={15} /></button>
      </footer>
    </article>}
    {liveSearch && !matching && <p role="status" className="th-note">Finding videos…</p>}
    {usingStarterVideos && <div className="th-video-status">
      <p role="status">{liveSearch ? 'Live search returned no videos. Showing starter videos for this field.' : 'Showing starter videos. Live search is available in AIHub Browser.'}</p>
      {liveSearch && <button className="th-btn" onClick={() => { setResults(undefined); setRetry(value => value + 1) }}><RefreshCw size={15} /> Retry</button>}
    </div>}
    {!!available.length && <>
      <label className="th-search"><Search size={16} aria-hidden="true" />
        <input aria-label="Filter videos by title or channel" placeholder="Filter by title or channel" value={filter} onChange={event => setFilter(event.target.value)} />
      </label>
      {!videos.length && <p role="status">No videos match your filter.</p>}
      <div className="th-video-grid">
        {videos.map(video => <button className="th-video-card" key={video.id} aria-pressed={selected?.id === video.id}
          onClick={() => {
            setPlaying(video)
            setAlternate(false)
          }}>
          <span className="th-video-thumb">
            <VideoThumbnail video={video} />
            <Play size={22} aria-hidden="true" />
            {video.duration && <small>{video.duration}</small>}
          </span>
          <span className="th-video-info"><strong>{video.title}</strong><small>{[video.channel, video.views].filter(Boolean).join(' · ')}</small></span>
        </button>)}
      </div>
    </>}
  </div>
}
