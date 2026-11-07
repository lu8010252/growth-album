// 回顾视频：把照片做成 1920x1080 的 MP4 幻灯片，生日聚会时可在大屏上直接播放。
// 结构：片头（可选「X 岁生日快乐」）→ 每张照片（相框+阴影+日期年龄胶囊）→ 选了单个孩子时按年龄分「X 岁」章节 → 片尾。
// 依赖系统里的 ffmpeg（带 drawtext）和一款中文字体（Dockerfile 里装了 fonts-wqy-microhei）。
// 装饰图形（彩纸、光斑、圆环、胶囊）用 node 自己画成小 PNG，再由 ffmpeg 叠上去，不依赖额外的库或 SVG 支持。
const { execFile } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const zlib = require('zlib');

const FONTS = [
  process.env.MOVIE_FONT,
  '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
  '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf',
].filter(Boolean);
const findFont = () => FONTS.find((f) => { try { return fs.statSync(f).size > 0; } catch { return false; } }) || null;

const W = 1920, H = 1080, FPS = 25, FADE = 0.6;
const CORAL = [242, 112, 95], GOLD = [255, 209, 102], SKY = [77, 150, 255], MINT = [107, 207, 127], VIOLET = [199, 125, 255], PINK = [255, 140, 170];
const PALETTE = [CORAL, GOLD, SKY, MINT, VIOLET, PINK];

function ff(args, timeout = 180e3) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', ['-y', '-v', 'error', '-nostdin', ...args], { timeout, maxBuffer: 1 << 24 }, (err, _o, stderr) => {
      if (err) reject(new Error((stderr || err.message || 'ffmpeg 失败').toString().trim().split('\n').slice(-3).join(' | ')));
      else resolve();
    });
  });
}

// 文字都写进文件再用 textfile 读，避免中文/引号/冒号在 filter 里转义
const q = (s) => String(s).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
const hex = (c) => '0x' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

const CN = '零一二三四五六七八九';
const cnNum = (n) => {
  n = Math.floor(+n);
  if (!(n >= 0)) return '';
  if (n < 10) return CN[n];
  if (n < 20) return '十' + (n % 10 ? CN[n % 10] : '');
  if (n < 100) return CN[Math.floor(n / 10)] + '十' + (n % 10 ? CN[n % 10] : '');
  return String(n);
};
const dateCn = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ''); return m ? `${+m[1]}年${+m[2]}月${+m[3]}日` : ''; };
// 估算一行字的宽度（给胶囊底色定宽用）：汉字占满一个字号，数字和字母约 0.58
const textW = (t, size) => [...String(t)].reduce((s, ch) => s + (ch.codePointAt(0) >= 0x2e80 ? size : size * 0.58), 0);

