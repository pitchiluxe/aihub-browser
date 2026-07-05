import { useState, useEffect } from 'react'

export function useTheme() {
  const [isLight, setIsLight] = useState(() => document.body.classList.contains('light-mode'))

  // Watch the body class itself rather than a custom event — the class is the
  // single source of truth, and it changes on BOTH paths (boot-time settings
  // load and the Settings page picker). The old event-only listener missed
  // the boot path: components mounted before settings resolved stayed stale.
  useEffect(() => {
    const sync = () => setIsLight(document.body.classList.contains('light-mode'))
    const mo = new MutationObserver(sync)
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] })
    sync()
    return () => mo.disconnect()
  }, [])

  return { isLight }
}
