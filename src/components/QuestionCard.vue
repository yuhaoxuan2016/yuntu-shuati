<template>
  <div class="qcard">
    <div class="stem" :class="{ 'no-toolbar': examMode }">
      <span class="idx">{{ index + 1 }}.</span>
      <span class="type-tag">{{ typeLabel }}</span>
      <span v-if="elapsedSecs !== null" class="timer" title="本题用时">{{ formatTime(elapsedSecs) }}</span>
      <span class="stem-text"><StemText :stem="question.stem" :images="(question as any).images || null" /></span>
      <!-- 右上角操作按钮组（考试模式/回顾模式下隐藏，防作弊） -->
      <div v-if="!examMode && !readOnly" class="card-toolbar">
        <button class="tool-btn" :class="{ active: favorited }" :title="favorited ? '取消收藏' : '收藏本题'" @click="$emit('toggle-favorite')">
          {{ favorited ? '★' : '☆' }}
        </button>
        <button class="tool-btn" title="编辑本题" @click="showEdit = true">✎</button>
        <button class="tool-btn ai" :disabled="analyzing" :title="analyzing ? 'AI 解析中…' : 'AI 详细解析'" @click="analyze">🤖</button>
      </div>
    </div>

    <!-- 选择题 -->
    <!-- P2-14：readOnly（复盘/只读回顾）与 submitted 同等对待，否则未答题的卡片在复盘里仍可点选 -->
    <div v-if="isChoice" class="options">
      <button
        v-for="(opt, i) in options"
        :key="i"
        class="option"
        :class="optionClass(i)"
        :disabled="submitted || readOnly"
        @click="toggle(i)"
      >
        <span class="letter">{{ letter(i) }}</span> {{ opt }}
      </button>
    </div>

    <!-- 判断题 -->
    <div v-else-if="isJudgeQuestion()" class="options">
      <button class="option" :class="judgeClass(true)" :disabled="submitted || readOnly" @click="answerJudge(true)">√ 正确</button>
      <button class="option" :class="judgeClass(false)" :disabled="submitted || readOnly" @click="answerJudge(false)">× 错误</button>
    </div>

    <!-- 填空/问答 -->
    <div v-else class="blank">
      <textarea v-model="blankAnswer" :disabled="submitted || readOnly" placeholder="输入你的答案"></textarea>
    </div>

    <div class="actions">
      <button v-if="hasPrev && !readOnly" class="act-btn ghost" @click="manualPrev">← 上一题</button>
      <!-- 2026-08-20：deferSubmit 考试模式交卷前不锁定，点选后手动下一题；交卷统一判分 -->
      <!-- P2-14：readOnly（复盘）下隐藏「确认答案」，避免只读卡片被"作答"并 emit('answered') -->
      <!-- P2-15：判断题直接点 √/× 即判分（answerJudge），不需要「确认答案」；旧实现该按钮对判断题
           可见，未选就点会把卡片锁死为「✗ 回答错误」且从不 emit('answered')（见 submit 里的防御性判断） -->
      <button v-if="!submitted && !deferSubmit && !readOnly && !isJudgeQuestion()" class="act-btn primary" @click="submit">确认答案</button>
      <button v-if="!submitted && deferSubmit" class="act-btn primary" @click="manualNext">下一题 →</button>
      <button v-if="submitted && (!isSelfEval || selfEvalDone) && !readOnly" class="act-btn primary" @click="manualNext">下一题 →</button>
      <!-- 2026-09-15 修复(P1-30 复审 MF-5)：这两个自评按钮此前缺 `!selfEvalDone` 锁，
           点过一次后仍然可点 ⇒ 同一题重复 emit('answered') ⇒ 复习页把一题计成两题
           （面板能打印「共复习 1 题 · 正确 2 题」），且 recordPractice/updateMemory 副作用走两遍。
           判据与上面「下一题」按钮的 `selfEvalDone` 保持一致。 -->
      <button v-if="submitted && !selfEvalDone && !isChoice && !isJudgeQuestion() && !readOnly" class="act-btn success" @click="selfEval(true)">✓ 答对</button>
      <button v-if="submitted && !selfEvalDone && !isChoice && !isJudgeQuestion() && !readOnly" class="act-btn danger" @click="selfEval(false)">✗ 答错</button>
    </div>

    <QuestionEditDialog :visible="showEdit" :question="question" @close="showEdit = false" @saved="onQuestionSaved" />

    <div class="hint" v-if="!submitted">快捷键：{{ keyHint }}</div>

    <div v-if="submitted" class="feedback" :class="{ correct: isCorrect, exam: examMode }">
      <template v-if="examMode">
        <p>✓ 已作答（考试模式不立即显示对错）</p>
      </template>
      <template v-else>
        <p v-if="isSelfEval && !selfEvalDone">请对照参考答案自评</p>
        <p v-else-if="!question.answer && isJudgeQuestion()">⚠ 参考答案缺失，无法判定对错</p>
        <p v-else>{{ isCorrect ? '✓ 回答正确' : '✗ 回答错误' }}</p>
        <p>正确答案：{{ displayAnswer }}</p>
        <div v-if="question.analysis" class="analysis">
          <strong>解析：</strong>{{ question.analysis }}
        </div>
      </template>
    </div>

    <div v-if="aiAnalysis" class="ai-analysis">
      <!-- 标题区 -->
      <div class="ai-header">
        <span class="ai-header-icon">🤖</span>
        <span>AI 详细解析</span>
        <span class="ai-header-badge">由 AI 生成，仅供参考</span>
      </div>

      <!-- 知识点 -->
      <div v-if="aiAnalysis.knowledge_point" class="ai-section knowledge">
        <div class="ai-section-title">
          <span class="icon">📌</span>
          <span>考查的知识点</span>
        </div>
        <div class="ai-section-body">{{ aiAnalysis.knowledge_point }}</div>
      </div>

      <!-- 背景知识 -->
      <div v-if="aiAnalysis.background" class="ai-section background">
        <div class="ai-section-title">
          <span class="icon">📚</span>
          <span>相关背景</span>
        </div>
        <div class="ai-section-body">{{ aiAnalysis.background }}</div>
      </div>

      <!-- 选项解析 -->
      <div v-if="aiAnalysis.option_analysis && aiAnalysis.option_analysis.length" class="ai-section">
        <div class="ai-section-title">
          <span class="icon">📋</span>
          <span>逐项分析</span>
          <span class="ai-section-count">共 {{ aiAnalysis.option_analysis.length }} 项</span>
        </div>
        <div class="ai-options">
          <div v-for="(oa, i) in aiAnalysis.option_analysis" :key="i" class="ai-option-row" :class="isOptCorrect(oa.verdict) ? 'is-correct' : 'is-wrong'">
            <div class="ai-option-head">
              <span class="ai-option-letter">{{ oa.letter }}</span>
              <span class="ai-option-verdict">
                <span v-if="isOptCorrect(oa.verdict)">✓ 正确</span>
                <span v-else>✗ 错误</span>
              </span>
            </div>
            <div class="ai-option-reason">{{ oa.reason }}</div>
          </div>
        </div>
      </div>

      <!-- 参考答案 -->
      <div v-if="aiAnalysis.reference_explanation" class="ai-section reference">
        <div class="ai-section-title">
          <span class="icon">✅</span>
          <span>参考答案解析</span>
        </div>
        <div class="ai-section-body">{{ aiAnalysis.reference_explanation }}</div>
      </div>

      <!-- 常见错误 -->
      <div v-if="aiAnalysis.common_mistakes" class="ai-section warning">
        <div class="ai-section-title">
          <span class="icon">⚠️</span>
          <span>常见错误</span>
        </div>
        <div class="ai-section-body">{{ aiAnalysis.common_mistakes }}</div>
      </div>

      <!-- 解题技巧 -->
      <div v-if="aiAnalysis.solving_skill" class="ai-section tip">
        <div class="ai-section-title">
          <span class="icon">💡</span>
          <span>解题技巧 / 记忆口诀</span>
        </div>
        <div class="ai-section-body">{{ aiAnalysis.solving_skill }}</div>
      </div>
    </div>
    <div v-if="aiError" class="ai-error">{{ aiError }}</div>
  </div>
