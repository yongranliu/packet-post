// 世界模型：有哪些设备、包走哪条路、每段链路上包长什么样。
// 关键想法：一个包不是一串固定字节。过路由器时 MAC 要换、TTL 要减，
// 过 NAT 时地址端口要改。所以每个包存的是“生成函数”，给定第几段链路，算出那一段的真实字节。

import { hashStr, hx, rng } from './net/bytes.js';
import { assemble, eth, ipv4, tcp, tcpOpt, udp } from './net/layers.js';

export const PUBLIC_IP = '203.0.113.7';

export const NODES = {
  client: { label: '你的电脑', ip: '192.168.1.10', mac: '3c:22:fb:5e:a1:07', icon: 'laptop', lan: true },
  printer: { label: '打印机', ip: '192.168.1.30', mac: '00:1b:a9:4d:2e:10', icon: 'printer', lan: true },
  intruder: { label: '被入侵的设备', ip: '192.168.1.66', mac: '02:de:ad:00:be:ef', icon: 'intruder', lan: true },
  switch: { label: '交换机', icon: 'switch', kind: 'switch', lan: true },
  router: { label: '家用路由器', ip: '192.168.1.1', wanIp: PUBLIC_IP, mac: 'a4:2b:b0:11:22:33', wanMac: 'a4:2b:b0:11:22:34', icon: 'router', kind: 'router', lan: true },
  isp: { label: '运营商路由器', ip: '198.51.100.1', icon: 'tower', kind: 'router' },
  core: { label: '骨干路由器', ip: '198.51.100.129', icon: 'core', kind: 'router' },
  server: { label: '网站服务器', ip: '192.0.2.80', mac: '52:54:00:9c:4f:80', icon: 'server' },
  resolver: { label: '公共 DNS', ip: '192.0.2.53', mac: '52:54:00:9c:4f:53', icon: 'book' },
  root: { label: '根服务器', ip: '198.41.0.4', icon: 'rootdns' },
  tld: { label: '.com 服务器', ip: '192.5.6.30', icon: 'tld' },
  auth: { label: '权威服务器', ip: '192.0.2.153', icon: 'auth' },
  mail: { label: '邮件服务器', ip: '192.0.2.25', mac: '52:54:00:9c:4f:25', icon: 'mail' },
  ntp: { label: '时间服务器', ip: '192.0.2.123', mac: '52:54:00:9c:4f:7b', icon: 'clock' },
};

/** 从你的电脑到某台服务器的路 */
export const route = (target) => ['client', 'router', 'isp', 'core', target];

const LATENCY = { 'client|switch': 0.3, 'switch|router': 0.3, 'switch|printer': 0.3, 'switch|intruder': 0.3, 'client|router': 1, 'router|isp': 4, 'isp|core': 7, 'core|server': 6, 'core|resolver': 3, 'core|mail': 6, 'core|ntp': 5, 'resolver|root': 12, 'resolver|tld': 16, 'resolver|auth': 9 };
const linkKey = (a, b) => [a, b].join('|');
const latency = (a, b) => LATENCY[linkKey(a, b)] ?? LATENCY[linkKey(b, a)] ?? 5;
export const pathLatency = (path) => path.slice(1).reduce((n, b, i) => n + latency(path[i], b), 0);

function ifaceMac(a, b) {
  const n = NODES[a];
  if (a === 'router') return NODES[b]?.lan ? n.mac : n.wanMac;
  if (n.mac) return n.mac;
  const h = hashStr(`${a}>${b}`);
  return ['02', 'a0', hx((h >>> 24) & 255), hx((h >>> 16) & 255), hx((h >>> 8) & 255), hx(h & 255)].join(':');
}

const natPort = (p) => ((p + 9000 - 1024) % 64511) + 1024;

/** 这个包在第 i 段链路上的外观 */
function viewAt(p, i) {
  const path = p.path;
  let a = i;
  let b = i + 1;
  while (NODES[path[a]].kind === 'switch') a--;
  while (NODES[path[b]].kind === 'switch') b++;
  const routersPassed = path.slice(1, i + 1).filter((n) => NODES[n].kind === 'router').length;

  let { src, dst, sport, dport } = p;
  const k = path.indexOf('router');
  if (k > 0 && k < path.length - 1) {
    const outbound = NODES[path[0]].lan && !NODES[path[path.length - 1]].lan;
    const inbound = NODES[path[path.length - 1]].lan && !NODES[path[0]].lan;
    if (outbound && i >= k) {
      src = PUBLIC_IP;
      sport = natPort(sport);
    }
    if (inbound && i < k) {
      dst = PUBLIC_IP;
      dport = natPort(dport);
    }
  }
  return {
    i,
    srcMac: ifaceMac(path[a], path[b]),
    dstMac: p.dstMac ?? ifaceMac(path[b], path[a]),
    src,
    dst,
    sport,
    dport,
    ttl: p.ttl - routersPassed,
    id: p.ipId,
  };
}

export class Script {
  constructor(seed = 'x') {
    this.frames = [];
    this.steps = [];
    this.t = 0;
    this.rand = rng(hashStr(seed));
    this.ipIdNext = 0x2c10 + (hashStr(seed) & 0xfff);
    this.pendingAsk = null;
    this.intro = '';
    this.outroText = '';
  }

  step(title, body, facts = []) {
    this.steps.push({ title, body, facts });
    return this;
  }
  ask(question, options, answer, why) {
    this.pendingAsk = { question, options, answer, why };
    return this;
  }
  wait(ms) {
    this.t += ms;
    return this;
  }
  outro(text) {
    this.outroText = text;
    return this;
  }

