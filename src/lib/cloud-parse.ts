// 云端文件解析（调用 CloudBase 云函数 parseFile）
// 用于浏览器端难以处理的格式：pdf / xlsx / xls / csv / doc，以及超大 docx 的兜底。
// 上传到云存储 → 调用云函数 → 返回段落；临时文件由云函数解析后删除。

const DEFAULT_CLOUD_ENV_ID = (import.meta.env.VITE_DEFAULT_CLOUD_ENV_ID as string) || ''

// 走云端解析的扩展名（浏览器端无法或不适合处理）
export const CLOUD_ONLY_EXTS = ['pdf', 'xlsx', 'xls', 'csv', 'doc']
// 浏览器优先、失败可回退云端的扩展名
export const CLOUD_FALLBACK_EXTS = ['docx']

let app: any = null
let ready = false

async function ensureCloud(): Promise<boolean> {
  if (ready) return true
  try {
    const cfgRaw = localStorage.getItem('cloudbase_config')
    let envId: string | null = null
    if (cfgRaw) {
      try {
        const cfg = JSON.parse(cfgRaw)
        if (cfg.envId && cfg.enabled) envId = cfg.envId
      } catch { /* 配置损坏则回退默认 */ }
    }
    if (!envId) envId = DEFAULT_CLOUD_ENV_ID
    if (!envId) return false

    const mod = await import('@cloudbase/js-sdk')
    const tcb = mod.default
    app = tcb.init({ env: envId })
    const auth = app.auth({ persistence: 'local' })
    let state: any = null
    try { state = await auth.getLoginState() } catch { state = null }
    if (!state) {
      await auth.anonymousAuthProvider().signIn()
    }
    ready = true
    return true
  } catch (e) {
    console.warn('云端解析初始化失败：', e)
    return false
  }
}

export function isCloudParseSupported(ext: string): boolean {
  const e = ext.toLowerCase().replace(/^\./, '')
  return CLOUD_ONLY_EXTS.includes(e) || CLOUD_FALLBACK_EXTS.includes(e)
}

/**
 * 上传文件到云存储并调用云函数解析
 * @returns 解析出的文本段落数组
 */
export async function parseFileInCloud(
  file: File,
  onProgress?: (text: string) => void,
): Promise<string[]> {
  if (!(await ensureCloud())) {
    throw new Error('云端解析不可用：未配置云环境')
  }
  const ext = (file.name.split('.').pop() || '').toLowerCase()

  onProgress?.('正在上传文件到云端…')
  // ⚠️ 平铺路径 `imports/<时间戳-随机>.<ext>` 是**有意的**，不是漏改：
  // 2026-09-15 在生产域名 https://yuhaoxuan.cn 上用真实客户端实测——网页端（匿名登录）调
  // `parseFile {action:'namespace'}` 拿到的是 `{ok:false, code:'NO_IDENTITY'}`，
  // 即服务端（wx-server-sdk 的 `cloud.getWXContext()`）**识别不出网页端调用方身份**
  // （小程序端同一动作能拿到 OPENID）。没有命名空间就没有 `imports/<ns>/` 可写，
  // 只能继续走平铺路径，由云函数里的 `ALLOW_LEGACY_FLAT_IMPORT` 兼容开关放行。
  // ⇒ 该开关**不能**在前置条件（服务端能识别网页端身份）满足前关掉；细节见账本 T16 节。
  const cloudPath = `imports/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const up: any = await app.uploadFile({ cloudPath, filePath: file })
  const fileID = up?.fileID
  if (!fileID) throw new Error('上传失败')

  onProgress?.('云端解析中…（大文件可能需要 1-2 分钟）')
  // 不传 `ext`：kind 由服务端从魔数 + fileID 扩展名推导（P1-56），客户端传了也不参与判定，
  // 留着只会让人误以为「改这里就能换解析器」。
  const res: any = await app.callFunction({
    name: 'parseFile',
    data: { fileID },
  })
  // ⚠️ 2026-09-15 实测（生产域名、真实 @cloudbase/js-sdk）：**函数返回值顶层带 `code` 字段时，
  // 调用方拿不到 `res.result`** —— 网关把 payload 平铺进了响应本身（`{requestId, ok, code, msg}`）。
  // 差分样本共 8 例：生产真实 SDK 7 例（平铺 4 例 = NO_IDENTITY / BAD_FILEID / BAD_PATH / BAD_PARAM，
  // 全部带 `code`；仍在 `res.result` 下 3 例 = 解析成功 + bindAccount 三条失败，全部不带 `code`），
  // 加本机直连生产网关的 HTTP 层 1 例（`{ok:true,paragraphs,count,kind,truncated}` → SDK 侧确为 result 包装）。
  // 按有无 `code` 分组，无一例外。parseFile 的六个错误分支
  // （BAD_FILEID / BAD_PATH / NO_IDENTITY / TOO_LARGE / PARSE_FAILED / EMPTY_RESULT）都带 `code`，
  // ⇒ 只看 `res.result` 会把它们的具体原因**一律**吞成下面那句通用文案。故两种形态都吃。
  // ⚠️ 边界（2026-09-16 凌晨，用户裁定：先记账、不堵路）：**错误路径的端到端提示文案尚未在生产复验**——
  // 线上是 09-10 旧构建、本机 localhost 又被 COS 跨域挡在上传这一步，两边都测不到这一条。
  // 上面 7 例差分测的是「SDK 交出来的对象形状」这一层，也就是本行修复实际生效的那一层。
  // 已挂 T17「真实浏览器待办」（与 P2-28 同批）：发版后点一次只含空白的 .pdf，应显示「未解析到内容」。
  // 附：同一轮顺带证实 P1-56 的魔数判类生效——内容不是 PDF 的 `.pdf` 被服务端判成 `kind:'txt'`
  // 正常解析（`{ok:true,count:1,kind:'txt'}`），不走 PARSE_FAILED。
  const out: any = res?.result ?? res
  if (!out?.ok) {
    throw new Error(out?.msg || '云端解析失败')
  }
  const paragraphs: string[] = Array.isArray(out.paragraphs) ? out.paragraphs : []
  if (!paragraphs.length) throw new Error('未解析到内容')
  onProgress?.(`云端解析完成：${paragraphs.length} 段`)
  return paragraphs
}
