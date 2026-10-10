// 断言 sync-ids.ts 的纯函数（Node 24 直跑 TS：`node tests/sync-ids.test.ts`）
// 覆盖：来源索引 / 单号映射 / 进度重映射 / 合并决策（他机·本机·自愈·库缺失）/ 设备指纹持久
// 2026-10-10 起补：B1 形状归一 / B2 逐键合并 / 缩水守卫（每条带反向对照）
import {
  buildSrcLocalIndex, mapSrcToLocal, remapProgress, mergeProgressForLocal, mergeProgressMapForCloud, getOrCreateDeviceId, orderHitRate, submittedCount, answeredCountLoose, trulyAnsweredCount,
  normalizeAnswerStates, isSeverelyShrunk,
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

// ── 2026-10-10（B1 形状归一）：小程序/桥形状 `{picked,correct}` 条目 → 网页端 QuestionState。
// 现场：小程序推上云的每题对错混进网页端本地后，QuestionCard 读 `saved?.submitted` 恒为 undefined
// ⇒ 对错不显示、正确率不计（PracticeView 的 `s.submitted && s.isCorrect === true`）。
const webState = { selected: [2], blankAnswer: '甲', submitted: true, isCorrect: false, selfEvalDone: true, judgeSelected: true, elapsedSecs: 9 }
const normed = normalizeAnswerStates({ mode: 'order', answer_states: { '10': { picked: [1, 0], correct: true }, '11': webState, '12': { picked: [], correct: false } } })
eq('归一：小程序形状 → 网页端 QuestionState（picked → selected、submitted 补 true）', normed.answer_states['10'],
  { selected: [1, 0], blankAnswer: '', submitted: true, isCorrect: true, selfEvalDone: false, judgeSelected: null, elapsedSecs: null })
eq('归一：correct=false 保真（判断题答否）', normed.answer_states['12'],
  { selected: [], blankAnswer: '', submitted: true, isCorrect: false, selfEvalDone: false, judgeSelected: null, elapsedSecs: null })
eq('归一：picked 非数组 → selected 空数组', normalizeAnswerStates({ answer_states: { k: { picked: null, correct: true } } }).answer_states.k.selected, [])
eq('归一反向对照：网页端条目原样（引用不变、字段不被覆盖）', normed.answer_states['11'] === webState, true)
eq('归一判据优先级：同时带 submitted 与 picked ⇒ 按网页端处理（原样）',
  normalizeAnswerStates({ answer_states: { k: { submitted: false, picked: [1], correct: true } } }).answer_states.k,
  { submitted: false, picked: [1], correct: true })
eq('归一：两种形状都不像的条目原样（null、空对象）', normalizeAnswerStates({ answer_states: { a: null, b: {} } }).answer_states, { a: null, b: {} })
eq('归一：进度其它字段不丢', normed.mode, 'order')

// 落地收口：经 mergeProgressForLocal（直通分支）落盘后，条目必须是网页端形状（B1 的实际出口）
const bridgeCloud = { mode: 'order', order_ids: [5, 6], current_id: 5, answer_states: { '5': { picked: [0], correct: true } }, saved_at: '2026-10-10T08:00:00Z', _src: { dev: 'mp', v: 3 } }
const landMp = mergeProgressForLocal(bridgeCloud, null, ME, new Map(), true)
eq('归一（收口·直通分支）：桥形状经合并落盘为网页端形状', landMp.value.answer_states['5'],
  { selected: [0], blankAnswer: '', submitted: true, isCorrect: true, selfEvalDone: false, judgeSelected: null, elapsedSecs: null })
eq('归一（收口）：不就地改写来源对象（云端那份仍是桥形状）', bridgeCloud.answer_states['5'], { picked: [0], correct: true })
const localBridge = JSON.stringify({ mode: 'order', order_ids: [5, 6], current_id: 5, answer_states: { '6': { picked: [1], correct: false } }, saved_at: '2026-10-10T07:00:00Z', _src: { dev: ME, v: 3 } })
const landBoth = mergeProgressForLocal(bridgeCloud, localBridge, ME, new Map(), true)
eq('归一（收口）：本机侧历史桥形状条目写出时同样归一（本机独有键保留）', landBoth.value.answer_states['6'],
  { selected: [1], blankAnswer: '', submitted: true, isCorrect: false, selfEvalDone: false, judgeSelected: null, elapsedSecs: null })

// ── 2026-10-10（B2 逐键合并）：整包按 saved_at 替换会删掉本机独有的作答键（本机改判/重答也传不回小程序）
// ⇒ 同名键由较新的一方覆盖、双方独有键都保留。
const stW = (c: boolean) => ({ selected: [1], blankAnswer: '', submitted: true, isCorrect: c, selfEvalDone: false, judgeSelected: null, elapsedSecs: null })
const b2Cloud = { mode: 'order', order_ids: [7], current_id: 7, answer_states: { '101': stW(false), '104': stW(true) }, saved_at: '2026-10-10T10:00:00Z' }
const b2LocalOlder = JSON.stringify({ mode: 'order', order_ids: [7], current_id: 7, answer_states: { '101': stW(true), '102': stW(false), '103': stW(true) }, saved_at: '2026-10-10T09:00:00Z', _src: { dev: ME, v: 3 } })
const b2a = mergeProgressForLocal(b2Cloud, b2LocalOlder, ME, new Map(), true)
eq('B2（云端较新 ⇒ 采用并合并）：同名键取云端值', b2a.value.answer_states['101'].isCorrect, false)
eq('B2（云端较新）：本机独有键保留（旧行为整包替换会丢）', ['102', '103'].map(k => !!b2a.value.answer_states[k]), [true, true])
eq('B2（云端较新）：云端独有键也在', b2a.value.answer_states['104'].isCorrect, true)

// 本机较新：常规「取新」下本机较新不写（本地就是对的）⇒「本机覆盖同名键」只在守卫触发时才轮到（用该入口验）
const b2Cloud6 = { mode: 'order', order_ids: [7], current_id: 7, answer_states: Object.fromEntries([101, 102, 103, 104, 105, 106].map(k => [String(k), stW(false)])), saved_at: '2026-10-10T08:00:00Z' }
const b2LocalNewerOne = JSON.stringify({ mode: 'order', order_ids: [7], current_id: 7, answer_states: { '101': stW(true) }, saved_at: '2026-10-10T09:00:00Z', _src: { dev: ME, v: 3 } })
const b2b = mergeProgressForLocal(b2Cloud6, b2LocalNewerOne, ME, new Map(), true)
eq('B2（本机较新 · 守卫采用）：同名键本机赢', b2b.value.answer_states['101'].isCorrect, true)
eq('B2（本机较新 · 守卫采用）：云端独有键都保留', Object.keys(b2b.value.answer_states).sort(), ['101', '102', '103', '104', '105', '106'])

// 同刻自愈路径（本地为未映射镜像、非本机态）：ct === lt ⇒ 采用云端，合并口径同上（本机覆盖同名键）
const b2T = '2026-10-10T09:00:00Z'
const b2c = mergeProgressForLocal(
  { mode: 'order', order_ids: [7], current_id: 7, answer_states: { '101': stW(false), '104': stW(true) }, saved_at: b2T },
  JSON.stringify({ mode: 'order', order_ids: [7], current_id: 7, answer_states: { '101': stW(true), '102': stW(true) }, saved_at: b2T }),
  ME, new Map(), true)
eq('B2（同刻采用）：同名键本机赢', b2c.value.answer_states['101'].isCorrect, true)
eq('B2（同刻采用）：双方独有键都保留', Object.keys(b2c.value.answer_states).sort(), ['101', '102', '104'])

// ── 2026-10-10（缩水守卫 · 补中间带）：旧守卫只拦「≤1 vs ≥5」的绝对空档，中间带（来方 2~49%）不拦 ——
// 来方 50 vs 现有 200 且 saved_at 更新 ⇒ 完整版会被缩水版压掉。新判据 = 来方不足现有的一半。
const stBig = (n: number, base = 300) => Object.fromEntries(Array.from({ length: n }, (_, i) => [String(base + i), { submitted: true, isCorrect: i % 2 === 0 }]))
const shrinkCloud50 = { mode: 'order', order_ids: [7], current_id: 7, answer_states: stBig(50), saved_at: '2026-10-10T10:00:00Z' }
const localProg200 = () => JSON.stringify({ mode: 'order', order_ids: [7], current_id: 7, answer_states: stBig(200), saved_at: '2026-10-10T09:00:00Z', _src: { dev: ME, v: 3 } })
const localProg50 = () => JSON.stringify({ mode: 'order', order_ids: [7], current_id: 7, answer_states: stBig(50), saved_at: '2026-10-10T09:00:00Z', _src: { dev: ME, v: 3 } })
eq('缩水守卫（拉）：云端 50 vs 本机 200 且云端时间新 ⇒ 不采用（旧守卫全不触发）',
  mergeProgressForLocal(shrinkCloud50, localProg200(), ME, new Map(), true).write, false)
const adopt200 = mergeProgressForLocal({ ...shrinkCloud50, answer_states: stBig(200) }, localProg50(), ME, new Map(), true)
eq('缩水守卫（拉）反向对照：云端 200 vs 本机 50 ⇒ 采用（不是「小的一律拦」）', adopt200.write, true)
eq('  采用内容 = 200 条（合并后键数不减）', Object.keys(adopt200.value.answer_states).length, 200)
eq('缩水守卫（拉）：来方带 _reset（有意清空）⇒ 放行',
  mergeProgressForLocal({ ...shrinkCloud50, _reset: '2026-10-10T10:00:00Z' }, localProg200(), ME, new Map(), true).write, true)
eq('缩水守卫（拉）反向对照：来方 120 vs 现有 200（没少一半）⇒ 照常按时间取新',
  mergeProgressForLocal({ ...shrinkCloud50, answer_states: stBig(120) }, localProg200(), ME, new Map(), true).write, true)
eq('缩水判据直测与边界：50 vs 200 ⇒ 缩水；恰好一半（100 vs 200）⇒ 不算；现有不足下限（4）⇒ 不算', [
  isSeverelyShrunk({ answer_states: stBig(200) }, { answer_states: stBig(50) }),
  isSeverelyShrunk({ answer_states: stBig(200) }, { answer_states: stBig(100) }),
  isSeverelyShrunk({ answer_states: stBig(4) }, { answer_states: stBig(1) }),
], [true, false, false])

// 推送侧（mergeProgressMapForCloud）：同一判据，逐库判断
const pushBig = { k: { answer_states: stBig(200, 600), saved_at: '2026-10-10T10:00:00Z' } }
const pushShrunk = mergeProgressMapForCloud(pushBig, { k: { answer_states: stBig(50, 600), saved_at: '2026-10-10T11:00:00Z' } })
eq('缩水守卫（推）：本机 50 vs 云端 200 且本机时间新 ⇒ 保留云端', pushShrunk.map.k.saved_at, '2026-10-10T10:00:00Z')
eq('  计入 tookCloud', pushShrunk.tookCloud, 1)
eq('缩水守卫（推）反向对照：本机 200 vs 云端 50（本机时间新）⇒ 采用本机',
  mergeProgressMapForCloud({ k: { answer_states: stBig(50, 600), saved_at: '2026-10-10T10:00:00Z' } }, { k: { answer_states: stBig(200, 600), saved_at: '2026-10-10T11:00:00Z' } }).map.k.saved_at, '2026-10-10T11:00:00Z')
eq('缩水守卫（推）：本机带 _reset（有意清空）⇒ 放行',
  mergeProgressMapForCloud(pushBig, { k: { answer_states: stBig(50, 600), _reset: '2026-10-10T11:00:00Z', saved_at: '2026-10-10T11:00:00Z' } }).map.k.saved_at, '2026-10-10T11:00:00Z')
eq('缩水守卫（推）反向对照：本机 120 vs 云端 200（没少一半）⇒ 照常按时间取新',
  mergeProgressMapForCloud(pushBig, { k: { answer_states: stBig(120, 600), saved_at: '2026-10-10T11:00:00Z' } }).map.k.saved_at, '2026-10-10T11:00:00Z')

// ── 2026-10-10（补修 A · `_reset` 有意清空连对错一起清）：来方带 `_reset` ⇒ answer_states 整包采用云端（不并键）。
// 此前并键是永久的 ⇒ 另一端「重新开始」传来的「空 + `_reset`」被采用后，本机 20 条对错原样留着，
// 「有意清空」传不过来，破坏 2026-10-04 既定语义（`_reset`＝允许覆盖对方的实质进度）。
const resetCloudEmpty = { mode: 'order', order_ids: [7], current_id: 7, answer_states: {}, _reset: '2026-10-10T12:00:00Z', saved_at: '2026-10-10T12:00:00Z' }
const local20Keys = () => JSON.stringify({ mode: 'order', order_ids: [7], current_id: 7, answer_states: stBig(20), saved_at: '2026-10-10T09:00:00Z', _src: { dev: ME, v: 3 } })
const rReset = mergeProgressForLocal(resetCloudEmpty, local20Keys(), ME, new Map(), true)
eq('补修A（来方带 `_reset`）：采用后 answer_states 为空（本机 20 键不残留）',
  [rReset.write, Object.keys(rReset.value.answer_states).length, rReset.value._reset], [true, 0, '2026-10-10T12:00:00Z'])
// 反向对照：同样空、无 `_reset` ⇒ 走既有路径。本机 20 键时被反向守卫拦下；本机不足下限（2 键）时
// 守卫不触发、照常并键 —— 两种情形本机键都保留（证明例外分支只认 `_reset`）。
const noResetCloudEmpty = { mode: 'order', order_ids: [7], current_id: 7, answer_states: {}, saved_at: '2026-10-10T12:00:00Z' }
eq('补修A 反向对照：无 `_reset` 的空档遇本机 20 键 ⇒ 既有反向守卫拦下（不落地）',
  mergeProgressForLocal(noResetCloudEmpty, local20Keys(), ME, new Map(), true).write, false)
const rNoReset = mergeProgressForLocal(noResetCloudEmpty, JSON.stringify({ mode: 'order', order_ids: [7], current_id: 7, answer_states: { '101': stW(true), '102': stW(false) }, saved_at: '2026-10-10T09:00:00Z', _src: { dev: ME, v: 3 } }), ME, new Map(), true)
eq('补修A 反向对照：守卫不触发时（本机 2 键）走并键路径、本机键保留',
  [rNoReset.write, Object.keys(rNoReset.value.answer_states).sort()], [true, ['101', '102']])

// ── 设备指纹
const mem: Record<string, string> = {}
const kv = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v } }
const d1 = getOrCreateDeviceId(kv)
const d2 = getOrCreateDeviceId(kv)
eq('设备指纹生成且持久（两次一致）', d1 === d2 && d1.length >= 6, true)

console.log(`\n${fail === 0 ? '全绿' : '有失败'}：${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
