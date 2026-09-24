<template>
  <div class="public-practice">
    <button class="back-btn" @click="$router.push('/')">← 返回首页</button>

    <div v-if="loading" class="center">加载公共题库题目中...</div>

    <div v-else-if="loadError" class="center">
      <div class="empty-icon">⚠️</div>
      <p>{{ loadError }}</p>
      <button class="retry-btn" @click="retryLoad">🔄 重试</button>
    </div>

    <div v-else-if="!bank" class="center">
      <div class="empty-icon">🔍</div>
      <p>题库不存在或已下线</p>
    </div>

    <div v-else-if="!allQuestions.length" class="center">
      <div class="empty-icon">📭</div>
      <p>该题库暂无题目</p>
    </div>

    <!-- 全题型被排除：order 为空，不渲染题目卡（避免 currentQuestion.type 白屏） -->
    <div v-else-if="!order.length" class="center">
      <div class="empty-icon">🔎</div>
      <p>当前筛选条件下没有题目</p>
      <button class="retry-btn" @click="clearTypeFilter">清除筛选</button>
    </div>

    <div v-else>
      <!-- 顶栏：题库名 + 进度 + 模式 -->
      <div class="topbar main-bar">
        <div class="main-left">
          <span class="bank-name">🌍 {{ bank.name }}</span>
          <span class="bank-creator" v-if="bank.creator_name">👤 {{ bank.creator_name }}</span>
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
            <!-- 2026-09-15 修复(P1-31)：按产品裁定**移除**「模拟考试」选项（而非实现）。
                 该模式从未实现：本文件里 `mode` 只在 :218 与 'random' 比较过一次，
                 移除后本文件再不含 'exam' 字面串（控制端实测；「全项目范围」未穷举，故意不声称）
                 ——无倒计时、无延迟判分、无成绩页，选了什么都不发生，留着是误导。
                 实现完整考试模式属新增功能，超出本次修复授权。 -->
          </select>
          <label class="shuffle-toggle" title="打乱选项顺序">
            <input type="checkbox" v-model="shuffleOptions" />
            🔀 乱序
          </label>
        </div>
      </div>

      <!-- 题型筛选 -->
      <div class="tool-bar" v-if="availableTypes.length > 1">
        <span class="filter-label">题型:</span>
        <button
          v-for="t in availableTypes"
          :key="t"
          class="type-chip-btn"
          :class="{ active: !typeFilter.includes(t) }"
          @click="toggleTypeFilter(t)"
        >{{ t }}</button>
        <button class="restart-btn" @click="restart">从头开始</button>
      </div>

      <!-- 题目卡片 -->
      <div class="question-card">
        <div class="q-stem">
          <span class="q-idx">{{ current + 1 }}.</span>
          <span class="q-type">{{ typeLabel(currentType) }}</span>
          <span class="q-text">{{ currentQuestion.stem }}</span>
        </div>

        <!-- 选择题 -->
        <div v-if="isChoice" class="options">
          <button v-for="(opt, i) in displayOptions" :key="i" class="option"
            :class="{ selected: selectedDisplay.includes(i), correct: showResult && isCorrectOption(i), wrong: showResult && selectedDisplay.includes(i) && !isCorrectOption(i) }"
            @click="toggleOption(i)">
            <span class="letter">{{ String.fromCharCode(65 + i) }}</span> {{ opt }}
            <span v-if="showResult && isCorrectOption(i)" class="opt-mark">✓</span>
          </button>
        </div>

        <!-- 判断题（含存成 single 的云端判断题） -->
        <div v-else-if="currentType === 'judge'" class="options">
          <button class="option" :class="{ selected: currentAnswer.judge === true, correct: showResult && isJudgeTrue === true, wrong: showResult && currentAnswer.judge === true && isJudgeTrue === false }" @click="currentAnswer.judge = true">√ 正确</button>
          <button class="option" :class="{ selected: currentAnswer.judge === false, correct: showResult && isJudgeTrue === false, wrong: showResult && currentAnswer.judge === false && isJudgeTrue === true }" @click="currentAnswer.judge = false">× 错误</button>
        </div>

        <!-- 填空/问答 -->
        <div v-else class="blank">
          <textarea v-model="currentAnswer.blank" placeholder="输入你的答案" rows="4"></textarea>
        </div>

        <!-- 09-24：A 类存疑题（答案不改、判分仍以题库为准）标出口径分歧。
             本页有自己的一套卡片标记，不走 QuestionCard，所以两处都要改。 -->
        <div v-if="showResult && (currentQuestion as any).answer_conflict === 'doubt'" class="doubt-note">
          ⚠ 本题口径与现行规程有别<span v-if="(currentQuestion as any).answer_conflict_note">：{{ (currentQuestion as any).answer_conflict_note }}</span>
        </div>

        <!-- 解析 -->
        <!-- 09-24：本页原来对答对答错一律铺开，与本地练习页相反；统一成「答错默认展开、答对可点开」 -->
        <div v-if="showResult && currentQuestion.analysis" class="analysis-box">
          <button v-if="!anaVisible" class="ana-open-btn" @click="anaManual = true">看解析<span class="ai-tag">AI 生成，仅供参考</span></button>
          <template v-else>
            <div class="ana-head">💡 解析<span class="ai-tag">AI 生成，仅供参考</span>
              <button v-if="isCurrentCorrect" class="ana-collapse-btn" @click="anaManual = false">收起</button>
            </div>
            <div>{{ currentQuestion.analysis }}</div>
            <p class="ai-foot">答案与题干来自题库原文；解析由 AI 批量生成，可能随规程更新而过时。</p>
          </template>
        </div>

        <!-- 导航 -->
        <div class="nav-row">
          <button class="nav-btn" :disabled="current === 0" @click="current--">← 上一题</button>
          <button v-if="showResult" class="nav-btn success" @click="nextQuestion">
            {{ current < order.length - 1 ? '下一题 →' : '完成 ✓' }}
          </button>
          <button v-else class="nav-btn primary" @click="checkAnswer">确认答案</button>
        </div>
      </div>

      <!-- 题号导航 -->
      <div class="dot-nav">
        <button v-for="(q, i) in order" :key="i" class="dot"
          :class="{ current: i === current, answered: isAnswered(q.id), correct: answeredStatus[String(q.id)] === true, wrong: answeredStatus[String(q.id)] === false }"
          @click="current = i">{{ i + 1 }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { listPublicBankQuestions, type ExamQuestion } from '../lib/exam'

interface StudentAnswer { selected: number[]; blank: string; judge: boolean | null }

const route = useRoute()
const bankId = String(route.params.bankId)
const bankName = String(route.params.bankName || '')
const bank = ref<{ name: string; creator_name?: string } | null>(null)

const allQuestions = ref<ExamQuestion[]>([])
const loading = ref(true)
const loadError = ref('')   // 加载失败时展示具体原因，不再静默
const current = ref(0)
// T8b（2026-09-16）：`ExamQuestion.id` 已如实放宽为 `number | string`，下面两个映射都是**对象键**
// 类消费方 → 键类型改成 `string`，读写一律走 `String(id)`（见 `currentAnswer` / `checkAnswer` / 模板 dot-nav）。
// 数字 id 常态下运行时行为逐字节不变（JS 对象键本来就会被字符串化）；
// 而 `_id` 兜底触发时也不会像 `Number(id)` 那样把整库塌成同一个 `NaN` 键。
const answers = ref<Record<string, StudentAnswer>>({})
const answeredStatus = ref<Record<string, boolean>>({})
const showResult = ref(false)
// 09-24：答对时默认收起解析，但留「看解析」入口；答错/未答对则直接铺开。换题重置手动态。
const anaManual = ref(false)
const isCurrentCorrect = computed(() => {
  const id = currentQuestion.value && (currentQuestion.value as any).id
  return id !== undefined && id !== null && answeredStatus.value[String(id)] === true
})
const anaVisible = computed(() => !isCurrentCorrect.value || anaManual.value)
watch(current, () => { anaManual.value = false })
const mode = ref<'order' | 'random'>('order')   // 2026-09-15 修复(P1-31)：'exam' 随选项一并移除（从未实现）
const typeFilter = ref<string[]>([])

// 选项乱序：打乱选择题展示顺序，answers 存原始下标（判分零改动）；localStorage 持久化，默认关
const shuffleOptions = ref(localStorage.getItem('pub_practice_shuffle') === '1')
// displayMap[displayIdx] = 原始下标；切题/切开关时重算
const displayMap = ref<number[]>([])
function buildDisplayMap() {
  const q = currentQuestion.value
  const n = q?.options ? safeParseOptions(q.options).length : 0
  const idx = Array.from({ length: n }, (_, i) => i)
  if (shuffleOptions.value && n > 2 && !isJudgeQuestion()) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[idx[i], idx[j]] = [idx[j], idx[i]]
    }
    if (idx.every((v, i) => v === i) && n > 1) {
      ;[idx[0], idx[1]] = [idx[1], idx[0]]
    }
  }
  displayMap.value = idx
}
function safeParseOptions(opts: string | null): string[] {
  if (!opts) return []
  try { return JSON.parse(opts) } catch { return [] }
}
// 规范化题型：云端判断题可能存 type:'single' + 选项[正确,错误]/[对,错]，统一识别为 judge
function normType(q: ExamQuestion | null | undefined): string {
  if (!q) return 'single'
  const t = q.type || 'single'
  if (t === 'judge') return 'judge'
  if (t === 'single' || t === 'multi') {
    const opts = safeParseOptions(q.options)
    if (opts.length === 2) {
      const clean = opts.map(o => (o || '').replace(/^[A-Ha-h][.、:：)]?\s*/i, '').trim())
      if ((clean[0] === '正确' && clean[1] === '错误') || (clean[0] === '对' && clean[1] === '错')) return 'judge'
    }
  }
  return t
}
// 判断题（type=judge，或选项恰为「正确/错误」的 single 存储形式）不做乱序
function isJudgeQuestion(): boolean {
  const q = currentQuestion.value
  if (!q) return false
  if (normType(q) === 'judge') return true
  return false
}
function toRawIndex(displayIdx: number): number {
  if (!shuffleOptions.value) return displayIdx
  return displayMap.value[displayIdx] ?? displayIdx
}
// 当前选中项的展示下标（反查）
const selectedDisplay = computed<number[]>(() => {
  const raw = currentAnswer.value.selected
  if (!shuffleOptions.value || !displayMap.value.length) return raw
  return raw.map(r => displayMap.value.indexOf(r)).filter(i => i >= 0)
})

