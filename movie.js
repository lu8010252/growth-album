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
      out.push(`drawtext=fontfile='${q(font)}':textfile='${q(tf)}':expansion=none:fontsize=${it.size}:fontcolor=white:x=(w-text_w)/2:y=${it.y}:shadowcolor=black@0.7:shadowx=2:shadowy=2${it.box ? ':box=1:boxcolor=black@0.45:boxborderw=16' : ''}`);
    }
    return out;
  };

  // 一个片段：背景=照片放大模糊，前景=照片完整居中，叠字，淡入淡出
  const segment = async (img, items, d, { dim = 0 } = {}) => {
    const tag = `s${n}`, out = path.join(work, `${tag}.mp4`);
    const tx = await textFilters(items, tag);
    const chain = [
      `[0:v]split=2[a][b]`,
      `[a]scale=480:270:force_original_aspect_ratio=increase,crop=480:270,boxblur=10:3${dim ? `,eq=brightness=${-dim}` : ''},scale=${W}:${H}[bg]`,
      `[b]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg]`,
      `[bg][fg]overlay=(W-w)/2:(H-h)/2[c]`,
      `[c]${[...tx, `fade=t=in:st=0:d=${FADE}`, `fade=t=out:st=${(d - FADE).toFixed(2)}:d=${FADE}`, 'format=yuv420p'].join(',')}[v]`,
    ].join(';');
    await ff(['-loop', '1', '-framerate', String(FPS), '-t', String(d), '-i', img,
      '-f', 'lavfi', '-t', String(d), '-i', 'anullsrc=r=44100:cl=stereo',
      '-filter_complex', chain, '-map', '[v]', '-map', '1:a',
      '-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '64k', '-t', String(d), out]);
    segs.push(out); n++;
  };

  const total = slides.length + 2;
  const tick = () => { if (opts.onProgress) opts.onProgress(n, total); };

  await segment(slides[0].file, [
    { text: opts.title, size: 120, y: 'h/2-190' },
    { text: opts.line2, size: 60, y: 'h/2-20' },
    { text: opts.line3, size: 42, y: 'h/2+90' },
  ], 4, { dim: 0.28 }); tick();
  for (const s of slides) {
    await segment(s.file, [
      { text: s.line1, size: 60, y: 'h-200', box: true },
      { text: s.line2, size: 42, y: 'h-115', box: true },
    ], secs); tick();
  }
  await segment(slides[slides.length - 1].file, [
    { text: '· 完 ·', size: 120, y: 'h/2-100' },
    { text: opts.title, size: 48, y: 'h/2+60' },
  ], 4, { dim: 0.28 }); tick();

  const list = path.join(work, 'list.txt');
  await fsp.writeFile(list, segs.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
  await ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', opts.outFile], 600e3);
  await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
  return opts.outFile;
}

module.exports = { buildMovie, findFont };
