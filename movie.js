// 回顾视频：把照片做成 1920x1080 的 MP4 幻灯片（标题页 + 每张照片带日期/年龄字幕 + 片尾），生日时可在大屏上直接播放。
// 依赖系统里的 ffmpeg（带 drawtext）和一款中文字体（Dockerfile 里装了 fonts-wqy-microhei）。
const { execFile } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

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

/**
 * slides: [{ file: 图片绝对路径, line1: 标题(可空), line2: 日期·年龄 }]
 * opts: { title, line2, line3, outFile, workDir, secs, onProgress(done,total) }
 */
async function buildMovie(slides, opts) {
  const font = findFont();
  if (!font) { const e = new Error('服务器缺少中文字体，请把镜像更新到最新版'); e.code = 'NO_FONT'; throw e; }
  if (!slides.length) throw new Error('没有可用的照片');
  const secs = Math.min(Math.max(+opts.secs || 4, 2), 10), work = opts.workDir;
  await fsp.mkdir(work, { recursive: true });
  const segs = [];
  let n = 0;

  // 文字层：items = [{ text, size, y, box }]
  const textFilters = async (items, tag) => {
    const out = [];
    for (let i = 0; i < items.length; i++) {
      let it = items[i]; if (!it.text) continue;
      const max = Math.floor(W * 0.9 / it.size); if ([...String(it.text)].length > max) it = { ...it, text: [...String(it.text)].slice(0, max - 1).join('') + '…' };
      const tf = path.join(work, `${tag}_${i}.txt`);
      await fsp.writeFile(tf, String(it.text), 'utf8');
      out.push(`drawtext=fontfile='${q(font)}':textfile='${q(tf)}':expansion=none:fontsize=${it.size}:fontcolor=${it.color || 'white'}:x='${it.x || '(w-text_w)/2'}':y='${it.y}':shadowcolor=black@0.6:shadowx=2:shadowy=2${it.box ? ':box=1:boxcolor=black@0.4:boxborderw=18' : ''}`);
    }
    return out;
  };

  // 一个片段：背景=照片放大模糊压暗，前景=照片完整居中（白边相框），缓慢推拉（Ken Burns），叠字，淡入淡出
  const FRAMES = (d) => Math.round(d * FPS);
  const segment = async (img, items, d, { dim = 0.12, frame = true, bar = false, out: zoomOut = false, deco = null } = {}) => {
    const tag = `s${n}`, out = path.join(work, `${tag}.mp4`);
    const tx = await textFilters(items, tag);
    const fr = FRAMES(d), inc = (0.075 / fr).toFixed(6);
    const zexpr = zoomOut ? `if(eq(on,0),1.075,max(zoom-${inc},1.0))` : `min(zoom+${inc},1.075)`;
    const fg = frame
      ? `[b]scale=1700:900:force_original_aspect_ratio=decrease,pad=iw+28:ih+28:14:14:color=white@0.95[fg]`
      : `[b]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg]`;
    const overlay = frame ? `[bg][fg]overlay=(W-w)/2:(H-h)/2-30[c]` : `[bg][fg]overlay=(W-w)/2:(H-h)/2[c]`;
    const layers = [
      ...(bar ? [`drawbox=x=0:y=ih-230:w=iw:h=230:color=black@0.38:t=fill`, `drawbox=x=0:y=ih-230:w=iw:h=4:color=0xf2705f@0.9:t=fill`] : []),
      ...(deco || []),
      ...tx,
      `fade=t=in:st=0:d=${FADE}`, `fade=t=out:st=${(d - FADE).toFixed(2)}:d=${FADE}`, 'format=yuv420p',
    ];
    const chain = [
      `[0:v]split=2[a][b]`,
      `[a]scale=480:270:force_original_aspect_ratio=increase,crop=480:270,boxblur=10:3,eq=brightness=${-dim}:saturation=1.1,scale=${W}:${H}[bg]`,
      fg, overlay,
      `[c]scale=2880:1620,zoompan=z='${zexpr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${fr}:s=${W}x${H}:fps=${FPS}[z]`,
      `[z]${layers.join(',')}[v]`,
    ].join(';');
    await ff(['-i', img,
      '-f', 'lavfi', '-t', String(d), '-i', 'anullsrc=r=44100:cl=stereo',
      '-filter_complex', chain, '-map', '[v]', '-map', '1:a',
      '-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '64k', '-t', String(d), out]);
    segs.push(out); n++;
  };

  const total = slides.length + 2;
  const tick = () => { if (opts.onProgress) opts.onProgress(n, total); };

  const accent = (y, w = 300) => [`drawbox=x=${(W - w) / 2}:y=${y}:w=${w}:h=6:color=0xf2705f:t=fill`];
  await segment(slides[0].file, [
    { text: opts.title, size: 128, y: 'h/2-200' },
    { text: opts.line2, size: 60, y: 'h/2+20' },
    { text: opts.line3, size: 42, y: 'h/2+120', color: 'white@0.85' },
  ], 5, { dim: 0.42, frame: false, deco: accent(H / 2 - 20) }); tick();
  let k = 0;
  for (const s of slides) {
    k++;
    await segment(s.file, [
      { text: s.line1, size: 60, y: 'h-190', box: true },
      { text: s.line2, size: 42, y: 'h-110', color: 'white@0.9' },
      { text: `${k} / ${slides.length}`, size: 30, x: 'w-text_w-48', y: '40', color: 'white@0.7' },
    ], secs, { bar: true, out: k % 2 === 0 }); tick();
  }
  await segment(slides[slides.length - 1].file, [
    { text: '· 完 ·', size: 128, y: 'h/2-150' },
    { text: opts.title, size: 52, y: 'h/2+50' },
    { text: '愿你们平安喜乐，慢慢长大', size: 38, y: 'h/2+140', color: 'white@0.85' },
  ], 5, { dim: 0.42, frame: false, out: true, deco: accent(H / 2 + 10) }); tick();

  const list = path.join(work, 'list.txt');
  await fsp.writeFile(list, segs.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
  await ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', opts.outFile], 600e3);
  await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
  return opts.outFile;
}

module.exports = { buildMovie, findFont };