// 筛选后的题目集合（顺序/随机两个模式共用同一口径）
const filteredQuestions = computed(() => allQuestions.value.filter(q => !typeFilter.value.includes(normType(q))))
// 2026-09-15 修复(P2-23)：随机顺序不再放进 computed——原实现每次重新求值（mode/typeFilter/题目
// 任何变化）都 Math.random 重洗全卷，学生做题中途会被静默重排；且 sort(() => Math.random() - 0.5)
// 是已知有偏洗牌。改为随机快照 ref：仅当筛选集合变化时用 Fisher-Yates 重排一次
//（与 PracticeView/MixExamView 同法），切模式不重洗。
const randomOrder = ref<ExamQuestion[]>([])
watch(filteredQuestions, (list) => {
  const arr = [...list]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  randomOrder.value = arr
}, { immediate: true })

const order = computed(() => {
  return mode.value === 'random' ? randomOrder.value : filteredQuestions.value
})
const currentQuestion = computed(() => order.value[current.value] || null)
// 显示类型（规范化后），供 q-type 标签使用
const currentType = computed(() => normType(currentQuestion.value))
const currentAnswer = computed<StudentAnswer>(() => {
  const q = currentQuestion.value
  if (!q) return { selected: [], blank: '', judge: null }
  const k = String(q.id)   // T8b：对象键归一，见上面 answers 的声明注释
  if (!answers.value[k]) answers.value[k] = { selected: [], blank: '', judge: null }
  return answers.value[k]
})
const parsedOptions = computed<string[]>(() => {
  const q = currentQuestion.value
  if (!q?.options) return []
  try { return JSON.parse(q.options) } catch { return [] }
})
// 展示选项（乱序时按 displayMap 重排）
const displayOptions = computed<string[]>(() => {
  const opts = parsedOptions.value
  if (!shuffleOptions.value || !displayMap.value.length) return opts
  return displayMap.value.map(i => opts[i]).filter(Boolean)
})
// 选择题判定也用规范化类型：存成 single 的判断题不渲染选择按钮，走判断题分支
const isChoice = computed(() => {
  const t = normType(currentQuestion.value)
  return t === 'single' || t === 'multi'
})
// 题型按钮列表：按规范化类型聚合（判断题不再缺失）
const availableTypes = computed(() => [...new Set(allQuestions.value.map(q => normType(q)))])
const totalCount = computed(() => order.value.length)

