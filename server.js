'use strict';
// 成长册 —— 家庭成长记录站。数据全部是普通文件：data/posts/<id>/post.json + files/
const express = require('express');
const multer = require('multer');
const { ZipArchive } = require('archiver');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');

const PORT = +process.env.PORT || 3000;
const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const MAX_UPLOAD = (+process.env.MAX_UPLOAD_MB || 2048) * 1024 * 1024;
const POSTS_DIR = path.join(DATA, 'posts');
fs.mkdirSync(POSTS_DIR, { recursive: true });

/* ---------- 小工具 ---------- */
const rand = (n = 6) => crypto.randomBytes(n).toString('hex');
function readJSON(f, def) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } }
function writeJSON(f, obj) {
  const t = f + '.' + process.pid + '.tmp';
  fs.writeFileSync(t, JSON.stringify(obj, null, 2));
  fs.renameSync(t, f);
}
const F_USERS = path.join(DATA, 'users.json');
const F_KIDS = path.join(DATA, 'kids.json');
const F_SET = path.join(DATA, 'settings.json');
const F_SECRET = path.join(DATA, 'secret.key');
const F_AI = path.join(DATA, 'ai.json');
const F_GROWTH = path.join(DATA, 'growth.json');
const F_QA = path.join(DATA, 'qa.json');
let aiCfg = readJSON(F_AI, { baseUrl: '', apiKey: '', model: '' });
const saveAi = () => fs.writeFileSync(F_AI, JSON.stringify(aiCfg, null, 2), { mode: 0o600 });
const aiReady = () => !!(aiCfg.baseUrl && aiCfg.apiKey && aiCfg.model);

let users = readJSON(F_USERS, []);
let kids = readJSON(F_KIDS, []);
let settings = readJSON(F_SET, { title: '成长册' });
let growth = readJSON(F_GROWTH, []); // 成长数据：{id,kidId,date,height,weight,shoe,note,by}
let qaRecs = readJSON(F_QA, []);     // 生日问答：{id,kidId,age,date,answers:[{q,a}],by}
const DEFAULT_QA = ['最喜欢的颜色？', '最喜欢吃的东西？', '最喜欢的动画片 / 书？', '最好的朋友是谁？', '长大了想做什么？', '最开心的事是什么？', '最害怕什么？', '想对爸爸妈妈说的一句话？'];
const qaQuestions = () => (Array.isArray(settings.qaQuestions) && settings.qaQuestions.length ? settings.qaQuestions : DEFAULT_QA);
let SECRET;
try { SECRET = fs.readFileSync(F_SECRET, 'utf8').trim(); } catch { SECRET = rand(32); fs.writeFileSync(F_SECRET, SECRET, { mode: 0o600 }); }
const saveUsers = () => writeJSON(F_USERS, users);
const saveKids = () => writeJSON(F_KIDS, kids);
const saveSettings = () => writeJSON(F_SET, settings);
const saveGrowth = () => writeJSON(F_GROWTH, growth);
const saveQa = () => writeJSON(F_QA, qaRecs);

const KID_COLORS = ['#f2705f', '#4aa8a0', '#e5a23a', '#7c8cf0', '#c46fc0', '#6bb26b'];
const ROLES = ['admin', 'member', 'viewer', 'child'];
const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.avif', '.bmp']);
const VID_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm', '.3gp', '.mkv', '.avi']);
const AUD_EXT = new Set(['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.oga', '.opus', '.amr', '.flac', '.weba', '.wma']);
const AUD_NATIVE = new Set(['.mp3', '.m4a', '.aac']); // 各浏览器都能直接播，不用转码
const kindOf = (ext) => (VID_EXT.has(ext) ? 'video' : AUD_EXT.has(ext) ? 'audio' : 'image');

