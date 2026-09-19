<template>
  <div class="mix-exam">
    <!-- ===== 配置阶段 ===== -->
    <div v-if="!started" class="config-wrap">
      <div class="config-header">
        <h2>🎲 综合抽题考试</h2>
        <button class="history-btn" @click="openHistory">📜 历史记录（{{ historyCount }}）</button>
        <p class="config-sub">从多个题库随机抽题，合成一张试卷。每道题仍归属原题库，练习记录/错题/收藏各自归位。</p>
      </div>

      <div class="config-toolbar">
        <label class="toggle-all">
          <input type="checkbox" :checked="selectedIds.length === banks.length" @change="toggleAll" />
          全选
        </label>
        <span class="toolbar-hint">已选 {{ selectedIds.length }} 个题库 · {{ totalCount }} 题</span>
      </div>

      <!-- 题型配比（可选） -->
      <div class="type-config">
        <label class="type-toggle">
          <input type="checkbox" v-model="useTypeMix" />
          按题型配比抽题
        </label>
        <p v-if="useTypeMix" class="type-hint">在下方填写各题型数量，将从所选题库中按题型分别抽足（不足的题型按实际数量）</p>
        <div v-if="useTypeMix" class="type-inputs">
          <div class="type-field">
            <label>单选</label>
            <input type="number" v-model.number="typeCounts.single" min="0" max="500" class="type-input" />
          </div>
          <div class="type-field">
            <label>多选</label>
            <input type="number" v-model.number="typeCounts.multi" min="0" max="500" class="type-input" />
          </div>
          <div class="type-field">
            <label>判断</label>
            <input type="number" v-model.number="typeCounts.judge" min="0" max="500" class="type-input" />
          </div>
          <div class="type-field">
            <label>填空/问答</label>
            <input type="number" v-model.number="typeCounts.blank" min="0" max="500" class="type-input" />
          </div>
        </div>
      </div>

      <div v-if="loading" class="loading">加载题库中...</div>
      <div v-else-if="banks.length === 0" class="empty">
        <p>还没有题库，先去首页创建吧</p>
        <button class="primary-btn" @click="$router.push('/')">返回首页</button>
      </div>
      <div v-else class="bank-list">
        <div
          v-for="b in banks"
          :key="b.id"
          class="bank-item"
          :class="{ selected: selectedIds.includes(b.id) }"
          @click="toggleBank(b.id)"
        >
          <div class="bank-info">
            <div class="bank-check">{{ selectedIds.includes(b.id) ? '☑' : '☐' }}</div>
            <div class="bank-main">
              <div class="bank-name">{{ b.name }}</div>
              <div class="bank-count">{{ b.question_count }} 道题</div>
            </div>
          </div>
          <div class="bank-config" @click.stop>
            <input
              type="number"
              class="count-input"
              :min="1"
              :max="b.question_count"
              :value="counts[b.id] ?? 0"
              :disabled="!selectedIds.includes(b.id)"
              @input="onCountInput(b, ($event.target as HTMLInputElement).value)"
            />
            <span class="count-max">/ {{ b.question_count }}</span>
          </div>
        </div>
      </div>

      <div class="config-footer">
        <div class="duration-field">
          <label>考试时长（分钟）</label>
          <input type="number" v-model.number="durationMinutes" min="1" max="300" class="duration-input" />
        </div>
        <button class="start-btn" :disabled="!canStart" @click="startExam">
          🚀 开始考试（{{ totalCount }} 题）
        </button>
      </div>
    </div>

    <!-- ===== 考试阶段 ===== -->
    <div v-else>
      <!-- 顶栏 -->
      <div class="exam-topbar">
        <div class="exam-info">
          <span class="exam-badge">综合考试</span>
          <span class="exam-timer" :class="{ 'time-up': examTimeUp }">⏱ {{ formatTime(examRemaining) }}</span>
        </div>
        <div class="exam-progress">
          <span class="progress-text">{{ current + 1 }} / {{ examQuestions.length }}</span>
          <div class="progress-track">
            <div class="progress-fill" :style="{ width: ((current + 1) / Math.max(examQuestions.length, 1) * 100) + '%' }"></div>
          </div>
        </div>
        <div class="exam-actions">
          <label class="auto-next-toggle">
            <input type="checkbox" v-model="autoNext" />
            自动下一题
          </label>
          <button class="submit-btn" :disabled="submitted" @click="requestSubmit">交卷</button>
        </div>
      </div>

      <!-- 结果页 -->
      <div v-if="submitted" class="result-panel">
        <h3>考试结束</h3>
        <div class="result-stats">
          <div class="stat-card"><div class="stat-num">{{ result.correct }}</div><div class="stat-label">答对</div></div>
          <div class="stat-card"><div class="stat-num">{{ result.wrong }}</div><div class="stat-label">答错</div></div>
          <div class="stat-card"><div class="stat-num">{{ result.unanswered }}</div><div class="stat-label">未答</div></div>
          <div class="stat-card highlight"><div class="stat-num">{{ result.score }}</div><div class="stat-label">得分</div></div>
        </div>
        <p class="result-hint">总分 100 · 正确率 {{ result.accuracy }}%</p>
        <div v-if="lastRecordCode" class="record-box">
          <div class="record-label">📋 本场记录码（保存好，可在历史记录中回看）</div>
          <div class="record-value" @click="copyRecordCode">{{ lastRecordCode }} <span class="copy-tip">点击复制</span></div>
        </div>
        <div class="result-actions">
          <button @click="resetAll">再考一次</button>
          <button @click="goHome">返回首页</button>
          <button class="add-wrong-btn" :disabled="addingWrong" @click="addWrongToBook">
            {{ addingWrong ? '添加中...' : '📥 错题加入错题本' }}
          </button>
        </div>
        <p v-if="addWrongMsg" class="add-wrong-msg" :class="{ warn: addWrongErr }">{{ addWrongMsg }}</p>
        <!-- 按题库统计 -->
        <div class="bank-breakdown" v-if="bankBreakdown.length">
          <h4>分题库成绩</h4>
          <div v-for="bb in bankBreakdown" :key="bb.bank_id" class="breakdown-row">
            <span class="bd-name">{{ bb.name }}</span>
            <span class="bd-stat">{{ bb.correct }}✓ / {{ bb.wrong }}✗ / {{ bb.unanswered }}○</span>
          </div>
        </div>
      </div>

      <!-- 2026-08-20：交卷后答题回顾（可逐题翻阅，红=错 绿=对） -->
      <div v-if="submitted && examQuestions.length" class="review-section">
        <h3 class="review-title">📋 答题回顾 <span class="review-sub">点击题号查看详情</span></h3>
        <QuestionCard
          :key="`${currentQuestion.id}-review-${reloadKey}`"
          :question="currentQuestion"
          :index="current"
          :has-prev="current > 0"
          :saved-state="answerStates.get(currentQuestion.id) || null"
          :read-only="true"
          @next="next"
          @prev="prev"
        />
        <div class="bank-tag">📁 所属题库：{{ bankNameOf(currentQuestion.bank_id) }}</div>
        <div class="question-nav" v-if="examQuestions.length > 1">
          <div class="nav-dots">
            <button
              v-for="(q, i) in examQuestions"
              :key="q.id"
              class="nav-dot"
              :class="getDotClass(i, q.id)"
              @click="goTo(i)"
            >{{ i + 1 }}</button>
          </div>
        </div>
      </div>

      <!-- 答题区 -->
      <div v-if="!submitted && examQuestions.length">
        <QuestionCard
          :key="`${currentQuestion.id}-${reloadKey}`"
          :question="currentQuestion"
          :index="current"
          :exam-mode="true"
          :auto-next="autoNext"
          :has-prev="current > 0"
          :saved-state="answerStates.get(currentQuestion.id) || null"
          :defer-submit="true"
          @answered="onAnswered"
          @state-change="onStateChange"
          @next="next"
          @prev="prev"
          @toggle-favorite="onToggleFavorite"
          @question-updated="onQuestionUpdated"
        />
        <div class="bank-tag">📁 所属题库：{{ bankNameOf(currentQuestion.bank_id) }}</div>

        <!-- 题目导航 -->
        <div class="question-nav" v-if="examQuestions.length > 1">
          <div class="nav-dots">
            <button
              v-for="(q, i) in examQuestions"
              :key="q.id"
              class="nav-dot"
              :class="getDotClass(i, q.id)"
              @click="goTo(i)"
            >{{ i + 1 }}</button>
          </div>
        </div>
      </div>
    </div>
    <!-- P2-18：一键交卷确认（参照 ExamTakeView 已有的「确认交卷」模态；此处另用 submit-* 类名，
         因为本文件没有 .modal-mask/.modal-body/.modal-actions 的样式定义，见报告 §8） -->
    <Teleport to="body">
      <div v-if="showSubmitConfirm" class="submit-mask" @click.self="showSubmitConfirm = false">
        <div class="submit-confirm">
          <h3>确认交卷？</h3>
          <p>已答 {{ answeredCount }} / {{ examQuestions.length }} 题，{{ answeredCount < examQuestions.length ? '还有未答题目！' : '全部完成！' }}</p>
          <div class="submit-confirm-actions">
            <button @click="showSubmitConfirm = false">继续答题</button>
            <button class="danger" @click="confirmSubmit">确认交卷</button>
          </div>
        </div>
      </div>
    </Teleport>
    <!-- 历史记录弹窗 -->
    <Teleport to="body">
      <div v-if="showHistory" class="modal-mask" @click.self="showHistory = false">
        <div class="modal-card">
          <div class="modal-body history-modal">
            <h3>📜 综合抽题历史记录</h3>
            <p v-if="!historyRecords.length" class="hint">还没有历史记录，考一场试试~</p>
            <div v-else class="history-list">
              <div v-for="r in historyRecords" :key="r.id" class="history-item">
                <div class="history-info">
                  <div class="history-score">{{ r.score }} 分</div>
                  <div class="history-meta">
                    正确率 {{ r.accuracy }}% · {{ r.correct }}✓ {{ r.wrong }}✗ {{ r.unanswered }}○
                    · {{ formatDate(r.created_at) }}
                    <span v-if="r.duration_ms"> · 用时 {{ formatDuration(r.duration_ms) }}</span>
                  </div>
                  <div class="history-code" v-if="r.query_code">记录码：{{ r.query_code }}</div>
                </div>
                <button class="history-del" @click="deleteHistory(r.id)" title="删除">🗑</button>
              </div>
            </div>
          </div>
          <button class="modal-close" @click="showHistory = false">关闭</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useBankStore } from '../stores/bank'
