// 2026-09-15 修复(P2-19)：反馈弹窗的「附加最近 100 行运行日志」此前是假的——
// FeedbackDialog 的 buildPayload 只用标题/描述/联系方式拼装，includeLogs 复选框从未被读取，
// 用户被告知「强烈建议，便于排查 Bug」而作者实际什么都收不到。
// 这里实现一个轻量环形缓冲：拦截 console.error/warn/log，保留最近 100 条，
// 供 FeedbackDialog 在用户勾选时真实附加到反馈正文。
// 安装位置：由 **FeedbackDialog 首次打开时**调用 `installLogCapture()`（幂等）。
// ⚠️ 2026-09-15 复审 MF-1：此前挂在 main.ts 启动路径上，但 FeedbackDialog 目前是**孤儿组件**
//    （全仓无引用），所以这条链路**今天对用户尚未生效**——缓冲只在弹窗真被挂载后才会开始收集。
//    「挂载还是删除该弹窗」已交用户裁定。

const MAX_LINES = 100
const buffer: string[] = []

function fmt(a: unknown): string {
  if (typeof a === 'string') return a
  if (a instanceof Error) return a.stack || `${a.name}: ${a.message}`
  try {
    return JSON.stringify(a) ?? String(a)
  } catch {
    return String(a)
  }
}

function push(line: string): void {
  buffer.push(line)
  if (buffer.length > MAX_LINES) buffer.shift()
}

let installed = false

/** 拦截 console.error/warn/log 写入环形缓冲（幂等，重复调用无效） */
export function installLogCapture(): void {
  if (installed) return
  installed = true
  const origError = console.error.bind(console)
  const origWarn = console.warn.bind(console)
  const origLog = console.log.bind(console)
  console.error = (...args: unknown[]) => {
    push('[error] ' + args.map(fmt).join(' '))
    origError(...args)
  }
  console.warn = (...args: unknown[]) => {
    push('[warn] ' + args.map(fmt).join(' '))
    origWarn(...args)
  }
  console.log = (...args: unknown[]) => {
    push('[log] ' + args.map(fmt).join(' '))
    origLog(...args)
  }
}

/** 取最近日志（时间序，最多 MAX_LINES 条），供反馈附件使用 */
export function getRecentLogs(): string[] {
  return [...buffer]
}
