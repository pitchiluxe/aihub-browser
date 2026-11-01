import React from 'react'
import type { FileScan } from '../../../../shared/security'

export default function DownloadSecurity({ scan }: { scan?: FileScan }) {
  const label = !scan ? 'Not scanned' : ({ pending: 'Scan queued', scanning: 'Scanning', 'no-threats-found': 'No threats found', detected: 'Detection · blocked', blocked: 'Scan blocked · review', failed: 'Scan failed · unverified', unavailable: 'Scanner unavailable' })[scan.state]
  const color = scan?.state === 'detected' || scan?.state === 'blocked' ? '#f87171' : scan?.state === 'no-threats-found' ? '#6ee7b7' : '#fbbf24'
  return <p className="text-xs mt-1" style={{ color }} title={scan?.message}>{label}</p>
}
