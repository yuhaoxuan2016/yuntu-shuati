// 断言 lib/wrong-order.ts（Node 24 原生直跑 TS：`node tests/wrong-order.test.ts`）
import { sortByWrongCountDesc, STUBBORN_MIN } from '../src/lib/wrong-order.ts'

let pass = 0, fail = 0
function eq (name: string, actual: any, expected: any): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) { pass++; console.log('✓', name) } else { fail++; console.log('✗', name, '\n  实际:', JSON.stringify(actual), '\n  期望:', JSON.stringify(expected)) }
}

eq('顽固阈值 = 3', STUBBORN_MIN, 3)

// 数字数组（单库路径的用法：id 列表 + 次数查表）
const counts = new Map<number, number>([[1, 2], [2, 5], [3, 1], [4, 5]])
eq('按错次降序', sortByWrongCountDesc([1, 2, 3, 4], id => counts.get(id) || 0), [2, 4, 1, 3])

// 稳定性：同次数保持原顺序
const tied = [{ id: 'a', n: 3 }, { id: 'b', n: 1 }, { id: 'c', n: 3 }]
eq('同次数稳定（不重排）', sortByWrongCountDesc(tied, x => x.n).map(x => x.id), ['a', 'c', 'b'])

// 不改动输入
const src = [1, 2, 3]
sortByWrongCountDesc(src, id => id)
eq('不改动原数组（副本排序）', src, [1, 2, 3])

eq('空列表', sortByWrongCountDesc([] as number[], id => id), [])

// 缺字段兜底：countOf 返回 0/undefined 时沉底且不吐 NaN
const dirty = [{ n: undefined }, { n: 4 }, { n: 0 }]
eq('缺次数视作 0，沉底且同 0 保持原序', sortByWrongCountDesc(dirty, (x: any) => x.n || 0).map(x => x.n), [4, undefined, 0])

console.log(`\n${pass} 通过 / ${fail} 失败`)
if (fail) process.exit(1)
