<template>
  <div class="memory">
    <div class="memory-header">
      <h2>记忆复习</h2>
      <p class="sub">基于遗忘曲线的间隔重复 · 自动评估 + 可手动覆盖</p>
      <p v-if="daysToExam !== null" class="exam-banner">
        ⏰ 距最近考试还有 <b>{{ daysToExam }}</b> 天，已开启「{{ examPhaseLabel }}」复习节奏
      </p>
    </div>

    <!-- 2026-08-23：复习范围选择（全部 / 各题库独立，配额随题库规模联动） -->
    <div class="scope-bar">
      <button
        class="scope-btn"
        :class="{ active: selectedBankId === null }"
        @click="selectBank(null)"
      >全部</button>
      <button
        v-for="b in banks"
        :key="b.id"
        class="scope-btn"
        :class="{ active: selectedBankId === b.id }"
        :title="`${b.name} · 每日建议 ${bankCap(b.id)} 题`"
        @click="selectBank(b.id)"
      >{{ b.name }}<span class="scope-count" v-if="bankDueCount(b.id) > 0">{{ bankDueCount(b.id) }}</span></button>
    </div>

    <div v-if="!loaded" class="loading">加载中...</div>

    <!-- 概览 -->
    <template v-else>
      <div class="overview">
        <div class="ov-item">
          <span class="ov-value">{{ dueCount }}</span>
          <span class="ov-label">今日待复习<span v-if="selectedBankId !== null" class="ov-cap">/ {{ activeCap }} 建议</span></span>
        </div>
        <div class="ov-item">
          <span class="ov-value">{{ healthPercent }}%</span>
          <span class="ov-label">记忆健康度<span v-if="selectedBankId !== null" class="ov-cap">· {{ selectedBankName }}</span></span>
        </div>
        <div class="ov-item">
          <span class="ov-value">{{ knowledgeCount }}</span>
          <span class="ov-label">知识点数<span class="ov-cap">（去重后）</span></span>
        </div>
      </div>

      <!-- 记忆强度分布 -->
      <div class="dist-section">
        <div class="dist-title">记忆强度分布</div>
        <div class="dist-bar">
          <div class="dist-seg strong" :style="{ width: dist.strong + '%' }" :title="`强 ${strongCount} 题`"></div>
          <div class="dist-seg mid" :style="{ width: dist.mid + '%' }" :title="`中 ${midCount} 题`"></div>
          <div class="dist-seg weak" :style="{ width: dist.weak + '%' }" :title="`弱 ${weakCount} 题`"></div>
          <div class="dist-seg untracked" :style="{ width: dist.untracked + '%' }" :title="`未追踪 ${untrackedCount} 题`"></div>
        </div>
        <div class="dist-legend">
          <span class="lg strong">🟢 强 {{ strongCount }}</span>
          <span class="lg mid">🟡 中 {{ midCount }}</span>
          <span class="lg weak">🔴 弱 {{ weakCount }}</span>
          <span class="lg untracked">⚪ 未追踪 {{ untrackedCount }}</span>
        </div>
      </div>

      <!-- 复习模式 -->
      <div v-if="practicing">
        <div class="practice-top">
          <span class="practice-idx">复习 {{ practiceIdx + 1 }} / {{ practiceQueue.length }}</span>
          <button class="exit-btn" @click="exitPractice">退出复习</button>
        </div>
        <QuestionCard
          v-if="current"
          :key="`${current.id}-${reloadKey}`"
          :question="current"
          :index="practiceIdx"
          :auto-next="false"
          :favorited="favoriteIds.has(current.id)"
          @answered="onAnswered"
          @next="next"
          @toggle-favorite="onToggleFavorite"
        />
        <!-- 手动覆盖记忆质量 -->
        <div v-if="current" class="memory-quality-bar">
          <span class="mc-label">记忆自评</span>
          <button
            v-for="opt in MEMORY_OPTIONS"
            :key="opt.label"
            class="mc-btn"
            :class="{ active: currentQualityLabel === opt.label }"
            @click="overrideMemory(opt.label)"
          >{{ opt.label }}</button>
        </div>
      </div>

      <!-- 待复习列表 -->
      <template v-else>
        <div class="due-section" v-if="dueList.length || deferredCount > 0">
          <div class="due-head">
            <span class="due-title">📅 今日待复习
              <span class="due-cap">（建议 {{ activeCap }} 题）</span>
              <span v-if="deferredCount > 0" class="deferred-tag">另有 {{ deferredCount }} 题顺延</span>
            </span>
            <button class="start-btn" v-if="dueList.length" @click="startPractice">开始复习</button>
          </div>
          <ul class="due-list">
            <li
              v-for="item in dueList"
              :key="item.question.id"
              class="due-item"
              :class="strengthClass(item.strength)"
            >
              <span class="due-strength">{{ item.level }}</span>
              <span v-if="item.stale" class="stale-tag">重新学</span>
              <span class="due-text">{{ item.question.stem }}</span>
              <span class="due-meta">{{ item.bankName }} · {{ item.sinceText }}</span>
            </li>
          </ul>
          <p v-if="deferredCount > 0" class="deferred-hint">为保持每天轻量复习，超出「今日建议 {{ activeCap }} 题」的部分已顺延到后面几天，不会堆积。</p>
        </div>

        <div v-else class="empty-state">
          <div class="empty-icon">🎉</div>
          <p>今日没有需要复习的题目</p>
          <p class="empty-sub">去练习页刷题会自动积累记忆数据，明天再来看看</p>
        </div>

        <!-- 弱记忆题目提示 -->
        <div v-if="weakList.length" class="weak-section">
          <div class="due-head">
            <span class="due-title">🔴 记忆薄弱（{{ weakList.length }}）</span>
            <button class="start-btn" @click="startWeak">重点复习</button>
          </div>
          <ul class="due-list">
            <li
              v-for="item in weakList"
              :key="item.question.id"
              class="due-item weak"
            >
              <span class="due-strength">{{ item.level }}</span>
              <span class="due-text">{{ item.question.stem }}</span>
              <span class="due-meta">{{ item.bankName }}</span>
            </li>
          </ul>
        </div>
      </template>

      <!-- 复习完成 -->
      <div v-if="finishStats" class="finish-state">
        <h3>🎉 复习完成</h3>
        <p>共复习 {{ finishStats.total }} 题 · 正确 {{ finishStats.correct }} 题 · 正确率 {{ finishStats.accuracy }}%</p>
        <button class="start-btn" @click="finishStats = null">返回</button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api, Question } from '../utils/api'
