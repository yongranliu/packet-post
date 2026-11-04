// 各层协议的真实编码。每个函数返回一个“层”：
//   { id, name, encode(payload, outerLayer) -> Writer }
// assemble() 从最内层往外包，长度和校验和都是真算出来的。

import { Writer, ascii, be16, be24, be32, checksum, hx, ip4, macBytes } from './bytes.js';

export function assemble(layers) {
  let payload = [];
  const out = new Array(layers.length);
  for (let i = layers.length - 1; i >= 0; i--) {
    const L = layers[i];
    const w = L.encode(payload, layers[i - 1]);
    out[i] = { id: L.id, name: L.name, hint: L.hint, fields: w.fields, len: w.b.length };
    payload = w.b.concat(payload);
  }
  let off = 0;
  for (const l of out) {
    l.off = off;
    for (const f of l.fields) f.abs = off + f.off;
    off += l.len;
  }
  return { layers: out, bytes: Uint8Array.from(payload) };
}

/* ───────── 链路层 ───────── */

const ETHERTYPE = { 0x0800: 'IPv4', 0x0806: 'ARP' };

export const eth = ({ dst, src, type = 0x0800 }) => ({
  id: 'eth',
  name: '以太网帧',
  hint: '最外层的信封。只管“这一段链路”从哪块网卡到哪块网卡，每过一个路由器就换一个。',
  encode() {
    const w = new Writer();
    const bcast = dst === 'ff:ff:ff:ff:ff:ff';
    w.mac('目的 MAC', dst, {
      note: bcast ? '全 1 是广播地址：同一局域网里的每台设备都会收下这一帧。' : '这一段链路上，下一个接收者的网卡地址。不一定是最终目的地。',
    });
    w.mac('源 MAC', src, { note: '这一段链路上，发送者的网卡地址。' });
    w.u16('类型', type, {
      show: `0x${hx(type, 4)} (${ETHERTYPE[type] ?? '?'})`,
      note: '告诉接收方：拆开这层后，里面装的是什么协议。',
    });
    return w;
  },
});

export const arp = ({ op, sha, spa, tha, tpa }) => ({
  id: 'arp',
  name: 'ARP',
  hint: '没有 IP 层，直接装在以太网帧里，因为它要解决的问题就是“IP 对应哪个 MAC”。',
  encode() {
    const w = new Writer();
    w.u16('硬件类型', 1, { show: '1 (以太网)' });
    w.u16('协议类型', 0x0800, { show: '0x0800 (IPv4)' });
    w.u8('硬件地址长度', 6);
    w.u8('协议地址长度', 4);
    w.u16('操作码', op, { show: op === 1 ? '1 (请求)' : '2 (应答)', note: '1 是“谁有这个 IP？”，2 是“我有”。' });
    w.mac('发送方 MAC', sha);
    w.ip('发送方 IP', spa, { note: '收到的设备会顺手记下这对 IP 和 MAC。ARP 没有任何认证，这也是 ARP 欺骗的根源。' });
    w.mac('目标 MAC', tha, { note: op === 1 ? '正是要问的东西，所以请求里填全 0。' : '发起询问的那台设备。' });
    w.ip('目标 IP', tpa);
    return w;
  },
});

/* ───────── 网络层 ───────── */

const IPPROTO = { 1: 'ICMP', 6: 'TCP', 17: 'UDP' };

