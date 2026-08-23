/**
 * Generated member avatars.
 *
 * Every avatar is derived from the member id — there is no upload path, in
 * this slice or any later one. That is a safety decision before it is a design
 * one: an image upload endpoint is a malware vector, an illegal-content
 * vector, and a moderation job, and a community that never accepts a file has
 * none of the three.
 *
 * The output is an inline SVG string, so it costs no network request, renders
 * at any size, and looks the same on every machine for the same member.
 *
 * Deliberately not `crypto` — this module is imported by the renderer, and a
 * Node built-in there means a bundler shim for something that does not need to
 * be cryptographic. Avatar collisions are cosmetic; the handle suffix is what
 * actually distinguishes two members.
 */

/** FNV-1a, 32-bit. Small, fast, and well spread for short strings. */
function hash32(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

const GRID = 5

/**
 * A symmetric 5×5 identicon for a seed.
 *
 * Mirrored across the vertical axis because bilateral symmetry is what makes
 * an arbitrary bit pattern read as a face or a badge rather than as noise —
 * the same reason GitHub's identicons are built this way.
 */
export function avatarSvg(seed: string, size = 40): string {
  const h = hash32(String(seed ?? ''))
  const hue = h % 360
  const fg = `hsl(${hue} 68% 62%)`
  const bg = `hsl(${hue} 34% 18%)`

  // Only the left three columns are decided; the right two mirror them.
  const half = Math.ceil(GRID / 2)
  const cells: string[] = []
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < half; x++) {
      // Re-hash per cell so neighbouring bits of one hash don't produce
      // visible banding down the grid.
      const on = hash32(`${seed}:${x}:${y}`) % 100 < 47
      if (!on) continue
      cells.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`)
      const mirrored = GRID - 1 - x
      if (mirrored !== x) cells.push(`<rect x="${mirrored}" y="${y}" width="1" height="1"/>`)
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${GRID} ${GRID}" shape-rendering="crispEdges" role="img" aria-hidden="true">`,
    `<rect width="${GRID}" height="${GRID}" fill="${bg}"/>`,
    `<g fill="${fg}">${cells.join('')}</g>`,
    `</svg>`,
  ].join('')
}

/** The same avatar as a data URI, for `src` and `background-image`. */
export function avatarDataUri(seed: string, size = 40): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(avatarSvg(seed, size))}`
}
