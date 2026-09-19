// 智能组卷自定义模板模块（2026-09-08）
// 配额表不再锁定固定 220 题：等级/题库/题型配额全部可编辑，可存为模板反复使用。
// 存储：settings 集合 key=compose_templates（走现有云同步链路，跨设备自动同步）。
import { idb } from './db'

export interface ComposeSpecRow {
  level: string
  bank: string
  single: number
  multi: number
  judge: number
}

export interface ComposeTemplate {
  id: string
  name: string
  rows: ComposeSpecRow[]
  createdAt: number
}

const STORE_KEY = 'compose_templates'
// 2026-09-15 新增(P2-11)：存储 schema 版本。旧数据是裸数组（且已经过云同步/备份往返），
// 读取时按 legacy 兼容并逐行归一化；写入统一用 { version, templates } 信封。
const STORE_VERSION = 1

// 公共题库下拉选项（与 COMPOSE_SPEC 原等级对应；模板里可任选）
export const BANK_OPTIONS = [
  { id: 'lquiz_banks_8', name: '初级' },
  { id: 'lquiz_banks_9', name: '中级' },
  { id: 'lquiz_banks_10', name: '高级' },
  { id: 'lquiz_banks_11', name: '技师' },
  { id: 'lquiz_banks_12', name: '安规' },
]

// 出厂默认模板：与原智能组卷 5 等级 × 3 题型规格一致
export function defaultSpec(): ComposeSpecRow[] {
  return [
    { level: '初级', bank: 'lquiz_banks_8', single: 11, multi: 5, judge: 14 },
    { level: '中级', bank: 'lquiz_banks_9', single: 11, multi: 5, judge: 14 },
    { level: '高级', bank: 'lquiz_banks_10', single: 29, multi: 15, judge: 36 },
    { level: '技师', bank: 'lquiz_banks_11', single: 18, multi: 10, judge: 22 },
    { level: '安规', bank: 'lquiz_banks_12', single: 11, multi: 5, judge: 14 },
  ]
}

export function specTotal(rows: ComposeSpecRow[]): number {
  return rows.reduce((s, r) => s + (r.single || 0) + (r.multi || 0) + (r.judge || 0), 0)
}

// 2026-09-15 新增(P2-11)：单行配额归一化。触发场景：键名不符/部分写入的对象经云同步回来后，
// single/multi/judge 为 undefined → specTotal 报 0、UI 显示 0 题试卷、旧版 createExam 照样发布。
// 配额一律归一为非负整数（非法值按 0）；bank 缺失或非字符串的行无法抽题 → 整行丢弃（返回 null）。
function normalizeSpecRow(raw: any): ComposeSpecRow | null {
  if (!raw || typeof raw !== 'object') return null
  const bank = typeof raw.bank === 'string' ? raw.bank.trim() : ''
  if (!bank) return null
  // 三个配额键**全部**缺失/非数值 → 失败行丢弃。这正是审计触发场景（键名不符/部分写入的对象
  // 经云同步回来）：若只归一为 0 保留，specTotal 仍报 0、UI 仍显示 0 题试卷。
  // 显式写了数值的 0（用户编辑中的行）不算失败——Number.isFinite 判定前先排除 null/''。
  const hasQuota = (v: any): boolean =>
    v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))
  if (!hasQuota(raw.single) && !hasQuota(raw.multi) && !hasQuota(raw.judge)) return null
  const quota = (v: any): number => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
  }
  return {
    level: typeof raw.level === 'string' ? raw.level : '',
    bank,
    single: quota(raw.single),
    multi: quota(raw.multi),
    judge: quota(raw.judge),
  }
}

// 2026-09-15 新增(P2-11)：单个模板归一化。非对象直接丢弃；id/name/createdAt 缺失时补安全默认；
// rows 逐行归一化、失败行丢弃，全部丢光（空列表）时回落 defaultSpec()——保证「选中模板」
// 永远不会把配额行变成空/undefined（0 题试卷的源头之一）。
function normalizeTemplate(raw: any, idx: number): ComposeTemplate | null {
  if (!raw || typeof raw !== 'object') return null
  // 2026-09-15(评审 Minor)：补 id 时**不能**带 `Date.now()`——那会让同一条已存记录在每次加载时
  // 拿到不同的 id（直到被保存），于是「当前选中的模板」匹配会来回跳。加载期补的 id 必须
  // **对同一条存储记录在多次加载间保持一致**；行序在两次加载之间不变，故仅用下标即可稳定。
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `tpl-healed-${idx}`
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : '未命名模板'
  const created = Number(raw.createdAt)
  let rows: ComposeSpecRow[] = []
  if (Array.isArray(raw.rows)) {
    for (const r of raw.rows) {
      const row = normalizeSpecRow(r)
      if (row) rows.push(row)
    }
  }
  if (!rows.length) rows = defaultSpec()
  return { id, name, rows, createdAt: Number.isFinite(created) ? created : Date.now() }
}

export async function loadTemplates(): Promise<ComposeTemplate[]> {
  try {
    const raw = await idb.getSetting(STORE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    // 三种来源：新版信封 { version:1, templates:[…] }；旧版裸数组（云同步历史数据，按 legacy 兼容）；
    // 其余（版本不识别/结构损坏）一律忽略——宁可用出厂默认，也不把未知 schema 灌进配额行
    let list: any[]
    if (Array.isArray(parsed)) {
      list = parsed
    } else if (parsed && typeof parsed === 'object' && parsed.version === STORE_VERSION && Array.isArray(parsed.templates)) {
      list = parsed.templates
    } else {
      console.warn('compose_templates 版本/结构不识别，已忽略：', parsed?.version)
      return []
    }
    const out: ComposeTemplate[] = []
    list.forEach((t, i) => {
      const tpl = normalizeTemplate(t, i)
      if (tpl) out.push(tpl)
    })
    return out
  } catch { return [] }
}

export async function saveTemplates(list: ComposeTemplate[]): Promise<void> {
  try {
    await idb.setSetting(STORE_KEY, JSON.stringify({ version: STORE_VERSION, templates: list }))
  } catch { /* 静默 */ }
}