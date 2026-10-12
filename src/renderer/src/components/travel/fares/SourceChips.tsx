import React from 'react'
import { Check, Loader2, ShieldAlert, Clock, AlertTriangle, ExternalLink, Database } from 'lucide-react'
import type { SiteState } from './useFareSearch'

const TEXT: Record<SiteState['status'], string> = {
  loading: 'searching…', done: 'offers', cached: 'cached', blocked: 'needs a human check',
  unreadable: "couldn't read", empty: 'no flights', timeout: 'timed out', error: 'failed',
}

export default function SourceChips({ sites, onOpenSite, onOpenVisible }: { sites: SiteState[]; onOpenSite: (url: string) => void; onOpenVisible: (url: string) => void }) {
  return <div className="fare-chips" role="status" aria-live="polite">
    {sites.map(s => {
      const icon = s.status === 'loading' ? <Loader2 size={13} className="fare-spin" />
        : s.status === 'done' ? <Check size={13} /> : s.status === 'cached' ? <Database size={13} />
        : s.status === 'blocked' ? <ShieldAlert size={13} /> : s.status === 'timeout' ? <Clock size={13} /> : <AlertTriangle size={13} />
      const ok = s.status === 'done' || s.status === 'cached'
      return <span key={s.site} className={`fare-chip is-${s.status}`}>
        {icon}<b>{s.label}</b>
        <span>{ok ? `${s.count} ${TEXT[s.status]}` : TEXT[s.status]}</span>
        {s.status === 'blocked' && <button onClick={() => onOpenVisible(s.url)}>Open for a human check</button>}
        {['unreadable', 'timeout', 'error', 'empty'].includes(s.status) && <button onClick={() => onOpenSite(s.url)}>Open site <ExternalLink size={11} /></button>}
      </span>
    })}
  </div>
}
