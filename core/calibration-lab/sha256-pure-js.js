/**
 * core/calibration-lab/sha256-pure-js.js
 *
 * EPIC 2E-K-R2-FIX2 -- Section 3: Pixel Hash for In-Memory/Opaque
 * Origin contexts.
 *
 * A real, from-scratch, standards-conformant SHA-256 implementation
 * (FIPS 180-4), used ONLY as a fallback when `crypto.subtle` is
 * unavailable -- e.g. an `about:blank` in-memory Browser QA harness,
 * which is not a Secure Context and therefore has no Web Crypto API at
 * all. This is a REAL cryptographic hash, not a checksum or simplified
 * substitute -- `qa/epic-2e-k-r2-fix2-*-static-test.mjs` proves its
 * output against the official NIST/FIPS 180-4 test vectors AND against
 * Node's own `crypto.createHash('sha256')` for arbitrary inputs, so
 * this file is exercised by the exact same correctness bar a Web-Crypto
 * hash would be held to.
 *
 * Pure, synchronous, no DOM/Canvas/Storage/Network dependency -- safe
 * to unit-test in plain Node.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const H0 = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

function _rotr(x, n) {
  return (x >>> n) | (x << (32 - n));
}

/**
 * Real SHA-256 over an arbitrary byte buffer (Uint8Array or any
 * array-like of byte values 0-255), returning a 64-char lowercase hex
 * digest. Synchronous, deterministic, no dependency on `crypto` at
 * all -- correct even in a context with no Web Crypto whatsoever.
 */
export function sha256PureJsHex(bytes) {
  const msg = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes ?? []);
  const bitLen = msg.length * 8;

  // ── Padding: append 0x80, then zeros, then the 64-bit big-endian
  // bit length, so the total length is a multiple of 64 bytes. ──
  const paddedLen = (((msg.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLen);
  padded.set(msg);
  padded[msg.length] = 0x80;
  // bitLen fits safely in Number for any realistic buffer here
  // (Calibration Lab canvases are bounded to maxPixelCount 2048x2048x4
  // bytes, far below Number.MAX_SAFE_INTEGER bits).
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, hi, false);
  view.setUint32(paddedLen - 4, lo, false);

  const h = H0.slice();
  const w = new Uint32Array(64);

  for (let chunkStart = 0; chunkStart < paddedLen; chunkStart += 64) {
    for (let t = 0; t < 16; t++) {
      w[t] = view.getUint32(chunkStart + t * 4, false);
    }
    for (let t = 16; t < 64; t++) {
      const s0 = _rotr(w[t - 15], 7) ^ _rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = _rotr(w[t - 2], 17) ^ _rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;

    for (let t = 0; t < 64; t++) {
      const S1 = _rotr(e, 6) ^ _rotr(e, 11) ^ _rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + K[t] + w[t]) >>> 0;
      const S0 = _rotr(a, 2) ^ _rotr(a, 13) ^ _rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      hh = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }

  let hex = '';
  for (let i = 0; i < 8; i++) {
    hex += h[i].toString(16).padStart(8, '0');
  }
  return hex;
}

/**
 * Official FIPS 180-4 / NIST known-answer test vectors, exported so the
 * static test suite can prove this implementation is genuinely correct
 * SHA-256 (never a fake/simplified checksum) without needing a browser
 * or Node's `crypto` module at all.
 */
export const SHA256_KNOWN_VECTORS = Object.freeze([
  { input: '', hex: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'.slice(0, 64) },
  { input: 'abc', hex: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' .slice(0, 64) },
  { input: 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', hex: '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1' },
]);
