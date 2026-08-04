import { describe, it, expect } from 'vitest'
import { PAGE_REFERENCE, FILE_REFERENCE, REFUSAL, wantedTools, selectBookmarksForPrompt } from './assistantIntent'

// These patterns decide whether the assistant reaches for a tool or answers
// from thin air. The failure they exist to prevent: the model replying "I
// don't have direct access to job boards, please paste your resume".
describe('page references', () => {
  it('catches the ways people point at what is on screen', () => {
    for (const msg of [
      'Use the current page open',
      'fill in the application currently open',
      'answer these questions for me based on my resume',
      'summarize this page',
      'what does this form want',
      'It is currently open',
    ]) expect(PAGE_REFERENCE.test(msg), msg).toBe(true)
  })

  it('does not fire on unrelated chat', () => {
    for (const msg of ['what is the capital of Kenya', 'write me a python script', 'thanks!']) {
      expect(PAGE_REFERENCE.test(msg), msg).toBe(false)
    }
  })
})

describe('file references', () => {
  it('catches paths and the documents people name', () => {
    for (const msg of [
      'find C:\\Users\\erick\\Downloads\\Erick_Omari_Resume.pdf',
      'read ~/Documents/cv.docx',
      'apply for jobs based on my resume',
      'use my cover letter',
      'organise my downloads folder',
    ]) expect(FILE_REFERENCE.test(msg), msg).toBe(true)
  })
})

describe('refusal detection', () => {
  it('recognises the chatbot brush-off', () => {
    for (const reply of [
      "I don't have direct access to job boards or company websites.",
      "Since I'm a large language model, I can't open files on your computer.",
      'Please provide me with the content of that PDF and I will help.',
      "I can only guide you through the process, not fill out applications.",
      'I cannot see the current page.',
      "I'm unable to browse the internet.",
    ]) expect(REFUSAL.test(reply), reply).toBe(true)
  })

  it('leaves honest, specific limitations alone', () => {
    for (const reply of [
      'That PDF is a scan with no text layer — send me the .docx and I will read it.',
      'The page needs you to log in first; tell me when you are in and I will continue.',
      'I filled every field. Confirm and I will submit it.',
    ]) expect(REFUSAL.test(reply), reply).toBe(false)
  })
})

describe('wantedTools', () => {
  it('names the tool the model should have used', () => {
    expect(wantedTools('Can you apply for me jobs based on my resume find C:\\Users\\erick\\Downloads\\r.pdf'))
      .toMatch(/read_file/)
    expect(wantedTools('Use the current page open')).toMatch(/read_page/)
    expect(wantedTools('find my tax documents')).toMatch(/find_files/)
    expect(wantedTools('what is 2 + 2')).toBeNull()
  })
})

describe('selectBookmarksForPrompt', () => {
  const bm = (title: string, url: string) => ({ title, url, category: 'x' })
  const many = [
    bm('Bible', 'aihub://bible'),
    bm('Mail', 'aihub://mail'),
    ...Array.from({ length: 220 }, (_, i) => bm(`Site ${i}`, `https://site${i}.com`)),
    bm('Indeed', 'https://www.indeed.com'),
  ]

  it('keeps every bookmark when the list is already small', () => {
    const few = many.slice(0, 10)
    expect(selectBookmarksForPrompt(few, 'anything', 25)).toHaveLength(10)
  })

  it('caps a large list', () => {
    expect(selectBookmarksForPrompt(many, 'hello', 25)).toHaveLength(25)
  })

  it('includes the bookmark the message actually names', () => {
    const picked = selectBookmarksForPrompt(many, 'open indeed and search jobs', 25)
    expect(picked.map(b => b.title)).toContain('Indeed')
  })

  it("always keeps AIHub's own pages", () => {
    const titles = selectBookmarksForPrompt(many, 'unrelated question', 25).map(b => b.title)
    expect(titles).toContain('Bible')
    expect(titles).toContain('Mail')
  })

  it('cuts the prompt cost dramatically for a real profile', () => {
    const full = many.map(b => `- ${b.title} [x]: ${b.url}`).join('\n').length
    const trimmed = selectBookmarksForPrompt(many, 'hi', 25).map(b => `- ${b.title} [x]: ${b.url}`).join('\n').length
    expect(trimmed).toBeLessThan(full / 5)
  })
})
