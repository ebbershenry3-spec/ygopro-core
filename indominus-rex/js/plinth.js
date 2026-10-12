// Tiered collector-statue plinth: glossy black tiers, blue trim bands, a carved fossil relief band
// and an engraved name plate. Built at full creature scale (metres); the statue group is scaled 1/15.
import * as THREE from 'three';
import { seededRandom } from './util.js';

// chamfered rectangle, offset outward by e
export function octagon(A, B, C, e = 0) {
  const base = [[A - C, B], [A, B - C], [A, -(B - C)], [A - C, -B], [-(A - C), -B], [-A, -(B - C)], [-A, B - C], [-(A - C), B]];
  const n = base.length;
  const normals = [];
  for (let i = 0; i < n; i++) {
    const [x0, z0] = base[i], [x1, z1] = base[(i + 1) % n];
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz);
    let nx = dz / l, nz = -dx / l;
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
    normals.push([nx, nz]);
  }
  return base.map((v, i) => {
    const a = normals[(i - 1 + n) % n], b = normals[i];
    const d = 1 + a[0] * b[0] + a[1] * b[1];
    return [v[0] + e * (a[0] + b[0]) / d, v[1] + e * (a[1] + b[1]) / d];
  });
}

function prism(poly, y0, y1, { cap = true, bottom = false, uScale = 1, vScale = 1, bevel = 0 } = {}) {
  const pos = [], nor = [], uv = [], idx = [];
  const n = poly.length;
  let u = 0;
  for (let i = 0; i < n; i++) {
    const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % n];
    const l = Math.hypot(x1 - x0, z1 - z0);
    let nx = (z1 - z0) / l, nz = -(x1 - x0) / l;
    if (nx * (x0 + x1) + nz * (z0 + z1) < 0) { nx = -nx; nz = -nz; }
    const b = pos.length / 3;
    const yt = y1 - bevel;
    pos.push(x0, y0, z0, x1, y0, z1, x1, yt, z1, x0, yt, z0);
    for (let k = 0; k < 4; k++) nor.push(nx, 0, nz);
    uv.push(u * uScale, y0 * vScale, (u + l) * uScale, y0 * vScale, (u + l) * uScale, yt * vScale, u * uScale, yt * vScale);
    idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    if (bevel > 0) {
      // 45 degree chamfer strip at the top edge catches a crisp highlight
      const c = pos.length / 3;
      const ix = -nx * bevel, iz = -nz * bevel;
      const bn = new THREE.Vector3(nx, 1, nz).normalize();
      pos.push(x0, yt, z0, x1, yt, z1, x1 + ix, y1, z1 + iz, x0 + ix, y1, z0 + iz);
      for (let k = 0; k < 4; k++) nor.push(bn.x, bn.y, bn.z);
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      idx.push(c, c + 2, c + 1, c, c + 3, c + 2);
    }
    u += l;
  }
  const capPoly = bevel > 0 ? polyInset(poly, bevel) : poly;
  const fan = (y, up) => {
    const c = pos.length / 3;
    pos.push(0, y, 0); nor.push(0, up ? 1 : -1, 0); uv.push(0.5, 0.5);
    for (const [x, z] of capPoly) { pos.push(x, y, z); nor.push(0, up ? 1 : -1, 0); uv.push(x * 0.05, z * 0.05); }
    for (let i = 0; i < n; i++) {
      const a = c + 1 + i, b2 = c + 1 + ((i + 1) % n);
      if (up) idx.push(c, b2, a); else idx.push(c, a, b2);
    }
  };
  if (cap) fan(y1, true);
  if (bottom) fan(y0, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  // make winding consistent with normals
  const p = g.attributes.position, nn = g.attributes.normal, ii = g.index.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), fn = new THREE.Vector3(), vn = new THREE.Vector3();
  for (let t = 0; t < ii.length; t += 3) {
    a.fromBufferAttribute(p, ii[t]); b.fromBufferAttribute(p, ii[t + 1]); c.fromBufferAttribute(p, ii[t + 2]);
    fn.subVectors(b, a).cross(c.clone().sub(a));
    vn.fromBufferAttribute(nn, ii[t]);
    if (fn.dot(vn) < 0) { const tmp = ii[t + 1]; ii[t + 1] = ii[t + 2]; ii[t + 2] = tmp; }
  }
  return g;
}

function polyInset(poly, d) {
  const cx = 0, cz = 0;
  return poly.map(([x, z]) => {
    const l = Math.hypot(x - cx, z - cz);
    return [x - (x / l) * d * 1.2, z - (z / l) * d * 1.2];
  });
}

