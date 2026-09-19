<template>
  <div
    class="import"
    :class="{ 'drop-active': dragActive }"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent="onDragOver"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
  >
    <h2>导入题库</h2>
    <div v-if="bankId" class="target">导入到：{{ bankName }}</div>

    <!-- 拖拽提示覆盖层 -->
    <div v-if="dragActive && step === 1" class="drop-overlay">
      <div class="drop-hint">
        <div class="drop-icon">📂</div>
        <div class="drop-text">松开鼠标导入文件</div>
        <div class="drop-hint-small">支持 Word / PDF / Excel / CSV / 文本</div>
      </div>
    </div>

    <div class="step" v-if="step === 1">
      <h3>步骤1：选择 Word 文件</h3>
      <div class="engine-select">
        <label><input type="radio" v-model="engine" value="local" /> 本地引擎（OCR + 规则解析）</label>
        <label><input type="radio" v-model="engine" value="ai" /> AI 引擎（需配置 API Key）</label>
      </div>
      <!-- P0-6：导入是「先清空题库再写入」（api.ts:108/117），非空题库会被整体替换，必须提前讲清楚 -->
      <p v-if="existingCount > 0" class="warning-text">导入将替换题库现有 {{ existingCount }} 题</p>
      <button @click="pickFile">选择文件</button>
      <p class="hint">支持 .docx/.doc/.pdf/.xlsx/.xls/.csv/.txt/.md。PDF、Excel 等格式在云端解析，需联网且可能需要 1-2 分钟</p>
      <p v-if="fileName">{{ fileName }}</p>
    </div>

    <div class="step" v-if="step === 2">
      <h3>步骤2：识别中</h3>

      <!-- 阶段指示器 -->
      <div class="stages">
        <div class="stage" :class="stageClass('reading')">
          <span class="stage-icon">{{ stageIcon('reading') }}</span> 读取文件
        </div>
        <div class="stage-line" :class="{ done: stageIndex > 0 }"></div>
        <div class="stage" :class="stageClass('parsing')">
          <span class="stage-icon">{{ stageIcon('parsing') }}</span> 解析文档
        </div>
        <div class="stage-line" :class="{ done: stageIndex > 1 }"></div>
        <div class="stage" :class="stageClass('recognizing')">
          <span class="stage-icon">{{ stageIcon('recognizing') }}</span> {{ engine === 'ai' ? 'AI 识别' : '结构化识别' }}
        </div>
        <div class="stage-line" :class="{ done: stageIndex > 2 }"></div>
        <div class="stage" :class="stageClass('saving')">
          <span class="stage-icon">{{ stageIcon('saving') }}</span> 保存入库
        </div>
      </div>

      <!-- 确定进度条（AI 分块识别阶段） -->
      <div v-if="progress.total > 0" class="progress-bar">
        <div class="progress-fill" :style="{ width: progressPct + '%' }"></div>
        <span class="progress-text">{{ progress.done }} / {{ progress.total }} 块（{{ progressPct }}%）</span>
      </div>

      <!-- PDF 逐页进度条 -->
      <div v-else-if="pdfProgress && pdfProgress.total > 0" class="progress-bar">
        <div class="progress-fill" :style="{ width: (pdfProgress.total > 0 ? (pdfProgress.done / pdfProgress.total * 100) : 0) + '%' }"></div>
        <span class="progress-text">{{ pdfProgress.done }} / {{ pdfProgress.total }} 页（{{ pdfProgress.total > 0 ? Math.round(pdfProgress.done / pdfProgress.total * 100) : 0 }}%）</span>
      </div>

      <!-- 不确定进度条（读取/解析/保存等不可追踪阶段） -->
      <div v-else class="progress-bar indeterminate">
        <div class="progress-fill-indeterminate"></div>
      </div>

      <p class="status-text">{{ status }}</p>
      <p class="elapsed" v-if="elapsed > 0">已耗时 {{ elapsed }} 秒</p>
      <p class="hint">识别中请勿关闭窗口。大题库可能需要 1-2 分钟；PDF 超过 5 分钟将自动停止</p>
      <button v-if="engine === 'ai'" class="cancel-btn" @click="cancelImport" :disabled="cancelling">{{ cancelling ? '取消中...' : '取消导入' }}</button>
      <button v-if="isPdfImporting" class="cancel-btn" @click="cancelPdfImport" :disabled="cancelling">{{ cancelling ? '取消中...' : '取消 PDF 导入' }}</button>
    </div>

    <div class="step" v-if="step === 2 && importWarning" style="border-color: var(--color-danger-strong);">
      <p class="warning-text">{{ importWarning }}</p>
    </div>

    <div class="step" v-if="step === 3">
      <h3>步骤3：校验识别结果（{{ reviewList.length }} 题）</h3>
      <div v-if="importWarning" class="warning-box">{{ importWarning }}</div>
      <ImportReviewTable :list="reviewList" @update="onUpdate" />
      <div class="actions">
        <button @click="confirmImport">确认导入</button>
        <button @click="resetImport">重新选择</button>
      </div>
    </div>

    <div class="step" v-if="step === 4">
      <!-- P1-34：回写部分失败时 importWarning 之前只在 step 2/3 渲染，而确认导入后立刻切到 step 4 → 提示看不见 -->
      <h3>导入成功！共 {{ importedCount }} 题{{ failedSaveCount ? `（${failedSaveCount} 题修改未保存）` : '' }}</h3>
      <div v-if="importWarning" class="warning-box">{{ importWarning }}</div>
      <button @click="$router.push(`/practice/${bankId}`)">开始刷题</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
