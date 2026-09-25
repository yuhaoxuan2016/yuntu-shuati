// 资源点读数口径断言 —— 防止「剩余」再次被写成 ReportValue 残差
// 用法: node scripts/check-credits-reading.mjs      （只读，不改任何状态）
// 地面真值：2026-09-25 rabbit 控制台读数「套餐资源点 1481.62 点 / 4万点」
// 背景：旧版把 DescribeCreditsUsage.ReportValue（= Origin − Deduct 的未扣减残差）当成剩余，
//      于是周报常年喊「只剩 832.51 点、还能撑 3 天」。
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

console.log(`读数: used=${c.used} quota=${c.quota} remaining=${c.remaining} unwaived=${c.unwaived} 日均=${c.avgDailyBurn?.toFixed?.(1)} 使用率=${c.usagePct}%`)
console.log(`对照控制台（2026-09-25 快照）: 已用 1481.62 / 配额 40000 —— used 应与之同口径\n`)

// 尺子活着：这几项为 0/空说明没量到东西，不能折算成「没问题」
ck('配额取到了（不是 null/0）', typeof c.quota === 'number' && c.quota > 0, `quota=${c.quota}`)
ck('本周期已用量 > 0', c.used > 0, `used=${c.used}`)
ck('按日明细非空（日均不是凭空来的）', Array.isArray(c.dailySeries) && c.dailySeries.length > 0, `${c.dailySeries?.length} 天`)
ck('日均 > 0', c.avgDailyBurn > 0, `${c.avgDailyBurn?.toFixed?.(1)} 点/天`)

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

const bad = results.filter((x) => !x).length
console.log(`\n${bad === 0 ? '✅ 全部通过' : '❌ 有失败'} ${results.length - bad}/${results.length}`)
process.exit(bad === 0 ? 0 : 1)
