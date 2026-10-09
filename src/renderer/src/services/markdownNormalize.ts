// Models are asked for GitHub-flavoured markdown, and the big hosted ones
// mostly comply. Small local models (llama3.2:3b is the everyday path here)
// don't: they draw tables with box characters, forget the |---| row, put the
// table in a plain code fence, or glue it to the sentence above. GFM rejects
// every one of those, so the answer arrives as a wall of pipes and dashes.
//
// This pass repairs what the model meant before react-markdown sees it. It is
// deliberately conservative: anything that isn't clearly a table is left
// exactly as written, and real code blocks are never touched.

export interface NormalizeOptions {
  /** The text is still arriving: close an open fence so the rest of the
   *  message doesn't render as code, and hide a half-received trade plan. */
  streaming?: boolean
}

// Cell separators: ASCII pipe plus the box-drawing verticals.
const CELL_SEP = /(?<!\\)[|│┃║]/
const CELL_SEP_G = /(?<!\\)[|│┃║]/g
const STARTS_WITH_SEP = /^[|│┃║]/
// A border line is made only of rule characters, junctions and spacing.
const BORDER_ONLY = /^[\s|│┃║+┌┐└┘├┤┬┴┼╔╗╚╝╠╣╦╩╬┏┓┗┛┣┫┳┻╋╭╮╯╰╞╡╪╟╢╫:\-=─━═]+$/
const JUNCTION = /[|│┃║+┌┐└┘├┤┬┴┼╔╗╚╝╠╣╦╩╬┏┓┗┛┣┫┳┻╋╭╮╯╰╞╡╪╟╢╫]/
const RULE_CHAR_G = /[-=─━═]/g
const BARE_RULE = /^\s*[-=─━═]{3,}\s*$/

const FENCE_OPEN = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)/
// Fence languages that mean "no language" — a table in one of these is a
// table the model was unsure how to show, not code.
const PLAIN_FENCE = new Set(['', 'text', 'txt', 'plain', 'plaintext', 'table', 'markdown', 'md'])

const isBorder = (line: string): boolean => {
  const t = line.trim()
  return BORDER_ONLY.test(t) && JUNCTION.test(t) && (t.match(RULE_CHAR_G)?.length ?? 0) >= 3
}

const isRow = (line: string): boolean =>
  CELL_SEP.test(line) && !isBorder(line) && /[^\s|│┃║]/.test(line)

function parseCells(line: string): string[] {
  const t = line.trim()
  const cells = t.split(CELL_SEP_G)
  if (STARTS_WITH_SEP.test(t)) cells.shift()
  if (cells.length > 1 && /[|│┃║]$/.test(t) && !t.endsWith('\\|')) cells.pop()
  return cells.map(c => {
    const cell = c.trim()
    // GFM can't hold a line break in a cell and raw HTML renders as text,
    // so "a<br>b" would show its tag. A middle dot keeps the items apart.
    return cell.includes('`') ? cell : cell.replace(/\s*<br\s*\/?>\s*(?:[-•*]\s+)?/gi, ' · ')
  })
}

type Align = 'left' | 'right' | 'center' | null

function parseAlign(border: string): Align[] | null {
  if (!border.includes(':')) return null
  return parseCells(border).map(c => {
    const l = c.startsWith(':'), r = c.endsWith(':')
    return l && r ? 'center' : r ? 'right' : l ? 'left' : null
  })
}

/** Several physical lines of one logical row (a wrapped cell) → one row. */
function mergeRows(group: string[]): string[] {
  const parsed = group.map(parseCells)
  const width = Math.max(...parsed.map(p => p.length))
  return Array.from({ length: width }, (_, i) =>
    parsed.map(p => p[i] ?? '').filter(Boolean).join(' '))
}

interface TableMatch { end: number; lines: string[] }

/** Tries to read a table starting at `start`. Returns the GFM lines that
 *  replace it and the index just past it, or null if it isn't a table. */
function readTable(src: string[], start: number): TableMatch | null {
  const groups: string[][] = [[]]
  let sawBorder = false
  let align: Align[] | null = null
  let i = start

  for (; i < src.length; i++) {
    const line = src[i]
    if (isBorder(line)) {
      sawBorder = true
      align ??= parseAlign(line)
      if (groups[groups.length - 1].length) groups.push([])
    } else if (isRow(line)) {
      groups[groups.length - 1].push(line)
    } else if (BARE_RULE.test(line) && !sawBorder && groups.length === 1 && groups[0].length === 1) {
      // "Name | Age" over a plain dash rule: the rule is the header separator.
      // Anywhere else a bare rule is a real horizontal rule and ends the table.
      sawBorder = true
      groups.push([])
    } else {
      break
    }
  }

  const bodyGroups = groups.filter(g => g.length)
  const rowLines = bodyGroups.flat()
  if (rowLines.length < 2) return null
  // Without any border, only rows framed by a leading pipe are trusted — a
  // couple of sentences that happen to contain "|" are not a table.
  if (!sawBorder && !rowLines.every(l => STARTS_WITH_SEP.test(l.trim()))) return null

  let rows: string[][]
  if (bodyGroups.length >= 3) {
    // Every row boxed on its own: each group is one row, possibly wrapped.
    rows = bodyGroups.map(mergeRows)
  } else if (bodyGroups.length === 2) {
    rows = [mergeRows(bodyGroups[0]), ...bodyGroups[1].map(parseCells)]
  } else {
    rows = rowLines.map(parseCells)
  }

  const cols = Math.max(...rows.map(r => r.length))
  if (cols < 2) return null

  const fmt = (cells: string[]) =>
    `| ${Array.from({ length: cols }, (_, c) => cells[c] ?? '').join(' | ')} |`
  const delim = Array.from({ length: cols }, (_, c) => {
    const a = align?.[c]
    return a === 'center' ? ':---:' : a === 'right' ? '---:' : a === 'left' ? ':---' : '---'
  })

  return { end: i, lines: [fmt(rows[0]), `| ${delim.join(' | ')} |`, ...rows.slice(1).map(fmt)] }
}