export const ipv4 = ({ src, dst, ttl = 64, proto, id = 0, df = true }) => ({
  id: 'ip',
  name: 'IPv4 数据报',
  hint: '端到端的地址。路由器看它决定下一跳，但一路上不会改写收件人（NAT 是例外）。',
  src,
  dst,
  proto,
  encode(payload) {
    const w = new Writer();
    w.u8('版本 + 首部长度', 0x45, {
      show: '0x45',
      bits: [
        ['版本', '4'],
        ['IHL', '5 (5 × 4 = 20 字节)'],
      ],
    });
    w.u8('服务类型', 0, { show: '0x00', note: 'DSCP + ECN，用来标记优先级和拥塞。普通流量全 0。' });
    w.u16('总长度', 20 + payload.length, { note: 'IP 首部加上里面所有内容的字节数。' });
    w.u16('标识', id, { show: `0x${hx(id, 4)}`, note: '分片时用来把碎片认回一个包。' });
    const flagsVal = df ? 0x4000 : 0;
    w.u16('标志 + 片偏移', flagsVal, {
      show: `0x${hx(flagsVal, 4)}`,
      bits: [
        ['DF 不分片', df ? '1' : '0'],
        ['MF 还有分片', '0'],
        ['片偏移', '0'],
      ],
    });
    w.u8('TTL', ttl, { note: '每过一个路由器减 1，减到 0 就丢弃，防止包在环路里转到天荒地老。' });
    w.u8('协议', proto, { show: `${proto} (${IPPROTO[proto] ?? '?'})`, note: '里面装的是什么。' });
    const ck = w.u16('首部校验和', 0, { note: '只覆盖 IP 首部。TTL 一变就得重算，所以每一跳都不一样。' });
    w.ip('源 IP', src);
    w.ip('目的 IP', dst);
    const c = checksum(w.b);
    w.patch16(ck, c, `0x${hx(c, 4)}`);
    return w;
  },
});

const ICMP_NAMES = {
  '0/0': 'Echo Reply',
  '8/0': 'Echo Request',
  '3/1': 'Destination Unreachable (Host)',
  '3/3': 'Destination Unreachable (Port)',
  '11/0': 'Time Exceeded (TTL)',
};

export const icmp = ({ type, code = 0, rest = [0, 0, 0, 0], restFields, data = [] }) => ({
  id: 'icmp',
  name: 'ICMP 报文',
  hint: '网络层自己的“回执和退信”，不搭载用户数据。',
  encode() {
    const w = new Writer();
    w.u8('类型', type, { show: `${type} (${ICMP_NAMES[`${type}/${code}`] ?? '?'})` });
    w.u8('代码', code);
    const ck = w.u16('校验和', 0, { note: '覆盖整个 ICMP 报文。' });
    if (restFields) restFields(w);
    else w.raw('未使用', rest, '00 00 00 00');
    if (data.length) {
      w.raw(type === 8 || type === 0 ? '数据' : '原始报文开头', data, undefined, {
        note:
          type === 8 || type === 0
            ? '回显请求的内容会被原样弹回来，发送方靠它确认收到的就是自己发的。'
            : '错误报文要把出事的包的 IP 首部和前 8 字节带回去，发送方才认得出是哪个连接的包。',
      });
    }
    const c = checksum(w.b);
    w.patch16(ck, c, `0x${hx(c, 4)}`);
    return w;
  },
});

export const icmpEcho = ({ reply = false, id, seq, data }) =>
  icmp({
    type: reply ? 0 : 8,
    data,
    restFields: (w) => {
      w.u16('标识符', id, { show: `0x${hx(id, 4)}`, note: '区分同一台机器上的多个 ping 进程。NAT 也靠它分辨谁是谁。' });
      w.u16('序号', seq, { note: 'ping 显示的 icmp_seq，用来发现丢包和乱序。' });
    },
  });

/* ───────── 传输层 ───────── */

function pseudo(outer, proto, len) {
  return [...ip4(outer.src), ...ip4(outer.dst), 0, proto, ...be16(len)];
}

export const udp = ({ sport, dport }) => ({
  id: 'udp',
  name: 'UDP 数据报',
  hint: '只有 8 字节首部：端口、长度、校验和，别的什么都不管。',
  encode(payload, outer) {
    const w = new Writer();
    w.u16('源端口', sport);
    w.u16('目的端口', dport);
    const len = 8 + payload.length;
    w.u16('长度', len);
    const ck = w.u16('校验和', 0, { note: '覆盖伪首部（源/目的 IP）、UDP 首部和数据。' });
    let c = checksum([...pseudo(outer, 17, len), ...w.b, ...payload]);
    if (c === 0) c = 0xffff;
    w.patch16(ck, c, `0x${hx(c, 4)}`);
    return w;
  },
});

