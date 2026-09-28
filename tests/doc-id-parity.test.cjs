// 跨端 doc id 对拍（2026-09-28）：网页端与云函数**各自实现**同一套 `_id` 拼法，
// 一旦漂一个字符，桥就会「写进去但对方读不到」——这类错今晚刚实测过一次（订阅行属主易主）。
// 所以这里不抄注释、不凭印象：**从两份真实源码里切出函数本体，逐字节对拍**。
//
// 覆盖：
//   ① 同输入两边产出逐字相同（settings 四类 key + 记录行 mp_*）
//   ② 反向对照：前 8 位相同的两个不同身份 ⇒ 新形状必须不同格（这正是被修掉的 bug）
//   ③ 旧形状仍可寻址（今晚实测到的真实线上 id，删除通道要能命中它）
//   ④ 网页端记录行仍以 `cloud_id` 优先（否则已同步行换 _id ⇒ 云端出现两行）
//
// 用法: node tests/doc-id-parity.test.cjs
const fs = require('fs')
const path = require('path')
const esbuild = require('esbuild')

const WEB = path.resolve(__dirname, '../src/lib/cloud.ts')
const FN = path.resolve(__dirname, '../../yuntu-mp/cloudfunctions/bindAccount/index.js')

let failed = 0
const ok = m => console.log('   ✓ ' + m)
const bad = m => { console.log('   ✗ ' + m); failed++ }

// —— 切片器：按「起始锚点行 → 顶格 }」取整块（含收尾花括号），再 esbuild 去 TS ——
function slice (lines, startRe, label) {
  const s = lines.findIndex(l => startRe.test(l))
  if (s < 0) throw new Error(`切片失败：找不到 ${label} 的起点`)
  let e = -1
  for (let i = s + 1; i < lines.length; i++) if (lines[i] === '}') { e = i; break }
  if (e < 0) throw new Error(`切片失败：${label} 没有顶格收尾 }`)
  return lines.slice(s, e + 1).join('\n')
}

const webLines = fs.readFileSync(WEB, 'utf8').split(/\r?\n/)
const fnLines = fs.readFileSync(FN, 'utf8').split(/\r?\n/)

const webSrc = [
  slice(webLines, /^function uidToken\(\)/, 'uidToken'),
  slice(webLines, /^function legacyUidToken\(\)/, 'legacyUidToken'),
  slice(webLines, /^function settingsDocId/, 'settingsDocId'),
  slice(webLines, /^function legacySettingsDocId/, 'legacySettingsDocId'),
].join('\n')
const webJs = esbuild.transformSync(webSrc, { loader: 'ts' }).code
// authedUid 是模块级变量 ⇒ 当依赖注入，避免与切片里的声明相撞
const web = new Function('authedUid', `${webJs}\nreturn { settingsDocId, legacySettingsDocId, uidToken, legacyUidToken }`)

const fnSrc = [
  slice(fnLines, /^function UPSERT_ID /, 'UPSERT_ID'),
  slice(fnLines, /^function legacyUpsertId /, 'legacyUpsertId'),
  slice(fnLines, /^function settingsDocId /, 'fn settingsDocId'),
  slice(fnLines, /^function legacySettingsDocId /, 'fn legacySettingsDocId'),
].join('\n')
const fn = new Function(`return (function(){${fnSrc}\nreturn { UPSERT_ID, legacyUpsertId, settingsDocId, legacySettingsDocId }})()`)()

console.log('切片：网页端 4 个函数 / 云函数 4 个函数')

// 2026-09-28 今晚实测到的三个真实绑定身份（前 8 位全是 wx_ocRhF）
const UID_A = 'wx_ocRhF5DTMfMoCkt98Bo4hu7MEjtk'
const UID_B = 'wx_ocRhF5FhR7PZibhGuYY3F8i8VBUU'
const UID_C = 'wx_ocRhF5JjQM3cY3idVgrXT-i9kr6o'
const ANON = 'IP7shNlevgG48V_p-N_SYg'
const KEYS = ['last_practice', 'daily_records', 'subscriptions', 'compose_templates', 'practice_progress']

