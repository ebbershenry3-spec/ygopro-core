// Loader for the SDF-sculpted creatures (rexy.glb, blue.glb, mosasaurus.glb) built by tools/build_creatures.py.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { scaleTextures, eyeTexture } from './textures.js';

// Triplanar scale relief driven by the bind-pose position, so the scales stick to the skin while it deforms.
export function addScaleRelief(material, { tex, scale = 2, bump = 1.0, tint = 0.35 }) {
  material.onBeforeCompile = (sh) => {
    sh.uniforms.scaleTex = { value: tex };
    sh.uniforms.uScale = { value: scale };
    sh.uniforms.uBump = { value: bump };
    sh.uniforms.uTint = { value: tint };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRestPos;\nvarying vec3 vRestNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRestPos = position;\nvRestNormal = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vRestPos;
varying vec3 vRestNormal;
uniform sampler2D scaleTex;
uniform float uScale;
uniform float uBump;
uniform float uTint;
vec3 perturbNormalScales( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir ) {
  vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
  vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
  vec3 R1 = cross( vSigmaY, surf_norm );
  vec3 R2 = cross( surf_norm, vSigmaX );
  float fDet = dot( vSigmaX, R1 ) * faceDir;
  vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
  return normalize( abs( fDet ) * surf_norm - vGrad );
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec3 tpw = pow(abs(normalize(vRestNormal)), vec3(4.0)); tpw /= (tpw.x + tpw.y + tpw.z);
float scaleH = texture2D(scaleTex, vRestPos.zy * uScale).r * tpw.x + texture2D(scaleTex, vRestPos.xz * uScale).r * tpw.y + texture2D(scaleTex, vRestPos.xy * uScale).r * tpw.z;
diffuseColor.rgb *= mix(1.0 - uTint, 1.0 + uTint * 0.4, scaleH);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = perturbNormalScales( -vViewPosition, normal, vec2( dFdx( scaleH ), dFdy( scaleH ) ) * uBump, faceDirection );`);
  };
  material.customProgramCacheKey = () => 'scales';
  return material;
}

export async function loadSculpted(url, { scaleCells = 10, scale = 2, bump = 1, iris = '#c9951c', seed = 7 } = {}) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const ex = gltf.parser.json.asset.extras || {};
  const model = gltf.scene;
  const bones = {};
  const tex = scaleTextures(seed, 256, scaleCells).height;
  model.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
      const m = o.material;
      m.vertexColors = true;
      if (m.name === 'skin') {
        m.roughness = 0.82; m.envMapIntensity = 0.5;
        addScaleRelief(m, { tex, scale, bump });
      }
    }
  });
  const root = new THREE.Group();
  root.add(model);
  root.updateMatrixWorld(true);
  const wp = (b) => b.getWorldPosition(new THREE.Vector3());
  const list = (prefix) => Object.keys(bones).filter((n) => new RegExp('^' + prefix + '\\d+$').test(n)).sort((a, b) => +a.replace(prefix, '') - +b.replace(prefix, '')).map((n) => bones[n]);
  const head = bones.head;
  // eyes & throat backdrop live on the head bone
  if (ex.eyes) {
    const eyeMat = new THREE.MeshStandardMaterial({ map: eyeTexture(iris), roughness: 0.12, emissive: new THREE.Color(iris).multiplyScalar(0.15) });
    const g = new THREE.SphereGeometry(ex.eyeR, 18, 12);
    const hp = wp(head);
    ex.eyes.forEach((e, i) => {
      const m = new THREE.Mesh(g, eyeMat);
      m.position.set(e[0], e[1], e[2]).sub(hp);
      const side = Math.sign(e[0]);
      const dir = new THREE.Vector3(ex.eyeDir[0] * side, ex.eyeDir[1], ex.eyeDir[2]);
      m.lookAt(m.position.clone().add(dir)); m.rotateY(-Math.PI / 2);
      head.add(m);
    });
  }
  if (ex.throat) {
    const t = new THREE.Mesh(new THREE.CircleGeometry(1, 20), new THREE.MeshBasicMaterial({ color: '#160504', side: THREE.DoubleSide }));
    t.scale.set(ex.throat.size[0], ex.throat.size[1], 1);
    t.position.set(...ex.throat.pos).sub(wp(head));
    head.add(t);
  }
  const legs = ['L', 'R'].map((s) => ({ side: s === 'L' ? 1 : -1, hip: bones['hip' + s], knee: bones['knee' + s], ankle: bones['ankle' + s], ball: bones['ball' + s], toes: [], groundY: 0 }));
  const arms = bones.upperL ? ['L', 'R'].map((s) => ({ side: s === 'L' ? 1 : -1, upper: bones['upper' + s], lower: bones['lower' + s], hand: bones['hand' + s], fingers: [] })) : [];
  const neck = list('neck'), tail = list('tail'), spine = list('spine');
  const even = (n, first = 1) => { const w = Array.from({ length: n }, (_, i) => first + i * 0.15); const s = w.reduce((a, b) => a + b, 0); return w.map((x) => x / s); };
  const map = {
    pelvis: bones.pelvis, spine, spineWeights: even(spine.length), neck, neckWeights: even(neck.length, 1.2).reverse(), head, jaw: bones.jaw,
    jawMax: ex.jawMax ?? 0.6,
    snoutOffset: ex.snout ? new THREE.Vector3(...ex.snout).sub(wp(head)) : new THREE.Vector3(0, 0, 1),
    tail, tailWeights: even(tail.length, 0.6), legs: bones.hipL ? legs : [], arms, all: Object.values(bones),
  };
  return { gltf, root, model, map, bones, extras: ex };
}
