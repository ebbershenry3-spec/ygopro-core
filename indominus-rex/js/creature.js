// Creature: locomotion (gait + planted feet), move playback, secondary motion and hit reactions.
import * as THREE from 'three';
import { clamp, lerp, damp, dampAngle, wrapAngle, smooth, Spring, sampleKeys, fbm1, noise1 } from './util.js';

export const POSE_KEYS = ['px', 'py', 'pz', 'bodyPitch', 'bodyRoll', 'bodyYaw', 'spinePitch', 'spineYaw', 'spineRoll',
  'neckPitch', 'neckYaw', 'neckRoll', 'headPitch', 'headYaw', 'headRoll', 'jaw', 'tailPitch', 'tailYaw',
  'armLRaise', 'armLOut', 'armLElbow', 'armLWrist', 'armLGrip', 'armRRaise', 'armROut', 'armRElbow', 'armRWrist', 'armRGrip', 'blink'];

// secondary-motion spring settings per channel (Hz, damping)
const SPRINGS = {
  px: [3.0, 0.7], py: [3.5, 0.65], pz: [3.0, 0.7], bodyPitch: [3.2, 0.7], bodyRoll: [3.0, 0.6], bodyYaw: [3.0, 0.7],
  spinePitch: [3.5, 0.65], spineYaw: [3.2, 0.65], spineRoll: [3.0, 0.6],
  neckPitch: [4.2, 0.6], neckYaw: [4.0, 0.6], neckRoll: [4.0, 0.55], headPitch: [5.0, 0.55], headYaw: [5.0, 0.55], headRoll: [5.0, 0.5],
  jaw: [9.0, 0.6], tailPitch: [2.2, 0.55], tailYaw: [2.0, 0.55],
  armLRaise: [5, 0.5], armLOut: [5, 0.5], armLElbow: [5.5, 0.5], armLWrist: [6, 0.5], armLGrip: [8, 0.6],
  armRRaise: [5, 0.5], armROut: [5, 0.5], armRElbow: [5.5, 0.5], armRWrist: [6, 0.5], armRGrip: [8, 0.6], blink: [20, 1],
};

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

export class Creature {
  constructor({ name, root, rig, mixer = null, idleActions = [], cfg = {} }) {
    this.name = name;
    this.root = root;
    this.rig = rig;
    this.mixer = mixer;
    this.idleActions = idleActions; // [{action, weightKey}] weightKey: 'body' | 'face'
    this.cfg = Object.assign({
      walkSpeed: 2.4, runSpeed: 9, maxSpeed: 10, accel: 5, decel: 7, turnRate: 1.4,
      f0: 0.48, fk: 0.065, stepHeight: 0.55, bob: 0.12, sway: 0.18, scale: 1,
      stepThresh: 0.45, idleStepDur: 0.5, radius: 2.2, length: 7, headReach: 6,
      breathe: 0.03, mass: 1,
    }, cfg);
    this.yaw = 0;
    this.vel = new THREE.Vector3();
    this.desiredVel = new THREE.Vector3();
    this.desiredYaw = null;
    this.push = new THREE.Vector3();
    this.effVel = new THREE.Vector3();
    this.prevPos = root.position.clone();
    this.yawRate = 0;
    this.prevYaw = 0;
    this.phase = 0;
    this.speed = 0;
    this.runBlend = 0;
    this.time = Math.random() * 10;
    this.moves = [];          // active move instances
    this.reaction = {};       // impulse springs for hit reactions
    for (const k of POSE_KEYS) this.reaction[k] = new Spring(0, 2.6, 0.35);
    this.springs = {};
    for (const k of POSE_KEYS) { const s = SPRINGS[k] || [4, 0.6]; this.springs[k] = new Spring(0, s[0], s[1]); }
    this.base = {};           // persistent posture offsets (e.g. stalking crouch), damped
    this.baseTarget = {};
    this.P = {};
    this.lookTarget = null;   // THREE.Vector3 | Object3D | () => Vector3
    this.lookWeight = 0;
    this.lookW = 0;
    this.lookYaw = 0; this.lookPitch = 0;
    this.health = 1;
    this.alive = true;
    this.plantLock = false;
    this.idleBodyWeight = 1;
    this.listeners = {};
    this.feet = rig.map.legs.map((leg, i) => ({
      leg, i, side: leg.side, plant: new THREE.Vector3(), yaw: 0, swinging: false, t: 0, dur: 0.5,
      from: new THREE.Vector3(), to: new THREE.Vector3(), fromYaw: 0, toYaw: 0, lastCycle: -1, lift: 0, curl: 0,
      offset: i * 0.5, idleStep: false,
    }));
    // tail chain followers (absolute yaw / pitch of each segment)
    const n = rig.map.tail.length;
    this.tailYawS = Array.from({ length: n }, (_, i) => new Spring(0, lerp(4.2, 1.6, i / (n - 1)), 0.42));
    this.tailPitchS = Array.from({ length: n }, (_, i) => new Spring(0, lerp(4.5, 2.0, i / (n - 1)), 0.45));
    this.tailOut = Array.from({ length: n }, () => ({ yaw: 0, pitch: 0 }));
    this.snapFeet();
  }

