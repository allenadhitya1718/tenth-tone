import { SvgXml } from 'react-native-svg';

// welcomeArt() from web/js/views.js: people, connected, enjoying it. Drawn,
// not photographed, so it is tiny, sharp at any size and works offline.
const NODES = [
  { x: 150, y: 62, r: 31, c: 'a' }, { x: 58, y: 148, r: 25, c: 'b' },
  { x: 248, y: 132, r: 23, c: 'c' }, { x: 108, y: 236, r: 20, c: 'b' },
  { x: 222, y: 231, r: 18, c: 'a' }, { x: 27, y: 66, r: 15, c: 'c' },
  { x: 286, y: 212, r: 13, c: 'b' },
];
const LINKS = [[0, 1], [0, 2], [1, 3], [2, 4], [3, 4], [0, 5], [1, 5], [2, 6], [4, 6]];

function build() {
  const person = (n: (typeof NODES)[number]) => {
    const hr = n.r * 0.3, hy = n.y - n.r * 0.2;
    const bw = n.r * 0.62, by = n.y + n.r * 0.1, bh = n.r * 0.52;
    return `<circle cx="${n.x}" cy="${hy.toFixed(1)}" r="${hr.toFixed(1)}" fill="#fff" opacity=".95"/>`
      + `<path d="M ${(n.x - bw).toFixed(1)} ${(by + bh).toFixed(1)} a ${bw.toFixed(1)} ${bh.toFixed(1)} 0 0 1 ${(bw * 2).toFixed(1)} 0 Z" fill="#fff" opacity=".95"/>`;
  };
  const links = LINKS.map(([i, j], k) => {
    const a = NODES[i], b = NODES[j];
    return `<path d="M ${a.x} ${a.y} Q ${((a.x + b.x) / 2).toFixed(0)} ${((a.y + b.y) / 2 - 16).toFixed(0)} ${b.x} ${b.y}" fill="none" stroke="url(#wl)" stroke-width="${k % 3 === 0 ? 2.1 : 1.4}" stroke-linecap="round" opacity="${k % 3 === 0 ? '.85' : '.5'}"/>`;
  }).join('');
  const nodes = NODES.map((n) =>
    `<g><circle cx="${n.x}" cy="${n.y}" r="${n.r + 4}" fill="url(#wh)" opacity=".55"/><circle cx="${n.x}" cy="${n.y}" r="${n.r}" fill="url(#w${n.c})"/>${person(n)}</g>`,
  ).join('');
  const sparks = [[196, 88, 2.6], [86, 206, 2.2], [268, 168, 2], [132, 140, 1.8], [42, 110, 1.6]]
    .map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="${p[2]}" fill="#7FB0FF" opacity=".8"/>`).join('');
  const heart = (x: number, y: number, sc: number, fill: string, op: string) =>
    `<path transform="translate(${x} ${y}) scale(${sc})" d="M0 3.6 C -3.4 1 -5.2 -1 -5.2 -3.1 A 3.1 3.1 0 0 1 0 -5.2 A 3.1 3.1 0 0 1 5.2 -3.1 C 5.2 -1 3.4 1 0 3.6 Z" fill="${fill}" opacity="${op}"/>`;
  const bubble = (x: number, y: number, sc: number, op: string) =>
    `<g transform="translate(${x} ${y}) scale(${sc})" opacity="${op}"><rect x="-7" y="-5.5" width="14" height="11" rx="4" fill="#3D7BFF"/><path d="M -2.5 5 L 0.5 8.4 L 2.4 5 Z" fill="#3D7BFF"/></g>`;
  const accents = heart(196, 96, 1.5, '#FF6FA3', '.95') + heart(70, 110, 1.05, '#FF9CC0', '.75')
    + bubble(258, 86, 1.15, '.9') + bubble(96, 192, 0.95, '.7');
  return '<svg viewBox="0 0 320 290" xmlns="http://www.w3.org/2000/svg">'
    + '<defs>'
    + '<linearGradient id="wa" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3D7BFF"/><stop offset="1" stop-color="#1E56D6"/></linearGradient>'
    + '<linearGradient id="wb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5B8CFF"/><stop offset="1" stop-color="#2A63E0"/></linearGradient>'
    + '<linearGradient id="wc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF7BA8"/><stop offset="1" stop-color="#E8478A"/></linearGradient>'
    + '<linearGradient id="wl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1E56D6" stop-opacity=".15"/><stop offset=".5" stop-color="#3D7BFF" stop-opacity=".75"/><stop offset="1" stop-color="#1E56D6" stop-opacity=".15"/></linearGradient>'
    + '<radialGradient id="wh"><stop offset=".55" stop-color="#3D7BFF" stop-opacity="0"/><stop offset="1" stop-color="#3D7BFF" stop-opacity=".38"/></radialGradient>'
    + '</defs>' + links + sparks + accents + nodes + '</svg>';
}

const XML = build();

export function WelcomeArt({ width }: { width: number }) {
  return <SvgXml xml={XML} width={width} height={(width * 290) / 320} accessibilityLabel="People connected together" />;
}
