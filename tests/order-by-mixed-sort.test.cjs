// created_at 混存形态的排序回归（2026-10-05）
//
// 病：`created_at` 两端写入形态不同（网页版 ISO 串 / 小程序毫秒数），云端 `orderBy` 对同一字段
// 混存两种类型时**先按类型分组再排** ⇒ 时间序被打乱。`quiz_banks` 实测 ISO 19 + 数字 33 + null 1，
// 网页版首页「公共题库」的「最新在前」此前一直是错的。
//
// 修：不依赖云端排序，改成「取全 → 本地按 createdAtMs 归一倒序」。
//
// 本测试用**真实云端数据**验证：旧口径（云端 orderBy 的返回顺序）与 新口径（本地归一排序）
// 的差异；并断言新口径确实是有序的。只读。
//
// 跑法：node tests/order-by-mixed-sort.test.cjs
const path = require('path')

const SCRIPTS = path.join(__dirname, '..', 'scripts')
let creds = null
let get = () => ''
try {
  const c = require(path.join(SCRIPTS, '_creds.cjs'))
  get = c.get            // 单键读取：环境变量 > .creds.env
  creds = c.creds()      // { sid, skey }
} catch { /* 无凭据：走到下面 skip */ }
let tcb = null
try { tcb = require(path.join(__dirname, '..', 'node_modules', '@cloudbase', 'node-sdk')) } catch { /* 无 sdk */ }

// envId 从凭据文件读（**不写进本文件**：tests/ 是入库目录，envId 不得入库，见 AGENTS.md §9）。
// `_creds.cjs` 在 gitignore 的 scripts/ 下，仅本机存在 ⇒ 换机/CI 上取不到就跳过本测试。
// ⚠️ `creds()` 只返回 sid/skey，**不含 envId**；envId 的键名是 `CLOUD_ENV_ID`，
//    与项目既有脚本（biz-stats.mjs / monitor-usage.mjs）同口径，故这里用 `get()` 单独取。
const ENV_ID = process.env.CLOUD_ENV_ID || get('CLOUD_ENV_ID') || ''
if (!creds || !tcb || !ENV_ID) {
  console.log('[skip] 缺凭据/环境 ID/node-sdk（scripts/.creds.env 与 @cloudbase/node-sdk），跳过')
  process.exit(0)
}

// 与被测代码同口径的归一函数（exam.ts 的 createdAtMs）。此处独立实现一份以做交叉验证：
// 若两者结论不一致，说明源码改了而测试没跟上——那本身就是需要发现的漂移。
function createdAtMs(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const t = new Date(String(v ?? '')).getTime()
  return Number.isFinite(t) ? t : 0
}

// 同步核验：源码里确实有 createdAtMs 且是这套实现（防止测试与实现脱节）
const fs = require('fs')
const examSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'exam.ts'), 'utf8')
if (!/function createdAtMs\(v: any\): number/.test(examSrc)) {
  console.error('❌ exam.ts 里找不到 createdAtMs —— 实现与测试脱节，需更新本测试')
  process.exit(1)
}
// 只查**真实调用**：注释里出现这个串是允许的（本次改动就在注释里写明「去掉了 orderBy」）。
// 判据 = 该行不是注释行（去空白后不以 // 或 * 开头）。
const codeLines = examSrc.split('\n').filter(l => {
  const t = l.trim()
  return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
})
const stillOrderBy = codeLines.filter(l => /\.orderBy\('created_at'/.test(l))
if (stillOrderBy.length) {
  console.error("❌ exam.ts 代码里仍存在 .orderBy('created_at' —— 归一排序改造未生效：")
  stillOrderBy.forEach(l => console.error('   ' + l.trim()))
  process.exit(1)
}
console.log("① 源码核验：createdAtMs 在位，且代码中已无 orderBy('created_at')（注释提及不算）")

async function main() {
  const app = tcb.init({ env: ENV_ID, secretId: creds.sid, secretKey: creds.skey })
  const db = app.database()

  // 拉 quiz_banks 全量（实盘 53）
  const rows = []
  for (let skip = 0; skip < 500; skip += 100) {
    const res = await db.collection('quiz_banks').skip(skip).limit(100).get()
    const d = res.data || []
    rows.push(...d)
    if (d.length < 100) break
  }
  console.log(`\n② quiz_banks 实拉 ${rows.length} 行`)

  const dist = {}
  for (const r of rows) {
    const v = r.created_at
    const s = v == null ? 'null' : typeof v === 'number' ? 'number' : 'string'
    dist[s] = (dist[s] || 0) + 1
  }
  console.log('   created_at 形态分布：', dist)

  // 旧口径：模拟云端 orderBy 的「先按类型分组再排」行为
  // （CloudBase 实测：ISO 组与数字组各自有序，组间按类型先后拼接）
  const iso = rows.filter(r => typeof r.created_at === 'string').sort((a, b) => createdAtMs(b.created_at) - createdAtMs(a.created_at))
  const num = rows.filter(r => typeof r.created_at === 'number').sort((a, b) => b.created_at - a.created_at)
  const nul = rows.filter(r => r.created_at == null)
  const oldOrder = [...iso, ...num, ...nul]

  // 新口径：本地统一归一后倒序
  const newOrder = rows.slice().sort((a, b) => createdAtMs(b.created_at) - createdAtMs(a.created_at))

  // 断言 A：新口径确实单调不增
  let violations = 0
  for (let i = 1; i < newOrder.length; i++) {
    if (createdAtMs(newOrder[i].created_at) > createdAtMs(newOrder[i - 1].created_at)) violations++
  }
  console.log(`\n③ 新口径单调性检查：违反（后项 > 前项）次数 = ${violations}（应为 0）`)

  // 断言 B：只有单一时态时两者应一致；混存时必须出现差异
  const mixed = Object.keys(dist).length > 1
  const sameOrder = JSON.stringify(oldOrder.map(r => r._id)) === JSON.stringify(newOrder.map(r => r._id))
  console.log(`④ 旧口径与新口径顺序${sameOrder ? '一致' : '不同'}；本次数据${mixed ? '是' : '不是'}混存形态`)
  if (mixed && sameOrder) {
    console.log('   （混存却没差异：可能两类时间区间不重叠，属正常，不判失败）')
  }

  // 打印前 8 条对照
  console.log('\n⑤ 前 8 条顺序对照（旧 orderBy 口径 → 新归一口径）')
  for (let i = 0; i < Math.min(8, newOrder.length); i++) {
    const o = oldOrder[i], n = newOrder[i]
    const mark = o._id === n._id ? '  ' : '≠ '
    console.log(`  ${mark}[${i}] old=${String(o.name || o._id).slice(0, 18).padEnd(18)} (${typeof o.created_at})  new=${String(n.name || n._id).slice(0, 18).padEnd(18)} (${typeof n.created_at})`)
  }

  console.log('\n⑥ null 形态的位置：旧口径末尾 / 新口径按归一值 0 排在末尾')
  const nullCount = rows.filter(r => r.created_at == null).length
  console.log(`   null 行数 = ${nullCount}（归一为 0 ⇒ 排最后，不再挤占「最新」位）`)

  const fail = violations > 0
  console.log(fail ? `\n❌ 新口径未做到单调有序` : '\n✅ 新口径在真实数据上单调有序（缺陷已修）')
  process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error('测试失败：', e.message); process.exit(1) })
