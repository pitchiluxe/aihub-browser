import React, { useCallback, useRef, useState } from 'react'
import { ImagePlus, X } from 'lucide-react'
import {
  ACCEPT_ATTR, checkFile, formatBytes, imagesFromClipboard, rejectionMessage,
  toAttachment, type Attachment,
} from '../../services/chatAttachments'

// The attach-an-image half of a composer: the button, the pending thumbnails,
// and the paste/drop handlers. Split out so every chat surface gets identical
// behaviour — a screenshot pasted into Agent Mode must work exactly the way it
// does in the assistant panel.

export function useImageAttachments() {
  const [images, setImages] = useState<Attachment[]>([])
  const [error, setError] = useState('')
  // The list is read between awaits (decoding one file while the next is being
  // checked), so state alone is a render behind. The ref is the truth; state is
  // the view of it.
  const ref = useRef<Attachment[]>([])

  const commit = (next: Attachment[]) => { ref.current = next; setImages(next) }

  const add = useCallback(async (files: File[] | FileList | null) => {
    const list = Array.from(files || [])
    if (!list.length) return
    setError('')
    for (const file of list) {
      // Checked one at a time against the running count, so dropping six
      // images attaches what fits and says why the rest were left behind.
      const problem = checkFile(file, ref.current.length)
      if (problem) { setError(rejectionMessage(problem, file.name)); continue }
      const attachment = await toAttachment(file).catch(() => null)
      if (!attachment) { setError(`${file.name} could not be read.`); continue }
      commit([...ref.current, attachment])
    }
  }, [])

  const remove = useCallback((index: number) => {
    commit(ref.current.filter((_, i) => i !== index))
    setError('')
  }, [])

  const clear = useCallback(() => { commit([]); setError('') }, [])

  const onPaste = useCallback((e: React.ClipboardEvent) => {
    const files = imagesFromClipboard(e.clipboardData?.items)
    if (!files.length) return
    e.preventDefault()
    void add(files)
  }, [add])

  const onDrop = useCallback((e: React.DragEvent) => {
    const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'))
    if (!files.length) return
    e.preventDefault()
    void add(files)
  }, [add])

  return { images, add, remove, clear, error, onPaste, onDrop, dataUrls: images.map(i => i.dataUrl) }
}

export function AttachImageButton({ onFiles, disabled, accent, size = 30 }: {
  onFiles: (files: FileList | null) => void
  disabled?: boolean
  accent?: string
  size?: number
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={ACCEPT_ATTR}
        multiple
        style={{ display: 'none' }}
        onChange={e => { onFiles(e.target.files); e.currentTarget.value = '' }}
      />
      <button
        onClick={() => input.current?.click()}
        disabled={disabled}
        title="Attach an image"
        style={{
          width: size, height: size, borderRadius: 10, flexShrink: 0, cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)',
          color: accent || 'rgb(var(--ds-text-4))', opacity: disabled ? 0.4 : 1, transition: 'all 0.12s',
        }}
      >
        <ImagePlus size={14} />
      </button>
    </>
  )
}

export function AttachmentStrip({ images, onRemove, error }: {
  images: Attachment[]
  onRemove: (index: number) => void
  error?: string
}) {
  if (!images.length && !error) return null
  return (
    <div style={{ marginBottom: 8 }}>
      {images.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {images.map((img, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <img
                src={img.dataUrl}
                alt={img.name}
                title={`${img.name} · ${formatBytes(img.bytes)}`}
                style={{
                  width: 54, height: 54, objectFit: 'cover', borderRadius: 9,
                  border: '1px solid var(--ds-border-sm)',
                }}
              />
              <button
                onClick={() => onRemove(i)}
                title="Remove"
                style={{
                  position: 'absolute', top: -5, right: -5, width: 17, height: 17, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                  background: 'rgba(15,17,22,0.95)', border: '1px solid var(--ds-border-sm)', color: '#f87171',
                }}
              >
                <X size={9} />
              </button>
            </div>
          ))}
        </div>
      )}
      {!!error && (
        <div style={{ marginTop: 5, fontSize: 10.5, color: '#f87171' }}>{error}</div>
      )}
    </div>
  )
}
