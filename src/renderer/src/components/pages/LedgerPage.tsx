import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Receipt, Download, Loader2, RefreshCw, Repeat, FileText, ExternalLink, AlertCircle,
} from 'lucide-react'
import { useBrowserStore } from '../../store/browserStore'
import {
  buildReceiptQuery, looksLikeReceipt, parseAmount, merchantFrom,
  totalsByCurrency, detectRecurring, sortEntries, toLedgerCsv,
  type ReceiptEntry,
} from '../../../../shared/receipts'
import type { ThreadRow } from '../../services/mailService'

/**
 * The Ledger — what you actually spent, assembled from mail you were already
 * sent.
 *
 * Purchase confirmations arrive as email and their invoices arrive as PDFs in
 * Downloads, and nothing ever puts the two together. This browser is the one
 * place where the mailbox, the downloads folder and a reader for both already
 * live in the same process, so it can answer "what did I spend" without any of
 * it leaving the machine. It reads receipts; it never touches a bank.
 *
 * Rows the parser is not sure about are dropped rather than guessed at — a
 * wrong number in a ledger is worse than a missing one, because a missing one
 * is visible.
 */
export default function LedgerPage() {
  const downloads = useBrowserStore(s => s.downloads)
  const [status, setStatus] = useState<{ connected?: boolean } | null>(null)
  const [entries, setEntries] = useState<ReceiptEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [months, setMonths] = useState(3)
  const [scanned, setScanned] = useState(0)

  useEffect(() => {
    window.electronAPI.gmail.status()
      .then((s: any) => setStatus(s || { connected: false }))
      .catch(() => setStatus({ connected: false }))
  }, [])

  const load = async () => {
    setLoading(true); setError('')
    try {
      const res = await window.electronAPI.gmail.listThreads(buildReceiptQuery(months))
      const threads: ThreadRow[] = res?.threads || res?.data?.threads || res || []
      setScanned(threads.length)

      const found: ReceiptEntry[] = []
      for (const t of threads) {
        if (!looksLikeReceipt(t.subject || '', t.snippet || '')) continue
        const money = parseAmount(`${t.subject || ''} ${t.snippet || ''}`)
        if (!money) continue
        const when = Date.parse(t.date || '')
        found.push({
          id: t.id,
          threadId: t.id,
          merchant: merchantFrom(t.from || '', t.subject || ''),
          amount: money.amount,
          currency: money.currency,
          date: Number.isFinite(when) ? when : Date.now(),
          subject: t.subject || '',
        })
      }
      setEntries(sortEntries(found))
    } catch (e: any) {
      setError(e?.message || 'Could not read your mail.')
    } finally {
      setLoading(false)
    }
  }

  const totals = useMemo(() => totalsByCurrency(entries), [entries])
  const recurring = useMemo(() => new Set(detectRecurring(entries).map(m => m.toLowerCase())), [entries])

  // An invoice PDF sitting in Downloads that names the same merchant. Matching
  // on the merchant name is deliberately loose: it is offered as a link to
  // check, never used to change a figure.
  const invoiceFor = (merchant: string) => {
    const needle = merchant.toLowerCase().split(/\s+/)[0]
    if (!needle || needle.length < 4) return null
    return downloads.find(d =>
      d.state === 'completed' &&
      /\.pdf$/i.test(d.filename) &&
      d.filename.toLowerCase().includes(needle)) || null
  }

  const exportCsv = async () => {
    await window.electronAPI.file.saveText({
      filename: `ledger-${new Date().toISOString().slice(0, 10)}.csv`,
      content: toLedgerCsv(entries),
    })
  }

  if (status && !status.connected) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 bg-aihub-bg text-aihub-muted text-center px-8">
        <Receipt size={40} className="opacity-20" />
        <p className="text-sm text-aihub-text font-medium">The Ledger needs your mailbox</p>
        <p className="text-xs max-w-md opacity-80">
          Receipts are read from your own Gmail, on this machine. Connect Google
          in Settings and come back — nothing is sent anywhere, and no bank or
          card is ever involved.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-aihub-bg text-aihub-text overflow-hidden">
      <div className="px-8 pt-8 pb-4 border-b border-aihub-border/30">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Receipt size={20} className="text-aihub-accent" /> Ledger
            </h1>
            <p className="text-sm text-aihub-muted mt-0.5">
              {entries.length
                ? `${entries.length} receipts from ${scanned} messages`
                : 'Assembled from purchase mail in your own mailbox'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={months}
              onChange={e => setMonths(Number(e.target.value))}
              className="px-3 py-2 rounded-xl bg-aihub-card/60 border border-aihub-border/30 text-sm outline-none"
            >
              <option value={1}>Last month</option>
              <option value={3}>Last 3 months</option>
              <option value={6}>Last 6 months</option>
              <option value={12}>Last year</option>
            </select>
            <button onClick={load} disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-aihub-accent/15 border border-aihub-accent/30 text-aihub-accent text-sm font-medium disabled:opacity-50">
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {loading ? 'Reading…' : 'Read receipts'}
            </button>
            {entries.length > 0 && (
              <button onClick={exportCsv}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-aihub-card/60 border border-aihub-border/30 text-sm">
                <Download size={14} /> CSV
              </button>
            )}
          </div>
        </div>

        {Object.keys(totals).length > 0 && (
          <div className="flex items-center gap-6 mt-4">
            {Object.entries(totals).map(([cur, total]) => (
              <div key={cur}>
                <div className="text-xs text-aihub-muted uppercase tracking-wide">{cur} total</div>
                <div className="text-xl font-bold">{total.toFixed(2)}</div>
              </div>
            ))}
            {recurring.size > 0 && (
              <div>
                <div className="text-xs text-aihub-muted uppercase tracking-wide flex items-center gap-1">
                  <Repeat size={11} /> Recurring
                </div>
                <div className="text-xl font-bold">{recurring.size}</div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-4">
        {error && (
          <div className="flex items-center gap-2 p-4 rounded-xl bg-red-500/10 border border-red-500/25 text-red-400 text-sm mb-4">
            <AlertCircle size={15} /> {error}
          </div>
        )}

        {!entries.length && !loading && !error && (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-aihub-muted text-center">
            <Receipt size={40} className="opacity-20" />
            <p className="text-sm">{scanned ? 'No receipts found in that window' : 'Press “Read receipts” to build the ledger'}</p>
          </div>
        )}

        <div className="space-y-2">
          {entries.map((e, i) => {
            const invoice = invoiceFor(e.merchant)
            const isSub = recurring.has(e.merchant.toLowerCase())
            return (
              <motion.div
                key={e.id}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.02, 0.3) }}
                className="flex items-center gap-4 p-4 rounded-2xl bg-aihub-card/60 border border-aihub-border/30"
              >
                <div className="w-20 shrink-0 text-xs text-aihub-muted">
                  {new Date(e.date).toLocaleDateString()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{e.merchant}</span>
                    {isSub && (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-aihub-accent/15 text-aihub-accent">
                        <Repeat size={9} /> recurring
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-aihub-muted truncate">{e.subject}</div>
                </div>
                {invoice && (
                  <button
                    onClick={() => window.electronAPI.downloads.openFile(invoice.savePath)}
                    title={`Open ${invoice.filename}`}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-aihub-muted hover:text-aihub-text hover:bg-aihub-card shrink-0"
                  >
                    <FileText size={11} /> invoice
                  </button>
                )}
                <div className="w-28 text-right shrink-0">
                  <div className="text-sm font-semibold tabular-nums">{e.amount.toFixed(2)}</div>
                  <div className="text-[10px] text-aihub-muted">{e.currency}</div>
                </div>
              </motion.div>
            )
          })}
        </div>

        {entries.length > 0 && (
          <p className="text-center text-xs text-aihub-muted mt-6 flex items-center justify-center gap-1">
            <ExternalLink size={10} />
            Messages the parser could not read an amount from are left out rather than guessed at
          </p>
        )}
      </div>
    </div>
  )
}
