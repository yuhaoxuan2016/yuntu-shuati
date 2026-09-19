<template>
  <div class="practice">
    <!-- 第一排：题库名 + 进度条 + 模式 -->
    <div class="topbar main-bar">
      <div class="main-left">
        <span class="bank-name">{{ bankName }}</span>
      </div>
      <div class="main-progress">
        <span class="progress-text">{{ current + 1 }} / {{ order.length }}</span>
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: ((current + 1) / Math.max(order.length, 1) * 100) + '%' }"></div>
        </div>
      </div>
      <div class="main-right">
        <select v-model="mode" class="mode-select">
          <option value="order">顺序练习</option>
          <option value="random">随机练习</option>
          <option value="wrong">错题重练</option>
        </select>
        <button class="help-btn" title="快捷键帮助 (?)" @click="showHelp = true">?</button>
      </div>
    </div>

    <!-- 第二排：搜索 / 类型筛选 / 自动下一题 / 重置 / 交卷 -->
    <div class="topbar tool-bar">
      <div class="search-box">
        <input v-model="searchQuery" placeholder="搜索题目..." @keyup.enter="doSearch" />
        <button v-if="searchQuery" class="search-btn" @click="doSearch">搜索</button>
        <button v-if="searchResults" class="clear-search-btn" @click="clearSearch">✕</button>
      </div>
      <div class="type-filter" v-if="availableTypes.length > 1">
        <span class="filter-label">题型:</span>
        <button
          v-for="t in availableTypes"
          :key="t"
          class="type-chip-btn"
          :class="{ active: !typeFilter.includes(t) }"
          @click="toggleTypeFilter(t)"
        >{{ t }}</button>
      </div>
      <label class="auto-next-toggle">
        <input type="checkbox" v-model="autoNext" />
        答对自动下一题
      </label>
      <label class="auto-next-toggle">
        <input type="checkbox" v-model="shuffleOptions" />
        🔀 选项乱序
      </label>
      <button class="restart-btn" @click="restart">重新开始</button>
    </div>

    <div v-if="searchResults" class="search-result-banner">
      搜索到 <b>{{ searchResults.length }}</b> 道包含"<b>{{ searchQuery }}</b>"的题目，点击跳转
      <button class="close-btn" @click="clearSearch">✕</button>
    </div>
    <div v-if="searchResults && searchResults.length" class="search-result-list">
      <div
        v-for="(r, ri) in searchResults.slice(0, 30)"
        :key="r.id"
        class="search-result-item"
        @click="jumpToQuestion(r.id)"
      >
        <span class="search-result-idx">{{ ri + 1 }}.</span>
        <span class="search-result-text" v-html="highlightText(r.stem, searchQuery)"></span>
        <span class="search-result-types">
          <span class="type-chip">{{ r.type }}</span>
        </span>
      </div>
      <div v-if="searchResults.length > 30" class="search-result-overflow">仅显示前 30 条，共 {{ searchResults.length }} 条匹配</div>
    </div>

    <!-- 快捷键帮助浮窗 -->
    <Teleport to="body">
      <div v-if="showHelp" class="help-overlay" @click.self="showHelp = false">
        <div class="help-modal">
          <div class="help-header">
            <h3>⌨️ 快捷键</h3>
            <button class="close-btn" @click="showHelp = false">×</button>
          </div>
          <div class="help-list">
            <div class="help-item"><kbd>←</kbd> / <kbd>→</kbd><span>上一题 / 下一题</span></div>
            <div class="help-item"><kbd>A</kbd> <kbd>B</kbd> <kbd>C</kbd> <kbd>D</kbd><span>选择对应选项</span></div>
            <div class="help-item"><kbd>Enter</kbd><span>确认 / 下一题</span></div>
            <div class="help-item"><kbd>F</kbd><span>收藏 / 取消收藏</span></div>
            <div class="help-item"><kbd>R</kbd><span>切换 AI 解析</span></div>
            <div class="help-item"><kbd>?</kbd><span>显示 / 隐藏本帮助</span></div>
            <div class="help-item"><kbd>Esc</kbd><span>关闭弹窗</span></div>
          </div>
          <p class="help-tip">提示：快捷键在输入框内不生效</p>
        </div>
      </div>
    </Teleport>

    <div v-if="restoredBanner" class="restored-banner">
      已从上次进度恢复，当前第 {{ current + 1 }} 题
      <button class="close-btn" @click="restoredBanner = false">×</button>
    </div>

    <div v-if="!loaded" class="loading">加载中...</div>
    <div v-else-if="finished" class="finished">
      <h3>练习完成！</h3>
      <p>共完成 {{ order.length }} 题</p>
      <button @click="restart">🔄 再练一次</button>
      <button @click="$router.push('/')">返回题库</button>
      <button @click="$router.push(`/wrong/${bankId}`)">查看错题</button>
    </div>
    <!-- 全题型被排除：不渲染题目卡，避免 currentQuestion 显示被排除的题 -->
    <div v-else-if="questions.length && !displayQuestions.length" class="empty-filter">
      <div class="empty-icon">🔎</div>
      <p>当前筛选条件下没有题目</p>
      <button class="restart-btn" @click="clearTypeFilter">清除筛选</button>
    </div>
    <!-- 2026-08-16 修复：错题重练/随机等模式下 order 为空（如暂无错题）时，
         此前会兜底显示题库第一题（currentQuestion 的 || questions[0]），用户误以为是错题 -->
    <div v-else-if="questions.length && !order.length" class="empty-filter">
      <div class="empty-icon">{{ mode === 'wrong' ? '🎉' : '📭' }}</div>
      <p>{{ mode === 'wrong' ? '暂无错题，先去刷题积累错题吧！' : '当前没有可练习的题目' }}</p>
      <button class="restart-btn" @click="$router.push(mode === 'wrong' ? '/' : '/')">返回题库</button>
    </div>
    <div v-else-if="questions.length && current >= 0 && displayQuestions.length">
      <QuestionCard
        :key="`${currentQuestion.id}-${reloadKey}`"
        :question="currentQuestion"
        :index="current"
        :auto-next="autoNext"
        :has-prev="current > 0"
        :saved-state="answerStates.get(currentQuestion.id) || null"
        :favorited="favoriteIds.has(currentQuestion.id)"
        :shuffle-options="shuffleOptions"
        @answered="onAnswered"
        @state-change="onStateChange"
        @next="next"
        @prev="prev"
        @toggle-favorite="onToggleFavorite"
        @question-updated="onQuestionUpdated"
      />
      <!-- 2026-08-23：记忆自评标签（自动评估，可点击手动覆盖） -->
      <div v-if="memoryReviewMap.has(currentQuestion.id)" class="memory-review-bar">
        <span class="memory-label">记忆自评</span>
        <div class="memory-quality-btns">
          <button
            v-for="opt in MEMORY_OPTIONS"
            :key="opt.label"
            class="memory-quality-btn"
            :class="{ active: currentMemoryLabel === opt.label }"
            :title="opt.hint"
            @click="overrideMemory(opt.label)"
          >{{ opt.label }}</button>
        </div>
        <span class="memory-next" title="下次复习时间">{{ memoryNextText }}</span>
      </div>
      <!-- 题目导航条 -->
      <div v-if="displayQuestions.length > 1" class="question-nav">
        <div class="nav-header">
          <span class="nav-title">题目导航 <span v-if="typeFilter.length" class="filter-hint">（已过滤 {{ typeFilter.length }} 类）</span></span>
          <span class="nav-stats">
            <span class="dot-stat correct">✓ {{ correctCount }}</span>
            <span class="dot-stat wrong">✗ {{ wrongCount }}</span>
            <span class="dot-stat unanswered">○ {{ unansweredCount }}</span>
          </span>
        </div>
        <div class="nav-dots">
          <button
            v-for="(q, i) in displayQuestions"
            :key="q.id"
            class="nav-dot"
            :class="getDotClass(i, q.id)"
            :title="`第 ${i + 1} 题`"
            @click="goToQuestion(i)"
          >{{ i + 1 }}</button>
        </div>
      </div>
    </div>
    <div v-else>暂无题目，请先导入。</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { api, Question } from '../utils/api'
