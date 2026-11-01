import { execFile } from 'child_process'
import { join, win32 } from 'path'
import type { DefenderStatus } from '../../shared/security'

export type ScanKind = 'file' | 'folder' | 'quick' | 'full'
type CommandResult = { stdout: string; stderr: string }
export type DefenderRun = (exe: string, args: string[], options: { env: NodeJS.ProcessEnv; timeout: number; windowsHide: boolean; maxBuffer: number }) => Promise<CommandResult>
const STATUS = `$s=Get-MpComputerStatus; [ordered]@{AntivirusEnabled=$s.AntivirusEnabled;RealTimeProtectionEnabled=$s.RealTimeProtectionEnabled;AMRunningMode=$s.AMRunningMode;SignaturesUpdated=if($s.AntivirusSignatureLastUpdated){$s.AntivirusSignatureLastUpdated.ToString('o')}else{$null};LastQuickScan=if($s.QuickScanEndTime){$s.QuickScanEndTime.ToString('o')}else{$null}} | ConvertTo-Json -Compress`

export function buildDefenderCommand(kind: ScanKind | 'status', target?: string) {
  if (!['status', 'file', 'folder', 'quick', 'full'].includes(kind)) throw Error('Unsupported scan type.')
  if ((kind === 'file' || kind === 'folder') && (!target || !win32.isAbsolute(target) || /[\0\r\n]/.test(target))) throw Error('Choose a valid absolute scan path.')
  const scan = `Start-MpScan -ScanType ${kind === 'full' ? 'FullScan' : 'QuickScan'}`
  const customScan = kind === 'file' || kind === 'folder' ? `
    $platform=Join-Path $env:ProgramData 'Microsoft\\Windows Defender\\Platform'
    $mp=$null
    if(Test-Path -LiteralPath $platform){$mp=Get-ChildItem -LiteralPath $platform -Directory | Sort-Object Name -Descending | ForEach-Object {Join-Path $_.FullName 'MpCmdRun.exe'} | Where-Object {Test-Path -LiteralPath $_} | Select-Object -First 1}
    if(-not $mp){$mp=Join-Path $env:ProgramFiles 'Windows Defender\\MpCmdRun.exe'}
    if(-not (Test-Path -LiteralPath $mp)){throw 'Defender file scanner could not be found.'}
    $ErrorActionPreference='Continue'
    $scanOutput=& $mp -Scan -ScanType 3 -File $env:AIHUB_SCAN_TARGET -DisableRemediation 2>&1
    $scanCode=$LASTEXITCODE
    $ErrorActionPreference='Stop'
    if($scanCode -ne 0 -and $scanCode -ne 2){throw 'Defender did not return a verified scan result.'}
    [ordered]@{completed=$true;detections=0;blocked=($scanCode -eq 2)} | ConvertTo-Json -Compress
  ` : ''
  const script = `$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;` + (kind === 'status' ? STATUS : `
    $s=Get-MpComputerStatus
    if(-not $s.AntivirusEnabled -or $s.AMRunningMode -ne 'Normal'){throw 'Microsoft Defender is unavailable or not in active mode.'}
    ${customScan ? customScan : `
    $started=Get-Date
    ${scan} | Out-Null
    $hits=@(Get-MpThreatDetection | Where-Object {
      $_.InitialDetectionTime -ge $started -or $_.LastThreatStatusChangeTime -ge $started
    })
    [ordered]@{completed=$true;detections=$hits.Count} | ConvertTo-Json -Compress
    `}
  `)
  return { args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], env: { ...process.env, AIHUB_SCAN_TARGET: target || '' } }
}

export function parseDefenderStatus(stdout: string): DefenderStatus {
  const s = JSON.parse(stdout.replace(/^\uFEFF/, '').trim())
  if (!s || typeof s.AntivirusEnabled !== 'boolean' || typeof s.RealTimeProtectionEnabled !== 'boolean' || typeof s.AMRunningMode !== 'string') throw Error('Unable to read Defender protection status.')
  return { available: true, active: s.AntivirusEnabled && s.AMRunningMode === 'Normal', realTime: s.RealTimeProtectionEnabled, mode: s.AMRunningMode, signaturesUpdated: s.SignaturesUpdated || undefined, lastQuickScan: s.LastQuickScan || undefined }
}

const defaultRun: DefenderRun = (exe, args, options) => new Promise((resolve, reject) => {
  execFile(exe, args, { ...options, encoding: 'utf8' }, (error, stdout, stderr) => error ? reject(new Error(error.killed ? 'Defender scan timed out. Its result is unknown.' : 'Defender could not complete the request. Check Windows Security and your permissions.')) : resolve({ stdout, stderr }))
})

export function createDefender(options: { platform?: string; run?: DefenderRun } = {}) {
  const platform = options.platform ?? process.platform
  const run = options.run ?? defaultRun
  const execute = async (kind: ScanKind | 'status', target?: string) => {
    if (platform !== 'win32') throw Error('Microsoft Defender controls are available on Windows only.')
    const command = buildDefenderCommand(kind, target)
    return run(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), command.args, { env: command.env, timeout: kind === 'status' ? 20_000 : kind === 'full' ? 7_200_000 : 900_000, windowsHide: true, maxBuffer: 512 * 1024 })
  }
  return {
    async status(): Promise<DefenderStatus> {
      try { return parseDefenderStatus((await execute('status')).stdout) }
      catch (e) { return { available: false, active: false, realTime: false, mode: 'Unavailable', message: e instanceof Error ? e.message : 'Defender unavailable.' } }
    },
    async scan(kind: ScanKind, target?: string): Promise<{ detected: boolean; blocked?: boolean }> {
      const result = JSON.parse((await execute(kind, target)).stdout.replace(/^\uFEFF/, '').trim())
      if (result?.completed !== true || !Number.isSafeInteger(result.detections) || result.detections < 0) throw Error('Defender did not return a verified scan result.')
      return { detected: result.detections > 0, ...(result.blocked === true ? { blocked: true } : {}) }
    },
  }
}
