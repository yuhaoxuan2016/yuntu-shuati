// 跨设备「题号映射」的纯函数集（2026-09-28）
//
// 背景：每台设备给题目分配的本地 id 是各自自增的 —— 同一个数字在不同设备上指向不同的题。
// 记录（错题/收藏/掌握/练习记录）与续练进度里的「题号引用」因此在跨设备时没有全局意义。
// 本文件把映射决策收敛成纯函数（无 IO、可脚本直测，见 tests/sync-ids.test.ts）：
//   · 记录侧：cloud.ts 用云端题 `_id` 精确映射到本机题号（映射不上 = 丢弃，绝不挂错号）；
//   · 进度侧：用「来源题号 → 本机题号」索引 + 设备标记，决定 写入/保持 与内容重塑。
// 题目的「来源题号」来自云端题的 `_local_id`，落地时由 cloud.ts 存为本地题的 `src_local_id`。

export const SYNC_DEVICE_KEY = 'cloud_device_id'

/** 进度内容的 schema 版本（写入时标在 `_src.v`）。v3 起「本机最终形态」才可信：
 *  v2（2026-09-28 早）的直通/映射判据有过一次错误泛化（按键形态分流而非按库归属），
 *  ⇒ v2 的本地内容一律视为「待重算」，同刻(saved_at 相同)也会被重映射修正。 */
export const PROG_SCHEMA_V = 3

export interface KVLike { getItem(key: string): string | null; setItem(key: string, value: string): void }

/** 设备指纹：首次调用生成并持久化；用途 = 判断一份同步内容是不是「本机写的」（换身份不影响）。 */
export function getOrCreateDeviceId(kv: KVLike): string {
  try {
    const cur = kv.getItem(SYNC_DEVICE_KEY)
    if (cur) return cur
    const id = Math.random().toString(36).slice(2, 10)
    kv.setItem(SYNC_DEVICE_KEY, id)
    return id
  } catch { return 'unknown' }
}

/** 本机题表 → 「来源题号 → 本机题号」索引（跨设备映射的唯一依据）。 */
export function buildSrcLocalIndex(questions: Array<{ id: number; src_local_id?: number | null }>): Map<number, number> {
  const m = new Map<number, number>()
  for (const q of questions) {
    const s = Number((q as any)?.src_local_id)
    if (Number.isFinite(s) && s > 0 && typeof (q as any)?.id === 'number') m.set(s, (q as any).id)
  }
  return m
}

/** 单题号映射：命中返回本机题号，否则 null（丢失策略由调用方决定）。 */
export function mapSrcToLocal(index: Map<number, number>, srcId: unknown): number | null {
  const v = Number(srcId)
  if (!Number.isFinite(v)) return null
  const hit = index.get(v)
  return hit == null ? null : hit
}

/** 进度里「已提交」的答题数（守卫判定用：区分「近乎空的自动生成态」与「实质进度」）。 */
export function submittedCount (prog: any): number {
  const m = prog && prog.answer_states
  if (!m || typeof m !== 'object') return 0
  let n = 0
  for (const v of Object.values(m)) { if (v && (v as any).submitted === true) n++ }
  return n
}

/** 「云端有实质进度」的判定下限（已提交答题数）。 */
export const SUBSTANTIAL_MIN = 5

/** **形状无关**的答题计数（只给「空档 vs 实质进度」这两条守卫用）。
 *  为什么不能直接用 submittedCount：它只数 `submitted === true`，而**小程序经桥写进来的**条目形状是
 *  `{picked, correct}`（没有 `submitted`）⇒ 会被数成 0、把实质进度误判成空档。
 *  口径：answer_states 里「非空对象」的条数（空档是 `{}` ⇒ 0；答过的两条形状都 ≥1）。
 *  ⚠️ 边界（2026-10-05 实测发现）：**「刚打开题库未作答」的条目也是非空对象** ——
 *  `{selected:[],blankAnswer:'',submitted:false,isCorrect:false,...}` 有 8 个字段 ⇒ 本函数返回 **1 而非 0**。
 *  所以它**分不出「答过 1 题」与「打开过 1 题」**：用作守卫阈值时，`<=1` 恰好吃住这个空档（这是它能工作的原因），
 *  但任何需要精确区分的地方都必须改用 `trulyAnsweredCount`。 */
