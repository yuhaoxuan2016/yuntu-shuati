#!/usr/bin/env node
// 业务侧数据（管理端口径）—— 从 CloudBase 读几个数、近 7 天增量，并与上一份存档比突变
//
// 为什么读得起：实测按时间过滤很便宜（近 7 天窗口 87ms，拉全量 88ms），每天跑对配额无感
// （常态 DB 读约 465 次/天）。**但别做无过滤深分页**——那是 dbBackup 踩过的坑。
//
// ⚠️ `_openid` 是**身份/设备计数，不是"人"**：绑定一次就会换新 _openid（实测同一昵称挂过 3 个）
// ⇒ 只能读作「至少有多少个身份在用」，不能当 DAU/人数。此结论写进输出，别在报告里被误读。
//
// 字段口径（2026-10-03 从每日备份实测，别再猜）：
//   practice_records  时间字段 = `date`（YYYY-MM-DD），且**一行是「身份×天」的汇总**（correct/total 是该天做题数），
//                     **不是逐题一行**；表里没有 practiced_at——早先用 practiced_at 筛，条件恒假 ⇒ 近 7 天恒 0。
//   wrong_questions   **两形态并存**：网页版用 updatedAt/wrongCount/rightStreak/bank，小程序用 updated_at/total_wrong/correct_streak/bank_id。
//                     ⇒ 窗口筛选必须 _.or 两个字段名，且分开报形态数，否则读数会被当成真实业务量。
//   exam_results `submitted_at` ｜ quiz_banks `created_at`（这两个筛法实测有效）
//
// 用法：node scripts/biz-stats.mjs              输出文本块，并存档 backups/biz-stats/<日期>.json
//       node scripts/biz-stats.mjs --selftest   只跑纯函数断言，不连云
import { SECRET_ID, SECRET_KEY, get } from './_creds.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const ENV_ID = process.env.CLOUD_ENV_ID || get('CLOUD_ENV_ID') || ''
if (!ENV_ID && !process.argv.includes('--selftest')) {
  console.error('缺少 CLOUD_ENV_ID —— 在 scripts/.creds.env 加一行，或用环境变量传入')
  process.exit(2)
}

// 累计量突变判据：|Δ|/prev ≥ 0.1 且 prev ≥ 50（小基数不报，免得 3→1 天天告警）
export const JUMP_RATIO = 0.1
export const JUMP_MIN_BASE = 50
// 一行＝「身份×天」。单行超过这个题数 ⇒ 不像真做过的一天，按历史摊行处理（2026-10-03 实测有单行 1,641）
export const SINGLE_DAY_SUSPECT = 500

export function isoDaysAgo(n, now = new Date()) { return new Date(now.getTime() - n * 86400000).toISOString().slice(0, 10) }

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

/** 累计量与上一份存档对比，返回给人看的突变行（无基线时返回空数组，不编造） */
export function jumpLines(prev, cur) {
  if (!prev) return []
  const watch = [
    ['题库', prev.banks?.total, cur.banks?.total],
    ['题目', prev.questions, cur.questions],
    ['练习汇总行数', prev.practice?.total, cur.practice?.total],
    ['考试提交', prev.exams?.total, cur.exams?.total],
    ['错题本', prev.wrong?.total, cur.wrong?.total],
    ['收藏', prev.favorites, cur.favorites],
    ['复习记录', prev.reviews, cur.reviews],
  ]
  const out = []
  for (const [name, a, b] of watch) {
    if (typeof a !== 'number' || typeof b !== 'number' || a < JUMP_MIN_BASE) continue
    const d = b - a
    if (Math.abs(d) / a < JUMP_RATIO) continue
    const pct = (Math.abs(d) / a * 100).toFixed(0)
    out.push(`⚠️ 突变｜${name}：${a.toLocaleString('zh-CN')} → ${b.toLocaleString('zh-CN')}（${d < 0 ? '−' : '+'}${pct}%）——要么真有人批量增删，要么统计口径变了，先查再播报`)
  }
  return out
}

