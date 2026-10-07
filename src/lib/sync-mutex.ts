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
//   例外：有「前置动作」的流程（如「清空本机再拉」的恢复）走 `waitForIdle`，
//   等轮空后**自己独占开一轮** —— 复用会拿到一个可能在清空**之前**就读完本机数据的轮次。
//
// ⚠️ 使用契约（2026-10-08 补，踩过：`maybeAutoSyncOnOpenInner` 因违反它而把全站同步锁死）：
//   **持锁函数体内不得再调用被 runExclusive 包裹的导出函数** —— 那会再抢同一把锁，
//   拿回的是「自己这一轮」的 promise ⇒ await 自己 ⇒ 永不返回、锁永不释放。
//   持锁函数应直接调对应的 `*Inner`（本仓命名约定，cloud.ts 内可访问）。
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

/** runExclusive 的可选行为。**不传 = 复用在飞的那一轮**（既有调用点全都依赖这个默认值）。 */
export interface RunExclusiveOptions {
  /** 等当前那轮结束再**自己独占开一轮**，不复用别人的结果。恢复类操作用它。
   *  为什么需要：复用对「幂等的全量合并」是省事，但对「我先清空、再由我自己拉」这类
   *  **有前置动作**的流程是错的 —— 别人的那一轮可能在清空**之前**就读完了本机数据。 */
  waitForIdle?: boolean
  /** waitForIdle 的最长等待（毫秒，默认 60s）。等不到就**抛错** —— 绝不复用别人的结果、也不静默。 */
  waitMaxMs?: number
}

const WAIT_IDLE_MAX_MS = 60 * 1000
const WAIT_IDLE_TIMEOUT_MSG = '另一轮同步仍在进行，请稍后再试'

/** 真正开一轮：调用方必须已确认锁是空闲的（inFlight 为 null）。 */
function startRound<T> (label: string, fn: () => Promise<T>): Promise<T> {
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

/** 等锁空闲再开自己那一轮。锁在本函数 `await` 期间一直被别人持着，所以只能轮询式重试。 */
async function waitIdleThenStart<T> (label: string, fn: () => Promise<T>, opts: RunExclusiveOptions): Promise<T> {
  const deadline = Date.now() + (Number(opts.waitMaxMs) > 0 ? Number(opts.waitMaxMs) : WAIT_IDLE_MAX_MS)
  while (inFlight) {
    const remain = deadline - Date.now()
    if (remain <= 0) throw new Error(WAIT_IDLE_TIMEOUT_MSG)
    const cur = inFlight
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      // 只等到「本轮结束」或「超时」，谁先到算谁；别人的失败不该打断我
      await Promise.race([
        cur.then(() => {}, () => {}),
        new Promise<void>(res => { timer = setTimeout(res, remain) }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
    if (Date.now() >= deadline) throw new Error(WAIT_IDLE_TIMEOUT_MSG)
  }
  return startRound(label, fn)
}

/** 把一次同步包进全局锁。
 *  · 已有同步在跑 ⇒ 默认直接返回**那个** Promise（不排队、不重复请求）；
 *  · 传 `waitForIdle` ⇒ 等它结束再**自己独占开一轮**（等超时则抛错）；
 *  · 否则执行 fn，无论成功失败都在收尾释放锁（失败必须释放，否则一次报错会把同步永久卡死）。 */
export function runExclusive<T> (label: string, fn: () => Promise<T>, opts?: RunExclusiveOptions): Promise<T> {
  if (!inFlight) return startRound(label, fn)
  if (!opts?.waitForIdle) return inFlight as Promise<T>
  return waitIdleThenStart(label, fn, opts)
}

/** 仅供测试：清空锁状态。**不要在业务代码里调用**。 */
export function __resetSyncMutex (): void {
  inFlight = null
  inFlightLabel = ''
  listeners = []
}
