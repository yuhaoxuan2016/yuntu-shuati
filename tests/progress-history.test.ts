// 断言 sync-ids.ts 的「进度历史栈」纯函数（Node 直跑 TS：`node tests/progress-history.test.ts`）
// 覆盖：空档不入栈 / 同版本去重 / 栈深上限与淘汰 / 深拷隔离 / 取出与回滚语义
import {
  pushHistory, pickHistory, makeRollbackValue, HISTORY_MAX, answeredCountLoose, trulyAnsweredCount, type HistoryEntry,
} from '../src/lib/sync-ids.ts'

let pass = 0, fail = 0
function eq (name: string, actual: any, expected: any): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) { pass++; console.log('✓', name) } else { fail++; console.log('✗', name, '\n  实际:', JSON.stringify(actual), '\n  期望:', JSON.stringify(expected)) }
}
function ok (name: string, cond: boolean): void {
  if (cond) { pass++; console.log('✓', name) } else { fail++; console.log('✗', name) }
}

// 桩用**云端真实形状**（判断题），避免「用假形状测出假绿灯」
const prog = (answered: number, savedAt: string, extra: any = {}) => ({
  mode: 'order', order_ids: [1, 2, 3, 4, 5], current_id: 1,
  answer_states: Object.fromEntries(Array.from({ length: answered }, (_, i) => [
    String(i + 1),
    { selected: [], blankAnswer: '', submitted: true, isCorrect: true, selfEvalDone: false, judgeSelected: true, elapsedSecs: 4 },
  ])),
  finished: false, saved_at: savedAt, ...extra,
})

// ── 空档不入栈（核心：否则每次打开练习页的空档会刷爆栈、把真版本挤出去）
eq('空档（0 答）不入栈', pushHistory([], prog(0, 'T1')), [])
eq('未提交的空档同样不入栈（模拟 lquiz_banks_14 现状）',
  pushHistory([], { ...prog(0, 'T1'), answer_states: { '500002': { selected: [], submitted: false } } }), [])
ok('空档判定走的是严格判据（answeredCountLoose 会误判成 1）',
  answeredCountLoose({ answer_states: { e: { selected: [], blankAnswer: '', submitted: false, isCorrect: false } } }) === 1)
ok('严格判据把「打开未答」判成 0',
  trulyAnsweredCount({ answer_states: { e: { selected: [], blankAnswer: '', submitted: false, isCorrect: false, judgeSelected: null } } }) === 0)
eq('空对象条目不计数', answeredCountLoose({ answer_states: { a: {} } }), 0)

// ── 严格判据：用**云端真实形状**当断言（2026-10-05 普查 99 条 answer_state 的分布）
//   42 × {submitted:true, selected:[], blankAnswer:'', judgeSelected:false}  ← 判断题答"否"
//   40 × {submitted:true, selected:[], blankAnswer:'', judgeSelected:true}   ← 判断题答"是"
//    7 × {submitted:false, selected:[], blankAnswer:'', judgeSelected:null}  ← 空档
//   10 × {submitted:true, selected:[0|1|2], blankAnswer:'', judgeSelected:null} ← 选择题
const judgeNo = { selected: [], blankAnswer: '', submitted: true, isCorrect: true, selfEvalDone: false, judgeSelected: false, elapsedSecs: 5 }
const judgeYes = { ...judgeNo, judgeSelected: true }
const blank = { ...judgeNo, judgeSelected: null, submitted: false, isCorrect: false, elapsedSecs: 3 }
const choice = { ...judgeNo, selected: [1], judgeSelected: null }
ok('判断题答"否"（judgeSelected:false）算答过 —— 不能把 false 当"非判断"排除',
  trulyAnsweredCount({ answer_states: { a: judgeNo } }) === 1)
ok('判断题答"是"算答过', trulyAnsweredCount({ answer_states: { a: judgeYes } }) === 1)
ok('选择题算答过', trulyAnsweredCount({ answer_states: { a: choice } }) === 1)
ok('空档（submitted:false）不算 —— 这正是 lquiz_banks_14 云端的现状',
  trulyAnsweredCount({ answer_states: { a: blank } }) === 0)
ok('真实混合：42 判断否 + 40 判断是 + 10 选择 + 7 空档 = 92',
  trulyAnsweredCount({
    answer_states: Object.fromEntries([
      ...Array.from({ length: 42 }, (_, i) => ['n' + i, judgeNo]),
      ...Array.from({ length: 40 }, (_, i) => ['y' + i, judgeYes]),
      ...Array.from({ length: 10 }, (_, i) => ['c' + i, choice]),
      ...Array.from({ length: 7 }, (_, i) => ['b' + i, blank]),
    ]),
  }) === 92)
ok('反向对照：answeredCountLoose 对同一份混合数据只能数出 99（分不出那 7 个空档）',
  answeredCountLoose({
    answer_states: Object.fromEntries([
      ...Array.from({ length: 42 }, (_, i) => ['n' + i, judgeNo]),
      ...Array.from({ length: 40 }, (_, i) => ['y' + i, judgeYes]),
      ...Array.from({ length: 10 }, (_, i) => ['c' + i, choice]),
      ...Array.from({ length: 7 }, (_, i) => ['b' + i, blank]),
    ]),
  }) === 99)
ok('空档判定走的是严格判据（answeredCountLoose 会误判成 1）',
  answeredCountLoose({ answer_states: { e: blank } }) === 1)
