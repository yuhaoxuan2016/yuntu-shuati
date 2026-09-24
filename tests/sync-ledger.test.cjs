// sync-ledger（同步删除账本）的正反对照测试。
//   node tests/sync-ledger.test.cjs
//
// ⚠️ 放 `tests/` 而不是 `scripts/lib/`：`.gitignore:91` 忽略了整个 `scripts/`，
//    放在那儿等于这份守卫进不了仓库（同目录的 diff-guards.test.cjs 就有这个问题）。
//
// 为什么用 esbuild 现场编译：账本逻辑活在 `src/lib/sync-ledger.ts`（网页端真正 import 的那份），
// 测试要跑**真实现**，不能抄一份到 .cjs 里 —— 抄的那份迟早跟真身走偏。
// 编译产物落在 os.tmpdir()，跑完即弃，不进仓库。
const fs = require('fs')
const os = require('os')
const path = require('path')
const esbuild = require('esbuild')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src', 'lib', 'sync-ledger.ts')

if (!fs.existsSync(SRC)) {
  console.error(`✗ 找不到被测实现：${SRC}`)
  process.exit(1)
}

const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sync-ledger-')), 'sync-ledger.cjs')
esbuild.buildSync({
  entryPoints: [SRC],
  outfile: outFile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'warning',
})

const L = require(outFile)

let fail = 0
let pass = 0
function t (name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) pass++
  else fail++
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  得到 ${JSON.stringify(got)} 期望 ${JSON.stringify(want)}`}`)
}

// 假存储：账本就是往 localStorage 写一条 JSON，用假的才能离线跑
function fakeKV (initial) {
  const m = new Map(initial ? [['sync_deleted_ledger', initial]] : [])
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, v),
    _raw: () => m.get('sync_deleted_ledger'),
  }
}

const T = Date.parse('2026-09-24T12:00:00Z')
const entry = (over = {}) => ({
  coll: 'quiz_banks',
  cloud_id: 'lquiz_banks_aaa_1',
  local_id: 1,
  question_id: null,
  sync_key: '兔子114514',
  at: T,
  ...over,
})
const idx = es => L.buildLedgerIndex(es)
const bankDoc = (over = {}) => ({
  _id: 'lquiz_banks_aaa_1',
  _local_id: 1,
  sync_key: '兔子114514',
  updated_at: '2026-09-01T00:00:00.000Z',
  ...over,
})

console.log('— 强键：云端 _id 就是那一条')
t('强键命中即抑制', L.isSuppressed(idx([entry()]), 'quiz_banks', bankDoc()), true)
t('强键不问时间（云端文档比删除时刻新也照样抑制）',
  L.isSuppressed(idx([entry()]), 'quiz_banks', bankDoc({ updated_at: '2026-10-01T00:00:00.000Z' })), true)
t('反例 _id 与本地 id 都对不上（另一份文档）→ 不抑制',
  L.isSuppressed(idx([entry()]), 'quiz_banks', bankDoc({ _id: 'lquiz_banks_bbb_1', _local_id: 7 })), false)

console.log('— 弱键：本地 id 相同 + 文档时间 ≤ 删除时刻（旧身份 / 缺 _local_id 的复活路）')
t('弱键命中（cloud_id 未知的老账本条目）',
  L.isSuppressed(idx([entry({ cloud_id: null })]), 'quiz_banks', bankDoc({ _id: '老文档_hex32' })), true)
t('反例 本地 id 被复用后新推上来的那份（updated_at 晚于删除时刻）不该挡',
  L.isSuppressed(idx([entry({ cloud_id: null })]), 'quiz_banks', bankDoc({ _id: '新文档', updated_at: '2026-09-25T00:00:00.000Z' })), false)
t('反例 同步昵称不同（换了身份的另一个人同名同 id）不抑制',
  L.isSuppressed(idx([entry({ cloud_id: null })]), 'quiz_banks', bankDoc({ _id: 'x', sync_key: '别人' })), false)
t('云端没写 sync_key 的老文档允许弱键命中（属主已由 _openid 保证）',
  L.isSuppressed(idx([entry({ cloud_id: null })]), 'quiz_banks', bankDoc({ _id: 'x', sync_key: undefined })), true)
t('反例 _local_id 不同则弱键不命中',
  L.isSuppressed(idx([entry({ cloud_id: null })]), 'quiz_banks', bankDoc({ _id: 'x', _local_id: 7 })), false)
t('云端缺 updated_at（取不到时间按 0）→ 属于老文档，抑制',
  L.isSuppressed(idx([entry({ cloud_id: null })]), 'quiz_banks', bankDoc({ _id: 'x', updated_at: undefined })), true)

