/**
 * AI Prompts for web-to-markdown conversion and entity extraction.
 *
 * These prompts are used by the `ai:convertToMarkdown` IPC handler to convert
 * raw web page content into structured Markdown with automatic tag/entity detection
 * and a compact research brief for the Obsidian node detail view.
 */

// ── System prompt for Markdown conversion ────────────────────────────────────

/** System prompt: instructs the model on how to convert web content to Markdown. */
export const MARKDOWN_CONVERSION_SYSTEM = `You are an expert at converting web page content into clean, well-structured Markdown files for a personal knowledge base.

Your task:
1. Take the raw extracted text from a web page (which may include navigation, ads, footers, etc.)
2. Identify and extract the MAIN CONTENT of the page
3. Convert it to clean Markdown with proper structure (headings, paragraphs, lists, code blocks, links)
4. Strip away all noise: navigation menus, sidebars, cookie banners, ads, footers, social widgets, comments
5. Preserve the semantic structure: use H1 for the main title, H2/H3 for sections, etc.
6. Keep all meaningful links as [text](url) format
7. Output should be a complete Markdown document with YAML frontmatter
8. Preserve useful context that helps the reader understand the page at a glance

Output format (STRICT - no extra commentary):
---
title: "Page Title"
url: "https://example.com"
category: "AI"
tags: ["tag1", "tag2", "tag3"]
summary: "A concise two-sentence description of the page."
key_takeaways:
  - "First useful takeaway"
  - "Second useful takeaway"
created: "2026-10-02T14:30:00Z"
---

# Page Title

[https://example.com](https://example.com)

## At a glance

**Summary:** A concise two-sentence description of the page.

### Key takeaways

- First useful takeaway
- Second useful takeaway

## Section 1

Main content paragraph...

## Section 2

- Key point 1
- Key point 2

...etc.

Rules for category (pick ONE that best fits):
- Development: coding, APIs, frameworks, DevOps, GitHub, documentation
- Finance: banking, investing, stocks, crypto, trading, markets
- AI: machine learning, LLMs, AI research, AI tools, models
- Trading: technical analysis, charts, strategies, TradingView, markets
- Education: tutorials, courses, learning, academic, how-to
- Business: startups, management, strategy, SaaS, products
- Personal: blogs, personal sites, portfolios, diaries
- News: journalism, news outlets, current events
- Tools: utilities, productivity apps, software tools
- Science: research, papers, physics, biology, chemistry
- Entertainment: movies, TV, games, streaming
- Sports: sports news, teams, athletes
- Music: music, bands, audio, streaming
- Art: design, visual arts, galleries, creative
- Travel: travel guides, destinations, booking
- Health: medical, fitness, wellness, mental health
- Shopping: e-commerce, products, reviews
- Social: social media, communities, forums
- Gaming: video games, esports, gaming news
- Design: UI/UX, graphic design, Figma, creative tools
- Productivity: note-taking, task management, organization

Tags should be:
- Lowercase, hyphen-separated (e.g., "machine-learning", "react-hooks", "trading-strategy")
- 3-8 tags maximum
- Specific to the content (not generic like "web" or "article")
- Include key entities: technologies, companies, people, products, concepts
- Include a concise summary and 3-5 specific takeaways in the frontmatter and "At a glance" section
- Identify the author and publication date only when the page explicitly provides them; do not guess

IMPORTANT:
- If the page has no clear main content (empty, login page, 404, etc.), return an error message starting with "ERROR: "
- The category value MUST be exactly one category name from the list above. Never combine categories or use separators.
- The frontmatter must be valid YAML
- Do NOT include any explanatory text outside the Markdown output`;

// ── User prompt template ────────────────────────────────────────────────────

/** Build the user prompt with page content and URL. */
export function buildMarkdownPrompt(pageText: string, url: string): string {
  return `Convert the following web page content to clean Markdown.

URL: ${url}

PAGE CONTENT (first 12000 chars):
${pageText.slice(0, 12000)}

Output ONLY the Markdown with frontmatter as specified in the system prompt.`
}

