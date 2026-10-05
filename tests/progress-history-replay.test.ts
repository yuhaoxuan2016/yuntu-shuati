// 2026-10-05：用**云端真实数据**演练历史栈的「入栈 → 被空档覆盖 → 回滚」全链（纯逻辑，不写云端）。
// 目的：证明「即使再发生一次空档覆盖，也能靠历史栈把实质进度救回来」。
import { pushHistory, pickHistory, makeRollbackValue, HISTORY_MAX, trulyAnsweredCount } from '../src/lib/sync-ids.ts'
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const ok = (n: string, c: boolean, extra = '') => { if (c) { pass++; console.log('✓', n) } else { fail++; console.log('✗', n, extra) } }

// 云端真实快照（由 _snapshot-progress.cjs 导出；缺失时用内联的真实形状兜底）
let cloud: any = null
try { cloud = JSON.parse(readFileSync(new URL('./_fixtures/progress-real-20261005.json', import.meta.url), 'utf8')) }
catch { cloud = null }

if (!cloud) {
  console.log('⚠️ 未找到真实快照，用内联真实形状构造（结构取自 2026-10-05 云端实读）')
  cloud = { 'lquiz_banks_14': {
    mode: 'order', order_ids: Array.from({ length: 1134 }, (_, i) => 500001 + i), current_id: 500002,
    answer_states: { '500002': { selected: [], blankAnswer: '', submitted: false, isCorrect: false, selfEvalDone: false, judgeSelected: null, elapsedSecs: 3 } },
    finished: false, saved_at: '2026-10-05T12:51:21.855Z', _src: { dev: 'lpdnplwr', v: 3 },
  } }
}

const p14 = cloud['lquiz_banks_14']
ok('真实快照读到了变电安规2026', !!p14)
ok('真实快照的正确答案数 = 0（正是被压掉的空档）', trulyAnsweredCount(p14) === 0)
ok('空档订单完整（order_ids 1134 条，说明是"打开题库"时生成的）', (p14.order_ids || []).length === 1134)

// ── 演练：模拟「实质进度 → 被空档覆盖 → 回滚」
// 1) 构造一份实质进度（答了 60 题，用真实形状）
const real: any = {
  ...p14,
  current_id: 500060,
  answer_states: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [
    String(500001 + i),
    { selected: [], blankAnswer: '', submitted: true, isCorrect: i % 3 !== 0, selfEvalDone: false, judgeSelected: i % 2 === 0, elapsedSecs: 6 },
  ])),
  saved_at: '2026-10-05T10:00:00.000Z',
}
ok('实质版本被认作 60 题', trulyAnsweredCount(real) === 60)

// 2) 入栈
let hist = pushHistory([], real)
ok('实质版本入栈成功', hist.length === 1 && hist[0].answered === 60)

// 3) 空档来了（两次：一次是「打开题库」，一次是 saved_at 更新的空档）—— 都不该入栈
hist = pushHistory(hist, p14)
ok('打开题库产生的空档不入栈（栈仍是 1 版）', hist.length === 1)
hist = pushHistory(hist, { ...p14, saved_at: '2026-10-05T12:51:21.855Z' })
ok('空档刷了时间戳依然不入栈（这一步就是它压掉实质进度的机理）', hist.length === 1)

// 4) 此刻「当前进度」已被空档覆盖 —— 模拟丢数据现场
const currentAfterLoss = p14
ok('丢数据现场：当前进度 0 答', trulyAnsweredCount(currentAfterLoss) === 0)

// 5) 回滚
const recovered = pickHistory(hist, '2026-10-05T10:00:00.000Z')
ok('回滚取回了实质版本', !!recovered && trulyAnsweredCount(recovered) === 60)
const rolled = makeRollbackValue(recovered, 'lpdnplwr', '2026-10-05T21:00:00.000Z')
ok('回滚后当前进度恢复 60 题', trulyAnsweredCount(rolled) === 60)
ok('回滚值时间戳刷新（不会被旧版本顶回）', rolled.saved_at === '2026-10-05T21:00:00.000Z')
ok('回滚值带本机标记', rolled._src && rolled._src.dev === 'lpdnplwr')

// 6) 反向对照：如果没历史栈，就救不回来
ok('反向对照：当前进度里确实没有任何已答记录（无历史栈即永久丢失）',
  Object.values(currentAfterLoss.answer_states).every((s: any) => s.submitted === false))

// ── 演练：连续多版本 + 空档穿插，栈内始终是真版本
let h2: any[] = []
const saves = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7']
for (let i = 0; i < saves.length; i++) {
  h2 = pushHistory(h2, { ...real, saved_at: '2026-10-05T0' + i + ':00:00.000Z', current_id: 500010 + i * 10 })
  h2 = pushHistory(h2, { ...p14, saved_at: '2026-10-05T0' + i + ':30:00.000Z' })  // 每次保存后跟一个空档
}
ok('7 次保存 + 7 次空档 ⇒ 栈内恰好 5 版且全是真版本', h2.length === HISTORY_MAX)
ok('栈内没有被空档污染（每版都有实答）', h2.every((e) => trulyAnsweredCount(e.prog) > 0))
ok('保留的是最近 5 次保存', h2.map((e) => e.saved_at).join(',') ===
  ['2026-10-05T06:00:00.000Z', '2026-10-05T05:00:00.000Z', '2026-10-05T04:00:00.000Z', '2026-10-05T03:00:00.000Z', '2026-10-05T02:00:00.000Z'].join(','))

// ── 演练：变电安规2026 现有 9 个库都入栈，体积估算
let allHist: any = {}
for (const [bid, prog] of Object.entries(cloud)) {
  const h = pushHistory([], prog)
  if (h.length) allHist[bid] = h
}
const histBytes = JSON.stringify(allHist).length
console.log(`\n本机 9 个库入栈后：${Object.keys(allHist).length} 个库有历史（其余是空档，不入栈）`)
console.log(`历史栈体积（实测 1 版/库）：${(histBytes / 1024).toFixed(1)}KB；5 版满栈粗估 ≈ ${(histBytes * 5 / 1024).toFixed(0)}KB`)
ok('历史栈体积在 512KB 上限内（满栈粗估）', histBytes * 5 < 512 * 1024)

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
