import { tls, tlsApp, tlsCcs, tlsClientHello, tlsServerHello } from '../net/layers.js';
import { route } from '../world.js';

const web = { client: [100, 350], router: [290, 230], isp: [490, 340], core: [680, 220], server: [885, 320] };
const P = route('server');
const SNI = 'www.example.com';

function hello(s, c) {
  const sessionId = s.rand.bytes(32);
  c.seg('a', {
    flags: ['PSH', 'ACK'],
    kind: 'tls',
    payload: tls([tlsClientHello({ sni: SNI, random: s.rand.bytes(32), sessionId, keyShare: s.rand.bytes(32) })], 'TLS 握手'),
    label: 'ClientHello',
    info: `Client Hello (SNI=${SNI})`,
    caption: '找到 server_name 扩展：窃听者能看到你访问的域名。试试看它是明文吗？',
  });
  return sessionId;
}

function flight(s, c, sessionId, o = {}) {
  c.seg('b', {
    flags: ['PSH', 'ACK'],
    kind: 'tls',
    payload: tls(
      [
        tlsServerHello({ random: s.rand.bytes(32), sessionId, keyShare: s.rand.bytes(32) }),
        tlsCcs(),
        tlsApp({
          bytes: s.rand.bytes(1100),
          inside: '解密后依次是 EncryptedExtensions、Certificate、CertificateVerify、Finished。TLS 1.3 把证书也加密了，1.2 时代它还是明文。',
        }),
      ],
      'TLS 握手',
    ),
    label: 'ServerHello',
    info: 'Server Hello, Change Cipher Spec, Application Data',
    caption: o.caption ?? '一个 TCP 段里装了三条记录：ServerHello 之后的一切都已加密。',
  });
}

const handshakeStep = (s) =>
  s.step('打通 TCP', 'TLS 跑在 TCP 之上，所以先握一次手，这次连的是 443 端口。', [['端口', '52380 → 443']]);

