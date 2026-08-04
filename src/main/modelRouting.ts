// Which local model runs a given turn.
//
// A 3B model is fine for chat and hopeless at agent work: asked to read a
// resume and fill a form it answers "as a large language model I don't have
// access", because it cannot hold a multi-tool protocol. A 14B model handles
// it but is needlessly slow for "what's the capital of Kenya".
//
// So the model is chosen per turn: the user's configured model for chat, and
// the best installed tool-capable model for anything that has to use tools.

export interface ModelInfo {
  name: string
  /** Ollama reports this per model — a model without it cannot do tool work. */
  tools: boolean
  /** Parameter count in billions, 0 when unknown. */
  params: number
  /** Served from ollama.com rather than this machine. */
  cloud: boolean
}

/** Below this, models reliably fail to follow the tool protocol. */
const MIN_AGENT_PARAMS = 7
/** Above this, local generation gets slow enough that the flow stops feeling live. */
const IDEAL_MAX_PARAMS = 15

// Instruction-following quality at a given size varies a lot by family. Order
// reflects how reliably each one emits a well-formed actions block.
const FAMILY_RANK = [
  /^qwen2\.5/i, /^qwen3/i, /^llama3\.[123]/i, /^mistral-nemo/i, /^mistral/i,
  /^gemma4/i, /^gpt-oss/i, /^deepseek/i, /^gemma[23]/i, /^phi/i,
]

function familyScore(name: string): number {
  const i = FAMILY_RANK.findIndex(re => re.test(name))
  return i === -1 ? FAMILY_RANK.length : i
}

/**
 * Pick the model for a tool-using turn, or null when nothing installed is up
 * to it (the caller then keeps whatever the user configured).
 *
 * Prefers the smallest capable model rather than the biggest: past ~15B, local
 * generation is slow enough that a five-step flow stops being usable, and the
 * extra quality does not pay for it.
 */
export function pickAgentModel(models: ModelInfo[], configured?: string): string | null {
  const capable = models.filter(m => m.tools && m.params >= MIN_AGENT_PARAMS)
  if (!capable.length) return null

  // Already on something capable? Leave it — the user's choice wins.
  if (configured && capable.some(m => m.name === configured)) return configured

  const ranked = [...capable].sort((a, b) => {
    // Local before cloud: a cloud model needs an ollama.com session that may
    // not exist, and failing over mid-task is worse than being a bit slower.
    if (a.cloud !== b.cloud) return a.cloud ? 1 : -1
    const aOver = a.params > IDEAL_MAX_PARAMS
    const bOver = b.params > IDEAL_MAX_PARAMS
    if (aOver !== bOver) return aOver ? 1 : -1
    const fam = familyScore(a.name) - familyScore(b.name)
    if (fam !== 0) return fam
    return a.params - b.params
  })
  return ranked[0].name
}

/** True when the configured model is too small to drive tools at all. */
export function isTooSmallForAgentWork(models: ModelInfo[], configured?: string): boolean {
  if (!configured) return false
  const m = models.find(x => x.name === configured)
  if (!m) return false
  return !m.tools || m.params < MIN_AGENT_PARAMS
}
