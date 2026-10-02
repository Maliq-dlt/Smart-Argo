import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

export type FlowerScene = { select: (asset: string) => void; point: (x: number, y: number) => void; dispose: () => void }
export type SceneState = 'loading' | 'ready' | 'fallback'

// ponytail: one pot and five static specimens; add a scene framework only for multiple cameras or editable scenes.
export function createFlowerScene(host: HTMLElement, onState: (state: SceneState) => void): FlowerScene {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('webgl2', { alpha: true, antialias: true, preserveDrawingBuffer: true })
  if (!context) throw new Error('WebGL2 unavailable')
  const renderer = new THREE.WebGLRenderer({ canvas, context, alpha: true, antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  host.append(renderer.domElement)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(32, 1, .1, 20)
  camera.position.set(0, 2.2, 3.8)
  camera.lookAt(0, .9, 0)
  scene.add(new THREE.HemisphereLight(0xf0eddb, 0x28301d, 2.5))
  const sun = new THREE.DirectionalLight(0xffead0, 3.2)
  sun.position.set(-2.5, 4, 3)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  sun.shadow.camera.left = sun.shadow.camera.bottom = -2
  sun.shadow.camera.right = sun.shadow.camera.top = 2
  sun.shadow.bias = -.0003
  scene.add(sun)
  const fill = new THREE.DirectionalLight(0xdce7d9, 1.3)
  fill.position.set(3, 2, -2)
  scene.add(fill)
  const pivot = new THREE.Group()
  scene.add(pivot)
  const soil = new THREE.Mesh(new THREE.CylinderGeometry(.39, .39, .025, 48), new THREE.MeshStandardMaterial({ color: 0x302619, roughness: 1 }))
  soil.position.y = .745
  soil.receiveShadow = true
  pivot.add(soil)
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1.3, 64), new THREE.ShadowMaterial({ opacity: .24 }))
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = -.012
  shadow.receiveShadow = true
  scene.add(shadow)
  const loader = new GLTFLoader()
  const cache = new Map<string, Promise<THREE.Group>>()
  const sources: THREE.Object3D[] = []
  let disposed = false, lost = false, visible = true, frame = 0, request = 0
  const angle = -.16
  let specimen: THREE.Group | undefined, entrance = 1, pointX = 0, pointY = 0

  const release = (root: THREE.Object3D) => root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    object.geometry.dispose()
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose()
      material.dispose()
    }
  })
  const load = (asset: string) => {
    if (!cache.has(asset)) cache.set(asset, loader.loadAsync(`./flowers/${asset}.glb`).then(gltf => {
      if (disposed) { release(gltf.scene); throw new Error('Scene disposed') }
      sources.push(gltf.scene)
      gltf.scene.traverse(object => {
        if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true }
      })
      return gltf.scene
    }).catch(error => { cache.delete(asset); throw error }))
    return cache.get(asset)!
  }
  const fit = (object: THREE.Group, height: number, width: number) => {
    const bounds = new THREE.Box3().setFromObject(object)
    const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3())
    const scale = Math.min(height / size.y, width / Math.max(size.x, size.z))
    object.scale.multiplyScalar(scale)
    object.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale)
    return object
  }
  const pot = Promise.all([load('planter_pot_clay'), load('rock_moss_set_01')]).then(([source, rock]) => {
    const ground = new THREE.Group()
    ground.add(fit(rock.clone(), .5, 3.6))
    ground.position.y = -.46
    ground.rotation.y = .3
    scene.add(ground)
    const object = fit(source.clone(), .8, 1)
    pivot.add(object)
  })
  // Loading errors are handled by each selection, including the shared pot request.
  void pot.catch(() => undefined)
  const render = () => {
    frame = 0
    if (disposed || lost || !visible || document.hidden) return
    pivot.rotation.y = THREE.MathUtils.lerp(pivot.rotation.y, angle + pointX * .12, .14)
    pivot.rotation.x = THREE.MathUtils.lerp(pivot.rotation.x, pointY * .045, .14)
    entrance = Math.min(1, entrance + .055)
    if (specimen) {
      const eased = 1 - Math.pow(1 - entrance, 4)
      specimen.scale.setScalar(.85 + eased * .15)
      specimen.position.y = .68 + eased * .06
    }
    renderer.render(scene, camera)
    if (entrance < 1 || Math.abs(pivot.rotation.y - angle - pointX * .12) > .0001 || Math.abs(pivot.rotation.x - pointY * .045) > .0001) schedule()
  }
  const schedule = () => { if (!frame && !disposed && !lost && visible && !document.hidden) frame = requestAnimationFrame(render) }
  const resize = () => {
    const { width, height } = host.getBoundingClientRect()
    if (!width || !height) return
    renderer.setSize(width, height)
    camera.aspect = width / height
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(16)) * Math.max(1, (600 / 576) / camera.aspect)))
    camera.updateProjectionMatrix()
    schedule()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) schedule() })
  intersection.observe(host)
  const visibility = () => { if (!document.hidden) schedule() }
  document.addEventListener('visibilitychange', visibility)
  const contextLost = (event: Event) => { event.preventDefault(); lost = true; onState('fallback') }
  renderer.domElement.addEventListener('webglcontextlost', contextLost)
  resize()

  return {
    select(asset) {
      const version = ++request
      if (lost || disposed) return
      onState('loading')
      void Promise.all([pot, load(asset)]).then(([, source]) => {
        if (disposed || version !== request) return
        if (specimen) pivot.remove(specimen)
        specimen = new THREE.Group()
        for (const [x, z, rotation, height] of [[0, -.07, 0, 1.04], [-.2, .08, .85, .85], [.2, .06, -.8, .9], [-.1, -.16, 1.6, .82], [.12, -.12, -1.5, .96]]) {
          const plant = fit(source.clone(), height, 1.42)
          const stem = new THREE.Group()
          stem.add(plant)
          stem.position.set(x, 0, z)
          stem.rotation.y = rotation
          specimen.add(stem)
        }
        pivot.add(specimen)
        entrance = 0
        schedule()
        onState('ready')
      }).catch(() => { if (!disposed && version === request) onState('fallback') })
    },
    point(x, y) { pointX = x; pointY = y; schedule() },
    dispose() {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect(); intersection.disconnect()
      document.removeEventListener('visibilitychange', visibility)
      renderer.domElement.removeEventListener('webglcontextlost', contextLost)
      sources.forEach(release)
      release(scene)
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    },
  }
}
