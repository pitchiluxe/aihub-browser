// Converts the upstream WEB token stream into compact chapters.
//
// Upstream emits a flat list of tokens: structural markers ("paragraph start",
// "chapter") carry no text, and text tokens carry chapterNumber/verseNumber.
// A single verse is frequently split across several tokens (poetry lines,
// paragraph breaks), so fragments sharing a verse number are joined in order.
export function normalizeBook(tokens) {
  const chapterMap = new Map()

  for (const tok of tokens || []) {
    if (typeof tok?.value !== 'string') continue
    if (typeof tok.chapterNumber !== 'number' || typeof tok.verseNumber !== 'number') continue

    if (!chapterMap.has(tok.chapterNumber)) chapterMap.set(tok.chapterNumber, new Map())
    const verses = chapterMap.get(tok.chapterNumber)
    verses.set(tok.verseNumber, (verses.get(tok.verseNumber) || '') + tok.value)
  }

  const chapters = [...chapterMap.keys()]
    .sort((a, b) => a - b)
    .map(cn => {
      const verses = chapterMap.get(cn)
      return [...verses.keys()]
        .sort((a, b) => a - b)
        .map(vn => ({ v: vn, t: verses.get(vn).replace(/\s+/g, ' ').trim() }))
    })

  return { chapters }
}
