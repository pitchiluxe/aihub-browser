import { describe, it, expect } from 'vitest'
import {
  cleanCell, csvCell, squareUp, dropEmptyRows, isDataTable,
  cleanTable, cleanTables, toCsv, csvFileName, buildTableExtractionScript,
} from './tableExtract'

describe('cleanCell', () => {
  it('converts the non-breaking spaces that make numbers import as text', () => {
    expect(cleanCell('1 234')).toBe('1 234')
  })
  it('collapses whitespace and trims', () => {
    expect(cleanCell('  a\n\n  b  ')).toBe('a b')
  })
  it('survives null and undefined', () => {
    expect(cleanCell(undefined as any)).toBe('')
    expect(cleanCell(null as any)).toBe('')
  })
})

describe('csvCell', () => {
  it('leaves a plain value alone', () => {
    expect(csvCell('hello')).toBe('hello')
  })
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('one\ntwo')).toBe('"one\ntwo"')
  })
  it('defuses a formula so a page cannot run code in the spreadsheet', () => {
    expect(csvCell('=cmd|/c calc')).toBe("'=cmd|/c calc")
    expect(csvCell('+1234')).toBe("'+1234")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell('-5')).toBe("'-5")
  })
  it('can be told not to, for values known to be safe', () => {
    expect(csvCell('-5', false)).toBe('-5')
  })
})

describe('squareUp / dropEmptyRows', () => {
  it('pads a short row rather than dropping data', () => {
    expect(squareUp([['a', 'b', 'c'], ['d']])).toEqual([['a', 'b', 'c'], ['d', '', '']])
  })
  it('removes rows that are entirely empty', () => {
    expect(dropEmptyRows([['a'], ['', ''], ['b']])).toEqual([['a'], ['b']])
  })
})

describe('isDataTable', () => {
  it('accepts a real table', () => {
    expect(isDataTable([['Name', 'Price'], ['Widget', '9.99']])).toBe(true)
  })
  it('rejects the single-cell and single-column layout tables', () => {
    expect(isDataTable([['just layout']])).toBe(false)
    expect(isDataTable([['a'], ['b'], ['c']])).toBe(false)
  })
})

describe('cleanTable', () => {
  it('cleans, squares and names a table', () => {
    const t = cleanTable({ rows: [['  Name ', 'Price'], ['Widget']], label: ' Q3 sales ' })
    expect(t).toEqual({ label: 'Q3 sales', columns: 2, rows: [['Name', 'Price'], ['Widget', '']] })
  })
  it('falls back to a generic name', () => {
    expect(cleanTable({ rows: [['a', 'b'], ['c', 'd']], label: '' })?.label).toBe('Table')
  })
  it('returns null for a layout table', () => {
    expect(cleanTable({ rows: [['only one']], label: 'x' })).toBeNull()
  })
  it('filters the rejects out of a batch', () => {
    const out = cleanTables([
      { rows: [['a', 'b'], ['c', 'd']], label: 'keep' },
      { rows: [['layout']], label: 'drop' },
    ])
    expect(out.map(t => t.label)).toEqual(['keep'])
  })
})

describe('toCsv', () => {
  it('writes CRLF rows a spreadsheet opens correctly', () => {
    const t = cleanTable({ rows: [['Name', 'Note'], ['Widget', 'a,b']], label: 'T' })!
    expect(toCsv(t)).toBe('Name,Note\r\nWidget,"a,b"')
  })
})

describe('csvFileName', () => {
  it('names the file after the table', () => {
    expect(csvFileName('Q3 Sales!')).toBe('Q3-Sales.csv')
  })
  it('falls back to the page title, then to a generic name', () => {
    expect(csvFileName('', 'Annual Report')).toBe('Annual-Report.csv')
    expect(csvFileName('', '')).toBe('table.csv')
  })
  it('never emits a path separator', () => {
    expect(csvFileName('a/b\\c')).not.toMatch(/[\\/]/)
  })
})

describe('buildTableExtractionScript', () => {
  it('is a self-contained expression that cannot throw', () => {
    const src = buildTableExtractionScript()
    expect(src.startsWith('(function(){')).toBe(true)
    expect(src).toContain("catch(e){ return '[]'; }")
  })
  it('honours the table limit it is given', () => {
    expect(buildTableExtractionScript(3)).toContain('out.length<3')
  })
  it('expands both span attributes, so merged headers do not shift columns', () => {
    const src = buildTableExtractionScript()
    expect(src).toContain('colspan')
    expect(src).toContain('rowspan')
  })
})
