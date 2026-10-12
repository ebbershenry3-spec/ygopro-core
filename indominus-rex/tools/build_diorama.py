"""Sculpts the statue diorama: mossy terrain slab, rocks, moss cushions and the dead Ankylosaurus.

World units are metres at full creature size (the viewer scales the statue to 1/15).
Base footprint: chamfered rectangle, half length A (x), half depth B (z), chamfer C.
usage: python build_diorama.py <out_dir>
"""
import sys
import time
import numpy as np
from sdf import Prim, Group, wave_noise, vertex_normals, write_static_glb, rot_from_dir, smax, smin

A_, B_, C_ = 5.8, 2.6, 1.1
rng = np.random.default_rng(11)


def hexc(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]) ** 2.2


def sm(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def vnoise(p, scale, seed):
    r = np.random.default_rng(seed)
    out = np.zeros(len(p))
    for i in range(5):
        k = r.normal(size=3)
        k = k / np.linalg.norm(k) * scale * (1.8 ** i)
        out += np.sin(p @ k + r.uniform(0, 6.28)) / (1.7 ** i)
    return out / 2.3


def footprint(x, z, inset=0.0):
    ax, az = np.abs(x), np.abs(z)
    d_box = np.maximum(ax - (A_ - inset), az - (B_ - inset))
    d_ch = (ax + az - (A_ + B_ - C_ - inset * 1.4)) / np.sqrt(2)
    return np.maximum(d_box, d_ch)


# ------------------------------------------------------------------ Ankylosaurus (local frame)
ANKY_POS = np.array([2.55, 0.0, 0.55])
ANKY_ROLL = np.radians(66)      # right side down -> armoured back turns toward the viewer (+z)
ANKY_YAW = np.radians(64)       # head toward front-right


def anky_xform():
    cr, sr = np.cos(ANKY_ROLL), np.sin(ANKY_ROLL)
    # roll about local Z: right side (-x) down means +x side goes up
    Rr = np.array([[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]])
    cy, sy = np.cos(ANKY_YAW), np.sin(ANKY_YAW)
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    return Ry @ Rr


def tail_curve(s):
    """s in 0..1 along the tail; returns local point (dead tail curls to the creature's left)."""
    z = -1.6 - s * 2.6
    x = 1.1 * s ** 2
    y = 0.95 - 0.5 * s
    return np.array([x, y, z])


def build_anky():
    g = Group('anky', 0.022, noise=wave_noise(21, 0.008, [0.08, 0.16, 0.32]))
    spikes = []    # (prim) osteoderms for colouring
    add = lambda pr: g.add(pr)
    add(Prim('ellipsoid', k=0.3, c=[0, 1.02, 0], r=[1.2, 0.72, 1.85]))
    add(Prim('ellipsoid', k=0.35, c=[0, 0.72, 0.1], r=[1.02, 0.45, 1.6]))
    add(Prim('ellipsoid', k=0.3, c=[0, 0.98, -1.2], r=[0.95, 0.6, 0.9]))
    add(Prim('ellipsoid', k=0.3, c=[0, 0.96, 1.25], r=[0.9, 0.55, 0.75]))
    # neck drooping to the ground, head resting on its cheek
    add(Prim('ellipsoid', k=0.25, c=[0.05, 0.82, 2.0], r=[0.55, 0.42, 0.5]))
    head_c = np.array([0.12, 0.62, 2.55])
    add(Prim('ellipsoid', k=0.15, c=head_c, r=[0.48, 0.3, 0.42]))
    add(Prim('box', k=0.12, c=head_c + [0, -0.06, 0.4], b=[0.24, 0.15, 0.17], rr=0.08, R=rot_from_dir([0, -0.25, 1])))
    add(Prim('ellipsoid', k=0.08, c=head_c + [0, -0.15, 0.62], r=[0.17, 0.13, 0.12]))
    for sx in (1, -1):
        add(Prim('cone', k=0.05, a=head_c + [0.36 * sx, 0.15, -0.2], b=head_c + [0.62 * sx, 0.26, -0.42], ra=0.11, rb=0.02))  # squamosal horns
        add(Prim('cone', k=0.05, a=head_c + [0.36 * sx, -0.15, -0.05], b=head_c + [0.55 * sx, -0.34, -0.1], ra=0.09, rb=0.02))  # cheek horns
        add(Prim('ellipsoid', k=0.04, op='sub', c=head_c + [0.43 * sx, 0.06, 0.08], r=[0.06, 0.035, 0.07]))  # shut eye
    for i in range(6):
        add(Prim('ellipsoid', k=0.04, c=head_c + [rng.uniform(-0.28, 0.28), 0.28, rng.uniform(-0.25, 0.3)], r=[0.08, 0.04, 0.08]))
    # tail with club
    pts = [tail_curve(s) for s in np.linspace(0, 1, 6)]
    radii = np.linspace(0.55, 0.12, 6)
    for i in range(5):
        add(Prim('cone', k=0.15, a=pts[i], b=pts[i + 1], ra=radii[i], rb=radii[i + 1]))
    end = tail_curve(1.0)
    tdir = (tail_curve(1.0) - tail_curve(0.9)); tdir /= np.linalg.norm(tdir)
    club = end + tdir * 0.25
    R = rot_from_dir(tdir)
    add(Prim('ellipsoid', k=0.1, c=club, r=[0.4, 0.24, 0.36], R=R))
    side = np.cross([0, 1, 0], tdir); side /= np.linalg.norm(side)
    for sx in (1, -1):
        add(Prim('ellipsoid', k=0.06, c=club + side * 0.24 * sx + tdir * 0.02, r=[0.24, 0.2, 0.27], R=R))
    # limbs splayed limp
    for sx in (1, -1):
        # the up-side (+x, left) legs flop under the body after the roll; the down-side ones splay out
        if sx > 0:
            sh = np.array([0.7, 0.72, 1.3]); el = np.array([0.82, 0.22, 1.6]); ft = np.array([0.7, -0.22, 1.95])
        else:
            sh = np.array([-0.78, 0.78, 1.3]); el = np.array([-1.12, 0.42, 1.55]); ft = np.array([-1.24, 0.14, 1.8])
        add(Prim('cone', k=0.12, a=sh, b=el, ra=0.3, rb=0.22))
        add(Prim('cone', k=0.08, a=el, b=ft, ra=0.21, rb=0.17))
        add(Prim('ellipsoid', k=0.06, c=ft + [0, -0.04, 0.06], r=[0.21, 0.1, 0.22]))
        if sx > 0:
            hp = np.array([0.7, 0.75, -1.0]); kn = np.array([0.88, 0.2, -0.55]); hf = np.array([0.75, -0.25, -0.95])
        else:
            hp = np.array([-0.74, 0.8, -1.0]); kn = np.array([-1.12, 0.38, -0.72]); hf = np.array([-1.22, 0.12, -0.95])
        add(Prim('cone', k=0.14, a=hp, b=kn, ra=0.42, rb=0.3))
        add(Prim('cone', k=0.08, a=kn, b=hf, ra=0.27, rb=0.22))
        add(Prim('ellipsoid', k=0.06, c=hf + [0, -0.04, 0.04], r=[0.26, 0.1, 0.28]))
    # --- osteoderms: transverse bands of spikes (JW style), lateral spikes largest
    dome_c, dome_r = np.array([0, 1.02, 0]), np.array([1.2, 0.72, 1.85])
    for z in np.linspace(-1.5, 1.5, 7):
        f = np.sqrt(max(0.05, 1 - (z / dome_r[2]) ** 2))
        for th in np.radians(np.linspace(-100, 100, 7)):
            n = np.array([np.sin(th) / dome_r[0], np.cos(th) / dome_r[1], z / dome_r[2] ** 2 * 0.5])
            n /= np.linalg.norm(n)
            p = dome_c + np.array([dome_r[0] * f * np.sin(th), dome_r[1] * f * np.cos(th), z])
            lat = abs(np.sin(th))
            L = 0.1 + 0.4 * lat ** 2 * (1.15 - 0.3 * abs(z) / 1.6)
            rb = 0.13 + 0.05 * lat
            tip = p + (n + np.array([0, 0, -0.25])) / np.linalg.norm(n + np.array([0, 0, -0.25])) * L
            spikes.append(add(Prim('cone', k=0.05, a=p - n * 0.05, b=tip, ra=rb, rb=0.025)))
            # flat scute between spikes
            th2 = th + np.radians(14)
            if abs(th2) < np.radians(96):
                p2 = dome_c + np.array([dome_r[0] * f * np.sin(th2), dome_r[1] * f * np.cos(th2), z + 0.17])
                n2 = np.array([np.sin(th2), np.cos(th2), 0])
                spikes.append(add(Prim('ellipsoid', k=0.05, c=p2, r=[0.17, 0.2, 0.06], R=rot_from_dir(n2))))
    # cervical half rings
    for z, rr in ((1.75, 0.5), (2.12, 0.44)):
        for th in np.radians([-75, -38, 0, 38, 75]):
            n = np.array([np.sin(th), np.cos(th), 0.15]); n /= np.linalg.norm(n)
            p = np.array([0.05, 0.84, z]) + np.array([np.sin(th) * rr, np.cos(th) * rr * 0.9, 0])
            spikes.append(add(Prim('ellipsoid', k=0.05, c=p, r=[0.15, 0.15, 0.07], R=rot_from_dir(n))))
            spikes.append(add(Prim('cone', k=0.04, a=p, b=p + n * 0.16, ra=0.08, rb=0.02)))
    # tail spikes
    for s in np.linspace(0.08, 0.8, 6):
        c = tail_curve(s); d = tail_curve(s + 0.02) - c; d /= np.linalg.norm(d)
        sd = np.cross([0, 1, 0], d); sd /= np.linalg.norm(sd)
        r = 0.55 + (0.12 - 0.55) * s
        L = 0.3 * (1 - s) + 0.1
        for sx in (1, -1):
            b0 = c + sd * r * 0.85 * sx + [0, 0.1, 0]
            spikes.append(add(Prim('cone', k=0.04, a=b0, b=b0 + (sd * sx * 0.8 - d * 0.5 + [0, 0.25, 0]) * L, ra=0.08, rb=0.02)))
    return g, spikes


def main(out):
    t0 = time.time()
    M = anky_xform()
    # ---------- anky
    ga, spikes = build_anky()
    va, fa = ga.polygonize(100000)
    na = ga.normals(va)
    # osteoderm mask: nearest primitive is a spike
    body_prims = [p for p in ga.prims if p.op == 'add' and p not in spikes]
    db = np.min(np.stack([p.sdf(va) for p in body_prims], 1), 1)
    ds = np.min(np.stack([p.sdf(va) for p in spikes], 1), 1)
    spike_w = sm((db - ds) / 0.06)
    # place in the world
    va_w = va @ M.T
    na_w = na @ M.T
    print(f'anky {len(va)} verts ({time.time() - t0:.1f}s)')

    # ---------- terrain height field
    def h(x, z):
        base = 0.3 + 0.12 * sm(-z / B_) + 0.05 * np.sin(x * 1.3 + 0.5) * np.cos(z * 1.7)
        p = np.stack([x, np.zeros_like(x), z], 1)
        base = base + 0.05 * vnoise(p, 0.9, 3)
        # dirt pushed up around the carcass
        d = np.hypot(x - ANKY_POS[0], (z - ANKY_POS[2]) * 1.3)
        base = base + 0.16 * np.exp(-((d - 1.8) ** 2) / 0.8)
        # front rim slightly lower
        base = base - 0.06 * sm((z - B_ + 0.8) / 0.8)
        return base

    # sink the Ankylosaurus into the dirt
    dome_c, dome_r = np.array([0, 1.02, 0]), np.array([1.2, 0.72, 1.85])
    low = (M @ dome_c)[1] - np.sqrt(np.sum((M[1] * dome_r) ** 2))
    gx, gz = (M @ dome_c + ANKY_POS)[[0, 2]]
    lift = h(np.array([gx]), np.array([gz]))[0] - low - 0.28
    t_anky = ANKY_POS + np.array([0, lift, 0])
    va_w = va_w + t_anky
    # spot on the armoured back for the Indominus foot (local -> world)
    u = dome_r * (M.T @ np.array([0, 1.0, 0]))
    u = u / np.linalg.norm(u)
    top_local = dome_c + dome_r * u + np.array([0, 0, -0.45])
    foot_w = M @ top_local + t_anky
    hand_w = M @ np.array([0.7, 1.3, 1.0]) + t_anky

    terrain = Group('terrain', 0.03, noise=wave_noise(5, 0.012, [0.1, 0.2, 0.4]))

    class Ground(Prim):
        def __init__(self):
            self.kind, self.k, self.op, self.tag, self.bones = 'ground', 0.0, 'add', None, None
            self.lo = np.array([-A_ - 0.2, -0.2, -B_ - 0.2])
            self.hi = np.array([A_ + 0.2, 0.9, B_ + 0.2])

        def sdf(self, p):
            top = p[:, 1] - h(p[:, 0], p[:, 2])
            side = footprint(p[:, 0], p[:, 2])
            d = smax(side, top, 0.12)
            return np.maximum(d, -(p[:, 1] + 0.02))
    terrain.add(Ground())

    # ---------- rocks
    rocks = Group('rocks', 0.025, noise=None)
    rock_list = [((-4.3, 0.3, -1.25), (0.95, 0.75, 0.8), 0.4), ((-3.25, 0.25, 1.35), (0.55, 0.45, 0.5), -0.3),
                 ((4.75, 0.25, 1.15), (0.62, 0.5, 0.55), 0.9), ((4.15, 0.2, 1.8), (0.36, 0.3, 0.3), 0.2),
                 ((3.1, 0.35, -1.75), (0.75, 0.62, 0.6), -0.6), ((-1.0, 0.2, 1.9), (0.4, 0.3, 0.35), 0.1),
                 ((0.6, 0.25, -2.0), (0.5, 0.42, 0.42), 1.2)]
    for (c, r, yaw) in rock_list:
        R = np.array([[np.cos(yaw), 0, np.sin(yaw)], [0, 1, 0], [-np.sin(yaw), 0, np.cos(yaw)]])
        tilt = rot_from_dir([rng.uniform(-0.3, 0.3), rng.uniform(-0.2, 0.2), 1])
        cc = np.array(c, float); cc[1] = h(np.array([c[0]]), np.array([c[2]]))[0] + r[1] * 0.2
        rocks.add(Prim('box', k=0.12, c=cc, b=np.array(r) * 0.62, rr=min(r) * 0.25, R=R @ tilt))
        rocks.add(Prim('box', k=0.1, c=cc + R @ np.array([r[0] * 0.5, -r[1] * 0.25, r[2] * 0.35]), b=np.array(r) * 0.4, rr=min(r) * 0.2, R=R @ tilt.T))
        rocks.add(Prim('ellipsoid', k=0.15, c=cc + [0, -r[1] * 0.2, 0], r=np.array(r) * 0.8, R=R))
    for i in range(14):
        x = rng.uniform(-A_ + 0.6, A_ - 0.6); z = rng.uniform(-B_ + 0.5, B_ - 0.4)
        if np.hypot(x - ANKY_POS[0], z - ANKY_POS[2]) < 2.2 or footprint(np.array([x]), np.array([z]))[0] > -0.3:
            continue
        s = rng.uniform(0.07, 0.18)
        rocks.add(Prim('ellipsoid', k=0.03, c=[x, h(np.array([x]), np.array([z]))[0] + s * 0.2, z], r=[s * 1.3, s * 0.8, s]))
    rock_noise_a = wave_noise(8, 0.045, [0.25, 0.5, 1.0])

    def ridged(p):
        r = rock_noise_a(p)
        for k, a in ((np.array([2.1, 1.2, -1.6]), 0.06), (np.array([-1.0, 2.8, 2.0]), 0.045), (np.array([3.6, -1.5, 2.6]), 0.02)):
            r = r - a * np.abs(np.sin(p @ k))
        return r
    rocks.noise = ridged

    # ---------- moss cushions on rocks, terrain and spilling over the rim
    moss = Group('moss', 0.016, noise=wave_noise(13, 0.012, [0.03, 0.06, 0.12, 0.25]))
    vr, fr = rocks.polygonize(44000)
    nr = rocks.normals(vr)
    tops = vr[nr[:, 1] > 0.7]

    def cluster(c, n_blobs, spread, size, flat=0.35):
        for _ in range(n_blobs):
            o = np.array([rng.normal() * spread, 0, rng.normal() * spread])
            sz = size * rng.uniform(0.5, 1.0)
            moss.add(Prim('ellipsoid', k=0.05, c=c + o + [0, -sz * flat * 0.4, 0], r=[sz, sz * flat, sz * rng.uniform(0.7, 1.2)]))
    for i in range(min(16, len(tops))):
        p = tops[rng.integers(len(tops))]
        cluster(p, 6, 0.12, 0.16, 0.45)
    for i in range(40):
        x = rng.uniform(-A_ + 0.3, A_ - 0.3); z = rng.uniform(-B_ + 0.25, B_ - 0.25)
        if footprint(np.array([x]), np.array([z]))[0] > -0.2:
            continue
        if np.hypot(x - ANKY_POS[0], (z - ANKY_POS[2]) * 1.2) < 1.9:
            continue
        y = h(np.array([x]), np.array([z]))[0]
        cluster(np.array([x, y, z]), int(rng.integers(4, 9)), 0.22, 0.22, 0.3)
    # moss spilling over the rim
    for t in np.linspace(-1, 1, 11):
        if rng.uniform() < 0.4:
            continue
        x = t * (A_ - C_ - 0.2); z = B_ - 0.06
        y = h(np.array([x]), np.array([z]))[0]
        cluster(np.array([x, y - 0.05, z]), 5, 0.15, 0.2, 0.55)
    for sx in (1, -1):
        for t in (-0.5, 0.4):
            x = sx * (A_ - 0.06); z = t * (B_ - C_)
            y = h(np.array([x]), np.array([z]))[0]
            cluster(np.array([x, y - 0.05, z]), 5, 0.15, 0.2, 0.55)

    vt, ft = terrain.polygonize(70000)
    nt = terrain.normals(vt)
    vm, fm = moss.polygonize(44000)
    nm = moss.normals(vm)
    print(f'terrain {len(vt)} rocks {len(vr)} moss {len(vm)} ({time.time() - t0:.1f}s)')

    # ---------- colours with ambient occlusion from every object
    class AnkyWorld:
        def eval(self, p):
            q = (p - t_anky) @ M
            return ga.eval(q)
    aw = AnkyWorld()

    def scene_eval(p):
        return np.minimum.reduce([terrain.eval(p), rocks.eval(p), moss.eval(p), aw.eval(p)])

    def occl(v, n, d=0.25):
        o = np.clip(scene_eval(v + n * d) / d, 0, 1)
        o2 = np.clip(scene_eval(v + n * d * 2.5) / (d * 2.5), 0, 1)
        return 0.5 * o + 0.5 * o2

    dirt, dirt_dark, dirt_light = hexc('#4b3b2b'), hexc('#2c2219'), hexc('#76634a')
    nz = vnoise(vt, 2.5, 1)[:, None]
    ct = dirt * (1 + 0.25 * nz)
    damp = sm(vnoise(vt, 0.8, 2) * 1.5)[:, None]
    ct = ct * (1 - damp * 0.35) + dirt_dark * damp * 0.35
    grit = vnoise(vt, 9, 3)[:, None]
    ct = ct * (0.9 + 0.2 * grit)
    cover = sm((vnoise(vt, 1.3, 12) - 0.15) * 2.5) * sm((nt[:, 1] - 0.6) * 4) * sm((np.hypot(vt[:, 0] - ANKY_POS[0], (vt[:, 2] - ANKY_POS[2]) * 1.2) - 1.6) * 2)
    ct = ct * (1 - cover[:, None] * 0.7) + hexc('#3a4a1c') * cover[:, None] * 0.7
    ct = ct * (0.35 + 0.65 * occl(vt, nt)[:, None])
    side = (nt[:, 1] < 0.35)[:, None]
    ct = np.where(side, ct * 0.7, ct)

    rock, rock_dark = hexc('#7b7a72'), hexc('#45453f')
    cr = rock * (1 + 0.2 * vnoise(vr, 3, 4)[:, None])
    cr = cr * (1 - sm(-nr[:, 1:2] * 1.5) * 0.4) + rock_dark * sm(-nr[:, 1:2] * 1.5) * 0.4
    lichen = sm((vnoise(vr, 1.6, 9) + 0.1) * 3)[:, None] * sm((nr[:, 1:2] - 0.2) * 2.5)
    cr = cr * (1 - lichen * 0.75) + hexc('#3f5220') * lichen * 0.75
    cr = cr * (0.4 + 0.6 * occl(vr, nr, 0.15)[:, None])

    moss_a, moss_b, moss_c = hexc('#3a4f1c'), hexc('#6b7c2a'), hexc('#1f2e14')
    mz = vnoise(vm, 6, 5)[:, None]
    cm = moss_a * (1 - sm(mz * 1.5)) + moss_b * sm(mz * 1.5)
    cm = cm * (1 - sm(-mz * 2) * 0.5) + moss_c * sm(-mz * 2) * 0.5
    cm = cm * (0.5 + 0.5 * occl(vm, nm, 0.12)[:, None])

    sk_base, sk_dark, sk_belly, osteo = hexc('#55504a'), hexc('#2c2925'), hexc('#857a68'), hexc('#857a66')
    up_l = na[:, 1]
    ca = np.tile(sk_base, (len(va), 1)) * (1 + 0.22 * vnoise(va, 3, 6)[:, None])
    dors = sm((up_l - 0.1) / 0.7)[:, None]
    ca = ca * (1 - dors * 0.45) + sk_dark * dors * 0.45
    vent = sm((-up_l - 0.2) / 0.6)[:, None]
    ca = ca * (1 - vent * 0.6) + sk_belly * vent * 0.6
    sw = spike_w[:, None]
    ca = ca * (1 - sw * 0.75) + osteo * (0.85 + 0.3 * vnoise(va, 5, 7)[:, None]) * sw * 0.75
    # three claw rakes on the flank facing the viewer (old, dark wounds)
    for k in range(3):
        a = np.array([0.95, 0.55 + k * 0.17, 0.55]); b = np.array([0.88, 1.05 + k * 0.17, -0.25])
        ab = b - a
        t = np.clip(((va - a) @ ab) / (ab @ ab), 0, 1)
        d = np.linalg.norm(va - (a + np.outer(t, ab)), axis=1)
        m = sm((0.05 - d) / 0.03) * sm(t * 6) * sm((1 - t) * 4) * (va[:, 0] > 0.5)
        ca = ca * (1 - m[:, None] * 0.8) + hexc('#4a1712') * m[:, None] * 0.8
    ca = ca * (0.4 + 0.6 * occl(va_w, na_w, 0.2)[:, None])

    # ---------- plant spots: open dirt, away from carcass, rocks and the Indominus feet
    cand = vt[(nt[:, 1] > 0.8) & (footprint(vt[:, 0], vt[:, 2]) < -0.25)]
    cand = cand[rng.permutation(len(cand))]
    avoid = [(foot_w, 1.0), (np.array([-1.7, 0, -0.9]), 1.1)]
    ferns, small = [], []
    for p in cand:
        if aw.eval(p[None])[0] < 0.25 or rocks.eval(p[None])[0] < 0.08:
            continue
        if any(np.hypot(*(p - c)[[0, 2]]) < r for c, r in avoid):
            continue
        near_rock = rocks.eval(p[None])[0] < 0.6 or aw.eval(p[None])[0] < 0.7
        if len(ferns) < 16 and (near_rock or rng.uniform() < 0.25) and all(np.linalg.norm(p - f) > 1.0 for f in ferns):
            ferns.append(p)
        elif len(small) < 50 and all(np.linalg.norm(p - f) > 0.3 for f in small):
            small.append(p)
        if len(ferns) >= 16 and len(small) >= 50:
            break

    tuft = vm[nm[:, 1] > 0.55]
    tuft = tuft[rng.permutation(len(tuft))[:1400]]
    meshes = [
        dict(name='terrain', verts=vt, faces=ft, normals=nt, colors=ct, material=0),
        dict(name='rocks', verts=vr, faces=fr, normals=nr, colors=cr, material=1),
        dict(name='moss', verts=vm, faces=fm, normals=nm, colors=cm, material=2),
        dict(name='ankylosaurus', verts=va_w, faces=fa, normals=na_w, colors=ca, material=3),
    ]
    materials = [
        {'name': 'dirt', 'pbrMetallicRoughness': {'metallicFactor': 0, 'roughnessFactor': 0.95}},
        {'name': 'rock', 'pbrMetallicRoughness': {'metallicFactor': 0, 'roughnessFactor': 0.85}},
        {'name': 'moss', 'pbrMetallicRoughness': {'metallicFactor': 0, 'roughnessFactor': 1.0}},
        {'name': 'anky', 'pbrMetallicRoughness': {'metallicFactor': 0, 'roughnessFactor': 0.75}},
    ]
    gh = lambda x, z: float(h(np.array([x]), np.array([z]))[0])
    extras = {
        'footprint': {'A': A_, 'B': B_, 'C': C_},
        'footSpot': foot_w.tolist(), 'handSpot': hand_w.tolist(),
        'ankyCenter': (M @ np.array([0, 1.0, 0]) + t_anky).tolist(),
        'groundAt': {'-1.7,-0.9': gh(-1.7, -0.9), '-2.2,-0.6': gh(-2.2, -0.6), '-0.6,-0.4': gh(-0.6, -0.4), '0,0': gh(0, 0)},
        'ferns': [p.tolist() for p in ferns], 'plants': [p.tolist() for p in small], 'mossPoints': np.round(tuft, 3).tolist(),
        'heightSamples': {'step': 0.25, 'x0': -A_, 'z0': -B_,
                          'nx': int(2 * A_ / 0.25) + 1, 'nz': int(2 * B_ / 0.25) + 1},
    }
    xs = np.arange(extras['heightSamples']['nx']) * 0.25 - A_
    zs = np.arange(extras['heightSamples']['nz']) * 0.25 - B_
    X, Z = np.meshgrid(xs, zs, indexing='ij')
    extras['heightSamples']['h'] = np.round(h(X.ravel(), Z.ravel()), 3).tolist()
    write_static_glb(f'{out}/diorama.glb', meshes, materials, extras)
    print(f'wrote diorama.glb ({time.time() - t0:.1f}s)  ferns={len(ferns)} plants={len(small)} foot={foot_w.round(2)}')


if __name__ == '__main__':
    main(sys.argv[1])
