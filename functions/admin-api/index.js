// admin-api 云函数：管理员操作入口（部署于 CloudBase 云函数，管理密钥天然在服务端）
// 前端调用方式：app.callFunction({ name: 'admin-api', data: { password, action, payload } })
//
// 支持的操作（action）：
//   list-exams          列出所有考试（含 private）
//   delete-exam         删除指定考试 { examId }
//   delete-all-exams    删除全部考试（可指定 visibility 过滤）
//   list-banks          列出所有题库（含 private）
//   delete-bank         删除题库（及其题目）{ bankId, bankRef }
//   delete-all-banks    删除全部题库
//   delete-user-data    删除指定用户全部数据（该用户创建的题库/考试/题目）{ uid }
//   clear-personal      清理所有非公共数据（private 题库/考试/题目）
//   reset-exams-acl     【未实现】恢复 exams 集合安全规则为正式规则——调用只会拿到 NOT_IMPLEMENTED，
//                       见文件末尾同名函数里的说明（P2-39：过去它空转返回 ok:true，会让人以为已恢复）
//
// 管理员口令：**不落环境变量、不落代码**，只以「盐 + sha256」的形式存在库里（`admin_auth/secret`）。
// 安全铁律：secret 文档缺失（或没有 pwd_hash）时服务直接禁用，绝不回退到任何默认口令。
// 为什么用哈希而不是 ADMIN_PASSWORD 环境变量（2026-09-16 用户拍板改云函数时定的）：
//   ① 口令明文不必经过部署工具/日志（部署参数里没有秘密）；② 库被读到也拿不到口令原值；
//   ③ 轮换＝用本机脚本重算一次哈希写回（原口令只存在用户的 `scripts/.creds.env` 里）。
const cloudbase = require('@cloudbase/node-sdk')
const crypto = require('crypto')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()
// 注：这里原有 `const _ = db.command` 只被 P2-5 删掉的那行测试导出消费，随它一起摘掉（死变量）；
// 日后要拼查询条件再加回来。


// ===== P1-38：口令尝试的次数限制与临时锁定（2026-09-16，用户拍板「加次数限制」）=====
// 背景：本函数一旦部署就是**公网可达**的（网页端匿名会话也能 invoke），口令是唯一门槛；
// 没有节流时，一个强口令也只是把在线猜测从「秒级」拖到「年月级」，而口令一旦泄露无法察觉。
// 设计（全局锁，不按调用方）：
//   · 失败计数落在 `admin_auth` 集合的单条状态文档上（`_id: 'state'`）——跨实例可见、冷启动不丢；
//     **不用函数内存计数**：多实例 + 冷启动会让内存计数形同虚设（bindAccount 的同类判断已有先例）。
//   · 15 分钟内累计失败 5 次 → 锁定 30 分钟；锁定期内**连口令都不比**（省一次常量时间比较，也不计数）。
//   · 成功一次立刻清零。
//   · 全局锁的代价（如实记）：攻击者可以用失败请求把管理员自己挡在门外——对**单人自用**的工具
//     这是可接受的取舍（宁可锁住，不可被猜穿），且锁定是自解的（30 分钟）。
//   · 判定逻辑抽成纯函数 decideAuth()，便于离线夹具验证（见 tmp-verify/t18-2e）。
const AUTH_COLL = 'admin_auth'
const AUTH_DOC_ID = 'state'
const SECRET_DOC_ID = 'secret'
const FAIL_LIMIT = 5
const FAIL_WINDOW_MS = 15 * 60 * 1000
const LOCK_MS = 30 * 60 * 1000

// 纯判定：输入当前状态 + 口令是否匹配 + 当前时间，输出「这次该做什么」与「状态该写成什么」。
// 不碰数据库、不读时钟，故可离线测。
function decideAuth(state, passwordOk, now) {
  const st = state || null
  const lockedUntil = Number((st && st.locked_until) || 0)
  if (lockedUntil > now) {
    return { outcome: 'locked', lockRemainMs: lockedUntil - now, nextState: null }
  }
  if (passwordOk) {
    // 成功即清零（含把过期的锁一并抹掉）
    return { outcome: 'ok', nextState: { fail_count: 0, window_at: now, locked_until: 0 } }
  }
  const windowAt = Number((st && st.window_at) || 0)
  const inWindow = windowAt > 0 && now - windowAt < FAIL_WINDOW_MS
  const count = (inWindow ? Number(st.fail_count || 0) : 0) + 1
  const lock = count >= FAIL_LIMIT ? now + LOCK_MS : 0
  return {
    outcome: 'bad',
    nextState: { fail_count: count, window_at: inWindow ? windowAt : now, locked_until: lock },
    justLocked: lock > 0,
  }
}

