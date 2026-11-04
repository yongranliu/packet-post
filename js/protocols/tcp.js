import { rawApp, tcpOpt } from '../net/layers.js';
import { ascii } from '../net/bytes.js';
import { route } from '../world.js';

const wan = { client: [100, 350], router: [290, 230], isp: [490, 340], core: [680, 220], server: [885, 320] };
const P = route('server');
const synOpts = [tcpOpt.mss(1460), tcpOpt.nop(), tcpOpt.wscale(7), tcpOpt.nop(), tcpOpt.nop(), tcpOpt.sackOk()];

const text = (s, show) => rawApp({ bytes: ascii(s), show: show ?? JSON.stringify(s) });

export default {
  id: 'tcp',
  name: 'TCP',
  full: 'Transmission Control Protocol',
  cn: '传输控制协议',
  layer: '传输层',
  port: '由应用决定',
  transport: 'IP (协议号 6)',
  rfc: 'RFC 9293',
  stamp: '6',
  summary: 'IP 可能丢包、乱序、重复。TCP 用序号、确认和重传，在这样的地基上造出一条可靠、有序的字节流。',
  metaphor: '挂号信加对账：每封信都编号，收件人回执“某号之前全收到了”，没回执就补寄。',
  scenarios: [
    {
      id: 'normal',
      title: '一条连接的一生',
      positions: wan,
      intro: '从建立、传数据到关闭，看一条 TCP 连接完整的一生。服务器监听在 7 号端口（echo 服务：你发什么，它回什么）。',
      build(s) {
        const c = s.tcpFlow({ path: P, sport: 52344, dport: 7 });
        s.step('三次握手', '双方要确认三件事：我能发、你能收、你也能回。同时互相告知起始序号和能力（MSS、窗口缩放、SACK）。', [
          ['SYN', '占用 1 个序号'],
          ['状态', 'SYN_SENT → ESTABLISHED'],
        ]);
        c.seg('a', { flags: ['SYN'], label: 'SYN', options: synOpts, caption: '“我想连接。我的字节流从这个序号开始。”初始序号是随机的，防止旧连接的包混进来。' });
        s.ask('服务器回 SYN-ACK 时，确认号应该是多少？（客户端的相对序号是 0）', ['0', '1', '随机值'], 1, 'SYN 虽然不带数据，却占一个序号。确认号的含义是“我期待的下一个序号”，所以是 0 + 1 = 1。');
        c.seg('b', { flags: ['SYN', 'ACK'], label: 'SYN-ACK', options: synOpts, caption: '“收到，我也从这个序号开始。”一个包同时完成了确认和发起。' });
        c.seg('a', { flags: ['ACK'], label: 'ACK', caption: '“收到你的序号了。”握手完成，这个 ACK 其实已经可以带数据。' });

        s.step('传送数据', '每个字节都有序号。发送方发 `hello` (5 字节)，确认号就要加 5。对方的回复可以顺便捎上确认。', [
          ['PSH', '提示接收方尽快交给应用'],
          ['确认规则', '累积确认'],
        ]);
        c.seg('a', { flags: ['PSH', 'ACK'], payload: text(s, 'hello'), label: 'hello', kind: 'data', caption: '5 字节数据，Seq=1。' });
        s.ask('客户端发了 Seq=1、长度 5 的数据。服务器回复里的 Ack 是多少？', ['5', '6', '1'], 1, '1 到 5 号字节都收到了，下一个想要 6。TCP 的确认号永远指向“下一个期待的字节”。');
        c.seg('b', { flags: ['PSH', 'ACK'], payload: text(s, 'hello'), label: 'hello', kind: 'data', caption: 'echo 服务把数据弹回来，同一个包里捎带了 Ack=6。' });
        c.seg('a', { flags: ['ACK'], label: 'ACK', caption: '客户端确认收到回显。' });

        s.step('四次挥手', 'TCP 是全双工，两个方向要分别关闭。FIN 只表示“我不再发了”，但还能继续收。', [
          ['FIN', '占用 1 个序号'],
          ['主动关闭方', '要等 TIME_WAIT'],
        ]);
        c.seg('a', { flags: ['FIN', 'ACK'], label: 'FIN', caption: '“我说完了。”' });
        c.seg('b', { flags: ['ACK'], label: 'ACK', caption: '“知道了。”这时服务器可能还有数据要发，所以不能合并。' });
        c.seg('b', { flags: ['FIN', 'ACK'], label: 'FIN', dt: 18, caption: '“我也说完了。”' });
        c.seg('a', { flags: ['ACK'], label: 'ACK', caption: '最后的确认。客户端进入 TIME_WAIT，再等 2 倍 MSL，以防这个 ACK 丢了需要重发。' });
        s.outro('如果服务器没有别的话要说，第二步和第三步常合并成一个 FIN-ACK，这时就是“三次挥手”。在 `ss -tan` 里看到大量 TIME_WAIT 是正常现象。');
      },
    },
    {
      id: 'lost-syn',
      title: 'SYN 丢了',
      fault: true,
      positions: wan,
      intro: '第一个包就在半路丢了。TCP 怎么发现，又怎么处理？',
      build(s) {
        const c = s.tcpFlow({ path: P, sport: 52344, dport: 443 });
        s.step('石沉大海', 'SYN 在骨干网丢失。服务器根本不知道有人来过，客户端只能等。', [['初始 RTO', '1 秒 (RFC 6298)']]);
        c.seg('a', { flags: ['SYN'], label: 'SYN', options: synOpts, noAdvance: true, lost: { link: 2, at: 0.6 }, caption: '包消失了。客户端启动重传定时器。', dt: 1000 });

        s.step('超时重传', '1 秒内没等到 SYN-ACK，客户端重发。序号一样，因为这就是同一个 SYN。再失败就等 2 秒、4 秒、8 秒，指数退避。', [
          ['序号', '不变'],
          ['下次超时', '2 秒'],
        ]);
        s.ask('重传的 SYN，序号和第一次相比？', ['完全相同', '加 1', '换一个新的随机值'], 0, '重传就是把同样的内容再发一遍，所以序号相同。Wireshark 把它标记为 TCP Retransmission。');
        c.seg('a', { flags: ['SYN'], label: 'SYN 重传', options: synOpts, caption: 'TCP 内容和第一个包一模一样，只有 IP 层的标识和校验和不同。' });
        c.seg('b', { flags: ['SYN', 'ACK'], label: 'SYN-ACK', options: synOpts, caption: '这次到了。' });
        c.seg('a', { flags: ['ACK'], label: 'ACK', caption: '连接建立，但比正常慢了整整 1 秒。' });
        s.outro('这就是有时打开网页突然卡 1 秒然后恢复的原因之一。Linux 默认重试 6 次 SYN，总共大约等 127 秒才放弃。');
      },
    },
    {
      id: 'fast-retransmit',
      title: '快速重传',
      fault: true,
      positions: wan,
      intro: '连接已建立，客户端连续发出 5 段数据，第 2 段丢了。这次不用等定时器。',
      build(s) {
        const c = s.tcpFlow({ path: P, sport: 52344, dport: 7 });
        const isn = c.a.isn;
        c.a.seq = (isn + 1) >>> 0;
        c.b.seq = (c.b.isn + 1) >>> 0;
        const chunk = (n) => rawApp({ bytes: ascii(String(n).repeat(500)), show: `第 ${n} 段，500 字节` });
        const seg = (n, o) => c.seg('a', { flags: ['PSH', 'ACK'], payload: chunk(n), kind: 'data', label: `段 ${n}`, dt: 1, ...o });
        const rel = (x) => (x - isn) >>> 0;

        s.step('连发 5 段', '窗口允许的话，发送方不用等确认，可以一口气发很多段。这就是滑动窗口。第 2 段不幸丢失。', [
          ['每段', '500 字节'],
          ['在途数据', '2500 字节'],
        ]);
        seg(1, { caption: '第 1 段，Seq=1。' });
        const hole = c.a.seq;
        seg(2, { lost: { link: 3, at: 0.5 }, caption: '第 2 段，Seq=501，丢了。' });
        const after2 = c.a.seq;
        seg(3, { caption: '第 3 段，Seq=1001。' });
        seg(4, { caption: '第 4 段，Seq=1501。' });
        seg(5, { dt: 18, caption: '第 5 段，Seq=2001。' });
        const end = c.a.seq;

        s.step('重复确认', '接收方只能确认连续收到的部分。收到第 3、4、5 段时，它一遍遍喊 Ack=501：我还在等 501。SACK 选项同时说明后面已经收到了哪些。', [
          ['累积确认', '卡在 501'],
          ['SACK', '报告空洞之后的数据'],
        ]);
        c.seg('b', { flags: ['ACK'], ack: hole, label: 'Ack=501', dt: 1, caption: '第 1 段的正常确认。' });
        const dup = (i, right, o = {}) =>
          c.seg('b', {
            flags: ['ACK'],
            ack: hole,
            label: `重复 ACK ${i}`,
            dt: 1,
            options: [tcpOpt.sack(after2, right, rel(after2), rel(right))],
            caption: `第 ${i} 个重复 ACK。看 SACK 选项，它已经收到了空洞后面的数据。`,
            ...o,
          });
        dup(1, (after2 + 500) >>> 0);
        dup(2, (after2 + 1000) >>> 0);
        s.ask('发送方收到第几个重复 ACK 时，不等超时立刻重传？', ['第 1 个', '第 3 个', '第 10 个'], 1, '一两个重复 ACK 可能只是乱序。连续 3 个基本可以断定丢包了，这就是快速重传，比等 RTO 快得多。');
        dup(3, end, { dt: 19 });

        s.step('快速重传', '3 个重复 ACK 就足够说明问题。发送方只补第 2 段，不用把后面全部重发一遍。', [
          ['触发条件', '3 个重复 ACK'],
          ['拥塞窗口', '减半（快速恢复）'],
        ]);
        seg(2, { seq: hole, noAdvance: true, label: '重传段 2', dt: 18, caption: '只补上空洞这一段，序号还是 501。' });
        c.seg('b', { flags: ['ACK'], ack: end, label: 'Ack=2501', caption: '空洞补上了，确认号一下跳到 2501：前面全齐了。' });
        s.outro('这里的 Ack 一次覆盖了 2000 字节。TCP 还把丢包当作拥塞信号，会同时收缩发送速度，这是互联网没有被流量压垮的关键机制之一。');
      },
    },
    {
      id: 'refused',
      title: '连接被拒绝',
      fault: true,
      positions: wan,
      intro: '服务器活着，但 8080 端口没有程序监听。',
      build(s) {
        const c = s.tcpFlow({ path: P, sport: 52344, dport: 8080 });
        c.b.isn = 0;
        c.b.seq = 0;
        s.step('敲门', 'SYN 到达服务器内核，内核发现没有进程在这个端口监听。', [['目的端口', '8080']]);
        c.seg('a', { flags: ['SYN'], label: 'SYN', options: synOpts, caption: '和往常一样的 SYN。' });
        s.step('立刻拒绝', '内核回一个 RST，干脆利落。程序里看到的就是 Connection refused。', [
          ['RST', '立即中止，不用挥手'],
          ['错误', 'ECONNREFUSED'],
        ]);
        s.ask('如果防火墙直接把 SYN 丢了（而不是回 RST），客户端会看到什么？', ['立刻 Connection refused', '等待一段时间后 Connection timed out', '连接成功'], 1, '被拒绝是“有人明确说不”，超时是“没人说话”。这个差别是排查网络问题的第一条线索：refused 说明网络通、服务没起；timed out 多半是防火墙或路由问题。');
        c.seg('b', { flags: ['RST', 'ACK'], label: 'RST', caption: '全程只用了一个往返。' });
        s.outro('Connection refused 其实算好消息：它证明包到了对方主机，问题只在服务本身。');
      },
    },
  ],
};
