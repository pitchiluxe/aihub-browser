// What the user is pointing at, and whether the model just brushed them off.
//
// A capable model reads the open page and the named file on its own. A small
// local one answers "I don't have access to your files, please paste them" —
// which is false in this browser. These patterns let the app attach the page
// itself, and catch the refusal so it can be corrected before the user sees it.

/** The user pointing at what is on their screen right now. */
export const PAGE_REFERENCE =
  /\b(this|the current|the open|currently open|the)\s+(page|site|website|form|application|app|listing|article|posting)\b|\bthis\s+(one|thing)\b|\bon\s+screen\b|\bthese\s+questions\b|\bcurrently\s+open\b/i

/** A local document the assistant is expected to open itself. */
export const FILE_REFERENCE =
  /[a-z]:[\\/][^\s"']+|~[\\/][^\s"']+|\b(my|the)\s+(resume|cv|cover\s*letter)\b|\b(downloads|documents|desktop)\s+folder\b/i

/** A chatbot refusal to something this browser can actually do. */
export const REFUSAL =
  /\b(i (don'?t|do not) have (direct )?access|i can'?t (see|access|browse|open|read)|i'?m (unable|not able) to (see|access|browse|open|read|fill)|as (a|an) (large )?(language model|ai)|since i'?m an? ai|please provide me with the (content|text)|paste the (content|text)|i can only (guide|help you through)|i cannot (see|access|read))\b/i

/** Appended instead of the full tool manual on plain chat turns. */
export const CHAT_ONLY_NOTE = `

## Tools
You have browser and file tools available, but this turn does not appear to need them — answer directly. If the user does want you to open, read, fill or search something, say so and they can ask again; the tool manual is loaded for those turns.`

interface PromptBookmark { title: string; url: string; category: string }

/**
 * The bookmarks worth spending prompt tokens on.
 *
 * A 230-bookmark list is ~6k tokens on every single turn, and on a local model
 * that is minutes of prompt processing. "open X" is resolved before the model
 * ever sees it, so the full list earns almost nothing: send the ones the
 * message actually mentions, then fill the remainder with the most recent.
 */
export function selectBookmarksForPrompt<T extends PromptBookmark>(
  bookmarks: T[],
  message: string,
  limit = 25,
): T[] {
  if (bookmarks.length <= limit) return bookmarks

  const words = (message || '').toLowerCase().match(/[a-z0-9.]{3,}/g) || []
  const mentioned = bookmarks.filter(b => {
    const hay = `${b.title} ${b.url}`.toLowerCase()
    return words.some(w => hay.includes(w))
  })

  const picked = [...mentioned]
  const seen = new Set(picked)
  // AIHub's own pages are cheap and always worth knowing about.
  for (const b of bookmarks) {
    if (picked.length >= limit) break
    if (!seen.has(b) && b.url.startsWith('aihub://')) { picked.push(b); seen.add(b) }
  }
  for (const b of bookmarks) {
    if (picked.length >= limit) break
    if (!seen.has(b)) { picked.push(b); seen.add(b) }
  }
  return picked.slice(0, limit)
}

/**
 * Which tool the model should have reached for, given what was asked. Used to
 * make the correction specific — a generic "try again" does not move a small
 * model off a refusal, but "use read_file with that path" does.
 */
export function wantedTools(msg: string): string | null {
  const wants: string[] = []
  if (PAGE_REFERENCE.test(msg)) wants.push('read_page (and scan_page if it is a form)')
  if (FILE_REFERENCE.test(msg)) wants.push('read_file with the exact path')
  if (/\b(find|search|locate|organi[sz]e)\b.*\b(files?|folders?|documents?|resumes?|downloads|pdfs?|photos?)\b/i.test(msg)) wants.push('find_files')
  if (/\b(job|jobs|apply|application|position|hiring)\b/i.test(msg)) wants.push('web_search / open_tab / scan_page / fill_field')
  return wants.length ? wants.join(', ') : null
}
