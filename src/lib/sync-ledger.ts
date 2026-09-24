// 同步删除账本（sync-ledger）：本机删过的云端文档，之后**下载时一律跳过**。
//
// 为什么要有它（2026-09-24，rabbit 报「本地题库删掉，一同步又回来了」）：
//   删除标记走的是 `where({ _local_id, _openid: 当前uid })`，但云端那条文档可能
//     ① 属于**旧身份**（换浏览器 / 清缓存 / 绑小程序之前写的，_openid 是另一个 uid），或
//     ② **缺 `_local_id`**（历史文档，云端出现过的形态，见 cloud.ts writeLocal 的注释）。
//   这两种情况下 where 命中 0 条 —— 而「命中 0 条」与「已经删干净」返回的是同一个结果，
//   标记于是被当成成功清掉，下一次 syncFromCloud 又按 sync_key 把它拉回来。
//   客户端**删不掉**旧身份文档（集合 ACL：write 需 `doc._openid == auth.openid`），
//   所以闸门只能下在本机：账本只记「这些云端文档不要再下载回来」。
//
// 与「删除标记」(localStorage `sync_deleted`) 的分工：
//   · 标记 = 待办：还要去云端删；删干净或重试到上限就消失
//   · 账本 = 终身记录：写进去就不再下载，只增不减（超上限按时间裁旧、超保留期读取时丢弃）
//
// 抑制判据（方向：宁可漏抑制一个旧的，也不许把**新数据**挡在门外）
//   · 强键：云端 `_id` 相同（就是那一份文档）→ 直接抑制，不看时间
//   · 弱键：本地 id 相同（+ 同步昵称一致、记录类还要题号一致）**且**云端文档时间 ≤ 删除时刻 → 抑制
//     时间闸门用来放过「本地 id 被复用后新推上来的那份」：它的 updated_at 必然晚于删除时刻。
//
// 本模块不 import 任何云端 SDK / 浏览器 API：storage 走参数注入，测试才能跑真实现（见
// scripts/lib/sync-ledger.test.cjs）。
export const LEDGER_KEY = 'sync_deleted_ledger'

export type LedgerColl = 'quiz_banks' | 'questions' | 'favorites' | 'wrong_questions' | 'mastered_questions'

export type LedgerEntry = {
  coll: LedgerColl
  /** 云端 _id（已知时最强键）；未知为 null */
  cloud_id: string | null
  /** 本地题库 id（quiz_banks）／题目所属本地题库 id（questions 与记录类） */
  local_id: number | null
  /** 记录类与逐题删除用；`null` = 整库语义（questions） */
  question_id: number | string | null
  /** 记下当时的同步昵称，弱键要比对 */
  sync_key: string
  /** 删除发生的时刻（ms）——弱键的时间闸门 */
  at: number
}

/** 账本上限：超出按 at 裁旧。300 条足够覆盖「删了几个题库 + 一批错题」的正常用量 */
export const LEDGER_MAX = 300
/** 保留期：180 天。老账本条目连时间闸门的参照价值都过期了，读取时直接丢 */
export const LEDGER_MAX_AGE_MS = 180 * 24 * 3600 * 1000

/** 只用到这两个方法 → 浏览器传 localStorage，测试传假实现 */
export type LedgerKV = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

/** 时间归一：云端时间戳有人写 ISO 串、有人写数字（与 cloud.ts 的 normalizeTs 同口径）；取不到返回 0 */
export function toMs (v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v) {
    const ms = Date.parse(v)
    if (!Number.isNaN(ms)) return ms
  }
  if (v && typeof v === 'object' && typeof (v as any).getTime === 'function') {
    const ms = (v as any).getTime()
    if (typeof ms === 'number' && Number.isFinite(ms)) return ms
  }
  return 0
}

function sameEntry (a: LedgerEntry, b: LedgerEntry): boolean {
  return a.coll === b.coll && a.cloud_id === b.cloud_id && a.local_id === b.local_id &&
    a.question_id === b.question_id && a.sync_key === b.sync_key
}

function readRaw (kv: LedgerKV): LedgerEntry[] {
  try {
    const raw = kv.getItem(LEDGER_KEY)
    if (!raw) return []
    const obj = JSON.parse(raw)
    return Array.isArray(obj) ? obj : []
  } catch {
    return []   // 坏 JSON / 存储被禁 → 当空账本，绝不因为账本把同步整个搞挂
  }
}

