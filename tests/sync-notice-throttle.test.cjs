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

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
