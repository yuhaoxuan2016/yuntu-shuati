// 间隔重复算法（简化版 SM-2）
// 用于智能学习计划，根据答题质量安排复习时间

/**
 * 复习记录 —— IndexedDB `review_records` / 备份载荷里的**实际持久化形状**（snake_case）
 *
 * 2026-09-15 修复(P2-8)：此前声明为 camelCase（`questionId`/`lastReview`/`easeFactor`），
 * 而下面 `calculateDailyTask` 的函数体读的是 snake_case（`r.question_id`、`record.next_review`、
 * `record.last_review`、`record.interval`）——**这四个字段在旧接口上根本不存在**。
 * 今天没炸只因唯一调用方 `StudyPlanView.vue` 传进来的是原始 IDB 行，且网页端 `npm run build`
 * 不做类型检查（P1-37），4 条 TS2339/TS2551 从未暴露。任何**遵守已发布接口**的调用方会执行
 * `recordMap.set(undefined, r)`：所有题的 key 都是 undefined、互相覆盖，于是每道题都查不到记录
 * 而被当作新题，`reviewQuestions` 永久为空且**无任何报错**。
 * （`SettingsView.vue` 的更新日志记载过同类字段命名不匹配已经弄坏过一次复习排程。）
 * 故按「代码实际读写的形状」重写接口，而不是改函数体去迁就一个没人遵守的接口。
 *
 * 两个时间字段都要收 number 与 string：`next_review` 自 2026-09-15(P1-21) 起写**纪元毫秒数字**，
 * 但用户 IndexedDB 里的历史记录是 `toISOString()` 的 ISO 串；读取一律走 `toReviewTs()`。
 */
export interface ReviewRecord {
  id?: number
  question_id: number
  bank_id?: number
  last_review: string | number          // 本次复习时刻（历史/网页端为 ISO 串）
  quality: number                       // 0-5，答题质量（0-2:错误，3-5:正确）
  repetitions: number                   // 连续正确次数
  ease_factor: number                   // 难度因子（1.3-2.5）
  interval: number                      // 复习间隔（天）
  next_review?: string | number | null  // 下次复习时刻（P1-21 起为纪元毫秒数字；历史数据为 ISO 串）
}

export interface StudyPlan {
  id: number
  name: string
  bankIds: number[]
  dailyGoal: number
  examDate?: string
  createdAt: string
}

export interface DailyTask {
  date: string
  reviewQuestions: number[]  // 需要复习的题目ID
  newQuestions: number[]     // 新题目ID
  totalGoal: number
}

/**
 * 复习间隔上限（天）—— 2026-09-15 新增(P1-23)
 * 超过一年的间隔对刷题没有意义，且会让题目实质从复习队列里消失（审计实测排程曾达 595 天）
 */
export const MAX_INTERVAL_DAYS = 365

/**
 * 计算下次复习日期
 * @param lastReview 上次复习时间
 * @param quality 答题质量（0-5）
 * @param repetitions 连续正确次数
 * @param easeFactor 难度因子
 * @param previousInterval 上次复习间隔（天）——2026-08-22 修复：此前函数内部 interval 未初始化，
 *        连续答对第 3 次起 interval*EF 得 NaN，复习日期变 Invalid Date
 * @returns 下次复习日期和更新后的参数
 */
