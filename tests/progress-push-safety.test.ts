// 2026-10-07 同步加固批 · 守卫断言（Node 24 原生跑：`node tests/progress-push-safety.test.ts`）
//
// 三条都是 03:44 / 02:10 两次「进度被写退」事故的直接补丁：
//   ① 轻推兜底缝 —— 读云端失败时**必须剔除进度行**，不能 `|| rows` 原样直推
//   ② last_practice 指针防倒退 —— 推送侧至今无守卫，两次事故都发生在这一步
//   ③ 历史栈 / 硬存档**按内容去重** —— 否则慢速用户 5 个槽位被「只是重新保存过」的版本占满
//
// 纪律：每条都带**反向对照**（只比对不该通过的形状也能通过 ⇒ 断言本身是摆设）。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  pushHistory, resolvePushedRows, shouldPushLastPractice, progressFingerprint, HISTORY_MAX,
} from '../src/lib/sync-ids.ts'

let pass = 0, fail = 0
function ok (name: string, cond: boolean, extra = ''): void {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; console.log('✗', name, extra ? '\n   ' + extra : '') }
}
function eq (name: string, actual: any, expected: any): void {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected),
    '实际:' + JSON.stringify(actual) + ' 期望:' + JSON.stringify(expected))
}

// 云端真实形状（判断题 / 选择题混合），避免「用假形状测出假绿灯」
const prog = (answered: number, savedAt: string, extra: any = {}) => ({
  mode: 'order',
  order_ids: [1, 2, 3, 4, 5],
  current_id: 1,
  answer_states: Object.fromEntries(Array.from({ length: answered }, (_, i) => [
    String(i + 1),
    { selected: [], blankAnswer: '', submitted: true, isCorrect: true, selfEvalDone: false, judgeSelected: true, elapsedSecs: 4 },
  ])),
  finished: false,
  saved_at: savedAt,
  ...extra,
})

console.log('── ① 轻推兜底缝：读云端失败 ⇒ 剔除进度行 ──')
{
  const rows = [
    { key: 'practice_progress', value: '{"a":1}' },
    { key: 'daily_records', value: '[]' },
    { key: 'last_practice', value: '{"position":1}' },
  ]
  // 反向对照：rows 里根本没有进度行 ⇒ 失败也不该动其余行（否则 last_practice 永远推不上去）
  const noProg = resolvePushedRows([rows[1], rows[2]], null, true)
  eq('无进度行 + 读失败 ⇒ 原样返回（其余行照推）', noProg.map(r => r.key), ['daily_records', 'last_practice'])

  const skipped = resolvePushedRows(rows, null, true)
  eq('有进度行 + 读失败 ⇒ 只剔除进度行', skipped.map(r => r.key), ['daily_records', 'last_practice'])
  ok('❗反向对照：旧实现 `(await merge()) || rows` 会把进度行留在里面',
    (rows as any[]).some(r => r.key === 'practice_progress'),
    '这正是 03:44 空档被无守卫直推的那一格')

  const merged = [{ key: 'practice_progress', value: '{"a":2}' }, rows[1], rows[2]]
  eq('读成功 ⇒ 用合并结果', resolvePushedRows(rows, merged as any, false).map(r => r.key),
    ['practice_progress', 'daily_records', 'last_practice'])
  // 反向对照：成功却返回 null（不该发生）也必须按失败处理，绝不直推
  eq('读成功但合并结果缺失 ⇒ 同样剔除（保守）',
    resolvePushedRows(rows, null, false).map(r => r.key), ['daily_records', 'last_practice'])
}

