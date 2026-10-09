import React, { useEffect, useMemo, useRef, useState } from 'react'
import Markdown from './Markdown'
import { cleanNarration } from '../../services/agentTools'

// A reply that is still arriving, rendered as markdown rather than raw text.
// Showing the raw stream meant every table appeared as a block of pipes and
// dashes and only snapped into a table when the last token landed.
//
// Two things keep this cheap and steady: the text is re-parsed at most every
// THROTTLE_MS rather than per token, and normalizeAiMarkdown (streaming mode)
// closes an unfinished code fence so the rest of the reply doesn't flash into
// a code block while it waits for the closing ```.

const THROTTLE_MS = 120

function useThrottled<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value)
  const last = useRef(0)
  useEffect(() => {
    const wait = last.current + ms - Date.now()
    if (wait <= 0) {
      last.current = Date.now()
      setShown(value)
      return
    }
    const t = setTimeout(() => { last.current = Date.now(); setShown(value) }, wait)
    return () => clearTimeout(t)
  }, [value, ms])
  return shown
}

interface Props {
  text: string
  onNavigate: (url: string) => void
  accent?: string
}

export default function StreamingMarkdown({ text, onNavigate, accent }: Props) {
  const shown = useThrottled(text, THROTTLE_MS)
  // Protocol (think tags, half-written tool calls) is stripped here too —
  // the finished bubble does it, and the live one must not show it either.
  const clean = useMemo(() => cleanNarration(shown), [shown])
  return <Markdown content={clean} onNavigate={onNavigate} accent={accent} streaming />
}