export function calculateNextReview(
  lastReview: Date,
  quality: number,
  repetitions: number,
  easeFactor: number,
  previousInterval = 0
): { nextReview: Date; newRepetitions: number; newEaseFactor: number; newInterval: number } {
  let interval: number
  let newRepetitions = repetitions
  let newEaseFactor = easeFactor

  if (quality < 3) {
    // 答错，重新开始
    newRepetitions = 0
    interval = 1
  } else {
    // 答对
    newRepetitions = repetitions + 1

    if (newRepetitions === 1) {
      interval = 1
    } else if (newRepetitions === 2) {
      interval = 3
    } else {
      // SM-2：间隔 = 上次间隔 × 难度因子（首答对后第一次用 EF 时以 3 天为基准）
      const base = previousInterval > 0 ? previousInterval : 3
      interval = Math.round(base * easeFactor)
    }
  }

  // 更新难度因子
  // 2026-09-15 修复(P1-23)：补上界钳制。此前只有 `Math.max(1.3, …)`，而 `quality===5` 是**唯一**
  // 会提升 EF 的取值（增量恒为 +0.1），且两处调用点都把持久化 EF 原样回传下一次 →
  // 从 EF 2.5 起全「认识」的排程为 1→3→8→22→64→192→**595 天**，题目实质从复习队列消失。
  // 同时 `getMemoryStrength` 按 2.5 钳制显示，UI 显示「强」时存储的 EF 已经 3.1+，读数与排程脱节。
  // `ReviewRecord.ease_factor` 的注释与显示层钳制本来就写着 1.3-2.5，唯独计算层不钳，这里补齐。
  newEaseFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
  newEaseFactor = Math.max(1.3, Math.min(2.5, newEaseFactor))

  // 2026-09-15 修复(P1-23 追加)：间隔上限。即便 EF 钳到 2.5，长期全对的题间隔仍会无界增长
  // （3→8→20→50→125→313→**783**），第 8 次复习就跨过一年。因为 interval 会被持久化并作为
  // 下一次的 base（`previousInterval`），钳在 MAX_INTERVAL_DAYS 后会稳定收敛在该上限，不再漂移。
  interval = Math.min(MAX_INTERVAL_DAYS, interval)

  // 注意：这里返回的 nextReview 锚定的是**调用方传进来的 lastReview**，而两端调用方传的都是
  // 「上次复习时刻」。迟到复习时它会算出**已经过去**的日期，使该题永远处于到期状态。
  // 2026-09-15(P1-21)：**持久化 next_review 一律走 `computeNextReviewTs()`**，不要用这个返回值
  // （两端四个调用点已全部改完，本字段如今无消费方，保留只为不破坏已发布的函数签名）。
  const nextReview = new Date(lastReview)
  nextReview.setDate(nextReview.getDate() + interval)

  return {
    nextReview,
    newRepetitions,
    newEaseFactor,
    newInterval: interval
  }
}

// ============================================================
// 2026-09-15 新增(P1-21)：下次复习时刻的**唯一**计算入口与**唯一**解析入口
// 此前两端共用本文件却在各自调用点算 next_review，三处都不一样：
//   (a) 锚点 —— 网页端从「上次复习日」算（PracticeView/MemoryReviewView 传 record.last_review），
//       小程序端从「当下」算（practice.vue/review.vue 用 Date.now()）；迟到 20 天再复习时两者相差 20 天，
//       网页端甚至会算出**已经过去**的 next_review，使该题永远处于到期状态。
//   (b) 算术 —— 网页端 `setDate(+n)` 是日历日（DST 正确），小程序端 `n*86400000` 是固定 24h，
//       跨夏令时边界每小时漂移。
//   (c) 类型 —— 网页端存 ISO 串、小程序端存纪元数字；跨端读取时 `Number("2026-01-01T…")` = NaN。
//       ⚠️ 症状方向曾被写反，2026-09-15 评审更正并实测确认：`store.ts` 落盘走 `JSON.stringify`、
//       读取走 `JSON.parse`，而 `JSON.stringify(NaN)` 得到**字面量 `null`** → 盘上是 `null`；
//       `store.ts:276` 的 `dueReviews()` 是裸比较 `x.nextReview <= now`，`null` 被强制转成 `0`
//       → `0 <= now` **恒为 true**。故修复前的真实症状是**相反**的：凡是从网页备份恢复进来的
//       `next_review` 一律**永久处于到期状态**，记忆复习页被几十天后才该到期的题**淹没**，而不是「题目消失」。
//       （实测：`JSON.parse(JSON.stringify(NaN)) === null` 且 `null <= Date.now() === true`；
//        并由 harness 夹具 G3 佐证——它在修复前失败，正因为那条未来到期的记录被 `dueReviews()` 返回了。）
// 裁定：统一为**纪元毫秒数字**（小程序侧本来就是数字，数字更省存储、比较更直接），
//       锚点统一为「本次复习的当下」，算术统一为日历日。
// ============================================================

/**
 * 计算下次复习的纪元毫秒时间戳 —— 两端所有 next_review 写入点一律用这个，不要再自己算
 *
 * @param intervalDays 复习间隔（天），取自 `calculateNextReview().newInterval`
 * @param anchorTs 锚点时刻，默认 `Date.now()`，即**本次复习的当下**；
 *        不要传上次复习时刻——那正是 P1-21(a) 的分歧源（迟到复习会算出已过去的日期）
 * @returns 下次复习时刻（纪元毫秒数字）
 */
