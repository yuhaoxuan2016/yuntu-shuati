// 离线断言（2026-09-25）：从公共题库导入到本地的副本**不该**出现「提交到公共题库」。
//
// 判据是 HomeView 的 isImportedCopy（先看本地标记 origin_ref，老副本才退回按题库名匹配）。
// 这里用**真实源码切片**（从 .vue 里切出两个函数本体、esbuild 去 TS）跑它，覆盖全部分支，
// 另加一条模板文本守卫（防止将来有人把这条件删掉、导入副本又把提交按钮露出来）。
//
// 用法: node tests/bank-origin.test.cjs
const fs = require('fs')
const path = require('path')
const esbuild = require('esbuild')

const SRC = path.resolve(__dirname, '../src/views/HomeView.vue')
const vue = fs.readFileSync(SRC, 'utf8')
const lines = vue.split(/\r?\n/)

// —— 切片：sourceOf + isImportedCopy 两段连着的函数本体（行尾自适应；结束行＝顶格 '}'）——
const start = lines.findIndex(l => /^function sourceOf\(b: any\)/.test(l))
const i2 = lines.findIndex(l => /^function isImportedCopy\(b: any\)/.test(l))
let end = -1
for (let i = i2 + 1; i2 >= 0 && i < lines.length; i++) if (lines[i] === '}') { end = i; break }
if (start < 0 || i2 < 0 || end < 0 || i2 < start) { console.error('❌ 切片失败：找不到函数边界'); process.exit(2) }
const ts = lines.slice(start, end + 1).join('\n')
const js = esbuild.transformSync(ts, { loader: 'ts' }).code
const make = new Function('publicBanks', `${js}\nreturn { sourceOf, isImportedCopy }`)
console.log(`切片：第 ${start + 1}~${end + 1} 行，${ts.length}B（sourceOf + isImportedCopy）`)

let failed = 0
const ok = m => console.log('   ✓ ' + m)
const bad = m => { console.log('   ✗ ' + m); failed++ }

const PUB = [
  { _id: 'lquiz_banks_14', name: '变电安规' },
  { _id: 'lquiz_banks_20', name: '计算题' },
]
const loaded = make({ value: PUB })
const notLoaded = make({ value: [] })   // 公共库列表还没拉回来（或拉失败）

const cases = [
  [loaded.isImportedCopy({ origin_ref: 'lquiz_banks_14', name: '改过名的副本' }), true, '带 origin_ref 的副本（即使改过名）⇒ 判为副本，提交按钮隐藏'],
  [notLoaded.isImportedCopy({ origin_ref: 'lquiz_banks_14' }), true, '列表没加载、但 origin_ref 在 ⇒ 仍判为副本（本地标记不依赖网络，这条是真修好的那一点）'],
  [loaded.isImportedCopy({ name: '变电安规' }), true, '老副本（无 origin_ref）按题库名兜底 ⇒ 判为副本'],
  [loaded.isImportedCopy({ name: '我的自建题库' }), false, '自建私人库 ⇒ 不是副本，提交按钮照旧显示'],
  [loaded.isImportedCopy(undefined), false],   // 边界：空对象不炸
  [notLoaded.isImportedCopy({ name: '变电安规' }), false, '已知边界：老副本 + 列表未加载 ⇒ 兜底失手（届时首页公共题库区也是空的，属降级态）'],
]
for (const [got, want, msg] of cases) {
  if (!msg) continue
  got === want ? ok(msg) : bad(`${msg}（实际 ${JSON.stringify(got)}）`)
}

// —— 模板文本守卫 ——
const want = "v-if=\"!isImportedCopy(b) && b.visibility !== 'public' && b.visibility !== 'pending'\""
vue.includes(want)
  ? ok('模板里的提交按钮条件含 !isImportedCopy(b)（文本守卫）')
  : bad('模板里的提交按钮条件**不再**含 !isImportedCopy(b) —— 导入副本会把提交按钮露出来')

console.log(failed ? `\n有失败：${failed} 项` : '\n全绿')
process.exit(failed ? 1 : 0)
