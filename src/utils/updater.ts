// 自动更新工具（PWA 网页版：无桌面更新能力，全部空实现）
export const check = async () => null
export type Update = any

export async function checkForUpdates(opts: { silent?: boolean } = {}): Promise<any> {
  // 当前版本：构建时由 vite 的 define 注入（见 vite.config.ts），dev/异常时回退到 unknown
  const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
  return { hasUpdate: false, currentVersion: version }
}

export async function promptAndApplyUpdate(_update: any): Promise<boolean> {
  window.alert('网页版无需更新，刷新页面即可获取最新版本')
  return false
}

export async function autoCheckOnStartup(): Promise<void> {
  // 网页版自动更新不可用
}
