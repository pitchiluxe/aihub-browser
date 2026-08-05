import { describe, it, expect } from 'vitest'
import {
  slugifyContainerId, partitionFor, addContainer, removeContainer, findContainer,
  DEFAULT_PARTITION, DEFAULT_CONTAINERS, type Container,
} from './containers'

describe('slugifyContainerId', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyContainerId('Work Stuff')).toBe('work-stuff')
    expect(slugifyContainerId('  Client  Ω  Work ')).toBe('client-work')
  })
  it('never returns an empty slug', () => {
    expect(slugifyContainerId('')).toBe('container')
    expect(slugifyContainerId('!!!')).toBe('container')
  })
  it('caps the length', () => {
    expect(slugifyContainerId('x'.repeat(100)).length).toBeLessThanOrEqual(32)
  })
})

describe('partitionFor', () => {
  it('uses the main partition when no container is set', () => {
    expect(partitionFor(null)).toBe(DEFAULT_PARTITION)
    expect(partitionFor(undefined)).toBe(DEFAULT_PARTITION)
    expect(partitionFor('')).toBe(DEFAULT_PARTITION)
  })

  it('namespaces every container away from the default jar', () => {
    expect(partitionFor('work')).toBe('persist:container-work')
    // The dangerous case: a container literally named "main" must NOT land in
    // the default partition and merge two identities.
    expect(partitionFor('main')).toBe('persist:container-main')
    expect(partitionFor('main')).not.toBe(DEFAULT_PARTITION)
  })

  it('cannot be steered into another partition by punctuation', () => {
    expect(partitionFor('persist:main')).toBe('persist:container-persist-main')
    expect(partitionFor('../../main')).toBe('persist:container-main')
  })

  it('is stable — the same container always reaches the same cookies', () => {
    expect(partitionFor('Work')).toBe(partitionFor('work'))
  })
})

describe('addContainer', () => {
  const base: Container[] = [...DEFAULT_CONTAINERS]

  it('adds a container with a slug id', () => {
    const out = addContainer(base, 'Side Project', '#fff')
    expect(out).toHaveLength(base.length + 1)
    expect(out[out.length - 1]).toMatchObject({ id: 'side-project', name: 'Side Project' })
  })

  it('never reuses an existing id, which would share its cookie jar', () => {
    const out = addContainer(addContainer([], 'Work', '#1'), 'work', '#2')
    expect(out.map(c => c.id)).toEqual(['work', 'work-2'])
  })

  it('ignores a blank name', () => {
    expect(addContainer(base, '   ', '#fff')).toEqual(base)
  })

  it('trims very long names', () => {
    const out = addContainer([], 'y'.repeat(80), '#fff')
    expect(out[0].name).toHaveLength(24)
  })
})

describe('removeContainer / findContainer', () => {
  const list: Container[] = [{ id: 'work', name: 'Work', color: '#1' }, { id: 'home', name: 'Home', color: '#2' }]

  it('removes by id and leaves the rest alone', () => {
    expect(removeContainer(list, 'work').map(c => c.id)).toEqual(['home'])
    expect(removeContainer(list, 'missing')).toHaveLength(2)
  })

  it('finds by id, and returns null for no container', () => {
    expect(findContainer(list, 'home')?.name).toBe('Home')
    expect(findContainer(list, null)).toBeNull()
    expect(findContainer(list, 'nope')).toBeNull()
  })
})
