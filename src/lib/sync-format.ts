// 同步结果明细 → 一行中文文案（纯函数、零依赖）
//
// 口径（2026-09-28 与 rabbit 对齐）：
//   「题库 2 个（初级2026、中级2026）· 题目 833 道 · 记录 5 条 · 订阅 3 个 · 设置 1 项」
//   · 题库：名单最多点 3 个，其余折叠为「等 N 个」；为 0 的类别省略；全 0 → 「无新增内容」
//   · 「记录」= 练习记录 + 错题 + 收藏 + 已掌握；「订阅」仅网页端有（小程序端无订阅体系）
//   · 「设置」每次全量推，所以它基本每次都会出现（设置本来就是每次推送的内容）
// 本文件在两端保持**逐字节相同**（先例：parser.ts / spaced-repetition.ts）；改一端记得同步另一端。

export interface SyncDetail {
  banks?: string[]
  questions?: number
  records?: number
  subscriptions?: number
  /** 订阅的公共题库名（能解析到就显示名单；解析不到退回数量）——2026-09-28 补 */
  subsNames?: string[]
  settings?: number
}

const pos = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)

export function formatBankNames (names: string[]): string {
  const list = (names || []).map(x => String(x || '').trim()).filter(Boolean)
  if (!list.length) return ''
  if (list.length <= 3) return `${list.length} 个（${list.join('、')}）`
  return `${list.length} 个（${list.slice(0, 3).join('、')} 等 ${list.length} 个）`
}

export function formatSyncDetail (d?: SyncDetail | null): string {
  if (!d) return '无新增内容'
  const parts: string[] = []
  const banks = (d.banks || []).map(x => String(x || '').trim()).filter(Boolean)
  if (banks.length) parts.push(`题库 ${formatBankNames(banks)}`)
  if (pos(d.questions)) parts.push(`题目 ${pos(d.questions)} 道`)
  if (pos(d.records)) parts.push(`记录 ${pos(d.records)} 条`)
  if (pos(d.subscriptions)) {
    const names = (d.subsNames || []).map(x => String(x || '').trim()).filter(Boolean)
    parts.push(names.length ? `订阅 ${formatBankNames(names)}` : `订阅 ${pos(d.subscriptions)} 个`)
  }
  if (pos(d.settings)) parts.push(`设置 ${pos(d.settings)} 项`)
  return parts.length ? parts.join(' · ') : '无新增内容'
}