import { idb, normalizeTs } from '../lib/db'
import { toastSuccess, toastInfo } from '../utils/toast'
import QuestionCard from '../components/QuestionCard.vue'
import {
  calculateNextReview,
  calculateAutoQuality,
  getMemoryStrength,
  strengthLevel,
  qualityLabel,
  labelToQuality,
  calculateDailyReviewCap,
  calculateBankReviewCap,
  calculateDynamicCap,
  calculateDaysToExam,
  isStaleReview,
  DEFAULT_DAILY_REVIEW_CAP,
  computeNextReviewTs,
  toReviewTs,
  type QualityLabel,
} from '../lib/spaced-repetition'

const router = useRouter()

// MEMORY_OPTIONS：手动质量覆盖按钮
// 2026-09-15 修复(P2-10)：必须与 qualityLabel 的值域一一对应（详见 spaced-repetition.ts 里的注释）。
// 此前「模糊」既表示 quality 3 又表示 quality 2，而 labelToQuality('模糊') 只回 3，
// 于是 quality:2 的记录被用户点同一个标签确认后重写成 3，跨越 quality<3 的及格线（失败改判为成功）。
// 标签拆成「勉强(3)/模糊(2)」后必须补第五个按钮，否则 quality:3 会显示出一个没有对应按钮的标签，
// 用户只能点相邻档 → 同一缺陷反方向重现。注：这是该标签集的**第 2 份副本**，
// 第 1 份在 PracticeView.vue，两份已同步改（属既有重复，未合并，见报告 concerns）。
const MEMORY_OPTIONS = [
  { label: '认识', q: 5, hint: '熟练，可拉长间隔' },
  { label: '一般', q: 4, hint: '会但不熟' },
  { label: '勉强', q: 3, hint: '想很久才答对' },
  { label: '模糊', q: 2, hint: '接近但没答对' },
  { label: '不认识', q: 1, hint: '完全不会，须尽快复习' },
] as const

const loaded = ref(false)
const questions = ref<Question[]>([])
const reviews = ref<Map<number, any>>(new Map()) // question_id -> 最新 review_record
const bankNameMap = ref<Map<number, string>>(new Map())
const favoriteIds = ref<Set<number>>(new Set())

// 2026-08-23：按题库独立复习
const banks = ref<any[]>([])
const selectedBankId = ref<number | null>(null)
// 2026-08-23：备考驱动动态配额——最早考期距今天数
const daysToExam = ref<number | null>(null)

