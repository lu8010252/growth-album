// 用 WHO 官方 LMS 表（0-5 岁 Anthro、5-19 岁 AnthroPlus）生成女孩身高/体重参考数据 → public/who.js
// 用法：先 npm pack @pedi-growth/core 解压，node scripts/gen-who.js <解压目录>/package/dist/data
const fs = require('fs'), path = require('path');
const dir = process.argv[2]; if (!dir) throw new Error('需要 WHO 数据目录参数');
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
fs.writeFileSync(path.join(__dirname, '../public/who.js'), '// WHO 儿童生长标准(0-5岁)与生长参考(5-19岁)，女孩，按月龄的 LMS 值。由 scripts/gen-who.js 生成。\nwindow.WHO_GIRLS = ' + JSON.stringify(data) + ';\n');
console.log('ok');