</template>

<script setup lang="ts">
import StemText from './StemText.vue'
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { api, Question } from '../utils/api'
import { toastError } from '../utils/toast'
// 判断题真值判定与判分/组卷共用 exam.ts 的同一份实现（1(a) 收敛，勿在本文件重建副本）
import { judgeAnswerBool as judgeAnswerBoolShared } from '../lib/exam'
// 选项乱序种子用仓库唯一的字符串哈希（GC3 冻结文件，只导入不修改）
import { simpleHash } from '../lib/spaced-repetition'
import QuestionEditDialog from './QuestionEditDialog.vue'

export interface QuestionState {
  selected: number[]
  blankAnswer: string
  submitted: boolean
  isCorrect: boolean
  selfEvalDone: boolean
  judgeSelected: boolean | null
  elapsedSecs: number | null
}

const props = defineProps<{
  question: Question
  index: number
  autoNext?: boolean
  hasPrev?: boolean
  savedState?: QuestionState | null
  favorited?: boolean
  examMode?: boolean
  shuffleOptions?: boolean   // 选项乱序：打乱选项展示顺序，判分/答案高亮随映射自动对齐
  deferSubmit?: boolean      // 2026-08-20：考试模式交卷前不锁定答案（点选只高亮，交卷统一判分，可随时修改）
  readOnly?: boolean         // 2026-08-20：只读回顾（交卷后回看，隐藏工具栏与操作按钮）
}>()
const emit = defineEmits<{
  (e: 'answered', payload: { correct: boolean; answer: string; duration_ms: number | null }): void
  (e: 'state-change', state: QuestionState): void
  (e: 'next'): void
  (e: 'prev'): void
  (e: 'toggle-favorite'): void
  (e: 'question-updated', q: Question): void
}>()

