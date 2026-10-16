import { describe, it, expect } from 'vitest'
import { extractDocumentPaths, documentBriefing, hasReadDocument, MAX_AUTO_READ } from './agentAutoRead'

describe('hasReadDocument', () => {
  it('spots a read_file digest and ignores other tools', () => {
    expect(hasReadDocument([{ toolLog: '- web_search jobs → …' }, { toolLog: '- read_file C:\\r.pdf → ERICK' }])).toBe(true)
    expect(hasReadDocument([{ toolLog: '- web_search jobs → …' }, {}])).toBe(false)
  })
})

describe('documentBriefing', () => {
  it('puts the user request after the document data', () => {
    const text = documentBriefing([{ tool: 'read_file', path: 'C:\\r.pdf', text: 'IAM Engineer, Entra ID' }], 'Find me a job')
    expect(text.indexOf('IAM Engineer')).toBeLessThan(text.indexOf('Find me a job'))
    expect(text).not.toMatch(/failed/)
  })

  it('names a failed read so the model cannot pretend', () => {
    const text = documentBriefing([{ tool: 'read_file', path: 'C:\\r.pdf', error: 'not found' }], 'x')
    expect(text).toContain('Reading C:\\r.pdf failed')
  })
})

describe('extractDocumentPaths', () => {
  it('finds a Windows path at the end of a sentence', () => {
    expect(extractDocumentPaths('Check my resume in C:\\Users\\erick\\Documents\\Erick_Omari_Engineer_Resume.pdf'))
      .toEqual(['C:\\Users\\erick\\Documents\\Erick_Omari_Engineer_Resume.pdf'])
  })

  it('keeps spaces inside folder names and drops trailing punctuation', () => {
    expect(extractDocumentPaths('Read C:\\Users\\me\\My Documents\\cv.docx, then find jobs.'))
      .toEqual(['C:\\Users\\me\\My Documents\\cv.docx'])
  })

  it('handles quoted, home-relative and Unix paths', () => {
    expect(extractDocumentPaths('use "~/Resumes/resume.md" and /Users/me/notes.txt'))
      .toEqual(['~/Resumes/resume.md', '/Users/me/notes.txt'])
  })

  it('ignores URLs, non-document files and plain prose', () => {
    expect(extractDocumentPaths('see https://example.com/file.pdf or C:\\tools\\setup.exe')).toEqual([])
    expect(extractDocumentPaths('What should I learn for IAM?')).toEqual([])
  })

  it('does not stop at an extension-like prefix', () => {
    expect(extractDocumentPaths('C:\\docs\\a.mdx')).toEqual([])
  })

  it('deduplicates and caps the count', () => {
    const many = Array.from({ length: 5 }, (_, i) => `C:\\d\\f${i}.pdf`).join(' ')
    expect(extractDocumentPaths(`C:\\d\\a.pdf c:/d/A.pdf`)).toEqual(['C:\\d\\a.pdf'])
    expect(extractDocumentPaths(many)).toHaveLength(MAX_AUTO_READ)
  })
})