// —— ① 两端逐字一致 ——
console.log('\n① 同输入 ⇒ 同 _id（两端对拍）')
for (const uid of [UID_A, UID_B, UID_C, ANON]) {
  const w = web(uid)
  for (const k of KEYS) {
    w.settingsDocId(k) === fn.settingsDocId(uid, k)
      ? ok(`settings ${uid.slice(0, 11)}…/${k}`)
      : bad(`${uid}/${k} 两端不一致：网页「${w.settingsDocId(k)}」 vs 云函数「${fn.settingsDocId(uid, k)}」`)
    w.legacySettingsDocId(k) === fn.legacySettingsDocId(uid, k)
      ? ok(`legacy settings ${uid.slice(0, 11)}…/${k}`)
      : bad(`legacy ${uid}/${k} 两端不一致`)
  }
}

// —— ② 反向对照：共用前缀的两个身份必须落在不同格 ——
console.log('\n② 前 8 位相同的不同身份 ⇒ 必须不同格（这就是被修掉的那条）')
const wa = web(UID_A), wb = web(UID_B), wc = web(UID_C)
new Set([wa.settingsDocId('subscriptions'), wb.settingsDocId('subscriptions'), wc.settingsDocId('subscriptions')]).size === 3
  ? ok('三个身份的 subscriptions 各占一格')
  : bad('不同身份仍共用同一格 subscriptions')
for (const [uid, w] of [[UID_A, wa], [UID_B, wb], [UID_C, wc]]) {
  w.legacySettingsDocId('subscriptions') === 'lsettings_wx_ocRhF_subscriptions'
    ? ok(`${uid.slice(0, 11)}… 的旧格算出来就是线上那一条`)
    : bad(`${uid} 旧格算错：${w.legacySettingsDocId('subscriptions')}`)
}
new Set([fn.UPSERT_ID(UID_A, 'wrong_questions', 23, 501777), fn.UPSERT_ID(UID_B, 'wrong_questions', 23, 501777)]).size === 2
  ? ok('同一题在两个身份下是两行（旧形状才会共用）')
  : bad('记录行仍会跨身份共用')
// 记录行必须含完整 uid，且长度留在安全区（实测 origin 能吃 60 字符）
const rid = fn.UPSERT_ID(UID_A, 'mastered_questions', 23, 501777)
rid.includes(UID_A) && rid.length < 90
  ? ok(`记录行含完整身份且不太长（${rid.length} 字符）`)
  : bad(`记录行形状不合格：${rid}`)

// —— ③ 旧形状仍可寻址（今晚真实读到的线上 id，删除通道要命中它） ——
console.log('\n③ 线上现存 id 必须还能被算出来（否则旧行永远删不掉、还读不懂）')
const LIVE = [
  ['lsettings_wx_ocRhF_subscriptions', () => wa.legacySettingsDocId('subscriptions')],
  ['mp_wrong_questions_23_501777', () => fn.legacyUpsertId('wrong_questions', 23, 501777)],
]
for (const [want, get] of LIVE) get() === want ? ok(`旧格 ${want}`) : bad(`旧格算不出来：期望 ${want} 实际 ${get()}`)