export function format(s) {
  const L = []
  L.push('【业务侧数据 · 管理端口径（云端全量，不是本机缓存）】')
  if (s.jumps?.length) L.push(...s.jumps)
  L.push(`题库：${s.banks.total} 个（近 7 天新建 ${s.banks.new7}${s.banks.public == null ? '' : `，其中公开 ${s.banks.public}`}）`)
  L.push(`题目：${s.questions.toLocaleString('zh-CN')} 条`)
  const p = s.practice
  L.push(`练习：库里 ${p.total} 行＝「身份×天」的汇总行（不是逐题）｜近 1 天做题 ${p.d1.ans.toLocaleString('zh-CN')} 题（对 ${p.d1.cor.toLocaleString('zh-CN')}）｜近 7 天做题 ${p.d7.ans.toLocaleString('zh-CN')} 题（对 ${p.d7.cor.toLocaleString('zh-CN')}）｜近 7 天涉及 ${p.d7.users ?? '?'} 个身份`)
  const web = (p.byid || []).filter((x) => x.isWeb).reduce((t, x) => t + x.ans, 0)
  const suspect = (p.byid || []).filter((x) => x.maxRow > SINGLE_DAY_SUSPECT)
  for (const x of p.byid || []) {
    L.push(`   · ${x.tail}${x.device === '无' ? '' : `（${x.device}）`}：${x.ans.toLocaleString('zh-CN')} 题｜${x.rows} 行｜单行最大 ${x.maxRow.toLocaleString('zh-CN')}｜所属日 ${x.span}｜写入批次 ${x.batchLabel}`)
  }
  for (const x of suspect) {
    L.push(`   ⚠️ ${x.tail} 有单行 ${x.maxRow.toLocaleString('zh-CN')} 题——一行＝一天，这个量级不像真做过，多半是历史汇总被摊成行；它的量**不许计入「近期活动」**。`)
  }
  if (suspect.length) L.push(`   ⇒ 讲趋势请用网页版（dev_web）那行的数：近 7 天 ${web.toLocaleString('zh-CN')} 题。`)
  L.push(`错题本：${s.wrong.total.toLocaleString('zh-CN')} 条（近 7 天更新 ${s.wrong.d7}）｜形态：网页版字段 ${s.wrong.web} ＋ 小程序字段 ${s.wrong.mp}——两形态时间字段不同名，窗口数已按两字段并集统计`)
  L.push(`收藏：${s.favorites.toLocaleString('zh-CN')} 条`)
  L.push(`考试提交：${s.exams.total} 份（近 7 天 ${s.exams.d7}）｜近 7 天涉及 ${s.exams.users7 ?? '?'} 个身份`)
  L.push(`复习记录：${s.reviews.toLocaleString('zh-CN')} 条`)
  L.push('⚠️ 上面「身份」是 `_openid` 计数不是人数：绑定一次就换新 _openid（实测同一昵称挂过 3 个）⇒ 只能读作「至少多少个身份在用」，别当 DAU。')
  L.push('⚠️ 练习侧的「近 1/7 天做题数」是把汇总行的 total/correct 求和得到的，与「行数」不是一个量纲；`date` 字段缺失的行不计入。')
  return L.join('\n')
}

const sumRows = (rows) => ({ ans: rows.reduce((t, d) => t + num(d.total), 0), cor: rows.reduce((t, d) => t + num(d.correct), 0) })

/** 毫秒时间戳 → 北京时间「MM-DD HH:mm」；无值返回「无」 */
export function bjMinute(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return '无'
  const ms = n > 1e11 ? n : n * 1000
  const d = new Date(ms + 8 * 3600000)
  return `${d.toISOString().slice(5, 10)} ${d.toISOString().slice(11, 16)}`
}