// 读状态：读不到/抛错一律按「没有记录」处理（最坏是这一次没挡住，方向安全）。
// ⚠️ 必须走 firstDoc()——node-sdk 的 data 是数组（见上面那条坑；不这样写会让计数永远读成空）。
async function readAuthState() {
  try {
    const res = await db.collection(AUTH_COLL).doc(AUTH_DOC_ID).get()
    return firstDoc(res)
  } catch (e) {
    console.error('[admin-api] 读取鉴权状态失败（按无记录处理）', e && e.errCode, e && e.message)
    return null
  }
}

// 2026-09-18 修复（重审 D-09）：**带乐观并发的写**。
//   调用方原来是「读状态 → 判 → 写状态」三步，步骤之间没有任何互斥 ⇒ 并发猜测时各请求读到**同一个**
//   `fail_count`、又各自写回 `count + 1` ⇒ 无论并发多少次，计数只涨 1、锁定永远凑不满，
//   锁定机制可被并发整体绕过（且锁定期内仍然每次都算一次哈希）。
//   这里把「读到的状态值」作为更新条件：期间若被别的请求改过，`update` 命中 0 行 ⇒ 返回 false，
//   调用方按**拒绝**处理（fail-closed）——并发尝试只会把自己拒掉，不会让计数失真。
// ⚠️ 只在读到的字段确实是数字时才把它写进条件：CloudBase 里 `where({field: 0})` 匹配不到
//   「该字段不存在」的文档，无条件塞进去会让**每一次**写都失败 ⇒ 把管理面板整体锁死。
//   字段缺失时退化为旧行为（无条件写），至少不会锁死。
async function writeAuthStateIfUnchanged(prev, next) {
  if (!next) return true
  const data = { ...next, updated_at: Date.now() }
  if (prev) {
    const cond = { _id: AUTH_DOC_ID }
    if (typeof prev.fail_count === 'number') cond.fail_count = prev.fail_count
    if (typeof prev.window_at === 'number') cond.window_at = prev.window_at
    try {
      const upd = await db.collection(AUTH_COLL).where(cond).update(data)
      const n = Number((upd && (upd.updated ?? (upd.stats && upd.stats.updated))) || 0)
      return n > 0
    } catch (e) {
      console.error('[admin-api] 条件写鉴权状态失败', e && e.errCode, e && e.message)
      return false
    }
  }
  try {
    await db.collection(AUTH_COLL).add({ _id: AUTH_DOC_ID, ...data })
    return true
  } catch (e) {
    // 并发下另一个请求刚建好，或权限问题 ⇒ 按失败处理（下次重读即可，方向安全）
    console.error('[admin-api] 首建鉴权状态失败（并发或权限）', e && e.errCode, e && e.message)
    return false
  }
}

// P2-6 的历史沿革（保留结论，代码已换实现）：原先写作 `password !== ADMIN_PASSWORD`，`!==` 在首个
// 不同的字节就短路返回，把「从开头连续匹配了几个字节」编码进了响应延迟；叠加 P1-38（原无速率限制）
// 方向上是在帮在线猜测。当时的修法是对环境变量明文做 `crypto.timingSafeEqual`。
// **2026-09-16 改云函数时又进一步**：明文不再进环境变量，改比哈希（见下面 hashMatches）。
// 常量时间的性质保留；「长度不等即拒会泄露长度」这条残余边界随之消失（比的是定长哈希）。

// ⚠️ 2026-09-16 真机调用抓到的坑（**必读**）：`@cloudbase/node-sdk` 的 `get()` 回执里
// `data` 是**数组**（`IGetRes.data: any[]`，即使走的是 `doc(id).get()`），与客户端 SDK
// （wx.cloud / @cloudbase/js-sdk 的 `doc().get()` 回 data 为**对象**）**形状相反**。
// 第一版按对象读 ⇒ secret 读不到（服务误报「未配置」）、更隐蔽的是**失败计数状态永远读成空**
// ⇒ P1-38 的锁定会静默失效（看着有实现、实际永不触发）。故统一走这个取首元素的适配器。
function firstDoc(res) {
  const d = res && res.data
  if (Array.isArray(d)) return d[0] || null
  return d || null
}

