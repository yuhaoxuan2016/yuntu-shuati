// 离线断言（2026-10-04）：轻推调度的**封顶等待**（纯函数 decideProgressPushSchedule，从 cloud.ts 切片直测）。
// 病灶（rabbit 实测）：8 秒尾触发每次落盘都被重置 ⇒ 连答 50 题一次都没推（云端停在旧时间、本地照存）。
// 现口径：8 秒没有新动作就推；但本轮**挂满 60 秒必推一次**。
// 用法（cwd 在 shuati-pwa）: node tests/progress-push-cap.test.cjs
const fs = require('fs')
const path = require('path')
const esbuild = require('esbuild')

function slice (file, startRe, endRe, incl) {
  const src = fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8')
  const lines = src.split(/\r?\n/)
  const s = lines.findIndex(l => startRe.test(l))
  const e = lines.findIndex((l, i) => i > s && endRe.test(l))
  if (s < 0 || e < 0) { console.error(`❌ 切片失败：${file}（start=${s} end=${e}）`); process.exit(2) }
  return { code: lines.slice(s, incl ? e + 1 : e).join('\n').replace(/^export /gm, ''), from: s + 1, to: incl ? e + 1 : e }
}

let failed = 0
const eq = (a, b, m) => {
  const ok = JSON.stringify(a) === JSON.stringify(b)
  console.log((ok ? '   ✓ ' : '   ✗ ') + m + (ok ? '' : `｜实得 ${JSON.stringify(a)} 期望 ${JSON.stringify(b)}`))
  if (!ok) failed++
}

// 1) 纯函数本体
const s = slice('src/lib/cloud.ts', /^export function decideProgressPushSchedule/, /^\}/, true)
console.log(`切片：decideProgressPushSchedule 第 ${s.from}~${s.to} 行`)
const MAX = (() => {
  const src = fs.readFileSync(path.resolve(__dirname, '../src/lib/cloud.ts'), 'utf8')
  const m = /const AUTO_PUSH_MAX_WAIT_MS = (\d+) \* 1000/.exec(src)
  if (!m) { console.error('❌ 找不到 AUTO_PUSH_MAX_WAIT_MS'); process.exit(2) }
  return Number(m[1]) * 1000
})()
console.log(`封顶常量 AUTO_PUSH_MAX_WAIT_MS = ${MAX / 1000}s`)

const js = esbuild.transformSync('const AUTO_PUSH_MAX_WAIT_MS = ' + MAX + '\n' + s.code, { loader: 'ts' }).code
const f = new Function(`${js}\nreturn decideProgressPushSchedule`)()

const T0 = 1_700_000_000_000
eq(f(T0, 0), 'reset-timer', '本轮未开（first=0）→ 走常规重置（不会凭空立刻推）')
eq(f(T0 + 1, T0), 'reset-timer', '刚开轮 1ms → 重置')
eq(f(T0 + MAX - 1, T0), 'reset-timer', '差 1ms 才满封顶 → 仍重置')
eq(f(T0 + MAX, T0), 'fire', '恰好满 60s → 立刻推')
eq(f(T0 + MAX + 5_000, T0), 'fire', '超封顶 → 立刻推')

// 2) 模拟「连续作答」：每 5 秒来一次调度，最多隔多久必推一次？
//    期望：不再饿死——第一轮在 60s 处触发（此前是**永远不触发**）。
let first = 0; let firedAt = []
for (let t = 0; t <= 300_000; t += 5_000) {
  if (!first) first = t + 1
  if (f(t + 1, first) === 'fire') { firedAt.push((t + 1) / 1000); first = 0 }
  // reset-timer 分支不改 first（与实现一致：重置计时器不动本轮起点）
}
console.log(`连续作答（每 5s 一次，共 300s）触发时刻(s)：${JSON.stringify(firedAt)}`)
// 注意口径：循环里时间是 t+1ms，且**下一轮的起点在下次调度时**才记（即再等一个作答间隔 5s），
// 所以期望值是「首次 ≈60s」「相邻间距 ≤ 65s（封顶 60s + 一个作答间隔）」——如实断言，别硬凑成整 60。
eq(firedAt.length >= 4, true, '300 秒内至少推 4 次（旧口径是 0 次）')
eq(firedAt[0] >= 60 && firedAt[0] < 61, true, `第一次触发满封顶即推（实得 ${firedAt[0]}s）`)
eq(firedAt.every((v, i) => i === 0 || (v - firedAt[i - 1] >= 60 && v - firedAt[i - 1] <= 65)), true,
  '此后每轮间隔落在 60~65s（＝封顶 + 一个作答间隔），不再被无限推迟')

// 3) 反向对照：**停手**的场景仍走 8 秒尾触发（不受封顶影响）
eq(f(T0 + 3_000, T0), 'reset-timer', '只过了 3 秒（用户停手）→ 仍交给 8 秒计时器，不被封顶抢跑')

console.log(failed ? `\n✗ ${failed} 项失败` : '\n全绿')
process.exit(failed ? 1 : 0)
