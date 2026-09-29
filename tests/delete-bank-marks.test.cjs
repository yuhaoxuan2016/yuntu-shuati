// 删库销账的判据（2026-09-29）：切**真实源码**跑。
//
// 病灶：`api.deleteBank` 的级联只清本机（IndexedDB 六张表），云端只写了「题库 + 题目」两笔标记，
// 记录类没写 ⇒ 本机删库后云端那批记录既没人删、又没有账本条目（驱动「下载不再拉回」的那本账）
// ⇒ 下次下载把它们拉回来挂在已不存在的库上（rabbit 账号实测 95 行：86 练习 + 9 错题）。
//
// 用法: node tests/delete-bank-marks.test.cjs
const fs = require('fs')
const path = require('path')
const esbuild = require('esbuild')

const CLOUD = path.resolve(__dirname, '../src/lib/cloud.ts')
const API = path.resolve(__dirname, '../src/utils/api.ts')
const lines = fs.readFileSync(CLOUD, 'utf8').split(/\r?\n/)

// 切片：deletedMarkWhere（锚点 → 顶格 }）
function slice (startRe, label) {
  const s = lines.findIndex(l => startRe.test(l))
  if (s < 0) throw new Error(`切片失败：找不到 ${label}（源码改过形状的话，判据要跟着改，别让守卫静默放行）`)
  let e = -1
  for (let i = s + 1; i < lines.length; i++) if (lines[i] === '}') { e = i; break }
  if (e < 0) throw new Error(`切片失败：${label} 没有顶格收尾 }`)
  return lines.slice(s, e + 1).join('\n')
}
const js = esbuild.transformSync(slice(/^function deletedMarkWhere/, 'deletedMarkWhere'), { loader: 'ts' }).code
// authedUid / visibilityGuard 都是模块级依赖 ⇒ 注入，别让切进来的声明相撞
const deletedMarkWhere = new Function('authedUid', 'visibilityGuard', `${js}\nreturn deletedMarkWhere`)

const UID = 'wx_ocRhF5DTMfMoCkt98Bo4hu7MEjtk'
const W = deletedMarkWhere(UID, () => 'private')

let failed = 0
const ok = m => console.log('   ✓ ' + m)
const bad = m => { console.log('   ✗ ' + m); failed++ }
const eq = (got, want, m) => { if (JSON.stringify(got) === JSON.stringify(want)) ok(m); else bad(`${m}（实际 ${JSON.stringify(got)}，期望 ${JSON.stringify(want)}）`) }

console.log('— ① 记录表 · 整库语义（删题库时级联）')
for (const coll of ['practice_records', 'wrong_questions', 'favorites', 'mastered_questions']) {
  const w = W(coll, { bank_id: 6, question_id: null })
  eq(w, { _local_bank_id: 6, _openid: UID }, `${coll}: 按 _local_bank_id 定位整库，且**不带 question_id**`)
  if ('question_id' in w) bad(`${coll}: 条件里混进了 question_id ⇒ 只匹配 question_id=null 的行，等于一条都删不到`)
}
eq(W('practice_records', { bank_id: 6, question_id: undefined }), { _local_bank_id: 6, _openid: UID },
  'question_id 为 undefined 也走整库语义（宽松比较是刻意，不是笔误）')
// 反证：老写法会把 question_id 带进条件
const oldWay = { _local_bank_id: 6, question_id: null, _openid: UID }
eq('question_id' in oldWay && oldWay.question_id === null, true,
  '反证：老条件里确实带着 question_id:null ⇒ 记录行（question_id 是数字）永远匹配不上，这就是那 95 行删不掉的原因')

console.log('\n— ② 记录表 · 单条（不能被上面的改动带歪）')
eq(W('wrong_questions', { bank_id: 6, question_id: 1342, cloud_id: 'lquestions_x' }),
  { question_cloud_id: 'lquestions_x', _openid: UID }, '带 cloud_id ⇒ 按题目云端 _id 定位（跨设备语义）')
eq(W('wrong_questions', { bank_id: 6, question_id: 1342 }),
  { _local_bank_id: 6, question_id: 1342, _openid: UID }, '无 cloud_id ⇒ 回退旧键')

console.log('\n— ③ 题库/题目两表不能被记录表的规则影响（回归）')
eq(W('quiz_banks', { bank_id: 6, question_id: null, cloud_id: 'lquiz_banks_X' }),
  { _id: 'lquiz_banks_X', _openid: UID, visibility: 'private' }, '题库：按 cloud_id + visibility 另一半')
eq(W('questions', { bank_id: 6, question_id: null, cloud_id: 'lquiz_banks_X' }),
  { bank_ref: 'lquiz_banks_X', _openid: UID, visibility: 'private' }, '题目整库：按 bank_ref')
eq(W('questions', { bank_id: 6, question_id: 1777 }),
  { _local_bank_id: 6, _local_id: 1777, _openid: UID, visibility: 'private' }, '题目单条：旧键 + visibility')

console.log('\n— ④ deleteBank 真的写了四笔记录标记（文本守卫）')
const apiSrc = fs.readFileSync(API, 'utf8')
for (const coll of ['practice_records', 'wrong_questions', 'favorites', 'mastered_questions']) {
  const hit = apiSrc.includes(`markCloudDeleted('${coll}', id, null)`)
  if (hit) ok(`deleteBank 里给 ${coll} 打了整库删除标记`)
  else bad(`deleteBank 没给 ${coll} 打标记 ⇒ 删库后该库记录会在下次下载复活`)
}
const body = apiSrc.slice(apiSrc.indexOf('async deleteBank(id: number)'), apiSrc.indexOf('async deleteBank(id: number)') + 1400)
if (body.includes("markCloudDeleted('quiz_banks', id, null, cid)") && body.includes("markCloudDeleted('questions', id, null, cid)")) {
  ok('原有两笔（题库 + 题目，带 cloud_id）没被改坏')
} else {
  bad('deleteBank 里题库/题目的标记被动过 —— 回归')
}

console.log('\n— ⑤ 接线：practice_records 必须在删除链路的**四个**地方都登记')
// 少一个的后果都是"静默无效"：标记写了却没人处理 / 账本不记 ⇒ 下次下载照旧复活。这类漏配最难发现，
// 所以逐处做文本守卫（源码改形状会立刻红，而不是等下一次下载才发现记录回来了）。
const WIRING = [
  ['src/lib/sync-ledger.ts', /export type LedgerColl = [^\n]*'practice_records'/, 'LedgerColl 联合类型含 practice_records'],
  ['src/lib/cloud.ts', /const LEDGER_COLLS = new Set<string>\(\[[^\]]*'practice_records'/, 'LEDGER_COLLS 含 practice_records（否则账本不记、下载不拦）'],
  ['src/lib/cloud.ts', /for \(const coll of \[[^\]]*'practice_records'[^\]]*\] as CloudCollection\[\]\)/, 'applyDeletedMarks 的循环含 practice_records（否则标记永不被处理）'],
  ['src/utils/api.ts', /coll: [^\n]*'practice_records'/, 'api 层 markCloudDeleted 包装的类型含 practice_records（否则类型报错 / 被拒）'],
]
for (const [rel, re, msg] of WIRING) {
  const src = fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8')
  if (re.test(src)) ok(msg)
  else bad(`${rel}：${msg} —— 没接上`)
}

console.log(failed ? `\n有失败：${failed} 项` : '\n全绿')
process.exit(failed ? 1 : 0)
