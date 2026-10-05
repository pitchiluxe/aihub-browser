import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { normalizeAiMarkdown, calloutKind, cellTone } from './markdownNormalize'

const toHtml = (md: string) =>
  renderToStaticMarkup(React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, md))

describe('normalizeAiMarkdown — output really is a GFM table', () => {
  const broken = {
    'box drawing': '┌────┬───┐\n│ A  │ B │\n├────┼───┤\n│ 1  │ 2 │\n└────┴───┘',
    'no separator': 'Prices:\n| A | B |\n| 1 | 2 |',
    'fenced': '```\n| A | B |\n|---|---|\n| 1 | 2 |\n```',
  }
  for (const [name, md] of Object.entries(broken)) {
    it(`${name}: raw GFM shows no table, normalized does`, () => {
      expect(toHtml(md)).not.toContain('<td>1</td>')
      expect(toHtml(normalizeAiMarkdown(md))).toContain('<td>1</td>')
    })
  }
})

const lines = (s: string) => s.split('\n')

describe('normalizeAiMarkdown — pipe tables', () => {
  it('leaves a valid GFM table rendering the same', () => {
    const md = '| Name | Age |\n| --- | --- |\n| Bob | 3 |'
    expect(normalizeAiMarkdown(md)).toBe(md)
  })

  it('adds the separator row a model left out', () => {
    const out = normalizeAiMarkdown('| Name | Age |\n| Bob | 3 |\n| Ann | 5 |')
    expect(lines(out)).toEqual(['| Name | Age |', '| --- | --- |', '| Bob | 3 |', '| Ann | 5 |'])
  })

  it('rebuilds a separator whose column count does not match the header', () => {
    const out = normalizeAiMarkdown('| A | B | C |\n|---|\n| 1 | 2 | 3 |')
    expect(lines(out)[1]).toBe('| --- | --- | --- |')
  })

  it('treats a bare dash rule under the header as the separator', () => {
    const out = normalizeAiMarkdown('Name | Age\n-----------\nBob | 3')
    expect(lines(out)).toEqual(['| Name | Age |', '| --- | --- |', '| Bob | 3 |'])
  })

  it('keeps column alignment from the original separator', () => {
    const out = normalizeAiMarkdown('| Item | Price |\n|:-----|------:|\n| Tea | 2 |')
    expect(lines(out)[1]).toBe('| :--- | ---: |')
  })

  it('drops divider rows repeated between body rows', () => {
    const out = normalizeAiMarkdown('| A | B |\n|---|---|\n| 1 | 2 |\n|---|---|\n| 3 | 4 |')
    expect(lines(out)).toEqual(['| A | B |', '| --- | --- |', '| 1 | 2 |', '| 3 | 4 |'])
  })

  it('pads short rows so every row has the header column count', () => {
    const out = normalizeAiMarkdown('| A | B | C |\n|---|---|---|\n| 1 | 2 |')
    expect(lines(out)[2]).toBe('| 1 | 2 |  |')
  })

  it('separates a table from the paragraph directly above it', () => {
    const out = normalizeAiMarkdown('Here are the options:\n| A | B |\n|---|---|\n| 1 | 2 |')
    expect(lines(out).slice(0, 3)).toEqual(['Here are the options:', '', '| A | B |'])
  })

  it('turns <br> inside cells into a readable separator', () => {
    const out = normalizeAiMarkdown('| A | B |\n|---|---|\n| one<br>two | x |')
    expect(lines(out)[2]).toBe('| one · two | x |')
  })

  it('does not treat a lone line with a pipe as a table', () => {
    const md = 'Choose A | B and continue.'
    expect(normalizeAiMarkdown(md)).toBe(md)
  })
})

