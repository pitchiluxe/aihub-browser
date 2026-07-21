import React, { useEffect, useState } from 'react'
import { getBooks, getChapter, type Verse } from '../../services/bibleService'

export default function BiblePage() {
  const [bookId, setBookId] = useState('JHN')
  const [chapter, setChapter] = useState(3)
  const [verses, setVerses] = useState<Verse[]>([])

  useEffect(() => {
    let cancelled = false
    getChapter(bookId, chapter).then(v => { if (!cancelled) setVerses(v) })
    return () => { cancelled = true }
  }, [bookId, chapter])

  const book = getBooks().find(b => b.id === bookId)

  return (
    <div className="h-full overflow-y-auto bg-aihub-bg text-aihub-text p-8">
      <h1 className="text-2xl font-bold mb-4">{book?.name} {chapter}</h1>
      <div className="flex gap-2 mb-4">
        <select value={bookId} onChange={e => { setBookId(e.target.value); setChapter(1) }}
          className="bg-aihub-surface border border-aihub-border/40 rounded-lg px-3 py-1.5 text-sm">
          {getBooks().map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <button onClick={() => setChapter(c => Math.max(1, c - 1))}
          className="px-3 py-1.5 rounded-lg bg-aihub-surface border border-aihub-border/40 text-sm">Prev</button>
        <button onClick={() => setChapter(c => Math.min(book?.chapters ?? 1, c + 1))}
          className="px-3 py-1.5 rounded-lg bg-aihub-surface border border-aihub-border/40 text-sm">Next</button>
      </div>
      <div className="max-w-2xl leading-8">
        {verses.map(v => (
          <span key={v.v}><sup className="text-aihub-muted mr-1">{v.v}</sup>{v.t} </span>
        ))}
      </div>
    </div>
  )
}
