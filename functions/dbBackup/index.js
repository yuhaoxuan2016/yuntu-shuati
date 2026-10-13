// dbBackup 云函数：全库定时备份（服务器利用计划，2026-09-16）
//
// 背景：云数据库里已有真实用户数据（做题记录/错题/收藏/题库）。平台自带备份保留期短，
// 没有「定时自动、长期保留、独立副本」的保险 ⇒ 本函数定时把全部集合导出到云存储
// `backups/{日期}/{集合}.json`，并在 `backup_meta` 里登记 fileID；超过保留期的旧备份自动删除。
// 异地第二副本：由配套拉取脚本再从云存储下载最新一份，形成独立副本。
//
// 触发：定时触发器（由部署方创建）；也可手动 invoke。
// 集合清单：硬编码（node-sdk 枚举集合要用 manager SDK，云函数里没有）；新增集合时在此追加。
const cloudbase = require('@cloudbase/node-sdk')
const https = require('https')
const { buildBackups } = require('./stream.js')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()
const _ = db.command

// （2026-09-16）：备份的**异地第二副本**——打包 POST 到配套服务器。
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
// 误用会在模块加载阶段即抛错、进程秒退（排查时先看这一条）。

// 备份覆盖的集合（2026-09-16 全量清单；新增集合时在此追加）
// 2026-10-03 补：加 `review_records`（此前无任何备份）。
//   `sync_ledger` 实测**集合不存在**（ResourceNotFound），不加——加了每轮只会多一行 ERROR。
//
// 2026-10-05 分层改版：热集合每轮备份，冷集合每周备份一次。
//   热集合 = **随时在变的小集合**（进度/记录类），提高频率可把恢复粒度做细；
//   冷集合 = **基本只读、体积大**的题库类（两遍流式打包的耗时与内存都不小，
//   提高频率会把成本抬升而收益极小）。
const HOT_COLLECTIONS = [
  'settings',          // ← 进度/每日统计都在这里，是最需要保护的数据
  'practice_records',
  'wrong_questions',
  'favorites',
  'mastered_questions',
  'review_records',
]
const COLD_COLLECTIONS = [
  'questions',
  'quiz_banks',
  'exams',
  'exam_results',
  'bind_codes',
  'admin_auth',
  'visit_stats',
]
const COLLECTIONS = [...HOT_COLLECTIONS, ...COLD_COLLECTIONS]

const COLD_HOUR = 3        // 主轮判据：只有该小时槽的轮次才可能带冷集合（具体触发时刻由部署方触发器决定）
const COLD_WEEKDAY = 0     // 冷集合（题库类）只在周日的主轮跑（题库很少变，每周一次够）

/** 纯函数（可离线直测）：本轮该备份哪些集合。
 *  判据两条 —— ① 只有主轮（`COLD_HOUR` 小时槽）才可能带冷集合；② 主轮里**只有周日**带。
 *  hour / weekday 都用北京时间传入（0~23 / 0=周日），避免依赖容器时区。
 *  ⚠️ 传 `Date.getUTCDay()` 的结果（对 `Date(started + 8h)` 取 UTC 分量 = 北京星期）。 */
function pickCollections (hour, weekday) {
  const list = HOT_COLLECTIONS.slice()
  if (Number(hour) !== COLD_HOUR) return list
  if (Number(weekday) !== COLD_WEEKDAY) return list
  return list.concat(COLD_COLLECTIONS)
}

const META_COLL = 'backup_meta'
const RETAIN_DAYS = 30

function firstDoc(res) {
  // ⚠️ node-sdk 的 get() 回执 data 是数组（客户端 SDK 是对象），见 admin-api 同款坑
  const d = res && res.data
  if (Array.isArray(d)) return d[0] || null
  return d || null
}

function pageFetcher(name) {
  // 管理端 SDK 直查全量（无 where）：客户端「无条件查询返回空」的地雷只作用于受规则约束的客户端，
  // 云函数是管理端权限，不受此限（admin-server 的 pullAll 同款写法已在线上验证多年）。
  //
  // ⚠️ 2026-10-03 起本函数**不再把整集合读进内存**（题库类集合体积很大，整集合驻内存会把容器顶穿），
  //   改用 stream.js 的流式打包；这里只保留分页取数（_id 游标）。
  //   历史沿革：2026-09-25 前是 skip/limit 深分页（数据量上去后单次跑不完、超时静默切断），
  //   09-25 改 _id 游标（走主键索引，单页成本与深度无关），10-03 改流式。
  //   ⚠️ 备份文件里**行的顺序**＝ `_id` 升序：集合与条目一个不增一个不减，恢复按 _id。
  return (lastId, limit) => {
    let q = db.collection(name)
    if (lastId !== null) q = q.where({ _id: _.gt(lastId) })
    return q.orderBy('_id', 'asc').limit(limit).get().then((res) => (res && res.data) || [])
  }
}

