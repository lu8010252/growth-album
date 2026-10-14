'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = { me: null, kids: [], title: '成长册' };
const ROLE_NAME = { admin: '管理员', member: '家人（可发布）', viewer: '家人（只读）', child: '孩子' };
const canWrite = () => S.me && S.me.role !== 'viewer';

/* ---------- 工具 ---------- */
async function api(url, opt = {}) {
  const o = { credentials: 'same-origin', ...opt };
  if (opt.json !== undefined) { o.method = opt.method || 'POST'; o.headers = { 'Content-Type': 'application/json' }; o.body = JSON.stringify(opt.json); }
  const r = await fetch(url, o);
  let d = null; try { d = await r.json(); } catch {}
  if (r.status === 401 && S.me) { S.me = null; location.hash = '#/login'; }
  if (!r.ok) throw new Error((d && d.error) || '请求失败 ' + r.status);
  return d;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2200); }
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const kidOf = (id) => S.kids.find((k) => k.id === id);
function ageText(b, d) {
  if (!b) return '';
  const x = new Date(b + 'T00:00:00'), y = new Date(d + 'T00:00:00');
  if (y < x) return '出生前';
  let Y = y.getFullYear() - x.getFullYear(), M = y.getMonth() - x.getMonth();
  if (y.getDate() < x.getDate()) M--;
  if (M < 0) { Y--; M += 12; }
  if (Y <= 0 && M <= 0) { const n = Math.round((y - x) / 864e5); return n === 0 ? '出生当天' : `出生第${n}天`; }
  return Y > 0 ? (M > 0 ? `${Y}岁${M}个月` : `${Y}岁`) : `${M}个月`;
}
const WD = ['日', '一', '二', '三', '四', '五', '六'];
const dateText = (d) => { const x = new Date(d + 'T00:00:00'); return `${x.getMonth() + 1}月${x.getDate()}日 周${WD[x.getDay()]}`; };
const monthText = (d) => `${d.slice(0, 4)}年${+d.slice(5, 7)}月`;
const sizeText = (n) => (n > 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.ceil(n / 1024) + ' KB');
function kidTags(p) {
  const ks = p.kidIds.map(kidOf).filter(Boolean);
  if (!ks.length) return p.type === 'diary' ? '' : '<span class="tag" style="background:#8c7b72">🏠 全家</span>';
  return ks.map((k) => `<span class="tag" style="background:${k.color}">${esc(k.emoji)} ${esc(k.name)}${k.birthday ? ' · ' + ageText(k.birthday, p.date) : ''}</span>`).join('');
}

