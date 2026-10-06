// 2026-10-07 · 本机硬存档**端到端**守卫（Node 24 原生跑：`node tests/local-archive-e2e.test.ts`）
//
// 与 tests/progress-push-safety.test.ts 的分工：那边测纯函数（入栈/指纹/闸门），
// 这边测**真实模块在真实落盘链路上能不能真的建出存档** —— 把唯一外部依赖（IndexedDB）
// 换成内存桩，其余代码一行不改地跑真实 src/lib/local-archive.ts。
//
// 还要钉住 UI 入口：存档建得出来 ≠ 用户够得着。历史栈（云端参与、可为空）与硬存档
// （纯本机）是**两套数据**，入口只挂在其中一套上 ⇒ 另一套存了也等于白存。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

let pass = 0, fail = 0
function ok (name: string, cond: boolean, extra = ''): void {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; console.log('✗', name, extra ? '\n   ' + extra : '') }
}
function eq (name: string, actual: any, expected: any): void {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected),
    '实际:' + JSON.stringify(actual) + ' 期望:' + JSON.stringify(expected))
}

// ── 把 IndexedDB 换成内存桩，其余跑真实源码 ──────────────────────────────────
const ROOT = process.cwd()
const genDir = join(ROOT, '.tmp-archive-test')
mkdirSync(genDir, { recursive: true })
let src = readFileSync(join(ROOT, 'src/lib/local-archive.ts'), 'utf8')
const before = src
src = src.replace(/import \{ idb \} from '\.\/db'/, `const __MEM: any = ((globalThis as any).__IDB_MEM__ ??= {})
const idb: any = {
  async getSetting (k: string) { return Object.prototype.hasOwnProperty.call(__MEM, k) ? __MEM[k] : null },
  async setSetting (k: string, v: string) { __MEM[k] = v },
}`)
src = src.replace(/from '\.\/sync-ids'/, "from '../src/lib/sync-ids.ts'")
writeFileSync(join(genDir, 'local-archive.ts'), src)
ok('前置：IO 层替换成功（否则测的是空气）',
  src !== before && !src.includes("from './db'") && src.includes('__IDB_MEM__'))

const MEM: Record<string, string> = ((globalThis as any).__IDB_MEM__ ??= {})
;(globalThis as any).window = { localStorage: { getItem: () => 'dev-e2e', setItem: () => {} } }

const { recordLocalArchive, listLocalArchive, restoreLocalArchive, LOCAL_ARCHIVE_KEY, ARCHIVE_MAX } =
  await import('../.tmp-archive-test/local-archive.ts')

// 真实 SavedProgress 形状（与 PracticeView.saveProgressInner 里构造的一致）
function prog (n: number, savedAt: string, extra: any = {}) {
  return {
    mode: 'order',
    order_ids: [101, 102, 103, 104, 105],
    current_id: 101,
    answer_states: Object.fromEntries(Array.from({ length: n }, (_, i) => [
      String(101 + i),
      { selected: [0], submitted: true, isCorrect: true, judgeSelected: null, elapsedSecs: 3 },
    ])),
    finished: false,
    saved_at: savedAt,
    ...extra,
  }
}

console.log('\n── ① 空档 / 坏值不入栈（否则 5 个槽位会被空档占满）──')
{
  ok('0 答不入栈', (await recordLocalArchive('b1', prog(0, '2026-10-07T01:00:00Z'))) === false)
  eq('存档仍为空', (await listLocalArchive('b1')).length, 0)
  ok('空 bankRef 不入栈', (await recordLocalArchive('', prog(2, '2026-10-07T01:00:00Z'))) === false)
  ok('非对象不入栈', (await recordLocalArchive('b1', null as any)) === false)
  ok('反向对照：答过题的就能入栈（上面几条不是一刀切拒绝）',
    (await recordLocalArchive('b1', prog(1, '2026-10-07T01:00:01Z'))) === true)
  eq('此时 1 版', (await listLocalArchive('b1')).length, 1)
}

console.log('\n── ② 答 6 题：能建 5 版、最旧的被淘汰 ──')
{
  MEM[LOCAL_ARCHIVE_KEY] = '{}'
  for (let i = 1; i <= 6; i++) {
    await recordLocalArchive('b1', prog(i, '2026-10-07T0' + i + ':00:00Z'))
  }
  const list = await listLocalArchive('b1')
  eq('存档版本数 = 5（上限）', list.length, ARCHIVE_MAX)
  eq('栈顶是最新（已答 6 题）', list[0].answered, 6)
  eq('栈内已答数从新到旧', list.map((e: any) => e.answered), [6, 5, 4, 3, 2])
  ok('每版都带完整进度快照（恢复才有东西可写回）',
    list.every((e: any) => e && e.prog && typeof e.prog.answer_states === 'object'))
}

