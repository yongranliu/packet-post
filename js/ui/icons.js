// 所有图标都是手写的 40×40 线稿，继承当前文字颜色。

export const ICONS = {
  laptop: '<rect x="9" y="9" width="22" height="16" rx="2"/><path d="M4 31h32l-4-6H8z"/>',
  printer: '<path d="M12 15V6h16v9"/><rect x="6" y="15" width="28" height="13" rx="2"/><path d="M12 24h16v10H12z"/><path d="M28 20h2"/>',
  intruder: '<path d="M20 6l15 27H5z"/><path d="M20 16v8M20 28v.5"/>',
  switch: '<rect x="5" y="14" width="30" height="13" rx="2"/><path d="M11 19v3M17 19v3M23 19v3M29 19v3"/><path d="M13 9h14M13 32h14"/>',
  router: '<rect x="5" y="20" width="30" height="11" rx="2"/><path d="M12 20L9 8M28 20l3-12"/><path d="M11 26h.5M17 26h.5M23 26h6"/>',
  tower: '<path d="M20 13v3M13 34l7-18 7 18M15.5 27h9"/><circle cx="20" cy="11" r="2"/><path d="M12 5a11 11 0 0 0 0 12M28 5a11 11 0 0 1 0 12"/>',
  core: '<path d="M20 5l13 7.5v15L20 35 7 27.500v-15z"/><path d="M13 20h14M20 13v14M23 16l4 4-4 4M17 16l-4 4 4 4"/>',
  server: '<rect x="8" y="6" width="24" height="12" rx="2"/><rect x="8" y="22" width="24" height="12" rx="2"/><path d="M13 12h.5M13 28h.5M19 12h8M19 28h8"/>',
  book: '<path d="M9 7h19a3 3 0 0 1 3 3v24H12a3 3 0 0 1-3-3z"/><path d="M9 31a3 3 0 0 1 3-3h19"/><path d="M15 13h10M15 19h7"/>',
  rootdns: '<circle cx="20" cy="9" r="3.500"/><circle cx="9" cy="30" r="3.500"/><circle cx="20" cy="30" r="3.500"/><circle cx="31" cy="30" r="3.500"/><path d="M20 12.500V26.500M20 19H9v7.500M20 19h11v7.500"/>',
  tld: '<rect x="5" y="11" width="30" height="18" rx="2"/><path d="M9.500 25h.5"/><path d="M18 17a3 3 0 1 0 0 6M24 17a3 3 0 1 0 .01 0"/>',
  auth: '<path d="M20 5l13 5v10c0 8-6 13-13 15-7-2-13-7-13-15V10z"/><path d="M14 20l4.500 4.500L27 15"/>',
  mail: '<rect x="5" y="9" width="30" height="22" rx="2"/><path d="M5 11l15 12 15-12"/>',
  clock: '<circle cx="20" cy="20" r="14"/><path d="M20 11v9l6 4"/>',
};

export const icon = (name, size = 22) =>
  `<svg class="ic" viewBox="0 0 40 40" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.200" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;

const ui = {
  play: '<path d="M7 4l12 7-12 7z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M6 4h3.500v14H6zM13 4h3.500v14H13z" fill="currentColor" stroke="none"/>',
  next: '<path d="M4 11h13M12 6l5 5-5 5"/>',
  prev: '<path d="M18 11H5M10 6l-5 5 5 5"/>',
  reset: '<path d="M4 11a7 7 0 1 0 2.300-5.200M4 3v4.500h4.500"/>',
  sun: '<circle cx="11" cy="11" r="4"/><path d="M11 2v2M11 18v2M2 11h2M18 11h2M4.600 4.600L6 6M16 16l1.400 1.400M4.600 17.400L6 16M16 6l1.400-1.400"/>',
  moon: '<path d="M18 13A8 8 0 0 1 9 4a8 8 0 1 0 9 9z"/>',
  download: '<path d="M11 3v11M6.500 10L11 14.500 15.500 10M4 19h14"/>',
  copy: '<rect x="7" y="7" width="11" height="12" rx="1.500"/><path d="M4 15V4.500A1.500 1.500 0 0 1 5.500 3H14"/>',
  close: '<path d="M5 5l12 12M17 5L5 17"/>',
  album: '<rect x="3" y="3" width="16" height="16" rx="1.500"/><path d="M3 8h16M8 3v16"/>',
};

export const uiIcon = (name, size = 16) =>
  `<svg class="ic" viewBox="0 0 22 22" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.800" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ui[name] ?? ''}</svg>`;

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** 讲解文字里的 `代码` 渲染成等宽 */
export const rich = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');

/** 圆形邮戳，用在 logo 和集邮册上 */
export function postmark({ top = '报文邮局', bottom = 'PACKET POST', mid = '', size = 96, id = 'pm' } = {}) {
  return `<svg class="postmark" viewBox="0 0 120 120" width="${size}" height="${size}" aria-hidden="true">
    <defs>
      <path id="${id}-t" d="M 22 60 a 38 38 0 0 1 76 0"/>
      <path id="${id}-b" d="M 16 60 a 44 44 0 0 0 88 0"/>
    </defs>
    <g fill="none" stroke="currentColor">
      <circle cx="60" cy="60" r="55" stroke-width="3"/>
      <circle cx="60" cy="60" r="33" stroke-width="1.500"/>
    </g>
    <g fill="currentColor" font-weight="700">
      <text font-size="14" letter-spacing="2"><textPath href="#${id}-t" startOffset="50%" text-anchor="middle">${esc(top)}</textPath></text>
      <text font-size="10.500" letter-spacing="1.500"><textPath href="#${id}-b" startOffset="50%" text-anchor="middle">${esc(bottom)}</textPath></text>
      <text x="60" y="66" font-size="17" text-anchor="middle">${esc(mid)}</text>
    </g>
  </svg>`;
}