export const tcpOpt = {
  mss: (v) => ({ bytes: [2, 4, ...be16(v)], label: 'MSS', value: `${v} 字节`, note: '告诉对方：我一次最多收这么多数据。1460 = 以太网 MTU 1500 − IP 20 − TCP 20。' }),
  nop: () => ({ bytes: [1], label: 'NOP', value: '填充', note: '让选项按 4 字节对齐。' }),
  wscale: (v) => ({ bytes: [3, 3, v], label: '窗口缩放', value: `× ${1 << v}`, note: '窗口字段只有 16 位，最大 64KB。这个选项把它放大，高速网络才跑得满。' }),
  sackOk: () => ({ bytes: [4, 2], label: 'SACK 许可', value: '支持', note: '允许“选择确认”：可以告诉对方具体缺哪一段，而不是只报最后连续的位置。' }),
  sack: (left, right, relLeft, relRight) => ({ bytes: [1, 1, 5, 10, ...be32(left), ...be32(right)], label: 'SACK', value: `已收到 ${relLeft}–${relRight}`, note: '“这一段我已经收到了。”发送方由此知道中间缺的是哪一块，只补那一块。' }),
};

const FLAG_BITS = { FIN: 1, SYN: 2, RST: 4, PSH: 8, ACK: 16 };

export const tcp = ({ sport, dport, seq, ack = 0, flags, win = 64240, options = [], rel }) => ({
  id: 'tcp',
  name: 'TCP 段',
  hint: '在不可靠的 IP 之上，用序号、确认和重传造出一条可靠的字节流。',
  encode(payload, outer) {
    const w = new Writer();
    const optBytes = options.flatMap((o) => o.bytes);
    if (optBytes.length % 4) throw new Error('TCP options must be 4-byte aligned');
    const hdrLen = 20 + optBytes.length;
    const fv = flags.reduce((a, f) => a | FLAG_BITS[f], 0);
    w.u16('源端口', sport);
    w.u16('目的端口', dport);
    w.u32('序号', seq, {
      show: rel ? `${seq >>> 0} (相对 ${rel.seq})` : seq >>> 0,
      note: '这一段第一个字节在字节流里的位置。初始值随机，界面用“相对序号”方便阅读，和 Wireshark 一样。',
    });
    w.u32('确认号', ack, {
      show: rel && flags.includes('ACK') ? `${ack >>> 0} (相对 ${rel.ack})` : ack >>> 0,
      note: '“我已连续收到这之前的全部字节，下一个想要这个位置。”',
    });
    const off = ((hdrLen / 4) << 12) | fv;
    w.u16('首部长度 + 标志', off, {
      show: `0x${hx(off, 4)} [${flags.join(', ')}]`,
      bits: [
        ['数据偏移', `${hdrLen / 4} (${hdrLen} 字节)`],
        ...Object.keys(FLAG_BITS)
          .reverse()
          .map((k) => [k, flags.includes(k) ? '1' : '0']),
      ],
    });
    w.u16('窗口', win, { note: '接收缓冲区还剩多少空间。发送方不能超过它，这就是流量控制。' });
    const ck = w.u16('校验和', 0, { note: '覆盖伪首部、TCP 首部和数据。NAT 改了 IP 或端口就要重算。' });
    w.u16('紧急指针', 0);
    for (const o of options) w.raw(`选项 ${o.label}`, o.bytes, o.value, { note: o.note });
    const c = checksum([...pseudo(outer, 6, hdrLen + payload.length), ...w.b, ...payload]);
    w.patch16(ck, c, `0x${hx(c, 4)}`);
    return w;
  },
});

/* ───────── DNS ───────── */

const QTYPE = { A: 1, NS: 2, CNAME: 5, SOA: 6, AAAA: 28 };
const RCODE = { 0: 'NOERROR', 3: 'NXDOMAIN' };

function nameBytes(name, table, base) {
  const labels = name.split('.').filter(Boolean);
  const out = [];
  for (let i = 0; i < labels.length; i++) {
    const suffix = labels.slice(i).join('.');
    if (table.has(suffix)) {
      const p = table.get(suffix);
      out.push(0xc0 | (p >> 8), p & 255);
      return out;
    }
    if (base + out.length < 0x3fff) table.set(suffix, base + out.length);
    const b = ascii(labels[i]);
    out.push(b.length, ...b);
  }
  out.push(0);
  return out;
}

