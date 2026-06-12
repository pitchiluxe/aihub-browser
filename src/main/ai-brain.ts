/**
 * AIHub Browser — AI Brain
 * Monitors browsing patterns, builds a user interest profile,
 * and generates personalized site recommendations.
 */
import os from 'os'
import fs from 'fs'
import { join } from 'path'
import axios from 'axios'

const APP_DIR = join(os.homedir(), '.aihub-browser')

interface BrowsingEntry {
  url: string
  title: string
  domain: string
  category: string
  timestamp: number
  visits: number
}

interface UserProfile {
  topDomains: string[]
  topCategories: string[]
  interests: string[]
  lastAnalyzed: number
  recommendations: Recommendation[]
  totalSessions: number
}

export interface Recommendation {
  url: string
  title: string
  reason: string
  category: string
  score: number
  favicon: string
}

const PROFILE_FILE = join(APP_DIR, 'user-profile.json')
const BRAIN_FILE = join(APP_DIR, 'browsing-brain.json')

// ── Domain → Category heuristic ───────────────────────────────────────────
const DOMAIN_CATS: Record<string, string> = {
  'youtube.com': 'Entertainment', 'netflix.com': 'Entertainment', 'twitch.tv': 'Entertainment',
  'spotify.com': 'Entertainment', 'reddit.com': 'Community', 'twitter.com': 'Social',
  'x.com': 'Social', 'instagram.com': 'Social', 'facebook.com': 'Social', 'linkedin.com': 'Professional',
  'github.com': 'Development', 'stackoverflow.com': 'Development', 'vercel.com': 'Development',
  'google.com': 'Search', 'bing.com': 'Search', 'amazon.com': 'Shopping', 'ebay.com': 'Shopping',
  'tradingview.com': 'Finance', 'binance.com': 'Finance', 'coinbase.com': 'Finance',
  'cnn.com': 'News', 'bbc.com': 'News', 'techcrunch.com': 'Technology',
  'medium.com': 'Knowledge', 'wikipedia.org': 'Knowledge', 'openai.com': 'AI',
}

function getDomain(url: string): string {
  try { return new URL(url).hostname.replace('www.', '') } catch { return '' }
}

function categorize(domain: string): string {
  for (const [key, cat] of Object.entries(DOMAIN_CATS)) {
    if (domain.includes(key)) return cat
  }
  return 'General'
}

// ── Read / Write helpers ───────────────────────────────────────────────────
function readBrain(): BrowsingEntry[] {
  try { return JSON.parse(fs.readFileSync(BRAIN_FILE, 'utf-8')) } catch { return [] }
}

function writeBrain(data: BrowsingEntry[]) {
  try {
    if (!fs.existsSync(APP_DIR)) fs.mkdirSync(APP_DIR, { recursive: true })
    fs.writeFileSync(BRAIN_FILE, JSON.stringify(data, null, 2))
  } catch {}
}

function readProfile(): UserProfile {
  try { return JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf-8')) }
  catch {
    return { topDomains: [], topCategories: [], interests: [], lastAnalyzed: 0, recommendations: [], totalSessions: 0 }
  }
}

function writeProfile(p: UserProfile) {
  try { fs.writeFileSync(PROFILE_FILE, JSON.stringify(p, null, 2)) } catch {}
}

// ── Record a page visit ───────────────────────────────────────────────────
export function recordVisit(url: string, title: string) {
  if (!url || url === 'home' || url.startsWith('aihub://') || url.startsWith('about:')) return
  const domain = getDomain(url)
  if (!domain) return
  const category = categorize(domain)
  const brain = readBrain()
  const existing = brain.find(e => e.domain === domain)
  if (existing) {
    existing.visits++
    existing.timestamp = Date.now()
    if (title && title !== existing.title) existing.title = title
  } else {
    brain.unshift({ url, title, domain, category, timestamp: Date.now(), visits: 1 })
  }
  writeBrain(brain.slice(0, 1000))
}

// ── Build interest profile from browsing brain ────────────────────────────
export function buildProfile(): UserProfile {
  const brain = readBrain()
  if (brain.length === 0) return readProfile()

  const domainCounts: Record<string, number> = {}
  const catCounts: Record<string, number> = {}
  for (const e of brain) {
    domainCounts[e.domain] = (domainCounts[e.domain] || 0) + e.visits
    catCounts[e.category] = (catCounts[e.category] || 0) + e.visits
  }

  const topDomains = Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1]).slice(0, 20).map(([d]) => d)

  const topCategories = Object.entries(catCounts)
    .sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c]) => c)

  const profile = readProfile()
  return { ...profile, topDomains, topCategories, totalSessions: profile.totalSessions + 1 }
}

