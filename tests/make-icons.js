// Builds each theme's PWA icons and inline 32 px favicon from its Chomper sprite
// (THEMES[id].sprites.chomp) and palette in chompers.html. Pure Node (zlib, vm),
// no image tools.
//
//   node tests/make-icons.js   -> writes the icon PNGs named in every theme's `icons`
//                                 and the `favicon:` data URL in each theme
//
// Re-run it whenever a theme's sprite or palette changes; tests/headless.js checks
// that the committed icons still match.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const HTML = path.join(ROOT, 'chompers.html');
const FILL = 0.62; // sprite width / icon width: keeps the creature inside the maskable safe circle

// Runs the CONFIG / DATA section (pure data + functions, no DOM) and returns its tables.
function loadData(html = fs.readFileSync(HTML, 'utf8')) {
  const start = html.indexOf(' * 1. CONFIG / DATA'), end = html.indexOf(' * 2. ENGINE');
  if (start < 0 || end < 0) throw new Error('section markers not found in chompers.html');
  const code = html.slice(html.indexOf('*/', start) + 2, html.lastIndexOf('/*', end));
  return vm.runInNewContext(code + '\n;({ CONFIG, PROFILES, THEMES, MODES, selectGame });',
                            { URLSearchParams, console });
}

// One theme's art: sprite rows + colour per sprite character + background.
function readArt(themeId = 'regular', data = loadData()) {
  const th = data.THEMES[themeId];
  if (!th) throw new Error(`no theme "${themeId}"`);
  const P = th.palette;
  return { rows: th.sprites.chomp, bg: P.bg,
           colors: { o: P.outline, b: P.body, w: P.eye, k: P.mouth, t: P.tooth, p: P.cheek } };
}

const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

// RGBA pixels: the sprite at the largest whole-number scale that fits `fill`
// of the width, centred; optional solid background (full-bleed, for maskable icons).
function iconPixels(size, { fill = FILL, background = true } = {}, art = readArt()) {
  const px = Buffer.alloc(size * size * 4);
  if (background) {
    const [r, g, b] = rgb(art.bg);
    for (let i = 0; i < size * size; i++) px.set([r, g, b, 255], i * 4);
  }
  const sw = art.rows[0].length, sh = art.rows.length;
  const s = Math.max(1, Math.floor((size * fill) / sw));
  const ox = Math.floor((size - sw * s) / 2), oy = Math.floor((size - sh * s) / 2);
  art.rows.forEach((row, r) => [...row].forEach((ch, c) => {
    const col = art.colors[ch];
    if (!col) return;
    const [R, G, B] = rgb(col);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      px.set([R, G, B, 255], ((oy + r * s + y) * size + (ox + c * s + x)) * 4);
    }
  }));
  return px;
}

// ---- minimal PNG (8-bit RGBA, filter 0) ----
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4), crc = Buffer.alloc(4), td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(size, px) {
  const stride = size * 4, raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
                        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
// Decodes PNGs written by encodePng (RGBA, filter 0) -> { width, height, px }.
function decodePng(buf) {
  let off = 8, width = 0, height = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = width * 4, px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    if (raw[y * (stride + 1)] !== 0) throw new Error('unsupported PNG filter');
    raw.copy(px, y * stride, y * (stride + 1) + 1, (y + 1) * (stride + 1));
  }
  return { width, height, px };
}

function faviconDataUrl(art) {
  return 'data:image/png;base64,' + encodePng(32, iconPixels(32, { fill: 0.9, background: false }, art)).toString('base64');
}

// Every icon file named by a theme: [{ theme, file, size }]
function iconList(data = loadData()) {
  return Object.entries(data.THEMES).flatMap(([theme, th]) =>
    Object.entries(th.icons).map(([size, file]) => ({ theme, file, size: Number(size) })));
}

function writeAll() {
  let html = fs.readFileSync(HTML, 'utf8');
  const data = loadData(html);
  for (const { theme, file, size } of iconList(data)) {
    fs.mkdirSync(path.dirname(path.join(ROOT, file)), { recursive: true });
    fs.writeFileSync(path.join(ROOT, file), encodePng(size, iconPixels(size, {}, readArt(theme, data))));
    console.log('wrote', file);
  }
  for (const theme of Object.keys(data.THEMES)) {
    const re = new RegExp(`(favicon: ')[^']*(', // generated by tests/make-icons\\.js \\(${theme}\\))`);
    if (!re.test(html)) throw new Error(`favicon line for theme "${theme}" not found in chompers.html`);
    html = html.replace(re, `$1${faviconDataUrl(readArt(theme, data))}$2`);
  }
  fs.writeFileSync(HTML, html);
  console.log('updated theme favicons in chompers.html');
}

module.exports = { loadData, readArt, iconPixels, encodePng, decodePng, faviconDataUrl, iconList, ROOT };
if (require.main === module) writeAll();
