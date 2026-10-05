// 跨端同源模块「真的一样吗」守护（2026-10-05）
//
// 背景：parser / spaced-repetition / poems / sync-format / duration 这几个纯逻辑模块，
// 网页版与小程序**各存一份、靠人手复制**保持同步。此前**没有任何机制检查这件事**
// —— 改一端忘了另一端就静默分叉：两端对同一道题算出的键/答案可能不同，
// 而两边都不会报错，线上只表现为「偶尔数据对不上」。
//
// 本脚本只做一件事：把清单里每个模块的**两边字节**摆在一起比。
// 不一致就报出「差在哪一行、两边各是什么」，并给同步命令。
//
// 用法:
//   node tests/cross-end-parity.test.cjs      # 两仓并列时（工作区常态）
//   npm run check-parity
//
// 设计取舍（重要，防「防御本身变陷阱」）：
//   ① **单清单 + 双向校验**。清单漏登记一个模块 ⇒ 该模块从此无人守护；
//      清单多登记一个其实不该相同的模块 ⇒ 每次跑都误报。故两头都要拦：
//      「文件里带跨端同源标记却没登记」与「登记了却没标记」都算失败。
//   ② **只比字节，不比语义**。压缩/构建后的形态差异一律不管 —— 那属另一层。
//   ③ **不 import 任何被测模块**（用 fs 读字节），所以不受本机 esbuild 限制，
//      也不碰 IndexedDB / wx 等任何运行时。在本机与 Qoder 侧都能跑。
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const WEB_ROOT = path.resolve(__dirname, '..')
const MP_ROOT = path.resolve(WEB_ROOT, '..', 'yuntu-mp')

// 跨端同源清单：文件必须同时存在于两仓且**逐字节相同**。
// 新增一条前先确认「它真的应该两端一样」——平台相关的模块（cloud/store/api 等）不要往这里加。
const PARITY = [
  { file: 'parser.ts', why: '题库解析，两端口径必须一致' },
  { file: 'spaced-repetition.ts', why: '遗忘曲线排程' },
  { file: 'sync-format.ts', why: '同步明细文案' },
  { file: 'duration.ts', why: '练习时长格式化' },
  { file: 'poems.ts', why: '每日一诗数据源' },
]

// 声明跨端同源的措辞。
//
// ⚠️ 只认**主语句式**（本文件/本模块/该文件 自称相同），**不认**泛指句
// —— 同仓储里大量存在「……逐字节相同的 parser.ts 早就把……」这类**引用别人**的句子
// （实测 `exam.ts:547`、`quiz.ts:14`、`store.ts:6` 三处），
// 若按关键字宽匹配，这三处会被当成「它自己也自称同源却没登记」⇒ 纯误报。
const MARKER = new RegExp(
  [
    // 主语句式：自称
    '(本文件|本模块|该文件|此文件|这个文件)[^。\\n]{0,24}(逐字节相同|两端相同|须同步另一端|必须同步另一端|同步另一端)',
    // 约定句式：「……逐字节相同（改一端必须同步另一端）」
    '(逐字节相同|两端相同)[^。\\n]{0,16}(改一端|两端|同步到另一端)',
  ].join('|')
)

// 两端各自的 lib 目录；标记扫描只扫这里（范围可控，不误伤视图层）
const LIB_DIRS = [
  { label: 'web', dir: path.join(WEB_ROOT, 'src', 'lib') },
  { label: 'mp', dir: path.join(MP_ROOT, 'src', 'lib') },
]

let failed = 0
const ok = m => console.log('   ✓ ' + m)
const bad = m => { console.log('   ✗ ' + m); failed++ }
const sha = b => crypto.createHash('sha256').update(b).digest('hex')

function readBytes (p) {
  try {
    return fs.readFileSync(p)
  } catch (e) {
    return null
  }
}

// 行数（按 LF 计）——用于「同一个文件、行数没变」这类快速判读
const lineCount = s => (s === '' ? 0 : s.split('\n').length - (s.endsWith('\n') ? 1 : 0))

// 生成「哪一行开始不同」的可读定位（按行比对，跳过行尾 \r 差异以免误导）
function firstDivergence (a, b) {
  const A = a.split('\n')
  const B = b.split('\n')
  const n = Math.min(A.length, B.length)
  for (let i = 0; i < n; i++) {
    if (A[i].replace(/\r$/, '') !== B[i].replace(/\r$/, '')) {
      return { line: i + 1, web: A[i].slice(0, 120), mp: B[i].slice(0, 120) }
    }
  }
  if (A.length !== B.length) {
    return {
      line: n + 1,
      web: A[n] === undefined ? '(网页版到此结束)' : A[n].slice(0, 120),
      mp: B[n] === undefined ? '(小程序到此结束)' : B[n].slice(0, 120),
    }
  }
  // 行内容全同却字节不同 ⇒ 只可能是行尾/BOM 这类不可见差异
  return { line: 0, web: '(行内容一致，差异在行尾符或 BOM)', mp: '' }
}

