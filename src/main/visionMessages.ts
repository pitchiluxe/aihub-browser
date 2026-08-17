// Sending a picture to two providers that disagree about how to carry one.
//
// The renderer speaks one portable shape — a message with `content` text and an
// `images` array of data URLs — because a chat component should not have to
// know which provider is going to answer. That decision is made later, by the
// router, and by then the message has already been built.
//
// Ollama wants bare base64 in a sibling `images` field. OpenRouter (the OpenAI
// shape) wants the parts inlined into `content` as an array. Neither accepts
// the other's form, so the conversion happens here, at the last possible
// moment, and is pure enough to test without a socket.

export interface PortableMessage {
  role: string
  content: string
  /** `data:image/png;base64,…` — what a file input or a paste produces. */
  images?: string[]
}

/** `data:image/png;base64,AAA` → `AAA`. Anything already bare is left alone. */
export function stripDataUrl(url: string): string {
  const m = /^data:[^;,]*;base64,(.*)$/s.exec(String(url || '').trim())
  return m ? m[1] : String(url || '').trim()
}

/** True when any message is carrying a picture — used to pick a model. */
export function hasImages(messages: any[]): boolean {
  return (messages || []).some(m => Array.isArray(m?.images) && m.images.length > 0)
}

export function countImages(messages: any[]): number {
  return (messages || []).reduce((n, m) => n + (Array.isArray(m?.images) ? m.images.length : 0), 0)
}

/**
 * Ollama's /api/chat shape.
 *
 * `images` stays a sibling of `content`, and the data-URL prefix has to go —
 * Ollama base64-decodes the string as-is and a leading "data:image/png;base64,"
 * decodes to garbage, which surfaces as a model that describes a black square.
 */
export function forOllama(messages: PortableMessage[]): any[] {
  return (messages || []).map(m => {
    if (!Array.isArray(m?.images) || !m.images.length) {
      const { images, ...rest } = m as any
      return rest
    }
    return { role: m.role, content: m.content ?? '', images: m.images.map(stripDataUrl) }
  })
}

/**
 * OpenRouter / OpenAI's shape: content becomes a parts array.
 *
 * Text first, then the images. Models weight the instruction more reliably
 * when it precedes the picture, and a message with images but no text would
 * otherwise send an empty text part, which some providers reject outright.
 */
export function forOpenRouter(messages: PortableMessage[]): any[] {
  return (messages || []).map(m => {
    if (!Array.isArray(m?.images) || !m.images.length) {
      const { images, ...rest } = m as any
      return rest
    }
    const parts: any[] = []
    const text = String(m.content ?? '').trim()
    if (text) parts.push({ type: 'text', text })
    for (const img of m.images) {
      // Sent as a data URL, complete with prefix — the opposite of Ollama.
      parts.push({ type: 'image_url', image_url: { url: img } })
    }
    return { role: m.role, content: parts }
  })
}

/**
 * Drop the pictures, keeping a note that they were there.
 *
 * For a provider or model that cannot see: silently sending text alone would
 * have the assistant answer "which screenshot?" while the user is looking at
 * the thumbnail they just attached. Saying so in the prompt gets an honest
 * reply instead.
 */
export function withoutImages(messages: PortableMessage[]): any[] {
  return (messages || []).map(m => {
    const { images, ...rest } = m as any
    if (!Array.isArray(images) || !images.length) return rest
    const n = images.length
    return {
      ...rest,
      content: `${String(m.content ?? '')}\n\n[The user attached ${n} image${n === 1 ? '' : 's'}, but the model answering cannot see images. Say so plainly and ask them to describe it, or suggest switching to a vision model in Settings → AI.]`.trim(),
    }
  })
}

// Model names that can actually look at a picture. Substring matched against
// the model id, because both providers spell their variants differently
// ("llava:13b", "qwen/qwen2.5-vl-72b-instruct", "gpt-4o-mini").
const VISION_HINTS = [
  'llava', 'bakllava', 'moondream', 'minicpm-v', 'llama3.2-vision', 'llama-3.2-11b-vision',
  'vl', 'vision', 'gpt-4o', 'gpt-4.1', 'gpt-5', 'claude', 'gemini', 'pixtral', 'internvl',
  'qwen2-vl', 'qwen2.5-vl', 'granite3.2-vision', 'gemma3',
]

export function looksVisionCapable(model: string): boolean {
  const id = String(model || '').toLowerCase()
  if (!id) return false
  return VISION_HINTS.some(hint => id.includes(hint))
}

/** The first installed model that could read an image, or '' if none can. */
export function pickVisionModel(installed: string[], preferred?: string): string {
  if (preferred && looksVisionCapable(preferred)) return preferred
  return (installed || []).find(looksVisionCapable) || ''
}