/**
 * 按身份拆练习汇总行。
 * 为什么要拆：`date` 讲的是「练习所属日」，`synced_at` 讲的是「这行什么时候进云端」——
 * 一次同步可以把跨十几天的历史一次性补传，此时窗口内的求和**含过去的量**，读成近期活跃度就是错的（2026-10-03 实测：
 * 一个身份单行 1,641 题、三行同在一分钟内写入 ⇒ 3,129 里有 2,714 是补传的历史）。
 * 这里只客观列「行数 / 所属日跨度 / 写入批次」，判定交给人。
 */
export function practiceBreakdown(rows) {
  const g = new Map()
  for (const d of rows || []) {
    const key = d._openid ? String(d._openid) : '无身份'
    if (!g.has(key)) g.set(key, { ans: 0, cor: 0, maxRow: 0, dates: [], devices: [], batch: new Map() })
    const e = g.get(key)
    e.ans += num(d.total); e.cor += num(d.correct)
    if (num(d.total) > (e.maxRow || 0)) e.maxRow = num(d.total)
    if (d.date) e.dates.push(String(d.date))
    if (d.device_id) e.devices.push(String(d.device_id))
    const b = bjMinute(d.synced_at)
    if (b !== '无') e.batch.set(b, (e.batch.get(b) || 0) + 1)
  }
  return [...g.entries()].map(([id, e]) => {
    const ds = e.dates.slice().sort()
    const batches = [...e.batch.entries()].sort((a, b) => b[1] - a[1])
    const top = batches[0]
    return {
      tail: id === '无身份' ? '无身份' : `…${id.slice(-6)}`,
      device: [...new Set(e.devices)].join('+') || '无',
      rows: e.dates.length, ans: e.ans, cor: e.cor, maxRow: e.maxRow,
      span: ds.length ? (ds[0] === ds[ds.length - 1] ? ds[0] : `${ds[0].slice(5)}→${ds[ds.length - 1].slice(5)}`) : '无',
      batchLabel: top ? `${top[0]} × ${top[1]} 行` : '无',
      batched: !!(top && top[1] >= 2),
      isWeb: e.devices.includes('dev_web'),
    }
  }).sort((a, b) => b.ans - a.ans)
}

async function collect(db) {
  const _ = db.command
  const now = new Date()
  const cut7 = isoDaysAgo(7, now)
  const cut1 = isoDaysAgo(1, now)
  const cnt = (c, w) => (w ? db.collection(c).where(w).count() : db.collection(c).count()).then((r) => r.total)
  const distinctUsers = (c, field, cut) => db.collection(c).aggregate()
    .match({ [field]: _.gte(cut) }).group({ _id: '$_openid' }).end()
    .then((r) => (r.data || []).length).catch(() => null)
  // practice_records 一行＝身份×天，按 date 筛窗口再把 total/correct 求和
  const practiceRows = (cut) => db.collection('practice_records').where({ date: _.gte(cut) })
    .limit(500).get().then((r) => r.data || []).catch(() => [])

  const [pr7, pr1] = [await practiceRows(cut7), await practiceRows(cut1)]
  return {
    at: now.toISOString(),
    window: { d7: cut7, d1: cut1 },
    banks: {
      total: await cnt('quiz_banks'),
      new7: await cnt('quiz_banks', { created_at: _.gte(cut7) }),
      public: await cnt('quiz_banks', { visibility: 'public' }).catch(() => null),
    },
    questions: await cnt('questions'),
    practice: {
      total: await cnt('practice_records'),
      d7: { ...sumRows(pr7), users: new Set(pr7.map((d) => d._openid)).size },
      d1: sumRows(pr1),
      rows7: pr7.length,
      byid: practiceBreakdown(pr7),
    },
    wrong: {
      total: await cnt('wrong_questions'),
      d7: await cnt('wrong_questions', _.or([{ updated_at: _.gte(cut7) }, { updatedAt: _.gte(cut7) }])).catch(() => null),
      web: await cnt('wrong_questions', { updatedAt: _.exists(true) }).catch(() => null),
      mp: await cnt('wrong_questions', { updated_at: _.exists(true) }).catch(() => null),
    },
    favorites: await cnt('favorites').catch(() => null),
    exams: {
      total: await cnt('exam_results'),
      d7: await cnt('exam_results', { submitted_at: _.gte(cut7) }),
      users7: await distinctUsers('exam_results', 'submitted_at', cut7),
    },
    reviews: await cnt('review_records').catch(() => null),
  }
}

