// Collector-statue viewer: the user's Indominus rex GLB posed on a sculpted diorama (1:15 scale).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadIndominus, setupFingerAxes } from './indominus.js';
import { Rig } from './rig.js';
import { buildPlinth } from './plinth.js';
import { buildVegetation, fernGeometry, leafGeometry, plantMaterial } from './plants.js';
import { addScaleRelief } from './sculpted.js';
import { scaleTextures } from './textures.js';
import { DEG, lerp, smoother, clamp, seededRandom } from './util.js';
import { POSES } from './poses.js';

const SCALE = 1 / 15;
const $ = (id) => document.getElementById(id);

export async function start({ onProgress } = {}) {
  const canvas = $('stage');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.minDistance = 0.45;
  controls.maxDistance = 2.4;
  controls.maxPolarAngle = 88 * DEG;
  controls.target.set(0, 0.22, 0);
  controls.autoRotateSpeed = 0.6;

  // ---------------- studio: curved backdrop, display table, lights
  const studio = buildStudio(scene);

  // ---------------- assets
  const progress = { indo: 0, dio: 0 };
  const report = () => onProgress && onProgress((progress.indo * 11.2 + progress.dio * 7.2) / 18.4);
  const [indo, dio] = await Promise.all([
    loadIndominus('assets/indominus_rex.glb', (e) => { if (e.total) progress.indo = e.loaded / e.total; report(); }),
    new GLTFLoader().loadAsync('assets/diorama.glb', (e) => { if (e.total) progress.dio = e.loaded / e.total; report(); }),
  ]);
  const ex = dio.parser.json.asset.extras;

  const statue = new THREE.Group();
  statue.name = 'statue';
  scene.add(statue);

  // diorama materials
  const grain = scaleTextures(31, 256, 24).height;
  dio.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    const name = o.material.name;
    let m;
    if (name === 'moss') {
      m = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.95, sheen: 1, sheenRoughness: 0.55, sheenColor: new THREE.Color('#a8bf4a') });
      addScaleRelief(m, { tex: grain, scale: 14, bump: 1.4, tint: 0.45 });
    } else if (name === 'anky') {
      m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, color: new THREE.Color(0.62, 0.58, 0.52) });
      addScaleRelief(m, { tex: scaleTextures(17, 256, 12).height, scale: 2.2, bump: 0.7, tint: 0.3 });
    } else if (name === 'rock') {
      m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, color: new THREE.Color(0.55, 0.55, 0.53) });
      addScaleRelief(m, { tex: grain, scale: 3, bump: 0.6, tint: 0.25 });
    } else {
      m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96 });
      addScaleRelief(m, { tex: grain, scale: 6, bump: 0.9, tint: 0.35 });
    }
    m.name = name;
    o.material = m;
  });
  statue.add(dio.scene);

  // terrain height lookup baked by the sculptor
  const hs = ex.heightSamples;
  const heightAt = (x, z) => {
    const fx = clamp((x - hs.x0) / hs.step, 0, hs.nx - 1.001), fz = clamp((z - hs.z0) / hs.step, 0, hs.nz - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const H = (a, b) => hs.h[a * hs.nz + b];
    return lerp(lerp(H(i, j), H(i, j + 1), v), lerp(H(i + 1, j), H(i + 1, j + 1), v), u);
  };

  statue.add(buildVegetation(ex, heightAt));
  statue.add(buildPlinth(ex.footprint));

  // ---------------- the Indominus
  const root = new THREE.Group();
  root.name = 'indominus';
  root.add(indo.model);
  const rig = new Rig(root, indo.map);           // captured while root sits at the origin
  setupFingerAxes(rig);
  indo.model.traverse((o) => {
    if (o.isMesh) {
      // painted-resin finish: satin, slightly cooler
      o.material.roughness = 0.82;
      o.material.color = new THREE.Color(1.0, 1.02, 1.06);
      o.material.envMapIntensity = 0.8;
    }
  });
  statue.add(root);

  // world-space contact points (full-scale metres)
  const footSpot = new THREE.Vector3(...ex.footSpot);
  const handSpot = new THREE.Vector3(...ex.handSpot);

  // creature-space (x, z) -> world for a root at (S.x, S.z) with heading S.yaw
  const toWorld = (S, x, z) => new THREE.Vector3(S.x + x * Math.cos(S.yaw) + z * Math.sin(S.yaw), 0, S.z - x * Math.sin(S.yaw) + z * Math.cos(S.yaw));
  function footTarget(leg, F, S) {
    if (F.mix) {
      // blending between two foot placements: interpolate and lift in an arc when changing support
      const [fa, fb, t] = F.mix;
      const a = footTarget(leg, fa, S), b = footTarget(leg, fb, S);
      const p = a.p.clone().lerp(b.p, t);
      if (fa.spot !== fb.spot || a.p.distanceTo(b.p) > 0.4) p.y += Math.sin(Math.PI * t) * 0.6;
      return { p, yaw: lerp(a.yaw, b.yaw, t), lift: lerp(a.lift, b.lift, t), curl: lerp(a.curl, b.curl, t) + Math.sin(Math.PI * t) * 0.4 };
    }
    let p;
    if (F.spot === 'anky') p = footSpot.clone().add(new THREE.Vector3(F.dx || 0, (F.dy || 0) + leg.ballHeight * 0.85, F.dz || 0));
    else {
      p = toWorld(S, F.local[0], F.local[1]);
      p.y = heightAt(p.x, p.z) + leg.ballHeight;
    }
    return { p, yaw: S.yaw + (F.yaw || 0), lift: F.lift || 0, curl: F.curl || 0 };
  }

  function poseStatue(S) {
    // pose at unit scale (the rig works in metres), then restore the 1:15 display transform
    const sPos = statue.position.clone(), sRot = statue.rotation.y, sScale = statue.scale.x;
    statue.position.set(0, 0, 0); statue.rotation.y = 0; statue.scale.setScalar(1);
    statue.updateMatrixWorld(true);
    root.position.set(S.x, S.y, S.z);
    root.rotation.set(0, S.yaw, 0);
    root.updateMatrixWorld(true);
    rig.reset();
    rig.pose(S.P, { tail: S.tail.map(([yaw, pitch]) => ({ yaw, pitch })) });
    const legs = rig.map.legs; // [left, right]
    for (const [leg, F] of [[legs[0], S.footL], [legs[1], S.footR]]) {
      const t = footTarget(leg, F, S);
      rig.solveLeg(leg, t.p, t.yaw, t.lift, t.curl);
    }
    statue.position.copy(sPos); statue.rotation.y = sRot; statue.scale.setScalar(sScale);
    statue.updateMatrixWorld(true);
  }

  statue.scale.setScalar(SCALE);
  statue.position.y = 1.9 * SCALE;

  // ---------------- pose blending
  const flat = (p) => {
    // place the root so the right foot's creature-space anchor lands on the carcass
    const [ax, az] = p.anchorR, yaw = p.root.yaw;
    const x = footSpot.x - (ax * Math.cos(yaw) + az * Math.sin(yaw));
    const z = footSpot.z - (-ax * Math.sin(yaw) + az * Math.cos(yaw));
    return { x, y: p.root.y ?? 0.3, z, yaw, P: { ...p.P }, tail: p.tail.map((t) => t.slice()), footL: { ...p.footL }, footR: { ...p.footR } };
  };
  let current = flat(POSES.triumph), from = current, to = current, blendT = 1;
  const mixState = (a, b, t) => {
    const keys = new Set([...Object.keys(a.P), ...Object.keys(b.P)]);
    const P = {};
    for (const k of keys) P[k] = lerp(a.P[k] || 0, b.P[k] || 0, t);
    const base = (f) => (f.mix ? (f.mix[2] < 0.5 ? f.mix[0] : f.mix[1]) : f);
    const mixFoot = (fa, fb) => ({ mix: [base(fa), base(fb), t] });
    return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t), yaw: lerp(a.yaw, b.yaw, t), P,
      tail: a.tail.map((ta, i) => [lerp(ta[0], b.tail[i][0], t), lerp(ta[1], b.tail[i][1], t)]),
      footL: mixFoot(a.footL, b.footL), footR: mixFoot(a.footR, b.footR) };
  };
  function setPose(name, instant = false) {
    from = current; to = flat(POSES[name]); blendT = 0;
    if (instant) { blendT = 1; current = to; poseStatue(current); if (rulers.visible) buildRulers(); else measure(); }
  }
  poseStatue(current);

  // ---------------- measurement overlay (display units: 1 unit = 1 m at 1:15 -> shown in cm)
  const rulers = new THREE.Group();
  scene.add(rulers);
  function measure() {
    const box = new THREE.Box3().setFromObject(statue, true);
    const f = (v) => (v * 100).toFixed(1).replace('.', ',');
    $('dims').textContent = `${f(box.max.x - box.min.x)} × ${f(box.max.z - box.min.z)} × ${f(box.max.y - box.min.y)} cm (B × T × H)`;
    return box;
  }
  function buildRulers() {
    rulers.clear();
    const box = measure();
    const w = box.max.x - box.min.x, h = box.max.y - box.min.y;
    const z = box.max.z + 0.04;
    const mat = new THREE.LineBasicMaterial({ color: '#e9edf5', transparent: true, opacity: 0.85 });
    const pts = [];
    const tick = (a, b) => pts.push(a, b);
    // width ruler on the table in front of the plinth
    const y0 = 0.002;
    tick(new THREE.Vector3(box.min.x, y0, z), new THREE.Vector3(box.max.x, y0, z));
    for (let x = 0, i = 0; x <= w + 1e-6; x += 0.01, i++) {
      const L = i % 10 === 0 ? 0.03 : i % 5 === 0 ? 0.02 : 0.01;
      tick(new THREE.Vector3(box.min.x + x, y0, z), new THREE.Vector3(box.min.x + x, y0, z + L));
    }
    // height ruler at the right
    const x1 = box.max.x + 0.04;
    tick(new THREE.Vector3(x1, 0, z), new THREE.Vector3(x1, h, z));
    for (let y = 0, i = 0; y <= h + 1e-6; y += 0.01, i++) {
      const L = i % 10 === 0 ? 0.02 : i % 5 === 0 ? 0.013 : 0.007;
      tick(new THREE.Vector3(x1, y, z), new THREE.Vector3(x1 - L, y, z));
    }
    rulers.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), mat));
    rulers.add(label(`${(w * 100).toFixed(1).replace('.', ',')} cm`, new THREE.Vector3((box.min.x + box.max.x) / 2, y0 + 0.02, z + 0.11)));
    rulers.add(label(`${(h * 100).toFixed(1).replace('.', ',')} cm`, new THREE.Vector3(x1 + 0.02, h + 0.04, z)));
  }
  function label(text, pos) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128;
    const g = c.getContext('2d');
    g.font = '600 76px "IBM Plex Mono", monospace'; g.fillStyle = '#eef2f8'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 256, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
    s.scale.set(0.16, 0.04, 1); s.position.copy(pos); s.renderOrder = 10;
    return s;
  }
  buildRulers();
  rulers.visible = false;

  // ---------------- camera presets
  const VIEWS = {
    front: { pos: [-0.66, 0.5, 1.85], target: [0.04, 0.22, 0] },
    side: { pos: [0.05, 0.32, 1.95], target: [0.02, 0.2, 0] },
    head: { pos: [0.85, 0.48, 0.85], target: [0.3, 0.36, 0.08] },
    back: { pos: [0.9, 0.55, -1.25], target: [0, 0.2, 0] },
  };
  let camAnim = null, viewName = 'front';
  // narrow (portrait) screens: back the camera off so the whole statue stays in frame
  const fit = () => { const a = camera.aspect || 1; return a >= 1.45 ? 1 : Math.pow(1.45 / a, 0.75); };
  function viewPose(name) {
    const v = VIEWS[name], k = fit();
    const t = new THREE.Vector3(...v.target);
    if (camera.aspect < 1) t.y -= 0.03;
    const p = new THREE.Vector3(...v.pos).sub(new THREE.Vector3(...v.target)).multiplyScalar(k).add(t);
    return { p, t };
  }
  function goView(name, instant = false) {
    viewName = name;
    const { p, t } = viewPose(name);
    controls.maxDistance = 2.4 * fit();
    if (instant) { camera.position.copy(p); controls.target.copy(t); controls.update(); return; }
    camAnim = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), p1: p, t1: t };
  }

  // ---------------- resize & loop
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 1 ? 36 : 30;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', () => { resize(); goView(viewName, true); });
  resize();
  goView('front', true);

  const clock = new THREE.Clock();
  let rulersDirty = false;
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (blendT < 1) {
      blendT = Math.min(1, blendT + dt / 1.6);
      current = mixState(from, to, smoother(blendT));
      if (blendT >= 1) current = to;
      poseStatue(current);
      if (blendT >= 1) rulersDirty = true;
    }
    if (rulersDirty) { if (rulers.visible) buildRulers(); else measure(); rulersDirty = false; }
    if (camAnim) {
      camAnim.t = Math.min(1, camAnim.t + dt / 1.2);
      const k = smoother(camAnim.t);
      camera.position.lerpVectors(camAnim.p0, camAnim.p1, k);
      controls.target.lerpVectors(camAnim.t0, camAnim.t1, k);
      if (camAnim.t >= 1) camAnim = null;
    }
    studio.update(dt);
    controls.update();
    renderer.render(scene, camera);
  }
  renderer.setAnimationLoop(frame);

  return {
    setPose, goView,
    setTurntable: (on) => { controls.autoRotate = on; },
    setRulers: (on) => { rulers.visible = on; if (on) { buildRulers(); } },
    setLight: (name) => studio.setLight(name),
    poseNames: Object.keys(POSES).map((k) => [k, POSES[k].label]),
    // test hooks
    _debug: { scene, camera, renderer, rig, statue, root, poseStatue, POSES, flat, controls, frame },
  };
}

