// 拆信：把一个包逐层拆开，字段和字节互相高亮，还能沿途比较每一段链路上的差异。

import { hexOf, hx } from '../net/bytes.js';
import { NODES } from '../world.js';
import { esc, uiIcon } from './icons.js';

const printable = (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '·');

/** 和上一段链路比较，找出哪些字段被改写了 */
function diffFields(cur, prev) {
  const changed = [];
  if (!prev) return changed;
  cur.layers.forEach((l, li) => {
    const pl = prev.layers[li];
    l.fields.forEach((f, fi) => {
      const pf = pl?.fields[fi];
      if (!pf || pf.value !== f.value) changed.push({ layer: l.id, label: f.label, field: f, from: pf?.value, to: f.value });
    });
  });
  return changed;
}

export function createInspector(root, { onLink }) {
  const openLayers = new Set(['ip', 'tcp', 'udp', 'dns', 'arp', 'icmp', 'dhcp', 'http', 'tls', 'smtp', 'ntp', 'data']);
  let current = null;
  let pinned = null;

  const fieldAt = (off) => {
    for (const l of current.layers) for (const f of l.fields) if (off >= f.abs && off < f.abs + f.len) return { f, l };
    return null;
  };

  function mark(f) {
    root.querySelectorAll('.hx.hl').forEach((n) => n.classList.remove('hl'));
    root.querySelectorAll('.fd.hl').forEach((n) => n.classList.remove('hl'));
    if (!f) return;
    for (let o = f.abs; o < f.abs + f.len; o++) root.querySelectorAll(`.hx[data-o="${o}"]`).forEach((n) => n.classList.add('hl'));
    root.querySelector(`.fd[data-a="${f.abs}"]`)?.classList.add('hl');
  }

  function explain(f, l) {
    const bar = root.querySelector('.note-bar');
    if (!bar) return;
    if (!f) {
      bar.innerHTML = '<span class="muted">把鼠标移到字段或字节上，这里会告诉你它是什么。</span>';
      return;
    }
    const bits = f.bits ? `<dl class="bits">${f.bits.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : '';
    bar.innerHTML = `<b class="t-${l.id}">${esc(f.label)}</b><span class="note-meta">偏移 ${f.abs} · ${f.len} 字节 · <code>${esc(hexOf(current.bytes.slice(f.abs, f.abs + Math.min(f.len, 6))))}${f.len > 6 ? ' …' : ''}</code></span>
      ${f.note ? `<p>${esc(f.note)}</p>` : ''}${bits}`;
  }

  root.addEventListener('mouseover', (e) => {
    const t = e.target.closest('[data-a],[data-o]');
    if (!t || !current) return;
    const off = Number(t.dataset.a ?? t.dataset.o);
    const hit = fieldAt(off);
    if (hit) {
      mark(hit.f);
      explain(hit.f, hit.l);
    }
  });
  root.addEventListener('mouseleave', () => {
    if (!current) return;
    if (pinned) {
      const hit = fieldAt(pinned);
      mark(hit?.f);
      explain(hit?.f, hit?.l);
    } else {
      mark(null);
    }
  });
  root.addEventListener('click', (e) => {
    const link = e.target.closest('[data-link]');
    if (link) return onLink(Number(link.dataset.link));
    const head = e.target.closest('[data-layer]');
    if (head) {
      const id = head.dataset.layer;
      if (openLayers.has(id)) openLayers.delete(id);
      else openLayers.add(id);
      head.closest('.ly').classList.toggle('open');
      head.setAttribute('aria-expanded', openLayers.has(id));
      return;
    }
    const seg = e.target.closest('[data-seg]');
    if (seg) {
      const id = seg.dataset.seg;
      openLayers.add(id);
      const box = root.querySelector(`.ly[data-id="${id}"]`);
      box?.classList.add('open');
      box?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }
    if (e.target.closest('[data-copy]')) {
      navigator.clipboard?.writeText(hexOf(current.bytes));
      const b = e.target.closest('[data-copy]');
      b.classList.add('ok');
      setTimeout(() => b.classList.remove('ok'), 900);
      return;
    }
    const t = e.target.closest('[data-a],[data-o]');
    if (t) {
      pinned = Number(t.dataset.a ?? t.dataset.o);
      const hit = fieldAt(pinned);
      if (hit) {
        mark(hit.f);
        explain(hit.f, hit.l);
      }
    }
  });

  function linkStrip(frame, link) {
    if (frame.links < 2) return '';
    const items = [];
    for (let i = 0; i < frame.links; i++) {
      const a = NODES[frame.path[i]].label;
      const b = NODES[frame.path[i + 1]].label;
      items.push(`<button class="lk${i === link ? ' on' : ''}" data-link="${i}" title="${esc(a)} → ${esc(b)}">
        <span>${i + 1}</span><em>${esc(a)} → ${esc(b)}</em></button>`);
    }
    return `<div class="links"><div class="links-title">它在路上的样子</div><div class="lk-row">${items.join('')}</div></div>`;
  }

  function diffNote(frame, link, changed) {
    if (frame.links < 2) return '';
    if (link === 0) return `<p class="diff muted">这是刚出发时的样子。切到后面的链路，看看路由器改了什么。</p>`;
    const via = NODES[frame.path[link]];
    if (!changed.length) return `<p class="diff ok">${esc(via.label)}原样转发，一个字节都没变。二层设备只看 MAC，不拆信。</p>`;
    const list = changed.map((c) => `<li><b>${esc(c.label)}</b><span>${esc(c.from)} → ${esc(c.to)}</span></li>`).join('');
    return `<div class="diff"><p>过了<b>${esc(via.label)}</b>，这 ${changed.length} 个字段被改写：</p><ul>${list}</ul></div>`;
  }

  function byteBar(pkt) {
    const total = pkt.bytes.length;
    return `<div class="bytebar" role="img" aria-label="各层占用字节">${pkt.layers
      .map((l) => `<button class="t-${l.id}" data-seg="${l.id}" style="flex:${Math.max(l.len, total * 0.075)} 1 0" title="${esc(l.name)} ${l.len} 字节"><span>${esc(l.id === 'data' ? '数据' : l.id.toUpperCase())}</span><i>${l.len}</i></button>`)
      .join('')}</div>`;
  }

  function layerBox(l, changed, depth) {
    const fields = l.fields
      .map((f) => {
        const ch = changed.some((c) => c.field === f);
        return `<div class="fd${ch ? ' chg' : ''}" data-a="${f.abs}"><span class="fd-k">${esc(f.label)}</span><span class="fd-v">${esc(f.value)}</span></div>`;
      })
      .join('');
    return `<section class="ly t-${l.id}${openLayers.has(l.id) ? ' open' : ''}" data-id="${l.id}" style="--d:${depth}">
      <button class="ly-head" data-layer="${l.id}" aria-expanded="${openLayers.has(l.id)}"><b>${esc(l.name)}</b><span>${l.len} 字节</span></button>
      <div class="ly-body">${l.hint ? `<p class="ly-hint">${esc(l.hint)}</p>` : ''}${fields}</div>
    </section>`;
  }

  function hexDump(pkt, changed) {
    const toneAt = new Array(pkt.bytes.length);
    for (const l of pkt.layers) toneAt.fill(l.id, l.off, l.off + l.len);
    const chg = new Set();
    for (const c of changed) for (let o = c.field.abs; o < c.field.abs + c.field.len; o++) chg.add(o);
    const rows = [];
    for (let r = 0; r < pkt.bytes.length; r += 16) {
      let h = '';
      let a = '';
      for (let i = r; i < Math.min(r + 16, pkt.bytes.length); i++) {
        const cls = `hx t-${toneAt[i]}${chg.has(i) ? ' chg' : ''}`;
        h += `<i class="${cls}" data-o="${i}">${hx(pkt.bytes[i])}</i>`;
        a += `<i class="${cls}" data-o="${i}">${esc(printable(pkt.bytes[i]))}</i>`;
      }
      rows.push(`<div class="hx-row"><span class="hx-off">${hx(r, 4)}</span><span class="hx-b">${h}</span><span class="hx-a">${a}</span></div>`);
    }
    return rows.join('');
  }

  function render(frame, link) {
    pinned = null;
    if (!frame) {
      current = null;
      root.innerHTML = `<div class="ins-empty"><p class="big">这里还没有信。</p><p>送出第一个包后，点地图上的信封或日志里的任意一行，就能把它拆开：看到每一层的每一个字段，直到最后一个字节。</p></div>`;
      return;
    }
    const pkt = frame.at(link);
    const prev = link > 0 ? frame.at(link - 1) : null;
    const changed = diffFields(pkt, prev);
    current = pkt;
    const scroll = root.scrollTop;
    root.innerHTML = `
      <header class="ins-head t-${frame.kind}">
        <div><span class="ins-no">No.${frame.n + 1}</span><b>${esc(frame.label)}</b></div>
        <p>${esc(frame.info)}</p>
      </header>
      ${linkStrip(frame, link)}
      ${diffNote(frame, link, changed)}
      <div class="sub-title"><span>一层套一层</span><span>${pkt.bytes.length} 字节</span></div>
      ${byteBar(pkt)}
      <div class="stack">${pkt.layers.map((l, i) => layerBox(l, changed, i)).join('')}</div>
      <div class="note-bar"></div>
      <div class="sub-title"><span>真实字节</span><button class="mini" data-copy title="复制十六进制">${uiIcon('copy', 13)}<span>复制</span></button></div>
      <div class="hexdump">${hexDump(pkt, changed)}</div>`;
    explain(null);
    root.scrollTop = scroll;
  }

  return { render };
}