// mammoth 改为动态 import，仅在用户选择文件后才加载（约 400KB 节省首屏）
import { api, Question } from '../utils/api'
import { toastError } from '../utils/toast'
import { useBankStore } from '../stores/bank'
import ImportReviewTable from '../components/ImportReviewTable.vue'
import { parseText, parseHtml } from '../lib/parser'
import { newQuestionIds, replacedCount } from '../lib/import-diff'

//#region debug-point import-crash-during
// 调试插桩：仅 DEV 环境启用，向本地 debug server 上报崩溃点
const DBG_URL = 'http://127.0.0.1:8899/logs'
const DBG_SESSION = 'import-crash-during'
const DBG_ENABLED = import.meta.env.DEV
let dbgSeq = 0
function dbg(stage: string, data: Record<string, unknown> = {}) {
  if (!DBG_ENABLED) return
  dbgSeq++
  const payload = JSON.stringify({
    ts: Date.now(),
    level: 'info',
    sessionId: DBG_SESSION,
    stage,
    seq: dbgSeq,
    data
  })
  try {
    fetch(DBG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true
    }).catch(() => {})
  } catch (e) { /* ignore */ }
}
//#endregion

const route = useRoute()
const router = useRouter()
const bankStore = useBankStore()
const bankId = ref(Number(route.params.bankId) || 0)
const bankName = ref('')
const step = ref(1)
const fileName = ref('')
const status = ref('')
const reviewList = ref<Question[]>([])
// 审阅前的题目快照（用于 confirmImport 时判断哪些被改过，只回写变化的题）
const originalSnapshot = ref<Map<number, { stem: string; answer: string; type: string; options: string; analysis: string }>>(new Map())
const importedCount = ref(0)
const engine = ref<'local' | 'ai'>('local')
const progress = ref({ done: 0, total: 0 })
const importWarning = ref('')
const cancelling = ref(false)
// P0-6（2026-09-15）：导入前题库现有题量（step 1 的「导入将替换题库现有 N 题」警告用）
const existingCount = ref(0)
// P0-6：本次导入新产生的题目 id（导入前快照 + 导入后差集）——「重新选择」只删这些，不整库清空
const newIds = ref<number[]>([])
// P1-34：确认导入时回写失败的题数（step 4 标题与警告区展示）
const failedSaveCount = ref(0)
// PDF 导入进度
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const pdfProgress = ref<{ stage: string; done: number; total: number; page?: number; success?: boolean } | null>(null)
const isPdfImporting = computed(() => pdfProgress.value !== null && pdfProgress.value.stage === 'parsing')

