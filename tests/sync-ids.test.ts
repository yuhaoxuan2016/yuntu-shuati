// 断言 sync-ids.ts 的纯函数（Node 24 直跑 TS：`node tests/sync-ids.test.ts`）
// 覆盖：来源索引 / 单号映射 / 进度重映射 / 合并决策（他机·本机·自愈·库缺失）/ 设备指纹持久
import {
  buildSrcLocalIndex, mapSrcToLocal, remapProgress, mergeProgressForLocal, mergeProgressMapForCloud, getOrCreateDeviceId, orderHitRate, submittedCount, answeredCountLoose, trulyAnsweredCount,
} from '../src/lib/sync-ids.ts'

let pass = 0, fail = 0
function eq (name: string, actual: any, expected: any): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) { pass++; console.log('✓', name) } else { fail++; console.log('✗', name, '\n  实际:', JSON.stringify(actual), '\n  期望:', JSON.stringify(expected)) }
}

// ── 索引与单号映射
const qs = [
  { id: 101, src_local_id: 5 },
  { id: 102, src_local_id: 6 },
  { id: 103 },                      // 无来源号（本机自产）不进索引
]
const idx = buildSrcLocalIndex(qs as any)
eq('索引只收带 src_local_id 的题', [...idx.entries()], [[5, 101], [6, 102]])
eq('命中映射', mapSrcToLocal(idx, 5), 101)
eq('未命中 → null', mapSrcToLocal(idx, 999), null)
eq('垃圾输入 → null', mapSrcToLocal(idx, 'abc'), null)
eq('字符串数字可映射', mapSrcToLocal(idx, '6'), 102)

// ── 进度重映射（反向对照：映射后必须 ≠ 源号，且失败项被剔除而非保留）
const remapped = remapProgress({ mode: 'order', order_ids: [5, 6, 7], current_id: 6, answer_states: { '5': { a: 1 }, '7': { b: 2 } }, saved_at: 'T' }, idx)
eq('order 映射并剔除无主项', remapped.order_ids, [101, 102])
eq('映射后不再是源号（反向对照）', remapped.order_ids.includes(5 as any), false)
eq('current_id 映射', remapped.current_id, 102)
eq('answer_states 只保留可映射键', Object.keys(remapped.answer_states), ['101'])

// ── 合并决策
const ME = 'devA', OTHER = 'devB'
const cloudOther = { mode: 'order', order_ids: [5, 6], current_id: 5, saved_at: '2026-09-27T10:00:00Z' }
const r1 = mergeProgressForLocal(cloudOther, null, ME, idx)
eq('他机进度 + 本地无 → 写入', r1.write, true)
eq('  内容已映射', r1.value.order_ids, [101, 102])
eq('  打上本机标记', r1.value._src, { dev: ME, v: 3 })

const mirror = JSON.stringify(cloudOther)   // 本机现存「他机镜像」（无标记，saved_at 相同）
const r2 = mergeProgressForLocal(cloudOther, mirror, ME, idx)
eq('同刻 + 本地是未映射镜像 → 覆盖自愈', r2.write, true)
eq('  自愈后编号正确', r2.value.current_id, 101)

const mine = JSON.stringify({ ...cloudOther, order_ids: [101, 102], current_id: 101, _src: { dev: ME, v: 3 } })
const r3 = mergeProgressForLocal(cloudOther, mine, ME, idx)
eq('同刻 + 本地是本机最终形态 → 保持本地（防二次误映射）', r3.write, false)

// v 版本闸门：v2 的「本机最终形态」不可信（判据错误泛化的历史版本）⇒ 同刻也重算
const mineV2 = JSON.stringify({ ...cloudOther, order_ids: [5, 6], current_id: 5, _src: { dev: ME, v: 2 } })
const r8 = mergeProgressForLocal(cloudOther, mineV2, ME, idx)
eq('v2 旧版本 + 同刻 → 重算（不被当成最终态）', r8.write, true)
eq('  重算后编号被映射', r8.value.current_id, 101)

const newer = JSON.stringify({ mode: 'order', order_ids: [101], current_id: 101, saved_at: '2026-09-27T11:00:00Z', _src: { dev: ME, v: 2 } })
const r4 = mergeProgressForLocal(cloudOther, newer, ME, idx)
eq('本地更新 → 不覆盖', r4.write, false)

const cloudMine = { ...cloudOther, order_ids: [101, 102], current_id: 101, _src: { dev: ME, v: 2 } }
const r5 = mergeProgressForLocal(cloudMine, null, ME, idx)
eq('云端内容来自本机 → 原样采用（不再映射）', r5.write, true)
eq('  原样 = 编号不变', r5.value.order_ids, [101, 102])

