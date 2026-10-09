// 访问量 + 资源点用量抓取脚本
// 用法: node scripts/fetch-visit-stats.mjs
// 输出: A) 访问统计（累计/每日/趋势）  B) CloudBase 资源点（当前计费周期 已用/配额/剩余 + 按日实扣）
// 存档: backups/visit-stats/visit-<时间戳>.json（全量快照）
// ⚠️ 资源点读数口径见 fetchCredits() 上方注释；改错了会被 check-credits-reading.mjs 拦下
import { SECRET_ID, SECRET_KEY, get } from './_creds.mjs'
import cloudbase from '@cloudbase/node-sdk'
import tcbSdk from 'tencentcloud-sdk-nodejs-tcb'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
// envId 不进仓库（与 src/lib/visit.ts 的 VITE_DEFAULT_CLOUD_ENV_ID 同口径）：
// 走 scripts/.creds.env 里的 CLOUD_ENV_ID，或同名环境变量覆盖。缺失就早失败，不静默用空值。
const ENV_ID = process.env.CLOUD_ENV_ID || get('CLOUD_ENV_ID') || ''
if (!ENV_ID) {
  console.error('缺少 CLOUD_ENV_ID —— 在 scripts/.creds.env 加一行 CLOUD_ENV_ID=<你的环境ID>，或用环境变量传入')
  process.exit(2)
}
const MODULES = ['FLEXDB', 'SCF', 'COS', 'HOSTING', 'Auth', 'APIInvocation', 'HTTPInvocation', 'Other']
const MODULE_NAMES = { FLEXDB: '文档数据库', SCF: '云函数', COS: '云存储', HOSTING: '静态托管', Auth: '用户认证', APIInvocation: 'API调用', HTTPInvocation: 'HTTP调用', Other: '其他' }

async function fetchVisits(db) {
  const res = await db.collection('visit_stats').limit(1000).get()
  const rows = Array.isArray(res.data) ? res.data : []
  const globalDoc = rows.find(r => r.key === 'global' || r._id === 'global')
  const daily = rows
    .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.key || r._id))
    .map(r => ({ date: r.key || r._id, count: typeof r.today === 'number' ? r.today : 0 }))
    .sort((a, b) => a.date.localeCompare(b.date))
  return { globalTotal: globalDoc?.total ?? null, daily }
}

// 资源点读数（schema 3）。
// 🔴 2026-10-09 实测更正（推翻 schema 2 的两条前提）：
//  · `DescribeCreditsUsage` 的窗口**基本被忽略**：0~0/1~0/2~0/6~0 全返 0；7 天窗口返 0；≥10 天返 7024.45；
//    整段落在 10-01 之后的窗口（含单日 10-01、10-05）恒 0；整段落在 09-30 之前的窗口（哪怕单日）恒 7024.45。
//    ⇒ 它给的是**最近一个已结算周期**，不是「当前周期累计」——老注释说「就是当前周期已用」是错的，
//    根因是当时（09-25）恰好落在有数据的那段里。**用 today=EndDate 单日窗口 ⇒ 恒 0**，这正是「资源点一直不更新」的病根。
//  · 明细 `DescribeCreditsUsageDetail` 覆盖 **08-08→09-23**（47 天），**10 月 0 天** ⇒ 平台侧计量自 09-23 起停更（待人工去控制台确认）。
//  ⇒ 因此本脚本只报「最近一期」并把 `数据截至` 一并输出；不把任何数写成「实时本周期」。
//  · `ReportValue` = OriginCredits − DeductValue 的**未扣减残差，不是余额**。旧版把它当 remaining，
//    于是 8 份存档里「剩余」恒为 832.51、周报常年喊「还能撑 3 天」。
//  · 配额走 DescribeEnvPlans → ResourceLimit.Credits.MaxSize（个人版 40000/月），不写死。
const CREDITS_SCHEMA = 3
const DAILY_WINDOW_DAYS = 30
// 聚合口径的窗口＝「dataThrough 所在自然月的 1 号 → dataThrough」。
// 实测依据（2026-10-09）：单日 09-20 查询 = 7024.45（= 整个 9 月），单日 10-01 = 0 ⇒ 平台按**自然月**聚合并忽略窗口内的天数；
// 而窗口一旦跨月就把上个月并进来（08-30→10-09 = 8155.77 = 8+9 月）⇒ 必须切在月初，否则「最近一期」会虚高一截。

