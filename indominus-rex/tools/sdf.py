"""Tiny signed-distance-field sculpting kit + skinned GLB writer.

Creatures are described as smooth unions of primitives (ellipsoids, round cones),
polygonised with marching cubes, decimated, coloured and skinned to a simple
identity-oriented skeleton (+Z forward, +Y up, +X = creature's left).
"""
import json
import struct
import numpy as np
from skimage.measure import marching_cubes
import fast_simplification


# ---------------------------------------------------------------- primitives
def _norm(v):
    return np.sqrt(np.sum(v * v, axis=-1))


def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1 - h) + a * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def rot_from_dir(d, up=(0, 1, 0)):
    """3x3 matrix whose columns are a local frame with +Z along d."""
    d = np.asarray(d, float)
    d = d / np.linalg.norm(d)
    up = np.asarray(up, float)
    if abs(np.dot(up, d)) > 0.95:
        up = np.array([1.0, 0, 0])
    x = np.cross(up, d)
    x /= np.linalg.norm(x)
    y = np.cross(d, x)
    return np.stack([x, y, d], axis=1)


class Prim:
    def __init__(self, kind, k=0.1, op='add', bones=None, tag=None, **kw):
        self.kind, self.k, self.op, self.tag = kind, k, op, tag
        self.bones = bones  # dict bone->w  |  list of (t, {bone: w}) along the primitive axis | callable(p)->list of dicts
        self.__dict__.update(kw)
        if kind == 'ellipsoid':
            self.c = np.asarray(self.c, float)
            self.r = np.asarray(self.r, float)
            self.R = np.eye(3) if getattr(self, 'R', None) is None else np.asarray(self.R, float)
            ext = np.abs(self.R) @ self.r
            self.lo, self.hi = self.c - ext, self.c + ext
        elif kind == 'cone':
            self.a = np.asarray(self.a, float)
            self.b = np.asarray(self.b, float)
            m = max(self.ra, self.rb)
            self.lo = np.minimum(self.a, self.b) - m
            self.hi = np.maximum(self.a, self.b) + m
        elif kind == 'box':  # rounded box: centre c, half extents b, rounding rr, rotation R
            self.c = np.asarray(self.c, float)
            self.b = np.asarray(self.b, float)
            self.R = np.eye(3) if getattr(self, 'R', None) is None else np.asarray(self.R, float)
            ext = np.abs(self.R) @ (self.b + self.rr)
            self.lo, self.hi = self.c - ext, self.c + ext
        elif kind == 'plane':  # half space n.(p - p0) > 0 is removed
            self.n = np.asarray(self.n, float) / np.linalg.norm(self.n)
            self.p0 = np.asarray(self.p0, float)
            self.lo = np.full(3, -1e9)
            self.hi = np.full(3, 1e9)
        pad = self.k + 0.05
        self.lo = self.lo - pad
        self.hi = self.hi + pad

    def sdf(self, p):
        if self.kind == 'ellipsoid':
            q = (p - self.c) @ self.R
            k0 = _norm(q / self.r)
            k1 = _norm(q / (self.r * self.r))
            return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)
        if self.kind == 'cone':
            a, b, r1, r2 = self.a, self.b, self.ra, self.rb
            ba = b - a
            l2 = np.dot(ba, ba)
            rr = r1 - r2
            a2 = l2 - rr * rr
            il2 = 1.0 / l2
            pa = p - a
            y = pa @ ba
            z = y - l2
            v = pa * l2 - np.outer(y, ba)
            x2 = np.sum(v * v, axis=-1)
            y2 = y * y * l2
            z2 = z * z * l2
            k = np.sign(rr) * rr * rr * x2
            d1 = np.sqrt(x2 + z2) * il2 - r2
            d2 = np.sqrt(x2 + y2) * il2 - r1
            d3 = (np.sqrt(np.maximum(x2 * a2 * il2, 0)) + y * rr) * il2 - r1
            return np.where(np.sign(z) * a2 * z2 > k, d1, np.where(np.sign(y) * a2 * y2 < k, d2, d3))
        if self.kind == 'box':
            q = np.abs((p - self.c) @ self.R) - self.b
            outside = _norm(np.maximum(q, 0))
            inside = np.minimum(np.max(q, axis=1), 0)
            return outside + inside - self.rr
        if self.kind == 'plane':
            return (p - self.p0) @ self.n
        raise ValueError(self.kind)

    def axis_t(self, p):
        """parameter of p along the primitive axis (0..1)."""
        if self.kind == 'cone':
            ba = self.b - self.a
            return np.clip(((p - self.a) @ ba) / np.dot(ba, ba), 0, 1)
        if self.kind == 'ellipsoid':
            ax = self.R[:, 2]
            return np.clip(((p - self.c) @ ax) / (2 * self.r[2]) + 0.5, 0, 1)
        if self.kind == 'box':
            ax = self.R[:, 2]
            return np.clip(((p - self.c) @ ax) / (2 * (self.b[2] + self.rr)) + 0.5, 0, 1)
        return np.zeros(len(p))

    def bone_weights(self, p, nbones, name_to_idx):
        W = np.zeros((len(p), nbones))
        b = self.bones
        if b is None:
            return W
        if callable(b):
            return b(p, name_to_idx)
        if isinstance(b, dict):
            for name, w in b.items():
                W[:, name_to_idx[name]] += w
            return W
        # keyed along axis
        t = self.axis_t(p)
        ts = [kv[0] for kv in b]
        for i in range(len(b)):
            # hat function for key i
            if len(b) == 1:
                h = np.ones_like(t)
            elif i == 0:
                h = np.clip((ts[1] - t) / (ts[1] - ts[0]), 0, 1)
            elif i == len(b) - 1:
                h = np.clip((t - ts[i - 1]) / (ts[i] - ts[i - 1]), 0, 1)
            else:
                h = np.minimum(np.clip((t - ts[i - 1]) / (ts[i] - ts[i - 1]), 0, 1), np.clip((ts[i + 1] - t) / (ts[i + 1] - ts[i]), 0, 1))
            for name, w in b[i][1].items():
                W[:, name_to_idx[name]] += h * w
        return W