export function computeNextReviewTs(intervalDays: number, anchorTs: number = Date.now()): number {
  // 间隔必须钳成有限整数：NaN/Infinity 会让 Date 变 Invalid、getTime() 得 NaN。
  // 2026-09-15 评审更正：NaN 落进 next_review 后**两端症状相反**，不是「两端都恒为 false」——
  //   网页端读取处有 `Number.isNaN(next)` 守卫 → `continue` 跳过该行 → 题目确实**静默消失**；
  //   小程序端 `store.ts` 走 `JSON.stringify`，NaN 变成字面量 `null`，而 `dueReviews()` 是裸比较
  //   `x.nextReview <= now` → `null` 转成 `0` → **恒为 true** → 题目**永久处于到期状态**。
  // 钳制之后两种结果都不会发生。
  const raw = Number.isFinite(intervalDays) ? intervalDays : 1
  const days = Math.max(0, Math.min(MAX_INTERVAL_DAYS, Math.round(raw)))
  const anchor = Number.isFinite(anchorTs) ? anchorTs : Date.now()
  const d = new Date(anchor)
  // 用 setDate 做**日历日**算术（跨 DST 正确），不用 anchor + days*86400000（固定 24h，跨夏令时每小时漂移）
  d.setDate(d.getDate() + days)
  return d.getTime()
}

/**
 * 把持久化的 next_review / last_review 解析成纪元毫秒 —— P1-21 的**读取侧**兼容层
 * 接受两种形态：纪元毫秒**数字**（P1-21 之后的新数据）、**字符串**（网页端历史数据，
 * `toISOString()` 的 ISO 串）。不可解析（null/空串/NaN/垃圾值/其它类型）一律返回 null，
 * 由调用方按「无到期信息」处理，不再让 NaN 渗进比较式。
 *
 * 对历史 ISO 串，本函数与修复前的 `new Date(v).getTime()` 产出**完全相同**的数字
 * （`Date.parse(s) === new Date(s).getTime()`），即用户已存在的排程不会因这次统一而漂移。
 */
export function toReviewTs(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const t = Date.parse(v)
    return Number.isNaN(t) ? null : t
  }
  return null
}

/**
 * 计算每日学习任务
 * @param plan 学习计划
 * @param reviewRecords 复习记录
 * @param allQuestions 所有题目
 * @returns 每日任务
 */
export function calculateDailyTask(
  plan: StudyPlan,
  reviewRecords: ReviewRecord[],
  allQuestions: { id: number; bankId: number }[]
): DailyTask {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = formatDate(today)

  // 获取需要复习的题目（今天或之前需要复习的）
  const reviewQuestions: number[] = []
  const newQuestions: number[] = []

  // 2026-08-23 优化：用 Set/Map 替代嵌套 find/includes，O(N×R+M×B) → O(N+R+M+B)
  const bankIdSet = new Set(plan.bankIds)
  const recordMap = new Map<number, ReviewRecord>()
  for (const r of reviewRecords) {
    recordMap.set(r.question_id, r)
  }

  // 筛选计划中的题库题目
  const planQuestions = allQuestions.filter(q => bankIdSet.has(q.bankId))

  for (const question of planQuestions) {
    const record = recordMap.get(question.id)

    if (record) {
      // 到期判断统一以 next_review 为准
      // 2026-09-15 修复(P1-21)：解析一律走 toReviewTs，同时接受纪元毫秒**数字**（P1-21 之后的新数据）
      // 与 **ISO 串**（用户 IndexedDB 里的历史数据）。三个分支与修复前逐条对应，也与网页端三个视图的
      // 读取口径一致：
      //   有 next_review 且可解析 → 用它
      //   有 next_review 但损坏   → Invalid Date（**不**回落到 last_review），`Invalid <= today` 恒 false
      //   无 next_review          → last_review + interval 个日历日（原有回落算术）
      // last_review 也损坏时同样得 Invalid Date，与修复前 `new Date(undefined)` 的行为一致：
      // 不把无从判断的记录误当成到期。
      let due: Date
      if (record.next_review) {
        const nextTs = toReviewTs(record.next_review)
        due = new Date(nextTs === null ? NaN : nextTs)
      } else {
        const lastTs = record.last_review ? toReviewTs(record.last_review) : null
        due = new Date(lastTs === null ? NaN : lastTs)
        due.setDate(due.getDate() + (record.interval ?? 0))
      }
      due.setHours(0, 0, 0, 0)
      if (due <= today) {
        reviewQuestions.push(question.id)
      }
    } else {
      // 新题目
      newQuestions.push(question.id)
    }
  }

  // 限制每日新题目数量
  const maxNewQuestions = plan.dailyGoal - reviewQuestions.length
  const limitedNewQuestions = newQuestions.slice(0, Math.max(0, maxNewQuestions))

  return {
    date: todayStr,
    reviewQuestions,
    newQuestions: limitedNewQuestions,
    totalGoal: plan.dailyGoal
  }
}