import { toastError, toastSuccess, toastInfo } from '../utils/toast'
import { useBankStore } from '../stores/bank'
import { idb } from '../lib/db'
import QuestionCard, { type QuestionState } from '../components/QuestionCard.vue'
import { classifyQuestionType } from '../lib/exam'
import { calculateAutoQuality, calculateNextReview, qualityLabel, labelToQuality, formatDate, computeNextReviewTs, toReviewTs, type QualityLabel } from '../lib/spaced-repetition'

interface SavedProgress {
  mode: string
  order_ids: number[]
  current_id: number
  answer_states: Record<string, QuestionState>
  finished: boolean
  saved_at: string
}

const route = useRoute()
const bankStore = useBankStore()
const bankId = Number(route.params.bankId)
// 2026-08-22：智能学习计划模式——队列来自 StudyPlanView 写入的 localStorage（study_plan_questions）
// 修复前：计划跳转路由错误 404，且 mode=plan / study_plan_questions 无消费方，计划功能完全断裂
const isPlanMode = route.query.mode === 'plan'
const planItems = ref<{ id: number; bankId: number }[]>([])
const planId = ref<string | null>(null)
const planQueueReady = ref(false)
const bankName = computed(() => bankStore.banks.find(b => b.id === bankId)?.name || '')
const questions = ref<Question[]>([])
const order = ref<number[]>([])
const current = ref(0)
const mode = ref('order')
const finished = ref(false)
const autoNext = ref(localStorage.getItem('practice_auto_next') === '1')
watch(autoNext, (v) => {
  localStorage.setItem('practice_auto_next', v ? '1' : '0')
})
// 选项乱序：打乱选择题选项展示顺序（localStorage 持久化，默认为关）
const shuffleOptions = ref(localStorage.getItem('practice_shuffle_options') === '1')
watch(shuffleOptions, (v) => {
  localStorage.setItem('practice_shuffle_options', v ? '1' : '0')
  reloadKey.value++ // 强制重挂载当前题，重新随机打乱
})
// 保存每道题的答题状态（按题目 id），切换题目时恢复
const answerStates = ref<Map<number, QuestionState>>(new Map())
// 收藏题目 id 集合
const favoriteIds = ref<Set<number>>(new Set())

const loaded = ref(false)
const restoring = ref(false)
const restoredBanner = ref(false)
const reloadKey = ref(0)

// 搜索相关
const searchQuery = ref('')
const searchResults = ref<Question[] | null>(null)

// 快捷键帮助浮窗
const showHelp = ref(false)