export async function fetchCredits() {
  const tcb = tcbSdk.tcb.v20180608
  const c = new tcb.Client({ credential: { secretId: SECRET_ID, secretKey: SECRET_KEY }, region: 'ap-shanghai' })
  const R = (x) => (x && x.Response) ? x.Response : x
  const fmt = (dt) => dt.toISOString().slice(0, 10)
  const d = new Date()
  const today = fmt(d)

  let quota = null, quotaEvery = null, packageId = null, packageName = null
  try {
    const envs = R(await c.DescribeEnvs({ EnvId: ENV_ID }))
    const env = (envs.EnvList || []).find((e) => e.EnvId === ENV_ID) || {}
    packageId = env.PackageId ?? null
    packageName = env.PackageName ?? null
    const plans = R(await c.DescribeEnvPlans({}))
    const plan = (plans.PlanList || []).find((p) => p.PackageId === packageId)
    const cr = JSON.parse(plan.ResourceLimit).Credits
    quota = Number(cr.MaxSize)
    quotaEvery = cr.TimeUnit === 'm' ? '月' : (cr.TimeUnit || '?')
  } catch { /* 拿不到配额就不算使用率，不猜数 */ }

  const start = fmt(new Date(d.getTime() - DAILY_WINDOW_DAYS * 86400000))
  let dailySeries = [], byModule = []
  try {
    const detail = R(await c.DescribeCreditsUsageDetail({
      EnvId: ENV_ID, StartDate: start, EndDate: today, Modules: MODULES, NeedUsageDetails: true,
    }))
    const modSum = {}, daySum = {}
    for (const mod of detail.Usages || []) {
      // 按模块名归并——旧版按传入 Modules 的下标对齐 Usages，模块缺项就会串位报错数
      const key = mod.Module || mod.ResourceType || '?'
      modSum[key] = (modSum[key] || 0) + Number(mod.DeductValue || 0)
      for (const m of mod.MetricUsageDetail || [])
        for (const v of m.ValueDetailList || []) {
          const day = String(v.CalcTime).slice(0, 10)
          daySum[day] = (daySum[day] || 0) + Number(v.DeductValue || 0)
        }
    }
    byModule = Object.entries(modSum)
      .map(([module, deduct]) => ({ module, name: MODULE_NAMES[module] || module, deduct: Number(deduct.toFixed(2)) }))
      .filter((x) => x.deduct > 0).sort((a, b) => b.deduct - a.deduct)
    dailySeries = Object.keys(daySum).sort().map((date) => ({ date, deduct: Number(daySum[date].toFixed(2)) }))
  } catch { /* 明细失败不影响主读数 */ }

  const dailyWindowDays = DAILY_WINDOW_DAYS + 1
  const dailyTotal = Number(dailySeries.reduce((s, x) => s + x.deduct, 0).toFixed(2))
  const avgDailyBurn = dailyTotal / dailyWindowDays

  // 数据新鲜度：明细里最新的一天＝平台侧计量的覆盖上限（2026-10-09 实测＝09-23，10 月 0 天）
  const dataThrough = dailySeries.length ? dailySeries[dailySeries.length - 1].date : null
  const staleDays = dataThrough ? Math.floor((Date.parse(today) - Date.parse(dataThrough)) / 86400000) : null
  const stale = staleDays != null && staleDays >= 2

  // 聚合口径：窗口**锚在 dataThrough**（不是今天）——停更期间读数才稳定。
  // 且窗口取 30 天：实测 60 天窗口会把上一期也并进来（8月+9月 = 8155.77），30 天只圈住最近一期（9 月 = 7024.45）。
  const anchor = dataThrough || today
  const usageStart = anchor.slice(0, 8) + '01'
  const usage = R(await c.DescribeCreditsUsage({ EnvId: ENV_ID, StartDate: usageStart, EndDate: anchor }))
  const used = Number(usage.DeductValue ?? 0)   // 最近一期（平台侧已结算）的扣减；**不是**实时本周期
  const origin = Number(usage.OriginCredits ?? 0)
  const unwaived = Number(usage.ReportValue ?? 0)
  const packageDeduct = Number(usage.PackageDeductValue ?? 0)

  const remaining = quota != null ? Number((quota - used).toFixed(2)) : null
  const usagePct = quota ? Number((used / quota * 100).toFixed(2)) : null

  return {
    schema: CREDITS_SCHEMA, used, origin, unwaived, packageDeduct,
    quota, quotaEvery, packageId, packageName, remaining, usagePct,
    dailySeries, dailyWindowDays, dailyTotal, avgDailyBurn, byModule,
    dataThrough, staleDays, stale, usageAnchor: anchor, usageWindowStart: usageStart,
  }
}

// 告警判定：配额按月重置 ⇒「还能撑几天」是错指标，只看使用率与烧速
// ⚠️ 平台侧数据停更时**不产出使用率告警**——拿旧数喊「用得快」比不喊更坏（2026-10-09：明细停在 09-23）
export function warnReasons(c) {
  const out = []
  if (c.stale) return out
  if (c.quota && c.usagePct >= 80) out.push(`资源点使用率 ${c.usagePct}%（≥80%）`)
  const budget = c.quota ? c.quota / 30 : 0
  if (budget > 0 && c.avgDailyBurn > budget * 2) out.push(`日均实扣 ${c.avgDailyBurn.toFixed(0)} 点/天，超月度预算速率 ${budget.toFixed(0)} 点/天的 2 倍`)
  return out
}

