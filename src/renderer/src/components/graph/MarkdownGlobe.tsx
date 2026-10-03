import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { GraphLink, GraphNode } from '../../services/markdownGraphService'
import { graphNodeColor } from './nodeStyle'

interface Props {
  nodes: GraphNode[]
  links: GraphLink[]
  query: string
  selectedId: string | null
  onSelect: (node: GraphNode) => void
}

interface Planet {
  id: string
  name: string
  label: string
  category: string
  color: THREE.Color
  radius: number
  position: THREE.Vector3
  rotationSpeed: number
  nodes: GraphNode[]
}

interface OrbitingNode {
  data: GraphNode
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  base: THREE.Vector3
  axis: THREE.Vector3
  phase: number
  speed: number
  dragging: boolean
}

interface DynamicConnection {
  source: OrbitingNode
  target: OrbitingNode
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  sourceWorld: THREE.Vector3
  targetWorld: THREE.Vector3
}

interface PlanetConnection {
  source: THREE.Group
  target: THREE.Group
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  sourceWorld: THREE.Vector3
  targetWorld: THREE.Vector3
  controlOffset: number
}

type DragTarget =
  | { kind: 'planet'; group: THREE.Group; plane: THREE.Plane; offset: THREE.Vector3 }
  | { kind: 'node'; node: OrbitingNode; group: THREE.Group; plane: THREE.Plane }

const MAX_PLANETS = 8
const MAX_NOTES_PER_PLANET = 8
const PLANET_NAMES = ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune']

function hashValue(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0
  return Math.abs(hash)
}

function makePlanets(nodes: GraphNode[]): Planet[] {
  const categories = new Map<string, GraphNode[]>()
  for (const node of nodes) {
    const category = node.category || 'General'
    if (!categories.has(category)) categories.set(category, [])
    categories.get(category)!.push(node)
  }

  const clusters: Array<{ category: string; nodes: GraphNode[] }> = []
  for (const [category, members] of categories) {
    for (let start = 0; start < members.length; start += MAX_NOTES_PER_PLANET) {
      clusters.push({ category, nodes: members.slice(start, start + MAX_NOTES_PER_PLANET) })
    }
  }

  // Even a single-category collection gets several connected worlds once it
  // has enough pages, instead of collapsing into one oversized planet.
  if (clusters.length === 1 && nodes.length > 1) {
    const chunkSize = Math.max(1, Math.ceil(nodes.length / 4))
    clusters.splice(0, 1, ...Array.from({ length: Math.ceil(nodes.length / chunkSize) }, (_, index) => ({
      category: clusters[0].category,
      nodes: nodes.slice(index * chunkSize, (index + 1) * chunkSize),
    })))
  }

  if (clusters.length > MAX_PLANETS) {
    const reduced: Array<{ category: string; nodes: GraphNode[] }> = clusters.slice(0, MAX_PLANETS - 1)
    for (const cluster of clusters.slice(MAX_PLANETS - 1)) {
      reduced[MAX_PLANETS - 2].nodes.push(...cluster.nodes)
    }
    clusters.splice(0, clusters.length, ...reduced)
  }

  const count = Math.max(clusters.length, 1)
  const spread = Math.min(310, 145 + count * 22)
  return clusters.map((cluster, index) => {
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2
    const position = new THREE.Vector3(
      Math.cos(angle) * spread,
      Math.sin(angle) * spread * 0.72,
      Math.sin(angle) * spread * 0.2,
    )
    const seed = cluster.nodes[0]?.id || cluster.category
    const color = new THREE.Color(cluster.nodes[0]?.color || graphNodeColor(seed))
    const radius = Math.max(37, Math.min(66, 36 + Math.sqrt(cluster.nodes.length) * 10))
    return {
      id: `${cluster.category}-${index}`,
      name: PLANET_NAMES[index],
      label: cluster.category,
      category: cluster.category,
      color,
      radius,
      position,
      rotationSpeed: 0.001 + (hashValue(seed) % 8) * 0.0002,
      nodes: cluster.nodes,
    }
  })
}