/**
 * 格式化日期为 YYYY-MM-DD
 */
export function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * 计算学习进度
 */
export function calculateProgress(
  task: DailyTask,
  completedQuestions: number[]
): { completed: number; total: number; percentage: number } {
  const total = task.reviewQuestions.length + task.newQuestions.length
  const completed = completedQuestions.filter(id => 
    task.reviewQuestions.includes(id) || task.newQuestions.includes(id)
  ).length
  
  return {
    completed,
    total,
    percentage: total > 0 ? Math.round((completed / total) * 100) : 0
  }
}

// ============================================================
// 2026-08-23 新增：记忆复习功能（自动评估 + 记忆强度 + 标签）
// 从「智能学习计划」的 SM-2 算法扩展为全局能力，任何练习模式都可积累记忆数据
// ============================================================

/**
 * 根据「对/错 + 答题耗时」自动推断 SM-2 答题质量（quality 0-5）
 * 用于不打断刷题节奏的自动记忆评估；用户可手动覆盖
 *
 * 映射表（标签名以 2026-09-15 P2-10 拆分后的 `qualityLabel` 为准：3=「勉强」、2=「模糊」）：
 *  答对 + 秒答 (<5s)     → 5  认识（熟练掌握，间隔拉最长）
 *  答对 + 想了一会儿     → 4  一般
 *  答对 + 想很久 (>15s)  → 3  勉强（勉强答对，容易忘）
 *  答错 + 秒选 (<5s)     → 1  不认识（完全不会）
 *  答错 + 思考过         → 2  模糊（接近但没答对）
 *
 * @param isCorrect 是否答对
 * @param durationMs 答题耗时（毫秒），null/undefined 时退化为对/错二元 → 5 或 1
 */
export function calculateAutoQuality(isCorrect: boolean, durationMs: number | null | undefined): number {
  const ms = typeof durationMs === 'number' && !Number.isNaN(durationMs) ? durationMs : null
  if (isCorrect) {
    if (ms === null) return 5
    if (ms < 5000) return 5
    if (ms < 15000) return 4
    return 3
  } else {
    if (ms === null) return 1
    if (ms < 5000) return 1
    return 2
  }
}

/**
 * 计算记忆强度（0-100），供 UI 概览/卡片展示
 * 综合「难度因子 EF」和「复习间隔」两个维度：
 *  - EF 越高，说明题目越容易被记住（长期稳定）
 *  - 间隔越长，说明已进入长时记忆通道
 * 无记录（新题）不应调用此函数，由调用方按「未学习」处理。
 *
 * @param easeFactor 难度因子（1.3 - 2.5）
 * @param interval 当前复习间隔（天）
 */
export function getMemoryStrength(easeFactor: number, interval: number): number {
  const ef = Math.max(1.3, Math.min(2.5, easeFactor || 2.5))
  const intv = Math.max(0, interval || 0)
  // EF 归一化到 0-1：1.3 → 0，2.5 → 1
  const efScore = (ef - 1.3) / (2.5 - 1.3)
  // 间隔归一化到 0-1：30 天以上视为满分
  const intScore = Math.min(1, intv / 30)
  const score = Math.round((efScore * 0.5 + intScore * 0.5) * 100)
  return Math.max(0, Math.min(100, score))
}

/**
 * 记忆强度分档（按 getMemoryStrength 计算出的 0-100）
 */
