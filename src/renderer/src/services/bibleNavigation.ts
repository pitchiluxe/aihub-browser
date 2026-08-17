// "Open this verse in the Bible" — from anywhere in the app to the reader.
//
// The study room can write the reading position into the marks file, but that
// only carries a book and a chapter, and the reader still greets you with the
// closed cover. Asking for John 3:16 and getting a book cover is not an answer
// to the question, so the request is carried explicitly: which verse, and the
// fact that the cover should be skipped this once.
//
// sessionStorage rather than a plain module variable because the reader may not
// be mounted yet when the request is made — the tab is created in the same
// commit — and a value that survives until the component's first effect is
// exactly what is needed. It is cleared as soon as it is read, so it can never
// hijack a later, deliberate visit to the cover.

const KEY = 'aihub-bible-goto-ref'
const EVT = 'aihub-bible-goto'

/** Ask the reader to open at `ref`. Safe to call whether or not it is mounted. */
export function requestBibleVerse(ref: string): void {
  if (!ref) return
  try { sessionStorage.setItem(KEY, ref) } catch {}
  window.dispatchEvent(new CustomEvent(EVT, { detail: ref }))
}

/** The pending request, consumed. Returns null when there isn't one. */
export function takeBibleVerseRequest(): string | null {
  try {
    const v = sessionStorage.getItem(KEY)
    if (v) sessionStorage.removeItem(KEY)
    return v || null
  } catch {
    return null
  }
}

/** Fires when a request arrives while the reader is already on screen. */
export function onBibleVerseRequest(cb: (ref: string) => void): () => void {
  const handler = (e: Event) => {
    const ref = (e as CustomEvent).detail as string
    if (ref) { takeBibleVerseRequest(); cb(ref) }
  }
  window.addEventListener(EVT, handler)
  return () => window.removeEventListener(EVT, handler)
}
