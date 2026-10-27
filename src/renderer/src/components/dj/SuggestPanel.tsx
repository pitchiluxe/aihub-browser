/**
 * NEXT — the song suggester's menu: three picks for what is on air, with the
 * reason, phrase-exact hot cues and a loop, a mashup pair for decks C + D, an
 * FX macro timed to the breakdown, the floor energy that orders them, and
 * push-to-talk filtering of the collection.
 */
import React, { useSyncExternalStore } from 'react'
import { ArrowLeftRight, ChevronLeft, ChevronRight, Layers, Loader2, Mic, RefreshCw, Wand2, X, Zap } from 'lucide-react'
import type { DjEngine } from './engine/DjEngine'
import { fmtMs, type SuggestionEngine } from './suggest/suggestEngine'
import type { CandidateFilter, FxStep, Pick } from './suggest/types'
import './suggest/suggest.css'

interface Props { suggester: SuggestionEngine; engine: DjEngine; visible: boolean }

const DIR_LABEL = { step_up: '▲ Step up', hold: '■ Hold', cool_down: '▼ Cool down' } as const
const REL_LABEL: Record<string, string> = {
  perfect: 'Same key', adjacent: '±1', relative: 'Rel. maj/min', 'diagonal-up': 'Diagonal ↗', 'diagonal-down': 'Diagonal ↘',
  boost: '+2 boost', semitone: '+7 lift', parallel: 'Parallel', unknown: 'Key ?',
}

function filterChips(f: CandidateFilter | null): string[] {
  if (!f) return []
  const out: string[] = []
  if (f.genres?.length) out.push(f.genres.join(', '))
  if (f.bpmMin || f.bpmMax) out.push(`${f.bpmMin ?? '…'}–${f.bpmMax ?? '…'} BPM`)
  if (f.yearFrom || f.yearTo) out.push(`${f.yearFrom ?? '…'}–${f.yearTo ?? '…'}`)
  if (f.camelot?.length) out.push(f.camelot.join(' '))
  if (f.text) out.push(`“${f.text}”`)
  return out
}

function fxLine(s: FxStep): string {
  const at = `${s.atBeat > 0 ? '+' : ''}${s.atBeat}b`
  const what = s.action === 'sweep' ? `${s.fx} → ${s.value.toFixed(2)}${s.beats ? ` over ${s.beats}b` : ''}` : `${s.fx} ${s.action}${s.action === 'on' ? ` ${s.value.toFixed(2)}` : ''}`
  return `${at} ${what}`
}

