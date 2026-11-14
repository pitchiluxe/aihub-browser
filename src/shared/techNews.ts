import { DESK_FEEDS, type FeedSource } from './news'

export const TECH_NEWS_FEEDS = {
  technology: DESK_FEEDS.tech,
  cybersecurity: [{ name: 'BleepingComputer', url: 'https://www.bleepingcomputer.com/feed/' }],
  ai: [{ name: 'OpenAI', url: 'https://openai.com/news/rss.xml' }],
  development: [{ name: 'GitHub Blog', url: 'https://github.blog/feed/' }],
  cloud: [{ name: 'Kubernetes Blog', url: 'https://kubernetes.io/feed.xml' }],
} satisfies Record<string, FeedSource[]>

export const TECH_NEWS_TOPICS = [
  { id: 'all', label: 'All topics' },
  { id: 'technology', label: 'Technology' },
  { id: 'cybersecurity', label: 'Cybersecurity' },
  { id: 'ai', label: 'AI' },
  { id: 'development', label: 'Software' },
  { id: 'cloud', label: 'Cloud & DevOps' },
] as const

export type TechNewsTopic = typeof TECH_NEWS_TOPICS[number]['id']