function typeLabel(t: string) {
  return { single: '单选', multi: '多选', judge: '判断', blank: '填空', qa: '问答' }[t] || t
}
function toggleTypeFilter(t: string) {
  const idx = typeFilter.value.indexOf(t)
  if (idx >= 0) typeFilter.value.splice(idx, 1)
  else typeFilter.value.push(t)
  current.value = 0
  showResult.value = false
}
function toggleOption(i: number) {
  const q = currentQuestion.value
  if (!q || showResult.value) return
  const a = currentAnswer.value
  const raw = toRawIndex(i)
  // 判断题（含存成 single 的）不在这里处理，走判断题按钮
  if (normType(q) === 'judge') return
  if (normType(q) === 'single') a.selected = [raw]
  else {
    const idx = a.selected.indexOf(raw)
    if (idx >= 0) a.selected.splice(idx, 1)
    else a.selected.push(raw)
  }
}
function isCorrectOption(i: number): boolean {
  const q = currentQuestion.value
  if (!q) return false
  const correct = parseAnswerLetters(q.answer)
  const raw = toRawIndex(i)
  return correct.includes(raw)
}
function parseAnswerLetters(answer: string | null): number[] {
  if (!answer) return []
  try {
    const arr = JSON.parse(answer) as string[]
    return arr.map(s => s.trim().toUpperCase().charCodeAt(0) - 65)
  } catch {
    return answer.split('').filter(c => /[A-Ha-h]/.test(c)).map(c => c.toUpperCase().charCodeAt(0) - 65)
  }
}
function checkAnswer() {
  const q = currentQuestion.value
  if (!q) return
  const a = currentAnswer.value
  const isCorrect = judge(q, a)
  answeredStatus.value[String(q.id)] = isCorrect   // T8b：对象键归一，与 dot-nav 的读侧同口径
  showResult.value = true
}
// 判断题正确答案（兼容云端存成 single 的判断题）：
// 返回 true=正确 / false=错误 / null=未知
const isJudgeTrue = computed<boolean | null>(() => isJudgeTrueFor(currentQuestion.value))
function judge(q: ExamQuestion, a: StudentAnswer): boolean {
  const t = normType(q)
  if (t === 'single' || t === 'multi') {
    // 2026-09-14 修复(P0-7)：两边都要排序。存储侧不排序，答案键写作 "CA" 时
    // correctLetters=[2,0] 而 picked=[0,2] → 选对了也恒判错（与 exam.ts 的 checkAnswer 同因）
    const correctLetters = parseAnswerLetters(q.answer).sort((x, y) => x - y)
    const picked = [...a.selected].sort((x, y) => x - y)
    return JSON.stringify(picked) === JSON.stringify(correctLetters)
  }
  if (t === 'judge') {
    // 判断题判分：a.judge 与正确答案比对
    const correct = isJudgeTrueFor(q)
    if (correct === null || a.judge === null) return false
    return a.judge === correct
  }
  if (!q.answer) return false
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '')
  return norm(a.blank) === norm(q.answer)
}
// 独立函数：给单题返回判断题正确答案（computed 之外的场合可用）
function isJudgeTrueFor(q: ExamQuestion | null): boolean | null {
  if (!q || normType(q) !== 'judge') return null
  const opts = safeParseOptions(q.options)
  const clean = opts.map(o => (o || '').replace(/^[A-Ha-h][.、:：)]?\s*/i, '').trim())
  const ans = q.answer
  if (ans == null) return null
  const s = String(ans).trim()
  if (s === 'true') return true
  if (s === 'false') return false
  try {
    const arr = JSON.parse(s) as string[]
    const first = String(arr[0] || '').trim().toUpperCase()
    if (first === '正确' || first === '√' || first === '对') return true
    if (first === '错误' || first === '×' || first === '错') return false
    const letterIdx = first.charCodeAt(0) - 65
    if (letterIdx >= 0 && letterIdx < opts.length) return clean[letterIdx] === '正确'
    if (arr.length === 2 && clean.length === 2) return clean[0] === '正确'
    return null
  } catch {
    const c = s.toUpperCase().charCodeAt(0) - 65
    if (c >= 0 && c < opts.length) return clean[c] === '正确'
    if (s === '正确' || s === '√' || s === '对') return true
    if (s === '错误' || s === '×' || s === '错') return false
    return null
  }
}
function clearTypeFilter() {
  typeFilter.value = []
  current.value = 0
  showResult.value = false
}
function nextQuestion() {
  showResult.value = false
  if (current.value < order.value.length - 1) current.value++
  else {
    // 完成
    const answered = Object.values(answeredStatus.value).filter(Boolean).length
    alert(`🎉 已刷完 ${order.value.length} 题，答对 ${answered} 题！`)
    current.value = 0
    showResult.value = false
  }
}
function restart() {
  current.value = 0
  showResult.value = false
  answers.value = {}
  answeredStatus.value = {}
}

