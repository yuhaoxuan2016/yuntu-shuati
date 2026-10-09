// 2026-10-09 · 练习页同步胶囊「点云朵」与进库横幅的三处不一致（断言 + 反向对照）
// 用法（cwd = shuati-pwa）：node tests/sync-chip-retry.test.cjs
//
// 起因（rabbit 实测截图）：进练习页时横幅说「云同步还没完成」，他手点云朵想催一下，
//   结果**文字还是「未同步」、云朵却变绿了**。三个独立缺陷叠在一起：
//
//   ① 胶囊的「已同步 HH:MM」真值是**上次成功拉取**（`webSyncPull.at`），而点云朵走的
//      `retryProgressSync()` → 轻推 = **只上行、不拉取** ⇒ 拉取时刻不会被更新
//      ⇒ 同步明明成功，文案永远停在「未同步」。点一次云朵永远不会让它变「已同步」。
//   ② 点云朵把整轮轻推跑完了（推完进度、`state='ok'`），可**拉取一次都没发生**
//      ⇒ 横幅那句「可能读不到上次进度」不但没被解决，反而被置成「不再可能」的样子。
//   ③ 同一条信息被画两遍且**颜色不一致**：横幅（跟着拉取走）说没同步，
//      云朵（跟着 `state` 走）变绿说成功 —— 同刻自相矛盾。
//      默认绿主题下 `--color-primary`(#42b883) 与 `--color-success-strong`(#16a34a) 都是绿色。
//
// 本测试钉死修后的语义：
//   ① 点云朵 = **全量双向同步**（上传 + 下载），不是只推
//   ② 拉取动作完成 ⇒ 横幅**立刻收掉**（不整页刷新、不等下次进页面）
//   ③ 正在跑**全量**同步时点云朵 → 如实提示「不必重复点」，而不是静默推一把聊胜于无的上行
//   ④ ❗反向对照：轻推仍**不得**打拉取标记（上一版刚立的规矩，不能被本版改回去）
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const PV = fs.readFileSync(path.join(ROOT, 'src', 'views', 'PracticeView.vue'), 'utf8')
const CLOUD = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'cloud.ts'), 'utf8')
const NOTICE = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'sync-notice.ts'), 'utf8')

let pass = 0, fail = 0
function ok (name, cond, extra) {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; console.log('✗', name, extra ? '\n   ' + extra : '') }
}

console.log('── ① 点云朵＝全量双向同步（原先只推上游 ⇒ 文案永远「未同步」）──')
{
  const gi = PV.indexOf('async function onSyncChipTap')
  const tap = PV.slice(gi, gi + 900)
  ok('onSyncChipTap 存在', gi > -1)
  ok('❗点云朵调的是 syncAll（上传+下载），不再是 retryProgressSync（只推）',
    /m\.syncAll\(\)|syncAll\(\)/.test(tap) && !/retryProgressSync/.test(tap))
  ok('拉取完成 ⇒ 同步刷新胶囊状态与拉取时刻',
    /refreshSyncStat\(\)/.test(tap))
  ok('❗同步后要重载本页进度（云端可能比本机新，否则界面还是旧的）',
    /reloadAfterSync|loadProgress|reloadKey/.test(tap))

  // 反向对照：只看**代码**（剥掉注释），别被解释性注释里的旧函数名绊住
  const code = PV.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  ok('❗反向对照：练习页代码里不再调用 retryProgressSync（注释里提到不算）',
    !/retryProgressSync/.test(code))
  const imp = code.slice(code.indexOf("from '../lib/cloud'") - 300, code.indexOf("from '../lib/cloud'"))
  ok('❗反向对照：该符号已从 import 清单里移除（不留死导入）',
    !/retryProgressSync/.test(imp))
}

console.log('── ② 拉取完成 ⇒ 横幅立刻收掉（不等下次进页面）──')
{
  const gi = PV.indexOf('function refreshSyncStat')
  const fn = PV.slice(gi, gi + 1600)
  ok('refreshSyncStat 里挂了「拉取已完成」的收横幅逻辑', /noticeHideWhenPullDone/.test(fn))
  ok('❗收横幅按**拉取**判（不是按任意同步成功，更不是按 state）',
    /isPullInFlight\(\)/.test(fn))
  ok('❗只有「因拉取而弹」的那条才自动收（其余原因的横幅留给用户手动关）',
    /noticeHideWhenPullDone && pullSettled/.test(fn))
  // 「本机可能没有云端最新」弹的横幅（不是因拉取在飞那一支）也要在拉取完成后收掉：
  // 否则点完云朵、真拉完了，那句警告还杵在那儿说「可能读不到上次进度」。
  ok('❗拉取时刻前进（=真拉过）也要收横幅，不限于「因拉取在飞」那一支',
    /pulledSinceEval/.test(fn) && /pullSettled && pulledSinceEval/.test(fn))
  ok('❗快照在**评估那一刻**取（在轮询里现取 ⇒ 条件恒假、横幅永远收不掉）',
    /function evaluateNotice[\s\S]{0,400}?pullAtAtEvaluated = lastPullAtRef\.value/.test(PV))
}

console.log('── ③ 全量同步在跑时点云朵：如实提示，不静默只推 ──')
{
  const gi = PV.indexOf('async function onSyncChipTap')
  const tap = PV.slice(gi, gi + 900)
  ok('点云朵前先看有没有全量同步在跑', /state === 'syncing'/.test(tap))
  ok('❗在跑 ⇒ 只提示、不叠加请求（与首页胶囊 doHomeSync 口径一致）',
    /toastInfo\(/.test(tap) && /return/.test(tap))
}

console.log('── ④ ❗反向对照：轻推仍不得打拉取标记（上一版刚立的规矩）──')
{
  const start = CLOUD.indexOf('async function pushProgressLightInner')
  const body = CLOUD.slice(start, start + 2500)
  ok('轻推体内没有 markPulled（只推不拉不算「已同步」）', !/markPulled\(\)/.test(body))
  ok('retryProgressSync 仍存在（首页/别处可能还用），只是练习页不再拿它当「点云朵」',
    /export async function retryProgressSync/.test(CLOUD))
}

console.log('── ⑤ 进库横幅与云朵文案不会自相矛盾（判据仍以拉取为准）──')
{
  ok('横幅判据用 pullBusy（拉取在飞），不是全局 busy',
    /pullBusy: pulling/.test(PV) && /const pulling = isPullInFlight\(\)/.test(PV))
  ok('胶囊文案用 lastPullAtRef（上次成功拉取），与横幅同一真值',
    /const pullAt = lastPullAtRef\.value/.test(PV))
  ok('❗反向对照：胶囊文案不得改用 state.at（那会把只推不拉冒充成已同步）',
    !/const s = syncStat\.value[\s\S]{0,120}new Date\(s\.at\)/.test(PV))
  ok('判据模块仍把「拉取在飞」放在首位（最该提示的场景）',
    /if \(pulling\) return true/.test(NOTICE))
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
