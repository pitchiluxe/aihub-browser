// One door for everything typed or said to the DJ: rules first (instant,
// never inverted), then the existing actions, and the model only for what
// neither understands — and then only in the whitelisted rule format.
import type { DjIntent } from '../djBrain'
import { buildInstructionPrompt, parseInstruction, parseModelInstructions, type Parsed } from '../ai/instructions'

export async function askDj(text: string, deps: { conductor: { instruct(p: Parsed): void }; runAction: (a: DjIntent) => void; chat?: (m: any[]) => Promise<any>; say: (m: string) => void }): Promise<void> {
  let p = parseInstruction(text)
  if (!p.understood && deps.chat) {
    try {
      const res = await deps.chat(buildInstructionPrompt(text))
      if (res?.content && res.provider !== 'none') p = parseModelInstructions(String(res.content))
    } catch { /* fall through to "didn't catch" */ }
  }
  if (!p.understood) { deps.say(parseInstruction(text).confirm || "I didn't catch that."); return }
  const rules = p.items.filter(i => !('action' in i))
  if (rules.length) deps.conductor.instruct({ ...p, items: rules })
  for (const i of p.items) if ('action' in i) deps.runAction(i.action)
  if (!rules.length && p.confirm) deps.say(p.confirm)
}
