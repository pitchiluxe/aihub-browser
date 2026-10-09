import { describe, it, expect, beforeEach } from 'vitest'
import {
  addToList, clearList, createList, deleteList, FAVORITES_ID, isFavorite, moveItem, queueStore, QUEUE_ID,
  removeAt, setRepeat, startList, stopList, takeNext, toggleFavorite,
} from './ytQueue'
import { ytTrackFrom } from './libraryData'

const yt = (n: number) => ytTrackFrom({ id: `vid${String(n).padStart(8, '0')}`, title: `Song ${n}`, artist: `Artist ${n}` })
const items = (id = QUEUE_ID) => queueStore.get().lists.find(l => l.id === id)!.items

describe('YouTube queue', () => {
  beforeEach(() => { clearList(QUEUE_ID); clearList(FAVORITES_ID); setRepeat(false); stopList() })

  it('adds YouTube songs once and ignores local files', () => {
    expect(addToList([yt(1), yt(2)])).toBe(2)
    expect(addToList([yt(2), yt(3)])).toBe(1)
    const local = { ...yt(4), youtubeId: undefined }
    expect(addToList([local])).toBe(0)
    expect(items().map(i => i.title)).toEqual(['Song 1', 'Song 2', 'Song 3'])
  })

  it('plays through a list in order and stops at the end', () => {
    addToList([yt(1), yt(2)])
    startList(QUEUE_ID)
    expect(takeNext()?.title).toBe('Song 1')
    expect(takeNext()?.title).toBe('Song 2')
    expect(takeNext()).toBeUndefined()
    expect(queueStore.get().playing).toBeNull()
  })

  it('wraps around on repeat', () => {
    addToList([yt(1), yt(2)])
    setRepeat(true)
    startList(QUEUE_ID, 1)
    expect(takeNext()?.title).toBe('Song 2')
    expect(takeNext()?.title).toBe('Song 1')
  })

  it('keeps the play position when an earlier song is removed', () => {
    addToList([yt(1), yt(2), yt(3)])
    startList(QUEUE_ID)
    takeNext()
    takeNext()
    removeAt(QUEUE_ID, 0)
    expect(takeNext()?.title).toBe('Song 3')
  })

  it('reorders songs', () => {
    addToList([yt(1), yt(2), yt(3)])
    moveItem(QUEUE_ID, 2, 0)
    expect(items().map(i => i.title)).toEqual(['Song 3', 'Song 1', 'Song 2'])
  })

  it('hearts and un-hearts favourites', () => {
    const t = yt(7)
    expect(toggleFavorite(t)).toBe(true)
    expect(isFavorite(t.youtubeId)).toBe(true)
    expect(toggleFavorite(t)).toBe(false)
    expect(isFavorite(t.youtubeId)).toBe(false)
  })

  it('creates and deletes playlists but never the built-in ones', () => {
    const id = createList('Sunday set')
    expect(queueStore.get().activeId).toBe(id)
    deleteList(id)
    deleteList(QUEUE_ID)
    expect(queueStore.get().lists.map(l => l.id)).toEqual([QUEUE_ID, FAVORITES_ID])
    expect(queueStore.get().activeId).toBe(QUEUE_ID)
  })
})