export const dns = ({ id, response = false, aa = false, rd = true, ra = false, rcode = 0, q, answers = [], authority = [], additional = [] }) => ({
  id: 'dns',
  name: 'DNS 消息',
  hint: '问题和答案都放在同一种格式里。域名被拆成“长度 + 标签”，重复的部分用指针压缩。',
  encode() {
    const w = new Writer();
    const table = new Map();
    const flags = (response ? 0x8000 : 0) | (aa ? 0x0400 : 0) | (rd ? 0x0100 : 0) | (ra ? 0x0080 : 0) | rcode;
    w.u16('事务 ID', id, { show: `0x${hx(id, 4)}`, note: '问答靠它配对。应答必须带回相同的 ID。' });
    w.u16('标志', flags, {
      show: `0x${hx(flags, 4)}${response ? ` (${RCODE[rcode]})` : ''}`,
      bits: [
        ['QR', response ? '1 (应答)' : '0 (查询)'],
        ['AA 权威', aa ? '1' : '0'],
        ['RD 期望递归', rd ? '1' : '0'],
        ['RA 支持递归', ra ? '1' : '0'],
        ['RCODE', `${rcode} (${RCODE[rcode]})`],
      ],
    });
    w.u16('问题数', 1);
    w.u16('回答数', answers.length);
    w.u16('授权数', authority.length);
    w.u16('附加数', additional.length);
    const qb = nameBytes(q.name, table, w.pos);
    w.raw('问题 · 域名', qb, q.name, { note: '每段前面一个长度字节，以 0 结尾。' });
    w.u16('问题 · 类型', QTYPE[q.type], { show: `${QTYPE[q.type]} (${q.type})` });
    w.u16('问题 · 类', 1, { show: '1 (IN)' });
    const section = (title, list) => {
      list.forEach((r, i) => {
        const start = w.pos;
        const bytes = nameBytes(r.name, table, start);
        bytes.push(...be16(QTYPE[r.type]), ...be16(1), ...be32(r.ttl));
        const rdStart = start + bytes.length + 2;
        let rd2;
        let show;
        if (r.type === 'A') {
          rd2 = ip4(r.data);
          show = r.data;
        } else if (r.type === 'NS' || r.type === 'CNAME') {
          rd2 = nameBytes(r.data, table, rdStart);
          show = r.data;
        } else if (r.type === 'SOA') {
          rd2 = nameBytes(r.data.mname, table, rdStart);
          rd2.push(...nameBytes(r.data.rname, table, rdStart + rd2.length));
          for (const v of [r.data.serial, 7200, 3600, 1209600, r.data.minimum]) rd2.push(...be32(v));
          show = `${r.data.mname} 序列号 ${r.data.serial}`;
        }
        bytes.push(...be16(rd2.length), ...rd2);
        w.raw(`${title} ${i + 1}`, bytes, `${r.name} ${r.type} ${show} · TTL ${r.ttl}`, { note: r.note });
      });
    };
    section('回答', answers);
    section('授权', authority);
    section('附加', additional);
    return w;
  },
});

/* ───────── DHCP ───────── */

const DHCP_TYPE = { 1: 'Discover', 2: 'Offer', 3: 'Request', 5: 'ACK', 6: 'NAK' };

export const dhcpOpt = {
  type: (v) => ({ code: 53, name: '消息类型', data: [v], show: `${v} (${DHCP_TYPE[v]})`, note: 'DORA 四步靠这个选项区分。' }),
  clientId: (mac) => ({ code: 61, name: '客户端标识', data: [1, ...macBytes(mac)], show: mac }),
  hostname: (s) => ({ code: 12, name: '主机名', data: ascii(s), show: s }),
  requestIp: (s) => ({ code: 50, name: '请求的 IP', data: ip4(s), show: s }),
  serverId: (s) => ({ code: 54, name: '服务器标识', data: ip4(s), show: s, note: '广播的 Request 靠它告诉所有服务器“我选了谁”。' }),
  lease: (sec) => ({ code: 51, name: '租期', data: be32(sec), show: `${sec} 秒 (${sec / 3600} 小时)`, note: '地址是租的，不是送的。到一半时间客户端就会去续租。' }),
  mask: (s) => ({ code: 1, name: '子网掩码', data: ip4(s), show: s }),
  router: (s) => ({ code: 3, name: '默认网关', data: ip4(s), show: s }),
  dns: (...s) => ({ code: 6, name: 'DNS 服务器', data: s.flatMap(ip4), show: s.join(', ') }),
  prl: () => ({ code: 55, name: '参数请求列表', data: [1, 3, 6, 15, 51], show: '掩码, 网关, DNS, 域名, 租期', note: '客户端点菜：我还想要这些配置。' }),
  message: (s) => ({ code: 56, name: '消息', data: ascii(s), show: s }),
};

