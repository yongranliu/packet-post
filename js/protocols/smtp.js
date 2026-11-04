import { smtp } from '../net/layers.js';
import { route } from '../world.js';

const web = { client: [100, 350], router: [290, 230], isp: [490, 340], core: [680, 220], mail: [885, 320] };
const P = route('mail');

const open = (s, c) => {
  s.step('打通连接，服务器先说话', '大多数协议是客户端先开口，SMTP 相反：连接建立后，服务器先报上名号。', [
    ['端口', '25'],
    ['先开口', '服务器'],
  ]);
  c.handshake();
};

function makeTalk(c) {
  const say = (side, text, label, caption, note) =>
    c.seg(side, {
      flags: ['PSH', 'ACK'],
      kind: 'smtp',
      payload: smtp({ text: `${text}\r\n`, note }),
      label,
      info: text.split('\r\n')[0],
      caption,
    });
  return { c: (t, l, cap, n) => say('a', t, l, cap, n), s: (t, l, cap, n) => say('b', t, l, cap, n) };
}

export default {
  id: 'smtp',
  name: 'SMTP',
  full: 'Simple Mail Transfer Protocol',
  cn: '简单邮件传输协议',
  layer: '应用层',
  port: '25 (服务器间) / 587 (提交)',
  transport: 'TCP',
  rfc: 'RFC 5321, 5322',
  stamp: '25',
  summary: '互联网上最古老的协议之一，至今还在运转。它的设计直接照搬了邮局：有信封，有信纸，两者是分开的。',
  metaphor: '这一章不用比喻。它就是真的邮局：MAIL FROM 和 RCPT TO 写在信封上，From 和 To 写在信纸上。',
  scenarios: [
    {
      id: 'normal',
      title: '寄一封信',
      positions: web,
      intro: '一封邮件从发信方到达收件方的邮件服务器。整段对话都能在 telnet 里手敲。',
      build(s) {
        const c = s.tcpFlow({ path: P, sport: 52400, dport: 25 });
        const t = makeTalk(c);
        open(s, c);
        t.s('220 mail.example.org ESMTP ready', '220 欢迎', '服务器的第一句话。三位数字给机器看，后面的文字给人看。', '220 表示服务就绪。第一位 2 成功、3 继续、4 暂时失败、5 永久失败。');

        s.step('互报家门', 'EHLO 打招呼，服务器列出支持的扩展。真实环境下这里会接着走 STARTTLS，为了看清内容这里跳过了。', [['命令', 'EHLO']]);
        t.c('EHLO laptop.example.com', 'EHLO', '客户端自我介绍。', 'EHLO 是 HELO 的升级版，表示“我懂 ESMTP 扩展”。');
        t.s('250-mail.example.org\r\n250-SIZE 35882577\r\n250-STARTTLS\r\n250 8BITMIME', '250 扩展', '横杠表示“还没说完”，空格表示这是最后一行。', '多行响应：250- 后面还有，250 空格是结束。');

        s.step('写信封', 'MAIL FROM 和 RCPT TO 就是信封。投递只看它们，邮件内容里的 From/To 服务器根本不看。', [
          ['信封发件人', 'you@example.com'],
          ['信封收件人', 'friend@example.org'],
        ]);
        t.c('MAIL FROM:<you@example.com>', 'MAIL FROM', '信封上的寄件人。投递失败时退信就寄到这里。', '也叫 envelope sender 或 Return-Path。');
        t.s('250 2.1.0 OK', '250', '好的。');
        t.c('RCPT TO:<friend@example.org>', 'RCPT TO', '信封上的收件人。群发时可以有多条 RCPT TO，这就是密送 BCC 的实现方式。', 'BCC 的人只出现在信封上，信纸上没有，所以其他收件人看不到。');
        t.s('250 2.1.5 OK', '250', '这个收件人没问题。');

        s.step('写信纸', 'DATA 之后的内容才是信纸，From、To、Subject 都在这里，而且是发信人自己写的。', [
          ['结束标记', '单独一行的句点'],
          ['格式规范', 'RFC 5322'],
        ]);
        s.ask('信纸上的 From: 能写得和信封上的 MAIL FROM 不一样吗？', ['不能，服务器会拒绝', '能，协议本身不检查', '只有管理员能改'], 1, '这是钓鱼邮件的根源：SMTP 本身不验证 From。所以后来才有了 SPF、DKIM、DMARC 三件套，用 DNS 记录和签名来堵这个洞。');
        t.c('DATA', 'DATA', '“我要开始写信了。”');
        t.s('354 End data with <CR><LF>.<CR><LF>', '354', '3 开头：继续，等你发完。');
        c.seg('a', {
          flags: ['PSH', 'ACK'],
          kind: 'smtp',
          payload: smtp({
            name: '邮件内容',
            label: '信纸',
            text: 'From: You <you@example.com>\r\nTo: Friend <friend@example.org>\r\nSubject: Hello\r\nDate: Wed, 04 Nov 2026 11:24:00 +0800\r\n\r\nHi! This letter travelled over TCP.\r\n.\r\n',
            note: '这才是收件人邮箱里看到的内容。',
          }),
          label: '信纸',
          info: 'Message: From: You <you@example.com>, Subject: Hello',
          caption: '邮件内容和信封完全分开。最后那一行单独的句点表示信写完了。',
        });
        t.s('250 2.0.0 OK: queued as 7F3A', '250 入队', '服务器接下这封信，责任从这一刻起转移给它。');

        s.step('道别', 'QUIT 结束这次会话。一条连接里其实可以连续寄很多封。', [['命令', 'QUIT']]);
        t.c('QUIT', 'QUIT', '客户端道别。');
        t.s('221 2.0.0 Bye', '221', '服务器道别。');
        s.outro('现实中你的邮件客户端先用 587 端口和账号密码把信交给自己的服务器，再由它用 25 端口投递到对方。收信则用 IMAP 或 POP3，那是另一回事。SMTP 只管“寄”。');
      },
    },
    {
      id: 'rejected',
      title: '查无此人',
      fault: true,
      positions: web,
      intro: '收件人地址拼错了。服务器在信封阶段就能发现，不用等信纸。',
      build(s) {
        const c = s.tcpFlow({ path: P, sport: 52400, dport: 25 });
        const t = makeTalk(c);
        open(s, c);
        t.s('220 mail.example.org ESMTP ready', '220 欢迎', '和往常一样。');
        s.step('写信封', '前面都一样，直到写收件人。', [['收件人', 'freind@example.org（拼错了）']]);
        t.c('EHLO laptop.example.com', 'EHLO', '打招呼。');
        t.s('250 mail.example.org', '250', '简短回应。');
        t.c('MAIL FROM:<you@example.com>', 'MAIL FROM', '发件人没问题。');
        t.s('250 2.1.0 OK', '250', '好的。');
        s.ask('服务器要回复“没有这个用户”。这个状态码第一位是几？', ['2 (成功)', '4 (暂时失败，稍后重试)', '5 (永久失败，别再试了)'], 2, '4xx 让发件方排队过会儿再试，5xx 让发件方立刻放弃并退信。用户不存在不是等一等就能好的事。');
        t.c('RCPT TO:<freind@example.org>', 'RCPT TO', 'friend 拼成了 freind。');

        s.step('当场拒收', '服务器直接拒绝，信纸都不用发。第一位是 5，意味着永久失败，发件方应该把信退回给写信的人。', [
          ['状态码', '550 5.1.1'],
          ['含义', '永久失败'],
        ]);
        t.s('550 5.1.1 User unknown', '550', '5 开头：别再试了。', '5.1.1 是增强状态码，意思是收件地址不存在。');
        t.c('QUIT', 'QUIT', '客户端放弃。');
        t.s('221 2.0.0 Bye', '221', '再见。');
        s.outro('你收到的 “Mail Delivery Failed” 退信，就是你的邮件服务器根据这个 550 生成的。4xx 则会让服务器排队重试好几天，所以有时候退信要过很久才来。');
      },
    },
  ],
};
