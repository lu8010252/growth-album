// 回顾视频：把照片做成 1920x1080 的 MP4 幻灯片（标题页 + 每张照片带日期/年龄字幕 + 片尾），生日时可在大屏上直接播放。
// 支持四种模板：经典简约 / 十周岁生日 / 成长时光线 / 纪念日·节日。
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

// 模板：经典简约（保留原有风格）
const TPL = {
  classic: {
    intro: (ctx) => ctx.segment(ctx.slides[0].file, [
      { text: ctx.opts.title, size: 128, y: 'h/2-200' },
      { text: ctx.opts.line2, size: 60, y: 'h/2+20' },
      { text: ctx.opts.line3, size: 42, y: 'h/2+120', color: 'white@0.85' },
    ], 5, { dim: 0.42, frame: false, deco: ctx.accent(H / 2 - 20) }, 'intro'),
    photo: (ctx, s, i) => ctx.segment(s.file, [
      { text: s.line1, size: 60, y: 'h-190', box: true },
      { text: s.line2, size: 42, y: 'h-110', color: 'white@0.9' },
      { text: `${i + 1} / ${ctx.slides.length}`, size: 30, x: 'w-text_w-48', y: '40', color: 'white@0.7' },
    ], ctx.secs, { bar: true, out: i % 2 === 0 }, 'photo'),
    outro: (ctx) => ctx.segment(ctx.slides[ctx.slides.length - 1].file, [
      { text: '· 完 ·', size: 128, y: 'h/2-150' },
      { text: ctx.opts.title, size: 52, y: 'h/2+50' },
      { text: '愿你们平安喜乐，慢慢长大', size: 38, y: 'h/2+140', color: 'white@0.85' },
    ], 5, { dim: 0.42, frame: false, out: true, deco: ctx.accent(H / 2 + 10) }, 'outro'),
    interlude: null,
  },
  // 十周岁生日主题：大字号生日快乐 + 彩色绶带装饰 + 气球几何造型（不用 emoji，中文字体无彩色字形）
  birthday: {
    intro: (ctx) => {
      const b = ctx.opts.birthday || {};
      // 彩色绶带：几条彩色横条斜放（用 drawbox 模拟）
      const ribbons = [
        `drawbox=x=-40:y=${H / 2 - 280}:w=200:h=14:color=0xff6b6b:t=fill`,
        `drawbox=x=-20:y=${H / 2 - 250}:w=180:h=14:color=0xffd93d:t=fill`,
        `drawbox=x=10:y=${H / 2 - 220}:w=160:h=14:color=0x6bcf7f:t=fill`,
        `drawbox=x=${W - 160}:y=${H / 2 - 280}:w=200:h=14:color=0x4d96ff:t=fill`,
        `drawbox=x=${W - 180}:y=${H / 2 - 250}:w=180:h=14:color=0xc77dff:t=fill`,
      ];
      return ctx.segment(ctx.slides[0].file, [
        { text: `${b.name || ''} ${b.age || ''}岁`, size: 90, y: 'h/2-240', color: '0xffd93d' },
        { text: '生日快乐', size: 160, y: 'h/2-100' },
        { text: b.date || '', size: 56, y: 'h/2+80', color: 'white@0.9' },
        { text: `${ctx.opts.title} · 成长回顾`, size: 40, y: 'h/2+180', color: 'white@0.7' },
      ], 6, { dim: 0.45, frame: false, deco: ribbons }, 'intro');
    },
    photo: (ctx, s, i) => ctx.segment(s.file, [
      { text: s.line1, size: 64, y: 'h-200', box: true, color: '0xffd93d' },
      { text: s.line2, size: 44, y: 'h-110', color: 'white@0.95' },
      { text: `${i + 1} / ${ctx.slides.length}`, size: 30, x: 'w-text_w-48', y: '40', color: '0xffd93d@0.8' },
    ], ctx.secs, { bar: true, out: i % 2 === 0 }, 'photo'),
    outro: (ctx) => {
      const b = ctx.opts.birthday || {};
      // 气球造型：几个彩色圆点（drawbox 圆角近似）分布在两侧
      const balloons = [
        `drawbox=x=120:y=200:w=70:h=70:color=0xff6b6b@0.85:t=fill`,
        `drawbox=x=200:y=320:w=55:h=55:color=0xffd93d@0.85:t=fill`,
        `drawbox=x=${W - 190}:y=200:w=70:h=70:color=0x4d96ff@0.85:t=fill`,
        `drawbox=x=${W - 270}:y=320:w=55:h=55:color=0x6bcf7f@0.85:t=fill`,
        `drawbox=x=${W / 2 - 150}:y=120:w=60:h=60:color=0xc77dff@0.8:t=fill`,
      ];
      return ctx.segment(ctx.slides[ctx.slides.length - 1].file, [
        { text: `${b.name || ''} ${b.age || ''}岁`, size: 90, y: 'h/2-220', color: '0xffd93d' },
        { text: '生日快乐', size: 140, y: 'h/2-60' },
        { text: '愿健康快乐，永远像今天这样笑', size: 40, y: 'h/2+120', color: 'white@0.9' },
        { text: ctx.opts.title, size: 36, y: 'h/2+200', color: 'white@0.65' },
      ], 6, { dim: 0.45, frame: false, out: true, deco: balloons }, 'outro');
    },
    interlude: null,
  },
  // 成长时光线：按年份分段，跨年时插一个年份大字幕过渡
  timeline: {
    intro: (ctx) => ctx.segment(ctx.slides[0].file, [
      { text: ctx.opts.title, size: 128, y: 'h/2-180' },
      { text: ctx.opts.line2, size: 60, y: 'h/2+20' },
      { text: ctx.opts.line3, size: 42, y: 'h/2+120', color: 'white@0.85' },
      { text: '时光线 · 一步一步长大的日子', size: 36, y: 'h/2+200', color: 'white@0.6' },
    ], 5, { dim: 0.42, frame: false, deco: ctx.accent(H / 2 - 20) }, 'intro'),
    photo: (ctx, s, i) => ctx.segment(s.file, [
      { text: s.line1, size: 60, y: 'h-190', box: true },
      { text: s.line2, size: 42, y: 'h-110', color: 'white@0.9' },
      { text: `${i + 1} / ${ctx.slides.length}`, size: 30, x: 'w-text_w-48', y: '40', color: 'white@0.7' },
    ], ctx.secs, { bar: true, out: i % 2 === 0 }, 'photo'),
    interlude: (ctx, year) => ctx.segment(ctx.slides[0].file, [
      { text: String(year), size: 200, y: 'h/2-130', color: 'white@0.95' },
      { text: '年', size: 60, y: 'h/2+60', color: 'white@0.6' },
    ], 3, { dim: 0.55, frame: false }, 'interlude'),
    outro: (ctx) => ctx.segment(ctx.slides[ctx.slides.length - 1].file, [
      { text: '· 完 ·', size: 128, y: 'h/2-150' },
      { text: ctx.opts.title, size: 52, y: 'h/2+50' },
      { text: '时间会走，这些瞬间留下', size: 38, y: 'h/2+140', color: 'white@0.85' },
    ], 5, { dim: 0.42, frame: false, out: true, deco: ctx.accent(H / 2 + 10) }, 'outro'),
  },
  // 纪念日·节日：深底 + 金色字 + 黑底字幕，庄重风格
  memorial: {
    intro: (ctx) => ctx.segment(ctx.slides[0].file, [
      { text: ctx.opts.title, size: 120, y: 'h/2-200', color: '0xd4af37' },
      { text: ctx.opts.line2, size: 56, y: 'h/2+20', color: '0xd4af37@0.9' },
      { text: ctx.opts.line3, size: 42, y: 'h/2+120', color: 'white@0.7' },
    ], 5, { dim: 0.5, frame: false }, 'intro'),
    photo: (ctx, s, i) => ctx.segment(s.file, [
      { text: s.line1, size: 60, y: 'h-190', box: true, color: '0xd4af37' },
      { text: s.line2, size: 42, y: 'h-110', color: 'white@0.9', box: true },
      { text: `${i + 1} / ${ctx.slides.length}`, size: 30, x: 'w-text_w-48', y: '40', color: '0xd4af37@0.7' },
    ], ctx.secs, { bar: true, out: i % 2 === 0 }, 'photo'),
    outro: (ctx) => ctx.segment(ctx.slides[ctx.slides.length - 1].file, [
      { text: '· 完 ·', size: 120, y: 'h/2-150', color: '0xd4af37' },
      { text: ctx.opts.title, size: 50, y: 'h/2+50', color: '0xd4af37@0.9' },
      { text: '愿这份记忆，长长久久', size: 38, y: 'h/2+140', color: 'white@0.7' },
    ], 5, { dim: 0.5, frame: false, out: true }, 'outro'),
    interlude: null,
  },
};

