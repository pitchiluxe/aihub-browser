import { describe, expect, it } from 'vitest'
import { resolve } from 'path'
import { pathToFileURL } from 'url'
import { extractLaunchUrl } from './launchUrl'

describe('OS launch targets', () => {
  it('opens HTML paths with spaces and reserved URL characters', () => {
    const path = resolve('My pages', 'résumé #1%.HTML')
    expect(extractLaunchUrl(['AIHub.exe', '--flag', path])).toBe(pathToFileURL(path).href)
  })
  it('accepts file URLs and preserves fragments', () => {
    const url = pathToFileURL(resolve('page.htm')).href + '#section'
    expect(extractLaunchUrl(['AIHub.exe', url])).toBe(url)
  })
  it('keeps ordinary web launches working', () => {
    expect(extractLaunchUrl(['AIHub.exe', 'https://example.com'])).toBe('https://example.com')
  })
  it('ignores executable paths, switches, and unsafe schemes', () => {
    expect(extractLaunchUrl(['AIHub.exe', '--profile=page.html', 'javascript:alert(1)', 'data:text/html,hi'])).toBeNull()
  })
})
