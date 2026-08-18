// Converts a getbible.net v2 book payload into the same compact chapter shape
// the WEB assets use: `chapters[i]` is an array of `{ v, t }`.
//
// Upstream gives one object per verse with the chapter repeated on it, text
// padded with trailing spaces, and typographic apostrophes. Verses arrive in
// order but the sort is kept anyway — a single out-of-order verse would
// otherwise silently reorder scripture.
export function normalizeGetBibleBook(payload) {
  const chapters = []

  for (const chapter of payload?.chapters || []) {
    const n = Number(chapter?.chapter)
    if (!Number.isFinite(n) || n < 1) continue

    const verses = (chapter.verses || [])
      .filter(v => typeof v?.text === 'string' && Number.isFinite(Number(v?.verse)))
      .map(v => ({ v: Number(v.verse), t: v.text.replace(/\s+/g, ' ').trim() }))
      .sort((a, b) => a.v - b.v)

    // Chapters are placed by their own number rather than pushed, so a gap in
    // the payload surfaces as a hole the caller can check for instead of
    // silently shifting every later chapter down by one.
    chapters[n - 1] = verses
  }

  return { chapters }
}
