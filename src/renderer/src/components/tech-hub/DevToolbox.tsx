import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { Binary, Braces, Check, Clock, Copy, Fingerprint, Hash, KeyRound, Link2, Network, Regex, ShieldCheck, Wand2 } from 'lucide-react'
import {
  base64Decode, base64Encode, decodeJwt, formatJson, generatePassword, HASH_ALGORITHMS, hashText, parseTimestamp,
  passwordEntropy, PASSWORD_SETS, subnet, testRegex, urlDecode, type HashAlgorithm, type PasswordSet,
} from './devTools'
import { copyText } from './useTechHubState'

export const TOOLS = [
  { id: 'json', label: 'JSON', hint: 'Format, minify and validate', icon: Braces },
  { id: 'base64', label: 'Base64', hint: 'Encode and decode text', icon: Binary },
  { id: 'url', label: 'URL', hint: 'Percent-encode and decode', icon: Link2 },
  { id: 'jwt', label: 'JWT', hint: 'Inspect token claims', icon: KeyRound },
  { id: 'hash', label: 'Hash', hint: 'SHA-1 / 256 / 384 / 512', icon: Hash },
  { id: 'uuid', label: 'UUID', hint: 'Random v4 identifiers', icon: Fingerprint },
  { id: 'time', label: 'Timestamp', hint: 'Unix ↔ human dates', icon: Clock },
  { id: 'subnet', label: 'Subnet', hint: 'CIDR calculator', icon: Network },
  { id: 'regex', label: 'Regex', hint: 'Test patterns live', icon: Regex },
  { id: 'password', label: 'Password', hint: 'Strong random secrets', icon: ShieldCheck },
] as const
export type ToolId = typeof TOOLS[number]['id']

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return
    const timer = window.setTimeout(() => setDone(false), 1400)
    return () => window.clearTimeout(timer)
  }, [done])
  return <button type="button" className="th-btn th-btn-ghost" disabled={!text} onClick={() => void copyText(text).then(setDone)}>
    {done ? <Check size={14} /> : <Copy size={14} />} {done ? 'Copied' : label}
  </button>
}

function Output({ value, error, rows = 8 }: { value: string; error?: string; rows?: number }) {
  return <div className="th-tool-output">
    <div className="th-tool-output-bar"><span>{error ? 'stderr' : 'stdout'}</span>{!error && <CopyButton text={value} />}</div>
    {error ? <pre className="th-tool-error" role="alert">{error}</pre> : <textarea readOnly rows={rows} value={value} aria-label="Output" spellCheck={false} />}
  </div>
}

function KeyValues({ rows }: { rows: [string, string][] }) {
  return <dl className="th-kv">{rows.map(([key, value]) => <div key={key}><dt>{key}</dt><dd><code>{value}</code><CopyButton text={value} label="" /></dd></div>)}</dl>
}

function JsonTool() {
  const [input, setInput] = useState('{"role":"SOC Analyst","skills":["SIEM","KQL"],"remote":true}')
  const [indent, setIndent] = useState<0 | 2 | 4>(2)
  const result = formatJson(input, indent)
  return <>
    <textarea className="th-code-input" rows={8} value={input} onChange={e => setInput(e.target.value)} spellCheck={false} aria-label="JSON input" />
    <div className="th-chip-row" role="group" aria-label="Indentation">
      {([2, 4, 0] as const).map(n => <button key={n} className="th-chip" aria-pressed={indent === n} onClick={() => setIndent(n)}>{n ? `${n} spaces` : 'Minify'}</button>)}
      {result.ok && <span className="th-ok"><Check size={14} /> Valid JSON</span>}
    </div>
    <Output value={result.ok ? result.output : ''} error={result.ok ? undefined : result.error} />
  </>
}

function Base64Tool() {
  const [input, setInput] = useState('')
  const [decode, setDecode] = useState(false)
  const [urlSafe, setUrlSafe] = useState(false)
  const result = decode ? base64Decode(input) : { ok: true as const, output: input ? base64Encode(input, urlSafe) : '' }
  return <>
    <div className="th-chip-row" role="group" aria-label="Direction">
      <button className="th-chip" aria-pressed={!decode} onClick={() => setDecode(false)}>Encode</button>
      <button className="th-chip" aria-pressed={decode} onClick={() => setDecode(true)}>Decode</button>
      {!decode && <label className="th-check"><input type="checkbox" checked={urlSafe} onChange={e => setUrlSafe(e.target.checked)} /> URL-safe</label>}
    </div>
    <textarea className="th-code-input" rows={6} value={input} onChange={e => setInput(e.target.value)} spellCheck={false} aria-label="Base64 input" placeholder={decode ? 'Paste Base64…' : 'Type or paste text…'} />
    <Output value={result.ok ? result.output : ''} error={input && !result.ok ? result.error : undefined} rows={6} />
  </>
}

