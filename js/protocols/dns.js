import { dns } from '../net/layers.js';
import { NODES, route } from '../world.js';

const { server, tld, auth } = NODES;
const NAME = 'www.example.com';
const CP = 53214;
const RP = 41873;
const pos = { client: [90, 400], router: [230, 300], isp: [340, 410], core: [460, 300], resolver: [600, 230], root: [860, 70], tld: [900, 240], auth: [860, 410] };
const path = route('resolver');
const back = [...path].reverse();

const toResolver = (s, id, name, o = {}) =>
  s.udp({
    path,
    sport: CP,
    dport: 53,
    kind: 'dns',
    label: 'A 查询',
    info: `Standard query 0x${id.toString(16)} A ${name}`,
    app: () => dns({ id, q: { name, type: 'A' } }),
    ...o,
  });

const ask = (s, target, id, o = {}) =>
  s.udp({
    path: ['resolver', target],
    sport: RP,
    dport: 53,
    kind: 'dns',
    label: `问 ${NODES[target].label}`,
    info: `Standard query 0x${id.toString(16)} A ${o.name ?? NAME}`,
    app: () => dns({ id, rd: false, q: { name: o.name ?? NAME, type: 'A' } }),
    ...o,
  });

export default {
  id: 'dns',
  name: 'DNS',
  full: 'Domain Name System',
  cn: '域名系统',
  layer: '应用层',
  port: '53',
  transport: 'UDP（大响应时用 TCP）',
  rfc: 'RFC 1034, 1035',
  stamp: '53',
  summary: '人记名字，机器要 IP。DNS 是一本分布在全世界的通讯录，没有谁存着全部内容，大家层层转介。',
  metaphor: '查地址：先问前台，前台问总局，总局说“.com 归他们管”，就这样一路打听到真正知道的人。',
  scenarios: [
    {
      id: 'recursive',
      title: '层层打听',
      positions: pos,
      intro: '你要访问 `www.example.com`，本机和公共 DNS 的缓存都是空的，这是最完整的一趟。',
      build(s) {
        const id = 0x5a3c;
        s.step('问前台', '你的电脑只问一个人：配置好的递归解析器。设置 RD=1，意思是“你帮我问到底，只给我答案”。', [
          ['查询类型', 'A (IPv4 地址)'],
          ['RD 标志', '1 (期望递归)'],
        ]);
        toResolver(s, id, NAME, { caption: '一个小小的 UDP 包。打开看看域名是怎么编码成“长度 + 标签”的。' });

        s.step('问根服务器', '解析器从根开始。根服务器不知道答案，但知道谁管 `.com`。全世界只有 13 组根服务器地址。', [['根的回答', '转介 (referral)']]);
        s.ask('根服务器知道 www.example.com 的 IP 吗？', ['知道，根服务器存着全部域名', '不知道，但它知道谁管 .com', '不知道，它会替你继续查'], 1, '根服务器只负责顶级域的转介，这是 DNS 能扩展到全世界的原因：每一级都只知道下一级。');
        ask(s, 'root', 0x8e11, { caption: '解析器这里用 RD=0：我自己跑腿，你告诉我下一站就行。' });
        s.udp({
          path: ['root', 'resolver'],
          sport: 53,
          dport: RP,
          kind: 'dns',
          label: '找 .com',
          info: 'Referral: com. NS a.gtld-servers.net',
          caption: '回答部分是空的。看“授权”和“附加”：下一站是谁，它的 IP 是多少。',
          app: () =>
            dns({
              id: 0x8e11,
              response: true,
              rd: false,
              q: { name: NAME, type: 'A' },
              authority: [{ name: 'com', type: 'NS', ttl: 172800, data: 'a.gtld-servers.net', note: '“.com 归它管。”' }],
              additional: [{ name: 'a.gtld-servers.net', type: 'A', ttl: 172800, data: tld.ip, note: '胶水记录：直接把 IP 也告诉你，省得再查一次。' }],
            }),
        });

        s.step('问 .com', 'TLD 服务器同样不知道 www，但知道 `example.com` 的权威服务器是谁。', [['回答', '再转介一次']]);
        ask(s, 'tld', 0x8e12, { caption: '问题没变，还是同一个完整域名。' });
        s.udp({
          path: ['tld', 'resolver'],
          sport: 53,
          dport: RP,
          kind: 'dns',
          label: '找权威',
          info: 'Referral: example.com. NS ns1.example.com',
          caption: 'ns1.example.com 在 example.com 自己里面，不给胶水记录就死循环了。',
          app: () =>
            dns({
              id: 0x8e12,
              response: true,
              rd: false,
              q: { name: NAME, type: 'A' },
              authority: [{ name: 'example.com', type: 'NS', ttl: 172800, data: 'ns1.example.com' }],
              additional: [{ name: 'ns1.example.com', type: 'A', ttl: 172800, data: auth.ip }],
            }),
        });

        s.step('问权威', '终于问到真正负责的人。权威服务器的答案带 AA 标志，还有一个 TTL：这个答案可以缓存多久。', [
          ['AA 标志', '1 (权威回答)'],
          ['TTL', '300 秒'],
        ]);
        ask(s, 'auth', 0x8e13, { caption: '这是最后一问。' });
        s.udp({
          path: ['auth', 'resolver'],
          sport: 53,
          dport: RP,
          kind: 'dns',
          label: '找到了',
          info: `Response A ${server.ip}`,
          caption: '“回答”部分终于有内容了。',
          app: () =>
            dns({
              id: 0x8e13,
              response: true,
              aa: true,
              rd: false,
              q: { name: NAME, type: 'A' },
              answers: [{ name: NAME, type: 'A', ttl: 300, data: server.ip, note: '域名用 2 字节指针 0xC00C 指回问题里的名字，这就是 DNS 压缩。' }],
            }),
        });

        s.step('带回结果', '解析器把答案缓存起来，返回给你的电脑。下一个查同样域名的人，一个来回就够了。', [['缓存', '300 秒']]);
        s.udp({
          path: back,
          sport: 53,
          dport: CP,
          kind: 'dns',
          label: server.ip,
          info: `Standard query response 0x${id.toString(16)} A ${server.ip}`,
          caption: '事务 ID 和最初的查询一样，这样你的电脑才知道这是对应哪个问题的答案。',
          app: () => dns({ id, response: true, ra: true, q: { name: NAME, type: 'A' }, answers: [{ name: NAME, type: 'A', ttl: 300, data: server.ip }] }),
        });
        s.outro('现实中解析器往往已缓存 `.com` 的服务器，很少真的从根开始。现代解析器还会做 QNAME 最小化：问根时只问 `com`，少泄露一点你要访问什么。普通 DNS 是明文的，DoH/DoT 把它放进了加密通道。');
      },
    },
    {
      id: 'cache',
      title: '命中缓存',
      positions: pos,
      intro: '88 秒后，你的同事也来查同一个域名。',
      build(s) {
        const id = 0x7b02;
        s.step('一问', '同样的查询。这次解析器缓存里已经有了。', [['缓存剩余', '212 秒']]);
        toResolver(s, id, NAME, { caption: '和上次一模一样的问题。' });
        s.step('即答', '解析器直接回答，不打扰任何人。注意 TTL 从 300 降到了 212：缓存在倒计时。', [
          ['TTL', '212 (300 − 88)'],
          ['AA 标志', '0，这不是权威回答'],
        ]);
        s.ask('从缓存回答时，TTL 字段是多少？', ['还是 300', '减去已经过去的时间', '变成 0'], 1, 'TTL 是全局有效的剩余时间。缓存转发时要把已过去的时间减掉，这样下游缓存不会把过期时间延长。');
        s.udp({
          path: back,
          sport: 53,
          dport: CP,
          kind: 'dns',
          label: '缓存命中',
          info: `Standard query response 0x${id.toString(16)} A ${server.ip}`,
          caption: '8 个包变成了 2 个，大约 30ms 就有了答案。',
          app: () => dns({ id, response: true, ra: true, q: { name: NAME, type: 'A' }, answers: [{ name: NAME, type: 'A', ttl: 212, data: server.ip }] }),
        });
        s.outro('这就是改了 DNS 记录后“要等一会儿才生效”的原因：全世界的缓存要等 TTL 倒数完。要迁移服务器，最好提前把 TTL 调小。');
      },
    },
    {
      id: 'nxdomain',
      title: '查无此名',
      fault: true,
      positions: pos,
      intro: '手滑打成了 `wwww.example.com`。解析器已经缓存了 example.com 的权威服务器。',
      build(s) {
        const bad = 'wwww.example.com';
        const id = 0x31aa;
        s.step('照常询问', '解析器有缓存，所以跳过根和 .com，直接问权威服务器。', [['跳过', '根、.com']]);
        toResolver(s, id, bad, { caption: '多打了一个 w。' });
        ask(s, 'auth', 0x8e77, { name: bad, caption: '解析器直奔权威服务器。' });

        s.step('NXDOMAIN', '权威服务器明确答复：这个名字不存在。RCODE=3，并附上 SOA 记录，说明这个“否定答案”可以缓存多久。', [
          ['RCODE', '3 (NXDOMAIN)'],
          ['否定缓存', '3600 秒'],
        ]);
        s.ask('“这个域名不存在”这种答案，解析器会缓存吗？', ['不会，下次还要重查', '会，缓存时间由 SOA 决定', '会，永久缓存'], 1, '这叫否定缓存 (RFC 2308)。否则一个不存在的域名被反复查询，会把权威服务器打穿。');
        s.udp({
          path: ['auth', 'resolver'],
          sport: 53,
          dport: RP,
          kind: 'dns',
          label: 'NXDOMAIN',
          info: `Response: No such name ${bad}`,
          caption: '回答为空，授权部分放了 SOA。',
          app: () =>
            dns({
              id: 0x8e77,
              response: true,
              aa: true,
              rd: false,
              rcode: 3,
              q: { name: bad, type: 'A' },
              authority: [{ name: 'example.com', type: 'SOA', ttl: 3600, data: { mname: 'ns1.example.com', rname: 'admin.example.com', serial: 2026110401, minimum: 3600 }, note: 'SOA 的最小 TTL 决定否定答案缓存多久。' }],
            }),
        });
        s.udp({
          path: back,
          sport: 53,
          dport: CP,
          kind: 'dns',
          label: 'NXDOMAIN',
          info: `Response: No such name ${bad}`,
          caption: '浏览器显示 DNS_PROBE_FINISHED_NXDOMAIN。',
          app: () =>
            dns({
              id,
              response: true,
              ra: true,
              rcode: 3,
              q: { name: bad, type: 'A' },
              authority: [{ name: 'example.com', type: 'SOA', ttl: 3600, data: { mname: 'ns1.example.com', rname: 'admin.example.com', serial: 2026110401, minimum: 3600 } }],
            }),
        });
        s.outro('NXDOMAIN 是一个明确的答案，不是故障。它和“服务器没响应”(SERVFAIL 或超时) 意义完全不同。');
      },
    },
  ],
};

