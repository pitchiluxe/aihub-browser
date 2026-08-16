// Show the answer while it is still being written.
//
// `ai:chat` has always been one request and one response, so the whole reply
// landed at once: a local model that took thirty seconds to generate looked
// like thirty seconds of a spinner, even though its first words were ready in
// under one. The tokens were already arriving one at a time in the main
// process — they were just accumulated in silence.
//
// The promise still resolves with the COMPLETE text, so every caller's
// existing parsing (action blocks, refusal retries, narration cleaning) is
// untouched. Streaming is purely additive: a display channel alongside it.

import { cleanNarration } from './agentTools'

export type ChatOpts = { preferCloud?: boolean; needsTools?: boolean }

/**
 * What is safe to show from a half-received reply.
 *
 * The buffer is a snapshot mid-token, so it can end inside a marker the model
 * is still typing — `##`, `###ACTIO`, `<thin`. Rendering that means the user
 * watches the machine protocol get spelled out one character at a time before
 * it disappears. Trailing fragments are cut; anything complete is handed to
 * the same cleaner the final text goes through, so nothing can appear
 * mid-stream that wouldn't have survived to the end.
 */
export function partialNarration(buffer: string): string {
  let s = buffer

  // Hashes at the very end may be the start of ###ACTIONS### — including a
  // single one, since the marker is typed a character at a time. Anchored to a
  // line/word boundary so "Issue #42" is left alone.
  s = s.replace(/(^|\s)#+[A-Za-z_]*$/, '$1')
  // An unterminated tag may be the start of <think> or a <|control|> token.
  s = s.replace(/<[^>\n]{0,24}$/, '')
  // A fence that has opened but not closed: its contents may turn out to be an
  // action call, which cleanNarration would have removed once it could see the
  // closing ```.
  const fences = (s.match(/```/g) || []).length
  if (fences % 2 === 1) s = s.slice(0, s.lastIndexOf('```'))

  // Trimmed both ends: what is left after cutting a partial marker is usually
  // trailing whitespace, and a bubble that grows by a blank line before the
  // next word arrives looks like a glitch.
  return cleanNarration(s).trim()
}

let streamSeq = 0

/**
 * Run a chat turn, reporting partial text as it arrives.
 *
 * `onPartial` receives display-ready narration, never raw tokens. It is not
 * called at all when the answer comes from a provider that cannot stream —
 * the caller just sees the completed result, exactly as before.
 */
export async function streamChat(
  messages: any[],
  opts: ChatOpts | undefined,
  onPartial: (text: string) => void,
): Promise<any> {
  const api = (window as any).electronAPI?.ai
  // No streaming support (older preload): fall back to the plain call rather
  // than failing the turn.
  if (!api?.onChunk) return api.chat(messages, undefined, opts)

  const streamId = `s${Date.now()}-${++streamSeq}`
  let buffer = ''
  let off: (() => void) | null = null

  try {
    off = api.onChunk((c: { streamId: string; delta?: string; reset?: boolean; done?: boolean }) => {
      if (c.streamId !== streamId) return
      if (c.reset) { buffer = ''; onPartial(''); return }
      if (c.done) return
      if (!c.delta) return
      buffer += c.delta
      onPartial(partialNarration(buffer))
    })
    return await api.chat(messages, undefined, { ...opts, streamId })
  } finally {
    try { off?.() } catch {}
  }
}
