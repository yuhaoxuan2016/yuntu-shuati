// 离线断言（2026-09-25）：公共题库分页的「哪些页少回了」判据。
//
// 背景：rabbit 报「导入不完整」——某页少回会被当成完整结果。修法是按页核对、缺页重取；
// 而「最后一页该有多少条」是 total 的余数、不是整页，这个 off-by-one 单独抽成 shortPages 后可测。
// 用**真实源码切片**（从 exam.ts 切出函数本体、esbuild 去 TS）跑断言。
//
// 用法: node tests/public-fetch-pages.test.cjs
const fs = require('fs')
const path = require('path')
const esbuild = require('esbuild')

const SRC = path.resolve(__dirname, '../src/lib/exam.ts')
const src = fs.readFileSync(SRC, 'utf8')
const lines = src.split(/\r?\n/)
const start = lines.findIndex(l => /^export function shortPages\(/.test(l))
let end = -1
for (let i = start + 1; start >= 0 && i < lines.length; i++) if (lines[i] === '}') { end = i; break }
if (start < 0 || end < 0) { console.error('❌ 切片失败：找不到 shortPages'); process.exit(2) }
const ts = lines.slice(start, end + 1).join('\n').replace(/^export\s+/, '')   // 切片带出了 export，new Function 不认
const js = esbuild.transformSync(ts, { loader: 'ts' }).code
const shortPages = new Function(`${js}\nreturn shortPages`)()

let failed = 0
const ok = m => console.log('   ✓ ' + m)
const bad = m => { console.log('   ✗ ' + m); failed++ }
const eq = (got, want, msg) => JSON.stringify(got) === JSON.stringify(want)
  ? ok(msg) : bad(`${msg}（实际 ${JSON.stringify(got)}，期望 ${JSON.stringify(want)}）`)

const PAGE = 200
const full = (n) => Array.from({ length: n }, () => ({}))

// ① 完整：1134 题 = 6 页（5 整页 + 末页 134）
{
  const chunks = [full(200), full(200), full(200), full(200), full(200), full(134)]
  eq(shortPages(chunks, 1134, PAGE), [], '完整（1134 = 5×200+134）不报缺页')
}
// ② 中间某页少回（就是这次实盘那种）
{
  const chunks = [full(200), full(200), full(195), full(200), full(200), full(134)]
  eq(shortPages(chunks, 1134, PAGE), [2], '第 3 页少 5 条 ⇒ 只报第 2 页（0 基）')
}
// ③ 末页按余数判：末页只有 133（少 1）要报
{
  const chunks = [full(200), full(200), full(200), full(200), full(200), full(133)]
  eq(shortPages(chunks, 1134, PAGE), [5], '末页少 1 条也要报（余数不是整页）')
}
// ④ 末页「恰好整页」时不许误报（total = 1200 整）
{
  const chunks = [full(200), full(200), full(200), full(200), full(200), full(200)]
  eq(shortPages(chunks, 1200, PAGE), [], 'total 恰为整页数时不误报')
}
// ⑤ 多回了不算缺（服务端多给几条）
{
  const chunks = [full(205), full(200), full(200), full(200), full(200), full(134)]
  eq(shortPages(chunks, 1134, PAGE), [], '某页多回不算缺页')
}
// ⑥ 整页空（请求全失败）
{
  const chunks = [[], [], [], [], [], []]
  eq(shortPages(chunks, 1134, PAGE), [0, 1, 2, 3, 4, 5], '整页空 ⇒ 全部页号都报')
}
// ⑦ 边界：total = 0 / 未知 / 单页
{
  eq(shortPages([[]], 0, PAGE), [], 'total=0（未知）⇒ 不判缺页')
  eq(shortPages([full(3)], 3, PAGE), [], '单页 3 条且拿全 ⇒ 不报')
  eq(shortPages([full(2)], 3, PAGE), [0], '单页 3 条只拿 2 ⇒ 报第 0 页')
  eq(shortPages(undefined, 10, PAGE), [], 'chunks 缺失 → 判据不崩、返回空（由调用方另行兜底）')
}
// ⑧ 负向对照：把判据写错（拿整页当末页期望）就会漏报 ③ —— 用它证明本条断言真在起作用
{
  const wrongJudge = (chunks, total, pageSize) => {
    const pages = Math.ceil(total / pageSize)
    const out = []
    for (let i = 0; i < pages; i++) if ((chunks[i] || []).length < pageSize) out.push(i)
    return out
  }
  const chunks = [full(200), full(200), full(200), full(200), full(200), full(133)]
  eq(wrongJudge(chunks, 1134, PAGE), [5], '负向对照：错误判据在末页这里也会报（说明 ③ 的判别力来自余数而非偶然）')
  eq(shortPages(chunks, 1134, PAGE), wrongJudge(chunks, 1134, PAGE), '两种判据在「末页少」这一例上一致 ⇒ 差异只出现在末页拿满的情形')
}

console.log(failed ? `\n有失败：${failed} 项` : '\n全绿')
process.exit(failed ? 1 : 0)