// 从保存的状态恢复（返回上一题时能看到之前的答案）
const saved = props.savedState

// 原始选项（按题目存储顺序）——必须先于 displayMap 定义，
// 否则 displayMap 的 IIFE 在顶层立即执行时会触发 TDZ 错误（Cannot access 'rawOptions' before initialization），
// 导致整个 QuestionCard setup 崩溃、题目卡消失（题号导航在父组件不受影响）。
const rawOptions = computed<string[]>(() => {
  if (!props.question.options) return []
  try {
    return JSON.parse(props.question.options)
  } catch {
    return []
  }
})

// 判断题（type=judge，或选项恰为「正确/错误」「对/错」的 single 存储形式）不做乱序，保持固定顺序
function isJudgeQuestion(): boolean {
  if (props.question.type === 'judge') return true
  const opts = rawOptions.value
  if (opts.length === 2) {
    const t = opts.map(o => (o || '').replace(/^[A-H][.、:：)]?\s*/i, '').trim())
    return (t[0] === '正确' && t[1] === '错误') || (t[0] === '对' && t[1] === '错')
  }
  return false
}

// 选项乱序映射：使用computed确保question属性变化时自动更新
// displayMap[displayIdx] = 原始下标；乱序关闭时即恒等映射 [0,1,2,...]。
const displayMap = computed<number[]>(() => {
  const n = rawOptions.value.length
  const idx = Array.from({ length: n }, (_, i) => i)
  if (props.shuffleOptions && n > 2 && !isJudgeQuestion()) {
    // 种子：**字符串**哈希（P2-24 + 控制端裁定）。旧实现 `const seed = props.question.id || 0`
    // 之后直接对该值做 LCG 乘法，只在 id 是 number 时成立；一旦被喂字符串 id（例如将来复用本组件
    // 承载 ExamQuestion，其 id 在云端 `_id` 兜底路径上就是字符串），hash 立刻变 NaN → j = NaN →
    // 解构交换 `[idx[i], idx[NaN]] = [idx[NaN], idx[i]]`。⚠️ 实测只产生**一个** undefined、
    // 恒在**最后一个下标**（被挤出的值暂时挂在数组的 "NaN" 属性上、下一轮又被取回）。
    // 本文件的消费端 `options`（下一条 computed）**没有** `.filter(Boolean)`，于是那个 undefined
    // 会被当成选项文本渲染成一个空位；ExamTakeView 那侧有 `.filter(Boolean)`，于是**少一个选项并整体
    // 错位**（4 选项活 3 个）——不是控制端裁定原先写的「只剩第一个选项」（该说法已被本任务 harness 反驳）。
    // 两侧表现不同，但根因同一颗种子（报告 §3.2 两侧都钉了夹具）。
    // simpleHash 是仓库**唯一**的 FNV-1a（src/lib/spaced-repetition.ts:564；
    // GC3 冻结文件，只导入、不修改、不复制），对字符串 id 恒稳定。
    const seed = simpleHash(String(props.question.id ?? ''))
    let hash = seed
    for (let i = n - 1; i > 0; i--) {
      hash = (hash * 9301 + 49297) % 233280
      const j = Math.floor((hash / 233280) * (i + 1))
      ;[idx[i], idx[j]] = [idx[j], idx[i]]
    }
    // 保证至少一个选项位置变化（避免偶发"恰好没乱"）
    if (idx.every((v, i) => v === i) && n > 1) {
      ;[idx[0], idx[1]] = [idx[1], idx[0]]
    }
  }
  return idx
})
const options = computed<string[]>(() => displayMap.value.map(i => rawOptions.value[i]))
// saved.selected 是原始下标 → 转成展示下标
const selected = ref<number[]>(saved?.selected ? saved.selected.map(raw => displayMap.value.indexOf(raw)).filter(i => i >= 0) : [])
const blankAnswer = ref(saved?.blankAnswer ?? '')
const submitted = ref(saved?.submitted ?? false)
const isCorrect = ref(saved?.isCorrect ?? false)
const selfEvalDone = ref(saved?.selfEvalDone ?? false)
const judgeSelected = ref<boolean | null>(saved?.judgeSelected ?? null)

// 单题计时（spec §5.2）
const startTime = ref<number | null>(null)
const elapsedSecs = ref<number | null>(saved?.elapsedSecs ?? null)
let timerId: number | null = null