  on(evt, fn) { (this.listeners[evt] ||= []).push(fn); }
  emit(evt, data) { for (const fn of this.listeners[evt] || []) fn(data, this); }

  get pos() { return this.root.position; }
  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  right(out = new THREE.Vector3()) { return out.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw)); }

  setPosition(x, z, yaw) {
    this.root.position.set(x, 0, z);
    if (yaw !== undefined) { this.yaw = yaw; this.prevYaw = yaw; }
    this.root.rotation.set(0, this.yaw, 0);
    this.prevPos.copy(this.root.position);
    this.vel.set(0, 0, 0); this.desiredVel.set(0, 0, 0); this.effVel.set(0, 0, 0);
    this.root.updateMatrixWorld(true);
    this.snapFeet();
  }

  homeWorld(foot, pos = this.root.position, yaw = this.yaw, out = new THREE.Vector3()) {
    const h = foot.leg.home;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return out.set(pos.x + h.x * c + h.z * s, 0, pos.z - h.x * s + h.z * c);
  }

  snapFeet() {
    for (const f of this.feet) { this.homeWorld(f, undefined, undefined, f.plant); f.yaw = this.yaw; f.swinging = false; }
  }

  // ---------- moves ----------
  play(move, opts = {}) {
    if (!opts.layer) {
      for (const m of this.moves) if (!m.layer && !m.fading) { m.fading = true; m.fadeStart = m.t; m.fadeDur = opts.blendIn ?? move.blendIn ?? 0.18; }
    }
    const inst = { move, t: 0, speed: opts.speed ?? 1, layer: !!opts.layer, fading: false, fired: new Set(), opts,
      startYaw: this.yaw, startPos: this.root.position.clone(), lastRoot: { f: 0, s: 0, y: 0 }, done: false };
    inst.promise = new Promise((res) => (inst.resolve = res));
    this.moves.push(inst);
    return inst;
  }
  get busy() { return this.moves.some((m) => !m.layer && !m.fading); }
  stopMoves() { for (const m of this.moves) if (!m.fading) { m.fading = true; m.fadeStart = m.t; m.fadeDur = 0.2; } }

  // ---------- reactions ----------
  hit(dirWorld, strength = 1, opts = {}) {
    // dirWorld: direction the hit pushes this creature
    const d = _v.copy(dirWorld).setY(0);
    if (d.lengthSq() < 1e-6) d.copy(this.forward()).multiplyScalar(-1);
    d.normalize();
    const f = this.forward(_v2);
    const fwdC = d.dot(f);
    const sideC = d.x * Math.cos(this.yaw) - d.z * Math.sin(this.yaw); // + = pushed toward creature's left (+X)
    const s = strength;
    const R = this.reaction;
    R.bodyRoll.v += -sideC * 1.6 * s;
    R.bodyYaw.v += -sideC * 1.2 * s;
    R.spineYaw.v += -sideC * 1.6 * s;
    R.neckYaw.v += -sideC * 3.2 * s * (opts.head ?? 1);
    R.headYaw.v += -sideC * 2.6 * s * (opts.head ?? 1);
    R.headRoll.v += sideC * 2.4 * s * (opts.head ?? 1);
    R.neckPitch.v += -fwdC * 1.2 * s + (opts.up ?? 0) * -2;
    R.bodyPitch.v += -fwdC * 0.6 * s;
    R.px.v += sideC * 3 * s;
    R.pz.v += fwdC * 3 * s;
    R.py.v += -2.0 * s;
    R.jaw.v += 3 * s;
    R.tailYaw.v += sideC * 2 * s;
    if (opts.push !== false) this.push.addScaledVector(d, (opts.pushSpeed ?? 4) * s / this.cfg.mass);
    this.emit('hit', { strength: s, dir: d.clone() });
  }

  // ---------- main update ----------
  update(dt, world) {
    this.time += dt;
    const cfg = this.cfg;
    // --- move playback & root motion ---
    const moveVals = {};
    let moveLook = 1, plant = this.plantLock, idleW = 1, envSum = 0, lookOverride = null;
    for (const m of this.moves) {
      const mv = m.move;
      m.t += dt * m.speed;
      let env;
      const bi = mv.blendIn ?? 0.18, bo = mv.blendOut ?? 0.3;
      if (m.fading) env = (1 - clamp((m.t - m.fadeStart) / Math.max(0.01, m.fadeDur), 0, 1)) * clamp(m.fadeStart / bi, 0, 1);
      else env = Math.min(clamp(m.t / bi, 0, 1), mv.loop ? 1 : clamp((mv.dur - m.t) / bo, 0, 1));
      env = smooth(env);
      m.env = env;
      const tt = mv.loop ? m.t % mv.dur : Math.min(m.t, mv.dur);
      for (const k in mv.keys) moveVals[k] = (moveVals[k] || 0) + sampleKeys(mv.keys[k], tt) * env;
      if (mv.look !== undefined) moveLook = Math.min(moveLook, lerp(1, typeof mv.look === 'number' ? mv.look : sampleKeys(mv.look, tt), env));
      if (mv.aim && env > 0.01) lookOverride = { w: env * (typeof mv.aim === 'number' ? mv.aim : sampleKeys(mv.aim, tt)) };
      if (mv.plant && env > 0.3) plant = true;
      if (mv.idle !== undefined) idleW = Math.min(idleW, lerp(1, mv.idle, env));
      envSum += env;
      // root motion (relative to heading at move start)
      if (mv.root && !m.fading) {
        const f = mv.root.fwd ? sampleKeys(mv.root.fwd, tt) : 0;
        const s = mv.root.side ? sampleKeys(mv.root.side, tt) : 0;
        const y = mv.root.yaw ? sampleKeys(mv.root.yaw, tt) : 0;
        const df = f - m.lastRoot.f, ds = s - m.lastRoot.s, dy = y - m.lastRoot.y;
        m.lastRoot = { f, s, y };
        // side > 0 moves toward the creature's left (+X in creature space)
        const yawRef = m.opts.rootYaw ?? this.yaw;
        const fx = Math.sin(yawRef), fz = Math.cos(yawRef);
        this.root.position.x += fx * df + fz * ds;
        this.root.position.z += fz * df - fx * ds;
        if (dy) { this.yaw += dy; if (this.desiredYaw !== null) this.desiredYaw += dy; }
      }
      // events
      if (mv.events) for (const e of mv.events) {
        if (!m.fired.has(e) && tt >= e.t && !m.fading) { m.fired.add(e); this.emit(e.type, Object.assign({ move: mv, inst: m }, e)); if (m.opts.onEvent) m.opts.onEvent(e, this); }
      }
      if (!mv.loop && m.t >= mv.dur && !m.done) { m.done = true; m.resolve(); }
    }
    this.moves = this.moves.filter((m) => {
      const dead = (m.fading && m.t - m.fadeStart >= m.fadeDur) || (!m.move.loop && m.t >= m.move.dur);
      if (dead && !m.done) { m.done = true; m.resolve(); }
      return !dead;
    });

    // --- locomotion (velocity & heading) ---
    if (this.alive) {
      const dv = _v.copy(this.desiredVel).sub(this.vel);
      const acc = this.desiredVel.lengthSq() > this.vel.lengthSq() ? cfg.accel : cfg.decel;
      const maxDv = acc * dt;
      if (dv.length() > maxDv) dv.setLength(maxDv);
      this.vel.add(dv);
      if (this.desiredYaw !== null) {
        const err = wrapAngle(this.desiredYaw - this.yaw);
        const rate = cfg.turnRate * lerp(1, 0.55, clamp(this.vel.length() / cfg.runSpeed, 0, 1));
        this.yaw += clamp(err, -rate * dt, rate * dt) * (Math.abs(err) < 0.3 ? smooth(Math.abs(err) / 0.3) * 0.7 + 0.3 : 1);
      }
    } else {
      this.vel.multiplyScalar(Math.exp(-3 * dt));
    }
    this.root.position.addScaledVector(this.vel, dt);
    // external push with friction
    this.root.position.addScaledVector(this.push, dt);
    this.push.multiplyScalar(Math.exp(-4.5 * dt));
    if (world && world.constrain) world.constrain(this);
    this.root.position.y = 0;
    this.root.rotation.set(0, this.yaw, 0);
    this.root.updateMatrixWorld(true);

    // effective velocity (includes root motion & pushes)
    const inst = _v.copy(this.root.position).sub(this.prevPos).divideScalar(Math.max(dt, 1e-4));
    this.effVel.lerp(inst, 1 - Math.exp(-10 * dt));
    this.prevPos.copy(this.root.position);
    const yr = wrapAngle(this.yaw - this.prevYaw) / Math.max(dt, 1e-4);
    this.yawRate = damp(this.yawRate, yr, 10, dt);
    this.prevYaw = this.yaw;
    this.speed = this.effVel.length();
    this.runBlend = damp(this.runBlend, smooth((this.speed - cfg.walkSpeed) / (cfg.runSpeed - cfg.walkSpeed)), 4, dt);

    // --- gait ---
    const gaitOut = this.updateFeet(dt, plant);

    // --- assemble pose ---
    const P = this.P;
    for (const k of POSE_KEYS) P[k] = 0;
    // breathing + life
    const t = this.time;
    const br = Math.sin(t * 1.6) * cfg.breathe;
    P.spinePitch += br * 0.5; P.neckPitch += -br * 0.6 + fbm1(t * 0.23) * 0.05; P.neckYaw += fbm1(t * 0.17 + 5) * 0.08;
    P.headYaw += fbm1(t * 0.31 + 9) * 0.05; P.headRoll += fbm1(t * 0.2 + 2) * 0.03;
    P.tailYaw += fbm1(t * 0.12 + 3) * 0.12;
    // persistent posture
    for (const k in this.baseTarget) { this.base[k] = damp(this.base[k] || 0, this.baseTarget[k], 3, dt); }
    for (const k in this.base) P[k] += this.base[k];
    // gait contributions
    for (const k in gaitOut) P[k] += gaitOut[k];
    // moves
    for (const k in moveVals) P[k] = (P[k] || 0) + moveVals[k];
    // reactions (impulse springs relax to 0)
    for (const k of POSE_KEYS) P[k] += this.reaction[k].update(0, dt);
    // death / external overrides
    if (this.override) this.override(P, dt, this);
    // secondary motion
    for (const k of POSE_KEYS) P[k] = this.springs[k].update(P[k], dt);

    // look-at
    let lw = this.lookWeight * moveLook;
    if (lookOverride) lw = Math.max(lw * (1 - lookOverride.w), lookOverride.w);
    this.lookW = damp(this.lookW, this.lookTarget ? lw : 0, 5, dt);
    if (this.lookTarget) {
      const tp = this.lookPoint(_v2);
      const a = this.rig.lookAngles(tp, P);
      this.lookYaw = damp(this.lookYaw, a.yaw * this.lookW, 6, dt);
      this.lookPitch = damp(this.lookPitch, a.pitch * this.lookW, 6, dt);
    } else {
      this.lookYaw = damp(this.lookYaw, 0, 4, dt); this.lookPitch = damp(this.lookPitch, 0, 4, dt);
    }

    // tail dynamics: segments follow the body heading/pitch with lag
    const tl = this.rig.map.tail.length;
    let prevY = this.yaw + (P.bodyYaw || 0), prevP = P.bodyPitch || 0;
    for (let i = 0; i < tl; i++) {
      const sy = this.tailYawS[i], sp = this.tailPitchS[i];
      // keep springs unwrapped relative to heading
      if (Math.abs(sy.x - prevY) > Math.PI) sy.x = prevY + wrapAngle(sy.x - prevY);
      sy.update(prevY, dt); sp.update(prevP + (this.verticalAcc || 0) * 0.002 * i, dt);
      this.tailOut[i].yaw = clamp(wrapAngle(sy.x - prevY), -0.35, 0.35);
      this.tailOut[i].pitch = clamp(sp.x - prevP, -0.25, 0.25);
      prevY = sy.x; prevP = sp.x;
    }

    // --- apply to skeleton ---
    this.rig.reset();
    if (this.mixer) {
      for (const ia of this.idleActions) ia.action.setEffectiveWeight(ia.kind === 'face' ? 1 : idleW * this.idleBodyWeight);
      this.mixer.update(dt);
    }
    this.rig.pose(P, { tail: this.tailOut, lookYaw: this.lookYaw, lookPitch: this.lookPitch });
    for (const f of this.feet) {
      this.rig.solveLeg(f.leg, _v.copy(f.plant).setY(f.plant.y + f.leg.ballHeight), f.yaw, f.lift, f.curl);
    }
  }

  lookPoint(out) {
    const t = this.lookTarget;
    if (!t) return null;
    if (t.isVector3) return out.copy(t);
    if (t.isObject3D) return t.getWorldPosition(out);
    return out.copy(t());
  }

  updateFeet(dt, plant) {
    const cfg = this.cfg;
    const out = { px: 0, py: 0, pz: 0, bodyRoll: 0, bodyYaw: 0, bodyPitch: 0, tailYaw: 0, neckPitch: 0, headPitch: 0, tailPitch: 0, spineYaw: 0 };
    const speed = this.speed;
    const moving = speed > 0.35 * cfg.scale && !plant;
    const f = cfg.f0 + cfg.fk * speed;
    const rb = this.runBlend;
    const duty = lerp(0.64, 0.4, rb);
    if (moving) this.phase += f * dt;
    const vel = this.effVel;
    let anySwing = this.feet.some((ft) => ft.swinging);
    for (const ft of this.feet) {
      if (ft.swinging) {
        ft.t += dt / ft.dur;
        // keep re-predicting landing while moving
        if (ft.adaptive) {
          const remain = Math.max(0, (1 - ft.t) * ft.dur);
          const fp = _v.copy(this.root.position).addScaledVector(vel, remain);
          const fy = this.yaw + this.yawRate * remain;
          const target = this.homeWorld(ft, fp, fy, _v2).addScaledVector(vel, ft.lead);
          ft.to.lerp(target, 1 - Math.exp(-12 * dt));
          ft.toYaw = fy;
        }
        const s = clamp(ft.t, 0, 1);
        const sh = smooth(s);
        ft.plant.lerpVectors(ft.from, ft.to, sh);
        ft.plant.y = Math.sin(Math.PI * Math.pow(s, 0.85)) * ft.height;
        ft.yaw = ft.fromYaw + wrapAngle(ft.toYaw - ft.fromYaw) * sh;
        ft.lift = (1 - s) * 0.5 * ft.liftAmt + Math.sin(Math.PI * s) * 0.15;
        ft.curl = Math.sin(Math.PI * s) * 0.55;
        if (ft.t >= 1) {
          ft.swinging = false; ft.plant.copy(ft.to); ft.plant.y = 0; ft.yaw = ft.toYaw; ft.lift = 0; ft.curl = 0;
          this.emit('footstep', { foot: ft, strength: ft.strength, pos: ft.plant.clone() });
        }
        continue;
      }
      ft.lift = damp(ft.lift, 0, 10, dt); ft.curl = damp(ft.curl, 0, 10, dt);
      if (plant) continue;
      if (moving) {
        const fp = (this.phase + ft.offset);
        const cyc = Math.floor(fp);
        const ph = fp - cyc;
        if (ph >= duty && ft.lastCycle !== cyc) {
          ft.lastCycle = cyc;
          const dur = (1 - duty) / f;
          this.startStep(ft, dur, true, (duty / f) * 0.5, lerp(cfg.stepHeight, cfg.stepHeight * 1.6, rb), lerp(0.5, 1, rb));
          anySwing = true;
        }
      } else if (!anySwing) {
        const home = this.homeWorld(ft, undefined, undefined, _v);
        const err = home.distanceTo(ft.plant);
        const yerr = Math.abs(wrapAngle(this.yaw - ft.yaw));
        if (err > cfg.stepThresh || yerr > 0.4) {
          // step the foot with the larger error first
          const other = this.feet.find((o) => o !== ft);
          const oerr = this.homeWorld(other, undefined, undefined, _v2).distanceTo(other.plant);
          if (err >= oerr || other.swinging) {
            this.startStep(ft, cfg.idleStepDur * clamp(0.75 + err / (cfg.stepThresh * 4), 0.75, 1.3), false, 0, cfg.stepHeight * clamp(err / 1.5, 0.5, 1.2), 0.35);
            ft.to.copy(home);
            anySwing = true;
          }
        }
      }
    }
    // pelvis motion from the feet
    for (const ft of this.feet) {
      if (!ft.swinging) continue;
      const b = Math.sin(Math.PI * clamp(ft.t, 0, 1));
      const k = ft.strength;
      out.py += cfg.bob * b * lerp(1, -1.6, rb) * k;
      out.px += -ft.side * cfg.sway * b * lerp(1, 0.5, rb) * k;
      out.bodyRoll += -ft.side * 0.035 * b * k;
      out.bodyYaw += -ft.side * 0.05 * b * k;
      out.tailYaw += ft.side * 0.12 * b * k;
      out.spineYaw += ft.side * 0.04 * b * k;
      out.headPitch += -cfg.bob * b * lerp(1, -1.6, rb) * k * 0.12; // head stabilisation
    }
    if (!this.feet.some((ft) => ft.swinging)) out.py -= cfg.bob * 0.3;
    out.py -= rb * cfg.bob * 2.2;          // run crouch
    out.bodyPitch += rb * 0.07 + clamp(this.speed / cfg.runSpeed, 0, 1) * 0.02;
    out.neckPitch += -rb * 0.06;           // keep the head up while leaning
    out.tailPitch += -rb * 0.1;
    // banking into turns
    out.bodyRoll += clamp(this.yawRate * this.speed * 0.025, -0.15, 0.15);
    out.spineYaw += clamp(this.yawRate * 0.25, -0.3, 0.3);
    out.neckYaw = clamp(this.yawRate * 0.3, -0.35, 0.35);
    return out;
  }

  startStep(ft, dur, adaptive, lead, height, strength) {
    ft.swinging = true; ft.t = 0; ft.dur = Math.max(0.12, dur); ft.adaptive = adaptive; ft.lead = lead;
    ft.from.copy(ft.plant).setY(0); ft.fromYaw = ft.yaw; ft.height = height; ft.strength = strength; ft.liftAmt = adaptive ? 1 : 0.4;
    const remain = ft.dur;
    const fp = _v.copy(this.root.position).addScaledVector(this.effVel, remain);
    const fy = this.yaw + this.yawRate * remain;
    this.homeWorld(ft, fp, fy, ft.to).addScaledVector(this.effVel, lead);
    ft.toYaw = fy;
  }

  // helpers for directors
  faceTowards(p) { this.desiredYaw = Math.atan2(p.x - this.pos.x, p.z - this.pos.z); }
  yawTo(p) { return Math.atan2(p.x - this.pos.x, p.z - this.pos.z); }
  distTo(p) { return Math.hypot(p.x - this.pos.x, p.z - this.pos.z); }
  goTowards(p, speed, stopDist = 0) {
    const d = _v.set(p.x - this.pos.x, 0, p.z - this.pos.z);
    const dist = d.length();
    this.faceTowards(p);
    const s = dist > stopDist ? Math.min(speed, (dist - stopDist) * 1.2 + 0.4) : 0;
    // only walk forward-ish: speed fades while turning
    const err = Math.abs(wrapAngle(this.desiredYaw - this.yaw));
    this.desiredVel.copy(this.forward(_v2)).multiplyScalar(s * clamp(1.3 - err, 0.15, 1));
    return dist;
  }
  stop() { this.desiredVel.set(0, 0, 0); }
}
