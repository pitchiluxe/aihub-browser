// ── Window-style registry ────────────────────────────────────────────────────
// A "window style" bundles the three window-chrome settings that used to be
// set separately: the DWM material (transparency), the glass see-through level,
// and the whole-window opacity. Presets let a user apply a tuned combination in
// one click, and — like themes — new ones can be AI- or locally generated.

export type Material = 'none' | 'acrylic' | 'mica' | 'tabbed' | 'auto'
export type GlassLevel = 'subtle' | 'medium' | 'strong'

export interface WindowStyle {
  id: string
  name: string
  desc: string
  transparency: Material
  glassIntensity: GlassLevel
  opacity: number
}

export interface CustomWindowStyle extends WindowStyle {
  custom: true
}

export const WINDOW_STYLES: WindowStyle[] = [
  { id: 'solid',    name: 'Solid',     desc: 'Opaque · no blur',          transparency: 'none',    glassIntensity: 'medium', opacity: 1 },
  { id: 'aero',     name: 'Aero',      desc: 'Frosted glass blur',        transparency: 'acrylic', glassIntensity: 'medium', opacity: 1 },
  { id: 'mica',     name: 'Mica',      desc: 'Tinted desktop material',   transparency: 'mica',    glassIntensity: 'subtle', opacity: 1 },
  { id: 'tabbed',   name: 'Tabbed',    desc: 'Layered Mica variant',      transparency: 'tabbed',  glassIntensity: 'subtle', opacity: 1 },
  { id: 'auto',     name: 'Auto',      desc: 'Windows picks the material', transparency: 'auto',   glassIntensity: 'medium', opacity: 1 },
  { id: 'frost',    name: 'Frost',     desc: 'Deep acrylic · see-through', transparency: 'acrylic', glassIntensity: 'strong', opacity: 0.95 },
  { id: 'ghost',    name: 'Ghost',     desc: 'Faded floating window',      transparency: 'acrylic', glassIntensity: 'strong', opacity: 0.85 },
  { id: 'vapor',    name: 'Vapor',     desc: 'Mica · barely-there tint',   transparency: 'mica',    glassIntensity: 'subtle', opacity: 0.9 },
]

const LS_STYLES = 'aihub-custom-window-styles'

export function loadCustomWindowStyles(): CustomWindowStyle[] {
  try { return JSON.parse(localStorage.getItem(LS_STYLES) || '[]') } catch { return [] }
}

export function saveCustomWindowStyles(styles: CustomWindowStyle[]): void {
  try { localStorage.setItem(LS_STYLES, JSON.stringify(styles)) } catch {}
  // Disk mirror — same durability story as custom themes/extensions
  try { (window as any).electronAPI?.extStore?.save?.({ customWindowStyles: styles }) } catch {}
}

export function deleteCustomWindowStyle(id: string): CustomWindowStyle[] {
  const rest = loadCustomWindowStyles().filter(s => s.id !== id)
  saveCustomWindowStyles(rest)
  return rest
}

export function getAllWindowStyles(): (WindowStyle | CustomWindowStyle)[] {
  return [...WINDOW_STYLES, ...loadCustomWindowStyles()]
}

// ── Generation ────────────────────────────────────────────────────────────────
const MATERIALS: Material[] = ['none', 'acrylic', 'mica', 'tabbed', 'auto']
const GLASS: GlassLevel[] = ['subtle', 'medium', 'strong']
const OPACITIES = [1, 0.97, 0.95, 0.92, 0.9, 0.87, 0.85]
const ADJ = ['Frosted', 'Crystal', 'Smoked', 'Arctic', 'Velvet', 'Prism', 'Halo', 'Nimbus', 'Quartz', 'Onyx', 'Opal', 'Zephyr', 'Lumen', 'Mirage', 'Drift', 'Aura']

