// parallelIntel.ts — Background AI summarization for any loaded page
//
// The user shouldn't have to ask "summarize this page" — the AI should
// already have a 3-bullet summary waiting the moment a tab finishes loading.
// That summary is cached per tab and surfaced through the BottomSummaryCard.

import { buildPageExtractionScript } from './pageExtractor'
import { useBrowserStore } from '../store/browserStore'

export interface PageInsight {
  tabId: string
  url: string
  title: string
  bullets: string[]   // 3 bullet points max
  pageType: 'article' | 'product' | 'video' | 'documentation' | 'other'
  fetchedAt: number
}

const insights = new Map<string, PageInsight>()

const inflight = new Map<string, Promise<PageInsight | null>>()

export function getInsight(tabId: string): PageInsight | undefined {
  return insights.get(tabId)
}

export function clearInsight(tabId: string) {
  insights.delete(tabId)
  inflight.delete(tabId)
}

export function listInsights(): PageInsight[] {
  return Array.from(insights.values())
}

const SUMMARY_PROMPT = `You are a page summarizer. Read the page text and produce:
1) pageType: one of [article, product, video, documentation, other]
2) bullets: EXACTLY 3 short bullet points (max 18 words each) covering the most important facts

Return ONLY valid JSON wrapped in triple-backtick json fences:
{
  "pageType": "article|product|video|documentation|other",
  "bullets": ["...", "...", "..."]
}

Be terse. No introductory phrases like "This page..." — start with the subject.`

/**
 * Background-summarize a page. Safe to call repeatedly — duplicate calls for
 * the same tab return the in-flight promise instead of starting a new one.
 */
export async function analyzeTab(
  tabId: string,
  url: string,
  title: string,
  opts?: { force?: boolean },
): Promise<PageInsight | null> {
  if (!url || url === 'home') return null
  if (!opts?.force && insights.has(tabId)) return insights.get(tabId)!
  if (inflight.has(tabId)) return inflight.get(tabId)!

  const promise = (async (): Promise<PageInsight | null> => {
    const wcId = useBrowserStore.getState().tabWcIds[tabId]
    let text: string | null = null

    // Try to get page text via the page extraction script
    if (wcId) {
      try {
        const result = await window.electronAPI.webview.execScript(wcId, buildPageExtractionScript())
        if (result && (result as any).result) {
          const raw = (result as any).result
          text = typeof raw === 'string' ? raw.slice(0, 4000) : null
        }
      } catch {
        text = null
      }
    }

    if (!text || text.length < 80) {
      // Fall back to title+url only
      text = `Title: ${title}\nURL: ${url}`
    }

    try {
      const api = (window as any).electronAPI?.ai
      if (!api?.chat) return fallbackInsight(tabId, url, title)

      const response = await api.chat(
        [
          { role: 'system', content: SUMMARY_PROMPT },
          { role: 'user', content: text.slice(0, 3500) },
        ],
        undefined,
        { preferCloud: false },  // local-first — fast, free
      )

      const raw = typeof response === 'string' ? response : JSON.stringify(response)
      const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/) ||
        raw.match(/\{[\s\S]*"bullets"[\s\S]*\}/)
      if (!jsonMatch) return fallbackInsight(tabId, url, title)

      const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0])
      const insight: PageInsight = {
        tabId,
        url,
        title,
        bullets: Array.isArray(parsed.bullets) ? parsed.bullets.slice(0, 3).map((s: any) => String(s).trim()) : [],
        pageType: ['article', 'product', 'video', 'documentation'].includes(parsed.pageType) ? parsed.pageType : 'other',
        fetchedAt: Date.now(),
      }

      if (!insight.bullets.length) return fallbackInsight(tabId, url, title)

      insights.set(tabId, insight)
      return insight
    } catch {
      return fallbackInsight(tabId, url, title)
    }
  })()

  inflight.set(tabId, promise)
  try {
    return await promise
  } finally {
    inflight.delete(tabId)
  }
}

function fallbackInsight(tabId: string, url: string, title: string): PageInsight {
  // Heuristic: if the title is short enough, just use it as the first bullet
  const insight: PageInsight = {
    tabId,
    url,
    title,
    bullets: title ? [title, `From: ${new URL(url).hostname || 'unknown source'}`] : ['No summary available yet'],
    pageType: 'other',
    fetchedAt: Date.now(),
  }
  insights.set(tabId, insight)
  return insight
}
