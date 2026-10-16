// Documents the user names in a chat message are read by the app, not left to
// the model.
//
// "Check my resume in C:\Users\me\Documents\Resume.pdf" is unambiguous, yet a
// small local model routinely skips the read_file action and answers "Sure!
// Here is your resume" — having seen nothing — then gives advice that ignores
// the user's real background for the rest of the conversation. Pulling the
// path out of the message and reading it before the first model turn makes the
// document's text part of the prompt no matter which model answers.

const DOC_EXTENSIONS = ['pdf', 'docx', 'doc', 'txt', 'md', 'rtf', 'odt', 'csv', 'json']

// A path root (drive letter, home "~", or a Unix home folder), then the
// shortest run of path characters ending in a document extension. Spaces are
// allowed inside the path — "My Documents" is a real folder — so the match is
// lazy and stops at the first known extension. The lookbehind keeps the "s:/"
// of "https://" and the "/home/" inside a URL from passing for a root.
const PATH_RE = new RegExp(
  String.raw`(?<![\w:/.])(?:[A-Za-z]:[\\/]|~[\\/]|/(?:Users|home)/)[^\n"'<>|*?]*?\.(?:${DOC_EXTENSIONS.join('|')})(?![A-Za-z0-9])`,
  'gi',
)

/** At most this many documents are read automatically per message. */
export const MAX_AUTO_READ = 3

/** Local document paths named in a message, in order, deduplicated. */
export function extractDocumentPaths(text: string): string[] {
  if (!text) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of text.matchAll(PATH_RE)) {
    const path = m[0].trim()
    const key = path.toLowerCase().replace(/\//g, '\\')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(path)
    if (out.length === MAX_AUTO_READ) break
  }
  return out
}
