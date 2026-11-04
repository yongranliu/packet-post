import { arp, eth, icmpEcho } from '../net/layers.js';
import { ascii } from '../net/bytes.js';
import { NODES } from '../world.js';

const BCAST = 'ff:ff:ff:ff:ff:ff';
const ZERO = '00:00:00:00:00:00';
const { client, router, intruder } = NODES;

const lan = { client: [150, 350], switch: [470, 260], router: [810, 130], printer: [810, 400] };
const pingData = ascii('abcdefghijklmnopqrstuvwabcdefghi');

function askFor(s, targetIp, opts = {}) {
  return s.send({
    path: ['client', 'switch', 'router'],
    also: [['client', 'switch', 'printer']],
    dstMac: BCAST,
    kind: 'arp',
    label: '谁有这个 IP？',
    info: `Who has ${targetIp}? Tell ${client.ip}`,
    layers: (v) => [eth({ dst: BCAST, src: v.srcMac, type: 0x0806 }), arp({ op: 1, sha: client.mac, spa: client.ip, tha: ZERO, tpa: targetIp })],
    ...opts,
  });
}

export default {
  id: 'arp',
  name: 'ARP',
  full: 'Address Resolution Protocol',
  cn: '地址解析协议',
  layer: '链路层',
  port: '无，直接装在以太网帧里',
  transport: '以太网 (0x0806)',
  rfc: 'RFC 826',
  stamp: '0806',
  summary: 'IP 地址是逻辑上的门牌号，但网线上的帧只认网卡的 MAC 地址。ARP 负责在局域网里把 IP 换成 MAC。',
  metaphor: '邮递员知道“3 栋 201”，但不知道住户长什么样，于是站在楼下喊一声，住户探头回应。',
  scenarios: [
    {
      id: 'normal',
      title: '喊一嗓子',
      positions: lan,
      intro: '你的电脑刚连上网，ARP 缓存是空的。它想给网关 `192.168.1.1` 发第一个包。',
      build(s) {
        s.step('广播询问', '电脑知道网关的 IP，却不知道它的 MAC，这个帧没法封口。只好向全网广播：谁是 `192.168.1.1`？', [
          ['目的 MAC', BCAST],
          ['走向', '交换机泛洪到所有端口'],
        ]);
        s.ask('电脑还不知道网关的 MAC。这个 ARP 请求的目的 MAC 该填什么？', ['全 0：00:00:00:00:00:00', '全 1：ff:ff:ff:ff:ff:ff', '网关的 IP 地址'], 1, '以太网里全 1 是广播地址，局域网里每块网卡都会收下。全 0 出现在 ARP 内容的“目标 MAC”字段里，表示“这正是我要问的”，但它不是一个能发送的帧地址。');
        askFor(s, router.ip, { caption: '交换机不认识全 1 这个地址，于是把帧复制到每个端口。打印机也收到了。' });

        s.step('只有主人回答', '打印机一看不是问自己，直接丢弃。网关回复一个单播应答，顺便记下了电脑的 IP 和 MAC。', [
          ['操作码', '2 (应答)'],
          ['回复方式', '单播，不再广播'],
        ]);
        s.send({
          path: ['router', 'switch', 'client'],
          kind: 'arp',
          label: '是我！',
          info: `${router.ip} is at ${router.mac}`,
          caption: '网关把自己的 MAC 填进“发送方 MAC”，单播回给电脑。',
          layers: (v) => [eth({ dst: client.mac, src: router.mac, type: 0x0806 }), arp({ op: 2, sha: router.mac, spa: router.ip, tha: client.mac, tpa: client.ip })],
        });

        s.step('信终于能发了', '电脑把结果写进 ARP 缓存，通常保留几十秒到几分钟。现在第一个 IP 包可以出门了，目的 MAC 写的是网关。', [['查看缓存', '终端里运行 arp -a']]);
        s.send({
          path: ['client', 'switch', 'router'],
          sport: 0x1234,
          kind: 'icmp',
          label: 'Ping',
          info: `Echo request id=0x1234 seq=1 → ${router.ip}`,
          caption: '等了一个来回，真正要发的包才上路。下一个包就不用再问了。',
          layers: (v) => s.ipLayers(v, 1, [icmpEcho({ id: 0x1234, seq: 1, data: pingData })]),
        });
        s.outro('ARP 只在一段局域网内有效。要访问外网时，电脑问的不是远方服务器的 MAC，而是网关的 MAC。IPv6 用邻居发现协议 NDP 取代了 ARP。');
      },
    },
    {
      id: 'nobody',
      title: '无人应答',
      fault: true,
      positions: lan,
      intro: '这次要找的 `192.168.1.99` 根本不存在，或者已经关机了。',
      build(s) {
        s.step('问了三遍', 'ARP 没有“查无此人”的回复。发送方只能隔一会儿再问，Linux 默认问 3 次，每次间隔 1 秒。', [['判定方式', '超时，而不是收到拒绝']]);
        askFor(s, '192.168.1.99', { dt: 1000, caption: '第 1 次询问。大家看了看都不是自己。' });
        askFor(s, '192.168.1.99', { dt: 1000, caption: '1 秒后第 2 次。' });
        s.ask('问了 3 次仍然没人回答，接下来会发生什么？', ['路由器回复一个“查无此人”', '操作系统告诉程序“主机不可达”', '继续无限重试'], 1, 'ARP 失败发生在你自己电脑上，所以 ping 会显示本机地址报告的 Destination Host Unreachable。没有任何设备回复过，错误是本地生成的。');
        askFor(s, '192.168.1.99', { dt: 1000, caption: '第 3 次，依然没有声音。系统放弃，把错误交给上层。' });
        s.outro('“没有回应”本身就是答案。这类靠超时判断失败的设计在网络里到处都是，因为你无法区分“对方不存在”和“回复丢了”。');
      },
    },
    {
      id: 'spoof',
      title: '冒名顶替',
      fault: true,
      positions: { client: [150, 350], switch: [470, 260], router: [810, 130], intruder: [810, 400] },
      intro: '局域网里有一台设备被入侵了。ARP 没有任何身份验证，谁喊得最后，电脑就信谁。',
      build(s) {
        s.step('不请自来的应答', '被入侵的设备主动发出 ARP 应答，声称 `192.168.1.1` 的 MAC 是自己的。电脑从没问过，但大多数系统依然会更新缓存。', [
          ['发送方 IP', `${router.ip}（伪造）`],
          ['发送方 MAC', `${intruder.mac}（真实）`],
        ]);
        s.ask('这个伪造应答要成功，攻击者需要知道网关的什么秘密？', ['网关的管理员密码', '什么都不需要', '网关的私钥'], 1, 'ARP 诞生于 1982 年，那时局域网里的设备彼此信任，协议里没有任何可供验证的东西。');
        s.send({
          path: ['intruder', 'switch', 'client'],
          kind: 'arp',
          label: '我才是网关',
          info: `${router.ip} is at ${intruder.mac}（伪造）`,
          caption: '注意字段：发送方 IP 写着网关，发送方 MAC 却是入侵者的。',
          layers: (v) => [eth({ dst: client.mac, src: intruder.mac, type: 0x0806 }), arp({ op: 2, sha: intruder.mac, spa: router.ip, tha: client.mac, tpa: client.ip })],
        });
        s.step('信被送错了门', '电脑的缓存已被污染。它照常往“网关”发包，IP 地址一点没错，帧却送到了入侵者手里。', [['目的 IP', '正确'], ['目的 MAC', '已被替换']]);
        s.send({
          path: ['client', 'switch', 'intruder'],
          dst: router.ip,
          kind: 'icmp',
          sport: 0x1234,
          label: '发错门了',
          info: `Echo request → ${router.ip}，但目的 MAC 是 ${intruder.mac}`,
          caption: '打开信封看：目的 IP 是网关，目的 MAC 却是入侵者。这就是中间人的起点。',
          layers: (v) => s.ipLayers({ ...v, dstMac: intruder.mac }, 1, [icmpEcho({ id: 0x1234, seq: 1, data: pingData })]),
        });
        s.outro('防御手段：企业交换机的 DAI（动态 ARP 检测）能拦下这种包。对普通用户来说，真正的保护来自上层加密，TLS 让中间人即使截到数据也读不了、改不了。');
      },
    },
  ],
};