import { api, Question } from '../utils/api'
import { classifyQuestionType, gradeByState, isJudgeLike } from '../lib/exam'
import { idb } from '../lib/db'
import { toastError, toastSuccess } from '../utils/toast'
import QuestionCard, { type QuestionState } from '../components/QuestionCard.vue'

const router = useRouter()
const bankStore = useBankStore()
const banks = computed(() => bankStore.banks)
const loading = ref(false)

// 配置状态
const selectedIds = ref<number[]>([])
const counts = ref<Record<number, number>>({})
const durationMinutes = ref(60)
const started = ref(false)
// 题型配比
const useTypeMix = ref(false)
const typeCounts = ref<Record<'single' | 'multi' | 'judge' | 'blank', number>>({ single: 10, multi: 5, judge: 5, blank: 0 })

const typeTotal = computed(() => useTypeMix.value
  ? typeCounts.value.single + typeCounts.value.multi + typeCounts.value.judge + typeCounts.value.blank
  : 0)

// 可开始条件：自由模式要有题库+数量；配比模式要有题库+至少一种题型数量>0
const canStart = computed(() => {
  if (!selectedIds.value.length) return false
  if (useTypeMix.value) return typeTotal.value > 0
  return totalCount.value > 0
})

const totalCount = computed(() =>
  useTypeMix.value ? typeTotal.value
    : selectedIds.value.reduce((s, id) => s + (counts.value[id] || 0), 0)
)