/* ---------- 弹窗表单 ---------- */
function formDialog(title, fields, onOk, okText = '保存', note = '') {
  const d = document.createElement('dialog');
  const fh = fields.map((f) => {
    const v = f.value ?? '';
    if (f.type === 'select') return `<label class="field"><span>${f.label}</span><select name="${f.name}">${f.options.map(([val, l]) => `<option value="${esc(val)}" ${val === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    return `<label class="field"><span>${f.label}</span><input name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}" autocomplete="off"></label>`;
  }).join('');
  d.innerHTML = `<form method="dialog" class="dlg"><h3>${esc(title)}</h3>${note ? `<p class="note">${note}</p>` : ''}${fh}<p class="err" hidden></p><div class="row sp"><button type="button" class="btn ghost" data-x>取消</button><button class="btn">${okText}</button></div></form>`;
  document.body.appendChild(d); d.showModal();
  $('[data-x]', d).onclick = () => d.close();
  d.addEventListener('close', () => d.remove());
  $('form', d).onsubmit = async (e) => {
    e.preventDefault();
    const vals = Object.fromEntries(new FormData(e.target));
    const err = $('.err', d); err.hidden = true;
    try { await onOk(vals); d.close(); } catch (x) { err.textContent = x.message; err.hidden = false; }
  };
}
function confirmBox(msg) { return confirm(msg); }

/* ---------- 大图查看 ---------- */
const LB = { list: [], i: 0 };
function openLB(list, i) { LB.list = list; LB.i = i; showLB(); $('#lb').hidden = false; }
function showLB() { $('#lb img').src = LB.list[LB.i]; $('#lb .nv').hidden = LB.list.length < 2; }
$('#lb .x').onclick = () => ($('#lb').hidden = true);
$('#lb .p').onclick = () => { LB.i = (LB.i - 1 + LB.list.length) % LB.list.length; showLB(); };
$('#lb .n').onclick = () => { LB.i = (LB.i + 1) % LB.list.length; showLB(); };
$('#lb').addEventListener('click', (e) => { if (e.target.id === 'lb') $('#lb').hidden = true; });
document.addEventListener('keydown', (e) => { if ($('#lb').hidden) return; if (e.key === 'Escape') $('#lb').hidden = true; if (e.key === 'ArrowLeft') $('#lb .p').click(); if (e.key === 'ArrowRight') $('#lb .n').click(); });
let tx = 0;
$('#lb').addEventListener('touchstart', (e) => (tx = e.touches[0].clientX), { passive: true });
$('#lb').addEventListener('touchend', (e) => { const dx = e.changedTouches[0].clientX - tx; if (Math.abs(dx) > 60 && LB.list.length > 1) (dx > 0 ? $('#lb .p') : $('#lb .n')).click(); });

/* ---------- 外框 ---------- */
function chrome(route) {
  const on = !!S.me;
  $('#top').hidden = !on; $('#tabs').hidden = !on;
  $('#brand').textContent = S.title; document.title = S.title;
  if (!on) return;
  $('#who').textContent = S.me.name;
  const tabs = [['#/', '🏡', '首页', ''], ['#/diary', '📖', '日记', 'diary']];
  if (canWrite()) tabs.splice(1, 0, ['#/new', '＋', '', 'add']);
  tabs.push(['#/me', '🙂', '我的', 'me']);
  $('#tabs').innerHTML = tabs.map(([h, ic, t, k]) => `<a href="${h}" class="${k === 'add' ? 'add' : ''} ${route === k || (k === '' && route === '') ? 'on' : ''}"><b>${ic}</b>${t}</a>`).join('');
}

/* ---------- 登录 / 初始化 ---------- */
function viewLogin(setup) {
  $('#view').innerHTML = `<div class="login"><h1>${esc(S.title)}</h1><p>${setup ? '第一次使用，先创建管理员账号' : '记录她们长大的每一天'}</p>
  <form class="panel" id="lf">
    ${setup ? '<label class="field"><span>你的名字（显示给家人看）</span><input name="name" type="text" placeholder="爸爸" required></label>' : ''}
    <label class="field"><span>用户名</span><input name="username" type="text" autocomplete="username" autocapitalize="none" required></label>
    <label class="field"><span>密码${setup ? '（至少 6 位）' : ''}</span><input name="password" type="password" autocomplete="${setup ? 'new-password' : 'current-password'}" required></label>
    <p class="err" hidden></p><button class="btn" style="width:100%">${setup ? '创建并进入' : '登录'}</button></form></div>`;
  $('#lf').onsubmit = async (e) => {
    e.preventDefault(); const err = $('.err'); err.hidden = true;
    try { await api(setup ? '/api/setup' : '/api/login', { json: Object.fromEntries(new FormData(e.target)) }); await boot(); location.hash = '#/'; route(); }
    catch (x) { err.textContent = x.message; err.hidden = false; }
  };
}

/* ---------- 时间线 ---------- */
function cardHtml(p) {
  const imgs = p.media.slice(0, 4);
  const grid = imgs.length ? `<div class="grid n${imgs.length}">${imgs.map((m, i) => {
    const src = m.kind === 'video' ? m.poster : (m.thumb || m.url);
    return `<div class="cell">${src ? `<img loading="lazy" src="${src}" alt="">` : ''}${m.kind === 'video' ? '<div class="play">▶</div>' : ''}${i === 3 && p.media.length > 4 ? `<div class="more">+${p.media.length - 4}</div>` : ''}</div>`;
  }).join('')}</div>` : '';
  return `<a class="card" href="#/post/${p.id}"><div class="meta"><span>${dateText(p.date)}</span>${kidTags(p)}${p.type === 'diary' ? `<span>📖 ${p.visibility === 'private' ? '私密日记' : '日记'}</span>` : ''}</div>
  ${p.title ? `<h3>${esc(p.title)}</h3>` : ''}${p.body ? `<p class="excerpt">${esc(p.body)}</p>` : ''}${grid}
  <div class="foot"><span>${esc(p.authorName)}</span><span>${p.liked ? '❤️' : '🤍'} ${p.likeCount || ''}</span><span>💬 ${p.comments.length || ''}</span></div></a>`;
}
async function viewTimeline(mode, qs) {
  const filter = { kid: qs.get('kid') || '', q: qs.get('q') || '' };
  const type = mode === 'diary' ? 'diary' : '';
  const chips = mode === 'diary' ? '' : `<div class="chips"><a class="chip ${!filter.kid ? 'on' : ''}" href="#/">全部</a>${S.kids.map((k) => `<a class="chip ${filter.kid === k.id ? 'on' : ''}" href="#/?kid=${k.id}">${esc(k.emoji)} ${esc(k.name)}</a>`).join('')}</div>`;
  $('#view').innerHTML = `${mode === 'diary' ? '<h2 style="margin:6px 4px 10px">📖 日记</h2>' : ''}${chips}<div id="tl"></div><div id="more" class="empty" hidden><button class="btn ghost">加载更多</button></div>`;
  let offset = 0, last = '', total = 0;
  const tl = $('#tl');
  async function load() {
    const u = `/api/posts?limit=15&offset=${offset}${type ? '&type=' + type : ''}${filter.kid ? '&kid=' + filter.kid : ''}${filter.q ? '&q=' + encodeURIComponent(filter.q) : ''}`;
    const d = await api(u); total = d.total;
    let h = '';
    for (const p of d.items) { const m = monthText(p.date); if (m !== last) { last = m; h += `<div class="month"><span>${m}</span></div>`; } h += cardHtml(p); }
    tl.insertAdjacentHTML('beforeend', h); offset += d.items.length;
    $('#more').hidden = offset >= total || !d.items.length;
    if (!total) tl.innerHTML = `<div class="empty">${mode === 'diary' ? '还没有日记' : '还没有记录'}${canWrite() ? '<br>点下面的 ＋ 写下第一条吧' : ''}</div>`;
  }
  $('#more button').onclick = () => load().catch((e) => toast(e.message));
  await load();
}

/* ---------- 详情 ---------- */
async function viewPost(id) {
  const p = await api('/api/posts/' + id);
  const imgs = p.media.filter((m) => m.kind === 'image');
  const media = p.media.map((m) => {
    if (m.kind === 'image') return `<figure><img loading="lazy" src="${m.view || m.url}" data-i="${imgs.indexOf(m)}" alt=""><figcaption><a href="${m.url}" download="${esc(m.name)}">下载原图 · ${sizeText(m.size)}</a></figcaption></figure>`;
    return `<figure><video controls playsinline preload="metadata" ${m.poster ? `poster="${m.poster}"` : ''} src="${m.web || m.url}"></video><figcaption>${m.status === 'processing' ? '⏳ 正在生成手机兼容版本，先播放原片 · ' : ''}<a href="${m.url}" download="${esc(m.name)}">下载原视频 · ${sizeText(m.size)}</a></figcaption></figure>`;
  }).join('');
  $('#view').innerHTML = `<div class="panel post"><div class="meta"><a href="javascript:history.back()">‹ 返回</a><span>${dateText(p.date)}</span>${kidTags(p)}${p.type === 'diary' ? `<span>📖 ${p.visibility === 'private' ? '私密日记' : '日记'}</span>` : ''}</div>
  ${p.title ? `<h2>${esc(p.title)}</h2>` : ''}<div class="note">${esc(p.authorName)} 记录于 ${p.createdAt.slice(0, 10)}</div>
  ${p.body ? `<div class="body">${esc(p.body)}</div>` : ''}<div class="media">${media}</div>
  <div class="row" style="margin-top:14px"><button class="btn ghost sm" id="like">${p.liked ? '❤️' : '🤍'} ${p.likeCount || '喜欢'}</button>
  ${p.canEdit ? `<a class="btn ghost sm" href="#/edit/${p.id}">编辑</a>` : ''}${p.canDelete ? '<button class="btn danger sm" id="del">删除</button>' : ''}</div></div>
  <div class="panel"><h3>💬 评论 ${p.comments.length || ''}</h3><div id="cms">${p.comments.map((c) => `<div class="cmt"><b>${esc(c.name)}</b><small>${c.at.slice(0, 10)}</small>${c.mine || p.canDelete ? `<a data-c="${c.id}">删除</a>` : ''}<br>${esc(c.text)}</div>`).join('')}</div>
  <form id="cf" class="row" style="margin-top:8px"><input type="text" name="text" placeholder="说点什么…" style="flex:1" required><button class="btn sm">发送</button></form></div>`;
  $('#view').querySelectorAll('.media img').forEach((i) => (i.onclick = () => openLB(imgs.map((m) => m.view || m.url), +i.dataset.i)));
  $('#like').onclick = async () => { await api(`/api/posts/${id}/like`, { method: 'POST' }); viewPost(id); };
  if ($('#del')) $('#del').onclick = async () => { if (confirmBox('确定删除这条记录？照片和视频也会一起删除，不能恢复。')) { await api('/api/posts/' + id, { method: 'DELETE' }); toast('已删除'); history.length > 1 ? history.back() : (location.hash = '#/'); } };
  $('#cf').onsubmit = async (e) => { e.preventDefault(); try { await api(`/api/posts/${id}/comments`, { json: Object.fromEntries(new FormData(e.target)) }); viewPost(id); } catch (x) { toast(x.message); } };
  $('#cms').querySelectorAll('[data-c]').forEach((a) => (a.onclick = async () => { await api(`/api/posts/${id}/comments/${a.dataset.c}`, { method: 'DELETE' }); viewPost(id); }));
}

/* ---------- 发布 / 编辑 ---------- */
function xhrSend(url, method, fd, onProg) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest(); x.open(method, url); x.responseType = 'json';
    x.upload.onprogress = (e) => e.lengthComputable && onProg(e.loaded / e.total);
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve(x.response) : reject(new Error((x.response && x.response.error) || '上传失败 ' + x.status)));
    x.onerror = () => reject(new Error('网络中断，请重试'));
    x.send(fd);
  });
}
async function viewCompose(id, qs) {
  if (!canWrite()) { location.hash = '#/'; return; }
  const post = id ? await api('/api/posts/' + id) : null;
  const type = post ? post.type : (qs.get('type') === 'diary' ? 'diary' : 'record');
  const myKid = S.me.kidId;
  const selKids = new Set(post ? post.kidIds : (type === 'record' && myKid ? [] : []));
  let files = []; const removed = new Set();
  const kidSel = `<div class="sel">${S.kids.map((k) => `<label><input type="checkbox" name="kid" value="${k.id}" ${selKids.has(k.id) ? 'checked' : ''}><span>${esc(k.emoji)} ${esc(k.name)}</span></label>`).join('')}</div>`;
  $('#view').innerHTML = `<form class="panel" id="cf"><div class="row sp"><h3 style="margin:0">${post ? '编辑' : '新' }${type === 'diary' ? '日记' : '记录'}</h3>
    ${post ? '' : `<a class="btn ghost sm" href="#/new${type === 'diary' ? '' : '?type=diary'}">${type === 'diary' ? '改写成长记录' : '改写日记'}</a>`}</div>
    <div class="field"><span>${type === 'diary' ? '关于谁（可不选）' : '是谁的记录（不选＝全家）'}</span>${kidSel}</div>
    <label class="field"><span>日期（这件事发生的那天）</span><input type="date" name="date" value="${post ? post.date : today()}" max="2100-01-01" required></label>
    <label class="field"><span>标题（可不写）</span><input type="text" name="title" maxlength="100" value="${esc(post ? post.title : '')}"></label>
    <label class="field"><span>${type === 'diary' ? '写下今天的心情…' : '发生了什么、她说了什么有趣的话…'}</span><textarea name="body" rows="8">${esc(post ? post.body : '')}</textarea></label>
    ${type === 'diary' ? `<label class="field"><span>谁能看</span><select name="visibility"><option value="private" ${post && post.visibility === 'family' ? '' : 'selected'}>🔒 只有我自己</option><option value="family" ${post && post.visibility === 'family' ? 'selected' : ''}>👨‍👩‍👧 家人都能看</option></select></label>` : ''}
    <div class="field"><span>照片和视频</span><div class="previews" id="pvs"></div>
      <input type="file" id="fi" accept="image/*,video/*" multiple hidden><button type="button" class="btn ghost sm" id="pick" style="margin-top:8px">＋ 选择照片 / 视频</button></div>
    <div class="bar" id="bar" hidden><i></i></div><p class="note" id="st"></p><p class="err" hidden></p>
    <div class="row sp"><a class="btn ghost" href="javascript:history.back()">取消</a><button class="btn" id="ok">${post ? '保存' : '发布'}</button></div></form>`;
  const pvs = $('#pvs');
  function drawPv() {
    const old = post ? post.media.filter((m) => !removed.has(m.id)).map((m) => `<div class="pv">${m.thumb || m.poster ? `<img src="${m.thumb || m.poster}" alt="">` : esc(m.name)}<button type="button" data-r="${m.id}">✕</button></div>`).join('') : '';
    pvs.innerHTML = old + files.map((f, i) => `<div class="pv">${f.type.startsWith('image/') && !/heic|heif/i.test(f.type) ? `<img src="${URL.createObjectURL(f)}" alt="">` : '🎬 ' + esc(f.name)}<button type="button" data-n="${i}">✕</button></div>`).join('');
    pvs.querySelectorAll('[data-r]').forEach((b) => (b.onclick = () => { removed.add(b.dataset.r); drawPv(); }));
    pvs.querySelectorAll('[data-n]').forEach((b) => (b.onclick = () => { files.splice(+b.dataset.n, 1); drawPv(); }));
  }
  drawPv();
  $('#pick').onclick = () => $('#fi').click();
  $('#fi').onchange = (e) => { files = files.concat([...e.target.files]); e.target.value = ''; drawPv(); };
  $('#cf').onsubmit = async (e) => {
    e.preventDefault(); const err = $('.err'); err.hidden = true;
    const v = Object.fromEntries(new FormData(e.target));
    const kidIds = [...e.target.querySelectorAll('[name=kid]:checked')].map((c) => c.value);
    if (!v.title.trim() && !v.body.trim() && !files.length && !(post && post.media.length - removed.size)) { err.textContent = '写点文字或选张照片吧'; err.hidden = false; return; }
    $('#ok').disabled = true; const bar = $('#bar'); bar.hidden = false;
    const prog = (r) => { $('i', bar).style.width = Math.round(r * 100) + '%'; $('#st').textContent = r < 1 ? `上传中 ${Math.round(r * 100)}%（别关页面）` : '处理中…'; };
    try {
      let res;
      if (!post) {
        const fd = new FormData(); fd.append('type', type);
        ['date', 'title', 'body', 'visibility'].forEach((k) => v[k] !== undefined && fd.append(k, v[k]));
        fd.append('kidIds', kidIds.join(',')); files.forEach((f) => fd.append('files', f));
        res = await xhrSend('/api/posts', 'POST', fd, prog);
      } else {
        res = await api('/api/posts/' + id, { method: 'PUT', json: { ...v, kidIds, removeMedia: [...removed] } });
        if (files.length) { const fd = new FormData(); files.forEach((f) => fd.append('files', f)); res = await xhrSend(`/api/posts/${id}/media`, 'POST', fd, prog); }
      }
      toast('已保存'); location.hash = '#/post/' + res.id;
    } catch (x) { err.textContent = x.message; err.hidden = false; $('#ok').disabled = false; bar.hidden = true; $('#st').textContent = ''; }
  };
}