// —— ④ 防重复的两条前置 ——
console.log('\n④ 防「同一记录两行」的写法还在')
const webAll = webLines.join('\n')
const reCloudIdFirst = /doc\.cloud_id \|\| \('l' \+ coll \+ '_' \+ uidToken\(\)/
const reDropGuard = /legacyId && String\(doc\._id \|\| ''\) !== legacyId/
const reSettingsLegacy = /if \(coll === 'settings' && typeof doc\.key === 'string'\) legacyId = legacySettingsDocId/
const fnAll = fnLines.join('\n')
const reFnDropSettings = /dropLegacyRow\(db, 'settings', legacyId, boundUid/
const reFnDropRecords = /dropLegacyRow\(db, g\.coll, legacyUpsertId/
reCloudIdFirst.test(webAll)
  ? ok('记录行优先沿用 cloud_id（换 uid 拼法也不会给已同步行造新行）')
  : bad('记录行不再优先 cloud_id ⇒ 改拼法会给已同步行造出第二行')
reDropGuard.test(webAll)
  ? ok('pushOne 里写了「成功且新旧格不同才清旧格」')
  : bad('pushOne 少了旧格清理')
reSettingsLegacy.test(webAll)
  ? ok('settings 行也登记了旧格（永远全推 ⇒ 每轮都会清）')
  : bad('settings 行没登记旧格')
(reFnDropSettings.test(fnAll) && reFnDropRecords.test(fnAll))
  ? ok('云函数写新格后清自己名下旧格（记录 + settings）')
  : bad('云函数没清旧格 ⇒ 云端会同时留新旧两行')
// —— ⑤ 迁移窗口读侧收敛（新旧两格并存时，同一 key 只能有一份到用户眼前） ——
console.log('\n⑤ 同一 key 出现新旧两格时，读侧必须取较新那份')
{
  const src = [
    slice(fnLines, /^function normTsMs /, 'normTsMs'),
    slice(fnLines, /^function newestPerKey /, 'newestPerKey'),
  ].join('\n')
  const { normTsMs, newestPerKey } = new Function(`return (function(){${src}\nreturn { normTsMs, newestPerKey }})()`)()
  const cases = [
    [normTsMs('2026-09-27T23:53:12.963Z') > 1e12, 'ISO 串能归一'],
    [normTsMs(1790563716199) === 1790563716199, '数值毫秒能归一'],
    [normTsMs('') === 0 && normTsMs(null) === 0, '空值归 0（不会冒充最新）'],
  ]
  for (const [got, msg] of cases) got ? ok(msg) : bad(msg)

  const rows = [
    { key: 'subscriptions', value: '["旧格值"]', updated_at: '2026-09-27T10:00:00.000Z', _id: 'lsettings_wx_ocRhF_subscriptions' },
    { key: 'subscriptions', value: '["新格值"]', updated_at: 1790570000000, _id: 'lsettings_wx_ocRhF5DTM_subscriptions' },
    { key: 'last_practice', value: 'LP', updated_at: 1790570000000, _id: 'x' },
  ]
  const kept = newestPerKey(rows)
  kept.length === 2 ? ok('两行 subscriptions 收敛成一行') : bad(`没收敛，返回 ${kept.length} 行`)
  const sub = kept.find(r => r.key === 'subscriptions')
  sub && sub.value === '["新格值"]' ? ok('留下的是较新的新格那行') : bad(`留下的是 ${JSON.stringify(sub && sub.value)}`)
  // 反证：把时间倒过来，必须选另一行（否则上面那条断言是恒绿的）
  const rev = newestPerKey(rows.map(r => r.key === 'subscriptions' ? { ...r, updated_at: r.updated_at === 1790570000000 ? '2026-09-29T10:00:00.000Z' : 1800000000000 } : r))
  const rsub = rev.find(r => r.key === 'subscriptions')
  rsub && rsub.value === '["旧格值"]' ? ok('反证：旧格更新时留下的就是旧格（判据真的在看时间）') : bad('反证失败：判据没在比较时间')
  // 两个读点都接了收敛（正则一律先命名再 .test —— 行首裸写 /re/ 会被 ASI 当除号，已踩两次）
  const rePullBoundDedupe = /newestPerKey\(\(\(res && res\.data\) \|\| \[\]\)/
  const reProgNewest = /const row = \(newestPerKey\(\(pr && pr\.data\) \|\| \[\]\)\)\[0\]/
  const reWebCollapse = /if \(collection === 'settings'\) \{[\s\S]{0,400}byKey\.set\(k, d\)/
  rePullBoundDedupe.test(fnAll)
    ? ok('pullBound 的设置行读取已过 newestPerKey')
    : bad('pullBound 仍按原样返回两行')
  reProgNewest.test(fnAll)
    ? ok('practice_progress 读取取「较新那份」而不是 [0]')
    : bad('practice_progress 仍是 [0] ⇒ 会随机取到旧格')
  reWebCollapse.test(webAll)
    ? ok('网页端 pullCollection 也按 key 收敛')
    : bad('网页端 pullCollection 没收敛 ⇒ 下载会随机盖一份')
}

console.log(failed ? `\n有失败：${failed} 项` : '\n全绿')
process.exit(failed ? 1 : 0)

process.exit(failed ? 1 : 0)
