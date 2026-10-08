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
//   ② 评估**只在进页面那一刻做一次并冻结**：未提示就保持不提示、提示过也不重复（2026-10-08 补：
//     此前挂在 3s 轮询里反复求值，「距上次拉取 >60s」随时间自然翻真 ⇒ 进库约 1 分钟后横幅迟到冒出）
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
  eq('从未成功同步过（配了云但还没跑过 ⇒ 提示；未配云由调用方闸掉、到不了这里）', M.shouldWarnOnEnter({ synced: false, lastOkAt: 0, now: NOW }), true)
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

console.log('\n── ③ 进页面评估一次即冻结（2026-10-08 修「横幅迟到」）──')
{
  const view = fs.readFileSync(path.join(ROOT, 'src', 'views', 'PracticeView.vue'), 'utf8')
  ok('有"本次已评估过"的冻结标记', /noticeEvaluated/.test(view))
  ok('❗反向对照：冻结在评估**一开始**就置位（而不是等警告出现才置位）——'
    + '否则「陈旧窗口」会随时间自然翻真、横幅进库约 1 分钟后自己冒出来',
    /if \(noticeEvaluated\) return[\s\S]{0,80}noticeEvaluated = true/.test(view))
  ok('❗反向对照：旧写法（只在提示后挡重复、未提示则持续复评）已移除',
    !/if \(noticeOnce\.value\) return/.test(view))
  ok('进页面时复位冻结与展示状态（下次进页面重新判）',
    /noticeEvaluated = false/.test(view) && /noticeShouldShow\.value = false/.test(view))
  ok('❗新增：因「正在拉取」弹出的横幅，拉完自动收掉（注释承诺过，本版做实）',
    /noticeHideWhenPullDone/.test(view) && /!isPullInFlight\(\)[\s\S]{0,120}noticeShouldShow\.value = false/.test(view))
  ok('横幅仍是页面顶部那条（文案保留）', /云同步还没完成/.test(view))
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

console.log('\n── ⑥ 「未配云」不提示（2026-10-08 补：与 mp「未打通不提示」对齐）──')
{
  // 病：没配云的用户没有云可同步，判据里 `!synced` 那条对他们恒真 ⇒ 每次进库都弹、纯添乱。
  // 闸放在调用方（判据保持纯函数）；两端各用自己的「有没有云」信号：web＝配了 envId、mp＝已打通。
  const pv = fs.readFileSync(path.join(ROOT, 'src', 'views', 'PracticeView.vue'), 'utf8')
  const pvEval = pv.slice(pv.indexOf('function evaluateNotice'), pv.indexOf('const syncingHint'))
  ok('练习页：评估里先闸「未配云」', /!isCloudEnabled\(\)\) return/.test(pvEval))
  ok('❗闸在判据之前（先闸后判；顺序反了则判据先跑、闸形同虚设）',
    pvEval.indexOf('isCloudEnabled') > -1 && pvEval.indexOf('isCloudEnabled') < pvEval.indexOf('shouldWarnOnEnter'))

  const home = fs.readFileSync(path.join(ROOT, 'src', 'views', 'HomeView.vue'), 'utf8')
  const gi = home.indexOf('function guardEnterPractice')
  const guard = home.slice(gi, gi + 900)
  ok('首页：进库守卫里闸「未配云」（用本文件已有的 syncEnabled，不新引 cloud.ts）',
    /syncEnabled\.value && !enterToastOnce/.test(guard))
  ok('❗闸在判据之前', guard.indexOf('syncEnabled.value') > -1 && guard.indexOf('syncEnabled.value') < guard.indexOf('shouldWarnOnEnter'))
  ok('闸的信号由 3s 轮询现刷（设置页刚配完云也能被认到）',
    /function pollHomeSync[\s\S]{0,300}syncEnabled\.value = cloudConfigured\(\)/.test(home))
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
