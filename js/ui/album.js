// 集邮册：进度不是进度条，是一本慢慢集满的邮票册。

import { esc, postmark } from './icons.js';

export function stampHtml(p, index, { earned, done = 0 }) {
  return `<div class="stamp t-${p.id}${earned ? ' earned' : ''}">
    <div class="stamp-in">
      <span class="stamp-no">第 ${index + 1} 站</span>
      <b>${esc(p.name)}</b>
      <span class="stamp-cn">${esc(p.cn)}</span>
      <span class="stamp-denom">${esc(p.stamp)}</span>
      ${earned ? `<span class="stamp-mark">${postmark({ mid: '已达', size: 74, id: `pm-${p.id}` })}</span>` : ''}
    </div>
    <div class="stamp-cap">${done} / ${p.scenarios.length} 个场景</div>
  </div>`;
}

export function renderAlbum(root, protocols, isDone) {
  const count = protocols.filter((p) => isDone(p.id, p.scenarios[0].id)).length;
  root.querySelector('.album-count').textContent = `${count} / ${protocols.length}`;
  root.querySelector('.album-grid').innerHTML = protocols
    .map((p, i) =>
      stampHtml(p, i, {
        earned: isDone(p.id, p.scenarios[0].id),
        done: p.scenarios.filter((s) => isDone(p.id, s.id)).length,
      }),
    )
    .join('');
}