function disposeObject(object: THREE.Object3D) {
  object.traverse(child => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Points || child instanceof THREE.Line) {
      child.geometry.dispose()
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      materials.forEach(material => {
        if ('map' in material && material.map instanceof THREE.Texture) material.map.dispose()
        material.dispose()
      })
    } else if (child instanceof THREE.Sprite) {
      child.material.map?.dispose()
      child.material.dispose()
    }
  })
}

function fitSystemToView(host: HTMLDivElement, camera: THREE.PerspectiveCamera, system: THREE.Group) {
  const width = Math.max(1, host.clientWidth)
  const height = Math.max(1, host.clientHeight)
  camera.aspect = width / height
  camera.updateProjectionMatrix()

  let halfWidth = 0
  let halfHeight = 0
  for (const child of system.children) {
    const radius = Math.max(Number(child.userData.planetRadius) || 0, Number(child.userData.orbitRadius) || 0)
    halfWidth = Math.max(halfWidth, Math.abs(child.position.x) + radius)
    halfHeight = Math.max(halfHeight, Math.abs(child.position.y) + radius)
  }
  const verticalFov = THREE.MathUtils.degToRad(camera.fov)
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect)
  const fitDistance = Math.max(720, halfWidth / Math.tan(horizontalFov / 2), halfHeight / Math.tan(verticalFov / 2)) * 1.08
  camera.userData.fitDistance = fitDistance
  camera.position.z = fitDistance
}

