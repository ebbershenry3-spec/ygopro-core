// Procedural diorama vegetation: ferns, broad-leaf rosettes, moss tufts with sporophytes and leaf litter.
import * as THREE from 'three';
import { seededRandom } from './util.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

class Mesher {
  constructor() { this.p = []; this.c = []; this.i = []; }
  v(p, c) { this.p.push(p.x, p.y, p.z); this.c.push(c.r, c.g, c.b); return this.p.length / 3 - 1; }
  tri(a, b, c) { this.i.push(a, b, c); }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeVertexNormals();
    return g;
  }
}

// One fern frond: an arching rachis with paired, tapering pinnae
function frond(M, origin, azimuth, len, rise, rnd, palette) {
  const N = 22;
  const pts = [];
  let p = origin.clone(), ang = rise;
  const dirH = V3(Math.sin(azimuth), 0, Math.cos(azimuth));
  const side = V3(Math.cos(azimuth), 0, -Math.sin(azimuth));
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    pts.push({ p: p.clone(), t, ang });
    const step = len / N;
    p.addScaledVector(dirH, Math.cos(ang) * step).add(V3(0, Math.sin(ang) * step, 0));
    ang -= (rise + 0.5) * 1.6 / N * (0.4 + t);
  }
  const twist = (rnd() - 0.5) * 0.4;
  for (let i = 2; i < N; i++) {
    const { p: base, t, ang: a } = pts[i];
    const tangent = dirH.clone().multiplyScalar(Math.cos(a)).add(V3(0, Math.sin(a), 0)).normalize();
    const L = len * 0.2 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.95 + 0.05)), 0.7) + len * 0.012;
    const w = L * 0.2;
    const col = palette.leaf.clone().lerp(palette.tip, t * 0.8 + rnd() * 0.15);
    const dark = palette.leaf.clone().multiplyScalar(0.55);
    for (const s of [1, -1]) {
      const out = side.clone().multiplyScalar(s).applyAxisAngle(tangent, twist * s).addScaledVector(tangent, 0.45).normalize();
      const droop = V3(0, -0.35 - t * 0.3, 0);
      const mid = base.clone().addScaledVector(out, L * 0.5).addScaledVector(droop, L * 0.12);
      const tip = base.clone().addScaledVector(out, L).addScaledVector(droop, L * 0.38);
      const perp = tangent.clone().multiplyScalar(w);
      const i0 = M.v(base, dark), i1 = M.v(mid.clone().add(perp), col), i2 = M.v(mid.clone().sub(perp), col), i3 = M.v(tip, col);
      M.tri(i0, i1, i3); M.tri(i0, i3, i2);
    }
  }
  // rachis as a thin ribbon
  for (let i = 0; i < N; i++) {
    const a = pts[i].p, b = pts[i + 1].p;
    const w = 0.012 * len * (1 - pts[i].t * 0.8);
    const s = side.clone().multiplyScalar(w);
    const c = palette.stem;
    const i0 = M.v(a.clone().add(s), c), i1 = M.v(a.clone().sub(s), c), i2 = M.v(b.clone().add(s), c), i3 = M.v(b.clone().sub(s), c);
    M.tri(i0, i2, i1); M.tri(i1, i2, i3);
  }
}

export function fernGeometry(seed, size = 1) {
  const rnd = seededRandom(seed);
  const M = new Mesher();
  const palette = { leaf: new THREE.Color('#244a17'), tip: new THREE.Color('#5f8a2c'), stem: new THREE.Color('#33401b') };
  const n = 10 + Math.floor(rnd() * 5);
  for (let k = 0; k < n; k++) {
    const az = (k / n) * Math.PI * 2 + rnd() * 0.5;
    frond(M, V3(0, 0, 0), az, size * (0.75 + rnd() * 0.45), 0.9 + rnd() * 0.45, rnd, palette);
  }
  // fiddleheads in the centre
  for (let k = 0; k < 3; k++) {
    const az = rnd() * 6.28;
    const base = V3(Math.sin(az) * 0.03, 0, Math.cos(az) * 0.03).multiplyScalar(size);
    for (let i = 0; i < 10; i++) {
      const t = i / 10, r = size * 0.05 * (1 - t * 0.7);
      const p = base.clone().add(V3(Math.sin(az) * r * Math.sin(t * 5), size * 0.25 + Math.cos(t * 5) * r, Math.cos(az) * r * Math.sin(t * 5)));
      const s = size * 0.012;
      const c = palette.stem;
      const i0 = M.v(p.clone().add(V3(s, 0, 0)), c), i1 = M.v(p.clone().add(V3(-s, 0, 0)), c), i2 = M.v(p.clone().add(V3(0, s * 2, 0)), c);
      M.tri(i0, i2, i1);
    }
  }
  return M.geometry();
}