/* ---------- 密码 / 会话 ---------- */
function hashPw(pw) { const s = rand(8); return s + ':' + crypto.scryptSync(pw, s, 32).toString('hex'); }
function checkPw(pw, h) {
  const [s, k] = String(h || '').split(':'); if (!s || !k) return false;
  const a = crypto.scryptSync(pw, s, 32), b = Buffer.from(k, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const sign = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
function safeEq(a, b) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); }
function makeToken(u) { const b = `${u.id}.${Date.now() + 180 * 864e5}.${u.sv || 0}`; return b + '.' + sign(b); }
function parseCookies(req) {
  const o = {};
  (req.headers.cookie || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
  return o;
}
function readUser(req) {
  const c = parseCookies(req).sid; if (!c) return null;
  const p = c.split('.'); if (p.length !== 4) return null;
  const [id, exp, sv, sig] = p;
  if (!safeEq(sig, sign(`${id}.${exp}.${sv}`)) || +exp < Date.now()) return null;
  const u = users.find((x) => x.id === id);
  return u && (u.sv || 0) === +sv ? u : null;
}
function setCookie(req, res, u) {
  res.setHeader('Set-Cookie', `sid=${makeToken(u)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=15552000${req.secure ? '; Secure' : ''}`);
}
const pubUser = (u) => ({ id: u.id, name: u.name, username: u.username, role: u.role, kidId: u.kidId || null });

const fails = new Map();
function tooMany(ip) { const f = fails.get(ip); return f && f.n >= 10 && Date.now() - f.t < 15 * 60e3; }
function noteFail(ip) { const f = fails.get(ip); if (!f || Date.now() - f.t > 15 * 60e3) fails.set(ip, { n: 1, t: Date.now() }); else { f.n++; f.t = Date.now(); } }

/* ---------- 帖子存储（内存索引 + 每帖一个 json） ---------- */
const posts = new Map();
for (const id of fs.readdirSync(POSTS_DIR)) {
  const p = readJSON(path.join(POSTS_DIR, id, 'post.json'), null);
  if (p) posts.set(p.id, p);
}
const postDir = (id) => path.join(POSTS_DIR, id);
const savePost = (p) => { fs.mkdirSync(postDir(p.id), { recursive: true }); writeJSON(path.join(postDir(p.id), 'post.json'), p); };
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && !isNaN(new Date(v + 'T00:00:00'));
// 生日 + N 岁（2 月 29 日出生的，非闰年算 2 月 28 日）
function addYears(b, n) {
  const [y, m, d] = b.split('-').map(Number), Y = y + n;
  const last = new Date(Y, m, 0).getDate();
  return `${Y}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
const isLocked = (p) => p.type === 'capsule' && p.unlockDate > localDay();   // 时间胶囊：没到日子谁也看不了
const canView = (u, p) => {
  if (p.type === 'record') return true;
  if (p.authorId === u.id || p.visibility === 'family') return true;
  return p.type === 'capsule' && !!u.kidId && p.kidIds.includes(u.kidId);      // 「只给她」：收信的孩子账号
};
const canEdit = (u, p) => (p.authorId === u.id && !isLocked(p)) || (u.role === 'admin' && p.type === 'record');
const canDelete = (u, p) => p.authorId === u.id || canEdit(u, p) || (u.role === 'admin' && p.visibility === 'family');
const userName = (id) => (users.find((x) => x.id === id) || {}).name || '已删除用户';

function mediaOut(pid, m) {
  const u = (f) => (f ? `/media/${pid}/${f}` : null);
  return {
    id: m.id, kind: m.kind, name: m.name, size: m.size, status: m.status || 'ready',
    url: u(m.file), thumb: u(m.thumb), view: u(m.view), poster: u(m.poster), web: m.status === 'ready' ? u(m.web) : null,
  };
}
const kidById = (id) => kids.find((k) => k.id === id);
/* 评论可见性：公开 / 悄悄话（仅管理员 · 指定的人 · 孩子满 18 岁后）。评论者本人永远看得到自己写的 */
function canSeeComment(u, c) {
  const w = c.whisper;
  if (!w || c.userId === u.id) return true;
  if (w.type === 'admin') return u.role === 'admin';
  if (w.type === 'user') return u.id === w.to;
  if (w.type === 'future') { const k = kidById(w.kidId); return !!k && !!k.birthday && u.kidId === k.id && addYears(k.birthday, 18) <= localDay(); }
  return false;
}
function whisperLabel(w, mine) {
  if (!w) return '';
  if (w.type === 'admin') return '仅管理员可见';
  if (w.type === 'user') return mine ? `只有${userName(w.to)}能看到` : '只有你能看到';
  const k = kidById(w.kidId);
  return mine ? `${k ? k.name : '孩子'}满 18 岁后才能看到` : '写给你的悄悄话';
}
function toClient(p, u) {
  const base = {
    id: p.id, type: p.type, kidIds: p.kidIds, authorId: p.authorId, authorName: userName(p.authorId),
    date: p.date, visibility: p.visibility, createdAt: p.createdAt, ai: !!p.ai,
    canEdit: canEdit(u, p), canDelete: canDelete(u, p),
  };
  if (p.type === 'capsule') Object.assign(base, { unlockDate: p.unlockDate, unlockMode: p.unlockMode, unlockAge: p.unlockAge || null });
  if (isLocked(p)) return { ...base, locked: true, title: '', body: '', media: [], comments: [], likeCount: 0, liked: false };
  return {
    ...base, title: p.title, body: p.body,
    media: p.media.map((m) => mediaOut(p.id, m)),
    comments: p.comments.filter((c) => canSeeComment(u, c)).map((c) => ({
      id: c.id, text: c.text, at: c.at, parentId: c.parentId || null, replyToName: c.replyToName || '',
      name: c.nick || userName(c.userId), account: userName(c.userId), mine: c.userId === u.id,
      whisper: whisperLabel(c.whisper, c.userId === u.id),
    })),
    likeCount: p.likes.length, liked: p.likes.includes(u.id),
  };
}

/* ---------- ffmpeg ---------- */
function ff(args, timeout = 120e3) {
  return new Promise((resolve) => {
    execFile('ffmpeg', ['-y', '-v', 'error', '-nostdin', ...args], { timeout }, (err) => resolve(!err));
  });
}
const exists = (f) => fs.existsSync(f) && fs.statSync(f).size > 0;
async function makeImageVariants(dir, file, base) {
  const src = path.join(dir, file), out = {};
  const t = `t_${base}.jpg`, v = `v_${base}.jpg`;
  if (await ff(['-i', src, '-vf', "scale='min(600,iw)':-2", '-frames:v', '1', '-q:v', '5', path.join(dir, t)]) && exists(path.join(dir, t))) out.thumb = t;
  if (await ff(['-i', src, '-vf', "scale='min(1800,iw)':-2", '-frames:v', '1', '-q:v', '3', path.join(dir, v)]) && exists(path.join(dir, v))) out.view = v;
  return out;
}
async function makePoster(dir, file, base) {
  const src = path.join(dir, file), p = `p_${base}.jpg`, dst = path.join(dir, p);
  const vf = ['-vf', "scale='min(600,iw)':-2", '-frames:v', '1', '-q:v', '5', dst];
  if (await ff(['-ss', '0.5', '-i', src, ...vf]) && exists(dst)) return p;
  if (await ff(['-i', src, ...vf]) && exists(dst)) return p;
  return null;
}
const queue = []; let working = false;
function enqueue(pid, mid) { queue.push({ pid, mid }); if (!working) work(); }
async function work() {
  working = true;
  while (queue.length) {
    const { pid, mid } = queue.shift();
    const p = posts.get(pid); const m = p && p.media.find((x) => x.id === mid);
    if (!m) continue;
    const dir = path.join(postDir(pid), 'files'), base = path.basename(m.file, path.extname(m.file)), w = m.kind === 'audio' ? `w_${base}.m4a` : `w_${base}.mp4`;
    const ok = m.kind === 'audio'
      ? await ff(['-i', path.join(dir, m.file), '-vn', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', path.join(dir, w)], 600e3)
      : await ff(['-i', path.join(dir, m.file), '-vf', "scale='if(gt(iw,ih),-2,min(720,iw))':'if(gt(iw,ih),min(720,ih),-2)'",
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', path.join(dir, w)], 3600e3);
    if (posts.get(pid) && p.media.includes(m)) {
      if (ok && exists(path.join(dir, w))) { m.web = w; m.status = 'ready'; } else { m.status = 'failed'; }
      savePost(p);
    } else { fsp.rm(path.join(dir, w), { force: true }).catch(() => {}); }
  }
  working = false;
}
for (const p of posts.values()) for (const m of p.media) if (m.kind !== 'image' && m.status === 'processing') enqueue(p.id, m.id);

// multer 把非 ASCII 文件名按 latin1 解出来，这里还原成 UTF-8（已经是正确 UTF-8 的则保持不变）
function fixName(n) {
  if (![...n].every((c) => c.charCodeAt(0) < 256)) return n;
  const s = Buffer.from(n, 'latin1').toString('utf8');
  return s.includes('�') ? n : s;
}
async function processUpload(post, f) {
  const dir = path.dirname(f.path), ext = path.extname(f.filename).toLowerCase(), base = path.basename(f.filename, ext);
  const m = { id: rand(4), file: f.filename, name: fixName(f.originalname).slice(0, 200), kind: kindOf(ext), size: f.size };
  if (m.kind === 'image') Object.assign(m, await makeImageVariants(dir, f.filename, base));
  else if (m.kind === 'audio') { if (!AUD_NATIVE.has(ext)) m.status = 'processing'; }
  else { m.poster = await makePoster(dir, f.filename, base) || undefined; m.status = 'processing'; }
  return m;
}

/* ---------- 上传 ---------- */
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { const d = path.join(postDir(req.pid), 'files'); fs.mkdirSync(d, { recursive: true }); cb(null, d); },
    filename: (req, file, cb) => cb(null, rand(6) + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: MAX_UPLOAD, files: 40 },
  fileFilter: (req, file, cb) => {
    const e = path.extname(file.originalname).toLowerCase();
    cb(null, IMG_EXT.has(e) || VID_EXT.has(e) || AUD_EXT.has(e));
  },
});
const wrapUpload = (isNew) => (req, res, next) => upload.array('files', 40)(req, res, (err) => {
  if (!err) return next();
  if (isNew) fsp.rm(postDir(req.pid), { recursive: true, force: true }).catch(() => {});
  else (req.files || []).forEach((f) => fsp.rm(f.path, { force: true }).catch(() => {}));
  res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? '文件太大了' : '上传失败：' + err.message });
});

/* ---------- 应用 ---------- */
const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});
app.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /\n'));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), { etag: true, maxAge: 0 }));

const needLogin = (req, res, next) => { const u = readUser(req); if (!u) return res.status(401).json({ error: '请先登录' }); req.user = u; next(); };
const needAdmin = [needLogin, (req, res, next) => (req.user.role === 'admin' ? next() : res.status(403).json({ error: '需要管理员权限' }))];
const needWrite = [needLogin, (req, res, next) => (req.user.role !== 'viewer' ? next() : res.status(403).json({ error: '当前账号是只读的' }))];
const str = (v, n) => String(v ?? '').trim().slice(0, n);

app.get('/api/init', (req, res) => {
  const me = readUser(req);
  res.json({ needSetup: users.length === 0, me: me && pubUser(me), kids: me ? kids : [], settings: { title: settings.title }, ai: !!me && aiReady(), qaQuestions: me ? qaQuestions() : [] });
});
app.post('/api/setup', (req, res) => {
  if (users.length) return res.status(403).json({ error: '已经初始化过了' });
  const { name, username, password } = req.body || {};
  if (!str(name, 30) || !str(username, 30) || String(password || '').length < 6) return res.status(400).json({ error: '请填写名字、用户名，密码至少 6 位' });
  const u = { id: 'u_' + rand(4), name: str(name, 30), username: str(username, 30).toLowerCase(), pw: hashPw(password), role: 'admin', sv: 0 };
  users.push(u); saveUsers(); setCookie(req, res, u); res.json({ ok: true });
});
app.post('/api/login', (req, res) => {
  const ip = req.ip;
  if (tooMany(ip)) return res.status(429).json({ error: '尝试次数太多，请 15 分钟后再试' });
  const { username, password } = req.body || {};
  const u = users.find((x) => x.username === str(username, 30).toLowerCase());
  if (!u || !checkPw(String(password || ''), u.pw)) { noteFail(ip); return res.status(401).json({ error: '用户名或密码不对' }); }
  fails.delete(ip); setCookie(req, res, u); res.json({ ok: true });
});
app.post('/api/logout', (req, res) => { res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0'); res.json({ ok: true }); });

/* 自己的账号 */
app.put('/api/me', needLogin, (req, res) => {
  const n = str(req.body.name, 30); if (!n) return res.status(400).json({ error: '名字不能为空' });
  req.user.name = n; saveUsers(); res.json(pubUser(req.user));
});
app.post('/api/me/password', needLogin, (req, res) => {
  const { old, pw } = req.body || {};
  if (!checkPw(String(old || ''), req.user.pw)) return res.status(400).json({ error: '旧密码不对' });
  if (String(pw || '').length < 6) return res.status(400).json({ error: '新密码至少 6 位' });
  req.user.pw = hashPw(pw); req.user.sv = (req.user.sv || 0) + 1; saveUsers(); setCookie(req, res, req.user); res.json({ ok: true });
});

/* 孩子 / 站点 / 账号管理（管理员） */
app.put('/api/settings', needAdmin, (req, res) => {
  settings.title = str(req.body.title, 20) || '成长册'; saveSettings(); res.json({ title: settings.title });
});
function kidFields(b) { return { name: str(b.name, 20), birthday: /^\d{4}-\d{2}-\d{2}$/.test(b.birthday || '') ? b.birthday : '', emoji: str(b.emoji, 4) || '🌸' }; }
app.post('/api/kids', needAdmin, (req, res) => {
  const f = kidFields(req.body); if (!f.name) return res.status(400).json({ error: '请填写名字' });
  const k = { id: 'k_' + rand(3), ...f, color: KID_COLORS[kids.length % KID_COLORS.length] };
  kids.push(k); saveKids(); res.json(k);
});
app.put('/api/kids/:id', needAdmin, (req, res) => {
  const k = kids.find((x) => x.id === req.params.id); if (!k) return res.status(404).json({ error: '没有这个孩子' });
  const f = kidFields(req.body); if (!f.name) return res.status(400).json({ error: '请填写名字' });
  Object.assign(k, f); saveKids(); res.json(k);
});
app.delete('/api/kids/:id', needAdmin, (req, res) => {
  kids = kids.filter((x) => x.id !== req.params.id); saveKids();
  users.forEach((u) => { if (u.kidId === req.params.id) u.kidId = null; }); saveUsers();
  for (const p of posts.values()) if (p.kidIds.includes(req.params.id)) { p.kidIds = p.kidIds.filter((k) => k !== req.params.id); savePost(p); }
  res.json({ ok: true });
});
app.get('/api/users', needAdmin, (req, res) => res.json(users.map(pubUser)));
function userFields(b) {
  return { name: str(b.name, 30), role: ROLES.includes(b.role) ? b.role : 'member', kidId: kids.some((k) => k.id === b.kidId) ? b.kidId : null };
}
app.post('/api/users', needAdmin, (req, res) => {
  const f = userFields(req.body), un = str(req.body.username, 30).toLowerCase();
  if (!f.name || !un || String(req.body.password || '').length < 6) return res.status(400).json({ error: '请填写名字、用户名，密码至少 6 位' });
  if (users.some((x) => x.username === un)) return res.status(400).json({ error: '用户名已被占用' });
  const u = { id: 'u_' + rand(4), username: un, pw: hashPw(req.body.password), sv: 0, ...f };
  users.push(u); saveUsers(); res.json(pubUser(u));
});
app.put('/api/users/:id', needAdmin, (req, res) => {
  const u = users.find((x) => x.id === req.params.id); if (!u) return res.status(404).json({ error: '没有这个账号' });
  const f = userFields(req.body); if (!f.name) return res.status(400).json({ error: '名字不能为空' });
  if (u.role === 'admin' && f.role !== 'admin' && users.filter((x) => x.role === 'admin').length < 2) return res.status(400).json({ error: '至少要保留一个管理员' });
  Object.assign(u, f);
  if (req.body.password) {
    if (String(req.body.password).length < 6) return res.status(400).json({ error: '密码至少 6 位' });
    u.pw = hashPw(req.body.password); u.sv = (u.sv || 0) + 1;
  }
  saveUsers(); res.json(pubUser(u));
});
app.delete('/api/users/:id', needAdmin, (req, res) => {
  const u = users.find((x) => x.id === req.params.id); if (!u) return res.status(404).json({ error: '没有这个账号' });
  if (u.id === req.user.id) return res.status(400).json({ error: '不能删除自己' });
  users = users.filter((x) => x !== u); saveUsers(); res.json({ ok: true });
});

/* 帖子 */
function postFields(b, u, old) {
  const type = old ? old.type : (b.type === 'diary' || b.type === 'capsule' ? b.type : 'record');
  const date = isDay(b.date) ? b.date : (old ? old.date : localDay());
  const has = (k) => b[k] !== undefined; // 修改时没传的字段保持原样，避免误清空
  const ids = Array.isArray(b.kidIds) ? b.kidIds : String(b.kidIds || '').split(',');
  const kidIds = has('kidIds') ? ids.filter((id) => kids.some((k) => k.id === id)) : (old ? old.kidIds : []);
  const visibility = type === 'record' ? 'family' : has('visibility') ? (b.visibility === 'family' ? 'family' : 'private') : (old ? old.visibility : 'private');
  return {
    type, date, kidIds, visibility,
    title: has('title') ? str(b.title, 100) : (old ? old.title : ''),
    body: has('body') ? String(b.body || '').trim().slice(0, 50000) : (old ? old.body : ''),
  };
}
/* 时间胶囊的解锁条件：指定日期，或某个孩子满 N 岁。封存后连写信的人也看不到，直到那天 */
function capsuleFields(b, f) {
  let r;
  if (b.unlockMode === 'age') {
    const k = kidById(f.kidIds[0]), age = Math.round(+b.unlockAge);
    if (!k || !k.birthday) return { error: '请选一个填了生日的孩子作为收信人，才能按年龄解锁' };
    if (!(age >= 1 && age <= 60)) return { error: '年龄请填 1~60' };
    r = { unlockMode: 'age', unlockAge: age, unlockDate: addYears(k.birthday, age) };
  } else {
    if (!isDay(b.unlockDate)) return { error: '请选择解锁日期' };
    r = { unlockMode: 'date', unlockDate: b.unlockDate };
  }
  if (r.unlockDate <= localDay()) return { error: '解锁日期要在今天之后' };
  return r;
}
app.get('/api/posts', needLogin, (req, res) => {
  const { kid, type, q } = req.query;
  const offset = Math.max(0, +req.query.offset || 0), limit = Math.min(50, +req.query.limit || 20);
  let list = [...posts.values()].filter((p) => p.type !== 'capsule' && canView(req.user, p));   // 胶囊有自己的页面
  if (type) list = list.filter((p) => p.type === type);
  if (kid === 'together') list = list.filter((p) => p.kidIds.length >= 2);   // 双宝日常：两个以上孩子同框
  else if (kid) list = list.filter((p) => p.kidIds.includes(kid));
  if (q) { const s = String(q).toLowerCase(); list = list.filter((p) => (p.title + ' ' + p.body).toLowerCase().includes(s)); }
  list.sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1));
  res.json({ total: list.length, items: list.slice(offset, offset + limit).map((p) => toClient(p, req.user)) });
});
const getPost = (req, res) => {
  const p = posts.get(req.params.id);
  if (!p || !canView(req.user, p)) { res.status(404).json({ error: '找不到这条记录' }); return null; }
  return p;
};
app.get('/api/posts/:id', needLogin, (req, res) => { const p = getPost(req, res); if (p) res.json(toClient(p, req.user)); });

app.post('/api/posts', needWrite, (req, res, next) => { req.pid = Date.now().toString(36) + rand(3); next(); }, wrapUpload(true), async (req, res) => {
  const cleanup = () => fsp.rm(postDir(req.pid), { recursive: true, force: true }).catch(() => {});
  try {
    const f = postFields(req.body, req.user);
    if (!f.title && !f.body && !(req.files || []).length) { await cleanup(); return res.status(400).json({ error: '写点文字或选张照片吧' }); }
    let cap = {};
    if (f.type === 'capsule') {
      cap = capsuleFields(req.body, f);
      if (cap.error) { await cleanup(); return res.status(400).json({ error: cap.error }); }
      f.date = localDay();
    }
    const now = new Date().toISOString();
    const post = { id: req.pid, ...f, ...cap, ai: ['1', 'true', true, 1].includes(req.body.ai), authorId: req.user.id, media: [], comments: [], likes: [], createdAt: now, updatedAt: now };
    for (const file of req.files || []) post.media.push(await processUpload(post, file));
    posts.set(post.id, post); savePost(post);
    post.media.filter((m) => m.status === 'processing').forEach((m) => enqueue(post.id, m.id));
    res.json(toClient(post, req.user));
  } catch (e) { console.error(e); await cleanup(); res.status(500).json({ error: '保存失败：' + e.message }); }
});
app.put('/api/posts/:id', needLogin, async (req, res) => {
  const p = getPost(req, res); if (!p) return;
  if (!canEdit(req.user, p)) return res.status(403).json({ error: '没有权限修改' });
  const f = postFields(req.body, req.user, p);
  const rm = new Set(Array.isArray(req.body.removeMedia) ? req.body.removeMedia : []);
  const gone = p.media.filter((m) => rm.has(m.id));
  p.media = p.media.filter((m) => !rm.has(m.id));
  if (!f.title && !f.body && !p.media.length) return res.status(400).json({ error: '内容不能全空' });
  Object.assign(p, f, { updatedAt: new Date().toISOString() }); savePost(p);
  for (const m of gone) for (const k of ['file', 'thumb', 'view', 'poster', 'web']) if (m[k]) fsp.rm(path.join(postDir(p.id), 'files', m[k]), { force: true }).catch(() => {});
  res.json(toClient(p, req.user));
});
app.post('/api/posts/:id/media', needLogin, (req, res, next) => {
  const p = getPost(req, res); if (!p) return;
  if (!canEdit(req.user, p)) return res.status(403).json({ error: '没有权限修改' });
  req.pid = p.id; req.post = p; next();
}, wrapUpload(false), async (req, res) => {
  try {
    for (const file of req.files || []) {
      const m = await processUpload(req.post, file); req.post.media.push(m);
      if (m.status === 'processing') enqueue(req.post.id, m.id);
    }
    req.post.updatedAt = new Date().toISOString(); savePost(req.post); res.json(toClient(req.post, req.user));
  } catch (e) { console.error(e); res.status(500).json({ error: '保存失败：' + e.message }); }
});
app.delete('/api/posts/:id', needLogin, (req, res) => {
  const p = getPost(req, res); if (!p) return;
  if (!canDelete(req.user, p)) return res.status(403).json({ error: '没有权限删除' });
  posts.delete(p.id); fsp.rm(postDir(p.id), { recursive: true, force: true }).catch(() => {}); res.json({ ok: true });
});
app.post('/api/posts/:id/like', needLogin, (req, res) => {
  const p = getPost(req, res); if (!p) return;
  const i = p.likes.indexOf(req.user.id); if (i >= 0) p.likes.splice(i, 1); else p.likes.push(req.user.id);
  savePost(p); res.json({ liked: i < 0, likeCount: p.likes.length });
});
app.post('/api/posts/:id/comments', needLogin, (req, res) => {
  const p = getPost(req, res); if (!p) return;
  if (isLocked(p)) return res.status(403).json({ error: '这个胶囊还没到开启的日子' });
  const text = str(req.body.text, 1000); if (!text) return res.status(400).json({ error: '评论不能为空' });
  const c = { id: rand(4), userId: req.user.id, text, at: new Date().toISOString() };
  const nick = str(req.body.nick, 20); if (nick) c.nick = nick;       // 署名：比如共用账号的「外公」
  const par = req.body.parentId ? p.comments.find((x) => x.id === req.body.parentId) : null;
  if (req.body.parentId && (!par || !canSeeComment(req.user, par))) return res.status(404).json({ error: '要回复的评论不存在' });
  if (par) { c.parentId = par.parentId || par.id; c.replyToName = par.nick || userName(par.userId); }
  const w = req.body.whisper;
  if (par && par.whisper) c.whisper = par.userId === req.user.id ? par.whisper : { type: 'user', to: par.userId };   // 回复悄悄话仍是悄悄话
  else if (w && w.type) {
    if (w.type === 'admin') c.whisper = { type: 'admin' };
    else if (w.type === 'user') {
      if (!users.some((x) => x.id === w.to) || w.to === req.user.id) return res.status(400).json({ error: '请选择悄悄话要给谁看' });
      c.whisper = { type: 'user', to: w.to };
    } else if (w.type === 'future') {
      const k = kidById(w.kidId);
      if (!k || !k.birthday) return res.status(400).json({ error: '这个孩子还没填生日，没法算 18 岁' });
      c.whisper = { type: 'future', kidId: k.id };
    } else return res.status(400).json({ error: '悄悄话类型不对' });
  }
  p.comments.push(c); savePost(p); res.json(toClient(p, req.user));
});
app.delete('/api/posts/:id/comments/:cid', needLogin, (req, res) => {
  const p = getPost(req, res); if (!p) return;
  const c = p.comments.find((x) => x.id === req.params.cid); if (!c || !canSeeComment(req.user, c)) return res.status(404).json({ error: '没有这条评论' });
  if (c.userId !== req.user.id && p.authorId !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: '没有权限' });
  p.comments = p.comments.filter((x) => x !== c && x.parentId !== c.id); savePost(p); res.json(toClient(p, req.user));
});
app.get('/api/people', needLogin, (req, res) => res.json(users.map((u) => ({ id: u.id, name: u.name }))));

/* 时间胶囊 */
app.get('/api/capsules', needLogin, (req, res) => {
  const list = [...posts.values()].filter((p) => p.type === 'capsule' && canView(req.user, p))
    .sort((a, b) => (a.unlockDate < b.unlockDate ? -1 : a.unlockDate > b.unlockDate ? 1 : 0));
  res.json(list.map((p) => toClient(p, req.user)));
});

/* 声音档案：所有记录里的语音，按日期倒序 */
app.get('/api/voices', needLogin, (req, res) => {
  const { kid } = req.query;
  let list = [...posts.values()].filter((p) => canView(req.user, p) && !isLocked(p) && p.media.some((m) => m.kind === 'audio'));
  if (kid === 'together') list = list.filter((p) => p.kidIds.length >= 2);
  else if (kid) list = list.filter((p) => p.kidIds.includes(kid));
  list.sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1));
  res.json(list.map((p) => ({ postId: p.id, type: p.type, date: p.date, title: p.title, kidIds: p.kidIds, authorName: userName(p.authorId), media: p.media.filter((m) => m.kind === 'audio').map((m) => mediaOut(p.id, m)) })));
});

/* 成长数据：身高 / 体重 / 鞋码 */
const numIn = (v, lo, hi) => { if (v === '' || v == null) return null; const n = +v; return isFinite(n) && n >= lo && n <= hi ? Math.round(n * 10) / 10 : NaN; };
function growthFields(b) {
  const kidId = kidById(b.kidId) ? b.kidId : '', date = isDay(b.date) ? b.date : '';
  const height = numIn(b.height, 20, 250), weight = numIn(b.weight, 1, 200), shoe = numIn(b.shoe, 10, 50);
  if (!kidId) return { error: '请选择孩子' };
  if (!date) return { error: '请选择日期' };
  if ([height, weight, shoe].some(Number.isNaN)) return { error: '数字不合理：身高 20~250 厘米，体重 1~200 公斤，鞋码 10~50' };
  if (height == null && weight == null && shoe == null) return { error: '身高、体重、鞋码至少填一项' };
  return { kidId, date, height, weight, shoe, note: str(b.note, 100) };
}
app.get('/api/growth', needLogin, (req, res) => {
  res.json(growth.filter((g) => !req.query.kid || g.kidId === req.query.kid).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((g) => ({ ...g, byName: userName(g.by), canEdit: g.by === req.user.id || req.user.role === 'admin' })));
});
app.post('/api/growth', needWrite, (req, res) => {
  const f = growthFields(req.body); if (f.error) return res.status(400).json({ error: f.error });
  const g = { id: 'g_' + rand(4), ...f, by: req.user.id, at: new Date().toISOString() };
  growth.push(g); saveGrowth(); res.json(g);
});
app.put('/api/growth/:id', needWrite, (req, res) => {
  const g = growth.find((x) => x.id === req.params.id); if (!g) return res.status(404).json({ error: '没有这条数据' });
  if (g.by !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: '没有权限修改' });
  const f = growthFields(req.body); if (f.error) return res.status(400).json({ error: f.error });
  Object.assign(g, f); saveGrowth(); res.json(g);
});
app.delete('/api/growth/:id', needWrite, (req, res) => {
  const g = growth.find((x) => x.id === req.params.id); if (!g) return res.status(404).json({ error: '没有这条数据' });
  if (g.by !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: '没有权限删除' });
  growth = growth.filter((x) => x !== g); saveGrowth(); res.json({ ok: true });
});

/* 生日问答：每个孩子每个年龄一份，方便每年对比 */
app.get('/api/qa', needLogin, (req, res) => res.json({ questions: qaQuestions(), records: qaRecs.map((r) => ({ ...r, byName: userName(r.by) })) }));
app.put('/api/qa/questions', needAdmin, (req, res) => {
  const qs = [...new Set((Array.isArray(req.body.questions) ? req.body.questions : []).map((x) => str(x, 60)).filter(Boolean))].slice(0, 30);
  if (!qs.length) return res.status(400).json({ error: '至少要有一个问题' });
  settings.qaQuestions = qs; saveSettings(); res.json({ questions: qs });
});
app.post('/api/qa', needWrite, (req, res) => {
  const kid = kidById(req.body.kidId), age = Math.round(+req.body.age);
  if (!kid) return res.status(400).json({ error: '请选择孩子' });
  if (!(age >= 0 && age <= 40)) return res.status(400).json({ error: '年龄请填 0~40' });
  const answers = (Array.isArray(req.body.answers) ? req.body.answers : []).map((x) => ({ q: str(x && x.q, 60), a: str(x && x.a, 1000) })).filter((x) => x.q && x.a);
  if (!answers.length) return res.status(400).json({ error: '至少回答一个问题' });
  let r = qaRecs.find((x) => x.kidId === kid.id && x.age === age);
  if (r && r.by !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: `${kid.name}${age}岁的问答是别人记的，只有 TA 本人或管理员能修改` });
  const date = isDay(req.body.date) ? req.body.date : localDay();
  if (r) Object.assign(r, { answers, date, updatedAt: new Date().toISOString() });
  else { r = { id: 'q_' + rand(4), kidId: kid.id, age, date, answers, by: req.user.id, updatedAt: new Date().toISOString() }; qaRecs.push(r); }
  saveQa(); res.json(r);
});
app.delete('/api/qa/:id', needWrite, (req, res) => {
  const r = qaRecs.find((x) => x.id === req.params.id); if (!r) return res.status(404).json({ error: '没有这份问答' });
  if (r.by !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: '没有权限删除' });
  qaRecs = qaRecs.filter((x) => x !== r); saveQa(); res.json({ ok: true });
});

/* 媒体文件（需要登录，支持 Range 以便视频拖动） */
app.get('/media/:id/:file', needLogin, (req, res) => {
  const p = posts.get(req.params.id);
  if (!p || !canView(req.user, p) || isLocked(p) || !/^[\w.-]+$/.test(req.params.file)) return res.status(404).end();
  res.setHeader('Cache-Control', 'private, max-age=2592000');
  res.sendFile(path.join(postDir(p.id), 'files', req.params.file), (err) => { if (err && !res.headersSent) res.status(404).end(); });
});

/* 导出：一个可离线翻看的压缩包 */
const slug = (s) => String(s || '').replace(/[\\/:*?"<>|\r\n]/g, ' ').trim().slice(0, 30);
app.get('/api/export', needLogin, async (req, res) => {
  const kid = kids.find((k) => k.id === req.query.kid);
  let list = [...posts.values()].filter((p) => canView(req.user, p) && !isLocked(p));
  if (kid) list = list.filter((p) => (p.type === 'record' ? (p.kidIds.includes(kid.id) || !p.kidIds.length) : p.type === 'capsule' ? p.kidIds.includes(kid.id) : p.authorId === req.user.id));
  list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt < b.createdAt ? -1 : 1));
  const today = new Date().toISOString().slice(0, 10);
  const archive = {
    title: settings.title, exportedAt: today, forKid: kid ? kid.id : null, kids, questions: qaQuestions(),
    growth: growth.filter((g) => !kid || g.kidId === kid.id).sort((a, b) => (a.date < b.date ? -1 : 1)).map((g) => ({ kidId: g.kidId, date: g.date, height: g.height, weight: g.weight, shoe: g.shoe, note: g.note })),
    qa: qaRecs.filter((r) => !kid || r.kidId === kid.id).sort((a, b) => a.age - b.age).map((r) => ({ kidId: r.kidId, age: r.age, date: r.date, answers: r.answers })),
    posts: list.map((p) => ({
      id: p.id, type: p.type, date: p.date, title: p.title, body: p.body, kidIds: p.kidIds, author: userName(p.authorId),
      unlockDate: p.type === 'capsule' ? p.unlockDate : undefined,
      comments: p.comments.filter((c) => canSeeComment(req.user, c)).map((c) => ({ name: c.nick || userName(c.userId), text: c.text, at: c.at, replyTo: c.replyToName || '', whisper: !!c.whisper })),
      media: p.media.map((m) => ({ kind: m.kind, name: m.name, file: `media/${p.id}/${m.file}`, poster: m.poster ? `media/${p.id}/${m.poster}` : null, web: m.web && m.status === 'ready' ? `media/${p.id}/${m.web}` : null })),
    })),
  };
  const zip = new ZipArchive({ zlib: { level: 1 } });
  zip.on('error', (e) => { console.error(e); res.destroy(); });
  res.attachment(`${slug(settings.title) || '成长册'}${kid ? '-' + slug(kid.name) : ''}-${today}.zip`);
  zip.pipe(res);
  zip.append('window.ARCHIVE = ' + JSON.stringify(archive) + ';', { name: 'data.js' });
  zip.append('用浏览器打开 index.html 就能离线翻看。\nmedia 文件夹里是原始照片和视频，posts 文件夹里是每一条记录的文字（Markdown）。\n', { name: '说明.txt' });
  zip.file(path.join(__dirname, 'export-viewer.html'), { name: 'index.html' });
  for (const p of list) {
    const md = `# ${p.title || '(无标题)'}\n\n- ${p.type === 'capsule' ? '封存于' : '日期'}：${p.date}${p.type === 'capsule' ? '，' + p.unlockDate + ' 开启' : ''}\n- 作者：${userName(p.authorId)}\n- 关于：${p.kidIds.map((id) => (kids.find((k) => k.id === id) || {}).name).filter(Boolean).join('、') || '全家'}\n\n${p.body}\n\n` +
      p.media.map((m) => (m.kind === 'audio' ? `[🎙 ${m.name}](../media/${p.id}/${m.file})` : `![${m.name}](../media/${p.id}/${m.file})`)).join('\n') + '\n' +
      (p.comments.length ? '\n## 评论\n' + p.comments.filter((c) => canSeeComment(req.user, c)).map((c) => `- ${c.whisper ? '🔒 ' : ''}${c.nick || userName(c.userId)}${c.replyToName ? ' 回复 ' + c.replyToName : ''}：${c.text}`).join('\n') + '\n' : '');
    zip.append(md, { name: `posts/${p.date}_${slug(p.title) || p.id}_${p.id.slice(-4)}.md` });
    for (const m of p.media) for (const k of ['file', 'poster', 'web']) {
      const f = path.join(postDir(p.id), 'files', m[k] || '');
      if (m[k] && fs.existsSync(f)) zip.file(f, { name: `media/${p.id}/${m[k]}`, store: true });
    }
  }
  zip.finalize();
});