/** 读账本：丢掉过期条目（顺手把存储里那份也裁一遍，避免越积越大） */
export function loadLedger (kv: LedgerKV, nowMs: number = Date.now()): LedgerEntry[] {
  const rows = readRaw(kv).filter(
    e => e && typeof e === 'object' &&
      typeof e.coll === 'string' && typeof e.at === 'number' &&
      nowMs - e.at <= LEDGER_MAX_AGE_MS,
  ) as LedgerEntry[]
  const raw = readRaw(kv)
  if (rows.length !== raw.length) {
    try { kv.setItem(LEDGER_KEY, JSON.stringify(rows)) } catch { /* 存储满/被禁：忽略 */ }
  }
  return rows
}

export function saveLedger (rows: LedgerEntry[], kv: LedgerKV): void {
  try { kv.setItem(LEDGER_KEY, JSON.stringify(rows)) } catch { /* ignore */ }
}

/** 记账：同一条只记一次；超出上限按 at 裁旧（新条目优先留下） */
export function addLedgerEntry (entry: LedgerEntry, kv: LedgerKV, nowMs: number = Date.now()): void {
  const rows = loadLedger(kv, nowMs)
  if (rows.some(e => sameEntry(e, entry))) return
  rows.push(entry)
  rows.sort((a, b) => a.at - b.at)
  saveLedger(rows.slice(Math.max(0, rows.length - LEDGER_MAX)), kv)
}

export type LedgerIndex = Map<LedgerColl, { cloudIds: Set<string>; weak: LedgerEntry[] }>

/** 建索引：强键走 Set（O(1)），弱键条目少（几百条上限）线性扫即可 */
export function buildLedgerIndex (rows: LedgerEntry[]): LedgerIndex {
  const idx: LedgerIndex = new Map()
  for (const e of rows) {
    let slot = idx.get(e.coll)
    if (!slot) { slot = { cloudIds: new Set(), weak: [] }; idx.set(e.coll, slot) }
    if (e.cloud_id) slot.cloudIds.add(e.cloud_id)
    slot.weak.push(e)
  }
  return idx
}

/** 云端文档的本条时间：prefer updated_at，其次 created_at */
function docMs (doc: any): number {
  return toMs(doc?.updated_at) || toMs(doc?.created_at) || 0
}

/**
 * 这条云端文档该不该跳过。
 * 判据与理由见文件头；`questions` 的强键是 `bank_ref`（题目按题库云端 _id 归属）。
 */
export function isSuppressed (index: LedgerIndex, coll: LedgerColl, doc: any): boolean {
  const slot = index.get(coll)
  if (!slot) return false

  // 强键：就是那一份文档
  if (coll === 'quiz_banks') {
    if (doc?._id && slot.cloudIds.has(String(doc._id))) return true
  } else if (coll === 'questions') {
    if (doc?.bank_ref && slot.cloudIds.has(String(doc.bank_ref))) {
      // 逐题删除的条目只管那一题：账本里那条 question_id 必须等于这道题的本地 id
      const perQ = slot.weak.filter(e => e.cloud_id === String(doc.bank_ref) && e.question_id != null)
      if (!perQ.length) return true
      if (perQ.some(e => doc._local_id != null && String(doc._local_id) === String(e.question_id))) return true
    }
  }
  // 记录类集合没有强键：pushOne 不给它们写 cloud_id 账本（见 cloud.ts 的记账调用点）

  const t = docMs(doc)
  for (const e of slot.weak) {
    if (e.at < t) continue                       // 时间闸门：云端这份比删除时刻新 → 是后来的新数据，放行
    if (e.sync_key && doc?.sync_key && String(doc.sync_key) !== e.sync_key) continue
    if (coll === 'quiz_banks') {
      if (e.local_id != null && doc?._local_id != null && String(doc._local_id) === String(e.local_id)) return true
    } else if (coll === 'questions') {
      if (e.local_id != null && doc?._local_bank_id != null && String(doc._local_bank_id) === String(e.local_id)) {
        if (e.question_id == null) return true
        if (doc._local_id != null && String(doc._local_id) === String(e.question_id)) return true
      }
    } else {
      if (e.local_id != null && e.question_id != null &&
          doc?._local_bank_id != null && doc?.question_id != null &&
          String(doc._local_bank_id) === String(e.local_id) &&
          String(doc.question_id) === String(e.question_id)) return true
    }
  }
  return false
}