export function strengthLevel(score: number): '强' | '中' | '弱' {
  if (score >= 70) return '强'
  if (score >= 40) return '中'
  return '弱'
}

/**
 * 记忆标签的值域 —— 2026-09-15 新增(P2-10)
 * 手动覆盖按钮的文案集合必须与它**一一对应**，见下方 qualityLabel 的注释
 */
export type QualityLabel = '认识' | '一般' | '勉强' | '模糊' | '不认识'

/**
 * SM-2 quality → 中文记忆标签（用于答案区展示 + 手动覆盖按钮）
 *
 * 2026-09-15 修复(P2-10)：此前 `q===3` 与 `q===2` **都**返回「模糊」，而 `labelToQuality('模糊')`
 * 返回 3 → 往返非单射，静默把 quality 2 升成 3。存为 `quality:2`（答错但思考过）的记录显示「模糊」，
 * 用户点同一个标签确认时被重写为 3，**跨越了 `calculateNextReview` 里 `quality < 3` 的及格/不及格边界**：
 * `repetitions` 不再归零、`interval` 从 1 跳到 `round(prev×EF)`，即把一次失败改判为成功。
 * 故把这两档拆开：3 →「勉强」（勉强答对）、2 →「模糊」（接近但没答对），
 * 与上方 `calculateAutoQuality` 的映射表注释逐条对应，往返在 1..5 上无损。
 *
 * **调用点约束**：手动覆盖按钮必须提供全部五个标签。若只保留旧的四个，
 * quality 3 的记录会显示出一个没有对应按钮的标签，用户只能点相邻档 → 同一个缺陷换个方向重现
 * （3 被降成 2，这次是跨越及格线往下的方向）。已同步改：网页端 `PracticeView.vue` 与
 * `MemoryReviewView.vue` 的 `MEMORY_OPTIONS`、小程序端 `pages/review/review.vue` 的按钮组。
 *
 * 注：quality 0 与 1 都归「不认识」——手动覆盖没有 0 这一档，`calculateAutoQuality` 也不产出 0；
 * 0→1 的塌缩留在**同一侧**（都 <3，都归零 repetitions、间隔 1 天），不跨越及格线。
 */
export function qualityLabel(q: number): QualityLabel {
  if (q >= 5) return '认识'
  if (q === 4) return '一般'
  if (q === 3) return '勉强'
  if (q === 2) return '模糊'
  return '不认识'
}

/**
 * 中文记忆标签 → 对应的 SM-2 quality（手动覆盖时用）
 * 与 `qualityLabel` 严格互逆（2026-09-15 P2-10）：**「模糊」现在是 2，不再是 3**；「勉强」才是 3。
 */
export function labelToQuality(label: QualityLabel): number {
  switch (label) {
    case '认识': return 5
    case '一般': return 4
    case '勉强': return 3
    case '模糊': return 2
    case '不认识': return 1
    default: return 3
  }
}

// ============================================================
// 2026-08-23 新增：防堆积机制（每日复习配额 + 逾期重学）
// 解决「墨墨背单词式」长时间不练 → 一次性涌出大量到期题的问题
// ============================================================

/**
 * 每日复习配额基准（默认值）：没有学习计划时每天最多复习这么多题
 */
export const DEFAULT_DAILY_REVIEW_CAP = 50

/**
 * 计算每日复习配额（防堆积）
 * 规则：
 *  - 若设置了一个或多个学习计划 → 取「计划每日目标」中的最大值（保证不少干计划要求）
 *  - 否则 → 用默认 50 题/天
 * 最终配额 = max(计划目标, 默认 50)，既联动计划又不低于保底。
 *
 * @param plans 学习计划数组（StudyPlan[]，可为空）
 * @returns 每日复习配额
 */
export function calculateDailyReviewCap(plans: { dailyGoal: number }[]): number {
  let cap = DEFAULT_DAILY_REVIEW_CAP
  if (plans && plans.length > 0) {
    const maxGoal = Math.max(...plans.map(p => p.dailyGoal || 0))
    cap = Math.max(maxGoal, DEFAULT_DAILY_REVIEW_CAP)
  }
  return cap
}

