// 地图视图：节点是邮戳形状的“站”，包是沿路线飞的信封。

import { NODES } from '../world.js';
import { ICONS, esc } from './icons.js';

const NS = 'http://www.w3.org/2000/svg';
const R = 34; // 节点半径
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const el = (tag, attrs = {}, html) => {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (html !== undefined) n.innerHTML = html;
  return n;
};

const textWidth = (s) => [...String(s)].reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 14 : 8), 0);
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export function createMap(svg, { onOpen }) {
  let pos = {};
  let wires = new Map();
  let nodeEls = {};
  let layerWires;
  let layerNodes;
  let layerEnv;
  let raf = 0;
  let resolveRun = null;
  let stopWatchdog = () => {};

  function setScript(script) {
    stop();
    pos = script.scenario.positions;
    svg.innerHTML = '';
    wires = new Map();
    nodeEls = {};
    layerWires = el('g');
    layerNodes = el('g');
    layerEnv = el('g');
    svg.append(layerWires, layerNodes, layerEnv);

    for (const f of script.frames) {
      for (const path of [f.path, ...f.also]) {
        for (let i = 0; i + 1 < path.length; i++) addWire(path[i], path[i + 1]);
      }
    }
    for (const id of script.nodes) {
      const n = NODES[id];
      const [x, y] = pos[id];
      const small = n.kind === 'switch';
      const g = el('g', { class: `node${n.kind ? ` is-${n.kind}` : ''}`, transform: `translate(${x} ${y})` });
      g.innerHTML = `
        <circle class="ring-pulse" r="${R}"/>
        <circle class="ring" r="${R}"/>
        <circle class="ring-in" r="${R - 5}"/>
        <g transform="translate(-19 -19) scale(.95)" class="glyph" fill="none" stroke="currentColor" stroke-width="2.200" stroke-linecap="round" stroke-linejoin="round">${ICONS[n.icon]}</g>
        <text class="n-label" y="${R + 22}" text-anchor="middle">${esc(n.label)}</text>
        ${n.ip && !small ? `<text class="n-ip" y="${R + 40}" text-anchor="middle">${n.ip}</text>` : ''}`;
      layerNodes.append(g);
      nodeEls[id] = g;
    }
  }

  function addWire(a, b) {
    const key = [a, b].sort().join('|');
    if (wires.has(key)) return;
    if (!pos[a] || !pos[b]) throw new Error(`map: missing position for ${a} or ${b}`);
    const line = el('line', { class: 'wire', x1: pos[a][0], y1: pos[a][1], x2: pos[b][0], y2: pos[b][1] });
    layerWires.append(line);
    wires.set(key, line);
  }

  const wire = (a, b) => wires.get([a, b].sort().join('|'));

  function highlight(frame) {
    for (const w of wires.values()) w.classList.remove('hot', 'ghost');
    for (const n of Object.values(nodeEls)) n.classList.remove('from', 'to');
    if (!frame) return;
    const mark = (path, cls, upto = path.length - 1) => {
      for (let i = 0; i < upto; i++) wire(path[i], path[i + 1])?.classList.add(cls);
    };
    frame.also.forEach((p) => mark(p, 'ghost'));
    mark(frame.path, 'hot', frame.lost ? frame.lost.link + 1 : frame.path.length - 1);
    nodeEls[frame.from]?.classList.add('from');
    if (!frame.lost) nodeEls[frame.to]?.classList.add('to');
  }

  /** 信封实际走的折线。终点停在节点前面一点，不挡住图标。 */
  function pointsFor(path, lost) {
    const pts = path.map((id) => pos[id].slice());
    if (lost) {
      const a = pts[lost.link];
      const b = pts[lost.link + 1];
      const end = [a[0] + (b[0] - a[0]) * lost.at, a[1] + (b[1] - a[1]) * lost.at];
      return [...pts.slice(0, lost.link + 1), end];
    }
    const n = pts.length;
    const [ax, ay] = pts[n - 2];
    const [bx, by] = pts[n - 1];
    const d = Math.hypot(bx - ax, by - ay) || 1;
    const back = Math.min(R + 26, d * 0.45);
    pts[n - 1] = [bx - ((bx - ax) / d) * back, by - ((by - ay) / d) * back];
    return pts;
  }

  function makeEnvelope(frame, { ghost = false } = {}) {
    const g = el('g', { class: `env t-${frame.kind}${ghost ? ' ghost' : ''}`, tabindex: ghost ? -1 : 0, role: ghost ? 'presentation' : 'button', 'aria-label': `拆开：${frame.label}` });
    const w = textWidth(frame.label) + 16;
    g.innerHTML = `
      <g class="env-body">
        <rect x="-21" y="-14" width="42" height="28" rx="2"/>
        <path d="M-21 -13 L0 3 L21 -13"/>
      </g>
      ${ghost ? '' : `<g class="env-tag" transform="translate(0 -29)"><rect x="${-w / 2}" y="-12" width="${w}" height="23" rx="2"/><text text-anchor="middle" y="4">${esc(frame.label)}</text></g>`}`;
    if (!ghost) {
      g.addEventListener('click', () => onOpen(frame));
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') onOpen(frame);
      });
    }
    layerEnv.append(g);
    return g;
  }

  const place = (g, [x, y]) => g.setAttribute('transform', `translate(${Math.max(46, Math.min(954, x))} ${Math.max(42, y)})`);

  function markStop(frame, env, [x, y]) {
    if (frame.lost) {
      env.classList.add('torn');
      const m = el('g', { class: 'stop-mark', transform: `translate(${x} ${y + 34})` }, `<text text-anchor="middle">丢失</text>`);
      layerEnv.append(m);
    } else if (frame.expires) {
      env.classList.add('torn');
      const m = el('g', { class: 'stop-mark', transform: `translate(${x} ${y + 34})` }, `<text text-anchor="middle">${esc(frame.expires)}</text>`);
      layerEnv.append(m);
    }
  }

  /** 静止状态：信封停在终点，等人来拆 */
  function update(frame) {
    if (!layerEnv) return;
    layerEnv.innerHTML = '';
    highlight(frame);
    if (!frame) return;
    frame.also.forEach((p) => place(makeEnvelope(frame, { ghost: true }), pointsFor(p).at(-1)));
    const end = pointsFor(frame.path, frame.lost).at(-1);
    const env = makeEnvelope(frame);
    place(env, end);
    markStop(frame, env, end);
  }

  function floatTag(id, text) {
    const [x, y] = pos[id];
    const t = el('text', { class: 'float-tag', x, y: y - R - 10, 'text-anchor': 'middle' }, esc(text));
    layerEnv.append(t);
    setTimeout(() => t.remove(), 1100);
  }

  function pulse(id) {
    const n = nodeEls[id];
    if (!n) return;
    n.classList.remove('ping');
    void n.getBoundingClientRect();
    n.classList.add('ping');
  }

  /** 让信封沿路线飞过去。返回 Promise，飞完（或被打断）时结束。 */
  function animate(frame, speed) {
    stop();
    if (reducedMotion()) {
      update(frame);
      return Promise.resolve(true);
    }
    layerEnv.innerHTML = '';
    highlight(frame);
    const runs = [
      { g: makeEnvelope(frame), pts: pointsFor(frame.path, frame.lost), path: frame.path, main: true },
      ...frame.also.map((p) => ({ g: makeEnvelope(frame, { ghost: true }), pts: pointsFor(p), path: p })),
    ];
    const links = Math.max(...runs.map((r) => r.pts.length - 1));
    const total = (500 + 420 * links) / speed;
    const start = performance.now();
    const seen = new Set();
    pulse(frame.from);
    runs.forEach((r) => place(r.g, r.pts[0]));

    return new Promise((resolve) => {
      resolveRun = resolve;
      const finish = () => {
        clearTimeout(watchdog);
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        resolveRun = null;
        if (!frame.lost) pulse(frame.to);
        update(frame);
        resolve(true);
      };
      // 页面在后台时 rAF 会暂停，靠定时器保证播放不会卡死
      const watchdog = setTimeout(finish, total + 250);
      stopWatchdog = () => clearTimeout(watchdog);
      const tick = (now) => {
        const p = Math.max(0, Math.min(1, (now - start) / total));
        for (const r of runs) {
          const n = r.pts.length - 1;
          const q = p * n;
          const i = Math.min(n - 1, Math.floor(q));
          const t = ease(q - i);
          const a = r.pts[i];
          const b = r.pts[i + 1];
          place(r.g, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
          if (r.main && i > 0 && !seen.has(i)) {
            seen.add(i);
            const id = r.path[i];
            pulse(id);
            if (NODES[id].kind === 'router') {
              const nat = id === 'router' && !NODES[frame.from].lan !== !NODES[frame.to].lan;
              floatTag(id, nat ? 'NAT · TTL−1' : 'TTL−1');
            }
          }
        }
        if (p < 1) raf = requestAnimationFrame(tick);
        else finish();
      };
      raf = requestAnimationFrame(tick);
    });
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    stopWatchdog();
    if (resolveRun) {
      resolveRun(false);
      resolveRun = null;
    }
  }

  return { setScript, update, animate, stop };
}
