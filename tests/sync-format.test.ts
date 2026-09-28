// 断言 sync-format.ts（Node 24 直跑 TS：`node tests/sync-format.test.ts`）
import { formatSyncDetail, formatBankNames } from '../src/lib/sync-format.ts'

let pass = 0, fail = 0
function eq (name: string, actual: any, expected: any): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) { pass++; console.log('✓', name) } else { fail++; console.log('✗', name, '\n  实际:', JSON.stringify(actual), '\n  期望:', JSON.stringify(expected)) }
}

eq('全 0 → 无新增内容', formatSyncDetail({ banks: [], questions: 0, records: 0, subscriptions: 0, settings: 0 }), '无新增内容')
eq('null → 无新增内容', formatSyncDetail(null), '无新增内容')
eq('完整五类', formatSyncDetail({ banks: ['初级2026', '中级2026'], questions: 833, records: 5, subscriptions: 3, settings: 1 }),
  '题库 2 个（初级2026、中级2026） · 题目 833 道 · 记录 5 条 · 订阅 3 个 · 设置 1 项')
eq('为 0 类别省略', formatSyncDetail({ questions: 12 }), '题目 12 道')
eq('名单 3 个内全列', formatBankNames(['a', 'b', 'c']), '3 个（a、b、c）')
eq('名单超 3 折叠（反向对照：不出现第 4 个名字）', formatBankNames(['a', 'b', 'c', 'd', 'e']), '5 个（a、b、c 等 5 个）')
eq('空名单不产出占位', formatBankNames([]), '')
eq('名单空白项过滤', formatBankNames(['', '  ', 'a']), '1 个（a）')
eq('负数/NaN 视为 0（省略）', formatSyncDetail({ questions: -1 as any, records: NaN as any }), '无新增内容')
eq('小数向下取整', formatSyncDetail({ questions: 3.9 }), '题目 3 道')

// 订阅名单（2026-09-28）
eq('订阅带名单', formatSyncDetail({ subscriptions: 2, subsNames: ['中级2026', '变电安规2026'] }),
  '订阅 2 个（中级2026、变电安规2026）')
eq('订阅无名单 → 退回数量', formatSyncDetail({ subscriptions: 2 }), '订阅 2 个')
eq('订阅名单全空白 → 退回数量', formatSyncDetail({ subscriptions: 2, subsNames: ['', ' '] }), '订阅 2 个')
eq('订阅名单与数量不一致时以名单为准', formatSyncDetail({ subscriptions: 9, subsNames: ['中级2026'] }), '订阅 1 个（中级2026）')

console.log(`\n${fail === 0 ? '全绿' : '有失败'}：${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