class Group:
    """A set of primitives that becomes one mesh."""

    def __init__(self, name, voxel, noise=None):
        self.name, self.voxel, self.prims, self.noise = name, voxel, [], noise

    def add(self, p):
        self.prims.append(p)
        return p

    def eval(self, p):
        F = np.full(len(p), 1e3)
        for pr in self.prims:
            m = np.all((p >= pr.lo) & (p <= pr.hi), axis=1)
            if not m.any():
                continue
            d = pr.sdf(p[m])
            if pr.op == 'add':
                F[m] = smin(F[m], d, pr.k)
            elif pr.op == 'sub':
                F[m] = smax(F[m], -d, pr.k)
            elif pr.op == 'clip':
                F[m] = smax(F[m], d, pr.k)
        if self.noise is not None:
            F = F + self.noise(p)
        return F

    def bounds(self):
        lo = np.min([p.lo for p in self.prims if p.op == 'add'], axis=0)
        hi = np.max([p.hi for p in self.prims if p.op == 'add'], axis=0)
        return lo, hi

    def polygonize(self, target_faces=None):
        lo, hi = self.bounds()
        h = self.voxel
        lo = lo - 2 * h
        hi = hi + 2 * h
        nx, ny, nz = (np.ceil((hi - lo) / h)).astype(int) + 1
        xs = lo[0] + np.arange(nx) * h
        ys = lo[1] + np.arange(ny) * h
        zs = lo[2] + np.arange(nz) * h
        F = np.full((nx, ny, nz), 1e3, dtype=np.float32)
        # evaluate each primitive only inside its window
        for pr in self.prims:
            if pr.op == 'clip':
                continue
            i0 = np.clip(np.searchsorted(xs, pr.lo[0]), 0, nx); i1 = np.clip(np.searchsorted(xs, pr.hi[0]) + 1, 0, nx)
            j0 = np.clip(np.searchsorted(ys, pr.lo[1]), 0, ny); j1 = np.clip(np.searchsorted(ys, pr.hi[1]) + 1, 0, ny)
            k0 = np.clip(np.searchsorted(zs, pr.lo[2]), 0, nz); k1 = np.clip(np.searchsorted(zs, pr.hi[2]) + 1, 0, nz)
            if i1 <= i0 or j1 <= j0 or k1 <= k0:
                continue
            X, Y, Z = np.meshgrid(xs[i0:i1], ys[j0:j1], zs[k0:k1], indexing='ij')
            P = np.stack([X.ravel(), Y.ravel(), Z.ravel()], axis=1)
            d = pr.sdf(P).reshape(X.shape)
            sub = F[i0:i1, j0:j1, k0:k1]
            if pr.op == 'add':
                F[i0:i1, j0:j1, k0:k1] = smin(sub, d, pr.k)
            else:
                F[i0:i1, j0:j1, k0:k1] = smax(sub, -d, pr.k)
        clips = [pr for pr in self.prims if pr.op == 'clip']
        if clips or self.noise is not None:
            X, Y, Z = np.meshgrid(xs, ys, zs, indexing='ij')
            P = np.stack([X.ravel(), Y.ravel(), Z.ravel()], axis=1)
            flat = F.ravel()
            near = np.abs(flat) < 0.5
            Pn = P[near]
            vals = flat[near]
            for pr in clips:
                vals = smax(vals, pr.sdf(Pn), pr.k)
            if self.noise is not None:
                vals = vals + self.noise(Pn)
            flat[near] = vals
            F = flat.reshape(F.shape)
        verts, faces, _, _ = marching_cubes(F, level=0.0, spacing=(h, h, h), gradient_direction='ascent')
        verts = verts + lo
        faces = faces.astype(np.int64)
        if target_faces and len(faces) > target_faces:
            red = 1.0 - target_faces / len(faces)
            verts, faces = fast_simplification.simplify(verts.astype(np.float32), faces.astype(np.int32), target_reduction=red, agg=5)
            verts = verts.astype(np.float64)
            faces = faces.astype(np.int64)
        # make sure faces wind outward (positive signed volume)
        v0, v1, v2 = verts[faces[:, 0]], verts[faces[:, 1]], verts[faces[:, 2]]
        vol = np.sum(np.einsum('ij,ij->i', v0, np.cross(v1, v2))) / 6
        if vol < 0:
            faces = faces[:, ::-1].copy()
        return verts, faces

    def normals(self, verts, eps=0.004):
        g = np.zeros_like(verts)
        for i in range(3):
            d = np.zeros(3)
            d[i] = eps
            g[:, i] = self.eval(verts + d) - self.eval(verts - d)
        n = g / np.maximum(_norm(g)[:, None], 1e-9)
        return n

    def skin(self, verts, bone_names, tau=0.05):
        idx = {n: i for i, n in enumerate(bone_names)}
        nb = len(bone_names)
        adds = [p for p in self.prims if p.op == 'add' and p.bones is not None]
        D = np.stack([p.sdf(verts) for p in adds], axis=1)
        dmin = D.min(axis=1, keepdims=True)
        infl = np.exp(-(D - dmin) / tau)
        infl[D - dmin > 6 * tau] = 0
        W = np.zeros((len(verts), nb))
        for j, p in enumerate(adds):
            m = infl[:, j] > 1e-4
            if not m.any():
                continue
            W[m] += infl[m, j:j + 1] * p.bone_weights(verts[m], nb, idx)
        # top 4
        order = np.argsort(-W, axis=1)[:, :4]
        top = np.take_along_axis(W, order, axis=1)
        top = top / np.maximum(top.sum(axis=1, keepdims=True), 1e-9)
        return order.astype(np.uint16), top.astype(np.float32)


