// 删除标记（DeletedMark）的消费判据 —— 纯函数，离线可断言。
//
// 2026-09-29 实测出来的坑：`removeCloudDocsByMark` 把「按 `_openid` 查不到待删文档」当作删除成功。
// 而「查不到」有两种截然不同的原因：
//   ① 确实已经删干净了（正常）；
//   ② **当前登录身份不是当初那份数据的属主** —— 查询条件里的 `_openid` 不匹配，自然一条也查不到。
// rabbit 的账号就栽在②：他在本机删了三个本地题库，随后在**匿名身份**下点了一次同步，
// 那批删除标记被判成"成功"消费掉；等重新绑定回 `wx_` 身份再上传，标记已经没了 ⇒
// 云端三个库（3 行题库 + 2,475 行题目）永久残留，而且驱动「下载不再拉回」的账本也一并失效。
//
// 判据：标记上记 `uid`（创建时的身份）。身份对不上就**留着**、且不计入重试次数——
// 它没有失败，只是轮不到这次同步干；等绑定回同一个账号自然会删掉。
// 老标记（本次改动之前创建的没有 uid）无法判定身份 ⇒ 查不到时也宁留，由重试上限兜底。

export interface DeletedMarkLike {
  uid?: string
  tries?: number
}

export interface RemoveResult {
  /** 这一轮实际扫描到的、属于本标记的文档数（0 = 一条都没看见） */
  scanned: number
  /** 成功删掉的条数 */
  removed: number
}

export type MarkOutcome = 'consumed' | 'keep-identity' | 'keep-empty'

export function decideDeletedMark (
  mark: DeletedMarkLike | null | undefined,
  authedUid: string | null | undefined,
  res: RemoveResult,
): MarkOutcome {
  const markUid = String((mark && mark.uid) || '')
  const me = String(authedUid || '')
  // 身份不符：不是"删完了"，是"这次轮不到我删" ⇒ 留着，且不消耗重试次数
  if (markUid && markUid !== me) return 'keep-identity'
  // 身份相符（或老标记无从判定）却一条都没扫到：老标记无法排除"其实属于别的身份" ⇒ 留着
  if (!markUid && Number(res && res.scanned) === 0) return 'keep-empty'
  return 'consumed'
}

/** 身份不符的标记不消耗重试次数（它没失败，只是在等正确的身份） */
export function nextTries (outcome: MarkOutcome, prev: number | undefined): number {
  const n = Number(prev || 0)
  return outcome === 'keep-empty' ? n + 1 : n
}
