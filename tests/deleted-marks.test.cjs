// 删除标记消费判据的离线断言（2026-09-29）：切**真实源码**跑。
//
// 病灶实例：rabbit 本机删了三个本地题库 → 在**匿名身份**下点了一次同步 →
// 「按 _openid 查不到待删文档」被判成删除成功、标记被消费 → 换回绑定身份再上传时标记已经没了
// ⇒ 云端 3 行题库 + 2,475 行题目永久残留，且「下载不再拉回」的账本同时失效。
//
// 用法: node tests/deleted-marks.test.cjs
const fs = require('fs')
const path = require('path')
const esbuild = require('esbuild')

const SRC = path.resolve(__dirname, '../src/lib/deleted-marks.ts')
const js = esbuild.transformSync(fs.readFileSync(SRC, 'utf8').replace(/^export\s+/gm, ''), { loader: 'ts', target: 'es2020' }).code
const { decideDeletedMark, nextTries } = new Function(`${js}\nreturn { decideDeletedMark, nextTries }`)()

let failed = 0
const ok = m => console.log('   ✓ ' + m)
const bad = m => { console.log('   ✗ ' + m); failed++ }
const eq = (got, want, m) => { if (JSON.stringify(got) === JSON.stringify(want)) ok(m); else bad(`${m}（实际 ${JSON.stringify(got)}，期望 ${JSON.stringify(want)}）`) }

const WX = 'wx_ocRhF5DTMfMoCkt98Bo4hu7MEjtk'
const ANON = '76570kzkDFnkP29oCF-8fQ'

console.log('— ① 正常路径：身份相符、确实删到了东西 ⇒ 消费标记')
eq(decideDeletedMark({ uid: WX }, WX, { scanned: 3, removed: 3 }), 'consumed', '删干净 → consumed')

console.log('\n— ② 病灶本身：身份不符、一条也扫不到 ⇒ 必须留着')
eq(decideDeletedMark({ uid: WX }, ANON, { scanned: 0, removed: 0 }), 'keep-identity',
  '匿名身份跑 wx_ 的标记 → keep-identity（不再被"查不到"骗过）')
eq(nextTries('keep-identity', 2), 2, '身份不符不消耗重试次数（它没失败，只是在等正确的身份）')

console.log('\n— ③ 身份相符却一条都没扫到（老标记）⇒ 宁留，但受重试上限兜底')
eq(decideDeletedMark({ uid: WX }, WX, { scanned: 0, removed: 0 }, ), 'consumed', '有 uid 且相符 → 视为已删干净')
eq(decideDeletedMark({}, WX, { scanned: 0, removed: 0 }), 'keep-empty', '无 uid 的老标记 → 宁留（无法排除属于别的身份）')
eq(decideDeletedMark({}, WX, { scanned: 2, removed: 2 }), 'consumed', '无 uid 但确实扫到并删掉了 → consumed')
eq(nextTries('keep-empty', 0), 1, 'keep-empty 会累加重试次数（有上限兜底，不会无限堆积）')
eq(nextTries('consumed', 5), 5, 'consumed 不改次数（标记马上就被丢掉）')

console.log('\n— ④ 边界')
eq(decideDeletedMark(null, WX, { scanned: 0, removed: 0 }), 'keep-empty', '坏标记（null）不炸，按宁留处理')
eq(decideDeletedMark({ uid: WX }, '', { scanned: 0, removed: 0 }), 'keep-identity', '未登录（authedUid 空）时不消费')
eq(decideDeletedMark({ uid: '' }, WX, { scanned: 1, removed: 1 }), 'consumed', 'uid 为空串＝老标记，正常删到就消费')

console.log('\n— ⑤ 反向对照：同样的"查不到"，只因身份相符就变成消费')
{
  const mark = { uid: WX }
  const res = { scanned: 0, removed: 0 }
  eq([decideDeletedMark(mark, WX, res), decideDeletedMark(mark, ANON, res)], ['consumed', 'keep-identity'],
    '同一份输入、只换身份 ⇒ 结果不同（判据真的在看身份，不是恒 keep/恒 consume）')
}

console.log(failed ? `\n有失败：${failed} 项` : '\n全绿')
process.exit(failed ? 1 : 0)