/**
 * 判断某题是否已「逾期过久，需要重新学习」
 * 超过 staleDays 天没复习 → 视为生疏，重新从短间隔开始（不留痛苦长尾）
 *
 * @param lastReview 上次复习时间（ISO 串 / 纪元毫秒数字 / null）
 * @param staleDays 逾期天数阈值（默认 30）
 */
// 2026-09-15 修复(评审 Minor)：参数类型与 P2-8 重写后的 `ReviewRecord.last_review`（`string | number`）对齐。
// 原签名只收 `string | null | undefined`，故第一个**带类型**传入 `record.last_review` 的调用方就会撞 TS2345
// ——正是 P2-8 要治的「公开接口与实际数据形状不符」，只是方向相反。当前两个调用方都传 `any`，
// 所以 vue-tsc 一直没报；这是给将来的类型化调用方留的坑。
// **仅改签名、行为不变**：函数体的 `new Date(lastReview)` 对 ISO 串与纪元毫秒数字都成立。
export function isStaleReview(lastReview: string | number | null | undefined, staleDays = 30): boolean {
  if (!lastReview) return false
  const t = new Date(lastReview).getTime()
  if (Number.isNaN(t)) return false
  const elapsedDays = (Date.now() - t) / 86400000
  return elapsedDays > staleDays
}

// ============================================================
// 2026-08-23 新增：按题库规模联动每日复习配额（大题库多练、小题库保底）
// 解决「全局固定 50」对 4000 题大库太保守的问题
// ============================================================

/** 配额 = clamp(题库题数 × 比例%, 保底, 上限) */
export const BANK_CAP_RATIO = 0.08        // 大库每天消化 8%
export const BANK_CAP_MIN = 25            // 保底
export const BANK_CAP_MAX = 200           // 上限

/**
 * 按单个题库的题目数计算该库每日复习配额
 *  4000 题 → 8% = 320，但被上限 200 截断 → 200
 *  1000 题 → 8% = 80
 *  100 题  → 8% = 8，被保底 25 抬到 25
 *
 * @param bankQuestionCount 该题库题目数
 * @returns 每日复习配额
 */
export function calculateBankReviewCap(bankQuestionCount: number): number {
  const n = Math.max(0, bankQuestionCount || 0)
  return Math.round(Math.max(BANK_CAP_MIN, Math.min(BANK_CAP_MAX, n * BANK_CAP_RATIO)))
}

// ============================================================
// 2026-08-23 新增：备考驱动动态复习节奏
// 设置考试日期后，按「距考试天数」动态加大每日复习比例（越临近越突击）
// 没设考试日期 → 用常规比例 8%
// ============================================================

/**
 * 计算距考试的天数（examDate - 今天，向上取整）
 *  - examDate 无效/为空 → 返回 null（视为未设考试），**并 console.warn**（见 P2-9）
 *  - examDate 已过期（今天>=考试日）→ 返回 0（进入冲刺极限）
 *
 * @param examDate 考试日期（'YYYY-MM-DD'，也容忍完整 ISO 串），可为空
 * @returns 距考试天数（>=0 整数），或 null 表示未设考试日期
 */
