import { icmp, icmpEcho, ipv4, assemble } from '../net/layers.js';
import { ascii } from '../net/bytes.js';
import { NODES, route } from '../world.js';

const wan = { client: [100, 350], router: [290, 230], isp: [490, 340], core: [680, 220], server: [885, 320] };
const data = ascii('abcdefghijklmnopqrstuvwabcdefghi');
const ID = 0x4d2;
const server = NODES.server;

const ping = (s, seq, ttl, o = {}) =>
  s.send({
    path: o.path ?? route('server'),
    dst: server.ip,
    sport: ID,
    ttl,
    kind: 'icmp',
    label: o.label ?? 'Echo 请求',
    info: `Echo request id=0x${ID.toString(16)} seq=${seq} ttl=${ttl}`,
    caption: o.caption,
    expires: o.expires,
    layers: (v) => s.ipLayers(v, 1, [icmpEcho({ id: v.sport, seq, data })]),
  });

const pong = (s, seq, o = {}) =>
  s.send({
    path: [...route('server')].reverse(),
    dport: ID,
    kind: 'icmp',
    label: o.label ?? 'Echo 应答',
    info: `Echo reply id=0x${ID.toString(16)} seq=${seq} ttl=61`,
    caption: o.caption,
    layers: (v) => s.ipLayers(v, 1, [icmpEcho({ reply: true, id: v.dport, seq, data })]),
  });

/** TTL 耗尽：路由器把出事的包的开头塞进退信寄回来 */
const expired = (s, from, seq, original) => {
  const path = route('server').slice(0, route('server').indexOf(from) + 1).reverse();
  return s.send({
    path,
    dport: ID,
    kind: 'icmp',
    label: 'TTL 耗尽',
    info: `Time-to-live exceeded，来自 ${NODES[from].ip}`,
    caption: `${NODES[from].label} 把 TTL 减到 0，丢掉了包，并报上自己的地址。`,
    layers: (v) => {
      const inner = assemble([ipv4({ src: v.dst, dst: server.ip, ttl: 1, proto: 1, id: original.ipId }), icmpEcho({ id: v.dport, seq, data })]).bytes;
      return s.ipLayers(v, 1, [icmp({ type: 11, code: 0, data: Array.from(inner.slice(0, 28)) })], { df: false });
    },
  });
};

