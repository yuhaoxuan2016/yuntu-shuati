// 2026-10-07 · 进库横幅：判据 + 「本次进页面只提示一次」闸门（断言 + 反向对照）
// 用法（cwd = shuati-pwa）：node tests/sync-banner-once.test.cjs
//
// 起因（rabbit 07:02 纠正口径）：v1.2.87 把横幅下沉到练习页了，但判据是 `state === 'syncing'`，
//   而**进练习页时同步压根不启动**（状态只会是 idle / 上次的 ok / fail）⇒ 条件几乎永不成立，
//   横幅一次都没出现过。且正确口径**不是**"每次进页面都弹/每次都跟同步状态跳"——
//   rabbit 原话：「横幅应该是首次进入练习页面的时候显示，而不是每次同步都跳出来」。
//
// 三条要钉住的语义：
//   ① 判据＝「本机可能还没有云端最新进度」（不是"此刻正在同步"）
//   ② 本次进页面**只提示一次**：同一次停留期间后台又同步完/又失败，不重新弹
//   ③ 下次再进页面**重新判**（可能又错过了新的）
const fs = require('fs')
const path = require('path')
const esbuild = require('esbuild')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src', 'lib', 'sync-notice.ts')
if (!fs.existsSync(SRC)) { console.error('✗ 找不到被测实现：' + SRC); process.exit(1) }

const raw = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n')
const noImports = raw.replace(/^import[^\n]*\n/gm, '').replace(/^export /gm, '')
const code = esbuild.transformSync(noImports, { loader: 'ts', format: 'cjs' }).code
const M = new Function('module', 'exports',
  code + '\nreturn { shouldWarnOnEnter, STALE_PULL_MS }'
)({ exports: {} }, {})

let pass = 0, fail = 0
function ok (name, cond, extra) {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; console.log('✗', name, extra ? '\n   ' + extra : '') }
}
function eq (name, actual, expected) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected),
    '实际:' + JSON.stringify(actual) + ' 期望:' + JSON.stringify(expected))
}

const NOW = 1_800_000_000_000   // 固定"现在"，避免用真实时钟造成的不稳定断言

console.log('── ① 判据：本机可能还没有云端最新进度 ──')
{
  eq('从未同步过（没配云/没跑过）⇒ 提示', M.shouldWarnOnEnter({ synced: false, lastOkAt: 0, now: NOW }), true)
  eq('上次同步失败 ⇒ 提示', M.shouldWarnOnEnter({ synced: false, lastOkAt: 0, lastFail: true, now: NOW }), true)
  eq('刚同步成功（远小于阈值）⇒ 不提示', M.shouldWarnOnEnter({ synced: true, lastOkAt: NOW - 1000, now: NOW }), false)
  eq('同步成功但已经过去很久（超过陈旧阈值）⇒ 提示',
    M.shouldWarnOnEnter({ synced: true, lastOkAt: NOW - M.STALE_PULL_MS - 1, now: NOW }), true)
  eq('正好卡在阈值上（等于阈值）⇒ 不提示（边界取闭）',
    M.shouldWarnOnEnter({ synced: true, lastOkAt: NOW - M.STALE_PULL_MS, now: NOW }), false)
  eq('❗反向对照：正在同步中也提示（这种时候最该提示）',
    M.shouldWarnOnEnter({ synced: true, lastOkAt: NOW - 1000, busy: true, now: NOW }), true)
  eq('❗反向对照：只判 busy 是不够的（非忙碌但陈旧也要提示）',
    M.shouldWarnOnEnter({ synced: true, lastOkAt: NOW - M.STALE_PULL_MS - 1, busy: false, now: NOW }), true)
  eq('阈值是 1 分钟量级（不是 0、也不是 10 分钟那么钝）', M.STALE_PULL_MS, 60 * 1000)
}

