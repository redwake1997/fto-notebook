// FTO Notebook: moving a shift from phone to laptop with QR codes.
// Nothing goes over the internet. The shift is compressed, split into small parts,
// shown as a looping series of QR codes, and read back by the laptop's webcam.
//
// Part format:  FTN1:<transfer id>:<part>/<total>:<D|R>:<data>
//   D = deflate-compressed, base64url;  R = uncompressed, base64url
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FTOHandoff = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

const PREFIX = 'FTN1';
const PART_SIZE = 360; // characters of data per QR code: small codes scan reliably off a phone screen

function toB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
async function pipe(bytes, stream) {
  const s = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(s).arrayBuffer());
}
const canCompress = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

// Short check code both screens show, so the FTO can confirm the right shift arrived.
function checkCode(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return String(h % 10000).padStart(4, '0');
}

async function encode(shift) {
  const json = JSON.stringify(shift);
  const raw = new TextEncoder().encode(json);
  let mode = 'R';
  let bytes = raw;
  if (canCompress()) {
    try { bytes = await pipe(raw, new CompressionStream('deflate-raw')); mode = 'D'; } catch (e) { bytes = raw; mode = 'R'; }
  }
  const data = toB64url(bytes);
  const id = Math.random().toString(36).slice(2, 8);
  const total = Math.max(1, Math.ceil(data.length / PART_SIZE));
  const parts = [];
  for (let i = 0; i < total; i++) {
    parts.push(`${PREFIX}:${id}:${i + 1}/${total}:${mode}:${data.slice(i * PART_SIZE, (i + 1) * PART_SIZE)}`);
  }
  return { parts, code: checkCode(json), id };
}

// Collects scanned parts in any order. add() returns progress; finish() returns the shift.
function createReceiver() {
  let id = null;
  let total = 0;
  let mode = 'R';
  const got = new Map();
  return {
    add(text) {
      const m = /^FTN1:([a-z0-9]+):(\d+)\/(\d+):([DR]):(.*)$/s.exec(String(text || ''));
      if (!m) return { ok: false, reason: 'not-ours' };
      const [, pid, ps, ts, pm, data] = m;
      if (id && pid !== id) { got.clear(); } // a new transfer started: start over
      id = pid; total = Number(ts); mode = pm;
      got.set(Number(ps), data);
      return { ok: true, have: got.size, total, done: got.size === total };
    },
    progress() { return { have: got.size, total }; },
    async finish() {
      if (!total || got.size !== total) throw new Error('Not all parts received yet.');
      let data = '';
      for (let i = 1; i <= total; i++) data += got.get(i);
      let bytes = fromB64url(data);
      if (mode === 'D') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
      const json = new TextDecoder().decode(bytes);
      const shift = JSON.parse(json);
      return { shift, code: checkCode(json) };
    },
  };
}

return { encode, createReceiver, checkCode, PART_SIZE };
});
