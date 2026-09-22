<template>
  <div class="home">
    <div class="header">
      <div>
        <h2>我的题库</h2>
        <div class="header-sub">
          共 <b>{{ bankStore.banks.length }}</b> 个题库 ·
          <b>{{ totalQuestions }}</b> 道题 ·
          已掌握 <b>{{ totalMastered }}</b> 道
        </div>
      </div>
      <div class="header-btns">
        <button class="exam-btn" @click="$router.push('/exams')"><img class="btn-icon" src="/icons/exam.gif" alt="考试" /> 考试</button>
        <button class="mix-exam-btn" @click="$router.push('/mix-exam')"><img class="btn-icon" src="/icons/mix.gif" alt="综合抽题" /> 综合抽题</button>
        <a class="calc-btn" href="/calc/" target="_blank" rel="noopener">🧮 计算器</a>
        <button class="new-bank-btn" @click="showNew = true">+ 新建题库</button>
      </div>
    </div>

    <!-- 云朵彩蛋欢迎条（触发过彩蛋后显示） -->
    <div v-if="cloudEgg" class="cloud-welcome-bar">☁️ 小兔错题本 已经准备就绪，旅行者请开始今天的练习 ⭐</div>

    <!-- 访问统计 -->
    <div v-if="visitStats" class="visit-bar">
      👁 累计访问 <b>{{ visitStats.total }}</b> 次 · 今日 <b>{{ visitStats.today }}</b> 次
    </div>

    <!-- 每日一诗 -->
    <div v-if="dailyPoem" class="poem-card">
      <div class="poem-head">📜 每日一诗 · {{ todayText }}</div>
      <div class="poem-content">{{ dailyPoem.content }}</div>
      <div class="poem-meta">—— {{ dailyPoem.dynasty }}·{{ dailyPoem.author }}《{{ dailyPoem.title }}》</div>
    </div>

    <!-- 每日学习卡片（学习类 App 常见激励） -->
    <div v-if="todayStats.total > 0" class="daily-card">
      <div class="daily-left">
        <img class="daily-icon" src="/icons/flame.gif" alt="🔥" />
        <div>
          <div class="daily-title">今天已刷 <b>{{ todayStats.total }}</b> 题</div>
          <div class="daily-sub">正确率 {{ todayStats.accuracy }}% · 连续刷题 <b>{{ streakDays }}</b> 天</div>
        </div>
      </div>
      <div class="daily-progress">
        <div class="daily-progress-bar">
          <div class="daily-progress-fill" :style="{ width: todayStats.accuracy + '%' }"></div>
        </div>
        <div class="daily-progress-label">今日正确率</div>
      </div>
    </div>

    <!-- 学习计划入口 -->
    <div v-if="studyPlan" class="study-plan-card" @click="$router.push('/study-plan')">
      <div class="sp-left">
        <img class="sp-icon" src="/icons/plan.gif" alt="📋" />
        <div>
          <div class="sp-title">{{ studyPlan.name }}</div>
          <div class="sp-sub">今日目标：{{ studyPlan.dailyGoal }}题 · 已完成 {{ todayCompleted }}题</div>
        </div>
      </div>
      <div class="sp-progress">
        <div class="sp-progress-bar">
          <div class="sp-progress-fill" :style="{ width: todayProgress + '%' }"></div>
        </div>
        <div class="sp-progress-text">{{ todayProgress }}%</div>
      </div>
      <div class="sp-arrow">›</div>
    </div>

    <!-- 记忆复习入口（2026-08-23 新增） -->
    <div v-if="memoryDueCount >= 0" class="memory-entry-card" @click="$router.push('/memory-review')">
      <div class="me-left">
        <img src="/icons/study.gif" class="me-icon-img" alt="记忆复习" />
        <div>
          <div class="me-title">记忆复习</div>
          <div class="me-sub" v-if="memoryDueCount > 0">今日建议复习 <b>{{ memoryDueCount }}</b> 题<template v-if="memoryDeferredCount > 0"> · <span class="me-fast">{{ memoryDeferredCount }} 题顺延</span></template> · 健康度 {{ memoryHealth }}%</div>
          <div class="me-sub" v-else>今日无待复习，去刷题积累记忆</div>
          <div v-if="memoryDaysToExam !== null" class="me-exam">⏰ 距最近考试 <b>{{ memoryDaysToExam }}</b> 天，{{ memoryPhaseLabel }}节奏</div>
        </div>
      </div>
      <div class="me-right">
        <div v-if="memoryHealth > 0" class="me-health-wrap"><div class="me-health-fill" :style="{ width: memoryHealth + '%' }"></div></div>
        <div class="me-arrow">›</div>
      </div>
    </div>

    <div v-if="lastPractice" class="resume-card" @click="resumePractice">
      <div class="resume-info">
        <div class="resume-label">继续刷题</div>
        <div class="resume-title">{{ lastPractice.bank_name }}</div>
        <div class="resume-meta">第 {{ lastPractice.position }} / {{ lastPractice.total }} 题 · {{ formatTime(lastPractice.saved_at) }}</div>
      </div>
      <div class="resume-arrow">›</div>
    </div>

    <!-- 公共考试入口（新用户开箱即用） -->
    <div v-if="publicExams.length" class="public-exam-banner" @click="$router.push('/exams')">
      <div class="pe-left">
        <img class="pe-icon" src="/icons/exam.gif" alt="📝" />
        <div>
          <div class="pe-title">公共考试</div>
          <div class="pe-sub">{{ publicExams.length }} 场考试，点此直接开考</div>
        </div>
      </div>
      <div class="pe-arrow">›</div>
    </div>

    <!-- 公共题库区块（云端直读，无需同步/导入） -->
    <div v-if="publicBanks.length" class="public-section">
      <div class="section-header">
        <h3>🌍 公共题库</h3>
        <span class="section-sub">云端官方题库 · 此处仅供展示，练习数据不保存，点「添加到我的题库」导入本地后享进度/收藏/错题</span>
      </div>
      <div class="grid public-grid">
        <div v-for="b in publicBanks" :key="b._id" class="card public-card">
          <div class="card-header">
            <h3>
              {{ b.name }}
              <span class="vis-badge public">🌍</span>
            </h3>
          </div>
          <div class="card-meta">
            <span v-if="b.creator_name" class="creator-pill">👤 {{ b.creator_name }}</span>
            <span class="count-pill">📝 {{ b.question_count || 0 }} 题</span>
          </div>
          <div class="actions">
            <button class="primary-btn" @click="$router.push(`/public-practice/${b._id}/${encodeURIComponent(b.name)}`)">开始刷题</button>
            <div v-if="isImported(b.name)" class="imported-tag">✓ 已添加到我的题库</div>
            <button v-else class="import-btn" :disabled="importingId === b._id" @click="importPublicBank(b)">
              <span v-if="importingId === b._id">导入中… {{ importProgress?.done }}/{{ importProgress?.total }}</span>
              <span v-else>＋ 添加到我的题库</span>
            </button>
            <div v-if="importingId === b._id && importProgress && importProgress.total" class="import-progress">
              <div class="import-bar"><div class="import-fill" :style="{ width: (importProgress.done / importProgress.total * 100) + '%' }"></div></div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="bankStore.loading" class="skeleton-grid">
      <div v-for="i in 3" :key="i" class="skeleton-card"></div>
    </div>
    <div v-else-if="bankStore.banks.length === 0" class="empty">
      <img class="empty-icon" src="/icons/study.gif" alt="📚" />
      <p class="empty-title">还没有题库</p>
      <p class="empty-tip">点击右上角"新建题库"开始你的刷题之旅</p>
      <button class="empty-action" @click="showNew = true">+ 新建第一个题库</button>
    </div>
    <div v-else class="grid">
      <div v-for="b in bankStore.banks" :key="b.id" class="card" :class="{ 'has-progress': statsFor(b.id)?.practiced, 'open': openMenuId === b.id }">
        <div class="card-header">
          <h3>
            {{ b.name }}
            <span class="vis-badge" :class="b.visibility === 'private' ? 'private' : (b.visibility === 'pending' ? 'pending' : 'public')">
              {{ b.visibility === 'private' ? '🔒' : (b.visibility === 'pending' ? '⏳' : '🌍') }}
            </span>
          </h3>
          <button class="more-btn" @click.stop="toggleMenu(b.id)">⋯</button>
        </div>
        <div class="card-meta">
          <span v-if="b.creator_name" class="creator-pill">👤 {{ b.creator_name }}</span>
          <span class="count-pill">📝 {{ b.question_count }} 题</span>
          <span v-if="statsFor(b.id)" class="accuracy-pill" :class="accuracyClass(statsFor(b.id)!.accuracy)">
            ✓ {{ statsFor(b.id)!.accuracy }}%
          </span>
        </div>

        <!-- 进度条 -->
        <div v-if="statsFor(b.id)?.practiced" class="progress-row">
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: progressPct(b.id) + '%' }"></div>
          </div>
          <div class="progress-text">{{ statsFor(b.id)!.practiced }} / {{ b.question_count }}</div>
        </div>

        <div class="actions">
          <button class="primary-btn" @click="$router.push(`/practice/${b.id}`)">开始刷题</button>
        </div>

        <div v-if="openMenuId === b.id" class="dropdown-menu" @click.stop>
          <button @click="$router.push(`/wrong/${b.id}`)">📕 错题本</button>
          <button @click="$router.push(`/favorites/${b.id}`)">⭐ 收藏夹</button>
          <button @click="$router.push(`/import/${b.id}`)">📥 导入题目</button>
          <button v-if="b.visibility !== 'public' && b.visibility !== 'pending'" @click="submitForReview(b)">
            🌍 提交到公共题库（待审核）
          </button>
          <button v-else-if="b.visibility === 'pending'" disabled>⏳ 已提交，待管理员审核</button>
          <button @click="exportBank(b)">📤 导出题库</button>
          <button class="danger" @click="del(b.id)">🗑 删除题库</button>
        </div>
      </div>
    </div>

    <!-- 免责声明（2026-09-07） -->
    <p class="site-disclaimer">本站为个人自用的非经营性学习工具，题库内容仅供个人学习交流参考；本站不向公众提供生成式人工智能服务（AI 功能需自行配置个人密钥）。</p>

    <!-- 备案标识：桌面在侧栏（App.vue），小屏侧栏是抽屉、不点开看不见，故在首页底部补一份 -->
    <div v-if="icpNumber || gaNumber" class="site-beian">
      <a v-if="icpNumber" class="beian-link" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">{{ icpNumber }}</a>
      <a v-if="gaNumber" class="beian-link" :href="gaLink" target="_blank" rel="noreferrer"><img src="/beian-icon.png" class="beian-icon" width="18" height="20" alt="公安备案" />{{ gaNumber }}</a>
    </div>

    <div v-if="showNew" class="modal" @click.self="showNew = false">
      <div class="modal-body">
        <h3>新建题库</h3>
        <input v-model="newName" placeholder="题库名称" @keyup.enter="create" />
        <input v-model="newCreator" placeholder="创建人（可选，显示在卡片上）" />
        <textarea v-model="newDesc" placeholder="描述（可选）"></textarea>
        <div class="vis-options">
          <label class="vis-option active">
            <span>🔒</span>
            <div>
              <div class="vis-name">自建题库（私人）</div>
              <div class="vis-desc">仅自己可见，默认私人。完成导入后可点题库卡片「提交到公共题库」申请公开（需管理员审核）</div>
            </div>
          </label>
        </div>
        <div class="modal-actions">
          <button @click="create">确定</button>
          <button @click="showNew = false">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useBankStore } from '../stores/bank'
