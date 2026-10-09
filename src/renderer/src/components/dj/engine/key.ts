/**
 * Musical key for AIHub DJ: detected from the audio (chroma + Krumhansl–Schmuckler
 * profiles) or read from a file's tag, shown on the Camelot wheel so the DJ can
 * see at a glance which songs mix harmonically.
 */

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** Krumhansl–Kessler tonal-hierarchy profiles, tonic first. */
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

/** Camelot number for each tonic (C = 0…), major (B) and minor (A). */
const CAMELOT_MAJOR = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1]
const CAMELOT_MINOR = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10]

export interface MusicalKey {
  /** 0 = C … 11 = B. */
  tonic: number
  minor: boolean
  /** Camelot code, e.g. "8A" (A minor) or "8B" (C major). */
  camelot: string
  /** Plain name, e.g. "A minor". */
  name: string
  /** 0..1 — how clearly one key stood out. Low means the music is ambiguous. */
  confidence: number
}

export function keyFrom(tonic: number, minor: boolean, confidence = 1): MusicalKey {
  const n = ((tonic % 12) + 12) % 12
  return {
    tonic: n, minor, confidence,
    camelot: `${(minor ? CAMELOT_MINOR : CAMELOT_MAJOR)[n]}${minor ? 'A' : 'B'}`,
    name: `${NOTES[n]} ${minor ? 'minor' : 'major'}`,
  }
}

/** In-place radix-2 FFT. `re` and `im` must have a power-of-two length. */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const xr = re[b] * cr - im[b] * ci
        const xi = re[b] * ci + im[b] * cr
        re[b] = re[a] - xr; im[b] = im[a] - xi
        re[a] += xr; im[a] += xi
        const t = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = t
      }
    }
  }
}

function correlate(a: number[], b: number[]): number {
  const n = a.length
  const ma = a.reduce((s, v) => s + v, 0) / n
  const mb = b.reduce((s, v) => s + v, 0) / n
  let c = 0, va = 0, vb = 0
  for (let i = 0; i < n; i++) { c += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2 }
  return va > 0 && vb > 0 ? c / Math.sqrt(va * vb) : 0
}

/** Pick the key whose profile best matches a 12-bin pitch-class energy vector. */
export function keyFromChroma(chroma: number[]): MusicalKey | null {
  if (chroma.length !== 12 || chroma.every(v => v <= 0)) return null
  let best = -2, second = -2, bestKey = { tonic: 0, minor: false }
  for (let t = 0; t < 12; t++) {
    for (const minor of [false, true]) {
      const profile = (minor ? MINOR : MAJOR).map((_, i, p) => p[(i - t + 12) % 12])
      const r = correlate(chroma, profile)
      if (r > best) { second = best; best = r; bestKey = { tonic: t, minor } } else if (r > second) second = r
    }
  }
  if (best < 0.3) return null
  return keyFrom(bestKey.tonic, bestKey.minor, Math.max(0, Math.min(1, (best - second) * 8 + 0.2)))
}

/**
 * Detect the key of a mono signal. Uses up to `seconds` from the middle of the
 * song, downsampled to ~8 kHz, so it costs a few milliseconds even on long tracks.
 */
export function detectKey(mono: Float32Array, sampleRate: number, seconds = 75): MusicalKey | null {
  const down = Math.max(1, Math.round(sampleRate / 8000))
  const sr = sampleRate / down
  const span = Math.min(mono.length, Math.floor(seconds * sampleRate))
  if (span < sampleRate * 8) return null
  const from = Math.floor((mono.length - span) / 2)
  const N = 4096
  const hop = 4096
  const chroma = new Array<number>(12).fill(0)
  const re = new Float32Array(N)
  const im = new Float32Array(N)
  const win = new Float32Array(N)
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))
  // Map FFT bins in 65–1800 Hz to pitch classes once.
  const binPc: number[] = []
  for (let b = 0; b < N / 2; b++) {
    const f = (b * sr) / N
    binPc.push(f < 65 || f > 1800 ? -1 : ((Math.round(12 * Math.log2(f / 440)) + 9) % 12 + 12) % 12)
  }
  const frameLen = N * down
  for (let pos = from; pos + frameLen <= from + span; pos += hop * down) {
    let energy = 0
    for (let i = 0; i < N; i++) {
      let s = 0
      for (let k = 0; k < down; k++) s += mono[pos + i * down + k]
      s /= down
      re[i] = s * win[i]
      im[i] = 0
      energy += s * s
    }
    if (energy < 1e-4) continue // silence
    fft(re, im)
    for (let b = 1; b < N / 2; b++) {
      const pc = binPc[b]
      if (pc < 0) continue
      // Square-root compression stops one loud partial from deciding the key.
      chroma[pc] += Math.sqrt(Math.hypot(re[b], im[b]))
    }
  }
  return keyFromChroma(chroma)
}

/** "8A", "Am", "A minor", "F#m", "Db" … → a key, or null when it is not recognisable. */
export function parseKey(raw: string | undefined | null): MusicalKey | null {
  const s = (raw || '').trim()
  if (!s) return null
  const cam = /^(1[0-2]|[1-9])\s*([ABab])$/.exec(s)
  if (cam) {
    const num = Number(cam[1])
    const minor = cam[2].toUpperCase() === 'A'
    const t = (minor ? CAMELOT_MINOR : CAMELOT_MAJOR).indexOf(num)
    return t >= 0 ? keyFrom(t, minor) : null
  }
  const m = /^([A-Ga-g])([#♯b♭]?)\s*(m|min|minor|maj|major|dur|moll)?$/i.exec(s)
  if (!m) return null
  const base: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }
  let t = base[m[1].toLowerCase()]
  if (m[2] === '#' || m[2] === '♯') t++
  else if (m[2] === 'b' || m[2] === '♭') t--
  const minor = !!m[3] && /^(m|min|minor|moll)$/i.test(m[3]) && !/^maj/i.test(m[3])
  return keyFrom(t, minor)
}

export type KeyMatch = 'perfect' | 'smooth' | 'energy' | 'clash'

/**
 * How two songs sit together on the Camelot wheel:
 *  perfect – same key; smooth – a step round the wheel or relative major/minor;
 *  energy  – two steps up (a lift) or a semitone-ish boost; clash – anything else.
 */
export function keyMatch(a: MusicalKey | null, b: MusicalKey | null): KeyMatch | null {
  if (!a || !b) return null
  const na = Number(a.camelot.slice(0, -1)), nb = Number(b.camelot.slice(0, -1))
  const sameMode = a.minor === b.minor
  const d = Math.min((na - nb + 12) % 12, (nb - na + 12) % 12)
  if (sameMode && d === 0) return 'perfect'
  if (sameMode && d === 1) return 'smooth'
  if (!sameMode && d === 0) return 'smooth'
  if (sameMode && d === 2) return 'energy'
  return 'clash'
}