function UrlTool() {
  const [input, setInput] = useState('')
  const [decode, setDecode] = useState(false)
  const result = decode ? urlDecode(input) : { ok: true as const, output: encodeURIComponent(input) }
  return <>
    <div className="th-chip-row" role="group" aria-label="Direction">
      <button className="th-chip" aria-pressed={!decode} onClick={() => setDecode(false)}>Encode</button>
      <button className="th-chip" aria-pressed={decode} onClick={() => setDecode(true)}>Decode</button>
    </div>
    <textarea className="th-code-input" rows={5} value={input} onChange={e => setInput(e.target.value)} spellCheck={false} aria-label="URL input" placeholder="https://example.com/search?q=zero trust" />
    <Output value={result.ok ? result.output : ''} error={result.ok ? undefined : result.error} rows={5} />
  </>
}

function JwtTool() {
  const [input, setInput] = useState('')
  const result = input.trim() ? decodeJwt(input) : undefined
  return <>
    <p className="th-note">Decoding happens on this device and does <strong>not</strong> verify the signature. Never trust claims from an unverified token.</p>
    <textarea className="th-code-input" rows={4} value={input} onChange={e => setInput(e.target.value)} spellCheck={false} aria-label="JWT" placeholder="eyJhbGciOi…" />
    {result && !result.ok && <pre className="th-tool-error" role="alert">{result.error}</pre>}
    {result?.ok && <>
      {result.value.expiresAt !== undefined && <p className={result.value.expired ? 'th-bad' : 'th-ok'}>
        {result.value.expired ? 'Expired' : 'Expires'} {new Date(result.value.expiresAt).toLocaleString()}
      </p>}
      <div className="th-split">
        <Output value={JSON.stringify(result.value.header, null, 2)} rows={6} />
        <Output value={JSON.stringify(result.value.payload, null, 2)} rows={10} />
      </div>
    </>}
  </>
}

function HashTool() {
  const [input, setInput] = useState('')
  const [hashes, setHashes] = useState<Partial<Record<HashAlgorithm, string>>>({})
  useEffect(() => {
    let current = true
    void Promise.all(HASH_ALGORITHMS.map(async algorithm => [algorithm, await hashText(input, algorithm)] as const))
      .then(entries => { if (current) setHashes(Object.fromEntries(entries)) })
    return () => { current = false }
  }, [input])
  return <>
    <textarea className="th-code-input" rows={5} value={input} onChange={e => setInput(e.target.value)} spellCheck={false} aria-label="Text to hash" placeholder="Text to hash (UTF-8)…" />
    <KeyValues rows={HASH_ALGORITHMS.map(algorithm => [algorithm, hashes[algorithm] || '…'])} />
    <p className="th-note">SHA-1 is broken for collision resistance. Use it only to match legacy checksums. Hash passwords with a slow KDF such as Argon2 or bcrypt, never a bare SHA.</p>
  </>
}

function UuidTool() {
  const [count, setCount] = useState(5)
  const [seed, setSeed] = useState(0)
  const ids = useMemo(() => Array.from({ length: count }, () => crypto.randomUUID()), [count, seed]) // eslint-disable-line react-hooks/exhaustive-deps
  return <>
    <div className="th-chip-row">
      {[1, 5, 10, 25].map(n => <button key={n} className="th-chip" aria-pressed={count === n} onClick={() => setCount(n)}>{n}</button>)}
      <button className="th-btn" onClick={() => setSeed(n => n + 1)}><Wand2 size={14} /> Regenerate</button>
    </div>
    <Output value={ids.join('\n')} rows={Math.min(12, count + 1)} />
  </>
}

function TimeTool() {
  const [input, setInput] = useState(() => String(Math.floor(Date.now() / 1000)))
  const date = parseTimestamp(input)
  return <>
    <div className="th-inline-input">
      <input value={input} onChange={e => setInput(e.target.value)} aria-label="Timestamp or date" placeholder="1700000000, 1700000000000 or 2026-11-14T09:30" spellCheck={false} />
      <button className="th-btn" onClick={() => setInput(String(Math.floor(Date.now() / 1000)))}>Now</button>
    </div>
    {date ? <KeyValues rows={[
      ['Local', date.toLocaleString()],
      ['UTC', date.toUTCString()],
      ['ISO 8601', date.toISOString()],
      ['Unix seconds', String(Math.floor(date.getTime() / 1000))],
      ['Unix ms', String(date.getTime())],
    ]} /> : input.trim() && <pre className="th-tool-error" role="alert">Unrecognised date or timestamp.</pre>}
  </>
}

