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
 *  口径：answer_states 里「非空对象」的条数（空档是 `{}` ⇒ 0；答过的两条形状都 ≥1）。 */
export function answeredCountLoose (prog: any): number {
  const m = prog && prog.answer_states
  if (!m || typeof m !== 'object') return 0
  let n = 0
  for (const v of Object.values(m)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v as any).length > 0) n++
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
  const substantial = submittedCount(cloudProg) >= SUBSTANTIAL_MIN && submittedCount(localProg) <= 1
    && !(localProg && localProg._reset)
  // 2026-10-04（反向守卫，与上面那条对称）：云端**近乎空**、本机有**实质进度**，且云端那份**没有 `_reset`**
  // ⇒ 不许云端顶掉本机。起因（rabbit 实测当晚 20:28）：小程序清空后新建的「0 答但时间戳更新」条目把
  // 网页端 51 题压成 0，随后网页端一拉，本机也跟着归零。`_reset` 保留「有意清空」这条路。
  const refuseEmptyCloud = answeredCountLoose(localProg) >= SUBSTANTIAL_MIN && answeredCountLoose(cloudProg) <= 1
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
    const guarded = submittedCount(cv) >= SUBSTANTIAL_MIN && submittedCount(lv) <= 1 && !(lv && lv._reset)
    // 2026-10-04（反向守卫，与 mergeProgressForLocal 那条对称）：本机有实质进度、云端近乎空且无 `_reset`
    // ⇒ 保留本机、不上传这个「空档」，否则一推就把云端（与其它设备）的实质进度抹掉。见那边注释的实测经过。
    const refuseEmptyCloud = answeredCountLoose(lv) >= SUBSTANTIAL_MIN && answeredCountLoose(cv) <= 1 && !(cv && cv._reset)
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
