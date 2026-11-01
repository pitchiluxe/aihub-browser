// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGrammarEditor, preserveGrammarWhitespace } from './grammarEditing'
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks() })
const field = (value = 'I has a apple.') => {
  const input = document.createElement('textarea'); input.value = value; document.body.append(input); input.focus(); return input
}
describe('grammar replacement integrity', () => {
  it('keeps boundary whitespace so a corrected selection cannot join neighboring words', () => {
    expect(preserveGrammarWhitespace(' I has a apple. ', 'I have an apple.')).toBe(' I have an apple. ')
    expect(preserveGrammarWhitespace('\n\tI has a apple.\n', '  I have an apple.  ')).toBe('\n\tI have an apple.\n')
  })
  it('replaces just the captured selection and emits an input event', () => {
    const input = field('Before: I has a apple. After.')
    input.setSelectionRange(8, 22)
    const onInput = vi.fn(); input.addEventListener('input', onInput)
    const editor = createGrammarEditor()
    expect(editor.capture('id', true, '')).toEqual({ id: 'id', original: 'I has a apple.', canReplace: true })
    expect(editor.apply('id', 'I have an apple.')).toBe(true)
    expect(input.value).toBe('Before: I have an apple. After.')
    expect(onInput).toHaveBeenCalledOnce()
    expect(editor.apply('id', 'second correction')).toBe(false)
  })
  it('captures the full field at a caret and rejects changed or removed targets', () => {
    const input = field(); input.setSelectionRange(0, 0)
    const editor = createGrammarEditor()
    expect(editor.capture('id', true, '')?.original).toBe(input.value)
    input.value = 'New draft'
    expect(editor.apply('id', 'I have an apple.')).toBe(false)
    expect(input.value).toBe('New draft')
    editor.capture('new', true, '')
    input.remove()
    expect(editor.apply('new', 'replacement')).toBe(false)
  })
  it('excludes passwords, read-only fields, oversized selections, and expired IDs', () => {
    const input = document.createElement('input'); input.type = 'password'; input.value = 'secret'; document.body.append(input); input.focus()
    const editor = createGrammarEditor()
    expect(editor.capture('password', true, 'secret')).toBeNull()
    input.type = 'text'; input.readOnly = true
    expect(editor.capture('readonly', true, '')).toBeNull()
    const text = field('x'.repeat(8001)); text.setSelectionRange(0, 0)
    expect(editor.capture('long', true, '')).toBeNull()
    text.value = 'Short sentence'; editor.capture('short', true, ''); editor.clear('short')
    expect(editor.apply('short', 'Corrected')).toBe(false)
  })
  it('offers selected page text for copying without making it replaceable', () => {
    const paragraph = document.createElement('p'); paragraph.textContent = 'It are good.'; document.body.append(paragraph)
    const range = document.createRange(); range.selectNodeContents(paragraph)
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range)
    const editor = createGrammarEditor()
    expect(editor.capture('page', false, '')).toEqual({ id: 'page', original: 'It are good.', canReplace: false })
    expect(editor.apply('page', 'It is good.')).toBe(false)
    expect(paragraph.textContent).toBe('It are good.')
  })
  it('preserves contenteditable markup outside the selected text and refuses stale ranges', () => {
    document.body.innerHTML = '<div contenteditable="true"><b>Before</b> It are good. <i>After</i></div>'
    const root = document.body.firstElementChild as HTMLElement
    const text = root.childNodes[1]
    const range = document.createRange(); range.setStart(text, 1); range.setEnd(text, 13)
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range)
    const editor = createGrammarEditor()
    const capture = editor.capture('edit', true, '')
    expect(capture?.canReplace).toBe(true)
    root.append('Changed')
    expect(editor.apply('edit', 'It is good.')).toBe(false)
    expect(root.querySelector('b')?.textContent).toBe('Before')
  })
})
