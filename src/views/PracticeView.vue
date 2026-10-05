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
        <!-- 2026-09-28：订阅库练习页的「同步」——多端切换时不必回设置页（双向：先推后拉） -->
        <button v-if="canSyncHere" class="sync-btn" :disabled="syncingCloud" title="同步（上传本机改动 + 拉取云端最新）" @click="doPageSync">
          {{ syncingCloud ? '☁️ 同步中…' : '⇅ 同步' }}
        </button>
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
      <!-- 2026-10-05：进度历史回滚入口。进度只留「当前值」时，被空档覆盖即永久丢失
           （10-04、10-05 各实测一次）⇒ 每库留最近 5 版可回滚。按钮仅在有历史时出现。 -->
      <button v-if="historyList.length" class="restart-btn history-btn" @click="showHistory = true">
        🕘 历史版本（{{ historyList.length }}）
      </button>
      <!-- 2026-10-03：同步状态（断网/失败可见，可点重试） -->
      <span class="sync-chip" :class="{ ok: syncStat.state === 'ok', fail: syncStat.state === 'fail' }" :title="syncStat.msg || ''" @click="onSyncChipTap">{{ syncChipText }}</span>
    </div>

    <!-- 2026-10-03：存档守望的可见出口（写不进去/落盘校验不过时出现，点一下补存）＋计划模式提示 -->
    <div v-if="saveWarn" class="save-warn" @click="retrySave">{{ saveWarn }}</div>
    <div v-if="isPlanMode" class="plan-hint">计划模式：本次练习不更新这道库的「练习进度」（错题/统计照常记录）</div>

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

    <div v-if="syncBanner" class="restored-banner">
      {{ syncBanner }}
      <button class="close-btn" @click="syncBanner = ''">×</button>
    </div>

    <!-- 2026-10-05：进度历史面板（回滚入口）。滚动快照按时间倒序列出，
         每行显示「时间 + 已答数」；点回滚后重新加载本页进度。 -->
    <Teleport to="body">
      <div v-if="showHistory" class="hist-mask" @click.self="showHistory = false">
        <div class="hist-panel">
          <div class="hist-head">
            <span>进度历史版本</span>
            <button class="close-btn" @click="showHistory = false">×</button>
          </div>
          <p class="hist-tip">每次实质作答都会自动留一版，最多保留最近 {{ HISTORY_MAX }} 版。若进度被意外清空，可从这里恢复到先前版本。</p>
          <div v-for="h in historyList" :key="h.saved_at" class="hist-row">
            <div class="hist-info">
              <div class="hist-time">{{ fmtHistTime(h.saved_at) }}</div>
              <div class="hist-meta">已答 {{ h.answered }} 题<template v-if="h.finished"> · 已完成</template><template v-if="h.marked"> · 含「重新开始」标记</template></div>
            </div>
            <button class="hist-btn2" :disabled="rollingBack" @click="onRollback(h)">恢复此版本</button>
          </div>
          <div v-if="!historyList.length" class="hist-empty">暂无历史版本（答过题后会自动记录）</div>
        </div>
      </div>
    </Teleport>

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
        <div class="nav-groups">
          <div v-for="g in navGroups" :key="g.cat" class="nav-group">
            <button class="nav-group-title" @click="goToQuestion(g.first)">{{ g.label }} · {{ g.count }} 题</button>
            <div class="nav-dots">
              <button
                v-for="i in g.indexes"
                :key="i"
                class="nav-dot"
                :class="getDotClass(i, displayQuestions[i]?.id)"
                :title="`第 ${i + 1} 题`"
                @click="goToQuestion(i)"
              >{{ i + 1 }}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-else>暂无题目，请先导入。</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { api, Question, resolveBankId } from '../utils/api'