eq('空对象条目不计数', answeredCountLoose({ answer_states: { a: {} } }), 0)

// ── 桥/小程序形状（反向对照：不能只认 submitted）
ok('桥形状 picked 算答过', trulyAnsweredCount({ answer_states: { a: { picked: 'A', correct: false } } }) === 1)
ok('桥形状 correct:true 兜底算答过', trulyAnsweredCount({ answer_states: { a: { picked: null, correct: true } } }) === 1)
ok('桥形状 picked:null 且 correct:false → 不算', trulyAnsweredCount({ answer_states: { a: { picked: null, correct: false } } }) === 0)
ok('混合形状：3 答 + 1 空档 = 3', trulyAnsweredCount({
  answer_states: { a: choice, b: judgeYes, c: { picked: 'A' }, d: blank },
}) === 3)

// ── 实质版本入栈
const h1 = pushHistory([], prog(3, 'T1'))
eq('实质版本入栈长度', h1.length, 1)
eq('栈顶 saved_at', h1[0].saved_at, 'T1')
eq('栈顶已答数', h1[0].answered, 3)
eq('栈顶 current_id', h1[0].current_id, 1)

// ── 同版本去重（防抖保存同一份不该重复占位）
eq('同一 saved_at 重复入栈 → 不变', pushHistory(h1, prog(3, 'T1')).length, 1)
ok('同一 saved_at 重复入栈 → 内容也没变', pushHistory(h1, prog(99, 'T1'))[0].answered === 3)

// ── 新版本压栈顶（新的在前）
const h2 = pushHistory(h1, prog(5, 'T2'))
eq('新版本在栈顶', h2[0].saved_at, 'T2')
eq('旧版本被顶到第二位', h2[1].saved_at, 'T1')

// ── 栈深上限：连续 8 个版本，只留最近 5
let stack: HistoryEntry[] = []
for (let i = 1; i <= 8; i++) stack = pushHistory(stack, prog(i, 'T' + i))
eq('栈深封顶 HISTORY_MAX', stack.length, HISTORY_MAX)
eq('保留的是最近 5 版（T8..T4）', stack.map((e) => e.saved_at), ['T8', 'T7', 'T6', 'T5', 'T4'])
ok('最旧的 T1..T3 已被淘汰', !stack.some((e) => ['T1', 'T2', 'T3'].includes(e.saved_at)))

// ── 空档不占位：真版本之间插空档，栈不变
let withGaps: HistoryEntry[] = []
withGaps = pushHistory(withGaps, prog(2, 'A'))
withGaps = pushHistory(withGaps, prog(0, 'A2'))       // 空档
withGaps = pushHistory(withGaps, prog(4, 'B'))
withGaps = pushHistory(withGaps, prog(0, 'B2'))       // 空档
eq('空档不占位（只剩两个实质版本）', withGaps.map((e) => e.saved_at), ['B', 'A'])
ok('20 个空档也挤不掉实质版本', (() => {
  let s = pushHistory([], prog(7, 'REAL'))
  for (let i = 0; i < 20; i++) s = pushHistory(s, prog(0, 'gap' + i))
  return s.length === 1 && s[0].saved_at === 'REAL'
})())

// ── 深拷隔离：入栈后改写原对象，栈内快照不受影响
const src = prog(3, 'T1')
const snap = pushHistory([], src)
src.answer_states['999'] = { submitted: true }
src.current_id = 42
eq('深拷：栈内快照的题数不受后续改写影响', Object.keys(snap[0].prog.answer_states).length, 3)
eq('深拷：栈内快照的 current_id 不受后续改写影响', snap[0].prog.current_id, 1)
ok('深拷：不是同一引用', snap[0].prog !== src)

// ── 取出某版
eq('按 saved_at 取出对应版本', pickHistory(h2, 'T1').saved_at, 'T1')
eq('取不存在的版本 → null', pickHistory(h2, 'NOPE'), null)
eq('空栈取出 → null', pickHistory(null, 'T1'), null)

// ── 回滚值语义
const rolled = makeRollbackValue(prog(3, 'T1'), 'mydev', 'NOW')
eq('回滚：saved_at 刷新为本次写入', rolled.saved_at, 'NOW')
eq('回滚：_src 重打为本机标记', rolled._src, { dev: 'mydev', v: 3 })
ok('回滚：不残留 _reset', !('_reset' in rolled))
ok('回滚：原版本内容被保留（3 题）', Object.keys(rolled.answer_states).length === 3)
ok('回滚：不修改传入的原对象', (() => { const o = prog(3, 'T1'); makeRollbackValue(o, 'd', 'N'); return o.saved_at === 'T1' })())

// ── 带 _reset 的版本入栈时保留 marked（UI 需提示「这版是清空」）
const marked = pushHistory([], prog(2, 'T1', { _reset: 'R1' }))
eq('入栈保留 marked', marked[0].marked, 'R1')
const norm = pushHistory([], prog(2, 'T1'))
eq('无 _reset 时 marked 为空', norm[0].marked, undefined)

// ── 反向对照：makeRollbackValue 的结果不能还带着 _reset（否则会被当成"有意清空"）
const rb = makeRollbackValue(prog(2, 'T1', { _reset: 'R1' }), 'd', 'N')
ok('反向对照：回滚一份带 _reset 的版本，结果不带 _reset', !('_reset' in rb))

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
