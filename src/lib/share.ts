// 分享工具：动态设置 Open Graph meta + 调起系统分享面板（降级复制）
// 说明：微信/QQ 在「粘贴链接」时弹出的预览卡由服务端爬虫读取静态 HTML 的 OG meta 生成，
// 爬虫不执行 JS，因此 hash 路由 SPA 的「粘贴预览」永远是 index.html 的固定卡。
// 本模块的动态 meta 主要服务两条路径：
//   1) 手机浏览器点「分享」按钮 → navigator.share 系统面板 → 选微信，此时用动态 title，卡片动态生效
//   2) 桌面浏览器地址栏分享 / 书签，读取 document.title

const SITE = '小兔错题本'
const DEFAULT_DESC = '导题 刷题 考试，就用小兔错题本'

function upsertMeta(selector: string, attr: string, key: string, content: string) {
  let el = document.head.querySelector(selector) as HTMLElement | null
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

/** 动态更新页面标题与 OG meta（供系统分享面板 / 桌面浏览器读取） */
export function setPageMeta(opts: { title?: string; desc?: string; image?: string }) {
  const title = opts.title ?? SITE
  if (document.title !== title) document.title = title
  upsertMeta('meta[property="og:title"]', 'property', 'og:title', title)
  if (opts.desc) upsertMeta('meta[property="og:description"]', 'property', 'og:description', opts.desc)
  if (opts.image) upsertMeta('meta[property="og:image"]', 'property', 'og:image', opts.image)
}

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed'

/** 优先调系统分享面板，不支持则复制链接到剪贴板 */
export async function sharePage(opts: { title: string; text: string; url: string }): Promise<ShareResult> {
  // 同步本页 meta，便于系统分享面板 / 桌面端读取
  setPageMeta({ title: opts.title, desc: opts.text })

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: opts.title, text: opts.text, url: opts.url })
      return 'shared'
    } catch (e: any) {
      if (e && e.name === 'AbortError') return 'cancelled'
      // 其他错误（如微信内不支持 navigator.share）降级复制
    }
  }

  // 降级：复制到剪贴板
  try {
    await navigator.clipboard.writeText(opts.url)
    return 'copied'
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = opts.url
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      if (ok) return 'copied'
    } catch {
      /* ignore */
    }
    return 'failed'
  }
}

export const shareDefaults = { SITE, DEFAULT_DESC }
