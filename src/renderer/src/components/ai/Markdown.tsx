import React, { Suspense, lazy, useMemo } from 'react'
import TradePlanCard from './TradePlanCard'
import { extractTradePlans, mergeBracket } from '../../services/tradePlanBlocks'

// The markdown stack (react-markdown + remark-gfm and their micromark/mdast
// dependency tree) is ~350 KB of source — the second-largest thing in the
// renderer after framer-motion, and none of it is needed to open the browser.
// It only matters once an AI message is on screen, so it loads on first use.
//
// While the chunk arrives (a local disk read, typically a frame or two) the
// text renders as plain pre-wrapped content rather than a spinner: the words
// are readable immediately and simply gain formatting a moment later, which
// matters for streaming answers where the text is already arriving.
const MarkdownRenderer = lazy(() => import('./MarkdownRenderer'))

interface Props {
  content: string
  onNavigate: (url: string) => void
}

export default function Markdown({ content, onNavigate }: Props) {
  // Trade plans are pulled out BEFORE markdown runs. The model does not
  // reliably use the fenced form the prompt asks for — a local model emitted
  // "[trade-plan] { … }", which markdown rendered as a wall of raw JSON in the
  // middle of the answer. Extracting first means any wrapper renders as a
  // card, and a long/short pair becomes one bracket the user can compare.
  const { text, plans } = useMemo(() => {
    const extracted = extractTradePlans(content)
    return { text: extracted.text, plans: mergeBracket(extracted.plans) }
  }, [content])

  return (
    <>
      {!!text && (
        <Suspense
          fallback={
            <div className="aihub-md" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {text}
            </div>
          }
        >
          <MarkdownRenderer content={text} onNavigate={onNavigate} />
        </Suspense>
      )}
      {plans.map((plan, i) => <TradePlanCard key={i} plan={plan as any} />)}
    </>
  )
}