// 考试状态
const examQuestions = ref<Question[]>([])
const current = ref(0)
const answerStates = ref<Map<number, QuestionState>>(new Map())
const submitted = ref(false)
const examTimeUp = ref(false)
const examRemaining = ref(0)
const result = ref({ correct: 0, wrong: 0, unanswered: 0, score: 0, accuracy: 0 })
const bankBreakdown = ref<{ bank_id: number; name: string; correct: number; wrong: number; unanswered: number }[]>([])
const reloadKey = ref(0)
const autoNext = ref(false)
// P2-18：交卷确认模态
const showSubmitConfirm = ref(false)
// 已答题数（与 ExamTakeView 的 answeredCount 同口径：选择题有选中 / 填空有文本 /
// 判断题选了 √× 才算已答）。answerStates 是 ref<Map>，Map 的 set 会触发依赖收集
// （同文件 getDotClass 也依赖这一行为刷新题号点）。
const answeredCount = computed(() => {
  let n = 0
  for (const st of answerStates.value.values()) {
    if (st.selected.length || st.blankAnswer || st.judgeSelected !== null) n++
  }
  return n
})

let examStartMs: number | null = null
let timerId: number | null = null

function toggleBank(id: number) {
  const idx = selectedIds.value.indexOf(id)
  if (idx >= 0) {
    selectedIds.value.splice(idx, 1)
  } else {
    selectedIds.value.push(id)
    if (!counts.value[id]) counts.value[id] = banks.value.find(b => b.id === id)?.question_count || 0
  }
}
function toggleAll(e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  if (checked) {
    selectedIds.value = banks.value.map(b => b.id)
    for (const b of banks.value) if (!counts.value[b.id]) counts.value[b.id] = b.question_count
  } else {
    selectedIds.value = []
  }
}
function onCountInput(b: { id: number; question_count: number }, val: string) {
  const n = Math.max(1, Math.min(b.question_count, parseInt(val) || 0))
  counts.value[b.id] = n
}
function bankNameOf(id: number): string {
  return banks.value.find(b => b.id === id)?.name || ''
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
function formatTime(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const currentQuestion = computed(() => examQuestions.value[current.value] || null)

async function startExam() {
  try {
    loading.value = true
    const picked: Question[] = []

    if (useTypeMix.value) {
      // 按题型配比：从所有选中题库收集题目，按题型分别抽足
      const pool: Question[] = []
      for (const id of selectedIds.value) {
        const all = await api.listQuestions(id)
        pool.push(...all)
      }
      const want = { ...typeCounts.value }
      // 每个题型：从池中筛出该题型，随机抽足数量
      for (const t of ['single', 'multi', 'judge', 'blank'] as const) {
        const need = want[t]
        if (need <= 0) continue
        const candidates = pool.filter(q => classifyQuestionType(q) === t)
        const src = shuffle(candidates).slice(0, need)
        picked.push(...src)
      }
    } else {
      // 自由模式：从每个选中题库抽题（原逻辑）
      for (const id of selectedIds.value) {
        const all = await api.listQuestions(id)
        const count = Math.min(counts.value[id] || 0, all.length)
        const src = shuffle(all).slice(0, count)
        picked.push(...src)
      }
    }

    if (!picked.length) {
      toastError('没有可抽取的题目')
      return
    }
    // 按题型排序：单选 → 多选 → 判断 → 其他（不打乱，保持有序）
    const typeOrder: Record<string, number> = { single: 0, multi: 1, judge: 2 }
    examQuestions.value = [...picked].sort((a, b) =>
      (typeOrder[classifyQuestionType(a)] ?? 9) - (typeOrder[classifyQuestionType(b)] ?? 9)
    )
    current.value = 0
    answerStates.value = new Map()
    submitted.value = false
    examTimeUp.value = false
    started.value = true
    // 启动计时
    const secs = Math.max(1, durationMinutes.value || 1) * 60
    examRemaining.value = secs
    examStartMs = Date.now()
    stopTimer()
    timerId = window.setInterval(tick, 1000)
    toastSuccess(`已生成 ${examQuestions.value.length} 题的综合试卷`)
  } catch (e) {
    toastError('抽题失败：' + (e instanceof Error ? e.message : String(e)))
  } finally {
    loading.value = false
  }
}

function tick() {
  if (examStartMs === null) return
  const elapsed = Math.floor((Date.now() - examStartMs) / 1000)
  const total = Math.max(1, durationMinutes.value || 1) * 60
  const remaining = total - elapsed
  examRemaining.value = remaining > 0 ? remaining : 0
  if (remaining <= 0) {
    examTimeUp.value = true
    submit()
  }
}
function stopTimer() {
  if (timerId) { window.clearInterval(timerId); timerId = null }
}

// P2-18：点「交卷」先确认。旧实现直接调 submit()：一键交卷立即判分、写练习记录、生成记录码，
// 误触无法撤销（与 ExamTakeView 的「交卷 → 确认模态 → 确认交卷」口径不一致）。
// 定时器到点自动交卷仍走 submit() 本身，不经确认（与 ExamTakeView 的 forceSubmit 同口径）。
function requestSubmit() {
  if (submitted.value) return
  showSubmitConfirm.value = true
}
function confirmSubmit() {
  showSubmitConfirm.value = false
  submit()
}
async function submit() {
  if (submitted.value) return
  // 交卷一旦真的发生（含定时器到点自动交卷），确认框必须收起，否则会盖在结果页上
  showSubmitConfirm.value = false
  stopTimer()
  let correct = 0, wrong = 0, unanswered = 0
  const bd = new Map<number, { name: string; correct: number; wrong: number; unanswered: number }>()
  // 2026-08-20：交卷统一判分（考试模式 deferSubmit 不锁定，交卷时才判定并补写状态供回顾）
  // 原「每答一题即 recordPractice」改为交卷后统一写入（答错自动进错题本）
  const recs: { bank_id: number; question_id: number; user_answer: string | null; is_correct: boolean; duration_ms: number | null }[] = []
  for (const q of examQuestions.value) {
    const raw = answerStates.value.get(q.id)
    const b = bd.get(q.bank_id) || { name: bankNameOf(q.bank_id), correct: 0, wrong: 0, unanswered: 0 }
    let st: QuestionState | null = null
    // 2026-09-18 修复（重审 B-10 / 控制端复核 V-1）：原判据是 `if (raw)`——**只问「有没有状态条目」**。
    //   而 QuestionCard 的单题计时器每秒 emit 一次 state-change（`watch([…, elapsedSecs], emitState)`），
    //   父组件 onStateChange（`:515-517`）又是**无条件** `answerStates.set` ⇒ 只要在某题上停留 ≥1 秒，
    //   条目就已存在 ⇒「看过但没答」被当成已作答，经 gradeByState（空作答三分支恒 false）判成答错。
    //   三层后果：① 分数把未答算成错；② 错题本被灌假错题；③ recs 里的 is_correct:false 走
    //   api.recordPractice → idb.markWrong → removeMastered + markCloudDeleted('mastered_questions')
    //   ⇒ **本地「已掌握」被删且云端那条也一并删掉**（不可逆）。
    //   现判据与同文件 answeredCount（`:307-313`）**同口径**：有选项 / 有填空 / 判断题选了 √× 才算已答。
    //   不为未答题补写状态是**本页既有的「未答」表示法**：buildWrongs（`:642`）靠 `!st.submitted` 跳过、
    //   getDotClass（`:546-547`）按 isCorrect 三态上色（undefined 即中性）；回顾卡片由
    //   `:read-only="true"`（`:156`）锁定，不依赖 saved-state.submitted ⇒ 不补写不会让它变回可编辑。
    const answered = !!raw && (raw.selected.length > 0 || !!raw.blankAnswer || raw.judgeSelected !== null)
    if (answered) {
      const isCorrect = gradeByState(q, raw)
      st = { ...raw, submitted: true, isCorrect }
      answerStates.value.set(q.id, st)
      recs.push({
        bank_id: q.bank_id,
        question_id: q.id,
        user_answer: formatAnswerForRecord(q, raw),
        is_correct: isCorrect,
        duration_ms: raw.elapsedSecs != null ? raw.elapsedSecs * 1000 : null,
      })
    }
    if (!st) { unanswered++; b.unanswered++ }
    else if (st.isCorrect) { correct++; b.correct++ }
    else { wrong++; b.wrong++ }
    bd.set(q.bank_id, b)
  }
  const total = examQuestions.value.length || 1
  const accuracy = Math.round((correct / total) * 100)
  const score = Math.round((correct / total) * 100)
  result.value = { correct, wrong, unanswered, score, accuracy }
  bankBreakdown.value = Array.from(bd.entries()).map(([bank_id, v]) => ({ bank_id, ...v }))
  submitted.value = true
  // 交卷后统一写入练习记录
  for (const r of recs) {
    try { await api.recordPractice(r) } catch (e) { console.error('记录练习失败：', e) }
  }
  // 保存历史记录 + 生成记录码
  try {
    const code = genRecordCode()
    await saveRecord(code)
    lastRecordCode.value = code
    historyCount.value++
  } catch (e) {
    console.warn('保存综合抽题记录失败：', e)
  }
}

// 交卷统一写入练习记录用的答案格式：判断 'true'/'false'、选择题字母串、填空原文
function formatAnswerForRecord(q: Question, st: QuestionState): string | null {
  if (isJudgeLike(q)) return st.judgeSelected == null ? null : String(st.judgeSelected)
  if (q.type === 'single' || q.type === 'multi') {
    if (!st.selected.length) return null
    return st.selected.map(i => String.fromCharCode(65 + i)).join('')
  }
  return st.blankAnswer || null
}

function next() {
  if (current.value < examQuestions.value.length - 1) current.value++
}
function prev() {
  if (current.value > 0) current.value--
}
function goTo(i: number) { current.value = i }

function onStateChange(state: QuestionState) {
  const q = currentQuestion.value
  if (q) answerStates.value.set(q.id, state)
}
async function onAnswered(payload: { correct: boolean; answer: string; duration_ms: number | null }) {
  // 2026-08-20：考试模式 deferSubmit 下答题不再立即提交，此回调不触发（交卷统一判分 + recordPractice）
  const q = currentQuestion.value
  if (!q) return
  try {
    const res = await api.recordPractice({ bank_id: q.bank_id, question_id: q.id, user_answer: payload.answer, is_correct: payload.correct, duration_ms: payload.duration_ms })
    // 答错自动进错题本 / 答对连续计数自动掌握（api.recordPractice 内部处理）
    if (res?.autoMastered) toastSuccess(`🎉 连续答对 ${res.streak} 次，该题已自动移入「已掌握」`)
  } catch (e) { console.error('记录练习失败：', e) }
}
function onToggleFavorite() {
  const q = currentQuestion.value
  if (!q) return
  api.toggleFavorite(q.bank_id, q.id).catch(e => console.error('收藏失败：', e))
}
function onQuestionUpdated(updated: Question) {
  const idx = examQuestions.value.findIndex(x => x.id === updated.id)
  if (idx >= 0) examQuestions.value[idx] = updated
  reloadKey.value++
}
function getDotClass(listIdx: number, qid: number): string {
  const classes: string[] = []
  if (qid === currentQuestion.value?.id) classes.push('current')
  const s = answerStates.value.get(qid)
  if (s?.submitted) {
    if (submitted.value) {
      // 交卷后才显示对错
      if (s.isCorrect === true) classes.push('correct')
      else if (s.isCorrect === false) classes.push('wrong')
    } else {
      // 交卷前只显示已答，不泄露对错
      classes.push('answered')
    }
  }
  return classes.join(' ')
}

// 历史记录
const showHistory = ref(false)
const historyCount = ref(0)
const historyRecords = ref<any[]>([])
const lastRecordCode = ref('')

onMounted(async () => {
  try { historyCount.value = (await idb.listComposeRecords()).filter(r => r.type === 'mix').length } catch { /* ignore */ }
})

function genRecordCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let rand = ''
  for (let i = 0; i < 4; i++) rand += chars[Math.floor(Math.random() * chars.length)]
  return 'M' + rand
}

async function saveRecord(code: string) {
  const answers: Record<number, any> = {}
  for (const [qid, st] of answerStates.value) {
    answers[Number(qid)] = JSON.parse(JSON.stringify(st))
  }
  await idb.addComposeRecord(JSON.parse(JSON.stringify({
    type: 'mix',
    query_code: code,
    created_at: new Date().toISOString(),
    duration_ms: examStartMs ? Date.now() - examStartMs : null,
    score: result.value.score,
    accuracy: result.value.accuracy,
    correct: result.value.correct,
    wrong: result.value.wrong,
    unanswered: result.value.unanswered,
    questions: examQuestions.value,
    answers,
    bankBreakdown: bankBreakdown.value,
  })))
}

async function openHistory() {
  try {
    historyRecords.value = (await idb.listComposeRecords()).filter(r => r.type === 'mix')
    showHistory.value = true
  } catch (e) {
    toastError('加载历史记录失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

async function deleteHistory(id: number) {
  try {
    await idb.deleteComposeRecord(id)
    historyRecords.value = historyRecords.value.filter(r => r.id !== id)
    historyCount.value--
  } catch (e) {
    toastError('删除失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return iso }
}
function formatDuration(ms: number): string {
  const sec = Math.round(ms / 1000)
  const m = Math.floor(sec / 60), s = sec % 60
  return m > 0 ? `${m}分${s}秒` : `${s}秒`
}
async function copyRecordCode() {
  if (!lastRecordCode.value) return
  try { await navigator.clipboard.writeText(lastRecordCode.value); toastSuccess('记录码已复制') }
  catch { toastError('复制失败，请手动记录') }
}

// 错题加入错题本
const addingWrong = ref(false)
const addWrongMsg = ref('')
const addWrongErr = ref(false)

async function addWrongToBook() {
  if (addingWrong.value) return
  addingWrong.value = true
  addWrongMsg.value = ''
  addWrongErr.value = false
  try {
    let added = 0, skipped = 0
    for (const q of examQuestions.value) {
      const st = answerStates.value.get(q.id)
      if (!st || !st.submitted || st.isCorrect) continue // 跳过未答和正确的
      if (!q.bank_id || q.bank_id <= 0) { skipped++; continue }
      await api.markWrong(q.bank_id, q.id)
      added++
    }
    if (added > 0 && skipped > 0) {
      addWrongMsg.value = `已添加 ${added} 道错题到错题本（${skipped} 题无本地题库已跳过）`
    } else if (added > 0) {
      addWrongMsg.value = `已添加 ${added} 道错题到错题本`
    } else if (skipped > 0) {
      addWrongMsg.value = `${skipped} 道错题均无本地题库，请先导入题库后再添加`
      addWrongErr.value = true
    } else {
      addWrongMsg.value = '本次考试没有错题，无需添加'
    }
  } catch (e) {
    addWrongMsg.value = '添加失败：' + (e instanceof Error ? e.message : String(e))
    addWrongErr.value = true
  } finally {
    addingWrong.value = false
  }
}

function resetAll() {
  stopTimer()
  started.value = false
  submitted.value = false
  examQuestions.value = []
  answerStates.value = new Map()
  current.value = 0
  lastRecordCode.value = ''
  addWrongMsg.value = ''
}
function goHome() {
  stopTimer()
  router.push('/')
}

onMounted(async () => {
  try {
    loading.value = true
    await bankStore.load()
  } catch (e) {
    toastError('加载题库失败：' + (e instanceof Error ? e.message : String(e)))
  } finally {
    loading.value = false
  }
})
onBeforeUnmount(() => stopTimer())
</script>

<style scoped>
.config-wrap { max-width: 760px; margin: 0 auto; }
.config-header { margin-bottom: 20px; }
.config-header h2 { margin: 0 0 6px 0; }
.config-sub { color: var(--color-text-secondary); font-size: 13px; margin: 0; }
.config-toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; padding: 10px 14px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-md); }
.toggle-all { display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; color: var(--color-text); }
.toolbar-hint { font-size: 12px; color: var(--color-text-secondary); }
.bank-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px; }
.bank-item { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; background: var(--color-card); border: 1px solid var(--color-border); border-radius: var(--radius-md); cursor: pointer; transition: all 0.15s; }
.bank-item:hover { border-color: var(--color-primary); transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
.bank-item.selected { border-color: var(--color-primary); background: var(--color-primary-light); }
.bank-info { display: flex; align-items: center; gap: 12px; }
.bank-check { font-size: 20px; color: var(--color-primary); }
.bank-name { font-weight: 600; font-size: 15px; }
.bank-count { font-size: 12px; color: var(--color-text-secondary); margin-top: 2px; }
.bank-config { display: flex; align-items: center; gap: 6px; }
.count-input { width: 60px; padding: 5px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-md); font-size: 14px; text-align: center; color: var(--color-text); background: var(--color-bg); }
.count-input:disabled { opacity: 0.4; }
.count-max { font-size: 12px; color: var(--color-text-tertiary); }
.config-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-top: 16px; border-top: 1px solid var(--color-border-light); }
.duration-field { display: flex; align-items: center; gap: 8px; }
.duration-field label { font-size: 13px; color: var(--color-text-secondary); }
.duration-input { width: 70px; padding: 6px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-md); font-size: 14px; text-align: center; color: var(--color-text); background: var(--color-bg); }
.start-btn { padding: 11px 26px; background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%); color: #fff; border: none; border-radius: var(--radius-md); font-size: 15px; font-weight: 600; cursor: pointer; transition: all 0.15s; box-shadow: 0 2px 8px rgba(79, 70, 229, 0.3); }
.start-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(79, 70, 229, 0.4); }
.start-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.exam-topbar { display: flex; align-items: center; gap: 16px; padding: 12px 16px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-md); margin-bottom: 16px; flex-wrap: wrap; }
.exam-info { display: flex; align-items: center; gap: 10px; }
.exam-badge { padding: 3px 10px; background: var(--tc-light); color: var(--color-primary); border-radius: 12px; font-size: 12px; font-weight: 600; }
.exam-timer { font-family: monospace; font-size: 14px; font-weight: 600; padding: 4px 12px; background: var(--color-info-light); color: var(--color-info); border-radius: var(--radius-md); }
.exam-timer.time-up { background: var(--color-danger-light); color: var(--color-danger); animation: pulse 1s infinite; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
.exam-progress { flex: 1; display: flex; align-items: center; gap: 10px; min-width: 140px; }
.progress-text { font-size: 12px; color: var(--color-text-secondary); font-family: monospace; white-space: nowrap; }
.progress-track { flex: 1; height: 6px; background: var(--color-border-light); border-radius: 3px; overflow: hidden; }
.progress-fill { height: 100%; background: linear-gradient(90deg, var(--color-primary), var(--color-primary-dark)); border-radius: 3px; transition: width 0.3s; }
.submit-btn { padding: 8px 20px; background: var(--color-danger); color: #fff; border: none; border-radius: var(--radius-md); font-size: 13px; font-weight: 600; cursor: pointer; }
.submit-btn:hover:not(:disabled) { opacity: 0.9; }
.submit-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.auto-next-toggle { display: flex; align-items: center; gap: 4px; font-size: 13px; cursor: pointer; color: var(--color-text-secondary); white-space: nowrap; }
.auto-next-toggle input { cursor: pointer; }

.bank-tag { margin-top: 10px; font-size: 12px; color: var(--color-text-tertiary); }
.question-nav { margin-top: 14px; padding: 12px 14px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-md); }
.nav-dots { display: flex; flex-wrap: wrap; gap: 4px; max-height: 160px; overflow-y: auto; }
.nav-dot { min-width: 28px; height: 28px; padding: 0 4px; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-card); color: var(--color-text-secondary); font-size: 11px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; font-weight: 500; }
.nav-dot:hover { border-color: var(--color-primary); color: var(--color-primary); }
.nav-dot.current { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
.nav-dot.answered { background: var(--tc-light); color: var(--color-primary); border-color: var(--color-info-strong); }
.nav-dot.correct { background: #dcfce7; color: #15803d; border-color: #bbf7d0; }
.nav-dot.wrong { background: #fee2e2; color: #b91c1c; border-color: #fecaca; }

.result-panel { text-align: center; padding: 32px; }
.result-panel h3 { margin-bottom: 24px; }

/* 2026-08-20：交卷后答题回顾区 */
.review-section { margin-top: 24px; }
.review-title { text-align: center; margin-bottom: 14px; font-size: 17px; }
.review-sub { font-size: 12px; color: var(--color-text-tertiary); font-weight: 400; margin-left: 8px; }
.result-stats { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; margin-bottom: 16px; }
.stat-card { background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-lg); padding: 16px 24px; min-width: 100px; }
.stat-card.highlight { background: linear-gradient(135deg, var(--color-primary), var(--color-primary-dark)); color: #fff; border-color: transparent; }
.stat-num { font-size: 28px; font-weight: 600; }
.stat-label { font-size: 13px; opacity: 0.8; margin-top: 4px; }
.result-hint { color: var(--color-text-secondary); margin: 16px 0; }
.result-actions { margin-top: 20px; }
.result-actions button { margin: 8px; padding: 9px 20px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); cursor: pointer; font-size: 14px; }
.result-actions button:first-child { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
.add-wrong-btn { background: var(--color-primary) !important; color: #fff !important; border-color: var(--color-primary) !important; }
.add-wrong-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.add-wrong-msg { font-size: 13px; color: var(--color-success-deep); margin: 4px 0 0; }
.add-wrong-msg.warn { color: var(--color-danger); }
.record-box { margin: 16px 0 12px; padding: 14px; background: var(--color-success-light); border: 1px dashed var(--color-success-strong); border-radius: var(--radius-md); }
.record-label { font-size: 12px; color: var(--color-success-deep); margin-bottom: 8px; }
.record-value { font-size: 24px; font-weight: 800; letter-spacing: 2px; color: var(--color-success-deep); cursor: pointer; user-select: all; font-family: monospace; }
.record-value:hover .copy-tip { opacity: 1; }
.copy-tip { font-size: 11px; color: var(--color-text-tertiary); opacity: 0; transition: opacity 0.15s; }
.history-btn { margin-top: 10px; padding: 7px 16px; border: 1px solid var(--color-primary); border-radius: var(--radius-md); background: var(--color-primary-light); color: var(--color-primary); cursor: pointer; font-size: 13px; font-weight: 500; }
.history-btn:hover { background: var(--color-primary); color: #fff; }
.history-modal { text-align: left; }
/* P2-18：交卷确认模态的样式。⚠️ 本文件此前只有 .history-modal 一条与模态相关的样式。
   全 src/ grep 的实际分布（控制端复核后更正本注释初版——它把情况说得比实际**更好**）：
     · .modal-mask / .modal-body / .modal-actions —— 定义在 ComposeExamView 与 ExamTakeView 的
       **scoped** 样式里（本文件够不到）；style.css 只在 ≤768px 媒体查询里给 .modal-body/.modal-actions 打补丁。
     · **.modal-card 与 .modal-close —— 整个 src/ 里根本没有定义**，只有本文件模板在用它们。
   即历史记录弹窗在桌面端既没有遮罩也没有卡片本体样式（既有问题，只记账不改，见报告 §8）。
   这里只给新模态加自己的 submit-* 类，不顺手改历史记录弹窗。 */
.submit-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 300; }
.submit-confirm { background: var(--color-card); color: var(--color-text); padding: 24px; border-radius: var(--radius-lg); min-width: 300px; max-width: 90vw; text-align: center; }
.submit-confirm h3 { margin: 0 0 10px 0; }
.submit-confirm p { margin: 0; color: var(--color-text-secondary); font-size: 14px; }
.submit-confirm-actions { display: flex; gap: 10px; justify-content: center; margin-top: 16px; }
.submit-confirm-actions button { padding: 8px 20px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); color: var(--color-text); cursor: pointer; font-size: 14px; }
.submit-confirm-actions button.danger { background: var(--color-danger); color: #fff; border-color: var(--color-danger); }
.history-list { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.history-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border: 1px solid var(--color-border-light); border-radius: var(--radius-md); }
.history-info { min-width: 0; }
.history-score { font-size: 18px; font-weight: 700; color: var(--color-primary); }
.history-meta { font-size: 12px; color: var(--color-text-tertiary); margin-top: 2px; }
.history-code { font-size: 11px; color: var(--color-text-secondary); font-family: monospace; }
.history-del { border: none; background: none; cursor: pointer; font-size: 16px; opacity: 0.5; }
.history-del:hover { opacity: 1; }
.bank-breakdown { margin-top: 28px; padding: 16px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-md); text-align: left; }
.bank-breakdown h4 { margin: 0 0 10px 0; font-size: 14px; }
.breakdown-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--color-border-light); font-size: 13px; }
.breakdown-row:last-child { border-bottom: none; }
.bd-name { font-weight: 500; }
.bd-stat { color: var(--color-text-secondary); font-family: monospace; }

.loading, .empty { text-align: center; padding: 48px; color: var(--color-text-tertiary); }
.primary-btn { padding: 9px 18px; background: var(--color-primary); color: #fff; border: none; border-radius: var(--radius-md); cursor: pointer; font-size: 14px; }

/* 题型配比 */
.type-config { margin-bottom: 16px; padding: 14px 16px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-md); }
.type-toggle { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 500; cursor: pointer; color: var(--color-text); }
.type-hint { font-size: 12px; color: var(--color-text-tertiary); margin: 8px 0 10px 0; }
.type-inputs { display: flex; gap: 14px; flex-wrap: wrap; }
.type-field { display: flex; align-items: center; gap: 8px; }
.type-field label { font-size: 13px; color: var(--color-text-secondary); white-space: nowrap; }
.type-input { width: 64px; padding: 5px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-md); font-size: 14px; text-align: center; color: var(--color-text); background: var(--color-bg); }

/* 移动端适配 */
@media (max-width: 768px) {
  .bank-item { flex-wrap: wrap; gap: 8px; }
  .bank-info { flex: 1 1 100%; }
  .config-footer { flex-direction: column; align-items: stretch; }
  .duration-field { justify-content: space-between; }
  .start-btn { width: 100%; }
  .exam-progress { min-width: 100%; }
  .config-toolbar { flex-wrap: wrap; gap: 6px; }
  .result-panel { padding: 20px 12px; }
}
</style>
