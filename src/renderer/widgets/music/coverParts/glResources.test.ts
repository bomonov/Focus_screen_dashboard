import { describe, expect, it } from 'vitest'
import { haltLoop, loseWhenGone, releaseGl, type GlResources } from './glResources'

function fakeGl(): { gl: WebGLRenderingContext; calls: string[] } {
  const calls: string[] = []
  const gl = {
    deleteTexture: () => calls.push('texture'),
    deleteProgram: () => calls.push('program'),
    deleteShader: () => calls.push('shader'),
    deleteBuffer: () => calls.push('buffer'),
    getExtension: (name: string) =>
      name === 'WEBGL_lose_context' ? { loseContext: () => calls.push('lose') } : null
  } as unknown as WebGLRenderingContext
  return { gl, calls }
}

it('gives back everything a scene used', () => {
  const { gl, calls } = fakeGl()
  const resources: GlResources = {
    gl,
    programs: [{} as WebGLProgram, {} as WebGLProgram],
    shaders: [{} as WebGLShader, {} as WebGLShader, {} as WebGLShader, {} as WebGLShader],
    buffers: [{} as WebGLBuffer, {} as WebGLBuffer],
    textures: [{} as WebGLTexture, {} as WebGLTexture, {} as WebGLTexture]
  }
  releaseGl(resources)
  expect(calls.filter((c) => c === 'texture')).toHaveLength(3)
  expect(calls.filter((c) => c === 'program')).toHaveLength(2)
  expect(calls.filter((c) => c === 'shader')).toHaveLength(4)
  expect(calls.filter((c) => c === 'buffer')).toHaveLength(2)
  expect(calls).not.toContain('lose')
  expect(resources.textures).toHaveLength(0)
})

it('stops the frame loop for good when the context is lost', () => {
  const cancelled: number[] = []
  const loop = { frame: 42, lastFrame: 1000, ready: true }
  haltLoop(loop, (id) => cancelled.push(id))
  expect(cancelled).toEqual([42])
  expect(loop).toEqual({ frame: 0, lastFrame: 0, ready: false })
})

describe('losing the context', () => {
  it('waits until the canvas has really left the page', () => {
    const { gl, calls } = fakeGl()
    const later: (() => void)[] = []
    const canvas = { isConnected: true }
    loseWhenGone(canvas, gl, (fn) => later.push(fn))
    later.forEach((fn) => fn())
    // React's StrictMode unmounts and mounts again on the same canvas: it must keep its context.
    expect(calls).not.toContain('lose')
    canvas.isConnected = false
    loseWhenGone(canvas, gl, (fn) => later.push(fn))
    later.forEach((fn) => fn())
    expect(calls).toContain('lose')
  })
})