/* ---------- 我的 / 管理 ---------- */
async function viewMe() {
  const admin = S.me.role === 'admin';
  let stats = null, users = [];
  if (admin) [stats, users] = await Promise.all([api('/api/stats'), api('/api/users')]);
  const exportBtns = [`<a class="btn ghost sm" href="/api/export">导出全部</a>`, ...S.kids.map((k) => `<a class="btn ghost sm" href="/api/export?kid=${k.id}">${esc(k.emoji)} ${esc(k.name)} 的成长册</a>`)].join(' ');
  $('#view').innerHTML = `
  <div class="panel"><h3>${esc(S.me.name)}</h3><p class="note">${ROLE_NAME[S.me.role]} · 用户名 ${esc(S.me.username)}</p>
    <div class="row"><button class="btn ghost sm" id="rn">改名字</button><button class="btn ghost sm" id="pw">改密码</button><button class="btn ghost sm" id="lo">退出登录</button></div></div>
  <div class="panel"><h3>📦 导出</h3><p class="note">打包成 zip：里面有原图原视频、每条记录的文字，用浏览器打开 index.html 就能离线翻看。长大后转给她们就用这个。</p><div class="row">${exportBtns}</div></div>
  ${admin ? `
  <div class="panel"><div class="row sp"><h3 style="margin:0">👧 孩子</h3><button class="btn sm" id="ak">添加</button></div>
    ${S.kids.map((k) => `<div class="item"><div>${esc(k.emoji)} <b>${esc(k.name)}</b><small>${k.birthday ? '生日 ' + k.birthday + ' · 现在 ' + ageText(k.birthday, today()) : '未填生日'}</small></div><div class="row"><button class="btn ghost sm" data-ek="${k.id}">编辑</button><button class="btn danger sm" data-dk="${k.id}">删除</button></div></div>`).join('') || '<p class="note">还没添加孩子</p>'}</div>
  <div class="panel"><div class="row sp"><h3 style="margin:0">👨‍👩‍👧 家人账号</h3><button class="btn sm" id="au">添加</button></div>
    ${users.map((u) => `<div class="item"><div><b>${esc(u.name)}</b><small>${esc(u.username)} · ${ROLE_NAME[u.role]}${u.kidId && kidOf(u.kidId) ? ' · ' + esc(kidOf(u.kidId).name) : ''}</small></div><div class="row"><button class="btn ghost sm" data-eu="${u.id}">编辑</button>${u.id !== S.me.id ? `<button class="btn danger sm" data-du="${u.id}">删除</button>` : ''}</div></div>`).join('')}
    <p class="note">孩子账号写的日记默认私密，管理员也看不到，除非她自己选择「家人都能看」。</p></div>
  <div class="panel"><h3>⚙️ 站点</h3><div class="row sp"><span>名称：${esc(S.title)}</span><button class="btn ghost sm" id="st">修改</button></div>
    <p class="note" style="margin-top:10px">已存 ${stats.posts} 条记录 · ${stats.images} 张照片 · ${stats.videos} 个视频 · 占用 ${sizeText(stats.bytes)}${stats.pending ? ' · ⏳ 视频处理中 ' + stats.pending : ''}</p></div>` : ''}`;
  const refresh = () => boot().then(viewMe);
  $('#rn').onclick = () => formDialog('改名字', [{ name: 'name', label: '名字', value: S.me.name }], async (v) => { await api('/api/me', { method: 'PUT', json: v }); await refresh(); });
  $('#pw').onclick = () => formDialog('改密码', [{ name: 'old', label: '旧密码', type: 'password' }, { name: 'pw', label: '新密码（至少 6 位）', type: 'password' }], async (v) => { await api('/api/me/password', { json: v }); toast('密码已修改'); });
  $('#lo').onclick = async () => { await api('/api/logout', { method: 'POST' }); S.me = null; location.hash = '#/login'; route(); };
  if (!admin) return;
  const kf = (k = {}) => [{ name: 'name', label: '名字', value: k.name }, { name: 'birthday', label: '生日（用来显示几岁几个月）', type: 'date', value: k.birthday }, { name: 'emoji', label: '头像表情（一个 emoji）', value: k.emoji || '🌸' }];
  $('#ak').onclick = () => formDialog('添加孩子', kf(), async (v) => { await api('/api/kids', { json: v }); await refresh(); });
  $('#view').querySelectorAll('[data-ek]').forEach((b) => (b.onclick = () => formDialog('编辑孩子', kf(kidOf(b.dataset.ek)), async (v) => { await api('/api/kids/' + b.dataset.ek, { method: 'PUT', json: v }); await refresh(); })));
  $('#view').querySelectorAll('[data-dk]').forEach((b) => (b.onclick = async () => { if (confirmBox('删除这个孩子？已有的记录会保留，只是不再标记是谁的。')) { await api('/api/kids/' + b.dataset.dk, { method: 'DELETE' }); await refresh(); } }));
  const kidOpts = [['', '（不关联）'], ...S.kids.map((k) => [k.id, k.name])];
  const roleOpts = Object.entries(ROLE_NAME);
  const uf = (u, isNew) => [{ name: 'name', label: '显示名字（如：奶奶）', value: u.name }, ...(isNew ? [{ name: 'username', label: '登录用户名' }] : []),
    { name: 'password', label: isNew ? '初始密码（至少 6 位）' : '重置密码（不改就留空）', type: 'password' },
    { name: 'role', label: '角色', type: 'select', options: roleOpts, value: u.role || 'member' }, { name: 'kidId', label: '这是哪个孩子的账号（仅「孩子」角色需要）', type: 'select', options: kidOpts, value: u.kidId || '' }];
  $('#au').onclick = () => formDialog('添加家人账号', uf({}, true), async (v) => { await api('/api/users', { json: v }); await refresh(); });
  $('#view').querySelectorAll('[data-eu]').forEach((b) => (b.onclick = () => formDialog('编辑账号', uf(users.find((u) => u.id === b.dataset.eu), false), async (v) => { await api('/api/users/' + b.dataset.eu, { method: 'PUT', json: v }); await refresh(); })));
  $('#view').querySelectorAll('[data-du]').forEach((b) => (b.onclick = async () => { if (confirmBox('删除这个账号？她发过的内容会保留。')) { await api('/api/users/' + b.dataset.du, { method: 'DELETE' }); await refresh(); } }));
  $('#st').onclick = () => formDialog('站点名称', [{ name: 'title', label: '名称', value: S.title }], async (v) => { await api('/api/settings', { method: 'PUT', json: v }); await refresh(); });
}