/* ---------- 迷你画板：抗锯齿的圆、圆环、圆角矩形、彩纸、星光，输出 PNG ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

class Canvas {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Uint8ClampedArray(w * h * 4); }
  px(i, c, a) {
    if (a <= 0) return;
    const d = this.d, da = d[i + 3] / 255, oa = a + da * (1 - a);
    d[i] = (c[0] * a + d[i] * da * (1 - a)) / oa;
    d[i + 1] = (c[1] * a + d[i + 1] * da * (1 - a)) / oa;
    d[i + 2] = (c[2] * a + d[i + 2] * da * (1 - a)) / oa;
    d[i + 3] = oa * 255;
  }
  // sdf(x,y) 返回到边缘的有符号距离（像素，里面为负），在 [x0,x1)×[y0,y1) 内填色
  fill(x0, y0, x1, y1, sdf, c, alpha = 1) {
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(this.w, Math.ceil(x1)); y1 = Math.min(this.h, Math.ceil(y1));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const cov = Math.min(1, Math.max(0, 0.5 - sdf(x + 0.5, y + 0.5)));
      if (cov > 0) this.px((y * this.w + x) * 4, c, cov * alpha);
    }
  }
  circle(cx, cy, r, c, a = 1) { this.fill(cx - r - 1, cy - r - 1, cx + r + 2, cy + r + 2, (x, y) => Math.hypot(x - cx, y - cy) - r, c, a); }
  ring(cx, cy, r, t, c, a = 1) { const o = r + t / 2 + 2; this.fill(cx - o, cy - o, cx + o, cy + o, (x, y) => Math.abs(Math.hypot(x - cx, y - cy) - r) - t / 2, c, a); }
  rrect(x, y, w, h, rad, c, a = 1) {
    const cx = x + w / 2, cy = y + h / 2;
    this.fill(x - 1, y - 1, x + w + 2, y + h + 2, (px, py) => {
      const qx = Math.abs(px - cx) - w / 2 + rad, qy = Math.abs(py - cy) - h / 2 + rad;
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad;
    }, c, a);
  }
  // 旋转的小长方形（彩纸条）
  paper(cx, cy, w, h, ang, c, a = 1) {
    const s = Math.sin(ang), co = Math.cos(ang), R = Math.hypot(w, h) / 2 + 2;
    this.fill(cx - R, cy - R, cx + R, cy + R, (px, py) => {
      const dx = px - cx, dy = py - cy, x = dx * co + dy * s, y = -dx * s + dy * co;
      const qx = Math.abs(x) - w / 2, qy = Math.abs(y) - h / 2;
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
    }, c, a);
  }
  // 四角星光：星形内部 (|x|/R)^(2/3)+(|y|/R)^(2/3) ≤ 1，3x3 超采样抗锯齿
  sparkle(cx, cy, R, c, a = 1) {
    const x0 = Math.max(0, Math.floor(cx - R - 1)), x1 = Math.min(this.w, Math.ceil(cx + R + 2)), y0 = Math.max(0, Math.floor(cy - R - 1)), y1 = Math.min(this.h, Math.ceil(cy + R + 2));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      let hit = 0;
      for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
        const dx = Math.abs(x + (i + 0.5) / 3 - cx) / R, dy = Math.abs(y + (j + 0.5) / 3 - cy) / R;
        if (Math.pow(dx, 2 / 3) + Math.pow(dy, 2 / 3) <= 1) hit++;
      }
      if (hit) this.px((y * this.w + x) * 4, c, (hit / 9) * a);
    }
  }
  png() {
    const { w, h, d } = this, raw = Buffer.alloc((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(d.buffer, d.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 4 })), chunk('IEND', Buffer.alloc(0))]);
  }
}

const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// 满屏彩纸 + 光斑；中间留一块椭圆空地放文字
function confetti(seed, { count = 150, clear = { cx: W / 2, cy: H / 2, rx: 820, ry: 330 }, bokeh = true } = {}) {
  const cv = new Canvas(W, H), r = rng(seed), pick = () => PALETTE[Math.floor(r() * PALETTE.length)];
  const inClear = (x, y, pad = 0) => ((x - clear.cx) / (clear.rx + pad)) ** 2 + ((y - clear.cy) / (clear.ry + pad)) ** 2 < 1;
  if (bokeh) for (let i = 0; i < 9; i++) cv.circle(r() * W, r() * H, 90 + r() * 170, pick(), 0.09 + r() * 0.07);
  let n = 0, guard = 0;
  while (n < count && guard++ < count * 20) {
    const x = r() * W, y = r() * H;
    if (inClear(x, y, 30)) continue;
    const k = r(), c = pick(), a = 0.72 + r() * 0.25;
    if (k < 0.4) cv.paper(x, y, 18 + r() * 22, 7 + r() * 6, r() * Math.PI, c, a);
    else if (k < 0.62) cv.circle(x, y, 5 + r() * 9, c, a);
    else if (k < 0.78) cv.ring(x, y, 8 + r() * 9, 3.5, c, a);
    else cv.sparkle(x, y, 14 + r() * 20, k > 0.9 ? [255, 255, 255] : GOLD, 0.9);
    n++;
  }
  return cv.png();
}

// 年龄章节的圆环：双圈 + 圈上八个彩点
function chapterRing() {
  const cv = new Canvas(W, H), cx = W / 2, cy = H / 2;
  cv.circle(cx, cy, 330, [0, 0, 0], 0.22);
  cv.ring(cx, cy, 330, 10, CORAL, 0.95);
  cv.ring(cx, cy, 362, 3, [255, 255, 255], 0.35);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 - Math.PI / 2; cv.circle(cx + Math.cos(a) * 330, cy + Math.sin(a) * 330, 14, PALETTE[i % PALETTE.length]); }
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.3, rr = 430 + (i % 2) * 40; cv.sparkle(cx + Math.cos(a) * rr * 1.45, cy + Math.sin(a) * rr * 0.9, 18 + (i % 3) * 6, GOLD, 0.85); }
  return cv.png();
}

function pill(w, h, c, a) { const cv = new Canvas(Math.ceil(w), Math.ceil(h)); cv.rrect(0, 0, w, h, h / 2, c, a); return cv.png(); }

/**
 * slides: [{ file: 图片绝对路径, line1: 标题(可空), line2: 日期·年龄, date, ageY?: 选了单个孩子时这张照片拍摄时的整岁数 }]
 * opts: { title, line2, line3, who, outFile, workDir, secs, birthday: {name,age,date}|null, onProgress(done,total) }
 */