exports.main = async () => {
  const started = Date.now()
  // 2026-09-18 修复（重审 E-12）：原来用 `new Date().getFullYear()/getMonth()/getDate()`——那是**容器的
  //   本地时间**，而 SCF 容器跑在 UTC ⇒ 定时器按北京时间触发时 UTC 还是前一天，于是每一天的备份都被
  //   登记到**前一天的目录名**，同一天内多次运行还会**就地互相覆盖**。
  //   改成显式按 UTC+8 计算：中国全年无夏令时，固定偏移即可，且不依赖容器 TZ 配置。
  const date = new Date(started + 8 * 3600 * 1000)
  const pad = n => String(n).padStart(2, '0')
  const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
  const hour = date.getUTCHours()
  // 2026-10-05（分层改版配套）：目录名带 **小时槽** —— 原先只有日期，多轮/天会**就地互相覆盖**
  //   （与此前修复的「日期归组」坑同族）。
  //   格式 `2026-10-05_1500` —— **刻意不用冒号**（部分工具/文件系统视其为禁区），
  //   也**刻意不用 `T15`**：实测 `Date.parse('2026-10-05T15')` 返回 **NaN**，
  //   会让按目录名解析时间的保留期扫描（配套接收/拉取脚本）静默失效、**永不清理**。
  //   ⇒ 配套口径：扫描侧一律取 `dir.slice(0, 10)` 再 parse（对 `2026-10-05` 与 `2026-10-05_1500` 都成立）。
  const slot = `${day}_${pad(hour)}00`
  const todo = pickCollections(hour, date.getUTCDay())

  const summary = []
  const fileIDs = []
  const pushSummary = []   // 逐集合推送的结果（改为**小包推送**，替代整包——整包内存峰值过高会 OOM）

  for (const coll of todo) {
    try {
      // 2026-10-03 流式改版：不再整集合进内存。stream.js 两遍走同一分页器——
      // 第一遍产纯数组 gz（异地推送，格式与历史一致），第二遍产包络 gz（云存储，
      // 键序 collection→date→count→rows 与历史一致；date 仍是 Date 序列化后的 ISO 串，不是 day 字符串）。
      // 全程只驻留一页（1000 条）与压缩输出；历史包袱见 pageFetcher 顶部注释。
      const { count, plainGz, envelopeGz } = await buildBackups({
        fetchPage: pageFetcher(coll),
        name: coll,
        dateIso: date.toISOString(),
      })
      const cloudPath = `backups/${slot}/${coll}.json`
      const up = await app.uploadFile({ cloudPath, fileContent: envelopeGz })
      fileIDs.push(up && up.fileID ? up.fileID : null)
      summary.push(`${coll}:${count}`)
      // 每集合留一行 RSS，便于观察哪一步内存逼近上限
      console.log(`[dbBackup] ${coll} ${count} 条，rss ${Math.round(process.memoryUsage().rss / 1048576)}MB`)
      // 异地第二副本：本集合压缩后**单包**推送（内存峰值可控）
      if (BACKUP_URL && BACKUP_TOKEN) {
        try {
          const u = new URL(BACKUP_URL)
          const pr = await postCollection(u.hostname, u.pathname, BACKUP_TOKEN, slot, coll, plainGz)
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
  // `slot` = 本轮唯一标识（`2026-10-05_1500`）。`day` 保留为日期部分（历史消费方按它分组）。
  history.push({ day, slot, fileIDs: fileIDs.filter(Boolean), summary: summary.join(' '), at: started })

  // 删过期备份（按登记的 fileID）
  const cutoff = started - RETAIN_DAYS * 86400000
  const expired = history.filter(h => h.at < cutoff)
  for (const h of expired) {
    const ids = (h.fileIDs || []).filter(Boolean)
    if (ids.length) {
      try { await app.deleteFile({ fileList: ids }) } catch (e) { console.error('[dbBackup] 删除过期备份失败', e && e.message) }
    }
  }
  // 2026-10-05：**不再用固定条数截断** —— 那是「低频轮次」时代的容量假设；
  //   提高轮次频率后，固定条数会把保留期悄悄削短。
  //   保留期唯一的判据就是上面的 `at >= cutoff`，条数不设限。
  //   体积估算：热集合包很小，history 每项只存 fileID 字符串，远在单文档大小上限之内；
  //   云存储里的实体包由 deleteFile 同步删掉。
  history = history.filter(h => h.at >= cutoff)

  // 写回 meta（upsert：先 update 0 行则 add）
  // ⚠️ update 的载荷里**不能带 _id**：实测会抛 INVALID_PARAM「不能更新_id的值」，
  // 一旦带上就会掉进 add 分支撞重复键 ⇒ history 永不增长、保留期形同虚设（实测定位）。
  const metaDoc = { history, last_run: started, last_day: day, last_slot: slot }
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
  console.log('[dbBackup] 完成', slot, '集合', okCount + '/' + todo.length, '用时', Date.now() - started, 'ms')
  console.log('[dbBackup] 异地推送', pushSummary.join(' '))

  // 2026-09-18 修复（重审 E-09 / E-10）：**如实回报成败**。
  //   原实现无论多少集合失败、异地推送是否全灭，一律 `ok: true` ⇒ 调用方/巡检看到的永远是「成功」，
  //   「今天少备份了几个集合」这件事没有任何出口（失败只在 history 里留一个字符串，调用方看不见）。
  //   现在：ok 只在「全部集合成功」时为真；同时把失败清单与推送失败数一并回给调用方。
  const failedColls = summary.filter(s => s.endsWith('ERROR')).map(s => s.split(':')[0])
  const pushFailed = pushSummary.filter(s => /FAIL|失败|ERROR/i.test(String(s))).length
  const ok = failedColls.length === 0
  if (!ok) console.error('[dbBackup] 本轮有集合备份失败：', failedColls.join(', '))
  if (pushFailed > 0) console.error('[dbBackup] 异地推送失败', pushFailed, '条：', pushSummary.join(' '))

  return {
    ok,
    day,
    slot,
    collections: summary,
    failed: failedColls,
    push: pushSummary,
    pushFailed,
    retainedDays: RETAIN_DAYS,
  }
}

// 纯函数导出（离线单测用；云函数运行时只调 exports.main，多这几个键无副作用）
exports._pickCollections = pickCollections
exports._HOT_COLLECTIONS = HOT_COLLECTIONS
exports._COLD_COLLECTIONS = COLD_COLLECTIONS
