// 「线上有没有更新的构建」——用**入口脚本的文件名**比对，不依赖版本号常量。
//
// 为什么不用版本号：构建期注入的 VITE_* 一旦在服务器 build.env 里漏配就是空串（静默降级），
// 而入口哈希 `assets/index-XXXX.js` 是构建产物自带的，改一个字节就变，天生可信。
//
// 背景（2026-09-25 rabbit 实测踩到）：PWA 的 Service Worker 会连同 index.html 一起预缓存，
// 用户（包括维护者本人）会长期停在旧壳里——他点应用内的「刷新」也可能只是被 SW 又喂了一份旧壳。
// 这里只负责**发现**，刷新动作交给调用方（走「注销 SW + 清缓存 + reload」那条老路）。
const ENTRY_RE = /assets\/(index-[A-Za-z0-9_-]+\.js)/

/** 从一份 index.html 文本里抠出入口脚本路径；抠不到返回空串 */
export function entrySrcOf (html: string): string {
  const m = String(html || '').match(ENTRY_RE)
  return m ? m[1] : ''
}

/** 当前页面真正加载的那个入口脚本（构建产物是 /assets/index-XXXX.js；dev 下是 /src/main.ts） */
export function currentEntrySrc (): string {
  try {
    const el = document.querySelector('script[type="module"][src]') as HTMLScriptElement | null
    const src = el ? el.getAttribute('src') || '' : ''
    const m = src.match(ENTRY_RE)
    return m ? m[1] : ''
  } catch { return '' }
}

/** 只有两边都拿到、且不相同才算「有新版」——拿不到一律当没新版，宁可不提示也别误报 */
export function isOutdated (current: string, remote: string): boolean {
  return Boolean(current && remote && current !== remote)
}

/** 取线上 index.html 里的入口名（no-store，别让 HTTP 缓存骗我们） */
export async function fetchRemoteEntry (): Promise<string> {
  try {
    const res = await fetch('/index.html', { cache: 'no-store' })
    if (!res.ok) return ''
    return entrySrcOf(await res.text())
  } catch {
    return ''
  }
}

/** 组合判据。dev 下入口是 /src/main.ts（没有哈希），由**调用方**跳过定时检查 —— 本模块不读 import.meta，
 *  这样它在 node 里也能被直接 require 来跑断言（tests/update-check.test.cjs）。 */
export async function checkForUpdate (): Promise<boolean> {
  const cur = currentEntrySrc()
  if (!cur) return false
  return isOutdated(cur, await fetchRemoteEntry())
}
