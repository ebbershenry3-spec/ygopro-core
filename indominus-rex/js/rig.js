// Procedural rig: layers creature-space rotations on top of a skeleton,
// solves digitigrade legs with two-bone IK and keeps feet planted.
//
// Every rotation is authored in "creature space": +Z forward, +Y up, +X to the creature's left.
// pitch > 0 = nose down, yaw > 0 = turn left, roll > 0 = roll to the right side down.
import * as THREE from 'three';
import { clamp, quatYPR } from './util.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);

export function worldPos(o, out = new THREE.Vector3()) { return o.getWorldPosition(out); }

// apply a world-space rotation R to a bone around its own pivot
export function rotateBoneWorld(bone, R) {
  const W = bone.getWorldQuaternion(_q2);
  const inv = _q3.copy(W).invert();
  // local delta = W^-1 R W
  const d = inv.multiply(R).multiply(W);
  bone.quaternion.multiply(d).normalize();
  bone.updateMatrixWorld(true);
}

export function setBoneWorldQuat(bone, Wdes) {
  const P = bone.parent.getWorldQuaternion(_q2);
  bone.quaternion.copy(P.invert().multiply(Wdes)).normalize();
  bone.updateMatrixWorld(true);
}

export class Rig {
  /**
   * @param root   Object3D placed in the world (position + yaw only, unit scale)
   * @param map    semantic bone map (see indominus.js / theropod.js)
   */
  constructor(root, map) {
    this.root = root;
    this.map = map;
    this.bones = map.all;
    this.rest = new Map();
    this.W0 = new Map(); // creature-relative world quaternion at rest
    this.capture();
  }

  capture() {
    const root = this.root;
    const savedPos = root.position.clone(), savedQ = root.quaternion.clone();
    root.position.set(0, 0, 0); root.quaternion.identity();
    root.updateMatrixWorld(true);
    for (const b of this.bones) {
      this.rest.set(b, { p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() });
    }
    for (const b of this.bones) this.W0.set(b, b.getWorldQuaternion(new THREE.Quaternion()));
    const m = this.map;
    // rest positions in creature space
    const P = (b) => b.getWorldPosition(new THREE.Vector3());
    this.restPelvis = P(m.pelvis);
    const pp = m.pelvis.parent;
    this.pelvisParentQ = pp.getWorldQuaternion(new THREE.Quaternion());
    this.pelvisParentScale = pp.getWorldScale(new THREE.Vector3()).x;
    this.restNeckBase = P(m.neck[0]);
    this.restHead = P(m.head);
    this.restSnout = m.snoutOffset ? P(m.head).add(m.snoutOffset.clone()) : P(m.head).add(new THREE.Vector3(0, 0, 1));
    const hd = this.restSnout.clone().sub(this.restNeckBase);
    this.restHeadPitch = Math.atan2(-hd.y, Math.hypot(hd.x, hd.z));
    for (const leg of m.legs) {
      leg.restHip = P(leg.hip); leg.restKnee = P(leg.knee); leg.restAnkle = P(leg.ankle); leg.restBall = P(leg.ball);
      leg.lenA = leg.restKnee.distanceTo(leg.restHip);
      leg.lenB = leg.restAnkle.distanceTo(leg.restKnee);
      leg.m0 = leg.restAnkle.clone().sub(leg.restBall);          // metatarsus vector (ball -> ankle)
      leg.ballHeight = leg.restBall.y - (leg.groundY ?? 0);
      leg.home = new THREE.Vector3(leg.restBall.x, 0, leg.restBall.z); // ground point under the ball
      leg.kneeDir = leg.restKnee.clone().sub(leg.restHip.clone().lerp(leg.restAnkle, 0.5)).setY(0).normalize();
    }
    for (const arm of m.arms || []) {
      arm.restHand = P(arm.hand);
    }
    root.position.copy(savedPos); root.quaternion.copy(savedQ);
    root.updateMatrixWorld(true);
  }

  reset() {
    for (const b of this.bones) {
      const r = this.rest.get(b);
      b.position.copy(r.p); b.quaternion.copy(r.q); b.scale.copy(r.s);
    }
  }

  // rotate bone by a creature-space rotation, expressed around the bone's rest frame (FK semantics)
  rotC(bone, q) {
    const W0 = this.W0.get(bone);
    _q1.copy(W0).invert().multiply(q).multiply(W0);
    bone.quaternion.multiply(_q1);
  }
  rotYPR(bone, yaw, pitch, roll = 0) {
    if (!yaw && !pitch && !roll) return;
    this.rotC(bone, quatYPR(yaw, pitch, roll, _q3));
  }