# ---------------------------------------------------------------- noise
def wave_noise(seed, amp, wavelengths):
    rng = np.random.default_rng(seed)
    waves = []
    for wl in wavelengths:
        for _ in range(3):
            k = rng.normal(size=3)
            k = k / np.linalg.norm(k) * (2 * np.pi / wl)
            waves.append((k, rng.uniform(0, 2 * np.pi), amp * (wl / max(wavelengths)) ** 0.5))
    def f(p):
        out = np.zeros(len(p))
        for k, ph, a in waves:
            out += a * np.sin(p @ k + ph)
        return out / np.sqrt(len(waves))
    return f


# ---------------------------------------------------------------- simple meshes
def cone_mesh(base, tip, r, sides=6, rz=None):
    """cone from base centre to tip; returns verts, faces (outward)."""
    base = np.asarray(base, float); tip = np.asarray(tip, float)
    R = rot_from_dir(tip - base)
    rz = r if rz is None else rz
    ring = []
    for i in range(sides):
        a = 2 * np.pi * i / sides
        ring.append(base + R[:, 0] * np.cos(a) * r + R[:, 1] * np.sin(a) * rz)
    verts = np.array(ring + [tip, base])
    faces = []
    for i in range(sides):
        j = (i + 1) % sides
        faces.append([i, j, sides])
        faces.append([j, i, sides + 1])
    return verts, np.array(faces)