function startTimer() {
  if (timerId) return
  startTime.value = Date.now()
  const baseSecs = elapsedSecs.value ?? 0
  timerId = window.setInterval(() => {
    if (startTime.value) {
      elapsedSecs.value = baseSecs + Math.floor((Date.now() - startTime.value) / 1000)
    }
  }, 1000)
}
function stopTimer() {
  if (timerId) {
    window.clearInterval(timerId)
    timerId = null
  }
}
function formatTime(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

onMounted(() => {
  // 已提交的题不重启计时
  if (!submitted.value) startTimer()
})
onBeforeUnmount(() => stopTimer())

// AI 解析相关
const analyzing = ref(false)
interface OptionAnalysis { letter: string; verdict: string; reason: string }
interface AiAnalysisData {
  knowledge_point?: string
  background?: string
  option_analysis?: OptionAnalysis[]
  reference_explanation?: string
  common_mistakes?: string
  solving_skill?: string
}
const aiAnalysis = ref<AiAnalysisData | null>(null)
const aiError = ref('')

function isOptCorrect(verdict: string): boolean {
  const v = verdict.trim()
  return v === '正确' || v === '对' || v === '✓' || v === '√'
}

// 题目编辑
const showEdit = ref(false)
function onQuestionSaved(updated: Question) {
  showEdit.value = false
  // 通知父组件题目已更新（父组件需要更新 questions 数组）
  emit('question-updated', updated)
}

// 判断题真值（三态）：true=正确 / false=错误 / null=答案无法识别（空值或非空杂值）。
// 2026-09-15（Task 6B 控制端补充 1(a)）：删除本文件这第 4 份局部判断逻辑副本——它内联了自己的
// 前缀正则 /^[A-H][.、:：)]?\s*/i 与自己的真值词数组，与 exam.ts 的 stripOptionPrefix /
// JUDGE_TRUE_WORDS 是同一套口径，改一处忘三处就会再次产生跨视图/跨端分歧。现改为调用 exam.ts
// **已导出**的 judgeAnswerBool()：它内部用 isJudgeWord(options[0], JUDGE_TRUE_WORDS)（原值 or
// 剥前缀**双查**，见 exam.ts 里 judgeAnswerBool 的 trueFirst 那一行）+ stripOptionPrefix 剥前缀，
// 正是简报 (a) 要求的判定。⚠️ 注释里刻意不写行号：exam.ts 属 Task 5/8 的射程，行号会漂。
// 附带收益：展示（本组件 judgeClass/displayAnswer）与判分（checkAnswer/gradeByState）现在共用
// 同一个函数，不可能再出现「显示说对一个说错」。
// 旧局部副本的 trueFirst 只查**剥前缀后**的值：RE_OPT_PREFIX 的分隔符是可选的（`[.、:：)]?`），
// 故 "false" 会被剥成 "alse"、两个集合都不命中 → trueFirst 退化为 false，而「假值词在前」的
// 正确答案恰好就是 false——即它在无前缀英文假值词上是**靠巧合**正确（夹具见报告 §3.1）。
// 返回值映射：exam.ts 用 ''/'true'/'false' 三态，'' → null（对应小程序 practice.vue 的 judgeTruth）。
function judgeTruthValue(ans: string | null | undefined): boolean | null {
  const t = judgeAnswerBoolShared(ans ?? '', rawOptions.value)
  if (t === 'true') return true
  if (t === 'false') return false
  return null
}

// 展示顺序：乱序开启时打乱，否则原序；displayMap[i] = 原始下标（展示第 i 个对应原第 displayMap[i] 个）
// 判断题（内容识别）不算选择题，走 √× 渲染分支
const isChoice = computed(() => !isJudgeQuestion() && ['single', 'multi'].includes(props.question.type))
const isSelfEval = computed(() => !isChoice.value && !isJudgeQuestion())
const typeLabel = computed(() => {
  if (isJudgeQuestion()) return '判断'
  return ({ single: '单选', multi: '多选', judge: '判断', blank: '填空', qa: '问答' }[props.question.type] || props.question.type)
})
const displayAnswer = computed(() => {
  if (!props.question.answer) return '（未识别到答案）'
  if (isJudgeQuestion()) {
    const truth = judgeTruthValue(props.question.answer)
    // 1(b) 配套：真值无法识别（非空杂值）时不猜「正确/错误」，原样回显答案
    //（与小程序 practice.vue 的 displayAnswer 同口径：judgeTruth === null ? ans : ...）
    return truth === null ? props.question.answer : (truth ? '正确' : '错误')
  }
  return props.question.answer
})
const keyHint = computed(() => {
  const suffix = props.examMode ? '' : '，F 收藏'
  // 考试模式 + 自动下一题：提示点击即跳（deferSubmit 只选中不锁定）
  if (props.examMode && props.autoNext) {
    if (isJudgeQuestion()) return '点击选项自动进入下一题' + suffix
    if (props.question.type === 'single') return '点击选项自动进入下一题' + suffix
    return props.deferSubmit ? '选完点「下一题」继续（可随时修改）' + suffix : '选完按 Enter 确认自动下一题' + suffix
  }
  if (isChoice.value) return '1-4 选选项，Enter 确认，← → 翻页' + suffix
  if (isJudgeQuestion()) return '1 正确 / 2 错误，← → 翻页' + suffix
  return '输入答案后 Enter 确认，← → 翻页' + suffix
})

function emitState() {
  emit('state-change', {
    // selected 转回原始下标存储（兼容存档与跨设备）
    selected: selected.value.map(toRawIndex),
    blankAnswer: blankAnswer.value,
    submitted: submitted.value,
    isCorrect: isCorrect.value,
    selfEvalDone: selfEvalDone.value,
    judgeSelected: judgeSelected.value,
    elapsedSecs: elapsedSecs.value,
  })
}

// 监听状态变化，及时同步给父组件保存
watch([selected, blankAnswer, submitted, isCorrect, selfEvalDone, judgeSelected, elapsedSecs], emitState, { deep: true })

function letter(i: number) { return String.fromCharCode(65 + i) }
function toggle(i: number) {
  if (props.question.type === 'single') {
    selected.value = [i]
    // 2026-08-20：考试模式 + deferSubmit → 只选中不锁定，交卷统一判分；自动下一题仍跳转
    if (props.examMode && props.deferSubmit) {
      if (props.autoNext) window.setTimeout(() => emit('next'), 300)
      return
    }
    // 考试模式 + 自动下一题：单选选完直接提交，无需点确认
    if (props.examMode && props.autoNext) {
      submit()
    }
  } else {
    const idx = selected.value.indexOf(i)
    if (idx >= 0) selected.value.splice(idx, 1)
    else selected.value.push(i)
  }
}
function optionClass(i: number) {
  if (!submitted.value) return { selected: selected.value.includes(i) }
  // 考试模式：提交后只标记选中，不泄露对错（交卷后才看成绩）
  if (props.examMode) return { selected: selected.value.includes(i) }
  const correctLetters = correctDisplayIndices()
  const isAns = correctLetters.includes(i)
  const isPicked = selected.value.includes(i)
  return { correct: isAns, wrong: isPicked && !isAns }
}
function judgeClass(val: boolean) {
  if (!submitted.value) return { selected: judgeSelected.value === val }
  // 考试模式：提交后只标记选中，不泄露对错（交卷后才看成绩）
  if (props.examMode) return { selected: judgeSelected.value === val }
  // 答案缺失时只高亮用户选择，不标绿/红
  if (!props.question.answer) return { selected: judgeSelected.value === val }
  const truth = judgeTruthValue(props.question.answer)
  // 1(b)：非空但**无法识别**的真值（judgeTruthValue === null）：不猜哪个是正确答案，
  // 只把学生点过的那个标红。旧实现里局部的 judgeAnswerBool 返回 boolean（无 null），杂值一律得
  // false，而 judgeClass 只用 `!props.question.answer` 挡了**空**答案，于是 × 被当成"正确答案"
  // 标绿；小程序端 practice.vue 的 judgeClass 空值分支早已改为「真值无法识别时只把学生点过的
  // 标为 wrong、不猜哪个对」，即同一道题两端展示相反（本任务的目标之一就是消掉这类分歧）。
  if (truth === null) return { wrong: judgeSelected.value === val }
  const isCorrectOption = (val === truth)
  // 答对时：只标绿正确选项，不标红错误选项；答错时：错项标红，正确项标绿
  if (isCorrect.value) {
    return { correct: isCorrectOption }  // 答对了，只显示正确答案为绿色，错误选项不高亮
  }
  // 答错了：用户选的标红，正确答案标绿
  return { correct: isCorrectOption, wrong: !isCorrectOption && judgeSelected.value === val }
}
function parseAnswerLetters(): number[] {
  if (!props.question.answer) return []
  try {
    const arr = JSON.parse(props.question.answer) as string[]
    return arr.map(s => s.charCodeAt(0) - 65)
  } catch {
    return props.question.answer.split('').filter(c => /[A-H]/i.test(c)).map(c => c.toUpperCase().charCodeAt(0) - 65)
  }
}
// 正确答案的展示下标（原始下标 → 展示下标映射；displayMap[displayIdx] = rawIdx，所以反查 rawIdx → displayIdx）
function correctDisplayIndices(): number[] {
  const rawCorrect = parseAnswerLetters()
  if (!props.shuffleOptions) return rawCorrect
  return rawCorrect.map(raw => displayMap.value.indexOf(raw)).filter(i => i >= 0)
}
// 展示下标 → 原始下标（存档/上报时用原始下标，兼容旧数据）
function toRawIndex(displayIdx: number): number {
  if (!props.shuffleOptions) return displayIdx
  return displayMap.value[displayIdx] ?? displayIdx
}
function getDurationMs(): number | null {
  if (elapsedSecs.value === null) return null
  return elapsedSecs.value * 1000
}
function answerJudge(val: boolean) {
  judgeSelected.value = val
  // 2026-08-20：考试模式 + deferSubmit → 只切换不锁定，交卷统一判分（可反悔）；自动下一题仍跳转
  if (props.examMode && props.deferSubmit) {
    if (props.autoNext) window.setTimeout(() => emit('next'), 300)
    return
  }
  finalizeJudge(val)
}
// 判断题判分 + 上报：answerJudge（点 √/×）与 submit（防御性路径）共用同一份判定，
// 避免两处口径漂移（P2-15）
function finalizeJudge(val: boolean) {
  submitted.value = true
  // 真值无法识别（空答案或非空杂值）时一律记为答错：与 judgeClass 只把学生点过的标红、
  // 不猜哪个正确保持一致（小程序 quiz.ts 的 isAnswerCorrect 在 want === null 时对 √/× 都返回 false）。
  // 旧实现把杂值折成 boolean false，于是点 × 会被判成"答对"（isCorrect=true）并上报，
  // 与界面上不再有任何绿色高亮自相矛盾。
  const truth = judgeTruthValue(props.question.answer)
  isCorrect.value = truth === null ? false : (val === truth)
  stopTimer()
  emit('answered', { correct: isCorrect.value, answer: String(val), duration_ms: getDurationMs() })
  maybeAutoNext()
}
function submit() {
  // P2-15：判断题必须先点 √/× 才能提交。旧实现里「确认答案」对判断题可见，未选就点会直接
  // submitted=true、isCorrect 保持 false → 卡片锁死显示「✗ 回答错误」，且**从不 emit('answered')**
  // （不判分、不记练习记录）。模板已对该题型隐藏按钮（第一道防线），这里是第二道：快捷键路径
  // 或将来复用组件时仍可能直接调用 submit()。
  if (isJudgeQuestion() && judgeSelected.value === null) {
    toastError('请先选择 √/×')
    return
  }
  submitted.value = true
  stopTimer()
  if (isChoice.value) {
    // selected 是展示下标 → 转原始下标后判分（与答案字母一致）
    const picked = [...selected.value].map(toRawIndex).sort().map(i => String.fromCharCode(65 + i))
    const correct = parseAnswerLetters().sort().map(i => String.fromCharCode(65 + i))
    isCorrect.value = JSON.stringify(picked) === JSON.stringify(correct)
    emit('answered', { correct: isCorrect.value, answer: JSON.stringify(picked), duration_ms: getDurationMs() })
    maybeAutoNext()
  } else if (isJudgeQuestion()) {
    // 判断题正常由 answerJudge 判定；走到这里说明 judgeSelected 已被上面的守卫保证非 null，
    // 走与点 √/× 完全相同的一步，避免「已选却静默锁死、不 emit」
    const val = judgeSelected.value
    if (val !== null) finalizeJudge(val)
  } else {
    // 填空/问答：展示参考答案，等自评，不设置 isCorrect
    isCorrect.value = false
  }
}
function selfEval(correct: boolean) {
  isCorrect.value = correct
  selfEvalDone.value = true
  emit('answered', { correct, answer: blankAnswer.value, duration_ms: getDurationMs() })
  maybeAutoNext()
}
// 自动下一题定时器（手动翻页时取消，避免跳两题）
let autoNextTimer: number | null = null
function maybeAutoNext() {
  if (!props.autoNext) return
  if (props.examMode) {
    // 考试模式：答完即自动跳下一题（不区分对错，因为考试模式不显示对错）
    autoNextTimer = window.setTimeout(() => { autoNextTimer = null; emit('next') }, 300)
  } else if (isCorrect.value) {
    // 练习模式：答对自动下一题，答错停留
    autoNextTimer = window.setTimeout(() => { autoNextTimer = null; emit('next') }, 1500)
  }
}
function cancelAutoNext() {
  if (autoNextTimer) {
    window.clearTimeout(autoNextTimer)
    autoNextTimer = null
  }
}
// 手动翻页：取消挂起的自动跳题，再触发翻页
function manualNext() { cancelAutoNext(); emit('next') }
function manualPrev() { cancelAutoNext(); emit('prev') }

// P1-9: 快捷键支持
function handleKeydown(e: KeyboardEvent) {
  // 忽略输入框中的按键（避免影响填空答题）
  const target = e.target as HTMLElement
  if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) {
    if (e.key === 'Enter' && !e.shiftKey && !submitted.value && !props.deferSubmit) {
      e.preventDefault()
      submit()
    }
    return
  }
  // 已提交时：← → 翻页，Enter 下一题，F 收藏
  if (submitted.value && (!isSelfEval.value || selfEvalDone.value)) {
    if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      manualNext()
      return
    }
  }
  // 考试模式：提交后也可以 Enter 进入下一题
  if (submitted.value && props.examMode) {
    if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      manualNext()
      return
    }
  }
  if (e.key === 'ArrowLeft' && props.hasPrev) {
    e.preventDefault()
    manualPrev()
    return
  }
  if (!props.examMode && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault()
    emit('toggle-favorite')
    return
  }
  // 未提交时：1-4 选 ABCD（选择题），1/2 选正确/错误（判断题），Enter 确认
  if (!submitted.value) {
    if (isChoice.value) {
      const n = parseInt(e.key, 10)
      if (n >= 1 && n <= options.value.length) {
        e.preventDefault()
        toggle(n - 1)
        return
      }
    } else if (isJudgeQuestion()) {
      if (e.key === '1') { e.preventDefault(); answerJudge(true); return }
      if (e.key === '2') { e.preventDefault(); answerJudge(false); return }
    }
    if (e.key === 'Enter' && isChoice.value && !props.deferSubmit) {
      e.preventDefault()
      submit()
    }
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  cancelAutoNext()
})