export function calculateDaysToExam(examDate: string | null | undefined): number | null {
  if (!examDate) return null
  // 2026-09-15 修复(评审 Important，GC11)：下面的 `.trim()` 是 P2-9 加固时新引入的，而它对
  // **非字符串的真值**（数字 / 布尔 / 对象）会抛 `TypeError: examDate.trim is not a function`；
  // 修复前的 `new Date(examDate + 'T00:00:00')` 是字符串拼接，任何类型都能吞下并返回 null。
  // 这不是理论风险：两个网页调用方都用 `plans.map(p => p.examDate).filter((d): d is string => !!d)`
  // 取值，那个类型谓词**只过滤真值、不做运行时 typeof 校验**，而 `study_plans` 正在备份/恢复与
  // 云同步载荷里——恰是本函数注释自己引用的威胁模型。调用点外层虽有 try/catch 兜住，
  // 但抛出会**中断该 catch 块的其余逻辑**，于是 todayCap / memoryDaysToExam 一起静默丢失，
  // 只在控制台留一条泛化的 error。故此处显式挡掉非字符串，走与「无法解析」相同的告警+null 路径。
  if (typeof examDate !== 'string') {
    console.warn('[spaced-repetition] calculateDaysToExam 收到非字符串的考试日期，按「未设考试」处理：', examDate)
    return null
  }
  // 2026-09-15 修复(P2-9)：此前**无条件**拼 'T00:00:00'，于是
  //   '2026-10-01T00:00:00.000Z' → '2026-10-01T00:00:00.000ZT00:00:00' → Invalid Date → null
  // 调用方（MemoryReviewView.vue:249、HomeView.vue:384）把 null 解读为「未设考试」并静默回落到
  // 8% 常规比例 —— 备考冲刺功能**无诊断地**整体失效。而 study_plans 在备份/恢复与云同步载荷内，
  // 任何一次 ISO 规范化往返就会触发它。故只有裸 'YYYY-MM-DD' 才拼本地午夜，其余交给 Date 自己解析。
  const s = examDate.trim()
  const exam = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : s)
  const examTs = exam.getTime()
  if (Number.isNaN(examTs)) {
    // 2026-09-15 修复(P2-9)：解析失败不再静默返回 null —— 调用方无法区分
    // 「用户没设考试」与「考试日期损坏」，两者都回落到 8%，后者需要能在控制台看到
    console.warn('[spaced-repetition] calculateDaysToExam 无法解析考试日期，按「未设考试」处理：', examDate)
    return null
  }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const examStart = new Date(examTs); examStart.setHours(0, 0, 0, 0)
  const diff = Math.round((examStart.getTime() - today.getTime()) / 86400000)
  return diff < 0 ? 0 : diff
}

/**
 * 距考试天数 → 每日复习比例（占题库比例）
 *   > 30 天   → 8%   （常规）
 *   8–30 天   → 12%  （开始加量）
 *   3–8 天    → 18%  （冲刺加量）
 *   ≤ 3 天    → 25%  （冲刺极限）
 * 未设考试（null）→ 8% 常规
 *
 * @param daysToExam 距考试天数（null=未设考试）
 * @returns 每日复习比例（0-1 小数）
 */
export function calculateDynamicRatio(daysToExam: number | null): number {
  if (daysToExam === null) return BANK_CAP_RATIO
  if (daysToExam <= 3) return 0.25
  if (daysToExam <= 8) return 0.18
  if (daysToExam <= 30) return 0.12
  return BANK_CAP_RATIO
}

/**
 * 按「题库规模 + 距考天数」计算动态每日复习配额
 *   quota = clamp(题库题数 × 动态比例, 保底 25, 上限 200)
 * 未设考试 → 效果等同 calculateBankReviewCap
 *
 * @param bankQuestionCount 题库题目数
 * @param daysToExam 距考天数（null=未设考试）
 * @returns 每日复习配额
 */
export function calculateDynamicCap(bankQuestionCount: number, daysToExam: number | null): number {
  const n = Math.max(0, bankQuestionCount || 0)
  const ratio = calculateDynamicRatio(daysToExam)
  return Math.round(Math.max(BANK_CAP_MIN, Math.min(BANK_CAP_MAX, n * ratio)))
}

// ============================================================
// 2026-08-23 新增：内容去重（记忆统计避免重复题虚高）
// 按题目 stem 内容去重，同一知识点只保留一份（最强记忆记录优先）
// ============================================================

/**
 * 简单字符串哈希（FNV-1a 变体，用于 stem 去重）
 * 不追求密码学安全，只要冲突率足够低即可
 */
export function simpleHash(str: string): number {
  let hash = 2166136261
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = (hash * 16777219) >>> 0
  }
  return hash
}

/**
 * 按 stem 内容去重记忆列表
 * 同一 stem（内容相同）的题，只保留「记忆强度最高」的那份记录
 *
 * @param items 带 questionId、stem、strength 的数组
 * @returns 去重后的数组（同 stem 只保留最强记录）
 */
export function deduplicateByStem<T extends { questionId: number; stem: string; strength: number }>(items: T[]): T[] {
  const bestMap = new Map<number, { item: T; hash: number }>()
  for (const item of items) {
    const h = simpleHash(item.stem.trim().toLowerCase())
    const existing = bestMap.get(h)
    if (!existing || item.strength > existing.item.strength) {
      bestMap.set(h, { item, hash: h })
    }
  }
  return Array.from(bestMap.values()).map(v => v.item)
}