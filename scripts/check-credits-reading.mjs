// 资源点读数口径断言 —— 防止「剩余」再次被写成 ReportValue 残差；防「最近一期」被读成「实时本周期」
// 用法: node scripts/check-credits-reading.mjs      （只读，不改任何状态）
// 地面真值：2026-09-25 rabbit 控制台读数「套餐资源点 1481.62 点 / 4万点」（那是控制台口径的周期累计）
// 🔴 2026-10-09 状态：平台侧计量停更（明细止于 09-23、10 月 0 天），聚合接口只给「最近一期」⇒
//    断言必须允许 used 是旧期数，同时**强制** dataThrough/stale 字段存在、且 stale 时不产出使用率告警。
import { fetchCredits, warnReasons } from './fetch-visit-stats.mjs'

const QUOTA_PERSONAL = 40000
const results = []
const ck = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? '  → ' + detail : ''}`) }

let c
try {
  c = await fetchCredits()
} catch (e) {
  console.error('❌ fetchCredits 调用失败:', e.message || e)
  process.exit(1)
}

console.log(`读数: used=${c.used} quota=${c.quota} remaining=${c.remaining} unwaived=${c.unwaived} 日均=${c.avgDailyBurn?.toFixed?.(1)} 占比=${c.usagePct}% 数据截至=${c.dataThrough}（停更 ${c.staleDays} 天，stale=${c.stale}）`)
console.log(`对照：2026-09-25 控制台快照 1481.62 / 40000 是**当时**的周期累计；10-09 起平台侧停更，used 只会是停更前最后一期，别再期望它等于任何实时值\n`)

// 尺子活着：这几项为 0/空说明没量到东西，不能折算成「没问题」
ck('配额取到了（不是 null/0）', typeof c.quota === 'number' && c.quota > 0, `quota=${c.quota}`)
ck('最近一期已用量 > 0（≠ 实时本周期）', c.used > 0, `used=${c.used}`)
ck('按日明细非空（日均不是凭空来的）', Array.isArray(c.dailySeries) && c.dailySeries.length > 0, `${c.dailySeries?.length} 天`)
ck('日均 > 0', c.avgDailyBurn > 0, `${c.avgDailyBurn?.toFixed?.(1)} 点/天`)

// 🔴 2026-10-09 新增：停更必须被显式暴露，否则「最近一期」会被读成「本周期」
ck('schema = 3（读数语义改版过）', c.schema === 3, `schema=${c.schema}`)
ck('dataThrough 是日期（平台侧覆盖上限）', /^\d{4}-\d{2}-\d{2}$/.test(String(c.dataThrough)), `dataThrough=${c.dataThrough}`)
ck('stale 与 staleDays 自洽', c.stale === (c.staleDays != null && c.staleDays >= 2), `stale=${c.stale} days=${c.staleDays}`)
ck('聚合窗口锚在 dataThrough（停更期间读数才稳定）', c.usageAnchor === (c.dataThrough || new Date().toISOString().slice(0, 10)), `anchor=${c.usageAnchor} window=${c.usageWindowStart}~${c.usageAnchor}`)
ck('停更时按日明细里没有「今天/昨天」（否则 stale 判定有误）',
  !c.dailySeries.some((x) => x.date >= new Date(Date.now() - 86400000).toISOString().slice(0, 10)) || !c.stale,
  `最新明细日=${c.dataThrough}`)

// 口径正确性（回归守卫）
ck('配额 = 个人版 4 万点', c.quota === QUOTA_PERSONAL, `期望 ${QUOTA_PERSONAL}，实得 ${c.quota}`)
ck('剩余 = 配额 − 已用（不是 ReportValue）',
  Math.abs(c.remaining - (c.quota - c.used)) < 0.01,
  `remaining=${c.remaining} vs quota-used=${(c.quota - c.used).toFixed(2)}`)
ck('剩余 ≠ 未扣减残差（旧 bug 的直接反证）',
  Math.abs(c.remaining - c.unwaived) > 1,
  `remaining=${c.remaining} unwaived=${c.unwaived}`)
ck('使用率与 used/quota 自洽',
  Math.abs(c.usagePct - (c.used / c.quota * 100)) < 0.01,
  `usagePct=${c.usagePct}`)
const sum = c.dailySeries.reduce((s, x) => s + x.deduct, 0)
ck('日均与按日明细自洽',
  Math.abs(c.avgDailyBurn * c.dailyWindowDays - sum) < 1,
  `日均×${c.dailyWindowDays}=${(c.avgDailyBurn * c.dailyWindowDays).toFixed(1)} 合计=${sum.toFixed(1)}`)

// 告警判定用合成输入测（不依赖当前用量——否则以后真用超了会被当成脚本坏了）
const synth = (used, burn) => ({ quota: QUOTA_PERSONAL, used, usagePct: Number((used / QUOTA_PERSONAL * 100).toFixed(2)), avgDailyBurn: burn })
ck('告警·正常态不响', warnReasons(synth(1481.62, 81.4)).length === 0)
ck('告警·使用率 97.5% 要响', warnReasons(synth(39000, 81.4)).length === 1, warnReasons(synth(39000, 81.4)).join('；'))
ck('告警·烧速超月度预算 2 倍要响', warnReasons(synth(1481.62, 5000)).length === 1, warnReasons(synth(1481.62, 5000)).join('；'))
ck('告警·平台侧停更时不响（拿旧数喊「用得快」比不喊更坏）',
  warnReasons({ ...synth(39000, 5000), stale: true }).length === 0,
  warnReasons({ ...synth(39000, 5000), stale: true }).join('；'))

const bad = results.filter((x) => !x).length
console.log(`\n${bad === 0 ? '✅ 全部通过' : '❌ 有失败'} ${results.length - bad}/${results.length}`)
process.exit(bad === 0 ? 0 : 1)