import { api, toLocalDateStr, addDays } from '../utils/api'
import { listPublicBanks, listExams, listPublicBankQuestions, classifyQuestionType, judgeAnswerBool, type Exam } from '../lib/exam'
import { toastSuccess, toastError } from '../utils/toast'
import { recordVisit, getVisitStats } from '../lib/visit'
import { poemOfTheDay, todayLabel, type Poem } from '../lib/poems'
import { idb, normalizeTs } from '../lib/db'
import { formatDate } from '../lib/spaced-repetition'

interface LastPractice {
  bank_id: number
  bank_name: string
  position: number
  total: number
  saved_at: string
}
interface Stats { total: number; practiced: number; correct: number; mastered: number; accuracy: number }
interface TodayStats { total: number; correct: number; accuracy: number }
interface DailyRecord { date: string; total: number; correct: number }

const router = useRouter()
const bankStore = useBankStore()
const showNew = ref(false)

// 备案标识：与 App.vue 侧栏那份同源（都只读 .env 注入值），改口径时两处一起改
const icpNumber = (import.meta.env.VITE_ICP_NUMBER as string) || ''
const gaNumber = (import.meta.env.VITE_GA_BEIAN_NUMBER as string) || ''
const gaLink = gaNumber
  ? `https://beian.mps.gov.cn/#/query/webSearch?code=${gaNumber.replace(/\D/g, "")}`
  : ''