/* ---------- AI 助手 ----------
   走 OpenAI 兼容的 /chat/completions：API 中转站、Hermes Agent 的 API Server 都可以。
   隐私：成长回顾只用「成长记录」，日记（包括孩子的）一律不参与；
   「帮我写」只发送用户当前在输入框里、主动点击按钮的那段文字。 */
async function aiChat(messages, { temperature = 0.7, timeout = 180e3 } = {}) {
  const url = aiCfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  let r;
  try {
    r = await fetch(url, {
      method: 'POST', signal: AbortSignal.timeout(timeout),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + aiCfg.apiKey },
      body: JSON.stringify({ model: aiCfg.model, messages, temperature, stream: false }),
    });
  } catch (e) { throw new Error('连不上 AI 服务：' + (e.name === 'TimeoutError' ? '等太久超时了' : (e.cause && e.cause.code) || e.message)); }
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch {}
  if (!r.ok) throw new Error(`AI 服务返回 ${r.status}：` + String((d && ((d.error && d.error.message) || d.error)) || t).slice(0, 200));
  let c = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
  if (Array.isArray(c)) c = c.map((x) => x.text || '').join('');
  c = String(c || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!c) throw new Error('AI 没有返回内容');
  return c;
}
function parseAi(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { const o = JSON.parse(text.slice(a, b + 1)); if (typeof o.body === 'string' && o.body.trim()) return { title: str(o.title, 100), body: o.body.trim(), note: str(o.note, 100) }; } catch {}
  }
  return { title: '', body: text.replace(/^```\w*\n?|\n?```$/g, '').trim(), note: '' };
}
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