// ------------------------------------------------------------------ studio set
function buildStudio(scene) {
  const g = new THREE.Group();
  scene.add(g);
  // curved backdrop with a soft spotlight pool
  const backMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { cTop: { value: new THREE.Color('#04070d') }, cMid: { value: new THREE.Color('#132545') }, cGlow: { value: new THREE.Color('#2a4c86') } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP; uniform vec3 cTop, cMid, cGlow;
      void main(){
        float h = clamp(vP.y / 3.0, 0.0, 1.0);
        vec3 c = mix(cMid, cTop, smoothstep(0.05, 0.85, h));
        c *= smoothstep(-0.02, 0.22, h) * 0.85 + 0.15;   // melt into the dark table at the horizon
        float ang = atan(vP.x, -vP.z);
        float pool = exp(-pow(ang / 0.9, 2.0)) * exp(-pow((vP.y - 0.55) / 0.9, 2.0));
        c += cGlow * pool * 0.55;
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const back = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 3.2, 64, 1, true), backMat);
  back.position.y = 1.5;
  g.add(back);
  // display table: dark, with a soft radial falloff so the key light does not paint a hard pool
  const fc = document.createElement('canvas'); fc.width = fc.height = 256;
  const fg = fc.getContext('2d');
  const rg = fg.createRadialGradient(128, 128, 10, 128, 128, 128);
  rg.addColorStop(0, '#2a2c31'); rg.addColorStop(0.35, '#121418'); rg.addColorStop(1, '#000000');
  fg.fillStyle = rg; fg.fillRect(0, 0, 256, 256);
  const floorTex = new THREE.CanvasTexture(fc); floorTex.colorSpace = THREE.SRGBColorSpace;
  // unlit table top (rim lights would otherwise paint bright pools) + a shadow catcher for the contact shadow
  const floor = new THREE.Mesh(new THREE.CircleGeometry(3.6, 64), new THREE.MeshBasicMaterial({ map: floorTex, color: '#8a92a6' }));
  floor.rotation.x = -Math.PI / 2;
  g.add(floor);
  const catcher = new THREE.Mesh(new THREE.CircleGeometry(1.6, 48), new THREE.ShadowMaterial({ opacity: 0.55 }));
  catcher.rotation.x = -Math.PI / 2;
  catcher.position.y = 0.0005;
  catcher.receiveShadow = true;
  g.add(catcher);

  // lights
  const hemi = new THREE.HemisphereLight('#4a6aa8', '#1a140e', 0.55);
  g.add(hemi);
  const key = new THREE.SpotLight('#f1f4ff', 34, 8, 17 * DEG, 0.85, 1.6);
  key.position.set(-1.35, 1.75, 1.45);
  key.target.position.set(0.05, 0.2, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.004;
  key.shadow.camera.near = 0.8; key.shadow.camera.far = 5;
  key.shadow.radius = 4;
  g.add(key, key.target);
  const rim = new THREE.SpotLight('#5b8dff', 26, 8, 28 * DEG, 0.6, 1.6);
  rim.position.set(1.5, 1.2, -1.5);
  rim.target.position.set(0, 0.25, 0);
  g.add(rim, rim.target);
  const top = new THREE.SpotLight('#dfe8ff', 14, 6, 34 * DEG, 0.8, 1.5);
  top.position.set(0.3, 2.2, 0.2);
  top.target.position.set(0.1, 0.2, 0);
  g.add(top, top.target);
  const fill = new THREE.PointLight('#ffd9b0', 0.6, 4, 1.8);
  fill.position.set(1.2, 0.5, 1.4);
  g.add(fill);

  // background dressing: hanging vines with leaves and floor ferns, kept beyond the orbit radius
  const rnd = seededRandom(5);
  const vineMat = new THREE.MeshStandardMaterial({ color: '#2b3a1e', roughness: 0.8 });
  const leafMat = plantMaterial({ color: '#2f5a22', roughness: 0.6 });
  const leafGeo = leafGeometry();
  const leafCount = 900;
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, leafCount);
  let li = 0;
  const dummy = new THREE.Object3D();
  const vineAngles = [-155, -128, -40, -15, 25, 150, 172];
  for (const a of vineAngles) {
    const ang = a * DEG, R = 2.9 + rnd() * 0.3;
    for (let k = 0; k < 3; k++) {
      const x0 = Math.sin(ang) * R + (rnd() - 0.5) * 0.5, z0 = -Math.cos(ang) * R + (rnd() - 0.5) * 0.5;
      const len = 0.8 + rnd() * 1.1;
      const pts = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        pts.push(new THREE.Vector3(x0 + Math.sin(t * 3 + k) * 0.08, 3.0 - t * len, z0 + Math.cos(t * 2.3 + k) * 0.08));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.008, 5), vineMat));
      for (let i = 0; i < 40 && li < leafCount; i++) {
        const p = curve.getPoint(rnd());
        dummy.position.copy(p);
        dummy.rotation.set(rnd() * 1.2 - 0.6, rnd() * 6.28, -0.8 - rnd() * 0.6);
        dummy.scale.setScalar(0.05 + rnd() * 0.05);
        dummy.updateMatrix(); leaves.setMatrixAt(li++, dummy.matrix);
      }
    }
  }
  leaves.count = li;
  g.add(leaves);
  const fernMat = plantMaterial({ roughness: 0.7, color: '#4a5a52' });
  const fernGeo = fernGeometry(21, 1);
  const ferns = new THREE.InstancedMesh(fernGeo, fernMat, 9);
  [-150, -120, -60, -30, 35, 70, 120, 160, 185].forEach((a, i) => {
    const R = 3.0 + rnd() * 0.3;
    dummy.position.set(Math.sin(a * DEG) * R, 0, -Math.cos(a * DEG) * R);
    dummy.rotation.set(0, rnd() * 6.28, 0);
    dummy.scale.setScalar(0.32 + rnd() * 0.22);
    dummy.updateMatrix(); ferns.setMatrixAt(i, dummy.matrix);
  });
  g.add(ferns);

  const LIGHTS = {
    blau: { key: '#f1f4ff', keyI: 34, rim: '#5b8dff', rimI: 26, hemi: ['#4a6aa8', '#1a140e', 0.55], glow: '#2a4c86', mid: '#132545', fill: 0.6, exposure: 1.05 },
    galerie: { key: '#fff1de', keyI: 38, rim: '#ffd2a1', rimI: 14, hemi: ['#8a8070', '#2a2018', 0.6], glow: '#4a3f33', mid: '#1c1915', fill: 0.9, exposure: 1.0 },
    nacht: { key: '#b8c8ff', keyI: 18, rim: '#3b6cff', rimI: 40, hemi: ['#1c2c55', '#0a0806', 0.35], glow: '#1d3566', mid: '#0b1528', fill: 0.15, exposure: 1.1 },
  };
  return {
    update() {},
    setLight(name) {
      const L = LIGHTS[name];
      key.color.set(L.key); key.intensity = L.keyI;
      rim.color.set(L.rim); rim.intensity = L.rimI;
      hemi.color.set(L.hemi[0]); hemi.groundColor.set(L.hemi[1]); hemi.intensity = L.hemi[2];
      backMat.uniforms.cGlow.value.set(L.glow); backMat.uniforms.cMid.value.set(L.mid);
      fill.intensity = L.fill;
    },
  };
}
