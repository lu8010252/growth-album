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
const os = require('os');
const { buildMovie, findFont } = require('./movie');

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
const F_MEMBERS = path.join(DATA, 'members.json');
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
let members = readJSON(F_MEMBERS, []); // 家人（爸爸、妈妈、爷爷奶奶……）：可自由添加，用于标记谁出镜，也能用参考照识别
let settings = readJSON(F_SET, { title: '成长册' });
let growth = readJSON(F_GROWTH, []); // 成长数据：{id,kidId,date,height,weight,shoe,note,by}
let qaRecs = readJSON(F_QA, []);     // 生日问答：{id,kidId,age,date,answers:[{q,a}],by}
const DEFAULT_QA = ['最喜欢的颜色？', '最喜欢吃的东西？', '最喜欢的动画片 / 书？', '最好的朋友是谁？', '长大了想做什么？', '最开心的事是什么？', '最害怕什么？', '想对爸爸妈妈说的一句话？'];
const qaQuestions = () => (Array.isArray(settings.qaQuestions) && settings.qaQuestions.length ? settings.qaQuestions : DEFAULT_QA);
let SECRET;
try { SECRET = fs.readFileSync(F_SECRET, 'utf8').trim(); } catch { SECRET = rand(32); fs.writeFileSync(F_SECRET, SECRET, { mode: 0o600 }); }
const saveUsers = () => writeJSON(F_USERS, users);
const saveKids = () => writeJSON(F_KIDS, kids);
const saveMembers = () => writeJSON(F_MEMBERS, members);
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
const memberById = (id) => members.find((m) => m.id === id);
const memberOut = (m) => ({ ...m, refs: (m.refs || []).map((r) => r.id) });
const kidOut = (k) => ({ ...k, refs: (k.refs || []).map((r) => r.id) }); // 参考照片只给前端 id 列表
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
    id: p.id, type: p.type, kidIds: p.kidIds, memberIds: p.memberIds || [], authorId: p.authorId, authorName: userName(p.authorId),
    date: p.date, visibility: p.visibility, createdAt: p.createdAt, ai: !!p.ai, category: catOfPost(p),
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
  res.json({ needSetup: users.length === 0, me: me && pubUser(me), kids: me ? kids.map(kidOut) : [], members: me ? members.map(memberOut) : [], settings: { title: settings.title }, ai: !!me && aiReady(), who: !!me && (aiReady() || !!aiCfg.faceUrl), qaQuestions: me ? qaQuestions() : [] });
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
/* 孩子的参考照片（给「识别是谁」用）：每人最多 5 张，缩成 512px 小图存在 data/kidrefs/ */
const REFS_DIR = path.join(DATA, 'kidrefs'), MAX_REFS = 5;
const refUpload = multer({
  storage: multer.diskStorage({ destination: os.tmpdir(), filename: (req, file, cb) => cb(null, 'ref_' + rand(6) + path.extname(file.originalname).toLowerCase()) }),
  limits: { fileSize: 30 * 1024 * 1024, files: MAX_REFS },
  fileFilter: (req, file, cb) => cb(null, IMG_EXT.has(path.extname(file.originalname).toLowerCase())),
});
function refRoutes(base, find, out, save) {
  app.post(`/api/${base}/:id/refs`, needAdmin, refUpload.array('files', MAX_REFS), async (req, res) => {
    const files = req.files || [], k = find(req.params.id);
    try {
      if (!k) return res.status(404).json({ error: '没有这个人' });
      k.refs = k.refs || [];
      if (!files.length) return res.status(400).json({ error: '没有收到图片' });
      if (k.refs.length >= MAX_REFS) return res.status(400).json({ error: `最多 ${MAX_REFS} 张，先删掉几张再加` });
      const dir = path.join(REFS_DIR, k.id); fs.mkdirSync(dir, { recursive: true });
      let bad = 0;
      for (const f of files) {
        if (k.refs.length >= MAX_REFS) break;
        const id = rand(4), o = path.join(dir, id + '.jpg');
        if (await ff(['-i', f.path, '-vf', "scale='min(512,iw)':-2", '-frames:v', '1', '-q:v', '4', o]) && exists(o)) k.refs.push({ id }); else bad++;
      }
      save(); res.json({ ...out(k), bad });
    } catch (e) { console.error(e); res.status(500).json({ error: '保存失败：' + e.message }); }
    finally { files.forEach((f) => fsp.rm(f.path, { force: true }).catch(() => {})); }
  });
  app.get(`/api/${base}/:id/refs/:rid`, needLogin, (req, res) => {
    const k = find(req.params.id), r = k && (k.refs || []).find((x) => x.id === req.params.rid);
    if (!r) return res.status(404).end();
    res.setHeader('Cache-Control', 'private, max-age=3600'); res.sendFile(path.join(REFS_DIR, k.id, r.id + '.jpg'));
  });
  app.delete(`/api/${base}/:id/refs/:rid`, needAdmin, (req, res) => {
    const k = find(req.params.id); if (!k) return res.status(404).json({ error: '没有这个人' });
    const r = (k.refs || []).find((x) => x.id === req.params.rid);
    if (r) { k.refs = k.refs.filter((x) => x !== r); save(); fsp.rm(path.join(REFS_DIR, k.id, r.id + '.jpg'), { force: true }).catch(() => {}); }
    res.json(out(k));
  });
}
refRoutes('kids', kidById, kidOut, saveKids);
refRoutes('members', memberById, memberOut, saveMembers);
/* 家人（可自由添加：爸爸、妈妈、爷爷、奶奶……） */
const MEMBER_COLORS = ['#5b7fa6', '#b5654f', '#6f9a72', '#9a7bb0', '#c08a3e', '#4f9aa6'];
const memberFields = (b) => ({ name: str(b.name, 20), emoji: str(b.emoji, 4) || '👤' });
app.post('/api/members', needAdmin, (req, res) => {
  const f = memberFields(req.body); if (!f.name) return res.status(400).json({ error: '请填写称呼，比如：爸爸' });
  if (members.length >= 30) return res.status(400).json({ error: '家人太多了，最多 30 位' });
  const m = { id: 'f_' + rand(3), ...f, color: MEMBER_COLORS[members.length % MEMBER_COLORS.length] };
  members.push(m); saveMembers(); res.json(memberOut(m));
});
app.put('/api/members/:id', needAdmin, (req, res) => {
  const m = memberById(req.params.id); if (!m) return res.status(404).json({ error: '没有这位家人' });
  const f = memberFields(req.body); if (!f.name) return res.status(400).json({ error: '请填写称呼' });
  Object.assign(m, f); saveMembers(); res.json(memberOut(m));
});
app.delete('/api/members/:id', needAdmin, (req, res) => {
  members = members.filter((x) => x.id !== req.params.id); saveMembers();
  fsp.rm(path.join(REFS_DIR, req.params.id), { recursive: true, force: true }).catch(() => {});
  for (const p of posts.values()) if ((p.memberIds || []).includes(req.params.id)) { p.memberIds = p.memberIds.filter((x) => x !== req.params.id); savePost(p); }
  res.json({ ok: true });
});
app.delete('/api/kids/:id', needAdmin, (req, res) => {
  kids = kids.filter((x) => x.id !== req.params.id); saveKids();
  fsp.rm(path.join(REFS_DIR, req.params.id), { recursive: true, force: true }).catch(() => {});
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
// 成长记录的分类（日记、时间胶囊不分类）
const CATS = ['daily', 'travel', 'award', 'exam', 'first', 'birthday', 'school', 'hobby', 'festival'];
const catOfPost = (p) => (p.type === 'record' ? (CATS.includes(p.category) ? p.category : 'daily') : '');
function postFields(b, u, old) {
  const type = old ? old.type : (b.type === 'diary' || b.type === 'capsule' ? b.type : 'record');
  const date = isDay(b.date) ? b.date : (old ? old.date : localDay());
  const has = (k) => b[k] !== undefined; // 修改时没传的字段保持原样，避免误清空
  const ids = Array.isArray(b.kidIds) ? b.kidIds : String(b.kidIds || '').split(',');
  const kidIds = has('kidIds') ? ids.filter((id) => kids.some((k) => k.id === id)) : (old ? old.kidIds : []);
  const mids = Array.isArray(b.memberIds) ? b.memberIds : String(b.memberIds || '').split(',');
  const memberIds = has('memberIds') ? mids.filter((id) => members.some((m) => m.id === id)) : (old ? old.memberIds || [] : []);
  const visibility = type === 'record' ? 'family' : has('visibility') ? (b.visibility === 'family' ? 'family' : 'private') : (old ? old.visibility : 'private');
  const category = type !== 'record' ? '' : has('category') ? (CATS.includes(b.category) ? b.category : 'daily') : (old && CATS.includes(old.category) ? old.category : 'daily');
  return {
    type, date, kidIds, memberIds, visibility, category,
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
function filterPosts(req) {
  const { kid, type, q, cat, member, media } = req.query;
  let list = [...posts.values()].filter((p) => p.type !== 'capsule' && canView(req.user, p));   // 胶囊有自己的页面
  if (type) list = list.filter((p) => p.type === type);
  if (cat && CATS.includes(cat)) list = list.filter((p) => catOfPost(p) === cat);
  if (kid === 'together') list = list.filter((p) => p.kidIds.length >= 2);   // 双宝日常：两个以上孩子同框
  else if (kid) { const ids = String(kid).split(',').filter(Boolean); list = list.filter((p) => ids.every((id) => p.kidIds.includes(id))); }   // 多个孩子＝都在场（同框）
  if (['image', 'video', 'audio'].includes(media)) list = list.filter((p) => p.media.some((m) => m.kind === media));   // 只看带图片/视频/音频的
  if (member) list = list.filter((p) => (p.memberIds || []).includes(member));   // 家人出镜；和 kid 同时给＝两人同框
  if (q) { const s = String(q).toLowerCase(); list = list.filter((p) => (p.title + ' ' + p.body + ' ' + p.media.map((m) => m.name).join(' ')).toLowerCase().includes(s)); }
  return list;
}
// 每个月有几条（同样的筛选条件），给首页「快速跳转」用；要放在 /api/posts/:id 前面
app.get('/api/posts/months', needLogin, (req, res) => {
  const m = {};
  for (const p of filterPosts(req)) { const k = String(p.date).slice(0, 7); m[k] = (m[k] || 0) + 1; }
  res.json(Object.entries(m).sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([ym, n]) => ({ ym, n })));
});
app.get('/api/posts', needLogin, (req, res) => {
  const offset = Math.max(0, +req.query.offset || 0), limit = Math.min(50, +req.query.limit || 20);
  let list = filterPosts(req);
  if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '')) list = list.filter((p) => p.date <= req.query.to);   // 从这一天往前看
  list.sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1));
  res.json({ total: list.length, items: list.slice(offset, offset + limit).map((p) => toClient(p, req.user)) });
});
const getPost = (req, res) => {
  const p = posts.get(req.params.id);
  if (!p || !canView(req.user, p)) { res.status(404).json({ error: '找不到这条记录' }); return null; }
  return p;
};
app.get('/api/posts/:id', needLogin, (req, res) => { const p = getPost(req, res); if (p) res.json(toClient(p, req.user)); });