// 云朵彩蛋欢迎条（在设置页连点云朵主题触发过彩蛋后，首页常显欢迎语）
const cloudEgg = (() => {
  try { return localStorage.getItem('cloud_egg_triggered') === '1' } catch { return false }
})()
const newName = ref('')
const newDesc = ref('')
const newCreator = ref('')
const newVisibility = ref<'public' | 'private' | 'pending'>('private')
const lastPractice = ref<LastPractice | null>(null)
const openMenuId = ref<number | null>(null)
const bankStatsMap = ref<Map<number, Stats>>(new Map())
const todayStats = ref<TodayStats>({ total: 0, correct: 0, accuracy: 0 })
const streakDays = ref(0)
const publicBanks = ref<any[]>([])
const publicExams = ref<Exam[]>([])
const importingId = ref<string | null>(null)
const importProgress = ref<{ done: number; total: number } | null>(null)
const visitStats = ref<{ total: number; today: number } | null>(null)
const dailyPoem = ref<Poem | null>(null)
const todayText = ref('')
const studyPlan = ref<any>(null)
const todayCompleted = ref(0)
const todayProgress = ref(0)
// 2026-08-23：记忆复习入口数据（今日待复习数 + 记忆健康度）；初始 -1 表示未加载
const memoryDueCount = ref(-1)
const memoryHealth = ref(0)
// 2026-08-23 防堆积：超出每日配额、顺延到后天的到期题数
const memoryDeferredCount = ref(0)
// 2026-08-23：备考驱动——距最近考试天数（null=未设考试日期）
const memoryDaysToExam = ref<number | null>(null)
// 距考阶段标签（用于首页卡片提示）
const memoryPhaseLabel = computed(() => {
  const d = memoryDaysToExam.value
  if (d === null) return ''
  if (d <= 3) return '冲刺极限'
  if (d <= 8) return '冲刺加量'
  if (d <= 30) return '加量复习'
  return '常规'
})

const totalQuestions = computed(() => bankStore.banks.reduce((s, b) => s + b.question_count, 0))
// 已掌握 = 错题本里标记「已掌握」的真实数量（2026-08-15 修复：此前用已练习数近似）
const totalMastered = computed(() => {
  let m = 0
  for (const s of bankStatsMap.value.values()) m += s.mastered || 0
  return m
})

function toggleMenu(id: number) {
  openMenuId.value = openMenuId.value === id ? null : id
}
function closeMenu() { openMenuId.value = null }

function statsFor(id: number): Stats | undefined {
  return bankStatsMap.value.get(id)
}

// 是否已导入到本地（按题库名匹配；公共题库与本地题库同名即视为已导入）
function isImported(name: string): boolean {
  return bankStore.banks.some(x => x.name === name)
}

function progressPct(id: number): number {
  const b = bankStore.banks.find(x => x.id === id)
  const s = bankStatsMap.value.get(id)
  if (!b || !s || b.question_count === 0) return 0
  return Math.min(100, Math.round((s.practiced / b.question_count) * 100))
}

function accuracyClass(accuracy: number): string {
  if (accuracy >= 80) return 'high'
  if (accuracy >= 60) return 'mid'
  return 'low'
}

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 2026-08-21 修复：此前在 onMounted 里注册匿名函数、onBeforeUnmount 里移除 closeMenu，
// removeEventListener 永远匹配不上 → 每次进出首页泄漏监听器。提升到 setup 顶层，注册/移除用同一函数。
// 手机端 click 事件可能不冒泡到 document（尤其微信内置浏览器），加 touchstart 兼容
// 2026-08-16 修复：touchstart 无差别 closeMenu 会在手机端吞掉菜单按钮的 click——
// touchstart 先冒泡关菜单 → v-if 卸载菜单 DOM → 按钮 click 不再触发 → 删除/导出/跳转全没反应。
// 现在点击目标在菜单 / ⋮ 按钮内部时不关闭。
const inMenu = (e: Event): boolean => {
  const t = e.target as HTMLElement | null
  return !!t && !!t.closest && !!t.closest('.dropdown-menu, .more-btn')
}
const onDocClick = (e: Event) => { if (!inMenu(e)) closeMenu() }

// 加载学习计划
async function loadStudyPlan() {
  try {
    const plans = await idb.listPlans()
    if (plans.length > 0) {
      studyPlan.value = plans[0]
      // 计算今日完成情况
      const today = formatDate(new Date())
      const stored = localStorage.getItem(`completed_${studyPlan.value.id}_${today}`)
      const completed = stored ? JSON.parse(stored) : []
      todayCompleted.value = completed.length
      // 2026-08-22 修复：进度分母用「今日任务总数」（StudyPlanView 落盘 task_total_*），
      // 此前用 dailyGoal 导致任务 10 题/目标 50 题时进度只显示 20%，与计划页口径不一致
      const taskTotalRaw = localStorage.getItem(`task_total_${studyPlan.value.id}_${today}`)
      const taskTotal = taskTotalRaw ? parseInt(taskTotalRaw, 10) : 0
      const denominator = taskTotal > 0 ? taskTotal : (studyPlan.value.dailyGoal || 1)
      todayProgress.value = Math.min(100, Math.round((completed.length / denominator) * 100))
    }
  } catch (e) {
    console.error('加载学习计划失败：', e)
  }
}