  /**
   * Apply a full pose. P is a plain object of parameters (see Creature.poseKeys).
   * extra: { tail: [{yaw,pitch}], lookYaw, lookPitch }
   */
  pose(P, extra = {}) {
    const m = this.map;
    // --- pelvis translation (creature space) ---
    if (P.px || P.py || P.pz) {
      _v1.set(P.px || 0, P.py || 0, P.pz || 0).applyQuaternion(_q1.copy(this.pelvisParentQ).invert()).divideScalar(this.pelvisParentScale);
      m.pelvis.position.add(_v1);
    }
    this.rotYPR(m.pelvis, P.bodyYaw || 0, P.bodyPitch || 0, P.bodyRoll || 0);

    // --- spine (front body) ---
    const sw = m.spineWeights;
    for (let i = 0; i < m.spine.length; i++) {
      this.rotYPR(m.spine[i], (P.spineYaw || 0) * sw[i], (P.spinePitch || 0) * sw[i], (P.spineRoll || 0) * sw[i]);
    }
    // --- neck + head (with look-at contribution) ---
    const ny = (P.neckYaw || 0) + (extra.lookYaw || 0) * 0.65;
    const np = (P.neckPitch || 0) + (extra.lookPitch || 0) * 0.55;
    const nw = m.neckWeights;
    for (let i = 0; i < m.neck.length; i++) {
      this.rotYPR(m.neck[i], ny * nw[i], np * nw[i], (P.neckRoll || 0) * nw[i]);
    }
    this.rotYPR(m.head, (P.headYaw || 0) + (extra.lookYaw || 0) * 0.35, (P.headPitch || 0) + (extra.lookPitch || 0) * 0.45, P.headRoll || 0);
    if (m.jaw) this.rotYPR(m.jaw, 0, clamp(P.jaw || 0, -0.05, 1.15) * m.jawMax, 0);
    if (m.tongue && P.jaw) this.rotYPR(m.tongue, 0, -(P.jaw) * 0.25, 0);

    // --- tail ---
    const tw = m.tailWeights;
    const dyn = extra.tail;
    for (let i = 0; i < m.tail.length; i++) {
      let y = (P.tailYaw || 0) * tw[i], p = (P.tailPitch || 0) * tw[i];
      if (dyn) { y += dyn[i].yaw; p += dyn[i].pitch; }
      this.rotYPR(m.tail[i], y, p, 0);
    }

    // --- arms ---
    for (const arm of m.arms || []) {
      const s = arm.side > 0 ? 'L' : 'R';
      const raise = P['arm' + s + 'Raise'] || 0, out = P['arm' + s + 'Out'] || 0;
      const elbow = P['arm' + s + 'Elbow'] || 0, wrist = P['arm' + s + 'Wrist'] || 0, grip = P['arm' + s + 'Grip'] || 0;
      // abduction rotates around the forward axis, sign mirrored per side
      if (arm.collar && (raise || out)) this.rotYPR(arm.collar, 0, -raise * 0.25, -out * arm.side * 0.3);
      this.rotYPR(arm.upper, out * arm.side * 0.3, -raise * 0.75, -out * arm.side * 0.7);
      if (elbow) this.rotYPR(arm.lower, 0, -elbow, 0);
      if (wrist) this.rotYPR(arm.hand, 0, -wrist, 0);
      if (arm.fingers) {
        for (const f of arm.fingers) {
          for (let k = 0; k < f.bones.length; k++) {
            const a = (grip + (f.base || 0)) * (k === 0 ? 0.35 : 0.6);
            if (a) this.rotC(f.bones[k], _q3.setFromAxisAngle(f.axis, a));
          }
        }
      }
    }
    // --- eyelids ---
    if (m.lids && P.blink) {
      for (const lid of m.lids) this.rotC(lid.bone, _q3.setFromAxisAngle(lid.axis, lid.amount * P.blink));
    }
    this.root.updateMatrixWorld(true);
  }

  // creature-space look angles from the neck base toward a world point
  lookAngles(targetWorld, P) {
    _v1.copy(targetWorld);
    this.root.worldToLocal(_v1);
    const nb = this.restNeckBase;
    const dx = _v1.x - nb.x - (P.px || 0), dy = _v1.y - nb.y - (P.py || 0), dz = _v1.z - nb.z - (P.pz || 0);
    const yaw = Math.atan2(dx, dz) - (P.bodyYaw || 0) - (P.spineYaw || 0) - (P.neckYaw || 0);
    const pitch = Math.atan2(-dy, Math.hypot(dx, dz)) - this.restHeadPitch - (P.bodyPitch || 0) - (P.spinePitch || 0) - (P.neckPitch || 0) - (P.headPitch || 0) * 0.5;
    return { yaw: clamp(yaw, -1.4, 1.4), pitch: clamp(pitch, -0.9, 0.8) };
  }