export const dhcp = ({ op, xid, flags = 0, ciaddr = '0.0.0.0', yiaddr = '0.0.0.0', siaddr = '0.0.0.0', chaddr, options }) => ({
  id: 'dhcp',
  name: 'DHCP 消息',
  hint: '定长的 BOOTP 老格式，后面接一串“选项”。真正有意思的都在选项里。',
  encode() {
    const w = new Writer();
    w.u8('操作', op, { show: op === 1 ? '1 (客户端请求)' : '2 (服务器回复)' });
    w.u8('硬件类型', 1, { show: '1 (以太网)' });
    w.u8('硬件地址长度', 6);
    w.u8('跳数', 0, { note: '经过中继时才会增加。' });
    w.u32('事务 ID', xid, { show: `0x${hx(xid, 8)}`, note: '客户端还没有 IP，只能靠它认领回复。' });
    w.u16('耗时', 0);
    w.u16('标志', flags, { show: `0x${hx(flags, 4)}`, note: '最高位是广播位：1 表示“回复请用广播，我还收不了单播”。' });
    w.ip('ciaddr 客户端 IP', ciaddr, { note: '客户端已经在用的地址，续租时才有值。' });
    w.ip('yiaddr 分配的 IP', yiaddr, { note: '服务器发给你的地址，“your IP”。' });
    w.ip('siaddr 服务器 IP', siaddr);
    w.ip('giaddr 中继 IP', '0.0.0.0');
    w.raw('chaddr 客户端 MAC', [...macBytes(chaddr), ...new Array(10).fill(0)], chaddr);
    w.raw('sname + file', new Array(192).fill(0), '全 0 (192 字节)', { note: 'BOOTP 时代给无盘启动留的字段，现在基本是空的。' });
    w.raw('魔数', [0x63, 0x82, 0x53, 0x63], '0x63825363', { note: '标记后面是 DHCP 选项。' });
    for (const o of options) {
      w.raw(`选项 ${o.code} ${o.name}`, [o.code, o.data.length, ...o.data], o.show, { note: o.note });
    }
    w.u8('选项结束', 255, { show: '255' });
    return w;
  },
});

/* ───────── NTP ───────── */

const NTP_EPOCH = 1793750400 + 2208988800; // 2026-11-04 00:00 UTC，从 1900 年算起

export const ntp = ({ mode, stratum = 0, origin = 0, recv = 0, xmit }) => ({
  id: 'ntp',
  name: 'NTP 消息',
  hint: '一问一答 48 字节，正是 UDP 擅长的事。',
  encode() {
    const w = new Writer();
    const first = (0 << 6) | (4 << 3) | mode;
    w.u8('LI + 版本 + 模式', first, {
      show: `0x${hx(first)}`,
      bits: [
        ['闰秒指示', '0'],
        ['版本', '4'],
        ['模式', mode === 3 ? '3 (客户端)' : '4 (服务器)'],
      ],
    });
    w.u8('层级', stratum, { note: '离原子钟有几层。1 是直接接时钟源。' });
    w.u8('轮询间隔', 6, { show: '6 (2⁶ = 64 秒)' });
    w.u8('精度', 0xec, { show: '−20 (约 1 微秒)' });
    w.u32('根延迟', 0);
    w.u32('根离散', 0);
    w.raw('参考 ID', stratum ? ascii('GPS\0') : [0, 0, 0, 0], stratum ? 'GPS' : '空');
    const ts = (label, off, note) => {
      const sec = off ? NTP_EPOCH + Math.floor(off / 1000) : 0;
      const frac = off ? Math.floor(((off % 1000) / 1000) * 4294967296) : 0;
      w.raw(label, [...be32(sec >>> 0), ...be32(frac >>> 0)], off ? `+${(off / 1000).toFixed(3)}s` : '0', { note });
    };
    ts('参考时间戳', stratum ? recv - 16000 : 0);
    ts('起始时间戳', origin, '客户端发出请求的时间，服务器原样抄回来。');
    ts('接收时间戳', recv, '服务器收到请求的时间。');
    ts('发送时间戳', xmit, '这个包发出的时间。四个时间一减，就能算出网络延迟和时钟偏差。');
    return w;
  },
});