console.log('\n── ② last_practice 指针防倒退 ──')
{
  const base = { bank_id: 21, bank_name: '变电安规2026', total: 1134, saved_at: 'X' }
  const bad = { ...base, position: 1 }                 // 03:44 那一笔的真身
  const good = { ...base, position: 464 }              // 云端正本

  ok('同库 · 新 1 / 旧 464 ⇒ 判倒退，不推', shouldPushLastPractice(bad, good) === false)
  ok('边界 · 新 2 / 旧 5 ⇒ 判倒退，不推', shouldPushLastPractice({ ...base, position: 2 }, { ...base, position: 5 }) === false)
  ok('边界 · 新 3 / 旧 5 ⇒ 放行（旧位置本就在开头）', shouldPushLastPractice({ ...base, position: 3 }, { ...base, position: 5 }) === true)
  ok('同库 · 新 470 / 旧 464 ⇒ 正常前进，放行', shouldPushLastPractice({ ...base, position: 470 }, good) === true)
  ok('云端没有 ⇒ 首次，放行', shouldPushLastPractice(bad, null) === true)
  ok('云端读失败 ⇒ 不推（与进度行同口径：宁可不推）', shouldPushLastPractice(bad, good, { readFailed: true }) === false)
  ok('带「重新开始」标记 ⇒ 放行（用户的明确意图）', shouldPushLastPractice({ ...bad, _reset: '2026-10-07T00:00:00.000Z' }, good) === true)
  ok('❗反向对照：不同库（换了个库从头练）⇒ 放行',
    shouldPushLastPractice({ ...bad, bank_name: '初级2026' }, good) === true)
  ok('❗反向对照：旧位置只有 4（不足 5）⇒ 放行，不误伤开新库',
    shouldPushLastPractice({ ...base, position: 1 }, { ...base, position: 4 }) === true)
  ok('❗反向对照：若把判据写成「新 < 旧 就拦」，正常回看第 3 题会被误杀 —— 本实现不会',
    shouldPushLastPractice({ ...base, position: 3 }, { ...base, position: 464 }) === true)
}

console.log('\n── ②b 订阅库：bank_id 是**字符串**（lquiz_banks_14），闸门也必须生效 ──')
{
  // 2026-10-07 事故现场：rabbit 进「变电安规2026」（订阅库）→ 指针被写回 position=1 上行，
  // 云端 last_practice 变成 { bank_name:'', bank_id:'lquiz_banks_14', position:1 }。
  // 根因：sameBankForPointer 用 Number(bank_id) 判「同一个库」，而订阅库的 bank_id 是字符串
  //   ⇒ Number('lquiz_banks_14') = NaN ⇒ isFinite 为假 ⇒ 判「不是同一个库」⇒ 闸门放行。
  const subBase = { bank_id: 'lquiz_banks_14', bank_name: '变电安规2026', total: 1134, saved_at: 'X' }
  const subBad = { ...subBase, position: 1 }            // 事故那一笔（含 bank_name 空的变体）
  const subGood = { ...subBase, position: 468 }         // 云端正本

  ok('❗核心：订阅库 · 新 1 / 旧 468 ⇒ 必须判倒退、不推',
    shouldPushLastPractice(subBad, subGood) === false)
  ok('❗事故变体：云端 bank_name 为空串、只靠字符串 bank_id 认库 ⇒ 仍必须判同库',
    shouldPushLastPractice(subBad, { ...subBase, bank_name: '', position: 468 }) === false)
  ok('❗事故变体：本机 bank_name 为空串 ⇒ 也要认得出是同库',
    shouldPushLastPractice({ ...subBad, bank_name: '' }, subGood) === false)
  ok('订阅库 · 新 470 / 旧 468 ⇒ 正常前进，放行',
    shouldPushLastPractice({ ...subBase, position: 470 }, subGood) === true)
  ok('❗反向对照：订阅库换了另一个库（id 与名字都不同）⇒ 放行，不误伤',
    shouldPushLastPractice({ ...subBad, bank_id: 'lquiz_banks_15', bank_name: '中级2026' }, subGood) === true)
  ok('❗反向对照：库名不同但都非空 ⇒ 按名字判不同库（即便 id 同为字符串）',
    shouldPushLastPractice({ ...subBad, bank_name: '中级2026' }, subGood) === true)
  ok('❗反向对照：订阅库 vs 本地库（数字 id）且无名字 ⇒ 不跨类型认等，放行',
    shouldPushLastPractice({ ...subBad, bank_id: 14, bank_name: '' }, { ...subGood, bank_name: '' }) === true)
}