/**
 * slides: [{ file: 图片绝对路径, line1: 标题(可空), line2: 日期·年龄, date, key }]
 * opts: { title, line2, line3, outFile, workDir, secs, template, birthday, keepSegments, onProgress(done,total), onSegments(segs) }
 *   template: 'classic' | 'birthday' | 'timeline' | 'memorial'（默认 classic）
 *   birthday: { name, age, date }（仅 birthday 模板用）
 *   keepSegments: true 时保留分片（用于 Concat 剪辑导出），通过 onSegments 回调返回带元数据的分片列表
 */
async function buildMovie(slides, opts) {
  const font = findFont();
  if (!font) { const e = new Error('服务器缺少中文字体，请把镜像更新到最新版'); e.code = 'NO_FONT'; throw e; }
  if (!slides.length) throw new Error('没有可用的照片');
  const secs = Math.min(Math.max(+opts.secs || 4, 2), 10), work = opts.workDir;
  const template = TPL[opts.template] ? opts.template : 'classic';
  await fsp.mkdir(work, { recursive: true });
  const segs = [];
  let n = 0;

  // 文字层：items = [{ text, size, y, box, color, x }]
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
  const segment = async (img, items, d, { dim = 0.12, frame = true, bar = false, out: zoomOut = false, deco = null } = {}, role = 'photo') => {
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
    // 附带元数据（用于 Concat 分片包导出）
    const subtitle = items.filter((it) => it.text).map((it) => String(it.text)).join(' · ');
    segs.push({ file: out, role, subtitle, duration: d, index: n });
    n++;
  };

  const tpl = TPL[template];
  const ctx = { segment, slides, secs, opts, accent: (y, w = 300) => [`drawbox=x=${(W - w) / 2}:y=${y}:w=${w}:h=6:color=0xf2705f:t=fill`] };
  const interludeCount = tpl.interlude ? (new Set(slides.map((s) => s.date.slice(0, 4))).size - 1) : 0;
  const total = slides.length + 2 + interludeCount;
  const tick = () => { if (opts.onProgress) opts.onProgress(n, total); };

  await tpl.intro(ctx); tick();
  let prevYear = null;
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    const year = s.date ? s.date.slice(0, 4) : null;
    if (tpl.interlude && year && prevYear !== null && year !== prevYear) {
      await tpl.interlude(ctx, year); tick();
    }
    if (year) prevYear = year;
    await tpl.photo(ctx, s, i); tick();
  }
  await tpl.outro(ctx); tick();

  const list = path.join(work, 'list.txt');
  await fsp.writeFile(list, segs.map((f) => `file '${f.file.replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
  await ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', opts.outFile], 600e3);
  if (opts.keepSegments) {
    // 保留分片目录和 list.txt，供 Concat 分片包导出
    if (opts.onSegments) opts.onSegments(segs);
  } else {
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
  }
  return opts.outFile;
}

module.exports = { buildMovie, findFont, TEMPLATES: TPL };
