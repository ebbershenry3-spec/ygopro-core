// Procedurally generated, tileable skin textures (scales) used by the generated creatures.
import * as THREE from 'three';
import { seededRandom } from './util.js';

// Voronoi scale field: returns {height, edge} arrays for a tileable N x N grid
function scaleField(N, cells, seed, jitter = 0.85) {
  const rnd = seededRandom(seed);
  const pts = [];
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
    pts.push([(i + 0.5 + (rnd() - 0.5) * jitter) / cells, (j + 0.5 + (rnd() - 0.5) * jitter) / cells, rnd()]);
  }
  const height = new Float32Array(N * N), tone = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      const ci = Math.floor(u * cells), cj = Math.floor(v * cells);
      let d1 = 9, d2 = 9, id = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const ii = (ci + di + cells) % cells, jj = (cj + dj + cells) % cells;
        const p = pts[jj * cells + ii];
        // wrapped neighbour cell -> shift the feature point by a whole tile
        const px = p[0] + (ci + di - ii) / cells, py = p[1] + (cj + dj - jj) / cells;
        const dx = u - px, dy = v - py;
        const d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; id = p[2]; } else if (d < d2) d2 = d;
      }
      const e = (Math.sqrt(d2) - Math.sqrt(d1)) * cells; // distance to edge (0 at crease)
      const h = Math.min(1, e * 2.2);
      height[y * N + x] = Math.sqrt(h) * (0.75 + id * 0.25);
      tone[y * N + x] = id;
    }
  }
  return { height, tone };
}

function heightToNormal(N, H, strength) {
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const l = H[y * N + ((x - 1 + N) % N)], r = H[y * N + ((x + 1) % N)];
    const d = H[((y - 1 + N) % N) * N + x], u = H[((y + 1) % N) * N + x];
    let nx = (l - r) * strength, ny = (d - u) * strength, nz = 1;
    const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    const i = (y * N + x) * 4;
    data[i] = (nx * 0.5 + 0.5) * 255; data[i + 1] = (ny * 0.5 + 0.5) * 255; data[i + 2] = (nz * 0.5 + 0.5) * 255; data[i + 3] = 255;
  }
  return data;
}

const cache = {};
export function scaleTextures(seed = 7, N = 256, cells = 10) {
  const key = seed + ':' + N + ':' + cells;
  if (cache[key]) return cache[key];
  const big = scaleField(N, cells, seed);
  const small = scaleField(N, cells * 3, seed + 11);
  const H = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) H[i] = big.height[i] * 0.75 + small.height[i] * 0.3;
  const nData = heightToNormal(N, H, 3.2);
  const normal = new THREE.DataTexture(nData, N, N, THREE.RGBAFormat);
  // albedo detail: creases darker, per-scale tone variation (multiplied with vertex colours)
  const aData = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    const c = 0.55 + 0.45 * Math.min(1, H[i] * 1.2) - big.tone[i] * 0.08 + small.tone[i] * 0.05;
    const v = Math.max(0, Math.min(255, c * 255));
    aData[i * 4] = v; aData[i * 4 + 1] = v * 0.98; aData[i * 4 + 2] = v * 0.95; aData[i * 4 + 3] = 255;
  }
  const albedo = new THREE.DataTexture(aData, N, N, THREE.RGBAFormat);
  albedo.colorSpace = THREE.SRGBColorSpace;
  const hData = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) { const v = Math.max(0, Math.min(255, H[i] * 230)); hData[i * 4] = hData[i * 4 + 1] = hData[i * 4 + 2] = v; hData[i * 4 + 3] = 255; }
  const height = new THREE.DataTexture(hData, N, N, THREE.RGBAFormat);
  for (const t of [normal, albedo, height]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  }
  cache[key] = { normal, albedo, height };
  return cache[key];
}

// eye texture: amber iris with vertical slit pupil
export function eyeTexture(iris = '#d8a020') {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#1a1208'; g.fillRect(0, 0, 128, 128);
  const grd = g.createRadialGradient(64, 64, 5, 64, 64, 60);
  grd.addColorStop(0, iris); grd.addColorStop(0.7, iris); grd.addColorStop(1, '#3a2408');
  g.fillStyle = grd; g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#050302'; g.beginPath(); g.ellipse(64, 64, 9, 40, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.arc(48, 44, 8, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