export function rosetteGeometry(seed, size = 1) {
  const rnd = seededRandom(seed);
  const M = new Mesher();
  const n = 5 + Math.floor(rnd() * 3);
  const dark = new THREE.Color('#1e3b18'), light = new THREE.Color('#4f7a2a');
  for (let k = 0; k < n; k++) {
    const az = (k / n) * Math.PI * 2 + rnd();
    const d = V3(Math.sin(az), 0, Math.cos(az));
    const s = V3(Math.cos(az), 0, -Math.sin(az));
    const L = size * (0.6 + rnd() * 0.4);
    const rise = 0.5 + rnd() * 0.4;
    let prevL = -1, prevR = -1, prevM = -1;
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const p = d.clone().multiplyScalar(L * t).add(V3(0, Math.sin(t * Math.PI * 0.9) * L * rise * 0.5 - t * t * L * 0.2, 0));
      const w = Math.sin(Math.PI * Math.min(1, t * 1.05)) * L * 0.22;
      const c = dark.clone().lerp(light, t * 0.7 + rnd() * 0.1);
      const im = M.v(p.clone().add(V3(0, -w * 0.15, 0)), c);
      const il = M.v(p.clone().addScaledVector(s, w).add(V3(0, w * 0.15, 0)), c);
      const ir = M.v(p.clone().addScaledVector(s, -w).add(V3(0, w * 0.15, 0)), c);
      if (prevM >= 0) { M.tri(prevM, il, prevL); M.tri(prevM, im, il); M.tri(prevM, prevR, ir); M.tri(prevM, ir, im); }
      prevL = il; prevR = ir; prevM = im;
    }
  }
  return M.geometry();
}

// a small cushion tuft of moss blades plus a few sporophyte stalks with capsules
export function mossTuftGeometry(seed) {
  const rnd = seededRandom(seed);
  const M = new Mesher();
  const a = new THREE.Color('#2c4419'), b = new THREE.Color('#8a9a34');
  for (let k = 0; k < 9; k++) {
    const az = rnd() * 6.28, r = rnd() * 0.5;
    const base = V3(Math.sin(az) * r, 0, Math.cos(az) * r);
    const h = 0.5 + rnd() * 0.6;
    const lean = V3(Math.sin(az) * 0.3, 1, Math.cos(az) * 0.3).normalize();
    const w = 0.09;
    const s = V3(Math.cos(az), 0, -Math.sin(az)).multiplyScalar(w);
    const i0 = M.v(base.clone().add(s), a), i1 = M.v(base.clone().sub(s), a), i2 = M.v(base.clone().addScaledVector(lean, h), b);
    M.tri(i0, i2, i1);
  }
  const stalk = new THREE.Color('#7a3b1d'), cap = new THREE.Color('#4a2a14');
  if (rnd() < 0.45) {
    for (let k = 0; k < 2; k++) {
      const az = rnd() * 6.28;
      const top = V3(Math.sin(az) * 0.3, 1.6 + rnd() * 0.8, Math.cos(az) * 0.3);
      const s = V3(0.025, 0, 0);
      const i0 = M.v(V3(0, 0, 0).add(s), stalk), i1 = M.v(V3(0, 0, 0).sub(s), stalk), i2 = M.v(top, stalk);
      M.tri(i0, i2, i1);
      const c = top.clone(), cs = 0.07;
      const j0 = M.v(c.clone().add(V3(cs, 0, 0)), cap), j1 = M.v(c.clone().add(V3(-cs, 0, 0)), cap), j2 = M.v(c.clone().add(V3(0, cs * 2.4, 0)), cap), j3 = M.v(c.clone().add(V3(0, -cs, 0)), cap);
      M.tri(j0, j2, j1); M.tri(j0, j1, j3);
    }
  }
  return M.geometry();
}

export function leafGeometry() {
  const M = new Mesher();
  const c = new THREE.Color('#ffffff');
  const pts = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const w = Math.sin(Math.PI * t) * 0.32 * (1 - t * 0.3);
    pts.push([t - 0.5, w]);
  }
  const center = [];
  for (const [x] of pts) center.push(M.v(V3(x, 0.02, 0), c));
  const left = pts.map(([x, w]) => M.v(V3(x, 0.05 * Math.abs(w), w), c));
  const right = pts.map(([x, w]) => M.v(V3(x, 0.05 * Math.abs(w), -w), c));
  for (let i = 0; i < 6; i++) {
    M.tri(center[i], left[i + 1], left[i]); M.tri(center[i], center[i + 1], left[i + 1]);
    M.tri(center[i], right[i], right[i + 1]); M.tri(center[i], right[i + 1], center[i + 1]);
  }
  return M.geometry();
}

