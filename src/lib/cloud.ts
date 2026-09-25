// 腾讯云 CloudBase 云同步模块
// 核心职责：
// 1. 匿名登录（每个设备独立身份）
// 2. 云数据库读写（6 个集合与本地 IndexedDB 对应）
// 3. 双向同步（启动拉取 + 改动推送，按 updated_at 解决冲突）
// 未配置时自动降级为纯本地模式，不抛错。

import { idb, normalizeTs } from './db'
import {
  addLedgerEntry,
  buildLedgerIndex,
  isSuppressed,
  loadLedger,
  type LedgerColl,
  type LedgerEntry,
  type LedgerIndex,
  type LedgerKV,
} from './sync-ledger'

// P2-7（T10a，2026-09-15）引入的时间戳归一化 helper 原本定义在本文件；
// T10b（2026-09-15）把它**搬到 `db.ts` 并在此重新导出**，原因：5 处 `last_review` 比较里有两处在
// `db.ts` 自己，而 `db.ts` 是本模块的**底层依赖**（本文件首行就 import 它）。若 `db.ts` 反过来
// import 本文件，就形成 `db.ts ⇄ cloud.ts` 循环依赖——本文件还带 SDK 动态加载与云状态，
// 让存储层依赖同步层不值得。搬到 db.ts 后：①无环，②`db.ts` 仍是零依赖的叶子模块，
// ③视图层两处比较可以直接从它们本来就 import 的 `../lib/db` 取（不必把 cloud.ts 静态拉进视图 chunk）。
// 导出面保持不变（`import { normalizeTs } from '../lib/cloud'` 依旧可用），调用口径仍是同一个函数。
export { normalizeTs }

// 集合名与本地 store 一一对应
export const CLOUD_COLLECTIONS = [
  'quiz_banks',
  'questions',
  'practice_records',
  'wrong_questions',
  'mastered_questions',
  'favorites',
  'settings',
] as const
export type CloudCollection = (typeof CLOUD_COLLECTIONS)[number]

// 删除账本只覆盖有「用户删除」语义的五个集合（settings 没有删除概念）
const LEDGER_COLLS = new Set<string>(['quiz_banks', 'questions', 'favorites', 'wrong_questions', 'mastered_questions'])

// 云同步配置（存 localStorage，避免进 IndexedDB 造成循环依赖）
const CFG_KEY = 'cloudbase_config'
interface CloudConfig {
  envId: string
  enabled: boolean
}

let app: any = null
let db: any = null
let auth: any = null
let authedUid: string | null = null
let syncChain: Promise<void> = Promise.resolve()

export const cloudState = {
  enabled: false,
  authed: false,
  syncing: false,
  lastSyncAt: null as string | null,
  error: null as string | null,
}

function getConfig(): CloudConfig | null {
  try {
    const raw = localStorage.getItem(CFG_KEY)
    if (!raw) return null
    const cfg = JSON.parse(raw) as CloudConfig
    if (!cfg.envId || !cfg.enabled) return null
    return cfg
  } catch { return null }
}

// 保存配置（由设置页调用）
export function setCloudConfig(envId: string, enabled: boolean): void {
  const cfg: CloudConfig = { envId, enabled }
  if (enabled && !envId) return
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg))
  cloudState.enabled = enabled
  if (!enabled) {
    app = null; db = null; auth = null; authedUid = null
    cloudState.authed = false
    cloudState.syncing = false
    cloudState.error = null
  }
}

export function isCloudEnabled(): boolean {
  const cfg = getConfig()
  return !!cfg
}

// 动态加载 SDK（保持主包轻量，未配置时不加载）
async function ensureApp(): Promise<boolean> {
  if (app) return true
  const cfg = getConfig()
  if (!cfg) return false
  try {
    const mod = await import('@cloudbase/js-sdk')
    const tcb = mod.default
    app = tcb.init({ env: cfg.envId })
    auth = app.auth({ persistence: 'local' })
    db = app.database()
    // 匿名登录
    try {
      // P2-3：改用 auth.getSession()（getLoginState 已废弃），resolveLoginUid 内部保留 getLoginState 回退
      const uid = await resolveLoginUid()
      if (uid) {
        authedUid = uid
      } else {
        // 未登录（session === undefined）→ 匿名登录；signIn() 可能返回 undefined（登录态存 SDK 内部），
        // 所以登录后必须重新取一次 uid
        await auth.anonymousAuthProvider().signIn()
        authedUid = await resolveLoginUid()
      }
      cloudState.authed = !!authedUid
      return !!authedUid
    } catch (e: any) {
      // 环境未开通匿名登录时降级
      console.warn('CloudBase 匿名登录失败：', e?.message || e)
      cloudState.error = '匿名登录失败：' + (e?.message || String(e))
      return false
    }
  } catch (e: any) {
    console.warn('CloudBase 初始化失败：', e?.message || e)
    cloudState.error = '初始化失败：' + (e?.message || String(e))
    return false
  }
}

// P2-3（T10a，2026-09-15）：取当前登录 uid。
// CloudBase AUTH-WEB-012 把 `auth.getLoginState()` 列为 error 级废弃，AUTH-WEB-008 要求改用
// `auth.getSession()` 并判 `data.session === undefined`（未登录时 session 为 undefined，不抛错）。
// ⚠️ 本机无法实盘验证运行时（GC1 禁止连云、无真实会话），故**保留 getLoginState 作为回退**：
//   - 已核对本地依赖 @cloudbase/js-sdk@3.7.1 的 core.d.ts：同一 Auth 类上 `getSession(): Promise<SignInRes>`
//     与 `getLoginState(): Promise<ILoginState | null>` 同时存在，两者都可用；
//   - 但 SignInRes 的 session 内层字段名未在该 d.ts 里展开（`type SignInRes = import('@cloudbase/auth').SignInRes`，
//     该包未随 SDK 落盘），`session.user.uid` 与 `session.uid` 都试一遍后才回落，避免不同版本差异（与 P1-15 同源）。
//   - 两条路都拿不到 uid 才返回 null → 调用方走匿名登录。
async function resolveLoginUid(): Promise<string | null> {
  try {
    if (auth && typeof auth.getSession === 'function') {
      const res: any = await auth.getSession()
      const session = res?.data?.session
      // 未登录：session === undefined（按 AUTH-WEB-008 的口径），此时不必再解析 uid
      if (session !== undefined) {
        const uid = session?.user?.uid || session?.uid || null
        if (uid) return uid
      }
    }
  } catch (e: any) {
    console.warn('auth.getSession 取登录态失败，回退 getLoginState：', e?.message || e)
  }
  try {
    const st2 = await auth.getLoginState()
    return st2?.user?.uid || st2?.uid || null
  } catch {
    return null
  }
}

function isAuthed(): boolean {
  return !!app && !!db && !!authedUid
}

// 服务端时间（用于 updated_at）
function now(): string { return new Date().toISOString() }

// 时间戳归一化比较（P2-7 / T10a 引入，T10b 起定义见 db.ts，本文件重新导出，见文件头注释）。
// 背景：网页端写的是 ISO 串（now() = toISOString），小程序端混进同一集合的是 Date.now() 数字
// （审计报告「updated_at 类型」一行：ISO 字符串 vs 数字），而两边都直接拿值比较/排序。
// 字典序下 `"2026-…" > "1789…"` 恒成立（"2" > "1"）⇒ 混合类型时「谁更新」判错。
// 归一成毫秒数后再比：数字原样；ISO 串/日期串走 Date.parse；数字字符串（"1789…"）按数字解析；
// 取不到时间 → 0（视为最早，不能当「最新」）。

// ===== 集合级操作 =====

// 同步昵称（跨设备身份）：设置页可自定义，默认随机生成；存 localStorage
// P1-12（T10b，2026-09-15）：sync_key 是用户自选昵称，却承担跨设备身份（云端按它区分数据归属）。
// GC2 下**不重构身份模型**（那要加属主字段 + 数据迁移，留给第四批），本任务只做三件「降风险」的事：
//   (a) 默认随机部分加长（见 randomBase36 注释）；
//   (b) 写入侧加最小长度/字符集校验 + 弱昵称碰撞提示（checkSyncKey / setSyncKey 返回值）；
//   (c) 设置页文案说明「昵称等同跨设备身份，勿用真实姓名」。
const SYNC_KEY_CFG = 'sync_nickname'
export const SYNC_KEY_MIN_LEN = 6
export const SYNC_KEY_MAX_LEN = 32
// 允许：中文、字母、数字、下划线、连字符（云端查询按字符串精确匹配，不含通配/引号等字符）
const SYNC_KEY_ALLOWED = /^[\u4e00-\u9fa5A-Za-z0-9_-]+$/
// 弱昵称：全数字、全同一字符（如 "111111"、"aaaaaa"）——这类昵称最容易被别人猜到/撞上
const SYNC_KEY_WEAK = /^[0-9]+$|^(.)\1+$/

// 随机 base36 串，长度**保证**为 len。原写法 `Math.random().toString(36).slice(2, 6)` 有个隐形坑：
// Math.random() 取值较小时 base36 串本身很短（如 0.5 → "0.i"），slice(2,6) 只会拿到 1 个字符，
// 即「4 位随机」有时只有 1~3 位。这里循环补齐，长度确定。
function randomBase36(len: number): string {
  let s = ''
  while (s.length < len) s += Math.random().toString(36).slice(2)
  return s.slice(0, len).toUpperCase()
}

export function getSyncKey(): string {
  try {
    const v = localStorage.getItem(SYNC_KEY_CFG)
    if (v) return v
  } catch { /* ignore */ }
  // (a) 随机部分 4 位 → 8 位：36^4 ≈ 1.7e6 撞名组合，36^8 ≈ 2.8e12（约 160 万倍），
  //     默认昵称被他人猜中/撞上从而互相覆盖云端数据的概率大幅下降。
  const gen = '兔子_' + randomBase36(8)
  try { localStorage.setItem(SYNC_KEY_CFG, gen) } catch { /* ignore */ }
  return gen
}

export interface SyncKeyCheck { ok: boolean; msg?: string; warn?: string }