// 2026-08-23：加载记忆复习入口数据（今日待复习数 + 记忆健康度）
// 用全量题目 + 复习记录在本地计算，失败静默不影响首页
// 2026-08-23 防堆积：卡片显示「今日份（配额内）」而非全量到期；超过配额记为顺延数
async function loadMemoryReviewStats() {
  try {
    const { idb } = await import('../lib/db')
    const { getMemoryStrength, strengthLevel, calculateDailyReviewCap, calculateDaysToExam, toReviewTs } = await import('../lib/spaced-repetition')
    const allQ = await idb.listAll('questions')
    const allRev = await idb.listAll('review_records')
    // 每题取最新记录
    const revMap = new Map<number, any>()
    for (const r of allRev) {
      if (r.question_id == null) continue
      const ex = revMap.get(r.question_id)
      // T10b（2026-09-15）修复：原为 `String(r.last_review) > String(ex.last_review)` 的字符串比较。
      // last_review 是混合类型（网页端 ISO 串 / 小程序端纪元数字，restoreBackup 会让 ISO 行回流），
      // 字典序下 `"2026-…" > "1789…"` 恒成立 ⇒ 会把历史 ISO 记录无条件当成「最新」。
      // 统一走 normalizeTs 归一后比较（不统一存储类型）。
      if (!ex || normalizeTs(r.last_review) > normalizeTs(ex.last_review)) revMap.set(r.question_id, r)
    }
    // 每日复习配额（联动学习计划，至少 50 保底）+ 距考天数动态
    const plans = await idb.listPlans()
    const cap = calculateDailyReviewCap(plans)
    const examDates = plans.map(p => p.examDate).filter((d): d is string => !!d).sort()
    memoryDaysToExam.value = calculateDaysToExam(examDates[0] || null)
    // 今日到期数（全量）+ 健康度（有记录题目的平均权重分）
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999)
    let allDue = 0, score = 0, tracked = 0
    for (const q of allQ) {
      const r = revMap.get(q.id)
      if (!r) continue
      tracked++
      const strength = getMemoryStrength(r.ease_factor ?? 2.5, r.interval ?? 0)
      const lvl = strengthLevel(strength)
      if (lvl === '强') score += 1
      else if (lvl === '中') score += 0.6
      else score += 0.3
      // 2026-09-15 修复(P1-21)：next_review 现在是纪元毫秒数字，历史数据仍是 ISO 串，一律走 toReviewTs
      //（对历史 ISO 串产出与 new Date(v).getTime() 完全相同的数字，首页到期数不会漂移）。
      // 三个分支与修复前逐条对应，不合并；下面既有的 `!Number.isNaN(next)` 守卫继续负责跳过损坏值。
      const nextTs = r.next_review ? toReviewTs(r.next_review) : null
      const lastTs = r.last_review ? toReviewTs(r.last_review) : null
      const next = r.next_review
        ? (nextTs === null ? NaN : nextTs)
        : (r.last_review ? (lastTs === null ? NaN : lastTs) + (r.interval ?? 0) * 86400000 : 0)
      if (!Number.isNaN(next) && next <= todayEnd.getTime()) allDue++
    }
    // 今日份 = 全量到期但截断在配额内；超出记为顺延
    memoryDueCount.value = Math.min(allDue, cap)
    memoryDeferredCount.value = Math.max(0, allDue - cap)
    memoryHealth.value = tracked > 0 ? Math.round((score / tracked) * 100) : 0
  } catch (e) {
    console.error('加载记忆复习统计失败：', e)
  }
}

onMounted(async () => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('touchstart', onDocClick, { passive: true })
  // 并行加载：本地题库 + 云端公共数据 + 学习计划（公共部分失败不影响本地使用）
  await Promise.allSettled([
    loadPublicData(),
    loadStudyPlan(),
    loadMemoryReviewStats(),
    bankStore.load().then(async () => {
      // 加载每个题库统计
      // 2026-09-15 修复(P2-13)：新增 statsOk 集合——只有统计**确实成功**的库才可能被判空壳
      const statsOk = new Set<number>()
      await Promise.all(bankStore.banks.map(async b => {
        try {
          const s = await api.bankStats(b.id)
          bankStatsMap.value.set(b.id, { ...s, accuracy: s.practiced > 0 ? Math.min(100, Math.round((s.correct / s.practiced) * 100)) : 0 })
          statsOk.add(b.id)
        } catch { /* ignore */ }
      }))
      // 2026-08-23：清理「我的题库」里的空公共壳（cloud_shared=true 且 0 题）。
      // 这类题库是早期同步误拉进来的公共题库空壳（公共题目不进本地缓存），仅占位无内容，
      // 且公共题库现在是云端直读（listPublicBanks），本地无需保留。删除仅限本地，不影响云端公共数据。
      // 2026-09-15 修复(P2-13)：原实现把「统计失败」当「统计为 0」——bankStats 抛错时该库不在
      // map 里，`?? 0` 判空成立 ⇒ 一次统计读取失败就能让有数据的 cloud_shared 题库在每次访问
      // 首页时被无确认删除。破坏性决定不能由可能缺失的证据驱动：只删「统计确实成功且为 0」的库，
      // 且删除前再用 idb 直接数一次。
      // ⚠️ 两处措辞由复审 MF-3 更正（原先写错了，别照抄回去）：
      //   ① 不是「网络抖动」——`api.bankStats` 全链路只读本地 IndexedDB
      //      （`src/utils/api.ts:203` → `src/lib/db.ts:594` 的 listQuestions + practice_records 索引），
      //      不触网。能抛的是 IDB 自身的问题（事务错误、配额、库被关闭/版本升级中）。
      //   ② 复核**不是**「另一个更可信的数据源」：`total` 本来就等于 `listQuestions(bankId).length`
      //      （`db.ts:595` + `:616`），与被调的 listQuestions 同源。复核的实际价值只有两条——
      //      在**执行删除的那一刻**重新读一次（防 bankStatsMap 是本轮早先算的、期间题目被加回来了），
      //      以及绕开 `bankStatsMap` 这层缓存。复审据此指出：只有「统计与删除之间发生了写入」
      //      这一种情形能被它拦住，同源失真它拦不住。
      const emptyPublicShells = bankStore.banks.filter(b => b.cloud_shared && statsOk.has(b.id) && bankStatsMap.value.get(b.id)?.total === 0)
      for (const shell of emptyPublicShells) {
        try {
          const localCount = (await idb.listQuestions(shell.id)).length
          if (localCount > 0) {
            console.warn('[云同步] 跳过清理：本地仍有', localCount, '道题，统计口径可能失真：', shell.name)
            continue
          }
          await bankStore.remove(shell.id)
          console.info('[云同步] 已清理空公共题库壳：', shell.name)
        } catch (e) { console.warn('清理空公共题库壳失败：', shell.name, e) }
      }
    }),
  ])
  // 计算今日统计 & 连续天数
  try {
    const raw = await api.getSetting('daily_records')
    const records: DailyRecord[] = raw ? JSON.parse(raw) : []
    const today = todayISO()
    const todayRec = records.find(r => r.date === today)
    if (todayRec) {
      todayStats.value = {
        total: todayRec.total,
        correct: todayRec.correct,
        accuracy: todayRec.total > 0 ? Math.round((todayRec.correct / todayRec.total) * 100) : 0,
      }
    }
    // 连续天数：从今天往回数，每天都有记录
    let streak = 0
    const sorted = [...records].sort((a, b) => b.date.localeCompare(a.date))
    let cursor = toLocalDateStr(new Date())
    for (const r of sorted) {
      if (r.date === cursor && r.total > 0) {
        streak++
        cursor = addDays(cursor, -1)
      } else if (r.date < cursor) {
        break
      }
    }
    streakDays.value = streak
  } catch (e) { console.error('加载每日统计失败：', e) }
  // 加载最近练习记录
  try {
    const raw = await api.getSetting('last_practice')
    if (raw) {
      const parsed = JSON.parse(raw) as LastPractice
      if (parsed && typeof parsed.bank_id === 'number' && bankStore.banks.some(b => b.id === parsed.bank_id)) {
        lastPractice.value = parsed
      }
    }
  } catch (e) { console.error('加载最近练习记录失败：', e) }
  // 访问统计（累计/今日）；失败静默，不影响首页
  try {
    await recordVisit()
    const s = await getVisitStats()
    if (s) visitStats.value = s
  } catch { /* 统计失败不影响首页 */ }
  // 每日一诗（按日期确定性取一首，当天稳定）
  try { dailyPoem.value = poemOfTheDay(); todayText.value = todayLabel() } catch { /* 不影响首页 */ }
})

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch { return '' }
}