// 练习状态
const practicing = ref(false)
const practiceQueue = ref<Question[]>([])
const practiceIdx = ref(0)
const current = computed(() => practiceQueue.value[practiceIdx.value] || null)
const reloadKey = ref(0)
const currentQualityLabel = ref<string | null>(null)
const finishStats = ref<{ total: number; correct: number; accuracy: number } | null>(null)
// 2026-09-15 修复(P1-30)：会话答题计数。此前完成面板硬编码 correct: 0 / accuracy: 0，
// onAnswered 收到每题 payload.correct 但从不计数 → 全对完成 30 题也显示「正确 0 题 · 正确率 0%」。
const sessionCorrect = ref(0)
const sessionTotal = ref(0)
// 2026-09-15 复审 MF-5：按题身份去重。QuestionCard 的 ✓/✗ 此前可连点（已在组件侧加锁），
// 但计数与写库副作用都挂在 onAnswered 上，任何一次重复 emit 都不该让面板自相矛盾，
// 所以这里再加一层：同一题只计一次。键用 (bank_id, id)——与 recordPractice 的身份口径一致。
const sessionAnswered = new Set<string>()

// 进入时先加载一次
onMounted(async () => {
  await loadData()
})

// 全量加载：题目 + 复习记录 + 题库名
async function loadData() {
  try {
    // 题目（全量）
    const allQuestions = await idb.listAll('questions')
    questions.value = allQuestions
    // 题库列表 + 题库名映射
    const bankList = await api.listBanks()
    banks.value = bankList
    bankNameMap.value = new Map(bankList.map(b => [b.id, b.name]))
    // 复习记录（全量，取每题最新）
    const allReviews = await idb.listAll('review_records')
    reviews.value = new Map()
    for (const r of allReviews) {
      if (r.question_id == null) continue
      const existing = reviews.value.get(r.question_id)
      // T10b（2026-09-15）修复：原为 `String(r.last_review) > String(existing.last_review)` 的字符串比较。
      // last_review 是混合类型（网页端 ISO 串 / 小程序端纪元数字，restoreBackup 会让 ISO 行回流），
      // 字典序下 `"2026-…" > "1789…"` 恒成立 ⇒ 会把历史 ISO 记录无条件当成「最新」。
      // 统一走 normalizeTs 归一后比较（不统一存储类型）。
      if (!existing || normalizeTs(r.last_review) > normalizeTs(existing.last_review)) {
        reviews.value.set(r.question_id, r)
      }
    }
    // 2026-08-23 防堆积：每日复习配额联动学习计划（全库模式用；单库模式按库规模）
    // 备考驱动：取所有计划最早到期的考试日期 → 距考天数 → 动态配额
    const plans = await idb.listPlans()
    // 最早考期（取所有计划 examDate 中最小日期优先）
    const examDates = plans.map(p => p.examDate).filter((d): d is string => !!d).sort()
    daysToExam.value = calculateDaysToExam(examDates[0] || null)
    todayCap.value = calculateDailyReviewCap(plans)
    loaded.value = true
  } catch (e) {
    console.error('加载记忆复习数据失败：', e)
    loaded.value = true
  }
}

// ===== 统计 =====
// 2026-08-23 内容去重：同 stem 的题只保留最强记录，避免重复题虚高统计
import { deduplicateByStem, simpleHash } from '../lib/spaced-repetition'
// 有追踪记录的题目合集（去重前，用于列表展示；去重后用于统计）
const tracked = computed(() => {
  const set = new Set<number>()
  for (const q of questions.value) if (reviews.value.has(q.id)) set.add(q.id)
  return set
})
const trackedCount = computed(() => tracked.value.size)

// 去重后的追踪题目合集（同 stem 只保留最强记录，用于统计）
const trackedDedup = computed(() => {
  const items = Array.from(tracked.value).map(id => {
    const q = questions.value.find(x => x.id === id)
    const r = reviews.value.get(id)
    return {
      questionId: id,
      stem: q?.stem || '',
      strength: getMemoryStrength(r?.ease_factor ?? 2.5, r?.interval ?? 0),
    }
  })
  return deduplicateByStem(items)
})
// 去重后知识点数（真正独立的知识点）
const knowledgeCount = computed(() => trackedDedup.value.length)

// 记忆强度分档（去重后统计，避免重复题虚高）
const strongCount = computed(() => countByLevel('强'))
const midCount = computed(() => countByLevel('中'))
const weakCount = computed(() => countByLevel('弱'))
const untrackedCount = computed(() => questions.value.length - trackedCount.value)
function countByLevel(level: string): number {
  let c = 0
  for (const item of trackedDedup.value) {
    const lvl = strengthLevel(item.strength)
    if (lvl === level) c++
  }
  return c
}