// 拖拽上传
const dragActive = ref(false)
let dragCounter = 0
function onDragEnter() {
  if (step.value !== 1) return
  dragCounter++
  dragActive.value = true
}
function onDragOver(e: DragEvent) {
  if (step.value !== 1) return
  e.dataTransfer!.dropEffect = 'copy'
}
function onDragLeave() {
  dragCounter = Math.max(0, dragCounter - 1)
  if (dragCounter === 0) dragActive.value = false
}
async function onDrop(e: DragEvent) {
  dragActive.value = false
  dragCounter = 0
  if (step.value !== 1) return
  const file = e.dataTransfer?.files?.[0]
  if (!file) return
  // 浏览器拖拽：直接拿 File 对象
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  if (!['docx', 'doc', 'txt', 'md', 'pdf', 'xlsx', 'xls', 'csv'].includes(ext)) {
    toastError('不支持的文件格式：' + ext + '（支持 .docx/.doc/.pdf/.xlsx/.xls/.csv/.txt/.md）')
    return
  }
  fileName.value = file.name
  await runImport(file)
}

// 进度阶段
type Stage = 'reading' | 'parsing' | 'recognizing' | 'saving' | 'done'
const stage = ref<Stage>('reading')
const stageOrder: Stage[] = ['reading', 'parsing', 'recognizing', 'saving', 'done']
const stageIndex = computed(() => stageOrder.indexOf(stage.value))
const progressPct = computed(() => progress.value.total > 0 ? Math.round(progress.value.done / progress.value.total * 100) : 0)

function stageClass(s: Stage) {
  const idx = stageOrder.indexOf(s)
  return { active: stage.value === s, done: stageIndex.value > idx }
}
function stageIcon(s: Stage) {
  const idx = stageOrder.indexOf(s)
  if (stageIndex.value > idx) return '✓'
  if (stage.value === s) return '⟳'
  return '○'
}

// 计时器
const elapsed = ref(0)
let timerId: number | null = null
function startTimer() {
  elapsed.value = 0
  if (timerId) window.clearInterval(timerId)
  timerId = window.setInterval(() => { elapsed.value++ }, 1000)
}
function stopTimer() {
  if (timerId) { window.clearInterval(timerId); timerId = null }
}

onUnmounted(() => {
  stopTimer()
})

// P0-6：题库现有题量——step 1 的替换警告需要它；导入前还会再取一次实时快照
async function loadExistingCount() {
  if (!bankId.value) return
  try {
    existingCount.value = replacedCount((await api.listQuestions(bankId.value)).map(q => q.id))
  } catch (e) {
    console.error('读取题库现有题量失败：', e)
  }
}

onMounted(async () => {
  if (!bankId.value) {
    const name = prompt('请输入题库名称')
    if (name) {
      try {
        const b = await bankStore.create(name, null)
        bankId.value = b.id
        bankName.value = b.name
      } catch (e) {
      toastError('创建题库失败：' + (e instanceof Error ? e.message : String(e)))
      router.push('/')
    }
    } else {
      router.push('/')
    }
  } else {
    bankName.value = bankStore.banks.find(b => b.id === bankId.value)?.name || ''
  }
  await loadExistingCount()
})

function htmlToText(html: string): string {
  // P0-3: 用 DOMParser 替代 innerHTML，避免 <img onerror=...> 等 XSS 风险
  // parseToString('text/html') 不执行脚本/不触发内联事件
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return doc.body.textContent || doc.body.innerText || ''
}