// 切题/切开关时重算选项乱序映射
watch([current, shuffleOptions], () => {
  localStorage.setItem('pub_practice_shuffle', shuffleOptions.value ? '1' : '0')
  buildDisplayMap()
  showResult.value = false
})

// 2026-09-15 修复(P2-23)：切换模式时重置到第一题——原实现 current 不重置，
// 顺序切随机（两份顺序不同）会把学生传送到无关题目。与 toggleTypeFilter 同口径。
watch(mode, () => {
  current.value = 0
  showResult.value = false
})

async function retryLoad() {
  loading.value = true
  loadError.value = ''
  try {
    allQuestions.value = await listPublicBankQuestions(bankId)
    if (!allQuestions.value.length) loadError.value = '题库暂无题目或云端不可用'
    else buildDisplayMap()
  } catch (e: any) {
    loadError.value = e?.message || '加载失败，请检查网络后重试'
  } finally {
    loading.value = false
  }
}
// T8b：形参跟着 `ExamQuestion.id` 一起放宽为 `number | string`（模板 dot-nav 传的就是 `q.id`）。
// 内部仍用 String() 归一成对象键，与旧的 `answers.value[qid]` 逐字节同效。
function isAnswered(qid: number | string) {
  const a = answers.value[String(qid)]
  return !!(a && (a.selected.length || a.blank || a.judge !== null))
}