import { toastError, toastSuccess, toastInfo } from '../utils/toast'
import { useBankStore } from '../stores/bank'
import { idb } from '../lib/db'
import QuestionCard, { type QuestionState } from '../components/QuestionCard.vue'
import { classifyQuestionType, TYPE_LABELS, groupQuestionsByCategory } from '../lib/exam'
import { calculateAutoQuality, calculateNextReview, qualityLabel, labelToQuality, formatDate, computeNextReviewTs, toReviewTs, type QualityLabel } from '../lib/spaced-repetition'
import { formatSyncDetail } from '../lib/sync-format'
import { getWebSyncStatus, retryProgressSync, listProgressHistory, rollbackProgress } from '../lib/cloud'
import { HISTORY_MAX } from '../lib/sync-ids'
import { msToSecs } from '../lib/duration'

interface SavedProgress {
  mode: string
  order_ids: number[]
  current_id: number
  answer_states: Record<string, QuestionState>
  finished: boolean
  saved_at: string
  /** 2026-09-28：本机点过「重新开始」的标记——同步守卫据此区分「故意的空」与
   *  「打开页面自动生成的新进度」，避免重置被云端旧进度顶回来（见 sync-ids 的守卫）。 */
  _reset?: string
}

const route = useRoute()
const bankStore = useBankStore()
// 2026-09-27 订阅模式：路由参数既可能是本地题库的数字 id，也可能是**公共题库的 bankRef**（云端 _id，
// 形如 `lquiz_banks_7` / 32 位十六进制串）。**不能再无条件 Number()** —— 那会把 bankRef 变成 NaN。
// 判据：纯数字 ⇒ 本地库（number）；否则 ⇒ 订阅库（string bankRef），题目由 api 层直接读云端、不落本地。
const bankId = resolveBankId(route.params.bankId)
// 2026-08-22：智能学习计划模式——队列来自 StudyPlanView 写入的 localStorage（study_plan_questions）
// 修复前：计划跳转路由错误 404，且 mode=plan / study_plan_questions 无消费方，计划功能完全断裂
const isPlanMode = route.query.mode === 'plan'
const planItems = ref<{ id: number; bankId: number }[]>([])
const planId = ref<string | null>(null)
const planQueueReady = ref(false)
// 2026-09-27 订阅模式：`canTrack` = 本次练习是否「留痕」（写错题/收藏/统计、进度上云）。
//   · 数字 bankId（本地库） ⇒ 恒 true
//   · 字符串 bankId（公共题库） ⇒ **仅当已订阅** 才 true
// 未订阅的公共库仍可用完整界面练，但**只练不留痕** —— 防止"随手点进别的库、做错几题却删不掉"的污染。
// 订阅记录存 settings（`api.listSubscriptions`），与进度同机制，跨端一致。
const subscribedRef = ref(false)
const canTrack = computed(() => typeof bankId === 'number' || subscribedRef.value)
if (typeof bankId === 'string') {
  api.listSubscriptions().then(list => { subscribedRef.value = list.indexOf(bankId) >= 0 }).catch(() => { /* 读失败按未订阅处理 */ })
}

// 2026-09-28：订阅库练习页的「同步」按钮（多端切换用）——只对「已订阅的公共库」显示。
// 跑双向（syncAll：先推后拉），完成后用顶部横幅显示明细（复用 restored-banner 样式）。
const syncingCloud = ref(false)
const syncBanner = ref('')
const canSyncHere = computed(() => typeof bankId === 'string' && subscribedRef.value)
async function doPageSync () {
  if (syncingCloud.value) return
  syncingCloud.value = true
  try {
    const mod = await import('../lib/cloud')
    const res = await mod.syncAll()
    const st = mod.getCloudStatus()
    if (!st.authed) { syncBanner.value = '尚未配置云同步（请到设置页配置后重试）'; return }
    if (st.error) { toastError('同步未完成：' + st.error); return }
    syncBanner.value = `✓ 同步完成 · ⬆ ${formatSyncDetail(res.pushDetail)} · ⬇ ${formatSyncDetail(res.pullDetail)}`
    setTimeout(() => { if (syncBanner.value) syncBanner.value = '' }, 8000)
  } catch (e) {
    toastError('同步失败：' + (e instanceof Error ? e.message : String(e)))
  } finally {
    syncingCloud.value = false
  }
}