console.log('\n── ③ 只翻页 / 重开库不占槽（内容未变）──')
{
  const beforeList = await listLocalArchive('b1')
  const cur = beforeList[0].prog
  ok('只改 current_id + 时间戳 ⇒ 不占槽',
    (await recordLocalArchive('b1', { ...cur, current_id: 999, saved_at: '2026-10-07T09:00:00Z' })) === false)
  eq('版本数不变', (await listLocalArchive('b1')).length, 5)
  ok('反向对照：真多答一题 ⇒ 占槽（上面的"不占"不是恒 false）',
    (await recordLocalArchive('b1', prog(7, '2026-10-07T09:01:00Z'))) === true)
  eq('反向对照后栈顶前进到第 7 题', (await listLocalArchive('b1'))[0].answered, 7)
}

console.log('\n── ④ 多库隔离 ──')
{
  await recordLocalArchive('b2', prog(1, '2026-10-07T10:00:00Z'))
  eq('b1 仍是 5 版', (await listLocalArchive('b1')).length, 5)
  eq('b2 独立 1 版', (await listLocalArchive('b2')).length, 1)
  ok('b2 的快照里没有 b1 的题号',
    Object.keys((await listLocalArchive('b2'))[0].prog.answer_states).length === 1)
}

console.log('\n── ⑤ 恢复：写回进度槽位 + 新时间戳 + 不带 _reset，且不污染存档栈 ──')
{
  const list = await listLocalArchive('b1')
  const target = list[2]                       // 第 3 新的那版
  const savedAtOfTarget = target.saved_at
  const beforeLen = list.length
  const okRestore = await restoreLocalArchive('b1', savedAtOfTarget)
  ok('恢复返回成功', okRestore === true)
  const written = JSON.parse(MEM['practice_progress_b1'] || 'null')
  ok('写回了练习页读的那个键（practice_progress_<ref>）', !!written)
  eq('写回内容的已答数与目标版本一致', Object.keys(written.answer_states || {}).length, target.answered)
  ok('时间戳已刷新（回滚＝一次新写入，否则会被云端旧版本顶回）', written.saved_at !== savedAtOfTarget)
  ok('不带 _reset（回滚不是"有意清空"）', !written._reset)
  eq('恢复本身不入栈（存档栈长度不变）', (await listLocalArchive('b1')).length, beforeLen)
  ok('恢复不存在的版本 ⇒ 返回 false', (await restoreLocalArchive('b1', 'no-such-time')) === false)
}

console.log('\n── ⑥ 云端路径不碰它（源码级）──')
{
  const cloud = readFileSync(join(ROOT, 'src/lib/cloud.ts'), 'utf8')
  ok('cloud.ts 不含存档键', !cloud.includes('local_archive'))
  ok('cloud.ts 不 import local-archive', !/local-archive/.test(cloud))
  const la = readFileSync(join(ROOT, 'src/lib/local-archive.ts'), 'utf8')
  ok('存档键不在 settings 上云白名单里（白名单制：ai_model/daily_records/last_practice/subscriptions）',
    !/const keys = \[[^\]]*local_archive/.test(cloud))
  ok('存档模块自己也不 import cloud（双向隔离）', !/from '\.\/cloud'/.test(la))
}

console.log('\n── ⑦ UI 入口：存得下来还得够得着 ──')
{
  const view = readFileSync(join(ROOT, 'src/views/PracticeView.vue'), 'utf8')
  const btn = view.match(/<button[^>]*history-btn[^>]*>/s)
  ok('🕘 按钮的显示条件同时看两套数据（历史栈 **或** 硬存档）',
    !!btn && btn[0].includes('historyList.length') && btn[0].includes('archiveList.length'),
    btn ? '实际条件:' + btn[0] : '未找到按钮')
  ok('打开面板时重新读取（否则答完题看到的还是进页那一刻的旧列表）',
    /@click="[^"]*refreshHistory\(\)[^"]*showHistory = true|showHistory = true[^"]*refreshHistory\(\)/.test(view)
    || /function openHistory[\s\S]{0,200}refreshHistory/.test(view),
    '未在打开动作里找到 refreshHistory()')
  ok('面板里有独立的硬存档分组', view.includes('本机硬存档'))
  ok('硬存档有独立恢复入口', /onRestoreArchive\(h\)/.test(view))
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
