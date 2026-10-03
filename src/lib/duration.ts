// 练习时长格式化。**两端逐字节相同**（改一端必须同步另一端），同 spaced-repetition.ts 的约定。
// 口径：每题提交时的用时累加成「当日练习时长」，单位秒。
// 显示统一 HH:MM:SS（与参考实现一致：不足 1 小时也补小时位）。
export function formatDuration(totalSecs: number | null | undefined): string {
  const n = Number(totalSecs)
  if (!Number.isFinite(n) || n <= 0) return '00:00:00'
  // 上限 999 小时：防止脏数据（负数/溢出/NaN 串）把布局撑破
  const secs = Math.min(Math.floor(n), 999 * 3600)
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  const p2 = (x: number) => String(x).padStart(2, '0')
  return `${p2(h)}:${p2(m)}:${p2(s)}`
}

// 毫秒 → 秒（四舍五入）。答题计时器每秒跳一次，累计用整秒即可。
export function msToSecs(ms: number | null | undefined): number {
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.round(n / 1000)
}

// 是否有可展示的时长（0 / 缺字段都算「没有」，用于决定是否渲染时长片段）
export function hasDuration(v: unknown): boolean {
  const n = Number(v)
  return Number.isFinite(n) && n > 0
}