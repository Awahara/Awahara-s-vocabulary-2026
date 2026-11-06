// 一次性数据自检脚本：node check-data.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8'), sandbox);

const WORDS = sandbox.window.IELTS_WORDS;
const TOPICS = sandbox.window.IELTS_TOPICS;
const problems = [];
const seen = new Set();

if (!Array.isArray(WORDS) || !WORDS.length) problems.push('词库为空');

for (const [i, it] of WORDS.entries()) {
  const tag = `#${i + 1} ${it.w || '(无词)'}`;
  if (!it.w) problems.push(`${tag}: 缺少 w`);
  if (!it.cn) problems.push(`${tag}: 缺少中文释义`);
  if (!it.en) problems.push(`${tag}: 缺少英文释义`);
  if (!it.ipa || !/^\/.+\/$/.test(it.ipa)) problems.push(`${tag}: 音标格式不对 -> ${it.ipa}`);
  if (!TOPICS.includes(it.t)) problems.push(`${tag}: 主题不在列表 -> ${it.t}`);
  if (!it.p || !/^(n|v|adj|adv)\.$/.test(it.p)) problems.push(`${tag}: 词性格式不对 -> ${it.p}`);

  if (seen.has(it.w)) problems.push(`${tag}: 单词重复`);
  seen.add(it.w);

  const blanks = (it.s.match(/_{2,}/g) || []).length;
  if (blanks !== 1) problems.push(`${tag}: 空格数量 = ${blanks}`);

  const opts = [it.f || it.w, ...(it.o || [])];
  if (!it.o || it.o.length !== 3) problems.push(`${tag}: 干扰项数量不是 3`);
  if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) problems.push(`${tag}: 选项有重复 -> ${opts}`);

  const stem = it.s.replace(/_{2,}/g, ' ||| ');
  const surface = (it.f || it.w).toLowerCase();
  if (stem.toLowerCase().includes(surface)) problems.push(`${tag}: 空格外的句子已经出现答案`);
  if (stem.toLowerCase().includes(it.w.toLowerCase()) && it.w.toLowerCase() !== surface) {
    problems.push(`${tag}: 空格外的句子出现了原形`);
  }
  for (const o of it.o) {
    if (!/^[a-z][a-z'-]*$/.test(o)) problems.push(`${tag}: 干扰项格式可疑 -> ${o}`);
  }
  // 干扰项的句首大写由前端处理，这里只要求数据里为小写
  if ((it.f || '').length && !/^[a-z][a-z'-]*$/.test(it.f)) problems.push(`${tag}: f 形式格式可疑 -> ${it.f}`);
}

const byTopic = {};
for (const it of WORDS) byTopic[it.t] = (byTopic[it.t] || 0) + 1;

console.log('词数：', WORDS.length);
console.log('主题分布：', byTopic);
if (problems.length) {
  console.log('\n发现问题 ' + problems.length + ' 个：');
  problems.forEach((p) => console.log(' - ' + p));
  process.exitCode = 1;
} else {
  console.log('数据校验通过 ✅');
}
