// 2026-10-09 · 进库横幅要考虑「本轮自动拉取被节流跳过」（断言 + 反向对照）
// 用法（cwd = shuati-pwa）：node tests/sync-notice-throttle.test.cjs
//
// 起因（rabbit 2026-10-09）：「要考虑首页同步的 10 分钟冷却，如果近期已经同步过，没必要弹横幅」。
//
// 缺口实况：启动自动拉取有**两道独立的冷却**——
//   ① 「距上次自动拉取 < 10 分钟」⇒ 直接跳过这一轮（AUTO_PULL_INTERVAL_MS / cloud_auto_pull_at）
//   ② 自动同步开关关着 ⇒ 同样跳过
// 两种情况下**本机数据其实还是几秒前刚拉的**，可横幅判据只认 STALE_PULL_MS（1 分钟）
// ⇒ 过了 1 分钟就笃定地说「可能读不到上次进度」，纯属添乱（近期明明同步过）。
//
// 三条要钉住的语义：
//   ① 有「自动拉取刚刚已跑过」这一事实时，横幅**不该**再按 1 分钟陈旧窗口抱怨
//   ② 但判据仍在「本机可能不最新」这个语义之内（不是无脑关掉横幅）：
//      上次失败 / 从未成功 / 真的陈旧 —— 该提示还是要提示
//   ③ ❗反向对照：自动拉取的**10 分钟节流常量与节流判断本身不许动**
//      （tests/auto-pull-open.test.cjs 明令守住；横幅永远不决定拉取频率）
const fs = require('fs')
const path = require('path')
const esbuild = require('esbuild')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src', 'lib', 'sync-notice.ts')
const CLOUD = path.join(ROOT, 'src', 'lib', 'cloud.ts')
if (!fs.existsSync(SRC)) { console.error('✗ 找不到被测实现：' + SRC); process.exit(1) }