  /**
   * Solve one leg. ballTarget: world position of the ball (metatarso-phalangeal) joint.
   * footYaw: world yaw of the foot. lift: extra metatarsus tilt (rad). curl: toe flex (rad).
   */
  solveLeg(leg, ballTarget, footYaw, lift = 0, curl = 0) {
    const qFoot = _q1.setFromAxisAngle(Y, footYaw);
    const hipW = worldPos(leg.hip, _v2);
    const reach = (leg.lenA + leg.lenB) * 0.995;
    let A = _v3;
    let l = lift;
    for (let it = 0; it < 18; it++) {
      A.copy(leg.m0).applyAxisAngle(X, l).applyQuaternion(qFoot).add(ballTarget);
      if (A.distanceTo(hipW) <= reach) break;
      l += 0.06;
    }
    const minR = Math.abs(leg.lenA - leg.lenB) + 0.15 * (leg.lenA + leg.lenB);
    const dist = A.distanceTo(hipW);
    if (dist > reach) A.sub(hipW).setLength(reach).add(hipW);
    else if (dist < minR) A.sub(hipW).setLength(minR).add(hipW);
    // pole: knee points along the foot heading
    const pole = _v4.copy(leg.kneeDir).applyQuaternion(_q3.setFromAxisAngle(Y, footYaw));
    twoBoneIK(leg.hip, leg.knee, leg.ankle, A.clone(), pole);
    // orient metatarsus so the ball lands on its target
    const ankW = worldPos(leg.ankle, new THREE.Vector3());
    const ballW = worldPos(leg.ball, new THREE.Vector3());
    const d0 = ballW.sub(ankW).normalize();
    const d1 = ballTarget.clone().sub(ankW).normalize();
    rotateBoneWorld(leg.ankle, new THREE.Quaternion().setFromUnitVectors(d0, d1));
    // toes stay flat (or curl) in the foot frame
    const W0 = this.W0.get(leg.ball);
    const Wd = new THREE.Quaternion().setFromAxisAngle(Y, footYaw).multiply(new THREE.Quaternion().setFromAxisAngle(X, curl)).multiply(W0);
    setBoneWorldQuat(leg.ball, Wd);
    if (leg.toes && curl) {
      for (const t of leg.toes) this.rotC(t, _q3.setFromAxisAngle(X, curl * 0.6));
      leg.ball.updateMatrixWorld(true);
    }
  }
}

// Analytic two-bone IK with pole twist. a=upper, b=middle, c=end bone.
export function twoBoneIK(a, b, c, target, poleDir) {
  const pa = worldPos(a, new THREE.Vector3()), pb = worldPos(b, new THREE.Vector3()), pc = worldPos(c, new THREE.Vector3());
  const lab = pb.distanceTo(pa), lcb = pc.distanceTo(pb);
  const lat = clamp(target.distanceTo(pa), Math.abs(lab - lcb) + 1e-3, lab + lcb - 1e-3);
  // 1. knee angle
  const u = pa.clone().sub(pb), v = pc.clone().sub(pb);
  const th0 = u.angleTo(v);
  const th1 = Math.acos(clamp((lab * lab + lcb * lcb - lat * lat) / (2 * lab * lcb), -1, 1));
  let n = u.clone().cross(v);
  if (n.lengthSq() < 1e-8) n = u.clone().cross(poleDir);
  n.normalize();
  rotateBoneWorld(b, new THREE.Quaternion().setFromAxisAngle(n, th1 - th0));
  // 2. aim the chain at the target
  const pc2 = worldPos(c, new THREE.Vector3());
  const d0 = pc2.sub(pa).normalize();
  const d1 = target.clone().sub(pa).normalize();
  rotateBoneWorld(a, new THREE.Quaternion().setFromUnitVectors(d0, d1));
  // 3. twist around the hip->target axis so the knee faces the pole
  const pb2 = worldPos(b, new THREE.Vector3()).sub(pa);
  const kb = pb2.clone().addScaledVector(d1, -pb2.dot(d1));
  const pp = poleDir.clone().addScaledVector(d1, -poleDir.dot(d1));
  if (kb.lengthSq() > 1e-6 && pp.lengthSq() > 1e-6) {
    kb.normalize(); pp.normalize();
    let ang = Math.acos(clamp(kb.dot(pp), -1, 1));
    if (kb.clone().cross(pp).dot(d1) < 0) ang = -ang;
    rotateBoneWorld(a, new THREE.Quaternion().setFromAxisAngle(d1, ang));
  }
}
