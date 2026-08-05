import { describe, it, expect } from 'vitest'
import { extensionOf, categorize, subfolderFor } from './downloadSorting'

describe('extensionOf', () => {
  it('reads the extension without the dot, lowercased', () => {
    expect(extensionOf('Report.PDF')).toBe('pdf')
    expect(extensionOf('archive.tar.gz')).toBe('gz')
  })
  it('is empty for files with no extension', () => {
    expect(extensionOf('LICENSE')).toBe('')
    expect(extensionOf('')).toBe('')
  })
  it('is not fooled by dots in the folder path', () => {
    expect(extensionOf('C:/my.files/report')).toBe('')
  })
})

describe('categorize', () => {
  it('files the everyday types where a person would', () => {
    expect(categorize('invoice.pdf')).toBe('Documents')
    expect(categorize('cat.JPG')).toBe('Images')
    expect(categorize('clip.mp4')).toBe('Video')
    expect(categorize('song.flac')).toBe('Audio')
    expect(categorize('bundle.zip')).toBe('Archives')
    expect(categorize('AIHub-Browser-1.30.0-win-x64.exe')).toBe('Installers')
    expect(categorize('script.ts')).toBe('Code')
  })

  it('falls back to Other for the unknown and the extensionless', () => {
    expect(categorize('mystery.qqq')).toBe('Other')
    expect(categorize('README')).toBe('Other')
  })

  it('treats an AppImage as an installer regardless of case', () => {
    expect(categorize('AIHub-Browser-1.30.0-linux-x86_64.AppImage')).toBe('Installers')
  })
})

describe('subfolderFor', () => {
  it('names the folder for a recognised type', () => {
    expect(subfolderFor('invoice.pdf')).toBe('Documents')
  })
  it('leaves unrecognised files at the top level rather than hiding them', () => {
    expect(subfolderFor('mystery.qqq')).toBeNull()
    expect(subfolderFor('README')).toBeNull()
  })
})