console.log('\n── ③ 历史栈 / 硬存档：按内容去重 ──')
{
  const p1 = prog(10, 'T1')
  const stack1 = pushHistory([], p1)
  eq('首次入栈', stack1.length, 1)

  // 同一份进度被重新保存（重开库 / 防抖补存）：只有 saved_at 变了
  const stack2 = pushHistory(stack1, prog(10, 'T2'))
  eq('仅 saved_at 变、内容不变 ⇒ 不占槽', stack2.length, 1)
  eq('栈顶仍是原版本（不覆盖）', stack2[0].saved_at, 'T1')

  // 真答了一题 ⇒ 入栈
  const stack3 = pushHistory(stack2, prog(11, 'T3'))
  eq('已答数变化 ⇒ 占槽', stack3.length, 2)
  eq('新版本在栈顶', stack3[0].saved_at, 'T3')

  // 反向对照：已答数没变，但**对错变了** ⇒ 必须占槽（只比数量会漏）
  const flipped = prog(10, 'T4')
  flipped.answer_states['1'] = { ...flipped.answer_states['1'], isCorrect: false }
  eq('❗反向对照：数量相同但对错改变 ⇒ 占槽', pushHistory(stack1, flipped).length, 2)

  // 反向对照：只是翻页（current_id 变）不占槽 —— 这正是「慢速用户五槽被占满」的元凶
  eq('❗反向对照：只翻页（current_id 变）⇒ 不占槽', pushHistory(stack1, { ...prog(10, 'T5'), current_id: 99 }).length, 1)

  ok('指纹：内容同则同、内容异则异',
    progressFingerprint(prog(10, 'A')) === progressFingerprint(prog(10, 'B')) &&
    progressFingerprint(prog(10, 'A')) !== progressFingerprint(prog(11, 'A')))
  ok('栈深不超上限', pushHistory(pushHistory(pushHistory([], prog(1, 'a')), prog(2, 'b')), prog(3, 'c')).length <= HISTORY_MAX)
}

console.log('\n── ④ 本机硬存档：不得进入任何云端路径（源码级）──')
{
  const cloudSrc = readFileSync(join(import.meta.dirname, '..', 'src', 'lib', 'cloud.ts'), 'utf8')
  ok('cloud.ts 不出现硬存档键（拉/推/合并/恢复备份都不碰它）', !/local_archive/.test(cloudSrc))
  const upList = cloudSrc.slice(cloudSrc.indexOf('async function listAllSettings'))
  const whitelist = upList.slice(0, upList.indexOf('const out: any[] = []'))
  ok('settings 上云白名单不含硬存档键', !/local_archive/.test(whitelist),
    '若将来要让它跨端，必须先改口径（当前铁律＝纯本机）')
}

console.log('\n── ⑤ 指针里的库名不能是空串（源码级 · 2026-10-07 事故加固）──')
{
  const pv = readFileSync(join(import.meta.dirname, '..', 'src', 'views', 'PracticeView.vue'), 'utf8')
  // 事故前提 = 本机写出的 last_practice.bank_name 是空串。修法：订阅库（字符串 bankId）补一条云端兜底。
  const nameLine = pv.slice(pv.indexOf('const bankName = computed'), pv.indexOf('const bankName = computed') + 400)
  ok('❗bankName 兜底链包含 bankNameResolved（订阅库无 name 时查云端）', /bankNameResolved\.value/.test(nameLine))
  ok('❗订阅库（字符串 bankId）在缺 name 时会去取云端名字', /typeof bankId === 'string'/.test(pv) && /fetchPublicBankName/.test(pv))
  // 反向对照：本地库**不该**走这条云端兜底（它本来就在 bankStore 里，多查一次纯属浪费）
  const guardIdx = pv.indexOf('fetchPublicBankName')
  const guardBlock = pv.slice(guardIdx - 500, guardIdx + 200)
  ok('❗反向对照：只在缺 name 时才查云端（已有名字就不查）', /!String\(route\.query\.name/.test(guardBlock))
  // exam.ts 侧：兜底函数必须存在，且失败回空串（不是抛错）
  const ex = readFileSync(join(import.meta.dirname, '..', 'src', 'lib', 'exam.ts'), 'utf8')
  ok('exam.ts 导出 fetchPublicBankName', /export async function fetchPublicBankName/.test(ex))
  const fn = ex.slice(ex.indexOf('export async function fetchPublicBankName'))
  ok('❗兜底失败必须是回空串（拿不到名字不该阻断练习）', /catch\s*{\s*return ''/.test(fn.slice(0, 900)))
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
