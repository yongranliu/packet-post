// 主程序。全部界面都是 (协议, 场景, 游标) 的函数：
// 播放、后退、跳转、深链接都只是在改游标，然后重新渲染。

import { PROTOCOLS, findProtocol, loadScript } from './protocols/index.js';
import { toPcap } from './net/pcap.js';
import { createMap } from './ui/map.js';
import { createSequence } from './ui/sequence.js';
import { createLog } from './ui/log.js';
import { createInspector } from './ui/inspector.js';
import { renderAlbum, stampHtml } from './ui/album.js';
import { esc, postmark, rich, uiIcon } from './ui/icons.js';

const $ = (s) => document.querySelector(s);
const KEY = 'packet-post.v1';

function readStore() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? {};
  } catch {
    return {};
  }
}
function writeStore() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ done: S.done, quiz: S.quiz, theme: S.theme }));
  } catch {
    /* 隐私模式下存不了，不影响使用 */
  }
}

const stored = readStore();
const S = {
  proto: PROTOCOLS[0].id,
  sc: PROTOCOLS[0].scenarios[0].id,
  script: null,
  cursor: -1,
  sel: -1,
  link: 0,
  playing: false,
  speed: 1,
  view: 'map',
  tab: 'story',
  quiz: stored.quiz ?? true,
  theme: stored.theme ?? null,
  done: stored.done ?? {},
  answered: new Set(),
  quizOpen: null,
};

let runId = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = () => S.script.frames;
const isDone = (p, s) => !!S.done[`${p}/${s}`];

const map = createMap($('#map'), { onOpen: (f) => openFrame(f.n) });
const seq = createSequence($('#seq'), { onSelect: (n) => openFrame(n) });
const log = createLog($('#log'), { onSelect: (n) => openFrame(n) });
const inspector = createInspector($('#tab-open'), {
  onLink: (i) => {
    S.link = i;
    renderInspector();
  },
});

/* ───────── 导航 ───────── */

function load(protoId, scId, cursor = -1) {
  pause();
  S.proto = protoId;
  S.sc = scId;
  S.script = loadScript(protoId, scId);
  S.cursor = Math.min(cursor, frames().length - 1);
  S.sel = S.cursor;
  S.link = S.cursor >= 0 ? frames()[S.cursor].capture : 0;
  S.answered = new Set();
  closeQuiz();
  map.setScript(S.script);
  seq.setScript(S.script);
  map.update(frames()[S.cursor]);
  render();
}

function go(n) {
  pause();
  closeQuiz();
  S.cursor = Math.max(-1, Math.min(n, frames().length - 1));
  S.sel = S.cursor;
  if (S.cursor >= 0) S.link = frames()[S.cursor].capture;
  map.update(frames()[S.cursor]);
  render();
}

/** 点了某个包：停下来，把它拆开 */
function openFrame(n) {
  pause();
  S.sel = n;
  S.link = frames()[n].capture;
  S.tab = 'open';
  render();
}

/* ───────── 播放 ───────── */

function pause() {
  runId++;
  S.playing = false;
  map.stop();
}

function needsQuiz(f) {
  return S.quiz && f.ask && !S.answered.has(f.n);
}

async function forward(id) {
  const next = frames()[S.cursor + 1];
  if (!next) {
    S.playing = false;
    render();
    return;
  }
  if (needsQuiz(next)) {
    showQuiz(next);
    return;
  }
  const newStep = S.cursor < 0 || frames()[S.cursor].step !== next.step;
  S.cursor += 1;
  S.sel = S.cursor;
  S.link = next.capture;
  render();
  const ok = S.view === 'map' ? await map.animate(next, S.speed) : (await sleep(850 / S.speed), true);
  if (!ok || id !== runId) return;
  if (S.view !== 'map') map.update(next);
  if (S.cursor === frames().length - 1) {
    S.playing = false;
    complete();
    render();
    return;
  }
  if (!S.playing) return;
  await sleep(((newStep ? 1500 : 800) + next.caption?.length * 22) / S.speed);
  if (id === runId && S.playing) forward(id);
}

