/**
 * Main-thread handle on a deck's scratch voice (scratch.worklet.js).
 *
 * The worklet module loads once per AudioContext; until it has, the voice is
 * inert and the platter falls back to silent seeking, so nothing waits on it.
 */
import workletUrl from './scratch.worklet.js?url'

const loaded = new WeakMap<BaseAudioContext, Promise<boolean>>()

export function loadScratchWorklet(ctx: AudioContext): Promise<boolean> {
  let p = loaded.get(ctx)
  if (!p) {
    p = ctx.audioWorklet.addModule(workletUrl).then(() => true, () => false)
    loaded.set(ctx, p)
  }
  return p
}

export interface RingDump { data: Float32Array; t0: number; rate: number; sampleRate: number }

export class ScratchVoice {
  private node: AudioWorkletNode | null = null
  private dumps = new Map<number, (d: RingDump | null) => void>()
  private dumpId = 0

  /** `input` feeds the rolling recording; the voice plays into `output`. */
  constructor(private ctx: AudioContext, input: AudioNode, output: AudioNode) {
    void loadScratchWorklet(ctx).then(ok => {
      if (!ok) return
      this.node = new AudioWorkletNode(ctx, 'aihub-dj-scratch', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      })
      this.node.port.onmessage = e => {
        const m = e.data
        if (m?.type !== 'dump') return
        const done = this.dumps.get(m.id)
        this.dumps.delete(m.id)
        done?.(m.data ? { data: m.data, t0: m.t0, rate: m.rate, sampleRate: m.sampleRate } : null)
      }
      input.connect(this.node)
      this.node.connect(output)
      if (this.pendingBuffer) this.setBuffer(this.pendingBuffer.data, this.pendingBuffer.rate)
    })
  }

  get ready(): boolean { return !!this.node }

  private pendingBuffer: { data: Float32Array; rate: number } | null = null

  /** The whole song, mono — every part of it becomes scratchable. */
  setBuffer(data: Float32Array, rate: number): void {
    if (!this.node) { this.pendingBuffer = { data, rate }; return }
    this.pendingBuffer = null
    this.node.port.postMessage({ type: 'buffer', data, rate }, [data.buffer])
  }
  clearBuffer(): void {
    this.pendingBuffer = null
    this.post({ type: 'clearBuffer' })
    this.post({ type: 'resetRing' })
  }

  /** Where the deck is, so the recorder can stamp what it hears. */
  anchor(t: number, rate: number, recording: boolean): void {
    this.post({ type: 'anchor', t, ctxT: this.ctx.currentTime, rate, rec: recording })
  }
  resetRing(): void { this.post({ type: 'resetRing' }) }

  grab(t: number): void { this.post({ type: 'grab', t }) }
  move(t: number): void { this.post({ type: 'move', t }) }
  /** Let go: spin up to `rate` (0 = stay stopped) and fade out after `fade` seconds. */
  release(rate: number, fade: number): void { this.post({ type: 'release', rate, fade }) }
  stop(): void { this.post({ type: 'stop' }) }

  /** The newest unbroken stretch the deck recorded, for live tempo detection. */
  dump(): Promise<RingDump | null> {
    if (!this.node) return Promise.resolve(null)
    const id = ++this.dumpId
    return new Promise(resolve => {
      this.dumps.set(id, resolve)
      this.post({ type: 'dump', id })
      window.setTimeout(() => { if (this.dumps.delete(id)) resolve(null) }, 2000)
    })
  }

  dispose(): void {
    this.node?.disconnect()
    this.node = null
  }

  private post(m: object): void { this.node?.port.postMessage(m) }
}
