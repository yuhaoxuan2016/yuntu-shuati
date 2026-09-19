// 轻量 IndexedDB 封装：替代 Tauri 后端的 SQLite
// 数据表：quiz_banks / questions / practice_records / wrong_questions / favorites / settings

interface DBSchema {
  quiz_banks: { keyPath: 'id'; indexes: { name: 'name' } }
  questions: { keyPath: 'id'; indexes: { bank_id: 'bank_id' } }
  practice_records: { keyPath: 'id'; indexes: { bank_id: 'bank_id'; question_id: 'question_id' } }
  wrong_questions: { keyPath: 'id'; indexes: { bank_id: 'bank_id' } }
  mastered_questions: { keyPath: 'id'; indexes: { bank_id: 'bank_id' } }
  favorites: { keyPath: 'id'; indexes: { bank_id: 'bank_id' } }
  settings: { keyPath: 'key' }
  compose_records: { keyPath: 'id'; indexes: { created_at: 'created_at' } }
  study_plans: { keyPath: 'id'; indexes: { created_at: 'created_at' } }
  review_records: { keyPath: 'id'; indexes: { question_id: 'question_id'; next_review: 'next_review' } }
}

const DB_NAME = 'shuati-bao-pwa'
const DB_VERSION = 4

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('quiz_banks')) {
        const store = db.createObjectStore('quiz_banks', { keyPath: 'id', autoIncrement: true })
        store.createIndex('name', 'name', { unique: false })
      }
      if (!db.objectStoreNames.contains('questions')) {
        const store = db.createObjectStore('questions', { keyPath: 'id', autoIncrement: true })
        store.createIndex('bank_id', 'bank_id', { unique: false })
      }
      if (!db.objectStoreNames.contains('practice_records')) {
        const store = db.createObjectStore('practice_records', { keyPath: 'id', autoIncrement: true })
        store.createIndex('bank_id', 'bank_id', { unique: false })
        store.createIndex('question_id', 'question_id', { unique: false })
      }
      if (!db.objectStoreNames.contains('wrong_questions')) {
        const store = db.createObjectStore('wrong_questions', { keyPath: 'id', autoIncrement: true })
        store.createIndex('bank_id', 'bank_id', { unique: false })
      }
      // v3：已掌握（mastered_questions）—— 与 wrong_questions 同构
      if (!db.objectStoreNames.contains('mastered_questions')) {
        const store = db.createObjectStore('mastered_questions', { keyPath: 'id', autoIncrement: true })
        store.createIndex('bank_id', 'bank_id', { unique: false })
      }
      if (!db.objectStoreNames.contains('favorites')) {
        const store = db.createObjectStore('favorites', { keyPath: 'id', autoIncrement: true })
        store.createIndex('bank_id', 'bank_id', { unique: false })
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' })
      }
      // v2：智能组卷历史记录
      if (!db.objectStoreNames.contains('compose_records')) {
        const store = db.createObjectStore('compose_records', { keyPath: 'id', autoIncrement: true })
        store.createIndex('created_at', 'created_at', { unique: false })
      }
      // v4：学习计划和复习记录
      if (!db.objectStoreNames.contains('study_plans')) {
        const store = db.createObjectStore('study_plans', { keyPath: 'id', autoIncrement: true })
        store.createIndex('created_at', 'created_at', { unique: false })
      }
      if (!db.objectStoreNames.contains('review_records')) {
        const store = db.createObjectStore('review_records', { keyPath: 'id', autoIncrement: true })
        store.createIndex('question_id', 'question_id', { unique: false })
        store.createIndex('next_review', 'next_review', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx<T>(storeName: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(db => new Promise<T>((resolve, reject) => {
    const t = db.transaction(storeName, mode)
    const store = t.objectStore(storeName)
    const req = fn(store)
    // 只依赖事务完成事件，确保数据已持久化
    t.oncomplete = () => resolve(req.result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  }))
}

// 时间戳归一化：把「纪元毫秒数字」与「ISO / 日期字符串」都转成可比的毫秒数。
// P2-7（T10a，2026-09-15）引入，原定义在 cloud.ts；T10b（2026-09-15）搬到本文件（本模块零依赖，
// 而 cloud.ts 依赖本模块——放这里可避免 `db.ts ⇄ cloud.ts` 循环依赖），并在 cloud.ts 重新导出，
// 导出面与调用口径不变。
// 为什么必须归一：本仓库的时间戳字段是**混合类型**——网页端写 ISO 串（toISOString），
// 小程序端混进同一集合的是 Date.now() 数字，且 api.ts 的 restoreBackup 会把备份行原样 bulkPut，
// 于是 ISO 行会不断回流。字典序下 `"2026-…" > "1789…"` 恒成立（"2" > "1"）
// ⇒ 混合类型下任何比较「谁更新」的字符串写法都会把历史 ISO 行判成无条件更新，与实际新旧无关。
// 约定（T10b 裁定）：**不统一存储类型**（那要数据迁移），只把比较统一走本函数。
// 取不到有效时间 → 0（视为最早，不能当「最新」，否则会把真正的旧数据判成新）。
export function normalizeTs(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'string' && v) {
    const t = Date.parse(v)
    if (!Number.isNaN(t)) return t
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return 0
}

export const idb = {
  // === quiz_banks ===
  async listBanks(): Promise<any[]> {
    return tx('quiz_banks', 'readonly', s => s.getAll())
  },
  async createBank(data: any): Promise<any> {
    const id = await tx('quiz_banks', 'readwrite', s => s.add(data)) as unknown as number
    return { id, ...data }
  },
  async deleteBank(id: number): Promise<void> {
    await tx('quiz_banks', 'readwrite', s => s.delete(id))
    // 级联删除题目、练习记录、错题、收藏、已掌握、复习记录（2026-08-23 补全 review_records）
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const stores = ['questions', 'practice_records', 'wrong_questions', 'favorites', 'mastered_questions', 'review_records'] as const
      const t = db.transaction([...stores], 'readwrite')
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
      const qs = t.objectStore('questions')
      const idx = qs.index('bank_id')
      const req = idx.openCursor(IDBKeyRange.only(id))
      req.onsuccess = () => {
        const c = req.result
        if (c) { qs.delete(c.value.id); c.continue() }
      }
      for (const storeName of stores) {
        const st = t.objectStore(storeName)
        // review_records 没有 bank_id 索引，跳过（用全量遍历兜底）
        const i = st.indexNames.contains('bank_id') ? st.index('bank_id') : null
        if (i) {
          const r = i.openCursor(IDBKeyRange.only(id))
          r.onsuccess = () => {
            const c = r.result
            if (c) { st.delete(c.value.id); c.continue() }
          }
        } else {
          // review_records 无 bank_id 索引：遍历全量，按 bank_id 字段匹配删除
          const r = st.openCursor()
          r.onsuccess = () => {
            const c = r.result
            if (c) {
              if (c.value.bank_id === id) st.delete(c.value.id)
              c.continue()
            }
          }
        }
      }
    })
  },
  // 云同步辅助：按 id 查单个题库 / 更新题库 / 全量练习记录 / 安全收藏
  async getBank(id: number): Promise<any | null> {
    const v = await tx('quiz_banks', 'readonly', s => s.get(id))
    return v ?? null
  },
  async updateBank(data: any): Promise<void> {
    await tx('quiz_banks', 'readwrite', s => s.put(data))
  },
  async listRecords(bankId: number): Promise<any[]> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const t = db.transaction('practice_records', 'readonly')
      const idx = t.objectStore('practice_records').index('bank_id')
      const req = idx.getAll(IDBKeyRange.only(bankId))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  },
  // 2026-08-16：云同步写前去重——判断同一次练习（同题库+同题+同时间）是否已存在，避免同步重复 add 导致正确率翻倍
  async findPracticeRecord(bankId: number, questionId: number, practicedAt: string | null | undefined): Promise<boolean> {
    const rows = await this.listRecords(bankId)
    return rows.some(r =>
      r.question_id === questionId && r.bank_id === bankId &&
      (practicedAt ? String(r.practiced_at) === String(practicedAt) : true)
    )
  },
  async toggleFavoriteSafe(bankId: number, questionId: number): Promise<boolean> {
    return this.toggleFavorite(bankId, questionId)
  },
  // === questions ===
  async listQuestions(bankId: number): Promise<any[]> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const t = db.transaction('questions', 'readonly')
      const idx = t.objectStore('questions').index('bank_id')
      const req = idx.getAll(IDBKeyRange.only(bankId))
      req.onsuccess = () => resolve(req.result.sort((a, b) => (a.source_index ?? 0) - (b.source_index ?? 0)))
      req.onerror = () => reject(req.error)
    })
  },
  async addQuestions(bankId: number, qs: any[]): Promise<number> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const t = db.transaction('questions', 'readwrite')
      t.oncomplete = () => resolve(qs.length)
      t.onerror = () => reject(t.error)
      const store = t.objectStore('questions')
      for (const q of qs) store.add({ ...q, bank_id: bankId })
    })
  },
  async clearBankQuestions(bankId: number): Promise<void> {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction('questions', 'readwrite')
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
      const store = t.objectStore('questions')
      const idx = store.index('bank_id')
      const req = idx.openCursor(IDBKeyRange.only(bankId))
      req.onsuccess = () => {
        const c = req.result
        if (c) { store.delete(c.value.id); c.continue() }
      }
    })
  },
  // P0-6（2026-09-15）：只删除指定 id 的题目（题库范围内），供导入页「重新选择」使用。
  // ⚠️ 存在的意义是**让「重新选择」不必整库清空**——`clearBankQuestions` 是不可逆的整库删除，
  // 而旧版在调用它之前没有任何确认，一次误点即丢掉整卷（这才是 P0-6 的真实缺陷）。
  // 注意别把原因写成「否则会删掉用户原有题」：导入本身（api.ts:108/117）就是先清空再写入，
  // 走到「重新选择」时题库里本就只剩本次导入的题。精确删除是把「删多少」算准，属未来防护。
  async deleteQuestions(bankId: number, ids: number[]): Promise<void> {
    if (!ids.length) return
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction('questions', 'readwrite')
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
      const store = t.objectStore('questions')
      const idx = store.index('bank_id')
      const req = idx.openCursor(IDBKeyRange.only(bankId))
      const want = new Set(ids)
      req.onsuccess = () => {
        const c = req.result
        if (c) {
          if (want.has(c.value.id)) store.delete(c.value.id)
          c.continue()
        }
      }
    })
  },
  async updateQuestion(q: any): Promise<void> {
    await tx('questions', 'readwrite', s => s.put(q))
  },
  async getQuestion(id: number): Promise<any | null> {
    const v = await tx('questions', 'readonly', s => s.get(id))
    return v ?? null
  },
  async searchQuestions(bankId: number, query: string, limit = 50): Promise<any[]> {
    const all = await this.listQuestions(bankId)
    const q = query.trim().toLowerCase()
    if (!q) return []
    const results = all.filter(x => (x.stem || '').toLowerCase().includes(q) || (x.answer || '').toLowerCase().includes(q))
    return results.slice(0, limit)
  },
  // === practice_records ===
  // 2026-08-21：返回新记录 id（供云同步拉取后回写 synced_at 增量标记）
  async recordPractice(record: any): Promise<number> {
    return tx('practice_records', 'readwrite', s => s.add(record)) as unknown as number
  },
  // === wrong_questions ===
  async listWrong(bankId: number): Promise<number[]> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const t = db.transaction('wrong_questions', 'readonly')
      const idx = t.objectStore('wrong_questions').index('bank_id')
      const req = idx.getAll(IDBKeyRange.only(bankId))
      req.onsuccess = () => resolve(req.result.map(x => x.question_id))
      req.onerror = () => reject(req.error)
    })
  },
  // T8b（2026-09-16）：`questionId` 随 `ExamQuestion.id` 一起放宽为 `number | string`（`api.markWrong`
  // 会把考试快照的 id 透传进来）。本函数只用 `x.question_id === questionId` 做等值比较、并把该值原样
  // 存进记录的 `question_id` 字段（`wrong_questions` 的主键是 autoIncrement 的 `id`，不是它），
  // 既不做算术也不作 IDB 键 → 纯类型放宽，数字 id 常态下运行时行为逐字节不变。
  async markWrong(bankId: number, questionId: number | string, streak?: number, totalWrongOverride?: number): Promise<number> {
    const db = await openDB()
    const exists = await new Promise<boolean>((resolve, reject) => {
      const t = db.transaction('wrong_questions', 'readonly')
      const idx = t.objectStore('wrong_questions').index('bank_id')
      const req = idx.getAll(IDBKeyRange.only(bankId))
      req.onsuccess = () => resolve(req.result.some(x => x.question_id === questionId))
      req.onerror = () => reject(req.error)
    })
    // 累计做错次数：传入 override（云同步带回）优先；否则错题本已有记录则 +1；
    // 没有则从已掌握的历史累计值继承（若无则从 1 开始）
    let totalWrong = 1
    if (typeof totalWrongOverride === 'number') {
      totalWrong = totalWrongOverride
    } else if (exists) {
      const cur = await this.getWrongRecord(bankId, questionId)
      totalWrong = (cur?.total_wrong || 0) + 1
    } else {
      const masteredRec = await this.getMasteredRecord(bankId, questionId)
      if (masteredRec?.total_wrong) totalWrong = masteredRec.total_wrong + 1
    }
    if (!exists) {
      // 2026-08-19：correct_streak = 连续答对计数（错题重练答对累计，达到阈值自动转「已掌握」）
      await tx('wrong_questions', 'readwrite', s => s.add({ bank_id: bankId, question_id: questionId, created_at: new Date().toISOString(), correct_streak: streak ?? 0, total_wrong: totalWrong }))
    } else {
      // 记录已存在：更新累计错误数 + 刷新连对 streak（答错时清零）
      await this.setWrongRecord(bankId, questionId, { total_wrong: totalWrong, correct_streak: typeof streak === 'number' ? streak : 0 })
    }
    // 2026-08-16（方案 B）：做错自动取消「已掌握」——从 mastered_questions 移除该记录
    await this.removeMastered(bankId, questionId)
    return totalWrong
  },
  // 查询已掌握中某条记录（含 total_wrong 历史累计）；不在已掌握返回 null
  // T8b：`questionId` 放宽为 `number | string`（被已放宽的 `markWrong` 透传调用；体内只有等值比较）
  async getMasteredRecord(bankId: number, questionId: number | string): Promise<any | null> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const t = db.transaction('mastered_questions', 'readonly')
      const idx = t.objectStore('mastered_questions').index('bank_id')
      const req = idx.getAll(IDBKeyRange.only(bankId))
      req.onsuccess = () => resolve(req.result.find(x => x.question_id === questionId) ?? null)
      req.onerror = () => reject(req.error)
    })
  },
  // 通用更新错题记录字段（含 total_wrong / correct_streak）
  // T8b：`questionId` 放宽为 `number | string`（被已放宽的 `markWrong` 透传调用；游标里只做等值比较）
  async setWrongRecord(bankId: number, questionId: number | string, patch: { total_wrong?: number; correct_streak?: number }): Promise<void> {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction('wrong_questions', 'readwrite')
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
      const store = t.objectStore('wrong_questions')
      const idx = store.index('bank_id')
      const req = idx.openCursor(IDBKeyRange.only(bankId))
      req.onsuccess = () => {
        const c = req.result
        if (c && c.value.question_id === questionId) {
          const { synced_at, ...rest } = c.value
          store.put({ ...rest, ...patch })
        } else if (c) c.continue()
      }
    })
  },
  // 查询错题本中某条记录（含 correct_streak 连续答对计数）；不在错题本返回 null
  // T8b：`questionId` 放宽为 `number | string`（`markWrong` 透传；体内 `find` 只做等值比较）
  async getWrongRecord(bankId: number, questionId: number | string): Promise<any | null> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const t = db.transaction('wrong_questions', 'readonly')
      const idx = t.objectStore('wrong_questions').index('bank_id')
      const req = idx.getAll(IDBKeyRange.only(bankId))
      req.onsuccess = () => resolve(req.result.find(x => x.question_id === questionId) ?? null)
      req.onerror = () => reject(req.error)
    })
  },
  // 更新错题记录的连续答对计数
  async setWrongStreak(bankId: number, questionId: number, streak: number): Promise<void> {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction('wrong_questions', 'readwrite')
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
      const store = t.objectStore('wrong_questions')
      const idx = store.index('bank_id')
      const req = idx.openCursor(IDBKeyRange.only(bankId))
      req.onsuccess = () => {
        const c = req.result
        if (c && c.value.question_id === questionId) {
          // 2026-08-21：本地改动 → 清 synced_at（云同步增量标记），下次推送自动补推
          const { synced_at, ...rest } = c.value
          store.put({ ...rest, correct_streak: streak })
        } else if (c) c.continue()
      }
    })
  },
  // 错题本完整记录（含 correct_streak，供列表展示「连对 n 次」）
  async listWrongRecords(bankId: number): Promise<any[]> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const t = db.transaction('wrong_questions', 'readonly')
      const idx = t.objectStore('wrong_questions').index('bank_id')
      const req = idx.getAll(IDBKeyRange.only(bankId))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  },
  // 从错题本直接删除记录（不做标记掌握，彻底移除）
  async removeWrong(bankId: number, questionId: number): Promise<void> {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction('wrong_questions', 'readwrite')
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
      const store = t.objectStore('wrong_questions')
      const idx = store.index('bank_id')
      const req = idx.openCursor(IDBKeyRange.only(bankId))
      req.onsuccess = () => {
        const c = req.result
        if (c && c.value.question_id === questionId) store.delete(c.value.id)
        else if (c) c.continue()
      }
    })
  },
  // 从已掌握表直接删除记录
  // T8b：`questionId` 放宽为 `number | string`（`markWrong` 透传；游标只做等值比较，删的是记录的 `id` 主键）
  async removeMastered(bankId: number, questionId: number | string): Promise<void> {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction('mastered_questions', 'readwrite')
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
      const store = t.objectStore('mastered_questions')
      const idx = store.index('bank_id')
      const req = idx.openCursor(IDBKeyRange.only(bankId))
      req.onsuccess = () => {
        const c = req.result
        if (c && c.value.question_id === questionId) store.delete(c.value.id)
        else if (c) c.continue()
      }
    })
  },
  async markWrongMastered(bankId: number, questionId: number): Promise<void> {
    // 语义：从错题表移除 + 加入已掌握表（2026-08-15 修复：此前只删错题，已掌握无存储）
    // total_wrong：转已掌握时保留错题记录的累计做错次数，供顽固错题统计
    const wrongRec = await this.getWrongRecord(bankId, questionId)
    const totalWrong = wrongRec?.total_wrong || 0
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(['wrong_questions', 'mastered_questions'], 'readwrite')
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
      // 删错题
      const wstore = t.objectStore('wrong_questions')
      const widx = wstore.index('bank_id')
      const wreq = widx.openCursor(IDBKeyRange.only(bankId))
      wreq.onsuccess = () => {
        const c = wreq.result
        if (c && c.value.question_id === questionId) wstore.delete(c.value.id)
        else if (c) c.continue()
      }
      // 加已掌握（去重）
      const mstore = t.objectStore('mastered_questions')
      const midx = mstore.index('bank_id')
      const mreq = midx.getAll(IDBKeyRange.only(bankId))
      mreq.onsuccess = () => {
        if (!mreq.result.some(x => x.question_id === questionId)) {
          mstore.add({ bank_id: bankId, question_id: questionId, created_at: new Date().toISOString(), total_wrong: totalWrong })
        } else {
          // 已存在：更新 total_wrong 取较大值
          const rec = mreq.result.find(x => x.question_id === questionId)
          const prev = rec?.total_wrong || 0
          if (totalWrong > prev) mstore.put({ ...rec, total_wrong: totalWrong })
        }
      }
    })
  },
  async restoreWrongToPending(bankId: number, questionId: number): Promise<void> {
    // 语义：从已掌握表移除 + 加回错题表（2026-08-15 修复：此前只是重新 markWrong）
    // total_wrong：已掌握移回错题时保留历史累计做错次数
    const masteredRec = await this.getMasteredRecord(bankId, questionId)
    const totalWrong = masteredRec?.total_wrong || 0
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(['wrong_questions', 'mastered_questions'], 'readwrite')
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
      // 删已掌握
      const mstore = t.objectStore('mastered_questions')
      const midx = mstore.index('bank_id')
      const mreq = midx.openCursor(IDBKeyRange.only(bankId))
      mreq.onsuccess = () => {
        const c = mreq.result
        if (c && c.value.question_id === questionId) mstore.delete(c.value.id)
        else if (c) c.continue()
      }
      // 加回错题（去重）
      const wstore = t.objectStore('wrong_questions')
      const widx = wstore.index('bank_id')
      const wreq = widx.getAll(IDBKeyRange.only(bankId))
      wreq.onsuccess = () => {
        if (!wreq.result.some(x => x.question_id === questionId)) {
          wstore.add({ bank_id: bankId, question_id: questionId, created_at: new Date().toISOString(), total_wrong: totalWrong })
        }
      }
    })
  },
  // === mastered_questions ===
  async listMastered(bankId: number): Promise<number[]> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const t = db.transaction('mastered_questions', 'readonly')
      const idx = t.objectStore('mastered_questions').index('bank_id')
      const req = idx.getAll(IDBKeyRange.only(bankId))
      req.onsuccess = () => resolve(req.result.map(x => x.question_id))
      req.onerror = () => reject(req.error)
    })
  },
  // 已掌握完整记录（含 total_wrong，供「曾错 n 次」展示）
  async listMasteredRecords(bankId: number): Promise<any[]> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const t = db.transaction('mastered_questions', 'readonly')
      const idx = t.objectStore('mastered_questions').index('bank_id')
      const req = idx.getAll(IDBKeyRange.only(bankId))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  },
  // === favorites ===
  async toggleFavorite(bankId: number, questionId: number): Promise<boolean> {
    const db = await openDB()
    const exists = await new Promise<boolean>((resolve, reject) => {
      const t = db.transaction('favorites', 'readonly')
      const idx = t.objectStore('favorites').index('bank_id')
      const req = idx.getAll(IDBKeyRange.only(bankId))
      req.onsuccess = () => resolve(req.result.some(x => x.question_id === questionId))
      req.onerror = () => reject(req.error)
    })
    if (exists) {
      await new Promise<void>((resolve, reject) => {
        const t = db.transaction('favorites', 'readwrite')
        t.oncomplete = () => resolve()
        t.onerror = () => reject(t.error)
        const store = t.objectStore('favorites')
        const idx = store.index('bank_id')
        const req = idx.openCursor(IDBKeyRange.only(bankId))
        req.onsuccess = () => {
          const c = req.result
          if (c && c.value.question_id === questionId) store.delete(c.value.id)
          else if (c) c.continue()
        }
      })
      return false
    } else {
      await tx('favorites', 'readwrite', s => s.add({ bank_id: bankId, question_id: questionId, created_at: new Date().toISOString() }))
      return true
    }
  },
  async listFavorites(bankId: number): Promise<number[]> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const t = db.transaction('favorites', 'readonly')
      const idx = t.objectStore('favorites').index('bank_id')
      const req = idx.getAll(IDBKeyRange.only(bankId))
      req.onsuccess = () => resolve(req.result.map(x => x.question_id))
      req.onerror = () => reject(req.error)
    })
  },
  async clearFavorites(bankId: number): Promise<void> {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction('favorites', 'readwrite')
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
      const store = t.objectStore('favorites')
      const idx = store.index('bank_id')
      const req = idx.openCursor(IDBKeyRange.only(bankId))
      req.onsuccess = () => {
        const c = req.result
        if (c) { store.delete(c.value.id); c.continue() }
      }
    })
  },
  // === settings ===
  async getSetting(key: string): Promise<string | null> {
    const v = await tx('settings', 'readonly', s => s.get(key))
    return v ? v.value : null
  },
  async setSetting(key: string, value: string): Promise<void> {
    await tx('settings', 'readwrite', s => s.put({ key, value }))
  },
  async getAllSettings(): Promise<Record<string, string>> {
    const rows = await tx('settings', 'readonly', s => s.getAll()) as any[]
    const out: Record<string, string> = {}
    for (const r of rows) out[r.key] = r.value
    return out
  },
  // === 备份/恢复底层辅助 ===
  async listAll(storeName: string): Promise<any[]> {
    return tx(storeName, 'readonly', s => s.getAll())
  },
  async clearStore(storeName: string): Promise<void> {
    await tx(storeName, 'readwrite', s => s.clear())
  },
  // bulkPut 保留对象自带的 key（含 autoIncrement 的 id），引用关系不丢失
  async bulkPut(storeName: string, rows: any[]): Promise<void> {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(storeName, 'readwrite')
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
      const store = t.objectStore(storeName)
      for (const r of rows) store.put(r)
    })
  },
  // === compose_records（智能组卷历史记录） ===
  async addComposeRecord(record: any): Promise<number> {
    return tx('compose_records', 'readwrite', s => s.add(record)) as unknown as number
  },
  async listComposeRecords(): Promise<any[]> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const t = db.transaction('compose_records', 'readonly')
      const idx = t.objectStore('compose_records').index('created_at')
      const req = idx.getAll()
      req.onsuccess = () => resolve(req.result.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))))
      req.onerror = () => reject(req.error)
    })
  },
  async getComposeRecord(id: number): Promise<any | null> {
    const v = await tx('compose_records', 'readonly', s => s.get(id))
    return v ?? null
  },
  async deleteComposeRecord(id: number): Promise<void> {
    await tx('compose_records', 'readwrite', s => s.delete(id))
  },
  // === 统计 ===
  async bankStats(bankId: number): Promise<{ total: number; practiced: number; correct: number; mastered: number }> {
    const qs = await this.listQuestions(bankId)
    const records = await new Promise<any[]>((resolve, reject) => {
      openDB().then(db => {
        const t = db.transaction('practice_records', 'readonly')
        const idx = t.objectStore('practice_records').index('bank_id')
        const req = idx.getAll(IDBKeyRange.only(bankId))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
    })
    // 2026-08-16 修复：历史云同步可能重复写入同一次练习（同题+同时间）→ 统计前按 (question_id, practiced_at) 去重，
    // 避免 correct 按次数翻倍导致首页正确率 >100%
    const seen = new Set<string>()
    const uniq = records.filter(r => {
      const k = `${r.question_id}_${r.practiced_at ?? ''}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    const practiced = new Set(uniq.map(r => r.question_id)).size
    const correct = uniq.filter(r => r.is_correct).length
    const mastered = (await this.listMastered(bankId)).length
    return { total: qs.length, practiced, correct, mastered }
  },
  // === study_plans ===
  async createPlan(data: any): Promise<any> {
    const id = await tx('study_plans', 'readwrite', s => s.add(data)) as unknown as number
    return { id, ...data }
  },
  async listPlans(): Promise<any[]> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const t = db.transaction('study_plans', 'readonly')
      const idx = t.objectStore('study_plans').index('created_at')
      const req = idx.getAll()
      req.onsuccess = () => resolve(req.result.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))))
      req.onerror = () => reject(req.error)
    })
  },
  async getPlan(id: number): Promise<any | null> {
    const v = await tx('study_plans', 'readonly', s => s.get(id))
    return v ?? null
  },
  async updatePlan(id: number, data: any): Promise<void> {
    await tx('study_plans', 'readwrite', s => s.put({ id, ...data }))
  },
  async deletePlan(id: number): Promise<void> {
    await tx('study_plans', 'readwrite', s => s.delete(id))
  },
  // === review_records ===
  async addReviewRecord(data: any): Promise<number> {
    return tx('review_records', 'readwrite', s => s.add(data)) as unknown as number
  },
  async getReviewRecordByQuestionId(questionId: number): Promise<any | null> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const t = db.transaction('review_records', 'readonly')
      const idx = t.objectStore('review_records').index('question_id')
      const req = idx.getAll(IDBKeyRange.only(questionId))
      req.onsuccess = () => {
        const records = req.result
        if (records.length > 0) {
          // 返回最新的记录
          // T10b（2026-09-15）修复：原写法 `String(b.last_review).localeCompare(String(a.last_review))`——
          // last_review 是混合类型（网页端 ISO 串 / 小程序端纪元数字，且 restoreBackup 会让 ISO 行持续回流），
          // 字典序下 `"2026-…" > "1789…"` 恒成立 ⇒ 任何历史 ISO 记录都会无条件赢过任何数字记录。
          // 现统一走 normalizeTs 归一成毫秒再比（不统一存储类型，只统一比较口径）。
          resolve(records.sort((a, b) => normalizeTs(b.last_review) - normalizeTs(a.last_review))[0])
        } else {
          resolve(null)
        }
      }
      req.onerror = () => reject(req.error)
    })
  },
  async updateReviewRecord(id: number, data: any): Promise<void> {
    await tx('review_records', 'readwrite', s => s.put({ id, ...data }))
  },
  async listReviewRecords(): Promise<any[]> {
    return tx('review_records', 'readonly', s => s.getAll())
  },
  // 2026-09-15 删除 `getReviewRecordsByNextReview`（原在本处）。两条理由，都经核实：
  //
  // 1) 控制端先前给它写的注释把 IndexedDB 的后果**说反了**。键排序确实是 number < date < string，
  //    但正因如此，用**字符串**上界查这个数字索引**不是**「一条都查不到」——每个数字键都小于任何字符串键，
  //    故 `IDBKeyRange.upperBound("<iso>")` 会匹配**全部数字行**，外加**字典序不高于该上界的那些历史 ISO 行**
  //    （字典序更高的 ISO 行仍被排除）。即结果既不是空、也不是「整个 store」，而是一个**无意义的混合子集**。
  // 2) 把参数改成 `number` 也**并不能让它变正确**，因为该索引现在是**永久混合类型**的：
  //    新写入的是纪元数字，历史行仍是 ISO 串，而 `api.ts` 的 `restoreBackup` 是把备份行**原样** bulkPut，
  //    于是 ISO 串会不断重新进入该索引。数字上界会**静默排除所有历史字符串行**。
  //    要正确实现只能**全量扫描**、用 `toReviewTs` 把两种形态都归一成纪元毫秒后再比较。
  //
  // ⚠️ 下方 `getReviewRecordsByQuestionIds` 在 **T10b（2026-09-15）之前**用的是
  //    `String(r.last_review) > String(best.last_review)` 直接字符串比较——那在混合类型字段上是错的
  //    （纪元数字字符串化后以 `1` 开头，ISO 串以 `2026` 开头，故任何历史 ISO 行都会**无条件赢过**
  //    任何数字行，与实际新旧无关）。T10b 已把它改成 `normalizeTs()` 归一后比较，与本条注释的口径一致：
  //    **已统一的三项**：`last_review` / `next_review` / `updated_at` —— 比较前**必须**先归一，不得直接比字符串。
  //    ⚠️ 2026-09-15 复审更正：原文写成「**凡**比较时间字段一律先归一」，范围过大。**至今仍是字符串比较、
  //    尚未归一**的至少还有两处：`created_at`（本文件 :604 与 :652 一带）与 `_snapshot_at`（`src/lib/exam.ts:271` 一带）。
  //    它们今天没坏是因为两侧写的都是 ISO 串（字典序恰好等于时间序），一旦有一侧改类型就会静默错乱
  //    ⇒ 已记入 T17 清单（要么一并归一，要么各自在注释里写明前提）。写新比较前先确认属于哪一类。
  //
  // 全仓库 grep 确认该函数**零调用方**（跨四个仓库只有本注释一处命中），故删除是移除一个陷阱而非移除功能。
  // 2026-08-23 新增：按一组题目 id 批量查最新复习记录（记忆复习页一次拉取，避免逐题查）
  // 返回 Map<questionId, record>；每个题目只保留 last_review 最新的那条（去重）
  async getReviewRecordsByQuestionIds(ids: number[]): Promise<Map<number, any>> {
    const all = await tx('review_records', 'readonly', s => s.getAll()) as any[]
    const map = new Map<number, any>()
    for (const id of ids) {
      let best: any = null
      for (const r of all) {
        if (r.question_id !== id) continue
        // T10b（2026-09-15）修复：原为 `String(r.last_review) > String(best.last_review)`（见上方注释的字典序推理）
        if (!best || normalizeTs(r.last_review) > normalizeTs(best.last_review)) best = r
      }
      if (best) map.set(id, best)
    }
    return map
  },
}
