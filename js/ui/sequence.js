// 时序图：同一条时间轴的另一种读法。

import { NODES } from '../world.js';
import { esc } from './icons.js';

const ROW = 46;
const BAND = 30;
const GUTTER = 64;

export function createSequence(root, { onSelect }) {
  let script = null;
  let last = { cursor: -1, sel: -1 };
  let width = 0;

  root.addEventListener('click', (e) => {
    const r = e.target.closest('[data-n]');
    if (r) onSelect(Number(r.dataset.n));
  });

  new ResizeObserver(() => {
    if (script && root.clientWidth && root.clientWidth !== width) draw();
  }).observe(root);

  function setScript(s) {
    script = s;
    last = { cursor: -1, sel: -1 };
    draw();
  }

  function columns() {
    const ids = new Set();
    for (const f of script.frames) {
      ids.add(f.from).add(f.to);
      f.also.forEach((p) => ids.add(p.at(-1)));
    }
    const pos = script.scenario.positions;
    const list = [...ids].filter((id) => NODES[id].kind !== 'switch').sort((a, b) => pos[a][0] - pos[b][0]);
    const usable = width - GUTTER - 70;
    const x = {};
    list.forEach((id, i) => {
      x[id] = GUTTER + 40 + (list.length > 1 ? (usable * i) / (list.length - 1) : usable / 2);
    });
    return { list, x };
  }

  function draw() {
    if (!script) return;
    width = Math.max(root.clientWidth, 520);
    const { list, x } = columns();
    let y = 8;
    let step = -1;
    const parts = [];
    for (const f of script.frames) {
      if (f.step !== step) {
        step = f.step;
        parts.push(`<g class="sq-band" data-upto="${f.n}"><text x="8" y="${y + 19}">第 ${step + 1} 步 · ${esc(script.steps[step].title)}</text><line x1="0" x2="${width}" y1="${y + BAND - 3}" y2="${y + BAND - 3}"/></g>`);
        y += BAND;
      }
      parts.push(rowSvg(f, x, y + ROW / 2 + 6));
      y += ROW;
    }
    const height = y + 16;
    const lifelines = list.map((id) => `<line class="sq-life" x1="${x[id]}" x2="${x[id]}" y1="0" y2="${height}"/>`).join('');
    const heads = list
      .map((id) => `<div class="sq-head" style="left:${x[id]}px"><b>${esc(NODES[id].label)}</b><span>${NODES[id].ip ?? ''}</span></div>`)
      .join('');
    root.innerHTML = `
      <div class="sq-heads" style="width:${width}px">${heads}</div>
      <svg class="sq-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <defs><marker id="sq-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="context-stroke"/></marker></defs>
        ${lifelines}${parts.join('')}
      </svg>`;
    update(last.cursor, last.sel, false);
  }

  function rowSvg(f, x, y) {
    const x1 = x[f.from];
    const x2 = x[f.to];
    const stopped = f.lost ? x1 + (x2 - x1) * 0.6 : x2;
    const dir = x2 > x1 ? 1 : -1;
    const mid = (x1 + stopped) / 2;
    const ghosts = f.also
      .map((p) => {
        const gx = x[p.at(-1)];
        return gx === undefined ? '' : `<line class="sq-ghost" x1="${x1}" x2="${gx - dir * 3}" y1="${y}" y2="${y + 9}"/>`;
      })
      .join('');
    const cross = f.lost || f.expires ? `<path class="sq-x" d="M${stopped - 7} ${y + 2}l14 14m0-14l-14 14"/>` : '';
    const endY = y + 9;
    return `<g class="sq-row t-${f.kind}" data-n="${f.n}" role="button" tabindex="0" aria-label="${esc(f.label)}">
      <rect class="sq-hit" x="0" y="${y - 24}" width="100%" height="${ROW}"/>
      <text class="sq-time" x="8" y="${y + 4}">${(f.time / 1000).toFixed(3)}</text>
      ${ghosts}
      <line class="sq-arrow" x1="${x1}" x2="${stopped - dir * 2}" y1="${y}" y2="${endY}" ${f.lost ? '' : 'marker-end="url(#sq-arrow)"'}/>
      ${cross}
      <text class="sq-label" x="${mid}" y="${y - 6}" text-anchor="middle">${esc(f.label)}</text>
    </g>`;
  }

  function update(cursor, sel, animate = true) {
    const advanced = animate && cursor === last.cursor + 1;
    last = { cursor, sel };
    root.querySelectorAll('.sq-row').forEach((g) => {
      const n = Number(g.dataset.n);
      g.classList.toggle('on', n <= cursor);
      g.classList.toggle('sel', n === sel);
      g.classList.toggle('fresh', advanced && n === cursor);
    });
    root.querySelectorAll('.sq-band').forEach((g) => g.classList.toggle('on', Number(g.dataset.upto) <= cursor));
    const cur = root.querySelector(`.sq-row[data-n="${sel}"]`);
    if (cur && root.offsetParent) {
      const r = cur.getBoundingClientRect();
      const box = root.getBoundingClientRect();
      if (r.bottom > box.bottom - 10 || r.top < box.top + 56) root.scrollTop += r.top - box.top - box.height / 2;
    }
    if (cursor < 0) root.scrollTop = 0;
  }

  return { setScript, update };
}
