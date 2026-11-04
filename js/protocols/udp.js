import { assemble, icmp, ipv4, ntp, udp } from '../net/layers.js';
import { NODES, route } from '../world.js';

const wan = { client: [100, 350], router: [290, 230], isp: [490, 340], core: [680, 220], ntp: [885, 320] };
const SP = 41017;
const T0 = 20000;

const req = (s, o = {}) =>
  s.udp({
    path: route('ntp'),
    sport: SP,
    dport: o.dport ?? 123,
    kind: 'udp',
    label: o.label ?? 'NTP 请求',
    info: `${SP} → ${o.dport ?? 123} NTP 客户端请求 Len=48`,
    app: () => ntp({ mode: 3, xmit: o.xmit ?? T0 }),
    ...o,
  });

export default {
  id: 'udp',
  name: 'UDP',
  full: 'User Datagram Protocol',
  cn: '用户数据报协议',
  layer: '传输层',
  port: '由应用决定',
  transport: 'IP (协议号 17)',
  rfc: 'RFC 768',
  stamp: '17',
  summary: '只比 IP 多了端口号。没有连接、没有确认、没有重传。够快够简单，可靠性交给应用自己决定。',
  metaphor: '明信片：写上地址丢进邮筒就走，不知道到没到，也不需要先打电话约好。',
  scenarios: [
    {
      id: 'normal',
      title: '一问一答',
      positions: wan,
      intro: '你的电脑要校准时钟。NTP 就是 UDP 的典型客户：一个小问题，一个小回答。',
      build(s) {
        s.step('直接发', '没有握手，第一个包里就是数据。首部只有 8 字节：源端口、目的端口、长度、校验和。', [
          ['首部开销', '8 字节 (TCP 至少 20)'],
          ['握手', '无'],
        ]);
        s.ask('校时前要先和服务器建立连接吗？', ['要，先三次握手', '不用，第一个包就带数据', '要，但只需两次'], 1, 'UDP 没有连接的概念。这也是 DNS、NTP、游戏、视频通话选择它的原因：省下一个往返。');
        req(s, { caption: '48 字节的 NTP 请求，直接上路。看看 UDP 首部多短。' });

        s.step('直接回', '服务器填好时间戳寄回来。它不记得你，下次你再来，它也当是第一次见。', [['服务器状态', '无']]);
        s.udp({
          path: [...route('ntp')].reverse(),
          sport: 123,
          dport: SP,
          kind: 'udp',
          label: 'NTP 响应',
          info: `123 → ${SP} NTP 服务器响应 Len=48`,
          caption: '四个时间戳一减，就算出了你的时钟快了还是慢了。',
          app: () => ntp({ mode: 4, stratum: 1, origin: T0, recv: T0 + 17, xmit: T0 + 18 }),
        });
        s.outro('整个过程只有两个包。同样的事情换成 TCP，光握手和挥手就要六七个包。');
      },
    },
    {
      id: 'lost',
      title: '丢了就丢了',
      fault: true,
      positions: wan,
      intro: '这次 NTP 请求在骨干网上丢了，比如路由器队列满了。UDP 会怎么办？',
      build(s) {
        s.step('半路消失', '路由器拥塞时会直接丢包，不通知任何人。UDP 没有确认机制，协议层完全不知道发生了什么。', [['协议层反应', '无']]);
        s.ask('UDP 发现包丢了之后，会怎么做？', ['自动重传', '发 ICMP 通知对方', '什么都不做，也不知道丢了'], 2, 'UDP 没有序号和确认，它连“丢了”这件事都不知道。');
        req(s, { lost: { link: 2, at: 0.55 }, caption: '包在第三段链路上消失了。没有人会告诉发送方。' });

        s.wait(1000);
        s.step('应用自己想办法', '等待超时的是 NTP 程序，不是 UDP。程序决定重发一次，操作系统把它当成全新的数据报。', [
          ['超时判断方', '应用程序'],
          ['可靠性', '由应用实现'],
        ]);
        req(s, { label: '应用重发', xmit: T0 + 1000, caption: '对 UDP 来说这是一个全新的包，它不知道这是“重发”。' });
        s.udp({
          path: [...route('ntp')].reverse(),
          sport: 123,
          dport: SP,
          kind: 'udp',
          label: 'NTP 响应',
          info: `123 → ${SP} NTP 服务器响应 Len=48`,
          caption: '这次成功了。',
          app: () => ntp({ mode: 4, stratum: 1, origin: T0 + 1000, recv: T0 + 1017, xmit: T0 + 1018 }),
        });
        s.outro('这正是分层的智慧：不是所有应用都需要可靠。视频通话里一帧丢了就丢了，重传回来也过期了。QUIC 则是在 UDP 上面自己造了一套比 TCP 更新的可靠传输，HTTP/3 就跑在它上面。');
      },
    },
    {
      id: 'closed',
      title: '端口没开',
      fault: true,
      positions: { client: [100, 350], router: [290, 230], isp: [490, 340], core: [680, 220], ntp: [885, 320] },
      intro: 'UDP 没有连接，那怎么知道对方端口没开？这次发到一个没人监听的端口 `9999`。',
      build(s) {
        const dport = 9999;
        s.step('敲错门', '包顺利到达服务器，但 9999 端口没有程序在听。', [['目的端口', dport]]);
        const original = req(s, { dport, label: '发往 9999', caption: '服务器内核收到后，发现没有 socket 绑定这个端口。' });
        s.step('ICMP 代为退信', 'UDP 自己没法回话，于是由 ICMP 发回“端口不可达”。TCP 遇到同样的情况会回 RST。', [
          ['ICMP 类型/代码', '3 / 3 (Port Unreachable)'],
        ]);
        s.send({
          path: [...route('ntp')].reverse(),
          dport: SP,
          kind: 'icmp',
          label: '端口不可达',
          info: `Destination unreachable (Port) ${NODES.ntp.ip}:${dport}`,
          caption: '退信里带着原始包的 IP 首部和 UDP 首部，内核靠它找到是哪个 socket。',
          layers: (v) => {
            const inner = assemble([ipv4({ src: v.dst, dst: NODES.ntp.ip, ttl: 61, proto: 17, id: original.ipId }), udp({ sport: v.dport, dport }), ntp({ mode: 3, xmit: T0 })]).bytes;
            return s.ipLayers(v, 1, [icmp({ type: 3, code: 3, data: Array.from(inner.slice(0, 28)) })], { df: false });
          },
        });
        s.outro('如果中间的防火墙把这条 ICMP 拦了，发送方就什么也收不到。这也是为什么 UDP 端口扫描又慢又不准：“没回应”可能是开着，也可能是被过滤。');
      },
    },
  ],
};