function play() {
  if (S.cursor >= frames().length - 1) {
    S.cursor = -1;
    S.sel = -1;
    map.update(null);
  }
  const id = ++runId;
  S.playing = true;
  renderControls();
  forward(id);
}

function stepOnce() {
  pause();
  const id = ++runId;
  forward(id);
}

function togglePlay() {
  if (S.quizOpen) return;
  if (S.playing) {
    pause();
    map.update(frames()[S.cursor]);
    render();
  } else {
    play();
  }
}

function complete() {
  const key = `${S.proto}/${S.sc}`;
  const first = !S.done[key];
  S.done[key] = true;
  writeStore();
  if (first) toast();
}

function toast() {
  const proto = findProtocol(S.proto);
  const main = proto.scenarios[0].id === S.sc;
  const box = $('#toast');
  box.innerHTML = main
    ? `<div class="toast-stamp">${stampHtml(proto, PROTOCOLS.indexOf(proto), { earned: true, done: proto.scenarios.filter((s) => isDone(proto.id, s.id)).length })}</div><p><b>盖章！</b>${esc(proto.name)} 已收入集邮册</p>`
    : `<p><b>场景完成</b>${esc(S.script.scenario.title)}</p>`;
  box.classList.remove('show');
  void box.offsetWidth;
  box.classList.add('show');
  setTimeout(() => box.classList.remove('show'), 3600);
}

/* ───────── 猜一猜 ───────── */

function showQuiz(f) {
  S.quizOpen = f;
  const q = f.ask;
  const box = $('#quiz');
  box.hidden = false;
  box.innerHTML = `
    <div class="quiz-card">
      <span class="quiz-kicker">寄出之前，先猜一猜</span>
      <p class="quiz-q">${rich(q.question)}</p>
      <div class="quiz-opts">${q.options.map((o, i) => `<button data-i="${i}"><kbd>${i + 1}</kbd><span>${rich(o)}</span></button>`).join('')}</div>
      <div class="quiz-why" hidden></div>
      <div class="quiz-foot"><button class="ghost" data-skip>跳过</button></div>
    </div>`;
  renderControls();
}

function answerQuiz(i) {
  const f = S.quizOpen;
  const box = $('#quiz');
  if (!f || box.querySelector('.quiz-opts.done')) return;
  const opts = box.querySelector('.quiz-opts');
  opts.classList.add('done');
  [...opts.children].forEach((b, k) => {
    b.disabled = true;
    if (k === f.ask.answer) b.classList.add('right');
    else if (k === i) b.classList.add('wrong');
  });
  const why = box.querySelector('.quiz-why');
  why.hidden = false;
  why.innerHTML = `<b>${i === f.ask.answer ? '答对了。' : '差一点。'}</b>${rich(f.ask.why)}`;
  box.querySelector('.quiz-foot').innerHTML = `<button class="primary" data-go>寄出这封信 ${uiIcon('next', 14)}</button>`;
  box.querySelector('[data-go]').focus();
}

function closeQuiz() {
  S.quizOpen = null;
  const box = $('#quiz');
  box.hidden = true;
  box.innerHTML = '';
}

function continueAfterQuiz() {
  const f = S.quizOpen;
  if (!f) return;
  S.answered.add(f.n);
  closeQuiz();
  const id = ++runId;
  forward(id);
}

$('#quiz').addEventListener('click', (e) => {
  const opt = e.target.closest('[data-i]');
  if (opt) return answerQuiz(Number(opt.dataset.i));
  if (e.target.closest('[data-go],[data-skip]')) continueAfterQuiz();
});

/* ───────── 渲染 ───────── */