// ── Entity/relationship extraction prompt ────────────────────────────────────

/** System prompt for extracting key entities and relationships from page content. */
export const ENTITY_EXTRACTION_SYSTEM = `You are an entity extraction system. Analyze the provided text and identify:

1. A concise summary (1-2 sentences)
2. Three to five specific key takeaways
3. Author and publication date, only if explicitly stated
4. Key entities (people, organizations, products, technologies, dates, locations)
5. Key concepts/topics
6. Important links/references to other pages or resources

Output a JSON object with this exact structure:
{
  "summary": "One or two concise sentences",
  "keyTakeaways": ["takeaway one", "takeaway two"],
  "author": "Author name or empty string",
  "publishedDate": "Explicit date or empty string",
  "pageType": "Article, documentation, tutorial, product page, discussion, or other concise type",
  "entities": ["entity1", "entity2", ...],
  "concepts": ["concept1", "concept2", ...],
  "links": [
    {"text": "link text", "url": "https://..."},
    ...
  ]
}

Rules:
- Entities: proper nouns that are specific (e.g., "React", "OpenAI", "Elon Musk", "Bitcoin", "PostgreSQL")
- Concepts: general topics/themes (e.g., "machine learning", "REST API", "technical analysis", "decentralized finance")
- Links: only include actual URLs found in the text that point to other resources
- Never infer an author or publication date that is not explicitly present
- Keep each takeaway factual, concise, and grounded in the provided page
- Use empty strings and empty arrays when the page does not provide reliable information
- Max 15 entities, 10 concepts, 10 links
- Output ONLY valid JSON, no extra text`;

/** Build the entity extraction prompt. */
export function buildEntityExtractionPrompt(pageText: string, url: string): string {
  return `Extract key entities, concepts, and links from this web page content.

URL: ${url}

CONTENT (first 8000 chars):
${pageText.slice(0, 8000)}

Output JSON only as specified.`
}

// ── Category auto-detection heuristic (fallback when AI fails) ──────────────

const DOMAIN_CATS: Record<string, string> = {
  'github.com': 'Development', 'gitlab.com': 'Development', 'stackoverflow.com': 'Development',
  'npmjs.com': 'Development', 'pypi.org': 'Development', 'crates.io': 'Development',
  'vercel.com': 'Development', 'netlify.com': 'Development', 'render.com': 'Development',
  'docker.com': 'Development', 'kubernetes.io': 'Development', 'cloudflare.com': 'Development',
  'aws.amazon.com': 'Development', 'cloud.google.com': 'Development', 'azure.microsoft.com': 'Development',
  'tradingview.com': 'Trading', 'binance.com': 'Finance', 'coinbase.com': 'Finance',
  'coinmarketcap.com': 'Finance', 'coingecko.com': 'Finance', 'kraken.com': 'Finance',
  'bybit.com': 'Trading', 'okx.com': 'Trading', 'deribit.com': 'Trading',
  'openai.com': 'AI', 'anthropic.com': 'AI', 'huggingface.co': 'AI', 'ollama.com': 'AI',
  'perplexity.ai': 'AI', 'cursor.sh': 'Development', 'vscode.dev': 'Development',
  'notion.so': 'Productivity', 'obsidian.md': 'Productivity', 'linear.app': 'Productivity',
  'figma.com': 'Design', 'miro.com': 'Design', 'canva.com': 'Design',
  'youtube.com': 'Entertainment', 'netflix.com': 'Entertainment', 'twitch.tv': 'Entertainment',
  'spotify.com': 'Music', 'soundcloud.com': 'Music', 'bandcamp.com': 'Music',
  'twitter.com': 'Social', 'x.com': 'Social', 'linkedin.com': 'Social', 'reddit.com': 'Social',
  'discord.com': 'Social', 'slack.com': 'Productivity', 'medium.com': 'Education',
  'wikipedia.org': 'Education', 'arxiv.org': 'Education', 'coursera.org': 'Education',
  'udemy.com': 'Education', 'freecodecamp.org': 'Education', 'khanacademy.org': 'Education',
  'news.ycombinator.com': 'News', 'techcrunch.com': 'News', 'theverge.com': 'News',
  'wired.com': 'News', 'arstechnica.com': 'News',
  'amazon.com': 'Shopping', 'ebay.com': 'Shopping', 'etsy.com': 'Shopping',
  'airbnb.com': 'Travel', 'booking.com': 'Travel', 'expedia.com': 'Travel',
}

