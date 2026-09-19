// 外观（明暗主题 / 主题色 / 字号）恢复模块
// 2026-09-07 修复：此前主题恢复只在设置页 onMounted 里执行，
// 刷新后不进设置页就永远停在默认绿。现在 App 启动时调用 restoreAppearance()。
// 策略：先读 localStorage 缓存同步应用（避免闪烁），再异步从设置存储校准。
import { api } from '../utils/api'

const CACHE_KEY = 'ui_appearance_cache'

interface Appearance {
  theme: string          // light | dark | system
  themeColor: string     // green | blue | ... | cloud
  fontSize: string       // small | medium | large
}

function applyToDom(a: Appearance) {
  const html = document.documentElement
  if (a.theme === 'light') html.setAttribute('data-theme', 'light')
  else if (a.theme === 'dark') html.setAttribute('data-theme', 'dark')
  else html.removeAttribute('data-theme')
  html.setAttribute('data-theme-color', a.themeColor || 'green')
  if (a.fontSize) html.setAttribute('data-font-size', a.fontSize)
}

function readCache(): Appearance | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const c = JSON.parse(raw)
    if (!c || typeof c !== 'object') return null
    return { theme: c.theme || 'system', themeColor: c.themeColor || 'green', fontSize: c.fontSize || 'medium' }
  } catch { return null }
}

// 写缓存（设置页每次应用外观时调用，保证缓存与最新选择一致）
export function updateAppearanceCache(a: Partial<Appearance>): void {
  try {
    const merged = { ...(readCache() || { theme: 'system', themeColor: 'green', fontSize: 'medium' }), ...a }
    localStorage.setItem(CACHE_KEY, JSON.stringify(merged))
  } catch { /* 静默 */ }
}

// App 启动时调用：先用缓存即时恢复（无闪烁），再异步从设置校准（跨设备云同步的值）
export async function restoreAppearance(): Promise<void> {
  const cached = readCache()
  if (cached) applyToDom(cached)
  try {
    const [t, tc, fs] = await Promise.all([
      api.getSetting('ui_theme'),
      api.getSetting('ui_theme_color'),
      api.getSetting('ui_font_size'),
    ])
    const a: Appearance = {
      theme: (t as string) || 'system',
      themeColor: (tc as string) || 'green',
      fontSize: (fs as string) || 'medium',
    }
    applyToDom(a)
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(a)) } catch { /* 静默 */ }
  } catch { /* 恢复失败保持当前（缓存或默认） */ }
}
