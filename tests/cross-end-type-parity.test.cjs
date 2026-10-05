// 跨端题型判定一致性（2026-10-05）
//
// 背景：两端各有一份「内容法判定题型」实现 —— 网页版 exam.ts 的 classifyQuestionType、
// 小程序 quiz.ts 的 classifyType。二者本该给出同一题型，但网页版「答案本身是判断词」
// 那一步一直**没有选项数门禁**，小程序端有（P1-2 修过）。分叉区间＝
// 「选项数恰为 1 且答案命中判断词」⇒ 网页判 judge（只渲染 √/×、真实选项丢失、无法作答），
// 小程序判 single。本次已给网页版补上同款门禁。
//
// 本测试**从真实源码取函数体**（切片 + esbuild 去 TS + new Function），不手抄逻辑——
// 手抄的副本会随源码漂移，守护力归零。
//
// ⚠️ 已知**设计差异**（不是分叉，不纳入对照）：
//   小程序端只有 single/multi/judge 三型（`classifyType` 的返回类型），**没有 blank/qa**——
//   声明为 blank/qa 的题在小程序一律归 single（quiz.ts 的注释写明这是刻意为之）。网页版有五型。
//   故本测试只比对两端**都可能判出的三型**（single/multi/judge）；blank/qa 相关用例不入表。
//
// 跑法：node tests/cross-end-type-parity.test.cjs   （两仓并列才有意义，否则跳过 rc=0）
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const WEB = path.join(ROOT, 'shuati-pwa', 'src', 'lib', 'exam.ts')
const MP = path.join(ROOT, 'yuntu-mp', 'src', 'lib', 'quiz.ts')

if (!fs.existsSync(WEB) || !fs.existsSync(MP)) {
  console.log('[skip] 两仓不并列（缺 shuati-pwa 或 yuntu-mp），题型一致性检查跳过')
  process.exit(0)
}

// ---- esbuild 去 TS（本宿主 buildSync 读文件被拒，transformSync 可用）----
let esbuild = null
try {
  esbuild = require(path.join(ROOT, 'shuati-pwa', 'node_modules', 'esbuild'))
} catch {
  try { esbuild = require('esbuild') } catch { esbuild = null }
}
if (!esbuild || typeof esbuild.transformSync !== 'function') {
  console.log('[skip] 取不到 esbuild.transformSync，跳过（不影响构建链）')
  process.exit(0)
}
// 先剥 `export ` 再 transform：带 export 的源码会被 transformSync 当作模块处理，
// 而模块顶层不允许出现 `return`（后面的包装需要它）。带上 `format:'cjs'` 又会引入 `module` 引用。
// 所以顺序是「去 export → 保留默认 format」。
const toJs = (ts) => esbuild.transformSync(ts.replace(/\bexport\s+/g, ''), { loader: 'ts' }).code

