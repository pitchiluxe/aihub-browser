/**
 * Whether an element is on screen, kept up to date by a ResizeObserver (an
 * element under `display: none` measures 0×0). Animation loops read `.shown`
 * every frame instead of `offsetParent`, which forces a synchronous layout of
 * the whole browser UI whenever anything on the page changed.
 */
export function shownFlag(el: Element, RO: typeof ResizeObserver | undefined = globalThis.ResizeObserver): { readonly shown: boolean; dispose(): void } {
  let shown = true
  if (!RO) return { shown: true, dispose: () => {} }
  const ro = new RO(entries => {
    const r = entries[entries.length - 1]?.contentRect
    if (r) shown = r.width > 0 && r.height > 0
  })
  ro.observe(el)
  return { get shown() { return shown }, dispose: () => ro.disconnect() }
}