export function plantMaterial(opts = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.62, metalness: 0, ...opts });
  return m;
}

/** Scatter the vegetation onto the diorama using the spots baked by tools/build_diorama.py. */
export function buildVegetation(ex, heightAt) {
  const group = new THREE.Group();
  const rnd = seededRandom(42);
  const mat = plantMaterial();
  const dummy = new THREE.Object3D();
  // ferns: three geometry variants
  const fernGeos = [fernGeometry(1, 1.0), fernGeometry(2, 1.0), fernGeometry(3, 1.0)];
  const perVariant = [[], [], []];
  ex.ferns.slice(0, 11).forEach((p, i) => perVariant[i % 3].push(p));
  fernGeos.forEach((g, k) => {
    const list = perVariant[k];
    if (!list.length) return;
    const im = new THREE.InstancedMesh(g, mat, list.length);
    list.forEach((p, i) => {
      dummy.position.set(p[0], p[1] - 0.03, p[2]);
      dummy.rotation.set((rnd() - 0.5) * 0.15, rnd() * 6.28, (rnd() - 0.5) * 0.15);
      const s = 0.75 + rnd() * 0.55;
      dummy.scale.set(s, s * (0.85 + rnd() * 0.3), s);
      dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
    });
    im.castShadow = true; im.receiveShadow = true;
    group.add(im);
  });
  // broad-leaf rosettes
  const ros = rosetteGeometry(7, 1);
  const pl = ex.plants.filter((_, i) => i % 3 === 0);
  if (pl.length) {
    const im = new THREE.InstancedMesh(ros, mat, pl.length);
    pl.forEach((p, i) => {
      dummy.position.set(p[0], p[1] - 0.02, p[2]); dummy.rotation.set(0, rnd() * 6.28, 0);
      const s = 0.35 + rnd() * 0.3; dummy.scale.set(s, s, s); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
    });
    im.castShadow = true; im.receiveShadow = true;
    group.add(im);
  }
  // small fern sprouts in the remaining plant spots
  const sprout = fernGeometry(9, 0.45);
  const sp = ex.plants.filter((_, i) => i % 3 !== 0);
  if (sp.length) {
    const im = new THREE.InstancedMesh(sprout, mat, sp.length);
    sp.forEach((p, i) => {
      dummy.position.set(p[0], p[1] - 0.02, p[2]); dummy.rotation.set(0, rnd() * 6.28, 0);
      const s = 0.5 + rnd() * 0.5; dummy.scale.set(s, s, s); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
    });
    im.castShadow = true; im.receiveShadow = true;
    group.add(im);
  }
  // moss tufts on the cushions
  const tuftGeos = [mossTuftGeometry(1), mossTuftGeometry(2), mossTuftGeometry(3)];
  const tuftMat = plantMaterial({ roughness: 0.9 });
  const mp = ex.mossPoints || [];
  tuftGeos.forEach((g, k) => {
    const list = mp.filter((_, i) => i % 3 === k);
    const im = new THREE.InstancedMesh(g, tuftMat, list.length);
    list.forEach((p, i) => {
      dummy.position.set(p[0], p[1] - 0.01, p[2]); dummy.rotation.set((rnd() - 0.5) * 0.4, rnd() * 6.28, (rnd() - 0.5) * 0.4);
      const s = 0.06 + rnd() * 0.05; dummy.scale.set(s, s * (0.8 + rnd() * 0.6), s); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
    });
    im.receiveShadow = true;
    group.add(im);
  });
  // leaf litter on the dirt
  const leafMat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8 });
  const leaves = new THREE.InstancedMesh(leafGeometry(), leafMat, 260);
  const browns = ['#5a3d22', '#7a5a2e', '#43301c', '#8a6a38', '#3b4a22', '#6b4a26'].map((c) => new THREE.Color(c));
  const { A, B, C } = ex.footprint;
  let n = 0;
  for (let tries = 0; tries < 2000 && n < 260; tries++) {
    const x = (rnd() * 2 - 1) * (A - 0.3), z = (rnd() * 2 - 1) * (B - 0.3);
    if (Math.abs(x) + Math.abs(z) > A + B - C - 0.4) continue;
    const y = heightAt(x, z);
    dummy.position.set(x, y + 0.025, z);
    dummy.rotation.set((rnd() - 0.5) * 0.4, rnd() * 6.28, (rnd() - 0.5) * 0.4);
    const s = 0.18 + rnd() * 0.22; dummy.scale.set(s, s, s); dummy.updateMatrix();
    leaves.setMatrixAt(n, dummy.matrix); leaves.setColorAt(n, browns[Math.floor(rnd() * browns.length)]);
    n++;
  }
  leaves.count = n;
  leaves.receiveShadow = true;
  group.add(leaves);
  return group;
}