onMounted(async () => {
  try {
    bank.value = { name: bankName || '公共题库' }
    allQuestions.value = await listPublicBankQuestions(bankId)
    if (!allQuestions.value.length) {
      loadError.value = '题库暂无题目或云端不可用'
    } else {
      buildDisplayMap()
    }
  } catch (e: any) {
    console.warn('加载公共题库失败:', e)
    loadError.value = e?.message || '加载失败，请检查网络后重试'
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.back-btn { padding: 6px 14px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); cursor: pointer; font-size: 13px; margin-bottom: 16px; color: var(--color-text); }
.back-btn:hover { background: var(--color-border-light); }
.center { text-align: center; padding: 80px 24px; color: var(--color-text-tertiary); }
.empty-icon { font-size: 64px; margin-bottom: 12px; opacity: 0.5; }
.retry-btn { margin-top: 16px; padding: 8px 22px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); cursor: pointer; font-size: 13px; color: var(--color-text); }
.retry-btn:hover { background: var(--color-border-light); }

.topbar { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-md); margin-bottom: 10px; flex-wrap: wrap; }
.main-left { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 150px; }
.bank-name { font-weight: 600; font-size: 15px; }
.bank-creator { font-size: 12px; color: var(--color-text-secondary); background: var(--color-border-light); padding: 2px 8px; border-radius: 10px; }
.main-progress { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 140px; }
.progress-text { font-size: 12px; color: var(--color-text-secondary); font-family: monospace; white-space: nowrap; }
.progress-track { flex: 1; height: 6px; background: var(--color-border-light); border-radius: 3px; overflow: hidden; }
.progress-fill { height: 100%; background: linear-gradient(90deg, var(--color-primary), var(--color-primary-dark)); border-radius: 3px; transition: width 0.3s; }
.mode-select { padding: 6px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); color: var(--color-text); font-size: 13px; }
.shuffle-toggle { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--color-text-secondary); cursor: pointer; white-space: nowrap; }
.shuffle-toggle input { accent-color: var(--color-primary); }
.tool-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; padding: 8px 12px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-md); }
.filter-label { font-size: 12px; color: var(--color-text-tertiary); }
.type-chip-btn { padding: 5px 12px; border: 1px solid var(--color-border); border-radius: 16px; background: var(--color-card); cursor: pointer; font-size: 12px; color: var(--color-text-secondary); }
.type-chip-btn.active { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
.restart-btn { padding: 6px 14px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); cursor: pointer; font-size: 13px; color: var(--color-text); }

