import { dns, http } from '../net/layers.js';
import { enc } from '../net/bytes.js';
import { NODES, route } from '../world.js';

const { server } = NODES;
const wan = { client: [100, 360], router: [280, 240], isp: [470, 350], core: [640, 230], server: [890, 140], resolver: [890, 400] };
const web = { client: [100, 350], router: [290, 230], isp: [490, 340], core: [680, 220], server: [885, 320] };
const P = route('server');
const HOST = 'www.example.com';
const DATE = 'Wed, 04 Nov 2026 03:24:11 GMT';

const reqHeaders = (extra = []) => [
  ['Host', HOST],
  ['User-Agent', 'PacketPost/1.0'],
  ['Accept', 'text/html'],
  ['Connection', 'keep-alive'],
  ...extra,
];

const get = (path) =>
  http({
    name: 'HTTP 请求',
    start: `GET ${path} HTTP/1.1`,
    startNote: '方法、路径、协议版本。这一行加上 Host 头，才拼得出完整网址。',
    headers: reqHeaders(),
  });

const resp = (status, headers, body, note) =>
  http({
    name: 'HTTP 响应',
    start: `HTTP/1.1 ${status}`,
    startNote: note,
    headers: [
      ['Date', DATE],
      ['Server', 'nginx'],
      ...headers,
      ...(body !== undefined ? [['Content-Type', 'text/html; charset=utf-8'], ['Content-Length', String(enc.encode(body).length)]] : [['Content-Length', '0']]),
    ],
    body: body ?? '',
  });

const PAGE = `<!doctype html>
<html lang="zh">
<head><title>示例网站</title></head>
<body><h1>你好，世界</h1><p>这段文字正是你在十六进制里看到的那些字节。</p></body>
</html>
`;

const NOT_FOUND = `<!doctype html><title>404</title><h1>页面不存在</h1>\n`;

