import React, { useEffect, useRef, useState } from 'react'
import { ROM_SYSTEMS } from '../../../../shared/games/catalog'
import type { RomFiles, RomGame } from '../../services/gameLibrary'
export default function RomPlayer({ game, files, paused }: { game: RomGame; files: RomFiles; paused: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null), channel = useRef<MessagePort | null>(null), currentPause = useRef(paused)
  const [status, setStatus] = useState('Loading the emulator…'), [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  currentPause.current = paused
  useEffect(() => { channel.current?.postMessage({ type: 'pause', paused }) }, [paused])
  useEffect(() => {
    let cancelled = false
    let port: MessagePort | undefined
    setStatus('Loading the emulator…'); setError('')
    const timeout = setTimeout(() => setError('The emulator is taking too long to start. Check your connection, selected system, and game file, then try again.'), 90_000)
    const onReady = async (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.type !== 'aihub-game-ready' || port) return
      const connection = new MessageChannel(); port = connection.port1; channel.current = port
      port.onmessage = async message => {
        if (cancelled) return
        if (message.data?.type === 'started') { setStatus(''); setError(''); clearTimeout(timeout) }
        if (message.data?.type === 'error') { setError(String(message.data.message || 'The game could not start.')); clearTimeout(timeout) }
        if (message.data?.type === 'connected') {
          try {
            const rom = await files.game.arrayBuffer(), bios = files.bios ? await files.bios.arrayBuffer() : undefined
            if (cancelled) return
            port!.postMessage({ type: 'load', rom, bios, core: ROM_SYSTEMS.find(system => system.id === game.system)!.core, title: game.title, fileName: game.fileName }, bios ? [rom, bios] : [rom])
            port!.postMessage({ type: 'pause', paused: currentPause.current })
          } catch { setError('Could not read the imported game. Import it again.'); clearTimeout(timeout) }
        }
      }
      frame.current!.contentWindow!.postMessage({ type: 'aihub-game-connect' }, '*', [connection.port2])
    }
    window.addEventListener('message', onReady)
    return () => { cancelled = true; window.removeEventListener('message', onReady); clearTimeout(timeout); port?.close(); channel.current = null }
  }, [game.id, attempt])
  return <div className="gr-rom-player"><iframe ref={frame} key={`${game.id}-${attempt}`} title={`Playing ${game.title}`} src={new URL('./game-emulator.html', window.location.href).href} sandbox="allow-scripts allow-downloads" allow="fullscreen; autoplay; gamepad" allowFullScreen onLoad={() => frame.current?.contentWindow?.postMessage({ type: 'aihub-game-ping' }, '*')} />{status && !error && <div className="gr-rom-status" role="status">{status}</div>}{error && <div className="gr-rom-error" role="alert"><p>{error}</p><button className="gr-control" onClick={() => setAttempt(value => value + 1)}>Try again</button></div>}<p className="gr-rom-notice">Keyboard and controller mappings are available in the player’s controls menu. Use its save-state buttons to download and restore progress. EmulatorJS 4.2.3 runs in an isolated player. <a href="https://github.com/EmulatorJS/EmulatorJS/tree/v4.2.3" target="_blank" rel="noreferrer">Source & licenses</a></p></div>
}