// 2026-09-27：订阅库不在 bankStore（那是本地库列表）⇒ 名字优先取路由 query 里的 name（公共库入口会带上）。
const bankName = computed(() => String(route.query.name || '') || bankStore.banks.find(b => b.id === bankId)?.name || '')
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
// 「重新开始」标记（随进度落盘，同步守卫读它；云端版本一旦覆盖本机，标记自然消失）
const resetMarked = ref<string | null>(null)

// 2026-10-05：进度历史（回滚）。listProgressHistory 读本机/云端并集，
// 由保存链与同步拉取两侧共同维护（见 cloud.ts 的 recordProgressHistory / PRACTICE_HISTORY_KEY）。
// ⚠️ bankRef 必须从 progressKey 推导（= 云端 cloud_id 优先的那套标尺）：
//   直接用页面参数 bankId 会在本地库上写出 `practice_progress_1` 这种本机号，
//   而练习页读的是 cloud_id 键 ⇒ 回滚看似成功、实则写到了没人读的键上（正是本页历史上踩过的坑）。
const historyBankRef = computed(() => String(progressKey.value).replace(/^practice_progress_/, ''))
const showHistory = ref(false)
const historyList = ref<any[]>([])
const rollingBack = ref(false)
async function refreshHistory () {
  try { historyList.value = await listProgressHistory(historyBankRef.value) } catch { historyList.value = [] }
}
function fmtHistTime (iso: string): string {
  const t = Date.parse(String(iso || ''))
  if (!Number.isFinite(t)) return String(iso || '')
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
async function onRollback (h: any) {
  if (rollingBack.value) return
  const okToGo = window.confirm(`恢复到 ${fmtHistTime(h.saved_at)} 的版本（已答 ${h.answered} 题）？\n\n当前进度会被这一版替换。`)
  if (!okToGo) return
  rollingBack.value = true
  try {
    const done = await rollbackProgress(historyBankRef.value, h.saved_at)
    if (!done) { toastError('恢复失败：该版本已不在历史里'); return }
    showHistory.value = false
    toastSuccess('已恢复该版本进度')
    await restoreProgress()      // 就地重载，用户立刻看到题号回退
    await refreshHistory()
  } catch (e: any) {
    toastError('恢复失败：' + String((e && e.message) || e))
  } finally {
    rollingBack.value = false
  }
}

// 搜索相关
const searchQuery = ref('')
const searchResults = ref<Question[] | null>(null)

// 快捷键帮助浮窗
const showHelp = ref(false)

// 题目类型筛选：typeFilter 存储**被排除**的题型（默认全选=空数组）
const typeFilter = ref<string[]>([])
// 2026-10-02：TYPE_LABELS 升到 lib/exam.ts（题号栏分组三处共用一份），这里直接 import
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
// 2026-10-02：题号栏按题型分段（组序=首次出现序；first=组内第一题的展示下标，供组头跳转）
const navGroups = computed(() => groupQuestionsByCategory(displayQuestions.value))

// 2026-08-16：单题库「模拟考试」已取消（功能与「创建考试」重叠，且存在切模式计时器泄漏等缺陷）

// 2026-09-27 统一「进度标尺」——此前是本轮同步不通的根因：
//   · 订阅库：bankId 已是 bankRef（云端 quiz_banks._id）⇒ 直接用 ✓
//   · 本地库：原用**本机自增 id**（`practice_progress_1`）⇒ 换设备/换浏览器后这个 id 毫无意义，
//     而另一台设备对同一个题库用的是**云端 id**（`practice_progress_lquiz_banks_14`）⇒ **两端标尺不同 ⇒ 进度永远对不上**。
//   现在：本地库**优先用它已上云的 `cloud_id`（= 云端 _id，与其它设备一致）**；
//   仅当该库从未上云（无 cloud_id）时才退回本地 id（此时本就无法跨端，属合理降级）。
const progressKey = computed(() => {
  if (typeof bankId === 'string') return `practice_progress_${bankId}`
  const bank: any = bankStore.banks.find((b: any) => b.id === bankId)
  const ref = bank && bank.cloud_id ? String(bank.cloud_id) : String(bankId)
  return `practice_progress_${ref}`
})
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
      await refreshHistory()   // 2026-10-05：同时载入历史版本（按钮仅在非空时出现）
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
  const saved = await api.getSetting(progressKey.value)
  if (!saved) return
  let progress: SavedProgress
  try {
    progress = JSON.parse(saved)
  } catch {
    return
  }
  if (!progress || typeof progress.current_id !== 'number') return
  if (!questions.value.length) return

  // 沿用落盘的「重新开始」标记（云端版本覆盖本机后此处自然读不到）
  resetMarked.value = progress._reset ? String(progress._reset) : null

  restoring.value = true
  // 2026-10-04：复位挪进 finally —— 恢复途中任何一次抛错都会让 restoring 永久停在 true，
  // 那会连锁静默关掉「保存 → 推送 → 存档守望」整条链（页面毫无异样、照常答题）。
  try {
    // 恢复练习模式
    if (progress.mode === 'order' || progress.mode === 'random') {
      mode.value = progress.mode
    }

    // 构建 题目id → 当前索引 的映射（题目列表可能已变化）
    // 2026-09-28：同时建「来源题号(q.src_local_id) → 索引」索引 —— 未完成换算的跨设备进度
    // （内容里还是源设备题号）也能直接恢复；两种题号都命中不了才算这份进度无效。
    const idToIndex = new Map(questions.value.map((q, i) => [q.id, i]))
    const srcToIndex = new Map<number, number>()
    questions.value.forEach((q: any, i) => {
      const s = Number(q && q.src_local_id)
      if (Number.isFinite(s) && s > 0) srcToIndex.set(s, i)
    })
    const idxOf = (id: number): number | undefined => idToIndex.get(id) ?? srcToIndex.get(id)

    // 恢复题目顺序
    if (progress.order_ids && progress.order_ids.length === questions.value.length) {
      const restoredOrder: number[] = []
      let valid = true
      for (const id of progress.order_ids) {
        const idx = idxOf(id)
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
    const currentOrderIdx = order.value.findIndex(i => {
      const q: any = questions.value[i]
      if (!q) return false
      return q.id === progress.current_id || Number(q.src_local_id) === progress.current_id
    })
    current.value = currentOrderIdx >= 0 ? currentOrderIdx : 0

    // 恢复各题答题状态
    if (progress.answer_states) {
      const map = new Map<number, QuestionState>()
      for (const [idStr, state] of Object.entries(progress.answer_states)) {
        const id = Number(idStr)
        const idx = idxOf(id)
        if (idx !== undefined) {
          // 统一按「本机题号」落 map（消费方按 currentQuestion.id 读）
          const localId = Number((questions.value[idx] as any)?.id)
          if (Number.isFinite(localId)) map.set(localId, state as QuestionState)
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
  } finally {
    restoring.value = false
  }
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
// 2026-10-03：存档守望（防「静默停写」）——实况：某场会话的进度在某一笔之后**一笔没再写**、页面毫无异样
//（错题/已掌握线却正常），用户对着旧进度干瞪眼。口径：有改动置 dirty、落盘成功清 dirty；
// 守望每 45s 与「切回前台」时体检：仍脏且无在途定时器 ⇒ 立即补存；写入/落盘校验失败 ⇒ 页面出横幅可重试。
const dirtySince = ref(0)
const saveWarn = ref('')
let lastSaveTry = 0
let saveWatchTimer: ReturnType<typeof setInterval> | null = null
function scheduleSave() {
  if (restoring.value) return
  if (!loaded.value) return
  // 2026-08-22：计划模式不写入普通练习进度（队列来自计划，避免下次普通练习被计划队列污染）
  if (isPlanMode) return
  dirtySince.value = dirtySince.value || Date.now()
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveProgress, 500)
}
function checkSaveHealth() {
  if (!dirtySince.value) return
  if (restoring.value || !loaded.value || isPlanMode) return
  if (saveTimer) return
  if (Date.now() - lastSaveTry < 8000) return
  console.warn('[practice] 存档守望补存：进度已挂 ' + Math.round((Date.now() - dirtySince.value) / 1000) + 's 未落盘')
  void saveProgress()
}
function onVisibilityChange() {
  // 切后台/可能被冻结或回收前，先硬存一笔；切回前台立即体检
  if (document.visibilityState === 'hidden') { if (dirtySince.value) void saveProgress() }
  else checkSaveHealth()
}
function retrySave() { void saveProgress() }

// 2026-10-03：顶栏同步状态（断网/失败可见、可点重试）——只读云同步模块的内存状态，每 3s 刷一次
const syncStat = ref(getWebSyncStatus())
let syncStatTimer: number | null = null
const syncChipText = computed(() => {
  const s = syncStat.value
  if (s.state === 'syncing') return '同步中…'
  if (s.state === 'fail') return '同步失败·点重试'
  if (s.state === 'ok') {
    const d = new Date(Number(s.at) || Date.now())
    const p2 = (n: number) => String(n).padStart(2, '0')
    return `已同步 ${p2(d.getHours())}:${p2(d.getMinutes())}`
  }
  return '未同步'
})
function refreshSyncStat () { syncStat.value = getWebSyncStatus() }
async function onSyncChipTap () {
  if (syncStat.value.state === 'syncing') return
  refreshSyncStat()
  await retryProgressSync()
  refreshSyncStat()
}

onMounted(() => {
  saveWatchTimer = setInterval(checkSaveHealth, 45000)
  document.addEventListener('visibilitychange', onVisibilityChange)
  refreshSyncStat()
  syncStatTimer = window.setInterval(refreshSyncStat, 3000)
})
onBeforeUnmount(() => {
  if (saveWatchTimer) clearInterval(saveWatchTimer)
  saveWatchTimer = null
  document.removeEventListener('visibilitychange', onVisibilityChange)
  if (syncStatTimer) { window.clearInterval(syncStatTimer); syncStatTimer = null }
})

async function saveProgress() {
  if (!questions.value.length || !order.value.length) return
  // 防重入：守望/切后台的补存可能与防抖保存并发——两次写、后一次赢，先写的那次「落盘校验」会误报失败
  if (saveInFlight) return
  saveInFlight = true
  try {
    await saveProgressInner()
  } finally {
    saveInFlight = false
  }
}
let saveInFlight = false

async function saveProgressInner() {
  const cur = order.value[current.value]
  if (cur === undefined) return
  const progress: SavedProgress = {
    mode: mode.value,
    order_ids: order.value
      .map(i => questions.value[i]?.id)
      .filter((id): id is number => id !== undefined),
    current_id: questions.value[cur].id,
    answer_states: Object.fromEntries(answerStates.value.entries()),
    // 2026-10-03（rabbit 口径）：练到末尾**不再清零**——「做完了」要留下可同步的完成记录。
    // 旧行为（完成即写空串、"下次从头"）会在完成的一瞬把整库进度抹掉，跨端永远等不到"完成"
    //（沙盒实况：完成后落盘 84755 → 0 字节，守卫 tests/practice-save-boundary.mjs 钉住此行为）。
    finished: finished.value,
    saved_at: new Date().toISOString(),
  }
  // 保留「重新开始」标记：本机是故意的空，同步守卫不得用云端旧进度把它顶回来
  if (resetMarked.value) progress._reset = resetMarked.value
  lastSaveTry = Date.now()
  const body = JSON.stringify(progress)
  try {
    if (canTrack.value) {
      await api.setSetting(progressKey.value, body)
      // 落盘校验（2026-10-03）：写成功再读回比对 saved_at——"写丢了还当成功"是静默停写最隐蔽的形态
      const back = await api.getSetting(progressKey.value)
      let landed = false
      try { const p = JSON.parse(back || 'null'); landed = !!(p && p.saved_at === progress.saved_at) } catch { landed = false }
      if (!landed) throw new Error('落盘校验不过（读回与本次不符）')
      // 同步更新全局最近练习记录（首页"继续刷题"卡片使用）
      const lastPractice = {
        bank_id: bankId,
        bank_name: bankName.value,
        position: current.value + 1,
        total: questions.value.length,
        saved_at: progress.saved_at,
      }
      await api.setSetting(LAST_PRACTICE_KEY, JSON.stringify(lastPractice))
    } else {
      // 未订阅的公共库：进度直写 idb，且**不改首页"继续刷题"指向**
      // 2026-10-04 更正：原注释写「不触发云推送」，与代码不符——下面那句轻推是共用的，而进度包是
      // **整包上传**（collectPracticeProgressRow 收所有 practice_progress_* 键），所以这个库的进度
      // 也会随下一次轻推上云。行为照旧，只把话说准（要不要改成"真的不推"是产品口径，另议）。
      await idb.setSetting(progressKey.value, body)
    }
    dirtySince.value = 0
    saveWarn.value = ''
    // 2026-10-03：落盘成功后防抖轻推（只推进度/当天统计/续练指针三条设置行；可在设置里关）
    void import('../lib/cloud').then(m => m.scheduleProgressPush()).catch(() => {})
  } catch (e) {
    console.error('保存进度失败：', e)
    saveWarn.value = '⚠️ 进度可能没存上（' + String((e && e.message) || e) + '）——点此立即重试'
  }
}

// 切换当前题目收藏状态
async function onToggleFavorite() {
  const q = currentQuestion.value
  if (!q) return
  // 未订阅的公共库：不记收藏（只练不留痕，防污染）
  if (!canTrack.value) { toastInfo('未订阅的题库不记录收藏与错题'); return }
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
  // 未订阅的公共库：不记练习记录/错题/已掌握/每日统计（只练不留痕，防污染）
  if (!canTrack.value) return
  try {
    const res = await api.recordPractice({ bank_id: bankId, question_id: q.id, user_answer: payload.answer, is_correct: payload.correct, duration_ms: payload.duration_ms })
    // 2026-08-19：连续答对达到阈值 → 自动移入「已掌握」
    if (res?.autoMastered) toastSuccess(`🎉 连续答对 ${res.streak} 次，该题已自动移入「已掌握」`)
    // 累计每日统计（用于热力图）；2026-10-03 起同时累加本题用时
    await bumpDailyRecord(payload.correct, payload.duration_ms)
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
function bumpDailyRecord(correct: boolean, durationMs: number | null = null): Promise<void> {
  // 串行化：将每次调用接到 chain 末尾，保证不并发
  const run = async () => {
    try {
      const raw = await api.getSetting('daily_records')
      const records: { date: string; total: number; correct: number; duration?: number }[] = raw ? JSON.parse(raw) : []
      const d = new Date()
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      // 2026-10-03：累加本题用时（秒）。duration 是**可选字段**——历史行没有它，
      // 读取侧一律按 0 兜底；只在有值时累加，避免把 null 写进去污染类型。
      const addSecs = msToSecs(durationMs)
      const idx = records.findIndex(r => r.date === today)
      if (idx >= 0) {
        records[idx].total++
        if (correct) records[idx].correct++
        if (addSecs > 0) records[idx].duration = (Number(records[idx].duration) || 0) + addSecs
      } else {
        records.push({ date: today, total: 1, correct: correct ? 1 : 0, ...(addSecs > 0 ? { duration: addSecs } : {}) })
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
  // 打标：这是**故意的**重置，同步时不把它当成「异常空进度」用云端旧值顶回来
  resetMarked.value = new Date().toISOString()
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
.sync-btn { height: 28px; padding: 0 10px; border-radius: 14px; border: 1px solid var(--color-border); background: var(--color-card); cursor: pointer; font-size: 12px; font-weight: 600; color: var(--color-text-secondary); white-space: nowrap; }
.sync-btn:hover:not(:disabled) { background: var(--color-primary-light); color: var(--color-primary); border-color: var(--color-primary); }
.sync-btn:disabled { opacity: 0.6; cursor: default; }
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

/* 2026-10-03：存档守望横幅 + 计划模式提示 */
.save-warn { margin: 8px 0; padding: 9px 12px; border-radius: var(--radius-md); background: var(--color-danger-bg); color: var(--color-danger-deep); font-size: 13px; cursor: pointer; }
.plan-hint { margin: 8px 0; padding: 8px 12px; border-radius: var(--radius-md); background: var(--color-warning-bg); color: var(--color-warning-text); font-size: 12.5px; }

/* 题目导航条 */
.question-nav { margin-top: 18px; padding: 14px 16px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-md); }
.nav-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.nav-title { font-size: 13px; font-weight: 600; color: var(--color-text); }
.nav-stats { display: flex; gap: 10px; font-size: 12px; }
.dot-stat { padding: 1px 8px; border-radius: 10px; }
.dot-stat.correct { background: var(--color-success-bg); color: var(--color-success-deep); }
.dot-stat.wrong { background: var(--color-danger-bg); color: var(--color-danger-deep); }
.dot-stat.unanswered { background: var(--color-border-light); color: var(--color-text-secondary); }
/* 2026-10-02：题号栏按题型分段——滚动容器从 .nav-dots 换成 .nav-groups（外层），每组自带标题行 */
.nav-groups { max-height: 180px; overflow-y: auto; padding: 2px; }
.nav-group { margin-bottom: 6px; }
.nav-group:last-child { margin-bottom: 0; }
.nav-group-title { font-size: 12px; color: var(--color-text-secondary); background: none; border: none; padding: 2px 4px; margin: 2px 0 4px; cursor: pointer; }
.nav-group-title:hover { color: var(--color-primary); }
.nav-dots { display: flex; flex-wrap: wrap; gap: 4px; }
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
/* 2026-10-03：同步状态小片（顶栏第二排） */
.sync-chip { padding: 4px 10px; border-radius: 999px; font-size: 12px; color: var(--color-text-secondary); }
.sync-chip.ok { opacity: 0.75; }
.sync-chip.fail { color: var(--color-danger-deep); font-weight: 600; cursor: pointer; }
.restart-btn:hover { background: var(--color-border-light); }

/* 2026-10-05：进度历史入口与面板（回滚）。样式沿用既有 token，无硬编码色值。 */
.history-btn { color: var(--color-primary); border-color: var(--color-primary); }
.hist-mask { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45); display: flex; align-items: center; justify-content: center; z-index: 3000; padding: 20px; }
.hist-panel { background: var(--color-card); border-radius: var(--radius-lg, 12px); padding: 18px 20px; width: 100%; max-width: 480px; max-height: 80vh; overflow-y: auto; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2); }
.hist-head { display: flex; justify-content: space-between; align-items: center; font-size: 15px; font-weight: 600; color: var(--color-text); margin-bottom: 8px; }
.hist-head .close-btn { background: none; border: none; font-size: 20px; cursor: pointer; color: var(--color-text-secondary); padding: 0 4px; line-height: 1; }
.hist-tip { font-size: 12px; color: var(--color-text-secondary); line-height: 1.6; margin: 0 0 14px; }
.hist-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--color-border-light); }
.hist-time { font-size: 14px; color: var(--color-text); }
.hist-meta { font-size: 12px; color: var(--color-text-secondary); margin-top: 2px; }
.hist-btn2 { padding: 5px 12px; border: 1px solid var(--color-primary); border-radius: var(--radius-md); background: var(--color-card); color: var(--color-primary); cursor: pointer; font-size: 12px; white-space: nowrap; }
.hist-btn2:hover:not(:disabled) { background: var(--color-primary-light); }
.hist-btn2:disabled { opacity: 0.5; cursor: not-allowed; }
.hist-empty { font-size: 13px; color: var(--color-text-secondary); padding: 12px 0; }

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