console.log('— 题目：整库语义按 bank_ref 锚到题库云端 _id')
// 删题库时 api 层会同时给 quiz_banks 与 questions 各记一条（见 api.ts deleteBank），
// 所以这里的账本条目 coll 是 questions、cloud_id 是**题库**的云端 _id。
const qEntry = (over = {}) => entry({ coll: 'questions', ...over })
t('bank_ref 命中题库 cloud_id 即抑制（整库删）',
  L.isSuppressed(idx([qEntry()]), 'questions', { _id: 'q1', bank_ref: 'lquiz_banks_aaa_1', updated_at: '2026-09-01T00:00:00.000Z' }), true)
t('反例 别的题库的题不受影响',
  L.isSuppressed(idx([qEntry()]), 'questions', { _id: 'q1', bank_ref: 'lquiz_banks_zzz_9', updated_at: '2026-09-01T00:00:00.000Z' }), false)
t('逐题删除的账本条目只挡那一题',
  L.isSuppressed(idx([qEntry({ question_id: 42 })]), 'questions', { _id: 'q1', bank_ref: 'lquiz_banks_aaa_1', _local_id: 42, updated_at: '2026-09-01T00:00:00.000Z' }), true)
t('逐题账本不挡同库别的题',
  L.isSuppressed(idx([qEntry({ question_id: 42 })]), 'questions', { _id: 'q2', bank_ref: 'lquiz_banks_aaa_1', _local_id: 43, updated_at: '2026-09-01T00:00:00.000Z' }), false)
t('反例 quiz_banks 的整库条目落到 questions 上不生效（coll 隔离）',
  L.isSuppressed(idx([entry()]), 'questions', { _id: 'q1', bank_ref: 'lquiz_banks_aaa_1', updated_at: '2026-09-01T00:00:00.000Z' }), false)

console.log('— 记录类集合（错题/收藏/掌握）按 (_local_bank_id, question_id)')
t('命中即抑制',
  L.isSuppressed(idx([entry({ coll: 'wrong_questions', local_id: 3, question_id: 99, cloud_id: null })]),
    'wrong_questions', { _id: 'w1', _local_bank_id: 3, question_id: 99, sync_key: '兔子114514', updated_at: '2026-09-01T00:00:00.000Z' }), true)
t('反例 同库不同题不抑制',
  L.isSuppressed(idx([entry({ coll: 'wrong_questions', local_id: 3, question_id: 99, cloud_id: null })]),
    'wrong_questions', { _id: 'w2', _local_bank_id: 3, question_id: 100, sync_key: '兔子114514', updated_at: '2026-09-01T00:00:00.000Z' }), false)

console.log('— 集合隔离与空账本')
t('quiz_banks 的条目不影响 questions',
  L.isSuppressed(idx([entry()]), 'questions', { _id: 'q1', _local_id: 1, updated_at: '2026-09-01T00:00:00.000Z' }), false)
t('空账本一律不抑制', L.isSuppressed(idx([]), 'quiz_banks', bankDoc()), false)

console.log('— 落盘：写入去重、上限裁剪、坏数据不炸')
{
  const kv = fakeKV()
  L.addLedgerEntry(entry(), kv, T)
  L.addLedgerEntry(entry(), kv, T)
  t('同一条只记一次', JSON.parse(kv._raw()).length, 1)
  L.addLedgerEntry(entry({ local_id: 2 }), kv, T)
  t('不同条目各自入账', JSON.parse(kv._raw()).length, 2)
}
{
  const kv = fakeKV()
  for (let i = 1; i <= L.LEDGER_MAX + 20; i++) {
    L.addLedgerEntry(entry({ local_id: i, at: T + i * 1000 }), kv, T + i * 1000)
  }
  const rows = JSON.parse(kv._raw())
  t('超出上限按时间裁旧', rows.length, L.LEDGER_MAX)
  t('保留的是最新的那批', rows[rows.length - 1].local_id, L.LEDGER_MAX + 20)
  t('最旧的已被裁掉', rows.some(r => r.local_id === 1), false)
}
{
  const kv = fakeKV()
  L.addLedgerEntry(entry({ local_id: 100, at: T - L.LEDGER_MAX_AGE_MS - 1000 }), kv, T)
  t('超过保留期的老账本在读取时被丢弃', L.loadLedger(kv, T).length, 0)
}
t('坏 JSON 不炸，退回空账本', L.loadLedger(fakeKV('{不是 JSON'), T), [])
t('落盘内容可回读（含 null 字段）', (() => {
  const kv = fakeKV()
  L.addLedgerEntry(entry({ coll: 'questions', question_id: null }), kv, T)
  const back = L.loadLedger(kv, T)
  return back.length === 1 && back[0].coll === 'questions' && back[0].question_id === null
})(), true)

console.log('— 时间归一：ISO 串 / 数字 / 垃圾输入')
t('ISO 串', L.toMs('2026-09-24T00:00:00.000Z'), Date.parse('2026-09-24T00:00:00.000Z'))
t('数字原样', L.toMs(1758600000000), 1758600000000)
t('垃圾输入取 0', L.toMs('不是时间'), 0)
t('undefined 取 0', L.toMs(undefined), 0)

console.log(`\n${fail === 0 ? '全绿' : '有失败'}：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