const r6 = mergeProgressForLocal(cloudOther, null, ME, new Map())
eq('库不在本机（索引空）→ 不落地', r6.write, false)

// passthrough（订阅库/公共库：题号是云端稳定 id，跨端天然一致，不做映射）
const r7 = mergeProgressForLocal(cloudOther, null, ME, new Map(), true)
eq('passthrough → 原样采用', r7.write, true)
eq('  题号保持云端稳定 id（反向对照：不得被映射）', r7.value.order_ids, [5, 6])

// ── 守卫（2026-09-28）：本地近乎空 + 云端实质 → 取云端（防「打开页面自动生成的新进度」顶掉云端）
const ans = (n: number) => Object.fromEntries(
  Array.from({ length: n }, (_, i) => [String(100 + i), { submitted: true, isCorrect: i % 2 === 0 }]))
const cloudReal = { mode: 'order', order_ids: [5, 6], current_id: 5, answer_states: ans(6), saved_at: '2026-09-27T10:00:00Z' }
eq('submittedCount：只数已提交', submittedCount({ answer_states: { a: { submitted: true }, b: { submitted: false }, c: {} } }), 1)
eq('submittedCount：空/垃圾 → 0', [submittedCount(null), submittedCount({}), submittedCount({ answer_states: 'x' })], [0, 0, 0])

const freshEmptyNewer = JSON.stringify({ mode: 'order', order_ids: [101, 102], current_id: 101, answer_states: {}, saved_at: '2026-09-27T12:00:00Z' })
const g1 = mergeProgressForLocal(cloudReal, freshEmptyNewer, ME, idx)
eq('守卫：本地空(更新) + 云 6 题 → 取云端（覆盖时间戳）', g1.write, true)
eq('  内容按本机号映射', g1.value.current_id, 101)

const cloudSmall = { ...cloudReal, answer_states: ans(3) }
const g2 = mergeProgressForLocal(cloudSmall, freshEmptyNewer, ME, idx)
eq('守卫：云端仅 3 题（不足实质）→ 不触发，保持本地', g2.write, false)

const resetLocal = JSON.stringify({ mode: 'order', order_ids: [101, 102], current_id: 101, answer_states: {}, _reset: '2026-09-27T12:00:00Z', saved_at: '2026-09-27T12:00:00Z' })
const g3 = mergeProgressForLocal(cloudReal, resetLocal, ME, idx)
eq('守卫：本机带 _reset（故意的重置）→ 不被顶回', g3.write, false)

const oneAnswered = JSON.stringify({ mode: 'order', order_ids: [101, 102], current_id: 101, answer_states: { '101': { submitted: true } }, saved_at: '2026-09-27T12:00:00Z' })
const g4 = mergeProgressForLocal(cloudReal, oneAnswered, ME, idx)
eq('守卫：本地 1 题已答（≤1）→ 仍取云端', g4.write, true)

const twoAnswered = JSON.stringify({ mode: 'order', order_ids: [101, 102], current_id: 101, answer_states: { '101': { submitted: true }, '102': { submitted: true } }, saved_at: '2026-09-27T12:00:00Z' })
const g5 = mergeProgressForLocal(cloudReal, twoAnswered, ME, idx)
eq('守卫边界：本地 2 题已答 → 不触发（本地更新即保留）', g5.write, false)

// ── 命中率（下载侧「进度与题库对不上」保护判定）
eq('hitRate：全命中 → 1', orderHitRate({ order_ids: [101, 102] }, new Set([101, 102])), 1)
eq('hitRate：全不命中 → 0', orderHitRate({ order_ids: [5, 6] }, new Set([101, 102])), 0)
eq('hitRate：空 order_ids → 1（不误判）', orderHitRate({ order_ids: [] }, new Set()), 1)

// ── 上传侧逐键合并（mergeProgressMapForCloud）
// 场景：B 设备（本机）只有 bankB 的进度，云端还有 A 设备写的 bankA —— 旧行为「整条覆盖」会把 bankA 抹掉。
const localB = { bankB: { mode: 'order', order_ids: [101], current_id: 101, answer_states: ans(1), saved_at: '2026-09-28T10:00:00Z', _src: { dev: ME, v: 3 } } }
const cloudAB = { bankA: { mode: 'order', order_ids: [5], current_id: 5, answer_states: ans(6), saved_at: '2026-09-28T09:00:00Z', _src: { dev: OTHER, v: 3 } } }
const mp1 = mergeProgressMapForCloud(cloudAB, localB)
eq('上传合并：云端独有的键被保留（旧行为会丢）', Object.keys(mp1.map).sort(), ['bankA', 'bankB'])
eq('  bankA 内容仍是云端那份（未被本机改写）', mp1.map.bankA._src, { dev: OTHER, v: 3 })
eq('  bankB 是本机这份', mp1.map.bankB.saved_at, '2026-09-28T10:00:00Z')
eq('  计入「采用云端」的库数', mp1.tookCloud, 0)