// ---------- carved fossil relief (height field drawn on a canvas)
function reliefTextures(seed = 3) {
  const W = 1024, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const rnd = seededRandom(seed);
  // stone base
  g.fillStyle = '#7a7a7a'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * W, y = rnd() * H, r = 2 + rnd() * 14;
    const v = 100 + rnd() * 70;
    g.fillStyle = `rgba(${v},${v},${v},0.35)`;
    g.beginPath(); g.ellipse(x, y, r * (1 + rnd()), r, rnd() * 3, 0, Math.PI * 2); g.fill();
  }
  // sediment strata
  for (let k = 0; k < 7; k++) {
    const y0 = 20 + k * 34 + rnd() * 10;
    g.strokeStyle = `rgba(40,40,40,${0.35 + rnd() * 0.3})`; g.lineWidth = 2 + rnd() * 3;
    g.beginPath();
    for (let x = 0; x <= W; x += 16) g.lineTo(x, y0 + Math.sin(x * 0.012 + k) * 5 + Math.sin(x * 0.05 + k * 3) * 2);
    g.stroke();
  }
  const ammonite = (x, y, r) => {
    for (let t = 0; t < 4 * Math.PI; t += 0.05) {
      const rr = r * Math.exp(-0.18 * (4 * Math.PI - t));
      const px = x + Math.cos(t) * rr, py = y + Math.sin(t) * rr;
      const rib = (Math.floor(t / 0.22) % 2) ? 205 : 170;
      g.fillStyle = `rgb(${rib},${rib},${rib})`;
      g.beginPath(); g.arc(px, py, Math.max(1.5, rr * 0.28), 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = 'rgba(30,30,30,0.8)'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, r * 1.1, 0, Math.PI * 2); g.stroke();
  };
  const fern = (x, y, len, ang) => {
    g.save(); g.translate(x, y); g.rotate(ang);
    g.strokeStyle = 'rgb(45,45,45)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(len * 0.5, -len * 0.08, len, 0); g.stroke();
    for (let i = 1; i < 16; i++) {
      const t = i / 16, px = len * t, py = -Math.sin(t * Math.PI) * len * 0.04, l = (1 - t) * len * 0.22 + 4;
      g.fillStyle = 'rgb(55,55,55)';
      for (const s of [1, -1]) { g.beginPath(); g.ellipse(px + l * 0.3, py + s * l * 0.5, l * 0.55, 3.2, s * 0.9, 0, Math.PI * 2); g.fill(); }
    }
    g.restore();
  };
  const bone = (x, y, len, ang) => {
    g.save(); g.translate(x, y); g.rotate(ang);
    g.fillStyle = 'rgb(215,215,215)';
    g.fillRect(0, -5, len, 10);
    for (const ex of [0, len]) { g.beginPath(); g.arc(ex, -7, 9, 0, Math.PI * 2); g.arc(ex, 7, 9, 0, Math.PI * 2); g.fill(); }
    g.restore();
  };
  const vertebrae = (x, y, n, ang) => {
    g.save(); g.translate(x, y); g.rotate(ang);
    for (let i = 0; i < n; i++) { g.fillStyle = 'rgb(210,210,210)'; g.beginPath(); g.ellipse(i * 22, 0, 9, 13 - i * 0.4, 0, 0, Math.PI * 2); g.fill(); g.fillRect(i * 22 - 3, -26 + i * 0.6, 6, 18); }
    g.restore();
  };
  for (let i = 0; i < 6; i++) ammonite(70 + i * 170 + rnd() * 60, 70 + rnd() * 120, 22 + rnd() * 26);
  for (let i = 0; i < 6; i++) fern(rnd() * W, 40 + rnd() * 180, 110 + rnd() * 90, -0.6 + rnd() * 1.2);
  for (let i = 0; i < 4; i++) bone(rnd() * W, 40 + rnd() * 170, 60 + rnd() * 80, rnd() * 3);
  for (let i = 0; i < 2; i++) vertebrae(rnd() * W * 0.8, 60 + rnd() * 130, 8, -0.3 + rnd() * 0.6);
  // moulded rims at top and bottom of the band
  const grd = g.createLinearGradient(0, 0, 0, 18); grd.addColorStop(0, '#d8d8d8'); grd.addColorStop(1, '#6a6a6a');
  g.fillStyle = grd; g.fillRect(0, 0, W, 14);
  const grd2 = g.createLinearGradient(0, H - 18, 0, H); grd2.addColorStop(0, '#6a6a6a'); grd2.addColorStop(1, '#d0d0d0');
  g.fillStyle = grd2; g.fillRect(0, H - 14, W, 14);
  // blur a touch so the normals are smooth
  const blurC = document.createElement('canvas'); blurC.width = W; blurC.height = H;
  const bg = blurC.getContext('2d'); bg.filter = 'blur(1.5px)'; bg.drawImage(c, 0, 0);
  const hd = bg.getImageData(0, 0, W, H).data;
  const Hf = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) Hf[i] = hd[i * 4] / 255;
  // normal + albedo
  const nC = document.createElement('canvas'); nC.width = W; nC.height = H;
  const aC = document.createElement('canvas'); aC.width = W; aC.height = H;
  const nI = nC.getContext('2d').createImageData(W, H), aI = aC.getContext('2d').createImageData(W, H);
  const strength = 5;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const l = Hf[y * W + ((x - 1 + W) % W)], r = Hf[y * W + ((x + 1) % W)];
    const u = Hf[Math.max(0, y - 1) * W + x], d = Hf[Math.min(H - 1, y + 1) * W + x];
    let nx = (l - r) * strength, ny = (d - u) * strength, nz = 1;
    const len = Math.hypot(nx, ny, nz);
    nI.data[i * 4] = (nx / len * 0.5 + 0.5) * 255; nI.data[i * 4 + 1] = (ny / len * 0.5 + 0.5) * 255; nI.data[i * 4 + 2] = (nz / len * 0.5 + 0.5) * 255; nI.data[i * 4 + 3] = 255;
    const h = Hf[i];
    // dry-brushed sandstone: dark recesses, warm raised detail
    const k = Math.pow(h, 1.4);
    aI.data[i * 4] = 40 + k * 150; aI.data[i * 4 + 1] = 32 + k * 120; aI.data[i * 4 + 2] = 24 + k * 88; aI.data[i * 4 + 3] = 255;
  }
  nC.getContext('2d').putImageData(nI, 0, 0); aC.getContext('2d').putImageData(aI, 0, 0);
  const normal = new THREE.CanvasTexture(nC), albedo = new THREE.CanvasTexture(aC);
  albedo.colorSpace = THREE.SRGBColorSpace;
  for (const t of [normal, albedo]) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 8; }
  return { normal, albedo };
}