  /** 发一个包。layers 是一个函数：给定链路视图，返回从外到内的各层。 */
  send(spec) {
    const { path } = spec;
    const p = {
      path,
      src: spec.src ?? NODES[path[0]].ip,
      dst: spec.dst ?? NODES[path[path.length - 1]].ip,
      sport: spec.sport ?? 0,
      dport: spec.dport ?? 0,
      ttl: spec.ttl ?? 64,
      ipId: (this.ipIdNext += 7) & 0xffff,
      dstMac: spec.dstMac,
    };
    const lat = pathLatency(path);
    const toClient = path[path.length - 1] === 'client';
    const fromClient = path[0] === 'client';
    const cache = new Map();
    const frame = {
      n: this.frames.length,
      ipId: p.ipId,
      step: this.steps.length - 1,
      t: this.t,
      time: toClient ? this.t + lat : this.t,
      path,
      from: path[0],
      to: path[path.length - 1],
      label: spec.label,
      kind: spec.kind,
      info: spec.info,
      caption: spec.caption,
      also: spec.also ?? [],
      lost: spec.lost ?? null,
      expires: spec.expires === true ? 'TTL = 0' : spec.expires ?? null,
      ask: this.pendingAsk,
      links: path.length - 1,
      capture: fromClient ? 0 : toClient ? path.length - 2 : 0,
      at(i) {
        if (!cache.has(i)) cache.set(i, assemble(spec.layers(viewAt(p, i))));
        return cache.get(i);
      },
    };
    this.pendingAsk = null;
    frame.size = frame.at(frame.capture).bytes.length;
    this.frames.push(frame);
    this.t += spec.dt ?? lat;
    return frame;
  }

  /** IP 之上的通用外壳 */
  ipLayers(v, proto, upper, opts = {}) {
    return [eth({ dst: v.dstMac, src: v.srcMac }), ipv4({ src: v.src, dst: v.dst, ttl: v.ttl, proto, id: v.id, df: opts.df ?? true }), ...upper];
  }

  udp(spec) {
    return this.send({
      ...spec,
      layers: (v) => this.ipLayers(v, 17, [udp({ sport: v.sport, dport: v.dport }), spec.app(v)]),
    });
  }

  tcpFlow(opts) {
    return new TcpFlow(this, opts);
  }
}

/** 自动维护序号和确认号，保证每个 TCP 段的数字都对得上 */
export class TcpFlow {
  constructor(s, { path, sport, dport, label = 'TCP' }) {
    this.s = s;
    this.path = path;
    this.a = { port: sport, isn: s.rand.u32(), name: 'a' };
    this.b = { port: dport, isn: s.rand.u32(), name: 'b' };
    this.a.seq = this.a.isn;
    this.b.seq = this.b.isn;
    this.label = label;
  }

  /** side: 'a' 是发起方，'b' 是另一端 */
  seg(sideName, o = {}) {
    const me = this[sideName];
    const peer = sideName === 'a' ? this.b : this.a;
    const flags = o.flags ?? ['ACK'];
    const payload = o.payload ?? null;
    const plen = payload ? payload.encode([], null).b.length : 0;
    const hasAck = flags.includes('ACK');
    const seq = (o.seq ?? me.seq) >>> 0;
    const ack = hasAck ? (o.ack ?? peer.seq) >>> 0 : 0;
    const relSeq = (seq - me.isn) >>> 0;
    const relAck = hasAck ? (ack - peer.isn) >>> 0 : 0;
    const path = sideName === 'a' ? this.path : [...this.path].reverse();
    const fl = flags.join(', ');
    const info =
      o.info ?? `${me.port} → ${peer.port} [${fl}] Seq=${relSeq}${hasAck ? ` Ack=${relAck}` : ''}${plen ? ` Len=${plen}` : ''}`;
    const win = o.win ?? (sideName === 'a' ? 64240 : 65160);
    const options = o.options ?? [];
    const frame = this.s.send({
      path,
      sport: me.port,
      dport: peer.port,
      ttl: o.ttl,
      label: o.label ?? fl,
      kind: o.kind ?? 'tcp',
      info,
      caption: o.caption,
      lost: o.lost,
      dt: o.dt,
      layers: (v) =>
        this.s.ipLayers(v, 6, [
          tcp({ sport: v.sport, dport: v.dport, seq, ack, flags, win, options, rel: { seq: relSeq, ack: relAck } }),
          ...(payload ? [payload] : []),
        ]),
    });
    if (!o.noAdvance) {
      me.seq = (seq + plen + (flags.includes('SYN') || flags.includes('FIN') ? 1 : 0)) >>> 0;
    }
    return frame;
  }

  handshake(notes = {}) {
    const synOpts = [tcpOpt.mss(1460), tcpOpt.nop(), tcpOpt.wscale(7), tcpOpt.nop(), tcpOpt.nop(), tcpOpt.sackOk()];
    this.seg('a', { flags: ['SYN'], label: 'SYN', options: synOpts, caption: notes.syn ?? '发起方：我想建立连接，我的序号从这里开始。' });
    this.seg('b', { flags: ['SYN', 'ACK'], label: 'SYN-ACK', options: synOpts, caption: notes.synack ?? '服务器：收到，我也从这里开始。' });
    this.seg('a', { flags: ['ACK'], label: 'ACK', caption: notes.ack ?? '发起方：收到你的序号了。连接建立。' });
  }
}
