<template>
  <Teleport to="body">
    <transition name="fade">
      <div v-if="visible" class="edit-mask" @click.self="close">
        <div class="edit-card">
          <button class="close-btn" @click="close" aria-label="关闭">×</button>
          <h2>编辑题目</h2>

          <div class="form-row">
            <label>类型</label>
            <select v-model="form.type">
              <option value="single">单选</option>
              <option value="multi">多选</option>
              <option value="judge">判断</option>
              <option value="blank">填空</option>
              <option value="qa">问答</option>
            </select>
          </div>

          <div class="form-row">
            <label>题干</label>
            <textarea v-model="form.stem" rows="4" placeholder="题干内容"></textarea>
          </div>

          <!-- 选项（仅 single/multi） -->
          <div v-if="form.type === 'single' || form.type === 'multi'" class="form-row">
            <label>选项 <button class="mini-btn" @click="addOption">+ 添加</button></label>
            <div v-for="(_opt, i) in form.options" :key="i" class="option-edit">
              <span class="opt-letter">{{ letter(i) }}</span>
              <input v-model="form.options[i]" :placeholder="`选项 ${letter(i)}`" />
              <button v-if="form.options.length > 2" class="mini-btn danger" @click="removeOption(i)">✕</button>
            </div>
          </div>

          <!-- 答案 -->
          <div class="form-row">
            <label>答案</label>
            <!-- 单选 -->
            <select v-if="form.type === 'single'" v-model="form.answer">
              <option v-for="(opt, i) in form.options" :key="i" :value="letter(i)">{{ letter(i) }}{{ opt ? ' - ' + opt.slice(0, 20) : '' }}</option>
            </select>
            <!-- 多选 -->
            <div v-else-if="form.type === 'multi'" class="multi-answer">
              <label v-for="(opt, i) in form.options" :key="i" class="checkbox-label">
                <input type="checkbox" :value="letter(i)" v-model="multiAnswer" />
                <span>{{ letter(i) }}{{ opt ? ' - ' + opt.slice(0, 20) : '' }}</span>
              </label>
            </div>
            <!-- 判断 -->
            <div v-else-if="form.type === 'judge'" class="judge-answer">
              <label class="radio-label"><input type="radio" value="true" v-model="form.answer" /> 正确</label>
              <label class="radio-label"><input type="radio" value="false" v-model="form.answer" /> 错误</label>
            </div>
            <!-- 填空/问答 -->
            <textarea v-else v-model="form.answer" rows="2" placeholder="答案文本"></textarea>
          </div>

          <div class="form-row">
            <label>解析（可选）</label>
            <textarea v-model="form.analysis" rows="3" placeholder="解题思路"></textarea>
          </div>

          <div class="form-actions">
            <button class="cancel-btn" @click="close">取消</button>
            <button class="save-btn" :disabled="saving" @click="save">{{ saving ? '保存中...' : '保存' }}</button>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { api, Question } from '../utils/api'
import { toastError } from '../utils/toast'

const props = defineProps<{ visible: boolean; question: Question | null }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved', q: Question): void }>()

const form = ref<{ type: string; stem: string; options: string[]; answer: string; analysis: string }>({
  type: 'single', stem: '', options: [], answer: '', analysis: ''
})
const multiAnswer = ref<string[]>([])
const saving = ref(false)

// 当 question 变化时填充表单
watch(() => props.question, (q) => {
  if (!q) return
  // 解析 options
  let options: string[] = []
  if (q.options) {
    try { options = JSON.parse(q.options) } catch { options = [] }
  }
  // 解析 answer
  let answer = q.answer || ''
  // 2026-08-16：判断题 answer 归一为 true/false（radio 用布尔值），兼容旧 'A'/'B' 与判断词
  if (q.type === 'judge' && answer) {
    const a = answer.trim().toUpperCase()
    if (a === 'A' || a === '正确' || a === '对' || a === '√') answer = 'true'
    else if (a === 'B' || a === '错误' || a === '错' || a === '×') answer = 'false'
  }
  if (q.type === 'multi' && answer) {
    try { multiAnswer.value = JSON.parse(answer) } catch { multiAnswer.value = answer.split('') }
  } else {
    multiAnswer.value = []
  }
  form.value = {
    type: q.type,
    stem: q.stem,
    options,
    answer,
    analysis: q.analysis || ''
  }
}, { immediate: true })

