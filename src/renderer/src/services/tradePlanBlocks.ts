/**
 * AIHub Browser — finding the trade plan in whatever shape the model emitted.
 *
 * The prompt asks for a fenced ```trade-plan block. A 3B local model produced
 * `[trade-plan] { … }` instead, so the renderer never matched it and the user
 * got raw JSON in the middle of their answer — the analysis was right and the
 * presentation was garbage.
 *
 * Being strict about format is the wrong trade here: the JSON is machine
 * output either way, and a plan the user can read is worth more than a rule
 * the model keeps breaking. So this accepts every form seen in practice and
 * strips it out of the prose.
 */

export interface RawTradePlan {
  [key: string]: any
}

export interface ExtractedPlans {
  /** The prose with every plan block removed. */
  text: string
  plans: RawTradePlan[]
}

/** Does this object look like a plan rather than some other JSON? */
export function looksLikeTradePlan(value: any): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const hasIdentity = typeof value.symbol === 'string' || typeof value.interval === 'string'
  const hasNumbers =
    value.entry !== undefined || value.stop !== undefined ||
    (Array.isArray(value.targets) && value.targets.length > 0) ||
    Array.isArray(value.scenarios)
  return hasIdentity && hasNumbers
}

/**
 * Walk out a balanced {...} starting at `from`, string-aware so a brace inside
 * a label cannot end the object early.
 */
function balancedObject(text: string, from: number): string | null {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = from; i < text.length; i++) {
    const ch = text[i]
    if (escaped) { escaped = false; continue }
    if (ch === '\\') { escaped = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(from, i + 1)
    }
  }
  return null
}

const FENCED = /```[ \t]*trade-plan[ \t]*\r?\n([\s\S]*?)```/gi
// The shapes models actually produce instead of a fence.
const TAGGED = /(?:\[|<|\()\s*trade-plan\s*(?:\]|>|\))\s*:?\s*/gi

/**
 * Pull every plan out of an answer, whatever wrapper it came in, and return
 * the prose without them. Order is preserved so a long/short pair renders in
 * the order the model presented it.
 */
export function extractTradePlans(markdown: string): ExtractedPlans {
  const source = String(markdown || '')
  if (!source) return { text: '', plans: [] }

  const plans: RawTradePlan[] = []
  let text = source

  // 1. The documented form.
  text = text.replace(FENCED, (_match, body) => {
    try {
      const parsed = JSON.parse(String(body).trim())
      if (looksLikeTradePlan(parsed)) { plans.push(parsed); return '' }
    } catch { /* fall through — keep the block visible rather than eat content */ }
    return _match
  })

  // 2. [trade-plan] { … } and friends: find the marker, then the object after it.
  let guard = 0
  for (;;) {
    if (guard++ > 20) break
    TAGGED.lastIndex = 0
    const marker = TAGGED.exec(text)
    if (!marker) break
    const braceAt = text.indexOf('{', marker.index + marker[0].length - 1)
    if (braceAt === -1) break
    const body = balancedObject(text, braceAt)
    if (!body) break
    let parsed: any = null
    try { parsed = JSON.parse(body) } catch { parsed = null }
    if (!parsed || !looksLikeTradePlan(parsed)) {
      // Not a plan — leave it alone and stop, rather than looping forever.
      break
    }
    plans.push(parsed)
    text = text.slice(0, marker.index) + text.slice(braceAt + body.length)
  }

  // 3. A bare JSON object with no wrapper at all.
  if (!plans.length) {
    let searchFrom = 0
    while (searchFrom < text.length) {
      const braceAt = text.indexOf('{', searchFrom)
      if (braceAt === -1) break
      const body = balancedObject(text, braceAt)
      if (!body) break
      let parsed: any = null
      try { parsed = JSON.parse(body) } catch { parsed = null }
      if (parsed && looksLikeTradePlan(parsed)) {
        plans.push(parsed)
        text = text.slice(0, braceAt) + text.slice(braceAt + body.length)
        searchFrom = braceAt
      } else {
        searchFrom = braceAt + body.length
      }
    }
  }

  // Tidy the hole the blocks left behind.
  text = text.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim()
  return { text, plans }
}

/**
 * A long and a short from the same read are two sides of ONE decision, not two
 * unrelated ideas. Merging them into a single card is what lets the user
 * compare the reward on each side at a glance — which is the whole point of a
 * bracket.
 */
export function mergeBracket(plans: RawTradePlan[]): RawTradePlan[] {
  if (plans.length < 2) return plans
  const long = plans.find(p => p.direction === 'long')
  const short = plans.find(p => p.direction === 'short')
  if (!long || !short) return plans

  const rest = plans.filter(p => p !== long && p !== short)
  const bestRr = (plan: RawTradePlan) =>
    Math.max(0, ...(Array.isArray(plan.targets) ? plan.targets.map((t: any) => Number(t?.rr) || 0) : []))

  const merged: RawTradePlan = {
    ...long,
    direction: 'bracket',
    bias: long.bias || short.bias || 'range',
    scenarios: [
      { ...long, direction: 'long', bestRr: bestRr(long) },
      { ...short, direction: 'short', bestRr: bestRr(short) },
    ],
  }
  delete merged.entry
  delete merged.stop
  delete merged.targets
  return [merged, ...rest]
}