// —— 0. 环境自检：两仓都在吗 ——
console.log('跨端同源模块对拍')
if (!fs.existsSync(MP_ROOT)) {
  console.log(`\n⚠️ 找不到小程序仓库：${MP_ROOT}`)
  console.log('   （本脚本要求网页版与小程序仓**并列**摆放；只 clone 了网页版时属正常，跳过。）')
  process.exit(0)
}

// —— 1. 逐个模块比字节 ——
console.log(`\n① 清单里 ${PARITY.length} 个模块，两边字节必须相同`)
for (const { file, why } of PARITY) {
  const wp = path.join(WEB_ROOT, 'src', 'lib', file)
  const mp = path.join(MP_ROOT, 'src', 'lib', file)
  const wb = readBytes(wp)
  const mb = readBytes(mp)

  if (wb === null || mb === null) {
    bad(`${file} 缺失（${wb === null ? '网页版' : '小程序'}那份不存在）——${why}`)
    continue
  }
  if (wb.equals(mb)) {
    ok(`${file} 一致（${wb.length} B / ${lineCount(wb.toString('utf8'))} 行）`)
    continue
  }
  const d = firstDivergence(wb.toString('utf8'), mb.toString('utf8'))
  bad(`${file} **两端已分叉**——${why}`)
  console.log(`       网页版 ${wb.length} B (${sha(wb).slice(0, 12)}) / 小程序 ${mb.length} B (${sha(mb).slice(0, 12)})`)
  console.log(`       第一个不同：第 ${d.line} 行`)
  console.log(`         网页版: ${d.web}`)
  console.log(`         小程序: ${d.mp}`)
}

// —— 2. 清单防漂移：文件自称同源 ⇒ 必须登记 ——
console.log('\n② 自称「跨端同源」的文件必须都登记在清单里（防漏登）')
const listed = new Set(PARITY.map(p => p.file))
for (const { label, dir } of LIB_DIRS) {
  if (!fs.existsSync(dir)) { bad(`${label} 的 lib 目录不存在：${dir}`); continue }
  const selfDeclared = fs.readdirSync(dir)
    .filter(f => f.endsWith('.ts'))
    .filter(f => MARKER.test(fs.readFileSync(path.join(dir, f), 'utf8')))
  const missing = selfDeclared.filter(f => !listed.has(f))
  if (missing.length === 0) {
    ok(`${label} 侧 ${selfDeclared.length} 个自称同源的文件全都已登记`)
  } else {
    bad(`${label} 侧有文件自称跨端同源却**没登记**，等于无人守护：${missing.join('、')}`)
  }
}

// —— 3. 清单防漂移：登记了 ⇒ 两边都得自称同源（防误登） ——
console.log('\n③ 登记了的文件，两边都该写明「两端逐字节相同」（防误登）')
for (const { file } of PARITY) {
  const sides = [
    ['网页版', path.join(WEB_ROOT, 'src', 'lib', file)],
    ['小程序', path.join(MP_ROOT, 'src', 'lib', file)],
  ]
  const silent = sides.filter(([, p]) => {
    const b = readBytes(p)
    return b !== null && !MARKER.test(b.toString('utf8'))
  }).map(([label]) => label)
  if (silent.length === 0) {
    ok(`${file} 两侧都有同源声明`)
  } else {
    bad(`${file} 被登记为跨端同源，但 ${silent.join('、')}那份里**没写**这句约定 ⇒ 后来者不会知道要同步`)
  }
}

// —— 4. 登记了的模块必须真被两端引用（防清单一厢情愿） ——
console.log('\n④ 登记了的模块应被两端都引用（只被一端用 ⇒ 多半登记错了）')
const walk = (dir, exts) => {
  const out = []
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop()
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (exts.some(x => e.name.endsWith(x))) out.push(p)
    }
  }
  return out
}
const webFiles = walk(path.join(WEB_ROOT, 'src'), ['.ts', '.vue'])
const mpFiles = walk(path.join(MP_ROOT, 'src'), ['.ts', '.vue'])
for (const { file } of PARITY) {
  const stem = file.replace(/\.ts$/, '')
  // 引用形如 from './duration' / '../lib/duration'（不带扩展名，与仓库既有写法一致）
  const re = new RegExp(`from\\s+['"][^'"]*${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`)
  const countRefs = files => files.filter(f => re.test(fs.readFileSync(f, 'utf8'))).length
  const w = countRefs(webFiles)
  const m = countRefs(mpFiles)
  if (w > 0 && m > 0) ok(`${file} 网页版 ${w} 处引用 / 小程序 ${m} 处引用`)
  else bad(`${file} 引用异常：网页版 ${w} 处 / 小程序 ${m} 处（有一端没在用）`)
}

console.log(failed ? `\n❌ 有失败：${failed} 项` : '\n✅ 全绿：清单内模块两端逐字节相同')
if (failed) {
  console.log('\n同步办法（以 duration.ts 为例，两端都得改）：')
  console.log('  cp shuati-pwa/src/lib/<file> yuntu-mp/src/lib/<file>')
  console.log('  然后两端各自跑一次构建/测试再提交——不要只提交一端。')
}
process.exit(failed ? 1 : 0)