// 同键两边都有：本机较新 → 取本机；云端较新 → 取云端（两个方向都要有断言，防「一律取本机」的假绿）
const newerLocal = { k: { answer_states: ans(6), saved_at: '2026-09-28T12:00:00Z' } }
const olderLocal = { k: { answer_states: ans(6), saved_at: '2026-09-28T08:00:00Z' } }
const cloudK = { k: { answer_states: ans(2), saved_at: '2026-09-28T11:00:00Z' } }
eq('同键：本机较新 → 本机', mergeProgressMapForCloud(cloudK, newerLocal).map.k.saved_at, '2026-09-28T12:00:00Z')
const mp2 = mergeProgressMapForCloud(cloudK, olderLocal)
eq('同键：云端较新 → 云端（反向对照）', mp2.map.k.saved_at, '2026-09-28T11:00:00Z')
eq('  计入 tookCloud', mp2.tookCloud, 1)

// 守卫：本机近乎空 + 云端实质 → 保留云端（防「打开练习页自动生成的空进度」按时间戳顶掉真实进度）
const emptyNewerLocal = { k: { answer_states: {}, saved_at: '2026-09-28T13:00:00Z' } }
const cloudSubstantial = { k: { answer_states: ans(6), saved_at: '2026-09-28T11:00:00Z' } }
eq('守卫：本机空但时间新 → 仍取云端', mergeProgressMapForCloud(cloudSubstantial, emptyNewerLocal).map.k.saved_at, '2026-09-28T11:00:00Z')
const resetLocalMap = { k: { answer_states: {}, _reset: '2026-09-28T13:00:00Z', saved_at: '2026-09-28T13:00:00Z' } }
eq('守卫：本机带 _reset（故意的重置）→ 取本机', mergeProgressMapForCloud(cloudSubstantial, resetLocalMap).map.k.saved_at, '2026-09-28T13:00:00Z')

// 空/坏输入：不抛、按空处理；两边都空 → 空 map
eq('坏输入不炸（null / 数组 / 字符串）', [
  Object.keys(mergeProgressMapForCloud(null, null).map).length,
  Object.keys(mergeProgressMapForCloud([] as any, { k: 1 }).map).length,
  Object.keys(mergeProgressMapForCloud({ k: 1 }, 'x' as any).map).length,
], [0, 1, 1])

// ── 反向守卫（2026-10-04）：**云端近乎空 + 本机有实质 + 云端无 `_reset` ⇒ 不许顶掉本机**
//    实测经过：rabbit 在网页端答到 51 题的库，被小程序侧「刚打开该库生成、0 答但时间戳更新」的条目
//    压成 0；随后网页端一拉，本机也跟着归零。守卫与 `_reset`（有意清空）成对。
const bigStates = (n: number) => Object.fromEntries(
  Array.from({ length: n }, (_, i) => [String(200 + i), { submitted: true, isCorrect: true }]))
const localBig = JSON.stringify({ mode: 'order', order_ids: [101, 102], current_id: 101, answer_states: bigStates(20), saved_at: '2026-10-04T11:40:00Z', _src: { dev: ME, v: 3 } })
const cloudEmptyNewer = { mode: 'order', order_ids: [5, 6], current_id: 5, answer_states: {}, saved_at: '2026-10-04T12:28:00Z' }
eq('反向守卫（拉）：云端空档 + 本机 20 题 → 不落地，保住本机',
  mergeProgressForLocal(cloudEmptyNewer, localBig, ME, idx).write, false)
eq('反向守卫（拉）：云端空但带 _reset（对方有意清空）→ 放行',
  mergeProgressForLocal({ ...cloudEmptyNewer, _reset: '2026-10-04T12:28:00Z' }, localBig, ME, idx).write, true)

const localMapBig = { k: { answer_states: bigStates(20), saved_at: '2026-10-04T11:40:00Z' } }
const cloudMapEmptyNewer = { k: { answer_states: {}, saved_at: '2026-10-04T12:28:00Z' } }
eq('反向守卫（推）：云端空档不许盖掉本机实质',
  mergeProgressMapForCloud(cloudMapEmptyNewer, localMapBig).map.k.saved_at, '2026-10-04T11:40:00Z')
