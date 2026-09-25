// dbBackup 云函数：全库定时备份（T18-2h 服务器利用计划，2026-09-16 用户拍板「装」）
//
// 背景：云数据库里已有真实用户数据（做题记录/错题/收藏/题库）。平台自带备份保留期短，
// 没有「每天自动、长期保留、独立副本」的保险 ⇒ 本函数每日定时把全部集合导出到云存储
// `backups/{日期}/{集合}.json`，并在 `backup_meta` 里登记 fileID；超过 30 天的旧备份自动删除。
// 轻量服务器上的拉取脚本（每日）再从云存储下载最新一份，形成异地第二副本。
//
// 触发：定时触发器每日 03:00（由部署方创建）；也可手动 invoke。
// 集合清单：硬编码（node-sdk 枚举集合要用 manager SDK，云函数里没有）；新增集合时在此追加。
const cloudbase = require('@cloudbase/node-sdk')
const https = require('https')
const zlib = require('zlib')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()
const _ = db.command

// T18-2h（2026-09-16）：备份的**异地第二副本**——打包 POST 到轻量服务器。
// 令牌走环境变量 BACKUP_TOKEN（与服务器端接收器同一把，只写不放读）；服务器无任何云密钥。
const BACKUP_URL = process.env.BACKUP_URL || ''
const BACKUP_TOKEN = process.env.BACKUP_TOKEN || ''

function postCollection(host, path, token, day, coll, gz) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host, path, method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'gzip',
        'Content-Length': gz.length,
        'X-Backup-Token': token,
        'X-Backup-Day': day,
        'X-Backup-Coll': coll,
      },
      timeout: 60000,
    }, res => {
      let b = ''
      res.on('data', c => { b += c })
      res.on('end', () => resolve({ status: res.statusCode, body: b.slice(0, 200) }))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('推送超时')) })
    req.write(gz)
    req.end()
  })
}
// ⚠️ node-sdk 的上传/删除是 app 顶层方法（uploadFile/deleteFile），**没有** app.storage() ——
// 第一版在模块顶层调了 app.storage() ⇒ 模块加载即抛错、进程秒退（线上 145 报错）。

// 备份覆盖的集合（2026-09-16 全量清单；新增集合时在此追加）
const COLLECTIONS = [
  'practice_records',
  'wrong_questions',
  'favorites',
  'mastered_questions',
  'settings',
  'exam_results',
  'exams',
  'quiz_banks',
  'questions',
  'bind_codes',
  'admin_auth',
  'visit_stats',
]

const META_COLL = 'backup_meta'
const RETAIN_DAYS = 30
const PAGE = 1000

function firstDoc(res) {
  // ⚠️ node-sdk 的 get() 回执 data 是数组（客户端 SDK 是对象），见 admin-api 同款坑
  const d = res && res.data
  if (Array.isArray(d)) return d[0] || null
  return d || null
}

async function dumpCollection(name) {
  // 管理端 SDK 直查全量（无 where）：客户端「无条件查询返回空」的地雷只作用于受规则约束的客户端，
  // 云函数是管理端权限，不受此限（admin-server 的 pullAll 同款写法已在线上验证多年）。
  //
  // 2026-09-25 修复：原实现是 `skip(offset).limit(PAGE)` 的**无过滤深分页**——跳过的行数随页号线性增长
  //   （整轮接近二次），questions 涨到 5.4 万条后跑不完函数的 120s 超时，被**静默切断**：
  //   实盘 `backups/2026-09-25/` 只有 8/12 个集合、`backup_meta` 停在 09-24（登记写在主循环之后，
  //   连失败都没机会上报）。改成 `_id` 游标：`where({_id: gt(last)}) + orderBy('_id','asc')`，
  //   走主键索引，单页成本与深度无关。等价性实测（同一全集 54,018/54,018、双向零差异）见
  //   scripts/probe-slowquery-20260925.cjs。
  //   ⚠️ 备份文件里**行的顺序**由自然顺序变成 `_id` 升序：集合与条目一个不增一个不减，恢复按 _id。
  const all = []
  let lastId = null
  for (let page = 0; ; page++) {
    // 游标必须单调前进：万一 gt 没生效（返回同一页），这里要炸掉而不是转到内存耗尽
    if (page > 200) throw new Error(`${name} 分页超过 200 页，游标疑似未推进（lastId=${String(lastId)}）`)
    let q = db.collection(name)
    if (lastId !== null) q = q.where({ _id: _.gt(lastId) })
    const res = await q.orderBy('_id', 'asc').limit(PAGE).get()
    const rows = (res && res.data) || []
    if (!rows.length) break
    all.push(...rows)
    lastId = rows[rows.length - 1]._id
    if (rows.length < PAGE) break
  }
  return all
}