.question-card { padding: 24px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-lg); margin-bottom: 14px; }
.q-stem { font-size: 16px; line-height: 1.6; margin-bottom: 18px; }
.q-idx { font-weight: bold; margin-right: 6px; }
.q-type { padding: 2px 8px; background: var(--color-border-light); border-radius: var(--radius-sm); font-size: 12px; margin-right: 8px; }
.options { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.option { text-align: left; padding: 12px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); cursor: pointer; color: var(--color-text); position: relative; }
.option.selected { border-color: var(--color-primary); background: var(--color-primary-light); }
.option.correct { border-color: #16a34a; background: #f0fdf4; }
.option.wrong { border-color: #dc2626; background: #fee2e2; }
.letter { font-weight: bold; margin-right: 8px; }
.opt-mark { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); color: #16a34a; font-weight: bold; }
.blank { margin-bottom: 16px; }
.blank textarea { width: 100%; padding: 10px; border: 1px solid var(--color-border); border-radius: var(--radius-md); font-size: 14px; background: var(--color-card); color: var(--color-text); font-family: inherit; resize: vertical; }
.analysis-box { padding: 10px 14px; background: #fffbeb; border-left: 3px solid #f59e0b; border-radius: 4px; font-size: 13px; color: #92400e; line-height: 1.5; margin-bottom: 16px; }
.nav-row { display: flex; justify-content: space-between; gap: 10px; }
.nav-btn { padding: 8px 18px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); cursor: pointer; font-size: 13px; color: var(--color-text); }
.nav-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.nav-btn.primary { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
.nav-btn.success { background: #16a34a; color: #fff; border-color: #16a34a; }
.dot-nav { display: flex; flex-wrap: wrap; gap: 5px; padding: 14px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-md); }
.dot { min-width: 30px; height: 30px; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-card); color: var(--color-text-secondary); font-size: 12px; cursor: pointer; }
.dot.answered { background: var(--color-primary-light); border-color: var(--color-primary); color: var(--color-primary); }
.dot.current { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
.dot.correct { background: #dcfce7; border-color: #16a34a; color: #15803d; }
.dot.wrong { background: #fee2e2; border-color: #dc2626; color: #b91c1c; }

@media (max-width: 768px) {
  .question-card { padding: 16px; }
  .q-stem { font-size: 15px; }
  .main-left { min-width: 0; flex: 1 1 100%; }
}
.doubt-note { margin-bottom: 12px; padding: 8px 12px; font-size: 13px; line-height: 1.5; border-radius: 4px;
  color: #a15c00; background: #fff4d6; border-left: 3px solid #f59e0b; }
.analysis-box .ana-head { font-weight: 600; margin-bottom: 4px; }
.analysis-box .ai-tag { display: inline-block; margin-left: 6px; padding: 1px 6px; font-size: 11px; font-weight: 600;
  color: #6b7280; background: #f3f4f6; border: 1px solid #d0d5dd; border-radius: 10px; }
.analysis-box .ai-foot { margin: 6px 0 0; font-size: 11px; color: #6b7280; }
.analysis-wrap { margin-top: 14px; }
.ana-open-btn { padding: 5px 12px; font-size: 12px; cursor: pointer; color: #6b7280;
  background: #f3f4f6; border: 1px solid #d0d5dd; border-radius: 14px; }
.analysis-box .ana-collapse-btn { float: right; margin-left: 8px; padding: 1px 8px; font-size: 11px;
  cursor: pointer; color: #6b7280; background: transparent; border: 1px solid #d0d5dd; border-radius: 10px; }
</style>