eq('反向守卫（推）：云端带 _reset 则放行',
  mergeProgressMapForCloud({ k: { ...cloudMapEmptyNewer.k, _reset: 'x' } }, localMapBig).map.k.saved_at, '2026-10-04T12:28:00Z')

// 形状无关计数：**小程序经桥写进来的**条目形状是 `{picked, correct}`（没有 `submitted`）——
// 用只认 `submitted` 的旧计数会把它们数成 0、把实质进度误判成空档（这条守卫必须形状无关）。
eq('answeredCountLoose：两种形状都数、空档/垃圾为 0', [
  answeredCountLoose({ answer_states: { a: { submitted: true }, b: { picked: [1], correct: true }, c: {}, d: null } }),
  answeredCountLoose({ answer_states: {} }),
  answeredCountLoose(null),
], [2, 0, 0])
eq('反向对照：submittedCount 对桥形状数 0（＝必须换计数的理由）',
  submittedCount({ answer_states: { a: { picked: [1], correct: true } } }), 0)
const localMapBridgeShape = { k: { answer_states: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [String(i), { picked: [0], correct: true }])), saved_at: '2026-10-04T11:40:00Z' } }
eq('反向守卫：本机是桥形状（picked/correct）也认得出实质',
  mergeProgressMapForCloud(cloudMapEmptyNewer, localMapBridgeShape).map.k.saved_at, '2026-10-04T11:40:00Z')

// ── 2026-10-05 根因第 3 层：守卫判据统一为 trulyAnsweredCount
// 现场（rabbit 的 lquiz_banks_15）：云端有 641 条实质、本机是「刚打开」的空档（1 条 submitted:false）。
// 旧写法用 submittedCount 数云端 —— 若云端那份是桥形状（{picked,correct}）就恒为 0 ⇒ 守卫失效、空档反压。
const bridgeSubstantial = { answer_states: Object.fromEntries(Array.from({ length: 641 }, (_, i) => [String(i), { picked: [0], correct: i % 3 === 0 }])), saved_at: '2026-10-04T03:49:01.100Z' }
const webEmptyNewer = { answer_states: { '500002': { selected: [], blankAnswer: '', submitted: false, isCorrect: false, selfEvalDone: false, judgeSelected: null, elapsedSecs: 3 } }, saved_at: '2026-10-05T12:51:21.855Z' }
eq('根因3（拉）：云端是桥形状的 641 条实质 → 即使本机时间戳更新也必须采用云端',
  mergeProgressForLocal(bridgeSubstantial, JSON.stringify(webEmptyNewer), 'dev', new Map(), true).write, true)
eq('根因3（拉）：反向对照 —— 旧 submittedCount 对桥形状数 0（正是守卫失效的原因）',
  submittedCount(bridgeSubstantial), 0)
eq('根因3（拉）：本机空档带 _reset（有意重置）时不触发守卫 → 按时间戳取本机',
  mergeProgressForLocal(bridgeSubstantial, JSON.stringify({ ...webEmptyNewer, _reset: 'x' }), 'dev', new Map(), true).write, false)
// 「打开过未作答」的条目在 answeredCountLoose 下返回 1 —— 反向守卫的 `<=1` 恰好吃住它，
// 但换成 trulyAnsweredCount 后语义更准（空档恒为 0），不会把 1 条空档误当实质。
const localOneGap = { answer_states: { g: { selected: [], blankAnswer: '', submitted: false, isCorrect: false } }, saved_at: '2026-10-05T12:51:21.855Z' }
eq('根因3（推）：本机只有 1 条空档时不算「实质」→ 不会被反向守卫拦住（正常走时间戳）',
  mergeProgressMapForCloud({ k: bridgeSubstantial }, { k: localOneGap }).map.k.saved_at, '2026-10-04T03:49:01.100Z')
eq('根因3：严格计数把空档判 0（answeredCountLoose 会判 1）', [
  trulyAnsweredCount(localOneGap), answeredCountLoose(localOneGap),
], [0, 1])

// ── 设备指纹
const mem: Record<string, string> = {}
const kv = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v } }
const d1 = getOrCreateDeviceId(kv)
const d2 = getOrCreateDeviceId(kv)
eq('设备指纹生成且持久（两次一致）', d1 === d2 && d1.length >= 6, true)

console.log(`\n${fail === 0 ? '全绿' : '有失败'}：${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
