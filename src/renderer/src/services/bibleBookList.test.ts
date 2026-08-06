import { describe, it, expect } from 'vitest'
import { bookListOptions, COVER_OPTION, getBooks } from './bibleService'

describe('bookListOptions — what the reader sees in the book dropdown', () => {
  const options = bookListOptions()

  it('puts the cover first, before Genesis', () => {
    expect(options[0].value).toBe(COVER_OPTION)
    expect(options[0].isCover).toBe(true)
    expect(options[1].label).toMatch(/^Genesis/i)
  })

  it('labels the cover so it reads as the front of the book', () => {
    expect(options[0].label).toMatch(/cover/i)
  })

  it('lists every book after it, in scripture order', () => {
    const books = getBooks()
    expect(options).toHaveLength(books.length + 1)
    expect(options.slice(1).map(o => o.value)).toEqual(books.map(b => b.id))
  })

  it('marks only the cover as the cover — the rest are real books', () => {
    expect(options.filter(o => o.isCover)).toHaveLength(1)
  })

  it('uses a sentinel that can never collide with a real book id', () => {
    expect(getBooks().some(b => b.id === COVER_OPTION)).toBe(false)
  })

  it('ends at Revelation, so nothing was dropped by prepending', () => {
    expect(options[options.length - 1].label).toMatch(/revelation/i)
  })
})