// 题目类型筛选：typeFilter 存储**被排除**的题型（默认全选=空数组）
const typeFilter = ref<string[]>([])
const TYPE_LABELS: Record<string, string> = { single: '单选', multi: '多选', judge: '判断', blank: '填空', qa: '问答' }
// 2026-08-16 修复：题型归类必须内容识别（判断题在库里是 type:'single' + ["正确","错误"]，
// 裸用 q.type 会把判断题并进"单选"，筛选框只剩单选/多选）
function questionTypeLabel(q: Question): string {
  const t = classifyQuestionType(q)
  return TYPE_LABELS[t] || t
}
const availableTypes = computed(() => {
  const set = new Set<string>()
  for (const q of questions.value) set.add(questionTypeLabel(q))
  return Array.from(set)
})
function toggleTypeFilter(t: string) {
  const idx = typeFilter.value.indexOf(t)
  if (idx >= 0) typeFilter.value.splice(idx, 1)
  else typeFilter.value.push(t)
  // 筛选变化时立即重建答题顺序并回到第一题
  rebuildOrderFromFilter()
}
function clearTypeFilter() {
  typeFilter.value = []
  rebuildOrderFromFilter()
}
// 按筛选重建 order（保留当前模式逻辑：顺序/随机/错题）
function rebuildOrderFromFilter() {
  // 2026-08-16 修复卡死：一次构建 id→下标 Map，避免每题 findIndex 的 O(N²)
  const idxMap = new Map(questions.value.map((q, i) => [q.id, i]))
  const filtered = displayQuestions.value
  if (mode.value === 'random') {
    order.value = shuffle(filtered.map(q => q.id).map(id => idxMap.get(id)).filter((i): i is number => i !== undefined && i >= 0))
  } else if (mode.value === 'wrong') {
    // 错题重练 + 筛选：从错题中再按筛选过滤（简单场景：直接过滤错题）
    const allowed = new Set(filtered.map(q => q.id))
    order.value = order.value.filter(i => allowed.has(questions.value[i]?.id))
  } else {
    order.value = filtered.map(q => idxMap.get(q.id)).filter((i): i is number => i !== undefined && i >= 0)
  }
  current.value = 0
  scheduleSave()
}

// 类型过滤后的题目列表（影响 order）
const displayQuestions = computed(() => {
  if (typeFilter.value.length === 0) return questions.value
  return questions.value.filter(q => {
    return !typeFilter.value.includes(questionTypeLabel(q))
  })
})

// 2026-08-16：单题库「模拟考试」已取消（功能与「创建考试」重叠，且存在切模式计时器泄漏等缺陷）

const progressKey = `practice_progress_${bankId}`
// 全局最近练习记录（供首页"继续刷题"使用）
const LAST_PRACTICE_KEY = 'last_practice'

const currentQuestion = computed(() => questions.value[order.value[current.value]] || questions.value[0])

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

onMounted(async () => {
  // 全局快捷键
  window.addEventListener('keydown', onKeydown)
  try {
    questions.value = await api.listQuestions(bankId)
    if (isPlanMode) {
      // 计划模式：读取 StudyPlanView 写入的今日任务队列，过滤出属于当前题库的题
      try {
        const raw = localStorage.getItem('study_plan_questions')
        planId.value = localStorage.getItem('study_plan_id')
        if (raw) {
          const items = JSON.parse(raw) as { id: number; bankId: number }[]
          const bankIdSet = new Set(items.map(i => i.bankId))
          if (!bankIdSet.has(bankId) && bankIdSet.size > 1) {
            // 队列里没有当前题库的题（跨题库计划），提示并回退普通练习
            toastInfo('今日计划中没有本题库的题目，已进入普通练习')
          }
          const allowed = new Set(items.filter(i => i.bankId === bankId).map(i => i.id))
          if (allowed.size > 0) {
            const idxMap = new Map(questions.value.map((q, i) => [q.id, i]))
            const planOrder = Array.from(allowed)
              .map(id => idxMap.get(id))
              .filter((i): i is number => i !== undefined)
            if (planOrder.length > 0) {
              order.value = planOrder
              planQueueReady.value = true
            }
          }
        }
      } catch (e) {
        console.error('读取计划队列失败：', e)
      }
    }
    if (!planQueueReady.value) {
      order.value = questions.value.map((_, i) => i)
    }
    // 加载收藏列表
    try {
      const favIds = await api.listFavorites(bankId)
      favoriteIds.value = new Set(favIds)
    } catch (e) {
      console.error('加载收藏列表失败：', e)
    }
    if (!isPlanMode) {
      // 计划模式不恢复普通练习进度（避免计划队列污染/被污染）
      await restoreProgress()
    }
  } catch (e) {
    toastError('加载题目失败：' + (e instanceof Error ? e.message : String(e)))
  } finally {
    loaded.value = true
    // 2026-08-23：进入页面加载记忆标签（已有答题状态的题）
    loadMemoryReviews()
  }
})

// 从后端恢复上次进度
async function restoreProgress() {
  const saved = await api.getSetting(progressKey)
  if (!saved) return
  let progress: SavedProgress
  try {
    progress = JSON.parse(saved)
  } catch {
    return
  }
  if (!progress || typeof progress.current_id !== 'number') return
  if (!questions.value.length) return

  restoring.value = true

  // 恢复练习模式
  if (progress.mode === 'order' || progress.mode === 'random') {
    mode.value = progress.mode
  }

  // 构建 题目id → 当前索引 的映射（题目列表可能已变化）
  const idToIndex = new Map(questions.value.map((q, i) => [q.id, i]))

  // 恢复题目顺序
  if (progress.order_ids && progress.order_ids.length === questions.value.length) {
    const restoredOrder: number[] = []
    let valid = true
    for (const id of progress.order_ids) {
      const idx = idToIndex.get(id)
      if (idx === undefined) { valid = false; break }
      restoredOrder.push(idx)
    }
    if (valid) {
      order.value = restoredOrder
    } else if (mode.value === 'random') {
      order.value = shuffle(questions.value.map((_, i) => i))
    }
    // 顺序模式下 order.value 已是 [0,1,...,n-1]
  } else if (mode.value === 'random') {
    order.value = shuffle(questions.value.map((_, i) => i))
  }

  // 恢复当前题号（按题目 id 定位，避免题目列表变化导致错位）
  const currentOrderIdx = order.value.findIndex(i => questions.value[i]?.id === progress.current_id)
  current.value = currentOrderIdx >= 0 ? currentOrderIdx : 0

  // 恢复各题答题状态
  if (progress.answer_states) {
    const map = new Map<number, QuestionState>()
    for (const [idStr, state] of Object.entries(progress.answer_states)) {
      const id = Number(idStr)
      if (idToIndex.has(id)) {
        map.set(id, state)
      }
    }
    answerStates.value = map
  }

  if (progress.finished) {
    finished.value = true
  } else if (currentOrderIdx >= 0) {
    restoredBanner.value = true
    setTimeout(() => { restoredBanner.value = false }, 5000)
  }

  await nextTick()
  restoring.value = false
}

