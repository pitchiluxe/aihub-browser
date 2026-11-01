export interface GrammarRequest { id: string; original: string; canReplace: boolean }
export function preserveGrammarWhitespace(original: string, corrected: string): string {
  return (original.match(/^\s*/)?.[0] || '') + corrected.trim() + (original.match(/\s*$/)?.[0] || '')
}
/** Runs in a private isolated world; the source page cannot replace this state. */
export function createGrammarEditor() {
  let saved: { id: string; original: string; field?: HTMLInputElement | HTMLTextAreaElement; value?: string; start?: number; end?: number; root?: HTMLElement; contents?: string; range?: Range } | null = null
  return {
    capture(id: string, editable: boolean, fallback: string): GrammarRequest | null {
      saved = null
      const element = document.activeElement
      if (element instanceof HTMLInputElement && !['text', 'search'].includes(element.type)) return null
      if (editable && (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement)) {
        if (element.readOnly || element.disabled || element.closest('[data-private], [data-sensitive]')) return null
        const start = element.selectionStart ?? 0, end = element.selectionEnd ?? 0
        const from = start === end ? 0 : start, to = start === end ? element.value.length : end
        const original = element.value.slice(from, to)
        if (!original.trim() || original.length > 8000) return null
        saved = { id, original, field: element, value: element.value, start: from, end: to }
        return { id, original, canReplace: true }
      }
      const selection = window.getSelection()
      const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null
      const node = range?.commonAncestorContainer
      const parent = node instanceof Element ? node : node?.parentElement
      const root = editable ? parent?.closest<HTMLElement>('[contenteditable="true"], [contenteditable="plaintext-only"]') : null
      if (root && range?.collapsed) range.selectNodeContents(root)
      const original = range?.toString() || fallback
      if (!original.trim() || original.length > 8000) return null
      if (root && range && !root.closest('[data-private], [data-sensitive]')) saved = { id, original, root, range, contents: root.textContent || '' }
      else saved = { id, original }
      return { id, original, canReplace: !!saved.field || !!saved.root }
    },
    apply(id: string, text: string): boolean {
      const target = saved
      if (!target || target.id !== id || typeof text !== 'string' || !text.trim() || text.length > 16000) return false
      if (target.field) {
        const field = target.field
        if (!field.isConnected || field.disabled || field.readOnly || field.value !== target.value) return false
        field.focus(); field.setSelectionRange(target.start!, target.end!)
        const before = field.value
        if (!document.execCommand?.('insertText', false, text) && field.value === before) {
          field.setRangeText(text, target.start!, target.end!, 'end')
          field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: text }))
        }
        saved = null
        return true
      }
      if (target.root && target.range) {
        const { root, range } = target
        if (!root.isConnected || root.textContent !== target.contents || range.toString() !== target.original || !root.contains(range.commonAncestorContainer)) return false
        root.focus()
        const selection = window.getSelection()
        selection?.removeAllRanges(); selection?.addRange(range)
        if (!document.execCommand?.('insertText', false, text)) return false
        saved = null
        return true
      }
      return false
    },
    clear(id: string) { if (saved?.id === id) saved = null },
  }
}
