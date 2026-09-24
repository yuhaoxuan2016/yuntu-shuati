<template>
  <div class="exam-take">
    <!-- 加载中 -->
    <div v-if="loading" class="center">加载考试中...</div>

    <!-- 成绩展示（须在 !exam 之前：交卷后 exam 置 null，但 finishedResult 有值应优先展示） -->
    <div v-else-if="finishedResult" class="center">
      <div class="result-card">
        <div class="result-icon">🎉</div>
        <h2>交卷成功！</h2>
        <p class="result-student">考生：{{ finishedResult.student_name }}</p>
        <div class="score-big">{{ finishedResult.score }}<span class="score-unit">分</span></div>
        <p class="result-accuracy">正确率 {{ finishedResult.accuracy }}%</p>
        <div class="result-stats">
          <div class="rs"><span class="rs-num good">{{ finishedResult.correct }}</span><span>答对</span></div>
          <div class="rs"><span class="rs-num bad">{{ finishedResult.wrong }}</span><span>答错</span></div>
          <div class="rs"><span class="rs-num neutral">{{ finishedResult.unanswered }}</span><span>未答</span></div>
        </div>

        <!-- 查询码 -->
        <div class="code-box" v-if="finishedCode">
          <div class="code-label">📋 你的查询码（保存好，可随时回看错题）</div>
          <div class="code-value" @click="copyCode">{{ finishedCode }} <span class="copy-tip">点击复制</span></div>
        </div>

        <div class="review-actions">
          <button class="review-btn" @click="showReview = true">🔍 查询码回看错题</button>
          <button class="review-btn add-wrong-btn" :disabled="addingWrong" @click="addExamWrongsToBook">
            {{ addingWrong ? '添加中...' : '📥 错题加入错题本' }}
          </button>
        </div>
        <p v-if="addWrongMsg" class="add-wrong-msg" :class="{ warn: addWrongErr }">{{ addWrongMsg }}</p>
        <p class="result-tip">感谢作答，可以关闭本页面了。</p>
      </div>
    </div>

    <!-- 考试不存在 -->
    <div v-else-if="!exam" class="center">
      <div class="empty-icon">🔍</div>
      <p>考试不存在或已删除</p>
    </div>

    <!-- 填姓名 -->
    <div v-else-if="!studentName" class="center">
      <div class="name-card">
        <h2>📝 {{ exam.title }}</h2>
        <p v-if="exam.description" class="exam-desc">{{ exam.description }}</p>
        <div class="exam-meta">
          <span>📚 {{ exam.questions.length }} 题</span>
          <span>⏱ {{ exam.duration_minutes }} 分钟</span>
          <span v-if="exam.deadline" :class="{ warn: deadlineReached }">⏰ {{ formatDeadline(exam.deadline) }}</span>
        </div>
        <div v-if="deadlineReached" class="deadline-warn">
          <p>🕐 {{ deadlineMsg }}</p>
          <p class="hint">本场考试已关闭，无法进入答题。</p>
        </div>
        <template v-else>
          <div class="name-field">
            <label>请输入你的姓名/昵称</label>
            <input v-model="nameInput" placeholder="例如：张三" @keyup.enter="startExam" />
          </div>
          <button class="start-btn" :disabled="!nameInput.trim()" @click="startExam">🚀 开始答题</button>
        </template>

        <!-- 已有查询码回看错题 -->
        <div class="review-entry" v-if="!deadlineReached">
          <div class="review-divider"><span>或</span></div>
          <p class="review-entry-hint">已经考过？凭查询码回看错题</p>
          <div class="code-input-row">
            <input v-model="codeInput" placeholder="查询码，例如 A1B2-C3D4E5" class="code-input" @keyup.enter="lookupByCode" />
            <button class="review-btn" @click="lookupByCode">🔍 回看</button>
          </div>
          <p v-if="codeError" class="code-error">{{ codeError }}</p>
        </div>
      </div>
    </div>

    <!-- 答题中 -->
    <div v-else>
      <!-- 顶栏 -->
      <div class="topbar">
        <div class="tb-left">
          <span class="tb-title">{{ exam.title }}</span>
          <span class="tb-student">👤 {{ studentName }}</span>
        </div>
        <div class="tb-timer" :class="{ 'time-up': timeUp }">⏱ {{ formatTime(remaining) }}</div>
        <span v-if="progressSaved" class="tb-saved">✓ 已保存</span>
        <button class="submit-exam" @click="submit">交卷</button>
      </div>

      <!-- 进度 -->
      <div class="progress-row">
        <span class="progress-text">{{ current + 1 }} / {{ exam.questions.length }}</span>
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: ((current + 1) / exam.questions.length * 100) + '%' }"></div>
        </div>
      </div>

      <!-- 题目 -->
      <div class="question-card">
        <div class="q-stem">
          <span class="q-idx">{{ current + 1 }}.</span>
          <span class="q-type">{{ typeLabel(currentQuestion.type) }}</span>
          <span class="q-text">{{ currentQuestion.stem }}</span>
        </div>

        <!-- 选择题 -->
        <div v-if="isChoice" class="options">
          <button v-for="(opt, i) in displayOptions" :key="i" class="option"
            :class="{ selected: selectedDisplay.includes(i) }"
            @click="toggleOption(i)">
            <span class="letter">{{ String.fromCharCode(65 + i) }}</span> {{ opt }}
          </button>
        </div>

        <!-- 判断题 -->
        <div v-else-if="isJudgeQuestion()" class="options">
          <button class="option" :class="{ selected: currentAnswer.judge === true }" @click="currentAnswer.judge = true">√ 正确</button>
          <button class="option" :class="{ selected: currentAnswer.judge === false }" @click="currentAnswer.judge = false">× 错误</button>
        </div>

        <!-- 填空/问答 -->
        <div v-else class="blank">
          <textarea v-model="currentAnswer.blank" placeholder="输入你的答案" rows="4"></textarea>
        </div>

        <!-- 导航 -->
        <div class="nav-row">
          <button class="nav-btn" :disabled="current === 0" @click="current--">← 上一题</button>
          <button v-if="current < exam.questions.length - 1" class="nav-btn primary" @click="current++">下一题 →</button>
          <button v-else class="nav-btn success" @click="submit">交卷 ✓</button>
        </div>
      </div>

      <!-- 题号导航 -->
      <div class="dot-nav">
        <button v-for="(q, i) in exam.questions" :key="i" class="dot"
          :class="{ current: i === current, answered: isAnswered(q.id) }"
          @click="current = i">{{ i + 1 }}</button>
      </div>
    </div>

    <!-- 交卷确认弹窗 -->
    <Teleport to="body">
      <div v-if="showConfirm" class="modal-mask" @click.self="showConfirm = false">
        <div class="modal-body">
          <h3>确认交卷？</h3>
          <p>已答 {{ answeredCount }} / {{ exam.questions.length }} 题，{{ answeredCount < exam.questions.length ? '还有未答题目！' : '全部完成！' }}</p>
          <div class="modal-actions">
            <button @click="showConfirm = false">继续答题</button>
            <button class="danger" @click="confirmSubmit">确认交卷</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 查询码回看错题弹窗 -->
    <Teleport to="body">
      <div v-if="showReview" class="modal-mask" @click.self="closeReview">
        <div class="modal-body review-modal">
          <h3>🔍 回看错题</h3>

          <!-- 输入查询码 -->
          <template v-if="!reviewResult">
            <p class="hint">输入交卷时获得的查询码，查看你的错题（题干 + 选项 + 你的答案 + 正确答案 + 解析）</p>
            <div class="code-input-row">
              <input v-model="codeInput" placeholder="例如 XXXX-XXXX" class="code-input"
                @keyup.enter="lookupByCode" :disabled="reviewLoading" />
              <button class="review-btn" @click="lookupByCode" :disabled="reviewLoading || !codeInput.trim()">
                {{ reviewLoading ? '查询中...' : '查询' }}
              </button>
            </div>
            <p v-if="codeError" class="code-error">{{ codeError }}</p>
          </template>

          <!-- 错题列表 -->
          <template v-else>
            <p class="hint">考生：<b>{{ reviewResult.student_name }}</b> · 得分 <b>{{ reviewResult.score }}</b> 分 · 错 <b>{{ reviewWrongs.length }}</b> 题</p>
            <div v-if="reviewWrongs.length" class="wrong-list">
              <div v-for="(w, i) in reviewWrongs" :key="i" class="wrong-item">
                <div class="wrong-q">{{ i + 1 }}. {{ w.question.stem }}</div>
                <!-- 选项区：选择题渲染 ABCD，判断题渲染 √/×，高亮我的答案与正确答案 -->
                <div v-if="w.question.type === 'single' || w.question.type === 'multi'" class="wrong-options">
                  <div v-for="(opt, oi) in parseWrongOptions(w.question.options)" :key="oi" class="wrong-option"
                    :class="{ 'is-mine': rawHas(w.myRaw, oi), 'is-answer': rawHas(w.correctRaw, oi) }">
                    <span class="wrong-opt-letter">{{ String.fromCharCode(65 + oi) }}</span>
                    <span class="wrong-opt-text">{{ opt }}</span>
                    <span v-if="rawHas(w.myRaw, oi)" class="wrong-opt-tag mine">我的答案</span>
                    <span v-if="rawHas(w.correctRaw, oi)" class="wrong-opt-tag answer">正确答案</span>
                  </div>
                </div>
                <div v-else-if="w.question.type === 'judge'" class="wrong-options">
                  <div class="wrong-option" :class="{ 'is-mine': w.myRaw === 'true', 'is-answer': w.correctRaw === 'true' }">
                    <span class="wrong-opt-letter">√</span><span class="wrong-opt-text">正确</span>
                    <span v-if="w.myRaw === 'true'" class="wrong-opt-tag mine">我的答案</span>
                    <span v-if="w.correctRaw === 'true'" class="wrong-opt-tag answer">正确答案</span>
                  </div>
                  <div class="wrong-option" :class="{ 'is-mine': w.myRaw === 'false', 'is-answer': w.correctRaw === 'false' }">
                    <span class="wrong-opt-letter">×</span><span class="wrong-opt-text">错误</span>
                    <span v-if="w.myRaw === 'false'" class="wrong-opt-tag mine">我的答案</span>
                    <span v-if="w.correctRaw === 'false'" class="wrong-opt-tag answer">正确答案</span>
                  </div>
                </div>
                <div class="wrong-row"><span class="wrong-label mine">你的答案：</span>{{ w.myAnswer }}</div>
                <div class="wrong-row"><span class="wrong-label correct">正确答案：</span>{{ w.correctAnswer }}</div>
                <div v-if="w.analysis" class="wrong-analysis"><span class="ai-tag">解析·AI 生成</span> {{ w.analysis }}</div>
              </div>
            </div>
            <p v-else class="hint success-text">🎉 太棒了！没有错题，全部答对！</p>
            <div class="modal-actions">
              <button @click="closeReview">关闭</button>
              <button class="danger" @click="closeReview">确定</button>
            </div>
          </template>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { getExam, getCurrentUid, isExamOwner, submitExamResult, gradeExamViaServer, reviewByCode, saveExamSnapshot, errMsg, type Exam, type ExamResult } from '../lib/exam'