// 模式切换：重新生成顺序并回到第一题（恢复阶段跳过）
watch(mode, async (m) => {
  if (restoring.value) return
  // 2026-08-16 修复卡死：此前每题 findIndex 扫全表 O(N²)，题库 3000+ 题切换随机/顺序会卡死。
  // 一次构建 id→下标 Map（O(N)），后续全部 O(1) 查表。
  const idxMap = new Map(questions.value.map((q, i) => [q.id, i]))
  const filtered = displayQuestions.value
  if (m === 'random') {
    const ids = shuffle(filtered.map(q => q.id))
    order.value = ids.map(id => idxMap.get(id)).filter((i): i is number => i !== undefined && i >= 0)
  } else if (m === 'wrong') {
    // 错题重练：加载错题 ID，按错题顺序生成 order（再叠加题型筛选）
    try {
      const wrongIds = await api.listWrong(bankId)
      const allowed = new Set(filtered.map(q => q.id))
      order.value = wrongIds.filter(id => allowed.has(id)).map(id => idxMap.get(id)).filter((i): i is number => i !== undefined)
    } catch (e) {
      console.error('加载错题失败：', e)
      order.value = []
    }
  } else {
    order.value = filtered.map(q => idxMap.get(q.id)).filter((i): i is number => i !== undefined && i >= 0)
  }
  current.value = 0
  scheduleSave()
})

// 防抖保存进度
let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave() {
  if (restoring.value) return
  if (!loaded.value) return
  // 2026-08-22：计划模式不写入普通练习进度（队列来自计划，避免下次普通练习被计划队列污染）
  if (isPlanMode) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveProgress, 500)
}

async function saveProgress() {
  if (!questions.value.length || !order.value.length) return
  // 完成练习后清除进度，下次从头开始
  if (finished.value) {
    try {
      await api.setSetting(progressKey, '')
    } catch (e) {
      console.error('清除进度失败：', e)
    }
    return
  }
  const cur = order.value[current.value]
  if (cur === undefined) return
  const progress: SavedProgress = {
    mode: mode.value,
    order_ids: order.value
      .map(i => questions.value[i]?.id)
      .filter((id): id is number => id !== undefined),
    current_id: questions.value[cur].id,
    answer_states: Object.fromEntries(answerStates.value.entries()),
    finished: false,
    saved_at: new Date().toISOString(),
  }
  try {
    await api.setSetting(progressKey, JSON.stringify(progress))
    // 同步更新全局最近练习记录（首页"继续刷题"卡片使用）
    const lastPractice = {
      bank_id: bankId,
      bank_name: bankName.value,
      position: current.value + 1,
      total: questions.value.length,
      saved_at: progress.saved_at,
    }
    await api.setSetting(LAST_PRACTICE_KEY, JSON.stringify(lastPractice))
  } catch (e) {
    console.error('保存进度失败：', e)
  }
}

// 切换当前题目收藏状态
async function onToggleFavorite() {
  const q = currentQuestion.value
  if (!q) return
  try {
    const nowFav = await api.toggleFavorite(bankId, q.id)
    const next = new Set(favoriteIds.value)
    if (nowFav) next.add(q.id)
    else next.delete(q.id)
    favoriteIds.value = next
  } catch (e) {
    console.error('切换收藏失败：', e)
  }
}

// 题目编辑保存后，更新本地 questions 数组并强制重渲染当前题
function onQuestionUpdated(updated: Question) {
  const idx = questions.value.findIndex(q => q.id === updated.id)
  if (idx >= 0) {
    questions.value[idx] = updated
  }
  reloadKey.value++  // 强制 QuestionCard 重新挂载，加载新数据
}

watch([current, finished], scheduleSave)
watch(order, scheduleSave, { deep: true })
// 2026-08-23：切换题目时刷新记忆标签（自动评估基于已答题状态）
watch(current, () => { loadMemoryReviews() })

// 组件卸载前立即保存一次，避免导航离开时丢失最后一次进度
// 全局快捷键处理
function onKeydown(e: KeyboardEvent) {
  // 在输入框/textarea 中不响应
  const t = e.target as HTMLElement
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  if (e.key === '?' || (e.shiftKey && e.key === '/')) {
    e.preventDefault()
    showHelp.value = !showHelp.value
  } else if (e.key === 'Escape') {
    showHelp.value = false
  }
  // BUG-005 修复：移除 F 键分支，由 QuestionCard 单独处理避免双触发
  // 旧实现：父组件 onKeydown + 子组件 handleKeydown 都监听 window keydown，
  // 按一次 F 收藏被切换两次，净效果为未变化
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
    void saveProgress()
  }
})

async function onAnswered(payload: { correct: boolean; answer: string; duration_ms: number | null }) {
  const q = currentQuestion.value
  try {
    const res = await api.recordPractice({ bank_id: bankId, question_id: q.id, user_answer: payload.answer, is_correct: payload.correct, duration_ms: payload.duration_ms })
    // 2026-08-19：连续答对达到阈值 → 自动移入「已掌握」
    if (res?.autoMastered) toastSuccess(`🎉 连续答对 ${res.streak} 次，该题已自动移入「已掌握」`)
    // 累计每日统计（用于热力图）
    await bumpDailyRecord(payload.correct)
  } catch (e) {
    console.error('记录练习失败：', e)
  }
  // 2026-08-23：记忆复习全局写入——任何练习模式都更新 SM-2 复习记录（计划模式用同一函数，避免双写冲突）
  try {
    await updateMemoryReview(q.id, payload.correct, payload.duration_ms)
    // 计划模式额外记录今日完成
    if (isPlanMode) {
      await markPlanCompleted(q.id)
    }
  } catch (e) {
    console.error('更新记忆复习记录失败：', e)
  }
}

