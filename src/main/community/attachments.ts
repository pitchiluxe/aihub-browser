import crypto from 'crypto'
import fs from 'fs'
import { join } from 'path'
import { app, nativeImage, protocol, net } from 'electron'
import { MAX_ATTACHMENT_BYTES, type Attachment } from '../../shared/community'
import { sniffMime, isAllowedAttachment, extensionFor } from '../../shared/fileTypes'

/**
 * Where attachments live, and how they get there.
 *
 * Two rules hold the whole design up.
 *
 * The renderer never writes to disk. It hands this module the bytes and gets
 * back a record; it never learns a path, never picks a filename, and never
 * touches the directory. A renderer that could choose where a file lands is a
 * renderer that can write anywhere the app can.
 *
 * Files are named by the hash of their contents, never by the name they
 * arrived with. That removes path traversal as a category rather than
 * defending against it — there is no user-supplied string anywhere near the
 * filesystem call — and it means two people posting the same screenshot cost
 * one file.
 */

export const ATTACHMENT_SCHEME = 'aihub-community-file'

/** `<64 hex>.<ext>` and nothing else. Anything that does not match this is not
 *  a filename this module ever produced, so it is refused without inspection. */
const STORED_NAME = /^[0-9a-f]{64}\.[a-z0-9]{2,5}$/

export function attachmentsDir(): string {
  return join(app.getPath('userData'), 'community-files')
}

function ensureDir(): string {
  const dir = attachmentsDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

export type SaveResult =
  | { ok: true; attachment: Attachment }
  | { ok: false; error: string }

/**
 * Validate and store one uploaded file.
 *
 * Order matters here. Size is checked first because it is free; the type is
 * decided from the bytes before anything else looks at the file; and images are
 * re-encoded rather than copied, which drops EXIF (including the GPS tag a
 * phone photo carries) and discards anything that failed to decode as an image
 * in the first place.
 *
 * GIF and WebP are stored as they arrived. Re-encoding them through nativeImage
 * would flatten an animation to its first frame, which is a real loss for a
 * chat, and neither format is executed by anything — the magic-byte check is
 * what protects them.
 */
export async function saveAttachment(bytes: Uint8Array, displayName: string): Promise<SaveResult> {
  if (!bytes?.length) return { ok: false, error: 'That file is empty.' }
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: `Files must be under ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB.` }
  }

  const mime = sniffMime(bytes)
  if (!mime || !isAllowedAttachment(mime)) {
    // One message for unrecognised, refused and truncated alike. Saying which
    // only tells an uploader which probe got closest.
    return { ok: false, error: 'That kind of file cannot be shared here.' }
  }

  let stored: Buffer = Buffer.from(bytes)
  let width: number | undefined
  let height: number | undefined

  if (mime === 'image/png' || mime === 'image/jpeg') {
    const image = nativeImage.createFromBuffer(stored)
    if (image.isEmpty()) return { ok: false, error: 'That image could not be read.' }
    const size = image.getSize()
    width = size.width
    height = size.height
    stored = mime === 'image/png' ? image.toPNG() : image.toJPEG(90)
  } else if (mime === 'image/gif' || mime === 'image/webp') {
    const image = nativeImage.createFromBuffer(stored)
    if (!image.isEmpty()) {
      const size = image.getSize()
      width = size.width
      height = size.height
    }
  }

  const sha256 = crypto.createHash('sha256').update(stored).digest('hex')
  const filename = `${sha256}.${extensionFor(mime)}`
  const path = join(ensureDir(), filename)

  try {
    // Written once. An identical file already on disk is the same bytes by
    // definition, so re-writing it would only risk truncating something another
    // message still points at.
    if (!fs.existsSync(path)) await fs.promises.writeFile(path, stored)
  } catch {
    return { ok: false, error: 'That file could not be saved.' }
  }

  return {
    ok: true,
    attachment: {
      id: sha256.slice(0, 16),
      // Kept for display only. It never reaches the filesystem, which is why a
      // name like "../../evil" is inert rather than dangerous.
      name: String(displayName ?? 'file').slice(0, 120),
      mime,
      bytes: stored.length,
      sha256,
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
    },
  }
}

/** The URL the renderer puts in an <img> or <video> src. */
export function attachmentUrl(attachment: Attachment): string {
  return `${ATTACHMENT_SCHEME}://${attachment.sha256}.${extensionFor(attachment.mime)}`
}

/**
 * Must run before app.whenReady().
 *
 * Registered as standard and secure so pages can load these URLs the way they
 * load any other image, without Chromium treating them as an opaque origin.
 * Not marked corsEnabled: nothing should be fetching these cross-origin.
 */
export function registerAttachmentScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: ATTACHMENT_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  }])
}

/**
 * Serve attachments, and only attachments.
 *
 * The guard is an allowlist on the shape of the name rather than a check that
 * the resolved path sits inside the directory. Both work; this one is easier to
 * be sure about, because a name that is not 64 hex characters plus a short
 * extension never reaches a filesystem call at all.
 */
export function registerAttachmentProtocol(): void {
  protocol.handle(ATTACHMENT_SCHEME, async request => {
    let name = ''
    try {
      const url = new URL(request.url)
      name = decodeURIComponent(`${url.hostname}${url.pathname}`).replace(/\/+$/, '')
    } catch {
      return new Response('Bad request', { status: 400 })
    }

    if (!STORED_NAME.test(name)) return new Response('Not found', { status: 404 })

    const path = join(attachmentsDir(), name)
    if (!fs.existsSync(path)) return new Response('Not found', { status: 404 })

    return net.fetch(`file://${path.replace(/\\/g, '/')}`)
  })
}

/**
 * Delete stored files no message refers to any more.
 *
 * Called after a purge. Content-addressed storage means a file is shared by
 * every message that posted it, so "is anyone still using this" is the only
 * safe question to ask before removing one.
 */
export function pruneAttachments(referenced: Set<string>): number {
  let removed = 0
  let names: string[] = []
  try { names = fs.readdirSync(attachmentsDir()) } catch { return 0 }

  for (const name of names) {
    if (!STORED_NAME.test(name)) continue
    const sha256 = name.slice(0, 64)
    if (referenced.has(sha256)) continue
    try { fs.unlinkSync(join(attachmentsDir(), name)); removed++ } catch {}
  }
  return removed
}
