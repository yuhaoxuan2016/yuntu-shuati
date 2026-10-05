// 更新日志数据与视图的绑定守卫（2026-10-05）
//
// 病：更新日志原先内联在 SettingsView.vue 的模板里，一度堆到 78 条、占该文件 46% 行数，
// 且展开时 78 条全部进 DOM。抽成 lib/changelog.ts 后，风险从「视图臃肿」变成
// 「数据与视图脱节」——比如有人改回内联、或在视图里硬编版本号、或数据顺序被打乱。
//
// 本测试守四件事：
//   ① CHANGELOG 非空且版本号严格从新到旧
//   ② 版本号格式统一（v + 语义化数字）
//   ③ 视图只引用数据、不再内联版本号（模板里不得出现 <span class="log-version">vX.Y.Z</span>）
//   ④ 最新一条的版本号 == package.json 的 version（发版必须补日志）
//
// 跑法：node tests/changelog-parity.test.cjs
const fs = require('fs')
const path = require('path')
const esbuild = require('esbuild')

const ROOT = path.join(__dirname, '..')
const fail = []

// 从 TS 源码取 CHANGELOG（剥 export 再 transform，与其它守卫同法）
const dataSrc = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'changelog.ts'), 'utf8').replace(/\r\n/g, '\n')
const code = esbuild.transformSync(
  dataSrc.replace(/\bexport\s+/g, ''),
  { loader: 'ts' }
).code
const CHANGELOG = new Function(`var __c__ = null;\n${code}\n__c__ = CHANGELOG;\nreturn __c__`)()
const RECENT_COUNT = new Function(`var __r__ = null;\n${code}\n__r__ = RECENT_COUNT;\nreturn __r__`)()

// ① 非空 + 版本严格从新到旧
if (!Array.isArray(CHANGELOG) || CHANGELOG.length === 0) {
  fail.push('CHANGELOG 为空或不是数组')
} else {
  const toNum = (v) => String(v).replace(/^v/, '').split('.').map((n) => Number(n))
  const gt = (a, b) => {
    const x = toNum(a), y = toNum(b)
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const p = x[i] || 0, q = y[i] || 0
      if (p !== q) return p > q
    }
    return false
  }
  for (let i = 1; i < CHANGELOG.length; i++) {
    if (!gt(CHANGELOG[i - 1].ver, CHANGELOG[i].ver)) {
      fail.push(`顺序错误：${CHANGELOG[i - 1].ver} 应排在 ${CHANGELOG[i].ver} 之前（数组须从新到旧）`)
    }
  }
  // ② 版本格式 + 重复
  const seen = new Set()
  for (const e of CHANGELOG) {
    if (!/^v\d+\.\d+\.\d+$/.test(e.ver)) fail.push(`版本号格式不规范：${e.ver}`)
    if (seen.has(e.ver)) fail.push(`版本号重复：${e.ver}`)
    seen.add(e.ver)
    if (typeof e.html !== 'string' || !e.html.trim()) fail.push(`${e.ver} 的 html 为空`)
    // 内容必须是受控标签（防将来塞入 script/onXXX 等危险 HTML）
    if (/<script|on\w+\s*=|javascript:/i.test(e.html)) {
      fail.push(`${e.ver} 的 html 含不允许的内容（script / 事件属性 / javascript:）`)
    }
  }
}

// ③ 视图不再内联版本号，且确实引用了数据
const view = fs.readFileSync(path.join(ROOT, 'src', 'views', 'SettingsView.vue'), 'utf8').replace(/\r\n/g, '\n')
const viewTpl = view.slice(0, view.indexOf('<script setup'))
const inlineVer = viewTpl.match(/<span class="log-version">v[\d.]+</g)
if (inlineVer) fail.push(`视图模板仍内联版本号（${inlineVer.length} 处）——应改为渲染 CHANGELOG`)
if (!/v-for="entry in visibleChangelog"/.test(viewTpl)) fail.push('视图未用 v-for 渲染 visibleChangelog')
if (!/v-html="entry\.html"/.test(viewTpl)) fail.push('视图未用 v-html 渲染条目 html')
if (!/from '\.\.\/lib\/changelog'/.test(view)) fail.push('视图未从 lib/changelog 导入')

// ④ 最新一条 == package.json 版本
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
if (CHANGELOG.length && CHANGELOG[0].ver !== `v${pkg.version}`) {
  fail.push(`最新日志 ${CHANGELOG[0].ver} ≠ package.json 版本 v${pkg.version}（发版须补日志条目）`)
}

if (fail.length) {
  console.error('❌ changelog 守卫失败：')
  fail.forEach((f) => console.error('   ' + f))
  process.exit(1)
}
console.log(`✅ changelog 守卫通过：${CHANGELOG.length} 条，最新 ${CHANGELOG[0].ver}（= package.json），` +
  `最早 ${CHANGELOG[CHANGELOG.length - 1].ver}，默认展示 ${RECENT_COUNT} 条`)

// 反向对照：把顺序颠倒后必须报错（证明守卫真的在检）
{
  const flipped = CHANGELOG.slice().reverse()
  const toNum = (v) => String(v).replace(/^v/, '').split('.').map((n) => Number(n))
  const gt = (a, b) => {
    const x = toNum(a), y = toNum(b)
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const p = x[i] || 0, q = y[i] || 0
      if (p !== q) return p > q
    }
    return false
  }
  let caught = false
  for (let i = 1; i < flipped.length; i++) if (!gt(flipped[i - 1].ver, flipped[i].ver)) { caught = true; break }
  if (!caught) {
    console.error('❌ 反向对照失败：顺序颠倒后竟未报错，说明顺序检查无效')
    process.exit(1)
  }
  console.log('[反向对照] 顺序颠倒后能检出错误 ✓')
}
process.exit(0)