// 2026-08-23 记忆复习相关状态
// ============================================================
// 记忆自评：自动评估（对错+耗时）→ 显示标签 → 可手动覆盖
// 任何练习模式都写 review_records（此前仅计划模式写）
// ============================================================
// 2026-09-15 修复(P2-10)：标签集合必须与 qualityLabel 的值域**一一对应**。
// 此前只有四个按钮且「模糊」的 q 写 3，而 qualityLabel(2) 也返回「模糊」、labelToQuality('模糊') 返回 3
// → 存为 quality:2 的记录被用户点同一个标签确认后重写成 3，跨越 quality<3 的及格线（失败改判为成功）。
// 标签拆分后若**不补**「勉强」按钮，quality:3 的记录会显示一个没有对应按钮的标签，
// 用户只能点相邻的「模糊」→ 3 被降成 2，同一个缺陷换个方向重现。故这里是五个按钮。
const MEMORY_OPTIONS = [
  { label: '认识', q: 5, hint: '熟练，可拉长复习间隔' },
  { label: '一般', q: 4, hint: '会但不熟' },
  { label: '勉强', q: 3, hint: '想很久才答对' },
  { label: '模糊', q: 2, hint: '接近但没答对' },
  { label: '不认识', q: 1, hint: '完全不会，须尽快复习' },
] as const

// 当前题的记忆记录（questionId → review_record 摘要，供标签展示）
// 2026-09-15(P1-21)：next_review 现在写**纪元毫秒数字**，但用户 IndexedDB 里的历史记录仍是 ISO 串，
// 故类型放宽为 string | number | null，读取一律走 toReviewTs
const memoryReviewMap = ref<Map<number, { quality: number; next_review: string | number | null; interval: number; ease_factor: number }>>(new Map())

const currentMemoryLabel = computed(() => {
  const rec = memoryReviewMap.value.get(currentQuestion.value?.id)
  if (!rec) return null
  return qualityLabel(rec.quality)
})

const memoryNextText = computed(() => {
  const rec = memoryReviewMap.value.get(currentQuestion.value?.id)
  if (!rec) return ''
  // 2026-09-15 修复(P1-21)：原式 `new Date(rec.next_review)` 对数字与 ISO 串都能解析，
  // 但对损坏值会得 Invalid Date 再靠 Number.isNaN 兜；改用 toReviewTs 后与全项目共用同一个解析口径
  //（对历史 ISO 串产出与 new Date(v).getTime() 完全相同的数字，展示不会漂移）
  const ts = rec.next_review ? toReviewTs(rec.next_review) : null
  if (ts === null) return ''
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const due = new Date(ts); due.setHours(0, 0, 0, 0)
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000)
  if (diffDays <= 0) return '今日已到期'
  return `${diffDays} 天后复习`
})

