// 离线断言（2026-10-03）：小程序上行进度的「重塑」纯函数——题号从
// `bankRef::id:<云题 _id>` 映射到本机题号；映射不到一律丢弃（绝不挂错号）。
// 用法（Node 24 直跑 TS）: node tests/mp-progress-reshape.test.ts
import { reshapeMpProgress } from '../src/lib/sync-ids.ts'

let pass = 0
let fail = 0
function eq (name: string, actual: any, expected: any): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) { pass++; console.log('✓', name) } else { fail++; console.log('✗', name, '\n  实际:', JSON.stringify(actual), '\n  期望:', JSON.stringify(expected)) }
}

const idMap = new Map<string, number>([['q1', 11], ['q2', 22], ['q3', 33]])

{
  const out = reshapeMpProgress({
    mode: 'order',
    order_ids: ['b::id:q1', 'b::id:qX', 'b::id:q2'],
    current_id: 'b::id:q2',
    answer_states: { 'b::id:q1': { submitted: true, isCorrect: true }, 'b::id:qX': { submitted: true } },
    saved_at: '2026-10-03T00:00:00.000Z',
    _src: { dev: 'mp', v: 3 },
  }, idMap)
  eq('题号映射到本机号；映射不到的丢弃', out && out.order_ids, [11, 22])
  eq('current_id 映射', out && out.current_id, 22)
  eq('answer_states 只保留映射成功的键', out && Object.keys(out.answer_states), ['11'])
  eq('saved_at 保留（合并比较基准）', out && out.saved_at, '2026-10-03T00:00:00.000Z')
  eq('_src 保留（下游合并据此识别来源）', out && out._src, { dev: 'mp', v: 3 })
  // 2026-10-10（B1 反向对照）：已是网页端形状的条目不得被改写（不得补出 picked→selected 那套字段）
  eq('重塑保留网页端形状条目原样（反向对照）', out && out.answer_states['11'], { submitted: true, isCorrect: true })
}

{
  eq('全部映射失败 → null（放弃合并）', reshapeMpProgress({ order_ids: ['b::id:qX'], saved_at: 1 }, idMap), null)
  eq('空入参 → null', reshapeMpProgress(null, idMap), null)
  eq('非对象 → null', reshapeMpProgress('x', idMap), null)
  const out2 = reshapeMpProgress({ order_ids: ['plain::id:q1'], saved_at: 1 }, idMap)
  eq('按最后一个 ::id: 解析（前缀任意）', out2 && out2.order_ids, [11])
  eq('current_id 缺失时回落到首题', out2 && out2.current_id, 11)
  const out3 = reshapeMpProgress({ order_ids: ['b::id:q3'], saved_at: 2, finished: true }, idMap)
  eq('finished 原样透传', out3 && out3.finished, true)
}

// 2026-10-10（B1 形状归一）：重塑出的 answer_states 条目必须是网页端 QuestionState 形状 ——
// 小程序形状 `{picked,correct}` 进不去 QuestionCard（读 `saved?.submitted` 恒 undefined ⇒ 对错不显示）。
{
  const webIn = { submitted: true, isCorrect: true }
  const outW = reshapeMpProgress({
    mode: 'order',
    order_ids: ['b::id:q1', 'b::id:q2', 'b::id:q3'],
    current_id: 'b::id:q2',
    answer_states: {
      'b::id:q1': { picked: [2, 0], correct: false },
      'b::id:q2': { picked: [], correct: false },
      'b::id:q3': webIn,
    },
    saved_at: '2026-10-10T00:00:00.000Z',
  }, idMap)
  eq('重塑：小程序形状 → 网页端 QuestionState（picked → selected、submitted 补 true）', outW && outW.answer_states['11'],
    { selected: [2, 0], blankAnswer: '', submitted: true, isCorrect: false, selfEvalDone: false, judgeSelected: null, elapsedSecs: null })
  eq('重塑：picked 空数组保真（判断题答否）', outW && outW.answer_states['22'],
    { selected: [], blankAnswer: '', submitted: true, isCorrect: false, selfEvalDone: false, judgeSelected: null, elapsedSecs: null })
  eq('重塑反向对照：网页端形状条目引用不变（未被强行整形）', outW && outW.answer_states['33'] === webIn, true)
  eq('重塑：两种形状共存时互不干扰', outW && Object.keys(outW.answer_states).sort(), ['11', '22', '33'])
}

console.log(`\n${fail ? '✗' : '全绿'}：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
