// 学习计划每日任务：复习记录必须按「题库 + 题号」复合键匹配（2026-10-20 P1-22）
// 跑法（cwd=shuati-pwa）：node tests/study-plan-task.test.ts
import { calculateDailyTask } from '../src/lib/spaced-repetition.ts'

let pass = 0
let fail = 0
function eq(name: string, actual: any, expected: any): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) { pass++; console.log('✓', name) } else { fail++; console.log('✗', name, '\n  实际:', JSON.stringify(actual), '\n  期望:', JSON.stringify(expected)) }
}

const today = new Date()
today.setHours(0, 0, 0, 0)
const past = new Date(today.getTime() - 86400000).toISOString()
const future = new Date(today.getTime() + 7 * 86400000).toISOString()
const base = { last_review: past, quality: 4, repetitions: 1, ease_factor: 2.5, interval: 1 }
const plan = { id: 1, name: 't', bankIds: [1], dailyGoal: 10 } as any

// 同一题号在另一个库有一条「未到期」记录，本库有一条「到期」记录。
// 旧实现只按 question_id 建表，后写覆盖 => 会把另一库的未到期日套到本库题上。
const records = [
  { ...base, question_id: 5, bank_id: 2, next_review: future },
  { ...base, question_id: 5, bank_id: 1, next_review: past },
]
const task = calculateDailyTask(plan, records as any, [{ id: 5, bankId: 1 }])
eq('复合键：取本库记录（到期）', task.reviewQuestions, [5])
eq('反向对照：不被另一库同号记录顶替成新题', task.newQuestions, [])

// 反向对照：没有 bank_id 的历史记录仍按「仅题号」命中（旧行为不变）
const legacy = [{ ...base, question_id: 5, next_review: past }]
const t2 = calculateDailyTask(plan, legacy as any, [{ id: 5, bankId: 1 }])
eq('反向对照：无 bank_id 的历史记录仍能命中', t2.reviewQuestions, [5])

console.log(`\n${fail === 0 ? '全绿' : '有失败'}：${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
