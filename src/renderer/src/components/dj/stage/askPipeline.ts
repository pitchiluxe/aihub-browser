// One door for everything typed or said to the DJ: rules first (instant,
// never inverted), then the existing actions, and the model only for what
// neither understands — and then only in the whitelisted rule format.
import type { DjIntent } from '../djBrain'
import { buildInstructionPrompt, parseInstruction, parseModelInstructions, type Parsed } from '../ai/instructions'

export interface AskDeps {
  /** Null when no AI set is running: rules are explained instead of dropped silently. */
  conductor: { instruct(p: Parsed): void } | null
  runAction: (a: DjIntent) => void
  /** "load X on deck A" / "play X on deck B". */
  loadDeck?: (query: string, deck: 'A' | 'B', play: boolean) => void
  chat?: (m: any[]) => Promise<any>
  say: (m: string) => void
  /** List songs matching a name ("Wizkid", "songs by Tems") for the listener to pick. */
  search?: (query: string) => void
  /** Start an AI set from a description ("r&b") when none is running. */
  startSet?: (brief: string) => Promise<void>
  /** The conductor once a set is running (after startSet). */
  activeConductor?: () => { instruct(p: Parsed): void } | null
}

/** An artist or a title on its own: a few words, no sentence. */
const looksLikeName = (t: string) => t.trim().split(/\s+/).length <= 5 && !/[?]/.test(t)

export async function askDj(text: string, deps: AskDeps): Promise<void> {
  let p = parseInstruction(text)
  if (p.understood && p.items.length === 1 && 'search' in p.items[0] && deps.search) { deps.search(p.items[0].search); return }
  // A bare name is a search, not a riddle for the model.
  if (!p.understood && deps.search && looksLikeName(text)) { deps.search(text.trim()); return }
  if (!p.understood && deps.chat) {
    try {
      const res = await deps.chat(buildInstructionPrompt(text))
      if (res?.content && res.provider !== 'none') p = parseModelInstructions(String(res.content))
    } catch { /* fall through to "didn't catch" */ }
  }
  if (!p.understood) { deps.say(parseInstruction(text).confirm || "I didn't catch that."); return }
  const rules = p.items.filter(i => 'rule' in i || 'removeRule' in i)
  if (rules.length) {
    const style = rules.flatMap(i => 'rule' in i && i.rule.kind === 'onlyGenres' ? i.rule.genres : [])
    if (deps.conductor) deps.conductor.instruct({ ...p, items: rules })
    else if (style.length && deps.startSet) {
      // "R&B" with nothing playing: play R&B now, and keep to it.
      await deps.startSet(style.join(' '))
      deps.activeConductor?.()?.instruct({ ...p, items: rules })
    }
    else deps.say('Rules like that apply to an AI set — start one on the stage, then tell me again.')
  }
  for (const i of p.items) {
    if ('action' in i) deps.runAction(i.action)
    if ('load' in i && deps.loadDeck) deps.loadDeck(i.load.query, i.load.deck, i.load.play)
  }
  if (!rules.length && p.confirm) deps.say(p.confirm)
}
