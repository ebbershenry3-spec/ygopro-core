// Statue pose presets. Angles in radians, creature space (+Z forward, +X = creature's left).
// pitch > 0 = nose down, yaw > 0 = turn left, roll > 0 = right side down; tailPitch > 0 raises the tail.
// anchorR: where the right foot sits in creature space; the root is placed so that it lands on the carcass.
// footL.local: left foot ground position in creature space.
const D = Math.PI / 180;

export const POSES = {
  triumph: {
    label: 'Triumph',
    root: { yaw: 80 * D, y: 0.3 }, anchorR: [-0.75, 1.45],
    P: {
      py: -0.48, pz: 0.35, bodyPitch: -0.05, bodyRoll: -0.06, bodyYaw: -0.03,
      spinePitch: -0.02, spineYaw: -0.1, spineRoll: 0.03,
      neckPitch: -0.14, neckYaw: -0.4, neckRoll: 0.06, headPitch: -0.26, headYaw: -0.24, headRoll: -0.16, jaw: 1.12,
      armRRaise: 0.35, armRElbow: 0.6, armRWrist: 0.35, armRGrip: 0.55, armROut: 0.1,
      armLRaise: 0.55, armLOut: 0.3, armLElbow: 0.95, armLWrist: 0.25, armLGrip: 0.85,
      tailPitch: 0.1, tailYaw: 0.12,
    },
    tail: [[0, 0], [0.01, 0], [0.02, 0.01], [0.03, 0.02], [0.02, 0.04], [0, 0.06], [-0.03, 0.1], [-0.06, 0.15], [-0.08, 0.22]],
    footR: { spot: 'anky', curl: 0.4, yaw: 0.12 },
    footL: { local: [0.9, -0.85], yaw: -0.06 },
  },
  threat: {
    label: 'Drohung',
    root: { yaw: 66 * D, y: 0.28 }, anchorR: [-0.7, 1.6],
    P: {
      py: -0.55, pz: 0.45, bodyPitch: 0.05, bodyRoll: -0.05, bodyYaw: -0.05,
      spinePitch: 0.05, spineYaw: -0.12,
      neckPitch: 0.02, neckYaw: -0.42, neckRoll: 0.05, headPitch: -0.1, headYaw: -0.3, headRoll: -0.1, jaw: 1.15,
      armRRaise: 0.8, armROut: 0.55, armRElbow: 0.5, armRWrist: 0.1, armRGrip: 1.0,
      armLRaise: 0.85, armLOut: 0.6, armLElbow: 0.55, armLWrist: 0.1, armLGrip: 1.0,
      tailPitch: 0.22, tailYaw: 0.05,
    },
    tail: [[0, 0], [0.02, 0], [0.03, 0.02], [0.03, 0.03], [0.01, 0.05], [-0.02, 0.07], [-0.05, 0.1], [-0.08, 0.15], [-0.1, 0.2]],
    footR: { spot: 'anky', curl: 0.45, yaw: 0.1, dx: 0.1 },
    footL: { local: [1.0, -1.3], yaw: -0.12 },
  },
  watch: {
    label: 'Wachsam',
    root: { yaw: 92 * D, y: 0.3 }, anchorR: [-0.85, 1.3],
    P: {
      py: -0.42, pz: 0.2, bodyPitch: 0.0, bodyRoll: -0.07,
      spinePitch: 0.06, spineYaw: -0.15, spineRoll: 0.04,
      neckPitch: 0.15, neckYaw: -0.5, neckRoll: 0.1, headPitch: 0.3, headYaw: -0.3, headRoll: 0.32, jaw: 0.2,
      armRRaise: 0.75, armRElbow: 0.35, armRWrist: 0.45, armRGrip: 0.7, armROut: 0.05,
      armLRaise: 0.55, armLOut: 0.15, armLElbow: 0.9, armLWrist: 0.3, armLGrip: 0.6,
      tailPitch: 0.06, tailYaw: 0.08,
    },
    tail: [[0, 0], [0.0, 0], [0.01, 0.01], [0.02, 0.02], [0.02, 0.03], [0.0, 0.05], [-0.03, 0.08], [-0.05, 0.12], [-0.07, 0.18]],
    footR: { spot: 'anky', curl: 0.35, yaw: 0.2, dz: -0.1 },
    footL: { local: [0.85, -0.8], yaw: 0.0 },
  },
};