// 健康度 = 去重后知识点的平均强度（权重：强1 / 中0.6 / 弱0.3）
const healthPercent = computed(() => {
  if (knowledgeCount.value === 0) return 0
  let score = 0
  for (const item of trackedDedup.value) {
    const lvl = strengthLevel(item.strength)
    if (lvl === '强') score += 1
    else if (lvl === '中') score += 0.6
    else score += 0.3
  }
  return Math.round((score / knowledgeCount.value) * 100)
})

const dist = computed(() => {
  // 2026-09-15 修复(P2-22)：原分母用去重后的知识点数 knowledgeCount，而 untracked 是题数口径
  //（questions.length - trackedCount），未追踪题多时可达知识点的几十倍 → 段宽百分比爆表
  //（审计实测可到 4000%）、堆叠条溢出被 overflow:hidden 裁掉，整条分布失去意义。
  // 统一改用题目总数作分母（分子分母同为题数口径）。
  // ⚠️ 但「合计 ≤ 100%」不成立（复审 MF-4 实测并穷举证实）：四段各自 Math.round，
  //    8 题的分布会凑出 13+13+13+63 = **102%**，堆叠条仍有轻微溢出可能。
  //    本条只把审计实测的「可到 4000%」量级压回 100% 附近；要严格不溢出需最大余数法或
  //    末段取余，那是新改动、超出本任务授权 → 记入 T17 清单。
  const t = questions.value.length
  if (t === 0) return { strong: 0, mid: 0, weak: 0, untracked: 0 }
  const p = (n: number) => Math.round((n / t) * 100)
  return {
    strong: p(strongCount.value),
    mid: p(midCount.value),
    weak: p(weakCount.value),
    untracked: p(untrackedCount.value),
  }
})

// ===== 待复习 =====
// 今日到期（next_review <= 今天 今天24点）
const todayEnd = computed(() => {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d.getTime()
})

// 2026-08-23 按题库独立复习
const selectedBank = computed(() => banks.value.find(b => b.id === selectedBankId.value) || null)
const selectedBankName = computed(() => selectedBank.value?.name || '全部题库')
// 题库题数
function bankQuestionCount(bankId: number): number {
  return questions.value.filter(q => q.bank_id === bankId).length
}
// 单库每日配额（按题库规模 + 距考天数动态联动）
function bankCap(bankId: number): number {
  return calculateDynamicCap(bankQuestionCount(bankId), daysToExam.value)
}
// 单库今日到期数（含顺延，用于 scope 角标）
function bankDueCount(bankId: number): number {
  return allDueList.value.filter(i => i.question.bank_id === bankId).length
}
function selectBank(id: number | null) {
  selectedBankId.value = id
}

// 2026-08-23：距考阶段标签（用于提示当前复习节奏）
const examPhaseLabel = computed(() => {
  const d = daysToExam.value
  if (d === null) return '常规'
  if (d <= 3) return '冲刺极限'
  if (d <= 8) return '冲刺加量'
  if (d <= 30) return '加量复习'
  return '常规'
})

// 2026-08-23 防堆积：每日复习配额
// 全库模式 → 联动学习计划（至少 50 保底）+ 距考天数动态；单库模式 → 按该库规模 + 距考天数动态
const todayCap = ref(DEFAULT_DAILY_REVIEW_CAP)
const activeCap = computed(() => {
  if (selectedBankId.value !== null) return bankCap(selectedBankId.value)
  // 全库模式：用动态配额（考虑距考天数），但至少不低于计划配额
  const totalCount = questions.value.length
  const dynamic = calculateDynamicCap(totalCount, daysToExam.value)
  return Math.max(dynamic, todayCap.value)
})
// 顺延数量（超出配额的部分）
const deferredCount = computed(() => Math.max(0, allDueCount.value - activeCap.value))

