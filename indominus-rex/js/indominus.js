// Loads the user's Indominus rex GLB (JWE2 rig) and maps its skeleton to the procedural rig.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export async function loadIndominus(url, onProgress) {
  const gltf = await new GLTFLoader().loadAsync(url, onProgress);
  const model = gltf.scene;
  const bones = {};
  model.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false; // skinned bounds don't follow the procedural pose
      const m = o.material;
      m.side = THREE.FrontSide;
      m.roughness = 1.0;
      m.envMapIntensity = 0.6;
      // the Indominus is pale grey-white in the film; keep the texture but lift it a touch
      m.color = new THREE.Color(1.08, 1.06, 1.03);
      if (m.normalScale) m.normalScale.set(1.25, 1.25);
    }
  });
  const B = (prefix) => {
    const k = Object.keys(bones).find((n) => n.startsWith(prefix));
    if (!k) throw new Error('bone not found: ' + prefix);
    return bones[k];
  };

  const legs = ['l', 'r'].map((s) => {
    const S = s.toUpperCase();
    return {
      side: s === 'l' ? 1 : -1,
      hip: B(`bip_hip_${s}_`), knee: B(`bip_knee_${s}_`), ankle: B(`bip_foot_${s}_`), ball: B(`bip_toe_${s}_`),
      toes: [B(`def_toeIndex1_joint${S}_`), B(`def_toeMid1_joint${S}_`), B(`def_toePinky1_joint${S}_`)],
      groundY: 0,
    };
  });

  const arms = ['l', 'r'].map((s) => {
    const side = s === 'l' ? 1 : -1;
    const chain = (name) => [0, 1, 2, 3].map((i) => Object.keys(bones).find((n) => n.startsWith(`bip_${name}_${i}_${s}_`))).filter(Boolean).map((k) => bones[k]);
    // palms face inwards and slightly back: flex axis = finger direction x palm normal
    const palm = new THREE.Vector3(-side * 0.75, 0.1, -0.65).normalize();
    const fingers = ['index', 'middle', 'pinky', 'thumb'].map((n) => ({ name: n, bones: chain(n) }));
    return { side, collar: B(`bip_collar_${s}_`), upper: B(`bip_upperarm_${s}_`), lower: B(`bip_lowerarm_${s}_`), hand: B(`bip_hand_${s}_`), fingers, palm };
  });

  const map = {
    pelvis: B('bip_pelvis_'),
    spine: [B('bip_spine_0_'), B('bip_spine_1_'), B('bip_spine_2_'), B('bip_spine_3_')],
    spineWeights: [0.2, 0.25, 0.27, 0.28],
    neck: [B('bip_neck_101'), B('bip_neck_1_'), B('bip_neck_2_'), B('bip_neck_3_')],
    neckWeights: [0.3, 0.27, 0.23, 0.2],
    head: B('bip_head_'), jaw: B('bip_jaw_'), tongue: B('bip_tongue_60'),
    jawMax: 0.72,
    snoutOffset: new THREE.Vector3(0, -0.3, 1.8),
    tail: [B('bip_tail_10'), B('bip_tail_1_'), B('bip_tail_2_'), B('bip_tail_3_'), B('bip_tail_4_'), B('bip_tail_5_'), B('bip_tail_6_'), B('bip_tail_7_'), B('bip_tail_8_')],
    tailWeights: [0.06, 0.08, 0.1, 0.11, 0.12, 0.13, 0.13, 0.13, 0.14],
    legs, arms,
    all: Object.values(bones),
  };
  return { gltf, model, map, bones, clip: gltf.animations[0] };
}

// finger flex axes need world-ish directions that only exist after the rig captured its rest pose
export function setupFingerAxes(rig) {
  for (const arm of rig.map.arms) {
    for (const f of arm.fingers) {
      if (f.bones.length < 2) continue;
      const a = f.bones[0].getWorldPosition(new THREE.Vector3());
      const b = f.bones[f.bones.length - 1].getWorldPosition(new THREE.Vector3());
      rig.root.worldToLocal(a); rig.root.worldToLocal(b);
      const d = b.sub(a).normalize();
      f.axis = d.clone().cross(arm.palm).normalize();
      f.base = f.name === 'thumb' ? 0.2 : 0;
    }
    arm.fingers = arm.fingers.filter((f) => f.axis);
  }
}
