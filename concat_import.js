#!/usr/bin/env node
/*
 * concat_import.js —— 把回顾视频的分片包导入 Concat 剪辑软件的示例脚本。
 *
 * 用法：
 *   1. 在 Concat 里打开「设置 → 自动化 → 脚本与应用」，记下地址和 token（写在 automation.json 里）。
 *   2. 解压分片包（含 manifest.json + seg_*.mp4）到某个文件夹。
 *   3. 设置环境变量：
 *        export CONCAT_API_ADDRESS=127.0.0.1:7420   # Concat 自动化里显示的地址
 *        export CONCAT_API_TOKEN=你的token            # Concat 自动化里显示的 token
 *   4. node concat_import.js /path/to/解压后的文件夹
 *
 * 脚本会：
 *   - 新建一个 Concat 项目
 *   - 按 manifest.json 里 segments 的 index 顺序，逐个 media_import 导入分片
 *   - 用 clips_add_sequence 把它们按顺序排到时间轴上
 *   - 加一条空的音乐轨（方便你在 Concat 里替换成自己的音乐）
 *
 * 这是示例脚本，不是运行时依赖。Concat 的 API 可能随版本变化，详见
 * https://github.com/jub0t/Concat 和 https://concat.standalones.org/docs
 * 不行就手动把 seg_*.mp4 拖进 Concat 窗口，再按顺序排好即可。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ADDR = process.env.CONCAT_API_ADDRESS;
const TOKEN = process.env.CONCAT_API_TOKEN;
const dir = process.argv[2];

if (!dir) { console.error('请指定分片包解压后的文件夹路径'); process.exit(1); }
if (!ADDR || !TOKEN) { console.error('请设置 CONCAT_API_ADDRESS 和 CONCAT_API_TOKEN 环境变量（在 Concat 的 设置 → 自动化 里查看）'); process.exit(1); }

const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const BASE = `http://${ADDR}`;

let id = 1;
async function rpc(method, params) {
  const body = { jsonrpc: '2.0', id: id++, method, params };
  const r = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${method} 失败: ${JSON.stringify(j.error)}`);
  return j.result;
}

(async () => {
  console.log('新建项目…');
  const project = await rpc('project_create', { name: manifest.title || '成长回顾' });
  await rpc('project_open', { id: project.id });

  // 按 index 顺序导入分片并加到时间轴
  const segs = manifest.segments.slice().sort((a, b) => a.index - b.index);
  const clipIds = [];
  for (const s of segs) {
    const file = path.resolve(dir, s.file);
    console.log(`导入 ${s.file} (${s.role})…`);
    const media = await rpc('media_import', { path: file });
    const clip = await rpc('clip_add', { mediaId: media.id, trackIndex: 0 });
    clipIds.push(clip.id);
  }

  // 加一条空音乐轨，方便用户在 Concat 里替换
  console.log('加一条音乐轨…');
  await rpc('track_add', { kind: 'audio' });

  await rpc('project_save', {});
  console.log(`\n完成！${segs.length} 个片段已按顺序导入 Concat。`);
  console.log('现在可以在 Concat 里加音乐、加字幕、加转场，然后导出。');
})().catch((e) => { console.error(e.message); process.exit(1); });