/* ───────── 文本协议 ───────── */

const HTTP_NOTES = {
  host: '必填。一个 IP 上可以有很多网站，服务器靠它分辨你要哪个。',
  'user-agent': '客户端自报家门。',
  accept: '我能接受什么格式。',
  'accept-encoding': '我能解压什么。这里为了能读懂内容，服务器没有压缩。',
  connection: '这次用完要不要留着这条 TCP 连接。',
  'content-type': '正文是什么格式。浏览器靠它决定怎么处理，而不是靠网址后缀。',
  'content-length': '正文有多少字节。TCP 是字节流没有边界，HTTP 靠这个知道读到哪里算完。',
  location: '告诉浏览器去这个地址。',
  server: '服务器软件。',
  date: '服务器生成响应的时间。',
  'cache-control': '这份响应可以缓存多久。',
};

export const http = ({ name = 'HTTP 消息', start, startNote, headers, body = '' }) => ({
  id: 'http',
  name,
  hint: '纯文本。每行以 CRLF 结束，空行之后是正文。',
  encode() {
    const w = new Writer();
    const line = (label, s, o) => w.raw(label, ascii(`${s}\r\n`), s || '(空行)', o);
    line(/^HTTP\//.test(start) ? '状态行' : '请求行', start, { note: startNote });
    for (const [k, v] of headers) line(k, `${k}: ${v}`, { note: HTTP_NOTES[k.toLowerCase()] });
    line('空行', '', { note: '首部到此结束。' });
    if (body) w.raw('正文', ascii(body), `${ascii(body).length} 字节`, { note: 'Content-Length 算的就是这部分。' });
    return w;
  },
});

export const smtp = ({ text, note, name = 'SMTP 消息', label }) => ({
  id: 'smtp',
  name,
  hint: '一问一答的纯文本，可以用 telnet 手敲。',
  encode() {
    const w = new Writer();
    const lines = text.split('\r\n');
    if (lines[lines.length - 1] === '') lines.pop();
    lines.forEach((l, i) => {
      w.raw(label ?? (/^\d{3}[ -]/.test(l) ? `响应 ${l.slice(0, 3)}` : l.split(/[ :]/)[0] || '空行'), ascii(`${l}\r\n`), l || '(空行)', { note: i === 0 ? note : undefined });
    });
    return w;
  },
});

export const rawApp = ({ id = 'data', name = '应用数据', bytes, show, note }) => ({
  id,
  name,
  hint: 'TCP 只负责把字节送到，不关心它们是什么意思。',
  encode() {
    const w = new Writer();
    w.raw('数据', bytes, show, { note });
    return w;
  },
});

/* ───────── TLS 1.3 ───────── */

function recordHeader(w, type, typeName, version, len) {
  w.u8('记录类型', type, { show: `${type} (${typeName})` });
  w.u16('记录版本', version, { show: `0x${hx(version, 4)}`, note: '为了骗过老旧中间设备，这里永远写旧版本号。真实版本在 supported_versions 扩展里协商。' });
  w.u16('记录长度', len);
}

const ext = (type, name, data, show, note) => ({ type, name, data, show, note });
const extBytes = (e) => [...be16(e.type), ...be16(e.data.length), ...e.data];
const lenPrefixed16 = (a) => [...be16(a.length), ...a];

function writeExts(w, list) {
  w.u16('扩展总长度', list.reduce((n, e) => n + 4 + e.data.length, 0));
  for (const e of list) w.raw(`扩展 ${e.name}`, extBytes(e), e.show, { note: e.note });
}

export const tlsClientHello = ({ sni, random, sessionId, keyShare }) => (w) => {
  const name = ascii(sni);
  const exts = [
    ext(0, 'server_name', lenPrefixed16([0, ...lenPrefixed16(name)]), sni, '明文！窃听者看不到你访问的页面，但看得到你访问的域名。ECH 扩展正是为了解决这个问题。'),
    ext(10, 'supported_groups', lenPrefixed16([0, 0x1d, 0, 0x17]), 'x25519, secp256r1', '我支持这些密钥交换曲线。'),
    ext(13, 'signature_algorithms', lenPrefixed16([4, 3, 8, 4, 4, 1]), 'ecdsa_secp256r1_sha256, rsa_pss_rsae_sha256, rsa_pkcs1_sha256', '我能验证这些签名算法。'),
    ext(16, 'alpn', lenPrefixed16([8, ...ascii('http/1.1')]), 'http/1.1', '握手时顺便商量上层协议。'),
    ext(43, 'supported_versions', [2, 3, 4], 'TLS 1.3', '这里才是真正的版本。'),
    ext(51, 'key_share', lenPrefixed16([0, 0x1d, ...lenPrefixed16(keyShare)]), `x25519 公钥 (32 字节)`, 'TLS 1.3 的关键：第一条消息就把公钥发出去，所以只要 1 个往返。'),
  ];
  const extLen = exts.reduce((n, e) => n + 4 + e.data.length, 0);
  const suites = [0x1301, 0x1302, 0x1303];
  const bodyLen = 2 + 32 + 1 + sessionId.length + 2 + suites.length * 2 + 2 + 2 + extLen;
  recordHeader(w, 22, 'Handshake', 0x0301, bodyLen + 4);
  w.u8('握手类型', 1, { show: '1 (ClientHello)' });
  w.put('握手长度', be24(bodyLen), bodyLen);
  w.u16('legacy_version', 0x0303, { show: '0x0303 (TLS 1.2)', note: '历史包袱，真实版本看 supported_versions。' });
  w.raw('Random', random, undefined, { note: '32 字节随机数，让每次握手都不一样。' });
  w.u8('会话 ID 长度', sessionId.length);
  w.raw('会话 ID', sessionId, undefined, { note: 'TLS 1.3 不用它，随便填一个是为了长得像 1.2，好通过中间设备。' });
  w.u16('密码套件长度', suites.length * 2);
  w.raw('密码套件', suites.flatMap(be16), 'AES_128_GCM, AES_256_GCM, CHACHA20_POLY1305', { note: '我能用的加密算法，由服务器挑一个。' });
  w.u8('压缩方法长度', 1);
  w.u8('压缩方法', 0, { show: '0 (无)', note: '压缩会导致 CRIME 攻击，TLS 1.3 直接废除。' });
  writeExts(w, exts);
};

export const tlsServerHello = ({ random, sessionId, keyShare }) => (w) => {
  const exts = [
    ext(43, 'supported_versions', [3, 4], 'TLS 1.3'),
    ext(51, 'key_share', [0, 0x1d, ...lenPrefixed16(keyShare)], 'x25519 公钥 (32 字节)', '双方都有了对方的公钥，各自算出同一个共享密钥。从下一条开始全部加密。'),
  ];
  const extLen = exts.reduce((n, e) => n + 4 + e.data.length, 0);
  const bodyLen = 2 + 32 + 1 + sessionId.length + 2 + 1 + 2 + extLen;
  recordHeader(w, 22, 'Handshake', 0x0303, bodyLen + 4);
  w.u8('握手类型', 2, { show: '2 (ServerHello)' });
  w.put('握手长度', be24(bodyLen), bodyLen);
  w.u16('legacy_version', 0x0303, { show: '0x0303 (TLS 1.2)' });
  w.raw('Random', random);
  w.u8('会话 ID 长度', sessionId.length);
  w.raw('会话 ID', sessionId, undefined, { note: '把客户端的原样抄回来。' });
  w.u16('选定的密码套件', 0x1301, { show: '0x1301 (TLS_AES_128_GCM_SHA256)' });
  w.u8('压缩方法', 0, { show: '0 (无)' });
  writeExts(w, exts);
};

export const tlsCcs = () => (w) => {
  recordHeader(w, 20, 'ChangeCipherSpec', 0x0303, 1);
  w.u8('内容', 1, { show: '1', note: 'TLS 1.3 其实不需要它，发一个只是为了让中间设备以为这是 1.2。' });
};

export const tlsApp = ({ bytes, inside, label = '密文' }) => (w) => {
  recordHeader(w, 23, 'Application Data', 0x0303, bytes.length);
  w.raw(label, bytes, `${bytes.length} 字节密文`, { note: inside });
};

export const tls = (records, name = 'TLS 记录') => ({
  id: 'tls',
  name,
  hint: '记录层把内容切成带类型和长度的小块。握手完成后，外面只看得到“Application Data”和长度。',
  encode() {
    const w = new Writer();
    for (const r of records) r(w);
    return w;
  },
});
