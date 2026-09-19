// 访问统计模块（累计访问 / 今日访问）
// 设计要点：
// 1. 独立集合 visit_stats，不依赖用户云同步配置。无配置时照抄 exam.ts 的 ensureCloud
//    回退逻辑，用默认 envId 匿名登录 —— 任何打开链接的人都能贡献计数。
// 2. 写：db.command.inc 原子自增；读：**两种文档形态都试**——
//    P1-20（T10b，2026-09-15）：`visit_stats` 的文档形态两端不同：
//      · 形态一：`_id` 与 `key` 同值 —— 网页端一直是 `doc(id).set({ key: id, ... })`；
//        **小程序端 T11a 之后也是**（`add({ data: { _id: id, key: id, ... } })`，见 yuntu-mp 同函数）。
//      · 形态二：**只有 `_id`、没有 `key` 字段** —— T11a 之前小程序端建的**存量**文档
//        （当时 `add` 只写 `_id` + 计数字段），网页端按 `key` 查永远查不到 ⇒ 首页访问数恒显示 0。
//        T11a 的「更新时回填 key」只覆盖写得到它的身份，跨身份的存量补不上（见其注释，转 T18）。
//    故读取先按既有 `where({key})` 查（ACL 下最稳），查不到再 `doc(id).get()` 回退——两种形态都能读到。
//    （⚠️ 2026-09-15 复审更正：原文写「小程序端 _id 未必等于 key」，与 mp 源码不符，见上。）
//    两边都失败视为无数据（返回 null，不抛错）。
// 3. 本设备按天 localStorage 去重（刷新不重复计）。**去重标记在写成功之后才落**
//    （P1-20：原实现先落标记再写，写入失败时当天既没计上、又因标记已存在而永久跳过）。
// 4. 云端集合 visit_stats 的 ACL 必须设为「所有用户可读写」，否则非创建者写入会被 ACL 拒绝
//    （功能降级为仅创建者本人可计数）。读取/写入失败均不抛错，绝不影响首页渲染。

// 默认云端环境 ID（构建时由 .env 的 VITE_DEFAULT_CLOUD_ENV_ID 注入，不进 git 仓库）
// 为空 = 未配置且无默认环境，访问统计静默跳过
const DEFAULT_CLOUD_ENV_ID = (import.meta.env.VITE_DEFAULT_CLOUD_ENV_ID as string) || ''
const VISIT_COLLECTION = 'visit_stats'
const VISIT_LS_KEY = 'visit_last_day'

let app: any = null
let db: any = null
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
    // 未配置或配置关闭 → 用默认 envId（不写入 localStorage、不触发云同步）
    if (!envId) envId = DEFAULT_CLOUD_ENV_ID
    if (!envId) return false  // 无默认环境且未配置 → 跳过统计（静默降级）
    const mod = await import('@cloudbase/js-sdk')
    const tcb = mod.default
    app = tcb.init({ env: envId })
    // 必须先匿名登录，否则 ACL（auth != null）会拒绝所有读写
    const auth = app.auth({ persistence: 'local' })
    let state: any = null
    try { state = await auth.getLoginState() } catch { state = null }
    if (!state) {
      await auth.anonymousAuthProvider().signIn()
      try { state = await auth.getLoginState() } catch { state = null }
    }
    db = app.database()
    ready = true
    return true
  } catch (e) {
    console.warn('访问统计 CloudBase 初始化失败：', e)
    return false
  }
}

