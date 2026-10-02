// 「题号栏按题型分段」的离线断言（2026-10-02，rabbit：网页版也一起改）。
//
// 覆盖：
//   ① 题型识别区块（exam.ts 的 题型识别 → groupQuestionsByCategory 一整段，esbuild 现场编译真实现）；
//   ② groupQuestionsByCategory 分组：组序=首次出现序、组内保持输入顺序、first 指向组内第一题的输入下标；
//   ③ 三个视图（练习页/公共练习页/考试页）的接线守卫（文本级）。
//
// 用法: node tests/question-nav-group.test.cjs
const fs = require('fs')
const path = require('path')
const esbuild = require('esbuild')

const ROOT = path.resolve(__dirname, '..')
const EXAM = path.join(ROOT, 'src/lib/exam.ts')
const PRACTICE = path.join(ROOT, 'src/views/PracticeView.vue')
const PUBLIC = path.join(ROOT, 'src/views/PublicPracticeView.vue')
const TAKE = path.join(ROOT, 'src/views/ExamTakeView.vue')

// 区域切片：题型识别区块（anchor → groupQuestionsByCategory 的顶格 }）
const lines = fs.readFileSync(EXAM, 'utf8').split(/\r?\n/)
const start = lines.findIndex(l => l.includes('题型识别（统一 content-based）'))
if (start < 0) throw new Error('切片失败：找不到「题型识别」区块（改过形状的话判据要跟着改，别让守卫静默放行）')
const defLine = lines.findIndex(l => /^export function groupQuestionsByCategory/.test(l))
if (defLine < 0) throw new Error('切片失败：找不到 groupQuestionsByCategory（功能尚未实现）')
let end = -1
for (let i = defLine + 1; i < lines.length; i++) if (lines[i] === '}') { end = i; break }
if (end < 0) throw new Error('切片失败：groupQuestionsByCategory 没有顶格收尾 }')
const src = lines.slice(start, end + 1).join('\n').replace(/^export\s+/gm, '')
const js = esbuild.transformSync(src, { loader: 'ts' }).code
const M = new Function(`${js}\nreturn { classifyQuestionType, TYPE_LABELS, groupQuestionsByCategory }`)()

let failed = 0
const ok = m => console.log('   ✓ ' + m)
const bad = m => { console.log('   ✗ ' + m); failed++ }
const eq = (got, want, m) => { if (JSON.stringify(got) === JSON.stringify(want)) ok(m); else bad(`${m}（实际 ${JSON.stringify(got)}，期望 ${JSON.stringify(want)}）`) }

console.log('— ① 题型识别（既有口径抽查）')
eq(M.classifyQuestionType({ type: 'single', options: '["正确","错误"]', answer: 'A' }), 'judge',
  '判断题存成单选（["正确","错误"]）→ judge（内容识别）')
eq(M.classifyQuestionType({ type: 'single', options: '["A. 面向对象","B. 面向过程"]', answer: 'A' }), 'single',
  '反证：含「对」字的普通选项 → single')
eq(M.classifyQuestionType({ type: 'blank', options: '[]', answer: 'CH4' }), 'blank',
  '反证：填空答案含多字母（CH4）→ blank（不被多选启发式拐走）')
eq(M.classifyQuestionType({ type: 'qa', options: '[]', answer: '略' }), 'qa', '声明 qa → qa')
eq(M.TYPE_LABELS, { single: '单选', multi: '多选', judge: '判断', blank: '填空', qa: '问答' }, '五类短名标签表')

console.log('\n— ② groupQuestionsByCategory 分组')
const S = { type: 'single', options: '["甲","乙"]', answer: 'A' }
const Mq = { type: 'multi', options: '["甲","乙","丙"]', answer: 'AB' }
const J = { type: 'single', options: '["正确","错误"]', answer: 'A' } // 内容识别 = judge

eq(M.groupQuestionsByCategory([]), [], '空输入 → 空分组')
const g1 = M.groupQuestionsByCategory([S, S, S])
eq([g1.length, g1[0].cat, g1[0].label, g1[0].count, g1[0].first], [1, 'single', '单选', 3, 0], '单类型组头字段')
const g2 = M.groupQuestionsByCategory([S, Mq, S, J])
eq(g2.map(g => g.cat), ['single', 'multi', 'judge'], '组序 = 首次出现序（J 判定为 judge）')
eq(g2[0].indexes, [0, 2], '反证：组内保持输入顺序（single 命中 0、2，不被重排）')
eq(g2[2].first, 3, 'judge 组 first=3（点组头就跳这题）')

console.log('\n— ③ 三个视图的接线守卫（文本级）')
const practice = fs.readFileSync(PRACTICE, 'utf8')
const pub = fs.readFileSync(PUBLIC, 'utf8')
const take = fs.readFileSync(TAKE, 'utf8')
const checks = [
  [practice, /import \{[^}]*\bTYPE_LABELS\b[^}]*\bgroupQuestionsByCategory\b[^}]*\} from '\.\.\/lib\/exam'/, '练习页：从 lib/exam 引入 TYPE_LABELS + groupQuestionsByCategory'],
  [practice, /const TYPE_LABELS: Record<string, string> = \{ single/, '练习页：本地 TYPE_LABELS 已删除（单一来源）', true],
  [practice, /const navGroups = computed/, '练习页：navGroups 计算属性存在'],
  [practice, /class="nav-group-title/, '练习页：分段组头存在'],
  [practice, /goToQuestion\(g\.first\)/, '练习页：点组头跳该组第一题'],
  [pub, /import \{[^}]*\bgroupQuestionsByCategory\b[^}]*\} from '\.\.\/lib\/exam'/, '公共练习页：引入 groupQuestionsByCategory'],
  [pub, /const navGroups = computed/, '公共练习页：navGroups 计算属性存在'],
  [pub, /class="nav-group-title/, '公共练习页：分段组头存在'],
  [pub, /current = g\.first/, '公共练习页：点组头跳该组第一题'],
  [take, /import \{[^}]*\bgroupQuestionsByCategory\b[^}]*\} from '\.\.\/lib\/exam'/, '考试页：引入 groupQuestionsByCategory'],
  [take, /const navGroups = computed/, '考试页：navGroups 计算属性存在'],
  [take, /class="nav-group-title/, '考试页：分段组头存在'],
  [take, /current = g\.first/, '考试页：点组头跳该组第一题'],
]
for (const [src, re, msg, absent] of checks) {
  const hit = re.test(src)
  if (absent) { hit ? bad(msg + ' —— 仍然存在') : ok(msg) }
  else { hit ? ok(msg) : bad(msg + ' —— 没找到') }
}

console.log(failed ? `\n有失败：${failed} 项` : '\n全绿')
process.exit(failed ? 1 : 0)
