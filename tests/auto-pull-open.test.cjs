// 2026-10-07 · 打开网页自动拉取的时序守卫（断言 + 反向对照）
// 用法（cwd = shuati-pwa）：node tests/auto-pull-open.test.cjs
//
// 历史（别改回去）：
//   rabbit 07:03 问「网页版同步是有延迟吗？而且我没看到横幅」→ 我误判成 bug，把启动延迟
//   4s 改成 800ms、把 10 分钟节流改成 1 分钟，并造了个 shouldPullOnOpen 判据。
//   rabbit 随即裁定：**那个延迟是有道理的** —— 每次开页面要先自渲染/切换新版，同步不该挤在
//   首屏关键路径上；而且「一个页面开一次同步一次就够了」。
//
// 所以本文件的职责**反转**了：不再论证"该拉得更勤"，而是守住两条不被改动的口径：
//   ① App.vue 启动延迟 = 4000ms（首屏留白）
//   ② cloud.ts 的自动拉取节流 = 10 分钟（AUTO_PULL_INTERVAL_MS）
// 另：横幅判据（sync-notice.ts 的 STALE_PULL_MS = 1 分钟）与这两条是**两件事**，不得联动。
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

let pass = 0, fail = 0
function ok (name, cond, extra) {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; console.log('✗', name, extra ? '\n   ' + extra : '') }
}

const cloud = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'cloud.ts'), 'utf8')
const app = fs.readFileSync(path.join(ROOT, 'src', 'App.vue'), 'utf8')
const notice = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'sync-notice.ts'), 'utf8')

console.log('── ① 启动延迟保持 4 秒（给首屏/切新版留时间）──')
{
  ok('App.vue 启动延迟仍是 4000ms', /\}, 4000\)/.test(app),
    '被改成了：' + (app.match(/window\.setTimeout\([\s\S]{0,200}?\}, (\d+)\)/) || [])[1])
  ok('注释里写明了"保持 4 秒"的理由（防后人再当 bug 改）',
    /rabbit 裁定[\s\S]{0,200}保持 4 秒/.test(app))
}

console.log('── ② 自动拉取节流保持 10 分钟 ──')
{
  ok('AUTO_PULL_INTERVAL_MS 仍是 10 分钟',
    /const AUTO_PULL_INTERVAL_MS = 10 \* 60 \* 1000/.test(cloud))
  ok('maybeAutoSyncOnOpen 用该常量判（没换别的判据）',
    /Date\.now\(\) - last < AUTO_PULL_INTERVAL_MS/.test(cloud))
  ok('❗反向对照：cloud.ts 里不该再出现 shouldPullOnOpen（B 已被撤销）',
    !/shouldPullOnOpen/.test(cloud))
}

console.log('── ③ 横幅口径与拉取频率解耦（不许联动）──')
{
  ok('sync-notice.ts 不再导出 shouldPullOnOpen', !/shouldPullOnOpen/.test(notice))
  ok('sync-notice.ts 不再导出 OPEN_PULL_MS', !/OPEN_PULL_MS/.test(notice))
  ok('横幅陈旧窗口仍是 1 分钟（与 10 分钟节流无关）',
    /export const STALE_PULL_MS = 60 \* 1000/.test(notice))
  ok('注释明确了两者不是同一条线', /只决定横幅要不要出现[\s\S]{0,120}不决定自动拉取的频率/.test(notice))
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