// 选项乱序种子用仓库唯一的字符串哈希（GC3 冻结文件，只导入不修改、不复制到 exam.ts）
import { simpleHash } from '../lib/spaced-repetition'
import { toastError, toastSuccess } from '../utils/toast'
import { setPageMeta } from '../lib/share'

interface StudentAnswer { selected: number[]; blank: string; judge: boolean | null }

const route = useRoute()
const examId = String(route.params.examId)
const exam = ref<Exam | null>(null)
const loading = ref(true)

const nameInput = ref('')
const studentName = ref('')
const current = ref(0)
// T8b（2026-09-16）：`ExamQuestion.id` 已如实放宽为 `number | string`，本视图的 answers 是**对象键**
// 类消费方 → 键类型改成 `string`，所有读写一律走 `String(q.id)`。
// 为什么这样运行时行为不变：JS 的对象键本来就会被字符串化，`obj[5]` 与 `obj["5"]` 是同一个键，
// 故数字 id 常态下逐字节同效（含 localStorage 存档与 `ExamResult.answers`，后者本来就是 `Record<string, …>`）。
// 为什么不能用 `Number(q.id)`：`_id` 兜底触发时那是 32 位十六进制串 → `Number()` 得 `NaN`，
// 所有题目会塌成同一个 `"NaN"` 键，等于把「类型不诚实」换成「运行时静默错位」。
const answers = ref<Record<string, StudentAnswer>>({})
const remaining = ref(0)
const timeUp = ref(false)
const showConfirm = ref(false)
const submitting = ref(false)
const deadlineReached = ref(false)   // 截止时间已到
const deadlineMsg = ref('')          // 截止提示文案
const finishedCode = ref('')         // 交卷后的查询码
const showReview = ref(false)        // 是否展示错题回看（查询码模式）
const reviewWrongs = ref<{ question: any; myAnswer: string; correctAnswer: string; analysis: string | null; myRaw: string | null; correctRaw: string | null }[]>([])
const reviewResult = ref<ExamResult | null>(null)
const codeInput = ref('')            // 查询码输入
const codeError = ref('')
const reviewLoading = ref(false)