export default function MarkdownGlobe({ nodes, links, query, selectedId, onSelect }: Props) {
  const planets = useMemo(() => makePlanets(nodes), [nodes])
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const worldRef = useRef<THREE.Group | null>(null)
  const systemRef = useRef<THREE.Group | null>(null)
  const nodesRef = useRef<GraphNode[]>(nodes)
  const onSelectRef = useRef(onSelect)
  const orbitingNodesRef = useRef<OrbitingNode[]>([])
  const planetGroupsRef = useRef<Array<{ group: THREE.Group; speed: number }>>([])
  const dynamicConnectionsRef = useRef<DynamicConnection[]>([])
  const planetConnectionsRef = useRef<THREE.Object3D[]>([])
  const planetBridgeDynamicsRef = useRef<PlanetConnection[]>([])
  const pickablesRef = useRef<THREE.Object3D[]>([])
  const pointerRef = useRef({ down: false, moved: false, x: 0, y: 0, target: null as DragTarget | null })

  useEffect(() => { nodesRef.current = nodes }, [nodes])
  useEffect(() => { onSelectRef.current = onSelect }, [onSelect])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' })
    } catch {
      host.dataset.webglUnavailable = 'true'
      return
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(host.clientWidth, host.clientHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.setClearColor(0x050a14, 0)
    renderer.domElement.className = 'absolute inset-0 h-full w-full touch-none'
    renderer.domElement.setAttribute('aria-label', 'Interactive multi-planet knowledge graph')
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(42, host.clientWidth / Math.max(1, host.clientHeight), 0.1, 2400)
    camera.position.set(0, 0, 720)
    const world = new THREE.Group()
    const system = new THREE.Group()
    world.add(system)
    scene.add(world)
    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(17, 32, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd17a, toneMapped: false }),
    )
    sun.userData.isCentralStar = true
    world.add(sun)
    const glowCanvas = document.createElement('canvas')
    glowCanvas.width = 128
    glowCanvas.height = 128
    const glowContext = glowCanvas.getContext('2d')
    if (glowContext) {
      const glow = glowContext.createRadialGradient(64, 64, 5, 64, 64, 64)
      glow.addColorStop(0, 'rgba(255, 217, 143, 0.8)')
      glow.addColorStop(0.2, 'rgba(255, 172, 84, 0.28)')
      glow.addColorStop(1, 'rgba(255, 140, 55, 0)')
      glowContext.fillStyle = glow
      glowContext.fillRect(0, 0, 128, 128)
    }
    const glowTexture = new THREE.CanvasTexture(glowCanvas)
    const solarFlare = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture, color: 0xffbf70, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }))
    solarFlare.scale.set(90, 90, 1)
    world.add(solarFlare)
    const sunlight = new THREE.PointLight(0xffbd68, 72, 1100)
    world.add(sunlight)
    scene.add(new THREE.AmbientLight(0x9bb7d5, 1.65))
    const keyLight = new THREE.PointLight(0x78d9e5, 110, 1400)
    keyLight.position.set(-280, 220, 450)
    scene.add(keyLight)
    const fillLight = new THREE.PointLight(0xffa86a, 48, 1100)
    fillLight.position.set(260, -150, -350)
    scene.add(fillLight)

    const starPositions = new Float32Array(1600 * 3)
    for (let i = 0; i < starPositions.length; i += 3) {
      const radius = 650 + Math.random() * 950
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      starPositions[i] = radius * Math.sin(phi) * Math.cos(theta)
      starPositions[i + 1] = radius * Math.cos(phi)
      starPositions[i + 2] = radius * Math.sin(phi) * Math.sin(theta)
    }
    const starsGeometry = new THREE.BufferGeometry()
    starsGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
    const stars = new THREE.Points(starsGeometry, new THREE.PointsMaterial({ color: 0xc7d8e9, size: 1.4, transparent: true, opacity: 0.68 }))
    scene.add(stars)

    sceneRef.current = scene
    cameraRef.current = camera
    rendererRef.current = renderer
    worldRef.current = world
    systemRef.current = system

    const resize = () => {
      fitSystemToView(host, camera, system)
      renderer.setSize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight))
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)

    const pointer = new THREE.Vector2()
    const raycaster = new THREE.Raycaster()
    const onPointerDown = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects(pickablesRef.current, false)[0]?.object as THREE.Mesh | undefined
      const hitNode = hit?.userData.node as OrbitingNode | undefined
      const planetGroup = (hitNode?.mesh.parent as THREE.Group | undefined)
        || planetGroupsRef.current.find(item => item.group.userData.planetId === hit?.userData.planetId)?.group
      let target: DragTarget | null = null

      if (hitNode && planetGroup) {
        const center = planetGroup.getWorldPosition(new THREE.Vector3())
        const normal = camera.getWorldDirection(new THREE.Vector3())
        hitNode.dragging = true
        target = { kind: 'node', node: hitNode, group: planetGroup, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, center) }
      } else if (planetGroup) {
        const center = planetGroup.getWorldPosition(new THREE.Vector3())
        const normal = camera.getWorldDirection(new THREE.Vector3())
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, center)
        const start = raycaster.ray.intersectPlane(plane, new THREE.Vector3())
        target = { kind: 'planet', group: planetGroup, plane, offset: start ? center.sub(start) : new THREE.Vector3() }
      }

      pointerRef.current = { down: true, moved: false, x: event.clientX, y: event.clientY, target }
      renderer.domElement.setPointerCapture(event.pointerId)
    }
    const onPointerMove = (event: PointerEvent) => {
      const state = pointerRef.current
      if (!state.down) return
      const dx = event.clientX - state.x
      const dy = event.clientY - state.y
      if (Math.abs(dx) + Math.abs(dy) > 2) state.moved = true
      if (state.target) {
        const rect = renderer.domElement.getBoundingClientRect()
        pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
        raycaster.setFromCamera(pointer, camera)
        const intersection = raycaster.ray.intersectPlane(state.target.plane, new THREE.Vector3())
        if (intersection) {
          if (state.target.kind === 'planet') {
            const destination = intersection.add(state.target.offset)
            system.worldToLocal(destination)
            state.target.group.position.copy(destination)
          } else {
            const local = state.target.group.worldToLocal(intersection)
            local.setLength(state.target.node.base.length())
            state.target.node.base.copy(local)
            state.target.node.mesh.position.copy(local)
          }
        }
      } else {
        world.rotation.y += dx * 0.005
        world.rotation.x = THREE.MathUtils.clamp(world.rotation.x + dy * 0.005, -1.1, 1.1)
      }
      state.x = event.clientX
      state.y = event.clientY
    }
    const onPointerUp = (_event: PointerEvent) => {
      const state = pointerRef.current
      pointerRef.current.down = false
      if (!state.moved && state.target?.kind === 'node') onSelectRef.current(state.target.node.data)
      if (state.target?.kind === 'node') state.target.node.dragging = false
      pointerRef.current.target = null
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      camera.position.z = THREE.MathUtils.clamp(camera.position.z + event.deltaY * 0.45, 400, Math.max(1800, (camera.userData.fitDistance || 720) * 1.5))
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerup', onPointerUp)
    renderer.domElement.addEventListener('pointercancel', onPointerUp)
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false })

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let frame = 0
    const animate = () => {
      frame = requestAnimationFrame(animate)
      const time = performance.now() / 1000
      if (!pointerRef.current.down && !reducedMotion) world.rotation.y += 0.00032

      for (const { group, speed } of planetGroupsRef.current) {
        if (!pointerRef.current.down) group.rotation.y += speed
      }
      for (const node of orbitingNodesRef.current) {
        if (!node.dragging) node.mesh.position.copy(node.base).applyAxisAngle(node.axis, time * node.speed + node.phase)
      }
      for (const connection of dynamicConnectionsRef.current) {
        const positions = connection.line.geometry.attributes.position as THREE.BufferAttribute
        connection.source.mesh.getWorldPosition(connection.sourceWorld)
        connection.target.mesh.getWorldPosition(connection.targetWorld)
        system.worldToLocal(connection.sourceWorld)
        system.worldToLocal(connection.targetWorld)
        positions.setXYZ(0, connection.sourceWorld.x, connection.sourceWorld.y, connection.sourceWorld.z)
        positions.setXYZ(1, connection.targetWorld.x, connection.targetWorld.y, connection.targetWorld.z)
        positions.needsUpdate = true
      }
      for (const connection of planetBridgeDynamicsRef.current) {
        connection.source.getWorldPosition(connection.sourceWorld)
        connection.target.getWorldPosition(connection.targetWorld)
        system.worldToLocal(connection.sourceWorld)
        system.worldToLocal(connection.targetWorld)
        const midpoint = connection.sourceWorld.clone().add(connection.targetWorld).multiplyScalar(0.5)
        midpoint.y += connection.controlOffset
        const points = new THREE.QuadraticBezierCurve3(connection.sourceWorld, midpoint, connection.targetWorld).getPoints(40)
        const positions = connection.line.geometry.attributes.position as THREE.BufferAttribute
        points.forEach((point, index) => positions.setXYZ(index, point.x, point.y, point.z))
        positions.needsUpdate = true
        connection.line.geometry.computeBoundingSphere()
      }
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      renderer.domElement.removeEventListener('pointercancel', onPointerUp)
      renderer.domElement.removeEventListener('wheel', onWheel)
      scene.traverse(disposeObject)
      renderer.dispose()
      renderer.domElement.remove()
      sceneRef.current = null
      cameraRef.current = null
      rendererRef.current = null
      worldRef.current = null
      systemRef.current = null
      orbitingNodesRef.current = []
      planetGroupsRef.current = []
      dynamicConnectionsRef.current = []
      planetConnectionsRef.current = []
      planetBridgeDynamicsRef.current = []
      pickablesRef.current = []
    }
  }, [])

  useEffect(() => {
    const scene = sceneRef.current
    const world = worldRef.current
    const system = systemRef.current
    if (!scene || !world || !system) return

    for (const connection of planetConnectionsRef.current) {
      connection.parent?.remove(connection)
      disposeObject(connection)
    }
    planetConnectionsRef.current = []

    while (system.children.length) {
      const child = system.children[0]
      system.remove(child)
      disposeObject(child)
    }
    orbitingNodesRef.current = []
    planetGroupsRef.current = []
    dynamicConnectionsRef.current = []
    planetConnectionsRef.current = []
    planetBridgeDynamicsRef.current = []
    pickablesRef.current = []

    const planetForNode = new Map<string, Planet>()
    const planetGroupById = new Map<string, THREE.Group>()
    const nodeById = new Map<string, OrbitingNode>()

    for (const planet of planets) {
      const radial = planet.position.clone().normalize()
      const normal = new THREE.Vector3(0.18, 0.26, 1).normalize()
      const tangent = new THREE.Vector3().crossVectors(normal, radial).normalize()
      if (tangent.lengthSq() < 0.01) tangent.set(0, 1, 0)
      const orbitRadius = planet.position.length()
      const orbitPoints = Array.from({ length: 128 }, (_, index) => {
        const angle = (index / 128) * Math.PI * 2
        return radial.clone().multiplyScalar(Math.cos(angle) * orbitRadius)
          .addScaledVector(tangent, Math.sin(angle) * orbitRadius * 0.68)
      })
      const orbit = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(orbitPoints),
        new THREE.LineBasicMaterial({ color: 0x668396, transparent: true, opacity: 0.12 }),
      )
      orbit.userData.orbitRadius = orbitRadius
      system.add(orbit)
    }

    for (const planet of planets) {
      const group = new THREE.Group()
      group.position.copy(planet.position)
      group.userData.planetRadius = planet.radius * 1.55
      group.userData.planetId = planet.id
      system.add(group)
      planetGroupById.set(planet.id, group)
      planetGroupsRef.current.push({ group, speed: planet.rotationSpeed })

      const coreMaterial = new THREE.MeshStandardMaterial({
        color: planet.color.clone().multiplyScalar(0.34),
        emissive: planet.color,
        emissiveIntensity: 0.17,
        roughness: 0.76,
        metalness: 0.16,
      })
      const core = new THREE.Mesh(new THREE.SphereGeometry(planet.radius, 40, 28), coreMaterial)
      core.userData.planetId = planet.id
      group.add(core)
      pickablesRef.current.push(core)

      const atmosphere = new THREE.Mesh(
        new THREE.SphereGeometry(planet.radius * 1.12, 36, 24),
        new THREE.MeshBasicMaterial({ color: planet.color, side: THREE.BackSide, transparent: true, opacity: 0.12 }),
      )
      group.add(atmosphere)

      const labelCanvas = document.createElement('canvas')
      labelCanvas.width = 360
      labelCanvas.height = 96
      const labelContext = labelCanvas.getContext('2d')
      if (labelContext) {
        labelContext.font = '700 30px Segoe UI, sans-serif'
        labelContext.textAlign = 'center'
        labelContext.textBaseline = 'alphabetic'
        labelContext.fillStyle = `#${planet.color.getHexString()}`
        labelContext.shadowColor = `#${planet.color.getHexString()}`
        labelContext.shadowBlur = 12
        labelContext.fillText(`${String(planets.indexOf(planet) + 1).padStart(2, '0')} ${planet.name.toUpperCase()}`, 180, 39, 340)
        labelContext.font = '500 19px Segoe UI, sans-serif'
        labelContext.globalAlpha = 0.82
        labelContext.fillText(planet.category.toUpperCase(), 180, 72, 340)
      }
      const labelTexture = new THREE.CanvasTexture(labelCanvas)
      labelTexture.colorSpace = THREE.SRGBColorSpace
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture, transparent: true, depthTest: false }))
      label.position.set(0, planet.radius + 25, 0)
      label.scale.set(planet.radius * 2.55, planet.radius * 0.68, 1)
      group.add(label)

      const gridMaterial = new THREE.LineBasicMaterial({ color: planet.color, transparent: true, opacity: 0.19 })
      for (const latitude of [-0.72, -0.36, 0, 0.36, 0.72]) {
        const ringRadius = planet.radius * Math.cos(latitude)
        const height = planet.radius * Math.sin(latitude)
        const points = Array.from({ length: 64 }, (_, index) => {
          const angle = (index / 64) * Math.PI * 2
          return new THREE.Vector3(Math.cos(angle) * ringRadius, height, Math.sin(angle) * ringRadius)
        })
        group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), gridMaterial))
      }
      for (let meridian = 0; meridian < 4; meridian++) {
        const longitude = (meridian / 4) * Math.PI
        const points = Array.from({ length: 64 }, (_, index) => {
          const latitude = (index / 63) * Math.PI * 2
          return new THREE.Vector3(
            planet.radius * Math.sin(latitude) * Math.cos(longitude),
            planet.radius * Math.cos(latitude),
            planet.radius * Math.sin(latitude) * Math.sin(longitude),
          )
        })
        group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), gridMaterial))
      }

      const axis = new THREE.Vector3(0.18, 0.87, 0.42).normalize()
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(planet.radius * 1.36, 0.65, 4, 96),
        new THREE.MeshBasicMaterial({ color: planet.color, transparent: true, opacity: 0.19 }),
      )
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis)
      group.add(ring)

      if (planet.nodes.length) {
        const latitude = 0.24
        const points = planet.nodes.map((_, index) => {
          const angle = (index / planet.nodes.length) * Math.PI * 2 + 0.4
          return new THREE.Vector3(
            Math.cos(angle) * Math.cos(latitude),
            Math.sin(latitude),
            Math.sin(angle) * Math.cos(latitude),
          ).multiplyScalar(planet.radius + 4)
        })
        points.forEach((point, index) => {
          const data = planet.nodes[index]
          planetForNode.set(data.id, planet)
          const color = new THREE.Color(data.color || `#${planet.color.getHexString()}`)
          const markerRadius = Math.max(4.5, Math.min(8.5, data.size * 0.15))
          const material = new THREE.MeshBasicMaterial({ color, toneMapped: false })
          const mesh = new THREE.Mesh(new THREE.SphereGeometry(markerRadius, 14, 10), material)
          const halo = new THREE.Mesh(
            new THREE.SphereGeometry(markerRadius * 2.1, 14, 10),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.14, depthWrite: false, toneMapped: false }),
          )
          mesh.add(halo)
          mesh.position.copy(point)
          mesh.userData.noteId = data.id
          group.add(mesh)

          const orbitingNode: OrbitingNode = {
            data,
            mesh,
            base: point,
            axis: new THREE.Vector3(0.25 + (index % 3) * 0.16, 0.75, 0.32).normalize(),
            phase: index * 1.7,
            speed: 0.018 + (hashValue(data.id) % 12) * 0.001,
            dragging: false,
          }
          mesh.userData.node = orbitingNode
          orbitingNodesRef.current.push(orbitingNode)
          nodeById.set(data.id, orbitingNode)
          pickablesRef.current.push(mesh)
        })

        const localOrbit = new THREE.Mesh(
          new THREE.TorusGeometry(planet.radius + 4, 0.25, 3, 96),
          new THREE.MeshBasicMaterial({ color: planet.color, transparent: true, opacity: 0.34 }),
        )
        localOrbit.rotation.x = 0.24
        group.add(localOrbit)
      }
    }

    for (const link of links) {
      const source = nodeById.get(link.source)
      const target = nodeById.get(link.target)
      if (!source || !target) continue
      const material = new THREE.LineBasicMaterial({ color: 0x9bc8d2, transparent: true, opacity: 0.13 + link.strength * 0.1 })
      const sourceWorld = source.mesh.getWorldPosition(new THREE.Vector3())
      const targetWorld = target.mesh.getWorldPosition(new THREE.Vector3())
      system.worldToLocal(sourceWorld)
      system.worldToLocal(targetWorld)
      const geometry = new THREE.BufferGeometry().setFromPoints([sourceWorld, targetWorld])
      const line = new THREE.Line(geometry, material)
      line.renderOrder = 1
      system.add(line)
      planetConnectionsRef.current.push(line)
      dynamicConnectionsRef.current.push({ source, target, line, sourceWorld, targetWorld })
    }

    const connected = new Set<string>()
    for (const link of links) {
      const sourcePlanet = planetForNode.get(link.source)
      const targetPlanet = planetForNode.get(link.target)
      if (!sourcePlanet || !targetPlanet || sourcePlanet.id === targetPlanet.id) continue
      const key = [sourcePlanet.id, targetPlanet.id].sort().join('|')
      if (connected.has(key)) continue
      connected.add(key)
      const source = planetGroupById.get(sourcePlanet.id)!
      const target = planetGroupById.get(targetPlanet.id)!
      const start = source.position.clone()
      const end = target.position.clone()
      const midpoint = start.clone().add(end).multiplyScalar(0.5)
      midpoint.y += 22 + (hashValue(key) % 24)
      const curve = new THREE.QuadraticBezierCurve3(start, midpoint, end)
      const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(40))
      const material = new THREE.LineBasicMaterial({ color: sourcePlanet.color, transparent: true, opacity: 0.32 })
      const connector = new THREE.Line(geometry, material)
      connector.computeLineDistances()
      system.add(connector)
      planetConnectionsRef.current.push(connector)
      planetBridgeDynamicsRef.current.push({
        source,
        target,
        line: connector,
        sourceWorld: start,
        targetWorld: end,
        controlOffset: midpoint.y - (start.y + end.y) / 2,
      })
    }

    const host = hostRef.current
    const camera = cameraRef.current
    if (host && camera) fitSystemToView(host, camera, system)
  }, [planets, nodes, links])

  useEffect(() => {
    const normalizedQuery = query.trim().toLowerCase()
    for (const node of orbitingNodesRef.current) {
      const matches = !normalizedQuery || node.data.title.toLowerCase().includes(normalizedQuery)
        || node.data.tags.some(tag => tag.toLowerCase().includes(normalizedQuery))
      const active = !selectedId || selectedId === node.data.id
      node.mesh.material.transparent = !matches || !active
      node.mesh.material.opacity = matches && active ? 1 : 0.2
    }
  }, [query, selectedId, nodes])

  return (
    <div ref={hostRef} className="absolute inset-0 overflow-hidden" aria-label="3D knowledge star system">
      <div className="pointer-events-none absolute left-4 top-4 z-[1] rounded-md border px-3 py-2"
        style={{ background: 'rgba(5, 10, 20, 0.72)', borderColor: 'rgba(139, 187, 199, 0.22)' }}>
        <div className="text-[12px] font-bold tracking-[0.08em]" style={{ color: 'rgb(var(--ds-text-1))' }}>
          {String(planets.length).padStart(2, '0')} PLANETS
        </div>
        <div className="mt-0.5 text-[10px]" style={{ color: 'rgb(var(--ds-text-4))' }}>
          {String(nodes.length).padStart(2, '0')} SAVED PAGES
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-5 left-1/2 z-[1] -translate-x-1/2 whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px]"
        style={{ color: 'rgb(var(--ds-text-3))', background: 'rgba(5, 10, 20, 0.68)', borderColor: 'rgba(139, 187, 199, 0.2)' }}>
        Drag planets or nodes to move them <span aria-hidden="true">·</span> Drag open space to rotate <span aria-hidden="true">·</span> Scroll to zoom <span aria-hidden="true">·</span> Click a node to inspect
      </div>
      <div className="pointer-events-none absolute inset-0 hidden items-center justify-center text-xs text-red-300 [div[data-webgl-unavailable=true]_&]:flex">
        3D rendering is unavailable on this device.
      </div>
    </div>
  )
}