// 跨库聚合（错题本 / 收藏）的分组与降级口径。纯函数，离线可断言。
//
// 为什么单独一个模块：`WrongView` / `FavoritesView` 原先把 `bankId` 当**页面级常量**
// （`const bankId = resolveBankId(route.params.bankId)`），答题、取消收藏、标记已掌握全用这一个值。
// 聚合态必须让**每条记录带自己的库 key**，否则跨库操作会写错库。分组/降级这类判断放这里，
// 两个页面共用，也方便脱离浏览器验证。
import type { BankKey, PracticableBank } from './practicable-banks'
import { bankLabel } from './practicable-banks'

export interface RawRecord {
  bank_id?: BankKey
  question_id?: number
  total_wrong?: number
  correct_streak?: number
  created_at?: string
  addedAt?: number | string
}

export interface GroupItem {
  bankKey: BankKey
  qid: number
  preview: string
  totalWrong: number
  streak: number
  ts: number
}

export interface BankGroup {
  key: BankKey
  name: string
  kind: 'local' | 'subscribed' | 'unknown'
  /** 该库的题目没取到（离线/云端失败）⇒ 只报数量，不假装列表是完整的 */
  unreachable: boolean
  count: number
  items: GroupItem[]
}

function tsOf (r: RawRecord): number {
  const v: any = r.addedAt ?? r.created_at
  if (typeof v === 'number') return v
  const p = Date.parse(String(v || ''))
  return Number.isFinite(p) ? p : 0
}

/**
 * 一行记录是否可用。**不能只写 `Number.isFinite(Number(r.question_id))`** ——
 * `Number(null)` 是 0、`Number('')` 也是 0，脏行会伪装成「第 0 题」混进列表（离线断言抓到过一次）。
 * 返回 null 表示这行该跳过；分组与计数共用它，两边口径才不会打架。
 */
export function validRow (r: RawRecord | null | undefined): { key: string; qid: number } | null {
  const key = String((r && r.bank_id) ?? '').trim()
  const raw: any = r && r.question_id
  if (!key || raw === null || raw === undefined || raw === '') return null
  const qid = Number(raw)
  if (!Number.isInteger(qid) || qid <= 0) return null
  return { key, qid }
}

/**
 * @param banks         可选库清单（用来取名字/类型）；对不上的 key 归到 unknown 组，**不丢记录**
 * @param questionsByKey  `String(bankKey) → 该库题目数组`；`null`/`undefined` 表示这道题的库没取到
 */
export function groupRecords (
  rows: RawRecord[] | null,
  banks: PracticableBank[],
  questionsByKey: Record<string, any[] | null>,
): BankGroup[] {
  const byKey = new Map<string, RawRecord[]>()
  for (const r of rows || []) {
    const v = validRow(r)
    if (!v) continue
    const arr = byKey.get(v.key) || []
    arr.push(r)
    byKey.set(v.key, arr)
  }

  const groups: BankGroup[] = []
  for (const [k, list] of byKey.entries()) {
    const bank = banks.find(b => String(b.key) === k)
    const qs = questionsByKey[k]
    const items: GroupItem[] = list.map(r => {
      const qid = Number(r.question_id)
      const q = Array.isArray(qs) ? qs.find((x: any) => Number(x && x.id) === qid) : null
      let preview = ''
      if (Array.isArray(qs)) preview = q ? String(q.stem || '').slice(0, 60) : '（题目已不在本库）'
      return {
        bankKey: bank ? bank.key : k,
        qid,
        preview,
        totalWrong: Number(r.total_wrong) || 0,
        streak: Number(r.correct_streak) || 0,
        ts: tsOf(r),
      }
    })
    items.sort((a, b) => b.ts - a.ts || b.qid - a.qid)
    groups.push({
      key: bank ? bank.key : k,
      name: bank ? bankLabel(bank) : `已不在可选列表的题库（${k}）`,
      kind: bank ? bank.kind : 'unknown',
      unreachable: !Array.isArray(qs),
      count: items.length,
      items,
    })
  }

  // 本地库在前、订阅库其次、认不出的最后；同类型按数量多的在前（先看大头）
  const rank = (g: BankGroup) => (g.kind === 'local' ? 0 : g.kind === 'subscribed' ? 1 : 2)
  groups.sort((a, b) => rank(a) - rank(b) || b.count - a.count || a.name.localeCompare(b.name, 'zh'))
  return groups
}

/** 汇总计数（标题与首页入口共用，口径必须一致） */
export function countByBank (rows: RawRecord[] | null): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows || []) {
    const v = validRow(r)          // 与 groupRecords 同一个合法性判据，两边计数才会一致
    if (!v) continue
    m.set(v.key, (m.get(v.key) || 0) + 1)
  }
  return m
}

/**
 * 按库取题目，**并发上限 + 单库超时/失败只让那一组降级**。
 * 订阅库的题目不在本地（订阅＝引用），每多一个库就多一次云端请求 ⇒ 不控并发、不设超时，
 * 一个挂住的请求就能把整个聚合页钉在空态（真浏览器实测到过：本地库的 bank_id 被 String() 之后
 * 当成 bankRef 发给云端，那一组永远 pending ⇒ 页面一直显示「暂无错题」）。
 * @param load 真实实现必须传 `(k) => api.listQuestions(resolveBankId(k))` —— **要还原数字形态**，
 *             否则本地库会被当公共库去查云端。离线断言传假函数（含抛错/挂死的键）。
 * @param timeoutMs 单库上限；超时按失败处理（该组 unreachable），不拖垮整页
 */
export async function loadQuestionsByBank (
  keys: string[],
  load: (key: string) => Promise<any[]>,
  limit = 3,
  timeoutMs = 8000,
): Promise<Record<string, any[] | null>> {
  const out: Record<string, any[] | null> = {}
  const queue = (keys || []).map(String).filter(Boolean)
  let cursor = 0
  const worker = async () => {
    while (cursor < queue.length) {
      const k = queue[cursor++]
      let timer: any = null
      try {
        const rows = await Promise.race([
          load(k),
          new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`取该库题目超时（${timeoutMs}ms）`)), timeoutMs) }),
        ])
        out[k] = Array.isArray(rows) ? rows : null
      } catch (e: any) {
        console.warn(`[聚合] 库 ${k} 的题目没取到，该组只显示数量：`, e?.message || e)
        out[k] = null
      } finally {
        if (timer) clearTimeout(timer)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, worker))
  return out
}
