/**
 * YouTube queue panel: playlists of YouTube songs saved while searching.
 * Play a list and Automix runs through it with crossfades, so the set moves
 * from artist to artist without stopping. "Mix now" blends any song in
 * straight away; songs can be dragged to reorder or onto a deck.
 */
import React, { useState, useSyncExternalStore } from 'react'
import { Play, Square, Shuffle, Repeat, Trash2, Plus, X, Heart, ArrowLeftRight, Pencil, Youtube, ListPlus } from 'lucide-react'
import type { DeckId, DjTrack } from './engine/DjEngine'
import { TRACK_MIME } from './DeckUI'
import { fmtTime } from './controls'
import { trackByToken } from './libraryData'
import {
  addToList, clearList, createList, deleteList, FAVORITES_ID, moveItem, queueStore, removeAt, renameList, setActiveList,
  setRepeat, shuffleList, startList, stopList, toggleFavorite, trackFrom, isFavorite,
} from './ytQueue'
import { recordTaste } from './taste'

const ITEM_MIME = 'application/x-aihub-dj-queue-index'

interface Props {
  visible: boolean
  automix: boolean
  setAutomix: (on: boolean) => void
  onLoad: (t: DjTrack, deck?: DeckId) => void
  mixNow: (t: DjTrack) => void
  say: (m: string) => void
}

