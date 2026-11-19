// Builds the PWA icons and the inline 32 px favicon from the Chomper sprite
// (SPR_CHOMP) and palette in chompers.html. Pure Node: zlib only, no image tools.
//
//   node tests/make-icons.js     -> writes icons/chompers-192.png, icons/chompers-512.png
//                                   and the favicon <link> in chompers.html
//
// Re-run it whenever the sprite or palette changes; tests/headless.js checks
// that the committed icons still match.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const HTML = path.join(ROOT, 'chompers.html');
const ICONS = [
  { file: 'icons/chompers-192.png', size: 192 },
  { file: 'icons/chompers-512.png', size: 512 },
];
const FILL = 0.62; // sprite width / icon width: keeps the creature inside the maskable safe circle

function readArt(html = fs.readFileSync(HTML, 'utf8')) {
  const m = /const SPR_CHOMP = \[([\s\S]*?)\];/.exec(html);
  if (!m) throw new Error('SPR_CHOMP not found in chompers.html');
  const rows = [...m[1].matchAll(/'([^']*)'/g)].map(x => x[1]);
  const color = key => {
    const c = new RegExp(`\\b${key}:\\s*'(#[0-9a-fA-F]{6})'`).exec(html);
    if (!c) throw new Error(`palette.${key} not found in chompers.html`);
    return c[1];
  };
  return {
    rows,
    colors: { o: color('outline'), b: color('body'), w: color('eye'), k: color('mouth'), t: color('tooth') },
    bg: color('bg'),
  };
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

function writeAll() {
  const html = fs.readFileSync(HTML, 'utf8'), art = readArt(html);
  for (const { file, size } of ICONS) {
    fs.mkdirSync(path.dirname(path.join(ROOT, file)), { recursive: true });
    fs.writeFileSync(path.join(ROOT, file), encodePng(size, iconPixels(size, {}, art)));
    console.log('wrote', file);
  }
  const re = /(<link rel="icon" type="image\/png" sizes="32x32" href=")[^"]*(">)/;
  if (!re.test(html)) throw new Error('favicon <link> not found in chompers.html');
  fs.writeFileSync(HTML, html.replace(re, `$1${faviconDataUrl(art)}$2`));
  console.log('updated favicon in chompers.html');
}

module.exports = { readArt, iconPixels, encodePng, decodePng, faviconDataUrl, ICONS, ROOT };
if (require.main === module) writeAll();
