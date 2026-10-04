// 错题列表展示排序（2026-10-03）：按累计做错次数从多到少——用户要能一眼看到「错得最多的题」。
// 同次数保持原顺序（Array.prototype.sort 稳定排序，ES2019 起各引擎保证）。
// 颜色阈值与筛选口径共用一个常量，避免三处字面量再次漂移。
export const STUBBORN_MIN = 3

export function sortByWrongCountDesc<T>(items: T[], countOf: (x: T) => number): T[] {
  return [...items].sort((a, b) => (countOf(b) || 0) - (countOf(a) || 0))
}