// 选项乱序：默认开启（防背答案顺序）；创建考试时可配置关闭
// 旧考试无 shuffle_options 字段 → 默认乱序，行为不变
const shuffleOptions = ref(true)
watch(exam, (e) => {
  if (e) shuffleOptions.value = e.shuffle_options !== false
}, { immediate: true })
// 当前题目的展示映射：displayMap[displayIdx] = 原始下标；切题时重算（watch current）
const displayMap = ref<number[]>([])
// P2-24：每场考试（每次开始作答）一份乱序盐，混入种子，使不同学生/不同场次的选项顺序不同
// （旧实现只用题目 id 播种 → 全年级同序，"第 3 个选项就是 B" 可以互相传）。
// 它随进度一起写进 localStorage（saveProgress 的 salt 字段），恢复进度时沿用原盐，
// 保证同一次作答内选项顺序可恢复；答案本身存的是**原始下标**，故换盐不会改判分。
const shuffleSalt = ref('')
function newShuffleSalt(): string {
  try {
    const a = new Uint32Array(2)
    crypto.getRandomValues(a)
    return a[0].toString(36) + '-' + a[1].toString(36)
  } catch {
    // 无 crypto（极旧环境）时的兜底：时间戳 + 随机数，同样只需"每场不同"
    return Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36)
  }
}
function buildDisplayMap() {
  const q = currentQuestion.value
  const all = q?.options ? safeParseOptions(q.options) : []
  // 2026-09-18 修复（重审 B-08）：映射**只覆盖非空选项**。
  //   原先映射覆盖全部下标（含空串选项），而 displayOptions 又 `.filter(Boolean)` 掉空项
  //   ⇒ 展示序号与 displayMap 下标错位：以 `["甲","乙","丙",""]` + `displayMap=[2,0,3,1]` 为例，
  //   展示列表只剩 3 项（丙/甲/乙），学生点第 3 行「乙」取到的是 `displayMap[2]=3`（那个空选项的原始下标）
  //   ⇒ 服务端按 D 判分而正确答案是 B（成绩已入云端，双方都无提示）；
  //   反向症状是「点了却完全不高亮」（反查出展示位 3，而屏幕只有 0..2）。
  //   现在 displayMap 与展示列表**同长**，toRaw / selectedDisplay 的映射自洽。
  //   注意：这是对**存量坏数据**的兜底；根因侧（不让空选项存进云端）已在 QuestionEditDialog 堵住。
  const valid = all.map((o, i) => ({ o, i }))
    .filter(x => String(x.o ?? '').trim() !== '')
    .map(x => x.i)
  const n = valid.length
  const idx = valid.slice()
  if (shuffleOptions.value && n > 2 && !isJudgeQuestion()) {
    // 种子：**字符串**哈希（P2-24 + 控制端裁定）。旧实现 `const seed = q?.id || 0` 之后直接对
    // 该值做 LCG 乘法，只在 id 是 number 时成立；云端 `_id` 兜底路径会让 id 变字符串，
    // 此时 hash 立刻变 NaN → j = NaN → 解构交换 `[idx[i], idx[NaN]] = [idx[NaN], idx[i]]`。
    // ⚠️ 后果的**实测**形状（控制端裁定原先写的「只剩第一个选项」是**错的**，本任务 harness 已反驳）：
    // 只产生**一个** undefined，且恒在**最后一个下标**（每轮被挤出去的值暂时挂在数组的 "NaN"
    // 属性上、下一轮又被取回，故只有首轮的 `idx[n-1]` 落到 undefined）。于是
    // 下面 displayOptions 的 `.filter(Boolean)` 会**少一个选项并整体错位**（4 选项活下来 3 个），
    // 而不是「只剩第一个」。修复必要性不变（仍是题目作答层面的真实故障），只是症状此前写错。
    // 改为先 String(q.id) 再交给 simpleHash（FNV-1a，对字符串恒稳定），并混入本场考试的盐。
    // 注意：这里只做 String()，不对 q.id 做算术/下标（Task 8 的类型放宽另办）。
    const seed = simpleHash(shuffleSalt.value + ':' + String(q?.id ?? ''))
    let hash = seed
    for (let i = n - 1; i > 0; i--) {
      hash = (hash * 9301 + 49297) % 233280
      const j = Math.floor((hash / 233280) * (i + 1))
      ;[idx[i], idx[j]] = [idx[j], idx[i]]
    }
    // 判「洗了个寂寞」要与**有效下标序列**比，不能与 0..n-1 比：valid 可能有洞（如 [0,1,3]），
    // 拿 v===i 会恒假（B-08 修复引入 valid 后必须同步改这一句）。
    if (idx.every((v, i) => v === valid[i]) && n > 1) {
      ;[idx[0], idx[1]] = [idx[1], idx[0]]
    }
  }
  displayMap.value = idx
}
function safeParseOptions(opts: string | null): string[] {
  if (!opts) return []
  try { return JSON.parse(opts) } catch { return [] }
}
// 判断题（type=judge，或选项恰为「正确/错误」的 single 存储形式）不做乱序
function isJudgeQuestion(): boolean {
  const q = currentQuestion.value
  if (!q) return false
  if (q.type === 'judge') return true
  const opts = safeParseOptions(q.options)
  if (opts.length === 2) {
    const t = opts.map(o => (o || '').replace(/^[A-H][.、:：)]?\s*/i, '').trim())
    return (t[0] === '正确' && t[1] === '错误') || (t[0] === '对' && t[1] === '错')
  }
  return false
}

