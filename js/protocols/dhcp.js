import { dhcp, dhcpOpt as O } from '../net/layers.js';
import { NODES } from '../world.js';

const { client, router } = NODES;
const BCAST = 'ff:ff:ff:ff:ff:ff';
const lan = { client: [150, 350], switch: [470, 260], router: [810, 130], printer: [810, 400] };
const up = ['client', 'switch', 'router'];
const down = ['router', 'switch', 'client'];
const also = [['client', 'switch', 'printer']];
const XID = 0x3903f326;
const LEASE = 86400;
const offerOpts = [O.serverId(router.ip), O.lease(LEASE), O.mask('255.255.255.0'), O.router(router.ip), O.dns('192.0.2.53')];

const bcast = (s, o) =>
  s.udp({
    path: up,
    also,
    src: '0.0.0.0',
    dst: '255.255.255.255',
    dstMac: BCAST,
    sport: 68,
    dport: 67,
    kind: 'dhcp',
    ...o,
  });

const reply = (s, o) => s.udp({ path: down, dst: client.ip, sport: 67, dport: 68, kind: 'dhcp', ...o });

export default {
  id: 'dhcp',
  name: 'DHCP',
  full: 'Dynamic Host Configuration Protocol',
  cn: '动态主机配置协议',
  layer: '应用层',
  port: '67 (服务器) / 68 (客户端)',
  transport: 'UDP',
  rfc: 'RFC 2131',
  stamp: '67',
  summary: '一台刚连上网的设备什么都没有：没有 IP、不知道网关、不知道 DNS。DHCP 在一无所有的情况下把这些全要来。',
  metaphor: '刚搬进小区的新住户，站在院子里大喊“我的门牌号是多少？”，物业回话并递上一张住户须知。',
  scenarios: [
    {
      id: 'dora',
      title: 'DORA 四步',
      positions: lan,
      intro: '你的电脑刚接入 Wi-Fi，自己连 IP 都没有。四步拿到身份，记法是 DORA：Discover、Offer、Request、ACK。',
      build(s) {
        s.step('Discover 发现', '没有地址的设备怎么发包？源 IP 填 `0.0.0.0`，目的 IP 填 `255.255.255.255`，目的 MAC 全 1，向全网广播。', [
          ['源 IP', '0.0.0.0'],
          ['目的 IP', '255.255.255.255'],
          ['端口', '68 → 67'],
        ]);
        s.ask('电脑此时还没有 IP。这个包的源 IP 填什么？', ['192.168.1.10', '127.0.0.1', '0.0.0.0'], 2, '0.0.0.0 的意思就是“本机，但我还没有地址”。');
        bcast(s, {
          label: 'Discover',
          info: `DHCP Discover  xid=0x${XID.toString(16)}`,
          caption: '网络里所有设备都收到了。只有 DHCP 服务器会回应。',
          app: () => dhcp({ op: 1, xid: XID, chaddr: client.mac, options: [O.type(1), O.clientId(client.mac), O.hostname('laptop'), O.prl()] }),
        });

        s.step('Offer 提供', '路由器内置的 DHCP 服务器从地址池里挑一个空闲地址，给出报价，附上掩码、网关、DNS、租期。', [
          ['提供 IP', client.ip],
          ['租期', '24 小时'],
        ]);
        reply(s, {
          label: 'Offer',
          info: `DHCP Offer  ${client.ip}`,
          caption: '注意 yiaddr 字段就是分配的地址。此时这个地址还不算你的。',
          app: () => dhcp({ op: 2, xid: XID, yiaddr: client.ip, siaddr: router.ip, chaddr: client.mac, options: [O.type(2), ...offerOpts] }),
        });

        s.step('Request 请求', '客户端再广播一次“我要这个地址”。为什么还要广播？因为网络里可能有多个 DHCP 服务器，这样落选的也能知道，把地址收回。', [
          ['选项 50', client.ip],
          ['选项 54', router.ip],
        ]);
        s.ask('客户端已经知道服务器的 IP 了，为什么 Request 还要用广播？', ['单播不够可靠', '让所有 DHCP 服务器都知道选了谁', '协议设计失误'], 1, '网络里可能有多台服务器同时发 Offer。广播的 Request 里写着选中的服务器，落选的服务器就能把预留的地址放回池子。');
        bcast(s, {
          label: 'Request',
          info: `DHCP Request  ${client.ip}`,
          caption: '选项 54 写着选中了谁。',
          app: () => dhcp({ op: 1, xid: XID, chaddr: client.mac, options: [O.type(3), O.clientId(client.mac), O.requestIp(client.ip), O.serverId(router.ip), O.hostname('laptop'), O.prl()] }),
        });

        s.step('ACK 确认', '服务器正式确认，记下租约。客户端配好地址，这才算真正上了网。', [
          ['结果', `${client.ip}/24`],
          ['下次续租', '12 小时后 (T1 = 租期一半)'],
        ]);
        reply(s, {
          label: 'ACK',
          info: `DHCP ACK  ${client.ip}`,
          caption: '成交。很多系统这时还会发一个 ARP 探测，确认这个地址真的没人用。',
          app: () => dhcp({ op: 2, xid: XID, yiaddr: client.ip, siaddr: router.ip, chaddr: client.mac, options: [O.type(5), ...offerOpts] }),
        });
        s.outro('Windows 上如果 DHCP 失败，你会看到 `169.254.x.x` 这样的地址，那是系统给自己随手取的“链路本地地址”，基本等于没上网。');
      },
    },
    {
      id: 'renew',
      title: '续租',
      positions: lan,
      intro: '12 小时过去了，租期过半。电脑已经有地址，这次不需要大喊大叫。',
      build(s) {
        s.step('单播续租', '有了 IP，客户端直接单播给服务器，`ciaddr` 填上正在用的地址。', [['T1', '租期的 50%'], ['ciaddr', client.ip]]);
        s.udp({
          path: up,
          sport: 68,
          dport: 67,
          kind: 'dhcp',
          label: '续租 Request',
          info: `DHCP Request (续租) ${client.ip}`,
          caption: '和第一次相比：源 IP 是真实地址，目的是路由器，再也不是广播。',
          app: () => dhcp({ op: 1, xid: XID + 1, ciaddr: client.ip, chaddr: client.mac, options: [O.type(3), O.clientId(client.mac), O.hostname('laptop'), O.prl()] }),
        });
        s.step('延期成功', '服务器回 ACK，租期重新计时。你的上网全程没有中断，什么也没感觉到。', [['新租期', '24 小时']]);
        reply(s, {
          label: 'ACK',
          info: `DHCP ACK ${client.ip}`,
          caption: '如果服务器这时没响应，客户端到 87.5% 时间 (T2) 会改用广播，向任何服务器求助。',
          app: () => dhcp({ op: 2, xid: XID + 1, ciaddr: client.ip, yiaddr: client.ip, siaddr: router.ip, chaddr: client.mac, options: [O.type(5), ...offerOpts] }),
        });
        s.outro('租约机制让地址可以回收。设备走了不用通知谁，到期自然释放，这是分布式系统里很经典的做法。');
      },
    },
    {
      id: 'nak',
      title: '换了网络',
      fault: true,
      positions: lan,
      intro: '你把笔记本从公司带回家，它还记得公司发的地址 `10.20.0.45`，想接着用。',
      build(s) {
        const old = '10.20.0.45';
        s.step('想继续用旧地址', '客户端跳过 Discover，直接广播 Request 申请之前的地址，这叫 INIT-REBOOT，能省下两步。', [['请求的 IP', old]]);
        bcast(s, {
          label: 'Request',
          info: `DHCP Request ${old}`,
          caption: '“我以前用的是这个，还能用吧？”',
          app: () => dhcp({ op: 1, xid: 0x51a07e11, chaddr: client.mac, options: [O.type(3), O.clientId(client.mac), O.requestIp(old), O.hostname('laptop')] }),
        });
        s.step('被拒绝', '家里的路由器一看，这个地址根本不属于本网段，回 NAK。', [['消息类型', '6 (NAK)']]);
        s.udp({
          path: down,
          dst: '255.255.255.255',
          dstMac: BCAST,
          sport: 67,
          dport: 68,
          kind: 'dhcp',
          label: 'NAK',
          info: 'DHCP NAK',
          caption: '客户端老老实实退回到从头开始。',
          app: () => dhcp({ op: 2, xid: 0x51a07e11, chaddr: client.mac, options: [O.type(6), O.serverId(router.ip), O.message('wrong network')] }),
        });
        s.step('重新开始', '收到 NAK 后回到第一步，走完整的 DORA。', [['接下来', 'Discover → Offer → Request → ACK']]);
        bcast(s, {
          label: 'Discover',
          info: 'DHCP Discover',
          caption: '后面就和 DORA 一样了。',
          app: () => dhcp({ op: 1, xid: 0x51a07e12, chaddr: client.mac, options: [O.type(1), O.clientId(client.mac), O.hostname('laptop'), O.prl()] }),
        });
        s.outro('这个设计让笔记本回到熟悉的网络时能快速上线，到了陌生网络也只损失一个来回。');
      },
    },
  ],
};