console.log('\n── ② 源码级：横幅判据已不再等于「正在同步」──')
{
  const view = fs.readFileSync(path.join(ROOT, 'src', 'views', 'PracticeView.vue'), 'utf8')
  ok('练习页已改用 shouldWarnOnEnter', /shouldWarnOnEnter\(/.test(view))
  ok('❗反向对照：不再用 `state === \'syncing\'` 直接驱动横幅',
    !/const syncingHint = computed\(\(\) => syncStat\.value\.state === 'syncing'\)/.test(view))
  ok('横幅仍是页面顶部那条（文案保留）', /云同步还没完成/.test(view))
}

console.log('\n── ③ 「本次进页面只提示一次」的闸门 ──')
{
  const view = fs.readFileSync(path.join(ROOT, 'src', 'views', 'PracticeView.vue'), 'utf8')
  ok('有"本次已提示过"的标记', /noticeShown|warnShown|bannerShownOnce|noticeOnce/.test(view))
  ok('❗反向对照：标记在进页面时被复位（否则第二次进页面就不再提示了）',
    /noticeOnce\.value = false|noticeShown\.value = false|warnShown\.value = false/.test(view))
  // 闸门语义：一旦提示过，后续状态变化不得让它再次为真（早退即可，不一定要 return false）
  ok('提示过之后即使仍在陈旧状态也不重复弹',
    /if \(noticeOnce\.value\) return\b|if \(noticeShown\.value\) return\b|if \(warnShown\.value\) return\b/.test(view))
}

console.log('\n── ④ 首页 toast 用同一判据（原先那条从没弹过）──')
{
  const home = fs.readFileSync(path.join(ROOT, 'src', 'views', 'HomeView.vue'), 'utf8')
  ok('首页 guardEnterPractice 改用 shouldWarnOnEnter', /shouldWarnOnEnter\(\{/.test(home))
  ok('❗反向对照：不再只看 `state === \'syncing\'` 就弹',
    !/if \(homeSync\.value\.state === 'syncing'\) toastInfo/.test(home))
  ok('首页 toast 也有"只提示一次"的闸门', /enterToastOnce/.test(home))
  ok('两端（首页 toast / 练习页横幅）用同一个判据函数'
    + ' ⇒ 不会一处提示一处沉默', /shouldWarnOnEnter\(\{[\s\S]{0,400}?\}\)/.test(home) && /shouldWarnOnEnter\(\{/.test(
      fs.readFileSync(path.join(ROOT, 'src', 'views', 'PracticeView.vue'), 'utf8')))
}

console.log('\n── ⑤ 「本机有多新」以**成功拉取**为准，不以任何状态变更为准（2026-10-07 事故 #2）──')
{
  // 事故 #2：只推不拉的轻推也写 state='ok'/'at' ⇒ 胶囊谎称「已同步」、首页数据白重跑一次。
  const cloud = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'cloud.ts'), 'utf8')
  ok('cloud.ts 提供「上次成功拉取时刻」的读取口', /export function getLastPullAt/.test(cloud))
  ok('❗反向对照：拉取成功才打标记（三处拉取路径都要有 markPulled）',
    (cloud.match(/markPulled\(\)/g) || []).length >= 3)
  ok('❗反向对照：轻推（pushProgressLightInner）**不得**打拉取标记',
    !/markPulled\(\)/.test(cloud.slice(cloud.indexOf('async function pushProgressLightInner'),
      cloud.indexOf('async function pushProgressLightInner') + 2500)))

  const home2 = fs.readFileSync(path.join(ROOT, 'src', 'views', 'HomeView.vue'), 'utf8')
  ok('首页胶囊文案取拉取时刻（homeSyncAt），不取 state.at', /homeSyncAt\.value/.test(home2))
  ok('❗反向对照：首页不再用 `s.at` 当「已同步」时间', !/new Date\(s\.at \|\| Date\.now\(\)\)/.test(home2))
  ok('首页数据重跑也以拉取时刻为准（lastPullAt）', /lastReloadedPullAt/.test(home2))

  const pv2 = fs.readFileSync(path.join(ROOT, 'src', 'views', 'PracticeView.vue'), 'utf8')
  ok('练习页芯片文案同样取拉取时刻', /lastPullAtRef\.value/.test(pv2))
  ok('❗反向对照：练习页不再用 `s.at` 当「已同步」时间', !/new Date\(Number\(s\.at\)/.test(pv2))
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