export default function SuggestPanel({ suggester: s, engine, visible }: Props) {
  useSyncExternalStore(s.subscribe, s.getVersion)
  // Decks C and D: the mashup faders follow them.
  useSyncExternalStore(engine.decks.C.subscribe, engine.decks.C.getVersion)
  useSyncExternalStore(engine.decks.D.subscribe, engine.decks.D.getVersion)
  const now = s.now
  const floor = s.floor.get()
  const busy = s.status === 'querying' || s.status === 'thinking'
  const chips = filterChips(s.filter)
  const C = engine.decks.C, D = engine.decks.D

  return (
    <div className="dj-ai dj-sg" style={{ display: visible ? 'flex' : 'none' }}>
      <div className="dj-sg-now">
        {now ? (
          <>
            <b>{now.artist ? `${now.artist} – ` : ''}{now.title}</b>
            <span>
              {now.bpm.toFixed(1)} BPM · {now.camelot ?? 'key ?'}{now.energy != null ? ` · E ${Math.round(now.energy * 100)}` : ''}
              {now.genre ? ` · ${now.genre}` : ''}{now.year ? ` · ${now.year}` : ''} · deck {now.deck}
            </span>
          </>
        ) : <span>{s.status === 'waiting' ? 'Reading the tempo of the song on air…' : 'Nothing on air'}</span>}
        <button type="button" className="dj-icon-btn" disabled={!now || busy} onClick={() => void s.refresh(true)} title="Ask again">
          {busy ? <Loader2 size={12} className="dj-spin" /> : <RefreshCw size={12} />}
        </button>
      </div>

      <div className="dj-sg-row">
        <span className="dj-sg-k">FLOOR</span>
        <input type="range" min={0} max={100} value={Math.round((floor ?? now?.energy ?? 0.5) * 100)}
          onChange={e => s.setFloor(Number(e.target.value) / 100)} aria-label="Floor energy" />
        <span className={`dj-sg-dir dj-sg-${s.direction}`}>{DIR_LABEL[s.direction]}</span>
        {floor != null && s.floor.source === 'manual' && <button type="button" className="dj-icon-btn" title="Back to the track's own energy" onClick={() => s.setFloor(null)}><X size={11} /></button>}
      </div>
      <label className="dj-ai-keep" title={`POST {"energy": 0..1} to http://127.0.0.1:${s.floorFeed.port || 47800}/floor`}>
        <input type="checkbox" checked={s.floorFeed.on} onChange={e => void s.setFloorFeed(e.target.checked)} />
        <span>External floor feed{s.floorFeed.on ? ` · 127.0.0.1:${s.floorFeed.port}/floor` : ''}{s.floor.source && s.floor.source !== 'manual' ? ` · ${s.floor.source}` : ''}</span>
      </label>
      {s.floorFeed.error && <div className="dj-sg-err">{s.floorFeed.error}</div>}

      <div className="dj-sg-row">
        <button type="button" className={`dj-sg-mic ${s.voice.listening ? 'on' : ''}`} disabled={s.voice.busy}
          onPointerDown={e => { e.preventDefault(); void s.voiceStart() }} onPointerUp={() => void s.voiceStop()} onPointerLeave={() => { if (s.voice.listening) void s.voiceStop() }}
          title="Hold and speak: “only 90s house”, “faster”, “Wizkid”, “clear filters”">
          {s.voice.busy ? <Loader2 size={12} className="dj-spin" /> : <Mic size={12} />} {s.voice.listening ? 'Listening' : 'Hold to talk'}
        </button>
        <div className="dj-ai-chips dj-sg-chips">
          {chips.map(c => <span key={c}>{c}</span>)}
          {chips.length > 0 && <button type="button" onClick={() => s.setFilter(null)} title="Clear the filter"><X size={10} /></button>}
        </div>
      </div>
      {s.voice.transcript && <div className="dj-sg-dim">› {s.voice.transcript}</div>}
      {s.voice.error && <div className="dj-sg-err">{s.voice.error}</div>}
      {s.voice.error && /speech|server/i.test(s.voice.error) && (
        <form className="dj-sg-row" onSubmit={e => { e.preventDefault(); const v = new FormData(e.currentTarget).get('stt'); if (typeof v === 'string') void s.setSttUrl(v) }}>
          <input key={s.sttUrl} name="stt" className="dj-ai-input dj-sg-url" defaultValue={s.sttUrl} spellCheck={false} onKeyDown={e => e.stopPropagation()}
            placeholder="http://127.0.0.1:8080/inference" aria-label="Speech-to-text server URL" />
          <button type="submit" className="dj-sg-btn">Save</button>
        </form>
      )}

      <div className="dj-sg-opts">
        <label className="dj-ai-keep"><input type="checkbox" checked={s.pivots} onChange={e => s.setPivots(e.target.checked)} /> Pivot keys</label>
        <label className="dj-ai-keep"><input type="checkbox" checked={s.stems.enabled} onChange={e => s.setAutoStems(e.target.checked)} /> Auto stems</label>
        <span className="dj-sg-dim">{s.pool.length} in pool · {s.libraryCount} in library{s.ahead.length ? ` · ${s.ahead.length} ahead` : ''}</span>
      </div>
      {s.stems.status && <div className="dj-sg-dim">Stems: {s.stems.status}</div>}

      {s.history.length > 1 && (
        <div className="dj-sg-hist">
          <button type="button" className="dj-icon-btn" disabled={!s.canPrev} onClick={() => s.step(-1)} title="Previous suggestions"><ChevronLeft size={13} /> Prev</button>
          <span>
            {s.viewing + 1} / {s.history.length}
            {s.shownFor && s.shownFor.id !== now?.id ? ` · for ${s.shownFor.artist ? `${s.shownFor.artist} – ` : ''}${s.shownFor.title}` : ''}
          </span>
          <button type="button" className="dj-icon-btn" disabled={!s.canNext} onClick={() => s.step(1)} title="Next (newer) suggestions">Next <ChevronRight size={13} /></button>
        </div>
      )}

      {s.error && <div className="dj-sg-err">{s.error}</div>}
      {s.status === 'thinking' && !s.ordered.length && <div className="dj-ai-status" role="status"><Loader2 size={11} className="dj-spin" /> <span>Local model is choosing…</span></div>}

      <div className="dj-sg-list">
        {s.ordered.map((p, i) => <PickCard key={p.entry.id} n={i + 1} p={p} s={s} />)}

        {s.result?.mashup && (
          <div className="dj-sg-card dj-sg-mash">
            <div className="dj-sg-h"><Layers size={11} /> MASHUP · C + D</div>
            {s.result.mashup.entries.map((e, i) => (
              <div key={e.id} className="dj-sg-t"><small>{i ? 'D rhythm' : 'C vocal'}</small> {e.artist ? `${e.artist} – ` : ''}{e.title} <span className="dj-sg-dim">{e.bpm.toFixed(0)} · {e.camelot ?? '?'}</span></div>
            ))}
            <div className="dj-sg-why">{s.result.mashup.rationale}</div>
            {s.mashupOn ? (
              <div className="dj-sg-row">
                <span className="dj-sg-k">C</span><input type="range" min={0} max={100} value={Math.round(C.volume * 100)} onChange={e => C.setVolume(Number(e.target.value) / 100)} aria-label="Deck C level" />
                <span className="dj-sg-k">D</span><input type="range" min={0} max={100} value={Math.round(D.volume * 100)} onChange={e => D.setVolume(Number(e.target.value) / 100)} aria-label="Deck D level" />
                <button type="button" className="dj-icon-btn" onClick={() => s.stopMashup()} title="Stop the layers"><X size={11} /></button>
              </div>
            ) : (
              <button type="button" className="dj-sg-btn" onClick={() => void s.mashup()}>Layer on C + D</button>
            )}
          </div>
        )}

        {s.result && s.result.fx.length > 0 && (
          <div className="dj-sg-card">
            <div className="dj-sg-h"><Wand2 size={11} /> FX MACRO · {now ? `breakdown ${fmtMs(now.breakdownSec * 1000)}` : ''}</div>
            <div className="dj-sg-fx">{s.result.fx.map((f, i) => <span key={i}>{fxLine(f)}</span>)}</div>
            {s.fx.armed
              ? <button type="button" className="dj-sg-btn on" onClick={() => s.disarmFx()}>Disarm</button>
              : <button type="button" className="dj-sg-btn" onClick={() => s.armFx()}><Zap size={11} /> Arm on deck {now?.deck}</button>}
          </div>
        )}
      </div>
      {s.result && <div className="dj-sg-dim dj-sg-src">{s.result.provider === 'library' ? 'Library ranking (model unavailable)' : `${s.result.provider}${s.result.model ? ` · ${s.result.model}` : ''}`}</div>}
    </div>
  )
}

