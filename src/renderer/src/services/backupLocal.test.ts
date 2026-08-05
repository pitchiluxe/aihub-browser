import { describe, it, expect } from 'vitest'
import { mergeLocalJsonArrays } from './backupLocal'

describe('mergeLocalJsonArrays', () => {
  it('brings across entries the new machine does not have', () => {
    const local = JSON.stringify([{ id: 't1', name: 'Mine' }])
    const incoming = JSON.stringify([{ id: 't2', name: 'Imported' }])
    expect(JSON.parse(mergeLocalJsonArrays(local, incoming)!)).toHaveLength(2)
  })

  it('keeps this machine version when both have the same id', () => {
    const local = JSON.stringify([{ id: 't1', name: 'Mine' }])
    const incoming = JSON.stringify([{ id: 't1', name: 'Theirs' }])
    const merged = JSON.parse(mergeLocalJsonArrays(local, incoming)!)
    expect(merged).toHaveLength(1)
    expect(merged[0].name).toBe('Mine')
  })

  it('imports onto a machine with nothing saved yet', () => {
    const incoming = JSON.stringify([{ id: 't1' }])
    expect(JSON.parse(mergeLocalJsonArrays(undefined, incoming)!)).toHaveLength(1)
  })

  it('survives corrupt storage on either side rather than losing both', () => {
    const good = JSON.stringify([{ id: 't1' }])
    expect(JSON.parse(mergeLocalJsonArrays('not json', good)!)).toHaveLength(1)
    expect(JSON.parse(mergeLocalJsonArrays(good, 'not json')!)).toHaveLength(1)
  })

  it('ignores values that are not arrays', () => {
    const good = JSON.stringify([{ id: 't1' }])
    expect(JSON.parse(mergeLocalJsonArrays(good, JSON.stringify({ id: 'x' }))!)).toHaveLength(1)
  })

  it('drops entries with no id instead of duplicating them forever', () => {
    const incoming = JSON.stringify([{ name: 'no id' }, { id: 't2' }])
    expect(JSON.parse(mergeLocalJsonArrays('[]', incoming)!)).toHaveLength(1)
  })

  it('returns the original when there is nothing to merge', () => {
    expect(mergeLocalJsonArrays(undefined, undefined)).toBeUndefined()
    expect(mergeLocalJsonArrays('[]', '[]')).toBe('[]')
  })
})