// 全量到期（未截断，用于统计顺延数；按选中题库过滤）
const allDueList = computed(() => {
  const list: { question: Question; strength: number; level: string; bankName: string; sinceText: string; stale: boolean }[] = []
  for (const q of questions.value) {
    if (selectedBankId.value !== null && q.bank_id !== selectedBankId.value) continue
    const r = reviews.value.get(q.id)
    if (!r) continue
    // 2026-09-15 修复(P1-21)：next_review 现在是纪元毫秒数字，历史数据仍是 ISO 串，一律走 toReviewTs
    //（对历史 ISO 串产出与 new Date(v).getTime() 完全相同的数字，到期集合不会漂移）。
    // 三个分支与修复前逐条对应，不合并：
    //   有 next_review        → 用它（解析不了得 NaN，由下面既有的 Number.isNaN 跳过）
    //   无 next_review 有 last → last_review + interval×86400000
    //   两者都无              → 0（修复前就是 0，`0 <= todayEnd` 成立 → 视为已到期，不改变既有行为）
    const nextTs = r.next_review ? toReviewTs(r.next_review) : null
    const lastTs = r.last_review ? toReviewTs(r.last_review) : null
    const next = r.next_review
      ? (nextTs === null ? NaN : nextTs)
      : (r.last_review ? (lastTs === null ? NaN : lastTs) + (r.interval ?? 0) * 86400000 : 0)
    if (Number.isNaN(next)) continue
    if (next <= todayEnd.value) {
      const strength = getMemoryStrength(r.ease_factor ?? 2.5, r.interval ?? 0)
      list.push({
        question: q,
        strength,
        level: strengthLevel(strength),
        bankName: bankNameMap.value.get(q.bank_id) || '未知题库',
        sinceText: sinceText(r),
        stale: isStaleReview(r.last_review),
      })
    }
  }
  // 记忆越弱越靠前（逾期重学的最优先，避免痛苦长尾）
  return list.sort((a, b) => a.strength - b.strength)
})
const allDueCount = computed(() => allDueList.value.length)

// 今日份（按配额截断，防堆积）
const dueList = computed(() => allDueList.value.slice(0, activeCap.value))
const dueCount = computed(() => dueList.value.length)

// 记忆薄弱（中/弱，且当前不碍事也列出来做重点）
const weakList = computed(() => {
  const list: { question: Question; strength: number; level: string; bankName: string }[] = []
  for (const q of questions.value) {
    // 2026-09-15 修复(P2-22)：与 allDueList 一样按选中题库过滤——原 weakList 恒跨全部题库，
    // 单库范围下「重点复习」队列（startWeak 由 weakList 构建）会练到范围外的题。
    if (selectedBankId.value !== null && q.bank_id !== selectedBankId.value) continue
    const r = reviews.value.get(q.id)
    if (!r) continue
    const strength = getMemoryStrength(r.ease_factor ?? 2.5, r.interval ?? 0)
    if (strength < 40) {
      list.push({ question: q, strength, level: strengthLevel(strength), bankName: bankNameMap.value.get(q.bank_id) || '未知题库' })
    }
  }
  return list.sort((a, b) => a.strength - b.strength).slice(0, 30)
})

function sinceText(r: any): string {
  // 2026-09-15 修复(P1-21)：next_review 现在是纪元毫秒数字，历史数据仍是 ISO 串，
  // 原式 `new Date(nextStr).getTime()` 虽然两种都能吃，但改走 toReviewTs 后与全项目共用同一解析口径；
  // 两处 '近期' 回落（值缺失 / 值不可解析）与修复前逐条对应
  const nextTime = r?.next_review ? toReviewTs(r.next_review) : null
  if (nextTime === null) return '近期'
  const days = Math.round((nextTime - Date.now()) / 86400000)
  // 2026-09-15 修复(控制端转交，Task 4 发现)：days 正值意味着「将来」（nextTime 在当下之后），
  // 原文案方向相反（days>=2 → 「N 天前到期」、days===1 → 「昨天到期」）。实测：
  // 现在 09:00、某题 next_review 是今天 23:59 → days=1 → 误显「昨天到期」。
  // 调用方 allDueList 已过滤 next <= 今日 23:59:59，days 的正常取值 ≤ 1；
  // days===1 只能是「今天晚些到期」（四舍五入进位），days>=2 在此调用点不可达但保留正确方向。
  if (days <= -2) return `${-days} 天前到期`
  if (days === -1) return '昨天到期'
  if (days >= 2) return `${days} 天后到期`
  return '今日到期'
}

function strengthClass(score: number): string {
  if (score >= 70) return 'st-strong'
  if (score >= 40) return 'st-mid'
  return 'st-weak'
}

// ===== 开始复习 =====
async function startPractice() {
  practiceQueue.value = dueList.value.map(i => i.question)
  if (!practiceQueue.value.length) { toastInfo('今日没有待复习题目'); return }
  practiceIdx.value = 0
  practicing.value = true
  finishStats.value = null
  sessionCorrect.value = 0
  sessionTotal.value = 0
  sessionAnswered.clear() // 复审 MF-5：不清就会把上一轮的题身份带进新会话，同题不再计数
  await refreshMemoryLabel()
}