// (b) 写入侧校验。**只在写入时校验，读取时绝不校验**——旧版本生成的短昵称（如 4 位、甚至 1 位）
// 必须仍能读回自己的数据，否则等于把老用户锁在数据外面。
export function checkSyncKey(name: string): SyncKeyCheck {
  const v = String(name ?? '').trim()
  if (!v) return { ok: false, msg: '同步昵称不能为空' }
  if (v.length < SYNC_KEY_MIN_LEN) {
    return { ok: false, msg: `同步昵称至少 ${SYNC_KEY_MIN_LEN} 个字符：太短的昵称容易被别人撞上，撞名会互相覆盖云端数据` }
  }
  if (v.length > SYNC_KEY_MAX_LEN) return { ok: false, msg: `同步昵称最长 ${SYNC_KEY_MAX_LEN} 个字符` }
  if (!SYNC_KEY_ALLOWED.test(v)) return { ok: false, msg: '同步昵称只能用中文、字母、数字、下划线或连字符' }
  if (SYNC_KEY_WEAK.test(v) || v.length < 8) {
    return { ok: true, warn: '昵称同时是跨设备身份标识，太短或太好猜容易被他人撞名并互相覆盖数据，建议 8 位以上、字母数字混合' }
  }
  return { ok: true }
}

// 设置同步昵称。返回值让调用方能如实提示（旧实现是 `void`，任何输入都被静默写入）。
export function setSyncKey(name: string): { ok: boolean; key: string; msg?: string; warn?: string } {
  const cur = getSyncKey()
  const r = checkSyncKey(name)
  if (!r.ok) return { ok: false, key: cur, msg: r.msg }
  const v = String(name).trim()
  try {
    localStorage.setItem(SYNC_KEY_CFG, v)
  } catch {
    return { ok: false, key: cur, msg: '保存失败：浏览器存储不可用（可能处于隐私模式）' }
  }
  return { ok: true, key: v, warn: r.warn }
}

// ===== 删除同步标记（2026-08-15，P1.2 修复）=====
// 问题：取消收藏/标记掌握/放回错题等「删除类」操作只删本地，云端旧文档残留，
//       pull 时会「复活」。方案：删除操作时把 {bank_id, question_id} 记入本地删除标记，
//       下次 push 时先按标记删除云端对应文档，成功后清空标记。
// 删除标记存储：localStorage 'sync_deleted' = { [coll]: [{bank_id, question_id}] }
const SYNC_DELETED_KEY = 'sync_deleted'

// T8b（2026-09-16）：`question_id` 随 `ExamQuestion.id` 一起放宽为 `number | string`。
// 该值只做两件事：等值比较（`markCloudDeleted` 里的 `some(...)`）与塞进 `where({ question_id })` 过滤条件，
// 都是字符串/数字通吃的；落盘是 JSON.stringify。故纯类型放宽、运行时行为不变。
// 2026-09-18 扩充（重审 A-15）：`question_id` 允许 `null` = **整库**语义
//   （`quiz_banks` 用不到 question_id；`questions` 传 null 表示"删该库的全部题目"）。
//   为什么不逐题打标记：一个 2000 题的题库会往 localStorage 写 2000 条标记，量级不可接受。
type DeletedMark = { bank_id: number; question_id: number | string | null; cloud_id?: string | null; at?: number; tries?: number }

function getDeletedMarks(): Record<string, DeletedMark[]> {
  try {
    const raw = localStorage.getItem(SYNC_DELETED_KEY)
    if (raw) {
      const obj = JSON.parse(raw)
      if (obj && typeof obj === 'object') return obj
    }
  } catch { /* ignore */ }
  return {}
}
function saveDeletedMarks(obj: Record<string, DeletedMark[]>): void {
  try { localStorage.setItem(SYNC_DELETED_KEY, JSON.stringify(obj)) } catch { /* ignore */ }
}

// ===== 删除账本接线（2026-09-24）=====
// 判据与理由全在 `sync-ledger.ts`（纯函数、跑 `node scripts/lib/sync-ledger.test.cjs` 验）；
// 这里只做两件事：接上 localStorage、在「删除发生的那一刻」记账。
//
// 为什么记账要在删除的那一刻、而不是等 push：
//   「下载」是独立的动作（不先 push）。删完立刻点下载时，若账本还没写，云端那条就又下来了。
function ledgerKV(): LedgerKV {
  try {
    const ls = window.localStorage
    return { getItem: k => ls.getItem(k), setItem: (k, v) => ls.setItem(k, v) }
  } catch {
    // 隐私模式 / 存储被禁：退化成内存账本，本会话内仍然生效（不抛错）
    const mem = new Map<string, string>()
    return { getItem: k => (mem.has(k) ? mem.get(k)! : null), setItem: (k, v) => { mem.set(k, v) } }
  }
}

/** 下载前建一次索引（账本上限 300 条，读一次就够） */
export function loadDeletedLedgerIndex(): LedgerIndex {
  return buildLedgerIndex(loadLedger(ledgerKV()))
}
// 记录一条删除标记（供 api 层在删除类操作时调用）
// T8b（2026-09-16）：`questionId` 随 `ExamQuestion.id` / `DeletedMark.question_id` 一起放宽，纯类型改动。
// A-15（2026-09-18）：`questionId` 可为 null —— 见上面 DeletedMark 的「整库」语义说明。
// 2026-09-24：补 `cloudId`（题库/题目的云端 `_id`，能拿到就带上，删除时按它精确定位；换过身份的
//   文档 `_local_id` 对不上，只有 `_id` 才认得出是同一份）＋ `at`（删除时刻，账本弱键的时间闸门），
//   并**同步写一笔删除账本** —— 账本是「下载时不要再拉回来」的终身凭据，与标记（待办）分开存。
export function markCloudDeleted(
  collection: CloudCollection, bankId: number, questionId: number | string | null,
  cloudId: string | null = null,
): void {
  const marks = getDeletedMarks()
  const list = marks[collection] || (marks[collection] = [])
  const hit = list.find(m => m.bank_id === bankId && m.question_id === questionId)
  if (hit) {
    // 老标记没带 cloud_id、这次拿到了 → 补上（删除时是按 _local_id 找的，那份可能永远找不到）
    if (cloudId && !hit.cloud_id) { hit.cloud_id = cloudId; saveDeletedMarks(marks) }
  } else {
    list.push({ bank_id: bankId, question_id: questionId, cloud_id: cloudId, at: Date.now() })
    saveDeletedMarks(marks)
  }
  recordDeletedLedger({
    coll: collection as LedgerColl,
    cloud_id: cloudId,
    local_id: bankId,
    question_id: questionId,
    sync_key: getSyncKey(),
    at: Date.now(),
  })
}

/** 记一笔账本（写盘在 sync-ledger.ts，坏存储不抛错） */
export function recordDeletedLedger(entry: LedgerEntry): void {
  addLedgerEntry(entry, ledgerKV())
}
// P0-2（T10a，2026-09-15）**删除必须带属主过滤**。
// 原实现只按 { _local_bank_id, question_id } 查删。⚠️ 2026-09-15 复核（含线上逐集合实读）更正两处：
//   ① 这段删除对账遍历的是**三个**集合（favorites / wrong_questions / mastered_questions），原文写「这两个集合」不准；
//   ② 三者的线上 ACL **并不相同**——`favorites` 与 `wrong_questions` 是 `{"read":"auth != null","write":"auth != null"}`
//      （对全体登录用户开放，这才是真风险）；而 `mastered_questions` 是 **PRIVATE**（谁都写不进去），
//      所以今天对它的删除标记其实是**无效操作**，要等 T18 把它的规则改成「属主可读写」之后才会生效。
// 于是用户 A 取消收藏会按同题号把用户 B 的文档一起删掉（单次最多 50 条），B 无任何感知。
// 裁定（控制端）：查询补 `_openid: authedUid` 作属主条件；`sync_key` 作第二重校验逐条比对；
// `limit` 只是请求量保护，**不得**当安全边界——安全边界是 where 里的属主条件。
//
// 不误伤自查（离线证据，未连云端）：backups/backup-2026-08-23T09-56-00-200Z 的三个集合 11190 条文档里，
//   ① `_openid` 全部是 22 位网页端 uid 字面量（与小程序端 28 位、`o` 开头的 openid 形态不同），
//      只有两个取值：dW_i8wJhNg1LuilSlOeM9Q（5735+112+118）、RxWhN7imfDEGs9MuDEsc4w（5455+80）；
//   ② pushOne 用 `'l'+coll+'_'+authedUid.slice(0,8)+'_'+id` 生成 _id，其前 8 位与同文档 `_openid` 头部一致的比例为
//      practice_records 10865/10880、favorites 156/192、wrong_questions 58/118。
//      ⚠️ 2026-09-15 复审更正：**不匹配的那些不能一概用「cloud_id 复用」解释**——例如 favorites 36/192、
//      wrong_questions 60/118 的 `_id` 是 **32 位 hex** 形态，而本函数生成的 `_id` 是
//      `l<coll>_<uid 前 8 位>_<id>` 的形态，两者根本不同源。→ 结论（`_openid` == authedUid）不变，
//      但「不匹配 = cloud_id 复用」这个解释只覆盖其中一部分，剩下的来源未查明（记为 T17 核对项）。
//   ③ 与仓库既有口径一致：本文件 pullCollection 里的本人拉取 `where({ _openid: authedUid })`，
//      以及 exam.ts 的 `where({ _openid: uid })` / isExamOwner，早就在用同一等价关系。
// 残留边界（偏安全侧）：网页端换过身份时（绑小程序之前写的匿名 uid，或登出后重新匿名拿到的新 uid），
//   旧文档 `_openid` != 当前 authedUid ⇒ 这些「自己的旧文档」删不掉，下次按 sync_key 拉取时会复活。
//   这是「宁可删不掉，不可删他人」的方向，符合 P0-2 的优先级。
// 删除标记 → 云端查询条件（**按集合分流**，2026-09-18 随 A-15 新增 quiz_banks/questions 两种形态）：
//   · favorites / wrong_questions / mastered_questions：pushOne 写的是 `_local_bank_id` + `question_id`
//   · questions：写的是 `_local_bank_id` + `_local_id`（题目本地 id）；`question_id === null` ⇒ 整个题库的题
//   · quiz_banks：只写 `_local_id`（本地题库 id），与 question_id 无关
//
// 2026-09-24（rabbit 报「删掉一同步又回来」）：**知道 cloud_id 时改用云端 `_id` 定位**。
//   原因：`_local_id` 只是「推送它的那台设备当时分配的本地 id」，换过设备/身份后对不上号
//   （云端文档 `_openid` 是旧 uid 时，用它做条件的删除命中 0 条，而「命中 0 条」被当成删成功 ⇒ 复活）。
//   题目的整库/逐题删除同理，改用 `bank_ref`（题库云端 `_id`，pushOne 写入）锚定。
//   两个形态都带 `_openid` 属主条件 —— 集合 ACL 要求查询条件是规则子集（write: doc._openid == auth.openid）。
//
// 2026-09-24（**实测到 403 之后补**）：`quiz_banks`/`questions` 的写规则是**合取**——
//   `doc._openid == auth.openid && doc.visibility != "public"`，**两半都要体现在查询里**，否则整条被拒。
//   第一版改完只加了 `_id`/`bank_ref`，实测 `where({_id, _openid}).remove()` 直接 **403 Permission denied**，
//   标记重试到上限后只能靠账本兜底。现在按 pushDoc 里那份实测矩阵的同款写法补上 `visibility: _.neq('public')`。
//   ⚠️ 这也解释了 rabbit 报的「删掉又回来」：**原实现的 where 从来没过 ACL 这一关**（09-18 写下、没人真跑过）。
function visibilityGuard(): any {
  return db.command.neq('public')
}
/** 单条删除的条件：`_id` + 属主，**且**（只对 quiz_banks/questions）带上规则的另一半 visibility */
function removeWhere(r: any, coll: CloudCollection): Record<string, any> {
  const w: Record<string, any> = { _id: r._id, _openid: authedUid }
  if (coll === 'quiz_banks' || coll === 'questions') w.visibility = visibilityGuard()
  return w
}
function deletedMarkWhere(coll: CloudCollection, m: DeletedMark): Record<string, any> {
  const vis = visibilityGuard()
  if (coll === 'quiz_banks') {
    return m.cloud_id
      ? { _id: m.cloud_id, _openid: authedUid, visibility: vis }
      : { _local_id: m.bank_id, _openid: authedUid, visibility: vis }
  }
  if (coll === 'questions') {
    if (m.question_id == null) {
      return m.cloud_id
        ? { bank_ref: m.cloud_id, _openid: authedUid, visibility: vis }
        : { _local_bank_id: m.bank_id, _openid: authedUid, visibility: vis }
    }
    return m.cloud_id
      ? { bank_ref: m.cloud_id, _local_id: m.question_id, _openid: authedUid, visibility: vis }
      : { _local_bank_id: m.bank_id, _local_id: m.question_id, _openid: authedUid, visibility: vis }
  }
  return { _local_bank_id: m.bank_id, question_id: m.question_id, _openid: authedUid }
}