// 手动覆盖记忆质量（写入 SM-2）
async function overrideMemory(label: QualityLabel) {
  const q = currentQuestion.value
  if (!q) return
  try {
    await updateMemoryReview(q.id, undefined, undefined, labelToQuality(label))
    toastInfo(`已标记「${label}」`)
  } catch (e) {
    toastError('标记失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

// 更新单题的 SM-2 复习记录（合并计划模式的 updatePlanReview，全局统一）
// 参数说明：quality 优先级最高；无 quality 时用自动评估（correct + durationMs 推断）
async function updateMemoryReview(questionId: number, correct?: boolean, durationMs?: number | null, explicitQuality?: number) {
  const record = await idb.getReviewRecordByQuestionId(questionId)
  const now = new Date()
  // 记忆评估：显式指定 > 自动评估（对错+耗时） > 兜底（对/错 → 4/1）
  const quality = explicitQuality ?? (correct !== undefined ? calculateAutoQuality(correct, durationMs) : (record?.quality ?? 4))
  const result = calculateNextReview(
    record?.last_review ? new Date(record.last_review) : now,
    quality,
    record?.repetitions ?? 0,
    record?.ease_factor ?? 2.5,
    record?.interval ?? 0
  )
  const data = {
    question_id: questionId,
    bank_id: bankId,
    last_review: now.toISOString(),   // 本次复习时间（2026-08-23 修复：此前误存为 nextReview，导致 isStaleReview 判断失效）
    quality,
    repetitions: result.newRepetitions,
    ease_factor: result.newEaseFactor,
    interval: result.newInterval,
    // 2026-09-15 修复(P1-21)：原为 `result.nextReview.toISOString()`，即「ISO 串 + 锚定上次复习日 +
    // 日历日算术」，与小程序端 practice.vue/review.vue 的「纪元数字 + 锚定当下 + 固定 24h」三处都不同：
    // 迟到 20 天再复习时两端相差 20 天，且锚定上次复习日会算出**已经过去**的日期使该题永远到期；
    // 跨端读取时 `Number("2026-01-01T…")` = NaN，小程序 dueReviews() 的 `<= now` 恒 false。
    // 现统一走 computeNextReviewTs：纪元毫秒数字、锚定本次复习的当下（与 last_review 同一时刻）、
    // 日历日算术、间隔钳在 MAX_INTERVAL_DAYS 内。历史 ISO 串由 toReviewTs 继续读得动。
    next_review: computeNextReviewTs(result.newInterval, now.getTime()),
  }
  if (record?.id != null) {
    await idb.updateReviewRecord(record.id, data)
  } else {
    await idb.addReviewRecord(data)
  }
  // 更新本地标签缓存
  memoryReviewMap.value.set(questionId, { quality, next_review: data.next_review, interval: data.interval, ease_factor: data.ease_factor })
}

// 加载已答题的记忆记录（进入页面/切换题时刷新标签）——仅带已提交答题状态的题
async function loadMemoryReviews() {
  const submittedIds = Array.from(answerStates.value.entries())
    .filter(([, s]) => s.submitted)
    .map(([id]) => id)
  if (!submittedIds.length) return
  try {
    const records = await idb.getReviewRecordsByQuestionIds(submittedIds)
    for (const [id, rec] of records) {
      memoryReviewMap.value.set(id, {
        quality: rec.quality,
        next_review: rec.next_review ?? rec.last_review ?? null,
        interval: rec.interval ?? 0,
        ease_factor: rec.ease_factor ?? 2.5,
      })
    }
    // 对新提交但尚无记录的题，用上次答题状态推断（避免标签空白）
    for (const id of submittedIds) {
      if (!memoryReviewMap.value.has(id)) {
        const st = answerStates.value.get(id)
        if (st) {
          const qc = calculateAutoQuality(st.isCorrect !== false, st.elapsedSecs ? st.elapsedSecs * 1000 : null)
          memoryReviewMap.value.set(id, { quality: qc, next_review: null, interval: 0, ease_factor: 2.5 })
        }
      }
    }
  } catch (e) {
    console.error('加载记忆复习记录失败：', e)
  }
}

// 计划模式：记录今日完成（completed_<planId>_<date>，供 StudyPlanView/首页进度展示）
async function markPlanCompleted(questionId: number) {
  if (!planId.value) return
  const key = `completed_${planId.value}_${formatDate(new Date())}`
  try {
    const raw = localStorage.getItem(key)
    const list: number[] = raw ? JSON.parse(raw) : []
    if (!list.includes(questionId)) {
      list.push(questionId)
      localStorage.setItem(key, JSON.stringify(list))
    }
  } catch (e) {
    console.error('记录计划完成失败：', e)
  }
}

// 累加今日刷题记录到 settings.daily_records
// BUG-008 修复：加前端互斥锁，避免连续答题时 read-modify-write 竞态导致统计丢失
// 旧实现：两次并发 bumpDailyRecord 都读到同一份 records，各自 +1 后写回，后写覆盖先写
let bumpDailyRecordChain: Promise<void> = Promise.resolve()
function bumpDailyRecord(correct: boolean): Promise<void> {
  // 串行化：将每次调用接到 chain 末尾，保证不并发
  const run = async () => {
    try {
      const raw = await api.getSetting('daily_records')
      const records: { date: string; total: number; correct: number }[] = raw ? JSON.parse(raw) : []
      const d = new Date()
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const idx = records.findIndex(r => r.date === today)
      if (idx >= 0) {
        records[idx].total++
        if (correct) records[idx].correct++
      } else {
        records.push({ date: today, total: 1, correct: correct ? 1 : 0 })
      }
      // 只保留最近 400 天
      const sorted = records.sort((a, b) => a.date.localeCompare(b.date))
      const trimmed = sorted.slice(-400)
      await api.setSetting('daily_records', JSON.stringify(trimmed))
    } catch (e) {
      console.error('更新每日统计失败：', e)
    }
  }
  bumpDailyRecordChain = bumpDailyRecordChain.then(run)
  return bumpDailyRecordChain
}

// P1-10: 搜索题目，跳转到第一个匹配
async function doSearch() {
  const q = searchQuery.value.trim()
  if (!q) {
    clearSearch()
    return
  }
  try {
    const results = await api.searchQuestions(bankId, q, 50)
    searchResults.value = results
    if (results.length > 0) {
      // 跳到第一个匹配的题目
      const firstId = results[0].id
      const idx = order.value.findIndex(i => questions.value[i]?.id === firstId)
      if (idx >= 0) {
        current.value = idx
      }
    }
  } catch (e) {
    toastError('搜索失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

function clearSearch() {
  searchResults.value = null
  searchQuery.value = ''
}

// 高亮关键词：转义 HTML 后用 <mark> 包裹
function highlightText(text: string, keyword: string): string {
  if (!text) return ''
  const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  if (!keyword.trim()) return safe
  const escapedKw = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return safe.replace(new RegExp(escapedKw, 'gi'), m => `<mark>${m}</mark>`)
}

// 跳转到指定题目
function jumpToQuestion(qid: number) {
  const orderIdx = order.value.findIndex(i => questions.value[i]?.id === qid)
  if (orderIdx >= 0) {
    current.value = orderIdx
    nextTick(() => {
      const el = document.querySelector('.qcard')
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }
}

// QuestionCard 状态变化时保存到 Map（切换题目/返回上一题时仍可恢复）
function onStateChange(state: QuestionState) {
  const q = currentQuestion.value
  answerStates.value.set(q.id, state)
  scheduleSave()
}

function next() {
  if (current.value < order.value.length - 1) {
    current.value++
  } else {
    finished.value = true
  }
}

function prev() {
  if (current.value > 0) {
    current.value--
  }
}

function goToQuestion(displayIndex: number) {
  // displayIndex 是 displayQuestions 的下标，需要找到对应 qid，再找到 order 中的 current 位置
  const target = displayQuestions.value[displayIndex]
  if (!target) return
  const orderIdx = order.value.findIndex(i => questions.value[i]?.id === target.id)
  if (orderIdx >= 0) {
    current.value = orderIdx
  }
}

// 导航点状态：current/submitted/correct/wrong/fav
function getDotClass(_listIndex: number, qid: number): string {
  const classes: string[] = []
  // current 通过 qid 比较（因为 listIndex 是 displayQuestions 下标，current 是 order 下标）
  const currentQid = currentQuestion.value?.id
  if (qid === currentQid) classes.push('current')
  const state = answerStates.value.get(qid)
  if (state?.submitted) {
    if (state.isCorrect === true) classes.push('correct')
    else if (state.isCorrect === false) classes.push('wrong')
    else classes.push('submitted')
  }
  if (favoriteIds.value.has(qid)) classes.push('fav')
  return classes.join(' ')
}

const correctCount = computed(() => {
  let c = 0
  for (const s of answerStates.value.values()) if (s.submitted && s.isCorrect === true) c++
  return c
})
const wrongCount = computed(() => {
  let c = 0
  for (const s of answerStates.value.values()) if (s.submitted && s.isCorrect === false) c++
  return c
})
const unansweredCount = computed(() => {
  const submitted = correctCount.value + wrongCount.value
  return Math.max(0, questions.value.length - submitted)
})

// 重新开始：清除进度并重置（练习中点击弹确认；练习完成页点击直接重练）
async function restart() {
  if (!finished.value && !confirm('确定要重新开始吗？当前进度将被清除。')) return
  restoring.value = true
  current.value = 0
  mode.value = 'order'
  // 2026-08-16：Map 查表避免 O(N²) 卡死
  const idxMap = new Map(questions.value.map((q, i) => [q.id, i]))
  order.value = displayQuestions.value.map(q => idxMap.get(q.id)).filter((i): i is number => i !== undefined && i >= 0)
  answerStates.value = new Map()
  finished.value = false
  restoredBanner.value = false
  reloadKey.value++
  await nextTick()
  restoring.value = false
  await saveProgress()
}
</script>

<style scoped>
/* topbar 合并两排布局 */
.topbar { display: flex; gap: 12px; align-items: center; margin-bottom: 10px; flex-wrap: wrap; padding: 10px 14px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-md); }
.main-bar { padding: 12px 16px; }
.main-left { display: flex; align-items: center; gap: 10px; }
.main-left .bank-name { font-weight: 600; color: var(--color-text); font-size: 15px; }
.main-progress { flex: 1; display: flex; align-items: center; gap: 10px; min-width: 160px; }
.main-progress .progress-text { color: var(--color-text-secondary); font-size: 13px; font-family: monospace; white-space: nowrap; }
.progress-track { flex: 1; height: 6px; background: var(--color-border-light); border-radius: 3px; overflow: hidden; }
.progress-fill { height: 100%; background: linear-gradient(90deg, var(--color-primary), var(--color-primary-dark)); border-radius: 3px; transition: width 0.3s; }
.main-right { display: flex; align-items: center; gap: 8px; }
.tool-bar { font-size: 13px; padding: 8px 14px; }
.info-bar { font-size: 15px; }
.info-bar .bank-name { font-weight: 600; color: var(--color-text); }
.info-bar .progress { color: var(--color-text-secondary); padding: 2px 10px; background: var(--color-border-light); border-radius: var(--radius-sm); font-size: 13px; font-family: monospace; }
.control-bar { padding-bottom: 8px; border-bottom: 1px solid var(--color-border-light); }
.action-bar { justify-content: flex-end; margin-top: 4px; }

.mode-select { padding: 5px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); color: var(--color-text); font-size: 13px; cursor: pointer; }
.help-btn { width: 28px; height: 28px; border-radius: 50%; border: 1px solid var(--color-border); background: var(--color-card); cursor: pointer; font-size: 14px; font-weight: 700; color: var(--color-text-secondary); }
.help-btn:hover { background: var(--color-primary-light); color: var(--color-primary); border-color: var(--color-primary); }

.type-filter { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.filter-label { font-size: 12px; color: var(--color-text-tertiary); margin-right: 2px; }
.type-chip-btn { padding: 3px 10px; border: 1px solid var(--color-border); border-radius: 12px; background: var(--color-bg); color: var(--color-text-tertiary); font-size: 12px; cursor: pointer; transition: all 0.12s; opacity: 0.5; }
.type-chip-btn.active { background: var(--color-primary-light); color: var(--color-primary); border-color: var(--color-primary); opacity: 1; }
.type-chip-btn:hover { transform: translateY(-1px); }
.filter-hint { font-size: 11px; color: var(--color-warning); margin-left: 6px; }

.help-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 200; animation: helpFadeIn 0.15s; }
.help-modal { background: var(--color-card); border-radius: var(--radius-lg); padding: 24px; min-width: 360px; max-width: 90vw; color: var(--color-text); box-shadow: 0 16px 48px rgba(0,0,0,0.25); }
.help-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.help-header h3 { margin: 0; }
.help-list { display: flex; flex-direction: column; gap: 10px; }
.help-item { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.help-item span { margin-left: auto; color: var(--color-text-secondary); }
.help-item kbd { display: inline-block; padding: 2px 8px; background: var(--color-bg); border: 1px solid var(--color-border); border-bottom-width: 2px; border-radius: 4px; font-family: ui-monospace, Consolas, monospace; font-size: 12px; color: var(--color-text); }
.help-tip { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--color-border-light); color: var(--color-text-tertiary); font-size: 12px; }

@keyframes helpFadeIn { from { opacity: 0; } to { opacity: 1; } }

/* 记忆自评栏 */
.memory-review-bar { margin-top: 12px; padding: 10px 14px; background: var(--color-card); border: 1px dashed var(--color-border); border-radius: var(--radius-md); display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.memory-label { font-size: 12px; color: var(--color-text-secondary); font-weight: 600; }
.memory-quality-btns { display: flex; gap: 6px; flex-wrap: wrap; }
.memory-quality-btn { padding: 4px 12px; border: 1px solid var(--color-border); border-radius: 12px; background: var(--color-bg); color: var(--color-text-secondary); font-size: 12px; cursor: pointer; transition: all 0.12s; }
.memory-quality-btn:hover { transform: translateY(-1px); border-color: var(--color-primary); color: var(--color-primary); }
.memory-quality-btn.active { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
.memory-next { margin-left: auto; font-size: 12px; color: var(--color-text-tertiary); }

/* 题目导航条 */
.question-nav { margin-top: 18px; padding: 14px 16px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-md); }
.nav-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.nav-title { font-size: 13px; font-weight: 600; color: var(--color-text); }
.nav-stats { display: flex; gap: 10px; font-size: 12px; }
.dot-stat { padding: 1px 8px; border-radius: 10px; }
.dot-stat.correct { background: var(--color-success-bg); color: var(--color-success-deep); }
.dot-stat.wrong { background: var(--color-danger-bg); color: var(--color-danger-deep); }
.dot-stat.unanswered { background: var(--color-border-light); color: var(--color-text-secondary); }
.nav-dots { display: flex; flex-wrap: wrap; gap: 4px; max-height: 180px; overflow-y: auto; padding: 2px; }
.nav-dot { min-width: 28px; height: 28px; padding: 0 4px; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-card); color: var(--color-text-secondary); font-size: 11px; cursor: pointer; transition: all 0.12s; display: inline-flex; align-items: center; justify-content: center; font-weight: 500; }
.nav-dot:hover { transform: translateY(-1px); box-shadow: 0 2px 6px rgba(0,0,0,0.1); border-color: var(--color-primary); color: var(--color-primary); }
.nav-dot.current { background: var(--color-primary); color: #fff; border-color: var(--color-primary); box-shadow: 0 0 0 2px var(--color-primary-light); }
.nav-dot.correct { background: var(--color-success-bg); color: var(--color-success-deep); border-color: var(--color-success-bg); }
.nav-dot.wrong { background: var(--color-danger-bg); color: var(--color-danger-deep); border-color: var(--color-danger-bg); }
.nav-dot.submitted { background: var(--color-warning-bg); color: var(--color-warning-text); border-color: var(--color-warning-light); }
.nav-dot.fav::after { content: "★"; color: var(--color-warning-strong); font-size: 8px; margin-left: 2px; }
.search-box { display: flex; gap: 4px; align-items: center; }
.search-box input { padding: 5px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-md); width: 200px; max-width: 100%; box-sizing: border-box; background: var(--color-card); color: var(--color-text); font-size: 13px; }
.search-btn { padding: 5px 12px; border: 1px solid var(--color-primary); background: var(--color-primary); color: #fff; border-radius: var(--radius-md); cursor: pointer; font-size: 12px; }
.clear-search-btn { padding: 5px 8px; border: 1px solid var(--color-border); background: var(--color-card); color: var(--color-text-secondary); border-radius: var(--radius-md); cursor: pointer; font-size: 12px; }
.auto-next-toggle { display: flex; align-items: center; gap: 4px; font-size: 13px; cursor: pointer; color: var(--color-text-secondary); }
.auto-next-toggle input { cursor: pointer; }

.restart-btn { padding: 5px 14px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); cursor: pointer; font-size: 13px; color: var(--color-text); }
.restart-btn:hover { background: var(--color-border-light); }

.search-result-banner { background: var(--color-info-light); color: var(--color-info); padding: 8px 16px; border-radius: var(--radius-md); margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
.search-result-banner b { color: var(--color-primary); font-weight: 600; }
.search-result-list { max-height: 360px; overflow-y: auto; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-md); margin-bottom: 16px; }
.search-result-item { display: flex; align-items: flex-start; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--color-border-light); cursor: pointer; transition: background 0.12s; }
.search-result-item:last-child { border-bottom: none; }
.search-result-item:hover { background: var(--color-primary-light); }
.search-result-idx { color: var(--color-text-tertiary); font-size: 13px; flex-shrink: 0; }
.search-result-text { flex: 1; font-size: 13px; line-height: 1.5; color: var(--color-text); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.search-result-text :deep(mark) { background: var(--color-warning-bg); color: var(--color-warning-text); padding: 0 2px; border-radius: 2px; font-weight: 600; }
.search-result-types { display: flex; gap: 4px; flex-shrink: 0; }
.type-chip { padding: 1px 6px; background: var(--color-border-light); color: var(--color-text-secondary); border-radius: 3px; font-size: 11px; }
.search-result-overflow { padding: 8px 14px; font-size: 12px; color: var(--color-text-tertiary); text-align: center; background: var(--color-bg); border-top: 1px solid var(--color-border-light); }
.restored-banner { background: var(--color-success-light); border: 1px solid var(--color-success); color: var(--color-success); padding: 8px 16px; border-radius: var(--radius-md); margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; font-size: 14px; }
.restored-banner .close-btn { background: none; border: none; font-size: 18px; cursor: pointer; color: var(--color-success); padding: 0 4px; line-height: 1; }
.loading { text-align: center; padding: 48px; color: var(--color-text-tertiary); }
.empty-filter { text-align: center; padding: 48px; color: var(--color-text-tertiary); }
.empty-filter .empty-icon { font-size: 56px; margin-bottom: 10px; opacity: 0.5; }
.empty-filter p { margin-bottom: 16px; }
.finished { text-align: center; padding: 48px; }
.finished button { margin: 8px; padding: 8px 16px; }

/* 移动端适配 */
@media (max-width: 768px) {
  .main-progress { min-width: 100%; }
  .search-box { flex: 1; }
  .search-box input { flex: 1; width: auto; min-width: 0; }
  .help-modal { min-width: 0; width: 92vw; padding: 18px; }
  .main-bar .main-right { flex-wrap: wrap; }
  .topbar { gap: 8px; }
  /* 2026-08-16：手机端隐藏快捷键帮助按钮（无键盘，纯桌面功能） */
  .help-btn { display: none; }
}
</style>
