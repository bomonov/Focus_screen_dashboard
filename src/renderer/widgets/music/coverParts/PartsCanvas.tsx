import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CoverScene } from '../../../../main/ipc'
import {
  KIND_CODE,
  MAX_SHADER_PARTS,
  PARTS_FRAGMENT,
  QUAD_VERTEX,
  SPRAY_FRAGMENT,
  SPRAY_VERTEX
} from './shader'
import { haltLoop, loseWhenGone, releaseGl, type GlResources } from './glResources'
import { bob, drift, flutterAmp, sprayDrops, surge, sway, twinkle } from './timeline'

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

/** The parts move slowly; more frames would look no smoother and cost the GPU for nothing. */
const FPS = 30
const MAX_DPR = 2
/** A cover's parts fade in over its still picture, as a new cover's art does. */
const FADE_MS = 900
const LOOP_PHASE = (2 * Math.PI) / 4

interface Programs {
  gl: WebGLRenderingContext
  parts: WebGLProgram
  spray: WebGLProgram
  quad: WebGLBuffer
  points: WebGLBuffer
  /** The pictures, in their texture units: cover, plate, then each part's weight map. */
  units: WebGLTexture[]
  /** Everything made, to give back when the canvas goes. */
  resources: GlResources
  uniform(program: WebGLProgram, name: string): WebGLUniformLocation | null
}

function loadImage(src: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.src = src
  return image.decode().then(() => image)
}

function program(resources: GlResources, vertex: string, fragment: string): WebGLProgram | null {
  const { gl } = resources
  const compile = (type: number, source: string): WebGLShader | null => {
    const shader = gl.createShader(type)
    if (!shader) return null
    resources.shaders.push(shader)
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null
  }
  const vs = compile(gl.VERTEX_SHADER, vertex)
  const fs = compile(gl.FRAGMENT_SHADER, fragment)
  const made = gl.createProgram()
  if (made) resources.programs.push(made)
  if (!vs || !fs || !made) return null
  gl.attachShader(made, vs)
  gl.attachShader(made, fs)
  gl.linkProgram(made)
  return gl.getProgramParameter(made, gl.LINK_STATUS) ? made : null
}

function texture(resources: GlResources, source: TexImageSource | null): WebGLTexture | null {
  const { gl } = resources
  const made = gl.createTexture()
  if (!made) return null
  resources.textures.push(made)
  gl.bindTexture(gl.TEXTURE_2D, made)
  if (source) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
  } else {
    // A part slot with nothing in it: no motion anywhere.
    const none = new Uint8Array([0, 0, 0, 255])
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, none)
  }
  // The pictures are 768 px, not a power of two: no mipmaps, edges clamped.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return made
}

function setUp(canvas: HTMLCanvasElement): Programs | null {
  const gl = canvas.getContext('webgl', { antialias: false, depth: false, alpha: false })
  if (!gl) return null
  const resources: GlResources = { gl, programs: [], shaders: [], buffers: [], textures: [] }
  const parts = program(resources, QUAD_VERTEX, PARTS_FRAGMENT)
  const spray = program(resources, SPRAY_VERTEX, SPRAY_FRAGMENT)
  const quad = gl.createBuffer()
  const points = gl.createBuffer()
  for (const buffer of [quad, points]) if (buffer) resources.buffers.push(buffer)
  if (!parts || !spray || !quad || !points) {
    releaseGl(resources)
    return null
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const locations = new Map<string, WebGLUniformLocation | null>()
  return {
    gl,
    parts,
    spray,
    quad,
    points,
    units: [],
    resources,
    uniform(target, name) {
      const id = `${target === parts ? 'p' : 's'}:${name}`
      if (!locations.has(id)) locations.set(id, gl.getUniformLocation(target, name))
      return locations.get(id) ?? null
    }
  }
}

/** One frame of the layered cover at time t (seconds into its loop). */
function draw(p: Programs, scene: CoverScene, t: number): void {
  const { gl } = p
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
  const strength = scene.strength
  const kinds = new Float32Array(MAX_SHADER_PARTS)
  const moves = new Float32Array(MAX_SHADER_PARTS * 2)
  const amps = new Float32Array(MAX_SHADER_PARTS)
  const centers = new Float32Array(MAX_SHADER_PARTS * 2)
  const bobs = new Float32Array(MAX_SHADER_PARTS * 2)
  let bobIndex = 0
  scene.parts.slice(0, MAX_SHADER_PARTS).forEach((part, i) => {
    kinds[i] = KIND_CODE[part.kind]
    moves.set(part.move, i * 2)
    centers.set(part.center, i * 2)
    if (part.kind === 'surge') amps[i] = surge(t, strength)
    if (part.kind === 'sway') amps[i] = sway(t, strength)
    if (part.kind === 'flutter') amps[i] = flutterAmp(strength)
    if (part.kind === 'bob') {
      const { lift, tiltDeg } = bob(t, strength, bobIndex++)
      bobs.set([lift, (tiltDeg * Math.PI) / 180], i * 2)
    }
  })
  const slide = drift(t, strength)

  gl.disable(gl.BLEND)
  gl.useProgram(p.parts)
  gl.bindBuffer(gl.ARRAY_BUFFER, p.quad)
  const position = gl.getAttribLocation(p.parts, 'a_pos')
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  p.units.forEach((made, unit) => {
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, made)
  })
  gl.uniform1i(p.uniform(p.parts, 'u_cover'), 0)
  gl.uniform1i(p.uniform(p.parts, 'u_plate'), 1)
  gl.uniform1iv(p.uniform(p.parts, 'u_w'), [2, 3, 4, 5, 6, 7])
  gl.uniform1i(p.uniform(p.parts, 'u_count'), Math.min(scene.parts.length, MAX_SHADER_PARTS))
  gl.uniform1fv(p.uniform(p.parts, 'u_kind'), kinds)
  gl.uniform2fv(p.uniform(p.parts, 'u_move'), moves)
  gl.uniform1fv(p.uniform(p.parts, 'u_amp'), amps)
  gl.uniform2fv(p.uniform(p.parts, 'u_center'), centers)
  gl.uniform2fv(p.uniform(p.parts, 'u_bob'), bobs)
  gl.uniform3f(p.uniform(p.parts, 'u_drift'), slide.a, slide.b, slide.blend)
  gl.uniform1f(p.uniform(p.parts, 'u_flutter'), LOOP_PHASE * t)
  gl.uniform1f(p.uniform(p.parts, 'u_twinkle'), twinkle(t))
  gl.uniform1f(p.uniform(p.parts, 'u_strength'), strength)
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

  const spraying = scene.parts.filter((part) => part.kind === 'spray')
  if (spraying.length === 0) return
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  gl.useProgram(p.spray)
  gl.uniform1f(p.uniform(p.spray, 'u_scale'), gl.drawingBufferWidth / 768)
  gl.bindBuffer(gl.ARRAY_BUFFER, p.points)
  const at = gl.getAttribLocation(p.spray, 'a_pos')
  const size = gl.getAttribLocation(p.spray, 'a_size')
  const alpha = gl.getAttribLocation(p.spray, 'a_alpha')
  for (const part of spraying) {
    const drops = sprayDrops(t, strength, part.emitters, part.seed, part.move)
    if (drops.length === 0) continue
    const data = new Float32Array(drops.length * 4)
    drops.forEach((drop, i) => data.set([drop.x, drop.y, drop.r, drop.alpha], i * 4))
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(at)
    gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 16, 0)
    gl.enableVertexAttribArray(size)
    gl.vertexAttribPointer(size, 1, gl.FLOAT, false, 16, 8)
    gl.enableVertexAttribArray(alpha)
    gl.vertexAttribPointer(alpha, 1, gl.FLOAT, false, 16, 12)
    const [r, g, b] = part.color
    gl.uniform3f(p.uniform(p.spray, 'u_color'), r / 255, g / 255, b / 255)
    gl.drawArrays(gl.POINTS, 0, drops.length)
  }
}