function plaqueTexture(title, sub) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#c9cdd2'); grd.addColorStop(0.45, '#8d939a'); grd.addColorStop(0.55, '#a7adb4'); grd.addColorStop(1, '#5f656c');
  g.fillStyle = grd; g.fillRect(0, 0, 1024, 256);
  for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.06})`; g.fillRect(0, Math.random() * 256, 1024, 1); }
  g.strokeStyle = '#30353b'; g.lineWidth = 8; g.strokeRect(14, 14, 996, 228);
  g.fillStyle = '#1d2126';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '700 112px "Big Shoulders Display", "Arial Narrow", sans-serif';
  if ('letterSpacing' in g) g.letterSpacing = '10px';
  g.fillText(title, 512, 112);
  g.font = '600 40px "IBM Plex Mono", monospace';
  if ('letterSpacing' in g) g.letterSpacing = '8px';
  g.fillText(sub, 512, 196);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export function buildPlinth({ A, B, C }) {
  const group = new THREE.Group();
  group.name = 'plinth';
  const black = new THREE.MeshPhysicalMaterial({ color: '#0c0d10', roughness: 0.32, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.12 });
  const blue = new THREE.MeshPhysicalMaterial({ color: '#1f53c4', roughness: 0.22, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.06 });
  const rel = reliefTextures();
  const reliefMat = new THREE.MeshStandardMaterial({ map: rel.albedo, normalMap: rel.normal, normalScale: new THREE.Vector2(1.6, -1.6), roughness: 0.9, metalness: 0 });
  const tiers = [
    // [offset, y0, y1, material, bevel, uvScale]
    [0.1, -0.16, 0.0, black, 0.04],
    [0.12, -0.26, -0.16, blue, 0],
    [0.3, -1.12, -0.26, reliefMat, 0, true],
    [0.36, -1.2, -1.12, black, 0.03],
    [0.62, -1.3, -1.2, blue, 0],
    [0.66, -1.78, -1.3, black, 0.05],
    [0.78, -1.9, -1.78, black, 0.04],
  ];
  for (const [e, y0, y1, mat, bevel, relief] of tiers) {
    const poly = octagon(A, B, C, e);
    // relief texture: 1 tile = 4 m of perimeter; v spans the band height
    const g = prism(poly, y0, y1, relief ? { uScale: 0.25, vScale: 1 / (y1 - y0), bevel } : { bevel });
    if (relief) {
      const v = g.attributes.uv;
      for (let i = 0; i < v.count; i++) if (g.attributes.normal.getY(i) === 0) v.setY(i, (g.attributes.position.getY(i) - y0) / (y1 - y0));
    }
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }
  // engraved plaque on the front of the lower black tier
  const plaque = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.62, 0.05), [
    new THREE.MeshStandardMaterial({ color: '#555b62', metalness: 0.9, roughness: 0.35 }),
    new THREE.MeshStandardMaterial({ color: '#555b62', metalness: 0.9, roughness: 0.35 }),
    new THREE.MeshStandardMaterial({ color: '#555b62', metalness: 0.9, roughness: 0.35 }),
    new THREE.MeshStandardMaterial({ color: '#555b62', metalness: 0.9, roughness: 0.35 }),
    new THREE.MeshStandardMaterial({ map: plaqueTexture('INDOMINUS REX', 'MASSSTAB 1:15'), metalness: 0.85, roughness: 0.38 }),
    new THREE.MeshStandardMaterial({ color: '#555b62', metalness: 0.9, roughness: 0.35 }),
  ]);
  plaque.position.set(0, -1.54, B + 0.66 + 0.025);
  plaque.castShadow = true;
  group.add(plaque);
  group.userData.bottom = -1.9;
  return group;
}
