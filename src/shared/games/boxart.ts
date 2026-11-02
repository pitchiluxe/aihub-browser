import type { RomSystem } from './catalog'
// Cartridge thumbnails come from the libretro-thumbnails project (the box art
// RetroArch shows), matched to the user's own dump names. Titles are matched
// loosely: region tags, revisions, punctuation and a leading "The" are ignored.
export const BOXART_REPOS: Partial<Record<RomSystem, string>> = {
  nes: 'Nintendo_-_Nintendo_Entertainment_System', genesis: 'Sega_-_Mega_Drive_-_Genesis', snes: 'Nintendo_-_Super_Nintendo_Entertainment_System',
  gb: 'Nintendo_-_Game_Boy', gba: 'Nintendo_-_Game_Boy_Advance',
}
const ROMAN: Record<string, string> = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6' }
export function boxartKey(name: string): string {
  return name.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/,\s*the\b/i, '').toLowerCase()
    // libretro writes "&" as "_", so "&", "_" and the word "and" all count as nothing.
    .replace(/[&_:\-–!'’.,+]/g, ' ').replace(/^the\s+/, '').split(/\s+/).filter(word => word && word !== 'and').map(word => ROMAN[word] ?? word).join(' ')
}
// Share of words two keys have in common (Jaccard), for titles that differ by a word.
function overlap(a: string, b: string): number {
  const left = new Set(a.split(' ')), right = new Set(b.split(' '))
  let shared = 0
  for (const word of left) if (right.has(word)) shared++
  return shared / (left.size + right.size - shared)
}
// Prefer the US/World release, then Europe, then anything else; unlicensed and hacked dumps last.
function rank(file: string): number {
  if (/\[(?:h|b|t|p)|hack|pirate|\(proto|\(beta|\(sample/i.test(file)) return 9
  // Re-releases and catalogue-style names come after the original cartridge.
  const reissue = /Virtual Console|e-Reader|Collection|Classic|\(\d{4}/i.test(file) ? 5 : 0
  if (/\((?:USA|World)[^)]*\)/.test(file)) return reissue + (/\(Rev/i.test(file) ? 1 : 0)
  if (/\(Europe/.test(file)) return reissue + 2
  return reissue + (/\(Unl\)/.test(file) ? 4 : 3)
}
/** Picks the best box art file name for a game title from a libretro listing. */
export function matchBoxart(title: string, files: readonly string[]): string | null {
  const wanted = boxartKey(title)
  if (!wanted) return null
  let best: string | null = null, bestRank = 99
  for (const file of files) {
    if (boxartKey(file) !== wanted) continue
    const score = rank(file)
    if (score < bestRank) { best = file; bestRank = score }
  }
  if (best) return best
  // A dump named for two games ("Sonic & Knuckles + Sonic 3") still finds the box of its first part.
  for (const file of files) {
    const key = boxartKey(file)
    const shorter = key.length < wanted.length ? key : wanted
    if (shorter.split(' ').length < 2 || !(wanted.startsWith(key + ' ') || key.startsWith(wanted + ' '))) continue
    const score = rank(file) + 10
    if (score < bestRank) { best = file; bestRank = score }
  }
  if (best) return best
  // Last, a title that differs by one word ("Flintstones 2 - The Surprise…" vs "Flintstones - The Surprise…"),
  // as long as every number on the box is also in the dump name, so Mega Man 3 never stands in for Mega Man 2.
  const numbers = (key: string) => key.split(' ').filter(word => /^\d+$/.test(word))
  for (const file of files) {
    const key = boxartKey(file)
    if (key.split(' ')[0] !== wanted.split(' ')[0] || overlap(key, wanted) < 0.8 || !numbers(key).every(n => numbers(wanted).includes(n))) continue
    const score = rank(file) + 20
    if (score < bestRank) { best = file; bestRank = score }
  }
  return best
}
export const boxartUrl = (system: RomSystem, file: string) => `https://raw.githubusercontent.com/libretro-thumbnails/${BOXART_REPOS[system]}/master/Named_Boxarts/${encodeURIComponent(file)}`
