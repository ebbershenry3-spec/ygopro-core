"""Repacks GLB files for the web viewer.

- re-encodes embedded PNG textures as JPEG (max 2048 px)
- writes the result base64-encoded as <name>.glb.b64.txt (artifact hosting serves text, not .glb)

usage: python pack_web.py <in.glb> <out.glb.b64.txt> [max_texture_px]
"""
import base64
import io
import json
import struct
import sys

from PIL import Image


def read_glb(path):
    d = open(path, 'rb').read()
    magic, ver, length = struct.unpack('<III', d[:12])
    assert magic == 0x46546C67
    off, js, binc = 12, None, b''
    while off < len(d):
        cl, ct = struct.unpack('<II', d[off:off + 8])
        chunk = d[off + 8:off + 8 + cl]
        if ct == 0x4E4F534A:
            js = json.loads(chunk)
        elif ct == 0x004E4942:
            binc = chunk
        off += 8 + cl
    return js, binc


def write_glb(js, binc):
    jb = json.dumps(js, separators=(',', ':')).encode()
    while len(jb) % 4:
        jb += b' '
    while len(binc) % 4:
        binc += b'\0'
    total = 12 + 8 + len(jb) + 8 + len(binc)
    return (struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(jb), 0x4E4F534A) + jb
            + struct.pack('<II', len(binc), 0x004E4942) + binc)


def main(src, dst, max_px=2048):
    js, binc = read_glb(src)
    views = js.get('bufferViews', [])
    data = [binc[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']] for v in views]
    # which material slot uses each image -> pick a sensible JPEG quality
    usage = {}
    for m in js.get('materials', []):
        pbr = m.get('pbrMetallicRoughness', {})
        for key, q in (('baseColorTexture', 90), ('metallicRoughnessTexture', 86)):
            if key in pbr:
                usage[js['textures'][pbr[key]['index']]['source']] = q
        if 'normalTexture' in m:
            usage[js['textures'][m['normalTexture']['index']]['source']] = 93
    for i, img in enumerate(js.get('images', [])):
        if 'bufferView' not in img:
            continue
        im = Image.open(io.BytesIO(data[img['bufferView']])).convert('RGB')
        if max(im.size) > max_px:
            im = im.resize((max_px, max_px * im.size[1] // im.size[0]), Image.LANCZOS)
        out = io.BytesIO()
        im.save(out, 'JPEG', quality=usage.get(i, 88), optimize=True, progressive=False)
        data[img['bufferView']] = out.getvalue()
        img['mimeType'] = 'image/jpeg'
    # re-lay all buffer views
    blob = bytearray()
    for v, d in zip(views, data):
        while len(blob) % 4:
            blob.append(0)
        v['byteOffset'] = len(blob)
        v['byteLength'] = len(d)
        blob += d
    js['buffers'] = [{'byteLength': len(blob)}]
    glb = write_glb(js, bytes(blob))
    with open(dst, 'w') as fh:
        fh.write(base64.b64encode(glb).decode())
    print(f'{src}: {len(binc) / 1e6:.1f} MB -> glb {len(glb) / 1e6:.1f} MB -> {dst}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 2048)
