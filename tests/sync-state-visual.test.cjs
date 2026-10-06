// 同步状态按钮四态动效守卫（2026-10-07，晚二版：☁ 常驻 + 状态随行符）
//
// 晚一版把 ☁ 换成了状态单符；rabbit 反馈「云哪去了，是不是不能加原来的云」⇒ 二版：☁ 常驻在场，
// 状态改由**随行小符 + 动效 + 颜色**表达（类名挂在胶囊上，随行符在 .sc-mark 上）。
//
// 本测试守四件事（小程序那份在 yuntu-mp/tests/sync-state-visual.test.cjs）：
//   ① ☁ 常驻：.sc-ico 恒为 ☁；状态随行符 .sc-mark ∈ {'', ↻, ✓, !}（空=待同步/未开启）
//   ② 动效：同步中随行符持续旋转；完成轻弹只挂在 ss-pop / pop 上（justSynced 闸门，只弹「转变为 ok」）
//   ③ 答题页「同步中」接主题色（此前无样式，是「分不清」最重的一处）
//   ④ 首页待同步文案 = 「未同步 · 点一下同步」（旧「点同步」不得残留）
//
// 跑法（cwd 在 shuati-pwa）: node tests/sync-state-visual.test.cjs
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
const home = read('src/views/HomeView.vue')
const practice = read('src/views/PracticeView.vue')

const fail = []
const has = (src, re, what) => { if (!re.test(src)) fail.push(what) }
const absent = (src, re, what) => { if (re.test(src)) fail.push(what) }

// ===== 首页胶囊（HomeView.vue） =====
has(home, /<span class="sc-ico">☁<\/span>/, '首页：☁ 应常驻在场（rabbit：云哪去了）')
has(home, /<span class="sc-mark">\{\{ homeSyncMark \}\}<\/span>/, '首页：缺状态随行符节点 {{ homeSyncMark }}')
has(home, /const homeSyncMark = computed\(/, '首页：缺 homeSyncMark 计算属性')
has(home, /s\.state === 'syncing'\) return '↻'/, "首页：同步中状态符应为 '↻'")
has(home, /s\.state === 'fail'\) return '!'/, "首页：失败状态符应为 '!'")
has(home, /s\.state === 'ok'\) return '✓'/, "首页：已同步状态符应为 '✓'")
absent(home, /homeSyncIco/, '首页：旧的 homeSyncIco（云被替换掉了）残留')
absent(home, /'☁ (云同步未开启|同步中|未同步|已同步|同步失败)/, '首页：文案里仍残留 ☁ 前缀（云已由 .sc-ico 承担）')
has(home, /'未同步 · 点一下同步'/, '首页：待同步文案应为「未同步 · 点一下同步」')
absent(home, /'未同步 · 点同步'/, '首页：旧文案「未同步 · 点同步」残留')
has(home, /'ss-pop': justSynced/, '首页：缺 ss-pop 类绑定（justSynced）')
has(home, /\.sync-chip\.ss-idle\s*\{[^}]*--color-primary/, '首页：待同步（ss-idle）未接主题色')
has(home, /@keyframes\s+sync-spin\s*\{/, '首页：缺 @keyframes sync-spin')
has(home, /@keyframes\s+sync-pop\s*\{/, '首页：缺 @keyframes sync-pop')
has(home, /\.sync-chip\.ss-syncing\s+\.sc-mark\s*\{[^}]*animation:\s*sync-spin/, '首页：同步中状态符未接旋转动画')
has(home, /\.sync-chip\.ss-ok\.ss-pop\s+\.sc-mark\s*\{[^}]*animation:\s*sync-pop/, '首页：完成轻弹未挂在 ss-ok.ss-pop 上')
has(home, /prevState !== 'ok' && s\.state === 'ok'\) markJustSynced\(\)/, '首页：缺「转变为 ok」的轻弹触发闸门')
if ((home.match(/markJustSynced\(\)/g) || []).length < 2) {
  fail.push('首页：markJustSynced 调用点应 ≥2（轮询转变 + 手动同步成功），防只接了一处')
}
// 同步中进库的提醒（2026-10-07 02:10 事故后改口径：不再说「可以先进去」）
has(home, /云同步还没完成：现在进去可能读不到上次进度/, '首页：进库提醒文案未改成警示口径')

// ===== 答题页状态片（PracticeView.vue） =====
has(practice, /<span class="sc-ico">☁<\/span>/, '答题页：☁ 应常驻在场')
has(practice, /<span class="sc-mark">\{\{ syncChipMark \}\}<\/span>/, '答题页：缺状态随行符节点 {{ syncChipMark }}')
has(practice, /const syncChipMark = computed\(/, '答题页：缺 syncChipMark 计算属性')
has(practice, /s\.state === 'syncing'\) return '↻'/, "答题页：同步中状态符应为 '↻'")
has(practice, /s\.state === 'fail'\) return '!'/, "答题页：失败状态符应为 '!'")
has(practice, /s\.state === 'ok'\) return '✓'/, "答题页：已同步状态符应为 '✓'")
absent(practice, /syncChipIco/, '答题页：旧的 syncChipIco 残留')
has(practice, /syncing: syncStat\.state === 'syncing'/, '答题页：状态片缺 syncing 类绑定')
has(practice, /pop: justSynced/, '答题页：状态片缺 pop 类绑定')
has(practice, /\.sync-chip\.syncing\s*\{[^}]*--color-primary/, '答题页：「同步中」未接主题色（此前无此样式）')
has(practice, /@keyframes\s+sync-spin\s*\{/, '答题页：缺 @keyframes sync-spin')
has(practice, /@keyframes\s+sync-pop\s*\{/, '答题页：缺 @keyframes sync-pop')
has(practice, /\.sync-chip\.syncing\s+\.sc-mark\s*\{[^}]*animation:\s*sync-spin/, '答题页：同步中状态符未接旋转动画')
has(practice, /\.sync-chip\.pop\s+\.sc-mark\s*\{[^}]*animation:\s*sync-pop/, '答题页：完成轻弹未挂在 pop 上')
has(practice, /const prevState = syncStat\.value\.state/, '答题页：刷新时缺 prevState 记录')
has(practice, /prevState !== 'ok' && next\.state === 'ok'\) markJustSynced\(\)/, '答题页：缺「转变为 ok」的轻弹触发闸门')

if (fail.length) {
  console.error('❌ 同步状态动效守卫失败：')
  fail.forEach((f) => console.error('   ' + f))
  process.exit(1)
}
console.log('✅ 同步状态动效守卫通过（☁ 常驻 + 随行符：↻ 转 / ✓ 弹 / ! 红 / 空=待同步；文案与闸门齐备）')
process.exit(0)
