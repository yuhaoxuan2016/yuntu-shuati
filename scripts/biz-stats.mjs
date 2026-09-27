#!/usr/bin/env node
// 业务侧数据（管理端口径）—— 从 CloudBase 读几个数与近 7 天增量
//
// 为什么读得起：实测按时间过滤很便宜（近 7 天练习记录 79 条 / 87ms，拉全量也才 88ms），
// 每天跑一次对配额无感（常态 DB 读约 465 次/天）。**但别做无过滤深分页**——那是 dbBackup 踩过的坑。
//
// ⚠️ `_openid` 是**身份/设备计数，不是"人"**：绑定一次就会换新 _openid（实测同一昵称挂过 3 个）
// ⇒ 这个数只能读作「至少有多少个身份在用」，不能当 DAU/人数。此结论写进输出，别在报告里被误读。
//
// 用法：node scripts/biz-stats.mjs        输出给人/模型读的文本块，并存档 backups/biz-stats/<日期>.json
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

export function isoDaysAgo(n, now = new Date()) { return new Date(now.getTime() - n * 86400000).toISOString().slice(0, 10) }

export function format(s) {
  const L = []
  L.push('【业务侧数据 · 管理端口径（云端全量，不是本机缓存）】')
  L.push(`题库：${s.banks.total} 个（近 7 天新建 ${s.banks.new7}${s.banks.public == null ? '' : `，其中公开 ${s.banks.public}`}）`)
  L.push(`题目：${s.questions.toLocaleString('zh-CN')} 条`)
  L.push(`练习记录：${s.practice.total.toLocaleString('zh-CN')} 条（近 7 天 ${s.practice.d7} / 近 1 天 ${s.practice.d1}）｜近 7 天去重 _openid ${s.practice.users7} 个`)
  L.push(`考试提交：${s.exams.total} 份（近 7 天 ${s.exams.d7}）｜近 7 天去重 _openid ${s.exams.users7} 个`)
  L.push(`复习记录：${s.reviews} 条`)
  L.push('⚠️ 上面 `_openid` 是**身份计数不是人数**：绑定一次就换新 _openid（实测同一昵称挂过 3 个）⇒ 只能读作「至少多少个身份在用」，别当 DAU。')
  return L.join('\n')
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
  return {
    at: now.toISOString(),
    banks: {
      total: await cnt('quiz_banks'),
      new7: await cnt('quiz_banks', { created_at: _.gte(cut7) }),
      public: await cnt('quiz_banks', { visibility: 'public' }).catch(() => null),
    },
    questions: await cnt('questions'),
    practice: {
      total: await cnt('practice_records'),
      d7: await cnt('practice_records', { practiced_at: _.gte(cut7) }),
      d1: await cnt('practice_records', { practiced_at: _.gte(cut1) }),
      users7: await distinctUsers('practice_records', 'practiced_at', cut7),
    },
    exams: {
      total: await cnt('exam_results'),
      d7: await cnt('exam_results', { submitted_at: _.gte(cut7) }),
      users7: await distinctUsers('exam_results', 'submitted_at', cut7),
    },
    reviews: await cnt('review_records'),
  }
}

function selftest() {
  const ck = []
  const t = (n, ok, got) => { ck.push(ok); console.log(`${ok ? '✅' : '❌'} ${n}${ok ? '' : '  → ' + JSON.stringify(got)}`) }
  t('isoDaysAgo(7) 从固定 now 算得对', isoDaysAgo(7, new Date('2026-09-27T09:00:00Z')) === '2026-09-20', isoDaysAgo(7, new Date('2026-09-27T09:00:00Z')))
  const out = format({
    banks: { total: 61, new7: 9, public: 12 }, questions: 57317,
    practice: { total: 10964, d7: 79, d1: 3, users7: 1 }, exams: { total: 98, d7: 0, users7: 0 }, reviews: 8,
  })
  t('题库行含总数与近 7 天新建', out.includes('61 个') && out.includes('近 7 天新建 9'), '')
  t('万位数字带千分位', out.includes('57,317'), '')
  t('练习行含三档数字', out.includes('10,964') && out.includes('近 7 天 79 / 近 1 天 3'), '')
  t('🔴 明确写了 _openid 不是人数（防报告误读）', out.includes('身份计数不是人数') && out.includes('别当 DAU'), '')
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
    console.log(format(s))
    const dir = path.join(ROOT, 'backups', 'biz-stats')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify(s, null, 1))
  }
}
