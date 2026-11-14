import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'

import type { DeviceMode, Highlight, LabelId } from './deviceFacts'
import { drawLeaves } from './leafPattern'

/** The Smart Agro probe built from code (approved spike: design-previews/device-3d-spike-2026-11-13). This is the only
 * module that imports three statically, so it lands in its own chunk loaded by deviceStage. */
export interface DeviceScene {
  setMode(mode: DeviceMode): void
  setHighlight(part: Highlight | null): void
  /** 0 = held above the soil, 1 = pushed in (soil modes only). */
  setSoilProgress(p: number): void
  /** `backdrop` is the section colour behind the canvas: it tints the haze and the ground bounce light. */
  setTheme(tokens: { accent: string; backdrop: string }): void
  /** Leaf-patterned key light on the device (the hero). The canvas never paints a backdrop; the page behind shows. */
  setStudio(on: boolean): void
  /** Skip the easing on the next frame: the canvas just moved to another section, which should open on its own shot. */
  snap(): void
  /** Label anchor points in CSS pixels of the canvas; `hidden` when the device body is in front of them. */
  anchors(): Record<LabelId, { x: number; y: number; hidden: boolean }>
  resize(width: number, height: number): void
  render(time: number): void
  dispose(): void
}

const AGRO_MARK = 'M18 19V9M18 12C10 13 7 9 8 5c7 0 10 3 10 7ZM18 9C18 3 23 2 28 3c0 6-4 8-10 6ZM8 18h20l-3 12H11L8 18ZM18 19v7m0-4-4 3m4-2 4 3'
const W = 0.5, H = 0.72, D = 0.4, TILT = 0.1, SEAM = -0.38
const SOIL_TOP = -0.71, SOIL_H = 1.1, SOIL_R = 1, FLOOR = -1.81
const plateau = (z: number) => 0.645 - TILT * z
const shape = (c: number, e: number) => Math.sign(c) * Math.abs(c) ** e
const smin = (a: number, b: number, k: number) => -k * Math.log(Math.exp(-a / k) + Math.exp(-b / k))
const approach = (from: number, to: number, rate: number) => from + (to - from) * rate
/** Critically damped spring (Unity's SmoothDamp) on value i of `state`: it leaves at rest and settles without
 * overshoot, so a camera move eases in and out instead of starting at full speed like `approach`. */
function damp(state: number[], vel: number[], i: number, to: number, smooth: number, dt: number) {
  const omega = 2 / smooth, x = omega * dt, decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
  const change = state[i] - to, temp = (vel[i] + omega * change) * dt
  vel[i] = (vel[i] - omega * temp) * decay
  state[i] = to + (change + temp) * decay
}
// Product finish: warm porcelain shell over a graphite skirt, black-glass solar cells, brushed steel probes.
const FINISH = { shell: '#dcdad1', skirt: '#2d3330', trim: '#1f2422', mark: '#2f5a3c', bezel: '#1a1e1d', steel: '#d4d8d5' }

/** `context` comes from the caller (created with alpha, antialias and preserveDrawingBuffer), so a missing WebGL is
 * detected before three is involved. preserveDrawingBuffer: the hero trail and the browser tests read pixels back. */