async function removeCloudDocsByMark(coll: CloudCollection, m: DeletedMark, syncKey: string): Promise<void> {
  // 分页只为请求量保护（每轮 100 条）：删除会让结果集变小，所以固定从头部重查，最多 20 轮防死循环。
  for (let round = 0; round < 20; round++) {
    const res = await withTimeout(
      db.collection(coll)
        .where(deletedMarkWhere(coll, m))
        .limit(100)
        .get(),
      20000, '删除同步',
    )
    const rows = Array.isArray(res.data) ? res.data : []
    if (!rows.length) return
    let removed = 0
    let failed = 0
    for (const r of rows) {
      // 第二重校验：sync_key 不符 = 不是当前同步身份的文档（他人 / 自己换过昵称留下的）→ 不删。
      // 云端文档缺 sync_key 时无从比对，但属主已由 where 的 `_openid` 条件保证，故放行。
      const sk = r.sync_key
      if (typeof sk === 'string' && sk && sk !== syncKey) {
        console.warn(`删除同步：跳过 sync_key 不符的 ${coll} 文档 ${r._id}`)
        continue
      }
      // T18-2a（2026-09-16）：删除从 `doc(id).remove()` 改为 `where({_id, _openid}).remove()`。
      // 属主型写规则（`doc._openid == auth.openid`）下客户端查询条件必须是规则子集，
      // `doc(id)` 形态连属主自己都会被拒（campaign 实盘地雷）。r 来自上面 `where({_openid: authedUid})`
      // 的查询结果，`_id` + `_openid` 双等值条件命中至多一行，语义与单文档删除等价。
      // 2026-09-24：**这一句才是真正被 ACL 拒的地方**（上面那句只是查询，删不删得动看这里）。
      //   实测矩阵（自有探针文档，见本文件底部的临时探针记录）：
      //     `where({_id,_openid}).remove()`                    → 403 Permission denied
      //     `where({_id,_openid,visibility:_.neq('public')}).remove()` → OK（删 1 条）
      //   所以 `quiz_banks`/`questions` 必须把规则的**另一半**（`visibility != "public"`）也带上。
      try {
        await withTimeout(db.collection(coll).where(removeWhere(r, coll)).remove(), 20000, '删除同步')
        removed++
      } catch (e: any) {
        // 2026-09-18 修复（重审 A-02）：原来这里是空的 catch——单条失败被吞掉，与本轮"没东西可删"
        // 返回同一个结果，调用方于是把整个集合的删除标记清掉 ⇒ 云端那条仍在，下一次 syncFromCloud
        // 按 sync_key 把它拉回来、界面上的收藏/错题**自己复活**（用户只看到「同步完成」）。
        // 现在如实计数并上抛，由 applyDeletedMarks 决定"留着下轮重试"还是"放弃"。
        failed++
        console.warn(`删除同步：${coll} 文档 ${r._id} 删除失败：`, e?.message || e)
      }
    }
    // 只要有失败的就不算删干净：上抛让标记留下来（下面 applyDeletedMarks 有重试上限兜底）
    if (failed) throw new Error(`删除同步未全部完成：${coll} 本轮 ${failed}/${rows.length} 条失败`)
    // 本页没有可删的（全被第二重校验挡下）或已到最后一页 → 结束
    if (removed === 0 || rows.length < 100) return
  }
}

// 删除标记连续失败的次数上限：到顶就放弃该标记并明说（云端那条可能残留，但至少不再每次同步空转）。
// 为什么需要上限：有些集合线上根本删不动（例如 `mastered_questions` 线上是 PRIVATE，见约束 §5 P1-13），
// 若"删不干净就永远留着"，标记会无限累积且每轮同步都重试一次。3 次足够覆盖弱网抖动。
const DELETED_MARK_MAX_TRIES = 3

// 推送前：按删除标记清理云端旧文档。**删干净才清标记**；失败的留着重试，连续失败到上限才放弃并告警。
async function applyDeletedMarks(): Promise<void> {
  if (!isAuthed()) return
  const marks = getDeletedMarks()
  let changed = false
  const syncKey = getSyncKey()
  // 2026-09-18 修复（重审 A-15）：原列表只有三个「记录类」集合，**删题库/删题目没有任何云端删除通道**
  //   （`scheduleCloudPush` 是空函数、本地删除又只动 IndexedDB）⇒ 下一次同步把整库原题从云端拉回来「复活」。
  //   现在补上 `questions` 与 `quiz_banks`：删除时由 api 层打标记（整库用 `question_id: null`），
  //   在这里按集合分流的 where 删云端文档（见 deletedMarkWhere）。
  for (const coll of ['favorites', 'wrong_questions', 'mastered_questions', 'questions', 'quiz_banks'] as CloudCollection[]) {
    const list = marks[coll]
    if (!list || !list.length) continue
    const kept: DeletedMark[] = []
    for (const m of list) {
      try {
        // 云端记录 push 时带 _local_bank_id（本地题库 id）+ question_id（+ _openid 属主）→ where 精确查删
        await removeCloudDocsByMark(coll, m, syncKey)
      } catch (e: any) {
        // 2026-09-18 修复（重审 A-02）：失败**不再**无条件丢弃标记（原实现在下面 `delete marks[coll]`，
        // 等于"试过就清"，弱网下一次取消收藏就会静默丢失、下次拉取复活）。
        const tries = Number((m as any).tries || 0) + 1
        if (tries >= DELETED_MARK_MAX_TRIES) {
          console.warn(`清理云端 ${coll} 删除标记连续 ${tries} 次失败，放弃该标记（云端那条可能残留）：`, e?.message || e)
        } else {
          kept.push({ ...m, tries } as DeletedMark)
          console.warn(`清理云端 ${coll} 删除标记失败（保留待重试 ${tries}/${DELETED_MARK_MAX_TRIES}）：`, e?.message || e)
        }
      }
    }
    if (kept.length) marks[coll] = kept
    else delete marks[coll]
    changed = true
  }
  if (changed) saveDeletedMarks(marks)
}

// 当前用户 _id 前缀（同设备稳定；配合 cloud_id 保持跨设备同昵称下身份一致）
function uidPrefix(): string {
  return (authedUid || 'anon').slice(0, 8)
}