/**
 * The cover with its parts moving, drawn live over its still picture. Time runs only while the
 * music plays; paused it rests on its last frame and draws nothing more. Under reduced motion,
 * or without WebGL, it isn't drawn at all and the still cover shows. Remount it (a new `key`)
 * for a new scene: the pictures are uploaded once.
 */
export function PartsCanvas({
  scene,
  playing
}: {
  scene: CoverScene
  playing: boolean
}): React.JSX.Element | null {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(() => reducedMotion.matches)
  const state = useRef({
    programs: null as Programs | null,
    ready: false,
    time: 0,
    lastFrame: 0,
    frame: 0,
    playing,
    scene,
    start: () => undefined as void
  })

  useLayoutEffect(() => {
    state.current.playing = playing
    state.current.scene = scene
  })

  useEffect(() => {
    const element = canvas.current
    const s = state.current
    if (!element) return
    const programs = setUp(element)
    if (!programs) {
      setFailed(true)
      return
    }
    s.programs = programs
    let live = true

    const paint = (): void => {
      if (s.ready && s.programs) draw(s.programs, s.scene, s.time)
    }
    s.start = () => {
      if (s.frame || !s.ready) return
      const loop = (now: number): void => {
        s.frame = requestAnimationFrame(loop)
        if (s.lastFrame && now - s.lastFrame < 1000 / FPS - 2) return
        const dt = s.lastFrame ? Math.min((now - s.lastFrame) / 1000, 0.1) : 0
        s.lastFrame = now
        if (s.playing) s.time += dt
        paint()
        if (!s.playing) {
          cancelAnimationFrame(s.frame)
          s.frame = 0
          s.lastFrame = 0
        }
      }
      s.frame = requestAnimationFrame(loop)
    }

    const resize = new ResizeObserver(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
      element.width = Math.max(1, Math.round(element.clientWidth * dpr))
      element.height = Math.max(1, Math.round(element.clientHeight * dpr))
      paint()
    })
    resize.observe(element)
    // A lost context draws nothing ever again: stop the loop, and the still cover shows.
    const lost = (event: Event): void => {
      event.preventDefault()
      haltLoop(s, cancelAnimationFrame)
      setFailed(true)
    }
    element.addEventListener('webglcontextlost', lost)

    const { scene: first } = s
    const sources = [first.cover, first.plate ?? first.cover, ...first.parts.map((p) => p.weight)]
    Promise.all(sources.map(loadImage))
      .then((images) => {
        if (!live) return
        const made = images.map((image) => texture(programs.resources, image))
        while (made.length < 2 + MAX_SHADER_PARTS) made.push(texture(programs.resources, null))
        if (made.some((t) => t === null)) {
          setFailed(true)
          return
        }
        programs.units = made as WebGLTexture[]
        s.ready = true
        paint()
        element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, fill: 'forwards' })
        if (s.playing) s.start()
      })
      .catch(() => {
        if (live) setFailed(true)
      })

    return () => {
      live = false
      haltLoop(s, cancelAnimationFrame)
      resize.disconnect()
      element.removeEventListener('webglcontextlost', lost)
      releaseGl(programs.resources)
      loseWhenGone(element, programs.gl)
      s.programs = null
    }
  }, [])

  useEffect(() => {
    if (playing) state.current.start()
  }, [playing])

  if (failed) return null
  return <canvas ref={canvas} className="cover__parts" style={{ opacity: 0 }} aria-hidden="true" />
}