exports.main = async () => {
  const started = Date.now()
  // 2026-09-18 修复（重审 E-12）：原来用 `new Date().getFullYear()/getMonth()/getDate()`——那是**容器的
  //   本地时间**，而 SCF 容器跑在 UTC ⇒ 定时器 03:00 CST 触发时 UTC 还是前一天 19:00，
  //   于是每一天的备份都被登记到**前一天的目录名**，同一天内多次运行还会**就地互相覆盖**
  //   （实盘：`/var/backups/shuati/` 只剩 1 个目录、目录名比数据早一天，而面板写「今日备份已到」）。
  //   改成显式按 UTC+8 计算：中国全年无夏令时，固定偏移即可，且不依赖容器 TZ 配置。
  const date = new Date(started + 8 * 3600 * 1000)
  const pad = n => String(n).padStart(2, '0')
  const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`

  const summary = []
  const fileIDs = []
  const pushSummary = []   // T18-2h：逐集合推送的结果（改为**小包推送**，替代整包——整包在 256MB 下会 OOM）

  for (const coll of COLLECTIONS) {
    try {
      const rows = await dumpCollection(coll)
      const rowsJson = JSON.stringify(rows)
      const buf = Buffer.from(JSON.stringify({ collection: coll, date, count: rows.length, rows }), 'utf8')
      const cloudPath = `backups/${day}/${coll}.json`
      const up = await app.uploadFile({ cloudPath, fileContent: buf })
      fileIDs.push(up && up.fileID ? up.fileID : null)
      summary.push(`${coll}:${rows.length}`)
      // 异地第二副本：本集合压缩后**单包**推送（gz 后 questions 约 3MB，内存峰值可控）
      if (BACKUP_URL && BACKUP_TOKEN) {
        try {
          const gz = zlib.gzipSync(Buffer.from(rowsJson, 'utf8'))
          const u = new URL(BACKUP_URL)
          const pr = await postCollection(u.hostname, u.pathname, BACKUP_TOKEN, day, coll, gz)
          if (pr.status !== 200) throw new Error('HTTP ' + pr.status + ' ' + pr.body)
          pushSummary.push(`${coll}:OK`)
        } catch (e) {
          pushSummary.push(`${coll}:FAIL(${String(e && e.message).slice(0, 40)})`)
        }
      }
    } catch (e) {
      // 单集合失败不中断整体（比如集合不存在）
      console.error('[dbBackup] 备份集合失败', coll, e && e.errCode, e && e.message)
      summary.push(`${coll}:ERROR`)
    }
  }

  // 登记本轮 fileID，并删除超过保留期的旧备份
  let history = []
  try {
    const meta = await db.collection(META_COLL).doc('state').get()
    const m = firstDoc(meta)
    if (m && Array.isArray(m.history)) history = m.history
  } catch (e) { /* 无记录 ⇒ 从空开始 */ }
  history.push({ day, fileIDs: fileIDs.filter(Boolean), summary: summary.join(' '), at: started })

  // 删过期备份（按登记的 fileID）
  const cutoff = started - RETAIN_DAYS * 86400000
  const expired = history.filter(h => h.at < cutoff)
  for (const h of expired) {
    const ids = (h.fileIDs || []).filter(Boolean)
    if (ids.length) {
      try { await app.deleteFile({ fileList: ids }) } catch (e) { console.error('[dbBackup] 删除过期备份失败', e && e.message) }
    }
  }
  history = history.filter(h => h.at >= cutoff).slice(-40)

  // 写回 meta（upsert：先 update 0 行则 add）
  // ⚠️ update 的载荷里**不能带 _id**：线上实测会抛 INVALID_PARAM「不能更新_id的值」，
  // 一旦带上就会掉进 add 分支撞重复键 ⇒ history 永不增长、30 天保留期形同虚设（2026-09-17 实盘定位）。
  const metaDoc = { history, last_run: started, last_day: day }
  try {
    const upd = await db.collection(META_COLL).doc('state').update(metaDoc)
    const n = Number((upd && (upd.updated ?? (upd.stats && upd.stats.updated))) || 0)
    if (!n) throw new Error('update 0 行')
  } catch (e) {
    console.error('[dbBackup] update meta 失败，回退 add', e && e.code, e && e.message)
    try { await db.collection(META_COLL).add({ _id: 'state', ...metaDoc }) } catch (e2) {
      console.error('[dbBackup] 写 meta 失败', e2 && e2.code, e2 && e2.message)
    }
  }
  console.log('[dbBackup] meta 已登记 history', history.length, '轮，fileID', fileIDs.filter(Boolean).length, '个')

  const okCount = summary.filter(s => !s.endsWith('ERROR')).length
  console.log('[dbBackup] 完成', day, '集合', okCount + '/' + COLLECTIONS.length, '用时', Date.now() - started, 'ms')
  console.log('[dbBackup] 异地推送', pushSummary.join(' '))

  // 2026-09-18 修复（重审 E-09 / E-10）：**如实回报成败**。
  //   原实现无论多少集合失败、异地推送是否全灭，一律 `ok: true` ⇒ 调用方/巡检看到的永远是「成功」，
  //   「今天少备份了 5 个集合」这件事没有任何出口（实盘：单集合失败只留一个 `coll:ERROR` 字符串在 history 里）。
  //   现在：ok 只在「全部集合成功」时为真；同时把失败清单与推送失败数一并回给调用方。
  const failedColls = summary.filter(s => s.endsWith('ERROR')).map(s => s.split(':')[0])
  const pushFailed = pushSummary.filter(s => /FAIL|失败|ERROR/i.test(String(s))).length
  const ok = failedColls.length === 0
  if (!ok) console.error('[dbBackup] 本轮有集合备份失败：', failedColls.join(', '))
  if (pushFailed > 0) console.error('[dbBackup] 异地推送失败', pushFailed, '条：', pushSummary.join(' '))

  return {
    ok,
    day,
    collections: summary,
    failed: failedColls,
    push: pushSummary,
    pushFailed,
    retainedDays: RETAIN_DAYS,
  }
}