// 加载云端公共数据（公共题库 + 公共考试）；任何失败都静默，不影响首页
async function loadPublicData() {
  try {
    const [banks, exams] = await Promise.allSettled([listPublicBanks(), listExams()])
    if (banks.status === 'fulfilled') {
      // 按题目数降序，过滤 0 题题库
      publicBanks.value = (banks.value || [])
        .filter(b => (b.question_count || 0) > 0)
        .sort((a, b) => (b.question_count || 0) - (a.question_count || 0))
    }
    if (exams.status === 'fulfilled') {
      publicExams.value = (exams.value || []).filter(e => e.visibility !== 'private' && (e.questions?.length || 0) > 0)
    }
  } catch { /* 公共数据加载失败不影响首页 */ }
}

function resumePractice() {
  if (lastPractice.value) router.push(`/practice/${lastPractice.value.bank_id}`)
}

// 将云端公共题库完整导入到本地「我的题库」，导入后自动获得进度/收藏/错题功能
async function importPublicBank(b: any) {
  if (importingId.value) return
  // 2026-08-21：按钮已 v-else 隐藏，这里再拦一道防止异常路径重复导入建副本
  if (isImported(b.name)) {
    toastError(`「${b.name}」已在你的题库中，无需重复导入`)
    return
  }
  const total = b.question_count || 0
  if (!confirm(`将「${b.name}」导入到我的题库？\n共 ${total} 题，导入后可享进度 / 收藏 / 错题功能。`)) return
  importingId.value = b._id
  importProgress.value = { done: 0, total }
  try {
    const qs = await listPublicBankQuestions(b._id)
    if (!qs.length) {
      toastError('该公共题库暂无可导入的题目')
      importingId.value = null
      importProgress.value = null
      return
    }
    importProgress.value = { done: 0, total: qs.length }
    // 建本地私人副本（private 避免被云同步当成公开题库重复发布）
    const created = await bankStore.create(b.name, b.description || `来自公共题库：${b.name}`, 'private', b.creator_name || null)
    if (!created?.id) throw new Error('创建本地题库失败')
    // 剥离公共 id/bank_id，分批写入（大题库避免单事务过大 + 实时进度）
    // 判断题归一：云端存为 type:'single' + ["正确","错误"]，导入时统一为 type:'judge' + answer true/false（2026-08-15 修复）
    const clean = qs.map(q => {
      const t = classifyQuestionType(q)
      if (t === 'judge') {
        let opts: string[] = []
        try { const p = JSON.parse(q.options || '[]'); if (Array.isArray(p)) opts = p.map((o: any) => String(o)) } catch { /* ignore */ }
        return {
          type: 'judge',
          stem: q.stem,
          options: JSON.stringify(['正确', '错误']),
          answer: judgeAnswerBool(q.answer, opts.length ? opts : null),
          analysis: q.analysis,
          source_index: q.source_index ?? null,
        }
      }
      return {
        type: t,
        stem: q.stem,
        options: q.options,
        answer: q.answer,
        analysis: q.analysis,
        source_index: q.source_index ?? null,
      }
    })
    const CHUNK = 250
    for (let i = 0; i < clean.length; i += CHUNK) {
      const slice = clean.slice(i, i + CHUNK)
      await api.addQuestions(created.id, slice)
      importProgress.value = { done: Math.min(i + CHUNK, clean.length), total: clean.length }
    }
    const s = await api.bankStats(created.id)
    bankStatsMap.value.set(created.id, { ...s, accuracy: 0 })
    toastSuccess(`已导入「${b.name}」${clean.length} 题到我的题库`)
  } catch (e) {
    toastError('导入失败：' + (e instanceof Error ? e.message : String(e)))
  } finally {
    setTimeout(() => { importingId.value = null; importProgress.value = null }, 500)
  }
}

