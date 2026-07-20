import React, { useMemo, useState } from 'react'

// Neutralize remote image sources so tracking pixels don't fire until the user
// opts in. Replaces src/srcset/background with data-* holders we can restore.
function blockRemoteImages(html: string): string {
  return html
    .replace(/\ssrc=/gi, ' data-blocked-src=')
    .replace(/\ssrcset=/gi, ' data-blocked-srcset=')
    .replace(/background=/gi, 'data-blocked-background=')
}
function restoreImages(html: string): string {
  return html
    .replace(/\sdata-blocked-src=/gi, ' src=')
    .replace(/\sdata-blocked-srcset=/gi, ' srcset=')
    .replace(/data-blocked-background=/gi, 'background=')
}

export default function EmailFrame({ html, plain }: { html: string; plain: string }) {
  // Images load automatically when an email is opened. (A "Hide images"
  // control isn't offered — the user asked for automatic display.)
  const [showImages, setShowImages] = useState(true)
  const [height, setHeight] = useState(200)
  const hasHtml = !!html.trim()

  // Iframes never auto-size to their content, so without this every email
  // gets clipped to the fallback minHeight. `allow-same-origin` (still no
  // allow-scripts) is what lets us read contentDocument at all — sandbox=""
  // alone makes the frame an opaque origin the parent can't introspect.
  // CSP inside the doc (default-src 'none') means nothing executes either way.
  const measure = (e: React.SyntheticEvent<HTMLIFrameElement>) => {
    try {
      const doc = e.currentTarget.contentDocument
      const h = doc?.documentElement?.scrollHeight || doc?.body?.scrollHeight || 0
      if (h) setHeight(h + 24)
    } catch { /* cross-origin read blocked — keep fallback height */ }
  }

  const srcDoc = useMemo(() => {
    if (!hasHtml) return ''
    const body = showImages ? restoreImages(html) : blockRemoteImages(html)
    // CSP blocks scripts + any resource load except images (only present once opted in).
    const csp = `default-src 'none'; img-src ${showImages ? 'https: data:' : "data:"}; style-src 'unsafe-inline'; font-src data:;`
    return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}">` +
      `<base target="_blank"><style>body{font-family:sans-serif;color:#111;background:#fff;margin:12px;} img{max-width:100%;}</style></head>` +
      `<body>${body}</body></html>`
  }, [html, showImages, hasHtml])

  if (!hasHtml) {
    return <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, color: 'rgb(var(--ds-text-2))' }}>{plain}</pre>
  }
  return (
    <div>
      {!showImages && /data-blocked-src=|data-blocked-srcset=|data-blocked-background=/i.test(blockRemoteImages(html)) && (
        <button onClick={() => setShowImages(true)}
          style={{ marginBottom: 8, padding: '4px 10px', fontSize: 12, borderRadius: 8, cursor: 'pointer',
            background: 'rgb(var(--ds-accent) / 0.12)', color: 'rgb(var(--ds-accent-soft))', border: '1px solid rgb(var(--ds-accent) / 0.25)' }}>
          Show remote images
        </button>
      )}
      <iframe
        title="email-body"
        // allow-popups lets a link (rendered with <base target="_blank">) fire
        // a new-window request, which the window-open handler turns into a new
        // app tab. Without it the click was silently swallowed by the sandbox.
        // Still no allow-scripts, so nothing in the email can run code.
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={srcDoc}
        onLoad={measure}
        style={{ width: '100%', height, border: 'none', background: '#fff', borderRadius: 8 }}
      />
    </div>
  )
}
