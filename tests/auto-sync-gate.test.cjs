// 离线断言（2026-10-03）：自动同步的开关口径（纯函数 resolveAutoSyncGate，从 cloud.ts 切片直测）。
// 口径（rabbit 2026-10-03）：显式设置优先；没设过 → 与小程序打通默认开、未打通默认关（需手动开）。
// 用法（cwd 在 shuati-pwa）: node tests/auto-sync-gate.test.cjs
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

const s = slice('src/lib/cloud.ts', /^export function resolveAutoSyncGate/, /^\}/, true)
console.log(`切片：resolveAutoSyncGate 第 ${s.from}~${s.to} 行`)
const js = esbuild.transformSync(s.code, { loader: 'ts' }).code
const f = new Function(`${js}\nreturn resolveAutoSyncGate`)()

eq(f('1', false), true, '显式开 → 未绑定也开')
eq(f('0', true), false, '显式关 → 已绑定也关（显式优先）')
eq(f(undefined, true), true, '未设置 + 已绑定 → 开（打通后默认开）')
eq(f(undefined, false), false, '未设置 + 未绑定 → 关（网页↔网页需手动开）')
eq(f(null, false), false, 'null 视同未设置')
eq(f('', false), false, '空串视同未设置')

console.log(failed ? `\n✗ ${failed} 项失败` : '\n全绿')
process.exit(failed ? 1 : 0)
