#!/usr/bin/env node
/**
 * AIHub Browser — Icon generator
 * Pure Node.js, zero external dependencies.
 * Produces resources/icon.ico with sizes: 16, 24, 32, 48, 64, 128, 256.
 *
 * Design: dark navy circle, blue→purple gradient ring,
 * bold "A" letterform with neural-node dots at each vertex.
 */

const zlib = require('zlib')
const fs   = require('fs')
const path = require('path')

// ── Math helpers ──────────────────────────────────────────────────────────────

const lerp  = (a, b, t) => a + (b - a) * t
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(px - ax, py - ay)
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / lenSq, 0, 1)
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}

// ── Pixel shader ──────────────────────────────────────────────────────────────

function drawPixel(x, y, size) {
  const half = (size - 1) / 2
  const R    = half * 0.96
  const dx   = x - half, dy = y - half
  const dist = Math.hypot(dx, dy)

  // Outside circle → transparent
  if (dist > R + 0.7) return [0, 0, 0, 0]

  const nx = dx / R, ny = dy / R
  const dn = dist / R

  // Circle alpha (anti-alias edge)
  const circAlpha = clamp((R + 0.7 - dist) / 1.2, 0, 1)

  // ── Background: deep navy ─────────────────────────────────────────────────
  let r = 7, g = 11, b = 27

  // Subtle radial centre glow (cool blue)
  const centGlow = Math.pow(clamp(1 - dn * 1.4, 0, 1), 2) * 0.42
  r = lerp(r, 18, centGlow)
  g = lerp(g, 42, centGlow)
  b = lerp(b, 115, centGlow)

  // ── Gradient ring at dn ≈ 0.83 ────────────────────────────────────────────
  const ringDist  = Math.abs(dn - 0.83)
  const ringAlpha = clamp(1 - ringDist / 0.058, 0, 1) * 0.98

  const angle = Math.atan2(ny, nx) + Math.PI   // 0 … 2π
  const rR = 59  + (139 - 59)  * (0.5 + 0.5 * Math.sin(angle + 0.0))
  const rG = 100 + (92  - 100) * (0.5 + 0.5 * Math.sin(angle + 1.0))
  const rB = 240 + (246 - 240) * (0.5 + 0.5 * Math.sin(angle + 2.0))

  r = lerp(r, rR, ringAlpha)
  g = lerp(g, rG, ringAlpha)
  b = lerp(b, rB, ringAlpha)

  // ── "A" — three segments ──────────────────────────────────────────────────
  // Vertices in normalised [-1..1] space
  const TOP = [0.0,   -0.37]
  const BL  = [-0.27,  0.36]
  const BR  = [0.27,   0.36]

  const strokeW = Math.max(0.072, 2.4 / R)   // adaptive: min ~2.4 px physical

  const dLeft  = distToSeg(nx, ny, BL[0], BL[1], TOP[0], TOP[1])
  const dRight = distToSeg(nx, ny, BR[0], BR[1], TOP[0], TOP[1])
  const dCross = distToSeg(nx, ny, -0.13, 0.055, 0.13, 0.055)

  const dMin = Math.min(dLeft, dRight, dCross)

  const strokeFill = clamp(1 - dMin / strokeW, 0, 1)
  const strokeGlow = clamp(1 - dMin / (strokeW * 3.0), 0, 1) * 0.48

  // Glow halo (soft blue)
  r = lerp(r, 70,  strokeGlow)
  g = lerp(g, 135, strokeGlow)
  b = lerp(b, 255, strokeGlow)

  // Fill (near-white with blue tint)
  r = lerp(r, 222, strokeFill)
  g = lerp(g, 237, strokeFill)
  b = lerp(b, 255, strokeFill)

  // ── Neural nodes at triangle vertices ─────────────────────────────────────
  const nodeR = Math.max(0.048, 3.2 / R)

  for (const [vx, vy] of [TOP, BL, BR]) {
    const nd = Math.hypot(nx - vx, ny - vy)
    const nodeGlow = clamp(1 - nd / (nodeR * 2.6), 0, 1) * 0.55
    const nodeFill = clamp(1 - nd / nodeR, 0, 1)

    r = lerp(r, 96,  nodeGlow)
    g = lerp(g, 165, nodeGlow)
    b = lerp(b, 250, nodeGlow)

    r = lerp(r, 185, nodeFill)
    g = lerp(g, 220, nodeFill)
    b = lerp(b, 255, nodeFill)
  }

  return [
    Math.round(clamp(r, 0, 255)),
    Math.round(clamp(g, 0, 255)),
    Math.round(clamp(b, 0, 255)),
    Math.round(clamp(circAlpha * 255, 0, 255)),
  ]
}