async function buildMovie(slides, opts) {
  const font = findFont();
  if (!font) { const e = new Error('服务器缺少中文字体，请把镜像更新到最新版'); e.code = 'NO_FONT'; throw e; }
  if (!slides.length) throw new Error('没有可用的照片');
  const secs = Math.min(Math.max(+opts.secs || 4, 2), 10), work = opts.workDir, bd = opts.birthday || null;
  await fsp.mkdir(work, { recursive: true });
  const files = [];
  let n = 0, nPng = 0;

  const writePng = async (buf) => { const f = path.join(work, `o${nPng++}.png`); await fsp.writeFile(f, buf); return f; };

  // 文字层：items = [{ text, size, y, x, color, bold, shadow }]
  const textFilters = async (items, tag) => {
    const out = [];
    for (let i = 0; i < items.length; i++) {
      let it = items[i]; if (!it.text) continue;
      const max = Math.floor((W * 0.92) / it.size); if ([...String(it.text)].length > max) it = { ...it, text: [...String(it.text)].slice(0, max - 1).join('') + '…' };
      const tf = path.join(work, `${tag}_${i}.txt`);
      await fsp.writeFile(tf, String(it.text), 'utf8');
      const col = it.color || 'white', bold = it.bold ? `:borderw=${Math.max(2, Math.round(it.size / 38))}:bordercolor=${String(col).split('@')[0]}` : '';
      out.push(`drawtext=fontfile='${q(font)}':textfile='${q(tf)}':expansion=none:fontsize=${it.size}:fontcolor=${col}:x='${it.x || '(w-text_w)/2'}':y='${it.y}'${bold}:shadowcolor=black@0.55:shadowx=${it.bold ? 3 : 2}:shadowy=${it.bold ? 3 : 2}`);
    }
    return out;
  };

  // 一个片段 = 背景（照片放大模糊压暗）+ 可选相框照片（白边+柔和阴影，缓慢推拉）+ 装饰小图 + 文字 + 淡入淡出
  // opts: frame 是否把照片完整放进相框；blur 背景模糊强度；dim 压暗；overlays [{ file, x, y }]；items 文字；zoomOut 推/拉
  const segment = async (img, items, d, { frame = false, dim = 0.3, soft = false, overlays = [], zoomOut = false, cy = 440 } = {}) => {
    const tag = `s${n}`, out = path.join(work, `${tag}.mp4`);
    const tx = await textFilters(items, tag);
    const fr = Math.round(d * FPS), inc = (0.06 / fr).toFixed(6);
    const zexpr = zoomOut ? `if(eq(on,0),1.06,max(zoom-${inc},1.0))` : `min(zoom+${inc},1.06)`;
    const bgScale = soft ? '960:540' : '480:270', bgBlur = soft ? 'boxblur=6:2' : 'boxblur=10:3';
    const chain = [];
    if (frame) {
      chain.push('[0:v]split=2[a][b]');
      chain.push(`[a]scale=${bgScale}:force_original_aspect_ratio=increase,crop=${bgScale.replace(':', ':')},${bgBlur},eq=brightness=${-dim}:saturation=1.15,scale=${W}:${H},vignette[bg]`);
      chain.push('[b]scale=1640:760:force_original_aspect_ratio=decrease,pad=iw+32:ih+32:16:16:color=white@0.97,format=rgba,split=2[fg][f2]');
      chain.push('[f2]lutrgb=r=0:g=0:b=0,pad=iw+200:ih+200:100:100:color=black@0,gblur=sigma=26,colorchannelmixer=aa=0.62[sh]');
      chain.push(`[bg][sh]overlay=x=(W-w)/2:y=${cy}-h/2+28:format=auto[t1]`);
      chain.push(`[t1][fg]overlay=x=(W-w)/2:y=${cy}-h/2:format=auto[c]`);
    } else {
      chain.push(`[0:v]scale=${bgScale}:force_original_aspect_ratio=increase,crop=${bgScale},${bgBlur},eq=brightness=${-dim}:saturation=1.15,scale=${W}:${H},vignette[c]`);
    }
    chain.push(`[c]scale=2880:1620,zoompan=z='${zexpr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${fr}:s=${W}x${H}:fps=${FPS}[z0]`);
    let last = 'z0';
    overlays.forEach((o, i) => {   // 输入序号：0 照片、1 静音、2.. 装饰图
      chain.push(`[${last}][${i + 2}:v]overlay=x=${o.x}:y=${o.y}:format=auto[z${i + 1}]`);
      last = `z${i + 1}`;
    });
    chain.push(`[${last}]${[...tx, `fade=t=in:st=0:d=${FADE}`, `fade=t=out:st=${(d - FADE).toFixed(2)}:d=${FADE}`, 'format=yuv420p'].join(',')}[v]`);
    const inputs = ['-i', img, '-f', 'lavfi', '-t', String(d), '-i', 'anullsrc=r=44100:cl=stereo'];
    for (const o of overlays) inputs.push('-loop', '1', '-framerate', String(FPS), '-t', String(d), '-i', o.file);
    await ff([...inputs,
      '-filter_complex', chain.join(';'), '-map', '[v]', '-map', '1:a',
      '-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '64k', '-t', String(d), out]);
    files.push(out);
    n++;
  };

  // 章节：选了单个孩子（每张照片都有整岁数）且跨了不止一个年龄，就在换岁数时插一张「X 岁」
  const ageYs = slides.map((s) => s.ageY);
  const chapters = ageYs.every((v) => Number.isInteger(v) && v >= 0) && new Set(ageYs).size >= 2;
  const nChapters = chapters ? new Set(ageYs).size : 0;
  const total = slides.length + 2 + nChapters;
  const tick = () => { if (opts.onProgress) opts.onProgress(n, total); };

  // 片头
  {
    const png = await writePng(confetti(7, { count: bd ? 170 : 90 }));
    const cnAge = bd ? cnNum(bd.age) : '';
    const items = bd ? [
      { text: bd.name, size: 84, y: '(h-text_h)/2-250', color: hex(GOLD), bold: true },
      { text: /^\d+$/.test(bd.age) ? `${cnAge}岁生日快乐` : `${bd.age}岁生日快乐`, size: 176, y: '(h-text_h)/2-90', bold: true },
      { text: dateCn(bd.date) || opts.line3, size: 54, y: '(h-text_h)/2+110', color: 'white@0.92' },
      { text: `${opts.title} · 成长回顾`, size: 40, y: '(h-text_h)/2+215', color: 'white@0.7' },
    ] : [
      { text: opts.title, size: 128, y: '(h-text_h)/2-170', bold: true },
      { text: opts.line2, size: 64, y: '(h-text_h)/2+10', color: hex(GOLD) },
      { text: opts.line3, size: 44, y: '(h-text_h)/2+120', color: 'white@0.85' },
    ];
    await segment(slides[0].file, items, 6, { frame: false, soft: true, dim: 0.5, overlays: [{ file: png, x: 0, y: 0 }] });
    tick();
  }

  // 照片和章节
  let prevAge = null, pn = 0;
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    if (chapters && s.ageY !== prevAge) {
      const ring = await writePng(chapterRing());
      const y = s.ageY, year = s.date ? s.date.slice(0, 4) : '';
      await segment(s.file, [
        { text: y === 0 ? '出生第一年' : `${cnNum(y)}岁`, size: y === 0 ? 112 : 220, y: '(h-text_h)/2-30', bold: true },
        { text: [year && `${year}年`, opts.who].filter(Boolean).join(' · '), size: 48, y: '(h-text_h)/2+150', color: hex(GOLD) },
      ], 3, { frame: false, soft: true, dim: 0.4, overlays: [{ file: ring, x: 0, y: 0 }] });
      tick(); prevAge = s.ageY;
    }
    // 底部：标题 + 日期年龄胶囊；右上角序号
    const pillTxt = s.line2 || '', size = 36, ph = 64, pw = Math.ceil(textW(pillTxt, size) + 80);
    const hasTitle = !!s.line1, py = hasTitle ? 962 : 930;
    const overlays = [];
    if (pillTxt) overlays.push({ file: await writePng(pill(pw, ph, CORAL, 0.95)), x: Math.round((W - pw) / 2), y: py });
    const cnt = `${++pn} / ${slides.length}`, cw = Math.ceil(textW(cnt, 28) + 44);
    overlays.push({ file: await writePng(pill(cw, 48, [0, 0, 0], 0.38)), x: W - 48 - cw, y: 36 });
    await segment(s.file, [
      { text: s.line1, size: 54, y: 872, bold: true },
      { text: pillTxt, size, y: `${py}+(${ph}-text_h)/2-2`, color: 'white' },
      { text: cnt, size: 28, x: `${W - 48 - cw}+(${cw}-text_w)/2`, y: '36+(48-text_h)/2-1', color: 'white@0.92' },
    ], secs, { frame: true, dim: 0.34, overlays, zoomOut: i % 2 === 0 });
    tick();
  }

  // 片尾
  {
    const png = await writePng(confetti(23, { count: bd ? 170 : 90 }));
    const items = bd ? [
      { text: bd.name, size: 84, y: '(h-text_h)/2-230', color: hex(GOLD), bold: true },
      { text: /^\d+$/.test(bd.age) ? `${cnNum(bd.age)}岁快乐` : `${bd.age}岁快乐`, size: 160, y: '(h-text_h)/2-60', bold: true },
      { text: '愿你健康快乐，永远像今天这样笑', size: 50, y: '(h-text_h)/2+130', color: 'white@0.92' },
      { text: opts.title, size: 38, y: '(h-text_h)/2+220', color: 'white@0.65' },
    ] : [
      { text: '· 完 ·', size: 128, y: '(h-text_h)/2-150', bold: true },
      { text: opts.title, size: 56, y: '(h-text_h)/2+30', color: hex(GOLD) },
      { text: '愿你们平安喜乐，慢慢长大', size: 42, y: '(h-text_h)/2+130', color: 'white@0.88' },
    ];
    await segment(slides[slides.length - 1].file, items, 6, { frame: false, soft: true, dim: 0.5, overlays: [{ file: png, x: 0, y: 0 }], zoomOut: true });
    tick();
  }

  const list = path.join(work, 'list.txt');
  await fsp.writeFile(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
  await ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', opts.outFile], 600e3);
  await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
  return opts.outFile;
}

module.exports = { buildMovie, findFont };