// 读口令哈希记录（`admin_auth/secret`）：读不到/抛错按「未配置」处理 ⇒ 服务禁用（fail-closed）。
// 但**抛错要进日志**（第一版静默吞掉，导致上面那条形状坑排查成本高）。
async function readSecret() {
  try {
    const res = await db.collection(AUTH_COLL).doc(SECRET_DOC_ID).get()
    return firstDoc(res)
  } catch (e) {
    console.error('[admin-api] 读取口令记录失败（按未配置处理）', e && e.errCode, e && e.message)
    return null
  }
}

// P2-6：口令比较保持**常量时间**的思路，只是比较对象从环境变量明文换成了哈希：
//   · 先算 `sha256(salt + given)`，再与库里的 `pwd_hash` 做定长（64 hex）常量时间比较；
//   · `timingSafeEqual` 要求两侧 Buffer 等长（不等会抛），这里先用长度判断兜住，
//     顺便把「非字符串入参」也挡在 Buffer 之外（undefined/数字/对象都会让 Buffer.from 抛）。
// 残余边界（如实记）：长度不等即拒本身仍泄露「口令长度是否等于预期」——但这里比较的是**哈希**长度
// （恒定 64），与用户口令长度无关，故这一侧的信号比原实现更弱；真正的口令长度只体现在
// `sha256` 的输入长度上，不产生可观测差异。
function hashPassword(salt, given) {
  return crypto.createHash('sha256').update(String(salt || '') + given).digest('hex')
}

function hashMatches(salt, given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string' || !expected) return false
  const got = hashPassword(salt, given)
  if (got.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))
}

exports.main = async (event = {}) => {
  const { password, action, payload = {} } = event

  // P1-38：先判锁（锁定期内不比口令），再判口令，最后按判定结果更新状态
  const now = Date.now()
  const secret = await readSecret()
  if (!secret || !secret.pwd_hash) {
    return { ok: false, code: 'NO_PASSWORD', message: '管理员口令未配置，服务已禁用' }
  }
  const passwordOk = hashMatches(secret.salt, password, secret.pwd_hash)
  const prevState = await readAuthState()
  const decision = decideAuth(prevState, passwordOk, now)
  if (decision.outcome === 'locked') {
    const mins = Math.max(1, Math.ceil(decision.lockRemainMs / 60000))
    console.warn('[admin-api] 口令处于锁定期，拒绝本次调用，剩余分钟', mins)
    return { ok: false, code: 'LOCKED', message: `尝试次数过多，已临时锁定，请约 ${mins} 分钟后再试` }
  }
  // D-09（2026-09-18）：条件写——并发下没抢到（状态已被别的请求改动）就直接拒绝，
  // 不让「读—判—写」的竞态把失败计数抹平（否则并发爆破可以让计数永远涨不上去、锁定永不触发）。
  const stateWritten = await writeAuthStateIfUnchanged(prevState, decision.nextState)
  if (!stateWritten) {
    console.warn('[admin-api] 检测到并发口令尝试：鉴权状态未按预期写入，本次直接拒绝（fail-closed）')
    return { ok: false, code: 'CONCURRENT', message: '请求过于频繁，请稍后再试' }
  }
  if (decision.outcome === 'bad') {
    if (decision.justLocked) console.warn('[admin-api] 口令失败次数达上限，已锁定', FAIL_LIMIT, '次')
    else console.warn('[admin-api] 口令错误，本次计数已记录')
    return { ok: false, code: 'BAD_PASSWORD', message: '管理员密码错误' }
  }

  try {
    switch (action) {
      case 'list-exams': return await listExams()
      case 'delete-exam': return await deleteExam(payload.examId)
      case 'delete-all-exams': return await deleteAllExams(payload.visibility)
      case 'list-banks': return await listBanks()
      case 'delete-bank': return await deleteBank(payload.bankId, payload.bankRef)
      case 'delete-all-banks': return await deleteAllBanks()
      case 'delete-user-data': return await deleteUserData(payload.uid)
      case 'clear-personal': return await clearPersonal()
      case 'reset-exams-acl': return await resetExamsAcl()   // 【未实现】只回 NOT_IMPLEMENTED，见函数注释
      // 2026-09-25：意见反馈的读/删。写入端在独立云函数 `feedback`（公开可调、无口令），
      // 这里只负责「管理员能看能删」——公开面与口令面刻意分在两个函数里，见 feedback/index.js 头部注释。
      case 'list-feedback': return await listFeedback(payload.limit)
      case 'delete-feedback': return await deleteFeedback(payload.id)
      default:
        return { ok: false, code: 'UNKNOWN_ACTION', message: `未知操作: ${action}` }
    }
  } catch (e) {
    // P2-5：原始内部错误文本**不外发**。原先 `message: e?.message || String(e)` 会把驱动报错、
    // 集合名、甚至带路径的栈信息原样吐给调用方（信息泄露）。原文只进日志；返回一条粗粒度中文提示。
    // ⚠️ 保留既有 `code` 字段形状不变（本函数其它分支也带 code），但账本新发现 D：
    //    网页端 SDK 见到返回对象里有 `code` 时会把 `res.result` 读空——若日后真给网页端接这个函数，
    //    这个字段名要改。当前零调用方 + 未部署，改名收益为零、爆炸半径未知，故本任务不改名。
    console.error('[admin-api]', action, e)
    return { ok: false, code: 'ERROR', message: '操作失败，请查看云函数日志' }
  }
}