// ── PNG encoder (pure Node.js) ────────────────────────────────────────────────

function buildPNG(size) {
  // Build CRC32 table once
  const T = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    T[i] = c
  }
  function crc32(buf) {
    let c = 0xFFFFFFFF
    for (const b of buf) c = T[(c ^ b) & 0xFF] ^ (c >>> 8)
    return (c ^ 0xFFFFFFFF) >>> 0
  }
  function chunk(type, data) {
    const tb = Buffer.from(type, 'ascii')
    const lb = Buffer.allocUnsafe(4); lb.writeUInt32BE(data.length, 0)
    const cb = Buffer.allocUnsafe(4); cb.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0)
    return Buffer.concat([lb, tb, data, cb])
  }

  // Rasterise
  const rows = []
  for (let y = 0; y < size; y++) {
    const row = Buffer.allocUnsafe(1 + size * 4)
    row[0] = 0 // filter: None
    for (let x = 0; x < size; x++) {
      const [pr, pg, pb, pa] = drawPixel(x, y, size)
      const i = 1 + x * 4
      row[i] = pr; row[i+1] = pg; row[i+2] = pb; row[i+3] = pa
    }
    rows.push(row)
  }

  const raw        = Buffer.concat(rows)
  const compressed = zlib.deflateSync(raw, { level: 6 })

  const ihdr = Buffer.allocUnsafe(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8]  = 8   // bit depth
  ihdr[9]  = 6   // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── ICO encoder ───────────────────────────────────────────────────────────────

function buildICO(entries) {
  const n   = entries.length
  const hdr = Buffer.allocUnsafe(6)
  hdr.writeUInt16LE(0, 0)
  hdr.writeUInt16LE(1, 2)  // type: ICO
  hdr.writeUInt16LE(n, 4)

  let offset = 6 + n * 16
  const dirs = entries.map(({ size, png }) => {
    const e = Buffer.allocUnsafe(16)
    e[0] = size >= 256 ? 0 : size   // 0 means 256
    e[1] = size >= 256 ? 0 : size
    e[2] = 0; e[3] = 0              // colours / reserved
    e.writeUInt16LE(1, 4)           // colour planes
    e.writeUInt16LE(32, 6)          // bpp
    e.writeUInt32LE(png.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += png.length
    return e
  })

  return Buffer.concat([hdr, ...dirs, ...entries.map(e => e.png)])
}

// ── Main ──────────────────────────────────────────────────────────────────────

const SIZES = [16, 24, 32, 48, 64, 128, 256]

console.log('\nAIHub Browser — icon generator\n')

const entries = SIZES.map(size => {
  process.stdout.write(`  Rendering ${String(size).padStart(3)}×${size}... `)
  const png = buildPNG(size)
  process.stdout.write(`${png.length} bytes\n`)
  return { size, png }
})

const ico = buildICO(entries)

const outPath = path.join(__dirname, '..', 'resources', 'icon.ico')
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, ico)

console.log(`\n✓  Saved ${outPath}  (${Math.ceil(ico.length / 1024)} KB)\n`)
