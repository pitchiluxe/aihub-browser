import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { connectedTrail, type NavigationGraph, type TrailNode } from '../../../../shared/navigationGraph'
import { TRAIL_CATEGORIES } from '../../../../shared/historyLayout'

const COLORS = ['#60a5fa', '#c4b5fd', '#fbbf24', '#fb7185', '#34d399']
export default function HistoryGraph({ onNavigate, revision = 0 }: { onNavigate: (url: string) => void; revision?: number }) {
  const host = useRef<HTMLDivElement>(null)
  const pose = useRef({ camera: [0, 150, 270] as [number, number, number], target: [0, 0, 0] as [number, number, number] })
  const [graph, setGraph] = useState<NavigationGraph>({ nodes: [], edges: [] })
  const [selected, setSelected] = useState<TrailNode | null>(null)
  const [days, setDays] = useState(30)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    window.electronAPI.history.graph().then((value: NavigationGraph) => { if (!cancelled) { setGraph(value); setLoading(false) } }).catch(() => { if (!cancelled) { setError('Could not load navigation trails.'); setLoading(false) } })
    return () => { cancelled = true }
  }, [revision])
  const filtered = useMemo(() => {
    const cutoff = Date.now() - days * 86400_000
    const nodes = graph.nodes.filter(node => node.lastSeen >= cutoff)
    const live = new Set(nodes.map(node => node.id))
    return { nodes, edges: graph.edges.filter(edge => edge.lastSeen >= cutoff && live.has(edge.source) && live.has(edge.target)) }
  }, [graph, days])
  const trail = useMemo(() => selected ? connectedTrail(filtered, selected.id) : null, [filtered, selected])
  useEffect(() => {
    const element = host.current
    if (!element || !filtered.nodes.length) return
    let renderer: THREE.WebGLRenderer | undefined, controls: OrbitControls | undefined, observer: ResizeObserver | undefined
    let mesh: THREE.InstancedMesh | undefined, lines: THREE.LineSegments | undefined
    let disposed = false
    const worker = new Worker(new URL('../../services/historyLayout.worker.ts', import.meta.url), { type: 'module' })
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 2000)
    camera.position.set(...pose.current.camera)
    let render = () => {}
    const contextLost = (event: Event) => { event.preventDefault(); setError('Graphics acceleration is unavailable. Use the page list below.') }
    const pointerDown = { x: 0, y: 0 }
    const down = (event: PointerEvent) => { pointerDown.x = event.clientX; pointerDown.y = event.clientY }
    const pick = (event: PointerEvent) => {
      if (!mesh || Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5) return
      const rect = element.getBoundingClientRect()
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera)
      const hit = raycaster.intersectObject(mesh)[0]
      if (hit?.instanceId !== undefined) setSelected(filtered.nodes[hit.instanceId])
    }
    worker.onerror = () => { if (!disposed) setError('The graph layout could not start. Use the page list below.') }
    worker.onmessage = event => {
      if (disposed) return
      try {
        const { positions, categories, links } = event.data as { positions: Float32Array; categories: Uint8Array; links: Uint16Array }
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
        renderer.domElement.setAttribute('aria-label', 'Navigation trails in 3D. Drag to rotate, scroll to zoom. Select a page below for keyboard access.')
        renderer.domElement.addEventListener('webglcontextlost', contextLost)
        element.appendChild(renderer.domElement)
        controls = new OrbitControls(camera, renderer.domElement)
        controls.target.set(...pose.current.target)
        controls.update()
        controls.enableDamping = false
        controls.minDistance = 35; controls.maxDistance = 600
        render = () => { if (!disposed) renderer?.render(scene, camera) }
        controls.addEventListener('change', render)
        mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial(), filtered.nodes.length)
        const matrix = new THREE.Matrix4()
        filtered.nodes.forEach((node, i) => {
          const size = node.id === selected?.id ? 4 : 1.7 + Math.min(1.5, Math.log2(node.visits + 1) * 0.3)
          matrix.makeScale(size, size, size); matrix.setPosition(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
          mesh!.setMatrixAt(i, matrix)
          const color = new THREE.Color(COLORS[categories[i]])
          if (trail && !trail.has(node.id)) color.multiplyScalar(0.25)
          mesh!.setColorAt(i, color)
        })
        scene.add(mesh)
        const points: number[] = [], colors: number[] = []
        for (let i = 0; i < links.length; i += 2) {
          const from = links[i], to = links[i + 1]
          const highlighted = trail?.has(filtered.nodes[from].id) && trail.has(filtered.nodes[to].id)
          const color = new THREE.Color(highlighted ? '#c4b5fd' : '#334155')
          for (const index of [from, to]) { points.push(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]); colors.push(color.r, color.g, color.b) }
        }
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
        lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.65 }))
        scene.add(lines)
        observer = new ResizeObserver(() => {
          const width = element.clientWidth, height = element.clientHeight
          if (!width || !height) return
          renderer!.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); render()
        })
        observer.observe(element)
        element.addEventListener('pointerdown', down); element.addEventListener('pointerup', pick)
        render()
      } catch { setError('Graphics acceleration is unavailable. Use the page list below.') }
    }
    worker.postMessage(filtered)
    return () => {
      pose.current = { camera: camera.position.toArray() as [number, number, number], target: (controls?.target.toArray() || [0, 0, 0]) as [number, number, number] }
      disposed = true; worker.terminate(); observer?.disconnect(); controls?.dispose()
      element.removeEventListener('pointerdown', down); element.removeEventListener('pointerup', pick)
      if (mesh) { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose() }
      if (lines) { lines.geometry.dispose(); (lines.material as THREE.Material).dispose() }
      if (renderer) { renderer.domElement.removeEventListener('webglcontextlost', contextLost); renderer.forceContextLoss(); renderer.dispose(); renderer.domElement.remove() }
    }
  }, [filtered, selected, trail])
  return <div className="flex flex-col h-full min-h-0">
    <div className="flex items-center gap-4 flex-wrap px-6 py-3 border-b border-aihub-border text-xs text-aihub-muted">
      <label>Show <select aria-label="Trail time range" className="bg-aihub-card rounded px-2 py-1 ml-2 text-aihub-text" value={days} onChange={event => { setDays(Number(event.target.value)); setSelected(null) }}><option value={1}>Today</option><option value={7}>7 days</option><option value={30}>30 days</option><option value={3650}>All trails</option></select></label>
      {TRAIL_CATEGORIES.map((category, i) => <span key={category} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: COLORS[i] }} />{category}</span>)}
      <span>{filtered.nodes.length} pages · {filtered.edges.length} discovery links</span>
    </div>
    <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_260px]">
      <div className="relative min-h-64"><div ref={host} className="absolute inset-0" />{(loading || error || !filtered.nodes.length) && <p role={error ? 'alert' : undefined} className="absolute inset-0 flex items-center justify-center p-10 text-sm text-aihub-muted text-center pointer-events-none">{loading ? 'Loading navigation trails…' : error || 'Browse a few pages to build your map. Links appear when you navigate between pages in a tab.'}</p>}<p className="absolute bottom-4 left-5 text-xs text-aihub-muted pointer-events-none">Drag to rotate · Scroll to zoom · Select a page to follow its trail</p></div>
      <aside className="border-l border-aihub-border overflow-auto p-4">
        {selected && <div className="mb-5 border-b border-aihub-border pb-4"><h2 className="font-medium text-sm break-words">{selected.title}</h2><p className="text-xs text-aihub-muted mt-2 break-all">{selected.url}</p><p className="text-xs text-aihub-muted mt-2">{selected.visits} visits · {trail?.size || 1} pages in this trail</p><button className="text-xs text-aihub-accent mt-3 mr-4" onClick={() => onNavigate(selected.url)}>Open page</button><button className="text-xs text-aihub-muted" onClick={() => setSelected(null)}>Clear selection</button><h3 className="text-xs mt-4">Discovered from</h3>{filtered.edges.filter(edge => edge.target === selected.id).map(edge => <button key={edge.source} className="text-xs text-aihub-accent text-left block truncate w-full mt-2" onClick={() => setSelected(filtered.nodes.find(node => node.id === edge.source) || null)}>{filtered.nodes.find(node => node.id === edge.source)?.title}</button>)}</div>}
        <h2 className="text-xs font-medium mb-3">{selected ? 'Pages in this trail' : 'Recent pages'}</h2>
        {filtered.nodes.filter(node => !trail || trail.has(node.id)).map(node => <button key={node.id} className={`block w-full text-left text-xs py-2 px-2 rounded-lg ${selected?.id === node.id ? 'bg-aihub-card text-aihub-accent' : 'text-aihub-muted hover:bg-aihub-card'}`} onClick={() => setSelected(node)}><span className="block truncate">{node.title}</span><span className="block truncate opacity-60 mt-1">{node.domain}</span></button>)}
      </aside>
    </div>
  </div>
}
