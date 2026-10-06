// 本机硬存档（2026-10-07）
//
// 起因：进度历史栈（`practice_history`）唯一的记录点挂在轻推链上（cloud.ts 的 pushProgressLight），
//   位于「自动同步开关」闸门之后 ⇒ 关掉自动同步、或压根没配云的用户**一条都记不到**，
//   安全网恰好在最需要它的那批人身上失效。rabbit 的原始提议：「留个本地硬存档，不受云端影响，只按本地进度走」。
//
// 三条铁律（改这个文件前先读）：
//   ① 只在「本机保存成功」时写入 —— 与网络、与同步开关完全解耦（落点在练习页落盘校验之后）；
//   ② **任何云端路径不读不写它** —— 键不入 settings 上云白名单（见 cloud.ts listAllSettings），
//      拉取合并 / 上传 / 云端历史恢复都不碰。这是它叫「硬」存档的原因：云端再怎么被写坏都影响不到它。
//      为让②在结构上成立，本模块独立成文件、cloud.ts **不 import 它**（tests/progress-push-safety.test.ts 有断言）。
//   ③ 每库保留最近 5 版，UI 单独成组 + 独立恢复入口（恢复＝写回进度 + 新时间戳，随下次同步上行）。
//
// 去重口径与历史栈一致（按内容，不看时间戳）—— 见 sync-ids.ts 的 progressFingerprint。

import { idb } from './db'
import {
  pushHistory, pickHistory, makeRollbackValue, getOrCreateDeviceId, HISTORY_MAX, type HistoryEntry,
} from './sync-ids'

export const LOCAL_ARCHIVE_KEY = 'local_archive'
export const ARCHIVE_MAX = HISTORY_MAX

async function readArchive(): Promise<Record<string, HistoryEntry[]>> {
  try {
    const raw = await idb.getSetting(LOCAL_ARCHIVE_KEY)
    if (!raw) return {}
    const m = JSON.parse(raw)
    return (m && typeof m === 'object' && !Array.isArray(m)) ? (m as Record<string, HistoryEntry[]>) : {}
  } catch { return {} }
}

/** 把一份刚落盘的进度压入本机硬存档。返回是否有变化。空的坏值一律静默跳过。 */
export async function recordLocalArchive(bankRef: string, prog: any): Promise<boolean> {
  const ref = String(bankRef || '')
  if (!ref || !prog || typeof prog !== 'object') return false
  try {
    const arch = await readArchive()
    const before = Array.isArray(arch[ref]) ? arch[ref] : []
    const after = pushHistory(before, prog)
    if (JSON.stringify(after) === JSON.stringify(before)) return false
    arch[ref] = after
    await idb.setSetting(LOCAL_ARCHIVE_KEY, JSON.stringify(arch))
    return true
  } catch (e) {
    console.warn('[archive] 本机硬存档写入失败（不阻断练习）', e)
    return false
  }
}

/** 列出某库的硬存档版本（新的在前）。 */
export async function listLocalArchive(bankRef: string): Promise<HistoryEntry[]> {
  const arch = await readArchive()
  const arr = arch[String(bankRef || '')]
  return Array.isArray(arr) ? arr : []
}

/** 恢复某一版到当前进度槽位（练习页读的 `practice_progress_<ref>`）。纯本机，不主动推云。 */
export async function restoreLocalArchive(bankRef: string, savedAt: string): Promise<boolean> {
  const ref = String(bankRef || '')
  if (!ref) return false
  try {
    const arch = await readArchive()
    const prog = pickHistory(arch[ref] || [], savedAt)
    if (!prog) return false
    const dev = getOrCreateDeviceId(window.localStorage)
    const value = makeRollbackValue(prog, dev, new Date().toISOString())
    await idb.setSetting('practice_progress_' + ref, JSON.stringify(value))
    return true
  } catch (e) {
    console.warn('[archive] 硬存档恢复失败', e)
    return false
  }
}
