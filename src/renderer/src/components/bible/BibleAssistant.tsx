import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Sparkles, X, Send, Loader2, BookOpen } from 'lucide-react'
import { buildIndex, isReady, search, context, expandQuery, type Hit } from '../../services/bibleSearch'
import { parseRef, formatRef, refKey } from '../../services/bibleService'
import { parseTypedRef } from './VerseSearch'

interface Msg { role: 'user' | 'assistant'; content: string; cites?: Hit[] }

interface Props {
  open: boolean
  onClose: () => void
  // Where the reader currently is, so "explain this" and "this chapter" mean something.
  bookId: string
  bookName: string
  chapter: number
  selectedRef: string | null
  onOpenRef: (ref: string) => void
}

const SUGGESTIONS = [
  'Find verses about money',
  'What does the Bible say about forgiveness?',
  'Explain this chapter to me',
  'Give me a verse for when I feel afraid',
]

// The assistant is grounded, not recalled. Every answer is written against
// verses retrieved from the bundled text and handed to the model in the
// prompt; it is told plainly that it may not quote anything else. That is what
// stops a Bible app from inventing scripture, which is the one failure mode
// that would make it worthless.
const SYSTEM = [
  'You are a warm, plain-spoken pastor and Bible teacher inside a Bible reader app.',
  'You are talking with someone who is reading scripture right now.',
  '',
  'RULES — these are absolute:',
  '1. Quote ONLY from the passages provided to you under "PASSAGES". Never quote or',
  '   paraphrase any other verse from memory, and never invent a reference.',
  '2. Cite every verse you use as a bare reference in square brackets, e.g. [John 3:16].',
  '   Use the exact book, chapter and verse from the passages given.',
  '3. If the passages provided do not answer the question, say so honestly and',
  '   suggest what the reader might search for instead. Do not fill the gap by guessing.',
  '3b. The passages are search results, not a reading list. CHOOSE the few that actually',
  '   teach on the question and build your answer around them. Prefer teaching, wisdom and',
  '   promise passages over places where the word merely appears in a narrative, a genealogy',
  '   or a ledger. Ignore the rest — do not list everything you were given.',
  '4. The translation is the World English Bible (WEB). Do not claim it is any other.',
  '5. On contested doctrinal questions, say plainly that faithful Christians differ,',
  '   give the main views fairly, and point to the text rather than ruling.',
  '6. You are not a substitute for a real pastor, counsellor or doctor. If someone is',
  '   in crisis or describes self-harm, say so kindly and urge them to reach a person',
  '   they trust or a local crisis line.',
  '',
  'Style: speak like a person, not a commentary. Short paragraphs. Warm, direct, never',
  'preachy about being preachy. Lead with the answer, then the scripture that carries it.',
].join('\n')

