// 生成女孩身高/体重参考数据 → public/who.js
//  · WHO：官方 LMS 表（0-5 岁 Anthro、5-19 岁 AnthroPlus），来自 npm 包 @pedi-growth/core
//  · 中国：国家卫健委 WS/T 423—2022《7岁以下儿童生长标准》七条 SD 阈值，来自 npm 包 child-growth-eval
// 用法：npm pack 两个包并解压，node scripts/gen-who.js <@pedi-growth/core>/package/dist/data <child-growth-eval>/package/references/china_growth_standard_2022.json
const fs = require('fs'), path = require('path');
const dir = process.argv[2], cnFile = process.argv[3]; if (!dir || !cnFile) throw new Error('需要 WHO 数据目录和国标 json 两个参数');
const rd = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const DAY = 30.4375, byAge = (a) => new Map(a.map((r) => [r.age, r]));
function build(early, late, maxM) { // early: 按天(0-5岁)，late: 按月(61 个月起)
  const e = byAge(rd(early)), l = byAge(rd(late)), out = { L: [], M: [], S: [] };
  for (let m = 0; m <= maxM; m++) {
    const r = m >= 61 ? l.get(m) : e.get(Math.round(m * DAY));
    if (!r) throw new Error('缺少月龄 ' + m);
    out.L.push(+r.L.toFixed(4)); out.M.push(+r.M.toFixed(3)); out.S.push(+r.S.toFixed(5));
  }
  return out;
}
const data = { height: build('lhfa-girls-0-5.json', 'hfa-girls-5-19.json', 228), weight: build('wfa-girls-0-5.json', 'wfa-girls-5-10.json', 120) };
const cn = JSON.parse(fs.readFileSync(cnFile, 'utf8')).ageBased.girl, cnOut = {};
for (const [k, key] of [['height', 'stature'], ['weight', 'weight']]) cnOut[k] = { m: cn[key].map((r) => r[0]), v: cn[key].map((r) => r.slice(1)) }; // 每行 -3SD…+3SD
fs.writeFileSync(path.join(__dirname, '../public/who.js'), '// 女孩生长参考：WHO_GIRLS=WHO 按月龄 LMS；CN_GIRLS=中国 WS/T 423—2022（7岁以下）按月龄的 -3~+3SD。由 scripts/gen-who.js 生成。\nwindow.WHO_GIRLS = ' + JSON.stringify(data) + ';\nwindow.CN_GIRLS = ' + JSON.stringify(cnOut) + ';\n');
console.log('ok');
