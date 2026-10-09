import { useCallback, useEffect, useRef, useState } from 'react'
import type { ResearchMonitor, ResearchMonitorBridge } from '../../../../shared/research/monitorTypes'

export function useResearchMonitors(projectId: string, privateWindow: boolean, bridge?: ResearchMonitorBridge) {
  const [monitors, setMonitors] = useState<ResearchMonitor[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const request = useRef(0)
  const refresh = useCallback(async () => {
    const generation = ++request.current
    if (!projectId || privateWindow || !bridge) { setMonitors([]); setLoading(false); return }
    setLoading(true); setError('')
    try {
      const result = await bridge.list(projectId)
      if (request.current !== generation) return
      if (!result.ok) throw Error(result.error)
      setMonitors(result.value)
    } catch (e) { if (request.current === generation) setError(e instanceof Error ? e.message : 'Research updates could not load.') }
    finally { if (request.current === generation) setLoading(false) }
  }, [projectId, privateWindow, bridge])
  useEffect(() => {
    void refresh()
    if (!bridge || privateWindow) return () => { request.current++ }
    const unsubscribe = bridge.onChanged(({ projectId: changedId }) => { if (changedId === projectId) void refresh() })
    return () => { request.current++; unsubscribe() }
  }, [bridge, privateWindow, projectId, refresh])
  return { monitors, loading, error, refresh }
}
