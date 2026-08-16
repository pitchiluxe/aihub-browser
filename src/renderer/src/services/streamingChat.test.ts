import { describe, it, expect } from 'vitest'
import { partialNarration } from './streamingChat'

// The buffer is a snapshot taken mid-generation, so every one of these is a
// state the model really passes through on its way to a complete reply.
describe('partialNarration', () => {
  it('shows ordinary prose as it arrives', () => {
    expect(partialNarration('Looking that up for')).toBe('Looking that up for')
  })

  it('never shows the ACTIONS marker being typed out', () => {
    expect(partialNarration('Opening the page.\n\n#')).toBe('Opening the page.')
    expect(partialNarration('Opening the page.\n\n##')).toBe('Opening the page.')
    expect(partialNarration('Opening the page.\n\n###ACT')).toBe('Opening the page.')
    expect(partialNarration('Opening the page.\n\n###ACTIONS###')).toBe('Opening the page.')
  })

  it('hides the JSON payload once the marker is complete', () => {
    const buf = 'On it.\n\n###ACTIONS###\n[{"tool":"open_tab","url":"https://exa'
    expect(partialNarration(buf)).toBe('On it.')
  })

  it('never shows a control tag mid-type', () => {
    expect(partialNarration('Thinking <')).toBe('Thinking')
    expect(partialNarration('Thinking <thi')).toBe('Thinking')
    expect(partialNarration('Thinking <|chan')).toBe('Thinking')
  })

  it('hides an unclosed code fence until it is known not to be an action call', () => {
    // A fenced block that turns out to hold an action call is stripped by
    // cleanNarration — so showing it while it streams would mean showing
    // protocol that later vanishes.
    expect(partialNarration('Here you go:\n```json\n{"tool":')).toBe('Here you go:')
  })

  it('shows a closed fence, which is genuinely part of the answer', () => {
    expect(partialNarration('Try:\n```sh\nnpm test\n```')).toContain('npm test')
  })

  it('strips completed think tags the way the final text does', () => {
    expect(partialNarration('<think>hmm</think>The answer is 4')).toBe('The answer is 4')
  })

  it('returns empty rather than whitespace for a buffer with nothing showable yet', () => {
    expect(partialNarration('###')).toBe('')
    expect(partialNarration('')).toBe('')
  })

  it('does not mistake a hash inside prose for the marker', () => {
    // Only a trailing run of hashes is treated as a marker under construction.
    expect(partialNarration('Issue #42 is fixed')).toBe('Issue #42 is fixed')
  })
})
