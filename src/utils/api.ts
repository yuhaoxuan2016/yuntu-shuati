// PWA 版 API 层：替代 Tauri invoke，用 IndexedDB + 浏览器能力实现
import { idb } from '../lib/db'

// 云同步：数据改动后触发推送（未启用时自动跳过）
function scheduleCloudPush() {
  import('../lib/cloud').then(m => m.scheduleAutoPush()).catch(() => {})
}

// 日期工具函数：避免夏令时问题
export function toLocalDateStr(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return toLocalDateStr(d)
}
// 删除类操作：记录云端删除标记（P1.2 修复，push 时按标记删云端旧文档）
// T8b（2026-09-16）：`questionId` 随 `ExamQuestion.id` 一起放宽为 `number | string`（`markWrong` 会把
// 考试快照的 id 透传进来）。纯类型放宽，本函数只做等值比较与转存，运行时行为不变。
// 2026-09-18 放宽（重审 A-15）：集合面从三个「记录类」扩到 `questions`/`quiz_banks`，
// 且 `questionId` 允许 null（对 `questions` 表示"整库全部题目"，对 `quiz_banks` 无意义）。
// 2026-09-24：`cloudId` —— 题库/题目的云端 `_id`。能拿到就带上：删除云端那条时按 `_id`/`bank_ref`
//   精确定位，不再只认「本设备当初分配的本地 id」（换过身份/设备的文档只认 cloud_id，否则删不掉、下次又拉回来）。
function markCloudDeleted(
  coll: 'favorites' | 'wrong_questions' | 'mastered_questions' | 'questions' | 'quiz_banks',
  bankId: number, questionId: number | string | null, cloudId: string | null = null,
) {
  import('../lib/cloud').then(m => m.markCloudDeleted(coll, bankId, questionId, cloudId)).catch(() => {})
}

/** 取题库的云端 `_id`（没推上去过 / 取不到 → null） */
async function bankCloudId(bankId: number): Promise<string | null> {
  try {
    const b: any = await idb.getBank?.(bankId)
    return b?.cloud_id ?? null
  } catch { return null }
}

export interface QuizBank {
  id: number; name: string; description: string | null;
  visibility?: 'public' | 'private' | 'pending';   // 公共/自建（私人）/待审核（pending=提交公共审核中）
  creator_name?: string | null;        // 创建人（用户可自定义填写）
  question_count: number; created_at: string; updated_at: string;
}
export interface Question {
  id: number; bank_id: number; type: string; stem: string;
  options: string | null; answer: string | null; analysis: string | null;
  source_index: number | null; confidence: number;
  // 2026-09-23：题面内嵌图片（data URI 数组），与 stem 里的 [IMG:n] 下标对应。
  // 来源：导入 docx 时 mammoth 抽出的图；渲染由 components/StemText.vue 负责。
  images?: string[] | null;
}
// origin_ref：本地副本指回它来源的公共题库（导入时写入）。「从公共题库更新」靠它定位，
// 没存的话就只能按题库名去猜——2026-09-24 之前导入的副本都是没存的。
export interface NewBank { name: string; description: string | null; visibility?: 'public' | 'private' | 'pending'; creator_name?: string | null; origin_ref?: string | null }

async function withCount(bank: any): Promise<QuizBank> {
  const qs = await idb.listQuestions(bank.id)
  return { ...bank, question_count: qs.length }
}