function SubnetTool() {
  const [input, setInput] = useState('192.168.10.37/26')
  const result = subnet(input)
  return <>
    <div className="th-inline-input">
      <input value={input} onChange={e => setInput(e.target.value)} aria-label="CIDR" placeholder="10.0.0.0/16 or 10.0.0.5 255.255.255.0" spellCheck={false} />
    </div>
    {result.ok ? <KeyValues rows={[
      ['Network', result.value.cidr], ['Subnet mask', result.value.mask], ['Wildcard', result.value.wildcard],
      ['Broadcast', result.value.broadcast], ['First host', result.value.firstHost], ['Last host', result.value.lastHost],
      ['Usable hosts', result.value.usableHosts.toLocaleString()], ['Total addresses', result.value.totalAddresses.toLocaleString()],
      ['Class', `${result.value.ipClass}${result.value.privateRange ? ' · private (RFC 1918)' : ''}`],
    ]} /> : <pre className="th-tool-error" role="alert">{result.error}</pre>}
  </>
}

function RegexTool() {
  const [pattern, setPattern] = useState('(\\d{1,3}\\.){3}\\d{1,3}')
  const [flags, setFlags] = useState('g')
  const [input, setInput] = useState('Failed login from 203.0.113.42 then 198.51.100.7 at 02:14')
  const result = testRegex(pattern, flags, input.slice(0, 20_000))
  return <>
    <div className="th-inline-input th-regex">
      <span aria-hidden="true">/</span>
      <input value={pattern} onChange={e => setPattern(e.target.value)} aria-label="Pattern" spellCheck={false} />
      <span aria-hidden="true">/</span>
      <input className="th-flags" value={flags} onChange={e => setFlags(e.target.value.replace(/[^dgimsuy]/g, ''))} aria-label="Flags" spellCheck={false} />
    </div>
    <textarea className="th-code-input" rows={5} value={input} onChange={e => setInput(e.target.value)} spellCheck={false} aria-label="Test text" />
    {result.ok ? <>
      <p className="th-note">{result.matches.length} match{result.matches.length === 1 ? '' : 'es'}{result.matches.length >= 200 ? ' (showing first 200)' : ''}</p>
      <ol className="th-matches">{result.matches.map((match, i) => <li key={`${match.index}-${i}`}>
        <code>{match.text || '∅'}</code><small>@{match.index}</small>
        {match.groups.map((group, g) => <small key={g}>${g + 1} = <code>{group}</code></small>)}
      </li>)}</ol>
    </> : <pre className="th-tool-error" role="alert">{result.error}</pre>}
  </>
}

function PasswordTool() {
  const [length, setLength] = useState(20)
  const [sets, setSets] = useState<PasswordSet[]>(['lower', 'upper', 'digits', 'symbols'])
  const [seed, setSeed] = useState(0)
  const password = useMemo(() => generatePassword(length, sets), [length, sets, seed]) // eslint-disable-line react-hooks/exhaustive-deps
  const bits = passwordEntropy(length, sets)
  return <>
    <div className="th-password"><code>{password || 'Pick at least one character set'}</code></div>
    <label className="th-range">Length <strong>{length}</strong>
      <input type="range" min={8} max={64} value={length} onChange={e => setLength(Number(e.target.value))} />
    </label>
    <div className="th-chip-row" role="group" aria-label="Character sets">
      {(Object.keys(PASSWORD_SETS) as PasswordSet[]).map(set => <button key={set} className="th-chip" aria-pressed={sets.includes(set)}
        onClick={() => setSets(current => current.includes(set) ? current.filter(item => item !== set) : [...current, set])}>{set}</button>)}
    </div>
    <div className="th-meter" aria-label={`About ${bits} bits of entropy`}>
      <span style={{ width: `${Math.min(100, bits / 1.28)}%` }} data-strength={bits >= 80 ? 'strong' : bits >= 60 ? 'ok' : 'weak'} />
    </div>
    <div className="th-chip-row">
      <span className="th-note">≈ {bits} bits · {bits >= 80 ? 'strong' : bits >= 60 ? 'fair' : 'weak'}</span>
      <button className="th-btn" onClick={() => setSeed(n => n + 1)}><Wand2 size={14} /> Regenerate</button>
      <CopyButton text={password} />
    </div>
  </>
}

const PANELS: Record<ToolId, ComponentType> = {
  json: JsonTool, base64: Base64Tool, url: UrlTool, jwt: JwtTool, hash: HashTool,
  uuid: UuidTool, time: TimeTool, subnet: SubnetTool, regex: RegexTool, password: PasswordTool,
}

export default function DevToolbox({ tool, onTool }: { tool: ToolId; onTool: (tool: ToolId) => void }) {
  const Panel = PANELS[tool]
  const active = TOOLS.find(item => item.id === tool)!
  return <div className="th-toolbox">
    <div className="th-tool-tabs" role="tablist" aria-label="Developer tools">
      {TOOLS.map(({ id, label, icon: Icon }) => <button key={id} role="tab" aria-selected={tool === id} onClick={() => onTool(id)}>
        <Icon size={15} aria-hidden="true" /> {label}
      </button>)}
    </div>
    <div className="th-tool-panel" role="tabpanel" aria-label={active.label}>
      <p className="th-tool-hint"><span>$ {active.id}</span> {active.hint} · runs offline, nothing leaves this device</p>
      <Panel key={tool} />
    </div>
  </div>
}