// 重点复习（记忆薄弱题）
async function startWeak() {
  practiceQueue.value = weakList.value.map(i => i.question)
  if (!practiceQueue.value.length) { toastInfo('没有需要重点复习的题目'); return }
  practiceIdx.value = 0
  practicing.value = true
  finishStats.value = null
  sessionCorrect.value = 0
  sessionTotal.value = 0
  sessionAnswered.clear() // 复审 MF-5：不清就会把上一轮的题身份带进新会话，同题不再计数
  await refreshMemoryLabel()
}

function exitPractice() {
  practicing.value = false
  practiceQueue.value = []
  finishStats.value = null
  loadData()
}

// 刷新当前题的记忆标签
async function refreshMemoryLabel() {
  if (!current.value) return
  const r = reviews.value.get(current.value.id)
  currentQualityLabel.value = r ? qualityLabel(r.quality) : null
}

// ===== 答题 =====
async function onAnswered(payload: { correct: boolean; answer: string; duration_ms: number | null }) {
  const q = current.value
  if (!q) return
  // 修复(P1-30)：累计本会话答题数与正确数（作答本身已发生，与记录是否写成功无关）
  // 复审 MF-5：按题去重——同一题的重复 emit 不再重复计数（组件侧已加 selfEvalDone 锁，这是第二层）
  const answeredKey = q.bank_id + ':' + q.id
  if (!sessionAnswered.has(answeredKey)) {
    sessionAnswered.add(answeredKey)
    sessionTotal.value++
    if (payload.correct) sessionCorrect.value++
  }
  try {
    await api.recordPractice({ bank_id: q.bank_id, question_id: q.id, user_answer: payload.answer, is_correct: payload.correct, duration_ms: payload.duration_ms })
    await updateMemory(q.id, payload.correct, payload.duration_ms)
  } catch (e) {
    console.error('复习记录失败：', e)
  }
}

// 更新 single 题的 SM-2
async function updateMemory(questionId: number, correct: boolean, durationMs: number | null, explicitQuality?: number) {
  const r = reviews.value.get(questionId)
  const now = new Date()
  const q = explicitQuality ?? calculateAutoQuality(correct, durationMs)
  const result = calculateNextReview(
    r?.last_review ? new Date(r.last_review) : now,
    q,
    r?.repetitions ?? 0,
    r?.ease_factor ?? 2.5,
    r?.interval ?? 0
  )
  // 2026-09-15 修复(P2-16)：缓存里的记录必须带 id。原代码 data 不含 id，同会话对同一题再次
  // 覆盖记忆自评时 `r?.id != null` 为假 → 又走 add（db.ts 的 addReviewRecord 是纯 insert 无 upsert）
  // → 同题重复 review_records 行并持续累加。update 路径回填既有主键；add 路径回填新插入行的主键
  //（addReviewRecord 返回 IDB 生成的 key，db.ts:645）。
  const data: any = {
    question_id: questionId,
    bank_id: current.value?.bank_id,
    last_review: now.toISOString(),   // 本次复习时间（2026-08-23 修复：此前误存为 nextReview）
    quality: q,
    repetitions: result.newRepetitions,
    ease_factor: result.newEaseFactor,
    interval: result.newInterval,
    // 2026-09-15 修复(P1-21)：原为 `result.nextReview.toISOString()`（ISO 串 + 锚定上次复习日 + 日历日），
    // 与小程序端的「纪元数字 + 锚定当下 + 固定 24h」三处都不同。统一走 computeNextReviewTs：
    // 纪元毫秒数字、锚定本次复习的当下（与 last_review 同一时刻）、日历日算术、间隔钳在 365 天内。
    // 三处分歧的完整说明见 spaced-repetition.ts 里 P1-21 的分节注释。
    next_review: computeNextReviewTs(result.newInterval, now.getTime()),
  }
  if (r?.id != null) {
    data.id = r.id
    await idb.updateReviewRecord(r.id, data)
  } else {
    data.id = await idb.addReviewRecord(data)
  }
  reviews.value.set(questionId, data)
  currentQualityLabel.value = qualityLabel(q)
}

// 手动覆盖记忆质量
async function overrideMemory(label: QualityLabel) {
  const q = current.value
  if (!q) return
  const quality = labelToQuality(label)
  await updateMemory(q.id, true, null, quality)
  toastSuccess(`已标记「${label}」`)
}

