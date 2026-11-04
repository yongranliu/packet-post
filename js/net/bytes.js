// 字节工具：所有报文都由这里的 Writer 一个字段一个字段写出来，
// 写的同时记录每个字段的偏移和含义，界面才能做到“指哪个字段，亮哪段字节”。

export const enc = new TextEncoder();
export const ascii = (s) => Array.from(enc.encode(s));
export const ip4 = (s) => s.split('.').map(Number);
export const macBytes = (s) => s.split(':').map((x) => parseInt(x, 16));
export const be16 = (v) => [(v >>> 8) & 255, v & 255];
export const be24 = (v) => [(v >>> 16) & 255, (v >>> 8) & 255, v & 255];
export const be32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
export const hx = (v, w = 2) => v.toString(16).padStart(w, '0');
export const hexOf = (arr) => Array.from(arr, (b) => hx(b)).join(' ');

/** RFC 1071 互联网校验和 */
export function checksum(bytes) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 2) {
    sum += (bytes[i] << 8) + (i + 1 < bytes.length ? bytes[i + 1] : 0);
  }
  while (sum >>> 16) sum = (sum & 0xffff) + (sum >>> 16);
  return ~sum & 0xffff;
}

/** 确定性的伪随机数：同一场景每次生成的“随机”字节都一样，可复现 */
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.bytes = (n) => Array.from({ length: n }, () => Math.floor(next() * 256));
  next.u32 = () => Math.floor(next() * 4294967296) >>> 0;
  return next;
}

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Writer {
  constructor() {
    this.b = [];
    this.fields = [];
  }
  get pos() {
    return this.b.length;
  }
  put(label, arr, value, opts = {}) {
    const f = { label, off: this.b.length, len: arr.length, value: String(value), note: opts.note, bits: opts.bits };
    for (const x of arr) this.b.push(x & 255);
    this.fields.push(f);
    return f;
  }
  u8(label, v, o = {}) {
    return this.put(label, [v], o.show ?? v, o);
  }
  u16(label, v, o = {}) {
    return this.put(label, be16(v), o.show ?? v, o);
  }
  u32(label, v, o = {}) {
    return this.put(label, be32(v), o.show ?? v >>> 0, o);
  }
  ip(label, s, o = {}) {
    return this.put(label, ip4(s), s, o);
  }
  mac(label, s, o = {}) {
    return this.put(label, macBytes(s), s, o);
  }
  raw(label, arr, show, o = {}) {
    return this.put(label, arr, show ?? hexOf(arr.slice(0, 8)) + (arr.length > 8 ? ' …' : ''), o);
  }
  patch16(f, v, show) {
    this.b[f.off] = (v >>> 8) & 255;
    this.b[f.off + 1] = v & 255;
    f.value = String(show ?? v);
  }
}