function describe(m: Material, g: GlassLevel, o: number): string {
  const mat = m === 'none' ? 'Opaque' : m === 'auto' ? 'Auto material' : m[0].toUpperCase() + m.slice(1)
  const glass = m === 'none' ? '' : ` · ${g} glass`
  const op = o < 1 ? ` · ${Math.round(o * 100)}%` : ''
  return `${mat}${glass}${op}`
}

/** Random, de-duplicated window-style presets that avoid combos already saved. */
export function generateLocalWindowStyles(count: number): CustomWindowStyle[] {
  const taken = new Set(getAllWindowStyles().map(s => `${s.transparency}|${s.glassIntensity}|${s.opacity}`))
  const takenNames = new Set(getAllWindowStyles().map(s => s.name.toLowerCase()))
  const out: CustomWindowStyle[] = []
  let guard = 0
  while (out.length < count && guard++ < count * 20) {
    const m = MATERIALS[Math.floor(Math.random() * MATERIALS.length)]
    const g = GLASS[Math.floor(Math.random() * GLASS.length)]
    // Solid material can't be see-through — keep it fully opaque to stay honest.
    const o = m === 'none' ? 1 : OPACITIES[Math.floor(Math.random() * OPACITIES.length)]
    const key = `${m}|${g}|${o}`
    if (taken.has(key)) continue
    taken.add(key)
    let name = ADJ[Math.floor(Math.random() * ADJ.length)]
    let n = 2
    while (takenNames.has(name.toLowerCase())) name = `${ADJ[Math.floor(Math.random() * ADJ.length)]} ${n++}`
    takenNames.add(name.toLowerCase())
    out.push({
      id: `winstyle-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      name, desc: describe(m, g, o), transparency: m, glassIntensity: g, opacity: o, custom: true,
    })
  }
  return out
}

/** AI-assisted generation with a fully offline fallback. Persists + returns the new styles. */
export async function generateWindowStyles(count = 6): Promise<CustomWindowStyle[]> {
  const existingNames = getAllWindowStyles().map(s => s.name).join(', ')
  let fresh: CustomWindowStyle[] = []
  try {
    const res = await (window as any).electronAPI?.ai?.chat?.(
      [{
        role: 'user',
        content:
          `Design ${count} distinct desktop window-chrome presets for a Windows browser. ` +
          `Existing names (do NOT reuse): ${existingNames}. ` +
          `Reply with ONLY a JSON array, no prose: ` +
          `[{"name":"one short evocative word","transparency":"none|acrylic|mica|tabbed|auto","glassIntensity":"subtle|medium|strong","opacity":0.85-1}].`,
      }],
      undefined, { preferCloud: true }
    )
    const match = String(res?.content || '').match(/\[[\s\S]*\]/)
    if (match && res?.provider !== 'error') {
      const takenNames = new Set(getAllWindowStyles().map(s => s.name.toLowerCase()))
      const seeds = JSON.parse(match[0]) as any[]
      for (const s of seeds.slice(0, count)) {
        const m: Material = MATERIALS.includes(s.transparency) ? s.transparency : 'acrylic'
        const g: GlassLevel = GLASS.includes(s.glassIntensity) ? s.glassIntensity : 'medium'
        const o = m === 'none' ? 1 : Math.min(1, Math.max(0.85, Number(s.opacity) || 1))
        let name = String(s.name || '').trim().slice(0, 16)
        if (!name || takenNames.has(name.toLowerCase())) name = ADJ[Math.floor(Math.random() * ADJ.length)]
        takenNames.add(name.toLowerCase())
        fresh.push({
          id: `winstyle-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
          name, desc: describe(m, g, o), transparency: m, glassIntensity: g, opacity: o, custom: true,
        })
      }
    }
  } catch { /* offline or AI unavailable — fall through to local generator */ }

  if (fresh.length < count) fresh = fresh.concat(generateLocalWindowStyles(count - fresh.length))

  const all = [...loadCustomWindowStyles(), ...fresh]
  saveCustomWindowStyles(all)
  return fresh
}