export function answeredCountLoose (prog: any): number {
  const m = prog && prog.answer_states
  if (!m || typeof m !== 'object') return 0
  let n = 0
  for (const v of Object.values(m)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v as any).length > 0) n++
  }
  return n
}

/** **严格**已答计数：只数「确实作答过」的条目，把「打开过但没答」排除在外。
 *  判据（依据 2026-10-05 对云端真实数据 99 条 answer_state 的形状普查）：
 *    · 网页端形状 —— **以 `submitted` 为唯一判据**：`true` 即答过。
 *      ⚠️ 不能再去要求「有选项/有填空/有 judgeSelected」：实测 82/99 条是判断题，
 *      形状是 `{submitted:true, selected:[], blankAnswer:'', judgeSelected:false|true}` ——
 *      「判断题答否」时 `judgeSelected:false`，而 `false` 与 `null` 极易被 `!== null` 之外的条件写错排除。
 *    · 桥/小程序形状 `{picked, correct}` —— 有 `picked`（非 null）或 `correct` 为真即算答过。
 *  ⚠️ 与 `answeredCountLoose` 的区别：本函数对「打开题库自动生成的那一条」返回 0。 */
export function trulyAnsweredCount (prog: any): number {
  const m = prog && prog.answer_states
  if (!m || typeof m !== 'object') return 0
  let n = 0
  for (const v of Object.values(m)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue
    const o = v as any
    if ('submitted' in o) { if (o.submitted === true) n++ ; continue }   // 网页端形状：只看 submitted
    if ('picked' in o || 'correct' in o) {                               // 桥/小程序形状
      if (o.picked !== null && o.picked !== undefined) { n++; continue }
      if (o.correct === true) n++
    }
  }
  return n
}

/** 进度内容与「本机已知题号」（题 id ∪ 源题号）的命中率（0~1）。
 *  无 order_ids 时返回 1（无据可判，不作无效处理）。用于「本机进度与题库对不上」的保护判定。 */
export function orderHitRate (prog: any, knownIds: Set<number>): number {
  const ids = prog && Array.isArray(prog.order_ids) ? prog.order_ids : []
  if (!ids.length) return 1
  let hit = 0
  for (const id of ids) { const n = Number(id); if (Number.isFinite(n) && knownIds.has(n)) hit++ }
  return hit / ids.length
}

export interface ProgressMergeResult { write: boolean; value: any }

const progTs = (x: any): number => { const t = Date.parse(String((x && x.saved_at) || '')); return isNaN(t) ? 0 : t }

/**
 * 续练进度的合并决策（纯函数）：
 *  - 云端更新 → 采用云端；同刻时：本地若已是「本机最终形态」（带本机 `_src` 标记）则保持本地，
 *    否则采用云端并**重映射**（历史错位数据的自愈路径）。
 *  - 守卫：本地近乎空（≤1 已提交）+ 云端实质（≥5 已提交）→ 无论时间戳都采用云端；
 *    本地点过「重新开始」（`_reset` 标记）时不触发，避免重置被顶回来。
 *  - 云端内容来自本机（`_src.dev == myDev`）→ 原样采用（内容已是本机编号）。
 *  - 库不在本机（index 为空）→ 不落地，等题库先同步下来。
 * 落盘值统一带本机 `_src` 标记，保证「本机最终形态」可被下次合并识别。
 */
