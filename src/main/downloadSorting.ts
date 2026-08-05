import { extname } from 'path'

/**
 * AIHub Browser — filing downloads by what they are.
 *
 * A Downloads folder with 400 loose files is a folder nobody opens. Sorting by
 * extension into Documents / Images / Video / Audio / Archives / Installers /
 * Code puts a file where a person would have put it, and the mapping is a pure
 * function so the categories can be tested without touching a disk.
 */

export type DownloadCategory =
  | 'Documents' | 'Images' | 'Video' | 'Audio' | 'Archives' | 'Installers' | 'Code' | 'Other'

const BY_EXTENSION: Record<string, DownloadCategory> = {}
const define = (category: DownloadCategory, extensions: string[]) => {
  for (const ext of extensions) BY_EXTENSION[ext] = category
}

define('Documents', ['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'xls', 'xlsx', 'ods', 'csv', 'ppt', 'pptx', 'odp', 'epub', 'mobi'])
define('Images', ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'svg', 'avif', 'heic', 'ico', 'psd'])
define('Video', ['mp4', 'mkv', 'mov', 'avi', 'webm', 'wmv', 'flv', 'm4v', 'mpg', 'mpeg'])
define('Audio', ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus', 'aiff'])
define('Archives', ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'iso'])
define('Installers', ['exe', 'msi', 'dmg', 'pkg', 'deb', 'rpm', 'appimage', 'apk', 'msix'])
define('Code', ['js', 'ts', 'tsx', 'jsx', 'json', 'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'cs', 'php', 'sh', 'ps1', 'sql', 'yml', 'yaml', 'toml', 'xml', 'html', 'css'])

/** Extension of a filename, lowercase, without the dot. '' when there is none. */
export function extensionOf(filename: string): string {
  const ext = extname(String(filename || '')).toLowerCase()
  return ext.startsWith('.') ? ext.slice(1) : ext
}

export function categorize(filename: string): DownloadCategory {
  const ext = extensionOf(filename)
  if (!ext) return 'Other'
  // Compound archive extensions (.tar.gz) resolve on their last part, which the
  // table already covers — .gz is an archive.
  return BY_EXTENSION[ext] || 'Other'
}

/**
 * Where a download should be filed, relative to the downloads root. 'Other'
 * files stay put: burying an unrecognised file in a folder called "Other" is
 * how people lose downloads.
 */
export function subfolderFor(filename: string): string | null {
  const category = categorize(filename)
  return category === 'Other' ? null : category
}