// 多选答案变化时同步到 form.answer
watch(multiAnswer, (vals) => {
  if (form.value.type === 'multi') {
    form.value.answer = JSON.stringify([...vals].sort())
  }
}, { deep: true })

// 切换题型时重置答案，避免残留旧格式（2026-08-15 修复）
watch(() => form.value.type, (t) => {
  if (t === 'multi') {
    // 从当前 answer 重建勾选（兼容旧 JSON 数组 / 紧凑字母串）
    let letters: string[] = []
    const a = form.value.answer || ''
    try {
      const arr = JSON.parse(a)
      if (Array.isArray(arr)) letters = arr.map((s: unknown) => String(s).trim().toUpperCase()).filter(s => /^[A-H]$/.test(s))
    } catch { /* not JSON */ }
    if (letters.length === 0) letters = a.split('').filter(c => /[A-H]/i.test(c)).map(c => c.toUpperCase())
    multiAnswer.value = letters
  } else if (t === 'judge') {
    multiAnswer.value = []
    const a = (form.value.answer || '').trim().toLowerCase()
    if (a === 'a' || a === '正确' || a === '对' || a === '√') form.value.answer = 'true'
    else if (a === 'b' || a === '错误' || a === '错' || a === '×') form.value.answer = 'false'
    else if (a !== 'true' && a !== 'false') form.value.answer = 'true'
  } else if (t === 'single') {
    multiAnswer.value = []
    if (form.value.options.length > 0 && !/^[A-H]$/i.test(form.value.answer || '')) {
      form.value.answer = 'A'
    }
  } else {
    multiAnswer.value = []
    if (!form.value.answer) form.value.answer = ''
  }
})

const letter = (i: number) => String.fromCharCode(65 + i)

// 2026-09-18 新增（重审 B-09 / B-08）：删掉或清空一个选项时**必须同步挪动答案字母**。
//   原实现只 `splice` 选项、完全不动 `answer` ⇒ 答案字母悬空（指向已不存在的项）且照样保存上云：
//   该题此后在任何端都答不对，界面上却看不出异常；multi 同理（勾选的字母整体错位）。
//   `removedIdx` 是要移除的**原始下标**（升序不必、内部会逐个判断），字母按
//   「被删的丢掉、其后的整体前移」重算。
function remapAnswerAfterRemoval(removedIdx: number[]) {
  const drop = new Set(removedIdx)
  const mapLetter = (L: string): string | null => {
    const i = L.charCodeAt(0) - 65
    if (!(i >= 0 && i < 26)) return null
    if (drop.has(i)) return null
    let shift = 0
    for (const d of drop) if (d < i) shift++
    return String.fromCharCode(65 + i - shift)
  }
  if (form.value.type === 'single') {
    const cur = String(form.value.answer || '').trim().toUpperCase()
    if (/^[A-Z]$/.test(cur)) form.value.answer = mapLetter(cur) || ''   // 被删的正是答案 ⇒ 置空，由保存前校验拦下
    return
  }
  if (form.value.type === 'multi') {
    const next: string[] = []
    for (const L of multiAnswer.value) {
      const m = mapLetter(String(L).trim().toUpperCase())
      if (m) next.push(m)
    }
    multiAnswer.value = next   // watch(multiAnswer) 会把它同步进 form.answer
  }
}

function addOption() {
  form.value.options.push('')
}
function removeOption(i: number) {
  form.value.options.splice(i, 1)
  remapAnswerAfterRemoval([i])
}

// 2026-09-18 新增（重审 B-08 的**根因侧**）：保存前清掉空白选项。
//   `addOption` 允许 push 出空串，原先原样序列化上云；而展示端（ExamTicketView 的 displayOptions）
//   会把空项过滤掉、造成「展示序号 ↔ 原始下标」错位 ⇒ 学生点的选项被记到别的字母上（服务端判分已入云端）。
//   这里连答案一起重映射，保证选项与答案始终自洽。
function pruneBlankOptions() {
  const blanks: number[] = []
  form.value.options.forEach((o, i) => { if (String(o ?? '').trim() === '') blanks.push(i) })
  if (!blanks.length) return
  remapAnswerAfterRemoval(blanks)
  for (const i of [...blanks].reverse()) form.value.options.splice(i, 1)
}

