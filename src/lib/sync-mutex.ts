// 同步全局互斥（2026-10-07）
//
// 起因：`cloudState.syncing` 此前**只写不读**（全仓没有一处 `if (cloudState.syncing) ...`），
//   等于没有重入守卫。页面切换本身**不会**触发同步（唯一自动入口是 App.vue 的启动钩子，全会话一次），
//   但**跨入口可并发**：首页胶囊 / 练习页按钮 / 设置页 4 处 / 答题后轻推 / 打开网页自动拉，
//   彼此无互斥 ⇒ 两个 syncAll 可同时跑，同身份并发推拉，最坏**两份进度互相覆盖**；
//   且 pushToCloud 与 syncFromCloud 各自收尾写 `syncing = false` ⇒ 先结束的那个会把还在跑的
//   那一轮标成「已完成」，连状态显示都不可信。
//
// 口径：**同一时刻只跑一轮**；后来者**复用同一 Promise** —— 不重复发请求、也不排队开第二轮。
//   这比"排队"更符合语义：同步是幂等的全量合并，跑第二轮拿到的结果与第一轮等价，纯属浪费。
//   注意**不是节流/防抖**：调用方（轻推链）已有 8s 防抖与 30s 最小间隔，这里只解决并发。
//
// 本模块不 import 任何东西（纯逻辑），便于被测试直接切片跑。

let inFlight: Promise<any> | null = null
let inFlightLabel = ''
// 锁状态变化的观察者（cloud.ts 用它把 `cloudState.syncing` 与真实锁状态对齐）。
// 放在这里而不是 cloud.ts：这样 syncing 只有一个真相来源（锁），不会各处手写打架。
let listeners: Array<(busy: boolean) => void> = []

/** 当前是否有同步在跑（唯一读点：给 UI 与状态回写用）。 */
export function isSyncBusy (): boolean {
  return inFlight !== null
}

/** 订阅锁状态变化（忙碌/空闲切换时回调一次当前值）。 */
export function onSyncBusyChange (fn: (busy: boolean) => void): void {
  listeners.push(fn)
}

function emitBusy (): void {
  const busy = inFlight !== null
  for (const fn of listeners) { try { fn(busy) } catch { /* 观察者自身出错不影响同步 */ } }
}

/** 当前在跑的同步标签（'syncAll' / 'pushToCloud' / …；空闲时为空串）。诊断用。 */
export function syncBusyLabel (): string {
  return inFlightLabel
}

/** 把一次同步包进全局锁。
 *  · 已有同步在跑 ⇒ 直接返回**那个** Promise（不排队、不重复请求）；
 *  · 否则执行 fn，无论成功失败都在收尾释放锁（失败必须释放，否则一次报错会把同步永久卡死）。 */
export function runExclusive<T> (label: string, fn: () => Promise<T>): Promise<T> {
  if (inFlight) return inFlight as Promise<T>
  inFlightLabel = String(label || '')
  const p = (async () => {
    try {
      return await fn()
    } finally {
      inFlight = null
      inFlightLabel = ''
      emitBusy()
    }
  })()
  inFlight = p
  emitBusy()
  return p
}

/** 仅供测试：清空锁状态。**不要在业务代码里调用**。 */
export function __resetSyncMutex (): void {
  inFlight = null
  inFlightLabel = ''
  listeners = []
}