const ALERT_TITLE: Record<string, string> = {
  NOTE: 'Note', TIP: 'Tip', IMPORTANT: 'Important', WARNING: 'Warning', CAUTION: 'Caution',
}

function fixProse(line: string): string {
  return line
    .replace(/^(\s*)[•●▪◦‣∙]\s+/, '$1- ')
    // "##Summary" → "## Summary". Single "#" is left alone: "#1 priority".
    .replace(/^(\s{0,3}#{2,6})([^\s#])/, '$1 $2')
    // GitHub alert syntax ("> [!WARNING]") isn't part of GFM proper and would
    // render its marker literally. As "> **Warning**" it reads correctly on
    // its own, and calloutKind() recognises it to colour the box.
    .replace(/^(\s*>\s*)\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i, (_, q, kind: string, rest: string) => {
      const title = ALERT_TITLE[kind.toUpperCase()]
      return rest ? `${q}**${title}:** ${rest}` : `${q}**${title}**`
    })
}

export type CalloutKind = 'note' | 'tip' | 'important' | 'warning' | 'caution'

/** A blockquote that opens with a label ("Warning:", "Tip —") is a callout. */
export function calloutKind(text: string): CalloutKind | null {
  const m = text.trimStart().match(/^(note|info|tip|hint|important|key point|warning|heads up|caution|danger|risk)\b\s*[:—–-]?/i)
  if (!m) return null
  const k = m[1].toLowerCase()
  if (k === 'note' || k === 'info') return 'note'
  if (k === 'tip' || k === 'hint') return 'tip'
  if (k === 'important' || k === 'key point') return 'important'
  if (k === 'warning' || k === 'heads up') return 'warning'
  return 'caution'
}

export type CellTone = 'up' | 'down' | 'good' | 'bad' | 'warn'

/** Colour a table cell by what it says: signed changes, verdicts, statuses. */
export function cellTone(text: string): CellTone | null {
  const t = text.trim()
  if (!t || t.length > 24) return null
  if (/^\+\s?[$€£]?\d[\d.,]*\s?%?$/.test(t)) return 'up'
  if (/^[-−–]\s?[$€£]?\d[\d.,]*\s?%?$/.test(t)) return 'down'
  if (/^(?:✅|✔️?|✓)?\s*(?:yes|true|pass(?:ed)?|bullish|buy|long|strong|good|supported|available|done)?\s*(?:✅|✔️?|✓)?$/i.test(t) && /\w|✅|✔|✓/.test(t)) return 'good'
  if (/^(?:❌|✖️?|✗|✘)?\s*(?:no|false|fail(?:ed)?|bearish|sell|short|weak|poor|unsupported|unavailable)?\s*(?:❌|✖️?|✗|✘)?$/i.test(t) && /\w|❌|✖|✗|✘/.test(t)) return 'bad'
  if (/^(?:⚠️?)?\s*(?:neutral|hold|partial|mixed|medium|moderate|maybe|wait|sideways|range|limited)?\s*(?:⚠️?)?$/i.test(t) && /\w|⚠/.test(t)) return 'warn'
  return null
}

export function normalizeAiMarkdown(input: string, opts: NormalizeOptions = {}): string {
  const src = input.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let blankBeforeNext = false

  const emit = (line: string) => {
    if (blankBeforeNext && line.trim() && out.length && out[out.length - 1].trim()) out.push('')
    blankBeforeNext = false
    out.push(line)
  }
  const emitTable = (lines: string[]) => {
    if (out.length && out[out.length - 1].trim()) out.push('')
    out.push(...lines)
    blankBeforeNext = true
  }

  for (let i = 0; i < src.length; i++) {
    const line = src[i]

    const fence = line.match(FENCE_OPEN)
    if (fence) {
      const [, marker, lang] = fence
      const closeRe = new RegExp(`^\\s{0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`)
      let close = -1
      for (let j = i + 1; j < src.length; j++) if (closeRe.test(src[j])) { close = j; break }

      if (close === -1) {
        if (opts.streaming) {
          // A trade plan is JSON until it's complete; showing it raw mid-stream
          // is exactly the wall of text the card exists to replace.
          if (lang.toLowerCase() !== 'trade-plan') {
            src.slice(i).forEach(emit)
            emit(marker)
          }
        } else {
          src.slice(i).forEach(emit)
        }
        break
      }

      const body = src.slice(i + 1, close).filter(l => l.trim())
      const table = PLAIN_FENCE.has(lang.toLowerCase()) && body.length ? readTable(body, 0) : null
      if (table && table.end === body.length) emitTable(table.lines)
      else src.slice(i, close + 1).forEach(emit)
      i = close
      continue
    }

    if (isRow(line) || isBorder(line)) {
      const table = readTable(src, i)
      if (table) {
        emitTable(table.lines)
        i = table.end - 1
        continue
      }
    }

    emit(fixProse(line))
  }

  return out.join('\n')
}