let startMs: number | null = null
let timerId: number | null = null
let deadlineTimerId: number | null = null
// 上一次自动交卷失败的时间戳（P1-26 的重试节流用，见 tick）
let lastSubmitFailAt = 0

// 停表：只在**交卷成功后**调用（P1-27）
function stopTimers() {
  if (timerId) { clearInterval(timerId); timerId = null }
  if (deadlineTimerId) { clearTimeout(deadlineTimerId); deadlineTimerId = null }
}

// ===== 考试进度自动保存（localStorage） =====
const progressSaved = ref(false)   // 显示「已保存」提示
let saveTimer: number | null = null

function progressKey(eid: string, name: string) {
  return `exam_progress_${eid}_${name}`
}

function saveProgress() {
  if (!studentName.value || !exam.value) return
  try {
    const data = {
      answers: answers.value,
      current: current.value,
      startMs,
      // P2-24：盐随进度保存，恢复时沿用同一颗盐 → 同一次作答内选项顺序可恢复
      salt: shuffleSalt.value,
      savedAt: Date.now(),
    }
    localStorage.setItem(progressKey(examId, studentName.value), JSON.stringify(data))
    progressSaved.value = true
    // 2 秒后隐藏提示
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => { progressSaved.value = false }, 2000)
  } catch { /* localStorage 满了静默忽略 */ }
}

function clearProgress() {
  if (!studentName.value) return
  try { localStorage.removeItem(progressKey(examId, studentName.value)) } catch {}
}

// 每次答案变化或切题时自动保存（deep watch + 500ms 防抖）
watch(answers, () => {
  if (!studentName.value) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = window.setTimeout(saveProgress, 500)
}, { deep: true })
// 切题时也保存 current（翻页检查不改答案的情况）
watch(current, () => {
  if (!studentName.value) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = window.setTimeout(saveProgress, 300)
})

const currentQuestion = computed(() => exam.value?.questions[current.value] || null)
// 切题时重算选项乱序映射（每题独立随机）
watch([current, shuffleOptions], () => buildDisplayMap())
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
// 展示选项：**始终**走 displayMap（乱序时是重排、不乱序时是恒等映射）。
// 2026-09-18 修复（重审 B-08）：原实现在「未开乱序」时直接 `return opts`，会把空串选项当一行渲染出来，
//   而 displayMap 又已经把空项剔掉 ⇒ 两个口径再次分叉：那一行可点、但 `selectedDisplay` 反查不到（回 -1）
//   ⇒ 表现为「点了不高亮」，且按 `toRaw` 的 `?? i` 兜底会把答案记到那个空选项上。
//   现在展示列表与 displayMap 恒同长，删掉 `.filter(Boolean)`（映射里已无空项，过滤是空操作）。
const displayOptions = computed<string[]>(() => {
  const opts = parsedOptions.value
  if (!displayMap.value.length) return opts
  return displayMap.value.map(i => opts[i])
})
// 当前选中项的展示下标（answers 存的是原始下标，反查展示下标用于高亮）
const selectedDisplay = computed<number[]>(() => {
  const raw = currentAnswer.value.selected
  if (!shuffleOptions.value || !displayMap.value.length) return raw
  return raw.map(r => displayMap.value.indexOf(r)).filter(i => i >= 0)
})
const isChoice = computed(() => !!currentQuestion.value && !isJudgeQuestion() && (currentQuestion.value?.type === 'single' || currentQuestion.value?.type === 'multi'))
const answeredCount = computed(() => Object.values(answers.value).filter(a => a.selected.length || a.blank || a.judge !== null).length)

function typeLabel(t: string) {
  // 判断题旧快照（type='single' + ["正确","错误"]）内容识别为判断
  if (isJudgeQuestion()) return '判断'
  return { single: '单选', multi: '多选', judge: '判断', blank: '填空', qa: '问答' }[t] || t
}
// T8b：形参跟着 `ExamQuestion.id` 一起放宽为 `number | string`（模板 dot-nav 传的就是 `q.id`）。
// 内部仍用 String() 归一成对象键，语义与旧的 `answers.value[qid]` 逐字节一致。
function isAnswered(qid: number | string) {
  const a = answers.value[String(qid)]
  return !!(a && (a.selected.length || a.blank || a.judge !== null))
}
function toggleOption(i: number) {
  const q = currentQuestion.value
  if (!q) return
  const a = currentAnswer.value
  // i 是展示下标 → 转回原始下标存储（判分用原始答案字母）
  const raw = shuffleOptions.value ? (displayMap.value[i] ?? i) : i
  if (q.type === 'single') {
    a.selected = [raw]
  } else {
    const idx = a.selected.indexOf(raw)
    if (idx >= 0) a.selected.splice(idx, 1)
    else a.selected.push(raw)
  }
}
function formatTime(s: number) {
  const m = Math.floor(s / 60), sec = s % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}
