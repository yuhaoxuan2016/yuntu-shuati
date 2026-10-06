// 同步状态按钮四态动效守卫（2026-10-07）
//
// 病（rabbit 10-07）：首页胶囊与答题页状态片只靠小字＋淡色区分、没有任何动效——
// 「同步中」和「未同步」肉眼几乎分不开；答题页的「同步中」此前甚至没有任何样式。
//
// 本测试守四件事（小程序那份在 yuntu-mp/tests/sync-state-visual.test.cjs）：
//   ① 图标分态：☁=未开启 / ↻=待同步（主题色）/ ↻转=同步中 / ✓=已同步 / !=失败
//   ② 动效：同步中持续旋转；完成轻弹只挂在 ss-pop / pop 上（由 justSynced 闸门控制，
//      不在首次装载时弹——弹的是「转变为 ok」那一刻）
//   ③ 答题页「同步中」接主题色（该状态此前没有样式，是「分不清」最重的一处）
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
has(home, /<span class="sc-ico">\{\{ homeSyncIco \}\}<\/span>/, '首页：胶囊缺图标节点 {{ homeSyncIco }}')
has(home, /const homeSyncIco = computed\(/, '首页：缺 homeSyncIco 计算属性')
has(home, /if \(!syncEnabled\.value\) return '☁'/, "首页：未开启图标应为 '☁'")
has(home, /s\.state === 'syncing'\) return '↻'/, "首页：同步中图标应为 '↻'")
has(home, /s\.state === 'fail'\) return '!'/, "首页：失败图标应为 '!'")
has(home, /s\.state === 'ok'\) return '✓'/, "首页：已同步图标应为 '✓'")
absent(home, /'☁ (云同步未开启|同步中|未同步|已同步|同步失败)/, '首页：文案里仍残留 ☁ 前缀（图标已由 sc-ico 承担）')
has(home, /'未同步 · 点一下同步'/, '首页：待同步文案应为「未同步 · 点一下同步」')
absent(home, /'未同步 · 点同步'/, '首页：旧文案「未同步 · 点同步」残留')
has(home, /'ss-pop': justSynced/, '首页：缺 ss-pop 类绑定（justSynced）')
has(home, /\.sync-chip\.ss-idle\s*\{[^}]*--color-primary/, '首页：待同步（ss-idle）未接主题色')
has(home, /@keyframes\s+sync-spin\s*\{/, '首页：缺 @keyframes sync-spin')
has(home, /@keyframes\s+sync-pop\s*\{/, '首页：缺 @keyframes sync-pop')
has(home, /\.sync-chip\.ss-syncing\s+\.sc-ico\s*\{[^}]*animation:\s*sync-spin/, '首页：同步中图标未接旋转动画')
has(home, /\.sync-chip\.ss-ok\.ss-pop\s+\.sc-ico\s*\{[^}]*animation:\s*sync-pop/, '首页：完成轻弹未挂在 ss-ok.ss-pop 上')
has(home, /prevState !== 'ok' && s\.state === 'ok'\) markJustSynced\(\)/, '首页：缺「转变为 ok」的轻弹触发闸门')
if ((home.match(/markJustSynced\(\)/g) || []).length < 2) {
  fail.push('首页：markJustSynced 调用点应 ≥2（轮询转变 + 手动同步成功），防只接了一处')
}

// ===== 答题页状态片（PracticeView.vue） =====
has(practice, /<span class="sc-ico">\{\{ syncChipIco \}\}<\/span>/, '答题页：状态片缺图标节点 {{ syncChipIco }}')
has(practice, /const syncChipIco = computed\(/, '答题页：缺 syncChipIco 计算属性')
has(practice, /s\.state === 'syncing'\) return '↻'/, "答题页：同步中图标应为 '↻'")
has(practice, /s\.state === 'fail'\) return '!'/, "答题页：失败图标应为 '!'")
has(practice, /s\.state === 'ok'\) return '✓'/, "答题页：已同步图标应为 '✓'")
has(practice, /syncing: syncStat\.state === 'syncing'/, '答题页：状态片缺 syncing 类绑定')
has(practice, /pop: justSynced/, '答题页：状态片缺 pop 类绑定')
has(practice, /\.sync-chip\.syncing\s*\{[^}]*--color-primary/, '答题页：「同步中」未接主题色（此前无此样式）')
has(practice, /@keyframes\s+sync-spin\s*\{/, '答题页：缺 @keyframes sync-spin')
has(practice, /@keyframes\s+sync-pop\s*\{/, '答题页：缺 @keyframes sync-pop')
has(practice, /\.sync-chip\.syncing\s+\.sc-ico\s*\{[^}]*animation:\s*sync-spin/, '答题页：同步中图标未接旋转动画')
has(practice, /\.sync-chip\.pop\s+\.sc-ico\s*\{[^}]*animation:\s*sync-pop/, '答题页：完成轻弹未挂在 pop 上')
has(practice, /const prevState = syncStat\.value\.state/, '答题页：刷新时缺 prevState 记录')
has(practice, /prevState !== 'ok' && next\.state === 'ok'\) markJustSynced\(\)/, '答题页：缺「转变为 ok」的轻弹触发闸门')

if (fail.length) {
  console.error('❌ 同步状态动效守卫失败：')
  fail.forEach((f) => console.error('   ' + f))
  process.exit(1)
}
console.log('✅ 同步状态动效守卫通过（首页胶囊 + 答题页状态片：图标分态 / 旋转 / 轻弹闸门 / 文案 / 主题色）')
process.exit(0)