export function createDeviceScene(canvas: HTMLCanvasElement, context: WebGL2RenderingContext): DeviceScene {
  const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 768 ? 1.5 : 2))
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.VSMShadowMap
  renderer.localClippingEnabled = true
  const maxAniso = renderer.capabilities.getMaxAnisotropy()

  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.28
  // The canvas is transparent (the page is the backdrop), so the camera may move. It holds still in the hero and the
  // product scenes, rides down with the device in 'tanah', and moves in on one part per figure in 'angka'.
  const camera = new THREE.PerspectiveCamera(28, 4 / 3, 0.1, 60)
  const target = new THREE.Vector3(0, -0.6, 0), viewDir = new THREE.Vector3(1.2, 2.3, 6.6).normalize()
  const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
  const HIGH = { aim: v3(0, -0.2, 0), dir: v3(1, 5.5, 3.6).normalize(), distance: 7.6 } // above the soil, looking down
  const LOW = { aim: v3(0.1, -0.95, 0.1), dir: v3(1.7, 1.1, 6.4).normalize(), distance: 7.4 } // level with the cut-away
  const CLOSE: Record<Highlight, { dir: THREE.Vector3; distance: number }> = {
    led: { dir: v3(0.5, 0.55, 3).normalize(), distance: 3.6 },
    probe: { dir: v3(1, 0.35, 1).normalize(), distance: 3.4 }, // into the corner of the cut-away
    moisture: { dir: v3(0.35, 0.3, 1).normalize(), distance: 4.4 }, // square on the face the rings spread over
    solar: { dir: v3(0.8, 4.4, 2.6).normalize(), distance: 3.6 },
  }
  // The turn that faces each part to its close-up: a part at local angle φ (atan2(x, z)) sits at φ + turn. For the
  // probes, −π/4 swings the front probe into the cut-away quarter (x > 0, z > 0), where the soil does not hide it.
  const PRESENT: Record<Highlight, number> = { led: 0.57, probe: -Math.PI / 4, moisture: -Math.PI / 4, solar: 0.3 }
  const TAU = Math.PI * 2
  const aim = target.clone(), look = viewDir.clone(), shot = { aim: v3(0, 0, 0), dir: v3(0, 0, 1), distance: 7 }

  let seed = 11 // seeded, so posters render the same textures every time
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const canvasTex = (w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) => {
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h })
    draw(c.getContext('2d')!, w, h)
    const texture = new THREE.CanvasTexture(c)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = maxAniso
    return texture
  }

  // ---------- Body: superellipsoid with a soft top cut leaning to the front, two-tone below the parting line ----------
  let bodyGeo: THREE.BufferGeometry = new THREE.SphereGeometry(1, 192, 144)
  bodyGeo.deleteAttribute('uv'); bodyGeo.deleteAttribute('normal')
  const pos = bodyGeo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const z = shape(pos.getZ(i), 0.6) * D
    pos.setXYZ(i, shape(pos.getX(i), 0.55) * W, smin(shape(pos.getY(i), 0.62) * H, plateau(z), 0.025), z)
  }
  bodyGeo = mergeVertices(bodyGeo, 1e-5)
  bodyGeo.computeVertexNormals()
  const upperTone = new THREE.Color(FINISH.shell), lowerTone = new THREE.Color(FINISH.skirt)
  const tones = new Float32Array(bodyGeo.attributes.position.count * 3)
  for (let i = 0; i < bodyGeo.attributes.position.count; i++) (bodyGeo.attributes.position.getY(i) < SEAM ? lowerTone : upperTone).toArray(tones, i * 3)
  bodyGeo.setAttribute('color', new THREE.BufferAttribute(tones, 3))
  // One shell material that eases between satin porcelain and frosted glass ('tembus').
  const shell = new THREE.MeshPhysicalMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.62, sheen: 0.3, sheenRoughness: 0.8, thickness: 0.35, ior: 1.35 })
  const body = new THREE.Mesh(bodyGeo, shell)
  body.castShadow = true

  const rubber = new THREE.MeshStandardMaterial({ color: FINISH.trim, roughness: 0.9 })
  // The parting line: the body again, clipped to a thin band. Clipping planes live in world space, so render() moves
  // them with the device as it sinks; left still, the band would sweep up the body as a dark stripe.
  const seamPlanes = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)]
  const seam = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ color: FINISH.trim, roughness: 0.9, clippingPlanes: seamPlanes }))
  seam.scale.setScalar(1.003)
  const ray = (origin: THREE.Vector3, dir: THREE.Vector3) => new THREE.Raycaster(origin, dir).intersectObject(body)[0]
  const frontHit = ray(new THREE.Vector3(0, -0.12, 2), new THREE.Vector3(0, 0, -1))
  const mark = new THREE.Mesh(new DecalGeometry(body, frontHit.point, new THREE.Euler(), new THREE.Vector3(0.22, 0.22, 0.3)),
    new THREE.MeshStandardMaterial({
      color: FINISH.mark, transparent: true, roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -4, depthWrite: false,
      map: canvasTex(256, 256, (g, w) => { g.scale(w / 36, w / 36); g.strokeStyle = '#fff'; g.lineWidth = 1.7; g.lineCap = g.lineJoin = 'round'; g.stroke(new Path2D(AGRO_MARK)) }),
    }))

  // ---------- Top: solar panel in a dark bezel ----------
  const bezel = new THREE.Mesh(new RoundedBoxGeometry(0.57, 0.024, 0.45, 4, 0.012), new THREE.MeshStandardMaterial({ color: FINISH.bezel, roughness: 0.45, metalness: 0.3 }))
  bezel.position.y = plateau(0) - 0.01
  bezel.rotation.x = Math.atan(TILT)
  // Monocrystalline cells under glass: near-black blue, hairline busbars, a clear coat that picks up the room light.
  const panelMat = new THREE.MeshPhysicalMaterial({
    color: '#ffffff', roughness: 0.4, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 2.4, emissive: '#9fb7ff', emissiveIntensity: 0,
    map: canvasTex(520, 400, (g, w, h) => {
      g.fillStyle = '#0d121b'; g.fillRect(0, 0, w, h)
      for (let i = 0; i < 8; i++) for (let j = 0; j < 6; j++) { g.fillStyle = (i + j) % 2 ? '#111826' : '#0f1521'; g.fillRect(i * w / 8 + 2, j * h / 6 + 2, w / 8 - 4, h / 6 - 4) }
      g.strokeStyle = 'rgba(176, 186, 200, .28)'; g.lineWidth = 1
      for (let i = 0; i < 8; i++) for (const f of [0.33, 0.66]) { g.beginPath(); g.moveTo((i + f) * w / 8, 0); g.lineTo((i + f) * w / 8, h); g.stroke() }
      g.strokeStyle = 'rgba(200, 206, 214, .5)'; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8)
    }),
  })
  const panel = new THREE.Mesh(new RoundedBoxGeometry(0.52, 0.03, 0.4, 4, 0.012), panelMat)
  panel.position.y = plateau(0) - 0.006
  panel.rotation.x = Math.atan(TILT)

  // ---------- Front LED with its light ring, rubber collars, back port ----------
  const ledHit = ray(new THREE.Vector3(-0.17, 0.3, 2), new THREE.Vector3(0, 0, -1))
  const ledMat = new THREE.MeshStandardMaterial({ color: '#1d3a24', emissive: '#6fe39a', emissiveIntensity: 1.4, toneMapped: false })
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.016, 24, 16), ledMat)
  // Just proud of the shell: sunk behind it, the frosted glass would refract the LED away from its ring.
  led.position.copy(ledHit.point).addScaledVector(ledHit.face!.normal, 0.002)
  const ledRing = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.004, 12, 40), new THREE.MeshStandardMaterial({ color: '#b9bdb9', metalness: 0.8, roughness: 0.32, envMapIntensity: 2 }))
  ledRing.position.copy(ledHit.point)
  ledRing.lookAt(ledHit.point.clone().add(ledHit.face!.normal))
  const collars = [-0.12, 0.12].map(x => {
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.056, 0.05, 32), rubber)
    collar.position.set(x, ray(new THREE.Vector3(x, -3, 0), new THREE.Vector3(0, 1, 0)).point.y, 0)
    return collar
  })
  const port = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.05, 0.03, 3, 0.012), rubber)
  port.position.copy(ray(new THREE.Vector3(0, -0.2, -2), new THREE.Vector3(0, 0, 1)).point)

  // ---------- Probes with depth marks ----------
  // Brushed stainless: metallic enough to catch the room light along the shaft, rough enough to stay satin.
  const steel = new THREE.MeshPhysicalMaterial({ color: FINISH.steel, metalness: 0.85, roughness: 0.34, envMapIntensity: 2.2, emissive: '#000000' })
  const etched = new THREE.MeshStandardMaterial({ color: '#5d625f', metalness: 0.8, roughness: 0.5, envMapIntensity: 1.5 })
  const probes = [-0.12, 0.12].map(x => {
    const rod = new THREE.Group()
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 1.15, 32), steel)
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.06, 32), steel)
    shaft.position.y = -1.175; tip.position.y = -1.78; tip.rotation.x = Math.PI
    shaft.castShadow = tip.castShadow = true
    rod.add(shaft, tip)
    for (const y of [-1.0, -1.25, -1.5]) {
      const tick = new THREE.Mesh(new THREE.CylinderGeometry(0.0287, 0.0287, 0.008, 32), etched)
      tick.position.y = y
      rod.add(tick)
    }
    rod.position.x = x
    return rod
  })

  // ---------- Inside, seen through the frosted shell: ESP32 board, battery, probe leads ----------
  const internals = new THREE.Group()
  const board = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.86, 0.035, 2, 0.01), new THREE.MeshStandardMaterial({
    roughness: 0.5,
    map: canvasTex(310, 430, (g, w, h) => {
      g.fillStyle = '#1f4a33'; g.fillRect(0, 0, w, h)
      g.strokeStyle = '#c8a24a'; g.lineWidth = 2
      for (let i = 0; i < 26; i++) {
        let x = rnd() * w, y = rnd() * h
        g.beginPath(); g.moveTo(x, y)
        for (let s = 0; s < 3; s++) { if (rnd() < 0.5) x += (rnd() - 0.5) * 120; else y += (rnd() - 0.5) * 120; g.lineTo(x, y) }
        g.stroke(); g.fillStyle = '#d9b45c'; g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill()
      }
    }),
  }))
  board.position.set(0, 0.12, -0.08)
  const chip = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.34, 0.04, 2, 0.006), new THREE.MeshStandardMaterial({
    metalness: 0.7, roughness: 0.35,
    map: canvasTex(300, 340, (g, w, h) => { g.fillStyle = '#c9ccd1'; g.fillRect(0, 0, w, h); g.fillStyle = '#3b4148'; g.font = '600 46px system-ui'; g.textAlign = 'center'; g.fillText('ESP32', w / 2, h / 2 + 16) }),
  }))
  chip.position.set(0, 0.26, -0.04)
  const battery = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.36, 8, 24), new THREE.MeshStandardMaterial({ color: '#2a3036', roughness: 0.45, metalness: 0.2 }))
  battery.rotation.z = Math.PI / 2
  battery.position.set(0, -0.32, 0.12)
  const copper = new THREE.MeshStandardMaterial({ color: '#c8874a', metalness: 0.8, roughness: 0.35 })
  internals.add(board, chip, battery, ...[-0.12, 0.12].map(x => {
    const lead = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.34, 12), copper)
    lead.position.set(x, -0.45, -0.06)
    return lead
  }))

  const device = new THREE.Group()
  device.add(body, seam, mark, bezel, panel, led, ledRing, port, ...collars, internals, ...probes)
  scene.add(device)

  // ---------- Soil cutaway with moisture pulses ----------
  const soil = new THREE.Group()
  const soilMap = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#4a3a2c'; g.fillRect(0, 0, w, h)
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = rnd() < 0.5 ? `rgba(28, 20, 14, ${rnd() * 0.5})` : `rgba(130, 106, 82, ${rnd() * 0.45})`
      g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 3, 2 + rnd() * 3)
    }
  })
  const tub = new THREE.Mesh(new THREE.CylinderGeometry(SOIL_R, SOIL_R, SOIL_H, 96, 1, false, Math.PI / 2, Math.PI * 1.5), new THREE.MeshStandardMaterial({ map: soilMap, roughness: 1 }))
  tub.position.y = SOIL_TOP - SOIL_H / 2
  tub.receiveShadow = true
  const faceMat = new THREE.MeshStandardMaterial({
    roughness: 1,
    map: canvasTex(512, 560, (g, w, h) => {
      const grad = g.createLinearGradient(0, 0, 0, h)
      grad.addColorStop(0, '#3a2c21'); grad.addColorStop(1, '#6a5442')
      g.fillStyle = grad; g.fillRect(0, 0, w, h)
      for (let i = 0; i < 2200; i++) { g.fillStyle = `rgba(20, 14, 10, ${rnd() * 0.45})`; g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 3, 2 + rnd() * 2) }
    }),
  })
  const faceA = new THREE.Mesh(new THREE.PlaneGeometry(SOIL_R, SOIL_H), faceMat)
  faceA.position.set(SOIL_R / 2, tub.position.y, 0)
  const faceB = new THREE.Mesh(new THREE.PlaneGeometry(SOIL_R, SOIL_H), faceMat)
  faceB.rotation.y = Math.PI / 2
  faceB.position.set(0, tub.position.y, SOIL_R / 2)
  // The surface ripples skip the cut-away quarter (x > 0 and z > 0).
  const pulseMat = (clip: boolean) => new THREE.MeshBasicMaterial({
    color: '#c3df95', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    ...(clip && { clippingPlanes: [new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0), new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)], clipIntersection: true }),
  })
  const faceRings = [0, 1, 2].map(() => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 64), pulseMat(false))
    ring.position.set(0.12, tub.position.y, 0.004)
    return ring
  })
  const topRings = [0, 1, 2].map(() => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.95, 1, 64), pulseMat(true))
    ring.rotation.x = -Math.PI / 2
    ring.position.set(0, SOIL_TOP + 0.003, 0)
    return ring
  })
  // Roots on the two cut faces, drawn in from the top as the probe goes down ('tanah'); they glow when it reads.
  const rootMat = new THREE.MeshStandardMaterial({ color: '#e4d3b2', roughness: 0.85, emissive: '#c3df95', emissiveIntensity: 0 })
  const roots = Array.from({ length: 14 }, (_, i) => {
    const onA = i < 8, points: THREE.Vector3[] = []
    let u = 0.12 + rnd() * 0.8, y = SOIL_TOP - 0.01 // u runs along the face: x on face A (z = 0), z on face B (x = 0)
    while (y > SOIL_TOP - SOIL_H + 0.08) {
      points.push(onA ? new THREE.Vector3(u, y, 0.004) : new THREE.Vector3(0.004, y, u))
      y -= 0.09 + rnd() * 0.09
      u = Math.min(0.96, Math.max(0.04, u + (rnd() - 0.5) * 0.16))
    }
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), points.length * 8, 0.004 + rnd() * 0.006, 5), rootMat)
    tube.geometry.setDrawRange(0, 0)
    return tube
  })
  soil.add(tub, faceA, faceB, ...roots, ...faceRings, ...topRings)
  soil.visible = false
  scene.add(soil)

  // ---------- Numbers: each figure animates what its part does (no labels there) ----------
  const glow = (color: string) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: THREE.DoubleSide })
  // 30 minutes: the LED sends out rings, a reading going out.
  const ledWaves = [0, 1, 2].map(() => {
    const wave = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.037, 48), glow('#6fe39a'))
    wave.position.copy(ledHit.point).addScaledVector(ledHit.face!.normal, 0.004)
    wave.lookAt(ledHit.point.clone().add(ledHit.face!.normal))
    return wave
  })
  // 3 sensors: moisture, temperature and pH as three coloured rings riding up each probe into the body.
  const probeData = [-0.12, 0.12].flatMap(x => ['#7cc6e8', '#f2a65a', '#b5d688'].map(color => {
    const bead = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.008, 10, 32), glow(color))
    bead.rotation.x = Math.PI / 2
    bead.position.x = x
    return bead
  }))
  // Wh: motes of sunlight falling onto the panel.
  const motes = Array.from({ length: 12 }, () => {
    const mote = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), glow('#fff1c4'))
    mote.userData = { x: (rnd() - 0.5) * 0.44, z: (rnd() - 0.5) * 0.34, offset: rnd() * 1600 }
    return mote
  })
  device.add(...ledWaves, ...probeData, ...motes)

  // ---------- Light: a soft contact shadow under the probes; in the hero, a leaf-patterned key light ----------
  // A painted gradient, not a shadow map: thin probes give jagged shadow-map stripes, a gradient stays smooth.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.1), new THREE.MeshBasicMaterial({
    transparent: true, depthWrite: false, toneMapped: false,
    map: canvasTex(256, 256, (g, w) => {
      const grad = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2)
      grad.addColorStop(0, 'rgba(24, 33, 27, .5)'); grad.addColorStop(0.35, 'rgba(24, 33, 27, .2)'); grad.addColorStop(1, 'rgba(24, 33, 27, 0)')
      g.fillStyle = grad; g.fillRect(0, 0, w, w)
    }),
  }))
  ground.rotation.x = -Math.PI / 2; ground.position.y = FLOOR + 0.002
  const sun = new THREE.SpotLight('#f7f9f1', 3.4, 0, 0.62, 0.65, 0)
  sun.position.set(-3, 5, 4)
  sun.target.position.set(0.4, -0.8, -1.5)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024); sun.shadow.radius = 6; sun.shadow.blurSamples = 16; sun.shadow.bias = -0.0005
  sun.map = canvasTex(512, 512, (g, w) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, w); drawLeaves(g, w) })
  const fill = new THREE.HemisphereLight('#f4f7ef', '#8a9a80', 1.1)
  const key = new THREE.DirectionalLight('#fffaf0', 1.9)
  key.position.set(-2.5, 5, 3); key.castShadow = true
  key.shadow.mapSize.set(1024, 1024); key.shadow.radius = 10; key.shadow.blurSamples = 20; key.shadow.bias = -0.0005
  Object.assign(key.shadow.camera, { left: -2.5, right: 2.5, top: 2.5, bottom: -2.5 })
  const rim = new THREE.DirectionalLight('#eef6ea', 0.45)
  rim.position.set(2, 2, -3)
  scene.add(ground, sun, sun.target, fill, key, rim)
  // A light haze in the section colour pulls the device into its backdrop instead of floating on it.
  scene.fog = new THREE.Fog('#a7b29c', 6, 22)

  // ---------- Interaction: drag sideways to turn the device; it turns slowly on its own when left alone ----------
  const reduced = !matchMedia('(prefers-reduced-motion: no-preference)').matches
  const REST = -0.35 // the pose the posters are rendered in; each section opens on it
  let spin = REST, velocity = 0, dragging = false, lastX = 0, idleSince = 0, lastTime = 0
  const down = (e: PointerEvent) => { dragging = true; lastX = e.clientX; velocity = 0; canvas.setPointerCapture(e.pointerId) }
  const move = (e: PointerEvent) => { if (!dragging) return; velocity = (e.clientX - lastX) * 0.01; spin += velocity; lastX = e.clientX }
  const up = () => { dragging = false; idleSince = performance.now() }
  canvas.addEventListener('pointerdown', down)
  canvas.addEventListener('pointermove', move)
  canvas.addEventListener('pointerup', up)
  canvas.addEventListener('pointercancel', up) // a vertical swipe hands the gesture back to the page scroll

  // ---------- State, eased every frame ----------
  let mode: DeviceMode = 'studio', highlight: Highlight | null = null, soilProgress = 0
  let glass = 0, lift = 0, rootGrow = 0, frame = 0, snapNext = true
  // Camera springs: aim xyz, look direction xyz, distance, and the turn that presents a part (see damp()).
  const cam = [...target.toArray(), ...viewDir.toArray(), 7], camVel = cam.map(() => 0), turn = [0], turnVel = [0]
  const setStudio = (on: boolean) => {
    sun.visible = on
    key.castShadow = !on
    key.intensity = on ? 0.7 : 1.9
  }
  setStudio(false)

  const anchorPoints: Record<LabelId, THREE.Vector3> = {
    panel: new THREE.Vector3(0.16, plateau(0.08) + 0.02, 0.08),
    led: led.position.clone(),
    probe: new THREE.Vector3(0.12, -1.1, 0.03),
    esp32: new THREE.Vector3(-0.08, 0.3, -0.02),
    baterai: new THREE.Vector3(-0.2, -0.32, 0.2),
  }
  const hiddenNow: Record<LabelId, boolean> = { panel: false, led: false, probe: false, esp32: false, baterai: false }
  const probeRay = new THREE.Raycaster(), point = new THREE.Vector3(), toPoint = new THREE.Vector3()

  /** Where the camera wants to be: 'tanah' (and 'angka' before a figure is lit) rides from HIGH to LOW as the device
   * goes in; a lit figure moves in on its part; every other state keeps the product framing. */
  function aimShot(inSoil: boolean) {
    if (inSoil && !(mode === 'angka' && highlight)) {
      const t = Math.min(1, Math.max(0, 1 - lift / 0.9)), p = t * t * (3 - 2 * t)
      shot.aim.lerpVectors(HIGH.aim, LOW.aim, p)
      shot.dir.lerpVectors(HIGH.dir, LOW.dir, p)
      shot.distance = approach(HIGH.distance, LOW.distance, p)
      shot.aim.y += lift * p // mid-descent the camera is already low while the device is still up: keep its top in frame
    } else if (mode === 'angka' && highlight) {
      if (highlight === 'led') led.getWorldPosition(shot.aim)
      else if (highlight === 'probe') device.localToWorld(shot.aim.set(0.12, -1.2, 0))
      else if (highlight === 'solar') device.localToWorld(shot.aim.set(0, plateau(0), 0))
      else shot.aim.set(0.2, -1.2, 0) // the moisture rings on the cut face, around the probe
      shot.dir.copy(CLOSE[highlight].dir)
      shot.distance = CLOSE[highlight].distance
    } else {
      shot.aim.copy(target)
      shot.dir.copy(viewDir)
      shot.distance = mode === 'studio' ? 7 : 6.6
    }
  }

  return {
    setMode(next) { mode = next },
    setHighlight(part) { if (part !== highlight) idleSince = 0; highlight = part },
    setSoilProgress(p) { soilProgress = Math.min(1, Math.max(0, p)) },
    setTheme({ accent, backdrop }) {
      for (const ring of [...faceRings, ...topRings]) ring.material.color.set(accent)
      ;(scene.fog as THREE.Fog).color.set(backdrop)
      fill.groundColor.set(backdrop).multiplyScalar(0.8)
    },
    setStudio,
    snap() { snapNext = true },
    anchors() {
      const width = canvas.clientWidth, height = canvas.clientHeight
      const checkOcclusion = frame % 4 === 0
      const out = {} as Record<LabelId, { x: number; y: number; hidden: boolean }>
      for (const id of Object.keys(anchorPoints) as LabelId[]) {
        point.copy(anchorPoints[id]).applyMatrix4(device.matrixWorld)
        if (checkOcclusion) {
          const far = camera.position.distanceTo(point)
          probeRay.set(camera.position, toPoint.copy(point).sub(camera.position).normalize())
          // Only the body hides a point: a probe inside the soil is still where the label says it is.
          const blocker = probeRay.intersectObjects([body])[0]
          hiddenNow[id] = !!blocker && blocker.distance < far - 0.03
        }
        point.project(camera)
        // Through the glass nothing is hidden, from the first frame it turns clear.
        out[id] = { x: (point.x + 1) / 2 * width, y: (1 - point.y) / 2 * height, hidden: glass < 0.5 && hiddenNow[id] }
      }
      return out
    },
    resize(width, height) {
      // At most ~4 megapixels: a full-screen hero at DPR 2 would otherwise ask the GPU for over 5.
      const ratio = Math.min(devicePixelRatio, innerWidth < 768 ? 1.5 : 2, Math.sqrt(4e6 / Math.max(1, width * height)))
      if (ratio !== renderer.getPixelRatio()) renderer.setPixelRatio(ratio)
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    },
    render(time) {
      frame++
      const elapsed = (time - lastTime) / 1000 || 0, dt = Math.min(0.05, elapsed)
      lastTime = time
      // Eased by time, not by frame, so a slow GPU or a 144 Hz screen reaches each state in the same ~0.6 s. A snap (the
      // canvas just changed sections) lands every state at once: a new section opens on its own shot, not a fly-in.
      const instant = reduced || snapNext
      const k = instant ? 1 : 1 - Math.exp(-Math.min(0.25, elapsed) * 5)
      const inSoil = mode === 'tanah' || mode === 'angka'
      glass = approach(glass, mode === 'tembus' ? 1 : 0, k)
      if (Math.abs(glass - Math.round(glass)) < 0.002) glass = Math.round(glass)
      // Matte sage when closed; the glass is smooth enough to read the board through it.
      shell.transmission = glass
      shell.roughness = 0.86 - 0.76 * glass
      shell.clearcoat = 0.5 * glass
      // Past halfway the glass drops the two sage tones for the light frosted look of the approved spike.
      const frosted = glass > 0.5
      if (frosted === shell.vertexColors) {
        shell.vertexColors = !frosted
        shell.color.set(frosted ? '#f1f6ee' : '#ffffff')
        shell.needsUpdate = true
      }
      internals.visible = glass > 0.01
      seam.visible = mark.visible = port.visible = glass < 0.5
      soil.visible = inSoil
      ground.visible = !inSoil
      // 'tanah' sinks in with the scroll; 'angka' carries on from there, already in.
      lift = approach(lift, mode === 'tanah' ? (1 - soilProgress) * 0.9 : 0, k)
      device.position.y = lift
      seamPlanes[0].constant = -(SEAM - 0.006 + lift)
      seamPlanes[1].constant = SEAM + 0.006 + lift
      // Roots draw in with the descent: none while the device is above the soil, all of them once it is in.
      rootGrow = approach(rootGrow, mode === 'tanah' ? Math.min(1, soilProgress / 0.85) : mode === 'angka' ? 1 : 0, k)
      for (const root of roots) root.geometry.setDrawRange(0, Math.floor(root.geometry.index!.count * rootGrow / 30) * 30)

      // A lit figure stops the slow turn and faces its part to the camera; a drag wins until the visitor lets go.
      const present = mode === 'angka' && highlight ? PRESENT[highlight] : null
      // Close-ups glide (about 1.5 s to settle); the soil descent follows the scroll more tightly.
      const smooth = mode === 'angka' ? 0.6 : inSoil ? 0.22 : 0.35, step = Math.min(0.1, elapsed)
      if (snapNext && !dragging && present === null) { spin = REST; velocity = 0 } // same pose as this section's poster
      if (!dragging) {
        velocity *= 0.92
        spin += velocity
        const idle = performance.now() - idleSince
        if (present !== null && idle > 1200) {
          turn[0] = spin
          const to = present + TAU * Math.round((spin - present) / TAU)
          if (instant) { turn[0] = to; turnVel[0] = 0 } else damp(turn, turnVel, 0, to, smooth, step)
          spin = turn[0]
        } else if (present === null && !reduced && idle > 2500) spin += 0.3 * dt
      } else turnVel[0] = 0
      device.rotation.y = spin
      device.updateMatrixWorld()

      aimShot(inSoil)
      const goal = [...shot.aim.toArray(), ...shot.dir.toArray(), shot.distance]
      goal.forEach((to, i) => { if (instant) { cam[i] = to; camVel[i] = 0 } else damp(cam, camVel, i, to, smooth, step) })
      snapNext = false
      aim.fromArray(cam)
      look.fromArray(cam, 3).normalize()
      camera.position.copy(aim).addScaledVector(look, cam[6])
      camera.lookAt(aim)

      // Every 3 s the probe reads: the LED pulses, then moisture rings spread through the soil.
      const cycle = reduced ? 600 : time % 3000
      const ledBoost = highlight === 'led' ? 1.8 : 1
      ledMat.emissiveIntensity = reduced ? 1.4 : (0.5 + 1.6 * Math.max(0, Math.sin(Math.min(cycle / 600, 1) * Math.PI))) * ledBoost
      const probeGlow = highlight === 'probe' ? 0.25 + 0.15 * Math.sin(time / 300) : 0
      steel.emissive.set(probeGlow ? '#c3df95' : '#000000'); steel.emissiveIntensity = probeGlow
      panelMat.emissiveIntensity = highlight === 'solar' ? 0.12 + 0.1 * Math.sin(time / 400) : 0
      // Highlighting moisture keeps the rings flowing instead of once per reading.
      ;[faceRings, topRings].forEach(rings => rings.forEach((ring, i) => {
        const p = reduced ? 0.5
          : highlight === 'moisture' ? ((time - i * 330) % 1000) / 1000
            : (cycle - 300 - i * 260) / 1500
        const s = 0.08 + Math.min(Math.max(p, 0), 1) * 0.5
        ring.scale.set(s, rings === faceRings ? s * 1.7 : s, 1)
        ring.material.opacity = p >= 0 && p <= 1 ? (1 - p) * 0.7 : 0
      }))
      // The roots take the reading in: a soft glow as each reading's rings pass.
      rootMat.emissiveIntensity = rootGrow > 0.95 && !reduced ? Math.sin(Math.min(Math.max((cycle - 300) / 1500, 0), 1) * Math.PI) * 0.45 : 0
      // The numbers' own motion, one per lit figure.
      ledWaves.forEach((wave, i) => {
        wave.visible = highlight === 'led' && !reduced
        const p = ((time + i * 500) % 1500) / 1500
        wave.scale.setScalar(1 + p * 5); wave.material.opacity = (1 - p) * 0.85
      })
      probeData.forEach((bead, i) => {
        bead.visible = highlight === 'probe' && !reduced
        const p = ((time + (i % 3) * 450 + (i < 3 ? 0 : 220)) % 1350) / 1350
        bead.position.y = approach(-1.74, -0.66, p * p * (3 - 2 * p)); bead.material.opacity = Math.sin(p * Math.PI) * 0.95
      })
      motes.forEach(mote => {
        mote.visible = highlight === 'solar' && !reduced
        const { x, z, offset } = mote.userData as { x: number; z: number; offset: number }, p = ((time + offset) % 1600) / 1600
        mote.position.set(x, approach(plateau(z) + 0.9, plateau(z) + 0.03, p * p), z)
        mote.material.opacity = Math.min(1, p * 5, (1 - p) * 8) * 0.9
      })
      renderer.render(scene, camera)
    },
    dispose() {
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
      scene.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose()
          for (const material of [object.material].flat()) { (material as THREE.MeshStandardMaterial).map?.dispose(); material.dispose() }
        }
      })
      sun.map?.dispose()
      pmrem.dispose()
      renderer.dispose()
    },
  }
}