describe('normalizeAiMarkdown — drawn tables', () => {
  it('converts a box-drawing table', () => {
    const md = [
      '┌──────┬─────┐',
      '│ Name │ Age │',
      '├──────┼─────┤',
      '│ Bob  │ 3   │',
      '│ Ann  │ 5   │',
      '└──────┴─────┘',
    ].join('\n')
    expect(lines(normalizeAiMarkdown(md))).toEqual([
      '| Name | Age |', '| --- | --- |', '| Bob | 3 |', '| Ann | 5 |',
    ])
  })

  it('converts an ASCII grid table', () => {
    const md = [
      '+------+-----+',
      '| Name | Age |',
      '+======+=====+',
      '| Bob  | 3   |',
      '+------+-----+',
    ].join('\n')
    expect(lines(normalizeAiMarkdown(md))).toEqual(['| Name | Age |', '| --- | --- |', '| Bob | 3 |'])
  })

  it('joins wrapped cell text when every row is boxed on its own', () => {
    const md = [
      '+------+-----------+',
      '| Name | Note      |',
      '+------+-----------+',
      '| Bob  | first     |',
      '|      | continued |',
      '+------+-----------+',
      '| Ann  | short     |',
      '+------+-----------+',
    ].join('\n')
    expect(lines(normalizeAiMarkdown(md))).toEqual([
      '| Name | Note |', '| --- | --- |', '| Bob | first continued |', '| Ann | short |',
    ])
  })
})

describe('normalizeAiMarkdown — code fences', () => {
  it('unwraps a table the model put in a plain fence', () => {
    const md = 'Result:\n\n```\n| A | B |\n|---|---|\n| 1 | 2 |\n```'
    expect(normalizeAiMarkdown(md)).not.toContain('```')
    expect(normalizeAiMarkdown(md)).toContain('| A | B |')
  })

  it('never touches a real code block', () => {
    const md = '```ts\nconst x = a | b\n| not | a table |\n```'
    expect(normalizeAiMarkdown(md)).toBe(md)
  })

  it('leaves a fence with non-table content alone', () => {
    const md = '```\necho hi\n| A | B |\n```'
    expect(normalizeAiMarkdown(md)).toBe(md)
  })
})

describe('normalizeAiMarkdown — prose', () => {
  it('turns unicode bullets into list items', () => {
    expect(normalizeAiMarkdown('• one\n• two')).toBe('- one\n- two')
  })

  it('adds the missing space after a heading marker', () => {
    expect(normalizeAiMarkdown('##Summary')).toBe('## Summary')
  })

  it('does not turn "#1" into a heading', () => {
    expect(normalizeAiMarkdown('#1 priority')).toBe('#1 priority')
  })
})

describe('normalizeAiMarkdown — streaming', () => {
  it('closes a fence that has not finished arriving', () => {
    const out = normalizeAiMarkdown('Code:\n```js\nconst a = 1', { streaming: true })
    expect(out.trimEnd().endsWith('```')).toBe(true)
  })

  it('hides a half-received trade plan instead of showing raw JSON', () => {
    const out = normalizeAiMarkdown('Plan:\n```trade-plan\n{"symbol":"XAU', { streaming: true })
    expect(out).not.toContain('XAU')
  })

  it('does not close fences when the message is complete', () => {
    const md = 'Code:\n```js\nconst a = 1'
    expect(normalizeAiMarkdown(md)).toBe(md)
  })
})

describe('callouts', () => {
  it('rewrites GitHub alert markers into a readable label', () => {
    expect(normalizeAiMarkdown('> [!WARNING]\n> Stop loss is wide.')).toBe('> **Warning**\n> Stop loss is wide.')
    expect(normalizeAiMarkdown('> [!tip] Use limits.')).toBe('> **Tip:** Use limits.')
  })

  it('recognises a labelled quote as a callout', () => {
    expect(calloutKind('Warning: high volatility')).toBe('warning')
    expect(calloutKind('Tip — buy the dip')).toBe('tip')
    expect(calloutKind('Note')).toBe('note')
    expect(calloutKind('Notebooks are great')).toBe(null)
    expect(calloutKind('To be or not to be')).toBe(null)
  })
})

describe('cellTone', () => {
  it('colours signed changes', () => {
    expect(cellTone('+2.4%')).toBe('up')
    expect(cellTone('-1.10%')).toBe('down')
    expect(cellTone('−$35')).toBe('down')
    expect(cellTone('2.4%')).toBe(null)
  })

  it('colours verdicts and statuses', () => {
    expect(cellTone('Yes')).toBe('good')
    expect(cellTone('✅')).toBe('good')
    expect(cellTone('Bearish')).toBe('bad')
    expect(cellTone('❌ No')).toBe('bad')
    expect(cellTone('Neutral')).toBe('warn')
  })

  it('leaves ordinary text alone', () => {
    expect(cellTone('Python')).toBe(null)
    expect(cellTone('')).toBe(null)
    expect(cellTone('Yes, but only on weekends when the market is closed')).toBe(null)
  })
})