async function analyze() {
  if (analyzing.value) return
  analyzing.value = true
  aiError.value = ''
  aiAnalysis.value = null
  try {
    const raw = await api.analyzeQuestion(props.question)
    // 解析 AI 返回的 JSON（兼容 markdown 代码块包裹）
    let s = raw.trim()
    s = s.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim()
    const start = s.indexOf('{')
    const end = s.lastIndexOf('}')
    if (start >= 0 && end > start) {
      s = s.slice(start, end + 1)
    }
    try {
      aiAnalysis.value = JSON.parse(s) as AiAnalysisData
    } catch (parseErr) {
      // 解析失败：原始文本回退显示
      aiAnalysis.value = {
        knowledge_point: '⚠ AI 返回格式异常，原始内容：',
        option_analysis: [],
        reference_explanation: raw,
        solving_skill: '',
      }
    }
  } catch (e) {
    aiError.value = '解析失败：' + (e instanceof Error ? e.message : String(e))
  } finally {
    analyzing.value = false
  }
}
</script>

<style scoped>
.qcard { background: var(--color-card); border-radius: var(--radius-lg); padding: 24px; border: 1px solid var(--color-border-light); }
.stem { font-size: 16px; line-height: 1.6; margin-bottom: 16px; position: relative; padding-right: 130px; }
.stem.no-toolbar { padding-right: 0; }
.idx { font-weight: bold; margin-right: 8px; }
.type-tag { background: var(--color-border-light); padding: 2px 8px; border-radius: var(--radius-sm); font-size: 12px; margin-right: 8px; }
.timer { color: var(--color-text-tertiary); font-size: 12px; margin-right: 8px; font-family: monospace; background: var(--color-border-light); padding: 2px 6px; border-radius: var(--radius-sm); }