function localDate(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 原子自增某字段；文档不存在时降级为创建（并发下可能少计 1，统计场景可接受）
// 注意：CloudBase Web SDK 中 doc(id).update() 对「不存在的文档」返回 updated:0 且不抛错，
// 所以光靠 catch 兜底不够——必须显式检查 updated===0 再 set 创建，否则计数永远写不进去。
// P1-20：返回值的**准确语义是「这次尝试没有硬失败」**，不是「确认写成功」——
//   · update 正常返回（含 updated:0 后走 set 兜底）→ true；
//   · update 抛错后 set 成功 → true；两者都抛错 → false。
//   注意它**不解析 `set()` 的回执**（Web SDK 的 set 回执形状未逐一核实），所以 true 只代表
//   「调用链没有抛错」，不代表云端一定落了数。recordVisit 用这个信号决定是否落「今天已计过」标记，
//   其代价边界见该函数末尾那段「两端有意不同」的说明。
async function incField(id: string, field: string, by = 1): Promise<boolean> {
  const _ = db.command
  try {
    const upd: any = await db.collection(VISIT_COLLECTION).doc(id).update({ [field]: _.inc(by) })
    if (upd && upd.updated === 0) {
      await db.collection(VISIT_COLLECTION).doc(id).set({ key: id, [field]: by })
    }
    return true
  } catch (e: any) {
    // update 抛「文档不存在」等异常时，降级为创建
    try {
      await db.collection(VISIT_COLLECTION).doc(id).set({ key: id, [field]: by })
      return true
    } catch { return false } // 写不进去：不抛错（统计失败不影响首页），但如实告诉调用方
  }
}

// P1-20：两种文档形态都读。**形态差异有实据**（对照 yuntu-mp/src/lib/visit.ts 的 T11a 修复注释）：
//   形态一：文档同时有 `_id` 与 `key` 两个字段且同值 —— 网页端一直这么写（doc(id).set({key:id,...})），
//          小程序端 T11a（commit 538c82a）也已对齐，新写的都是这一形态 ⇒ where({key}) 命中；
//   形态二：只有 `_id`（= id）而没有 `key` 字段 —— **T11a 之前小程序端建的存量文档**。
//          当时小程序 add 只写 `_id` + 计数字段，导致「小程序先建出的 global 文档，网页端按 key 查不到 →
//          首页访问数恒显示 0」。T11a 的自愈（update 时回填 key）只覆盖「写得动它」的设备/身份，
//          跨身份的存量文档补不上 key（见其注释「跨身份的存量修复需要云端写授权，已记入 T18」）。
//          ⇒ 本回退正是把这些存量文档读回来的口子。
// doc(id).get() 在部分 ACL 下会被拒（本文件原注释就记着这一点），故只在形态一落空后才试，失败即视为无数据。
async function getField(id: string): Promise<any | null> {
  try {
    const res = await db.collection(VISIT_COLLECTION).where({ key: id }).limit(1).get()
    const row = (res.data && res.data[0]) || null
    if (row) return row
  } catch (e) { /* 落空或 ACL 拒绝 → 走回退 */ }
  try {
    const res = await db.collection(VISIT_COLLECTION).doc(id).get()
    const data = res?.data
    return (Array.isArray(data) ? data[0] : data) || null
  } catch { return null }
}

// 记录一次访问（本设备按天去重，避免重复计）
// P1-20：时序改为「先尝试写、写成功后再落标记」——修复前标记写在两次 await **之前**，
// 一次写入失败就把这一天的计数丢掉（标记已在，当天不再重试），是静默丢计数。
// 门控取「**至少一处**写成功」（a || b），不是「两处都成功」（a && b）：
//   global 与当日文档是固定 _id 的两条**共享**文档，若集合 ACL 按创建者分叉（本文件头第 4 条要求
//   「所有用户可读写」，但云端实际设成什么本地不可核实、GC1 也禁止查），会出现「写 global 恒失败、
//   写当日文档成功」这种持久性偏科；此时若要求两处都成功才标记，标记就永远落不下去，
//   而本函数挂在首页挂载时 ⇒ 用户每刷新一次页面 today 就被多计一次（**无界**）。
//   反之，两处都失败（网络断/全被拒）时不留标记 ⇒ 下次打开会重试，不会静默丢。
// 上界如实说明：网页端每次首页加载最多调用一次 recordVisit，去重上界是「一次/页面加载」，
//   不像小程序端那样挂 onShow 高频触发（那边另有 in-flight 闩，见 yuntu-mp 同函数注释）。
// 记录一次访问（本设备按天去重）
// ⚠️ 并发闩（对齐小程序端 T11a 的修复）：本函数挂在首页挂载/每次回到首页时，判据（读 localStorage）
//    与写标记之间隔着两次云往返 ⇒ 重叠调用会各自读到「没标记」而各计一遍。
//    闩在读标记之后、任何 await 之前同步置位（JS 单线程，中间没有 await），finally 复位。
let visitInFlight = false
export async function recordVisit(): Promise<void> {
  if (visitInFlight) return
  try {
    if (!(await ensureCloud())) return
    const today = localDate()
    const lastDay = localStorage.getItem(VISIT_LS_KEY)
    if (lastDay === today) return
    visitInFlight = true
    let wrote = false
    try {
      const a = await incField('global', 'total', 1)
      const b = await incField(today, 'today', 1)
      wrote = a || b
    } catch (e) {
      console.warn('访问计数写入失败：', e)
    }
    if (wrote) {
      try { localStorage.setItem(VISIT_LS_KEY, today) } catch { /* ignore */ }
    } else {
      console.warn('访问计数两处均未写入成功，不标记当天（下次打开首页会重试）')
    }
  } finally { visitInFlight = false }
}
// ⚠️ 两端在「标记时机」上**有意不同**，不要为了「看起来一致」而互相抄（2026-09-15 控制端裁定）：
//   · 网页端（本文件）：`incField` 的返回值语义是「这次尝试没有**硬失败**」——它不解析回执，
//     回执读不到也会走 set 分支并返回 true。所以「至少一处没硬失败才标记」不会因回执形状误判；
//     而两处**全**抛错时没写进任何东西，不标记也不会多计（下次打开重试是净收益）。
//   · 小程序端（yuntu-mp）：那边的 `incStat` 历史上按**回执**判成败，而回执形状受 GC1 约束本地验不了，
//     一旦回执读不到就会把「写成功」判成失败 ⇒ 门控会导致每次进首页重试、当天计数被反复自增（无界）。
//     故那边取**无条件标记**，把代价压成「该设备当天至多少计一次」。
//   两端都满足「每设备每天 ≤1 次」这个上界（并发由各自的闩保证），只是一个偏「能恢复」、
//   一个偏「不回执依赖」。


// 读取当前统计；失败返回 null（调用方降级不显示）
export async function getVisitStats(): Promise<{ total: number; today: number } | null> {
  if (!(await ensureCloud())) return null
  const today = localDate()
  try {
    const [g, t] = await Promise.all([getField('global'), getField(today)])
    return {
      total: g && typeof g.total === 'number' ? g.total : 0,
      today: t && typeof t.today === 'number' ? t.today : 0,
    }
  } catch (e) {
    console.warn('访问计数读取失败：', e)
    return null
  }
}
