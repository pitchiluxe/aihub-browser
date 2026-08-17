import { describe, it, expect } from 'vitest'
import {
  countImages, forOllama, forOpenRouter, hasImages, looksVisionCapable,
  pickVisionModel, stripDataUrl, withoutImages, type PortableMessage,
} from './visionMessages'

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

const conversation: PortableMessage[] = [
  { role: 'system', content: 'You are helpful.' },
  { role: 'user', content: 'What is in this?', images: [PNG] },
  { role: 'assistant', content: 'A cat.' },
]

describe('stripDataUrl', () => {
  it('removes the prefix Ollama would otherwise decode as image data', () => {
    expect(stripDataUrl(PNG)).toBe('iVBORw0KGgo=')
    expect(stripDataUrl(JPG)).toBe('/9j/4AAQSkZJRg==')
  })

  it('leaves bare base64 alone', () => {
    expect(stripDataUrl('iVBORw0KGgo=')).toBe('iVBORw0KGgo=')
  })

  it('does not throw on nonsense', () => {
    expect(stripDataUrl('')).toBe('')
    expect(stripDataUrl(undefined as any)).toBe('')
  })
})

describe('detection', () => {
  it('spots a conversation carrying a picture', () => {
    expect(hasImages(conversation)).toBe(true)
    expect(countImages(conversation)).toBe(1)
  })

  it('says no for plain text, an empty array, and nothing at all', () => {
    expect(hasImages([{ role: 'user', content: 'hi' }])).toBe(false)
    expect(hasImages([{ role: 'user', content: 'hi', images: [] }])).toBe(false)
    expect(hasImages([])).toBe(false)
  })
})

describe('forOllama', () => {
  const out = forOllama(conversation)

  it('keeps images as a sibling field, stripped of the data-URL prefix', () => {
    expect(out[1]).toEqual({ role: 'user', content: 'What is in this?', images: ['iVBORw0KGgo='] })
  })

  it('leaves text-only messages byte-identical, with no empty images key', () => {
    expect(out[0]).toEqual({ role: 'system', content: 'You are helpful.' })
    expect('images' in out[0]).toBe(false)
  })

  it('does not mutate the messages it was given', () => {
    expect(conversation[1].images).toEqual([PNG])
  })

  it('carries every image, not just the first', () => {
    const many = forOllama([{ role: 'user', content: 'these', images: [PNG, JPG] }])
    expect(many[0].images).toHaveLength(2)
  })
})

describe('forOpenRouter', () => {
  const out = forOpenRouter(conversation)

  it('inlines the picture into a content parts array', () => {
    expect(out[1]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'What is in this?' },
        { type: 'image_url', image_url: { url: PNG } },
      ],
    })
  })

  it('puts the text before the image', () => {
    expect(out[1].content[0].type).toBe('text')
  })

  it('keeps the data-URL prefix, which this API wants', () => {
    expect(out[1].content[1].image_url.url).toMatch(/^data:image\/png;base64,/)
  })

  it('omits the text part entirely rather than sending an empty one', () => {
    const bare = forOpenRouter([{ role: 'user', content: '   ', images: [PNG] }])
    expect(bare[0].content).toHaveLength(1)
    expect(bare[0].content[0].type).toBe('image_url')
  })

  it('leaves text-only messages as plain strings', () => {
    expect(out[2]).toEqual({ role: 'assistant', content: 'A cat.' })
  })
})

describe('withoutImages', () => {
  it('says out loud that a picture was attached and could not be read', () => {
    const out = withoutImages(conversation)
    expect(out[1].images).toBeUndefined()
    expect(out[1].content).toContain('What is in this?')
    expect(out[1].content).toMatch(/cannot see images/i)
  })

  it('counts them correctly in the note', () => {
    expect(withoutImages([{ role: 'user', content: 'x', images: [PNG, JPG] }])[0].content).toMatch(/attached 2 images/)
    expect(withoutImages([{ role: 'user', content: 'x', images: [PNG] }])[0].content).toMatch(/attached 1 image,/)
  })

  it('leaves text-only turns untouched', () => {
    expect(withoutImages(conversation)[0]).toEqual({ role: 'system', content: 'You are helpful.' })
  })
})

describe('picking a model that can see', () => {
  it('recognises the common vision families on both providers', () => {
    for (const id of ['llava:13b', 'llama3.2-vision:11b', 'qwen/qwen2.5-vl-72b-instruct', 'openai/gpt-4o', 'moondream', 'gemma3:4b']) {
      expect(looksVisionCapable(id), id).toBe(true)
    }
  })

  it('does not claim a text-only model can see', () => {
    for (const id of ['llama3.2:3b', 'deepseek-r1:7b', 'mistral:latest', 'qwen3-coder', '']) {
      expect(looksVisionCapable(id), id).toBe(false)
    }
  })

  it('keeps the configured model when it can already see', () => {
    expect(pickVisionModel(['llama3.2:3b', 'llava:13b'], 'llava:13b')).toBe('llava:13b')
  })

  it('finds an installed one when the configured model cannot', () => {
    expect(pickVisionModel(['llama3.2:3b', 'llava:13b'], 'llama3.2:3b')).toBe('llava:13b')
  })

  it('returns nothing when the machine has no vision model at all', () => {
    expect(pickVisionModel(['llama3.2:3b', 'mistral'], 'llama3.2:3b')).toBe('')
    expect(pickVisionModel([])).toBe('')
  })
})
