// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The waveform scan holds the one shared scan slot; every way it can end must
// report back (onEnd), or the other deck waits at "Reading the waveform… 0%" forever.
const bridge = {
  load: vi.fn(async () => ({ ok: true })),
  streamId: vi.fn(async () => 'stream-1'),
  cmd: vi.fn(async () => true),
  state: vi.fn(async () => ({ t: 0, d: 180, paused: false, ended: false, ad: false, state: 1 })),
  unload: vi.fn(async () => true),
}
let worklet = true
vi.mock('./youtubeDeck', () => ({
  ytBridge: () => bridge,
  captureTab: async () => ({ getAudioTracks: () => [{ readyState: 'live' }], getTracks: () => [] }),
}))
vi.mock('./scratch', () => ({ loadScratchWorklet: async () => worklet }))

import { YouTubeScan } from './youtubeScan'

const node = () => ({ connect: (x: any) => x, disconnect: () => {}, port: {} as any, gain: { value: 1 } })
const ctx = { currentTime: 0, destination: {}, createMediaStreamSource: node, createGain: node } as any
;(globalThis as any).AudioWorkletNode = function () { return node() }

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] }); worklet = true; for (const f of Object.values(bridge)) f.mockClear() })
afterEach(() => { vi.useRealTimers() })

describe('YouTubeScan always releases the scan slot', () => {
  it('when the scan player stops answering (state calls fail), it gives up after the stall time', async () => {
    const onEnd = vi.fn()
    const scan = new YouTubeScan('A-scan', ctx, () => {}, onEnd)
    await scan.start('vid00000001', 180)
    bridge.state.mockImplementation(async () => { throw new Error("reply was never sent") })
    await vi.advanceTimersByTimeAsync(25_000)
    expect(onEnd).toHaveBeenCalledWith(false)
  })

  it('when a player command fails while starting', async () => {
    const onEnd = vi.fn()
    bridge.cmd.mockImplementationOnce(async () => { throw new Error('window gone') })
    const scan = new YouTubeScan('A-scan', ctx, () => {}, onEnd)
    await scan.start('vid00000001', 180).catch(() => {})
    expect(onEnd).toHaveBeenCalledWith(false)
  })

  it('when the audio reader cannot load', async () => {
    worklet = false
    const onEnd = vi.fn()
    const scan = new YouTubeScan('A-scan', ctx, () => {}, onEnd)
    await scan.start('vid00000001', 180)
    expect(onEnd).toHaveBeenCalledWith(false)
  })
})