def vertex_normals(verts, faces):
    n = np.zeros_like(verts)
    fn = np.cross(verts[faces[:, 1]] - verts[faces[:, 0]], verts[faces[:, 2]] - verts[faces[:, 0]])
    for i in range(3):
        np.add.at(n, faces[:, i], fn)
    return n / np.maximum(_norm(n)[:, None], 1e-9)


# ---------------------------------------------------------------- GLB writer
class GLB:
    def __init__(self):
        self.bin = bytearray()
        self.views, self.accessors = [], []

    def _align(self):
        while len(self.bin) % 4:
            self.bin.append(0)

    def add(self, arr, comp, typ, target=None, normalized=False, minmax=False):
        self._align()
        data = np.ascontiguousarray(arr).tobytes()
        off = len(self.bin)
        self.bin += data
        view = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
        if target:
            view['target'] = target
        self.views.append(view)
        count = arr.shape[0]
        acc = {'bufferView': len(self.views) - 1, 'componentType': comp, 'count': int(count), 'type': typ}
        if normalized:
            acc['normalized'] = True
        if minmax:
            acc['min'] = [float(x) for x in arr.min(axis=0)]
            acc['max'] = [float(x) for x in arr.max(axis=0)]
        self.accessors.append(acc)
        return len(self.accessors) - 1