// ===== 实现 =====

// 意见反馈列表（新→旧）。字段全给出来，面板侧只负责显示；不在这里做摘要/裁剪，
// 免得以后想加「按类型筛」「导出」还要回头改函数。
async function listFeedback(limit) {
  const n = Math.min(Math.max(Number(limit) || 100, 1), 500)
  const res = await db.collection('feedback').orderBy('created_at', 'desc').limit(n).get()
  const rows = res.data || []
  return {
    ok: true,
    total: rows.length,
    items: rows.map(f => ({
      _id: f._id,
      category: f.category, category_label: f.category_label,
      title: f.title, body: f.body, contact: f.contact || '',
      page: f.page || '', ua: f.ua || '', version: f.version || '',
      id_source: f.id_source || '', claim_uid: f.claim_uid || '', claim_sync_key: f.claim_sync_key || '',
      _openid: f._openid || '',
      created_at: f.created_at, pushed: !!f.pushed, push_error: f.push_error || '',
    })),
  }
}

async function deleteFeedback(id) {
  if (!id) return { ok: false, message: '缺少 id' }
  await db.collection('feedback').doc(id).remove()
  return { ok: true, message: `已删除反馈 ${id}` }
}

async function listExams() {
  const all = []
  const pageSize = 100
  for (let skip = 0; skip < 1000; skip += pageSize) {
    const res = await db.collection('exams').skip(skip).limit(pageSize).get()
    const rows = res.data || []
    all.push(...rows)
    if (rows.length < pageSize) break
  }
  return { ok: true, total: all.length, exams: all.map(e => ({
    _id: e._id, title: e.title, visibility: e.visibility, question_count: e.questions?.length || 0,
    created_at: e.created_at, creator_name: e.creator_name, _openid: e._openid,
  })) }
}

async function deleteExam(examId) {
  if (!examId) return { ok: false, message: '缺少 examId' }
  await db.collection('exams').doc(examId).remove()
  // 级联删除答卷
  const results = await db.collection('exam_results').where({ exam_id: examId }).limit(500).get()
  for (const r of (results.data || [])) {
    await db.collection('exam_results').doc(r._id).remove()
  }
  return { ok: true, message: `已删除考试 ${examId} 及 ${results.data?.length || 0} 份答卷` }
}

async function deleteAllExams(visibility) {
  const all = []
  const pageSize = 100
  for (let skip = 0; skip < 1000; skip += pageSize) {
    const q = visibility ? db.collection('exams').where({ visibility }) : db.collection('exams')
    const res = await q.skip(skip).limit(pageSize).get()
    const rows = res.data || []
    all.push(...rows)
    if (rows.length < pageSize) break
  }
  let n = 0
  for (const e of all) {
    try { await db.collection('exams').doc(e._id).remove(); n++ } catch { /* ignore */ }
  }
  return { ok: true, message: `已删除 ${n} 个考试`, deleted: n }
}

