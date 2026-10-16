'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = { me: null, kids: [], title: '成长册' };
const ROLE_NAME = { admin: '管理员', member: '家人（可发布）', viewer: '家人（只读）', child: '孩子' };
const IN_APP = /GrowthAlbumApp/.test(navigator.userAgent); // Android 外壳
// 成长记录分类：[id, 图标, 名称, 颜色]
const CATS = [['daily', '🌤', '日常', '#7d9a94'], ['travel', '🧳', '旅行', '#3f93c0'], ['award', '🏅', '奖状荣誉', '#d99a22'], ['exam', '📝', '考试成绩', '#7a6fc4'], ['first', '🌱', '第一次', '#4fa872'], ['birthday', '🎂', '生日', '#e0607e'], ['school', '🎒', '学校', '#d6843f'], ['hobby', '🎨', '兴趣特长', '#a864c0'], ['festival', '🧧', '节日', '#d4504b']];
const catOf = (id) => CATS.find((c) => c[0] === id) || CATS[0];
const catTag = (p) => (p.type === 'record' && p.category && p.category !== 'daily' ? `<span class="tag cat" style="--c:${catOf(p.category)[3]}">${catOf(p.category)[1]} ${catOf(p.category)[2]}</span>` : '');
const ICON = {
  home: '<svg viewBox="0 0 24 24" class="ic"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/></svg>',
  gift: '<svg viewBox="0 0 24 24" class="ic"><rect x="3.5" y="8" width="17" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12"/><path d="M12 8c-2.5 0-4-1-4-2.5S10 3 12 8c2-5 4-4.5 4-2.5S14.500 8 12 8Z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" class="ic"><path d="M12 5v14M5 12h14"/></svg>',
  book: '<svg viewBox="0 0 24 24" class="ic"><path d="M4 5.5C4 4.700 4.700 4 5.500 4H11v16H5.500C4.700 20 4 19.300 4 18.500Z"/><path d="M20 5.500c0-.8-.7-1.500-1.500-1.500H13v16h5.500c.8 0 1.500-.7 1.500-1.500Z"/></svg>',
  me: '<svg viewBox="0 0 24 24" class="ic"><circle cx="12" cy="8.500" r="3.800"/><path d="M4.500 20c.8-4 3.700-6 7.500-6s6.700 2 7.500 6"/></svg>',
};
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
// 精准年龄：9岁2个月15天（不满月显示「出生第N天」）
function ageText(b, d) {
  if (!b) return '';
  const x = new Date(b + 'T00:00:00'), y = new Date(d + 'T00:00:00');
  if (y < x) return '出生前';
  let tm = (y.getFullYear() - x.getFullYear()) * 12 + y.getMonth() - x.getMonth();
  if (y.getDate() < x.getDate()) tm--;
  const anchor = new Date(x.getFullYear(), x.getMonth() + tm, Math.min(x.getDate(), new Date(x.getFullYear(), x.getMonth() + tm + 1, 0).getDate()));
  const D = Math.round((y - anchor) / 864e5), Y = Math.floor(tm / 12), M = tm % 12;
  if (tm <= 0) return D === 0 ? '出生当天' : `出生第${D}天`;
  return (Y ? Y + '岁' : '') + (M || (Y && D) ? M + '个月' : '') + (D ? D + '天' : '');
}
function ageYears(b, d) {
  const x = new Date(b + 'T00:00:00'), y = new Date(d + 'T00:00:00');
  let n = y.getFullYear() - x.getFullYear();
  if (y.getMonth() < x.getMonth() || (y.getMonth() === x.getMonth() && y.getDate() < x.getDate())) n--;
  return Math.max(0, n);
}
function addYears(b, n) {
  const [y, m, d] = b.split('-').map(Number), last = new Date(y + n, m, 0).getDate();
  return `${y + n}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
const daysUntil = (d) => Math.ceil((new Date(d + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 864e5);
const lsGet = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
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
/* 孩子的参考照片：给「识别是谁」对照用，每人最多 5 张 */
function refsDialog(kidId) {
  const d = document.createElement('dialog'); document.body.appendChild(d); d.showModal();
  d.addEventListener('close', () => d.remove());
  const reload = () => boot().then(viewMe);
  const draw = () => {
    const k = kidOf(kidId); if (!k) return d.close(); const refs = k.refs || [];
    d.innerHTML = `<div class="dlg"><h3>📷 ${esc(k.name)} 的参考照片</h3><p class="note">传 2~5 张清楚的正脸照（最好是不同年龄、没戴帽子口罩的）。点「识别是谁」时，AI 会拿这些小图对照着认；只有这里的小图和你选的照片会发给 AI。</p>
      <div class="previews">${refs.map((id) => `<div class="pv"><img src="/api/kids/${k.id}/refs/${id}" alt=""><button type="button" data-r="${id}">✕</button></div>`).join('')}</div>
      <input type="file" id="rf" accept="image/*" multiple hidden><p class="err" hidden></p>
      <div class="row sp"><button type="button" class="btn ghost" data-x>关闭</button><button type="button" class="btn" id="radd" ${refs.length >= 5 ? 'disabled' : ''}>＋ 添加照片（${refs.length}/5）</button></div></div>`;
    const err = $('.err', d), fail = (m) => { err.textContent = m; err.hidden = false; };
    $('[data-x]', d).onclick = () => d.close();
    $('#radd', d).onclick = () => $('#rf', d).click();
    $('#rf', d).onchange = async (e) => {
      const fs = [...e.target.files].slice(0, 5 - refs.length); if (!fs.length) return;
      $('#radd', d).disabled = true; $('#radd', d).textContent = '上传中…';
      try { const fd = new FormData(); fs.forEach((f) => fd.append('files', f)); const r = await xhrSend(`/api/kids/${k.id}/refs`, 'POST', fd, () => {}); await reload(); draw(); if (r.bad) fail(`有 ${r.bad} 张格式不支持，没传上`); }
      catch (x) { draw(); fail(x.message); }
    };
    d.querySelectorAll('[data-r]').forEach((b) => (b.onclick = async () => { try { await api(`/api/kids/${k.id}/refs/${b.dataset.r}`, { method: 'DELETE' }); await reload(); draw(); } catch (x) { fail(x.message); } }));
  };
  draw();
}
function formDialog(title, fields, onOk, okText = '保存', note = '') {
  const d = document.createElement('dialog');
  const fh = fields.map((f) => {
    const v = f.value ?? '';
    if (f.type === 'select') return `<label class="field"><span>${f.label}</span><select name="${f.name}">${f.options.map(([val, l]) => `<option value="${esc(val)}" ${val === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    if (f.type === 'textarea') return `<label class="field"><span>${f.label}</span><textarea name="${f.name}" rows="${f.rows || 3}" placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea></label>`;
    return `<label class="field"><span>${f.label}</span><input name="${f.name}" type="${f.type || 'text'}" ${f.inputmode ? `inputmode="${f.inputmode}"` : ''} value="${esc(v)}" placeholder="${esc(f.placeholder || '')}" autocomplete="off"></label>`;
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

/* AI 结果弹窗：生成 → 可直接改 → 采用。run(dialog) 返回 {title, body, note?, count?, ...} */
function aiResultDialog({ heading, controls = '', autoRun = true, runText = '重新生成', useText = '采用', run, onUse }) {
  const d = document.createElement('dialog');
  d.innerHTML = `<div class="dlg"><h3>✨ ${esc(heading)}</h3>${controls}<p class="note" id="ains"></p>
    <div id="airs" hidden><label class="field"><span>标题</span><input type="text" id="ait"></label><label class="field"><span>正文（可以直接改）</span><textarea id="aib" rows="12"></textarea></label></div>
    <p class="err" hidden></p><div class="row sp"><button type="button" class="btn ghost" data-x>关闭</button><span class="row"><button type="button" class="btn ghost" id="aigo">${autoRun ? runText : '生成'}</button><button type="button" class="btn" id="aiuse" hidden>${useText}</button></span></div></div>`;
  document.body.appendChild(d); d.showModal();
  const err = $('.err', d), note = $('#ains', d);
  d.addEventListener('close', () => d.remove());
  $('[data-x]', d).onclick = () => d.close();
  let busy = false;
  async function go() {
    if (busy) return; busy = true; err.hidden = true;
    $('#aigo', d).disabled = true; $('#aiuse', d).disabled = true; note.textContent = 'AI 正在写，通常要十几秒…';
    try {
      const r = await run(d); d._meta = r;
      $('#airs', d).hidden = false; $('#ait', d).value = r.title || ''; $('#aib', d).value = r.body || '';
      note.textContent = r.note ? '💬 ' + r.note : r.count ? `参考了 ${r.count} 条记录。AI 可能写错细节，保存前请通读一遍。` : 'AI 可能改错细节，采用前请看一眼。';
      $('#aiuse', d).hidden = false; $('#aigo', d).textContent = runText;
    } catch (e) { err.textContent = e.message; err.hidden = false; note.textContent = ''; }
    busy = false; $('#aigo', d).disabled = false; $('#aiuse', d).disabled = false;
  }
  $('#aigo', d).onclick = go;
  $('#aiuse', d).onclick = async () => {
    try { await onUse({ title: $('#ait', d).value.trim(), body: $('#aib', d).value.trim(), meta: d._meta }, d); d.close(); }
    catch (e) { err.textContent = e.message; err.hidden = false; }
  };
  if (autoRun) go();
  return d;
}
function openReview(defKid) {
  const now = new Date(), opts = [];
  const ym = (back) => { const x = new Date(now.getFullYear(), now.getMonth() - back, 1); return [`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`, `${x.getFullYear()}年${x.getMonth() + 1}月`]; };
  opts.push([ym(1)[0], `上个月（${ym(1)[1]}）`], [ym(0)[0], `本月（${ym(0)[1]}）`]);
  for (let i = 2; i < 12; i++) opts.push(ym(i));
  opts.push([String(now.getFullYear()), `今年（${now.getFullYear()}年）`], [String(now.getFullYear() - 1), `去年（${now.getFullYear() - 1}年）`]);
  const sel = (id, label, os, v) => `<label class="field"><span>${label}</span><select id="${id}">${os.map(([a, b]) => `<option value="${esc(a)}" ${a === v ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select></label>`;
  aiResultDialog({
    heading: '成长回顾', autoRun: false, useText: '保存为一条记录',
    controls: sel('rvk', '给谁写', [['', '全家一起'], ...S.kids.map((k) => [k.id, `${k.emoji} ${k.name}`])], defKid || '') + sel('rvp', '哪段时间', opts, opts[0][0]) +
      '<p class="note">只会用这段时间的「成长记录」，不会用到任何日记。</p>',
    run: (d) => api('/api/ai/review', { json: { kidId: $('#rvk', d).value, period: $('#rvp', d).value } }),
    onUse: async (r) => {
      const m = r.meta;
      const p = await api('/api/posts', { json: { type: 'record', date: m.date, title: r.title, body: r.body, kidIds: m.kidIds.join(','), ai: '1' } });
      toast('已保存'); location.hash = '#/post/' + p.id;
    },
  });
}

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
  const tabs = [['#/', ICON.home, '首页', ''], ['#/treasure', ICON.gift, '珍藏', 'treasure'], ['#/diary', ICON.book, '日记', 'diary']];
  if (canWrite()) tabs.splice(2, 0, ['#/new', ICON.plus, '', 'add']);
  tabs.push(['#/me', ICON.me, '我的', 'me']);
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
// 孩子筛选：全部 / 每个孩子 / 双宝日常（两个以上孩子同框）。base 是页面地址，extra 是要带上的其他参数
function kidChipsHtml(base, active, together, extra = '') {
  const href = (k) => base + (k || extra ? '?' + [k ? 'kid=' + k : '', extra].filter(Boolean).join('&') : '');
  const chip = (k, label) => `<a class="chip ${active === k ? 'on' : ''}" href="${href(k)}">${label}</a>`;
  return chip('', '全部') + S.kids.map((k) => chip(k.id, `${esc(k.emoji)} ${esc(k.name)}`)).join('') + (together && S.kids.length > 1 ? chip('together', '👭 双宝日常') : '');
}
function cardHtml(p, rail) {
  const vis = p.media.filter((m) => m.kind !== 'audio'), nAud = p.media.length - vis.length;
  const imgs = vis.slice(0, 4);
  const grid = imgs.length ? `<div class="grid n${imgs.length}">${imgs.map((m, i) => {
    const src = m.kind === 'video' ? m.poster : (m.thumb || m.url);
    return `<div class="cell">${src ? `<img loading="lazy" src="${src}" alt="">` : ''}${m.kind === 'video' ? '<div class="play">▶</div>' : ''}${i === 3 && vis.length > 4 ? `<div class="more">+${vis.length - 4}</div>` : ''}</div>`;
  }).join('')}</div>` : '';
  const card = `<a class="card" href="#/post/${p.id}"><div class="meta">${rail ? '' : `<span>${dateText(p.date)}</span>`}${kidTags(p)}${catTag(p)}${p.type === 'diary' ? `<span>📖 ${p.visibility === 'private' ? '私密日记' : '日记'}</span>` : ''}${p.type === 'capsule' ? '<span>✉️ 时间胶囊</span>' : ''}${p.ai ? '<span>✨ AI 整理</span>' : ''}</div>
  ${p.title ? `<h3>${esc(p.title)}</h3>` : ''}${p.body ? `<p class="excerpt">${esc(p.body)}</p>` : ''}${grid}
  <div class="foot"><span>${esc(p.authorName)}</span><span class="sp"></span><span>${p.liked ? '❤️' : '🤍'} ${p.likeCount || ''}</span><span>💬 ${p.comments.length || ''}</span>${nAud ? `<span>🎙 ${nAud}</span>` : ''}</div></a>`;
  if (!rail) return card;
  const wd = WD[new Date(p.date + 'T00:00:00').getDay()];
  return `<div class="tli"><div class="rail"><b>${+p.date.slice(8)}</b><small>周${wd}</small></div>${card}</div>`;
}
const greet = () => { const h = new Date().getHours(); return h < 6 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好'; };
function heroHtml() {
  const kids = S.kids.map((k) => `<div class="kp"><i style="background:${k.color}">${esc(k.emoji)}</i><b>${esc(k.name)}</b>${k.birthday ? `<small>${ageText(k.birthday, today())}</small>` : ''}</div>`).join('');
  return `<section class="hero"><div class="hi">${greet()}，${esc(S.me.name)}</div><div class="sub" id="tot">记录她们长大的每一天</div>${kids ? `<div class="kidsrow">${kids}</div>` : ''}</section>`;
}
// 筛选条：孩子 + 分类，两者可以叠加
function filterHref(kid, cat) { const a = [kid ? 'kid=' + kid : '', cat ? 'cat=' + cat : ''].filter(Boolean).join('&'); return '#/' + (a ? '?' + a : ''); }
function catChipsHtml(kid, cat) {
  return `<a class="chip ${cat ? '' : 'on'}" href="${filterHref(kid, '')}">全部分类</a>` + CATS.map(([id, ic, n]) => `<a class="chip ${cat === id ? 'on' : ''}" href="${filterHref(kid, id)}">${ic} ${n}</a>`).join('');
}
async function loadOnThisDay() {
  const box = $('#otd'); if (!box) return;
  let list = []; try { list = await api('/api/onthisday'); } catch { return; }
  if (!list.length || !$('#otd')) return;
  const by = new Map(); list.forEach((p) => { if (!by.has(p.ago)) by.set(p.ago, []); by.get(p.ago).push(p); });
  const offTxt = (o) => (o === 0 ? '当天' : o < 0 ? `前${-o}天` : `后${o}天`);
  box.innerHTML = [...by].map(([ago, ps], gi) => {
    const dates = [...new Set(ps.map((p) => p.date))].sort(), exact = ps.some((p) => p.off === 0);
    const head = `${ago} 年前的今天${exact ? '' : '前后'}（${dates.length === 1 ? dates[0] : dates[0] + ' ~ ' + dates[dates.length - 1]}）`;
    return `<div class="otd"><h3>${gi === 0 ? '📅 那年今日 <span class="sep">|</span> ' : ''}${head}</h3><div class="strip">${ps.map((p) => {
      const m = p.media.find((x) => x.kind === 'image' || (x.kind === 'video' && x.poster)), src = m ? (m.kind === 'video' ? m.poster : (m.thumb || m.url)) : '';
      const txt = p.title || (p.body || '').slice(0, 24) || '一段回忆';
      return `<a class="mem ${src ? '' : 'nopic'}" href="#/post/${p.id}">${src ? `<img loading="lazy" src="${src}" alt="">` : ''}<span class="yr">${offTxt(p.off)}</span><b>${esc(txt)}</b></a>`;
    }).join('')}</div></div>`;
  }).join('');
}
async function viewTimeline(mode, qs) {
  const filter = { kid: qs.get('kid') || '', q: qs.get('q') || '', cat: CATS.some((c) => c[0] === qs.get('cat')) ? qs.get('cat') : '' };
  const type = mode === 'diary' ? 'diary' : '';
  const plain = mode === 'home' && !filter.kid && !filter.cat;
  const chips = mode === 'diary' ? '' : `<div class="chips">${kidChipsHtml('#/', filter.kid, true, filter.cat ? 'cat=' + filter.cat : '')}${S.ai && ['admin', 'member'].includes(S.me.role) ? '<a class="chip ai" id="rv">✨ 成长回顾</a>' : ''}</div><div class="chips cats">${catChipsHtml(filter.kid, filter.cat)}</div>`;
  $('#view').innerHTML = `${mode === 'diary' ? '<h2 class="ptitle">📖 日记</h2>' : mode === 'home' ? heroHtml() + '<div id="otd"></div>' : ''}${chips}<div id="tl"></div><div id="more" class="empty" hidden><button class="btn ghost">加载更多</button></div>`;
  if (mode === 'home') loadOnThisDay();
  if ($('#rv')) $('#rv').onclick = () => openReview(filter.kid);
  let offset = 0, last = '', total = 0;
  const tl = $('#tl');
  async function load() {
    const u = `/api/posts?limit=15&offset=${offset}${type ? '&type=' + type : ''}${filter.kid ? '&kid=' + filter.kid : ''}${filter.cat ? '&cat=' + filter.cat : ''}${filter.q ? '&q=' + encodeURIComponent(filter.q) : ''}`;
    const d = await api(u); total = d.total;
    if (mode === 'home' && $('#tot') && total) $('#tot').textContent = plain ? `已经记下 ${total} 个瞬间` : `筛选出 ${total} 个瞬间`;
    let h = '';
    for (const p of d.items) { const m = monthText(p.date); if (m !== last) { last = m; h += `<div class="month"><span>${m}</span></div>`; } h += cardHtml(p, true); }
    tl.insertAdjacentHTML('beforeend', h); offset += d.items.length;
    $('#more').hidden = offset >= total || !d.items.length;
    if (!total) tl.innerHTML = `<div class="empty">${mode === 'diary' ? '还没有日记' : filter.cat ? `还没有「${catOf(filter.cat)[2]}」的记录` : '还没有记录'}${canWrite() ? (filter.cat ? `<br><br><a class="btn" href="#/new?cat=${filter.cat}">记一条${catOf(filter.cat)[2]}</a>` : '<br>点下面的 ＋ 写下第一条吧') : ''}</div>`;
  }
  $('#more button').onclick = () => load().catch((e) => toast(e.message));
  await load();
}

/* ---------- 详情 ---------- */
const typeLabel = (p) => (p.type === 'diary' ? `<span>📖 ${p.visibility === 'private' ? '私密日记' : '日记'}</span>` : p.type === 'capsule' ? `<span>✉️ 时间胶囊 · 封存于 ${p.date} · ${p.unlockDate} 开启</span>` : '');
function commentsHtml(p) {
  const ids = new Set(p.comments.map((c) => c.id));
  const top = p.comments.filter((c) => !c.parentId || !ids.has(c.parentId));
  const one = (c, re) => `<div class="cmt${re ? ' re' : ''}${c.whisper ? ' wh' : ''}"><b>${esc(c.name)}</b>${c.name !== c.account ? `<small>（${esc(c.account)}的账号）</small>` : ''}<small>${c.at.slice(0, 10)}</small>${c.whisper ? `<span class="lk">🔒 ${esc(c.whisper)}</span>` : ''}
    <span class="acts"><a data-re="${c.id}" data-n="${esc(c.name)}">回复</a>${c.mine || p.authorId === S.me.id || S.me.role === 'admin' ? `<a data-c="${c.id}">删除</a>` : ''}</span><br>${c.replyToName ? `<span class="to">回复 ${esc(c.replyToName)}：</span>` : ''}${esc(c.text)}</div>`;
  return top.map((c) => one(c, false) + p.comments.filter((r) => r.parentId === c.id).map((r) => one(r, true)).join('')).join('');
}
function viewLocked(p) {
  const ks = p.kidIds.map(kidOf).filter(Boolean).map((k) => k.name).join('、'), n = daysUntil(p.unlockDate);
  $('#view').innerHTML = `<div class="panel post"><div class="meta"><a href="javascript:history.back()">‹ 返回</a></div><div class="lockbox"><div class="big">🔒</div><h2>一封时间胶囊</h2>
    <p>${esc(p.authorName)} 写给${ks ? esc(ks) : '未来'}</p><p class="when">${p.unlockDate} 开启${p.unlockMode === 'age' && p.unlockAge ? `（满 ${p.unlockAge} 岁那天）` : ''}</p>
    <p class="note">${n > 0 ? `还有 ${n} 天。` : ''}到那一天之前，谁也看不到里面写了什么。</p>${p.canDelete ? '<button class="btn danger sm" id="del">删除这封信</button>' : ''}</div></div>`;
  if ($('#del')) $('#del').onclick = async () => { if (confirmBox('确定删除这封还没开启的信？删了就找不回来了。')) { await api('/api/posts/' + p.id, { method: 'DELETE' }); toast('已删除'); location.hash = '#/capsule'; } };
}
async function viewPost(id, keepY) {
  const [p, people] = await Promise.all([api('/api/posts/' + id), api('/api/people').catch(() => [])]);
  if (p.locked) return viewLocked(p);
  const imgs = p.media.filter((m) => m.kind === 'image');
  const media = p.media.map((m) => {
    if (m.kind === 'image') return `<figure><img loading="lazy" src="${m.view || m.url}" data-i="${imgs.indexOf(m)}" alt=""><figcaption><a href="${m.url}" download="${esc(m.name)}">下载原图 · ${sizeText(m.size)}</a></figcaption></figure>`;
    if (m.kind === 'audio') return `<figure class="aud"><audio controls preload="none" src="${m.web || m.url}"></audio><figcaption>🎙 ${esc(m.name)} · ${m.status === 'processing' ? '⏳ 正在转成通用格式，先播放原文件 · ' : ''}<a href="${m.url}" download="${esc(m.name)}">下载原音频 · ${sizeText(m.size)}</a></figcaption></figure>`;
    return `<figure><video controls playsinline preload="metadata" ${m.poster ? `poster="${m.poster}"` : ''} src="${m.web || m.url}"></video><figcaption>${m.status === 'processing' ? '⏳ 正在生成手机兼容版本，先播放原片 · ' : ''}<a href="${m.url}" download="${esc(m.name)}">下载原视频 · ${sizeText(m.size)}</a></figcaption></figure>`;
  }).join('');
  const bk = (p.kidIds.length ? p.kidIds.map(kidOf).filter((k) => k && k.birthday) : S.kids.filter((k) => k.birthday));
  const others = people.filter((u) => u.id !== S.me.id);
  $('#view').innerHTML = `<div class="panel post"><div class="meta"><a href="javascript:history.back()">‹ 返回</a><span>${dateText(p.date)}</span>${kidTags(p)}${catTag(p)}${typeLabel(p)}</div>
  ${p.title ? `<h2>${esc(p.title)}</h2>` : ''}<div class="note">${esc(p.authorName)} 记录于 ${p.createdAt.slice(0, 10)}${p.ai ? ' · ✨ AI 整理，内容请以家人记忆为准' : ''}</div>
  ${p.body ? `<div class="body">${esc(p.body)}</div>` : ''}<div class="media">${media}</div>
  <div class="row" style="margin-top:14px"><button class="btn ghost sm" id="like">${p.liked ? '❤️' : '🤍'} ${p.likeCount || '喜欢'}</button>
  ${p.canEdit ? `<a class="btn ghost sm" href="#/edit/${p.id}">编辑</a>` : ''}${p.canDelete ? '<button class="btn danger sm" id="del">删除</button>' : ''}</div></div>
  <div class="panel"><h3>💬 评论 ${p.comments.length || ''}</h3><div id="cms">${commentsHtml(p)}</div>
  <form id="cf" style="margin-top:10px"><div class="note" id="rb" hidden>回复 <b id="rn"></b> <a id="rx" style="cursor:pointer;text-decoration:underline">取消</a></div>
  <div class="row"><input type="text" name="text" maxlength="1000" placeholder="说点什么，送上祝福…" style="flex:1" required><button class="btn sm">发送</button></div>
  <details class="more"><summary>署名 / 悄悄话</summary>
    <label class="field"><span>署名（可不填。多人共用一个账号时写上「外公」「奶奶」，不填就用账号名字）</span><input type="text" name="nick" maxlength="20" value="${esc(lsGet('ga_nick'))}"></label>
    <label class="field" id="wf"><span>谁能看到这条</span><select name="wtype"><option value="">所有家人</option><option value="admin">🔒 仅管理员（爸爸妈妈的手记）</option>${others.length ? '<option value="user">🔒 只给某一个人</option>' : ''}${bk.length ? '<option value="future">🕰 留给孩子，满 18 岁后才能看</option>' : ''}</select></label>
    <label class="field" id="wu" hidden><span>给谁看</span><select name="wto">${others.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></label>
    <label class="field" id="wk" hidden><span>留给哪个孩子（TA 满 18 岁后才会在评论里看到）</span><select name="wkid">${bk.map((k) => `<option value="${k.id}">${esc(k.emoji)} ${esc(k.name)}（${addYears(k.birthday, 18)} 满 18 岁）</option>`).join('')}</select></label>
  </details></form></div>`;
  $('#view').querySelectorAll('.media img').forEach((i) => (i.onclick = () => openLB(imgs.map((m) => m.view || m.url), +i.dataset.i)));
  const again = () => viewPost(id).then(() => window.scrollTo(0, window.scrollY));
  $('#like').onclick = async () => { await api(`/api/posts/${id}/like`, { method: 'POST' }); viewPost(id); };
  if ($('#del')) $('#del').onclick = async () => { if (confirmBox('确定删除这条记录？照片和视频也会一起删除，不能恢复。')) { await api('/api/posts/' + id, { method: 'DELETE' }); toast('已删除'); history.length > 1 ? history.back() : (location.hash = '#/'); } };
  const f = $('#cf'); let parent = '';
  const syncW = () => { const t = f.elements.wtype.value; $('#wu').hidden = t !== 'user'; $('#wk').hidden = t !== 'future'; };
  f.elements.wtype.onchange = syncW;
  $('#cms').querySelectorAll('[data-re]').forEach((a) => (a.onclick = () => {
    parent = a.dataset.re; $('#rn').textContent = a.dataset.n; $('#rb').hidden = false; $('#wf').hidden = true; f.elements.wtype.value = ''; syncW();
    f.elements.text.focus(); f.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }));
  $('#rx').onclick = () => { parent = ''; $('#rb').hidden = true; $('#wf').hidden = false; };
  f.onsubmit = async (e) => {
    e.preventDefault(); const v = Object.fromEntries(new FormData(f)); const t = v.wtype;
    const whisper = parent ? undefined : t === 'admin' ? { type: 'admin' } : t === 'user' ? { type: 'user', to: v.wto } : t === 'future' ? { type: 'future', kidId: v.wkid } : undefined;
    lsSet('ga_nick', v.nick.trim());
    try { await api(`/api/posts/${id}/comments`, { json: { text: v.text, nick: v.nick, parentId: parent || undefined, whisper } }); again(); } catch (x) { toast(x.message); }
  };
  $('#cms').querySelectorAll('[data-c]').forEach((a) => (a.onclick = async () => { if (!confirmBox('删除这条评论？回复它的也会一起删除。')) return; await api(`/api/posts/${id}/comments/${a.dataset.c}`, { method: 'DELETE' }); again(); }));
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
const AUD_RE = /\.(mp3|m4a|aac|wav|ogg|oga|opus|amr|flac|weba|wma)$/i;
const isAudioFile = (f) => (f.type || '').startsWith('audio/') || AUD_RE.test(f.name);
/* ---------- 从文件里读出「这件事发生的那天」：照片拍摄时间 > 视频/m4a 录制时间 > 文件名里的日期 > 文件修改时间 ---------- */
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const okDay = (d) => d instanceof Date && !isNaN(d) && d.getFullYear() >= 1990 && d.getTime() < Date.now() + 864e5;
const IMG_RE = /\.(jpe?g|heic|heif|png|webp|avif|tiff?)$/i, MP4_RE = /\.(mp4|m4v|mov|3gp|m4a)$/i;
function tiffDate(dv, t, le) { // 从 TIFF/EXIF 里取 DateTimeOriginal → DateTimeDigitized → DateTime
  try {
    const u16 = (o) => dv.getUint16(o, le), u32 = (o) => dv.getUint32(o, le);
    const ifd = (off) => { const out = {}, p = t + off, n = u16(p); for (let k = 0; k < n && k < 200; k++) { const e = p + 2 + k * 12; out[u16(e)] = e; } return out; };
    const str = (e) => { const n = u32(e + 4), o = n > 4 ? t + u32(e + 8) : e + 8; let r = ''; for (let k = 0; k < n && k < 32 && dv.getUint8(o + k); k++) r += String.fromCharCode(dv.getUint8(o + k)); return r; };
    const main = ifd(u32(t + 4)), ex = main[0x8769] ? ifd(u32(main[0x8769] + 8)) : {};
    const s = (ex[0x9003] && str(ex[0x9003])) || (ex[0x9004] && str(ex[0x9004])) || (main[0x132] && str(main[0x132])) || '';
    const m = /^(\d{4}):(\d{2}):(\d{2})/.exec(s); if (!m || +m[2] < 1 || +m[2] > 12) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]); return okDay(d) ? d : null;
  } catch { return null; }
}
async function exifDay(f) { // JPEG 的 APP1 和 HEIC 里的 Exif 都以 "Exif\0\0" + TIFF 头开头，直接在文件开头扫
  const u = new Uint8Array(await f.slice(0, 524288).arrayBuffer()), dv = new DataView(u.buffer);
  for (let i = 0; i + 14 < u.length; i++) {
    if (u[i] !== 0x45 || u[i + 1] !== 0x78 || u[i + 2] !== 0x69 || u[i + 3] !== 0x66 || u[i + 4] || u[i + 5]) continue;
    const t = i + 6; if (!((u[t] === 0x49 && u[t + 1] === 0x49) || (u[t] === 0x4d && u[t + 1] === 0x4d))) continue;
    const d = tiffDate(dv, t, u[t] === 0x49); if (d) return d;
  }
  return null;
}
async function mp4Day(f) { // 顺着顶层 box 找 moov，取第一个子 box mvhd 里的创建时间（1904 年起的秒数，UTC）
  const fourcc = (v, o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  let pos = 0;
  for (let n = 0; n < 40 && pos + 16 <= f.size; n++) {
    const dv = new DataView(await f.slice(pos, pos + 16).arrayBuffer());
    let size = dv.getUint32(0), hdr = 8; const type = fourcc(dv, 4);
    if (size === 1) { size = Number(dv.getBigUint64(8)); hdr = 16; } else if (size === 0) size = f.size - pos;
    if (size < hdr) return null;
    if (type === 'moov') {
      const b = new DataView(await f.slice(pos + hdr, pos + hdr + 40).arrayBuffer());
      if (b.byteLength < 20 || fourcc(b, 4) !== 'mvhd') return null;
      const secs = b.getUint8(8) === 1 ? Number(b.getBigUint64(12)) : b.getUint32(12);
      if (!secs) return null; const d = new Date((secs - 2082844800) * 1000); return okDay(d) ? d : null;
    }
    pos += size;
  }
  return null;
}
function nameDay(n) { // IMG_20240501_093000.jpg / 2024-05-01 / 微信 mmexport1714500000000.jpg
  let m = /(?:^|\D)(1\d{12})(?!\d)/.exec(n); if (m) { const d = new Date(+m[1]); if (okDay(d)) return d; }
  m = /(?:^|\D)((?:19|20)\d{2})[-_.年]?(0[1-9]|1[0-2])[-_.月]?(0[1-9]|[12]\d|3[01])(?!\d)/.exec(n);
  if (m) { const d = new Date(+m[1], +m[2] - 1, +m[3]); if (okDay(d)) return d; }
  return null;
}
async function fileDay(f) { // → { day:'YYYY-MM-DD', src, strong }，结果缓存在 File 对象上
  if (f._day) return f._day;
  let d = null, src = '';
  try {
    if ((f.type || '').startsWith('image/') || IMG_RE.test(f.name)) { d = await exifDay(f); src = '拍摄时间'; }
    else if (MP4_RE.test(f.name)) { d = await mp4Day(f); src = '录制时间'; }
  } catch {}
  if (!d) { d = nameDay(f.name); src = '文件名里的日期'; }
  if (!d && f.lastModified) { const x = new Date(f.lastModified); if (okDay(x)) { d = x; src = '文件修改时间'; } }
  return (f._day = d ? { day: ymd(d), src, strong: src !== '文件修改时间' } : { day: '', src: '', strong: false });
}
// 识别用：把照片缩成 768px 的 JPEG 再发给服务器（省流量，也省 AI 的额度）
async function shrinkImage(f, max = 768) {
  const bmp = await createImageBitmap(f), s = Math.min(1, max / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); if (bmp.close) bmp.close();
  return new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('转换失败'))), 'image/jpeg', 0.8));
}
let activeRec = null; // 录音中的 MediaRecorder，离开页面时停掉，免得麦克风一直开着
window.addEventListener('hashchange', () => { if (activeRec) { try { activeRec.stop(); } catch {} } });
async function viewCompose(id, qs) {
  if (!canWrite()) { location.hash = '#/'; return; }
  const post = id ? await api('/api/posts/' + id) : null;
  const type = post ? post.type : (['diary', 'capsule'].includes(qs.get('type')) ? qs.get('type') : 'record');
  const cap = type === 'capsule', fresh = cap && !post;
  const selKids = new Set(post ? post.kidIds : []);
  let files = []; const removed = new Set();
  const kidSel = `<div class="sel">${S.kids.map((k) => `<label><input type="checkbox" name="kid" value="${k.id}" ${selKids.has(k.id) ? 'checked' : ''}><span>${esc(k.emoji)} ${esc(k.name)}</span></label>`).join('')}</div>`;
  const names = { record: '成长记录', diary: '日记', capsule: '写给未来的信' };
  const typeSw = post ? '' : `<div class="chips" style="padding:8px 0 0">${Object.entries(names).map(([t, n]) => `<a class="chip ${t === type ? 'on' : ''}" href="#/new${t === 'record' ? '' : '?type=' + t}">${n}</a>`).join('')}</div>`;
  const visOpts = type === 'diary' ? [['private', '🔒 只有我自己'], ['family', '👨‍👩‍👧 家人都能看']] : [['private', '🎁 只给收信的孩子（和我自己）'], ['family', '👨‍👩‍👧 开启后家人都能看']];
  $('#view').innerHTML = `<form class="panel" id="cf"><h3 style="margin:0">${post ? '编辑' : '新'}${names[type]}</h3>${typeSw}
    <div class="field"><span>${cap ? '写给谁（可多选；按「满几岁」解锁时以第一个为准）' : type === 'diary' ? '关于谁（可不选）' : '是谁的记录（不选＝全家；选两个＝双宝日常）'}</span>${kidSel}</div>
    ${type === 'record' ? `<div class="field"><span>分类</span><div class="sel">${CATS.map(([id, ic, n]) => `<label><input type="radio" name="category" value="${id}" ${(post ? post.category || 'daily' : CATS.some((c) => c[0] === qs.get('cat')) ? qs.get('cat') : 'daily') === id ? 'checked' : ''}><span>${ic} ${n}</span></label>`).join('')}</div></div>` : ''}
    ${cap ? '' : `<label class="field"><span>日期（这件事发生的那天）</span><input type="date" name="date" value="${post ? post.date : today()}" max="2100-01-01" required></label><p class="note" id="dn" hidden></p>`}
    ${fresh ? `<div class="field"><span>什么时候开启</span><div class="row"><select name="unlockMode" id="um"><option value="date">指定日期</option><option value="age">孩子满几岁那天</option></select><input type="date" name="unlockDate" id="ud" min="${addYears(today(), 0)}"><span id="ua" hidden><input type="text" inputmode="numeric" name="unlockAge" id="uai" placeholder="18" maxlength="2" style="width:64px"> 岁</span></div><p class="note" id="uh"></p></div>
      <p class="note">⚠️ 封存之后，连你自己也看不到内容，要等到开启那天。写好再封存吧。</p>` : ''}
    <label class="field"><span>标题（可不写）</span><input type="text" name="title" maxlength="100" value="${esc(post ? post.title : '')}"></label>
    <label class="field"><span>${cap ? '写给她的话…' : type === 'diary' ? '写下今天的心情…' : '发生了什么、她说了什么有趣的话…'}</span><textarea name="body" rows="8">${esc(post ? post.body : '')}</textarea>${S.ai && !cap ? `<button type="button" class="btn ghost sm" id="aipolish" style="margin-top:8px">${S.me.role === 'child' ? '✨ AI 帮我看看' : '✨ AI 帮我写'}</button>` : ''}</label>
    ${type !== 'record' ? `<label class="field"><span>${cap ? '开启后谁能看' : '谁能看'}</span><select name="visibility">${visOpts.map(([v, l]) => `<option value="${v}" ${(post ? post.visibility : 'private') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
    <div class="field"><span>照片、视频和语音</span><div class="previews" id="pvs"></div>
      <input type="file" id="fi" accept="image/*,video/*,audio/*,.m4a,.mp3,.aac,.wav,.amr,.opus,.weba" multiple hidden>
      <div class="row" style="margin-top:8px"><button type="button" class="btn ghost sm" id="pick">＋ 照片 / 视频 / 音频</button><button type="button" class="btn ghost sm" id="rec">🎙 录音</button>${S.who ? '<button type="button" class="btn ghost sm" id="who">🧑 识别是谁</button>' : ''}<span class="note" id="rt"></span></div></div>
    <div class="bar" id="bar" hidden><i></i></div><p class="note" id="st"></p><p class="err" hidden></p>
    <div class="row sp"><a class="btn ghost" href="javascript:history.back()">取消</a><button class="btn" id="ok">${post ? '保存' : cap ? '封存' : '发布'}</button></div></form>`;
  const pvs = $('#pvs');
  function drawPv() {
    if (!pvs.isConnected) return;
    const old = post ? post.media.filter((m) => !removed.has(m.id)).map((m) => `<div class="pv">${m.thumb || m.poster ? `<img src="${m.thumb || m.poster}" alt="">` : (m.kind === 'audio' ? '🎙 ' : '') + esc(m.name)}<button type="button" data-r="${m.id}">✕</button></div>`).join('') : '';
    pvs.innerHTML = old + files.map((f, i) => `<div class="pv">${f.type.startsWith('image/') && !/heic|heif/i.test(f.type) ? `<img src="${URL.createObjectURL(f)}" alt="">` : (isAudioFile(f) ? '🎙 ' : '🎬 ') + esc(f.name)}<button type="button" data-n="${i}">✕</button></div>`).join('');
    pvs.querySelectorAll('[data-r]').forEach((b) => (b.onclick = () => { removed.add(b.dataset.r); drawPv(); }));
    pvs.querySelectorAll('[data-n]').forEach((b) => (b.onclick = () => { files.splice(+b.dataset.n, 1); drawPv(); autoDate(); }));
  }
  drawPv();
  const form = $('#cf');
  if (fresh) {
    const hint = () => {
      const m = $('#um').value; $('#ud').hidden = m !== 'date'; $('#ua').hidden = m !== 'age';
      if (m === 'date') { $('#uh').textContent = $('#ud').value ? `${daysUntil($('#ud').value)} 天后开启` : ''; return; }
      const kid = kidOf(([...form.querySelectorAll('[name=kid]:checked')][0] || {}).value), n = Math.round(+$('#uai').value);
      $('#uh').textContent = !kid ? '先在上面选一个孩子' : !kid.birthday ? `${kid.name}还没填生日，没法按年龄算` : n >= 1 && n <= 60 ? `${kid.name}满 ${n} 岁是 ${addYears(kid.birthday, n)}（还有 ${daysUntil(addYears(kid.birthday, n))} 天）` : '填一个年龄，比如 18';
    };
    form.addEventListener('input', hint); form.addEventListener('change', hint); hint();
  }
  if ($('#aipolish')) {
    const child = S.me.role === 'child', btn = $('#aipolish'), label = btn.textContent; let undo = null;
    btn.onclick = () => {
      const f = $('#cf');
      if (undo) { f.elements.title.value = undo.title; f.elements.body.value = undo.body; undo = null; btn.textContent = label; return; }
      const src = { body: f.elements.body.value, title: f.elements.title.value, date: f.elements.date.value, kidIds: [...f.querySelectorAll('[name=kid]:checked')].map((c) => c.value) };
      if (src.body.trim().length < 4) return toast('先随手写几句，再让 AI 帮忙');
      aiResultDialog({
        heading: child ? 'AI 帮你看看' : 'AI 帮我写', useText: '替换原文',
        controls: child ? '' : '<label class="field"><span>风格</span><select id="aistyle"><option value="warm">温暖真诚</option><option value="funny">轻松幽默</option><option value="short">简洁有余味</option></select></label>',
        run: (d) => api('/api/ai/polish', { json: { ...src, style: $('#aistyle', d) ? $('#aistyle', d).value : '' } }),
        onUse: (r) => { undo = { title: f.elements.title.value, body: f.elements.body.value }; f.elements.body.value = r.body; if (r.title && !f.elements.title.value.trim()) f.elements.title.value = r.title; btn.textContent = '↩️ 还原原文'; },
      });
    };
  }
  $('#pick').onclick = () => $('#fi').click();
  $('#fi').onchange = (e) => { files = files.concat([...e.target.files]); e.target.value = ''; drawPv(); autoDate(); };
  // 新发布时：日期自动取文件自带的时间（多个文件取最早的一天）；自己手动改过日期就不再覆盖
  let dateTouched = false, adTok = 0; const dateEl = form.elements.date;
  if (dateEl) ['input', 'change'].forEach((ev) => dateEl.addEventListener(ev, () => { dateTouched = true; const n = $('#dn'); if (n) n.hidden = true; }));
  async function autoDate() {
    if (!dateEl || post || dateTouched || !files.length) return;
    const my = ++adTok, rs = (await Promise.all(files.map(fileDay))).filter((r) => r.day);
    if (my !== adTok || dateTouched || !rs.length) return;
    const use = rs.some((r) => r.strong) ? rs.filter((r) => r.strong) : rs, days = use.map((r) => r.day).sort(), first = days[0], last = days[days.length - 1];
    const src = use.find((r) => r.day === first).src; dateEl.value = first;
    const n = $('#dn'); if (!n) return; n.hidden = false;
    n.textContent = `已按${src}自动填成 ${first}` + (first !== last ? `（这些文件横跨 ${first} ~ ${last}，取了最早的一天）` : '') + (src === '文件修改时间' ? '。注意：这只是文件修改时间，从相册导入的文件常常是导入那天，请核对' : '，不对可以直接改');
  }
  if ($('#who')) $('#who').onclick = async () => {
    const imgs = files.filter((f) => (f.type || '').startsWith('image/'));
    if (!imgs.length) return toast('先选几张照片再识别');
    const pick = imgs.length <= 6 ? imgs : Array.from({ length: 6 }, (_, i) => imgs[Math.floor((i * imgs.length) / 6)]);
    const btn = $('#who'), old = btn.textContent; btn.disabled = true; btn.textContent = '识别中…';
    try {
      const fd = new FormData(); fd.append('date', dateEl ? dateEl.value : ''); let n = 0;
      for (const f of pick) { try { fd.append('images', await shrinkImage(f), `p${++n}.jpg`); } catch { n--; } }
      if (n <= 0) throw new Error('这些照片浏览器读不了（比如 HEIC），识别不了');
      const r = await xhrSend('/api/ai/who', 'POST', fd, () => {});
      const hit = (r.kidIds || []).map((id) => form.querySelector(`[name=kid][value="${id}"]`)).filter(Boolean);
      hit.forEach((c) => (c.checked = true));
      toast(hit.length ? `认出了：${hit.map((c) => kidOf(c.value).name).join('、')}，已帮你选上（不对请手动改）` : '没认出是谁，可能脸不清楚，请手动选');
    } catch (x) { toast(x.message); } finally { btn.disabled = false; btn.textContent = old; }
  };
  // 录音：直接在页面里录，存成一段语音（需要 HTTPS 访问才有麦克风权限）
  $('#rec').onclick = async () => {
    if (activeRec) { activeRec.stop(); return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) return toast('这个浏览器不能直接录音（需要 HTTPS），可以用手机录音机录好后选择文件');
    let st;
    try { st = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast('没能打开麦克风，请允许权限（需要 HTTPS 访问）'); }
    const rec = new MediaRecorder(st), chunks = [], t0 = Date.now();
    const tick = setInterval(() => { const n = $('#rt'); if (n) { const s = Math.floor((Date.now() - t0) / 1000); n.textContent = `● 录音中 ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; } }, 300);
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      clearInterval(tick); st.getTracks().forEach((t) => t.stop()); activeRec = null;
      const mt = rec.mimeType || 'audio/webm', ext = /mp4|aac/.test(mt) ? 'm4a' : /ogg/.test(mt) ? 'ogg' : 'weba', d = new Date();
      if (chunks.length) files.push(new File(chunks, `录音-${d.getMonth() + 1}月${d.getDate()}日${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.${ext}`, { type: mt }));
      if ($('#rec')) { $('#rec').textContent = '🎙 录音'; $('#rt').textContent = ''; drawPv(); }
    };
    rec.start(); activeRec = rec; $('#rec').textContent = '⏹ 停止并保存';
  };
  form.onsubmit = async (e) => {
    e.preventDefault(); const err = $('.err'); err.hidden = true;
    if (activeRec) { err.textContent = '还在录音，先点「停止并保存」'; err.hidden = false; return; }
    const v = Object.fromEntries(new FormData(e.target));
    const kidIds = [...e.target.querySelectorAll('[name=kid]:checked')].map((c) => c.value);
    if (!v.title.trim() && !v.body.trim() && !files.length && !(post && post.media.length - removed.size)) { err.textContent = '写点文字或选张照片吧'; err.hidden = false; return; }
    if (fresh && !confirmBox('封存后连你自己也看不到内容，直到开启那天。确定封存吗？')) return;
    $('#ok').disabled = true; const bar = $('#bar'); bar.hidden = false;
    const prog = (r) => { $('i', bar).style.width = Math.round(r * 100) + '%'; $('#st').textContent = r < 1 ? `上传中 ${Math.round(r * 100)}%（别关页面）` : '处理中…'; };
    try {
      let res;
      if (!post) {
        const fd = new FormData(); fd.append('type', type);
        ['date', 'title', 'body', 'visibility', 'category', 'unlockMode', 'unlockDate', 'unlockAge'].forEach((k) => v[k] !== undefined && fd.append(k, v[k]));
        fd.append('kidIds', kidIds.join(',')); files.forEach((f) => fd.append('files', f));
        res = await xhrSend('/api/posts', 'POST', fd, prog);
      } else {
        res = await api('/api/posts/' + id, { method: 'PUT', json: { ...v, kidIds, removeMedia: [...removed] } });
        if (files.length) { const fd = new FormData(); files.forEach((f) => fd.append('files', f)); res = await xhrSend(`/api/posts/${id}/media`, 'POST', fd, prog); }
      }
      toast(cap && !post ? '已封存 ✉️' : '已保存'); location.hash = cap && !post ? '#/capsule' : '#/post/' + res.id;
    } catch (x) { err.textContent = x.message; err.hidden = false; $('#ok').disabled = false; bar.hidden = true; $('#st').textContent = ''; }
  };
}

/* ---------- 珍藏：成长数据 / 声音档案 / 时间胶囊 / 生日问答 ---------- */
function viewTreasure() {
  const tiles = [['#/cats', '🗂', '分类相册', '旅行、奖状、考试、第一次……按类别翻看', 'wide'], ['#/growth', '📈', '成长数据', '身高、体重、鞋码的变化曲线'], ['#/voice', '🎙', '声音档案', '听听她们小时候的声音'], ['#/capsule', '✉️', '时间胶囊', '写给未来的信，到时间才能打开'], ['#/qa', '🎂', '生日问答', '每年生日问同样的问题，长大后对比']];
  $('#view').innerHTML = `<h2 class="ptitle">🎁 珍藏</h2><div class="tiles">${tiles.map(([h, i, t, d, w]) => `<a class="tile ${w || ''}" href="${h}"><b>${i}</b><span>${t}</span><small>${d}</small></a>`).join('')}</div>`;
}
/* 分类相册：每个分类一张封面，点进去就是该分类的时间线 */
async function viewCats() {
  const d = await api('/api/cats');
  $('#view').innerHTML = `<h2 class="ptitle">🗂 分类相册</h2><p class="note" style="margin:0 4px 12px">旅行、奖状、考试、第一次……发布记录时选一个分类，就会出现在这里。</p>
  <div class="catgrid">${CATS.map(([id, ic, n, c]) => { const o = d[id] || { count: 0, cover: '' }; return `<a class="catcard" href="#/?cat=${id}" style="--c:${c}">${o.cover ? `<img loading="lazy" src="${o.cover}" alt="">` : `<em>${ic}</em>`}<div class="cl"><b>${ic} ${n}</b><small>${o.count} 条</small></div></a>`; }).join('')}</div>`;
}

/* 成长数据：折线图用内联 SVG，不依赖任何外部库（离线也能看） */
const GMETRIC = { height: ['身高', 'cm'], weight: ['体重', 'kg'], shoe: ['鞋码', '码'] };
function niceTicks(lo, hi, n) {
  const span = hi - lo || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag, t = [];
  for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step + 1e-9; v += step) t.push(+v.toFixed(6));
  return t;
}
const Z = { p3: -1.8808, p15: -1.0364, p50: 0, p85: 1.0364, p97: 1.8808 };
const normCdf = (z) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
// 参考曲线：返回 { id, name, max(岁), at(年龄岁, 'p3'|'p15'|'p50'|'p85'|'p97'), pct(年龄岁, 数值), note }
function makeRef(src, metric) {
  if (src === 'who' && window.WHO_GIRLS && window.WHO_GIRLS[metric]) {
    const t = window.WHO_GIRLS[metric], n = t.M.length - 1;
    const val = (m, z) => { const L = t.L[m], M = t.M[m], S = t.S[m]; return L ? M * Math.pow(1 + L * S * z, 1 / L) : M * Math.exp(S * z); };
    const at = (a, k) => { const m = Math.min(Math.max(a * 12, 0), n), i = Math.floor(m), f = m - i; return i >= n ? val(n, Z[k]) : val(i, Z[k]) * (1 - f) + val(i + 1, Z[k]) * f; };
    return { id: 'who', name: 'WHO 女孩参考', max: n / 12, at, pct(a, y) {
      const mo = a * 12; if (mo < 0 || mo > n) return null;
      const i = Math.min(Math.floor(mo), n - 1), f = mo - i, g = (x) => x[i] * (1 - f) + x[i + 1] * f, L = g(t.L), M = g(t.M), S = g(t.S);
      return Math.round(normCdf(L ? (Math.pow(y / M, L) - 1) / (L * S) : Math.log(y / M) / S) * 100); },
      note: '灰色带是 WHO 女孩参考范围：深带 P3–P97（大多数孩子落在其中），浅带 P15–P85，虚线为中位数 P50。' + (metric === 'weight' ? 'WHO 体重参考只到 10 岁。' : '') };
  }
  if (src === 'cn' && window.CN_GIRLS && window.CN_GIRLS[metric]) {
    const t = window.CN_GIRLS[metric], n = t.m.length - 1, COL = { p3: 1, p15: 2, p50: 3, p85: 4, p97: 5 };
    const row = (a) => { const mo = Math.min(Math.max(a * 12, 0), t.m[n]); let i = 0; while (i < n - 1 && t.m[i + 1] <= mo) i++; const f = (mo - t.m[i]) / (t.m[i + 1] - t.m[i]); return t.v[i].map((x, j) => x * (1 - f) + t.v[i + 1][j] * f); };
    return { id: 'cn', name: '中国国标', max: t.m[n] / 12, at: (a, k) => row(a)[COL[k]], pct(a, y) {
      if (a * 12 > t.m[n] + 0.5) return null; const r = row(a); if (y <= r[0]) return Math.round(normCdf(-3) * 100); if (y >= r[6]) return Math.round(normCdf(3) * 100);
      let i = 0; while (i < 5 && y >= r[i + 1]) i++; return Math.round(normCdf(i - 3 + (y - r[i]) / (r[i + 1] - r[i])) * 100); },
      note: '灰色带是国家卫健委女孩标准：深带 −2SD～+2SD（约 P2～P98），浅带 ±1SD（约 P16～P84），虚线为中位数。' + (metric === 'height' ? '7 岁以下用 WS/T 423—2022，7～18 岁用 WS/T 612—2018（两个标准在 7 岁处会有一点小落差）。' : '体重标准只覆盖 7 岁以下，超过的孩子没有参考带。') };
  }
  return null;
}
function growthChart(series, unit, ref) {
  const W = 640, H = 300, L = 46, R = 16, T = 14, B = 36, useAge = series.every((s) => s.k.birthday), DAY = 864e5;
  const xv = (s, d) => (useAge ? (new Date(d + 'T00:00:00') - new Date(s.k.birthday + 'T00:00:00')) / (365.25 * DAY) : new Date(d + 'T00:00:00').getTime());
  const xs = series.flatMap((s) => s.pts.map((p) => xv(s, p.date))), ys = series.flatMap((s) => s.pts.map((p) => p.y));
  let x0 = Math.min(...xs), x1 = Math.max(...xs);
  if (x1 - x0 < (useAge ? 0.2 : 30 * DAY)) { const pad = useAge ? 0.5 : 30 * DAY; x0 -= pad; x1 += pad; }
  if (ref && useAge) { x0 = Math.max(0, x0 - 0.3); x1 += 0.3; }
  const bx1 = ref && useAge ? Math.min(x1, ref.max) : 0, band = ref && useAge && bx1 > x0 ? Array.from({ length: 41 }, (_, i) => x0 + ((bx1 - x0) * i) / 40) : null; // 参考带只画到参考表覆盖的年龄
  if (band) band.forEach((a) => { ys.push(ref.at(a, 'p3'), ref.at(a, 'p97')); });
  const yt = niceTicks(Math.min(...ys), Math.max(...ys), 5), y0 = yt[0], y1 = yt[yt.length - 1];
  const X = (v) => L + ((v - x0) / (x1 - x0)) * (W - L - R), Y = (v) => T + (1 - (v - y0) / (y1 - y0 || 1)) * (H - T - B);
  let xt = [];
  if (useAge) { const st = Math.max(1, Math.ceil((x1 - x0) / 7)); for (let a = Math.ceil(x0); a <= x1; a += st) xt.push([a, a + '岁']); }
  else for (let i = 0; i < 5; i++) { const t = x0 + ((x1 - x0) * i) / 4, d = new Date(t); xt.push([t, `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`]); }
  const grid = yt.map((v) => `<line class="gl" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`).join('') +
    xt.map(([v, l]) => `<text class="ax" x="${X(v)}" y="${H - 12}" text-anchor="middle">${l}</text>`).join('');
  const pl = (k) => band.map((a) => X(a).toFixed(1) + ',' + Y(ref.at(a, k)).toFixed(1));
  const ribbon = band ? `<polygon class="wb" points="${[...pl('p3'), ...pl('p97').reverse()].join(' ')}"/><polygon class="wb in" points="${[...pl('p15'), ...pl('p85').reverse()].join(' ')}"/><polyline class="wm" fill="none" points="${pl('p50').join(' ')}"/>` : '';
  const lines = series.map((s) => {
    const pts = s.pts.map((p) => [X(xv(s, p.date)), Y(p.y), p]).sort((a, b) => a[0] - b[0]);
    return `<polyline fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" points="${pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}"/>` +
      pts.map(([x, y, p]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${s.color}" stroke="var(--card)" stroke-width="1.5"><title>${esc(s.k.name)} ${p.date}${s.k.birthday ? '（' + ageText(s.k.birthday, p.date) + '）' : ''}：${p.y} ${unit}</title></circle>`).join('');
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="成长曲线">${grid}${ribbon}${lines}</svg>`;
}
async function viewGrowth(qs) {
  const kid = qs.get('kid') || '', metric = GMETRIC[qs.get('m')] ? qs.get('m') : 'height';
  if (!S.kids.length) { $('#view').innerHTML = '<div class="empty">还没有添加孩子</div>'; return; }
  const all = await api('/api/growth'), sel = kid ? S.kids.filter((k) => k.id === kid) : S.kids;
  const link = (k, m) => `#/growth?${[k ? 'kid=' + k : '', 'm=' + m].filter(Boolean).join('&')}`;
  const series = sel.map((k) => ({ k, color: k.color, pts: all.filter((g) => g.kidId === k.id && g[metric] != null).map((g) => ({ date: g.date, y: g[metric] })) })).filter((s) => s.pts.length);
  const rows = all.filter((g) => sel.some((k) => k.id === g.kidId)).reverse();
  const [mn, unit] = GMETRIC[metric];
  const allBirth = series.length > 0 && series.every((s) => s.k.birthday), refSrc = qs.get('ref') || 'who';
  const ref = allBirth ? makeRef(refSrc, metric) : null, ageOf = (k, d) => (new Date(d + 'T00:00:00') - new Date(k.birthday + 'T00:00:00')) / (365.25 * 864e5);
  const inRange = !!ref && series.some((s) => s.pts.some((p) => ageOf(s.k, p.date) <= ref.max + 0.05));
  const pctNote = ref ? series.map((s) => { const last = s.pts.slice().sort((a, b) => (a.date < b.date ? -1 : 1)).pop(), pc = ref.pct(ageOf(s.k, last.date), last.y); return pc == null ? '' : `${esc(s.k.name)}最近一次约第 ${Math.min(Math.max(pc, 1), 99)} 百分位`; }).filter(Boolean).join('；') : '';
  const refLink = (r) => link(kid, metric) + '&ref=' + r;
  const refChips = allBirth && window.WHO_GIRLS && window.WHO_GIRLS[metric] ? `<div class="chips"><span class="note" style="align-self:center;white-space:nowrap">对照</span>${[['who', 'WHO 女孩'], ['cn', '中国国标'], ['0', '不对照']].map(([r, n]) => `<a class="chip ${refSrc === r || (!['who', 'cn'].includes(refSrc) && r === '0') ? 'on' : ''}" href="${refLink(r)}">${n}</a>`).join('')}</div>` : '';
  $('#view').innerHTML = `<div class="row sp" style="margin:6px 4px 8px"><h2 style="margin:0">📈 成长数据</h2>${canWrite() ? '<button class="btn sm" id="ga">＋ 记一次</button>' : ''}</div>
  <div class="chips">${kidChipsHtml('#/growth', kid, false, 'm=' + metric)}</div>
  <div class="chips">${Object.entries(GMETRIC).map(([m, [n]]) => `<a class="chip ${m === metric ? 'on' : ''}" href="${link(kid, m)}">${n}</a>`).join('')}</div>
  ${refChips}
  <div class="panel">${series.length ? `${growthChart(series, unit, ref)}<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.k.name)}</span>`).join('')}<span class="note">${mn}（${unit}）· 横轴${allBirth ? '是年龄' : '是日期'}</span></div>${ref ? (inRange ? `<p class="note" style="margin:8px 0 0">${ref.note}${pctNote ? pctNote + '。' : ''}曲线走势比单个点的高低更重要，只要沿着自己的百分位带稳定增长就是正常的；有疑虑请咨询儿科医生。</p>` : `<p class="note" style="margin:8px 0 0">选中的孩子已超出「${ref.name}」的年龄范围，没有参考带。</p>`) : (series.length && !allBirth ? '<p class="note" style="margin:8px 0 0">给孩子填了生日后才能对照参考曲线。</p>' : '')}` : `<div class="empty" style="padding:30px 10px">还没有${mn}的记录${canWrite() ? '<br>点右上角「＋ 记一次」' : ''}</div>`}</div>
  <div class="panel"><h3>记录表</h3>${rows.length ? `<div class="tw"><table class="gt"><thead><tr><th>日期</th>${sel.length > 1 ? '<th>谁</th>' : ''}<th>年龄</th><th>身高 cm</th><th>体重 kg</th><th>鞋码</th><th>备注</th><th></th></tr></thead><tbody>${rows.map((g) => { const k = kidOf(g.kidId) || {}; return `<tr><td>${g.date}</td>${sel.length > 1 ? `<td>${esc(k.emoji || '')} ${esc(k.name || '')}</td>` : ''}<td>${k.birthday ? ageText(k.birthday, g.date) : ''}</td><td>${g.height ?? ''}</td><td>${g.weight ?? ''}</td><td>${g.shoe ?? ''}</td><td>${esc(g.note)}</td><td>${g.canEdit ? `<a data-e="${g.id}" class="lnk">改</a> <a data-d="${g.id}" class="lnk">删</a>` : ''}</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="note">暂无记录</p>'}</div>`;
  const fields = (g = {}) => [
    { name: 'kidId', label: '谁', type: 'select', options: S.kids.map((k) => [k.id, `${k.emoji} ${k.name}`]), value: g.kidId || kid || S.kids[0].id },
    { name: 'date', label: '量的那天', type: 'date', value: g.date || today() },
    { name: 'height', label: '身高（厘米，没量就留空）', inputmode: 'decimal', value: g.height ?? '' },
    { name: 'weight', label: '体重（公斤）', inputmode: 'decimal', value: g.weight ?? '' },
    { name: 'shoe', label: '鞋码', inputmode: 'decimal', value: g.shoe ?? '' },
    { name: 'note', label: '备注（可不写）', value: g.note || '' }];
  const refresh = () => viewGrowth(qs);
  if ($('#ga')) $('#ga').onclick = () => formDialog('记录成长数据', fields(), async (v) => { await api('/api/growth', { json: v }); await refresh(); });
  $('#view').querySelectorAll('[data-e]').forEach((a) => (a.onclick = () => formDialog('修改记录', fields(all.find((g) => g.id === a.dataset.e)), async (v) => { await api('/api/growth/' + a.dataset.e, { method: 'PUT', json: v }); await refresh(); })));
  $('#view').querySelectorAll('[data-d]').forEach((a) => (a.onclick = async () => { if (confirmBox('删除这条记录？')) { await api('/api/growth/' + a.dataset.d, { method: 'DELETE' }); await refresh(); } }));
}

/* 声音档案 */
async function viewVoice(qs) {
  const kid = qs.get('kid') || '', list = await api('/api/voices' + (kid ? '?kid=' + kid : ''));
  $('#view').innerHTML = `<h2 style="margin:6px 4px 8px">🎙 声音档案</h2><div class="chips">${kidChipsHtml('#/voice', kid, true)}</div>
  ${list.length ? list.map((v) => `<div class="panel"><div class="meta"><span>${dateText(v.date)}</span>${kidTags(v)}<span>${esc(v.authorName)}</span></div>${v.title ? `<h3 style="margin-top:6px">${esc(v.title)}</h3>` : ''}
    ${v.media.map((m) => `<audio controls preload="none" src="${m.web || m.url}" style="width:100%;margin-top:8px"></audio><div class="note">🎙 ${esc(m.name)}${m.status === 'processing' ? ' · ⏳ 转码中' : ''}</div>`).join('')}<a class="note" href="#/post/${v.postId}" style="text-decoration:underline">查看这条记录 ›</a></div>`).join('')
    : `<div class="empty">还没有语音<br>发布记录时点「🎙 录音」，或选择手机里的录音文件${canWrite() ? '<br><br><a class="btn" href="#/new">去记录</a>' : ''}</div>`}`;
}

/* 时间胶囊 */
async function viewCapsule() {
  const list = await api('/api/capsules'), locked = list.filter((c) => c.locked), open = list.filter((c) => !c.locked).reverse();
  $('#view').innerHTML = `<div class="row sp" style="margin:6px 4px 8px"><h2 style="margin:0">✉️ 时间胶囊</h2>${canWrite() ? '<a class="btn sm" href="#/new?type=capsule">写一封信</a>' : ''}</div>
  <p class="note" style="margin:0 4px 12px">写给未来的信。封存后，要等到设定的日期（或孩子满某个岁数的那天）才能打开，之前谁也看不到内容。</p>
  ${locked.length ? '<div class="month"><span>等待开启</span></div>' + locked.map((c) => { const ks = c.kidIds.map(kidOf).filter(Boolean).map((k) => k.name).join('、'), n = daysUntil(c.unlockDate); return `<a class="card lockcard" href="#/post/${c.id}"><b>🔒</b><div><div>${esc(c.authorName)} 写给${ks ? esc(ks) : '未来'}</div><small>${c.unlockDate} 开启${c.unlockMode === 'age' && c.unlockAge ? `（满 ${c.unlockAge} 岁）` : ''} · 还有 ${n} 天</small></div></a>`; }).join('') : ''}
  ${open.length ? '<div class="month"><span>已经开启</span></div>' + open.map(cardHtml).join('') : ''}
  ${list.length ? '' : '<div class="empty">还没有时间胶囊</div>'}`;
}

/* 生日问答 */
async function viewQa(qs) {
  if (!S.kids.length) { $('#view').innerHTML = '<div class="empty">还没有添加孩子</div>'; return; }
  const kidId = kidOf(qs.get('kid')) ? qs.get('kid') : S.kids[0].id, k = kidOf(kidId), d = await api('/api/qa');
  const recs = d.records.filter((r) => r.kidId === kidId).sort((a, b) => a.age - b.age);
  const qsAll = [...d.questions]; recs.forEach((r) => r.answers.forEach((x) => { if (!qsAll.includes(x.q)) qsAll.push(x.q); }));
  const nextAge = k.birthday ? ageYears(k.birthday, today()) : recs.length ? recs[recs.length - 1].age + 1 : 1;
  $('#view').innerHTML = `<div class="row sp" style="margin:6px 4px 8px"><h2 style="margin:0">🎂 生日问答</h2><span class="row">${S.me.role === 'admin' ? '<button class="btn ghost sm" id="eq">编辑问题</button>' : ''}${canWrite() ? `<button class="btn sm" id="aq">＋ 记 ${nextAge} 岁</button>` : ''}</span></div>
  <div class="chips">${S.kids.map((x) => `<a class="chip ${x.id === kidId ? 'on' : ''}" href="#/qa?kid=${x.id}">${esc(x.emoji)} ${esc(x.name)}</a>`).join('')}</div>
  ${recs.length ? `<p class="note" style="margin:0 4px 10px">每个问题把 ${esc(k.name)} 历年的回答放在一起，长大后回头看很有意思。</p>
  ${qsAll.map((q) => { const rs = recs.map((r) => [r.age, (r.answers.find((x) => x.q === q) || {}).a]).filter((x) => x[1]); return rs.length ? `<div class="panel"><h3>${esc(q)}</h3>${rs.map(([a, t]) => `<div class="qa"><span class="age" style="background:${k.color}">${a}岁</span><span>${esc(t)}</span></div>`).join('')}</div>` : ''; }).join('')}
  <div class="panel"><h3>已记录的年份</h3><div class="row">${recs.map((r) => `<span class="item" style="border:0;padding:0"><span>${r.age} 岁 · ${r.date}</span><a class="lnk" data-e="${r.id}">看/改</a><a class="lnk" data-d="${r.id}">删</a></span>`).join('')}</div></div>`
  : `<div class="empty">${esc(k.name)}还没有生日问答${canWrite() ? '<br>每年生日问同样的问题，下次再来对比' : ''}</div>`}`;
  const refresh = () => viewQa(qs);
  const edit = (r) => {
    const cur = (q) => ((r && r.answers.find((x) => x.q === q)) || {}).a || '';
    formDialog(r ? `${k.name} ${r.age} 岁的回答` : `${k.name} 的生日问答`, [{ name: 'age', label: '几岁生日', inputmode: 'numeric', value: r ? r.age : nextAge }, { name: 'date', label: '记录的日期', type: 'date', value: r ? r.date : today() },
      ...qsAll.map((q, i) => ({ name: 'q' + i, label: q, type: 'textarea', rows: 2, value: cur(q) }))],
    async (v) => { await api('/api/qa', { json: { kidId, age: v.age, date: v.date, answers: qsAll.map((q, i) => ({ q, a: v['q' + i] })) } }); await refresh(); }, '保存', '没想好的问题可以留空。');
  };
  if ($('#aq')) $('#aq').onclick = () => edit(recs.find((r) => r.age === nextAge) || null);
  $('#view').querySelectorAll('[data-e]').forEach((a) => (a.onclick = () => edit(recs.find((r) => r.id === a.dataset.e))));
  $('#view').querySelectorAll('[data-d]').forEach((a) => (a.onclick = async () => { if (confirmBox('删除这一年的问答？')) { await api('/api/qa/' + a.dataset.d, { method: 'DELETE' }); await refresh(); } }));
  if ($('#eq')) $('#eq').onclick = () => formDialog('编辑问题', [{ name: 'qs', label: '每行一个问题', type: 'textarea', rows: 10, value: d.questions.join('\n') }],
    async (v) => { await api('/api/qa/questions', { method: 'PUT', json: { questions: v.qs.split('\n') } }); await refresh(); }, '保存', '改问题文字不影响以前的回答（按问题原文对应，旧问题的回答仍会保留显示）。');
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
  <div class="panel"><h3>🎬 回顾视频（MP4）</h3><p class="note">把成长记录里的照片做成带日期和年龄字幕的 1080p 视频，生日聚会时拷到 U 盘、投屏或在大屏上直接播放。可选孩子和时间范围；只用照片（每条记录最多 2 张），不含日记和时间胶囊。生成要几分钟，期间可以先去做别的。做好的视频暂存在服务器上约 6 小时，用完可以点「🗑 删除」释放空间。</p><div class="row"><button class="btn ghost sm" id="mv">生成视频</button></div><div id="mvl"></div></div>
  ${IN_APP ? '<div class="panel"><h3>📱 手机 App</h3><p class="note">当前连接的是这台服务器。想换成别的地址：</p><button class="btn ghost sm" id="sw">切换服务器</button></div>' : ''}
  ${admin ? `
  <div class="panel"><div class="row sp"><h3 style="margin:0">👧 孩子</h3><button class="btn sm" id="ak">添加</button></div>
    ${S.kids.map((k) => `<div class="item"><div>${esc(k.emoji)} <b>${esc(k.name)}</b><small>${k.birthday ? '生日 ' + k.birthday + ' · 现在 ' + ageText(k.birthday, today()) : '未填生日'}</small></div><div class="row"><button class="btn ghost sm" data-rk="${k.id}">📷 参考照 ${(k.refs || []).length}</button><button class="btn ghost sm" data-ek="${k.id}">编辑</button><button class="btn danger sm" data-dk="${k.id}">删除</button></div></div>`).join('') || '<p class="note">还没添加孩子</p>'}</div>
  <div class="panel"><div class="row sp"><h3 style="margin:0">👨‍👩‍👧 家人账号</h3><button class="btn sm" id="au">添加</button></div>
    ${users.map((u) => `<div class="item"><div><b>${esc(u.name)}</b><small>${esc(u.username)} · ${ROLE_NAME[u.role]}${u.kidId && kidOf(u.kidId) ? ' · ' + esc(kidOf(u.kidId).name) : ''}</small></div><div class="row"><button class="btn ghost sm" data-eu="${u.id}">编辑</button>${u.id !== S.me.id ? `<button class="btn danger sm" data-du="${u.id}">删除</button>` : ''}</div></div>`).join('')}
    <p class="note">孩子账号写的日记默认私密，管理员也看不到，除非她自己选择「家人都能看」。</p></div>
  <div class="panel"><div class="row sp"><h3 style="margin:0">✨ AI 助手</h3><button class="btn ghost sm" id="aic">设置</button></div>
    <p class="note" style="margin-top:8px">${S.ai ? '已启用：发布页有「AI 帮我写」「识别是谁」（需先给孩子传参考照），时间线有「成长回顾」。' : '未启用。填入 OpenAI 兼容的接口地址（API 中转站，或 Hermes Agent 的 API Server）即可。'}<br>成长回顾只用「成长记录」，不会用到任何日记；「帮我写」只发送你主动点击时输入框里的文字。</p></div>
  <div class="panel"><h3>⚙️ 站点</h3><div class="row sp"><span>名称：${esc(S.title)}</span><button class="btn ghost sm" id="st">修改</button></div>
    <p class="note" style="margin-top:10px">已存 ${stats.posts} 条记录 · ${stats.images} 张照片 · ${stats.videos} 个视频 · 占用 ${sizeText(stats.bytes)}${stats.pending ? ' · ⏳ 视频处理中 ' + stats.pending : ''}</p></div>` : ''}`;
  const refresh = () => boot().then(viewMe);
  const mvTime = (t) => { const d = new Date(t), z = (n) => String(n).padStart(2, '0'); return `${d.getMonth() + 1}月${d.getDate()}日 ${z(d.getHours())}:${z(d.getMinutes())}`; };
  const mvPlay = (id) => {
    const d = document.createElement('dialog'); d.style.width = 'min(780px,94vw)';
    d.innerHTML = `<div style="padding:12px"><video controls autoplay playsinline src="/api/movie/${id}/file?inline=1" style="width:100%;max-height:72vh;background:#000;border-radius:14px"></video><div class="row sp" style="margin-top:10px"><span class="note">点视频右下角全屏，或用手机/电脑投屏，就能在大屏上播放</span><button class="btn ghost sm" data-x>关闭</button></div></div>`;
    document.body.appendChild(d); d.showModal(); $('[data-x]', d).onclick = () => d.close(); d.addEventListener('close', () => d.remove());
  };
  const mvList = async () => {
    clearTimeout(mvList.t); if (!$('#mvl')) return;
    let list; try { list = await api('/api/movie'); } catch { return; }
    const el = $('#mvl'); if (!el) return;
    el.innerHTML = list.map((j) => `<div class="item" style="margin-top:8px"><div><b>${esc(j.name)}</b><small>${mvTime(j.at)} · ${j.state === 'running' ? `⏳ 生成中 ${j.done} / ${j.total}……` : j.state === 'done' ? '✅ ' + sizeText(j.size) : '⚠️ ' + esc(j.error || '生成失败')}</small></div><div class="row">${j.state === 'done' ? `<a class="lnk" data-play="${j.id}">▶ 播放</a><a class="lnk" href="/api/movie/${j.id}/file" download>⬇ 下载</a>` : ''}${j.state !== 'running' ? `<a class="lnk" data-del="${j.id}">🗑 删除</a>` : ''}</div></div>`).join('');
    el.querySelectorAll('[data-play]').forEach((a) => (a.onclick = () => mvPlay(a.dataset.play)));
    el.querySelectorAll('[data-del]').forEach((a) => (a.onclick = async () => { if (!confirmBox('删除这个视频文件？')) return; try { await api('/api/movie/' + a.dataset.del, { method: 'DELETE' }); } catch (e) { toast(e.message); } mvList(); }));
    if (list.some((j) => j.state === 'running')) mvList.t = setTimeout(mvList, 2000);
  };
  $('#mv').onclick = () => formDialog('生成回顾视频', [
    { name: 'kid', label: '谁的', type: 'select', options: [['', '全部孩子'], ...S.kids.map((k) => [k.id, `${k.emoji} ${k.name}`])], value: '' },
    { name: 'since', label: '从（可留空）', type: 'date', value: '' },
    { name: 'until', label: '到（可留空）', type: 'date', value: '' },
    { name: 'secs', label: '每张停留', type: 'select', options: [['3', '3 秒'], ['4', '4 秒'], ['5', '5 秒'], ['6', '6 秒'], ['8', '8 秒']], value: '4' }],
  async (v) => { const r = await api('/api/movie', { json: v }); toast(`开始生成，共 ${r.total} 张照片`); mvList(); }, '开始生成', '最多取 120 张，超出会均匀抽样。');
  mvList();
  $('#rn').onclick = () => formDialog('改名字', [{ name: 'name', label: '名字', value: S.me.name }], async (v) => { await api('/api/me', { method: 'PUT', json: v }); await refresh(); });
  $('#pw').onclick = () => formDialog('改密码', [{ name: 'old', label: '旧密码', type: 'password' }, { name: 'pw', label: '新密码（至少 6 位）', type: 'password' }], async (v) => { await api('/api/me/password', { json: v }); toast('密码已修改'); });
  if ($('#sw')) $('#sw').onclick = () => { location.href = 'https://localhost/index.html?reset=1'; };
  $('#lo').onclick = async () => { await api('/api/logout', { method: 'POST' }); S.me = null; location.hash = '#/login'; route(); };
  if (!admin) return;
  const kf = (k = {}) => [{ name: 'name', label: '名字', value: k.name }, { name: 'birthday', label: '生日（用来显示几岁几个月）', type: 'date', value: k.birthday }, { name: 'emoji', label: '头像表情（一个 emoji）', value: k.emoji || '🌸' }];
  $('#ak').onclick = () => formDialog('添加孩子', kf(), async (v) => { await api('/api/kids', { json: v }); await refresh(); });
  $('#view').querySelectorAll('[data-ek]').forEach((b) => (b.onclick = () => formDialog('编辑孩子', kf(kidOf(b.dataset.ek)), async (v) => { await api('/api/kids/' + b.dataset.ek, { method: 'PUT', json: v }); await refresh(); })));
  $('#view').querySelectorAll('[data-rk]').forEach((b) => (b.onclick = () => refsDialog(b.dataset.rk)));
  $('#view').querySelectorAll('[data-dk]').forEach((b) => (b.onclick = async () => { if (confirmBox('删除这个孩子？已有的记录会保留，只是不再标记是谁的。')) { await api('/api/kids/' + b.dataset.dk, { method: 'DELETE' }); await refresh(); } }));
  const kidOpts = [['', '（不关联）'], ...S.kids.map((k) => [k.id, k.name])];
  const roleOpts = Object.entries(ROLE_NAME);
  const uf = (u, isNew) => [{ name: 'name', label: '显示名字（如：奶奶）', value: u.name }, ...(isNew ? [{ name: 'username', label: '登录用户名' }] : []),
    { name: 'password', label: isNew ? '初始密码（至少 6 位）' : '重置密码（不改就留空）', type: 'password' },
    { name: 'role', label: '角色', type: 'select', options: roleOpts, value: u.role || 'member' }, { name: 'kidId', label: '这是哪个孩子的账号（仅「孩子」角色需要）', type: 'select', options: kidOpts, value: u.kidId || '' }];
  $('#au').onclick = () => formDialog('添加家人账号', uf({}, true), async (v) => { await api('/api/users', { json: v }); await refresh(); });
  $('#view').querySelectorAll('[data-eu]').forEach((b) => (b.onclick = () => formDialog('编辑账号', uf(users.find((u) => u.id === b.dataset.eu), false), async (v) => { await api('/api/users/' + b.dataset.eu, { method: 'PUT', json: v }); await refresh(); })));
  $('#view').querySelectorAll('[data-du]').forEach((b) => (b.onclick = async () => { if (confirmBox('删除这个账号？她发过的内容会保留。')) { await api('/api/users/' + b.dataset.du, { method: 'DELETE' }); await refresh(); } }));
  $('#aic').onclick = async () => {
    const c = await api('/api/ai/config');
    formDialog('AI 助手设置', [
      { name: 'baseUrl', label: '接口地址（含 /v1）', value: c.baseUrl, placeholder: 'https://你的中转站/v1' },
      { name: 'apiKey', label: '密钥', type: 'password', placeholder: c.hasKey ? '已保存，不改就留空' : 'sk-…' },
      { name: 'model', label: '模型名', value: c.model, placeholder: '例如 hermes-agent 或中转站支持的模型名' },
      { name: 'visionModel', label: '「识别是谁」用的视觉模型名（可留空＝用上面的模型；要能看图）', value: c.visionModel, placeholder: '例如 gpt-4o / claude-sonnet / qwen-vl' },
      { name: 'faceUrl', label: '或：自建人脸识别接口地址（可留空；填了就不用大模型识别）', value: c.faceUrl, placeholder: 'http://主机:端口/identify' },
      { name: 'faceKey', label: '自建接口的密钥（可留空）', type: 'password', placeholder: c.hasFaceKey ? '已保存，不改就留空' : '' },
    ], async (v) => {
      await api('/api/ai/config', { method: 'PUT', json: v });
      try { const t = await api('/api/ai/test', { method: 'POST' }); toast('连接成功：' + t.reply); }
      catch (e) { await refresh(); throw new Error('已保存，但测试没通过：' + e.message); }
      await refresh();
    }, '保存并测试', '写文字用普通模型的中转站就行，比 Agent 更快。Hermes Agent 的 API Server 默认是 http://主机:8642/v1，模型名 hermes-agent。');
  };
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
    const TR = ['treasure', 'cats', 'growth', 'voice', 'capsule', 'qa'];
    chrome(TR.includes(r) ? 'treasure' : ['diary', 'new', 'me'].includes(r) ? (r === 'new' ? 'add' : r) : (r === '' ? '' : 'x'));
    if (r === '') return await viewTimeline('home', qs);
    if (r === 'diary') return await viewTimeline('diary', qs);
    if (r === 'post') return await viewPost(seg[1]);
    if (r === 'new') return await viewCompose(null, qs);
    if (r === 'edit') return await viewCompose(seg[1], qs);
    if (r === 'me') return await viewMe();
    if (r === 'treasure') return viewTreasure();
    if (r === 'cats') return await viewCats();
    if (r === 'growth') return await viewGrowth(qs);
    if (r === 'voice') return await viewVoice(qs);
    if (r === 'capsule') return await viewCapsule();
    if (r === 'qa') return await viewQa(qs);
    location.hash = '#/';
  } catch (e) { $('#view').innerHTML = `<div class="empty">${esc(e.message)}<br><br><a class="btn ghost" href="#/">回首页</a></div>`; }
}
async function boot() {
  const d = await api('/api/init');
  S.me = d.me; S.kids = d.kids; S.title = d.settings.title; S.needSetup = d.needSetup; S.ai = !!d.ai; S.who = !!d.who;
}
window.addEventListener('hashchange', route);
boot().then(route).catch((e) => ($('#view').innerHTML = `<div class="empty">无法连接服务器：${esc(e.message)}</div>`));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