async function next() {
  if (practiceIdx.value < practiceQueue.value.length - 1) {
    practiceIdx.value++
    await refreshMemoryLabel()
  } else {
    // 完成
    await loadData()
    practicing.value = false
    // 修复(P1-30)：用会话累计值替换硬编码的 0
    // 复审 MF-5：`total` 也改用会话计数——原先 `practiceQueue.length` 与 correct/accuracy 的
    // 分母（sessionTotal）是两套口径，提前结束或重复作答时会打印出「共复习 1 题 · 正确 2 题」
    // 这种自相矛盾的数字。改后 `correct <= total` 恒成立。
    finishStats.value = {
      total: sessionTotal.value,
      correct: sessionCorrect.value,
      accuracy: sessionTotal.value > 0 ? Math.round((sessionCorrect.value / sessionTotal.value) * 100) : 0,
    }
  }
}

async function onToggleFavorite() {
  if (!current.value) return
  try {
    const nowFav = await api.toggleFavorite(current.value.bank_id, current.value.id)
    const next = new Set(favoriteIds.value)
    if (nowFav) next.add(current.value.id)
    else next.delete(current.value.id)
    favoriteIds.value = next
  } catch (e) {
    console.error('切换收藏失败：', e)
  }
}
</script>

<style scoped>
.memory { max-width: 860px; margin: 0 auto; padding: 20px; }
.memory-header { margin-bottom: 24px; }
.memory-header h2 { margin: 0 0 6px 0; }
.memory-header .sub { color: var(--color-text-tertiary); font-size: 13px; margin: 0; }
.exam-banner { margin: 12px 0 0; padding: 8px 14px; background: var(--color-warning-bg); border: 1px solid var(--color-warning-light); border-radius: var(--radius-md); color: var(--color-warning-text); font-size: 13px; display: inline-block; }
.exam-banner b { color: var(--color-warning-deep); }

.loading { text-align: center; padding: 48px; color: var(--color-text-tertiary); }