// ── Generate AI-powered recommendations ──────────────────────────────────
export async function generateRecommendations(ollamaBase: string, ollamaModel: string): Promise<Recommendation[]> {
  const brain = readBrain()
  if (brain.length < 3) return getDefaultRecommendations()

  const profile = buildProfile()
  const topVisited = brain.slice(0, 15).map(e => `${e.domain} (${e.visits}x, ${e.category})`).join(', ')

  const prompt = `You are an AI browser assistant that recommends websites based on user browsing patterns.

The user frequently visits: ${topVisited}
Top categories: ${profile.topCategories.join(', ')}

Based on this browsing pattern, suggest 6 websites the user would find valuable that they may NOT have visited yet.

Respond with ONLY valid JSON array, no explanation:
[
  {"url": "https://example.com", "title": "Example", "reason": "Because you often visit...", "category": "Development"},
  ...
]`

  try {
    const res = await axios.post(`${ollamaBase}/api/chat`, {
      model: ollamaModel,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      options: { temperature: 0.7 }
    }, { timeout: 30000 })

    const content = res.data?.message?.content || ''
    const jsonMatch = content.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return getDefaultRecommendations()

    const recs: Recommendation[] = JSON.parse(jsonMatch[0])
    return recs.slice(0, 6).map(r => ({
      ...r,
      score: Math.random() * 0.3 + 0.7,
      favicon: `https://www.google.com/s2/favicons?domain=${r.url}&sz=64`,
    }))
  } catch {
    return getDefaultRecommendations()
  }
}

// ── Save recommendations to profile ──────────────────────────────────────
export function saveRecommendations(recs: Recommendation[]) {
  const profile = buildProfile()
  profile.recommendations = recs
  profile.lastAnalyzed = Date.now()
  writeProfile(profile)
}

export function getStoredRecommendations(): Recommendation[] {
  return readProfile().recommendations || []
}

// ── Default recommendations (before enough browsing data) ─────────────────
function getDefaultRecommendations(): Recommendation[] {
  return [
    { url: 'https://perplexity.ai', title: 'Perplexity AI', reason: 'AI-powered search engine', category: 'AI', score: 0.95, favicon: 'https://www.google.com/s2/favicons?domain=perplexity.ai&sz=64' },
    { url: 'https://github.com', title: 'GitHub', reason: 'World\'s largest code repository', category: 'Development', score: 0.90, favicon: 'https://www.google.com/s2/favicons?domain=github.com&sz=64' },
    { url: 'https://notion.so', title: 'Notion', reason: 'All-in-one workspace for notes', category: 'Productivity', score: 0.88, favicon: 'https://www.google.com/s2/favicons?domain=notion.so&sz=64' },
    { url: 'https://figma.com', title: 'Figma', reason: 'Collaborative design tool', category: 'Design', score: 0.85, favicon: 'https://www.google.com/s2/favicons?domain=figma.com&sz=64' },
    { url: 'https://openai.com', title: 'OpenAI', reason: 'Leading AI research lab', category: 'AI', score: 0.84, favicon: 'https://www.google.com/s2/favicons?domain=openai.com&sz=64' },
    { url: 'https://vercel.com', title: 'Vercel', reason: 'Deploy web apps instantly', category: 'Development', score: 0.82, favicon: 'https://www.google.com/s2/favicons?domain=vercel.com&sz=64' },
  ]
}
