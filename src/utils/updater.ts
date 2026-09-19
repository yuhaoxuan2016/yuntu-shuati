// 自动更新工具（PWA 网页版：无桌面更新能力，全部空实现）
export const check = async () => null
export type Update = any

export async function checkForUpdates(opts: { silent?: boolean } = {}): Promise<any> {
  return { hasUpdate: false, currentVersion: '1.2.48-web' }
}

export async function promptAndApplyUpdate(_update: any): Promise<boolean> {
  window.alert('网页版无需更新，刷新页面即可获取最新版本')
  return false
}

export async function autoCheckOnStartup(): Promise<void> {
  // 网页版自动更新不可用
}