function renderNav() {
  $('#nav').innerHTML = `
    <div class="nav-title">投递路线</div>
    <ol>${PROTOCOLS.map((p, i) => {
      const n = p.scenarios.filter((s) => isDone(p.id, s.id)).length;
      const earned = isDone(p.id, p.scenarios[0].id);
      return `<li><button class="stop${p.id === S.proto ? ' on' : ''}${earned ? ' earned' : ''}" data-p="${p.id}" ${p.id === S.proto ? 'aria-current="true"' : ''}>
        <span class="stop-dot">${i + 1}</span>
        <span class="stop-t"><b>${esc(p.name)}</b><em>${esc(p.cn)}</em></span>
        <span class="stop-n">${n}/${p.scenarios.length}</span>
      </button></li>`;
    }).join('')}</ol>`;
}

function renderHead() {
  const p = findProtocol(S.proto);
  $('#scenarios').innerHTML = p.scenarios
    .map(
      (s) => `<button class="sc${s.id === S.sc ? ' on' : ''}${s.fault ? ' fault' : ''}" data-s="${s.id}" role="tab" aria-selected="${s.id === S.sc}">
      ${isDone(p.id, s.id) ? '<i class="sc-ok">✓</i>' : ''}${esc(s.title)}</button>`,
    )
    .join('');
  document.querySelectorAll('[data-view]').forEach((b) => {
    b.classList.toggle('on', b.dataset.view === S.view);
    b.setAttribute('aria-pressed', b.dataset.view === S.view);
  });
  $('#map').classList.toggle('hide', S.view !== 'map');
  $('#seq').classList.toggle('hide', S.view !== 'seq');
  const count = PROTOCOLS.filter((x) => isDone(x.id, x.scenarios[0].id)).length;
  $('#album-count').textContent = `${count}/${PROTOCOLS.length}`;
}

function renderCaption() {
  const f = frames()[S.cursor];
  const cap = $('#caption');
  cap.innerHTML = f?.caption ? `<span class="t-${f.kind}">${f.n + 1}</span><p>${rich(f.caption)}</p>` : '';
  cap.classList.toggle('empty', !f?.caption);
}

function renderControls() {
  const atEnd = S.cursor >= frames().length - 1;
  $('#btn-play').innerHTML = S.playing ? `${uiIcon('pause')}<span>暂停</span>` : `${uiIcon('play')}<span>${atEnd ? '再来一遍' : S.cursor >= 0 ? '继续' : '开始投递'}</span>`;
  $('#btn-prev').disabled = S.cursor < 0;
  $('#btn-next').disabled = atEnd;
  $('#btn-reset').disabled = S.cursor < 0;
  $('#speed').textContent = `${S.speed}×`;
  $('#quiz-toggle').setAttribute('aria-pressed', S.quiz);
  $('#quiz-toggle').classList.toggle('on', S.quiz);
  $('#ticks').innerHTML = frames()
    .map((f) => {
      const newStep = f.n > 0 && frames()[f.n - 1].step !== f.step;
      return `<button class="tick t-${f.kind}${f.n <= S.cursor ? ' on' : ''}${f.n === S.cursor ? ' cur' : ''}${f.lost ? ' lost' : ''}${newStep ? ' gap' : ''}" data-t="${f.n}" aria-label="第 ${f.n + 1} 个包：${esc(f.label)}" title="${f.n + 1}. ${esc(f.label)}"></button>`;
    })
    .join('');
  $('#counter').textContent = `${S.cursor + 1} / ${frames().length}`;
}