export default function QueuePanel({ visible, automix, setAutomix, onLoad, mixNow, say }: Props) {
  const st = useSyncExternalStore(queueStore.subscribe, queueStore.get)
  const list = st.lists.find(l => l.id === st.activeId) ?? st.lists[0]
  const playingHere = st.playing?.listId === list.id && automix
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState('')
  const [dropAt, setDropAt] = useState<number | null>(null)

  const play = (index = 0) => {
    if (!list.items.length) { say('This list is empty — add songs from a YouTube search'); return }
    startList(list.id, index)
    setAutomix(true)
    say(`Playing ${list.name}`)
  }
  const stop = () => { stopList(); setAutomix(false) }

  const onDropItem = (e: React.DragEvent, at: number) => {
    e.preventDefault()
    setDropAt(null)
    const from = e.dataTransfer.getData(ITEM_MIME)
    if (from !== '') { moveItem(list.id, Number(from), at > Number(from) ? at - 1 : at); return }
    const t = trackByToken(e.dataTransfer.getData(TRACK_MIME))
    if (!t) return
    if (!t.youtubeId) { say('The YouTube queue holds YouTube songs — local files go in the set list'); return }
    if (addToList([t], list.id)) {
      recordTaste({ kind: 'queue', artist: t.artist, title: t.title, youtubeId: t.youtubeId })
      moveItem(list.id, list.items.length, at)
    }
  }

  return (
    <div className="dj-queue" style={{ display: visible ? 'flex' : 'none' }}>
      <div className="dj-queue-bar">
        {renaming ? (
          <input autoFocus className="dj-queue-name" value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { renameList(list.id, name); setRenaming(false) } if (e.key === 'Escape') setRenaming(false) }}
            onBlur={() => { renameList(list.id, name); setRenaming(false) }} />
        ) : (
          <select className="dj-queue-select" value={list.id} onChange={e => setActiveList(e.target.value)} aria-label="Playlist">
            {st.lists.map(l => <option key={l.id} value={l.id}>{l.id === FAVORITES_ID ? '♥ ' : ''}{l.name} ({l.items.length})</option>)}
          </select>
        )}
        <button type="button" className="dj-icon-btn" title="New playlist"
          onClick={() => { const n = window.prompt('Name the new playlist', 'My set'); if (n != null) createList(n) }}><Plus size={12} /></button>
        {!list.fixed && (
          <>
            <button type="button" className="dj-icon-btn" title="Rename" onClick={() => { setName(list.name); setRenaming(true) }}><Pencil size={11} /></button>
            <button type="button" className="dj-icon-btn" title="Delete playlist"
              onClick={() => { if (window.confirm(`Delete the playlist "${list.name}"?`)) deleteList(list.id) }}><Trash2 size={11} /></button>
          </>
        )}
      </div>

      <div className="dj-queue-actions">
        {playingHere
          ? <button type="button" className="dj-queue-play dj-on dj-on-orange" onClick={stop}><Square size={10} fill="currentColor" /> Stop</button>
          : <button type="button" className="dj-queue-play" onClick={() => play(0)} disabled={!list.items.length}><Play size={11} fill="currentColor" /> Play list</button>}
        <button type="button" className="dj-icon-btn" title="Shuffle what has not played yet" onClick={() => shuffleList(list.id)} disabled={list.items.length < 2}><Shuffle size={12} /></button>
        <button type="button" className={`dj-icon-btn ${st.repeat ? 'on' : ''}`} title={st.repeat ? 'Repeat is on' : 'Repeat the list'} onClick={() => setRepeat(!st.repeat)}><Repeat size={12} /></button>
        <button type="button" className="dj-icon-btn" title="Empty this list" disabled={!list.items.length}
          onClick={() => { if (window.confirm(`Remove every song from "${list.name}"?`)) clearList(list.id) }}><Trash2 size={12} /></button>
      </div>

      <div className="dj-queue-list"
        onDragOver={e => { if (e.dataTransfer.types.includes(TRACK_MIME) || e.dataTransfer.types.includes(ITEM_MIME)) { e.preventDefault(); setDropAt(list.items.length) } }}
        onDragLeave={e => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDropAt(null) }}
        onDrop={e => onDropItem(e, list.items.length)}>
        {list.items.length === 0 && (
          <div className="dj-side-empty">
            <Youtube size={26} />
            <p>Search YouTube in the browser and press <ListPlus size={11} style={{ verticalAlign: -1 }} /> on any song (or drag it here) to queue it.
              Play the list and Automix crossfades from song to song with no gaps.</p>
          </div>
        )}
        {list.items.map((it, i) => {
          const t = trackFrom(it)
          const next = playingHere && st.playing!.index === i
          const done = playingHere && i < st.playing!.index
          return (
            <div key={`${it.id}-${i}`} className={`dj-queue-item ${next ? 'dj-queue-next' : ''} ${done ? 'dj-queue-done' : ''} ${dropAt === i ? 'dj-queue-drop' : ''}`}
              draggable
              onDragStart={e => { e.dataTransfer.setData(TRACK_MIME, t.token); e.dataTransfer.setData(ITEM_MIME, String(i)); e.dataTransfer.effectAllowed = 'copyMove' }}
              onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDropAt(i) }}
              onDrop={e => { e.stopPropagation(); onDropItem(e, i) }}
              onDoubleClick={() => onLoad(t)}
              title={`${it.artist ? `${it.artist} – ` : ''}${it.title} — double-click to load, drag onto a deck`}>
              {it.cover ? <img src={it.cover} alt="" draggable={false} /> : <span className="dj-queue-ph"><Youtube size={12} /></span>}
              <div className="dj-queue-t">
                <b>{next ? '▶ ' : ''}{it.title}</b>
                <small>{it.artist}{it.duration ? ` · ${fmtTime(it.duration, false)}` : ''}</small>
              </div>
              <div className="dj-queue-acts">
                <button type="button" title="Mix it in now" onClick={() => {
                  // Jumping ahead in the list being played: carry on from after this song.
                  if (playingHere) startList(list.id, i + 1)
                  mixNow(t)
                }}><ArrowLeftRight size={11} /></button>
                <button type="button" title="Play from here" onClick={() => play(i)}><Play size={10} fill="currentColor" /></button>
                <button type="button" className={isFavorite(it.id) ? 'dj-fav-on' : ''} title={isFavorite(it.id) ? 'Remove from favourites' : 'Add to favourites'}
                  onClick={() => { if (toggleFavorite(t)) recordTaste({ kind: 'favorite', artist: t.artist, title: t.title, youtubeId: t.youtubeId }) }}>
                  <Heart size={11} fill={isFavorite(it.id) ? 'currentColor' : 'none'} />
                </button>
                <button type="button" title="Remove" onClick={() => removeAt(list.id, i)}><X size={11} /></button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