// 分类相册：每个分类的条数和封面（最新一条带图的记录）
app.get('/api/cats', needLogin, (req, res) => {
  const out = {};
  const list = [...posts.values()].filter((p) => p.type === 'record' && canView(req.user, p)).sort((a, b) => (a.date < b.date ? 1 : -1));
  for (const p of list) {
    const o = out[catOfPost(p)] || (out[catOfPost(p)] = { count: 0, cover: '' });
    o.count++;
    if (!o.cover) {
      const m = p.media.find((x) => x.kind === 'image' || (x.kind === 'video' && x.poster));
      if (m) { const mo = mediaOut(p.id, m); o.cover = m.kind === 'video' ? mo.poster : (mo.thumb || mo.url); }
    }
  }
  res.json(out);
});
// 那年今日：往年同一天及前后 3 天的记录（按「几年前」分组，同一年里越接近今天越靠前）
app.get('/api/onthisday', needLogin, (req, res) => {
  const t = localDay(), y = +t.slice(0, 4), DAY = 864e5, T = Date.UTC(y, +t.slice(5, 7) - 1, +t.slice(8, 10)), found = [];
  for (const p of posts.values()) {
    if (p.type === 'capsule' || !canView(req.user, p)) continue;
    const m = +p.date.slice(5, 7) - 1, d = +p.date.slice(8, 10);
    let best = null;
    for (const yy of [y - 1, y, y + 1]) {          // 周年日可能落在今年、去年或明年（跨年的前后几天）
      const off = Math.round((Date.UTC(yy, m, d) - T) / DAY), ago = yy - +p.date.slice(0, 4);
      if (ago >= 1 && Math.abs(off) <= 3 && (!best || Math.abs(off) < Math.abs(best.off))) best = { off, ago };
    }
    if (best) found.push({ p, ...best });
  }
  found.sort((a, b) => a.ago - b.ago || Math.abs(a.off) - Math.abs(b.off) || (a.p.date < b.p.date ? 1 : -1));
  res.json(found.slice(0, 12).map(({ p, off, ago }) => ({ ...toClient(p, req.user), ago, off })));
});

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
    title: settings.title, exportedAt: today, forKid: kid ? kid.id : null, kids: kids.map(({ refs, ...k }) => k), members: members.map(({ refs, ...m }) => m), questions: qaQuestions(),
    growth: growth.filter((g) => !kid || g.kidId === kid.id).sort((a, b) => (a.date < b.date ? -1 : 1)).map((g) => ({ kidId: g.kidId, date: g.date, height: g.height, weight: g.weight, shoe: g.shoe, note: g.note })),
    qa: qaRecs.filter((r) => !kid || r.kidId === kid.id).sort((a, b) => a.age - b.age).map((r) => ({ kidId: r.kidId, age: r.age, date: r.date, answers: r.answers })),
    posts: list.map((p) => ({
      id: p.id, type: p.type, category: catOfPost(p), date: p.date, title: p.title, body: p.body, kidIds: p.kidIds, memberIds: p.memberIds || [], author: userName(p.authorId),
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
    const md = `# ${p.title || '(无标题)'}\n\n- ${p.type === 'capsule' ? '封存于' : '日期'}：${p.date}${p.type === 'capsule' ? '，' + p.unlockDate + ' 开启' : ''}\n- 作者：${userName(p.authorId)}\n- 关于：${p.kidIds.map((id) => (kids.find((k) => k.id === id) || {}).name).filter(Boolean).join('、') || '全家'}${(p.memberIds || []).length ? '\n- 出镜：' + p.memberIds.map((id) => (memberById(id) || {}).name).filter(Boolean).join('、') : ''}\n\n${p.body}\n\n` +
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

/* ---------- 回顾视频：把照片做成 1080p MP4，生日时可在大屏上播放 ---------- */
const MOVIE_DIR = path.join(os.tmpdir(), 'growth-album-movies');
fsp.rm(MOVIE_DIR, { recursive: true, force: true }).catch(() => {});   // 重启后清掉上次遗留的临时文件
const movies = new Map(); let movieBusy = false;
function ageShort(b, d) {
  if (!b || d < b) return '';
  const x = b.split('-').map(Number), y = d.split('-').map(Number);
  let tm = (y[0] - x[0]) * 12 + y[1] - x[1]; if (y[2] < x[2]) tm--;
  if (tm < 0) return ''; const Y = Math.floor(tm / 12), M = tm % 12;
  return Y ? (M ? `${Y}岁${M}个月` : `${Y}岁`) : (M ? `${M}个月` : '不满1个月');
}
const cut = (t, n) => { const a = [...String(t || '').replace(/\s+/g, ' ').trim()]; return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join(''); };
const dateCn = (d) => { const [y, m, dd] = d.split('-').map(Number); return `${y}年${m}月${dd}日`; };
const MOVIE_MAX = 120;   // 最多多少张照片（超过就均匀抽样），免得视频太长、服务器忙太久
app.post('/api/movie', needLogin, (req, res) => {
  if (!findFont()) return res.status(500).json({ error: '服务器缺少中文字体，请把镜像更新到最新版（docker compose pull && docker compose up -d）' });
  if (movieBusy) return res.status(409).json({ error: '正在生成另一个视频，请等它完成后再试' });
  const b = req.body || {}, kid = kids.find((k) => k.id === b.kid);
  const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '');
  const since = day(b.since), until = day(b.until), secs = Math.min(Math.max(+b.secs || 4, 3), 8);
  // 只用「成长记录」：日记、时间胶囊不进视频（视频会拿到大屏上给很多人看）；视频文件不用，只取照片
  let list = [...posts.values()].filter((p) => p.type === 'record' && canView(req.user, p) && (!kid || p.kidIds.includes(kid.id) || !p.kidIds.length) && (!since || p.date >= since) && (!until || p.date <= until));
  list.sort((a, c) => (a.date < c.date ? -1 : a.date > c.date ? 1 : a.createdAt < c.createdAt ? -1 : 1));
  let slides = [];
  for (const p of list) {
    const ks = (kid ? [kid] : p.kidIds.map(kidById).filter(Boolean)).filter((k) => k.birthday);
    const line2 = [dateCn(p.date), ...ks.map((k) => `${ks.length > 1 || !kid ? k.name + ' ' : ''}${ageShort(k.birthday, p.date)}`)].join(' · ');
    const line1 = cut(p.title || (p.body || '').split('\n')[0], 22);
    for (const m of p.media.filter((x) => x.kind === 'image').slice(0, 2)) {
      const f = path.join(postDir(p.id), 'files', m.view || m.file);
      if (fs.existsSync(f)) slides.push({ file: f, line1, line2, date: p.date });
    }
  }
  if (!slides.length) return res.status(400).json({ error: '这个范围内没有可用的照片（只用「成长记录」里的照片）' });
  if (slides.length > MOVIE_MAX) slides = Array.from({ length: MOVIE_MAX }, (_, i) => slides[Math.floor((i * slides.length) / MOVIE_MAX)]);
  for (const [id, j] of movies) if (Date.now() - j.at > 6 * 3600e3) { fsp.rm(j.file, { force: true }).catch(() => {}); movies.delete(id); }
  const id = rand(6), job = { id, userId: req.user.id, state: 'running', done: 0, total: slides.length + 2, at: Date.now(), file: path.join(MOVIE_DIR, id + '.mp4'),
    name: `${slug(settings.title) || '成长册'}-${kid ? slug(kid.name) : '全家'}-回顾.mp4` };
  movies.set(id, job); movieBusy = true;
  const names = (kid ? [kid] : kids).map((k) => k.name).join('、'), r = `${slides[0].date.slice(0, 7).replace('-', '.')} – ${slides[slides.length - 1].date.slice(0, 7).replace('-', '.')}`;
  fsp.mkdir(MOVIE_DIR, { recursive: true })
    .then(() => buildMovie(slides, { title: settings.title || '成长册', line2: `${names} 的成长回顾`, line3: r, outFile: job.file, workDir: path.join(MOVIE_DIR, 'w_' + id), secs, onProgress: (d) => { job.done = d; } }))
    .then(() => { job.state = 'done'; job.done = job.total; job.size = fs.statSync(job.file).size; })
    .catch((e) => { console.error('movie', e.message); job.state = 'error'; job.error = '生成失败：' + e.message.slice(0, 160); fsp.rm(path.join(MOVIE_DIR, 'w_' + id), { recursive: true, force: true }).catch(() => {}); })
    .finally(() => { movieBusy = false; });
  res.json({ id, total: slides.length });
});
const myMovie = (req, res) => { const j = movies.get(req.params.id); if (!j || (j.userId !== req.user.id && req.user.role !== 'admin')) { res.status(404).json({ error: '没有这个视频（可能已过期，重新生成一次即可）' }); return null; } return j; };
const movieInfo = (j) => ({ id: j.id, state: j.state, done: j.done, total: j.total, size: j.size, error: j.error, name: j.name, at: j.at });
app.get('/api/movie', needLogin, (req, res) => res.json([...movies.values()].filter((j) => j.userId === req.user.id).sort((a, b) => b.at - a.at).map(movieInfo)));
app.get('/api/movie/:id', needLogin, (req, res) => { const j = myMovie(req, res); if (j) res.json(movieInfo(j)); });
app.get('/api/movie/:id/file', needLogin, (req, res) => {
  const j = myMovie(req, res); if (!j) return;
  if (j.state !== 'done') return res.status(409).json({ error: '还没生成完' });
  if (req.query.inline) return res.sendFile(j.file, { headers: { 'Content-Type': 'video/mp4' } });   // 在线播放（支持拖动进度）
  res.download(j.file, j.name);
});
app.delete('/api/movie/:id', needLogin, (req, res) => {
  const j = myMovie(req, res); if (!j) return;
  if (j.state === 'running') return res.status(409).json({ error: '还在生成中，做完以后再删' });
  fsp.rm(j.file, { force: true }).catch(() => {}); movies.delete(j.id); res.json({ ok: true });
});

/* ---------- AI 助手 ----------
   走 OpenAI 兼容的 /chat/completions：API 中转站、Hermes Agent 的 API Server 都可以。
   隐私：成长回顾只用「成长记录」，日记（包括孩子的）一律不参与；
   「帮我写」只发送用户当前在输入框里、主动点击按钮的那段文字。 */
async function aiChat(messages, { temperature = 0.7, timeout = 180e3, model } = {}) {
  const url = aiCfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  let r;
  try {
    r = await fetch(url, {
      method: 'POST', signal: AbortSignal.timeout(timeout),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + aiCfg.apiKey },
      body: JSON.stringify({ model: model || aiCfg.model, messages, temperature, stream: false }),
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

app.get('/api/ai/config', needAdmin, (req, res) => res.json({ baseUrl: aiCfg.baseUrl, model: aiCfg.model, hasKey: !!aiCfg.apiKey, visionModel: aiCfg.visionModel || '', faceUrl: aiCfg.faceUrl || '', hasFaceKey: !!aiCfg.faceKey }));
app.put('/api/ai/config', needAdmin, (req, res) => {
  const baseUrl = str(req.body.baseUrl, 300), model = str(req.body.model, 100), key = str(req.body.apiKey, 500);
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) return res.status(400).json({ error: '地址要以 http:// 或 https:// 开头' });
  aiCfg.baseUrl = baseUrl; aiCfg.model = model;
  if (key) aiCfg.apiKey = key;
  if (req.body.clearKey) aiCfg.apiKey = '';
  // 「识别是谁」的可选设置：视觉模型名（主模型不能看图时单独指定）、自建人脸识别接口
  if (req.body.visionModel !== undefined) aiCfg.visionModel = str(req.body.visionModel, 100);
  if (req.body.faceUrl !== undefined) {
    const fu = str(req.body.faceUrl, 300);
    if (fu && !/^https?:\/\//i.test(fu)) return res.status(400).json({ error: '识别接口地址要以 http:// 或 https:// 开头' });
    aiCfg.faceUrl = fu;
  }
  if (str(req.body.faceKey, 500)) aiCfg.faceKey = str(req.body.faceKey, 500);
  saveAi(); res.json({ ok: true, ready: aiReady() });
});
const aiBusy = new Set();
const aiBusyGuard = (req, res, next) => {
  if (aiBusy.has(req.user.id)) return res.status(429).json({ error: '上一个 AI 请求还没完成，稍等一下' });
  aiBusy.add(req.user.id); res.on('close', () => aiBusy.delete(req.user.id)); next();
};
const aiGuard = (req, res, next) => {
  if (!aiReady()) return res.status(400).json({ error: '管理员还没有配置 AI（「我的」页 → AI 助手）' });
  aiBusyGuard(req, res, next);
};
app.post('/api/ai/test', needAdmin, async (req, res) => {
  try { res.json({ reply: (await aiChat([{ role: 'user', content: '请只回复“收到”两个字。' }], { timeout: 60e3 })).slice(0, 60) }); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

/* ---------- 识别照片里是谁 ----------
   两种后端，二选一（设置了 faceUrl 就走自建接口，否则走视觉大模型）：
   1) 视觉大模型：OpenAI 兼容接口，要求模型能看图。把每个孩子的「参考照片」和待识别照片一起发过去，让模型对照着认。
   2) 自建接口（faceUrl）：可以接 CompreFace / DeepFace 之类的本地人脸识别服务，约定见 README。
   只在用户点「识别是谁」时才发送；发出去的是缩小后的照片，不会发送日记或文字。 */
const whoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 6 } });
const refB64 = async (k) => (await Promise.all((k.refs || []).map((r) => fsp.readFile(path.join(REFS_DIR, k.id, r.id + '.jpg')).then((b) => b.toString('base64')).catch(() => null)))).filter(Boolean);
app.post('/api/ai/who', needWrite, (req, res, next) => (aiCfg.faceUrl || aiReady() ? aiBusyGuard(req, res, next) : res.status(400).json({ error: '管理员还没有配置 AI（「我的」页 → AI 助手）' })), whoUpload.array('images', 6), async (req, res) => {
  try {
    const imgs = (req.files || []).filter((f) => /^image\//.test(f.mimetype));
    if (!imgs.length) return res.status(400).json({ error: '没有收到可识别的照片' });
    const cand = [...kids.map((k) => ({ ...k, kind: 'kid' })), ...members.map((m) => ({ ...m, kind: 'member' }))].filter((k) => (k.refs || []).length);
    if (!cand.length) return res.status(400).json({ error: '还没有参考照片：「我的」页 → 孩子 / 家人 → 📷 参考照，每人传 2~5 张清楚的正脸照' });
    const date = isDay(req.body.date) ? req.body.date : localDay();
    const refs = new Map(); for (const k of cand) refs.set(k.id, await refB64(k));
    const ageOf = (k) => (k.birthday ? ageText(k.birthday, date) : '');
    let photos; // 每张照片认出的孩子 id 数组，顺序同 imgs
    if (aiCfg.faceUrl) {
      let r;
      try {
        r = await fetch(aiCfg.faceUrl, {
          method: 'POST', signal: AbortSignal.timeout(120e3),
          headers: { 'Content-Type': 'application/json', ...(aiCfg.faceKey ? { Authorization: 'Bearer ' + aiCfg.faceKey } : {}) },
          body: JSON.stringify({ date, candidates: cand.map((k) => ({ id: k.id, kind: k.kind, name: k.name, birthday: k.birthday || '', age: ageOf(k), refs: refs.get(k.id) })), images: imgs.map((f) => f.buffer.toString('base64')) }),
        });
      } catch (e) { return res.status(502).json({ error: '连不上识别接口：' + (e.name === 'TimeoutError' ? '等太久超时了' : (e.cause && e.cause.code) || e.message) }); }
      const d = await r.json().catch(() => null);
      if (!r.ok || !d) return res.status(502).json({ error: `识别接口返回 ${r.status}` });
      const arr = Array.isArray(d.results) ? d.results : [{ kidIds: d.kidIds }];
      photos = imgs.map((_, i) => ((arr[i] && arr[i].kidIds) || []).filter((id) => cand.some((k) => k.id === id)));
    } else {
      const parts = [{ type: 'text', text: '下面先给出每个孩子的参考照片，再给出待识别的照片。' }];
      for (const k of cand) {
        parts.push({ type: 'text', text: `【${k.name}${k.kind === 'member' ? '（大人）' : ''}${ageOf(k) ? `（拍待识别照片那天约${ageOf(k)}）` : ''}的参考照片，共${refs.get(k.id).length}张】` });
        for (const b of refs.get(k.id)) parts.push({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b } });
      }
      parts.push({ type: 'text', text: `【待识别的照片，共${imgs.length}张】` });
      imgs.forEach((f, i) => { parts.push({ type: 'text', text: `照片${i + 1}：` }); parts.push({ type: 'image_url', image_url: { url: `data:${f.mimetype};base64,` + f.buffer.toString('base64') } }); });
      const names = cand.map((k) => k.name).join('、');
      const system = `你是家庭相册的人物识别助手。根据参考照片，判断每张待识别的照片里出现了哪几个人（孩子或大人）。可选的名字只有：${names}。` +
        '规则：只能从这些名字里选；一张照片里可以有多人，请全部列出；孩子会随年龄长大，请结合参考照片的脸型、五官和给出的年龄综合判断；姐妹之间可能长得像，没把握就不要选；照片里没有人脸、脸看不清、只有大人或别的孩子，names 就给空数组，不要猜。' +
        '只输出 JSON：{"photos":[{"index":1,"names":["名字"]}]}，index 从 1 开始，每张待识别的照片都要有一项，不要输出任何其他内容。';
      let text;
      try { text = await aiChat([{ role: 'system', content: system }, { role: 'user', content: parts }], { temperature: 0, timeout: 180e3, model: aiCfg.visionModel || aiCfg.model }); }
      catch (e) { return res.status(502).json({ error: e.message + '（识别需要能看图的模型，可在「AI 助手 → 设置」里单独填视觉模型名）' }); }
      const a = text.indexOf('{'), b = text.lastIndexOf('}'); let o = null;
      if (a >= 0 && b > a) { try { o = JSON.parse(text.slice(a, b + 1)); } catch {} }
      if (!o || !Array.isArray(o.photos)) return res.status(502).json({ error: 'AI 返回的格式看不懂，再试一次' });
      photos = imgs.map((_, i) => {
        const it = o.photos.find((x) => +x.index === i + 1);
        return ((it && Array.isArray(it.names) ? it.names : []).map((n) => (cand.find((k) => k.name === String(n).trim()) || {}).id)).filter(Boolean);
      });
    }
    const all = [...new Set(photos.flat())];
    res.json({ kidIds: all.filter((id) => kidById(id)), memberIds: all.filter((id) => memberById(id)), photos, count: imgs.length });
  } catch (e) { console.error(e); res.status(500).json({ error: '识别失败：' + e.message }); }
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
