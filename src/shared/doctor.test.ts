import { describe, it, expect } from 'vitest'
import { createDoctorModel, DOCTOR_LIMITS, type ProcessSample, type Sample } from './doctor'

const sample = (at: number, loopP99Ms = 20, processes: ProcessSample[] = [], loopMaxMs = loopP99Ms): Sample =>
  ({ at, loopP99Ms, loopMaxMs, processes })
const tabProc = (pid: number, cpu: number, memMb: number, active = false, id = `t${pid}`): ProcessSample =>
  ({ pid, type: 'Tab', cpu, memMb, tab: { id, windowId: 1, title: `Tab ${pid}`, active } })

describe('Agent Doctor model', () => {
  it('is ok with healthy samples', () => {
    const d = createDoctorModel()
    for (let i = 0; i < 5; i++) d.addSample(sample(i * 10_000, 15, [tabProc(10, 5, 200)]))
    const s = d.snapshot(50_000)
    expect(s.status).toBe('ok')
    expect(s.findings).toEqual([])
    expect(s.samples).toHaveLength(5)
  })

  it('caps the sample history', () => {
    const d = createDoctorModel()
    for (let i = 0; i < DOCTOR_LIMITS.samples + 10; i++) d.addSample(sample(i * 10_000))
    expect(d.snapshot(1e9).samples).toHaveLength(DOCTOR_LIMITS.samples)
  })

  it('flags sustained main-process lag only after consecutive slow samples', () => {
    const d = createDoctorModel()
    d.addSample(sample(0, 400))
    d.addSample(sample(10_000, 400))
    expect(d.snapshot(10_000).findings.map(f => f.kind)).not.toContain('main-stall')
    d.addSample(sample(20_000, 400))
    const s = d.snapshot(20_000)
    expect(s.status).toBe('critical')
    expect(s.findings[0]).toMatchObject({ kind: 'main-stall', since: 0 })
  })

  it('reports a single long block as a spike, not a stall', () => {
    const d = createDoctorModel()
    d.addSample(sample(0, 30, [], 1800))
    expect(d.snapshot(0).findings.map(f => f.kind)).toEqual(['main-spike'])
  })

  it('reports a hung tab only after the grace period, and clears it on recovery', () => {
    const d = createDoctorModel()
    d.tabUnresponsive(1, 'a', 'Slow page', 0)
    expect(d.snapshot(3_000).findings).toEqual([])
    const hung = d.snapshot(9_000).findings
    expect(hung).toHaveLength(1)
    expect(hung[0]).toMatchObject({ kind: 'tab-hung', severity: 'critical', tab: { id: 'a', windowId: 1 } })
    d.tabResponsive(1, 'a', 10_000)
    expect(d.snapshot(10_000).findings).toEqual([])
  })

  it('flags a background tab burning CPU for a full minute, never the active one', () => {
    const d = createDoctorModel()
    for (let i = 0; i < DOCTOR_LIMITS.cpuSamples; i++) {
      d.addSample(sample(i * 10_000, 20, [tabProc(10, 80, 300), tabProc(11, 95, 300, true)]))
    }
    const f = d.snapshot(60_000).findings
    expect(f.map(x => x.kind)).toEqual(['tab-cpu'])
    expect(f[0].tab?.id).toBe('t10')
  })

  it('does not flag CPU from a brief burst', () => {
    const d = createDoctorModel()
    for (let i = 0; i < DOCTOR_LIMITS.cpuSamples; i++) {
      d.addSample(sample(i * 10_000, 20, [tabProc(10, i === 3 ? 5 : 80, 300)]))
    }
    expect(d.snapshot(60_000).findings).toEqual([])
  })

  it('flags a tab holding a lot of memory', () => {
    const d = createDoctorModel()
    d.addSample(sample(0, 20, [tabProc(10, 1, 2048)]))
    expect(d.snapshot(0).findings[0]).toMatchObject({ kind: 'tab-memory', severity: 'warn' })
  })

  it('shows a crash for a while, then lets it drop off', () => {
    const d = createDoctorModel()
    d.tabCrashed(1, 'a', 'Boom', 'crashed', 0)
    expect(d.snapshot(1_000).findings[0]).toMatchObject({ kind: 'tab-crashed' })
    expect(d.snapshot(DOCTOR_LIMITS.crashShowMs + 1).findings).toEqual([])
  })

  it('journals when problems open and resolve, newest first, keeping the start time', () => {
    const d = createDoctorModel()
    d.tabUnresponsive(1, 'a', 'Slow page', 0)
    d.snapshot(9_000)
    const ongoing = d.snapshot(20_000).findings[0]
    expect(ongoing.since).toBe(0)
    d.tabResponsive(1, 'a', 25_000)
    const j = d.snapshot(25_000).journal
    expect(j.map(e => e.event)).toEqual(['resolved', 'opened'])
    expect(j[0]).toMatchObject({ kind: 'tab-hung', at: 25_000 })
  })

  it('forgets a hung tab that was closed', () => {
    const d = createDoctorModel()
    d.tabUnresponsive(1, 'a', 'Slow page', 0)
    expect(d.snapshot(9_000).findings).toHaveLength(1)
    d.tabClosed(1, 'a', 9_500)
    expect(d.snapshot(10_000).findings).toEqual([])
  })

  it('orders critical findings before warnings', () => {
    const d = createDoctorModel()
    d.addSample(sample(0, 20, [tabProc(10, 1, 2048)]))
    d.tabUnresponsive(1, 'b', 'Hung', 0)
    const kinds = d.snapshot(9_000).findings.map(f => f.kind)
    expect(kinds).toEqual(['tab-hung', 'tab-memory'])
  })
})
