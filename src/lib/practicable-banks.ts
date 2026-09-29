// 「可选的库」＝本地库 + 订阅的公共库。
//
// 为什么要单独一个模块（2026-09-29）：订阅 = **引用**公共题库，不在本地 `quiz_banks` 落行，
// 所以任何只用 `api.listBanks()` 的地方都会把订阅库整块漏掉。学习计划就是这么变成空壳的
// （`StudyPlanView.vue:140` 的选库列表 = `idb.listBanks()`，rabbit 删掉三个本地库后列表直接空，
// 而表单校验 `bankIds.length > 0` 永远不满足 ⇒ 创建按钮永远点不动）。
// 聚合错题本/收藏要按库分组，也需要同一份「key → 名字」口径，故两处共用这里。
//
// 纯函数、不碰网络也不碰 IndexedDB ⇒ 可以直接离线断言（tests/practicable-banks.test.cjs 切真实源码跑）。
export type BankKey = number | string

export interface PracticableBank {
  key: BankKey
  name: string
  kind: 'local' | 'subscribed'
  questionCount: number
  /** 订阅里有这个 ref，但公共库列表没取到（离线/被删/还没加载）⇒ 名字未知，调用方要如实标出来，别编一个 */
  unresolved: boolean
}

/**
 * @param localBanks   `api.listBanks()` 的结果（本地库行，字段 id/name/question_count）
 * @param subs         `api.listSubscriptions()` 的结果（bankRef 字符串数组）
 * @param publicBanks  `listPublicBanks()` 的结果（云端公共库行，字段 _id/name/question_count）；拉失败传 []
 */
export function buildPracticableBanks (
  localBanks: any[] | null,
  subs: any[] | null,
  publicBanks: any[] | null,
): PracticableBank[] {
  const out: PracticableBank[] = []
  for (const b of localBanks || []) {
    if (!b || b.id === undefined || b.id === null) continue
    out.push({
      key: Number(b.id),
      name: String(b.name || ''),
      kind: 'local',
      questionCount: Number(b.question_count ?? b.count ?? 0) || 0,
      unresolved: false,
    })
  }
  const pubByRef = new Map<string, any>()
  for (const p of publicBanks || []) {
    const ref = String((p && p._id) || '')
    if (ref) pubByRef.set(ref, p)
  }
  const seen = new Set<string>()
  for (const raw of subs || []) {
    const ref = String(raw || '').trim()
    if (!ref || seen.has(ref)) continue
    seen.add(ref)
    const hit = pubByRef.get(ref)
    out.push({
      key: ref,
      name: String((hit && hit.name) || ''),
      kind: 'subscribed',
      questionCount: Number(hit && hit.question_count) || 0,
      unresolved: !hit,
    })
  }
  return out
}

/** 展示名：解析不到库名时如实标出来，绝不显示空白或假名字 */
export function bankLabel (b: PracticableBank): string {
  if (b.name) return b.name
  return b.kind === 'subscribed' ? `订阅的公共题库（离线，未取到名称）` : `本地题库 #${String(b.key)}`
}

/** 记录里的 bank key（IndexedDB 存的是数字或字符串）→ 对应哪个可选库；对不上返回 null */
export function findBank (banks: PracticableBank[], key: any): PracticableBank | null {
  const s = String(key ?? '')
  if (!s) return null
  return banks.find(b => String(b.key) === s) || null
}
