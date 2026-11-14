import { useEffect, useRef, useState } from 'react'

export function useTechHubStream() {
  const active = useRef<string>()
  const [partial, setPartial] = useState('')
  useEffect(() => window.electronAPI?.ai?.onChunk?.(chunk => {
    if (!active.current || chunk.streamId !== active.current) return
    if (chunk.reset) setPartial('')
    else if (chunk.delta) setPartial(text => text + chunk.delta)
  }), [])
  return {
    partial,
    start() {
      const id = crypto.randomUUID()
      active.current = id
      setPartial('')
      return id
    },
    finish() {
      active.current = undefined
      setPartial('')
    },
  }
}