const raw = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n')
const noImports = raw.replace(/^import[^\n]*\n/gm, '').replace(/^export /gm, '')
const code = esbuild.transformSync(noImports, { loader: 'ts', format: 'cjs' }).code
const M = new Function('module', 'exports',
  code + '\nreturn { shouldWarnOnEnter, STALE_PULL_MS, RECENT_AUTO_PULL_MS }'
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

const NOW = 1_800_000_000_000
const MIN = 60 * 1000

console.log('── ① 自动拉取刚跑过（被节流跳过）⇒ 不弹 ──')
{
  // 最典型：2 分钟前刚自动拉成功，进练习页；1 分钟陈旧窗口已过，但本轮拉取被 10 分钟节流跳过
  eq('❗2 分钟前刚自动拉过 ⇒ 不弹（原先会弹）',
    M.shouldWarnOnEnter({
      synced: true, lastOkAt: NOW - 2 * MIN, autoPullDue: false, now: NOW,
    }), false)
  eq('❗5 分钟前刚自动拉过 ⇒ 不弹',
    M.shouldWarnOnEnter({
      synced: true, lastOkAt: NOW - 5 * MIN, autoPullDue: false, now: NOW,
    }), false)
  eq('刚拉完（几秒前）⇒ 不弹（与原行为一致）',
    M.shouldWarnOnEnter({
      synced: true, lastOkAt: NOW - 3000, autoPullDue: false, now: NOW,
    }), false)
}

console.log('── ② 但仍在「本机可能不最新」语义内（不是无脑关掉）──')
{
  eq('❗反正上次同步就是失败的 ⇒ 照弹（近期拉过也救不了）',
    M.shouldWarnOnEnter({
      synced: false, lastOkAt: 0, lastFail: true, autoPullDue: false, now: NOW,
    }), true)
  eq('❗从未成功同步过 ⇒ 照弹',
    M.shouldWarnOnEnter({
      synced: false, lastOkAt: 0, autoPullDue: false, now: NOW,
    }), true)
  eq('❗此刻正在拉取 ⇒ 照弹（这种时候最该提示）',
    M.shouldWarnOnEnter({
      synced: true, lastOkAt: NOW - 3000, pullBusy: true, autoPullDue: false, now: NOW,
    }), true)
  eq('❗这次进页面**不会**自动拉（超过 10 分钟才轮到它）⇒ 陈旧就该弹',
    M.shouldWarnOnEnter({
      synced: true, lastOkAt: NOW - 20 * MIN, autoPullDue: true, now: NOW,
    }), true)
  eq('❗没给该信号时退回原行为：陈旧窗口照旧（兼容既有调用与测试）',
    M.shouldWarnOnEnter({
      synced: true, lastOkAt: NOW - M.STALE_PULL_MS - 1, now: NOW,
    }), true)
}

console.log('── ③ 「近期」的口径 ──')
{
  ok('RECENT_AUTO_PULL_MS 与自动拉取节流同量级（不是 1 分钟的陈旧窗口）',
    M.RECENT_AUTO_PULL_MS >= 10 * 60 * 1000, '实际 ' + M.RECENT_AUTO_PULL_MS)
  eq('陈旧窗口仍独立存在（1 分钟），两者不得合并',
    M.STALE_PULL_MS, 60 * 1000)
  eq('❗本轮会拉（autoPullDue=true）且本机已陈旧 ⇒ 照常提示（该拉就该弹）',
    M.shouldWarnOnEnter({
      synced: true, lastOkAt: NOW - 2 * MIN, autoPullDue: true, now: NOW,
    }), true)
  eq('❗同上，本机陈旧很久 ⇒ 照样弹',
    M.shouldWarnOnEnter({
      synced: true, lastOkAt: NOW - 20 * MIN, autoPullDue: true, now: NOW,
    }), true)
}

console.log('── ④ ❗反向对照：10 分钟节流不认识横幅（不得被联动改写）──')
{
  const cloud = fs.readFileSync(CLOUD, 'utf8')
  ok('AUTO_PULL_INTERVAL_MS 仍是 10 分钟（拉取频率口径不许动）',
    /const AUTO_PULL_INTERVAL_MS = 10 \* 60 \* 1000/.test(cloud))
  ok('节流判断仍是 `Date.now() - last < AUTO_PULL_INTERVAL_MS`',
    /Date\.now\(\) - last < AUTO_PULL_INTERVAL_MS/.test(cloud))
  ok('❗cloud.ts 不引用 sync-notice（横幅判据不参与拉取频率决策）',
    !/from '\.\/sync-notice'/.test(cloud))
  ok('❗sync-notice.ts 不引用 cloud.ts（保持纯函数、无 IO、可直测）',
    !/from '\.\/cloud'/.test(raw))
}

console.log('── ⑤ 真实路径：开了页面**直接点进题库**（rabbit 2026-10-09）──')
{
  // rabbit 原话：「你见过哪个做题的人愿意在首页等一分钟？不都是直接进题库吗？」
  // ⇒ 上一版把减噪挂在 `synced`（= 内存 state === 'ok'）之后是**形同虚设**：
  //   刷新页面后 state 归零成 idle、webSyncPull.at 也归零 ⇒ synced 恒 false
  //   ⇒ 判据在「从未成功同步过」那一支就 return true 了，减噪那行**永远走不到**。
  const cloud = fs.readFileSync(CLOUD, 'utf8')
  ok('❗「上次成功拉取」必须**持久化**（内存口径刷新即归零 ⇒ 冷启动时无法与"从没同步过"区分）',
    /cloud_last_pull_at/.test(cloud))
  ok('❗markPulled 同时写内存与本地存储（成功才写；只推不拉的轻推仍不得写）',
    /function markPulled[\s\S]{0,300}?localStorage\.setItem/.test(cloud))
  const markSeg = cloud.slice(cloud.indexOf('function markPulled'), cloud.indexOf('function markPulled') + 320)
  ok('❗反向对照：内部仍只由 markPulled 写（不许别处伪造"已拉取"）',
    (cloud.match(/webSyncPull\.at = Date\.now\(\)/g) || []).length === 1)
  ok('初始化时从本地存储读回（否则首屏仍是「未同步」）',
    /const webSyncPull = \{ at: readPersistedLastPull\(\)/.test(cloud) ||
    /webSyncPull = \{ at: readPersisted/.test(cloud))

  // 调用方必须把**持久化后**的成功时刻交上去，而不是拿内存 state 推 synced
  const pv = fs.readFileSync(path.join(ROOT, 'src', 'views', 'PracticeView.vue'), 'utf8')
  const hv = fs.readFileSync(path.join(ROOT, 'src', 'views', 'HomeView.vue'), 'utf8')
  ok('❗练习页的 synced 改为「有没有成功拉取记录」，不再取 state === \'ok\'',
    !/const ok = st\.state === 'ok'[\s\S]{0,200}synced: ok/.test(pv))
  ok('❗首页同理', !/const ok = st\.state === 'ok'[\s\S]{0,300}synced: ok/.test(hv))
}

console.log('── ⑥ ❗冷启动判据：近期同步过 ⇒ 不唠叨；没同步过/真陈旧 ⇒ 照说 ──')
{
  // 冷启动时调用方交上来的就是持久化值（lastOkAt = 上次成功拉取时刻）
  eq('❗3 分钟前刚同步过 + 本轮不会自动拉 ⇒ 不弹（rabbit 的真实路径）',
    M.shouldWarnOnEnter({
      synced: true, lastOkAt: NOW - 3 * MIN, autoPullDue: false, now: NOW,
    }), false)
  eq('❗3 分钟前刚同步过 + 本轮会自动拉（还没起跑）⇒ 照弹（此刻确实可能读到旧数据，拉完自动收）',
    M.shouldWarnOnEnter({
      synced: true, lastOkAt: NOW - 3 * MIN, autoPullDue: true, now: NOW,
    }), true)
  eq('❗从没成功同步过（持久化里也没有）⇒ 照弹',
    M.shouldWarnOnEnter({
      synced: false, lastOkAt: 0, autoPullDue: true, now: NOW,
    }), true)
  eq('❗真陈旧（3 小时）+ 本轮不会自动拉 ⇒ 照弹（没有拉取安排，得让人知道）',
    M.shouldWarnOnEnter({
      synced: true, lastOkAt: NOW - 3 * 60 * MIN, autoPullDue: false, now: NOW,
    }), true)

  // 上面那种「不会有拉取来收横幅」的情形 ⇒ 必须能手动关，否则整场会话都杵在那儿。
  const pv = fs.readFileSync(path.join(ROOT, 'src', 'views', 'PracticeView.vue'), 'utf8')
  const banner = pv.slice(pv.indexOf('v-if="syncingHint"'), pv.indexOf('v-if="syncingHint"') + 300)
  ok('❗这条进库横幅必须带关闭按钮（同页另两条都有；只靠"拉完自收"会卡住）',
    /close-btn/.test(banner) && /dismissSyncingHint/.test(banner))
  ok('关闭函数清展示状态与「拉完自收」标记', /function dismissSyncingHint[\s\S]{0,300}noticeShouldShow\.value = false/.test(pv))
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
