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

// ── Free-tier cloud model ordering ─────────────────────────────────────────

/**
 * Models that spend their completion budget "thinking" before answering.
 *
 * They are fine for chat and actively harmful for structured output: on the
 * extension-generation prompt one was observed burning 4909 of 8192 tokens on
 * reasoning, truncating the JSON mid-object. The user then sees "the AI
 * response couldn't be parsed" — which is what happened with
 * nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free.
 */
export const REASONING_MODEL_RE = /(reasoning|thinking|-r1\b|\bqwq\b|deepseek-r)/i

export function isReasoningModel(id: string): boolean {
  return REASONING_MODEL_RE.test(String(id || ''))
}

/**
 * Models that are not chat models at all and must never enter the chain.
 *
 * The live free tier includes a content-safety classifier
 * (nvidia/nemotron-3.5-content-safety) and a vision-language model
 * (nemotron-nano-12b-v2-vl). Sending them a JSON-generation prompt wastes a
 * full round-trip and returns something that can never parse.
 */
export const UNSUITABLE_MODEL_RE = /(content-safety|moderation|guard|shield|embed|rerank|whisper|tts|vision|(?:^|[-/])vl(?:[-.:]|$))/i

export function isUnsuitableModel(id: string): boolean {
  return UNSUITABLE_MODEL_RE.test(String(id || ''))
}

/**
 * Order the free-tier chain for a request.
 *
 * The curated list leads (hand-checked for structured output), then any other
 * live free model. Reasoning models are pushed to the very back rather than
 * dropped: when nothing else is available, a model that might truncate still
 * beats no answer at all. For `structured` requests they go last without
 * exception — that is the case they actively break.
 */
export function orderFreeModels(
  live: string[],
  configured: string | undefined,
  curated: string[],
  opts?: { structured?: boolean },
): string[] {
  const liveSet = new Set(live || [])
  // No catalog (offline, or the fetch failed): try what we know rather than
  // refusing to try anything.
  if (!liveSet.size) {
    const raw = ([configured, ...curated].filter(Boolean) as string[]).filter(m => !isUnsuitableModel(m))
    return [...new Set(opts?.structured ? stableSortReasoningLast(raw) : raw)]
  }

  const head = [
    ...(configured && liveSet.has(configured) && !(opts?.structured && isReasoningModel(configured)) ? [configured] : []),
    ...curated.filter(m => liveSet.has(m)),
  ]
  // Anything that cannot hold a chat is dropped outright rather than ordered.
  const tail = live.filter(m => !head.includes(m) && !isUnsuitableModel(m))
  return [...new Set([...head, ...stableSortReasoningLast(tail)])]
}

/** Keep order, but move every reasoning model behind the rest. */
function stableSortReasoningLast(ids: string[]): string[] {
  const plain = ids.filter(id => !isReasoningModel(id))
  const reasoning = ids.filter(isReasoningModel)
  return [...plain, ...reasoning]
}

// ── Recovering from a model this machine cannot serve ──────────────────────

/**
 * The best installed model that is strictly smaller than one that just timed
 * out, or null when nothing smaller is installed.
 *
 * A first-token timeout is not a mystery to be reported as an outage. It is a
 * measurement: this machine cannot process a prompt of that size for a model
 * of that size within the budget. On a box with no usable GPU that ceiling is
 * hard — measured on an Intel UHD machine, a 7B model evaluates a prompt at
 * about 11 tokens/sec, so a 2,000-token page blows a 120-second budget before
 * emitting a single byte, every time.
 *
 * The user can act on that immediately, but only if told which model to switch
 * to. "Try a smaller model" is not an instruction when eight are installed.
 *
 * Largest-below wins rather than smallest-overall: the point is to get under
 * the machine's ceiling while giving up as little quality as possible. Cloud
 * entries are excluded — they are not slow for this reason and switching to
 * one trades a speed problem for an account problem.
 */
export function suggestFasterModel(models: ModelInfo[], timedOut: string): string | null {
  const failed = models.find(m => m.name === timedOut)
  // Unknown size means no basis for calling anything else "smaller".
  if (!failed || !failed.params) return null

  const smaller = models.filter(m =>
    !m.cloud && m.params > 0 && m.params < failed.params && m.name !== timedOut)
  if (!smaller.length) return null

  return [...smaller].sort((a, b) => {
    if (b.params !== a.params) return b.params - a.params
    return familyScore(a.name) - familyScore(b.name)
  })[0].name
}
