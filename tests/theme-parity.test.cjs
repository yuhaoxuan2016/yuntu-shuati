// 跨端主题色一致性（2026-10-05）
//
// 背景：两端各有一份「10 套主题色」定义 ——
//   网页版 `shuati-pwa/src/style.css` 的 `[data-theme-color="X"] { --tc-base/--tc-light/--tc-deep }`
//   小程序 `yuntu-mp/src/lib/theme.ts` 的 `THEMES[]`（{ base, light, deep }）
// 小程序不能用 CSS 变量，所以同一份主题色在 `yuntu-mp/src/App.vue` 的 `.skin-*` 静态样式里
// **又手写了一遍**——即小程序侧本身也是两处同源。三处任一漂移，用户就会看到「同一套主题、
// 两端不一样」或「小程序内颜色打架」。
//
// 2026-10-05 首次校正：tech.deep / forest.light / forest.deep / space.light / space.deep 五值
// 小程序侧各差一档（写在「与网页版对齐」的注释下却对不齐）。本测试即为其守卫。
//
// 跑法：node tests/theme-parity.test.cjs   （两仓并列才有意义，否则跳过 rc=0）
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const WEB_CSS = path.join(ROOT, 'shuati-pwa', 'src', 'style.css')
const MP_THEME = path.join(ROOT, 'yuntu-mp', 'src', 'lib', 'theme.ts')
const MP_APP = path.join(ROOT, 'yuntu-mp', 'src', 'App.vue')

for (const f of [WEB_CSS, MP_THEME, MP_APP]) {
  if (!fs.existsSync(f)) {
    console.log(`[skip] 缺 ${path.relative(ROOT, f)}，主题色一致性检查跳过`)
    process.exit(0)
  }
}

const IDS = ['green', 'blue', 'purple', 'pink', 'orange', 'teal', 'tech', 'forest', 'space', 'cloud']

// ---- 网页版：从 CSS 抽 10 套 ----
const css = fs.readFileSync(WEB_CSS, 'utf8').replace(/\r\n/g, '\n')
const web = {}
for (const id of IDS) {
  const m = css.match(new RegExp(`\\[data-theme-color="${id}"\\]\\s*\\{([\\s\\S]*?)\\}`))
  if (!m) { console.error(`网页版 style.css 找不到 [data-theme-color="${id}"]`); process.exit(1) }
  const body = m[1]
  const g = (k) => {
    const r = body.match(new RegExp(`--tc-${k}:\\s*(#[0-9a-fA-F]{3,8})`))
    return r ? r[1].toLowerCase() : null
  }
  web[id] = { base: g('base'), light: g('light'), deep: g('deep') }
}

// ---- 小程序 theme.ts ----
const themeSrc = fs.readFileSync(MP_THEME, 'utf8').replace(/\r\n/g, '\n')
const mp = {}
for (const id of IDS) {
  const m = themeSrc.match(new RegExp(`\\{ id: '${id}'[^}]*\\}`))
  if (!m) { console.error(`小程序 theme.ts 找不到 id:'${id}'`); process.exit(1) }
  const s = m[0]
  const g = (k) => {
    const r = s.match(new RegExp(`${k}: '(#[0-9a-fA-F]{3,8})'`))
    return r ? r[1].toLowerCase() : null
  }
  mp[id] = { base: g('base'), light: g('light'), deep: g('deep') }
}

// ---- 小程序 App.vue：.skin-* 的 tp-strong(深色文字) / tp-bg(浅色底) 必须与 theme.ts 同值 ----
const appSrc = fs.readFileSync(MP_APP, 'utf8').replace(/\r\n/g, '\n')

let fail = 0
console.log('① 网页版 style.css  vs  小程序 theme.ts')
for (const id of IDS) {
  for (const f of ['base', 'light', 'deep']) {
    const a = web[id][f], b = mp[id][f]
    const ok = a === b
    if (!ok) fail++
    if (!ok) console.log(`  FAIL  ${id.padEnd(7)} ${f.padEnd(6)} web=${a} mp=${b}`)
  }
}
console.log(fail === 0 ? '  ok 10 套 × 3 字段 = 30 值全一致' : `  共 ${fail} 处不一致`)

console.log('\n② 小程序 App.vue 的 .skin-* 与 theme.ts（同一端内两处同源）')
let fail2 = 0
for (const id of IDS) {
  const strong = appSrc.match(new RegExp(`\\.skin-${id} \\.tp-strong \\{ color: (#[0-9a-f]{6})`))
  const bg = appSrc.match(new RegExp(`\\.skin-${id} \\.tp-bg \\{ background: (#[0-9a-f]{6})`))
  if (strong && strong[1].toLowerCase() !== mp[id].deep) {
    fail2++
    console.log(`  FAIL  .skin-${id} .tp-strong = ${strong[1]} ≠ theme.ts deep ${mp[id].deep}`)
  }
  if (bg && bg[1].toLowerCase() !== mp[id].light) {
    fail2++
    console.log(`  FAIL  .skin-${id} .tp-bg = ${bg[1]} ≠ theme.ts light ${mp[id].light}`)
  }
}
console.log(fail2 === 0 ? '  ok .skin-* 的深色/浅色值与 theme.ts 逐套一致' : `  共 ${fail2} 处不一致`)
fail += fail2

// ---- 反向对照：把 theme.ts 的一个值改回旧值，本测试必须报错 ----
const brokenSrc = themeSrc.replace("light: '#dcfce7', deep: '#166534'", "light: '#f0fdf4', deep: '#15803d'")
let reverseWorks = false
if (brokenSrc !== themeSrc) {
  const m = brokenSrc.match(new RegExp(`\\{ id: 'forest'[^}]*\\}`))
  const s = m[0]
  const light = s.match(/light: '(#[0-9a-fA-F]{6})'/)[1].toLowerCase()
  reverseWorks = light !== web.forest.light
  console.log(`\n[反向对照] 把 forest.light 改回旧值 #f0fdf4 ⇒ 与网页版 ${web.forest.light} 不一致 = ${reverseWorks}（应为 true）`)
} else {
  console.log('\n[反向对照] 未匹配到 forest 定义串，跳过（写法变了要更新本测试的正则）')
}
if (!reverseWorks) fail++

console.log(fail ? `\n❌ 存在 ${fail} 处问题` : '\n✅ 两端主题色 10 套全一致，且反向对照可证伪')
process.exit(fail ? 1 : 0)
