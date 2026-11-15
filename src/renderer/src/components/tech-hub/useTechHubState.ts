import { useCallback, useEffect, useRef, useState } from 'react'
import { useTechHubStream } from './useTechHubStream'

/**
 * Small per-viewer persistence for Tech Hub progress. Storage can be missing
 * (private partitions) or hold stale shapes from older builds, so every read
 * is validated and every failure falls back to the default.
 */
export function usePersistentState<T>(key: string, fallback: T, valid: (value: unknown) => value is T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`techHub.${key}`)
      if (raw === null) return fallback
      const parsed: unknown = JSON.parse(raw)
      return valid(parsed) ? parsed : fallback
    } catch {
      return fallback
    }
  })
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    try { localStorage.setItem(`techHub.${key}`, JSON.stringify(value)) } catch { /* storage unavailable */ }
  }, [key, value])
  return [value, setValue] as const
}

export const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string')
export const isStringRecord = (value: unknown): value is Record<string, string[]> =>
  !!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(isStringArray)

export type AiDraft = { content: string; model: string; provider: string }

export function providerLabel(draft: AiDraft) {
  const provider = draft.provider === 'openrouter' ? 'OpenRouter' : draft.provider === 'ollama' ? 'Ollama' : draft.provider
  return draft.model ? `${provider} · ${draft.model}` : provider
}

/** One streamed AI request at a time, with its live partial text and error. */
export function useAiRequest() {
  const stream = useTechHubStream()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = useCallback(async (prompt: string, mode: string): Promise<AiDraft | undefined> => {
    setBusy(true)
    setError('')
    try {
      const result: AiDraft = await window.electronAPI.techHub.generate(prompt, stream.start(), mode)
      if (result.provider === 'none' || !result.content?.trim()) {
        throw new Error('No AI response. Check your Ollama model and OpenRouter fallback in Settings.')
      }
      return result
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not generate a response.')
      return undefined
    } finally {
      stream.finish()
      setBusy(false)
    }
  // stream.start/finish only touch a ref and a setter, so they are stable enough.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return { run, busy, error, partial: stream.partial, clearError: () => setError('') }
}

export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true } catch { return false }
}