export function mergeProgressForLocal(
  cloudProg: any, localRaw: string | null, myDev: string, index: Map<number, number>,
  passthrough = false,
): ProgressMergeResult {
  const localProg = (() => { try { return localRaw ? JSON.parse(localRaw) : null } catch { return null } })()
  const localIsMine = !!(localProg && localProg._src && localProg._src.dev === myDev && localProg._src.v === PROG_SCHEMA_V)
  const cloudIsMine = !!(cloudProg && cloudProg._src && cloudProg._src.dev === myDev)
  const ct = progTs(cloudProg)
  const lt = localProg ? progTs(localProg) : -1
  // 2026-09-28（守卫）：本机进度「近乎空」（≤1 题已提交）而云端有实质进度（≥5 题）时，
  // **即使本机 saved_at 更新也以云端为准** —— 防「打开练习页自动生成的新进度」（时间戳新、
  // 内容空）按「取新」规则永久顶掉云端真实进度。
  // 例外：本机带 `_reset` 标记（用户在练习页点过「重新开始」）⇒ 空是**故意的**，交常规取新规则。
  // 2026-10-05（修根因第 3 层）：判据由 `submittedCount` 换成 `trulyAnsweredCount`。
  // 旧写法对数「小程序经桥写进来的 `{picked,correct}` 形状」恒为 0 ⇒ 云端实质进度会被判成空档，
  // 「云端实质 vs 本机近乎空」这条守卫形同虚设（实测 10-05 rabbit 的 lquiz_banks_15 641 条就这样被顶掉）。
  const substantial = trulyAnsweredCount(cloudProg) >= SUBSTANTIAL_MIN && trulyAnsweredCount(localProg) <= 1
    && !(localProg && localProg._reset)
  // 2026-10-04（反向守卫，与上面那条对称）：云端**近乎空**、本机有**实质进度**，且云端那份**没有 `_reset`**
  // ⇒ 不许云端顶掉本机。起因（rabbit 实测当晚 20:28）：小程序清空后新建的「0 答但时间戳更新」条目把
  // 网页端 51 题压成 0，随后网页端一拉，本机也跟着归零。`_reset` 保留「有意清空」这条路。
  // 2026-10-05：同样换成 `trulyAnsweredCount`（`answeredCountLoose` 对「打开过未作答」的空档也返回 1，
  // 会让「本机实质 vs 云端空档」这条反向守卫把 1 条空档误当实质；严格判据下空档恒为 0）。
  const refuseEmptyCloud = trulyAnsweredCount(localProg) >= SUBSTANTIAL_MIN && trulyAnsweredCount(cloudProg) <= 1
    && !(cloudProg && cloudProg._reset)
  if (refuseEmptyCloud) return { write: false, value: null }
  const take = substantial || ct > lt || (ct === lt && !localIsMine)
  if (!take) return { write: false, value: null }
  // passthrough = 订阅库/公共库：进度里的题号是**云端稳定 id**（两端一致），跨端无需映射、也不能
  // 按本机题表映射 ⇒ 原样采用。仅本地库（数字键）才需要 src_local_id 重映射；本地题未就位（index 空）
  // 时跳过，等题库同步下来再拉。
  if (!passthrough && (!index || index.size === 0)) return { write: false, value: null }
  const mapped = (cloudIsMine || passthrough) ? { ...cloudProg } : remapProgress(cloudProg, index)
  mapped._src = { dev: myDev, v: PROG_SCHEMA_V }
  return { write: true, value: mapped }
}

/**
 * **上传侧**的逐键合并（纯函数）：进度 map 是全量打包上传的，若直接整条覆盖云端，
 * 一台「本机还没有那些键」的设备（新电脑 / 清过缓存 / 手机端）一推就会把别的设备写的键抹掉。
 * 口径：云端 map 打底 + 本机键覆盖；同一个库两边都有时按 `saved_at` 取新，
 * 并复用与 mergeProgressForLocal **同一条**空缺守卫（本机近乎空 + 云端实质 ⇒ 保留云端，
 * `_reset` = 用户故意的空）。⇒「先推」与「先拉」结果一致，同步顺序不再影响数据。
 */