// ---- 切片器：从锚点行取到顶格 `}` 或文件末尾的块 ----
// 单行声明（不以 `{` 结尾）只取一行，否则会把整个文件吞进来（重复声明报错）。
function slice(lines, anchorRe, fromLine = 0) {
  let s = -1
  for (let i = fromLine; i < lines.length; i++) {
    if (anchorRe.test(lines[i])) { s = i; break }
  }
  if (s < 0) throw new Error('找不到锚点：' + anchorRe)
  if (!/\{\s*$/.test(lines[s])) return lines[s]
  for (let i = s + 1; i < lines.length; i++) {
    if (lines[i] === '}') return lines.slice(s, i + 1).join('\n')
  }
  return lines.slice(s).join('\n')
}

// 截取两块源码之间的一段（含头不含尾），用于把常量/helper 一并带上
function between(text, startRe, endRe) {
  const s = text.search(startRe)
  if (s < 0) throw new Error('找不到起锚：' + startRe)
  const rest = text.slice(s)
  const e = rest.search(endRe)
  if (e < 0) throw new Error('找不到止锚：' + endRe)
  return rest.slice(0, e)
}

const webSrc = fs.readFileSync(WEB, 'utf8').replace(/\r\n/g, '\n')
const mpSrc = fs.readFileSync(MP, 'utf8').replace(/\r\n/g, '\n')
const webLines = webSrc.split('\n')
const mpLines = mpSrc.split('\n')

// ---- 网页版：JUDGE_* 常量 + RE_OPT_PREFIX + stripOptionPrefix + isJudgeWord
//      + normalizeMultiAnswer + classifyQuestionType ----
const webJudgeConsts = between(webSrc, /const JUDGE_TRUE_WORDS/, /^const RE_OPT_PREFIX/m)
const webOptPrefix = slice(webLines, /^const RE_OPT_PREFIX/)
const webStrip = slice(webLines, /^(export )?function stripOptionPrefix/)
const webIsJudge = slice(webLines, /^function isJudgeWord/)
const webMultiConsts = between(webSrc, /^const RE_MULTI_NOISE/m, /^export function classifyQuestionType/m)
const webNormalizeMulti = slice(webLines, /^export function normalizeMultiAnswer/)
const webClassify = slice(webLines, /^export function classifyQuestionType/)

// ---- 小程序端：JUDGE_* 常量 + RE_OPT_PREFIX + stripOptionPrefix + isJudgeWord
//      + normalizeMultiAnswer + optionsOf + letter + classifyType ----
const mpJudgeConsts = between(mpSrc, /const JUDGE_TRUE =/, /^const RE_OPT_PREFIX/m)
const mpOptPrefix = slice(mpLines, /^const RE_OPT_PREFIX/)
const mpStrip = slice(mpLines, /^function stripOptionPrefix/)
const mpIsJudge = slice(mpLines, /^function isJudgeWord/)
const mpMultiConsts = between(mpSrc, /^const RE_MULTI_NOISE/m, /^export function letter/m)
const mpNormalizeMulti = slice(mpLines, /^export function normalizeMultiAnswer/)
const mpOptionsOf = slice(mpLines, /^function optionsOf/)
const mpLetter = slice(mpLines, /^export function letter/)
const mpClassify = slice(mpLines, /^(export )?function classifyType/)

// 源码片段 + 变量声明组成一个函数体。**不用 `return`**：transformSync 的输出被当作模块，
// 顶层 return 会报 "Top-level return cannot be used inside an ECMAScript module"。
// 改为「把导出赋给局部变量、再由 Function 末尾取回」。
function build(parts, exportName) {
  const code = toJs(parts.join('\n\n'))
  // eslint-disable-next-line no-new-func
  return new Function(`var __out__ = null;\n${code}\n__out__ = ${exportName};\nreturn __out__`)()
}

let classifyWeb, classifyMp
const webParts = [webJudgeConsts, webOptPrefix, webStrip, webIsJudge, webMultiConsts, webNormalizeMulti, webClassify]
const mpParts = [mpJudgeConsts, mpOptPrefix, mpStrip, mpIsJudge, mpMultiConsts, mpNormalizeMulti, mpOptionsOf, mpLetter, mpClassify]
try {
  // web 与 mp 的函数名不同（classifyQuestionType / classifyType），其余同名 helper 各自独立作用域。
  classifyWeb = build(webParts, 'classifyQuestionType')
  classifyMp = build(mpParts, 'classifyType')
} catch (e) {
  console.error('编译真实源码失败：', e.message)
  process.exit(1)
}
if (typeof classifyWeb !== 'function' || typeof classifyMp !== 'function') {
  console.error('取到的不是函数，切片锚点已漂移，需要更新本测试')
  process.exit(1)
}

// ---- 对照语料：覆盖判断题各存储形态 + 分叉区间 + 边界 ----
const q = (type, options, answer) => ({ type, options, answer })
const J = (arr) => JSON.stringify(arr)

const CASES = [
  // [说明, 题目, 期望（两端都必须等于它）]
  ['经典判断题(single+正确/错误+A)', q('single', J(['正确', '错误']), 'A'), 'judge'],
  ['带前缀选项 A. 正确', q('single', J(['A. 正确', 'B. 错误']), 'A'), 'judge'],
  ['答案即判断词(2 选项)', q('single', J(['正确', '错误']), '正确'), 'judge'],
  ['答案即判断词(0 选项)', q('single', J([]), '正确'), 'judge'],
  ['答案即判断词(options 非法 JSON)', q('single', 'not-json', '正确'), 'judge'],
  ['答案即判断词(options 缺失)', q('single', undefined, '正确'), 'judge'],
  ['★分叉区间：1 个选项 + 答案=判断词', q('single', J(['正确']), '正确'), 'single'],
  ['★分叉区间：1 个选项 + 答案=true', q('single', J(['true']), 'true'), 'single'],
  ['★分叉区间：1 个选项 + 答案=对', q('single', J(['对']), '对'), 'single'],
  ['★分叉区间：3 个选项 + 答案=判断词', q('single', J(['正确', '错误', '不确定']), '正确'), 'single'],
  ['英文判断词选项对 true/false', q('single', J(['true', 'false']), 'F'), 'judge'],
  ['裸字母 F 是判断词(2 选项，既有行为)', q('single', J(['甲', '乙']), 'F'), 'judge'],
  ['真单选 A(无判断词)', q('single', J(['甲', '乙', '丙', '丁']), 'A'), 'single'],
  ['真多选 AB', q('multi', J(['甲', '乙', '丙']), 'AB'), 'multi'],
  ['多选连写 ABD', q('multi', J(['甲', '乙', '丙', '丁']), 'ABD'), 'multi'],
  ['多选答案带分隔 A,B', q('multi', J(['甲', '乙', '丙']), 'A,B'), 'multi'],
  ['声明 judge 类型', q('judge', J(['正确', '错误']), 'A'), 'judge'],
  ['无选项 + 字母答案 A(不得判 judge)', q('single', J([]), 'A'), 'single'],
  ['0 选项 + 字母答案 B', q('single', J([]), 'B'), 'single'],
  ['P1-1 排除：A.面向对象/B.面向过程', q('single', J(['A. 面向对象', 'B. 面向过程']), 'A'), 'single'],
  ['未声明 + 化学答案 CH4(不得判 multi)', q('', J([]), 'CH4'), 'single'],
  ['未声明 + "ab" 仍判 multi', q('', J(['甲', '乙']), 'ab'), 'multi'],
  ['大小写混合判断词 T/T', q('single', J(['T', 'F']), 'T'), 'judge'],
  ['判断词 是/否', q('single', J(['是', '否']), '是'), 'judge'],
  ['判断词 √/×', q('single', J(['√', '×']), '√'), 'judge'],
]

let fail = 0
const rows = []
for (const [desc, question, want] of CASES) {
  let w, m
  try { w = classifyWeb(question) } catch (e) { w = 'ERR:' + e.message }
  try { m = classifyMp(question) } catch (e) { m = 'ERR:' + e.message }
  const ok = w === m && w === want
  if (!ok) fail++
  rows.push({ desc, w, m, want, ok })
  console.log(
    `${ok ? '  ok' : 'FAIL'}  ${String(desc).padEnd(38)} web=${String(w).padEnd(7)} mp=${String(m).padEnd(7)} want=${want}`
  )
}

// 反向对照：证明本测试真能抓到分叉（把网页版门禁"拆掉"再跑同一批语料，必须出现不一致）
// —— 用测试内的等价实现模拟旧行为，不碰磁盘上的源码。
const oldWebSrc = webClassify.replace(
  /const optCount = opts \? opts\.length : 0\n\s*if \(\(optCount === 2 \|\| optCount === 0\) && JUDGE_WORDS\.has\(ans\)\) return 'judge'/,
  `if (JUDGE_WORDS.has(ans)) return 'judge'`
)
let reverseWorks = false
if (oldWebSrc !== webClassify) {
  try {
    const oldClassify = build([webJudgeConsts, webOptPrefix, webStrip, webIsJudge, webMultiConsts, webNormalizeMulti, oldWebSrc], 'classifyQuestionType')
    let diffs = 0
    for (const [, question] of CASES) {
      if (oldClassify(question) !== classifyMp(question)) diffs++
    }
    reverseWorks = diffs > 0
    console.log(`\n[反向对照] 去掉网页版门禁后，与小程序不一致的用例数 = ${diffs}（应为 >0）`)
  } catch (e) {
    console.log('\n[反向对照] 构造失败：' + e.message)
  }
} else {
  console.log('\n[反向对照] 未匹配到门禁代码，跳过（门禁写法变了要更新本测试的正则）')
}
if (!reverseWorks) fail++

console.log(`\n${CASES.length} 例对照：${CASES.length - rows.filter(r => !r.ok).length} 一致 / ${rows.filter(r => !r.ok).length} 不一致`)
if (fail) {
  console.log(`❌ 存在 ${fail} 处问题（含反向对照）`)
  process.exit(1)
}
console.log('✅ 两端题型判定在全部用例上逐字同口径，且反向对照可证伪')
process.exit(0)
