"""Sculpts the supporting cast (Rexy, Blue, Mosasaurus) as skinned GLBs.

usage: python build_creatures.py <out_dir> [rexy|blue|mosa ...]
"""
import sys
import time
import numpy as np
from sdf import Prim, Group, wave_noise, cone_mesh, vertex_normals, write_skinned_glb, rot_from_dir

A = np.array


def interp_profile(keys, z, field):
    zs = [k['z'] for k in keys]
    return np.interp(z, zs, [k[field] for k in keys])


def chain_weight_fn(stations):
    """stations: list of (z_centre, bone) sorted by z -> callable for Prim.bones"""
    zs = np.array([s[0] for s in stations])
    names = [s[1] for s in stations]

    def f(p, idx):
        W = np.zeros((len(p), len(idx)))
        z = p[:, 2]
        i = np.clip(np.searchsorted(zs, z) - 1, 0, len(zs) - 2)
        t = np.clip((z - zs[i]) / (zs[i + 1] - zs[i]), 0, 1)
        t = t * t * (3 - 2 * t)
        for k in range(len(zs) - 1):
            m = i == k
            if m.any():
                W[m, idx[names[k]]] += 1 - t[m]
                W[m, idx[names[k + 1]]] += t[m]
        return W
    return f


def smooth01(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def hexc(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]) ** 2.2  # to linear


def value_noise3(p, scale, seed=0):
    rng = np.random.default_rng(seed)
    out = np.zeros(len(p))
    for i in range(4):
        k = rng.normal(size=3)
        k = k / np.linalg.norm(k) * scale * (1.7 ** i)
        out += np.sin(p @ k + rng.uniform(0, 6.28)) / (1.6 ** i)
    return out / 2.2


def trunk(group, keys, step, k, weight_fn, tau_scale=1.0):
    zs = np.arange(keys[0]['z'], keys[-1]['z'] + 1e-6, step)
    for z in zs:
        y = interp_profile(keys, z, 'y')
        w = interp_profile(keys, z, 'w')
        hu = interp_profile(keys, z, 'hu')
        hd = interp_profile(keys, z, 'hd')
        dz = 0.05
        dy = interp_profile(keys, z + dz, 'y') - interp_profile(keys, z - dz, 'y')
        R = rot_from_dir([0, dy, 2 * dz])
        c = A([0, y + (hu - hd) / 2, z])
        group.add(Prim('ellipsoid', k=k, c=c, r=[w, (hu + hd) / 2, max(step * 1.2, min(w, (hu + hd) / 2) * 0.9)], R=R, bones=weight_fn))


def finalize(group, target, bones, tau=0.05):
    t0 = time.time()
    v, f = group.polygonize(target)
    n = group.normals(v)
    names = [b[0] for b in bones]
    j, w = group.skin(v, names, tau)
    print(f'  {group.name}: {len(v)} verts {len(f)} faces ({time.time() - t0:.1f}s)')
    return v, f, n, j, w


def ao(group, v, n, dist=0.2):
    d = group.eval(v + n * dist)
    return np.clip(d / dist, 0, 1)