export const api = {
  // === 题库 ===
  async listBanks(): Promise<QuizBank[]> {
    const banks = await idb.listBanks()
    return Promise.all(banks.map(withCount))
  },
  async createBank(b: NewBank): Promise<QuizBank> {
    const now = new Date().toISOString()
    const created = await idb.createBank({ ...b, created_at: now, updated_at: now })
    scheduleCloudPush()
    return withCount(created)
  },
  // 2026-08-23：提交题库到公共审核（改 visibility=pending）或管理员改可见性。
  // 标脏（清 synced_at）→ 主动推送云端，让 pending 状态同步上去供管理员审核。
  async updateBankVisibility(id: number, visibility: 'public' | 'private' | 'pending'): Promise<QuizBank> {
    const bank = await idb.getBank?.(id)
    if (!bank) throw new Error('题库不存在')
    const { cloud_shared, ...rest } = bank // 本地字段，不覆盖
    const updated = { ...rest, visibility, updated_at: new Date().toISOString(), synced_at: undefined }
    await idb.updateBank(updated)
    // 主动推送（把新的 visibility 同步到云端）
    try { await import('../lib/cloud').then(m => m.pushToCloud()) } catch { /* 推送失败不阻塞 */ }
    return withCount(updated)
  },
  async deleteBank(id: number): Promise<void> {
    // 2026-09-18 修复（重审 A-15）：删除**必须留下云端删除标记**，否则本地删了、云端还在，
    // 下一次同步会把整个题库连同题目一起拉回来「复活」（`scheduleCloudPush` 是空函数，
    // 而 `db.deleteBank` 的级联删除只作用于 IndexedDB）。
    // 题库与题目各一条：题目用整库语义 `null`，避免逐题写标记把 localStorage 撑爆。
    // 2026-09-24：带上题库的 cloud_id（拿得到时）——云端删除按它定位，并写进删除账本，
    //   保证「云端删不掉的那种（旧身份/缺 _local_id）」下次下载也不会再回来。
    const cid = await bankCloudId(id)
    markCloudDeleted('quiz_banks', id, null, cid)
    markCloudDeleted('questions', id, null, cid)
    await idb.deleteBank(id)
    scheduleCloudPush()
  },
  // === 题目 ===
  async listQuestions(bankId: number): Promise<Question[]> {
    return idb.listQuestions(bankId)
  },
  async clearBankQuestions(bankId: number): Promise<void> {
    // A-15：同上——清空题目也要在云端删，否则下次同步整库题目原样回来
    markCloudDeleted('questions', bankId, null, await bankCloudId(bankId))
    await idb.clearBankQuestions(bankId)
    scheduleCloudPush()
  },
  // P0-6（2026-09-15）：按 id 精确删除题目（导入页「重新选择」用，替代整库清空）。
  // 2026-09-18（A-15）：本函数原先的注释写着「题目没有云端删除标记 ⇒ 不会去删云端文档」，
  //   那是当时的实况；现在题目集合已纳入标记机制，这里逐题打标记（该路径的 id 数量就是本次导入
  //   重新选择的那几十上百条，逐条可接受）。
  async deleteQuestions(bankId: number, ids: number[]): Promise<void> {
    const cid = await bankCloudId(bankId)   // 2026-09-24：同 deleteBank，按题库云端 _id 锚定
    for (const qid of ids) markCloudDeleted('questions', bankId, qid, cid)
    await idb.deleteQuestions(bankId, ids)
    scheduleCloudPush()
  },
  // 批量写入题目（导入公共题库到本地、合并题目等场景）
  async addQuestions(bankId: number, qs: any[]): Promise<number> {
    const n = await idb.addQuestions(bankId, qs)
    scheduleCloudPush()
    return n
  },
  async updateQuestion(q: Question): Promise<void> {
    // 2026-08-21：本地改动 → 清 synced_at（云同步增量标记），下次推送自动补推
    const { synced_at, ...rest } = q as any
    await idb.updateQuestion(rest)
    scheduleCloudPush()
  },
  async searchQuestions(bankId: number, query: string, limit?: number): Promise<Question[]> {
    return idb.searchQuestions(bankId, query, limit)
  },
  // === 导入 ===
  // 浏览器端：直接解析后入库（规则引擎）
  async importFromHtml(bankId: number, html: string): Promise<number> {
    const { parseHtml } = await import('../lib/parser')
    const qs = parseHtml(html, bankId)
    await idb.clearBankQuestions(bankId)
    const n = await idb.addQuestions(bankId, qs)
    scheduleCloudPush()
    return n
  },
  // AI 引擎：分块调用百炼 API
  // 2026-09-18 修复（重审 A-21 / A-23）：
  //   · A-21：把 `aiStructurize` 新回报的 `failedChunks` 一路带到调用方（原来只写 console）。
  //   · A-23：`expected` 原来直接写成 `count`（自己跟自己比）⇒ 导入页那条「识别题数明显少于预期」
  //     的安全网**永远不可能触发**。现在改用**独立于 AI 的文档题号预估**（ai.ts 的 estimateQuestionCount）。
  async importWithAi(bankId: number, text: string, onProgress?: (done: number, total: number) => void): Promise<{ count: number; expected: number; failedChunks: number; totalChunks: number }> {
    const { aiStructurize, estimateQuestionCount } = await import('../lib/ai')
    const res = await aiStructurize(text, bankId, onProgress)
    await idb.clearBankQuestions(bankId)
    const count = await idb.addQuestions(bankId, res.questions)
    scheduleCloudPush()
    return { count, expected: estimateQuestionCount(text), failedChunks: res.failedChunks, totalChunks: res.totalChunks }
  },
  async importFromPdf(bankId: number, path: string): Promise<number> {
    throw new Error('PDF 导入在网页版暂不支持，请使用 TXT/MD/docx 格式')
  },
  async testAiConnection(): Promise<void> {
    const { testConnection } = await import('../lib/ai')
    return testConnection()
  },
  async cancelImport(): Promise<void> { /* 无操作 */ },
  async cancelPdfImport(): Promise<void> { /* 无操作 */ },
  // === 数据库信息（PWA 中显示浏览器存储说明） ===
  async getDbInfo(): Promise<{ path: string; size_bytes: number; backups_dir: string; backup_count: number }> {
    return { path: '浏览器 IndexedDB（本地存储）', size_bytes: 0, backups_dir: '—', backup_count: 0 }
  },
  async openDbFolder(): Promise<string> { throw new Error('网页版不支持打开文件夹') },
  async pickDatabaseFolder(): Promise<string | null> { return null },
  async changeDbPath(newDir: string): Promise<string> { throw new Error('网页版不支持修改数据库位置') },
  async restartApp(): Promise<void> { location.reload() },
  async quitApp(): Promise<void> { window.close() },
  // === 练习记录 ===
  // 返回 { autoMastered, streak, totalWrong }：autoMastered=true 表示本次答对触发「自动移入已掌握」；null 表示无错题本动作
  async recordPractice(r: { bank_id: number; question_id: number; user_answer: string | null; is_correct: boolean; duration_ms: number | null }): Promise<{ autoMastered: boolean; streak: number; totalWrong?: number } | null> {
    await idb.recordPractice({ ...r, practiced_at: new Date().toISOString() })
    let signal: { autoMastered: boolean; streak: number; totalWrong?: number } | null = null
    if (!r.is_correct) {
      // 答错自动加入错题本（连续答对计数清零 + 累计错误 +1），返回累计做错次数
      const totalWrong = await idb.markWrong(r.bank_id, r.question_id, 0)
      // ⚠️ 2026-09-15 复审 MUST-FIX 1（同一漏的**既有实例**，练习答题路径）：`idb.markWrong` 内部
      // 会 `removeMastered` ⇒ 本地已掌握记录消失，也必须记云端删除标记，否则云端那条会复活。
      markCloudDeleted('mastered_questions', r.bank_id, r.question_id)
      signal = { autoMastered: false, streak: 0, totalWrong }
    } else {
      // 答对：若该题在错题本 → 连续答对 +1；达到阈值自动转「已掌握」（2026-08-19 新增）
      const rec = await idb.getWrongRecord(r.bank_id, r.question_id)
      if (rec) {
        const threshold = await api.getWrongMasterThreshold()
        const streak = (rec.correct_streak ?? 0) + 1
        if (threshold > 0 && streak >= threshold) {
          await api.markWrongMastered(r.bank_id, r.question_id)
          signal = { autoMastered: true, streak }
        } else {
          await idb.setWrongStreak(r.bank_id, r.question_id, streak)
          signal = { autoMastered: false, streak }
        }
      }
    }
    scheduleCloudPush()
    return signal
  },
  // 错题本自动掌握阈值：settings 'wrong_auto_master_threshold'（0=关闭，仅手动标记；默认 3 = 连续答对 3 次）
  async getWrongMasterThreshold(): Promise<number> {
    const v = await idb.getSetting('wrong_auto_master_threshold')
    if (v == null || v === '') return 3
    const n = parseInt(v, 10)
    return Number.isFinite(n) && n >= 0 ? n : 3
  },
  async listWrong(bankId: number): Promise<number[]> { return idb.listWrong(bankId) },
  // 错题本完整记录（含 correct_streak，供「连对 n 次」展示）
  async listWrongRecords(bankId: number): Promise<any[]> { return idb.listWrongRecords(bankId) },
  async listMastered(bankId: number): Promise<number[]> { return idb.listMastered(bankId) },
  async listMasteredRecords(bankId: number): Promise<any[]> { return idb.listMasteredRecords(bankId) },
  async markWrong(bankId: number, questionId: number | string): Promise<number> {
    // T8b（2026-09-16）：形参 `questionId` 随 `ExamQuestion.id` 一起放宽为 `number | string`。
    // 这里是**传参**类消费方（`ExamTakeView.vue` 的 `api.markWrong(q.bank_id, q.id)`）。
    // 为什么不按另外两种写法：`String(id)` 归一会让**数字** id 也变成字符串写进 `question_id`，
    // 而本层及以下全是 `x.question_id === questionId` 的**严格等值**比较（见 db.ts 的
    // `markWrong` / `getWrongRecord` / `getMasteredRecord` / `setWrongRecord` / `removeMastered`），
    // 类型一变就再也匹配不上既有的数字记录 —— 那是改行为；`Number(id)` 更不行（十六进制串 → NaN）。
    // 放宽是纯类型层面的，运行时行为逐字节不变：数字进来还是数字出去，串进来还是串出去。
    // 2026-09-15 修复（从类型基线里挖出来的真故障）：ExamTakeView 与 MixExamView 一直在调
    // `api.markWrong(...)`，而 `api` 上**从来没有这个方法**——类型检查里那两条 TS2339
    // （ExamTakeView 的 `api.default.markWrong`、MixExamView 的 `api.markWrong`）不是噪声，
    // 运行时就是 `TypeError: ... is not a function` ⇒ **「把考试错题加入错题本」这条路径一直是坏的**。
    // 实现直接落到 `idb.markWrong`（与 recordPractice 内部对错题的处置是同一个函数，streak 传 0
    // 表示「本次不参与连对计数」），并按本文件惯例触发云推送。
    // ⚠️ 2026-09-15 复审 MUST-FIX 1：`idb.markWrong` 内部**必然**调 `removeMastered`
    //（db.ts 的「做错自动取消已掌握」方案 B）⇒ 本地会少一条 mastered 记录。若不在这里记云端删除标记，
    // 云端那条 `mastered_questions` 文档会残留，**下次拉取把它带回来 = 复活**。
    // 同文件的 markWrongMastered / restoreWrongToPending / removeWrongRecord 都记标记，此处必须一致。
    markCloudDeleted('mastered_questions', bankId, questionId)
    const n = await idb.markWrong(bankId, questionId, 0)
    scheduleCloudPush()
    return n
  },
  async markWrongMastered(bankId: number, questionId: number): Promise<void> {
    // 从错题表移除 → 记录云端删除标记（P1.2）
    markCloudDeleted('wrong_questions', bankId, questionId)
    await idb.markWrongMastered(bankId, questionId)
    scheduleCloudPush()
  },
  async restoreWrongToPending(bankId: number, questionId: number): Promise<void> {
    // 从已掌握表移除 → 记录云端删除标记（P1.2）
    markCloudDeleted('mastered_questions', bankId, questionId)
    await idb.restoreWrongToPending(bankId, questionId)
    scheduleCloudPush()
  },
  // 2026-08-16：从错题本直接删除记录（不做标记掌握）
  async removeWrongRecord(bankId: number, questionId: number): Promise<void> {
    markCloudDeleted('wrong_questions', bankId, questionId)
    await idb.removeWrong(bankId, questionId)
    scheduleCloudPush()
  },
  // 2026-08-16：从已掌握表直接删除记录
  async removeMasteredRecord(bankId: number, questionId: number): Promise<void> {
    markCloudDeleted('mastered_questions', bankId, questionId)
    await idb.removeMastered(bankId, questionId)
    scheduleCloudPush()
  },
  async bankStats(bankId: number): Promise<{ total: number; practiced: number; correct: number; mastered: number }> { return idb.bankStats(bankId) },
  // === 设置 ===
  async getSetting(key: string): Promise<string | null> { return idb.getSetting(key) },
  async setSetting(key: string, value: string): Promise<void> { await idb.setSetting(key, value); scheduleCloudPush() },
  // === 收藏 ===
  async toggleFavorite(bankId: number, questionId: number): Promise<boolean> {
    const r = await idb.toggleFavorite(bankId, questionId)
    // 取消收藏 → 记录云端删除标记（P1.2）
    if (!r) markCloudDeleted('favorites', bankId, questionId)
    scheduleCloudPush()
    return r
  },
  async listFavorites(bankId: number): Promise<number[]> { return idb.listFavorites(bankId) },
  async isFavorite(bankId: number, questionId: number): Promise<boolean> {
    const favs = await idb.listFavorites(bankId)
    return favs.includes(questionId)
  },
  async clearFavorites(bankId: number): Promise<void> {
    // 清空收藏 → 全量记录云端删除标记（P1.2）
    const favs = await idb.listFavorites(bankId)
    for (const qid of favs) markCloudDeleted('favorites', bankId, qid)
    await idb.clearFavorites(bankId)
    scheduleCloudPush()
  },
  // === 备份/导出 ===
  async backupDatabase(): Promise<string> {
    const data = await exportAll()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `小兔错题本备份_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    return '已下载备份文件'
  },
  async restoreBackup(data: any, onProgress?: (msg: string) => void): Promise<void> {
    return restoreBackup(data, onProgress)
  },
  async exportBank(bankId: number): Promise<string> {
    const banks = await idb.listBanks()
    const bank = banks.find(x => x.id === bankId)
    const qs = await idb.listQuestions(bankId)
    return JSON.stringify({ bank, questions: qs }, null, 2)
  },
  async analyzeQuestion(q: Question): Promise<string> {
    const { analyzeQuestion } = await import('../lib/ai')
    return analyzeQuestion(q)
  },
}

// P1-10 / P1-11 备份隐私：以下设置属于「本机凭据/端点」，不写进可下载的备份 JSON。
// - ai_api_key：BYOK 密钥明文（云同步侧本就跳过它，见 lib/cloud.ts）
// - ai_base_url：端点被篡改等于把 Bearer 密钥发往攻击者地址，备份不应搬运它
// - ai_base_url_ack：本机对自定义端点的显式确认，只能由本机设置页交互写入
// 过滤点放在 exportAll()（而不是 db.getAllSettings()）：db 层保持通用存储语义，
// 备份这一个出口单独承担隐私过滤，改动面最小（见 task-9 报告 §P1-10 调用方清单）。
const BACKUP_PROTECTED_SETTING_KEYS = ['ai_api_key', 'ai_base_url', 'ai_base_url_ack']

function filterBackupSettings(settings: Record<string, string> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of Object.keys(settings || {})) {
    if (BACKUP_PROTECTED_SETTING_KEYS.includes(k)) continue
    out[k] = (settings as Record<string, string>)[k]
  }
  return out
}

// 导出全部数据（用于备份/迁移）：题库 + 题目 + 错题 + 收藏 + 练习记录 + 设置 + 学习计划
export async function exportAll() {
  const db = await import('../lib/db')
  const m = (db as any).idb
  return {
    app: 'shuati-bao-pwa',
    version: 2,
    exported_at: new Date().toISOString(),
    banks: await m.listBanks(),
    questions: await m.listAll('questions'),
    wrong_questions: await m.listAll('wrong_questions'),
    favorites: await m.listAll('favorites'),
    practice_records: await m.listAll('practice_records'),
    mastered_questions: await m.listAll('mastered_questions'),
    compose_records: await m.listAll('compose_records'),
    study_plans: await m.listAll('study_plans'),       // 2026-08-22：学习计划加入备份
    review_records: await m.listAll('review_records'), // 2026-08-22：复习记录加入备份
    settings: filterBackupSettings(await m.getAllSettings()),
  }
}

// 从备份文件恢复数据（覆盖式：清空后按原 id 写回，引用关系保持）
export async function restoreBackup(data: any, onProgress?: (msg: string) => void): Promise<void> {
  if (!data || typeof data !== 'object') throw new Error('备份文件格式无效')
  const db = await import('../lib/db')
  const m = (db as any).idb
  const storeMap: Record<string, string> = {
    banks: 'quiz_banks',
    questions: 'questions',
    wrong_questions: 'wrong_questions',
    favorites: 'favorites',
    practice_records: 'practice_records',
    mastered_questions: 'mastered_questions',
    compose_records: 'compose_records',
    study_plans: 'study_plans',       // 2026-08-22：学习计划加入恢复
    review_records: 'review_records', // 2026-08-22：复习记录加入恢复
    settings: 'settings',
  }
  const keys = Object.keys(storeMap).filter(k => Array.isArray(data[k]))
  if (keys.length === 0) throw new Error('备份文件未包含任何可恢复的数据（题库/题目等）')
  // P1-10 / P1-11：备份文件不得覆盖本机的 BYOK 凭据/端点设置（ai_api_key / ai_base_url /
  // ai_base_url_ack）。先取本机现值，恢复 settings 时剔除这些键，最后原样写回。
  // 做「不覆盖」而非「确认后覆盖」：恢复入口（设置页选择文件）没有可分辨的凭据语义，
  // 一旦把文件值落地就意味着密钥可能被发往文件里写的地址；保留本机值最保守且不丢用户的 Key。
  const preservedSettings: Record<string, string> = {}
  for (const k of BACKUP_PROTECTED_SETTING_KEYS) {
    const v = await m.getSetting(k)
    if (v != null) preservedSettings[k] = v
  }
  let skippedSensitive = 0
  for (const key of keys) {
    const store = storeMap[key]
    let rows = data[key] as any[]
    onProgress?.(`正在恢复 ${key}（${rows.length} 条）...`)
    // 2026-09-18 修复（重审 A-24）：**删掉了原来那段「给缺 synced_at 的行补一个」的逻辑**。
    // 原注释的前提「备份本就是已同步的干净数据」不成立：自动推送是空函数
    // （`cloud.ts:scheduleAutoPush` 直接 return，注释写着「自动同步已关闭」），
    // 所以不常点手动同步的用户，本机绝大多数题库/题目行**本来就没有** synced_at；
    // exportAll 是整行原样导出 ⇒ 这些脏行进了备份，恢复时又被盖上「已同步」
    // ⇒ 恢复出来的数据被永久判定为已上云，此后再也不会推送（用户以为恢复完就同步好了）。
    // 现在保持原样：缺 synced_at 的行继续缺，用户下一次手动同步会把它们正常推上去。
    // 代价只是「恢复后首次同步会多推一些记录」，那是应有的行为，不是需要修的重复。
    if (store === 'settings') {
      const before = rows.length
      rows = rows.filter(r => r && typeof r === 'object' && !BACKUP_PROTECTED_SETTING_KEYS.includes(String(r.key)))
      skippedSensitive += before - rows.length
      // 备份里的 settings 全是敏感项：不清空本机设置，否则会连主题等本地设置一起丢掉
      if (rows.length === 0) continue
    }
    await m.clearStore(store)
    if (rows.length) await m.bulkPut(store, rows)
  }
  // 写回本机凭据/端点（若本机原本没有则不写入，保持默认值）
  for (const k of BACKUP_PROTECTED_SETTING_KEYS) {
    if (preservedSettings[k] != null) await m.setSetting(k, preservedSettings[k])
  }
  if (skippedSensitive > 0) {
    onProgress?.(`已忽略备份中的 ${skippedSensitive} 条敏感设置（API Key / 端点由本机保留，未被文件覆盖）`)
  }
  onProgress?.('恢复完成')
}