/* ---------- 路由 ---------- */
async function route() {
  const [path, q] = location.hash.slice(1).split('?'), qs = new URLSearchParams(q || '');
  const seg = path.split('/').filter(Boolean);
  window.scrollTo(0, 0);
  try {
    if (!S.me) { chrome(''); return viewLogin(S.needSetup); }
    if (seg[0] === 'login') { location.hash = '#/'; return; }
    const r = seg[0] || '';
    chrome(['diary', 'new', 'me'].includes(r) ? (r === 'new' ? 'add' : r) : (r === '' ? '' : 'x'));
    if (r === '') return await viewTimeline('home', qs);
    if (r === 'diary') return await viewTimeline('diary', qs);
    if (r === 'post') return await viewPost(seg[1]);
    if (r === 'new') return await viewCompose(null, qs);
    if (r === 'edit') return await viewCompose(seg[1], qs);
    if (r === 'me') return await viewMe();
    location.hash = '#/';
  } catch (e) { $('#view').innerHTML = `<div class="empty">${esc(e.message)}<br><br><a class="btn ghost" href="#/">回首页</a></div>`; }
}
async function boot() {
  const d = await api('/api/init');
  S.me = d.me; S.kids = d.kids; S.title = d.settings.title; S.needSetup = d.needSetup;
}
window.addEventListener('hashchange', route);
boot().then(route).catch((e) => ($('#view').innerHTML = `<div class="empty">无法连接服务器：${esc(e.message)}</div>`));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