function PickCard({ n, p, s }: { n: number; p: Pick; s: SuggestionEngine }) {
  const e = p.entry
  return (
    <div className="dj-sg-card">
      <div className="dj-sg-t"><i>{n}</i> <b>{e.artist ? `${e.artist} – ` : ''}{e.title}</b></div>
      <div className="dj-sg-meta">
        <span>{e.bpm.toFixed(1)} BPM ({e.pitchPct > 0 ? '+' : ''}{e.pitchPct.toFixed(1)}%)</span>
        <span>{e.camelot ?? '?'} · {REL_LABEL[e.relation]}</span>
        <span>E {p.energyRating}/10</span>
        {e.year ? <span>{e.year}</span> : null}
        {p.gainTrimDb ? <span>{p.gainTrimDb > 0 ? '+' : ''}{p.gainTrimDb} dB</span> : null}
        {p.stems.isolate !== 'none' && <span>{p.stems.isolate} · {p.stems.deck}</span>}
      </div>
      <div className="dj-sg-why">{p.rationale}</div>
      <div className="dj-sg-cues">
        {p.cues.map((c, i) => <span key={i} title={`${c.ms} ms`}><b>{i + 1}</b> {c.label} {fmtMs(c.ms)}</span>)}
        {p.loop && <span title={`${p.loop.startMs}–${p.loop.endMs} ms`}><b>L</b> {fmtMs(p.loop.startMs)}–{fmtMs(p.loop.endMs)}</span>}
      </div>
      <div className="dj-sg-acts">
        <button type="button" onClick={() => void s.load(p, 'A')} title="Load on deck A with its cues">A</button>
        <button type="button" onClick={() => void s.load(p, 'B')} title="Load on deck B with its cues">B</button>
        <button type="button" onClick={() => void s.load(p)} title="Load on the free deck across the mixer">Load</button>
        <button type="button" onClick={() => void s.mix(p)} title="Mix it in now"><ArrowLeftRight size={11} /> Mix</button>
      </div>
    </div>
  )
}
