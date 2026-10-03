// 断言 lib/duration.ts（Node 24 原生直跑 TS：`node tests/duration.test.ts`）
import { formatDuration, msToSecs, hasDuration } from '../src/lib/duration.ts'

let pass = 0, fail = 0
function eq (name: string, actual: any, expected: any): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) { pass++; console.log('✓', name) } else { fail++; console.log('✗', name, '\n  实际:', JSON.stringify(actual), '\n  期望:', JSON.stringify(expected)) }
}

// HH:MM:SS 固定三段（与参考实现一致：不足 1 小时也补小时位）
eq('零 → 00:00:00', formatDuration(0), '00:00:00')
eq('秒级补零', formatDuration(9), '00:00:09')
eq('分秒', formatDuration(65), '00:01:05')
eq('整分', formatDuration(120), '00:02:00')
eq('参考值 1077 题那天 1:55:15', formatDuration(6915), '01:55:15')
eq('参考值 00:23:11', formatDuration(1391), '00:23:11')
eq('超 24 小时不被截断', formatDuration(30 * 3600), '30:00:00')

// 缺字段/脏数据一律归零，不许吐 NaN 或负数
eq('undefined → 零', formatDuration(undefined), '00:00:00')
eq('null → 零', formatDuration(null), '00:00:00')
eq('NaN → 零', formatDuration(NaN), '00:00:00')
eq('负数 → 零', formatDuration(-500), '00:00:00')
eq('字符串数字（云端 JSON 反序列化后可能是字符串）', formatDuration('90' as any), '00:01:30')
eq('上限 999 小时（脏数据不撑破布局）', formatDuration(999 * 3600 + 5000), '999:00:00')

// 毫秒 → 秒
eq('ms 精确取整', msToSecs(1500), 2)
eq('ms 不足 1 秒', msToSecs(400), 0)
eq('ms null', msToSecs(null), 0)
eq('ms 负数', msToSecs(-1000), 0)
eq('ms NaN', msToSecs(NaN), 0)

// 有无时长的显示判据：0 与缺字段都不渲染时长片段
eq('有时长', hasDuration(1), true)
eq('0 不算有', hasDuration(0), false)
eq('缺字段不算有', hasDuration(undefined), false)
eq('负数不算有', hasDuration(-3), false)

console.log(`\n${fail === 0 ? '全绿' : '有失败'}：${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)