export default {
  id: 'http',
  name: 'HTTP',
  full: 'Hypertext Transfer Protocol',
  cn: '超文本传输协议',
  layer: '应用层',
  port: '80',
  transport: 'TCP',
  rfc: 'RFC 9110, 9112',
  stamp: '80',
  summary: '网页的语言。客户端发一个请求，服务器回一个响应。HTTP/1.1 全是人能直接读懂的文本。',
  metaphor: '一张填好的点单：要什么、要哪种格式，服务员端回来时附一张小票写着状态和内容。',
  scenarios: [
    {
      id: 'normal',
      title: '打开一个网页',
      positions: wan,
      intro: '在地址栏输入 `http://www.example.com/` 并回车。把前面学过的东西串起来，从敲下回车到页面出现。',
      build(s) {
        const id = 0x1f7e;
        s.step('先问地址', '浏览器只知道域名，包却只能发给 IP，所以先走一趟 DNS。', [['域名', HOST]]);
        s.udp({
          path: route('resolver'),
          sport: 53214,
          dport: 53,
          kind: 'dns',
          label: 'DNS 查询',
          info: `Standard query 0x${id.toString(16)} A ${HOST}`,
          caption: '想看解析器背后的跑腿过程，去 DNS 那一章。',
          app: () => dns({ id, q: { name: HOST, type: 'A' } }),
        });
        s.udp({
          path: [...route('resolver')].reverse(),
          sport: 53,
          dport: 53214,
          kind: 'dns',
          label: server.ip,
          info: `Standard query response A ${server.ip}`,
          caption: '拿到 IP 了。',
          app: () => dns({ id, response: true, ra: true, q: { name: HOST, type: 'A' }, answers: [{ name: HOST, type: 'A', ttl: 300, data: server.ip }] }),
        });

        const c = s.tcpFlow({ path: P, sport: 52344, dport: 80 });
        s.step('打通连接', 'HTTP/1.1 跑在 TCP 上，先三次握手。这里花掉了一个完整的往返，一个字节有用的数据都还没传。', [['端口', '52344 → 80']]);
        c.handshake();

        s.step('发送请求', '连接通了，HTTP 才第一次出场。整个请求就是几行文本，你完全可以用 telnet 手敲。', [
          ['方法', 'GET'],
          ['路径', '/'],
        ]);
        s.ask('一台服务器上有很多网站，共用同一个 IP。服务器靠什么知道你要哪个？', ['端口号', 'Host 请求头', 'TCP 序号'], 1, 'HTTP/1.1 要求必须带 Host 头。这就是“虚拟主机”：一个 IP 上挂成千上万个网站。');
        c.seg('a', {
          flags: ['PSH', 'ACK'],
          payload: get('/'),
          kind: 'http',
          label: 'GET /',
          info: `GET / HTTP/1.1`,
          caption: '拆开最里层，看看每一行都是什么字节。行尾的 0d 0a 就是 CRLF。',
        });

        s.step('收到响应', '服务器回 200 和 HTML。响应的结构和请求一样：一行状态、几行首部、一个空行、正文。', [
          ['状态码', '200 OK'],
          ['类型', 'text/html'],
        ]);
        c.seg('b', {
          flags: ['PSH', 'ACK'],
          payload: resp('200 OK', [['Cache-Control', 'max-age=600']], PAGE, '200 表示成功。2xx 成功，3xx 重定向，4xx 客户端错，5xx 服务器错。'),
          kind: 'http',
          label: '200 OK',
          info: 'HTTP/1.1 200 OK (text/html)',
          caption: '真实网页通常大得多，会被切成很多个 TCP 段。这个例子足够小，一段就装下了。',
        });
        c.seg('a', { flags: ['ACK'], label: 'ACK', caption: 'TCP 层确认收到。连接保持打开，下一个请求可以直接复用。' });
        s.outro('浏览器解析 HTML 后发现还要 CSS、JS、图片，于是继续发请求。今天几乎所有网站都强制 HTTPS，这里的明文 HTTP 是为了让你看清内容。HTTP/2 改成二进制帧并多路复用，HTTP/3 换到了 QUIC，但方法、状态码、首部这些语义都没变。');
      },
    },
    {
      id: 'not-found',
      title: '404',
      fault: true,
      positions: web,
      intro: '连接已经建好，这次访问一个不存在的路径。',
      build(s) {
        const c = s.tcpFlow({ path: P, sport: 52344, dport: 80 });
        c.a.seq = (c.a.isn + 1) >>> 0;
        c.b.seq = (c.b.isn + 1) >>> 0;
        s.step('请求一个不存在的路径', '网络没有任何问题：DNS 对、连接通、服务器也在。', [['路径', '/old-page']]);
        c.seg('a', { flags: ['PSH', 'ACK'], payload: get('/old-page'), kind: 'http', label: 'GET /old-page', info: 'GET /old-page HTTP/1.1', caption: '和正常请求的结构完全一样。' });
        s.step('404 也是一个成功的响应', '从 TCP 和 HTTP 协议的角度，这次通信完全成功。404 是应用层的语义，而且响应里照样可以有 HTML 正文。', [['状态码', '404 Not Found']]);
        s.ask('收到 404 时，TCP 层认为这次传输……', ['失败了，要重传', '成功了，这只是服务器说的话', '连接要被重置'], 1, 'TCP 只负责把字节送到。这些字节的含义是“找不到”，TCP 既看不懂也不关心。这就是分层。');
        c.seg('b', {
          flags: ['PSH', 'ACK'],
          payload: resp('404 Not Found', [], NOT_FOUND, '4xx 表示问题出在请求这一方。'),
          kind: 'http',
          label: '404',
          info: 'HTTP/1.1 404 Not Found (text/html)',
          caption: '你看到的“404 页面”就是这个响应的正文。',
        });
        c.seg('a', { flags: ['ACK'], label: 'ACK', caption: 'TCP 高高兴兴地确认了。' });
        s.outro('分清是哪一层出的问题是网络排错的核心：DNS 失败、连接超时、连接被拒、404、500，分别发生在完全不同的层。');
      },
    },
    {
      id: 'redirect',
      title: '301 重定向',
      positions: web,
      intro: '大多数网站会把 http:// 转到 https://。这一步发生在明文里，TLS 还没开始。',
      build(s) {
        const c = s.tcpFlow({ path: P, sport: 52344, dport: 80 });
        c.a.seq = (c.a.isn + 1) >>> 0;
        c.b.seq = (c.b.isn + 1) >>> 0;
        s.step('明文敲门', '用户只输入了域名，浏览器先试 http。', [['协议', 'http://']]);
        c.seg('a', { flags: ['PSH', 'ACK'], payload: get('/'), kind: 'http', label: 'GET /', info: 'GET / HTTP/1.1', caption: '这个请求是明文的。' });
        s.step('请走 HTTPS', '服务器不给内容，只给 `Location` 头。浏览器收到后自动换地址重新请求。', [
          ['状态码', '301 Moved Permanently'],
          ['下一站', `https://${HOST}/`],
        ]);
        s.ask('这个明文的 301 响应，可能被中间人篡改吗？', ['不可能', '可能，HSTS 就是为此而生', '只有 ISP 才能'], 1, '第一次明文请求是 HTTPS 的软肋：中间人可以改掉 Location。HSTS 头让浏览器记住“以后直接用 HTTPS”，预加载列表连第一次也保护了。');
        c.seg('b', {
          flags: ['PSH', 'ACK'],
          payload: resp('301 Moved Permanently', [['Location', `https://${HOST}/`]], undefined, '3xx 表示“去别处”。301 是永久的，浏览器会记住。'),
          kind: 'http',
          label: '301',
          info: `HTTP/1.1 301 Moved Permanently → https://${HOST}/`,
          caption: '没有正文，只有地址。接下来就是 TLS 那一章的故事了。',
        });
        s.outro('这也解释了为什么 Chrome 地址栏现在默认先试 https://。下一站：TLS。');
      },
    },
  ],
};
