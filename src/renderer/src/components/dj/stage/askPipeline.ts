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
}

export async function askDj(text: string, deps: AskDeps): Promise<void> {
  let p = parseInstruction(text)
  if (!p.understood && deps.chat) {
    try {
      const res = await deps.chat(buildInstructionPrompt(text))
      if (res?.content && res.provider !== 'none') p = parseModelInstructions(String(res.content))
    } catch { /* fall through to "didn't catch" */ }
  }
  if (!p.understood) { deps.say(parseInstruction(text).confirm || "I didn't catch that."); return }
  const rules = p.items.filter(i => 'rule' in i || 'removeRule' in i)
  if (rules.length) {
    if (deps.conductor) deps.conductor.instruct({ ...p, items: rules })
    else deps.say('Rules like that apply to an AI set — start one on the stage, then tell me again.')
  }
  for (const i of p.items) {
    if ('action' in i) deps.runAction(i.action)
    if ('load' in i && deps.loadDeck) deps.loadDeck(i.load.query, i.load.deck, i.load.play)
  }
  if (!rules.length && p.confirm) deps.say(p.confirm)
}