async function create() {
  if (!newName.value.trim()) return
  try {
    const created = await bankStore.create(newName.value.trim(), newDesc.value || null, newVisibility.value, newCreator.value.trim() || null)
    showNew.value = false
    newName.value = ''
    newDesc.value = ''
    newCreator.value = ''
    newVisibility.value = 'private'
    if (created && created.id) {
      if (confirm('题库创建成功！是否立即导入题目？\n（点"取消"稍后从题库卡片 ⋯ 菜单里导入）')) {
        router.push(`/import/${created.id}`)
      }
    }
  } catch (e) {
    toastError('创建题库失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

async function del(id: number) {
  if (!confirm('确认删除该题库？此操作不可恢复。')) return
  try {
    await bankStore.remove(id)
    openMenuId.value = null
    bankStatsMap.value.delete(id)
    if (lastPractice.value && lastPractice.value.bank_id === id) {
      lastPractice.value = null
      try { await api.setSetting('last_practice', '') } catch {}
    }
    toastSuccess('题库已删除')
  } catch (e) {
    toastError('删除题库失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

async function exportBank(b: { id: number; name: string }) {
  openMenuId.value = null
  try {
    const jsonStr = await api.exportBank(b.id)
    const defaultName = `${b.name}_导出_${new Date().toISOString().slice(0, 10)}.json`
    const blob = new Blob([jsonStr], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = defaultName
    a.click()
    URL.revokeObjectURL(url)
    toastSuccess('导出成功')
  } catch (e) {
    toastError('导出失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

// 2026-08-23：提交题库到公共题库审核（visibility=private → pending）
async function submitForReview(b: { id: number; name: string }) {
  if (!confirm(`将「${b.name}」提交到公共题库审核？\n提交后需管理员审核通过才会在首页公开展示（审核前仅自己可见）。`)) return
  openMenuId.value = null
  try {
    await api.updateBankVisibility(b.id, 'pending')
    // 刷新该题库统计（visibility 变化影响展示）
    const s = await api.bankStats(b.id)
    bankStatsMap.value.set(b.id, { ...s, accuracy: s.practiced > 0 ? Math.min(100, Math.round((s.correct / s.practiced) * 100)) : 0 })
    // 刷新题库列表（badge 状态更新）
    await bankStore.load()
    toastSuccess('已提交审核，管理员审核通过后将公开')
  } catch (e) {
    toastError('提交失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

onBeforeUnmount(() => { document.removeEventListener('click', onDocClick); document.removeEventListener('touchstart', onDocClick) })
</script>

<style scoped>
.header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 20px; gap: 16px; }
.header h2 { margin: 0 0 4px 0; font-size: 24px; }
.header-sub { font-size: 13px; color: var(--color-text-secondary); }
.header-sub b { color: var(--color-primary); font-weight: 600; }

/* 访问统计条 */
.visit-bar { margin-bottom: 16px; font-size: 13px; color: var(--color-text-secondary); padding: 8px 14px; background: var(--color-surface, #f7f8fa); border: 1px solid var(--color-border, #eee); border-radius: var(--radius-md); }

/* 云朵彩蛋欢迎条 */
.cloud-welcome-bar {
  margin-bottom: 16px;
  padding: 9px 14px;
  font-size: 13px;
  color: var(--color-text-secondary);
  background: linear-gradient(90deg, var(--tc-light, #f0f9ff) 0%, transparent 85%);
  border: 1px dashed var(--color-border, #e5e7eb);
  border-radius: var(--radius-md);
}
.visit-bar b { color: var(--color-primary); font-weight: 600; }

/* 每日一诗卡 */
.poem-card { margin-bottom: 16px; padding: 14px 16px; background: linear-gradient(135deg, var(--color-surface) 0%, var(--color-surface) 100%); border: 1px solid var(--color-border, #eee); border-left: 3px solid var(--color-primary); border-radius: var(--radius-md); }
.poem-head { font-size: 12px; color: var(--color-primary); font-weight: 600; margin-bottom: 8px; letter-spacing: 0.5px; }
.poem-content { font-size: 15px; line-height: 1.8; color: var(--color-text); white-space: pre-line; letter-spacing: 0.5px; }
.poem-meta { margin-top: 8px; font-size: 12px; color: var(--color-text-secondary); text-align: right; }

.new-bank-btn { padding: 9px 18px; background: var(--color-primary); color: #fff; border: none; border-radius: var(--radius-md); font-size: 14px; cursor: pointer; font-weight: 500; transition: background 0.15s, transform 0.1s; white-space: nowrap; }
.new-bank-btn:hover { background: var(--color-primary-dark); transform: translateY(-1px); }
.header-btns { display: flex; gap: 8px; align-items: center; }
.btn-icon { width: 18px; height: 18px; vertical-align: -3px; margin-right: 4px; }
.exam-btn, .mix-exam-btn { display: inline-flex; align-items: center; justify-content: center; }
.exam-btn { padding: 9px 18px; background: linear-gradient(135deg, var(--color-warning-strong) 0%, var(--color-warning-deep) 100%); color: #fff; border: none; border-radius: var(--radius-md); font-size: 14px; cursor: pointer; font-weight: 500; transition: background 0.15s, transform 0.1s; white-space: nowrap; box-shadow: 0 2px 6px rgba(245, 158, 11, 0.3); }
.exam-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4); }
.mix-exam-btn { padding: 9px 18px; background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%); color: #fff; border: none; border-radius: var(--radius-md); font-size: 14px; cursor: pointer; font-weight: 500; transition: background 0.15s, transform 0.1s; white-space: nowrap; box-shadow: 0 2px 6px rgba(79, 70, 229, 0.3); }
.mix-exam-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(79, 70, 229, 0.4); }
.calc-btn { padding: 9px 18px; background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%); color: #fff; border: none; border-radius: var(--radius-md); font-size: 14px; cursor: pointer; font-weight: 500; transition: background 0.15s, transform 0.1s; white-space: nowrap; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18); text-decoration: none; display: inline-flex; align-items: center; justify-content: center; }
.calc-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.22); }

/* 每日激励卡 */
.daily-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
  margin-bottom: 16px;
  background: linear-gradient(135deg, var(--color-warning-light) 0%, var(--color-warning-bg) 100%);
  border: 1px solid var(--color-warning-light);
  border-radius: var(--radius-lg);
  box-shadow: 0 2px 6px rgba(245, 158, 11, 0.08);
}
.daily-left { display: flex; align-items: center; gap: 14px; }
.daily-icon { width: 40px; height: 40px; }
.daily-title { font-size: 16px; color: var(--color-warning-deep); font-weight: 600; }
.daily-title b { color: var(--color-warning-deep); font-size: 18px; }
.daily-sub { font-size: 13px; color: var(--color-warning-text); margin-top: 4px; }
.daily-sub b { color: var(--color-warning-deep); }
.daily-progress { min-width: 160px; }
.daily-progress-bar { height: 6px; background: rgba(146, 64, 14, 0.15); border-radius: 3px; overflow: hidden; }
.daily-progress-fill { height: 100%; background: linear-gradient(90deg, var(--color-warning-strong), var(--color-warning-strong)); border-radius: 3px; transition: width 0.4s; }
.daily-progress-label { font-size: 11px; color: var(--color-warning-text); margin-top: 4px; text-align: right; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 18px; }
.card { position: relative; border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 18px; background: var(--color-card); transition: transform 0.18s, box-shadow 0.18s, border-color 0.18s; cursor: default; display: flex; flex-direction: column; }
.card:hover { transform: translateY(-3px); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08); border-color: var(--color-primary-light); }
.card.has-progress { border-left: 3px solid var(--color-primary); }
.card.open { z-index: 60; }
.card-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 8px; }
.card-header h3 { margin: 0; flex: 1; font-size: 16px; line-height: 1.4; word-break: break-all; }
.more-btn { padding: 4px 8px; border: none; background: none; cursor: pointer; color: var(--color-text-secondary); font-size: 20px; line-height: 1; border-radius: var(--radius-sm); transition: background 0.12s; }
.more-btn:hover { background: var(--color-border-light); }
.card-meta { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
.count-pill, .accuracy-pill, .creator-pill {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 3px 10px; border-radius: 12px;
  font-size: 12px; font-weight: 500;
}
.count-pill { background: var(--color-primary-light); color: var(--color-primary); }
.accuracy-pill { background: var(--color-success-bg); color: var(--color-success-deep); }
.creator-pill { background: var(--tc-light); color: var(--color-primary); }
.accuracy-pill.mid { background: var(--color-warning-bg); color: var(--color-warning-text); }
.accuracy-pill.low { background: var(--color-danger-bg); color: var(--color-danger-deep); }

.progress-row { margin-bottom: 14px; }
.progress-bar { height: 6px; background: var(--color-border-light); border-radius: 3px; overflow: hidden; }
.progress-fill { height: 100%; background: linear-gradient(90deg, var(--color-primary), var(--color-primary-dark)); border-radius: 3px; transition: width 0.4s; }
.progress-text { font-size: 11px; color: var(--color-text-tertiary); margin-top: 4px; text-align: right; }

.actions { margin-top: auto; }
.primary-btn { width: 100%; padding: 10px 12px; border: none; border-radius: var(--radius-md); background: var(--color-primary); color: #fff; cursor: pointer; font-size: 14px; font-weight: 500; transition: background 0.15s, transform 0.1s; }
.primary-btn:hover { background: var(--color-primary-dark); transform: translateY(-1px); }

.dropdown-menu { position: absolute; top: 50px; right: 12px; min-width: 160px; background: var(--color-card); border: 1px solid var(--color-border); border-radius: var(--radius-md); box-shadow: 0 4px 16px rgba(0,0,0,0.15); padding: 4px; z-index: 80; }
.dropdown-menu button { display: flex; align-items: center; width: 100%; text-align: left; padding: 8px 12px; border: none; background: none; cursor: pointer; color: var(--color-text); font-size: 13px; border-radius: var(--radius-sm); gap: 8px; }
.dropdown-menu button:hover { background: var(--color-border-light); }
.dropdown-menu button.danger { color: var(--color-danger); }
.dropdown-menu button.danger:hover { background: var(--color-danger-light); }

.modal { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 100; animation: fadeIn 0.15s; }
.modal-body { background: var(--color-card); padding: 24px; border-radius: var(--radius-lg); min-width: 340px; display: flex; flex-direction: column; gap: 10px; color: var(--color-text); box-shadow: 0 8px 32px rgba(0,0,0,0.2); }
.modal-body h3 { margin: 0 0 4px 0; }
.modal-body input, .modal-body textarea { padding: 8px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg); color: var(--color-text); font-family: inherit; font-size: 14px; }
.modal-body textarea { min-height: 60px; resize: vertical; }
.modal-body input:focus, .modal-body textarea:focus { outline: none; border-color: var(--color-primary); }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
.modal-actions button { padding: 7px 16px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); cursor: pointer; font-size: 14px; }
.modal-actions button:first-child { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
.modal-actions button:first-child:hover { background: var(--color-primary-dark); }
.vis-options { display: flex; gap: 8px; }
.vis-option { flex: 1; display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: 1.5px solid var(--color-border); border-radius: var(--radius-md); cursor: pointer; background: var(--color-bg); }
.vis-option.active { border-color: var(--color-primary); background: var(--color-primary-light); }
.vis-option > span { font-size: 18px; }
.vis-name { font-size: 13px; font-weight: 600; color: var(--color-text); }
.vis-desc { font-size: 11px; color: var(--color-text-tertiary); }
.vis-badge { font-size: 11px; margin-left: 6px; }
.vis-badge.public { color: var(--color-info-deep); }
.vis-badge.private { color: var(--color-warning-text); }
.vis-badge.pending { color: var(--color-warning-text); }

.empty { text-align: center; padding: 80px 24px; color: var(--color-text-tertiary); }
.empty-icon { width: 88px; height: 88px; margin-bottom: 16px; opacity: 0.75; }
.empty-title { font-size: 18px; color: var(--color-text-secondary); margin: 0 0 8px 0; }
.empty-tip { font-size: 14px; margin: 0 0 20px 0; }
.empty-action { padding: 10px 24px; background: var(--color-primary); color: #fff; border: none; border-radius: var(--radius-md); font-size: 14px; cursor: pointer; font-weight: 500; }
.empty-action:hover { background: var(--color-primary-dark); }

/* 公共考试入口 banner */
.public-exam-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  margin-bottom: 18px;
  background: linear-gradient(135deg, var(--color-warning-strong) 0%, var(--color-warning-deep) 100%);
  color: #fff;
  border-radius: var(--radius-lg);
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
  transition: transform 0.15s, box-shadow 0.15s;
}
.public-exam-banner:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(245, 158, 11, 0.4); }
.pe-left { display: flex; align-items: center; gap: 14px; }
.pe-icon { width: 36px; height: 36px; }
.pe-title { font-size: 16px; font-weight: 700; }
.pe-sub { font-size: 12px; opacity: 0.9; margin-top: 2px; }
.pe-arrow { font-size: 30px; opacity: 0.8; line-height: 1; }

/* 公共题库区块 */
.public-section { margin-bottom: 24px; }
.section-header { display: flex; align-items: baseline; gap: 10px; margin-bottom: 14px; }
.section-header h3 { margin: 0; font-size: 17px; }
.section-sub { font-size: 12px; color: var(--color-text-tertiary); }
.public-grid { margin-top: 0; }
.public-card { border-color: var(--color-primary-light); background: linear-gradient(180deg, var(--color-card) 0%, rgba(124, 58, 237, 0.03) 100%); }
.public-card:hover { border-color: var(--color-primary); }

/* 添加到我的题库 */
.import-btn { width: 100%; margin-top: 8px; padding: 8px 12px; border: 1px dashed var(--color-primary); border-radius: var(--radius-md); background: var(--color-primary-light); color: var(--color-primary); cursor: pointer; font-size: 13px; font-weight: 500; transition: background 0.15s, transform 0.1s; }
.import-btn:hover:not(:disabled) { background: var(--color-primary); color: #fff; transform: translateY(-1px); }
.import-btn:disabled { cursor: default; opacity: 0.7; }
.imported-tag { margin-top: 8px; font-size: 12px; color: var(--color-success-deep); background: var(--color-success-bg); padding: 4px 10px; border-radius: 12px; text-align: center; }
.import-progress { margin-top: 8px; }
.import-bar { height: 6px; background: var(--color-border-light); border-radius: 3px; overflow: hidden; }
.import-fill { height: 100%; background: linear-gradient(90deg, var(--color-primary), var(--color-primary-dark)); border-radius: 3px; transition: width 0.2s; }

/* 移动端适配 */
@media (max-width: 768px) {
  .header { flex-direction: column; align-items: stretch; gap: 12px; }
  .header-btns { flex-wrap: wrap; }
  .header-btns button, .header-btns .calc-btn { flex: 1; min-width: 100px; padding: 9px 10px; font-size: 13px; }
  .new-bank-btn { flex: 1 1 100% !important; }
  .grid { grid-template-columns: 1fr; }
  .daily-card { flex-direction: column; align-items: stretch; gap: 10px; }
  .daily-progress { min-width: 0; }
  .dropdown-menu { right: 8px; }
  .resume-card { padding: 14px 16px; }
  .modal-body { min-width: 0; }
  /* 记忆复习入口卡片移动端 */
  .memory-entry-card { flex-direction: column; align-items: stretch; gap: 10px; padding: 14px 16px; }
  .me-right { min-width: 0; }
  .me-health-wrap { width: 100%; }
  .me-arrow { display: none; }
  .me-sub { font-size: 12px; }
  .me-exam { font-size: 11px; }
  /* 学习计划卡片移动端 */
  .study-plan-card { flex-direction: column; align-items: stretch; gap: 10px; padding: 14px 16px; }
  .sp-progress { min-width: 0; }
  .sp-arrow { display: none; }
}

/* 学习计划卡片 */
.study-plan-card { display: flex; align-items: center; justify-content: space-between; padding: 18px 22px; margin-bottom: 16px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff; border-radius: var(--radius-xl); cursor: pointer; box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3); transition: transform 0.15s, box-shadow 0.15s; }
.study-plan-card:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(102, 126, 234, 0.4); }
.sp-left { display: flex; align-items: center; gap: 12px; }
.sp-icon { width: 32px; height: 32px; }
.sp-title { font-size: 18px; font-weight: bold; }
.sp-sub { font-size: 13px; opacity: 0.9; margin-top: 4px; }
.sp-progress { min-width: 100px; }
.sp-progress-bar { height: 8px; background: rgba(255, 255, 255, 0.3); border-radius: 4px; overflow: hidden; margin-bottom: 4px; }
.sp-progress-fill { height: 100%; background: #fff; border-radius: 4px; transition: width 0.3s ease; }
.sp-progress-text { text-align: center; font-size: 14px; font-weight: 500; }
.sp-arrow { font-size: 32px; line-height: 1; opacity: 0.8; }

/* 记忆复习入口卡片（2026-08-23） */
.memory-entry-card { display: flex; align-items: center; justify-content: space-between; padding: 18px 22px; margin-bottom: 16px; background: linear-gradient(135deg, var(--color-primary) 0%, var(--tc-strong) 100%); color: #fff; border-radius: var(--radius-xl); cursor: pointer; box-shadow: 0 4px 12px rgba(124, 58, 237, 0.3); transition: transform 0.15s, box-shadow 0.15s; }
.memory-entry-card:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(124, 58, 237, 0.4); }
.me-left { display: flex; align-items: center; gap: 12px; }
.me-icon-img { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; flex-shrink: 0; background: #fff; padding: 4px; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15); }
.me-title { font-size: 18px; font-weight: bold; }
.me-sub { font-size: 13px; opacity: 0.9; margin-top: 4px; }
.me-sub b { color: #fde68a; }
.me-fast { color: #fcd34d; font-weight: 600; }
.me-exam { font-size: 12px; color: #fde68a; margin-top: 4px; }
.me-exam b { color: #fff; }
.me-right { display: flex; align-items: center; gap: 12px; }
.me-health-wrap { width: 90px; height: 8px; background: rgba(255, 255, 255, 0.3); border-radius: 4px; overflow: hidden; }
.me-health-fill { height: 100%; background: #fff; border-radius: 4px; transition: width 0.3s ease; }
.me-arrow { font-size: 32px; line-height: 1; opacity: 0.8; }

.resume-card { display: flex; align-items: center; justify-content: space-between; padding: 18px 22px; margin-bottom: 16px; background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%); color: #fff; border-radius: var(--radius-xl); cursor: pointer; box-shadow: 0 4px 12px rgba(66, 184, 131, 0.3); transition: transform 0.15s, box-shadow 0.15s; }
.resume-card:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(66, 184, 131, 0.4); }
.resume-label { font-size: 12px; opacity: 0.9; margin-bottom: 4px; letter-spacing: 1px; }
.resume-title { font-size: 18px; font-weight: bold; }
.resume-meta { font-size: 13px; opacity: 0.9; margin-top: 4px; }
.resume-arrow { font-size: 32px; line-height: 1; opacity: 0.8; }

/* 加载骨架 */
.skeleton-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 18px; }
.skeleton-card { height: 160px; background: linear-gradient(90deg, var(--color-border-light) 0%, var(--color-card) 50%, var(--color-border-light) 100%); background-size: 200% 100%; border-radius: var(--radius-lg); animation: shimmer 1.4s infinite; }

@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

/* 免责声明 */
.site-disclaimer {
  margin: 26px auto 8px;
  max-width: 720px;
  text-align: center;
  font-size: 11px;
  line-height: 1.6;
  color: var(--color-text-tertiary);
}

/* 小屏才显示，链接本身的样式在 App.vue（非 scoped，全局生效） */
.site-beian { display: none; margin: 0 auto 20px; }
@media (max-width: 768px) { .site-beian { display: block; } }
</style>
