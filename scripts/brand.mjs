import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
// Derived from klang-landingpage/SignalSculpture.tsx. Keep the hero geometry identical.
function contour(u, compact = false) {
  const envelope = Math.pow(Math.sin(Math.PI * u), 1.2);
  const radius = 9 + envelope * (90 + 95 * Math.pow(Math.sin(u * Math.PI * 2.3 - 0.5), 2));
  return Array.from({ length: 81 }, (_, j) => {
    const a = (j / 80) * Math.PI * 2,
      ripple = 1 + 0.14 * Math.sin(a * 3 + u * 8);
    const x = 80 + u * 1120 + Math.cos(a) * radius * 0.57 * ripple;
    const y = 240 + Math.sin(u * Math.PI * 2) * 24 + Math.sin(a) * radius * ripple;
    return compact ? [8 + ((x - 60) / 1160) * 112, 64 + ((y - 240) / 1160) * 112] : [x, y];
  });
}
const gradient =
  '<linearGradient id="ink" gradientUnits="userSpaceOnUse" x1="0" y1="80" x2="1150" y2="420"><stop stop-color="#748dff"/><stop offset=".3" stop-color="#212bfa"/><stop offset=".65" stop-color="#000052"/><stop offset="1" stop-color="#596dff"/></linearGradient>';
const markGradient = gradient.replace('y1="80" x2="1150" y2="420"', 'y1="48" x2="118" y2="82"');
const path = (points) =>
  points.map(([x, y], j) => `${j ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ') + 'Z';
await mkdir('public/brand', { recursive: true });
await mkdir('public/icons', { recursive: true });
await writeFile(
  'public/brand/wave.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 480" fill="none"><defs>${gradient}</defs><g stroke="url(#ink)" stroke-width="1.15" stroke-opacity=".82">${Array.from({ length: 116 }, (_, i) => `<path d="${path(contour(i / 115))}"/>`).join('')}</g></svg>`,
);
const mark = (count) =>
  Array.from({ length: count }, (_, i) => contour(0.05 + (0.9 * i) / (count - 1), true));
await writeFile(
  'public/brand/mark.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 40 128 48" fill="none"><defs>${markGradient}</defs><g stroke="url(#ink)" stroke-width="1.45">${mark(
    23,
  )
    .map((points) => `<path d="${path(points)}"/>`)
    .join('')}</g></svg>`,
);
await writeFile(
  'public/brand/mark-mono.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 40 128 48" fill="none"><g stroke="#212bfa" stroke-width="1.45">${mark(
    23,
  )
    .map((points) => `<path d="${path(points)}"/>`)
    .join('')}</g></svg>`,
);
// Rasterize the same contour geometry with 4x antialiasing for Chromium's PNG icon requirement.
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type),
    size = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, crc]);
}
for (const size of [16, 32, 48, 128]) {
  const scale = 4,
    side = size * scale,
    alpha = new Float32Array(side * side);
  const count = size === 16 ? 5 : size === 32 ? 9 : size === 48 ? 13 : 23;
  const width = (size === 16 ? 0.72 : size === 32 ? 0.7 : size === 48 ? 0.8 : 1.45) * scale;
  for (const points of mark(count))
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1].map((v) => (v / 128) * side),
        [bx, by] = points[i].map((v) => (v / 128) * side);
      const dx = bx - ax,
        dy = by - ay,
        length = dx * dx + dy * dy;
      for (
        let y = Math.max(0, Math.floor(Math.min(ay, by) - width));
        y <= Math.min(side - 1, Math.ceil(Math.max(ay, by) + width));
        y++
      )
        for (
          let x = Math.max(0, Math.floor(Math.min(ax, bx) - width));
          x <= Math.min(side - 1, Math.ceil(Math.max(ax, bx) + width));
          x++
        ) {
          const t = Math.max(0, Math.min(1, ((x + 0.5 - ax) * dx + (y + 0.5 - ay) * dy) / length));
          const distance = Math.hypot(x + 0.5 - ax - t * dx, y + 0.5 - ay - t * dy);
          alpha[y * side + x] = Math.max(
            alpha[y * side + x],
            Math.max(0, Math.min(1, width / 2 + 0.5 - distance)),
          );
        }
    }
  const data = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) sum += alpha[(y * scale + dy) * side + x * scale + dx];
      data.set([33, 43, 250, Math.round((sum / scale ** 2) * 255)], y * (size * 4 + 1) + 1 + x * 4);
    }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  await writeFile(
    `public/icons/${size}.png`,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(data)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}
console.log('Pianissimo wave, logo and toolbar icons generated.');