def write_skinned_glb(path, bones, prims, materials, extras=None):
    """bones: list of (name, parent_index or -1, world_pos)
    prims: list of dict(verts, faces, normals, colors(Nx3 0..1), joints(Nx4), weights(Nx4), material)
    materials: list of glTF material dicts."""
    g = GLB()
    nodes = []
    # bone nodes come first
    for i, (name, parent, wp) in enumerate(bones):
        wp = np.asarray(wp, float)
        local = wp - (np.asarray(bones[parent][2], float) if parent >= 0 else 0)
        nodes.append({'name': name, 'translation': [float(x) for x in local]})
    for i, (name, parent, wp) in enumerate(bones):
        if parent >= 0:
            nodes[parent].setdefault('children', []).append(i)
    ibm = np.zeros((len(bones), 16), np.float32)
    for i, (_, _, wp) in enumerate(bones):
        m = np.eye(4)
        m[:3, 3] = -np.asarray(wp, float)
        ibm[i] = m.T.ravel()  # column-major
    ibm_acc = g.add(ibm, 5126, 'MAT4')
    gl_prims = []
    for pr in prims:
        v = pr['verts'].astype(np.float32)
        n = pr['normals'].astype(np.float32)
        c = np.clip(pr['colors'] * 255 + 0.5, 0, 255).astype(np.uint8)
        c = np.concatenate([c, np.full((len(c), 1), 255, np.uint8)], axis=1)
        j = pr['joints'].astype(np.uint16)
        w = pr['weights'].astype(np.float32)
        f = pr['faces'].astype(np.uint32 if len(v) > 65535 else np.uint16).ravel()
        attrs = {
            'POSITION': g.add(v, 5126, 'VEC3', 34962, minmax=True),
            'NORMAL': g.add(n, 5126, 'VEC3', 34962),
            'COLOR_0': g.add(c, 5121, 'VEC4', 34962, normalized=True),
            'JOINTS_0': g.add(j, 5123, 'VEC4', 34962),
            'WEIGHTS_0': g.add(w, 5126, 'VEC4', 34962),
        }
        ind = g.add(f.reshape(-1, 1), 5125 if f.dtype == np.uint32 else 5123, 'SCALAR', 34963)
        gl_prims.append({'attributes': attrs, 'indices': ind, 'material': pr['material']})
    mesh_node = len(nodes)
    nodes.append({'name': 'body', 'mesh': 0, 'skin': 0})
    root_node = len(nodes)
    nodes.append({'name': 'root', 'children': [mesh_node, 0]})
    gltf = {
        'asset': {'version': '2.0', 'generator': 'indominus-fight sdf sculptor', 'extras': extras or {}},
        'scene': 0,
        'scenes': [{'nodes': [root_node]}],
        'nodes': nodes,
        'meshes': [{'name': 'body', 'primitives': gl_prims}],
        'skins': [{'joints': list(range(len(bones))), 'inverseBindMatrices': ibm_acc, 'skeleton': 0}],
        'materials': materials,
        'buffers': [{'byteLength': 0}],
        'bufferViews': g.views,
        'accessors': g.accessors,
    }
    g._align()
    gltf['buffers'][0]['byteLength'] = len(g.bin)
    js = json.dumps(gltf, separators=(',', ':')).encode()
    while len(js) % 4:
        js += b' '
    total = 12 + 8 + len(js) + 8 + len(g.bin)
    with open(path, 'wb') as fh:
        fh.write(struct.pack('<III', 0x46546C67, 2, total))
        fh.write(struct.pack('<II', len(js), 0x4E4F534A))
        fh.write(js)
        fh.write(struct.pack('<II', len(g.bin), 0x004E4942))
        fh.write(bytes(g.bin))


def write_static_glb(path, meshes, materials, extras=None):
    """meshes: list of dict(name, verts, faces, normals, colors(Nx3 linear 0..1), material)"""
    g = GLB()
    gl_meshes, nodes = [], []
    for m in meshes:
        v = m['verts'].astype(np.float32)
        n = m['normals'].astype(np.float32)
        c = np.clip(m['colors'] * 255 + 0.5, 0, 255).astype(np.uint8)
        c = np.concatenate([c, np.full((len(c), 1), 255, np.uint8)], axis=1)
        f = m['faces'].astype(np.uint32 if len(v) > 65535 else np.uint16).ravel()
        attrs = {
            'POSITION': g.add(v, 5126, 'VEC3', 34962, minmax=True),
            'NORMAL': g.add(n, 5126, 'VEC3', 34962),
            'COLOR_0': g.add(c, 5121, 'VEC4', 34962, normalized=True),
        }
        ind = g.add(f.reshape(-1, 1), 5125 if f.dtype == np.uint32 else 5123, 'SCALAR', 34963)
        gl_meshes.append({'name': m['name'], 'primitives': [{'attributes': attrs, 'indices': ind, 'material': m['material']}]})
        nodes.append({'name': m['name'], 'mesh': len(gl_meshes) - 1})
    gltf = {
        'asset': {'version': '2.0', 'generator': 'indominus-rex sdf sculptor', 'extras': extras or {}},
        'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}], 'nodes': nodes, 'meshes': gl_meshes,
        'materials': materials, 'buffers': [{'byteLength': 0}], 'bufferViews': g.views, 'accessors': g.accessors,
    }
    g._align()
    gltf['buffers'][0]['byteLength'] = len(g.bin)
    js = json.dumps(gltf, separators=(',', ':')).encode()
    while len(js) % 4:
        js += b' '
    total = 12 + 8 + len(js) + 8 + len(g.bin)
    with open(path, 'wb') as fh:
        fh.write(struct.pack('<III', 0x46546C67, 2, total))
        fh.write(struct.pack('<II', len(js), 0x4E4F534A))
        fh.write(js)
        fh.write(struct.pack('<II', len(g.bin), 0x004E4942))
        fh.write(bytes(g.bin))
