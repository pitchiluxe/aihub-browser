import { isAbsolute, extname } from 'path'
import { pathToFileURL } from 'url'

/** OS launch arguments are targets, not browser command-line switches. */
export function extractLaunchUrl(argv: string[]): string | null {
  for (const arg of argv) {
    if (/^https?:\/\//i.test(arg)) return arg
    if (/^file:\/\//i.test(arg)) {
      try { return new URL(arg).href } catch { continue }
    }
    if (isAbsolute(arg) && /^\.html?$/i.test(extname(arg))) {
      return pathToFileURL(arg).href
    }
  }
  return null
}
