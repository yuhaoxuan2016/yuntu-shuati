// 「意见反馈」收录端（**公开可调**：不需要口令，任何人都能调）。
//
// 只做四件事：校验 → 限流 → 写 feedback 集合 → 推钉钉（凭据没配就跳过推送，收录照常）。
//
// 为什么单独一个函数、而不是塞进 admin-api 加个 action：
//   这个入口面向全网匿名调用，而 admin-api 里全是 list-*/delete-* 这类管理动作。
//   公开面与口令面必须物理隔离——混在一个函数里靠 action 字符串区分，迟早有人写错一格。
//
// 身份：这个项目里没有可靠的服务端身份（网页端匿名/自定义登录都取不到稳定的 caller id，
//   小程序端平台会注入 event.userInfo.openId）。所以：
//     · 平台给的   → 写进 _openid，标 id_source='platform'
//     · 客户端自报 → 只写进 claim_uid，标 id_source='claim'（不可信，仅用于限流与人肉判断）
//     · 都没有     → id_source='anon'
//   限流按「平台身份优先、否则自报身份」做尽力而为——自报可伪造，所以只当作反滥用下限，
//   真正的兜底是字段长度硬上限 + 管理端可删。
const cloudbase = require('@cloudbase/node-sdk')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()
const _ = db.command

const CATS = { bug: 'Bug 报告', feature: '功能建议', question: '使用问题', other: '其他' }
const LIMITS = { title: 100, body: 3000, contact: 120, page: 200, ua: 300, version: 40 }
const RATE = { perMinute: 1, perDay: 10 }

const clip = (v, n) => String(v == null ? '' : v).replace(/\u0000/g, '').trim().slice(0, n)
const fail = (code, message) => ({ ok: false, code, message })

exports.main = async (event = {}) => {
  const category = clip(event.category, 20)
  if (!CATS[category]) return fail('BAD_CATEGORY', '反馈类型不对')
  const title = clip(event.title, LIMITS.title)
  const body = clip(event.body, LIMITS.body)
  if (!title) return fail('NO_TITLE', '请填写标题')
  if (!body) return fail('NO_BODY', '请填写反馈内容')

  const platformUid = clip((event.userInfo && event.userInfo.openId) || '', 64)
  const claimUid = clip((event.claim && event.claim.uid) || '', 64)
  const claimKey = clip((event.claim && event.claim.sync_key) || '', 64)
  const idSource = platformUid ? 'platform' : (claimUid ? 'claim' : 'anon')
  const ownerKey = platformUid || claimUid || 'anon'

  try {
    // 限流：同一身份 1 分钟 1 条、每天 10 条（尽力而为，见文件头）
    const nowMs = Date.now()
    const oneMinAgo = new Date(nowMs - 60 * 1000).toISOString()
    const dayStart = new Date(new Date(nowMs).setHours(0, 0, 0, 0)).toISOString()
    const recent = await db.collection('feedback').where({ owner_key: ownerKey, created_at: _.gte(oneMinAgo) }).count()
    if ((recent.total || 0) >= RATE.perMinute) return fail('TOO_FAST', '刚提交过，歇一分钟再来')
    const today = await db.collection('feedback').where({ owner_key: ownerKey, created_at: _.gte(dayStart) }).count()
    if ((today.total || 0) >= RATE.perDay) return fail('TOO_MANY', '今天提交得有点多，明天再来')

    const doc = {
      category,
      category_label: CATS[category],
      title,
      body,
      contact: clip(event.contact, LIMITS.contact),
      // 系统信息（客户端勾选才带）
      page: clip(event.page, LIMITS.page),
      ua: clip(event.ua, LIMITS.ua),
      version: clip(event.version, LIMITS.version),
      // 身份：_openid 只放平台给的值；自报的另存，绝不写进 _openid
      _openid: platformUid || '',
      claim_uid: claimUid,
      claim_sync_key: claimKey,
      id_source: idSource,
      owner_key: ownerKey,
      created_at: new Date(nowMs).toISOString(),
      pushed: false,
      push_error: '',
    }
    // ⚠️ 服务端 SDK 的写形态与**客户端** SDK 不同（2026-09-25 实测踩过）：
    //   客户端是 `add({ data: {...} })` / `update({ data: {...} })`；
    //   @cloudbase/node-sdk 是 `add({...字段})` / `update({...字段})` —— 多包一层 `data:`
    //   不会报错，而是把整份文档塞进一个字面量叫 `data` 的字段里（回读才发现）。
    //   本仓的权威参照是 `functions/dbBackup/index.js:162` 与 `admin-api/index.js:109`。
    const res = await db.collection('feedback').add(doc)
    const id = res && (res.id || res._id || (res.ids && res.ids[0])) || ''

    // 推钉钉（机器人单聊，走与推送脚本同一套环境变量；没配就跳过，不影响收录）
    const push = await pushDingTalk(doc)
    if (id && push.attempted) {
      try {
        await db.collection('feedback').doc(id).update({ pushed: push.ok, push_error: push.error || '' })
      } catch (e) { console.warn('回写推送状态失败：', (e && e.message) || e) }
    }
    return { ok: true, id, notified: push.ok }
  } catch (e) {
    console.error('feedback 收录失败：', (e && e.message) || e)
    return fail('STORE_FAILED', '服务器暂时收不了，请稍后再试或改用复制内容')
  }
}

// ===== 钉钉单聊推送（与 server-ops/agent-deploy/scripts/push-dingtalk.mjs 同一套接口）=====
// 环境变量：DINGTALK_APP_KEY / DINGTALK_APP_SECRET / DINGTALK_USER_ID，任一缺失则整段跳过。
function pushDingTalk (doc) {
  const key = process.env.DINGTALK_APP_KEY || ''
  const secret = process.env.DINGTALK_APP_SECRET || ''
  const uid = process.env.DINGTALK_USER_ID || ''
  if (!key || !secret || !uid) return Promise.resolve({ attempted: false, ok: false, error: 'not-configured' })
  const content = [
    `💌 新反馈［${doc.category_label}］${doc.title}`,
    '',
    doc.body.slice(0, 300) + (doc.body.length > 300 ? '…' : ''),
    doc.contact ? `\n联系方式：${doc.contact}` : '',
    doc.version ? `版本：${doc.version}` : '',
  ].filter(Boolean).join('\n')
  return postJSON('https://api.dingtalk.com/v1.0/oauth2/accessToken', { appKey: key, appSecret: secret }, null)
    .then(t => {
      if (!t || !t.accessToken) throw new Error('取 token 失败')
      return postJSON('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend',
        { robotCode: key, userIds: [uid], msgKey: 'sampleText', msgParam: JSON.stringify({ content }) },
        { 'x-acs-dingtalk-access-token': t.accessToken })
    })
    .then(r => ({ attempted: true, ok: true, error: '', raw: r }))
    .catch(e => ({ attempted: true, ok: false, error: String((e && e.message) || e).slice(0, 300) }))
}

function postJSON (url, body, headers) {
  return new Promise((resolve, reject) => {
    const https = require('https')
    const data = Buffer.from(JSON.stringify(body))
    const req = https.request(url, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': data.length }, headers || {}),
      timeout: 8000,
    }, res => {
      let buf = ''
      res.on('data', c => { buf += c })
      res.on('end', () => {
        try { resolve(JSON.parse(buf)) } catch { reject(new Error('返回不是 JSON：' + buf.slice(0, 120))) }
      })
    })
    req.on('timeout', () => req.destroy(new Error('钉钉请求超时')))
    req.on('error', reject)
    req.end(data)
  })
}