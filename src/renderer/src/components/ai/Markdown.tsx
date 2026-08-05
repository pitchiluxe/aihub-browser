import React, { Suspense, lazy } from 'react'

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
  return (
    <Suspense
      fallback={
        <div className="aihub-md" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {content}
        </div>
      }
    >
      <MarkdownRenderer content={content} onNavigate={onNavigate} />
    </Suspense>
  )
}
