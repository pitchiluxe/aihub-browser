import { useState, useEffect } from 'react'

export function useTheme() {
  const [isLight, setIsLight] = useState(() => document.body.classList.contains('light-mode'))

  useEffect(() => {
    const handler = (e: Event) => setIsLight((e as CustomEvent).detail === 'light')
    document.addEventListener('aihub-theme-change', handler)
    return () => document.removeEventListener('aihub-theme-change', handler)
  }, [])

  return { isLight }
}