app.get('/api/ai/config', needAdmin, (req, res) => res.json({ baseUrl: aiCfg.baseUrl, model: aiCfg.model, hasKey: !!aiCfg.apiKey }));
app.put('/api/ai/config', needAdmin, (req, res) => {
  const baseUrl = str(req.body.baseUrl, 300), model = str(req.body.model, 100), key = str(req.body.apiKey, 500);
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) return res.status(400).json({ error: '地址要以 http:// 或 https:// 开头' });
  aiCfg.baseUrl = baseUrl; aiCfg.model = model;
  if (key) aiCfg.apiKey = key;
  if (req.body.clearKey) aiCfg.apiKey = '';
  saveAi(); res.json({ ok: true, ready: aiReady() });
});
const aiBusy = new Set();
const aiGuard = (req, res, next) => {
  if (!aiReady()) return res.status(400).json({ error: '管理员还没有配置 AI（「我的」页 → AI 助手）' });
  if (aiBusy.has(req.user.id)) return res.status(429).json({ error: '上一个 AI 请求还没完成，稍等一下' });
  aiBusy.add(req.user.id); res.on('close', () => aiBusy.delete(req.user.id)); next();
};
app.post('/api/ai/test', needAdmin, async (req, res) => {
  try { res.json({ reply: (await aiChat([{ role: 'user', content: '请只回复“收到”两个字。' }], { timeout: 60e3 })).slice(0, 60) }); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

const STYLES = { warm: '语气真诚温暖、自然口语', funny: '语气轻松幽默、带点俏皮，但不油腻', short: '尽量简洁，几句话说清楚，留白有余味' };
app.post('/api/ai/polish', needWrite, aiGuard, async (req, res) => {
  const body = String(req.body.body || '').trim();
  if (body.length < 4) return res.status(400).json({ error: '先随手写几句，再让 AI 帮忙' });
  if (body.length > 8000) return res.status(400).json({ error: '内容太长了，分几次整理吧' });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.body.date || '') ? req.body.date : localDay();
  const ids = Array.isArray(req.body.kidIds) ? req.body.kidIds : [];
  const who = ids.map((id) => kids.find((k) => k.id === id)).filter(Boolean).map((k) => k.name + (k.birthday ? `（那时${ageText(k.birthday, date)}）` : '')).join('、');
  const title = str(req.body.title, 100);
  const child = req.user.role === 'child';
  const system = child
    ? '你在帮一个小学生修改她自己写的日记。只改错别字、标点和明显不通顺的句子，保留她自己的口吻、想法和用词，不要改写成大人腔，不要添加原文没有的内容。' +
      '另外给一句具体的、真诚的鼓励（不超过30字，指出她写得好的某个地方）。只输出 JSON：{"title":"原标题；没有就起一个不超过10字的","body":"修改后的正文","note":"鼓励的话"}，不要输出任何其他内容。'
    : '你是一位温柔细腻的中文写作助手，帮家人把随手记下的孩子成长片段整理成值得长大后回看的文字。要求：' +
      '1. 严格忠于原文，不添加原文没有的情节、人名、地点、对话；2. 保留孩子说的原话；3. ' + (STYLES[req.body.style] || STYLES.warm) + '，不堆砌辞藻，不说教；' +
      '4. 篇幅与原文相当，最多比原文长一半；5. 保持原文的叙述视角和对孩子的称呼；6. 用空行分段，不使用 Markdown 标记。' +
      '只输出 JSON：{"title":"不超过12字的标题","body":"整理后的正文"}，不要输出任何其他内容。';
  const user = `日期：${date}\n${who ? '关于：' + who + '\n' : ''}${title ? '原标题：' + title + '\n' : ''}原文：\n${body}`;
  try { res.json(parseAi(await aiChat([{ role: 'system', content: system }, { role: 'user', content: user }], { timeout: 120e3 }))); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

function periodRange(p) {
  if (/^\d{4}-\d{2}$/.test(p)) {
    const [y, m] = p.split('-').map(Number); if (m < 1 || m > 12) return null;
    return { from: `${p}-01`, to: `${p}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`, label: `${y}年${m}月`, year: false };
  }
  if (/^\d{4}$/.test(p)) return { from: p + '-01-01', to: p + '-12-31', label: p + '年', year: true };
  return null;
}
app.post('/api/ai/review', needWrite, aiGuard, async (req, res) => {
  if (req.user.role === 'child') return res.status(403).json({ error: '成长回顾由家长生成' });
  const r = periodRange(String(req.body.period || '')); if (!r) return res.status(400).json({ error: '时间范围不对' });
  const kid = kids.find((k) => k.id === req.body.kidId) || null;
  const list = [...posts.values()]
    .filter((p) => p.type === 'record' && p.date >= r.from && p.date <= r.to && (!kid || p.kidIds.includes(kid.id) || !p.kidIds.length))
    .sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? -1 : 1) : a.date < b.date ? -1 : 1));
  if (!list.length) return res.status(400).json({ error: `${r.label}还没有${kid ? kid.name + '的' : ''}成长记录` });
  let sample = list;
  if (list.length > 100) sample = Array.from({ length: 100 }, (_, i) => list[Math.floor((i * list.length) / 100)]);
  const cap = list.length > 100 ? 200 : 400;
  let lines = sample.map((p) => {
    const age = kid ? ageText(kid.birthday, p.date) : '';
    const names = kid ? '' : p.kidIds.map((id) => (kids.find((k) => k.id === id) || {}).name).filter(Boolean).join('、');
    const im = p.media.filter((m) => m.kind === 'image').length, vd = p.media.length - im;
    const extra = [im && im + '张照片', vd && vd + '个视频'].filter(Boolean).join('、');
    const cm = p.comments.filter((c) => !c.whisper).slice(0, 2).map((c) => `${userName(c.userId)}说：${c.text.slice(0, 40)}`).join('；');
    return `【${p.date}${age ? '｜' + age : ''}${names ? '｜' + names : ''}】${p.title ? p.title + '。' : ''}${p.body.slice(0, cap)}${extra ? `（附${extra}）` : ''}${cm ? ` 家人评论：${cm}` : ''}`;
  });
  let text = lines.join('\n\n'); if (text.length > 60000) text = text.slice(0, 60000);
  const whoDesc = kid ? `孩子：${kid.name}${kid.birthday ? '（' + kid.birthday + ' 出生）' : ''}` : '孩子们：' + kids.map((k) => k.name + (k.birthday ? '（' + k.birthday + ' 出生）' : '')).join('、');
  const system = '你是一位善于讲故事的家庭记录整理者。根据家人在一段时期里记下的片段，写一篇成长回顾，让孩子长大后读到会会心一笑、也会被打动。要求：' +
    '1. 只使用提供的内容，不编造事实、日期、人物或对话；2. 按时间自然串起来，不要写成流水账，挑出最有意思的几个瞬间展开讲；' +
    '3. 如果能从内容里看出这段时间的变化或成长，点出来；4. 保留孩子说的原话；5. 语气温暖真诚，不煽情，不说教；' +
    `6. 篇幅${r.year ? '800~1500' : '500~900'}字，分 3~6 段，用空行分段，不使用 Markdown 标记；若素材很少就写短一点，不要凑字数。` +
    '只输出 JSON：{"title":"不超过16字的标题","body":"正文"}，不要输出任何其他内容。';
  const user = `${whoDesc}\n时期：${r.label}\n共 ${list.length} 条记录${list.length > 100 ? '（以下均匀抽取了 100 条）' : ''}：\n\n${text}`;
  try {
    const out = parseAi(await aiChat([{ role: 'system', content: system }, { role: 'user', content: user }], { timeout: 180e3 }));
    res.json({ title: out.title || `${r.label} · ${kid ? kid.name + '的' : ''}成长回顾`, body: out.body, count: list.length, date: r.to < localDay() ? r.to : localDay(), kidIds: kid ? [kid.id] : [] });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

/* 存储用量 */
function dirSize(d) {
  let n = 0;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    n += e.isDirectory() ? dirSize(f) : fs.statSync(f).size;
  }
  return n;
}
app.get('/api/stats', needAdmin, (req, res) => {
  let videos = 0, images = 0;
  for (const p of posts.values()) for (const m of p.media) m.kind === 'video' ? videos++ : images++;
  res.json({ posts: posts.size, images, videos, bytes: dirSize(DATA), pending: queue.length + (working ? 1 : 0) });
});

app.use((req, res) => res.status(404).json({ error: '没有这个页面' }));
app.listen(PORT, () => console.log(`成长册已启动：http://localhost:${PORT}  数据目录：${DATA}`));
