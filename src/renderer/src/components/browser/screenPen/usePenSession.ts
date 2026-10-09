import { useEffect, useState } from 'react'
import { penSession, type PenSessionState } from '../../../services/screenPen/penSession'

/** Subscribe a component to the Screen Pen's host-side session state. */
export function usePenSession(): PenSessionState {
  const [state, setState] = useState(penSession.getState())
  useEffect(() => {
    // Catch a change that landed between the first render and this effect.
    setState(penSession.getState())
    return penSession.subscribe(setState)
  }, [])
  return state
}
