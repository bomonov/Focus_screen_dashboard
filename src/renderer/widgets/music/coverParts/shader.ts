// The layered cover's shaders (WebGL 1). One pass draws the cover with its parts moved: Surge,
// Sway and Flutter displace it, Drift slides its part's texture, Twinkle changes brightness, and
// Bob lifts its part over the plate (the cover with what's under it filled in). A second pass
// draws Spray's drops as soft points. Distances are in the 768 px analysis space.

/** Kind codes the main pass switches on (the order of MOTION_KINDS). */
export const KIND_CODE = {
  surge: 0,
  flutter: 1,
  sway: 2,
  drift: 3,
  bob: 4,
  spray: 5,
  twinkle: 6
} as const

export const MAX_SHADER_PARTS = 6

export const QUAD_VERTEX = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  // Top-left origin, as the pictures are uploaded.
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

export const PARTS_FRAGMENT = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_cover;
uniform sampler2D u_plate;
uniform sampler2D u_w[6];
uniform int u_count;
uniform float u_kind[6];
uniform vec2 u_move[6];
uniform float u_amp[6];
uniform vec2 u_center[6];
// Bob: lift (px) and tilt (radians).
uniform vec2 u_bob[6];
// Drift: the two offsets (px) and their blend.
uniform vec3 u_drift;
uniform float u_flutter;
uniform float u_twinkle;
uniform float u_strength;
const float S = 768.0;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec3 cover(vec2 q) { return texture2D(u_cover, clamp(q / S, 0.0, 1.0)).rgb; }
// Sampler arrays only take constant indices in WebGL 1.
vec4 W(int i, vec2 q) {
  vec2 uv = clamp(q / S, 0.0, 1.0);
  if (i == 0) return texture2D(u_w[0], uv);
  if (i == 1) return texture2D(u_w[1], uv);
  if (i == 2) return texture2D(u_w[2], uv);
  if (i == 3) return texture2D(u_w[3], uv);
  if (i == 4) return texture2D(u_w[4], uv);
  return texture2D(u_w[5], uv);
}

void main() {
  vec2 p = v_uv * S;
  // Out of step from place to place, so a flutter or a twinkle never moves as one sheet.
  float phi = noise(p / 18.0) * 6.2832;

  vec2 d = vec2(0.0);
  for (int i = 0; i < 6; i++) {
    if (i >= u_count) break;
    float k = u_kind[i];
    if (k < 0.5 || (k > 1.5 && k < 2.5)) {
      // Surge and Sway: bent along the part, the far end turning down with gravity.
      vec4 w = W(i, p);
      vec2 m = u_move[i];
      float a = radians(35.0) * w.g * (m.x >= 0.0 ? 1.0 : -1.0);
      d += w.r * u_amp[i] * vec2(m.x * cos(a) - m.y * sin(a), m.x * sin(a) + m.y * cos(a));
    } else if (k < 1.5) {
      vec4 w = W(i, p);
      d += w.r * u_amp[i] * sin(u_flutter + phi) * u_move[i];
    }
  }
  vec3 color = cover(p - d);

  for (int i = 0; i < 6; i++) {
    if (i >= u_count) break;
    float k = u_kind[i];
    if (k > 2.5 && k < 3.5) {
      // Drift: two offsets crossfaded, only where the part lands on itself.
      vec2 dir = vec2(u_move[i].x >= 0.0 ? 1.0 : -1.0, 0.0);
      vec2 pa = p - dir * u_drift.x;
      vec2 pb = p - dir * u_drift.y;
      float ok = W(i, p).r * W(i, pa).r * W(i, pb).r;
      color = mix(color, mix(cover(pa), cover(pb), u_drift.z), ok);
    } else if (k > 5.5) {
      color *= 1.0 + 0.2 * u_strength * W(i, p).r * sin(u_twinkle + phi);
    }
  }

  for (int i = 0; i < 6; i++) {
    if (i >= u_count) break;
    float k = u_kind[i];
    if (k > 3.5 && k < 4.5) {
      // Bob: what's under the part first, then the part lifted and tilted about its middle.
      color = mix(color, texture2D(u_plate, v_uv).rgb, smoothstep(0.0, 0.35, W(i, p).b));
      vec2 c = u_center[i];
      float t = u_bob[i].y;
      vec2 r = p - c - vec2(0.0, u_bob[i].x);
      vec2 q = vec2(r.x * cos(t) + r.y * sin(t), -r.x * sin(t) + r.y * cos(t)) + c;
      color = mix(color, cover(q), W(i, q).b);
    }
  }
  gl_FragColor = vec4(color, 1.0);
}`

export const SPRAY_VERTEX = `
attribute vec2 a_pos;
attribute float a_size;
attribute float a_alpha;
uniform float u_scale;
varying float v_alpha;
void main() {
  gl_Position = vec4(a_pos.x / 768.0 * 2.0 - 1.0, 1.0 - a_pos.y / 768.0 * 2.0, 0.0, 1.0);
  gl_PointSize = max(1.0, a_size * 2.0 * u_scale);
  v_alpha = a_alpha;
}`

export const SPRAY_FRAGMENT = `
precision mediump float;
uniform vec3 u_color;
varying float v_alpha;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.55, 1.0, r)) * v_alpha * 0.9;
  gl_FragColor = vec4(u_color * a, a);
}`