async function pickFile() {
  dbg('pickFile_start', { engine: engine.value, bankId: bankId.value })
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.docx,.doc,.txt,.md,.pdf,.xlsx,.xls,.csv'
  const file: File | null = await new Promise(resolve => {
    input.onchange = () => resolve(input.files?.[0] || null)
    input.click()
  })
  if (!file) return
  const fileNameOnly = file.name
  fileName.value = fileNameOnly
  const ext = (fileNameOnly.split('.').pop() || '').toLowerCase()
  if (!['docx', 'doc', 'txt', 'md', 'pdf', 'xlsx', 'xls', 'csv'].includes(ext)) {
    toastError('不支持的文件格式：' + ext + '（支持 .docx/.doc/.pdf/.xlsx/.xls/.csv/.txt/.md）')
    return
  }
  await runImport(file)
}

// 实际导入流程：传入 File 对象（浏览器版）
async function runImport(file: File) {
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  step.value = 2
  progress.value = { done: 0, total: 0 }
  importWarning.value = ''
  cancelling.value = false
  newIds.value = []
  startTimer()

  try {
    // AI 引擎：先测试连通性，避免卡死
    if (engine.value === 'ai') {
      stage.value = 'reading'
      status.value = '正在测试 AI 连接...'
      dbg('ai_connection_test_start')
      try {
        await api.testAiConnection()
        dbg('ai_connection_test_ok')
      } catch (e) {
        dbg('ai_connection_test_fail', { err: e instanceof Error ? e.message : String(e) })
        throw new Error('AI 连接失败：' + (e instanceof Error ? e.message : String(e)) + '。请到设置页检查 API Key、地址、模型。')
      }
    }

    // 阶段1+2：按文件类型分别处理
    let html: string
    let text: string
    stage.value = 'reading'
    const CLOUD_EXTS = ['pdf', 'xlsx', 'xls', 'csv', 'doc']
    if (ext === 'docx') {
      // Word：浏览器端 mammoth 优先（快且离线），失败时回退云端解析
      status.value = '正在读取 Word 文件...'
      dbg('readFile_start', { name: file.name })
      try {
        const arrayBuffer = await file.arrayBuffer()
        dbg('readFile_done', { bytes: arrayBuffer.byteLength })
        stage.value = 'parsing'
        status.value = '正在解析 Word 文档...'
        const mammoth = (await import('mammoth')).default
        const result = await mammoth.convertToHtml({ arrayBuffer })
        html = result.value
        dbg('mammoth_done', { htmlLen: html.length, messages: result.messages.length })
        text = htmlToText(html)
      } catch (localErr) {
        dbg('mammoth_failed_fallback_cloud', { err: String(localErr) })
        status.value = '本地解析失败，改用云端解析...'
        const { parseFileInCloud } = await import('../lib/cloud-parse')
        const paragraphs = await parseFileInCloud(file, t => { status.value = t })
        text = paragraphs.join('\n')
        html = paragraphs.map(l => `<p>${escapeHtml(l)}</p>`).join('\n')
      }
    } else if (CLOUD_EXTS.includes(ext)) {
      // PDF / Excel / CSV / 老版 doc：云函数解析
      stage.value = 'parsing'
      status.value = '正在上传到云端...'
      dbg('cloud_parse_start', { ext, name: file.name })
      const { parseFileInCloud } = await import('../lib/cloud-parse')
      const paragraphs = await parseFileInCloud(file, t => { status.value = t })
      dbg('cloud_parse_done', { count: paragraphs.length })
      text = paragraphs.join('\n')
      html = paragraphs.map(l => `<p>${escapeHtml(l)}</p>`).join('\n')
    } else {
      // txt / md 等纯文本
      status.value = '正在读取文本...'
      dbg('readText_start', { name: file.name })
      text = await file.text()
      // 转成 mammoth 兼容 HTML：每个非空行包 <p>，后端会复用 html_to_questions
      html = text
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l.length > 0)
        .map(l => `<p>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
        .join('\n')
      dbg('readText_done', { textLen: text.length, htmlLen: html.length })
    }

    // 阶段3：识别
    // P0-6（2026-09-15）：写库从这一步开始（importFromHtml / importWithAi 都是「先清空再写入」），
    // 故先对题库现有题目 id 做快照：导入后的差集 = 本次导入新产生的题，「重新选择」只允许删这些。
    // ⚠️ 旧版的缺陷**不是**「删掉了用户原有题」（那批题在导入这一步就已被清空，见下方 `resetImport` 的更正说明），
    // 而是那次整库清空**不可逆且没有任何确认**，一次误点即丢整卷。差集层是把「删多少」算准的未来防护。
    const beforeIds = (await api.listQuestions(bankId.value)).map(q => q.id)
    existingCount.value = replacedCount(beforeIds)
    stage.value = 'recognizing'
    if (engine.value === 'ai') {
      status.value = 'AI 识别中（分块解析，请耐心等待...）'
      progress.value = { done: 0, total: 0 }
    } else {
      status.value = '结构化识别中...'
    }
    if (engine.value === 'ai') {
      dbg('importWithAi_call_start', { textLen: text.length })
      const importResult = await api.importWithAi(bankId.value, text, (done, total) => {
        progress.value = { done, total }
      })
      dbg('importWithAi_call_done', { count: importResult.count, expected: importResult.expected })
      if (cancelling.value) {
        importWarning.value = `已取消导入，仅识别到 ${importResult.count} 题（预计 ${importResult.expected} 题）。可重新选择文件再次导入。`
        cancelling.value = false
      } else if (importResult.failedChunks > 0) {
        // 2026-09-18 新增（重审 A-21）：分块失败原来只写 console，用户只看到「题数偏少」。
        // 这条比下面的题数启发式精确得多（知道是**整块**丢了），所以排在前面。
        importWarning.value = `⚠ AI 分块有 ${importResult.failedChunks}/${importResult.totalChunks} 块解析失败并已跳过，可能少了整块的题目。建议重新导入。`
      } else if (importResult.expected > 0 && importResult.count < importResult.expected - 5) {
        // A-23：expected 现在是**独立于 AI 的文档题号预估**（原先等于 count，这条永远不触发）
        importWarning.value = `⚠ 识别到 ${importResult.count} 题，但文档预估约 ${importResult.expected} 题，可能有 ${importResult.expected - importResult.count} 题丢失（AI 输出截断或网络错误）。可尝试重新导入。`
      }
    } else {
      dbg('importFromHtml_call_start', { htmlLen: html.length })
      const cnt = await api.importFromHtml(bankId.value, html)
      dbg('importFromHtml_call_done', { count: cnt })
    }

    // 阶段4：保存入库
    stage.value = 'saving'
    status.value = '正在保存到数据库...'
    dbg('listQuestions_call_start', { bankId: bankId.value })
    const qs = await api.listQuestions(bankId.value)
    dbg('listQuestions_call_done', { count: qs.length })
    dbg('reviewList_assign_start')
    reviewList.value = qs
    // P0-6：差集 = 本次导入新产生的题目 id（「重新选择」只删这些）
    newIds.value = newQuestionIds(beforeIds, qs.map(q => q.id))
    // 记录审阅前快照，供确认导入时判断改动
    originalSnapshot.value = new Map(
      qs.filter(q => q.id != null).map(q => [
        q.id as number,
        {
          stem: q.stem,
          answer: q.answer ?? '',
          type: q.type,
          options: JSON.stringify(q.options ?? []),
          analysis: q.analysis ?? '',
        },
      ]),
    )
    dbg('reviewList_assign_done')

    stage.value = 'done'
    stopTimer()
    dbg('step3_switch_start')
    step.value = 3
    dbg('step3_switch_done')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    dbg('pickFile_error', { msg, cancelling: cancelling.value, stack: e instanceof Error ? e.stack : undefined })
    if (cancelling.value) {
      status.value = '已取消导入'
    } else {
      status.value = '失败：' + msg
      // P1-33：失败后立刻切回 step 1，而 status 只在 step 2 渲染 → 用户看不到任何失败原因，改用 toast
      toastError('导入失败：' + msg)
    }
    step.value = 1
    stopTimer()
    cancelling.value = false
  }
}

async function cancelImport() {
  cancelling.value = true
  try {
    await api.cancelImport()
    status.value = '正在取消...'
  } catch (e) {
    console.error('取消失败：', e)
  }
}

// 取消 PDF 导入：触发后端全局取消标志，pdf_to_html 循环将在下一页检查并退出
async function cancelPdfImport() {
  cancelling.value = true
  try {
    status.value = '正在取消 PDF 导入...'
    await api.cancelPdfImport()
  } catch (e) {
    console.error('取消 PDF 导入失败：', e)
  } finally {
    cancelling.value = false
  }
}

function onUpdate(q: Question) {
  const i = reviewList.value.findIndex(x => x.id === q.id)
  if (i >= 0) reviewList.value[i] = q
}

async function resetImport() {
  // P0-6（2026-09-15；危害描述经复审核正——本段初版是错的）：
  // 旧版这里**无确认**直接 api.clearBankQuestions（整库清空），一次误点即不可逆地丢掉整卷。
  // ⚠️ 初版注释写的「用户在导入前题库里已有的题目会被一并删除」**不成立**：导入本身
  // （api.ts:108 / :117）就是「先清空再写入」，走到 step 3 时题库里只剩本次导入的题，
  // 旧版删的正是「重新选择」该删的那批。**不可逆删除没有确认**才是真正的缺陷，确认门禁才是修复。
  // 现在只删本次导入新产生的题（newIds = 导入前快照与导入后的差集），属把「删多少」算准的**未来防护**。
  const ids = newIds.value
  if (bankId.value && ids.length > 0) {
    if (!confirm(`「重新选择」将删除本次导入的 ${ids.length} 题，且不可撤销。继续吗？`)) return
    try {
      await api.deleteQuestions(bankId.value, ids)
    } catch (e) {
      console.error('清理本次导入的题目失败：', e)
      toastError('清理本次导入的题目失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }
  reviewList.value = []
  fileName.value = ''
  importWarning.value = ''
  failedSaveCount.value = 0
  // 2026-09-15（复审核正）：回到 step 1 时本题库已没有「本次导入待替换」的题了，
  // 若不清零，step 1 会显示一个过期的「导入将替换题库现有 N 题」——而那个数早已不成立。
  existingCount.value = 0
  newIds.value = []
  step.value = 1
}

async function confirmImport() {
  // 2026-09-09 修复：此前只统计数量，审阅表格里改过的题干/答案/选项没有写回数据库，编辑等于无效。
  // 现在逐题比对原始快照，仅对真正改动的题目调用 updateQuestion。
  const changed = reviewList.value.filter(q => {
    const orig = originalSnapshot.value.get(q.id!)
    if (!orig) return false
    return orig.stem !== q.stem
      || orig.answer !== q.answer
      || orig.type !== q.type
      || orig.options !== JSON.stringify(q.options ?? [])
      || (orig.analysis ?? '') !== (q.analysis ?? '')
  })

  if (changed.length) {
    status.value = `正在保存 ${changed.length} 处修改…`
    let ok = 0
    for (const q of changed) {
      try {
        await api.updateQuestion(q)
        ok++
      } catch (e) {
        console.error('回写题目失败：', q.id, e)
      }
    }
    if (ok < changed.length) {
      failedSaveCount.value = changed.length - ok
      importWarning.value = `${changed.length - ok} 题修改未保存成功，可在练习页重新编辑`
    } else {
      failedSaveCount.value = 0
    }
    status.value = ''
  }

  importedCount.value = reviewList.value.length
  step.value = 4
}
</script>

<style scoped>
.import { position: relative; min-height: 100%; }
.drop-active { outline: 2px dashed var(--color-primary); outline-offset: -8px; }
.drop-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 1000; pointer-events: none; animation: dropFade 0.15s; }
.drop-hint { background: var(--color-card); border-radius: var(--radius-lg); padding: 48px 80px; text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,0.3); border: 3px dashed var(--color-primary); }
.drop-icon { font-size: 64px; margin-bottom: 12px; }
.drop-text { font-size: 20px; font-weight: 600; color: var(--color-text); margin-bottom: 6px; }
.drop-hint-small { font-size: 13px; color: var(--color-text-tertiary); }
@keyframes dropFade { from { opacity: 0; } to { opacity: 1; } }

.step { background: var(--color-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 24px; margin-top: 16px; }
.actions { margin-top: 16px; display: flex; gap: 8px; }
button { padding: 8px 16px; border: 1px solid var(--color-border); border-radius: var(--radius-md); cursor: pointer; background: var(--color-card); color: var(--color-text); }
button:hover { background: var(--color-border-light); }
.target { color: var(--color-text-secondary); margin-bottom: 12px; }
.engine-select { margin-bottom: 12px; }
.engine-select label { display: block; margin: 4px 0; }
.hint { color: var(--color-text-tertiary); font-size: 13px; }
.status-text { font-size: 15px; margin: 12px 0 4px; }
.elapsed { color: var(--color-text-tertiary); font-size: 13px; margin: 4px 0; }

/* 阶段指示器 */
.stages { display: flex; align-items: center; margin: 16px 0; flex-wrap: wrap; gap: 4px; }
.stage { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--color-text-tertiary); padding: 4px 8px; border-radius: var(--radius-sm); white-space: nowrap; }
.stage.active { color: var(--color-primary); font-weight: 500; background: var(--color-primary-light); }
.stage.done { color: var(--color-primary); }
.stage-icon { font-size: 16px; }
.stage.active .stage-icon { animation: spin 1s linear infinite; display: inline-block; }
.stage-line { width: 20px; height: 2px; background: var(--color-border); }
.stage-line.done { background: var(--color-primary); }

@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

/* 确定进度条 */
.progress-bar { position: relative; width: 100%; max-width: 500px; height: 28px; background: var(--color-border-light); border-radius: 14px; overflow: hidden; margin: 12px 0; }
.progress-fill { position: absolute; left: 0; top: 0; height: 100%; background: var(--color-primary); transition: width 0.3s; }
.progress-text { position: absolute; width: 100%; text-align: center; line-height: 28px; font-size: 13px; color: var(--color-text); font-weight: 500; }

/* 不确定进度条（条纹流动动画） */
.progress-bar.indeterminate { background: var(--color-border-light); }
.progress-fill-indeterminate { position: absolute; height: 100%; width: 40%; background: var(--color-primary); border-radius: 14px; animation: indeterminate 1.5s ease-in-out infinite; }
@keyframes indeterminate {
  0% { left: -40%; }
  100% { left: 100%; }
}

.warning-box { background: var(--color-warning-light); border: 1px solid var(--color-warning); border-radius: var(--radius-md); padding: 12px; margin-bottom: 12px; color: var(--color-warning); font-size: 14px; }
.warning-text { color: var(--color-danger); font-size: 14px; margin: 0; }
.cancel-btn { margin-top: 12px; padding: 8px 20px; border: 1px solid var(--color-danger); border-radius: var(--radius-md); background: var(--color-card); color: var(--color-danger); cursor: pointer; font-size: 14px; }
.cancel-btn:hover { background: var(--color-danger-light); }
.cancel-btn:disabled { color: var(--color-text-tertiary); border-color: var(--color-border); cursor: not-allowed; }

/* 移动端适配 */
@media (max-width: 768px) {
  .step { padding: 16px; }
  .drop-hint { padding: 28px 20px; }
  .actions { flex-wrap: wrap; }
  .actions button { flex: 1; }
  .stage { padding: 3px 6px; font-size: 12px; }
}
</style>
