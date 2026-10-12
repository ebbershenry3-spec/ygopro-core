// Fetches a GLB that is hosted base64-encoded as text (*.glb.b64.txt), with download progress.
// Plain *.glb URLs are fetched as binary.
const LUT = new Uint8Array(256);
'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.split('').forEach((c, i) => { LUT[c.charCodeAt(0)] = i; });

function decodeBase64(bytes) {
  // bytes: ASCII base64 as Uint8Array (no whitespace)
  let n = bytes.length;
  while (n > 0 && bytes[n - 1] === 61) n--; // '='
  const out = new Uint8Array(Math.floor((n * 3) / 4));
  let o = 0, i = 0;
  for (; i + 4 <= n; i += 4) {
    const a = LUT[bytes[i]], b = LUT[bytes[i + 1]], c = LUT[bytes[i + 2]], d = LUT[bytes[i + 3]];
    out[o++] = (a << 2) | (b >> 4); out[o++] = ((b & 15) << 4) | (c >> 2); out[o++] = ((c & 3) << 6) | d;
  }
  const rest = n - i;
  if (rest >= 2) { const a = LUT[bytes[i]], b = LUT[bytes[i + 1]]; out[o++] = (a << 2) | (b >> 4); if (rest === 3) { const c = LUT[bytes[i + 2]]; out[o++] = ((b & 15) << 4) | (c >> 2); } }
  return out.buffer.slice(0, o);
}

export async function fetchGLB(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const total = +res.headers.get('content-length') || 0;
  let bytes;
  if (res.body && total) {
    const reader = res.body.getReader();
    bytes = new Uint8Array(total);
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (got + value.length > bytes.length) { const b = new Uint8Array(Math.max(bytes.length * 2, got + value.length)); b.set(bytes); bytes = b; }
      bytes.set(value, got); got += value.length;
      onProgress && onProgress(got / total);
    }
    bytes = bytes.subarray(0, got);
  } else {
    bytes = new Uint8Array(await res.arrayBuffer());
    onProgress && onProgress(1);
  }
  return url.endsWith('.b64.txt') ? decodeBase64(bytes) : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
