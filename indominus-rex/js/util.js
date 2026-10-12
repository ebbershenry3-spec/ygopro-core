// Small math helpers shared by the rig, the creatures and the director.
import * as THREE from 'three';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const smoother = (t) => { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
export const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeIn = (t) => Math.pow(clamp(t, 0, 1), 3);
export const DEG = Math.PI / 180;

// frame-rate independent exponential approach
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
export const dampAngle = (a, b, lambda, dt) => a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));

// Second-order spring follower (frequency in Hz, zeta = damping ratio). Gives overlap/overshoot.
export class Spring {
  constructor(value = 0, freq = 4, zeta = 0.7) { this.x = value; this.v = 0; this.freq = freq; this.zeta = zeta; }
  update(target, dt) {
    const w = this.freq * Math.PI * 2;
    // semi-implicit integration with substeps for stability
    const n = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = w * w * (target - this.x) - 2 * this.zeta * w * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
    return this.x;
  }
  reset(v) { this.x = v; this.v = 0; }
}

// deterministic value noise (1D) for organic jitter
export function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
export function noise1(x) {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash(i), hash(i + 1), u) * 2 - 1;
}
export function fbm1(x, oct = 3) {
  let a = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { a += noise1(x * f + i * 17.3) * amp; f *= 2; amp *= 0.5; }
  return a;
}

// Keyframe track with non-uniform Catmull-Rom style tangents.
// keys: [[t, v], [t, v], ...] sorted by t. Optional third element per key = 'step' | 'lin'
export function sampleKeys(keys, t) {
  const n = keys.length;
  if (n === 0) return 0;
  if (t <= keys[0][0]) return keys[0][1];
  if (t >= keys[n - 1][0]) return keys[n - 1][1];
  let i = 0;
  while (i < n - 2 && t > keys[i + 1][0]) i++;
  const [t0, v0] = keys[i], [t1, v1] = keys[i + 1];
  const h = t1 - t0;
  const s = h > 0 ? (t - t0) / h : 1;
  const mode = keys[i + 1][2];
  if (mode === 'lin') return lerp(v0, v1, s);
  if (mode === 'step') return v0;
  const slope = (a, b) => (keys[b][1] - keys[a][1]) / Math.max(1e-6, keys[b][0] - keys[a][0]);
  const m0 = i > 0 ? 0.5 * (slope(i - 1, i) + slope(i, i + 1)) : 0;
  const m1 = i + 2 < n ? 0.5 * (slope(i, i + 1) + slope(i + 1, i + 2)) : 0;
  const s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * v0 + (s3 - 2 * s2 + s) * h * m0 + (-2 * s3 + 3 * s2) * v1 + (s3 - s2) * h * m1;
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
// quaternion from creature-space yaw (Y), pitch (X, + = nose down), roll (Z)
export function quatYPR(yaw, pitch, roll, out = new THREE.Quaternion()) {
  _e.set(pitch, yaw, roll, 'YXZ');
  return out.setFromEuler(_e);
}

export function seededRandom(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export { _q as tmpQuat };
