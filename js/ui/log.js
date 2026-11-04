// 抓包日志：只显示已经发生的包。

import { NODES } from '../world.js';
import { esc } from './icons.js';

const KIND_LABEL = { arp: 'ARP', icmp: 'ICMP', udp: 'UDP', tcp: 'TCP', data: 'TCP', dhcp: 'DHCP', dns: 'DNS', http: 'HTTP', tls: 'TLS', smtp: 'SMTP' };
const fmtSize = (n) => (n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);
const name = (id) => NODES[id].label;

export function createLog(root, { onSelect }) {
  root.addEventListener('click', (e) => {
    const r = e.target.closest('tr[data-n]');
    if (r) onSelect(Number(r.dataset.n));
  });
  root.addEventListener('keydown', (e) => {
    const r = e.target.closest('tr[data-n]');
    if (r && e.key === 'Enter') onSelect(Number(r.dataset.n));
  });

  function update(script, cursor, sel) {
    const rows = script.frames.slice(0, cursor + 1);
    if (!rows.length) {
      root.innerHTML = `<p class="log-empty">线路上还没有包。按 <kbd>空格</kbd> 开始，或按 <kbd>→</kbd> 一次送一封。</p>`;
      return;
    }
    root.innerHTML = `<table>
      <thead><tr><th class="c-n">No.</th><th class="c-t">时间</th><th class="c-p">从 → 到</th><th class="c-k">协议</th><th>内容</th><th class="c-s">大小</th></tr></thead>
      <tbody>${rows
        .map(
          (f) => `<tr data-n="${f.n}" tabindex="0" class="t-${f.kind}${f.n === sel ? ' sel' : ''}${f.lost ? ' lost' : ''}">
          <td class="c-n">${f.n + 1}</td>
          <td class="c-t">${(f.time / 1000).toFixed(3)}</td>
          <td class="c-p">${esc(name(f.from))} → ${esc(name(f.to))}</td>
          <td class="c-k"><span class="chip">${KIND_LABEL[f.kind]}</span></td>
          <td class="c-i">${f.lost ? '<b class="lost-tag">丢失</b> ' : ''}${esc(f.info)}</td>
          <td class="c-s">${fmtSize(f.size)}</td>
        </tr>`,
        )
        .join('')}</tbody></table>`;
    const cur = root.querySelector('tr.sel');
    if (cur) {
      const box = root.getBoundingClientRect();
      const r = cur.getBoundingClientRect();
      if (r.bottom > box.bottom || r.top < box.top + 28) root.scrollTop += r.bottom - box.bottom + 8;
    }
  }

  return { update };
}
