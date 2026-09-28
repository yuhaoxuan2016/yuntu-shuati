// 离线断言（2026-09-25 立，2026-09-28 改）：从公共题库导入到本地的副本**不该**出现「提交到公共题库」，
// 而**不是**副本的库（自建 / 「导入题库」从文件建的）不该出现「从公共题库更新」。
//
// 2026-09-28 变更：判据本体从 HomeView 搬到了 `src/lib/bank-provenance.ts`（纯函数），
// 这里不再切片 .vue 里的函数体（它在 HomeView 里只剩两行委托，切出来会 ReferenceError——
// 那次改动当场把这个测试打红，是对的）。改为直接编译被测模块，另保留**模板文本守卫**。
//
// 用法: node tests/bank-origin.test.cjs
const fs = require('fs')
const path = require('path')
const os = require('os')
const esbuild = require('esbuild')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src', 'lib', 'bank-provenance.ts')
const VUE = path.join(ROOT, 'src', 'views', 'HomeView.vue')
if (!fs.existsSync(SRC)) { console.error(`✗ 找不到被测实现：${SRC}`); process.exit(1) }
const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bank-origin-')), 'bank-provenance.cjs')
esbuild.buildSync({ entryPoints: [SRC], outfile: outFile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning' })
const P = require(outFile)
const vue = fs.readFileSync(VUE, 'utf8')

let failed = 0
const ok = m => console.log('   ✓ ' + m)
const bad = m => { console.log('   ✗ ' + m); failed++ }

const PUB = [
  { _id: 'lquiz_banks_14', name: '变电安规' },
  { _id: 'lquiz_banks_20', name: '计算题' },
]
const loaded = b => P.isPublicCopy(b, PUB)
const notLoaded = b => P.isPublicCopy(b, [])

const cases = [
  [loaded({ origin_ref: 'lquiz_banks_14', name: '改过名的副本' }), true, '带 origin_ref 的副本（即使改过名）⇒ 判为副本，提交按钮隐藏'],
  [notLoaded({ origin_ref: 'lquiz_banks_14' }), true, '列表没加载、但 origin_ref 在 ⇒ 仍判为副本（本地标记不依赖网络）'],
  [loaded({ name: '变电安规' }), true, '老副本（无 origin_ref）按题库名兜底 ⇒ 判为副本'],
  [loaded({ name: '我的自建题库' }), false, '自建私人库 ⇒ 不是副本，提交按钮照旧显示'],
  [loaded(undefined), false],   // 边界：空对象不炸
  [notLoaded({ name: '变电安规' }), false, '已知边界：老副本 + 列表未加载 ⇒ 兜底失手（届时首页公共题库区也是空的，属降级态）'],
  // 2026-09-28：文件导入的私人库（visibility 取默认 'public'）名字撞车也不算副本
  [loaded({ name: '变电安规', visibility: 'public' }), false, '名字撞上公共库的「文件导入」库 ⇒ **不是**副本（反向对照：同名，只差 visibility）'],
  [loaded({ name: '变电安规', visibility: 'private' }), true, '  同名但 visibility=private 的老副本 ⇒ 仍是副本（对照成立）'],
]
for (const [got, want, msg] of cases) {
  if (!msg) continue
  got === want ? ok(msg) : bad(`${msg}（实际 ${JSON.stringify(got)}）`)
}

// —— 模板文本守卫：两个入口各自的条件都不许丢 ——
const guards = [
  ["v-if=\"!isImportedCopy(b) && b.visibility !== 'public' && b.visibility !== 'pending'\"",
    '提交按钮条件含 !isImportedCopy(b)', '提交按钮条件**不再**含 !isImportedCopy(b) —— 导入副本会把提交按钮露出来'],
  ['<button v-if="isImportedCopy(b)" :disabled="updatingId === b.id"',
    '「从公共题库更新」按钮条件 = isImportedCopy(b)', '更新按钮的条件不是 isImportedCopy(b) —— 自建/文件导入的库又会露出这个入口'],
  ['<div v-if="isImportedCopy(b)" class="pub-sync-hint"',
    '卡片 🔄 提示条件 = isImportedCopy(b)', '卡片提示的条件不是 isImportedCopy(b)'],
]
for (const [want, good, msg] of guards) {
  vue.includes(want) ? ok(msg + '（文本守卫）') : bad(msg)
}

console.log(failed ? `\n有失败：${failed} 项` : '\n全绿')
process.exit(failed ? 1 : 0)