export function mergeProgressMapForCloud(
  cloudMap: Record<string, any> | null, localMap: Record<string, any> | null,
): { map: Record<string, any>; tookCloud: number } {
  const c = (cloudMap && typeof cloudMap === 'object' && !Array.isArray(cloudMap)) ? cloudMap : {}
  const l = (localMap && typeof localMap === 'object' && !Array.isArray(localMap)) ? localMap : {}
  const out: Record<string, any> = { ...c }
  let tookCloud = 0
  for (const bid of Object.keys(l)) {
    const cv = c[bid]
    const lv = l[bid]
    if (!cv) { out[bid] = lv; continue }
    // 2026-10-05：与 mergeProgressForLocal 同批改用 `trulyAnsweredCount`（旧的 submittedCount 数不到桥形状）。
    const guarded = trulyAnsweredCount(cv) >= SUBSTANTIAL_MIN && trulyAnsweredCount(lv) <= 1 && !(lv && lv._reset)
    // 2026-10-04（反向守卫，与 mergeProgressForLocal 那条对称）：本机有实质进度、云端近乎空且无 `_reset`
    // ⇒ 保留本机、不上传这个「空档」，否则一推就把云端（与其它设备）的实质进度抹掉。见那边注释的实测经过。
    const refuseEmptyCloud = trulyAnsweredCount(lv) >= SUBSTANTIAL_MIN && trulyAnsweredCount(cv) <= 1 && !(cv && cv._reset)
    if (refuseEmptyCloud) { out[bid] = lv; continue }
    if (guarded || progTs(lv) < progTs(cv)) { out[bid] = cv; tookCloud++ } else { out[bid] = lv }
  }
  return { map: out, tookCloud }
}

/** 进度内容重映射：order_ids 剔除映射失败项；current_id 映射；answer_states 丢失败键。 */
export function remapProgress(prog: any, index: Map<number, number>): any {
  const out: any = { ...(prog || {}) }
  if (Array.isArray(out.order_ids)) {
    const next: number[] = []
    for (const id of out.order_ids) { const m = mapSrcToLocal(index, id); if (m != null) next.push(m) }
    out.order_ids = next
  }
  if (out.current_id != null) out.current_id = mapSrcToLocal(index, out.current_id)
  if (out.answer_states && typeof out.answer_states === 'object') {
    const ns: Record<string, any> = {}
    for (const [k, v] of Object.entries(out.answer_states)) {
      const m = mapSrcToLocal(index, k)
      if (m != null) ns[String(m)] = v
    }
    out.answer_states = ns
  }
  return out
}

/** 2026-10-03：把小程序上行的进度条目（题号是 `bankRef::id:<云题 _id>`）重塑成网页端本地形态。
 *  idMap = 「云题 _id → 本机题号」索引（由调用方异步构建）；映射不到的题号一律丢弃
 *  （丢失策略与记录侧一致：绝不挂错号）；order_ids 全空时返回 null（放弃合并）。 */
