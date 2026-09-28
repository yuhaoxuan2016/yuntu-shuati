// 「这份本地库是不是从公共题库复制来的」——判定归一处（2026-09-28）。
//
// 为什么需要它：这个判据原先散在 HomeView 的 `sourceOf` / `isImportedCopy` 里，菜单项与卡片提示
// 各用一套，且都会**按题库名兜底匹配**。于是「用『导入题库』从文件建的私人库只要名字撞上某个公共库」
// 就会被认成副本：卡片谎称「本库来自公共题库」，菜单里还多一条「从公共题库更新」——点下去会把
// 公共库的解析/知识点/难度/配图写进这份库的题里（匹配不到 source_index 时还会**按位置**兜底，
// 落到别的题上）。rabbit 2026-09-28 在小程序上报的就是这个现象（小程序那条已单独修）。
//
// 两条判据，各司其职：
//   · `origin_ref`（导入时写下的公共库 _id，不依赖网络）——精确，优先；
//   · 名字兜底——只给 09-24 之前导的老副本用（那时还没写 origin_ref）。
//     兜底必须排除「文件导入」的库：那种库走 `ImportView` 的 `bankStore.create(name, null)`，
//     visibility 取默认值 `'public'`；而公共库副本一直是**显式** `'private'`（自最初提交起如此）。
//
// ⚠️ 本模块是纯函数（不读 store、不发网络），供视图调用与 `tests/bank-provenance.test.cjs` 直测。
export interface BankLike { name?: string | null; origin_ref?: string | null; visibility?: string | null }
export interface PublicBankLike { _id?: string | null; name?: string | null }

/** 定位「可能的内容来源」公共库：origin_ref 精确命中优先，其次按名字兜底（老副本）。
 *  只用于取内容，**不要**拿它决定「要不要显示入口」——那是 isPublicCopy 的职责。 */
export function findSourceBank (b: BankLike | null | undefined, publicBanks: PublicBankLike[] | null | undefined): PublicBankLike | null {
  const list = Array.isArray(publicBanks) ? publicBanks : []
  const ref = String(b?.origin_ref || '').trim()
  if (ref) {
    const hit = list.find(p => String(p?._id || '') === ref)
    if (hit) return hit
  }
  const name = String(b?.name || '').trim()
  if (!name) return null
  return list.find(p => String(p?.name || '') === name) || null
}

/** 是不是「从公共题库复制来的本地副本」——决定要不要给「从公共题库更新」/「提交到公共题库」。 */
export function isPublicCopy (b: BankLike | null | undefined, publicBanks: PublicBankLike[] | null | undefined): boolean {
  if (String(b?.origin_ref || '').trim()) return true
  // 文件名导入的私人库 = visibility 默认 'public' ⇒ 名字撞车也不算副本
  if (String(b?.visibility || '') === 'public') return false
  return !!findSourceBank(b, publicBanks)
}
