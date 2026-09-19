// externalProbe：异地探活（2026-09-18 新增）
//
// 为什么要有它：inspect.cjs 跑在轻量服务器上，检查的是「服务器自己」。机器整机挂了、
// 或者那条 cron 没跑，inspect 就不产结果，也就永远没人知道它没产结果——这是自证。
// 本函数放在云函数侧（另一个位置、另一个账号名下），每 30 分钟从外面读一次
// https://yuhaoxuan.cn/ops/ping，读不到 / 读到 ok=false / 心跳过期都记一次事故。
//
// 写库纪律（承重，别改松）：本账户月度配额里「调用次数 20 万次」已经用到八成，
// 数据库写请求占全账户消耗 62%。所以**一切正常时每天只写 1 行心跳**，
// 连续故障期间也只更新同一条事故的 last_seen_at，不逐次追加。
//
// 探针自己挂了谁发现：probe_state/latest 的 last_ok_at。超过 2 天没动 = 探针侧停摆，
// 由本机的账户简报读出来（它同时读 status 与 probe_state）。
const cloudbase = require('@cloudbase/node-sdk')
const https = require('https')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()

const PING_URL = process.env.PROBE_URL || 'https://yuhaoxuan.cn/ops/ping'
// 服务器巡检每天 08:03 重写 ping.json，正常最长心跳约 24h；26h 留了补跑余量
const MAX_HEARTBEAT_HOURS = Number(process.env.PROBE_MAX_HEARTBEAT_HOURS || 26)
const INCIDENT_COLL = 'probe_incidents'
const STATE_COLL = 'probe_state'
const STATE_ID = 'latest'

function fetchPing() {
  return new Promise(resolve => {
    const u = new URL(PING_URL)
    const req = https.request({
      host: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { 'User-Agent': 'external-probe/1.0', Accept: 'application/json' },
      timeout: 15000,
    }, res => {
      let body = ''
      res.on('data', c => { body += c; if (body.length > 65536) req.destroy() })
      res.on('end', () => resolve({ status: res.statusCode || 0, body }))
    })
    req.on('error', e => resolve({ status: 0, body: '', error: String(e && e.message).slice(0, 160) }))
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '', error: '请求超时 15s' }) })
    req.end()
  })
}

// 判定：返回 { ok, kind, reason }。kind 决定是「新事故 / 已有事故续期 / 恢复」
async function evaluate() {
  const r = await fetchPing()
  if (r.error) return { ok: false, kind: 'net', reason: '网络不可达：' + r.error }
  if (r.status !== 200) return { ok: false, kind: 'http', reason: 'HTTP ' + r.status + '（/ops/ping 未挂出或 nginx 挂了）' }
  let data
  try { data = JSON.parse(r.body) } catch (e) {
    // SPA 回退会把未知路径兜成 index.html——那时 200 + HTML，必须算异常而不是当成健康
    return { ok: false, kind: 'parse', reason: '响应不是 JSON，前 60 字：' + String(r.body).slice(0, 60) }
  }
  if (data.ok !== true) return { ok: false, kind: 'self', reason: '服务器自检自报 ok=false（细节看 /ops/status）' }
  const at = Date.parse(data.at)
  if (!Number.isFinite(at)) return { ok: false, kind: 'parse', reason: '心跳缺 at 字段或不可解析' }
  const hours = (Date.now() - at) / 3600000
  if (hours > MAX_HEARTBEAT_HOURS) {
    return { ok: false, kind: 'stale', reason: `心跳过期：${Math.round(hours)} 小时前（阈值 ${MAX_HEARTBEAT_HOURS}h）⇒ 巡检 cron 没跑` }
  }
  if (hours < -2) return { ok: false, kind: 'skew', reason: `心跳时间在未来：${Math.round(hours)}h ⇒ 服务器时钟漂了` }
  return { ok: true, kind: 'ok', reason: '', ageHours: Math.round(hours * 10) / 10 }
}

function firstDoc(res) {
  // ⚠️ node-sdk 的 get() 回执 data 是数组（客户端 SDK 是对象），见 dbBackup 同款坑
  const d = res && res.data
  if (Array.isArray(d)) return d[0] || null
  return d || null
}

async function readState() {
  try { return firstDoc(await db.collection(STATE_COLL).doc(STATE_ID).get()) || {} }
  catch (e) { return {} }
}

// upsert 状态文档。⚠️ update 载荷里**绝不能带 _id**：线上实测会抛 INVALID_PARAM
// 「不能更新_id的值」，一旦带上就掉进 add 分支撞重复键（dbBackup 的 30 天保留期就是这么静默失效的）。
async function writeState(patch) {
  try {
    const upd = await db.collection(STATE_COLL).doc(STATE_ID).update(patch)
    const n = Number((upd && (upd.updated ?? (upd.stats && upd.stats.updated))) || 0)
    if (!n) throw new Error('update 0 行')
  } catch (e) {
    try { await db.collection(STATE_COLL).add({ _id: STATE_ID, ...patch }) }
    catch (e2) { console.error('[externalProbe] 写 probe_state 失败', e2 && e2.message) }
  }
}

exports.main = async () => {
  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  const today = nowIso.slice(0, 10)
  const verdict = await evaluate()
  const state = await readState()

  let action = 'noop'

  if (!verdict.ok) {
    if (state.open_incident_id) {
      // 同一次故障的延续：只续期，不新增行。kind 要跟着 reason 一起改——
      // 否则会出现「kind:stale 却写着 skew 的原因」这种自相矛盾的行（2026-09-18 验证时实测到）。
      await db.collection(INCIDENT_COLL).doc(state.open_incident_id)
        .update({ last_seen_at: nowIso, seen_count: (state.open_seen_count || 1) + 1,
          kind: verdict.kind, reason: verdict.reason })
      action = 'incident-updated'
    } else {
      const addRes = await db.collection(INCIDENT_COLL).add({
        started_at: nowIso, last_seen_at: nowIso, seen_count: 1,
        kind: verdict.kind, reason: verdict.reason, resolved_at: null,
      })
      const id = addRes && (addRes.id || (addRes.ids && addRes.ids[0]))
      await writeState({ open_incident_id: id || null, open_seen_count: 1, open_since: nowIso })
      action = 'incident-opened'
    }
  } else {
    if (state.open_incident_id) {
      try {
        await db.collection(INCIDENT_COLL).doc(state.open_incident_id)
          .update({ resolved_at: nowIso, down_for_hours: Math.round((now - Date.parse(state.open_since)) / 360000) / 10 })
      } catch (e) { console.error('[externalProbe] 回填 resolved 失败', e && e.message) }
      action = 'recovered'
    } else if (state.last_heartbeat_day !== today) {
      action = 'heartbeat'
    }
    const next = { last_ok_at: nowIso, open_incident_id: null, open_seen_count: null, open_since: null }
    if (action === 'heartbeat') next.last_heartbeat_day = today
    // 只有心跳/恢复这类"状态真的变了"才写；纯健康复述一律不写
    if (action === 'heartbeat' || action === 'recovered') await writeState(next)
  }

  console.log('[externalProbe]', action, verdict.ok ? 'ok' : 'FAIL', verdict.reason, 'age', verdict.ageHours)
  return { at: nowIso, ok: verdict.ok, action, kind: verdict.kind, ageHours: verdict.ageHours, reason: verdict.reason }
}