/** 取上一份存档（同目录里按文件名排序、不是今天那份）；没有就返回 null，不猜基线 */
export function loadPrev(dir, today) {
  let names = []
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json') && !n.startsWith(today)) } catch { return null }
  names.sort()
  const last = names[names.length - 1]
  if (!last) return null
  try { return JSON.parse(fs.readFileSync(path.join(dir, last), 'utf8')) } catch { return null }
}

function selftest() {
  const ck = []
  const t = (n, ok, got) => { ck.push(ok); console.log(`${ok ? '✅' : '❌'} ${n}${ok ? '' : '  → ' + JSON.stringify(got)}`) }
  t('isoDaysAgo(7) 从固定 now 算得对', isoDaysAgo(7, new Date('2026-09-27T09:00:00Z')) === '2026-09-20', isoDaysAgo(7, new Date('2026-09-27T09:00:00Z')))
  // 求和用的是字符串字段——库里 total/correct 存的是字符串，漏了 Number 就是 0
  t('汇总行求和吃字符串字段', JSON.stringify(sumRows([{ total: '378', correct: '348' }, { total: '9', correct: '4' }])) === JSON.stringify({ ans: 387, cor: 352 }), sumRows([{ total: '378', correct: '348' }, { total: '9', correct: '4' }]))
  t('缺 total/correct 的行按 0 算不抛错', sumRows([{ x: 1 }]).ans === 0, sumRows([{ x: 1 }]))
  const state = {
    banks: { total: 41, new7: 0, public: 16 }, questions: 32567,
    practice: { total: 10, d7: { ans: 3009, cor: 2711, users: 2 }, d1: { ans: 378, cor: 348 }, rows7: 4 },
    wrong: { total: 426, d7: 101, web: 237, mp: 189 }, favorites: 3,
    exams: { total: 98, d7: 0, users7: 0 }, reviews: 1579,
  }
  const out = format(state)
  t('题库行含总数与近 7 天新建', out.includes('41 个') && out.includes('近 7 天新建 0'), '')
  t('万位数字带千分位', out.includes('32,567') && out.includes('1,579'), '')
  t('练习行说清「行≠题」', out.includes('10 行＝「身份×天」') && out.includes('近 1 天做题 378 题（对 348）'), '')
  // 按身份拆：毫秒 → 北京时间；同批多行必须被标出来
  t('bjMinute 毫秒换北京时间', bjMinute('1790732256140') === '09-30 09:37', bjMinute('1790732256140'))
  t('bjMinute 无值不抛错', bjMinute(undefined) === '无' && bjMinute('abc') === '无', bjMinute('abc'))
  const br = practiceBreakdown([
    { _openid: 'a_7MEjtk', device_id: 'dev_web', date: '2026-10-02', total: '400', correct: '370', synced_at: '1790950293776' },
    { _openid: 'a_7MEjtk', device_id: 'dev_web', date: '2026-09-27', total: '9', correct: '4', synced_at: '1790950293770' },
    { _openid: 'b_i8VBUU', device_id: 'dev_562b', date: '2026-09-27', total: '100', correct: '92', synced_at: '1790732256138' },
    { _openid: 'b_i8VBUU', device_id: 'dev_562b', date: '2026-09-28', total: '1641', correct: '1487', synced_at: '1790732256139' },
  ])
  t('按身份拆成两组、按量降序', br.length === 2 && br[0].tail === '…i8VBUU' && br[0].ans === 1741, br)
  t('网页版身份被认出来', br[1].isWeb === true && br[1].device === 'dev_web', br[1])
  t('一次补传多天被打上 batched', br[0].batched === true && br[0].rows === 2 && br[0].span === '09-27→09-28', br[0])
  t('单行最大值算得出', br[0].maxRow === 1641 && br[1].maxRow === 400, br.map((x) => x.maxRow))
  const out2 = format({ ...state, practice: { ...state.practice, byid: br } })
  t('单行超嫌疑线被点名', out2.includes('有单行 1,641 题') && out2.includes('不许计入「近期活动」'), out2.split('\n').filter((l) => l.includes('单行 1,641')).join('|'))
  t('嫌疑行指回网页版的数', out2.includes('网页版（dev_web）那行的数：近 7 天 409 题'), out2.split('\n').filter((l) => l.includes('讲趋势')).length)
  t('拆分行带单行最大与写入批次', out2.includes('单行最大 1,641') && out2.includes('写入批次 09-30 09:37 × 2 行'), '')
  t('网页版 400 不被误判为嫌疑行', !out2.includes('有单行 400 题'), out2.split('\n').filter((l) => l.includes('不许计入')).length)
  const out3 = format({ ...state, practice: { ...state.practice, byid: br.map((x) => ({ ...x, maxRow: 120 })) } })
  t('没嫌疑行时不打 ⚠️ 也不指路', !out3.includes('不许计入') && !out3.includes('讲趋势请用'), '')
  t('错题行带形态拆解', out.includes('网页版字段 237') && out.includes('小程序字段 189'), '')
  t('🔴 明确写了 _openid 不是人数（防报告误读）', out.includes('`_openid` 计数不是人数') && out.includes('别当 DAU'), '')
  t('无突变时不多打一行', !out.includes('⚠️ 突变'), out.split('\n').filter((l) => l.includes('突变')).length)
  // 突变判据
  const prev = { banks: { total: 41 }, questions: 32567, practice: { total: 10964 }, exams: { total: 98 }, wrong: { total: 426 }, favorites: 3, reviews: 1579 }
  const j = jumpLines(prev, state)
  t('练习 10,964→10 被判突变', j.length === 1 && j[0].includes('10,964 → 10') && j[0].includes('−100%'), j)
  t('小基数（收藏 3→4）不报', jumpLines({ favorites: 3 }, { favorites: 4, banks: { total: 41 }, questions: 32567 }).length === 0, jumpLines({ favorites: 3 }, { favorites: 4 }))
  t('无上一份存档时返回空（不编基线）', jumpLines(null, state).length === 0, '')
  t('涨幅同样报', jumpLines({ reviews: 1000 }, { reviews: 1579 }).some((x) => x.includes('+58%')), jumpLines({ reviews: 1000 }, { reviews: 1579 }))
  // 存档读取：取最近的非今天
  const dir = path.join(ROOT, 'backups', 'biz-stats-selftest')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, '2026-10-02.json'), JSON.stringify({ reviews: 1 }))
  fs.writeFileSync(path.join(dir, '2026-10-03.json'), JSON.stringify({ reviews: 999 }))
  t('loadPrev 跳过今天那份', loadPrev(dir, '2026-10-03')?.reviews === 1, loadPrev(dir, '2026-10-03'))
  fs.rmSync(dir, { recursive: true, force: true })
  t('目录不存在时不抛错', loadPrev(path.join(ROOT, 'no-such-dir'), '2026-10-03') === null, '')
  const bad = ck.filter((x) => !x).length
  console.log(`\n${bad === 0 ? '✅ 全部通过' : '❌ 有失败'} ${ck.length - bad}/${ck.length}`)
  process.exit(bad === 0 ? 0 : 1)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  if (process.argv.includes('--selftest')) { selftest() }
  else {
    const { default: cloudbase } = await import('@cloudbase/node-sdk')
    const db = cloudbase.init({ env: ENV_ID, secretId: SECRET_ID, secretKey: SECRET_KEY }).database()
    const s = await collect(db)
    const dir = path.join(ROOT, 'backups', 'biz-stats')
    const today = new Date().toISOString().slice(0, 10)
    s.jumps = jumpLines(loadPrev(dir, today), s)
    console.log(format(s))
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${today}.json`), JSON.stringify(s, null, 1))
  }
}
