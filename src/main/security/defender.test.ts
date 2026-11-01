import { describe, expect, it, vi } from 'vitest'
import { createDefender, parseDefenderStatus, buildDefenderCommand } from './defender'

describe('Defender boundary', () => {
  it('passes hostile filenames as environment data, never executable script', () => {
    const target = "C:\\Users\\me\\a';Start-Process calc;#.html"
    const command = buildDefenderCommand('file', target)
    expect(command.env.AIHUB_SCAN_TARGET).toBe(target)
    const script = Buffer.from(command.args.at(-1)!, 'base64').toString('utf16le')
    expect(script).not.toContain(target)
    expect(script).toContain('$env:AIHUB_SCAN_TARGET')
    expect(script).toContain('-DisableRemediation')
    expect(script).toContain('$scanCode -ne 0 -and $scanCode -ne 2')
    expect(script).not.toContain('Get-MpThreatDetection')
    expect(command.args).toContain('-NonInteractive')
  })
  it('does not report malformed or passive protection as active', () => {
    expect(() => parseDefenderStatus('{}')).toThrow()
    expect(parseDefenderStatus(JSON.stringify({ AntivirusEnabled: true, RealTimeProtectionEnabled: false, AMRunningMode: 'Passive' })).active).toBe(false)
  })
  it('reports unsupported platforms explicitly without launching anything', async () => {
    const run = vi.fn()
    const defender = createDefender({ platform: 'linux', run })
    expect((await defender.status()).available).toBe(false)
    await expect(defender.scan('file', '/tmp/a')).rejects.toThrow(/Windows/)
    expect(run).not.toHaveBeenCalled()
  })
  it('fails closed when scan output is missing or the command fails', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: '{}', stderr: '' })
    const defender = createDefender({ platform: 'win32', run })
    await expect(defender.scan('file', 'C:\\a.html')).rejects.toThrow()
    run.mockRejectedValueOnce(new Error('Access denied'))
    await expect(defender.scan('quick')).rejects.toThrow('Access denied')
  })
  it('retains ambiguous Defender exit-2 results as blocked, never clean', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: '{"completed":true,"detections":0,"blocked":true}', stderr: '' })
    expect(await createDefender({ platform: 'win32', run }).scan('file', 'C:\\invoice;2026.exe')).toEqual({ detected: false, blocked: true })
  })
})