async function main() {
  const app = cloudbase.init({ env: ENV_ID, secretId: SECRET_ID, secretKey: SECRET_KEY })
  const db = app.database()

  // ===== A. 访问统计 =====
  const visits = await fetchVisits(db)
  const daily = visits.daily
  const sumLast = (n) => {
    const cut = daily.slice(-n)
    return { days: cut.length, total: cut.reduce((s, x) => s + x.count, 0) }
  }
  const last7 = sumLast(7), last30 = sumLast(30)
  const peak = daily.reduce((m, x) => (x.count > m.count ? x : m), { date: '-', count: 0 })
  const today = daily[daily.length - 1]

  console.log(`📊 刷题宝数据报告（${new Date().toLocaleString('zh-CN')}）`)
  console.log(`\n【访问统计】`)
  console.log(`   累计设备访问: ${visits.globalTotal ?? '?'} 次`)
  console.log(`   有记录天数: ${daily.length} 天（${daily[0]?.date || '-'} ~ ${today?.date || '-'}）`)
  console.log(`   今日(${today?.date}): ${today?.count ?? 0} 次`)
  console.log(`   近 7 天: ${last7.total} 次 · 日均 ${last7.days ? (last7.total / last7.days).toFixed(1) : 0}`)
  console.log(`   近 30 天: ${last30.total} 次 · 日均 ${last30.days ? (last30.total / last30.days).toFixed(1) : 0}`)
  console.log(`   峰值: ${peak.date}（${peak.count} 次）`)
  console.log('')
  console.log('日期        次数  图示')
  for (const x of daily.slice(-30)) {
    console.log(`${x.date}  ${String(x.count).padStart(4)}  ${'█'.repeat(Math.min(x.count, 40))}`)
  }

  // ===== B. 资源点（平台侧口径见 fetchCredits 顶部；只有「最近一期」+「数据截至」是可信的） =====
  let credits = null
  try { credits = await fetchCredits() } catch (e) { console.log('\n（资源点抓取失败: ' + (e.message || e) + '）') }
  if (credits) {
    const c = credits
    console.log(`\n【CloudBase 资源点 · 最近一期（平台侧已结算，非实时本周期）】`)
    console.log(`   套餐: ${c.packageName ?? '?'}（${c.packageId ?? '?'}）`)
    console.log(`   最近一期已用: ${c.used} 点` + (c.quota ? ` / 配额 ${c.quota} 点（每${c.quotaEvery}）= 占比 ${c.usagePct}%` : ' / 配额: 未取到'))
    console.log(`   按配额推算剩余: ${c.remaining ?? '?'} 点（配额按月重置，别写成「还能撑 N 天」）`)
    console.log(`   未扣减残差(ReportValue，⚠️不是余额): ${c.unwaived} 点 · 资源包扣减: ${c.packageDeduct} 点`)
    if (c.stale) {
      console.log(`   🔴 数据截至 ${c.dataThrough}（距今 ${c.staleDays} 天）——**平台侧资源点计量已停更**，上面数字是停更前最后结算的一期；`)
      console.log(`      不要再把它读成「本周期 0 点/未消耗」。要去控制台用量统计页看实时数（2026-10-09 实测：明细 10 月 0 天）。`)
    } else if (c.dataThrough) {
      console.log(`   数据截至 ${c.dataThrough}`)
    }
    if (c.byModule.length) {
      console.log(`   近 ${c.dailyWindowDays} 天消耗构成（按日明细归并）:`)
      for (const m of c.byModule) console.log(`     ${m.name}(${m.module}): ${m.deduct}`)
    }
    if (c.dailySeries.length) {
      console.log(`   近 ${c.dailyWindowDays} 天按日实扣: 合计 ${c.dailyTotal} 点 · 日均 ${c.avgDailyBurn.toFixed(1)} 点/天（窗口会滚，日均随旧日滚出而变小，≠用量下降）`)
      console.log('     ' + c.dailySeries.slice(-10).map((x) => `${x.date.slice(5)}=${x.deduct}`).join('  '))
    } else {
      console.log('   ⚠️ 按日明细为空——日均算不出来，别把这个 0 读成「没消耗」')
    }
    const reasons = warnReasons(c)
    console.log(reasons.length
      ? `   🔴 资源点告警：${reasons.join('；')}`
      : `   ✅ 资源点不告警（配额每${c.quotaEvery ?? '?'}重置，「还能撑几天」不是判据）`)
  }

  // ===== 存档 =====
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outDir = path.join(ROOT, 'backups', 'visit-stats')
  fs.mkdirSync(outDir, { recursive: true })
  const out = path.join(outDir, `visit-${ts}.json`)
  fs.writeFileSync(out, JSON.stringify({
    exportedAt: new Date().toISOString(), env: ENV_ID,
    creditsSchema: credits?.schema ?? null,
    total: visits.globalTotal, daily, credits,
  }, null, 2))
  console.log(`\n💾 已存档 → ${out}`)
}

// 直接执行才跑主流程；被 check-credits-reading.mjs 当模块导入时不动
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main().catch(e => { console.error('❌ 抓取失败:', e.message || e); process.exit(1) })
