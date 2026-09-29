// 跨库聚合的离线断言（2026-09-29）：切**真实源码**跑，不抄注释、不凭印象。
//
// 背景：订阅 = 引用公共题库、**不落本地 quiz_banks 行**，所以凡是只用 `api.listBanks()` 的地方
// 都会把订阅库整块漏掉 —— 学习计划因此变成空壳（选库列表空 ⇒ 创建按钮永远点不动），
// 错题本/收藏也因此只能一库一入口，取消订阅后记录虽在却没有任何地方能看到。
// 本轮把「可选库」和「跨库分组」抽成两个纯模块，两处共用，这里逐条钉住它们的判据。
//
// 用法: node tests/records-aggregate.test.cjs
const fs = require('fs')
const path = require('path')
const esbuild = require('esbuild')

const FILES = ['../src/lib/practicable-banks.ts', '../src/lib/records-aggregate.ts'].map(p => path.resolve(__dirname, p))

// 两个模块拼进同一个作用域：records-aggregate 按名字用 bankLabel，
// 所以先剥掉 import 行、再把 export 去掉 —— 不能靠 new Function 注入同名声明（会撞）。
function loadModules () {
  const parts = FILES.map(f => fs.readFileSync(f, 'utf8'))
  const src = parts
    .map(s => s.split('\n').filter(l => !/^\s*import\s/.test(l)).join('\n'))
    .join('\n')
    .replace(/^export\s+/gm, '')
  const js = esbuild.transformSync(src, { loader: 'ts', target: 'es2020' }).code
  return new Function(`${js}\nreturn { buildPracticableBanks, bankLabel, findBank, groupRecords, countByBank, loadQuestionsByBank }`)()
}

const { buildPracticableBanks, bankLabel, findBank, groupRecords, countByBank, loadQuestionsByBank } = loadModules()

let failed = 0
const ok = m => console.log('   ✓ ' + m)
const bad = m => { console.log('   ✗ ' + m); failed++ }
const eq = (got, want, m) => JSON.stringify(got) === JSON.stringify(want) ? ok(m) : bad(`${m}（实际 ${JSON.stringify(got)}，期望 ${JSON.stringify(want)}）`)

const LOCAL = [{ id: 6, name: '我导入的库', question_count: 40 }]
const SUBS = ['lquiz_banks_14', 'lquiz_banks_16']
const PUBS = [{ _id: 'lquiz_banks_14', name: '变电安规2026', question_count: 1134 }, { _id: 'lquiz_banks_16', name: '中级2026', question_count: 700 }]

console.log('— ① 可选库清单（学习计划/聚合页共用）')
{
  const list = buildPracticableBanks(LOCAL, SUBS, PUBS)
  eq(list.map(b => String(b.key)), ['6', 'lquiz_banks_14', 'lquiz_banks_16'], '本地库 + 两个订阅库都在')
  eq(list.map(b => b.kind), ['local', 'subscribed', 'subscribed'], '类型标对了')
  eq(list.find(b => b.kind === 'subscribed').name, '变电安规2026', '订阅库名字从公共库列表解析出来')
  // 反向对照：这条就是空壳的病灶 —— 只用 listBanks() 的旧口径必然漏掉订阅库
  const oldWay = LOCAL.map(b => String(b.id))
  eq(oldWay.includes('lquiz_banks_14'), false, '反证：旧口径（只有本地库）确实取不到订阅库 ⇒ 空壳成因成立')
  eq(buildPracticableBanks(LOCAL, [], []).map(b => String(b.key)), ['6'], '没订阅时只剩本地库（不是凭空多出东西）')
  eq(buildPracticableBanks([], SUBS, PUBS).length, 2, '本地库全删光（rabbit 现状）时，订阅库仍然可选 ⇒ 计划不再空壳')
  eq(buildPracticableBanks(null, SUBS.concat([SUBS[0]]), PUBS).length, 2, '重复 ref 去重')
}

console.log('\n— ② 公共库列表拉不到时的降级（不许编名字）')
{
  const list = buildPracticableBanks(LOCAL, SUBS, [])
  const sub = list.find(b => b.kind === 'subscribed')
  eq(sub.unresolved, true, '标记 unresolved')
  eq(sub.name, '', '名字留空，不拿 ref 冒充库名')
  eq(/离线/.test(bankLabel(sub)), true, `展示名如实说明离线：「${bankLabel(sub)}」`)
  eq(/离线/.test(bankLabel(sub)) && !/lquiz_banks_14/.test(bankLabel(sub)), true, '展示名里不含裸 ref（不给人看内部键）')
}

console.log('\n— ③ findBank：记录里的 bank_id 数字/字符串都要能对上')
{
  const list = buildPracticableBanks(LOCAL, SUBS, PUBS)
  eq(!!findBank(list, 6), true, '数字 6 对上本地库')
  eq(!!findBank(list, '6'), true, '字符串 "6" 也对上（IndexedDB 里两种都可能存）')
  eq(!!findBank(list, 'lquiz_banks_16'), true, 'bankRef 对上订阅库')
  eq(findBank(list, 'lquiz_banks_99'), null, '对不上返回 null（调用方要如实标未知，别丢记录）')
  eq(findBank(list, null), null, '空值不炸')
}

