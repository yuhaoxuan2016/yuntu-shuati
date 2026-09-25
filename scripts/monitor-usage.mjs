// 资源用量异常监控：与上次快照对比，超阈值时高亮告警
// 用法: node scripts/monitor-usage.mjs
// 存档: backups/usage-monitor/usage-<日期>.json（每日一份，用于环比）
//
// 阈值来自 2026-09-10 的实测基线：正常开发期数据库写请求约 15 万次/计费周期，
// 其中绝大部分由本地同步测试与批量导入产生；正式使用后日增应远低于此。
import { SECRET_ID, SECRET_KEY, get } from './_creds.mjs'
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

// 单日增量阈值：超过即视为异常（正常个人使用远低于这些数字）
const DAILY_LIMITS = {
  dbWrite: 5000,     // 数据库写请求/天
  dbRead: 20000,     // 数据库读请求/天
  apiCall: 10000,    // API 安全调用/天
  credits: 300,      // 资源点消耗/天
}

const MODULES = ['FLEXDB', 'SCF', 'COS', 'HOSTING', 'Auth', 'APIInvocation', 'HTTPInvocation', 'Other']

function client() {
  const tcb = tcbSdk.tcb.v20180608
  return new tcb.Client({ credential: { secretId: SECRET_ID, secretKey: SECRET_KEY }, region: 'ap-shanghai' })
}

// 从用量明细里挑出关心的几个指标
function pickMetrics(usages) {
  const out = { dbWrite: 0, dbRead: 0, dbCapacityMB: 0, apiCall: 0, fnInvoke: 0, credits: 0 }
  for (const mod of usages || []) {
    out.credits += Number(mod.DeductValue || 0)
    for (const m of mod.MetricUsageDetail || []) {
      const v = Number(m.Value || 0)
      if (mod.Module === 'FLEXDB' && m.MetricName === 'WriteRequests') out.dbWrite += v
      if (mod.Module === 'FLEXDB' && m.MetricName === 'ReadRequests') out.dbRead += v
      if (mod.Module === 'FLEXDB' && m.MetricName === 'Capacity') out.dbCapacityMB = Math.max(out.dbCapacityMB, v)
      if (mod.Module === 'APIInvocation' && m.MetricName === 'CloudDevelopmentSecureCallsInvocation') out.apiCall += v
      if (mod.Module === 'SCF' && m.MetricName === 'Invocation') out.fnInvoke += v
    }
  }
  return out
}

function loadPrevSnapshot(dir) {
  if (!fs.existsSync(dir)) return null
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()
  if (!files.length) return null
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]), 'utf8'))
  } catch {
    return null
  }
}

function fmt(n) {
  return Number(n).toLocaleString('zh-CN')
}

async function main() {
  const c = client()
  // 查询当前计费周期：起始取 30 天前，结束取今天（API 会按账户周期归并）
  const fmtDate = (dt) => dt.toISOString().slice(0, 10)
  const today = new Date()
  const detail = await c.DescribeCreditsUsageDetail({
    EnvId: ENV_ID,
    StartDate: fmtDate(new Date(today.getTime() - 30 * 86400000)),
    EndDate: fmtDate(today),
    Modules: MODULES,
    NeedUsageDetails: false,
  })
  const cur = pickMetrics(detail.Usages)
  const cycleStart = detail.AccountCircle?.StartTime?.slice(0, 10) || '?'
  const cycleEnd = detail.AccountCircle?.EndTime?.slice(0, 10) || '?'

  const outDir = path.join(ROOT, 'backups', 'usage-monitor')
  const prev = loadPrevSnapshot(outDir)

  console.log(`资源用量监控 · ${new Date().toLocaleString('zh-CN')}`)
  console.log(`统计窗口: 近 30 天（绝对值会因窗口滚掉旧日子而下降——那是窗口在动，不是用量减少）`)
  // AccountCircle 实测为 null（2026-09-25），取不到就直说，别打「? ~ ?」冒充有值
  console.log(`计费周期: ${detail.AccountCircle?.StartTime ? `${cycleStart} ~ ${cycleEnd}` : 'API 未返回（AccountCircle=null）'}`)
  console.log(`对比基线: ${prev?.at ? `上次快照 @ ${prev.at}` : '（无历史快照，本次只建基线）'}`)
  console.log('')
  console.log('指标              窗口内累计       较上次快照')

  const rows = [
    ['数据库写请求', 'dbWrite', ''],
    ['数据库读请求', 'dbRead', ''],
    ['API 安全调用', 'apiCall', ''],
    ['云函数调用', 'fnInvoke', ''],
    ['数据库容量', 'dbCapacityMB', 'MB'],
    ['资源点已扣', 'credits', ''],
  ]

  const alerts = []
  const hoursSince = prev?.at ? (Date.now() - new Date(prev.at).getTime()) / 3600000 : null

  for (const [label, key, unit] of rows) {
    const now = cur[key]
    let deltaText = '（首次记录）'
    if (prev?.metrics && typeof prev.metrics[key] === 'number') {
      const d = now - prev.metrics[key]
      deltaText = d === 0 ? '无变化' : (d > 0 ? `+${fmt(d)}` : `↓${fmt(-d)}（窗口滚掉旧日子，非用量下降）`)
      // 折算为日增速判断异常
      if (hoursSince && hoursSince >= 1 && DAILY_LIMITS[key]) {
        const perDay = d / (hoursSince / 24)
        if (perDay > DAILY_LIMITS[key]) {
          alerts.push(`${label}：折算日增 ${fmt(Math.round(perDay))}${unit}，超过阈值 ${fmt(DAILY_LIMITS[key])}`)
        }
      }
    }
    const pad = label + '  '.repeat(Math.max(0, 8 - label.length))
    console.log(pad + String(fmt(now) + unit).padStart(12) + '   ' + deltaText)
  }

  console.log('')
  if (alerts.length) {
    console.log('⚠️ 检测到异常增长：')
    for (const a of alerts) console.log(`   ${a}`)
    console.log('')
    console.log('   排查建议：')
    console.log('   1. 控制台 → 云开发 → 用量统计，看是哪个集合/函数被大量调用')
    console.log('   2. 若确认是恶意刷量，可临时收紧对应集合的安全规则')
    console.log('   3. 检查是否有本地脚本在循环写入（历史上大量写请求多由同步测试产生）')
  } else if (prev) {
    console.log('✅ 未发现异常增长')
  } else {
    console.log('已建立基线快照，下次运行即可对比增量')
  }

  // 存档（每日一份，同日覆盖）
  fs.mkdirSync(outDir, { recursive: true })
  const day = new Date().toISOString().slice(0, 10)
  fs.writeFileSync(
    path.join(outDir, `usage-${day}.json`),
    JSON.stringify({ at: new Date().toISOString(), env: ENV_ID, cycle: { start: cycleStart, end: cycleEnd }, metrics: cur }, null, 2),
  )

  if (alerts.length) process.exitCode = 2
}

main().catch(e => {
  console.error('监控失败:', e.message || e)
  process.exit(1)
})
