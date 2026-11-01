import React from 'react'
import { cartridgeHue } from '../../../../shared/games/romFolder'

// Original label art drawn from a title's theme. No box art, logos or
// characters are reproduced; each motif is a generic scene in AIHub's style.
type Motif = 'jet' | 'star' | 'glove' | 'visor' | 'speed' | 'city' | 'shell' | 'dragon' | 'night' | 'lamp' | 'volcano' | 'acorn' | 'carrot' | 'cheese' | 'girders' | 'court' | 'bolt' | 'blocks' | 'grid' | 'fist' | 'pipes'
const MOTIFS: [RegExp, Motif][] = [
  [/top gun|jet|wing|air|sky/i, 'jet'], [/ninja|gaiden|shinobi/i, 'star'], [/punch|boxing|tyson/i, 'glove'], [/robo|cop|cyber/i, 'visor'],
  [/sonic|hedgehog|knuckles|speed|racing/i, 'speed'], [/streets|rage|double dragon|final fight/i, 'city'], [/turtle/i, 'shell'], [/dragon/i, 'dragon'],
  [/batman|\bbats?\b|knight|vampire/i, 'night'], [/aladdin|genie|arabian/i, 'lamp'], [/flintstone|dino|stone age/i, 'volcano'], [/chip|dale|rescue|squirrel/i, 'acorn'],
  [/toon|bunny|rabbit/i, 'carrot'], [/tom|jerry|mouse|cat\b/i, 'cheese'], [/kong|barrel/i, 'girders'], [/tennis|golf|soccer|basket|sport/i, 'court'],
  [/mega ?man|robot|blaster/i, 'bolt'], [/tetris|puzzle|block/i, 'blocks'], [/in-1|in 1|collection|classics/i, 'grid'], [/kombat|fighter|fight|kung fu|karate/i, 'fist'], [/mario|bros|plumb/i, 'pipes'],
]
export const motifFor = (title: string): Motif | null => MOTIFS.find(([pattern]) => pattern.test(title))?.[1] ?? null