console.log('\n— ④ 跨库分组')
{
  const banks = buildPracticableBanks(LOCAL, SUBS, PUBS)
  const rows = [
    { bank_id: 'lquiz_banks_14', question_id: 11, total_wrong: 2, correct_streak: 1, created_at: '2026-09-20T00:00:00.000Z' },
    { bank_id: 'lquiz_banks_14', question_id: 12, total_wrong: 5, created_at: '2026-09-26T00:00:00.000Z' },
    { bank_id: 6, question_id: 3, created_at: 1758000000000 },
    { bank_id: 'lquiz_banks_77', question_id: 9, created_at: '2026-09-01T00:00:00.000Z' },   // 已取消订阅/已删的库
    { bank_id: '', question_id: 5 },                                                        // 坏行
    { bank_id: 6, question_id: null },                                                      // 坏行
  ]
  const qs = {
    'lquiz_banks_14': [{ id: 11, stem: '题 11 的题干' }, { id: 12, stem: '题 12 的题干' }],
    '6': [{ id: 3, stem: '本地题 3' }],
    // lquiz_banks_77 故意不给 ⇒ 模拟该库题目取不到
  }
  const groups = groupRecords(rows, banks, qs)
  eq(groups.length, 3, '三个库三组（含一个认不出的库）')
  eq(groups.map(g => g.kind), ['local', 'subscribed', 'unknown'], '本地在前、订阅其次、认不出的最后')
  eq(groups.reduce((n, g) => n + g.count, 0), 4, '总数守恒：4 条有效记录一条不丢（坏行 2 条被跳过）')
  eq(groups[1].items.map(i => i.qid), [12, 11], '组内按时间倒序（最近的错题在前）')
  eq(groups[1].items[0].preview, '题 12 的题干', '题干取到了')
  eq(groups[1].unreachable, false, '该组题目可达')
  const unknown = groups.find(g => g.kind === 'unknown')
  eq(unknown.unreachable, true, '取不到题目的组标 unreachable（只报数量，不假装列表完整）')
  eq(unknown.count, 1, '它的数量仍然如实报出')
  eq(/不在可选列表/.test(unknown.name), true, `认不出的库有说明：「${unknown.name}」`)
  eq(countByBank(rows).get('lquiz_banks_14'), 2, 'countByBank 与分组计数同口径')
  eq(countByBank(rows).get('6'), 1, 'question_id 为 null 的脏行不计数（Number(null)=0 会伪装成「第 0 题」）')
}

console.log('\n— ⑤ 单条题目在本库里找不到（题被删了）')
{
  const banks = buildPracticableBanks(LOCAL, [], [])
  const g = groupRecords([{ bank_id: 6, question_id: 999 }], banks, { '6': [{ id: 1, stem: '别的题' }] })
  eq(g[0].items[0].preview, '（题目已不在本库）', '显示"已不在本库"，不是空白也不是假题干')
  eq(g[0].unreachable, false, '库本身是可达的，只是这一题没了 —— 两者不能混为一谈')
}

console.log('\n— ⑥ 按库取题目：限并发 + 单库失败不传染')
// ⚠️ .cjs 里没有顶层 await；异步断言必须挂到 pending 上并参与退出码，
//    否则脚本会在断言跑之前就 exit(0)（静默通过的假绿，本仓栽过一次）。
const pending = []
pending.push((async () => {
  const keys = ['a', 'b', 'c', 'd', 'e', 'f']
  let live = 0, peak = 0
  const out = await loadQuestionsByBank(keys, async (k) => {
    live++; peak = Math.max(peak, live)
    await new Promise(r => setTimeout(r, 20))
    live--
    if (k === 'c') throw new Error('模拟云端失败')
    return [{ id: 1, stem: k }]
  }, 3)
  eq(peak <= 3, true, `并发上限生效（峰值 ${peak} ≤ 3）`)
  eq(out.c, null, '失败的那个库返回 null（上层据此降级）')
  eq(Object.keys(out).filter(k => out[k] === null), ['c'], '只有失败的那一个降级，其余五库不受影响')
  eq(Array.isArray(out.a), true, '反证：正常库确实拿到数组（否则上面两条是恒真）')
  const allBad = await loadQuestionsByBank(['x', 'y'], async () => { throw new Error('全挂') })
  eq([allBad.x, allBad.y], [null, null], '全挂也不抛异常，返回两个 null')
  // 挂死（真浏览器踩过的形态：本地库号被当 bankRef 发给云端，请求永不返回）
  const hung = await loadQuestionsByBank(['hang', 'ok'], async (k) => {
    if (k === 'hang') return new Promise(() => {})          // 永不 resolve
    return [{ id: 1, stem: '好的' }]
  }, 3, 300)
  eq(hung.hang, null, '挂死的库被超时判失败（不能把整页钉在空态）')
  eq(Array.isArray(hung.ok), true, '同一个调用里另一个库正常返回')
  eq(await loadQuestionsByBank([], async () => []), {}, '空列表直接返回空对象')
})())

Promise.all(pending).then(() => {
  console.log(failed ? `\n有失败：${failed} 项` : '\n全绿')
  process.exit(failed ? 1 : 0)
}).catch(e => { console.error('异步断言抛错：', e && e.stack || e); process.exit(1) })