async function listBanks() {
  const all = []
  const pageSize = 100
  for (let skip = 0; skip < 1000; skip += pageSize) {
    const res = await db.collection('quiz_banks').skip(skip).limit(pageSize).get()
    const rows = res.data || []
    all.push(...rows)
    if (rows.length < pageSize) break
  }
  // 附加题目数
  const banks = await Promise.all(all.map(async b => {
    try {
      const cnt = await db.collection('questions').where({ bank_ref: b._id }).count()
      return { _id: b._id, name: b.name, visibility: b.visibility, question_count: cnt.total, creator_name: b.creator_name, _openid: b._openid }
    } catch { return { _id: b._id, name: b.name, visibility: b.visibility, question_count: 0, creator_name: b.creator_name, _openid: b._openid } }
  }))
  return { ok: true, total: banks.length, banks }
}

async function deleteBank(bankId, bankRef) {
  if (!bankId) return { ok: false, message: '缺少 bankId' }
  // 删除题库
  await db.collection('quiz_banks').doc(bankId).remove()
  // 级联删除题目（按 bank_ref 匹配）
  let deleted = 0
  const pageSize = 100
  for (let skip = 0; skip < 5000; skip += pageSize) {
    const q = db.collection('questions').where({ bank_ref: bankId })
    const res = await q.skip(skip).limit(pageSize).get()
    const rows = res.data || []
    for (const qd of rows) {
      try { await db.collection('questions').doc(qd._id).remove(); deleted++ } catch { /* ignore */ }
    }
    if (rows.length < pageSize) break
  }
  return { ok: true, message: `已删除题库 ${bankId} 及 ${deleted} 道题目` }
}

async function deleteAllBanks() {
  const all = []
  const pageSize = 100
  for (let skip = 0; skip < 1000; skip += pageSize) {
    const res = await db.collection('quiz_banks').skip(skip).limit(pageSize).get()
    const rows = res.data || []
    all.push(...rows)
    if (rows.length < pageSize) break
  }
  let n = 0
  for (const b of all) {
    try {
      await deleteBank(b._id, b._id)
      n++
    } catch { /* ignore */ }
  }
  return { ok: true, message: `已删除 ${n} 个题库及其题目`, deleted: n }
}

async function deleteUserData(uid) {
  if (!uid) return { ok: false, message: '缺少 uid' }
  let total = 0
  // 该用户创建的题库
  const banks = await db.collection('quiz_banks').where({ _openid: uid }).limit(500).get()
  for (const b of (banks.data || [])) {
    await deleteBank(b._id, b._id)
    total++
  }
  // 该用户创建的考试
  const exams = await db.collection('exams').where({ _openid: uid }).limit(500).get()
  for (const e of (exams.data || [])) {
    await db.collection('exams').doc(e._id).remove()
    total++
  }
  return { ok: true, message: `已清理用户 ${uid} 的 ${total} 个数据项（题库+考试）` }
}

async function clearPersonal() {
  let n = 0
  // 删除所有 private 题库及其题目
  const banks = await db.collection('quiz_banks').where({ visibility: 'private' }).limit(500).get()
  for (const b of (banks.data || [])) {
    await deleteBank(b._id, b._id)
    n++
  }
  // 删除所有 private 考试
  const exams = await db.collection('exams').where({ visibility: 'private' }).limit(500).get()
  for (const e of (exams.data || [])) {
    await db.collection('exams').doc(e._id).remove()
    n++
  }
  return { ok: true, message: `已清理 ${n} 个私人数据项（题库+考试）` }
}

// P2-39：这个 action 此前**什么都不做却返回 ok:true**（运维者会以为规则已经恢复）。
// 现改为明确返回「未实现」。⚠️ 有意**不**在这里实现它：
// 　· 改集合安全规则不在这份本地代码能做到的范围内（要经管理侧 API/脚本），本次授权也不含动云端配置；
// 　· 且该动作的去留属另一条待拍板项（见 campaign 的推迟项清单），不由本任务定。
// 真正的恢复路径仍是下面文案里的管理脚本，该脚本被 gitignore、不在公开仓库里。
async function resetExamsAcl() {
  return {
    ok: false,
    code: 'NOT_IMPLEMENTED',
    message: '该操作未实现，请用管理脚本 scripts/manage-acl.cjs restore（该脚本被 gitignore，不在公开仓库内）',
  }
}
