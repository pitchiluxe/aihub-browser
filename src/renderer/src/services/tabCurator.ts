// tabCurator.ts — AI-powered tab grouping
import { Tab } from '../store/browserStore'

export interface TabCluster {
  name: string
  color: string
  tabIds: string[]
  reason: string
}

const GROUP_COLORS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#f97316', // orange
  '#14b8a6', // teal
  '#22c55e', // green
  '#3b82f6', // blue
  '#eab308', // yellow
]

/**
 * Ask the AI to group open tabs into meaningful clusters.
 * Returns an array of TabCluster objects ready for the store's groupTabs().
 *
 * Falls back to a simple keyword heuristic when the AI call fails —
 * the UI never shows an error, it just works.
 */
export async function curateTabs(tabs: Tab[]): Promise<TabCluster[]> {
  const browserTabs = tabs.filter(t => t.pageType === 'browser')
  if (browserTabs.length < 2) return []

  // Shortcut for few tabs — don't bother the AI for obvious groupings
  if (browserTabs.length <= 3) return keywordCurator(browserTabs)

  const tabList = browserTabs
    .map((t, i) => `${i + 1}. "${t.title}" — ${t.url}`)
    .join('\n')

  const systemPrompt = `You are a tab curator. Analyze a list of browser tabs and group them by topic.
Return a JSON array (no markdown, no explanation, just the array) where each item is:
{
  "name": "Short group name (3-6 words)",
  "tabIds": ["list of tab IDs in this group"],
  "reason": "One sentence explaining why these tabs belong together"
}
Use the tab IDs exactly as provided. Make 1-6 groups depending on actual topics.
Return ONLY valid JSON wrapped in triple-backtick json fences.`

  try {
    const api = (window as any).electronAPI?.ai
    if (!api?.chat) return keywordCurator(browserTabs)

    const response = await api.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Tabs:\n${tabList}` },
      ],
      undefined,
      { preferCloud: true }
    )

    const raw = typeof response === 'string' ? response : JSON.stringify(response)
    const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/) ||
      raw.match(/\[\s*\{[\s\S]*\}\s*\]/)
    if (!jsonMatch) return keywordCurator(browserTabs)

    const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0])
    if (!Array.isArray(parsed)) return keywordCurator(browserTabs)

    return parsed.map((cluster: any, i: number) => ({
      name: String(cluster.name || `Group ${i + 1}`).slice(0, 30),
      tabIds: Array.isArray(cluster.tabIds)
        ? cluster.tabIds.filter((id: string) => browserTabs.some(t => t.id === id))
        : [],
      reason: String(cluster.reason || '').slice(0, 120),
      color: GROUP_COLORS[i % GROUP_COLORS.length],
    })).filter((c: TabCluster) => c.tabIds.length >= 1)
  } catch {
    return keywordCurator(browserTabs)
  }
}

/**
 * Keyword-based fallback when AI is unavailable.
 * Groups tabs by domain + title keywords.
 */
function keywordCurator(tabs: Tab[]): TabCluster[] {
  const groups = new Map<string, { name: string; tabIds: string[] }>()

  for (const tab of tabs) {
    const url = tab.url || ''

    // Extract a meaningful keyword from domain
    const domainMatch = url.match(/https?:\/\/(?:www\.)?([^/]+)/)
    const domain = domainMatch?.[1] || ''

    // Group by domain first
    const key = domain || 'other'
    if (!groups.has(key)) {
      groups.set(key, {
        name: domain
          ? domain.replace(/^(www\.|m\.)/, '').split('.')[0].replace(/[-_]/g, ' ')
          : 'Miscellaneous',
        tabIds: [],
      })
    }
    groups.get(key)!.tabIds.push(tab.id)
  }

  return Array.from(groups.entries()).map(([key, g], i) => ({
    name: g.name.charAt(0).toUpperCase() + g.name.slice(1),
    tabIds: g.tabIds,
    reason: `${g.tabIds.length} tab${g.tabIds.length > 1 ? 's' : ''} from ${key}`,
    color: GROUP_COLORS[i % GROUP_COLORS.length],
  }))
}