function formatDeadline(iso: string) {
  try {
    return '截止 ' + new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
}
async function copyCode() {
  if (!finishedCode.value) return
  try {
    await navigator.clipboard.writeText(finishedCode.value)
    toastSuccess('查询码已复制')
  } catch {
    toastError('复制失败，请手动记录')
  }
}

function startExam() {
  if (!nameInput.value.trim()) return
  // 截止时间检查：已到截止时间则禁止进入
  if (checkDeadline()) return
  studentName.value = nameInput.value.trim()
  // P2-24：先清空盐——"开始答题"即开启一场新的作答。下面若恢复了带 salt 的存档，会在恢复分支里
  // 沿用那颗（同一次作答内的顺序可恢复）；否则统一在末尾补一颗新盐。清空使盐值只取决于本次调用，
  // 不会残留上一次留下的值（避免将来在这条路径上复用旧盐却看不出来）。
  shuffleSalt.value = ''

  // 检查是否有未完成的进度
  let restored = false
  try {
    const raw = localStorage.getItem(progressKey(examId, studentName.value))
    if (raw) {
      const saved = JSON.parse(raw)
      if (saved?.answers && saved.savedAt) {
        // 只恢复 24 小时内的进度（防止太久远的脏数据）
        if (Date.now() - saved.savedAt < 24 * 60 * 60 * 1000) {
          const elapsed = Math.floor((Date.now() - saved.startMs) / 1000)
          const total = exam.value!.duration_minutes * 60
          const rem = total - elapsed
          if (rem > 0 && confirm('检测到上次未完成的答题进度，是否恢复？\n（选「取消」将重新开始）')) {
            answers.value = saved.answers
            current.value = saved.current || 0
            startMs = saved.startMs
            remaining.value = rem
            // P2-24：存档里有盐就沿用（同一场考试同一顺序）；旧存档没有 salt 字段 → 下面补一颗新盐
            if (typeof saved.salt === 'string' && saved.salt) shuffleSalt.value = saved.salt
            restored = true
            toastSuccess('已恢复上次进度')
          }
        }
        // 过期或用户拒绝 → 清除旧存档
        if (!restored) clearProgress()
      }
    }
  } catch { /* JSON 解析失败忽略 */ }

  if (!restored) {
    startMs = Date.now()
    remaining.value = exam.value!.duration_minutes * 60
  }
  // P2-24：本场答题的乱序盐。恢复进度且存档带 salt 时已在上面沿用，其余情况（新开考、旧存档无 salt）
  // 在这里生成；随后重算映射，让「开始答题」之后看到的选项顺序与存档里的盐一致。
  if (!shuffleSalt.value) shuffleSalt.value = newShuffleSalt()
  buildDisplayMap()
  timerId = window.setInterval(tick, 1000)
  // 截止时间到点自动强制收卷
  if (exam.value!.deadline) {
    deadlineTimerId = window.setTimeout(() => {
      if (!submitting.value && !finishedResult.value) {
        deadlineReached.value = true
        forceSubmit('考试已截止，自动收卷')
      }
    }, Math.max(0, new Date(exam.value!.deadline).getTime() - Date.now() + 1000))
  }
}
// 检查截止时间；返回 true 表示已截止
function checkDeadline(): boolean {
  const dl = exam.value?.deadline
  if (!dl) return false
  if (Date.now() >= new Date(dl).getTime()) {
    deadlineReached.value = true
    deadlineMsg.value = '本场考试已于 ' + new Date(dl).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' 截止'
    return true
  }
  return false
}
function tick() {
  // exam.value 在交卷成功后会被置空（切到成绩视图），此时若定时器还没停，旧代码会在
  // `exam.value!.duration_minutes` 上抛 TypeError → 这里先挡住
  if (startMs === null || !exam.value) return
  const elapsed = Math.floor((Date.now() - startMs) / 1000)
  const total = exam.value.duration_minutes * 60
  const rem = total - elapsed
  remaining.value = rem > 0 ? rem : 0
  if (rem <= 0) {
    timeUp.value = true
    // P1-26：时间到直接自动交卷。旧实现在这里只弹确认框（showConfirm），学生点「取消」就能
    // 继续作答（时间已到却仍可交卷/继续答），与同文件 deadline 路径（startExam 里的 setTimeout
    // → forceSubmit）以及 MixExamView/ComposeExamView 的 tick() 口径不一致。
    // 节流只针对「自动重试」：交卷失败时（P1-27 修完后定时器仍活着）每秒重试会刷屏 toast，
    // 故失败后 4s 内不再自动重发；手动点「交卷」不受影响。
    if (!submitting.value && Date.now() - lastSubmitFailAt > 4000) forceSubmit('考试时间到，自动交卷')
  }
}

function forceSubmit(reason: string) {
  if (submitting.value) return
  showConfirm.value = false
  doSubmit(reason)
}

function submit() {
  if (submitting.value) return
  showConfirm.value = true
}
async function confirmSubmit() {
  if (submitting.value) return
  showConfirm.value = false
  await doSubmit('')
}
async function doSubmit(reason: string) {
  if (submitting.value) return
  submitting.value = true
  try {
    // T18-2d：判分改由**服务端**做（客户端手里已没有答案——卷是闸门剥过的）。
    // 服务端同时回下答案表 key（交卷后才发），合并回卷对象，供错题回顾/查询码回看/错题本/快照使用。
    const g = await gradeExamViaServer(examId, answers.value)
    if (!g?.ok) throw new Error(g?.message || '判分服务不可用')
    if (exam.value && g.key) {
      exam.value.questions = exam.value.questions.map(q => {
        const k = g.key[String(q.id)]
        return k ? { ...q, answer: k.answer ?? null, analysis: k.analysis ?? null } : q
      })
    }
    const grade = { correct: g.correct, wrong: g.wrong, unanswered: g.unanswered, score: g.score, accuracy: g.accuracy }
    const result: ExamResult = {
      exam_id: examId,
      student_name: studentName.value,
      answers: answers.value,
      correct: grade.correct,
      wrong: grade.wrong,
      unanswered: grade.unanswered,
      score: grade.score,
      accuracy: grade.accuracy,
      duration_ms: startMs ? Date.now() - startMs : null,
      submitted_at: new Date().toISOString(),
    }
    await submitExamResult(result)
    // P1-27：定时器只在**交卷成功后**才停。旧实现在 `await` 之前就 clearInterval/clearTimeout，
    // 提交失败（网络/权限异常，submitExamResult 会 throw）后计时永久死掉：倒计时不再走动、
    // 时间到也不再自动交卷，学生只能刷新页面重来。
    // 放在 `await submitExamResult(result)` 之后、`exam.value = null` 之前——后者会让 tick() 无题可读。
    stopTimers()
    clearProgress() // 交卷成功，清除本地存档
    // P0-5：考生此刻已交卷，覆盖开考前那份**剥离版**快照为完整快照。
    // 用途：交卷后重进页面 + 云端查不到时，按查询码回看错题仍需题目答案与解析。
    const ex = exam.value
    if (ex) saveExamSnapshot(ex)
    // 保存展示数据后切到成绩视图
    finishedCode.value = result.query_code || ''
    finishedExam.value = exam.value
    finishedResult.value = result
    exam.value = null
    if (reason) toastSuccess(reason + '，得分 ' + grade.score + ' 分')
    else toastSuccess(`交卷成功！得分 ${grade.score} 分`)
  } catch (e) {
    // 交卷失败：定时器**未**被停掉，倒计时继续走、到点仍会自动重试（见 tick 的 4s 节流）。
    // submitting 由 finally 复位，学生可再点「交卷」重试。
    lastSubmitFailAt = Date.now()
    toastError('交卷失败：' + errMsg(e))
  } finally {
    submitting.value = false
  }
}

// 查询码回看错题
async function lookupByCode() {
  const code = codeInput.value.trim()
  if (!code) { codeError.value = '请输入查询码'; return }
  codeError.value = ''
  reviewLoading.value = true
  try {
    const { findResultByCode, getWrongQuestions } = await import('../lib/exam')
    let found = await findResultByCode(examId, code)
    // 获取考试题目（优先用内存中的，否则走闸门按查询码取——服务端带答案下发。
    // T18-2d：原先这里调 getExam(examId) 直查公开整卷；改造后考生端只有这一条路能拿到答案，
    // 且必须持有查询码。）
    let examData = finishedExam.value
    if (!examData || !found) {
      const gate = await reviewByCode(code)
      if (!gate?.ok) {
        codeError.value = gate?.message || '网络异常，无法加载考试数据，请检查网络后重试'
        return
      }
      if (!found) found = gate.result
      if (!examData) examData = gate.exam
    }
    if (!found) {
      codeError.value = '未找到该查询码对应的答卷，请检查是否输错（注意大小写）'
      return
    }
    if (!examData) {
      codeError.value = '考试不存在或已被删除，请联系考试创建者'
      return
    }
    reviewResult.value = found
    reviewWrongs.value = getWrongQuestions(examData, found)
    showReview.value = true
  } catch (e) {
    const msg = errMsg(e)
    if (msg.includes('timeout') || msg.includes('超时')) {
      codeError.value = '查询超时，请稍后重试'
    } else if (msg.includes('network') || msg.includes('网络')) {
      codeError.value = '网络异常，请检查网络连接'
    } else {
      codeError.value = '查询失败：' + msg
    }
  } finally {
    reviewLoading.value = false
  }
}
function closeReview() {
  showReview.value = false
  reviewResult.value = null
  reviewWrongs.value = []
  codeInput.value = ''
}

// 错题回看选项渲染辅助
function parseWrongOptions(options: string | null): string[] {
  if (!options) return []
  try {
    const p = JSON.parse(options)
    return Array.isArray(p) ? p.map((o: any) => String(o)) : []
  } catch { return [] }
}
// raw（字母串如 "B"、"A、C"，或判断题 'true'/'false'）是否包含下标 oi 对应选项
function rawHas(raw: string | null, oi: number): boolean {
  if (!raw) return false
  return raw.split(/[、,，\s]/).includes(String.fromCharCode(65 + oi))
}

// 交卷后展示成绩
const finishedResult = ref<ExamResult | null>(null)
const finishedExam = ref<Exam | null>(null)

// 错题加入错题本
const addingWrong = ref(false)
const addWrongMsg = ref('')
const addWrongErr = ref(false)

async function addExamWrongsToBook() {
  if (addingWrong.value) return
  const ex = finishedExam.value
  const res = finishedResult.value
  if (!ex || !res) return
  addingWrong.value = true
  addWrongMsg.value = ''
  addWrongErr.value = false
  try {
    const { getWrongQuestions } = await import('../lib/exam')
    // 2026-09-15 修复：原先写 `const api = await import('../utils/api')` 再调 `api.default.markWrong(...)`，
    // 而该模块**只有具名导出 `api`、没有 default** ⇒ `.default` 是 undefined、运行时 TypeError，
    // 「把考试错题加入错题本」一直是坏的（类型检查里那条 TS2339 就是它）。改为解构具名导出。
    const { api } = await import('../utils/api')
    const wrongs = getWrongQuestions(ex, res)
    let added = 0, skipped = 0
    for (const w of wrongs) {
      const q = w.question
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
    addWrongMsg.value = '添加失败：' + errMsg(e)
    addWrongErr.value = true
  } finally {
    addingWrong.value = false
  }
}

onMounted(async () => {
  try {
    exam.value = await getExam(examId)
    const ex = exam.value
    if (ex) {
      // 缓存考试快照：交卷后/后续重进时云端查不到也能正常展示（兜底"考完提交后考试不存在"）
      // P0-5：考生**开考前**不得把整卷答案/解析写进 localStorage，故按属主决定是否剥离
      // （getExam 内部也按同一口径写过一次快照，这里是显式的第二道防线：视图自己声明"我是考生"）。
      // 交卷成功后 doSubmit 会补存一份完整快照，交卷后的回看不受影响。
      const uid = await getCurrentUid()
      saveExamSnapshot(ex, { forTaker: !isExamOwner(ex, uid) })
      // 动态设置分享卡片标题=考试名（服务系统分享面板 / 桌面浏览器）
      setPageMeta({ title: `【考试】${ex.title}`, desc: ex.description || '正在作答考试' })
      // 截止时间检查：未答题时已到截止时间 → 显示截止状态
      checkDeadline()
      buildDisplayMap()
    }
  } catch (e) {
    toastError('加载考试失败：' + errMsg(e))
  } finally {
    loading.value = false
  }
})
onBeforeUnmount(() => {
  stopTimers()
  // 页面离开时保存一次（切换后台/关闭页面）
  if (studentName.value && !finishedResult.value) saveProgress()
})
</script>

<style scoped>
.center { max-width: 460px; margin: 60px auto; text-align: center; color: var(--color-text-tertiary); }
.empty-icon { font-size: 56px; margin-bottom: 12px; opacity: 0.5; }
.name-card { padding: 32px 28px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-lg); text-align: center; }
.name-card h2 { margin: 0 0 8px 0; }
.exam-desc { color: var(--color-text-secondary); font-size: 13px; margin: 0 0 12px 0; }
.exam-meta { display: flex; gap: 16px; justify-content: center; font-size: 13px; color: var(--color-text-tertiary); margin-bottom: 24px; }
.exam-meta .warn { color: var(--color-danger); font-weight: 600; }
.deadline-warn { padding: 12px; background: var(--color-danger-light); border: 1px solid var(--color-danger); border-radius: var(--radius-md); margin-bottom: 16px; }
.deadline-warn p { margin: 0 0 4px 0; color: var(--color-danger); font-weight: 600; }
.deadline-warn .hint { color: var(--color-text-secondary); font-weight: 400; font-size: 13px; }
.review-entry { margin-top: 20px; padding-top: 14px; border-top: 1px solid var(--color-border-light); text-align: center; }
.review-divider { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.review-divider::before, .review-divider::after { content: ''; flex: 1; height: 1px; background: var(--color-border-light); }
.review-divider span { font-size: 12px; color: var(--color-text-tertiary); }
.review-entry-hint { font-size: 12px; color: var(--color-text-tertiary); margin: 0 0 8px; }
.review-entry .code-input-row { justify-content: center; }
.name-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; text-align: left; }
.name-field label { font-size: 13px; color: var(--color-text-secondary); }
.name-field input { padding: 10px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-md); font-size: 15px; background: var(--color-bg); color: var(--color-text); text-align: center; }
.start-btn { padding: 11px 32px; background: linear-gradient(135deg, var(--color-primary), var(--color-primary-dark)); color: #fff; border: none; border-radius: var(--radius-md); font-size: 15px; font-weight: 600; cursor: pointer; }
.start-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.topbar { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-md); margin-bottom: 10px; flex-wrap: wrap; }
.tb-left { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 150px; }
.tb-title { font-weight: 600; font-size: 15px; }
.tb-student { font-size: 12px; color: var(--color-text-secondary); background: var(--color-border-light); padding: 2px 8px; border-radius: 10px; }
.tb-timer { font-family: monospace; font-size: 15px; font-weight: 700; padding: 4px 12px; background: var(--color-info-light); color: var(--color-info); border-radius: var(--radius-md); }
.tb-timer.time-up { background: var(--color-danger-light); color: var(--color-danger); animation: pulse 1s infinite; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
.tb-saved { font-size: 12px; color: var(--color-success, #42b883); white-space: nowrap; animation: fadeIn 0.3s; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
.submit-exam { padding: 8px 18px; background: var(--color-danger); color: #fff; border: none; border-radius: var(--radius-md); font-size: 13px; font-weight: 600; cursor: pointer; }

.progress-row { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.progress-text { font-size: 12px; color: var(--color-text-secondary); font-family: monospace; white-space: nowrap; }
.progress-track { flex: 1; height: 6px; background: var(--color-border-light); border-radius: 3px; overflow: hidden; }
.progress-fill { height: 100%; background: linear-gradient(90deg, var(--color-primary), var(--color-primary-dark)); border-radius: 3px; transition: width 0.3s; }

.question-card { padding: 24px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-lg); margin-bottom: 14px; }
.q-stem { font-size: 16px; line-height: 1.6; margin-bottom: 18px; }
.q-idx { font-weight: bold; margin-right: 6px; }
.q-type { padding: 2px 8px; background: var(--color-border-light); border-radius: var(--radius-sm); font-size: 12px; margin-right: 8px; }
.options { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.option { text-align: left; padding: 12px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); cursor: pointer; color: var(--color-text); }
.option.selected { border-color: var(--color-primary); background: var(--color-primary-light); }
.letter { font-weight: bold; margin-right: 8px; }
.blank { margin-bottom: 16px; }
.blank textarea { width: 100%; padding: 10px; border: 1px solid var(--color-border); border-radius: var(--radius-md); font-size: 14px; background: var(--color-card); color: var(--color-text); font-family: inherit; resize: vertical; }
.nav-row { display: flex; justify-content: space-between; gap: 10px; }
.nav-btn { padding: 8px 18px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); cursor: pointer; font-size: 13px; color: var(--color-text); }
.nav-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.nav-btn.primary { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
.nav-btn.success { background: var(--color-success-strong); color: #fff; border-color: var(--color-success-strong); }
.dot-nav { display: flex; flex-wrap: wrap; gap: 5px; padding: 14px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-md); }
.dot { min-width: 30px; height: 30px; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-card); color: var(--color-text-secondary); font-size: 12px; cursor: pointer; }
.dot.answered { background: var(--color-primary-light); border-color: var(--color-primary); color: var(--color-primary); }
.dot.current { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }

.modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 300; }
.modal-body { background: var(--color-card); padding: 24px; border-radius: var(--radius-lg); min-width: 320px; color: var(--color-text); text-align: center; }
.modal-body h3 { margin: 0 0 10px 0; }
.modal-body p { color: var(--color-text-secondary); font-size: 14px; }
.modal-actions { display: flex; gap: 10px; justify-content: center; margin-top: 16px; }
.modal-actions button { padding: 8px 20px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); cursor: pointer; font-size: 14px; }
.modal-actions button.danger { background: var(--color-danger); color: #fff; border-color: var(--color-danger); }

/* 成绩展示 */
.result-card { padding: 36px 32px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-lg); text-align: center; }
.result-icon { font-size: 52px; margin-bottom: 8px; }
.result-card h2 { margin: 0 0 6px 0; }
.result-student { color: var(--color-text-secondary); font-size: 13px; margin: 0 0 16px 0; }
.score-big { font-size: 56px; font-weight: 700; color: var(--color-primary); line-height: 1; }
.score-unit { font-size: 20px; color: var(--color-text-tertiary); margin-left: 4px; font-weight: 500; }
.result-accuracy { color: var(--color-text-secondary); font-size: 14px; margin: 8px 0 20px 0; }
.result-stats { display: flex; justify-content: center; gap: 32px; margin-bottom: 20px; }
.rs { display: flex; flex-direction: column; gap: 4px; }
.rs-num { font-size: 24px; font-weight: 700; }
.rs-num.good { color: var(--color-success-strong); }
.rs-num.bad { color: var(--color-danger-strong); }
.rs-num.neutral { color: var(--color-text-tertiary); }
.rs span:last-child { font-size: 12px; color: var(--color-text-tertiary); }
.result-tip { font-size: 12px; color: var(--color-text-tertiary); margin: 0; }

/* 查询码 */
.code-box { margin: 16px 0 12px; padding: 14px; background: var(--color-success-light); border: 1px dashed var(--color-success-strong); border-radius: var(--radius-md); }
.code-label { font-size: 12px; color: var(--color-success-deep); margin-bottom: 8px; }
.code-value { font-size: 24px; font-weight: 800; letter-spacing: 2px; color: var(--color-success-deep); cursor: pointer; user-select: all; font-family: monospace; }
.code-value:hover .copy-tip { opacity: 1; }
.copy-tip { font-size: 11px; color: var(--color-text-tertiary); opacity: 0; transition: opacity 0.15s; }
.review-actions { display: flex; gap: 8px; margin: 8px 0 14px; flex-wrap: wrap; justify-content: center; }
.add-wrong-btn { background: var(--color-primary); color: #fff; }
.add-wrong-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.add-wrong-msg { font-size: 13px; color: var(--color-success-deep); margin: 4px 0 0; }
.add-wrong-msg.warn { color: var(--color-danger); }
.review-btn { padding: 8px 18px; background: var(--color-success-strong); color: #fff; border: none; border-radius: var(--radius-md); font-size: 13px; font-weight: 500; cursor: pointer; }
.review-btn:hover { background: var(--color-success-deep); }
.review-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* 错题回看弹窗 */
.review-modal { max-width: 560px; max-height: 80vh; overflow-y: auto; text-align: left; }
.review-modal h3 { text-align: center; }
.review-modal .hint { font-size: 13px; color: var(--color-text-secondary); margin: 4px 0 12px; }
.code-input-row { display: flex; gap: 8px; margin: 8px 0; }
.code-input { flex: 1; padding: 9px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-md); font-size: 15px; font-family: monospace; letter-spacing: 1px; background: var(--color-bg); color: var(--color-text); text-transform: uppercase; }
.code-error { color: var(--color-danger); font-size: 13px; margin: 6px 0 0; }
.success-text { color: var(--color-success-deep); font-weight: 600; }
.wrong-list { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; }
.wrong-item { padding: 12px; border: 1px solid var(--color-border-light); border-radius: var(--radius-md); background: var(--color-bg); }
.wrong-q { font-size: 14px; font-weight: 500; margin-bottom: 8px; line-height: 1.5; word-break: break-all; color: var(--color-text); }
.wrong-options { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; }
.wrong-option { display: flex; align-items: flex-start; gap: 8px; padding: 5px 8px; border-radius: 4px; font-size: 13px; color: var(--color-text); line-height: 1.5; word-break: break-all; }
.wrong-option.is-mine { background: var(--color-danger-light); }
.wrong-option.is-answer { background: var(--color-success-light); }
.wrong-option.is-mine.is-answer { background: var(--color-success-light); }
.wrong-opt-letter { font-weight: 700; flex-shrink: 0; min-width: 16px; }
.wrong-opt-text { flex: 1; }
.wrong-opt-tag { flex-shrink: 0; font-size: 11px; padding: 0 6px; border-radius: 8px; font-weight: 600; }
.wrong-opt-tag.mine { background: var(--color-danger); color: #fff; }
.wrong-opt-tag.answer { background: var(--color-success); color: #fff; }
.wrong-row { font-size: 13px; color: var(--color-text-secondary); margin: 3px 0; line-height: 1.5; word-break: break-all; }
.wrong-label { font-weight: 600; }
.wrong-label.mine { color: var(--color-danger); }
.wrong-label.correct { color: var(--color-success-deep); }
.wrong-analysis { margin-top: 6px; padding: 8px; background: var(--color-warning-light); border-left: 3px solid var(--color-warning-strong); border-radius: 4px; font-size: 13px; color: var(--color-warning-deep); line-height: 1.5; word-break: break-all; }
.review-modal .modal-actions { margin-top: 16px; }

/* 移动端适配 */
@media (max-width: 768px) {
  .center { margin: 24px auto; }
  .name-card { padding: 24px 16px; }
  .question-card { padding: 16px; }
  .q-stem { font-size: 15px; }
  .tb-left { min-width: 0; flex: 1 1 100%; }
  .result-card { padding: 24px 16px; }
  .score-big { font-size: 44px; }
  .result-stats { gap: 20px; }
  .code-value { font-size: 20px; }
  .review-modal { max-width: 94vw; }
  .modal-body { min-width: 0; }
}
.wrong-analysis .ai-tag { display: inline-block; margin-right: 4px; padding: 1px 6px; font-size: 11px; font-weight: 600; color: #6b7280; background: #f3f4f6; border: 1px solid #d0d5dd; border-radius: 10px; }
</style>
