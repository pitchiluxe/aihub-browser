import React, { useId, useMemo, useState } from 'react'
import { airportLabel, searchAirports, type Airport } from './airports'

export default function AirportInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const options = useMemo(() => searchAirports(value), [value])
  const expanded = open && value.trim().length > 0
  const pick = (airport: Airport) => { onChange(airportLabel(airport)); setOpen(false); setActive(-1) }
  return <div className="fare-airport">
    <label htmlFor={id}>{label}</label>
    <input id={id} role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={`${id}-options`}
      aria-describedby={`${id}-hint`}
      aria-activedescendant={expanded && active >= 0 ? `${id}-option-${active}` : undefined}
      required maxLength={150} autoComplete="off" value={value}
      onFocus={() => { setOpen(true); setActive(-1) }} onBlur={() => setOpen(false)}
      onChange={e => { onChange(e.target.value); setActive(-1); setOpen(true) }}
      onKeyDown={e => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); setOpen(true)
          setActive(i => options.length ? (e.key === 'ArrowDown' ? (i + 1) % options.length : i <= 0 ? options.length - 1 : i - 1) : -1)
        } else if (e.key === 'Enter' && expanded && active >= 0 && options[active]) { e.preventDefault(); pick(options[active]) }
        else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); setActive(-1) }
      }} />
    <small id={`${id}-hint`}>City, airport name, ICAO or IATA code · {label === 'From' ? 'KJFK / JFK' : 'LFPG / CDG'}</small>
    {expanded && <div className="fare-airport-options" id={`${id}-options`} role="listbox" aria-label={`${label} airports`}>
      {options.map((a, i) => <button type="button" role="option" aria-selected={active === i} id={`${id}-option-${i}`} key={a.iata}
        tabIndex={-1} onMouseDown={e => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pick(a)}>
        <strong>{a.iata}{a.icao && <span> · {a.icao}</span>}</strong><span>{a.name}</span><small>{a.city}{a.city ? ', ' : ''}{a.country}{!a.scheduled ? ' · No scheduled airline service listed' : ''}</small>
      </button>)}
      {!options.length && <p role="status">No matching airport. Try a city, airport name, ICAO or IATA code.</p>}
    </div>}
  </div>
}
