import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useCoverPalette } from '../hooks/useCoverPalette'
import { parseHex } from '../theme/color'

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

/**
 * The canvas is this many times smaller than the window and scaled up: the colors are soft
 * anyway, so it costs next to nothing to draw.
 */
const SCALE = 8
/**
 * Frames a second. The colors drift slowly, so more would look no smoother; and everything in
 * front (glass cards especially) is redrawn as often as this changes.
 */
const FPS = 15
/** A new song's colors melt in over this long. */
const BLEND_MS = 1600

const VERTEX = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`

// Three soft blobs on slow paths that never quite repeat, over the cover's overall tone.
const FRAGMENT = `
precision mediump float;
varying vec2 v_uv;
uniform float u_aspect;
uniform float u_time;
uniform vec3 u_colors[4];

float blob(vec2 p, vec2 c, float r) {
  vec2 d = p - c;
  return exp(-dot(d, d) / (r * r));
}

void main() {
  float a = u_aspect;
  float t = u_time;
  vec2 p = vec2(v_uv.x * a, v_uv.y);
  vec2 c0 = vec2(a * (0.30 + 0.24 * sin(t * 0.13)), 0.36 + 0.26 * cos(t * 0.11));
  vec2 c1 = vec2(a * (0.70 + 0.22 * cos(t * 0.09 + 1.3)), 0.62 + 0.25 * sin(t * 0.12 + 0.7));
  vec2 c2 = vec2(a * (0.50 + 0.32 * sin(t * 0.07 + 2.1)), 0.50 + 0.30 * sin(t * 0.10 + 3.4));
  float w0 = blob(p, c0, 0.5);
  float w1 = blob(p, c1, 0.46);
  float w2 = blob(p, c2, 0.4);
  // The cover's overall tone only fills in where no blob reaches, so its colors stay apart.
  float w3 = 0.05;
  vec3 color = (u_colors[0] * w0 + u_colors[1] * w1 + u_colors[2] * w2 + u_colors[3] * w3)
    / (w0 + w1 + w2 + w3);
  // A whisper of noise, so dark gradients don't band once scaled up.
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  gl_FragColor = vec4(color + (n - 0.5) / 255.0, 1.0);
}`

/** The four colors as 12 numbers, 0–1, for the shader. */
function toFloats(palette: readonly string[]): number[] {
  return palette.flatMap((hex) => {
    const rgb = parseHex(hex) ?? { r: 51, g: 51, b: 51 }
    return [rgb.r / 255, rgb.g / 255, rgb.b / 255]
  })
}

function supportsWebGl(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl') !== null
  } catch {
    return false
  }
}

interface LivingColorsProps {
  /** The cover, as a data URL; null when the song has none. */
  artwork: string | null
  /** The stand-in label's colors, used when there's no cover. */
  fallback: readonly string[]
  /** The colors only drift while the music plays; paused, they rest where they are. */
  playing: boolean
}

/**
 * The song's colors drifting slowly behind the cards, like Apple Music's full-screen player.
 * Drawn small with WebGL and scaled up; it draws at most FPS times a second, only while it
 * moves (music playing, or a new song's colors blending in), and not at all when hidden.
 */
export function LivingColors({ artwork, fallback, playing }: LivingColorsProps): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)
  const palette = useCoverPalette(artwork, fallback)
  const [webgl, setWebgl] = useState(supportsWebGl)
  const state = useRef({
    gl: null as WebGLRenderingContext | null,
    uniforms: null as {
      aspect: WebGLUniformLocation | null
      time: WebGLUniformLocation | null
      colors: WebGLUniformLocation | null
    } | null,
    from: toFloats(palette),
    to: toFloats(palette),
    blendStart: 0,
    time: 0,
    lastFrame: 0,
    frame: 0,
    playing,
    draw: () => undefined as void
  })

  // GL is set up once; a lost context falls back to still colors.
  useLayoutEffect(() => {
    const element = canvas.current
    if (!element || !webgl) return
    const s = state.current
    const gl = element.getContext('webgl', { antialias: false, alpha: false, depth: false })
    if (!gl) return
    const shader = (type: number, source: string): WebGLShader | null => {
      const made = gl.createShader(type)
      if (!made) return null
      gl.shaderSource(made, source)
      gl.compileShader(made)
      return gl.getShaderParameter(made, gl.COMPILE_STATUS) ? made : null
    }
    const vertex = shader(gl.VERTEX_SHADER, VERTEX)
    const fragment = shader(gl.FRAGMENT_SHADER, FRAGMENT)
    const program = gl.createProgram()
    if (!vertex || !fragment || !program) return
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return
    gl.useProgram(program)
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(program, 'a_position')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    s.gl = gl
    s.uniforms = {
      aspect: gl.getUniformLocation(program, 'u_aspect'),
      time: gl.getUniformLocation(program, 'u_time'),
      colors: gl.getUniformLocation(program, 'u_colors')
    }

    const resize = (): void => {
      element.width = Math.max(48, Math.round(window.innerWidth / SCALE))
      element.height = Math.max(32, Math.round(window.innerHeight / SCALE))
      gl.viewport(0, 0, element.width, element.height)
      s.draw()
    }
    const lost = (event: Event): void => {
      event.preventDefault()
      cancelAnimationFrame(s.frame)
      s.frame = 0
      s.gl = null
      setWebgl(false)
    }
    element.addEventListener('webglcontextlost', lost)
    window.addEventListener('resize', resize)
    resize()
    return () => {
      cancelAnimationFrame(s.frame)
      s.frame = 0
      element.removeEventListener('webglcontextlost', lost)
      window.removeEventListener('resize', resize)
      s.gl = null
    }
  }, [webgl])

  // One frame: the blend between the last colors and the new ones, at the current drift.
  useLayoutEffect(() => {
    const s = state.current
    s.draw = () => {
      const gl = s.gl
      const uniforms = s.uniforms
      if (!gl || !uniforms) return
      const t = Math.min(Math.max((performance.now() - s.blendStart) / BLEND_MS, 0), 1)
      const eased = t * t * (3 - 2 * t)
      const colors = s.to.map((to, i) => (s.from[i] ?? to) + (to - (s.from[i] ?? to)) * eased)
      gl.uniform1f(uniforms.aspect, gl.drawingBufferWidth / Math.max(1, gl.drawingBufferHeight))
      gl.uniform1f(uniforms.time, s.time)
      gl.uniform3fv(uniforms.colors, colors)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
  })

  const start = useRef(() => undefined as void)
  useLayoutEffect(() => {
    const s = state.current
    start.current = () => {
      if (s.frame || !s.gl) return
      const loop = (now: number): void => {
        s.frame = requestAnimationFrame(loop)
        if (s.lastFrame && now - s.lastFrame < 1000 / FPS - 2) return
        const dt = s.lastFrame ? Math.min((now - s.lastFrame) / 1000, 0.1) : 0
        s.lastFrame = now
        if (s.playing && !reducedMotion.matches) s.time += dt
        s.draw()
        const blending = now - s.blendStart < BLEND_MS
        if ((!s.playing || reducedMotion.matches) && !blending) {
          cancelAnimationFrame(s.frame)
          s.frame = 0
          s.lastFrame = 0
        }
      }
      s.frame = requestAnimationFrame(loop)
    }
  })

  // A new song's colors: blend from wherever the colors are now.
  const paletteKey = palette.join(',')
  useEffect(() => {
    const s = state.current
    const t = Math.min(Math.max((performance.now() - s.blendStart) / BLEND_MS, 0), 1)
    const eased = t * t * (3 - 2 * t)
    s.from = s.to.map((to, i) => (s.from[i] ?? to) + (to - (s.from[i] ?? to)) * eased)
    s.to = toFloats(paletteKey.split(','))
    s.blendStart = performance.now()
    start.current()
  }, [paletteKey])

  useEffect(() => {
    state.current.playing = playing
    if (playing) start.current()
  }, [playing])

  if (!webgl) {
    // No WebGL: the same colors, still.
    const [a, b, c, base] = palette
    return (
      <div
        className="backdrop__living"
        style={{
          background: `radial-gradient(circle at 25% 30%, ${a}, transparent 60%), radial-gradient(circle at 75% 65%, ${b}, transparent 55%), radial-gradient(circle at 50% 50%, ${c}, transparent 50%), ${base}`
        }}
      />
    )
  }
  return <canvas ref={canvas} className="backdrop__living" />
}
