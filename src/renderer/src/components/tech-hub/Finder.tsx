import { useEffect, useMemo, useRef, useState } from 'react'
import { CornerDownLeft, GraduationCap, Search, UserRound } from 'lucide-react'
import { TOOLS, type ToolId } from './DevToolbox'
import { SECTIONS, type SectionId } from './sections'

export type FinderAction =
  | { kind: 'section'; id: SectionId }
  | { kind: 'tool'; id: ToolId }
  | { kind: 'role'; track: number; role: string }
  | { kind: 'ask'; topic: string }

type Item = { key: string; label: string; detail: string; icon: typeof Search; action: FinderAction; haystack: string }

export default function Finder({ tracks, onPick, onClose }: {
  tracks: { name: string; roles: string[] }[]
  onPick: (action: FinderAction) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  useEffect(() => { input.current?.focus() }, [])

  const all = useMemo<Item[]>(() => [
    ...SECTIONS.map(section => ({ key: `s:${section.id}`, label: section.label, detail: section.blurb, icon: section.icon,
      action: { kind: 'section', id: section.id } as const, haystack: `${section.label} ${section.blurb} ${section.keywords}` })),
    ...TOOLS.map(tool => ({ key: `t:${tool.id}`, label: `${tool.label} tool`, detail: tool.hint, icon: tool.icon,
      action: { kind: 'tool', id: tool.id } as const, haystack: `${tool.label} ${tool.hint} toolbox utility` })),
    ...tracks.flatMap((track, index) => track.roles.map(role => ({ key: `r:${role}`, label: role, detail: `Switch focus · ${track.name}`, icon: UserRound,
      action: { kind: 'role', track: index, role } as const, haystack: `${role} ${track.name} role career` }))),
  ], [tracks])

  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const items = useMemo(() => {
    // Items whose own name matches rank above ones that only match a keyword,
    // so "subnet" lands on the Subnet tool rather than the toolbox section.
    const rank = (item: Item) => terms.filter(term => item.label.toLowerCase().includes(term)).length
    const matches = terms.length
      ? all.filter(item => terms.every(term => item.haystack.toLowerCase().includes(term))).sort((a, b) => rank(b) - rank(a))
      : all.filter(item => item.action.kind !== 'role')
    const ask: Item[] = query.trim() ? [{ key: 'ask', label: `Ask the tutor: “${query.trim()}”`, detail: 'Explanation, cheat sheet or quiz', icon: GraduationCap,
      action: { kind: 'ask', topic: query.trim() }, haystack: '' }] : []
    return [...matches.slice(0, 12), ...ask]
  }, [all, terms.join(' '), query]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setCursor(0) }, [query])
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }) }, [cursor])

  return <div className="th-finder-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="th-finder" role="dialog" aria-modal="true" aria-label="Find anything in Tech Hub">
      <div className="th-finder-input">
        <Search size={17} aria-hidden="true" />
        <input ref={input} value={query} onChange={event => setQuery(event.target.value)} maxLength={160}
          placeholder="Find a tool, role or topic…" aria-label="Search Tech Hub" role="combobox" aria-expanded="true" aria-controls="th-finder-list"
          onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); onClose() }
            else if (event.key === 'ArrowDown') { event.preventDefault(); setCursor(c => Math.min(items.length - 1, c + 1)) }
            else if (event.key === 'ArrowUp') { event.preventDefault(); setCursor(c => Math.max(0, c - 1)) }
            else if (event.key === 'Enter' && items[cursor]) { event.preventDefault(); onPick(items[cursor].action) }
          }} />
        <kbd>esc</kbd>
      </div>
      <ul id="th-finder-list" role="listbox" ref={list}>
        {items.map((item, index) => {
          const Icon = item.icon
          return <li key={item.key} role="option" aria-selected={index === cursor} onMouseEnter={() => setCursor(index)} onClick={() => onPick(item.action)}>
            <Icon size={16} aria-hidden="true" /><span><strong>{item.label}</strong><small>{item.detail}</small></span>
            {index === cursor && <CornerDownLeft size={14} aria-hidden="true" />}
          </li>
        })}
        {!items.length && <li className="th-finder-empty">Type to search.</li>}
      </ul>
    </div>
  </div>
}
