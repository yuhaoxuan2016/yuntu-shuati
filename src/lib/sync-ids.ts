// 跨设备「题号映射」的纯函数集（2026-09-28）
//
// 背景：每台设备给题目分配的本地 id 是各自自增的 —— 同一个数字在不同设备上指向不同的题。
// 记录（错题/收藏/掌握/练习记录）与续练进度里的「题号引用」因此在跨设备时没有全局意义。
// 本文件把映射决策收敛成纯函数（无 IO、可脚本直测，见 scripts/test-sync-ids.ts）：
//   · 记录侧：cloud.ts 用云端题 `_id` 精确映射到本机题号（映射不上 = 丢弃，绝不挂错号）；
//   · 进度侧：用「来源题号 → 本机题号」索引 + 设备标记，决定 写入/保持 与内容重塑。
// 题目的「来源题号」来自云端题的 `_local_id`，落地时由 cloud.ts 存为本地题的 `src_local_id`。

export const SYNC_DEVICE_KEY = 'cloud_device_id'

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

export interface ProgressMergeResult { write: boolean; value: any }

const progTs = (x: any): number => { const t = Date.parse(String((x && x.saved_at) || '')); return isNaN(t) ? 0 : t }

/**
 * 续练进度的合并决策（纯函数）：
 *  - 云端更新 → 采用云端；同刻时：本地若已是「本机最终形态」（带本机 `_src` 标记）则保持本地，
 *    否则采用云端并**重映射**（历史错位数据的自愈路径）。
 *  - 云端内容来自本机（`_src.dev == myDev`）→ 原样采用（内容已是本机编号）。
 *  - 库不在本机（index 为空）→ 不落地，等题库先同步下来。
 * 落盘值统一带本机 `_src` 标记，保证「本机最终形态」可被下次合并识别。
 */
export function mergeProgressForLocal(
  cloudProg: any, localRaw: string | null, myDev: string, index: Map<number, number>,
  passthrough = false,
): ProgressMergeResult {
  const localProg = (() => { try { return localRaw ? JSON.parse(localRaw) : null } catch { return null } })()
  const localIsMine = !!(localProg && localProg._src && localProg._src.dev === myDev)
  const cloudIsMine = !!(cloudProg && cloudProg._src && cloudProg._src.dev === myDev)
  const ct = progTs(cloudProg)
  const lt = localProg ? progTs(localProg) : -1
  const take = ct > lt || (ct === lt && !localIsMine)
  if (!take) return { write: false, value: null }
  // passthrough = 订阅库/公共库：进度里的题号是**云端稳定 id**（两端一致），跨端无需映射、也不能
  // 按本机题表映射 ⇒ 原样采用。仅本地库（数字键）才需要 src_local_id 重映射；本地题未就位（index 空）
  // 时跳过，等题库同步下来再拉。
  if (!passthrough && (!index || index.size === 0)) return { write: false, value: null }
  const mapped = (cloudIsMine || passthrough) ? { ...cloudProg } : remapProgress(cloudProg, index)
  mapped._src = { dev: myDev, v: 2 }
  return { write: true, value: mapped }
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