export default {
  id: 'icmp',
  name: 'ICMP',
  full: 'Internet Control Message Protocol',
  cn: '互联网控制报文协议',
  layer: '网络层',
  port: '无端口，IP 协议号 1',
  transport: 'IP',
  rfc: 'RFC 792',
  stamp: '1',
  summary: 'IP 只管投递，出了事不吭声。ICMP 是网络的回执和退信：能不能通、卡在哪一跳、为什么送不到，全靠它。',
  metaphor: '一张“查无此人，退回寄件人”的黄色贴条，也是挂号信寄回来的回执。',
  scenarios: [
    {
      id: 'ping',
      title: 'ping 一下',
      positions: wan,
      intro: '在终端里敲下 `ping 192.0.2.80`。这是全世界用得最多的网络诊断命令。',
      build(s) {
        s.step('发出回显请求', 'ping 向目标发送 ICMP 类型 8，里面塞一段任意数据。路由器看到的只是一个普通 IP 包。出门时 TTL 是 64。', [
          ['ICMP 类型', '8 (Echo Request)'],
          ['初始 TTL', '64'],
        ]);
        ping(s, 1, 64, { caption: '点开这封信，试着切换下面的链路：看看 TTL 和 MAC 怎么变，源 IP 怎么被 NAT 改掉。' });

        s.step('原样弹回', '服务器把类型改成 0，数据一字不动地送回来。回程经过 3 个路由器，所以你收到时 TTL 是 61。', [
          ['ICMP 类型', '0 (Echo Reply)'],
          ['往返时间', '36 ms'],
        ]);
        s.ask('服务器的初始 TTL 是 64，中间有 3 个路由器。你收到回复时 TTL 是多少？', ['64', '61', '58'], 1, '每过一个路由器减 1。终端里看到的 ttl=61 其实在告诉你：对方离你 3 跳。常见的初始值有 64 (Linux/macOS)、128 (Windows)、255 (网络设备)。');
        pong(s, 1, { caption: 'ping 用发送和收到的时间差算出 RTT。' });

        s.step('再来一轮', 'ping 默认每秒发一次，序号递增。序号断了就是丢包，时间抖动就是网络不稳。', [['icmp_seq', '2']]);
        s.wait(964);
        ping(s, 2, 64, { caption: '第二个请求。' });
        pong(s, 2, { caption: '这一轮也回来了。0% 丢包。' });
        s.outro('ping 不通不代表主机挂了。很多服务器和防火墙会直接丢弃 ICMP，所以它只能证明“通”，不能证明“不通”。');
      },
    },
    {
      id: 'traceroute',
      title: 'traceroute',
      positions: wan,
      intro: '谁也不会告诉你路线图。traceroute 用了一个绝妙的办法：故意让包死在半路，逼路由器自报家门。',
      build(s) {
        const to = (n) => route('server').slice(0, route('server').indexOf(n) + 1);
        s.step('TTL = 1', '第一个包的 TTL 只有 1。到第一个路由器时减到 0，路由器必须丢包，并按规定发回一条 ICMP 超时。', [['这样得知', '第 1 跳的 IP']]);
        s.ask('TTL=1 的包到达第一个路由器时，会发生什么？', ['路由器转发它，TTL 变成 0', '路由器丢弃它，并发回 ICMP 超时', '路由器悄悄丢弃'], 1, 'RFC 要求丢包时回一条 Time Exceeded。这条“退信”的源 IP 就是路由器自己，traceroute 正是利用这一点把路线摸出来的。');
        expired(s, 'router', 1, ping(s, 1, 1, { path: to('router'), expires: true, label: 'TTL=1', caption: '只够走到第一个路由器。' }));

        s.step('TTL = 2', '把 TTL 加 1。这次能穿过第一跳，死在第二跳。', [['这样得知', '第 2 跳的 IP']]);
        expired(s, 'isp', 2, ping(s, 2, 2, { path: to('isp'), expires: true, label: 'TTL=2', caption: '多走一步。' }));

        s.step('TTL = 3', '继续加 1。每多走一步，路线图就多一格。', [['这样得知', '第 3 跳的 IP']]);
        expired(s, 'core', 3, ping(s, 3, 3, { path: to('core'), expires: true, label: 'TTL=3', caption: '再多走一步。' }));

        s.step('TTL = 4：到了', 'TTL 够用，包终于到达目的地。回来的不再是超时，而是 Echo Reply，traceroute 知道到头了。', [['结果', '4 跳到达']]);
        ping(s, 4, 4, { label: 'TTL=4', caption: '这次 TTL 够了。' });
        pong(s, 4, { caption: '回来的是应答，不是超时。追踪结束。' });
        s.outro('这里演示的是 Windows `tracert` 和 `traceroute -I` 的 ICMP 方式。Linux 默认用 UDP 探测高端口，靠“端口不可达”判断到头，原理一样。每跳实际会发 3 个探测包，看到的 `* * *` 代表那个路由器没回。');
      },
    },
    {
      id: 'unreachable',
      title: '主机不可达',
      fault: true,
      positions: wan,
      intro: '这次 ping 一个那边并不存在的地址 `192.0.2.99`。最后一个路由器会替它回话。',
      build(s) {
        const dead = '192.0.2.99';
        const path = ['client', 'router', 'isp', 'core'];
        s.step('送到了最后一站', '路由器一路转发，到骨干路由器时发现目标就在直连网段，却怎么也问不到它的 MAC。', [['目标', dead]]);
        const original = s.send({
          path,
          dst: dead,
          sport: ID,
          kind: 'icmp',
          expires: '到不了',
          label: 'Echo 请求',
          info: `Echo request → ${dead}`,
          caption: '骨干路由器发 ARP 询问，等了几秒没人应。',
          layers: (v) => s.ipLayers(v, 1, [icmpEcho({ id: v.sport, seq: 1, data })]),
        });
        s.wait(3000);
        s.step('退信', '路由器发回 ICMP 类型 3，代码 1：主机不可达。退信里带着原包的开头，你的系统才知道是哪个包出了事。', [
          ['ICMP 类型', '3 (Destination Unreachable)'],
          ['代码', '1 (Host)'],
        ]);
        s.send({
          path: [...path].reverse(),
          dport: ID,
          kind: 'icmp',
          label: '不可达',
          info: `Destination unreachable (Host)，来自 ${NODES.core.ip}`,
          caption: '和 ARP 失败时的本地错误不同，这封退信来自远方的路由器。',
          layers: (v) => {
            const inner = assemble([ipv4({ src: v.dst, dst: dead, ttl: 62, proto: 1, id: original.ipId }), icmpEcho({ id: v.dport, seq: 1, data })]).bytes;
            return s.ipLayers(v, 1, [icmp({ type: 3, code: 1, data: Array.from(inner.slice(0, 28)) })], { df: false });
          },
        });
        s.outro('ICMP 差错报文有个铁律：绝不为 ICMP 差错再产生差错，否则一个故障能引发报文风暴。');
      },
    },
  ],
};
