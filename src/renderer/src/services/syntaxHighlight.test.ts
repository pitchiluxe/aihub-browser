import { describe, it, expect } from 'vitest'
import { highlight, type Token } from './syntaxHighlight'

const ofType = (tokens: Token[], type: Token['type']) =>
  tokens.filter(t => t.type === type).map(t => t.text.trim())

describe('highlight', () => {
  it('always reproduces the source exactly', () => {
    const src = 'const x = "a\\"b" // hi\nfunction f(n) { return n * 2.5 }'
    expect(highlight(src, 'js').map(t => t.text).join('')).toBe(src)
  })

  it('finds the main JavaScript token kinds', () => {
    const t = highlight('const total = sum(items, 42) // done', 'ts')
    expect(ofType(t, 'keyword')).toContain('const')
    expect(ofType(t, 'function')).toContain('sum')
    expect(ofType(t, 'number')).toContain('42')
    expect(ofType(t, 'comment')).toContain('// done')
  })

  it('uses hash comments and triple-quoted strings for Python', () => {
    const t = highlight('def f():\n    """doc"""\n    return None  # nothing', 'python')
    expect(ofType(t, 'keyword')).toContain('def')
    expect(ofType(t, 'string')).toContain('"""doc"""')
    expect(ofType(t, 'literal')).toContain('None')
    expect(ofType(t, 'comment')).toContain('# nothing')
  })

  it('tells JSON keys from JSON values', () => {
    const t = highlight('{"price": 12.5, "name": "gold", "ok": true}', 'json')
    expect(ofType(t, 'property')).toEqual(['"price"', '"name"', '"ok"'])
    expect(ofType(t, 'string')).toEqual(['"gold"'])
    expect(ofType(t, 'literal')).toEqual(['true'])
  })

  it('matches SQL keywords regardless of case', () => {
    expect(ofType(highlight('SELECT * FROM t', 'sql'), 'keyword')).toEqual(['SELECT', 'FROM'])
  })

  it('leaves an unknown language as one plain token', () => {
    expect(highlight('anything at all', 'brainfuck')).toEqual([{ type: 'plain', text: 'anything at all' }])
  })
})