function close() { emit('close') }

async function save() {
  if (!props.question) return
  // 2026-09-18（重审 B-08 / B-09）：选择题在保存前做两件清洗与校验——
  //   ① 清掉空白选项（并同步挪答案），不让「带空选项的题」再进云端；
  //   ② 拦住**悬空答案**（字母指向已不存在的选项）。这是最后一道闸：这类题存进去之后，
  //      任何端都答不对、且界面看不出来，只能靠人再发现。
  if (form.value.type === 'single' || form.value.type === 'multi') {
    pruneBlankOptions()
    const n = form.value.options.length
    const letters = form.value.type === 'single'
      ? (/^[A-Z]$/.test(String(form.value.answer || '').trim().toUpperCase()) ? [String(form.value.answer).trim().toUpperCase()] : [])
      : multiAnswer.value.map(l => String(l).trim().toUpperCase()).filter(Boolean)
    const dangling = letters.filter(L => { const i = L.charCodeAt(0) - 65; return i < 0 || i >= n })
    if (dangling.length) {
      toastError(`答案（${dangling.join('、')}）指向的选项已不存在，请重新选择答案`)
      return
    }
  }
  saving.value = true
  try {
    const updated: Question = {
      ...props.question,
      type: form.value.type,
      stem: form.value.stem,
      options: (form.value.type === 'single' || form.value.type === 'multi') && form.value.options.length > 0
        ? JSON.stringify(form.value.options) : null,
      answer: form.value.answer || null,
      analysis: form.value.analysis || null,
    }
    await api.updateQuestion(updated)
    emit('saved', updated)
  } catch (e) {
    toastError('保存失败：' + (e instanceof Error ? e.message : String(e)))
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.edit-mask {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 9999;
}
.edit-card {
  position: relative;
  background: var(--color-card);
  border-radius: 12px;
  padding: 24px 28px;
  width: 600px;
  max-width: 92vw;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 12px 40px rgba(0,0,0,0.3);
  color: var(--color-text);
}
.close-btn {
  position: absolute; top: 12px; right: 16px;
  background: none; border: none; cursor: pointer;
  font-size: 22px; color: var(--color-text-tertiary);
}
.close-btn:hover { color: var(--color-text); }
h2 { margin: 0 0 16px; font-size: 18px; }
.form-row { margin-bottom: 14px; }
.form-row label { display: block; font-size: 13px; color: var(--color-text-secondary); margin-bottom: 4px; font-weight: 500; }
textarea, input[type="text"], select {
  width: 100%; padding: 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-card);
  color: var(--color-text);
  font-family: inherit; font-size: 14px;
}
textarea { resize: vertical; }
.option-edit { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.opt-letter { font-weight: bold; width: 20px; color: var(--color-primary); }
.option-edit input { flex: 1; }
.mini-btn {
  padding: 2px 8px; border: 1px solid var(--color-border);
  border-radius: 4px; background: var(--color-card); cursor: pointer;
  font-size: 12px; color: var(--color-text-secondary);
}
.mini-btn.danger { color: var(--color-danger); border-color: var(--color-danger); }
.mini-btn.danger:hover { background: var(--color-danger-light); }
.multi-answer, .judge-answer { display: flex; flex-wrap: wrap; gap: 12px; }
.checkbox-label, .radio-label { display: flex; align-items: center; gap: 4px; cursor: pointer; font-size: 14px; }
.form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.cancel-btn {
  padding: 8px 16px; border: 1px solid var(--color-border);
  border-radius: 6px; background: var(--color-card); cursor: pointer;
  color: var(--color-text);
}
.save-btn {
  padding: 8px 20px; border: none;
  border-radius: 6px; background: var(--color-primary); color: #fff;
  cursor: pointer; font-weight: 500;
}
.save-btn:disabled { background: var(--color-text-tertiary); cursor: not-allowed; }
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