/** Auto-detect category from URL domain (fallback). */
export function detectCategoryFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace('www.', '')
    for (const [domain, cat] of Object.entries(DOMAIN_CATS)) {
      if (host.includes(domain)) return cat
    }
  } catch {}
  return 'General'
}

/** Heuristic category from content (simple keyword matching). */
export function detectCategoryFromContent(text: string): string {
  const lower = text.toLowerCase()
  const scores: Record<string, number> = {}

  const keywords: Record<string, string[]> = {
    Development: ['code', 'programming', 'developer', 'api', 'github', 'git', 'npm', 'python', 'javascript', 'typescript', 'react', 'vue', 'node', 'docker', 'kubernetes', 'devops', 'ci/cd', 'framework', 'library', 'function', 'class', 'debug', 'compile', 'runtime', 'database', 'sql', 'nosql', 'redis', 'postgres', 'mongodb'],
    Finance: ['stock', 'market', 'invest', 'portfolio', 'trading', 'finance', 'bank', 'etf', 'fund', 'bond', 'yield', 'dividend', 'earnings', 'revenue', 'profit', 'loss', 'bull', 'bear', 'volatility', 'option', 'future', 'forex', 'crypto', 'bitcoin', 'ethereum', 'blockchain', 'defi', 'wallet', 'exchange'],
    AI: ['ai', 'artificial intelligence', 'machine learning', 'deep learning', 'neural network', 'llm', 'large language model', 'gpt', 'claude', 'gemini', 'llama', 'transformer', 'attention', 'embedding', 'vector', 'rag', 'fine-tuning', 'inference', 'training', 'dataset', 'model', 'agent', 'prompt', 'completion', 'token', 'context window'],
    Trading: ['trading', 'chart', 'technical analysis', 'candlestick', 'indicator', 'moving average', 'rsi', 'macd', 'bollinger', 'support', 'resistance', 'trend', 'breakout', 'volume', 'price action', 'fibonacci', 'elliott wave', 'gold', 'silver', 'crude oil', 'futures', 'options', 'derivatives', 'leverage', 'margin', 'position', 'entry', 'exit', 'stop loss', 'take profit'],
    Education: ['tutorial', 'course', 'learn', 'lesson', 'guide', 'how to', 'step by step', 'beginner', 'introduction', 'fundamentals', 'basics', 'advanced', 'masterclass', 'workshop', 'certification', 'academy', 'university', 'college', 'study', 'exam', 'quiz', 'assignment', 'project'],
    Business: ['startup', 'business', 'company', 'enterprise', 'saas', 'product', 'market', 'customer', 'revenue', 'growth', 'strategy', 'management', 'leadership', 'team', 'hiring', 'funding', 'investor', 'vc', 'venture', 'series a', 'ipo', 'acquisition', 'merger', 'competitor', 'market share'],
    Productivity: ['productivity', 'todo', 'task', 'note', 'organization', 'workflow', 'automation', 'efficiency', 'time management', 'focus', 'planning', 'scheduling', 'calendar', 'reminder', 'habit', 'routine', 'system', 'method', 'gtd', 'pomodoro', 'deep work'],
  }

  for (const [cat, words] of Object.entries(keywords)) {
    let score = 0
    for (const word of words) {
      const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'gi')
      const matches = lower.match(regex)
      if (matches) score += matches.length
    }
    scores[cat] = score
  }

  const top = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]
  return top && top[1] > 0 ? top[0] : 'General'
}