export default {
  id: 'tls',
  name: 'TLS',
  full: 'Transport Layer Security',
  cn: '传输层安全协议',
  layer: '应用层之下',
  port: '443 (HTTPS)',
  transport: 'TCP',
  rfc: 'RFC 8446',
  stamp: '443',
  summary: '在不可信的网络上做到三件事：内容别人读不了、改了能发现、确认对面真是它。HTTPS 就是 HTTP 装进 TLS。',
  metaphor: '和陌生人隔着很多道邮局通信：先当众交换半把钥匙，各自配出一把只有你俩有的锁，之后全部锁在箱子里寄。',
  scenarios: [
    {
      id: 'normal',
      title: 'TLS 1.3 握手',
      positions: web,
      intro: '访问 `https://www.example.com/`。注意看，握手之后，信封里的内容你再也读不懂了。',
      build(s) {
        const c = s.tcpFlow({ path: P, sport: 52380, dport: 443 });
        handshakeStep(s);
        c.handshake();

        s.step('ClientHello', '客户端一上来就把一切都摆上桌：支持的算法、随机数、想访问的域名，还有密钥交换的公钥。这是 TLS 1.3 只要 1 个往返的秘密。', [
          ['版本', 'TLS 1.3 (在扩展里)'],
          ['SNI', SNI],
          ['密钥交换', 'x25519'],
        ]);
        s.ask('用了 HTTPS，路上的窃听者能看到什么？', ['什么都看不到', '能看到你访问的域名和流量大小，看不到路径和内容', '能看到完整网址'], 1, 'SNI 是明文的，IP 地址和包大小也藏不住。URL 路径、Cookie、内容全部加密。ECH 扩展正在解决 SNI 的问题。');
        const sid = hello(s, c);

        s.step('ServerHello 和加密', '服务器选定算法，发回自己的公钥。此时双方都能算出同一个共享密钥，从下一条记录开始全部加密，连证书都不例外。', [
          ['密码套件', 'TLS_AES_128_GCM_SHA256'],
          ['密钥协商', 'ECDHE，有前向保密'],
        ]);
        s.ask('窃听者录下了双方交换的两个公钥，能算出共享密钥吗？', ['能，公钥都有了', '不能，还需要某一方的私钥', '只要有足够的存储就能'], 1, '这就是 Diffie-Hellman 的魔法：公开的值无法反推共享密钥。而且密钥是临时生成的，哪怕服务器私钥多年后泄露，今天录下的流量依然解不开，这叫前向保密。');
        flight(s, c, sid);

        s.step('客户端完成', '浏览器验证证书链、域名、有效期和服务器签名，全部通过后发送 Finished。第一个往返结束，握手完成。', [
          ['验证项', '证书链、域名、有效期、签名'],
          ['往返次数', '1-RTT'],
        ]);
        c.seg('a', {
          flags: ['PSH', 'ACK'],
          kind: 'tls',
          payload: tls([tlsCcs(), tlsApp({ bytes: s.rand.bytes(53), inside: '解密后是 Finished：对整个握手过程的 HMAC。只要有人改过任何一个字节，这里就对不上。' })], 'TLS 握手'),
          label: 'Finished',
          info: 'Change Cipher Spec, Application Data',
          caption: 'Finished 证明双方看到的握手内容完全一致。',
        });

        s.step('加密的 HTTP', '和上一章一样的 GET 请求，但现在外面只看得到 Application Data 和长度。', [
          ['外部可见', '类型、长度'],
          ['内部', 'GET / HTTP/1.1 …'],
        ]);
        c.seg('a', {
          flags: ['PSH', 'ACK'],
          kind: 'tls',
          payload: tls([tlsApp({ bytes: s.rand.bytes(121), inside: '解密后是 GET / HTTP/1.1 …。这串字节对路上的所有路由器都毫无意义。' })], 'TLS 应用数据'),
          label: '加密请求',
          info: 'Application Data',
          caption: '对比 HTTP 那一章的十六进制：这里再也没有可读的文字了。',
        });
        c.seg('b', {
          flags: ['PSH', 'ACK'],
          kind: 'tls',
          payload: tls([tlsApp({ bytes: s.rand.bytes(388), inside: '解密后是 HTTP/1.1 200 OK 和网页内容。' })], 'TLS 应用数据'),
          label: '加密响应',
          info: 'Application Data',
          caption: '响应同样被加密。',
        });
        c.seg('a', { flags: ['ACK'], label: 'ACK', caption: 'TCP 不知道也不关心里面是什么，照常确认。' });
        s.outro('这里的密文是演示用的随机字节，不是真实加密结果。TLS 1.2 需要 2 个往返，TLS 1.3 砍到 1 个，回头客用 0-RTT 甚至可以不等。真实证书链通常有 3 到 4KB，要分好几个 TCP 段。');
      },
    },
    {
      id: 'expired',
      title: '证书过期',
      fault: true,
      positions: web,
      intro: '网站管理员忘了续证书。这次握手中途，浏览器会喊停。',
      build(s) {
        const c = s.tcpFlow({ path: P, sport: 52380, dport: 443 });
        handshakeStep(s);
        c.handshake();
        s.step('前半段一切正常', '两边照常打招呼。证书是在加密的记录里发过来的，到这一步之前没有任何异常。', [['状态', '握手中']]);
        const sid = hello(s, c);
        flight(s, c, sid, { caption: '证书就在这段密文里。它的有效期截止到昨天。' });

        s.step('证书校验失败', '浏览器解密后检查证书，发现 `notAfter` 已过。它发出一条 alert，告诉对方为什么不继续了。', [
          ['Alert', 'certificate_expired (45)'],
          ['级别', 'fatal'],
        ]);
        s.ask('这条 Alert，路上的窃听者能读出原因吗？', ['能，Alert 总是明文', '不能，这时已有握手密钥，Alert 也被加密', '只有服务器能发 Alert'], 1, '打开包看，它的记录类型写着 Application Data，真实类型藏在密文里。TLS 1.3 尽量让外部什么都看不出来。');
        c.seg('a', {
          flags: ['PSH', 'ACK'],
          kind: 'tls',
          payload: tls([tlsCcs(), tlsApp({ bytes: s.rand.bytes(19), inside: '解密后是 Alert：级别 fatal，描述 45 (certificate_expired)。' })], 'TLS 告警'),
          label: 'Alert',
          info: 'Application Data (加密的 Alert: certificate_expired)',
          caption: '从外面看，这条告警和普通数据一模一样。',
        });
        c.seg('a', { flags: ['FIN', 'ACK'], label: 'FIN', dt: 1, caption: '客户端关闭连接。' });
        c.seg('b', { flags: ['FIN', 'ACK'], label: 'FIN', caption: '服务器也关闭。' });
        c.seg('a', { flags: ['ACK'], label: 'ACK', caption: '浏览器显示 NET::ERR_CERT_DATE_INVALID。' });
        s.outro('证书解决的是“对面真是它吗”。没有这一步，加密毫无意义：你可能在和中间人安全地聊天。Let\'s Encrypt 用 90 天的短证书和自动续期，让这种事故越来越少。');
      },
    },
  ],
};
