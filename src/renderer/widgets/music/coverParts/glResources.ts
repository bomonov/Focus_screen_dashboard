// Giving WebGL back. The cover's canvas is remounted for every new cover (and every editor
// rebuild), and Chromium keeps at most 16 live contexts, dropping the oldest, which can be Living
// colors' background; so each mount hands back everything it made, and its context once the
// canvas is gone.

export interface GlResources {
  gl: WebGLRenderingContext
  programs: WebGLProgram[]
  shaders: WebGLShader[]
  buffers: WebGLBuffer[]
  /** Every texture made, kept even when a later one fails, so none is left behind. */
  textures: WebGLTexture[]
}

export function releaseGl(resources: GlResources): void {
  const { gl } = resources
  for (const texture of resources.textures) gl.deleteTexture(texture)
  for (const program of resources.programs) gl.deleteProgram(program)
  for (const shader of resources.shaders) gl.deleteShader(shader)
  for (const buffer of resources.buffers) gl.deleteBuffer(buffer)
  resources.textures = []
  resources.programs = []
  resources.shaders = []
  resources.buffers = []
}

/**
 * Lets the context go, but only once the canvas has really left the page: React's StrictMode
 * unmounts and mounts again on the same canvas (in dev builds), and a lost context can't be used.
 */
export function loseWhenGone(
  canvas: { isConnected: boolean },
  gl: WebGLRenderingContext,
  later: (run: () => void) => void = (run) => setTimeout(run, 0)
): void {
  later(() => {
    if (!canvas.isConnected) gl.getExtension('WEBGL_lose_context')?.loseContext()
  })
}

/** Stops a frame loop for good: nothing more is drawn until the canvas is mounted again. */
export function haltLoop(
  loop: { frame: number; lastFrame: number; ready: boolean },
  cancel: (id: number) => void
): void {
  if (loop.frame) cancel(loop.frame)
  loop.frame = 0
  loop.lastFrame = 0
  loop.ready = false
}
