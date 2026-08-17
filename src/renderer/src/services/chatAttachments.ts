// Attaching a picture to a chat message.
//
// Images travel as data URLs, because that is the one form both providers can
// be given (see src/main/visionMessages.ts) and the one form that survives
// being saved to the conversation archive and read back later. The cost of
// that convenience is size: base64 is a third larger than the file, the whole
// thing sits in the prompt, and a modern phone photo is several megabytes. So
// everything here is about keeping what is sent small enough to be answered.

export interface Attachment {
  /** `data:image/png;base64,…` */
  dataUrl: string
  name: string
  /** Bytes of the decoded image, after any downscale. */
  bytes: number
}

export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp']
export const ACCEPT_ATTR = ACCEPTED_TYPES.join(',')

/** Per image, before downscaling. Beyond this it is a file, not a screenshot. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024
/** Per message. Four screenshots is a lot to ask a model to hold at once. */
export const MAX_IMAGES = 4
/** Longest edge after downscaling. Enough to read UI text in a screenshot. */
export const MAX_EDGE = 1280

export type Rejection = 'type' | 'size' | 'count'

export function rejectionMessage(kind: Rejection, name?: string): string {
  switch (kind) {
    case 'type': return `${name || 'That file'} is not an image — PNG, JPEG, WebP, GIF and BMP work.`
    case 'size': return `${name || 'That image'} is too large. Images up to 20 MB can be attached.`
    case 'count': return `Up to ${MAX_IMAGES} images per message.`
  }
}

/** Pure gate, so the rules are testable without a File or a canvas. */
export function checkFile(
  file: { name?: string; type?: string; size?: number },
  alreadyAttached: number,
): Rejection | null {
  if (alreadyAttached >= MAX_IMAGES) return 'count'
  const type = String(file?.type || '').toLowerCase()
  if (!ACCEPTED_TYPES.includes(type)) return 'type'
  if ((file?.size ?? 0) > MAX_FILE_BYTES) return 'size'
  return null
}

/** Roughly how many bytes a base64 data URL decodes to. */
export function dataUrlBytes(dataUrl: string): number {
  const i = String(dataUrl || '').indexOf(',')
  if (i < 0) return 0
  const b64 = dataUrl.slice(i + 1)
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding)
}

/** The size to draw at: shrink to fit MAX_EDGE, never enlarge. */
export function scaledSize(width: number, height: number, maxEdge = MAX_EDGE): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (!longest || longest <= maxEdge) return { width, height }
  const k = maxEdge / longest
  return { width: Math.round(width * k), height: Math.round(height * k) }
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

/**
 * Shrink a picture to something a model can actually be asked about.
 *
 * A 12-megapixel photo is ~16 MB of base64 in the prompt and buys nothing: the
 * models downsample it anyway, and on a local model every extra kilobyte is
 * seconds of prompt processing. GIFs are left alone — re-drawing one to a
 * canvas throws away the animation and keeps only the first frame, which is a
 * silent, surprising edit of the user's file.
 */
export async function downscale(dataUrl: string, type: string, maxEdge = MAX_EDGE): Promise<string> {
  if (type === 'image/gif') return dataUrl
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('decode failed'))
      el.src = dataUrl
    })
    const size = scaledSize(img.naturalWidth || img.width, img.naturalHeight || img.height, maxEdge)
    if (size.width === (img.naturalWidth || img.width)) return dataUrl
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return dataUrl
    ctx.drawImage(img, 0, 0, size.width, size.height)
    // JPEG for photographs, PNG for anything with transparency — a screenshot
    // re-encoded as JPEG turns crisp UI text into mush.
    const out = type === 'image/jpeg'
      ? canvas.toDataURL('image/jpeg', 0.85)
      : canvas.toDataURL('image/png')
    return out.length < dataUrl.length ? out : dataUrl
  } catch {
    // A picture that will not decode here is still worth sending — the model
    // may well handle a format this renderer does not.
    return dataUrl
  }
}

/** A File (or a pasted Blob) turned into something sendable. */
export async function toAttachment(file: File, maxEdge = MAX_EDGE): Promise<Attachment> {
  const raw = await readAsDataUrl(file)
  const dataUrl = await downscale(raw, file.type, maxEdge)
  return { dataUrl, name: file.name || 'image', bytes: dataUrlBytes(dataUrl) }
}

/** Every image on a clipboard event, in paste order. */
export function imagesFromClipboard(items: DataTransferItemList | null | undefined): File[] {
  const out: File[] = []
  for (const item of Array.from(items || [])) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file) out.push(file)
  }
  return out
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