export function reshapeMpProgress(prog: any, idMap: Map<string, number>): any | null {
  const toLocal = (qid: unknown): number | null => {
    const s = String(qid || '')
    const at = s.lastIndexOf('::id:')
    const docId = at >= 0 ? s.slice(at + 5) : s
    if (!docId) return null
    const hit = idMap.get(docId)
    return hit == null ? null : hit
  }
  if (!prog || typeof prog !== 'object') return null
  const order_ids = (Array.isArray(prog.order_ids) ? (prog.order_ids as unknown[]) : [])
    .map(toLocal)
    .filter((x: number | null): x is number => x != null)
  if (!order_ids.length) return null
  const answer_states: Record<string, any> = {}
  const src = (prog.answer_states && typeof prog.answer_states === 'object') ? prog.answer_states : {}
  for (const [k, v] of Object.entries(src)) {
    const m = toLocal(k)
    if (m != null) answer_states[String(m)] = v
  }
  const current = toLocal(prog.current_id)
  return {
    mode: prog.mode || 'order',
    order_ids,
    current_id: current == null ? order_ids[0] : current,
    answer_states,
    finished: !!prog.finished,
    saved_at: prog.saved_at,
    _src: prog._src,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 进度题号引用解析（2026-10-07）
//
// 起因：小程序推上云的进度条目用 qid 字符串（`bankRef::id:<云题 _id>`）；网页版拉取时对
// 「本地没有的库」（订阅库）走「直通不映射」分支原样存下 ⇒ 练习页恢复只认数字 current_id
// ⇒ 静默放弃恢复、从第 1 题开始，首存还把 last_practice 指针改写成 position=1 并上行
//（2026-10-07 02:10 实测事故）。本模块把三类引用统一解析成本机索引，供恢复链使用。
//
// 三类引用：数字本机 id（网页版自产）/ src_local_id（跨设备来源号）/ qid 字符串
//（`::id:<云题 _id>`，需题目对象带 cloud_qid —— 订阅题目经 mapPublicQuestion 携带）。
// 解析不了返回 undefined —— **绝不猜**（防挂错号，宁可走「未恢复」保守路径）。
// ─────────────────────────────────────────────────────────────────────────────
export interface ProgressRefMaps {
  byId: Map<number, number>
  byDocId: Map<string, number>
}

export function buildProgressRefMaps(questions: any[]): ProgressRefMaps {
  const byId = new Map<number, number>()
  const byDocId = new Map<string, number>()
  ;(questions || []).forEach((q: any, i: number) => {
    if (!q) return
    if (typeof q.id === 'number') byId.set(q.id, i)
    const s = Number(q.src_local_id)
    if (Number.isFinite(s) && s > 0) byId.set(s, i)
    const d = q.cloud_qid
    if (typeof d === 'string' && d) byDocId.set(d, i)
  })
  return { byId, byDocId }
}

export function resolveProgressRef(ref: unknown, maps: ProgressRefMaps): number | undefined {
  if (typeof ref === 'number') return Number.isFinite(ref) ? maps.byId.get(ref) : undefined
  const s = String(ref == null ? '' : ref).trim()
  if (!s) return undefined
  if (/^\d+$/.test(s)) return maps.byId.get(Number(s))
  const at = s.lastIndexOf('::id:')
  if (at >= 0) return maps.byDocId.get(s.slice(at + 5))
  return maps.byDocId.get(s)
}

// ─────────────────────────────────────────────────────────────────────────────
// 进度历史栈（2026-10-05）
//
// 起因：进度只有「当前值」一个槽位，一旦被空档覆盖（10-04 与 10-05 各实测一次：
//   本机/云端任一端的「刚打开题库、0 答但 saved_at 更新」条目把实质进度顶掉）就**永久找不回**。
//   守卫能拦住一部分，但守卫本身依赖形状判定，且拉取链上「本机进度被判无效」时守卫会失效。
//   ⇒ 补一层与守卫**互相独立**的保险：每次实质变化都把旧版本压进历史栈，保留最近 N 版。
//
// 设计约束：
//   · **只入栈实质版本**（answeredCountLoose >= 1），否则每次打开练习页生成的空档会把栈刷爆、
//     把真版本挤出去 —— 那恰好帮了倒忙。
//   · 内容相同（同一 saved_at）不重复入栈，避免防抖保存把栈塞满同一个版本。
//   · 栈是**纯数据**，不参与任何合并决策 ⇒ 不可能让同步逻辑变复杂或引入新的覆盖路径。
//   · 每库独立保留 HISTORY_MAX 版；超出淘汰最旧。
// ─────────────────────────────────────────────────────────────────────────────

/** 每个库保留的历史版本数。5 版 × 单库最大约 25KB ≈ 125KB，CloudBase 单文档 16MB 上限内。 */
export const HISTORY_MAX = 5

export interface HistoryEntry {
  saved_at: string
  answered: number      // 入栈时的已答数（供 UI 展示「这一版答了多少题」）
  current_id: number | string
  finished: boolean
  /** 点过「重新开始」的那一版 —— 回滚它等于接受「清空」，UI 需提示 */
  marked?: string
  /** 2026-10-07：内容指纹（入栈去重判据）。老版本条目没有这个字段，按「内容已变」处理。 */
  fp?: string
  prog: any             // 完整进度快照
}

// 2026-10-07（rabbit 指出「做题慢五个存档会不会相似甚至相同」）：
// 入栈去重只看 saved_at ⇒ 同一份进度每被重新保存一次（重开库、防抖补存、切后台）就白占一版，
// 慢速用户 5 个槽位会被「几乎相同」的版本填满，真正能救命的旧版本反而被挤掉。
// 判据改为**实质内容**：已答数 或 逐题对错摘要 变化才占槽；只翻页（current_id 变）不占槽。
function hash32 (s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** 进度的内容指纹（不含 saved_at / current_id）：同内容同指纹，供入栈去重。 */
export function progressFingerprint (prog: any): string {
  const st = (prog && typeof prog.answer_states === 'object' && prog.answer_states) || {}
  const parts: string[] = []
  for (const k of Object.keys(st).sort()) {
    const v: any = (st as any)[k]
    if (!v || typeof v !== 'object') { parts.push(k + '=' + String(v)); continue }
    if ('submitted' in v) parts.push(k + ':s' + (v.submitted ? 1 : 0) + ':c' + (v.isCorrect === true ? 1 : 0) + ':j' + String(v.judgeSelected))
    else parts.push(k + ':p' + String(v.picked ?? '') + ':c' + (v.correct === true ? 1 : 0))
  }
  return trulyAnsweredCount(prog) + '#' + hash32(parts.join('|')) + '#' + (prog && prog.finished ? 1 : 0)
}

/** 把一份进度压入历史栈（返回新栈）。非实质内容、或与栈顶**内容相同**时不改动。
 *  「实质」用 `trulyAnsweredCount` 判 —— **必须**，不能用 answeredCountLoose：
 *  后者对「打开题库自动生成的那一条」返回 1（条目有 8 个字段但都没答），
 *  用它会让每次打开练习页都入一版空档，5 个槽位很快被空档占满、真版本全被挤出去。 */
export function pushHistory(stack: HistoryEntry[] | null | undefined, prog: any): HistoryEntry[] {
  const cur = Array.isArray(stack) ? stack.slice() : []
  if (!prog || typeof prog !== 'object') return cur
  const answered = trulyAnsweredCount(prog)
  if (answered < 1) return cur                       // 空档不入栈
  const savedAt = String(prog.saved_at || '')
  if (!savedAt) return cur
  if (cur.length && cur[0] && String(cur[0].saved_at || '') === savedAt) return cur  // 同版本去重
  const fp = progressFingerprint(prog)
  // 2026-10-07：栈顶内容未变 ⇒ 不占槽（只更新这一版的展示时间无意义，反而挤掉真版本）
  if (cur.length && cur[0] && String(cur[0].fp || '') === fp) return cur
  const entry: HistoryEntry = {
    saved_at: savedAt,
    answered,
    current_id: prog.current_id,
    finished: !!prog.finished,
    marked: prog._reset ? String(prog._reset) : undefined,
    fp,
    prog: JSON.parse(JSON.stringify(prog)),          // 深拷：入栈后原对象还会被就地改写
  }
  const next = [entry, ...cur.filter((e) => String(e?.saved_at || '') !== savedAt)]
  return next.slice(0, HISTORY_MAX)
}

/** 从历史栈取出某版进度（供回滚）。找不到返回 null。 */
export function pickHistory(stack: HistoryEntry[] | null | undefined, savedAt: string): any | null {
  const hit = (Array.isArray(stack) ? stack : []).find((e) => String(e?.saved_at || '') === String(savedAt))
  return hit && hit.prog ? hit.prog : null
}

/** 回滚：把历史版本写回当前槽位。带上 `_reset` 语义 —— 否则同步守卫会用别处的旧版本把它顶回去。
 *  `_src` 必须重打为本机标记（内容此刻已是本机口径，不应再被重映射）。 */
export function makeRollbackValue(prog: any, myDev: string, nowIso: string): any {
  const out = JSON.parse(JSON.stringify(prog || {}))
  out.saved_at = nowIso                              // 回滚视为一次「新的写入」，时间戳必须更新
  out._src = { dev: myDev, v: PROG_SCHEMA_V }
  delete out._reset                                  // 回滚本身不是「有意清空」，别留下这个标记
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// 2026-10-07：推送侧两道闸门（03:44 / 02:10 两次「进度被写退」事故的直接补丁）
//
// 事故形态：一台「本机进度是空档」的设备轻推 ⇒ 云端 333 答的实质进度被 1 条空档顶掉。
// 守卫（mergeProgressMapForCloud）本身是对的（用真实形态验过：空 vs 富 ⇒ 保富），
// 但**守卫没跑起来**就等于没有 —— 下面两条把「守卫失效」的两种出口各自堵死。
// ─────────────────────────────────────────────────────────────────────────────

export const PROGRESS_ROW_KEY = 'practice_progress'

/**
 * 装配真正要推送的设置行。
 * **`readFailed` 时必须剔除进度行**——旧实现 `(await merge()) || rows` 会在读云端失败时
 * 原样直推本机值，等于「守卫一失效就敞开大门」（03:44 就是这么被顶掉的）。
 * 宁可本次不推（下轮再试），也不能拿本机空档去覆盖云端实质进度。
 */
export function resolvePushedRows<T extends { key?: string }> (
  rows: T[], merged: T[] | null, readFailed: boolean,
): T[] {
  const hasProg = rows.some(r => r && r.key === PROGRESS_ROW_KEY)
  if (!hasProg) return rows
  if (readFailed || !merged) return rows.filter(r => !(r && r.key === PROGRESS_ROW_KEY))
  return merged
}

/** 两端对同一个库写的 `bank_id` 是各自的本地号（网页 14 / 小程序 21），只有库名可跨端比对。 */
function sameBankForPointer (a: any, b: any): boolean {
  const an = String(a?.bank_name || '').trim()
  const bn = String(b?.bank_name || '').trim()
  if (an && bn) return an === bn
  // 2026-10-07：**先按字符串比 bank_id**（订阅库是 `lquiz_banks_14`，两端一致且稳定）。
  // ⚠️ 此前只有 `Number(bank_id)` 一条路 ⇒ 字符串 id 得 NaN ⇒ isFinite 假 ⇒ 判「不是同一个库」
  //   ⇒ 防倒退闸门对**订阅库整体失效**。事故（当日 08:14 实测）：rabbit 进「变电安规2026」（订阅库）
  //   退出后，本机首存把指针写成 position=1 上行，云端 last_practice 被顶成第 1 题（进度本体未丢，
  //   丢的是首页「继续刷题」指向）。触发前提是**库名缺失**（事故里云端写入的 bank_name 是空串），
  //   所以此前只用带名字的用例测不出来 —— 见 tests/progress-push-safety.test.ts 的 ②b 组。
  // 数字库（本地库）仍走数值比较，且**不跨类型**认等（'14' 与 14 视为不同，避免本地号撞上订阅库号）。
  const as = String(a?.bank_id ?? '').trim()
  const bs = String(b?.bank_id ?? '').trim()
  if (!as || !bs) return false
  const aNum = Number(as)
  const bNum = Number(bs)
  const aIsNum = as !== '' && Number.isFinite(aNum)
  const bIsNum = bs !== '' && Number.isFinite(bNum)
  if (aIsNum !== bIsNum) return false          // 一边数字一边字符串 ⇒ 不同库，不做跨类型猜测
  return aIsNum ? aNum === bNum : as === bs
}

/**
 * 续练指针能不能推。
 * 判据（定死，勿随意调）：同一个库、新位置 ≤2、旧位置 ≥5、且没有「重新开始」标记 ⇒ 判为倒退，不推。
 * 下限 2 是留给「刚打开就退出」的正常写入；上限 5 保证「本来就在开头」的新库不被误伤。
 */
export function shouldPushLastPractice (
  local: any, cloud: any | null | undefined, opts?: { readFailed?: boolean },
): boolean {
  if (opts?.readFailed) return false                 // 读不到云端就别推（与进度行同口径）
  if (!local || typeof local !== 'object') return false
  if (String(local._reset || '')) return true        // 用户明确「重新开始」，那是他的意图
  if (!cloud || typeof cloud !== 'object') return true  // 云端没有 ⇒ 首次写入
  const nPos = Number(local.position)
  const oPos = Number(cloud.position)
  if (!Number.isFinite(nPos) || !Number.isFinite(oPos)) return true
  if (!sameBankForPointer(local, cloud)) return true
  return !(nPos <= 2 && oPos >= 5)
}

/**
 * 「以云端为准恢复进度」的结果文案判据（纯函数、可直测）。
 * 口径：**只有真的重建了本机进度键才说「恢复」**。
 * 起因（2026-10-08）：原先这句话只以「拉取没报错」为准，而「没报错」≠「恢复了」——
 * 清空本机后若那一轮拉取其实早已读完本机数据（详见 sync-mutex 的 waitForIdle），
 * 界面照样说恢复成功，用户进去却还是第 1 题、已做 0 题。宁可少说，不可多说。
 * @param cleared 清空的本机进度键个数
 * @param rebuilt 拉完之后**数出来的**本机非空进度键个数
 */
export function restoreOutcomeText (cleared: number, rebuilt: number): { kind: 'ok' | 'info'; text: string } {
  const c = Number(cleared) || 0
  const r = Number(rebuilt) || 0
  if (r > 0) return { kind: 'ok', text: `已按云端版本恢复 ${r} 个题库的进度` }
  if (c > 0) return { kind: 'info', text: `已清空本机 ${c} 个进度，但云端没有可恢复的内容` }
  return { kind: 'info', text: '本机与云端都没有可恢复的进度' }
}

/**
 * 记录类（错题 / 收藏 / 已掌握 / 练习记录）落地：库解析失败后，还能不能拿 `bank_id` 本身当 bankRef 再试一次。
 * 返回**要试的 bankRef**，或 null（不需要试 / 不该试）。
 * 起因（2026-10-08）：网页端推送**不给记录类写 `bank_ref`**（只有「题目」那一支写），而订阅库记录的
 *   `bank_id` 就是 bankRef 字符串本身 ⇒ 落地时两条既有路径（本机题库 cloud_id / `bank_ref`）都解不出
 *   ⇒ 整条**静默丢弃**（实测：错题 8 条、收藏 4 条、已掌握 81 条）。
 * ⚠️ 只认**字符串**：数字 `bank_id` 是「推送设备的本地库号」，解不出就是解不出 —— 拿它当 bankRef
 *   去认库会认到别的库上（宁可丢，不可错挂）。
 */
export function recordBankRefFallback (bankId: number | string | null | undefined, rawBankId: unknown): string | null {
  if (bankId != null) return null            // 已经解出来了，别再兜（免得把认对的覆盖成别的）
  if (typeof rawBankId !== 'string') return null
  return rawBankId || null
}

/**
 * 记录类落地：这条记录的**题号该怎么定**（纯函数、可直测）。三个取值：
 *   · `'translate'` —— 按 `question_cloud_id` 翻译成本机题号（**本地库**：本机有题目行可查）
 *   · `'as-is'`     —— 原样采用 `question_id`（**订阅库**：题号本就是云端稳定号）
 *   · `'skip'`      —— 定不了 ⇒ 整条跳过（宁可少挂，绝不挂错号）
 *
 * 为什么**订阅库不能翻译**：`mapCloudQuestionToLocal` 是读**本机题目行**建 `cloud_id → 本机号` 索引的，
 *   而订阅库（题目在线直读、不落本地）本机**没有任何题行** ⇒ 必然返回 null ⇒ 带 `question_cloud_id`
 *   的行被整体丢弃（实测 11 条错题就是这么没的）。
 *   订阅库的 `question_id` 由 `api.listQuestions` 的订阅分支给出，就是云端 `_local_id`，跨设备一致；
 *   展示侧用**同一套编号**去云端取题 ⇒ 原样采用即正确，翻译反而只可能失败。
 *
 * 判据 `typeof bankId === 'string'` = 订阅库：本仓既有口径（纯数字 ⇒ 本地库；字符串 ⇒ 订阅库，
 *   见 PracticeView 的路由参数说明与 `mapCloudBankRefToLocal` 的返回值）。
 */
export function planRecordQuestionRef (opts: {
  bankId: number | string | null | undefined
  questionCloudId?: unknown
  questionId?: unknown
}): 'translate' | 'as-is' | 'skip' {
  const bankId = opts.bankId
  if (bankId == null) return 'skip'                                     // 库都没解出来：无处置放
  const hasUsableId = Number(opts.questionId) > 0
  if (typeof bankId === 'string') return hasUsableId ? 'as-is' : 'skip' // 订阅库：不翻译
  if (opts.questionCloudId) return 'translate'                          // 本地库：优先按云端题 _id 精确映射
  return hasUsableId ? 'as-is' : 'skip'
}