# =================================================================== REXY
def build_rexy(out):
    print('Rexy')
    body_keys = [
        dict(z=-7.6, y=2.5, w=0.04, hu=0.04, hd=0.04),
        dict(z=-6.4, y=2.95, w=0.13, hu=0.15, hd=0.17),
        dict(z=-5.0, y=3.35, w=0.22, hu=0.26, hd=0.3),
        dict(z=-3.6, y=3.75, w=0.33, hu=0.4, hd=0.48),
        dict(z=-2.2, y=4.05, w=0.46, hu=0.52, hd=0.64),
        dict(z=-0.9, y=4.22, w=0.58, hu=0.56, hd=0.76),
        dict(z=0.3, y=4.22, w=0.76, hu=0.6, hd=1.02),
        dict(z=1.4, y=4.12, w=0.88, hu=0.62, hd=1.32),
        dict(z=2.4, y=4.15, w=0.8, hu=0.6, hd=1.25),
        dict(z=3.1, y=4.36, w=0.62, hu=0.55, hd=0.92),
        dict(z=3.7, y=4.7, w=0.53, hu=0.5, hd=0.7),
        dict(z=4.2, y=5.0, w=0.48, hu=0.46, hd=0.56),
        dict(z=4.55, y=5.12, w=0.42, hu=0.4, hd=0.45),
    ]
    yz = lambda z: float(interp_profile(body_keys, z, 'y'))
    bones = []

    def B(name, parent, pos):
        bones.append((name, -1 if parent is None else [b[0] for b in bones].index(parent), A(pos, float)))
        return name
    B('pelvis', None, [0, 4.2, -0.5])
    tailz = [-1.4, -2.3, -3.2, -4.1, -5.0, -5.8, -6.5, -7.05, -7.4]
    prev = 'pelvis'
    for i, z in enumerate(tailz):
        prev = B(f'tail{i}', prev, [0, yz(z), z])
    prev = 'pelvis'
    for i, z in enumerate([0.0, 0.8, 1.6, 2.4]):
        prev = B(f'spine{i}', prev, [0, yz(z), z])
    for i, z in enumerate([3.1, 3.6, 4.05]):
        prev = B(f'neck{i}', prev, [0, yz(z), z])
    B('head', prev, [0, 5.12, 4.48])
    B('jaw', 'head', [0, 4.985, 4.62])
    LEG = dict(H=A([0.72, 3.75, -0.35]), K=A([0.86, 2.2, 0.45]), An=A([0.8, 0.9, -0.2]), Bl=A([0.82, 0.3, 0.12]))
    ARM = dict(S=A([0.62, 3.55, 2.6]), E=A([0.74, 3.0, 2.86]), Hn=A([0.7, 2.72, 3.16]))
    for s, sx in (('L', 1), ('R', -1)):
        m = A([sx, 1, 1])
        B('hip' + s, 'pelvis', LEG['H'] * m)
        B('knee' + s, 'hip' + s, LEG['K'] * m)
        B('ankle' + s, 'knee' + s, LEG['An'] * m)
        B('ball' + s, 'ankle' + s, LEG['Bl'] * m)
        B('upper' + s, 'spine3', ARM['S'] * m)
        B('lower' + s, 'upper' + s, ARM['E'] * m)
        B('hand' + s, 'lower' + s, ARM['Hn'] * m)

    # ---------------- body group
    body = Group('body', 0.04, noise=wave_noise(3, 0.012, [0.12, 0.25, 0.5]))
    stations = [(-7.6, 'tail8'), (-7.2, 'tail8'), (-6.8, 'tail7'), (-6.15, 'tail6'), (-5.4, 'tail5'), (-4.55, 'tail4'), (-3.65, 'tail3'),
                (-2.75, 'tail2'), (-1.85, 'tail1'), (-1.05, 'tail0'), (-0.45, 'pelvis'), (0.4, 'spine0'), (1.2, 'spine1'), (2.0, 'spine2'),
                (2.75, 'spine3'), (3.35, 'neck0'), (3.82, 'neck1'), (4.25, 'neck2'), (4.6, 'head')]
    tw = chain_weight_fn(stations)
    trunk(body, body_keys, 0.22, 0.32, tw)
    # neck musculature & throat
    body.add(Prim('ellipsoid', k=0.3, c=[0, 5.22, 3.95], r=[0.44, 0.3, 0.75], R=rot_from_dir([0, 0.55, 1]), bones={'neck1': 0.5, 'neck2': 0.5}))
    body.add(Prim('ellipsoid', k=0.3, c=[0, 4.62, 4.15], r=[0.42, 0.38, 0.5], bones={'neck2': 0.6, 'head': 0.4}))
    # chest / pectoral mass
    body.add(Prim('ellipsoid', k=0.4, c=[0, 3.25, 2.55], r=[0.7, 0.55, 0.7], bones={'spine2': 0.4, 'spine3': 0.6}))
    for s, sx in (('L', 1), ('R', -1)):
        m = A([sx, 1, 1])
        H, K, An, Bl = LEG['H'] * m, LEG['K'] * m, LEG['An'] * m, LEG['Bl'] * m
        fem = K - H
        body.add(Prim('ellipsoid', k=0.35, c=H + A([-0.1 * sx, 0.35, -0.05]), r=[0.55, 0.6, 0.8], bones={'pelvis': 0.65, 'hip' + s: 0.35}))
        body.add(Prim('ellipsoid', k=0.3, c=H + 0.42 * fem + A([0.12 * sx, 0.12, 0.0]), r=[0.5, 0.72, 1.02], R=rot_from_dir(fem, up=[0, 0, 1]),
                      bones=[(0, {'pelvis': 0.35, 'hip' + s: 0.65}), (0.35, {'hip' + s: 1}), (1, {'hip' + s: 0.6, 'knee' + s: 0.4})]))
        body.add(Prim('ellipsoid', k=0.4, c=A([0.48 * sx, 3.72, -1.4]), r=[0.36, 0.5, 0.95], R=rot_from_dir([0, 0.15, 1]), bones={'pelvis': 0.55, 'hip' + s: 0.25, 'tail0': 0.2}))
        body.add(Prim('cone', k=0.15, a=H + 0.6 * fem, b=K, ra=0.48, rb=0.33, bones=[(0, {'hip' + s: 1}), (1, {'hip' + s: 0.5, 'knee' + s: 0.5})]))
        shin = An - K
        body.add(Prim('cone', k=0.12, a=K, b=An, ra=0.34, rb=0.19, bones=[(0, {'hip' + s: 0.35, 'knee' + s: 0.65}), (0.2, {'knee' + s: 1}), (0.85, {'knee' + s: 1}), (1, {'knee' + s: 0.5, 'ankle' + s: 0.5})]))
        body.add(Prim('ellipsoid', k=0.15, c=K + 0.3 * shin + A([0, 0.0, -0.12]), r=[0.27, 0.27, 0.5], R=rot_from_dir(shin, up=[0, 0, 1]), bones={'knee' + s: 1}))
        body.add(Prim('ellipsoid', k=0.08, c=An, r=[0.21, 0.2, 0.21], bones={'knee' + s: 0.35, 'ankle' + s: 0.65}))
        body.add(Prim('cone', k=0.08, a=An, b=Bl, ra=0.19, rb=0.16, bones=[(0, {'knee' + s: 0.3, 'ankle' + s: 0.7}), (0.25, {'ankle' + s: 1}), (1, {'ankle' + s: 0.5, 'ball' + s: 0.5})]))
        # toes: outer, middle, inner (+ small dew claw)
        toe_tips = []
        for yaw, ln in ((0.42, 0.6), (0.0, 0.74), (-0.36, 0.58)):
            d = A([np.sin(yaw * sx), 0, np.cos(yaw)])
            a = Bl + A([0, -0.06, 0.04])
            mid = A([Bl[0], 0.13, Bl[2]]) + d * ln * 0.45
            tip = A([Bl[0], 0.07, Bl[2]]) + d * ln
            body.add(Prim('cone', k=0.06, a=a, b=mid, ra=0.14, rb=0.115, bones={'ball' + s: 1}))
            body.add(Prim('cone', k=0.05, a=mid, b=tip, ra=0.115, rb=0.06, bones={'ball' + s: 1}))
            toe_tips.append((tip, d))
        body.add(Prim('cone', k=0.04, a=Bl + A([-0.08 * sx, 0.05, -0.05]), b=Bl + A([-0.14 * sx, 0.12, -0.28]), ra=0.07, rb=0.04, bones={'ball' + s: 1}))
        LEG['tips' + s] = toe_tips
        # arms
        S_, E_, H_ = ARM['S'] * m, ARM['E'] * m, ARM['Hn'] * m
        body.add(Prim('ellipsoid', k=0.2, c=S_ + A([-0.12 * sx, 0.12, 0]), r=[0.24, 0.3, 0.3], bones={'spine3': 0.7, 'upper' + s: 0.3}))
        body.add(Prim('cone', k=0.08, a=S_, b=E_, ra=0.16, rb=0.115, bones=[(0, {'spine3': 0.3, 'upper' + s: 0.7}), (0.3, {'upper' + s: 1}), (1, {'upper' + s: 0.5, 'lower' + s: 0.5})]))
        body.add(Prim('cone', k=0.06, a=E_, b=H_, ra=0.115, rb=0.085, bones=[(0, {'upper' + s: 0.3, 'lower' + s: 0.7}), (0.3, {'lower' + s: 1}), (1, {'lower' + s: 0.5, 'hand' + s: 0.5})]))
        ftips = []
        for off in (A([0.03 * sx, -0.21, 0.12]), A([-0.04 * sx, -0.19, 0.1])):
            body.add(Prim('cone', k=0.03, a=H_, b=H_ + off, ra=0.06, rb=0.035, bones={'hand' + s: 1}))
            ftips.append((H_ + off, off / np.linalg.norm(off)))
        ARM['tips' + s] = ftips

    # ---------------- head (upper skull): long, boxy T. rex skull with a straight, sloping top line
    head = Group('head', 0.016, noise=wave_noise(5, 0.005, [0.06, 0.12, 0.25]))
    HB = {'head': 1}
    pitch = lambda d: rot_from_dir([0, -d, 1])
    head.add(Prim('box', k=0.16, c=[0, 5.3, 4.72], b=[0.4, 0.22, 0.26], rr=0.13, bones=HB))                      # braincase / temporal region
    head.add(Prim('box', k=0.2, c=[0, 5.22, 5.3], b=[0.27, 0.2, 0.32], rr=0.1, R=pitch(0.2), bones=HB))          # maxilla
    head.add(Prim('box', k=0.16, c=[0, 5.15, 5.85], b=[0.19, 0.15, 0.3], rr=0.09, R=pitch(0.22), bones=HB))      # snout
    head.add(Prim('ellipsoid', k=0.1, c=[0, 5.12, 6.16], r=[0.19, 0.17, 0.14], bones=HB))                          # blunt tip
    for sx in (1, -1):
        head.add(Prim('ellipsoid', k=0.12, c=[0.43 * sx, 5.16, 4.78], r=[0.15, 0.22, 0.36], bones=HB))           # jugal flare
        head.add(Prim('ellipsoid', k=0.08, c=[0.35 * sx, 5.64, 5.0], r=[0.12, 0.07, 0.24], R=rot_from_dir([-0.3 * sx, -0.1, 1]), bones=HB))  # brow
        head.add(Prim('ellipsoid', k=0.06, c=[0.25 * sx, 5.62, 5.26], r=[0.07, 0.055, 0.1], bones=HB))          # lacrimal horn
        head.add(Prim('ellipsoid', k=0.06, c=[0.27 * sx, 5.18, 5.62], r=[0.05, 0.1, 0.42], R=pitch(0.2), bones=HB))  # maxilla ridge
    for i, z in enumerate(np.linspace(5.35, 6.0, 6)):
        head.add(Prim('ellipsoid', k=0.05, c=[0, 5.5 - (z - 5.35) * 0.33, z], r=[0.07, 0.045, 0.08], bones=HB))  # nasal rugosities
    for sx in (1, -1):
        head.add(Prim('ellipsoid', k=0.05, op='sub', c=[0.45 * sx, 5.47, 5.07], r=[0.075, 0.085, 0.1], bones=None))  # eye socket
        head.add(Prim('ellipsoid', k=0.02, op='sub', c=[0.13 * sx, 5.2, 6.2], r=[0.035, 0.045, 0.06], bones=None))   # nostril
        head.add(Prim('ellipsoid', k=0.06, op='sub', c=[0.52 * sx, 5.33, 4.6], r=[0.05, 0.11, 0.15], bones=None))   # temporal fenestra hint
        head.add(Prim('ellipsoid', k=0.05, op='sub', c=[0.33 * sx, 5.3, 5.45], r=[0.03, 0.08, 0.14], bones=None))   # antorbital fossa
    head.add(Prim('ellipsoid', k=0.05, op='sub', c=[0, 4.98, 5.35], r=[0.26, 0.09, 0.75], bones=None))             # palate
    head.add(Prim('plane', k=0.025, op='clip', n=[0, -1, 0.03], p0=[0, 4.985, 4.5]))

    # ---------------- jaw
    jaw = Group('jaw', 0.016, noise=wave_noise(9, 0.005, [0.06, 0.12, 0.25]))
    JB = {'jaw': 1}
    for c, r, k in (([0, 4.76, 4.74], [0.45, 0.25, 0.34], 0.15), ([0, 4.8, 5.2], [0.37, 0.2, 0.44], 0.18),
                    ([0, 4.86, 5.66], [0.27, 0.15, 0.4], 0.16), ([0, 4.92, 6.04], [0.19, 0.1, 0.2], 0.1)):
        jaw.add(Prim('ellipsoid', k=k, c=c, r=r, bones=JB))
    for sx in (1, -1):
        jaw.add(Prim('ellipsoid', k=0.1, c=[0.39 * sx, 4.78, 4.76], r=[0.12, 0.19, 0.3], bones=JB))
    jaw.add(Prim('ellipsoid', k=0.05, op='sub', c=[0, 4.99, 5.3], r=[0.27, 0.09, 0.72], bones=None))
    jaw.add(Prim('plane', k=0.025, op='clip', n=[0, 1, -0.03], p0=[0, 4.985, 4.5]))

    vb, fb, nb, jb, wb = finalize(body, 70000, bones, 0.06)
    vh, fh, nh, jh, wh = finalize(head, 18000, bones)
    vj, fj, nj, jj, wj = finalize(jaw, 9000, bones)

    # ---------------- colours
    base, dark, belly = hexc('#645a4d'), hexc('#3a322a'), hexc('#a69a82')
    mouth = hexc('#4a1d1b')

    def skin_col(v, n, grp, part):
        up = n[:, 1]
        col = np.tile(base, (len(v), 1))
        dors = smooth01((up - 0.05) / 0.8)[:, None]
        vent = smooth01((-up - 0.2) / 0.6)[:, None]
        col = col * (1 - dors * 0.55) + dark * dors * 0.55
        col = col * (1 - vent * 0.7) + belly * vent * 0.7
        if part == 'body':
            st = np.sin(v[:, 2] * 2 * np.pi * 0.55 + value_noise3(v, 1.0, 4) * 3.0 + v[:, 1] * 0.8)
            blot = value_noise3(v, 2.2, 6)
            st = smooth01((st + blot * 0.6 - 0.35) / 0.7) * smooth01((up + 0.2) / 0.8) * 0.38
            col = col * (1 - st[:, None]) + dark * st[:, None]
        mot = value_noise3(v, 3.0, 8)
        col = col * (0.86 + 0.28 * (mot[:, None] * 0.5 + 0.5))
        a = ao(grp, v, n, 0.18 if part == 'body' else 0.08)
        col = col * (0.45 + 0.55 * a[:, None])
        return col

    cb = skin_col(vb, nb, body, 'body')
    # darker toes/feet
    foot = smooth01((0.9 - vb[:, 1]) / 0.6)[:, None]
    cb = cb * (1 - foot * 0.35)
    ch = skin_col(vh, nh, head, 'head')
    inside = (nh[:, 1] < -0.4) & (vh[:, 1] < 5.06)
    lipz = np.abs(nh[:, 0]) > 0.75
    ch[inside & ~lipz] = mouth * 0.8
    cj = skin_col(vj, nj, jaw, 'jaw')
    lighter = smooth01((-nj[:, 1] - 0.1) / 0.6)[:, None]
    cj = cj * (1 - lighter * 0.4) + belly * lighter * 0.4
    inside_j = (nj[:, 1] > 0.4) & (vj[:, 1] > 4.9)
    cj[inside_j & ~(np.abs(nj[:, 0]) > 0.75)] = mouth * 0.8

    # ---------------- teeth (upper on head, lower on jaw)
    def lip_x(grp, y, z):
        lo, hi = 0.0, 0.8
        for _ in range(24):
            mid = (lo + hi) / 2
            if grp.eval(A([[mid, y, z]]))[0] < 0:
                lo = mid
            else:
                hi = mid
        return lo

    tv, tf, tj = [], [], []

    def add_teeth(grp, bone, y_edge, zs, up, sizes):
        for z, L in zip(zs, sizes):
            for sx in (1, -1):
                x = lip_x(grp, y_edge + (0.02 if not up else -0.02), z) - 0.055
                base_ = A([x * sx, y_edge + (0.03 if not up else -0.03), z])
                tip = base_ + A([-0.01 * sx, -L if not up else L, -0.035])
                v, f = cone_mesh(base_, tip, 0.032 * L / 0.13, 6, 0.045 * L / 0.13)
                tf.append(f + sum(len(x) for x in tv))
                tv.append(v)
                tj.append(np.full(len(v), [b[0] for b in bones].index(bone)))
    zs_up = np.linspace(4.85, 6.15, 13)
    add_teeth(head, 'head', 5.0, zs_up, False, 0.08 + 0.07 * np.sin(np.linspace(0.3, 2.9, 13)))
    zs_lo = np.linspace(4.92, 6.02, 12)
    add_teeth(jaw, 'jaw', 4.975, zs_lo, True, 0.07 + 0.06 * np.sin(np.linspace(0.3, 2.9, 12)))
    tv = np.concatenate(tv); tf = np.concatenate(tf); tj = np.concatenate(tj)

    # ---------------- claws
    cv, cf, cjn = [], [], []

    def add_claw(base_, d, L, r, bone):
        tip = base_ + d * L
        v, f = cone_mesh(base_, tip, r, 7)
        cf.append(f + sum(len(x) for x in cv)); cv.append(v); cjn.append(np.full(len(v), [b[0] for b in bones].index(bone)))
    for s in ('L', 'R'):
        for tip, d in LEG['tips' + s]:
            dd = d + A([0, -0.45, 0]); dd /= np.linalg.norm(dd)
            add_claw(tip - d * 0.06 + A([0, 0.03, 0]), dd, 0.22, 0.06, 'ball' + s)
        for tip, d in ARM['tips' + s]:
            add_claw(tip - d * 0.02, d, 0.1, 0.028, 'hand' + s)
    cv = np.concatenate(cv); cf = np.concatenate(cf); cjn = np.concatenate(cjn)

    def rigid(v, f, jidx, color):
        n = vertex_normals(v, f)
        j = np.zeros((len(v), 4), np.uint16); j[:, 0] = jidx
        w = np.zeros((len(v), 4), np.float32); w[:, 0] = 1
        return dict(verts=v, faces=f, normals=n, colors=np.tile(color, (len(v), 1)), joints=j, weights=w)

    prims = [
        dict(verts=vb, faces=fb, normals=nb, colors=cb, joints=jb, weights=wb, material=0),
        dict(verts=vh, faces=fh, normals=nh, colors=ch, joints=jh, weights=wh, material=0),
        dict(verts=vj, faces=fj, normals=nj, colors=cj, joints=jj, weights=wj, material=0),
        dict(**rigid(tv, tf, tj, hexc('#d9cba3')), material=1),
        dict(**rigid(cv, cf, cjn, hexc('#24201b')), material=2),
    ]
    materials = [
        {'name': 'skin', 'pbrMetallicRoughness': {'baseColorFactor': [1, 1, 1, 1], 'metallicFactor': 0, 'roughnessFactor': 0.85}},
        {'name': 'teeth', 'pbrMetallicRoughness': {'baseColorFactor': [1, 1, 1, 1], 'metallicFactor': 0, 'roughnessFactor': 0.45}},
        {'name': 'claws', 'pbrMetallicRoughness': {'baseColorFactor': [1, 1, 1, 1], 'metallicFactor': 0, 'roughnessFactor': 0.35}},
    ]
    extras = {
        'species': 'rexy',
        'eyes': [[0.41, 5.47, 5.08], [-0.41, 5.47, 5.08]], 'eyeR': 0.055, 'eyeDir': [0.8, 0.05, 0.6],
        'throat': {'pos': [0, 4.99, 4.72], 'size': [0.3, 0.18]},
        'snout': [0, 5.0, 6.25], 'jawMax': 0.62,
    }
    write_skinned_glb(f'{out}/rexy.glb', bones, prims, materials, extras)
    print('  wrote rexy.glb')


if __name__ == '__main__':
    out = sys.argv[1]
    which = sys.argv[2:] or ['rexy']
    for w in which:
        globals()['build_' + w](out)