function Scene({ motif, accent, ink }: { motif: Motif | null; accent: string; ink: string }) {
  switch (motif) {
    case 'jet': return <g><path d="M10 70l100-30" stroke={ink} strokeOpacity=".25" strokeWidth="2" strokeDasharray="6 5" /><path d="M58 50l34-12 6 3-22 13 6 13-5 2-10-11-12 5-2 7-4 1 1-10-8-4 3-3Z" fill={ink} /><circle cx="96" cy="20" r="9" fill={accent} /></g>
    case 'star': return <g><circle cx="88" cy="26" r="16" fill={accent} fillOpacity=".85" /><path d="M42 30l6 16 16 6-16 6-6 16-6-16-16-6 16-6Z" fill={ink} /><circle cx="42" cy="52" r="3" fill={accent} /><path d="M0 82l30-14 22 9 30-16 38 21v8H0Z" fill="#00000055" /></g>
    case 'glove': return <g><rect x="8" y="64" width="104" height="4" fill={ink} fillOpacity=".35" /><rect x="8" y="54" width="104" height="2" fill={ink} fillOpacity=".25" /><path d="M48 24q22-8 32 8 6 14-6 24l-4 14H46l-4-12q-12-4-8-14 3-6 10-4Q40 30 48 24Z" fill={accent} stroke={ink} strokeWidth="2.5" /><path d="M50 62h22" stroke={ink} strokeWidth="3" /></g>
    case 'visor': return <g><path d="M30 76V44q0-24 30-24t30 24v32Z" fill="#00000040" stroke={ink} strokeWidth="2" /><rect x="34" y="40" width="52" height="12" rx="3" fill={accent} /><rect x="36" y="44" width="48" height="3" fill="#ffffffaa" /><path d="M44 64h32M48 70h24" stroke={ink} strokeOpacity=".5" strokeWidth="2" /></g>
    case 'speed': return <g>{[18, 30, 42, 54, 66].map((y, i) => <path key={y} d={`M${4 + i * 6} ${y}h${44 - i * 4}`} stroke={ink} strokeOpacity=".5" strokeWidth="3" strokeLinecap="round" />)}<circle cx="78" cy="44" r="18" fill={accent} /><path d="M66 38l20-10-6 12 14 2-22 12 6-12Z" fill={ink} /><path d="M0 78q30-10 60 0t60 0v12H0Z" fill="#00000055" /></g>
    case 'city': return <g><circle cx="88" cy="22" r="11" fill={accent} fillOpacity=".7" />{[[6, 40, 18], [26, 28, 14], [42, 46, 20], [64, 22, 16], [82, 38, 14], [98, 30, 20]].map(([x, y, w], i) => <g key={i}><rect x={x} y={y} width={w} height={90 - y} fill="#00000066" />{[0, 1, 2].map(r => <rect key={r} x={x + 3} y={y + 6 + r * 10} width="3" height="4" fill={accent} fillOpacity=".8" />)}</g>)}<rect y="76" width="120" height="14" fill={ink} fillOpacity=".2" /></g>
    case 'shell': return <g><ellipse cx="60" cy="50" rx="34" ry="24" fill={accent} stroke={ink} strokeWidth="2.5" /><path d="M60 28v44M40 36l10 14-10 14M80 36l-10 14 10 14M50 50h20" stroke={ink} strokeWidth="2" fill="none" /><path d="M0 82h120v8H0Z" fill="#00000055" /></g>
    case 'dragon': return <g><path d="M14 66q20-30 46-22 10-18 30-14-6 6-4 12 14 2 22 14-14-2-24 4-6 16-30 14Q30 72 14 66Z" fill={accent} stroke={ink} strokeWidth="2" /><circle cx="88" cy="40" r="2.4" fill={ink} /><path d="M50 46l-8-14 16 8M66 44l2-16 8 14" fill={ink} fillOpacity=".6" /></g>
    case 'night': return <g><path d="M92 10a16 16 0 1 0 12 26 13 13 0 1 1-12-26Z" fill={accent} />{[[30, 24], [46, 16], [58, 28]].map(([x, y], i) => <path key={i} d={`M${x - 6} ${y}q3-3 6 0 3-3 6 0`} fill="none" stroke={ink} strokeWidth="1.6" strokeLinecap="round" />)}{[[4, 56], [20, 44], [36, 60], [52, 38], [70, 52], [90, 46], [104, 58]].map(([x, y], i) => <g key={i}><rect x={x} y={y} width="16" height={90 - y} fill="#000000a0" /><rect x={x + 4} y={y + 6} width="3" height="3" fill={accent} fillOpacity=".7" /></g>)}<path d="M58 38v-6l2-3 2 3v6" fill="#000000a0" /></g>
    case 'lamp': return <g>{[[18, 18], [100, 28], [34, 66], [92, 70]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.6" fill={ink} />)}<path d="M30 58q20 8 50 0l14-12q6-4 10 0-6 0-12 10-6 14-30 16-22-2-32-14Z" fill={accent} stroke={ink} strokeWidth="2" /><path d="M54 52q6-8 12 0" fill={accent} stroke={ink} strokeWidth="2" /><path d="M60 46q-8-14 4-22 4 10-4 22" fill={ink} fillOpacity=".35" /></g>
    case 'volcano': return <g><path d="M20 84l30-50h18l32 50Z" fill="#00000066" /><path d="M50 34l6-10 6 8 6-8v10Z" fill={accent} /><circle cx="52" cy="16" r="6" fill={ink} fillOpacity=".3" /><circle cx="64" cy="10" r="8" fill={ink} fillOpacity=".22" /><path d="M0 84h120v6H0Z" fill={ink} fillOpacity=".25" /><path d="M90 84q0-14 8-16 6 0 6 8 6-2 8 8Z" fill={accent} fillOpacity=".7" /></g>
    case 'acorn': return <g><ellipse cx="60" cy="56" rx="18" ry="22" fill={accent} stroke={ink} strokeWidth="2" /><path d="M38 40q22-16 44 0-2 8-22 8t-22-8Z" fill={ink} fillOpacity=".75" /><path d="M60 26v-8" stroke={ink} strokeWidth="3" strokeLinecap="round" /><path d="M0 84h120v6H0Z" fill="#00000055" /></g>
    case 'carrot': return <g><path d="M46 34l30 6-24 44Z" fill={accent} stroke={ink} strokeWidth="2" strokeLinejoin="round" /><path d="M56 40l8 3M54 52l8 2M52 64l6 2" stroke={ink} strokeWidth="1.6" /><path d="M64 34q4-16 14-18-2 10-8 18M66 36q12-8 22-4-8 6-18 8" fill={ink} fillOpacity=".7" /></g>
    case 'cheese': return <g><path d="M24 66l66-30 8 30Z" fill={accent} stroke={ink} strokeWidth="2" strokeLinejoin="round" /><circle cx="60" cy="58" r="4" fill={ink} fillOpacity=".3" /><circle cx="80" cy="54" r="3" fill={ink} fillOpacity=".3" /><circle cx="44" cy="62" r="2.5" fill={ink} fillOpacity=".3" /><path d="M0 76h120v14H0Z" fill="#00000055" /></g>
    case 'girders': return <g>{[[10, 70, 110, 64], [10, 46, 110, 52], [10, 28, 110, 22]].map(([a, b, c, d], i) => <path key={i} d={`M${a} ${b}L${c} ${d}`} stroke={accent} strokeWidth="6" />)}<circle cx="34" cy="38" r="6" fill={ink} fillOpacity=".75" /><circle cx="76" cy="58" r="6" fill={ink} fillOpacity=".75" /><path d="M96 70v-14M104 70v-14" stroke={ink} strokeWidth="2" /></g>
    case 'court': return <g><path d="M10 80l20-40h60l20 40Z" fill="#00000040" stroke={ink} strokeOpacity=".5" strokeWidth="1.5" /><path d="M20 60h80" stroke={ink} strokeWidth="2.5" /><path d="M60 40v40" stroke={ink} strokeOpacity=".4" /><circle cx="78" cy="26" r="8" fill={accent} /><path d="M72 22q6 4 12 0" stroke={ink} fill="none" strokeWidth="1.2" /></g>
    case 'bolt': return <g><circle cx="60" cy="45" r="28" fill="#00000035" stroke={ink} strokeOpacity=".4" strokeDasharray="4 4" /><path d="M66 14L44 50h14l-6 26 24-38H62Z" fill={accent} stroke={ink} strokeWidth="2" strokeLinejoin="round" /></g>
    case 'blocks': return <g>{[[34, 58], [46, 58], [58, 58], [58, 46], [70, 58], [70, 46], [70, 34], [46, 46]].map(([x, y], i) => <rect key={i} x={x} y={y} width="11" height="11" rx="2" fill={i % 3 ? accent : ink} fillOpacity={i % 2 ? 1 : .7} />)}</g>
    case 'grid': return <g>{Array.from({ length: 12 }, (_, i) => <rect key={i} x={18 + (i % 4) * 22} y={14 + Math.floor(i / 4) * 22} width="18" height="18" rx="3" fill={i % 3 === 0 ? accent : ink} fillOpacity={0.25 + (i % 4) * 0.18} />)}</g>
    case 'fist': return <g><path d="M18 76l20-30M102 76L82 46" stroke={ink} strokeOpacity=".2" strokeWidth="10" /><circle cx="60" cy="42" r="26" fill={accent} fillOpacity=".25" /><path d="M46 32h28q6 0 6 6v12q0 10-10 12H52q-10-2-10-12V36q0-4 4-4Z" fill={accent} stroke={ink} strokeWidth="2.5" /><path d="M53 32v14M60 32v14M67 32v14" stroke={ink} strokeWidth="2" /></g>
    case 'pipes': return <g><rect x="14" y="48" width="22" height="42" fill={accent} stroke={ink} strokeWidth="2" /><rect x="10" y="42" width="30" height="10" fill={accent} stroke={ink} strokeWidth="2" /><rect x="50" y="22" width="12" height="12" fill={ink} fillOpacity=".75" /><rect x="64" y="22" width="12" height="12" fill={accent} stroke={ink} strokeWidth="1.5" /><path d="M0 84h120v6H0Z" fill="#00000066" /><circle cx="96" cy="70" r="8" fill={ink} fillOpacity=".75" /></g>
    default: return <g><path d="M0 70l20-12 18 10 24-18 22 14 18-8 18 10v24H0Z" fill="#00000055" /><path d="M48 30l12-8 12 8v14l-12 8-12-8Z" fill={accent} stroke={ink} strokeWidth="2" /></g>
  }
}

export default function CartridgeArt({ title }: { title: string }) {
  const hue = cartridgeHue(title), accent = `hsl(${(hue + 150) % 360} 90% 66%)`, ink = `hsl(${hue} 30% 94%)`, id = `ca-${hue}`
  return <svg viewBox="0 0 120 90" className="gr-cart-art" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
    <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={`hsl(${hue} 62% 30%)`} /><stop offset="1" stopColor={`hsl(${(hue + 30) % 360} 70% 13%)`} /></linearGradient></defs>
    <rect width="120" height="90" fill={`url(#${id})`} />
    <Scene motif={motifFor(title)} accent={accent} ink={ink} />
  </svg>
}