function renderStory() {
  const p = findProtocol(S.proto);
  const sc = S.script.scenario;
  const f = frames()[S.cursor];
  const root = $('#tab-story');
  const steps = S.script.steps;
  const stepList = `<ol class="steps">${steps
    .map((st, i) => {
      const first = frames().find((x) => x.step === i);
      const cur = f ? f.step : -1;
      return `<li class="${i === cur ? 'on' : i < cur ? 'past' : ''}"><button data-go="${first?.n ?? 0}"><span>${i + 1}</span>${esc(st.title)}</button></li>`;
    })
    .join('')}</ol>`;

  if (!f) {
    const facts = [
      ['所在层', p.layer],
      ['端口', p.port],
      ['承载于', p.transport],
      ['规范', p.rfc],
    ];
    root.innerHTML = `
      <article class="card">
        <span class="kicker">第 ${PROTOCOLS.indexOf(p) + 1} 站</span>
        <h2>${esc(p.name)}</h2>
        <p class="full">${esc(p.cn)} · ${esc(p.full)}</p>
        <p class="lead">${rich(p.summary)}</p>
        <blockquote>${rich(p.metaphor)}</blockquote>
        <dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      </article>
      <article class="card scene">
        <span class="kicker${sc.fault ? ' fault' : ''}">${sc.fault ? '出了点事' : '这一趟'}</span>
        <h3>${esc(sc.title)}</h3>
        <p>${rich(sc.intro)}</p>
        ${stepList}
      </article>`;
    return;
  }

  const st = steps[f.step];
  const atEnd = S.cursor === frames().length - 1;
  const nextProto = PROTOCOLS[PROTOCOLS.indexOf(p) + 1];
  const scIdx = p.scenarios.indexOf(sc);
  const nextSc = p.scenarios[scIdx + 1];
  root.innerHTML = `
    <article class="card">
      <span class="kicker">第 ${f.step + 1} / ${steps.length} 步</span>
      <h2 class="step-title">${esc(st.title)}</h2>
      <p class="lead">${rich(st.body)}</p>
      ${st.facts.length ? `<dl class="facts">${st.facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
      <button class="open-link" data-open>${uiIcon('next', 14)}拆开这封信，看里面的字节</button>
    </article>
    ${
      atEnd && S.script.outroText
        ? `<article class="card outro">
        <span class="kicker">这一趟的收获</span>
        <p>${rich(S.script.outroText)}</p>
        <div class="outro-next">
          ${nextSc ? `<button class="primary" data-goto="${p.id}/${nextSc.id}">下一个场景：${esc(nextSc.title)}</button>` : ''}
          ${nextProto ? `<button class="${nextSc ? 'ghost' : 'primary'}" data-goto="${nextProto.id}/${nextProto.scenarios[0].id}">下一站：${esc(nextProto.name)}</button>` : ''}
        </div>
      </article>`
        : ''
    }
    <article class="card scene">${stepList}</article>`;
}

function renderInspector() {
  const f = frames()[S.sel];
  inspector.render(f, f ? Math.min(S.link, f.links - 1) : 0);
}

function renderSide() {
  document.querySelectorAll('[data-tab]').forEach((b) => {
    b.classList.toggle('on', b.dataset.tab === S.tab);
    b.setAttribute('aria-selected', b.dataset.tab === S.tab);
  });
  $('#tab-story').hidden = S.tab !== 'story';
  $('#tab-open').hidden = S.tab !== 'open';
  if (S.tab === 'story') renderStory();
  else renderInspector();
}

function renderHash() {
  const h = `#/${S.proto}/${S.sc}${S.cursor >= 0 ? `/${S.cursor + 1}` : ''}`;
  if (location.hash !== h) history.replaceState(null, '', h);
}

function render() {
  renderNav();
  renderHead();
  renderCaption();
  renderControls();
  seq.update(S.cursor, S.sel);
  log.update(S.script, S.cursor, S.sel);
  renderSide();
  renderHash();
  document.title = `${findProtocol(S.proto).name} · 报文邮局`;
}

/* ───────── 事件 ───────── */

$('#nav').addEventListener('click', (e) => {
  const b = e.target.closest('[data-p]');
  if (!b) return;
  const p = findProtocol(b.dataset.p);
  load(p.id, p.scenarios[0].id);
});
$('#scenarios').addEventListener('click', (e) => {
  const b = e.target.closest('[data-s]');
  if (b) load(S.proto, b.dataset.s);
});
document.querySelectorAll('[data-view]').forEach((b) =>
  b.addEventListener('click', () => {
    S.view = b.dataset.view;
    map.update(frames()[S.cursor]);
    render();
  }),
);
document.querySelectorAll('[data-tab]').forEach((b) =>
  b.addEventListener('click', () => {
    S.tab = b.dataset.tab;
    renderSide();
  }),
);
$('#tab-story').addEventListener('click', (e) => {
  const open = e.target.closest('[data-open]');
  if (open) return openFrame(S.cursor);
  const goto = e.target.closest('[data-goto]');
  if (goto) {
    const [p, s] = goto.dataset.goto.split('/');
    S.tab = 'story';
    return load(p, s);
  }
  const step = e.target.closest('[data-go]');
  if (step) go(Number(step.dataset.go));
});

$('#btn-play').addEventListener('click', togglePlay);
$('#btn-next').addEventListener('click', () => (S.quizOpen ? null : stepOnce()));
$('#btn-prev').addEventListener('click', () => go(S.cursor - 1));
$('#btn-reset').addEventListener('click', () => go(-1));
$('#speed').addEventListener('click', () => {
  S.speed = S.speed === 1 ? 2 : S.speed === 2 ? 0.5 : 1;
  renderControls();
});
$('#quiz-toggle').addEventListener('click', () => {
  S.quiz = !S.quiz;
  writeStore();
  renderControls();
});
$('#ticks').addEventListener('click', (e) => {
  const t = e.target.closest('[data-t]');
  if (t) go(Number(t.dataset.t));
});

$('#btn-pcap').addEventListener('click', () => {
  const url = URL.createObjectURL(toPcap(frames()));
  const a = document.createElement('a');
  a.href = url;
  a.download = `packet-post-${S.proto}-${S.sc}.pcap`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});

const album = $('#album');
$('#btn-album').addEventListener('click', () => {
  renderAlbum(album, PROTOCOLS, isDone);
  album.showModal();
});
$('#album-close').addEventListener('click', () => album.close());
album.addEventListener('click', (e) => {
  if (e.target === album) album.close();
});
$('#album-reset').addEventListener('click', () => {
  if (!confirm('清空所有邮票和进度？')) return;
  S.done = {};
  writeStore();
  renderAlbum(album, PROTOCOLS, isDone);
  render();
});

function applyTheme() {
  if (S.theme) document.documentElement.dataset.theme = S.theme;
  const dark = S.theme ? S.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  $('#btn-theme').innerHTML = uiIcon(dark ? 'sun' : 'moon', 17);
  $('#btn-theme').setAttribute('aria-label', dark ? '切换到白天' : '切换到夜班');
}
$('#btn-theme').addEventListener('click', () => {
  const dark = S.theme ? S.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  S.theme = dark ? 'light' : 'dark';
  writeStore();
  applyTheme();
});

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input,textarea') || album.open || e.metaKey || e.ctrlKey || e.altKey) return;
  if (S.quizOpen) {
    const answered = $('#quiz .quiz-opts.done');
    if (!answered && /^[1-4]$/.test(e.key) && Number(e.key) <= S.quizOpen.ask.options.length) answerQuiz(Number(e.key) - 1);
    else if (answered && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      continueAfterQuiz();
    }
    return;
  }
  const onControl = e.target.matches('button,[role=button],tr');
  if (e.key === ' ' && !onControl) {
    e.preventDefault();
    togglePlay();
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    if (S.cursor < frames().length - 1) stepOnce();
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    go(S.cursor - 1);
  } else if (e.key === 'r') {
    go(-1);
  } else if (e.key === 'v') {
    S.view = S.view === 'map' ? 'seq' : 'map';
    map.update(frames()[S.cursor]);
    render();
  } else if (e.key === 'o') {
    S.tab = S.tab === 'open' ? 'story' : 'open';
    renderSide();
  }
});

function fromHash() {
  const [, p, s, n] = location.hash.split('/');
  const proto = findProtocol(p);
  if (!proto) return false;
  const sc = proto.scenarios.find((x) => x.id === s) ?? proto.scenarios[0];
  load(proto.id, sc.id, n ? Number(n) - 1 : -1);
  return true;
}
window.addEventListener('hashchange', fromHash);

$('#brand-mark').innerHTML = postmark({ mid: '✉', size: 44, id: 'brand' });
applyTheme();
if (!fromHash()) load(S.proto, S.sc);