// 超时保护：CloudBase 请求异常挂起时避免页面永远卡在"同步中"（2026-08-16 手机端反馈：
// 无超时 → syncAll 挂起 → cloudSyncing 永远 true → 设置页两个按钮禁用，点啥都没反应）
function withTimeout<T>(p: Promise<T>, ms = 20000, label = '同步请求'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}超时（${ms / 1000}s），请检查网络后重试`)), ms)
    p.then(
      v => { clearTimeout(timer); resolve(v) },
      e => { clearTimeout(timer); reject(e) },
    )
  })
}

// 推送单条文档（2026-08-15 实测确定的可靠写法）：
// - doc(id).get() 在 ACL 下永远返回空 → 无法判断存在
// - doc(id).set()/update() 在 write 规则为 doc._openid==auth.openid 时「假成功」（不写入）；
//   规则改为 write: auth != null 后 update 生效（实测）
// - add 带 _id：首次创建 ✓，重复静默忽略（不更新）
// → 双写：先 add（保证首次创建），再 update 不带 _id（保证最新内容覆盖）
// 2026-08-21 修复：此前 .catch(() => {}) 吞掉所有错误（含网络错误/超时），网络断时同步显示成功但实际 0 写入（假成功）。
// 现在按错误类型区分：重复 _id（add）/ 文档不存在（update）属正常路径静默；其余错误（网络、权限）上抛，
// 由 pushToCloud 捕获并提示「推送失败」，用户可感知。
function isIgnorableSyncError(e: any): boolean {
  const msg = String(e?.message || e)
  return /duplicate|already\s*exists|已存在|not\s*exist|不存在/i.test(msg)
}
// 返回值语义（2026-09-18 修复 A-03 时改明确）：
//   true  = 已写入云端；false = **跳过**（未登录，或 public 文档客户端无权写）。
//   失败仍走 throw（由 pushOne 的调用方计入 failed）。
//   为什么必须把「跳过」与「成功」分开：原来跳过返回 null、而 pushOne **丢掉了返回值**，
//   照样 `markSynced` + 计 `pushed++` ⇒ 对公共题库/公共题的本地改动被永久丢弃且无人知情。
async function pushDoc(collection: CloudCollection, doc: any): Promise<boolean> {
  if (!isAuthed()) return false
  const coll = db.collection(collection)
  const id = doc._id || doc.cloud_id
  // T18（2026-09-15 夜间，沙盒集合 acl_probe_tmp 实测）：推送前必须剥掉 `_openid`。
  // 实测 ①：`_openid` 由客户端传什么就存什么（不清洗）；不传时才由平台按登录态自动填。因此在
  //   `create: "doc._openid == auth.openid"` 这类规则下，**自报别人的 _openid 会被拒**（两端各测
  //   省略/自填/冒充三例，结果全对：省略✓ 自填✓ 冒充✗）。
  // 实测 ②：本文件的拉取路径 writeLocal 是 `const r = { ...doc }` 整份拷贝云端文档，**云端 `_openid`
  //   会跟着进本地行**；pushOne 又以 `{ ...r }` 回推 ⇒ 换浏览器/换设备时，会把**别人的 `_openid`**
  //   写成新文档的属主。这既是「favorites 192 条里 36 条 `_openid` 与 `_id` 前缀不一致」的最可能来源，
  //   也是任何「属主可写」类规则上线前必须先堵的口子（否则那 36 条一推就 403）。
  // 参照：小程序端早就是这么处理的——yuntu-mp/src/lib/cloud.ts:691 `const { _id, _openid, ...rest } = r`。
  const { _openid, _id, ...rest } = doc // _id / _openid 均为系统字段，add 时另行显式带上 _id
  // T18-2f（2026-09-16，用户在线上看到「3148 条推送失败」后定位）：`quiz_banks` / `questions` 的线上写规则是
  //   `doc._openid == auth.openid && doc.visibility != "public"`
  // ——**两个条件都必须体现在客户端查询/写入里**，否则整条被拒（"查询条件必须是规则子集"的合取形态）。
  // 实测矩阵（控制端用自有临时文档探针，非用户数据）：
  //   `add({...})` 不带 visibility            → **DENIED**（本地题目行本来就没有这个字段 ⇒ 每次推送题目都拒）
  //   `add({...， visibility:'private'})`      → OK
  //   `where({_id,_openid}).update(...)`        → **DENIED**（缺 visibility 那一半）
  //   `where({_id,_openid,visibility:_.neq('public')}).update(...)` → OK
  //   `doc(id).update(...)`                     → DENIED（旧的写法，同因）
  // ⇒ 对这两个集合：新建补 `visibility`（缺省 private）、更新/删除把 `visibility != 'public'` 写进条件。
  const NEED_VIS = collection === 'quiz_banks' || collection === 'questions'
  let body: any = rest
  if (NEED_VIS) {
    const v = (rest as any).visibility
    if (v === 'public') {
      // 公共题库/题目的写权在服务端（规则明确禁止客户端改 public）→ 跳过，**不计入失败**。
      // 2026-09-18（A-03）：返回 false 而不是 null——调用方要能和「成功」区分开，
      // 否则这条本地改动会被当成已同步（详见 pushDoc 顶部的返回值说明）。
      console.warn(`推送 ${collection} 跳过：public 文档客户端无权写（${String(id)}）`)
      return false
    }
    body = { ...rest, visibility: v || 'private' }
  }
  try {
    if (id) {
      await withTimeout(coll.add({ ...body, _id: id, updated_at: now() }).catch((e: any) => { if (!isIgnorableSyncError(e)) throw e }), 20000, '推送')
      // T18-2a（2026-09-16）：`doc(id).update()` 改 `where({_id, _openid: authedUid}).update()`
      // T18-2f：这两个集合还要带上 `visibility != 'public'`，否则整条被拒（见上）
      const where: any = { _id: id, _openid: authedUid }
      // 2026-09-18 修复（重审 A-01 / V-5）：原写作 `db().command`，**这是从小程序端同名文件照抄过来的**——
      //   yuntu-mp/src/lib/cloud.ts:26 的 `db` 是函数（`function db() {…}`），那边 `db().command` 是对的；
      //   而本文件 `db` 是实例（`:39 let db: any = null` → `:91 db = app.database()`），调用形态必抛
      //   `TypeError: db is not a function`。后果：`quiz_banks`/`questions` 的**每一次内容更新推送**都在这里炸，
      //   自 09-16（`0150a5d`）起已有题库/题目一条都更新不上去，用户只看到笼统的「推送失败」。
      //   本文件其余用法（`:296` / `:317` / `:379` / `:463`）全是属性形态 `db.collection(…)`，只有这一处是调用形态。
      //   编译器抓不到：`db` 声明为 `any`（这正是类型基线里 cloud.ts 占 9 条错误却漏掉本缺陷的原因）。
      //   ⇒ 两仓 `cloud.ts` 是**有意分叉**的两个文件（`parser.ts`/`spaced-repetition.ts` 才要求逐字节相同），
      //     跨端照抄表达式前必须先确认宿主标识符的形态一致。
      if (NEED_VIS) where.visibility = db.command.neq('public')
      await withTimeout(coll.where(where).update({ ...body, updated_at: now() }).catch((e: any) => { if (!isIgnorableSyncError(e)) throw e }), 20000, '更新')
      return true
    } else {
      await withTimeout(coll.add({ ...body, updated_at: now() }), 20000, '新增')
      return true
    }
  } catch (e: any) {
    console.warn(`CloudBase 推送 ${collection} 失败：`, e?.message || e)
    throw e
  }
}

// 分页拉取一个查询的全部结果
// P1-19（T10b，2026-09-15）：截断不再静默。
// 原实现 `skip > 8000` 直接 break：调用方无从得知「拉到的不是全部」，用户看到「同步完成」而数据少了一截。
// 现在① 命中上限打 console.warn，② 向上返回 truncated 标志，由 syncFromCloud → syncAll 传给设置页提示用户。
// 上限的**数值边界与修复前逐字一致**（`skip > 8000`，即最多 81 页 / 8100 条）——本次只加告警与标志，不改行为。
// 注释里原先写「公共题现有 7049 道」：该数字早已过期（线上 23103），写死数量只会再次误导，故不再写死。
async function pullAll(coll: any, query: any, label = ''): Promise<{ rows: any[]; truncated: boolean }> {
  const all: any[] = []
  const pageSize = 100
  const MAX_SKIP = 8000
  let skip = 0
  let truncated = false
  for (;;) {
    const res = await withTimeout(query.skip(skip).limit(pageSize).get(), 20000, '拉取')
    const rows = Array.isArray(res.data) ? res.data : []
    all.push(...rows)
    if (rows.length < pageSize) break
    skip += pageSize
    if (skip > MAX_SKIP) {
      // 命中上限：最后一页是满页 ⇒ 后面**可能**还有数据，无法区分「刚好 8100 条」与「不止 8100 条」，一律按可能截断告警
      truncated = true
      break
    }
  }
  if (truncated) {
    console.warn(`拉取${label ? `（${label}）` : ''}达到分页上限：本次只取了前 ${all.length} 条，可能还有更多数据未同步`)
  }
  return { rows: all, truncated }
}

async function pullCollection(collection: CloudCollection, localIds: Set<string>): Promise<{ docs: any[]; truncated: boolean }> {
  if (!isAuthed()) return { docs: [], truncated: false }
  const coll = db.collection(collection)
  const all: any[] = []
  // CloudBase ACL：不带 where 条件的查询会被 ACL 拒绝返回空（实测）
  // 因此必须带条件查询：本人数据 = _openid == 当前 uid（同设备稳定）；换设备用 sync_key 昵称
  // 2026-08-16 对齐「只同步私人数据」约定：不再拉取公共题库/公共题（visibility public）。
  // 此前拉公共数据会把公共题 _local_id 当本地 id put 覆盖「添加到我的题库」的 private 副本，导致副本题目丢失。
  // 公共题库刷题走云端直读（listPublicBanks / listPublicBankQuestions），无需本地缓存。
  const seen = new Set<string>()
  const syncKey = getSyncKey()
  let truncated = false

  // 拉取本人数据（优先按 sync_key 昵称，失败/空则按 _openid；ACL 放开前昵称查询返回空）
  const mineQueries: any[] = []
  if (syncKey) {
    try {
      const byKey = await pullAll(coll, coll.where({ sync_key: syncKey }).orderBy('updated_at', 'desc'), collection + ':sync_key')
      if (byKey.truncated) truncated = true
      if (byKey.rows.length) mineQueries.push(byKey.rows)
    } catch (e: any) { console.warn(`拉取 ${collection} sync_key 数据失败：`, e?.message || e) }
  }
  try {
    const byUid = await pullAll(coll, coll.where({ _openid: authedUid }).orderBy('updated_at', 'desc'), collection + ':_openid')
    if (byUid.truncated) truncated = true
    if (byUid.rows.length) mineQueries.push(byUid.rows)
  } catch (e: any) { console.warn(`拉取 ${collection} 本人数据失败：`, e?.message || e) }
  for (const rows of mineQueries) {
    for (const d of rows) {
      // 2026-08-23：只同步私人数据——公共题库（visibility=public）不拉进本地。
      // 公共题库本就云端直读（listPublicBanks），本地只应保留用户自己的私人题库。
      // 此前会把公共库空壳拉进本地（0 题），造成「我的题库」区出现空公共库。
      if (collection === 'quiz_banks' && d.visibility === 'public') continue
      const key = String(d._id ?? d.id)
      if (!seen.has(key)) { seen.add(key); all.push(d) }
    }
  }
  return { docs: all, truncated }
}

// ===== 同步 =====

// 全量同步：云端 → 本地（合并，updated_at 新的赢）
// P1-19：返回值加 truncated —— 拉取命中分页上限时为 true。截断**不是错误**（同步确实完成了一部分），
// 所以不写 cloudState.error（那会让状态行显示成失败），只如实向上返回，由设置页附加提示。
// 2026-09-24：返回值加 suppressed —— 命中**删除账本**（本机删过的云端文档）而主动跳过的条数。
//   这与 truncated 一样属于「如实告知、不是失败」：用户删过的东西不再回来，是预期行为。
export async function syncFromCloud(): Promise<{ pulled: number; truncated: boolean; suppressed: number }> {
  if (!(await ensureApp())) return { pulled: 0, truncated: false, suppressed: 0 }
  if (!isAuthed()) return { pulled: 0, truncated: false, suppressed: 0 }
  cloudState.syncing = true
  cloudState.error = null
  try {
    let pulled = 0
    let truncated = false
    let suppressed = 0
    resetSyncCaches() // 2026-08-23：每次同步重建 cloud_id/stem/题库 索引（防缓存过期）
    const ledgerIndex = loadDeletedLedgerIndex() // 2026-09-24：删除账本（本机删过的不再下载）
    for (const coll of CLOUD_COLLECTIONS) {
      const pulledColl = await pullCollection(coll, new Set())
      if (pulledColl.truncated) truncated = true
      const cloudDocs = pulledColl.docs
      if (!cloudDocs.length) continue
      // 本地对应的记录（按 id 映射）
      const localMap: Map<string, any> = new Map()
      const localRows = await listLocalAll(coll)
      for (const r of localRows) {
        localMap.set(String(r.id ?? r._id), r)
        if (r.cloud_id) localMap.set('cid:' + r.cloud_id, r)
      }

      for (const cd of cloudDocs) {
        // 删除账本命中：这份云端文档本机删过（且它比删除时刻旧），跳过 —— 这就是「删掉的别回来」的闸门。
        // 放在写入之前，且不动 localMap：本地那份已经不存在了，没有可比较的时间。
        if (LEDGER_COLLS.has(coll) && isSuppressed(ledgerIndex, coll as LedgerColl, cd)) {
          suppressed++
          continue
        }
        // 2026-08-16 修复：云端文档 push 时 id 被删、只留 _id + _local_id（数字），
        // 原逻辑 String(cd.id ?? cd._id) 永远匹配不上本地数字 id → 每次全量重写且 updated_at 冲突比较失效。
        // 优先用 _local_id 匹配本地，其次 cloud_id，最后回退 _id。
        const localId = String(cd._local_id ?? cd.id ?? cd._id)
        const local = localMap.get(localId) || (cd._id ? localMap.get('cid:' + cd._id) : undefined)
        // P2-7（T10a）：updated_at 类型混合（网页端 ISO 串 / 小程序端数字）→ 必须归一后比较，
        // 直接字典序比较时 `"2026-…" > "1789…"` 恒成立，会把云端更旧的判断成更新。
        // 相等时**保留云端**：同一毫秒的更新若判本地较新就永远推不上去（云端那份丢）。
        // 例外：两边都取不到有效时间（normalizeTs 均为 0，例如远古文档没有 updated_at）时不写，
        //       避免每次同步都做无意义的本地重写（与 writeLocal 里 practice_records 去重那段同因）。
        const cloudTs = normalizeTs(cd.updated_at)
        const localTs = local ? normalizeTs(local.updated_at) : 0
        if (!local || cloudTs > localTs || (cloudTs === localTs && cloudTs > 0)) {
          // 云端较新（或本地没有）→ 写入本地；2026-08-23 计数修复：pulled 只统计真正新增的题目，
          // 避免"遍历的云端文档数"虚高（此前导入干净备份后显示拉取 15800，实际云端只 14088）
          const type = await writeLocal(coll, cd)
          if (type === 'added') pulled++
        }
      }
    }
    cloudState.lastSyncAt = now()
    return { pulled, truncated, suppressed }
  } catch (e: any) {
    cloudState.error = '同步失败：' + (e?.message || String(e))
    console.warn('syncFromCloud 失败：', e)
    return { pulled: 0, truncated: false, suppressed: 0 }
  } finally {
    cloudState.syncing = false
  }
}

// 本地 → 云端（推送本设备私人数据；公共数据人人可读无需同步，rabbit 2026-08-15 明确）
// 2026-08-21 性能优化（方案 A+B，解决「云同步速度慢」）：
// - A 并发推送：逐条串行改为 6 并发批量（Promise.allSettled），单条失败不中断整体，最后汇总失败数提示
// - B 增量推送：本地记录带 synced_at（最近成功推送时间）。有 synced_at = 已同步未改动 → 跳过；
//   本地写操作会清掉/不带 synced_at（标脏）→ 下次推送自动补推；推送成功后回写 synced_at；
//   云端拉取写入（writeLocal）也带 synced_at → 不会又被推回去。
//   settings 集合量小（5 条）且 key 结构特殊，保持全推不参与增量。
// #36（T10b，2026-09-15）：返回值补 failed —— 推送侧的部分失败数要能被 syncAll 汇总。
// 原先只有 `cloudState.error` 一条通道，而它会被紧随其后的 `syncFromCloud` 首句 `cloudState.error = null`
// 抹掉（见 syncAll 内注释），导致「推送部分失败」回到设置页时变成「同步完成」。
export async function pushToCloud(): Promise<{ pushed: number; failed: number; skipped: number }> {
  if (!(await ensureApp())) return { pushed: 0, failed: 0, skipped: 0 }
  if (!isAuthed()) return { pushed: 0, failed: 0, skipped: 0 }
  cloudState.syncing = true
  cloudState.error = null
  const syncKey = getSyncKey()
  const PUSH_CONCURRENCY = 6 // 并发上限（腾讯云数据库 API 限流安全值）
  try {
    let pushed = 0
    let failed = 0
    let skipped = 0   // A-03：客户端无权写的公共内容（不算成功、也不算失败，单独报给用户）
    // 先处理删除标记：取消收藏/标记掌握/放回等删除类操作同步到云端（P1.2 修复）
    await applyDeletedMarks()
    for (const coll of CLOUD_COLLECTIONS) {
      const localRows = await listLocalAll(coll)
      // 增量过滤：有 synced_at = 已同步且本地未改动 → 跳过；settings 永远全推（量小）
      let dirty = coll === 'settings' ? localRows : localRows.filter(r => !r.synced_at)
      // 2026-08-23 推送侧去重（防本地重复题反复上传）：
      // 题目若因历史叠加在本地产生同 bank_ref + stem 的多份副本（都无 synced_at），
      // 只推内容唯一的一条，其余视为同源跳过——避免推送侧再次放大云端重复。
      if (coll === 'questions') {
        const seenByStem = new Set<string>()
        dirty = dirty.filter(r => {
          const key = String(r.bank_ref ?? r._local_bank_id ?? r.bank_id ?? '') + '||' + String(r.stem || '').trim()
          if (seenByStem.has(key)) return false
          seenByStem.add(key)
          return true
        })
      }
      for (let i = 0; i < dirty.length; i += PUSH_CONCURRENCY) {
        const batch = dirty.slice(i, i + PUSH_CONCURRENCY)
        const results = await Promise.allSettled(batch.map(r => pushOne(coll, r, syncKey)))
        for (const res of results) {
          if (res.status === 'fulfilled' && res.value === 'pushed') pushed++
          else if (res.status === 'fulfilled' && res.value === 'skipped') skipped++
          else if (res.status === 'rejected') {
            failed++
            console.warn(`推送 ${coll} 失败：`, res.reason?.message || res.reason)
          }
        }
      }
    }
    cloudState.lastSyncAt = now()
    if (failed > 0) {
      cloudState.error = `推送完成，但有 ${failed} 条记录推送失败（网络或权限问题），请稍后重试`
    }
    // #36：把两侧结果一起返回（failed 见 pushToCloud；error 见下方汇总后的 cloudState.error）
    return { pushed, failed, skipped }
  } catch (e: any) {
    cloudState.error = '推送失败：' + (e?.message || String(e))
    console.warn('pushToCloud 失败：', e)
    // 整轮中断，具体失败条数未知（失败原因由 cloudState.error 承载）
    return { pushed: 0, failed: 0, skipped: 0 }
  } finally {
    cloudState.syncing = false
  }
}

// 推送单条本地记录（原 pushToCloud 循环体拆出）→ 'pushed' 已写入 / 'skipped' 客户端无权写（public）
async function pushOne(coll: CloudCollection, r: any, syncKey: string): Promise<'pushed' | 'skipped'> {
  const doc = { ...r, sync_key: syncKey }
  if (typeof doc.id === 'number') {
    // 有 cloud_id 则沿用云端身份（同昵称换设备不重复创建）；否则用 uid 前缀防撞
    doc._id = doc.cloud_id || ('l' + coll + '_' + uidPrefix() + '_' + doc.id)
    doc._local_id = doc.id
    delete doc.id
  }
  if (coll === 'questions' && typeof doc._bank_id === 'number') {
    doc._local_bank_id = doc._bank_id
    // 题目继承所属题库的可见性（ACL 用 doc.visibility 判断公共/私有）
    const bank = await idb.getBank?.(doc._bank_id).catch?.(() => null)
    doc.visibility = bank?.visibility || doc.visibility || 'public'
    // 记录题库的云端 _id（若该题库已同步过），供公共题库跨用户关联题目
    if (bank?.cloud_id) doc.bank_ref = bank.cloud_id
    delete doc._bank_id
  }
  if ((coll === 'practice_records' || coll === 'wrong_questions' || coll === 'mastered_questions' || coll === 'favorites') && typeof doc.bank_id === 'number') {
    doc._local_bank_id = doc.bank_id
    // 保留 bank_id 供云端统计；拉取时用 _local_bank_id 回映
  }
  const ok = await pushDoc(coll, doc)
  // 2026-09-18 修复（重审 A-03）：无论成功还是「跳过」都要回写 synced_at——被跳过的那条本地改动
  //   永远推不上去（公共内容客户端无权写），不标就会每轮同步都重试并刷日志。
  //   但**绝不把它谎报为 pushed**：计数交给 pushToCloud 的 skipped，并一路报到设置页文案。
  await markSynced(coll, r, doc._id ? String(doc._id) : null)
  return ok ? 'pushed' : 'skipped'
}

// 推送成功后回写本地：synced_at（增量标记）；quiz_banks/questions 同时回写 cloud_id（云端身份）
async function markSynced(coll: CloudCollection, r: any, cloudId: string | null): Promise<void> {
  try {
    let row: any
    if (coll === 'questions') {
      // 剥离 listAllQuestions 附加的冗余字段，避免污染 IndexedDB
      const { _bank_id, _bank_visibility, cloud_shared, ...rest } = r
      row = { ...rest }
    } else if (coll === 'settings') {
      // settings 无 id（keyPath=key），_id 是推送用字段，回写时剥掉
      const { _id, ...rest } = r
      row = { ...rest }
    } else {
      row = { ...r }
    }
    if ((coll === 'quiz_banks' || coll === 'questions') && cloudId) row.cloud_id = cloudId
    row.synced_at = now()
    await idb.bulkPut(coll, [row])
  } catch (e: any) {
    console.warn(`回写 ${coll} 同步标记失败：`, e?.message || e)
  }
}

// 拉取写入后补同步标记：wrong/mastered/favorites 按 (bank_id, question_id) 定位回写
// （云端拉下来的数据视为已同步，避免下次推送又推回去；全表扫量级小，可接受）
async function stampSyncedByKey(coll: 'wrong_questions' | 'mastered_questions' | 'favorites', bankId: number, questionId: number): Promise<void> {
  try {
    const rows = await idb.listAll(coll)
    const rec = rows.find(x => x.bank_id === bankId && x.question_id === questionId)
    if (rec) await idb.bulkPut(coll, [{ ...rec, synced_at: now() }])
  } catch (e: any) {
    console.warn(`补写 ${coll} 同步标记失败：`, e?.message || e)
  }
}

// 全量双向同步（设置页按钮调用）
// P1-19：把拉取侧的 truncated 一并上抛，供设置页提示「有数据超出单次同步上限，未同步完整」。
// #36（T10b，2026-09-15）：原先推送侧部分失败（pushToCloud 里写 cloudState.error）会被紧跟其后的
//   syncFromCloud **首句 `cloudState.error = null`** 抹掉 ⇒ 设置页看到的是「同步完成」（T8a 复审 MF-2）。
//   修法：进入拉取前先记下推送侧的 error，拉取结束后若拉取侧没有写出新的 error，就把它放回 cloudState；
//   并把 failed / truncated / error 一并返回给调用方，让提示按两侧的真实结果分流。
// 2026-09-24：把拉取侧的 suppressed（命中删除账本、主动跳过的条数）一并上抛，设置页如实告知。
export async function syncAll(): Promise<{ pulled: number; pushed: number; failed: number; skipped: number; truncated: boolean; suppressed: number; error: string | null }> {
  const pushRes = await pushToCloud()
  const pushError = cloudState.error // 拉取会把 error 清空，先抓在手里
  const pullRes = await syncFromCloud()
  if (!cloudState.error && pushError) cloudState.error = pushError
  return {
    pulled: pullRes.pulled,
    pushed: pushRes.pushed,
    failed: pushRes.failed,
    skipped: pushRes.skipped,   // A-03：透传给设置页，让「公共内容推不上去」这件事被说出来
    truncated: pullRes.truncated,
    suppressed: pullRes.suppressed,   // 2026-09-24：本机删过、这次跳过没下载的条数
    error: cloudState.error,
  }
}

// 改动后自动推送（轻量防抖）
// ⚠️ 2026-08-09：因推送全量数据导致刷题卡顿，默认关闭自动同步。
// 保留函数签名兼容旧调用，但不再自动执行；用户可在设置页手动同步。
export function scheduleAutoPush(): void {
  return // 自动同步已关闭（手动同步见设置页）
}

// ===== 本地辅助 =====

async function listLocalAll(coll: CloudCollection): Promise<any[]> {
  switch (coll) {
    case 'quiz_banks': return idb.listBanks()
    case 'questions': return listAllQuestions()
    case 'practice_records': return listAllRecords()
    case 'wrong_questions': return listAllWrong()
    case 'mastered_questions': return listAllMastered()
    case 'favorites': return listAllFavorites()
    case 'settings': return listAllSettings()
  }
}

// questions 的 cloud_id 索引缓存（同一次同步内复用，避免 7049 道公共题逐条全量 listQuestions 造成 O(n²) 卡死）
// 2026-08-23 扩展：cloudMap（cloud_id→题目）+ stemMap（stem→题目），供精确匹配 + 内容级去重，均 O(1)
let qCloudIdx: { bankId: number; cloudMap: Map<string, any>; stemMap: Map<string, any> } | null = null

// 2026-08-23 本地题库映射缓存（mapCloudBankToLocal 内部会 listBanks；一次同步内固化，避免每道题都全量扫题库）
let bankMapCache: { banks: any[] } | null = null
function resetSyncCaches(): void {
  qCloudIdx = null
  bankMapCache = null
}

// 写本地，返回本次变更类型：added=新增 / updated=更新 / skipped=未变
async function writeLocal(coll: CloudCollection, doc: any): Promise<'added' | 'updated' | 'skipped'> {
  switch (coll) {
    case 'quiz_banks': {
      // 云端文档：本地 id 存在 _local_id 字段（push 时 doc.id 被转成 _local_id）
      // 优先按 cloud_id（云端 _id）匹配已存在的本地题库（同昵称换设备不重复创建）
      const banks = await idb.listBanks()
      const byCloudId = doc._id ? banks.find(b => b.cloud_id === doc._id) : null
      const localId = byCloudId?.id ?? doc._local_id ?? doc.id
      if (typeof localId === 'number') {
        const exists = byCloudId ?? (await idb.getBank?.(localId))
        if (exists) {
          // 本地已有同 id 的自建题库则不覆盖（保留用户数据）
          if (!exists.cloud_shared && !byCloudId) {
            // 2026-08-16 修复：id 被用户自建题库占用时，公共题库改用新 id 创建（此前 break 会导致公共题库永远拉不下来）
            const maxId = banks.reduce((m, b) => Math.max(m, typeof b.id === 'number' ? b.id : 0), 0)
            await idb.createBank({
              id: maxId + 1,
              name: doc.name,
              description: doc.description,
              visibility: doc.visibility || 'public',
              cloud_shared: true,
              cloud_id: doc._id ?? null,
              created_at: doc.created_at,
              updated_at: doc.updated_at,
              synced_at: now(), // 2026-08-21：云端拉取视为已同步
            })
            return 'added'
          }
          await idb.updateBank?.({ ...doc, id: localId, cloud_id: doc._id ?? exists.cloud_id, visibility: doc.visibility || 'public', cloud_shared: true, synced_at: now() })
        } else {
          await idb.createBank({
            id: localId,
            name: doc.name,
            description: doc.description,
            visibility: doc.visibility || 'public',
            cloud_shared: true,
            cloud_id: doc._id ?? null, // 云端 _id，供题目 bank_ref 关联
            created_at: doc.created_at,
            updated_at: doc.updated_at,
            synced_at: now(), // 2026-08-21：云端拉取视为已同步
          })
        }
      } else if (doc._id && !byCloudId) {
        // 云端题库无 _local_id（历史数据里出现过）：分配新本地 id 创建，记 cloud_id
        const maxId = banks.reduce((m, b) => Math.max(m, typeof b.id === 'number' ? b.id : 0), 0)
        await idb.createBank({
          id: maxId + 1,
          name: doc.name,
          description: doc.description,
          visibility: doc.visibility || 'public',
          cloud_shared: true,
          cloud_id: doc._id,
          created_at: doc.created_at,
          updated_at: doc.updated_at,
          synced_at: now(), // 2026-08-21：云端拉取视为已同步
        })
      }
      return 'updated'
    }
    case 'questions': {
      // 云端题目：bank_ref 是可靠关联（题库云端 _id）；_local_bank_id 是旧设备 id（可能与题库 _local_id 错位）
      // 2026-08-16 严重修复：此前 q.id = _local_id 后 put 覆盖——questions store 是全局自增 id，
      // 公共题 _local_id(1~6229) 会覆盖本地其他题库（如「添加到我的题库」的私人副本）同 id 题目，
      // 造成副本题目丢失无法恢复。正确做法：优先按 cloud_id 匹配本地已有记录（保留本地自增 id）；
      // 无匹配则 add 分配新 id。绝不使用云端 _local_id 作为本地 id。
      //
      // 2026-08-23 根治「题目叠加」：
      // 前两次修复（v1.2.40 stem 去重）只防「新增」，没清存量，且本地旧数据 cloud_id 为空时仍会漏判。
      // 本版幂等去重升级为「bank_ref + stem」：无论 cloudId 是否为空、是否匹配上，都做内容级去重。
      // 只要本地题库里已存在同 stem 的题 → update（保留本地 id）而非 add，重复叠加从源头被阻断。
      const q = { ...doc }
      const cloudBankId = q.bank_ref ?? q._local_bank_id ?? q.bank_id
      const bankId = await mapCloudBankToLocal(cloudBankId)
      if (bankId == null) return 'skipped'
      const cloudId = doc._id ?? q.cloud_id ?? null
      const stem = (q.stem || '').trim()
      let localQ: any = null
      // 索引缓存：cloudMap（cloud_id→题目）+ stemMap（stem→题目），一次构建，O(1) 查询，避免每题全量扫
      const ensureIdx = async () => {
        if (qCloudIdx && qCloudIdx.bankId === bankId) return
        const all = await idb.listQuestions(bankId)
        const cloudMap = new Map<string, any>()
        const stemMap = new Map<string, any>()
        for (const x of all) {
          if (x.cloud_id) cloudMap.set(x.cloud_id, x)
          const s = (x.stem || '').trim()
          if (s && !stemMap.has(s)) stemMap.set(s, x)
        }
        qCloudIdx = { bankId, cloudMap, stemMap }
      }
      // 1) 优先用 cloud_id 精确匹配（O(1)）
      if (cloudId) {
        await ensureIdx()
        localQ = qCloudIdx!.cloudMap.get(cloudId) ?? null
      }
      // 2) 兜底：内容级去重——同题库下同 stem 已存在 → 视为同一题（公共题导副本、旧数据无 cloud_id 都靠它）
      if (!localQ && stem) {
        await ensureIdx()
        localQ = qCloudIdx!.stemMap.get(stem) ?? null
      }
      if (localQ) {
        // 已存在：保留本地 id 与本地 cloud_id，仅按最新内容更新
        const { _id, _local_id, ...rest } = q
        const wasNoCloud = cloudId && !localQ.cloud_id
        await idb.updateQuestion({ ...localQ, ...rest, id: localQ.id, bank_id: bankId, cloud_id: cloudId ?? localQ.cloud_id, synced_at: now() })
        // 回写 cloud_id 后刷新索引（下次同库可直接 cloud_id 命中）
        if (wasNoCloud) {
          await idb.updateQuestion({ ...localQ, cloud_id: cloudId })
          await ensureIdx()
        }
        return wasNoCloud ? 'updated' : 'skipped'
      } else {
        // 首次拉取：剥离云端 id/_local_id，add 让 IndexedDB 分配新 id（避免覆盖其他题库）
        const { _id, _local_id, id, ...rest } = q
        await idb.addQuestions(bankId, [{ ...rest, cloud_id: cloudId, synced_at: now() }])
        // 新增后刷新索引（同库后续题可直接命中）
        await ensureIdx()
        return 'added'
      }
    }
    case 'practice_records':
    case 'wrong_questions':
    case 'mastered_questions':
    case 'favorites': {
      const r = { ...doc }
      const bankId = await mapCloudBankToLocal(r._local_bank_id ?? r.bank_id)
      if (bankId != null) {
        r.bank_id = bankId
        if (coll === 'practice_records') {
          // 2026-08-16 修复：本地记录无 updated_at → 合并比较永远"云端较新" → 每次同步重复 add 同一条记录，
          // 导致 correct（按次数统计）翻倍、首页正确率爆表（如 200%）。写前按 (bank_id, question_id, practiced_at) 去重。
          const dup = await idb.findPracticeRecord?.(bankId, r.question_id, r.practiced_at) ?? false
          if (!dup) {
            // 2026-08-21：拉取写入带 synced_at（视为已同步，避免下次推送又推回去）
            const newId = await idb.recordPractice(r)
            if (newId != null) await idb.bulkPut('practice_records', [{ ...r, id: newId, synced_at: now() }])
          }
        }
        else if (coll === 'wrong_questions') {
          // 2026-08-19：保留云端 correct_streak（连续答对计数）；云端旧记录无该字段时保留本地计数
          const tw = typeof r.total_wrong === 'number' ? r.total_wrong : undefined
          await idb.markWrong(bankId, r.question_id, typeof r.correct_streak === 'number' ? r.correct_streak : undefined, tw)
          await stampSyncedByKey(coll, bankId, r.question_id)
        }
        else if (coll === 'mastered_questions') {
          await idb.markWrongMastered(bankId, r.question_id)
          await stampSyncedByKey(coll, bankId, r.question_id)
        }
        else {
          await idb.toggleFavoriteSafe?.(bankId, r.question_id)
          await stampSyncedByKey(coll, bankId, r.question_id)
        }
      }
      return 'skipped'
    }
    case 'settings': {
      // 敏感设置（ai_api_key）不参与云同步，云端残留也忽略
      // P1-11：ai_base_url / ai_base_url_ack 同理 —— 端点与「自定义端点确认」都只能由本机决定；
      // 旧版本可能已在云端留下 ai_base_url 文档，这里一律不落地，避免静默改写端点。
      if (doc.key === 'ai_api_key' || doc.key === 'ai_base_url' || doc.key === 'ai_base_url_ack') return 'skipped'
      // 2026-08-21：bulkPut 带 synced_at（拉取视为已同步；settings 推送为全推，此标记仅避免重复写）
      await idb.bulkPut('settings', [{ key: doc.key, value: doc.value, synced_at: now() }])
      return 'skipped'
    }
  }
  return 'skipped'
}

// 云端 bank_id → 本地 bank_id
// 云端文档带 bank_ref（题库云端 _id）时优先按本地题库 cloud_id 匹配（可靠关联）；
// 其次按 _local_bank_id（同设备/多设备同 id 兼容）或名字匹配
async function mapCloudBankToLocal(cloudBankId: number | string | null | undefined): Promise<number | null> {
  // 2026-08-23 性能：一次同步内复用题库列表，避免每道题都全量 listBanks()
  if (!bankMapCache) bankMapCache = { banks: await idb.listBanks() }
  const banks = bankMapCache.banks
  if (typeof cloudBankId === 'string') {
    const byCloud = banks.find(b => b.cloud_id === cloudBankId)
    if (byCloud) return byCloud.id
  }
  if (typeof cloudBankId === 'number') {
    const direct = banks.find(b => b.id === cloudBankId)
    if (direct) return direct.id
    const cloudIdMatch = banks.find(b => b.cloud_id === cloudBankId)
    if (cloudIdMatch) return cloudIdMatch.id
  }
  return null
}

// 以下辅助函数补齐 idb 缺的方法（在 db.ts 里没暴露的）
async function listAllQuestions(): Promise<any[]> {
  const banks = await idb.listBanks()
  const all: any[] = []
  for (const b of banks) {
    const qs = await idb.listQuestions(b.id)
    for (const q of qs) all.push({ ...q, _bank_id: b.id, _bank_visibility: b.visibility, cloud_shared: !!b.cloud_shared })
  }
  return all
}
async function listAllRecords(): Promise<any[]> {
  const banks = await idb.listBanks()
  const all: any[] = []
  for (const b of banks) {
    const recs = await idb.listRecords?.(b.id) || []
    all.push(...recs)
  }
  return all
}
async function listAllWrong(): Promise<any[]> {
  // 2026-08-21：返回完整记录（含 id），供 pushOne 构造稳定 _id + markSynced 回写 synced_at
  return idb.listAll('wrong_questions')
}
async function listAllMastered(): Promise<any[]> {
  return idb.listAll('mastered_questions')
}
async function listAllFavorites(): Promise<any[]> {
  return idb.listAll('favorites')
}
async function listAllSettings(): Promise<any[]> {
  // 读取已知 key（从设置页用到的）
  // 注意：ai_api_key（AI 密钥）不参与云同步，仅保存在本地浏览器，避免泄露到云端
  // P1-11：ai_base_url（AI 端点）同样不参与云同步 —— 端点决定 Bearer 密钥发往哪里，
  // 让云端文档能改写它等于把密钥交给云端；自定义端点改由本机设置页显式确认（ai_base_url_ack）。
  // 2026-08-21 修复：此前无 _id → pushDoc 走 add 不带 _id 分支 → 每次手动同步都新增 5 条重复文档，
  // settings 集合无限膨胀。现在带稳定 _id（uid 前缀 + key），pushDoc 双写变成 upsert 语义。
  const keys = ['ai_model', 'daily_records', 'last_practice', 'practice_progress']
  const out: any[] = []
  for (const k of keys) {
    const v = await idb.getSetting(k)
    if (v != null) out.push({ _id: 'lsettings_' + uidPrefix() + '_' + k, key: k, value: v })
  }
  return out
}

// 导出给设置页用的状态
export function getCloudStatus() {
  return { ...cloudState }
}

// ===== 与小程序账号打通（自定义登录 ticket）=====
// 网页版默认匿名登录（uid 随浏览器变化，换设备即丢数据）。
// 在小程序端「设置 → 与网页版打通」生成 6 位绑定码，在此输入即可切换为
// 与小程序同一身份（customUserId 由微信 openid 派生），两端数据自动互通。
const BOUND_FLAG = 'cloud_bound_custom'
// P2-4（T10b，2026-09-15）：绑定态的**权威来源是真实登录态**，localStorage 标记只是缓存。
// 记录绑定时那个会话的 uid，才能判断「当前会话还是不是绑定身份」——只凭一个 '1' 是判不出来的。
const BOUND_UID = 'cloud_bound_uid'

// 同步读缓存标记（模板首帧渲染用；真实性由 refreshBoundState 校正）
export function isBoundToMiniProgram(): boolean {
  try {
    return localStorage.getItem(BOUND_FLAG) === '1'
  } catch {
    return false
  }
}

function setBoundCache(uid: string | null): void {
  try {
    if (uid) {
      localStorage.setItem(BOUND_FLAG, '1')
      localStorage.setItem(BOUND_UID, uid)
    } else {
      localStorage.removeItem(BOUND_FLAG)
      localStorage.removeItem(BOUND_UID)
    }
  } catch { /* ignore */ }
}
function getBoundUid(): string | null {
  try { return localStorage.getItem(BOUND_UID) } catch { return null }
}

// 读一次当前会话，返回判定「是否绑定身份」需要的字段；拿不到会话时返回 null（=无法判定）。
// 依据（本地 SDK 类型定义，未实盘验证运行时——GC1 禁止连云）：
//   - getSession() 的 session.user 含 `customUserId?: string` / `loginType?: string`
//     （@cloudbase/js-sdk@3.7.1 core.d.ts:826 / :818）；
//   - 匿名标记的写法 `data.user.is_anonymous` 见同文件注释示例 core.d.ts:1004。
// SDK 未把 SignInRes 内层展开，故全部按 `any` 保守读取，读不到就返回 null 而不是猜。
async function resolveLoginIdentity(): Promise<{ uid: string | null; customUserId: string | null; isAnonymous: boolean | null } | null> {
  if (!auth) return null
  let session: any = null
  try {
    if (typeof auth.getSession === 'function') {
      const res: any = await auth.getSession()
      session = res?.data?.session ?? null
    }
  } catch (e: any) {
    console.warn('refreshBoundState：getSession 取会话失败，回退 getLoginState：', e?.message || e)
  }
  if (!session) {
    try {
      const st = await auth.getLoginState()
      if (st) session = st
    } catch { /* ignore */ }
  }
  if (!session) return null
  const u: any = session.user || session
  const uid = typeof u?.uid === 'string' && u.uid ? u.uid : null
  const customUserId = typeof u?.customUserId === 'string' && u.customUserId ? u.customUserId : null
  let isAnonymous: boolean | null = null
  if (typeof u?.is_anonymous === 'boolean') isAnonymous = u.is_anonymous
  else if (typeof u?.loginType === 'string' && u.loginType) isAnonymous = /^anonymous/i.test(u.loginType)
  return { uid, customUserId, isAnonymous }
}

/**
 * P2-4：以真实登录态校正绑定态（设置页进入时调用一次）。
 * 原实现只读 localStorage 标记，两种失真都会出现：
 *   ① 换浏览器/清缓存 → 标记没了，明明已绑定却显示「未绑定」；
 *   ② 标记还在但会话已经换回匿名（绑定后重新匿名登录、换 profile）→ 显示「已绑定」，实际不是那个身份。
 * 现在只在**拿到正面证据**时下结论，其余一律返回 null（调用方保持缓存不动，宁可保守也不误报）：
 *   - 证据 A（最强）：会话带 customUserId（自定义登录身份，由微信 openid 派生）⇒ 确为绑定态；
 *   - 证据 B：本地记过绑定 uid，而当前会话 uid 不是它 ⇒ 当前身份已不是绑定时那个；
 *   - 证据 C：SDK 明确标记匿名登录 ⇒ 不是绑定态；
 *   - A/B/C 都无从判定（老版本只写了 flag 没写 uid、且 SDK 不给登录类型）⇒ 返回缓存原值。
 * @returns true=绑定态 / false=非绑定态 / null=无法判定
 */
export async function refreshBoundState(): Promise<boolean | null> {
  if (!(await ensureApp())) return null
  const cached = isBoundToMiniProgram()
  const id = await resolveLoginIdentity()
  if (!id) return null
  if (id.customUserId) {
    setBoundCache(id.uid)
    return true
  }
  const boundUid = getBoundUid()
  if (boundUid && id.uid && boundUid !== id.uid) {
    setBoundCache(null)
    return false
  }
  if (id.isAnonymous === true) {
    setBoundCache(null)
    return false
  }
  return cached
}

/**
 * 管理员面板 → 云函数 `admin-api`（T18-2c，2026-09-16：管理面从「本机 admin-server」改为云函数）。
 * 口令由调用方传入（面板里手输，只存在内存），函数端负责常量时间比较 + 失败计数锁定（P1-38）。
 * ⚠️ 回执要吃两种形态：本函数**几乎每条分支都带 `code` 字段**，而 js-sdk 见到 `code` 会把 payload
 * 平铺到响应本身、不再包 `result`（账本「新发现 D」，与 cloud-parse.ts 同源）⇒ 统一 `res.result ?? res`。
 * 也**绝不能**把 `res.result` 当唯一路径读，否则「口令错误」会被读成成功之外的未知态。
 */
export async function callAdminApi(action: string, password: string, payload: Record<string, any> = {}): Promise<any> {
  if (!(await ensureApp())) {
    return { ok: false, code: 'NO_CLOUD', message: '云环境未连接，请先在设置里开启云同步' }
  }
  try {
    const res: any = await app.callFunction({ name: 'admin-api', data: { password, action, payload } })
    const out: any = res?.result ?? res
    return out && typeof out === 'object' ? out : { ok: false, code: 'BAD_RESPONSE', message: '响应异常' }
  } catch (e: any) {
    // 函数未部署 / invoke 权限被拒 / 网络异常都落这里。原文只进控制台，对外给可读提示。
    console.warn('admin-api 调用失败：', e?.message || e)
    const msg = String(e?.message || e || '')
    return { ok: false, code: 'CALL_FAILED', message: '无法调用管理云函数（可能尚未部署或权限未放通）：' + msg.slice(0, 120) }
  }
}

/**
 * 提交意见反馈（2026-09-25）。
 *
 * 走**公开**云函数 `feedback`：不需要管理员口令，也不需要用户配过云同步——匿名身份能调就行。
 * 身份随包带一个「自称」的 `claim`（uid + 同步昵称），云端会把它记成不可信字段（只用于限流与排查）；
 * 这点很重要：网页端取不到可靠身份（见本文件里 ALLOW_LEGACY_FLAT_IMPORT 的注释），所以**不要**把
 * claim 当身份用。
 *
 * 失败时如实回报 code（TOO_FAST / TOO_MANY / NO_CLOUD / CALL_FAILED），由调用方提示用户改用复制/邮箱。
 */
export async function submitFeedback(payload: {
  category: string
  title: string
  body: string
  contact?: string
  page?: string
  ua?: string
  version?: string
}): Promise<{ ok: boolean; code?: string; message?: string; id?: string; notified?: boolean }> {
  if (!(await ensureApp())) {
    return { ok: false, code: 'NO_CLOUD', message: '云环境未连接，可改用「复制到剪贴板」发我' }
  }
  try {
    const claim = { uid: authedUid || '', sync_key: getSyncKey() }
    const res: any = await app.callFunction({ name: 'feedback', data: { ...payload, claim } })
    const out: any = res?.result ?? res
    return out && typeof out === 'object' ? out : { ok: false, code: 'BAD_RESPONSE', message: '响应异常' }
  } catch (e: any) {
    // 函数未部署 / 网络异常都落这里。原文只进控制台，对外给可读提示。
    // ⚠️ 2026-09-25：CloudBase SDK 抛出的 `e.message` 有时是**对象**（实测 CORS 被拒那次就是），
    //   直接 `String(e?.message)` 会得到 `[object Object]`——用户看到的就是句废话。这里做一次提取。
    console.warn('feedback 调用失败：', e?.message || e)
    const raw = e?.message && typeof e.message === 'object' ? JSON.stringify(e.message) : String(e?.message || e || '')
    return { ok: false, code: 'CALL_FAILED', message: '提交失败：' + raw.slice(0, 120) }
  }
}

/**
 * 凭小程序生成的绑定码切换身份
 * @returns 成功时返回新的 uid
 */
export async function redeemBindCode(code: string): Promise<{ ok: boolean; msg?: string; uid?: string }> {
  const clean = String(code || '').trim().toUpperCase()
  if (!/^[A-Z2-9]{6}$/.test(clean)) {
    return { ok: false, msg: '绑定码应为 6 位字母数字' }
  }
  if (!(await ensureApp())) {
    return { ok: false, msg: '云环境未连接，请先在设置中开启云同步' }
  }
  // ⚠️ 2026-09-15 修复：上面原先调用 `ensureCloud()`——**本文件根本没有这个函数**（只有 `ensureApp`）。
  // 类型检查里的那条 `TS2304: Cannot find name 'ensureCloud'` 不是噪声，运行时就是 ReferenceError
  // ⇒ **「兑换绑定码」整条链路一直是坏的**（同时使 P1-15 修的两条失败路径不可达，故一并修掉）。
  // 教训记在账本：这 36 条基线类型错误里有至少三条是「功能已经坏了」的信号，不是风格问题。
  // P1-15：ticket 需在 catch 里可见（回退分支要把它传给 SDK，原先传的是错误消息）
  let ticket = ''
  try {
    // 1) 调云函数换 ticket
    const res: any = await app.callFunction({
      name: 'bindAccount',
      data: { action: 'redeemCode', code: clean },
    })
    // 两种形态都吃：函数返回顶层带 `code` 时，js-sdk 会把 payload 平铺到响应本身而不再包 `result`
    // （8 例差分见 `cloud-parse.ts` 同处注释）。bindAccount 当前这条 `redeemCode` 分支不带 `code`，
    // 但它的 `createCode` 分支成功时返回的就是 `{ok:true, code:'<绑定码>', expiresIn}`
    // （`yuntu-mp/cloudfunctions/bindAccount/index.js:64,66`）⇒ 网页端哪天接上「生成绑定码」，
    // 只读 `res.result` 就会把成功当失败。两种都吃之后这个坑不存在。
    const out: any = res?.result ?? res
    if (!out?.ok) {
      return { ok: false, msg: out?.msg || '绑定失败' }
    }
    ticket = out.ticket
    if (!ticket) return { ok: false, msg: '未获取到登录凭证' }

    // 2) 退出当前匿名登录，用 ticket 重新登录
    try { await auth.signOut() } catch { /* 匿名态可能无法登出，忽略 */ }
    await auth.signInWithTicket(ticket)
    // P2-3：登录成功后统一走 resolveLoginUid（getSession 优先，getLoginState 回退）
    const uid = await resolveLoginUid()
    if (!uid) {
      // ⚠️ 2026-09-15 复审 MUST-FIX 2：走到这里时**上面已经 signOut 掉了匿名登录**。
      // 若不复位就 return，`authedUid` 仍指向上一个身份、`cloudState.authed` 仍为 true
      // ⇒ 界面显示「已登录」、后续同步按旧 uid 发请求，而服务端会话其实已经变了。
      // 这与下方 catch 分支的复位必须一致（那段注释声明的正是这个不变量）。
      authedUid = null
      cloudState.authed = false
      return { ok: false, msg: '登录态获取失败（已退出原登录态，请刷新页面后重试）' }
    }

    authedUid = uid
    cloudState.authed = true
    setBoundCache(uid) // P2-4：同时记下绑定身份的 uid（绑定态的权威判据之一）
    return { ok: true, uid }
  } catch (e: any) {
    const msg = e?.message || String(e)
    // P1-15：signInWithTicket 在部分 SDK 版本叫 customAuthProvider().signIn()。
    // 原先这条回退把**错误消息**当 ticket 传（signIn(String(msg))）——凭据传错变量，
    // 服务端只会收到 SDK 报错文本，该分支永远不可能成功。这里改为传真正换来的 ticket。
    if (ticket && /signInWithTicket is not a function/i.test(msg)) {
      try {
        await auth.customAuthProvider().signIn(ticket)
        const uid2 = await resolveLoginUid() // P2-3：同上，getSession 优先 + getLoginState 回退
        if (uid2) {
          // 回退路径真的登录成功 → 如实返回成功（原实现无论回退结果如何都返回「绑定失败」）
          authedUid = uid2
          cloudState.authed = true
          setBoundCache(uid2) // P2-4：同上
          return { ok: true, uid: uid2 }
        }
      } catch (e2: any) {
        console.warn('customAuthProvider().signIn 回退失败：', e2?.message || e2)
      }
    }
    // P1-15：失败路径复位登录态。上面第 2 步已 signOut 掉匿名登录，若不复位：
    // authedUid 仍指向上一个身份、cloudState.authed 仍为 true → 界面显示「已登录」，
    // 但服务端会话已换 → 后续同步按旧 uid 发请求。这里如实回落为未登录。
    // 注：ensureApp() 在 app 已初始化时直接返回，故复位后要重新匿名登录需重载页面（既有行为，未改动）。
    authedUid = null
    cloudState.authed = false
    return { ok: false, msg: '绑定失败：' + msg }
  }
}

// 解除绑定，回到匿名身份（数据留在云端，可再次绑定找回）
export async function unbindMiniProgram(): Promise<boolean> {
  try {
    if (auth) {
      try { await auth.signOut() } catch { /* ignore */ }
    }
    // P2-4：标志与绑定 uid 一起清（只清 flag 会让下次会话对不上绑定身份）
    setBoundCache(null)
    authedUid = null
    cloudState.authed = false
    // 下次调用 ensureCloud 会重新走匿名登录
    return true
  } catch {
    return false
  }
}