/* 复习范围选择器（2026-08-23 按题库独立） */
.scope-bar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
.scope-btn { display: inline-flex; align-items: center; gap: 4px; padding: 7px 14px; border: 1px solid var(--color-border); border-radius: 20px; background: var(--color-card); color: var(--color-text-secondary); font-size: 13px; cursor: pointer; transition: all 0.12s; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scope-btn:hover { border-color: var(--color-primary); color: var(--color-primary); transform: translateY(-1px); }
.scope-btn.active { background: var(--color-primary); color: #fff; border-color: var(--color-primary); font-weight: 500; }
.scope-count { font-size: 11px; font-weight: 700; background: var(--color-danger-bg); color: var(--color-danger-deep); border-radius: 10px; padding: 1px 6px; flex-shrink: 0; }
.scope-btn.active .scope-count { background: rgba(255,255,255,0.25); color: #fff; }

/* 概览 */
.overview { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
.ov-item { flex: 1; min-width: 140px; display: flex; flex-direction: column; align-items: center; padding: 18px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-lg); }
.ov-value { font-size: 32px; font-weight: 700; color: var(--color-primary); }
.ov-label { margin-top: 4px; font-size: 13px; color: var(--color-text-secondary); }
.ov-cap { display: block; font-size: 11px; color: var(--color-text-tertiary); margin-top: 2px; }

/* 分布 */
.dist-section { margin-bottom: 24px; padding: 18px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-lg); }
.dist-title { font-size: 14px; font-weight: 600; color: var(--color-text); margin-bottom: 12px; }
.dist-bar { display: flex; height: 14px; border-radius: 7px; overflow: hidden; background: var(--color-border-light); }
.dist-seg { height: 100%; transition: width 0.3s; }
.dist-seg.strong { background: var(--color-success-strong); }
.dist-seg.mid { background: var(--color-warning-strong); }
.dist-seg.weak { background: var(--color-danger-strong); }
.dist-seg.untracked { background: var(--color-border); }
.dist-legend { display: flex; gap: 16px; margin-top: 12px; flex-wrap: wrap; font-size: 12px; }
.dist-legend .lg { color: var(--color-text-secondary); }
.dist-legend .lg.strong { color: var(--color-success-deep); }
.dist-legend .lg.mid { color: var(--color-warning-text); }
.dist-legend .lg.weak { color: var(--color-danger-deep); }

/* 待复习 */
.due-section { margin-bottom: 24px; }
.due-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
.due-title { font-size: 16px; font-weight: 600; color: var(--color-text); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.due-cap { font-size: 12px; font-weight: 400; color: var(--color-text-tertiary); }
.deferred-tag { font-size: 11px; font-weight: 500; color: var(--color-warning-text); background: var(--color-warning-bg); padding: 2px 8px; border-radius: 10px; }
.deferred-hint { font-size: 12px; color: var(--color-text-tertiary); margin-top: 8px; }
.stale-tag { flex-shrink: 0; font-size: 11px; font-weight: 600; color: var(--color-warning-text); background: var(--color-warning-bg); padding: 2px 8px; border-radius: 10px; border: 1px solid var(--color-warning-light); }
.start-btn { padding: 8px 20px; background: var(--color-primary); color: #fff; border: none; border-radius: var(--radius-md); cursor: pointer; font-size: 14px; font-weight: 500; }
.start-btn:hover { background: var(--color-primary-dark); }
.due-list { list-style: none; padding: 0; margin: 0; }
.due-item { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border: 1px solid var(--color-border-light); border-radius: var(--radius-md); margin-bottom: 8px; background: var(--color-card); }
.due-item.st-strong { border-left: 4px solid var(--color-success-strong); }
.due-item.st-mid { border-left: 4px solid var(--color-warning-strong); }
.due-item.st-weak { border-left: 4px solid var(--color-danger-strong); }
.due-strength { flex-shrink: 0; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 10px; }
.st-strong .due-strength { background: var(--color-success-bg); color: var(--color-success-deep); }
.st-mid .due-strength { background: var(--color-warning-bg); color: var(--color-warning-text); }
.st-weak .due-strength { background: var(--color-danger-bg); color: var(--color-danger-deep); }
.due-text { flex: 1; font-size: 14px; color: var(--color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.due-meta { flex-shrink: 0; font-size: 11px; color: var(--color-text-tertiary); }

/* 薄弱 */
.weak-section { margin-bottom: 24px; }

/* 复习模式 */
.practice-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.practice-idx { font-size: 14px; color: var(--color-text-secondary); }
.exit-btn { padding: 6px 14px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); cursor: pointer; color: var(--color-text-secondary); font-size: 13px; }
.exit-btn:hover { background: var(--color-border-light); }

.memory-quality-bar { margin-top: 12px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px 14px; border: 1px dashed var(--color-border); border-radius: var(--radius-md); }
.mc-label { font-size: 12px; color: var(--color-text-secondary); font-weight: 600; }
.mc-btn { padding: 4px 14px; border: 1px solid var(--color-border); border-radius: 12px; background: var(--color-bg); color: var(--color-text-secondary); font-size: 12px; cursor: pointer; transition: all 0.12s; }
.mc-btn:hover { border-color: var(--color-primary); color: var(--color-primary); transform: translateY(-1px); }
.mc-btn.active { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }

/* 完成 / 空态 */
.finish-state { text-align: center; padding: 48px; }
.finish-state h3 { margin-bottom: 8px; }
.finish-state p { color: var(--color-text-secondary); margin-bottom: 20px; }
.empty-state { text-align: center; padding: 48px 24px; color: var(--color-text-tertiary); }
.empty-icon { font-size: 56px; margin-bottom: 10px; }
.empty-state p { margin-bottom: 8px; }
.empty-sub { font-size: 13px; }

@media (max-width: 768px) {
  .memory { padding: 14px; }
  .overview { gap: 8px; }
  .ov-item { min-width: 90px; padding: 12px; }
  .ov-value { font-size: 24px; }
  .ov-cap { font-size: 10px; }
  .scope-bar { gap: 6px; margin-bottom: 16px; }
  .scope-btn { padding: 6px 10px; font-size: 12px; max-width: 140px; }
  .exam-banner { font-size: 12px; padding: 6px 10px; }
  .due-section { margin-bottom: 16px; }
  .due-head { flex-direction: column; align-items: flex-start; gap: 8px; }
  .due-title { font-size: 14px; }
  .start-btn { width: 100%; text-align: center; }
  .due-item { flex-wrap: wrap; padding: 10px 12px; gap: 6px; }
  .due-text { white-space: normal; font-size: 13px; }
  .due-meta { width: 100%; }
  .practice-top { flex-direction: column; align-items: flex-start; gap: 8px; }
  .exit-btn { width: 100%; text-align: center; }
  .memory-quality-bar { flex-wrap: wrap; gap: 6px; padding: 8px 10px; }
  .mc-btn { padding: 6px 12px; font-size: 12px; }
  .dist-section { padding: 14px; }
  .dist-legend { gap: 10px; }
  .weak-section { margin-bottom: 16px; }
}
</style>
