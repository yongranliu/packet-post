// 把一个场景导出成标准 pcap 文件，可以直接用 Wireshark 打开。

const LINKTYPE_ETHERNET = 1;
const BASE_EPOCH = 1793790000; // 2026-11-04

export function pcapParts(frames) {
  const parts = [];
  const hdr = new DataView(new ArrayBuffer(24));
  hdr.setUint32(0, 0xa1b2c3d4, true);
  hdr.setUint16(4, 2, true);
  hdr.setUint16(6, 4, true);
  hdr.setUint32(16, 65535, true);
  hdr.setUint32(20, LINKTYPE_ETHERNET, true);
  parts.push(new Uint8Array(hdr.buffer));
  for (const f of frames) {
    const { bytes } = f.at(f.capture);
    const rec = new DataView(new ArrayBuffer(16));
    const ms = Math.round(f.time);
    rec.setUint32(0, BASE_EPOCH + Math.floor(ms / 1000), true);
    rec.setUint32(4, (ms % 1000) * 1000, true);
    rec.setUint32(8, bytes.length, true);
    rec.setUint32(12, bytes.length, true);
    parts.push(new Uint8Array(rec.buffer), bytes);
  }
  return parts;
}

export const toPcap = (frames) => new Blob(pcapParts(frames), { type: 'application/vnd.tcpdump.pcap' });
