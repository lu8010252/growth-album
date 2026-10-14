// 生成 PWA 图标（纯 Node，无依赖）：珊瑚色渐变底 + 白色爱心。运行：node scripts/gen-icons.js
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function png(size) {
  const SS = 3, raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let cov = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const hx = ((x + (sx + 0.5) / SS) / size - 0.5) * 4.0;
        const hy = -((y + (sy + 0.5) / SS) / size - 0.52) * 4.0 + 0.05;
        const v = Math.pow(hx * hx + hy * hy - 1, 3) - hx * hx * Math.pow(hy, 3);
        if (v <= 0) cov++;
      }
      const a = cov / (SS * SS), t = (x + y) / (2 * size);
      const bg = [255 - 13 * t, 154 - 42 * t, 139 - 44 * t];
      const o = y * (size * 4 + 1) + 1 + x * 4;
      for (let c = 0; c < 3; c++) raw[o + c] = Math.round(bg[c] * (1 - a) + 255 * a);
      raw[o + 3] = 255;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const dir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'icon-192.png'), png(192));
fs.writeFileSync(path.join(dir, 'icon-512.png'), png(512));
fs.writeFileSync(path.join(dir, 'apple-touch-icon.png'), png(180));
console.log('icons ok');