/* 右上角工具栏 */
.card-toolbar { position: absolute; top: -4px; right: 0; display: flex; gap: 6px; }
.tool-btn { width: 32px; height: 32px; border: 1px solid var(--color-border); border-radius: 50%; background: var(--color-card); cursor: pointer; font-size: 15px; line-height: 1; color: var(--color-text-secondary); display: flex; align-items: center; justify-content: center; transition: all 0.15s; padding: 0; }
.tool-btn:hover { background: var(--color-primary-light); color: var(--color-primary); border-color: var(--color-primary); transform: translateY(-1px); }
.tool-btn.active { background: var(--color-warning-bg); color: var(--color-warning-deep); border-color: var(--color-warning-light); }
.tool-btn.ai:hover { background: var(--tc-light); color: var(--color-primary); border-color: var(--color-info-strong); }
.tool-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
.options { display: flex; flex-direction: column; gap: 8px; }
.option { text-align: left; padding: 12px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); cursor: pointer; color: var(--color-text); }
.option.selected { border-color: var(--color-primary); background: var(--color-primary-light); }
.option.correct { border-color: var(--color-success); background: var(--color-success-light); }
.option.wrong { border-color: var(--color-danger); background: var(--color-danger-light); }
.letter { font-weight: bold; margin-right: 8px; }
.actions { margin-top: 16px; display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.act-btn { padding: 9px 18px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); cursor: pointer; color: var(--color-text); font-size: 14px; font-weight: 500; transition: all 0.15s; }
.act-btn:hover { transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
.act-btn.primary { background: var(--color-primary); color: #fff; border-color: var(--color-primary); margin-left: auto; }
.act-btn.primary:hover { background: var(--color-primary-dark); }
.act-btn.ghost { background: transparent; }
.act-btn.success { background: var(--color-success-strong); color: #fff; border-color: var(--color-success-strong); margin-left: auto; }
.act-btn.success:hover { background: var(--color-success-deep); }
.act-btn.danger { background: var(--color-danger-strong); color: #fff; border-color: var(--color-danger-strong); }
.act-btn.danger:hover { background: var(--color-danger-deep); }
.hint { margin-top: 8px; font-size: 12px; color: var(--color-text-tertiary); }
.feedback { margin-top: 16px; padding: 12px; border-radius: var(--radius-md); background: var(--color-danger-light); }
.feedback.correct { background: var(--color-success-light); }
.feedback.exam { background: var(--color-info-light); color: var(--color-info); }
.analysis { margin-top: 8px; color: var(--color-text-secondary); }
textarea { width: 100%; min-height: 80px; padding: 8px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); color: var(--color-text); }
.ai-analysis {
  margin-top: 20px;
  padding: 20px 24px;
  border-radius: var(--radius-lg);
  background: linear-gradient(180deg, var(--color-surface) 0%, var(--color-surface) 100%);
  border: 1px solid var(--color-border);
  font-size: 14px;
  line-height: 1.75;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}
.ai-header {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 17px;
  font-weight: 700;
  color: var(--color-info-deep);
  margin-bottom: 18px;
  padding-bottom: 12px;
  border-bottom: 2px solid var(--color-border);
}
.ai-header-icon { font-size: 22px; }
.ai-header-badge {
  margin-left: auto;
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-tertiary);
  background: var(--color-card);
  padding: 3px 10px;
  border-radius: 12px;
  border: 1px solid var(--color-border-light);
}
.ai-section {
  margin-bottom: 16px;
  padding: 12px 14px 12px 16px;
  border-radius: var(--radius-md);
  background: var(--color-card);
  border-left: 4px solid var(--color-border);
  position: relative;
}
.ai-section:last-child { margin-bottom: 0; }
.ai-section.knowledge { border-left-color: var(--color-warning-strong); background: linear-gradient(90deg, var(--color-warning-light) 0%, var(--color-card) 30%); }
.ai-section.background { border-left-color: var(--color-info-strong); background: linear-gradient(90deg, var(--tc-light) 0%, var(--color-card) 30%); }
.ai-section.reference { border-left-color: var(--color-success-strong); background: linear-gradient(90deg, var(--color-success-light) 0%, var(--color-card) 30%); }
.ai-section.warning { border-left-color: var(--color-danger-strong); background: linear-gradient(90deg, var(--color-danger-light) 0%, var(--color-card) 30%); }
.ai-section.tip { border-left-color: var(--color-info-strong); background: linear-gradient(90deg, var(--color-info-light) 0%, var(--color-card) 30%); }
.ai-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 700;
  color: var(--color-text);
  font-size: 15px;
  margin-bottom: 8px;
}
.ai-section-title .icon { font-size: 17px; }
.ai-section-count {
  margin-left: auto;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-tertiary);
  background: var(--color-surface);
  padding: 1px 8px;
  border-radius: 10px;
}
.ai-section-body {
  color: var(--color-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  text-align: justify;
  font-size: 14px;
}
.ai-options { display: flex; flex-direction: column; gap: 10px; }
.ai-option-row {
  padding: 12px 14px;
  border-radius: var(--radius-md);
  background: var(--color-surface);
  border: 1px solid var(--color-border-light);
  border-left: 4px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: all 0.15s;
}
.ai-option-row:hover { transform: translateX(2px); box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05); }
.ai-option-row.is-correct {
  border-left-color: var(--color-success-strong);
  background: linear-gradient(90deg, var(--color-success-bg) 0%, var(--color-card) 60%);
  border-color: var(--color-success-bg);
}
.ai-option-row.is-wrong {
  border-left-color: var(--color-danger-strong);
  background: linear-gradient(90deg, var(--color-danger-bg) 0%, var(--color-card) 60%);
  border-color: var(--color-danger-bg);
}
.ai-option-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.ai-option-letter {
  font-weight: 800;
  font-size: 16px;
  color: var(--color-text-secondary);
  width: 24px;
  text-align: center;
  background: var(--color-card);
  border-radius: 50%;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--color-border);
}
.ai-option-row.is-correct .ai-option-letter { color: var(--color-success-deep); border-color: var(--color-success-strong); }
.ai-option-row.is-wrong .ai-option-letter { color: var(--color-danger-deep); border-color: var(--color-danger-strong); }
.ai-option-verdict {
  font-size: 12px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 12px;
  background: var(--color-border-light);
  color: var(--color-text-secondary);
  letter-spacing: 0.5px;
}
.ai-option-row.is-correct .ai-option-verdict { background: var(--color-success-strong); color: #fff; }
.ai-option-row.is-wrong .ai-option-verdict { background: var(--color-danger-strong); color: #fff; }
.ai-option-reason {
  color: var(--color-text-secondary);
  font-size: 13.5px;
  line-height: 1.7;
  padding-left: 34px;
  text-align: justify;
}
.ai-error { margin-top: 12px; padding: 8px 12px; border-radius: var(--radius-md); background: var(--color-danger-light); color: var(--color-danger); }

/* 移动端适配 */
@media (max-width: 768px) {
  .qcard { padding: 16px; }
  .stem { padding-right: 0; padding-bottom: 38px; }
  .stem.no-toolbar { padding-bottom: 0; }
  /* 2026-08-16 修复：此前工具栏仍 absolute 右上角（right:0;top:0），而题干已取消右 padding
     → 三个按钮直接压在题干文字上。改为挂到题干下方（padding-bottom:38px 已让位） */
  .card-toolbar { top: auto; bottom: 0; right: 0; }
  .act-btn { flex: 1; min-width: 88px; justify-content: center; text-align: center; padding: 9px 8px; font-size: 13px; }
  .act-btn.primary, .act-btn.success { margin-left: 0; }
  /* 2026-08-16：手机端隐藏键盘快捷键提示（无键盘，纯桌面功能） */
  .hint { display: none; }
  .ai-analysis { padding: 14px 14px; }
  .ai-option-reason { padding-left: 0; }
}
</style>