export default function BibleAssistant({
  open, onClose, bookId, bookName, chapter, selectedRef, onOpenRef,
}: Props) {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [indexing, setIndexing] = useState(false)
  const [progress, setProgress] = useState(0)
  const scroller = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Build the verse index the first time the panel opens, not at app start —
  // it costs a few seconds and most sessions never ask a question.
  useEffect(() => {
    if (!open || isReady()) return
    setIndexing(true)
    buildIndex((done, total) => setProgress(Math.round((done / total) * 100)))
      .finally(() => setIndexing(false))
  }, [open])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 60)
  }, [open])

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [msgs, busy])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const ask = useCallback(async (question: string) => {
    const q = question.trim()
    if (!q || busy) return
    setInput('')
    setMsgs(m => [...m, { role: 'user', content: q }])

    // "open John 3:16", "go to Psalm 23", "take me to Romans 8" — a navigation
    // request, not a question. Resolve it here and turn the page immediately
    // rather than paying a model round trip to be told what we already parsed.
    const nav = q.match(/\b(?:open|go\s+to|goto|take\s+me\s+to|show\s+me|turn\s+to|jump\s+to|read)\b\s+(.+)$/i)
    if (nav) {
      const parsed = parseTypedRef(nav[1])
      if (parsed) {
        const ref = refKey(parsed.bookId, parsed.chapter, parsed.verse ?? 1)
        onOpenRef(ref)
        setMsgs(m => [...m, { role: 'assistant', content: `Opened ${formatRef(ref)}.` }])
        return
      }
    }

    setBusy(true)

    try {
      if (!isReady()) await buildIndex()

      // Retrieval. Three sources, in priority order: the verse the reader has
      // selected (with its surrounding passage), the chapter they are on when
      // they ask about "this", and a BM25 search over the whole Bible.
      let hits: Hit[] = []
      const wantsHere = /\bthis (verse|chapter|passage|page)\b|\bhere\b/i.test(q)

      if (selectedRef) {
        const p = parseRef(selectedRef)
        if (p) hits = hits.concat(context(p.bookId, p.chapter, p.verse, 4))
      }
      if (wantsHere && !selectedRef) {
        hits = hits.concat(context(bookId, chapter, 1, 40).slice(0, 25))
      }
      // Widen the query into scripture's own vocabulary before searching, or a
      // question about "money" only ever finds ledgers, never the teaching.
      hits = hits.concat(search(expandQuery(q), 18))

      // De-dupe, keep order (context first, then relevance).
      const seen = new Set<string>()
      const passages = hits.filter(h => !seen.has(h.ref) && seen.add(h.ref)).slice(0, 28)

      const passageBlock = passages.length
        ? passages.map(h => `[${h.book} ${h.chapter}:${h.verse}] ${h.text}`).join('\n')
        : '(no matching passages were found in the text)'

      const where = selectedRef
        ? `The reader has ${formatRef(selectedRef)} selected.`
        : `The reader is on ${bookName} ${chapter}.`

      const messages = [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `${where}\n\nPASSAGES (the only scripture you may quote):\n${passageBlock}\n\nQUESTION: ${q}`,
        },
      ]

      const res = await window.electronAPI.ai.chat(messages)
      const content = (res?.content || '').trim()
      if (!content) {
        setMsgs(m => [...m, {
          role: 'assistant',
          content: res?.error
            ? `I couldn't reach the AI: ${res.error}\n\nCheck Settings — you need either Ollama running locally or an OpenRouter key.`
            : "I couldn't get an answer just then. Try asking again.",
        }])
      } else {
        setMsgs(m => [...m, { role: 'assistant', content, cites: passages }])
      }
    } catch (e: any) {
      setMsgs(m => [...m, { role: 'assistant', content: `Something went wrong: ${e?.message || e}` }])
    } finally {
      setBusy(false)
    }
  }, [busy, selectedRef, bookId, bookName, chapter, onOpenRef])

  // Turn [John 3:16] citations into buttons that actually open the passage.
  const render = (text: string, cites?: Hit[]) => {
    const parts = text.split(/(\[[^\]\n]{2,40}?\])/g)
    return parts.map((part, i) => {
      const m = part.match(/^\[([^\]]+)\]$/)
      if (!m) return <span key={i}>{part}</span>
      const label = m[1]
      const hit = cites?.find(h => `${h.book} ${h.chapter}:${h.verse}`.toLowerCase() === label.toLowerCase())
      if (!hit) return <span key={i}>{part}</span>
      return (
        <button
          key={i}
          onClick={() => onOpenRef(hit.ref)}
          title={hit.text}
          className="mx-0.5 rounded px-1.5 py-0.5 text-[0.92em] font-medium"
          style={{ background: 'rgb(var(--ds-accent) / 0.16)', color: 'rgb(var(--ds-accent-soft))' }}
        >
          {label}
        </button>
      )
    })
  }

  if (!open) return null

  return (
    <div className="flex h-full w-[380px] shrink-0 flex-col border-l"
      style={{ borderColor: 'var(--ds-border-sm)', background: 'var(--ds-page-bg)' }}>

      <div className="flex shrink-0 items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--ds-border-sm)' }}>
        <Sparkles size={15} style={{ color: 'rgb(var(--ds-accent-soft))' }} />
        <div className="flex-1">
          <div className="text-sm font-semibold">Study with AI</div>
          <div className="text-[11px] opacity-55">Answers grounded in the text you're reading</div>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 opacity-60 hover:opacity-100" title="Close (Esc)">
          <X size={15} />
        </button>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {indexing && (
          <div className="mb-4 flex items-center gap-2 rounded-xl px-3 py-2 text-xs"
            style={{ background: 'rgb(var(--ds-accent) / 0.10)' }}>
            <Loader2 size={13} className="animate-spin" />
            Reading the whole Bible so I can search it… {progress}%
          </div>
        )}

        {msgs.length === 0 && !indexing && (
          <div className="mt-2">
            <p className="mb-3 text-xs leading-relaxed opacity-60">
              Ask about what you're reading, or search the whole Bible by meaning.
              Every answer quotes verses found in the text — nothing is recalled from memory.
            </p>
            <div className="flex flex-col gap-1.5">
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => ask(s)}
                  className="rounded-xl px-3 py-2 text-left text-xs transition-colors"
                  style={{ background: 'rgb(var(--ds-accent) / 0.08)' }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {msgs.map((m, i) => (
          <div key={i} className={`mb-4 ${m.role === 'user' ? 'text-right' : ''}`}>
            <div
              className={`inline-block max-w-full rounded-2xl px-3.5 py-2.5 text-left text-[13px] leading-relaxed whitespace-pre-wrap ${m.role === 'user' ? 'font-medium' : ''}`}
              style={m.role === 'user'
                ? { background: 'rgb(var(--ds-accent) / 0.16)' }
                : { background: 'var(--ds-surface, rgba(127,127,127,0.10))' }}
            >
              {m.role === 'assistant' ? render(m.content, m.cites) : m.content}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-2 text-xs opacity-60">
            <Loader2 size={13} className="animate-spin" /> Searching the scriptures…
          </div>
        )}
      </div>

      <div className="shrink-0 p-3" style={{ borderTop: '1px solid var(--ds-border-sm)' }}>
        {selectedRef && (
          <button
            onClick={() => ask(`Explain ${formatRef(selectedRef)} to me — what does it mean and how do I live it?`)}
            disabled={busy}
            className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium disabled:opacity-40"
            style={{ background: 'rgb(var(--ds-accent) / 0.14)', color: 'rgb(var(--ds-accent-soft))' }}
          >
            <BookOpen size={13} /> Explain {formatRef(selectedRef)}
          </button>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input) }
            }}
            rows={2}
            placeholder="Ask anything about the Bible…"
            className="min-h-0 flex-1 resize-none rounded-xl px-3 py-2 text-[13px] outline-none"
            style={{ background: 'rgb(127 127 127 / 0.10)', border: '1px solid var(--ds-border-sm)' }}
          />
          <button
            onClick={() => ask(input)}
            disabled={busy || !input.trim()}
            className="rounded-xl p-2.5 disabled:opacity-35"
            style={{ background: 'rgb(var(--ds-accent) / 0.9)', color: '#fff' }}
            title="Ask (Enter)"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          </button>
        </div>
      </div>
    </div>
  )
}
