// 零依赖生成团子图标（三色团子串）。用法：node scripts/gen-icons.mjs
// 只用 Node 内置的 zlib 编码 PNG，不装任何包。
import zlib from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

// —— 极简 PNG 编码（RGBA）——
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// —— 画一张团子图（超采样抗锯齿）——
function hex(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
const BG = hex('#319aaf');
const SKEWER = hex('#c9a66b');
const BALLS = [hex('#f4c2ce'), hex('#fbf1dd'), hex('#bfe0b6')];

function renderIcon(size) {
  const SS = 3;
  const S = size * SS;
  const buf = Buffer.alloc(S * S * 4);
  const cx = S / 2;
  const r = S * 0.15;
  const centers = [S * 0.36, S * 0.52, S * 0.68];
  const skHalf = S * 0.022;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let col = BG;
      // 竹签
      if (Math.abs(x - cx) < skHalf && y > centers[0] - r && y < centers[2] + r * 1.6) col = SKEWER;
      // 三颗团子
      for (let i = 0; i < 3; i++) {
        const dx = x - cx;
        const dy = y - centers[i];
        if (dx * dx + dy * dy <= r * r) col = BALLS[i];
      }
      const o = (y * S + x) * 4;
      buf[o] = col[0]; buf[o + 1] = col[1]; buf[o + 2] = col[2]; buf[o + 3] = 255;
    }
  }
  // 下采样到目标尺寸（3x3 box）
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let rr = 0; let gg = 0; let bb = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const o = ((y * SS + sy) * S + (x * SS + sx)) * 4;
          rr += buf[o]; gg += buf[o + 1]; bb += buf[o + 2];
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      out[o] = Math.round(rr / n); out[o + 1] = Math.round(gg / n); out[o + 2] = Math.round(bb / n); out[o + 3] = 255;
    }
  }
  return encodePng(size, size, out);
}

await mkdir(join(OUT, 'icons'), { recursive: true });
for (const size of [192, 512]) {
  await writeFile(join(OUT, 'icons', `icon-${size}.png`), renderIcon(size));
}
await writeFile(join(OUT, 'apple-touch-icon.png'), renderIcon(180));
console.log('图标已生成：public/icons/icon-192.png, icon-512.png, public/apple-touch-icon.png');
