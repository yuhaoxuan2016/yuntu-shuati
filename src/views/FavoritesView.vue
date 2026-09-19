<template>
  <div class="favorites">
    <h2>收藏夹（{{ favoriteIds.length }} 题）</h2>
    <div v-if="!practicing && favoriteIds.length" class="toolbar">
      <button @click="startAll">收藏重练</button>
      <button class="clear-btn" @click="clearAll">清空收藏</button>
    </div>

    <!-- 列表视图：展示所有收藏题目 -->
    <div v-if="!practicing" class="fav-list">
      <div v-if="!favoriteIds.length" class="empty">
        暂无收藏题目。在练习时点击"☆ 收藏"按钮即可加入收藏夹。
      </div>
      <div v-for="(q, i) in favQuestions" :key="q.id" class="fav-item">
        <div class="fav-main" @click="startFrom(i)">
          <span class="fav-idx">{{ i + 1 }}.</span>
          <span class="type-tag">{{ typeLabel(q) }}</span>
          <span class="fav-stem">{{ truncate(q.stem, 60) }}</span>
        </div>
        <button class="remove-btn" title="取消收藏" @click.stop="removeOne(q.id)">×</button>
      </div>
    </div>

    <!-- 练习视图 -->
    <QuestionCard
      v-if="practicing && current"
      :key="current.id"
      :question="current"
      :index="idx"
      :favorited="true"
      @answered="onAnswered"
      @next="next"
      @toggle-favorite="onToggleFavorite"
    />
    <div v-else-if="practicing && !current" class="empty">收藏夹已空</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { api, Question } from '../utils/api'
import { toastError } from '../utils/toast'
import { classifyQuestionType } from '../lib/exam'
import QuestionCard from '../components/QuestionCard.vue'

const route = useRoute()
const bankId = Number(route.params.bankId)
const allQuestions = ref<Question[]>([])
const favoriteIds = ref<number[]>([])
const practicing = ref(false)
const queue = ref<number[]>([])
const idx = ref(0)
const current = ref<Question | null>(null)

// 按收藏顺序展示的题目对象列表
const favQuestions = computed(() => {
  const map = new Map(allQuestions.value.map(q => [q.id, q]))
  return favoriteIds.value.map(id => map.get(id)).filter((q): q is Question => !!q)
})

onMounted(async () => {
  try {
    allQuestions.value = await api.listQuestions(bankId)
    favoriteIds.value = await api.listFavorites(bankId)
  } catch (e) {
    toastError('加载收藏失败：' + (e instanceof Error ? e.message : String(e)))
  }
})

// 2026-08-16 修复：题型标签用内容识别（判断题在库里是 type:'single' + ["正确","错误"]，裸 q.type 会显示"单选"）
function typeLabel(q: Question): string {
  const t = classifyQuestionType(q)
  return ({ single: '单选', multi: '多选', judge: '判断', blank: '填空', qa: '问答' } as Record<string, string>)[t] || t
}
function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

// 从第 i 题开始练习
function startFrom(i: number) {
  queue.value = [...favoriteIds.value]
  idx.value = i
  practicing.value = true
  loadCurrent()
}
// 从第一题开始
function startAll() {
  startFrom(0)
}
function loadCurrent() {
  while (idx.value < queue.value.length) {
    const id = queue.value[idx.value]
    const q = allQuestions.value.find(q => q.id === id)
    if (q) {
      current.value = q
      return
    }
    idx.value++
  }
  current.value = null
  practicing.value = false
}
async function next() {
  if (idx.value < queue.value.length - 1) {
    idx.value++
    loadCurrent()
  } else {
    practicing.value = false
    current.value = null
    try {
      favoriteIds.value = await api.listFavorites(bankId)
    } catch (e) {
      console.error('刷新收藏列表失败：', e)
    }
  }
}
async function onAnswered(payload: { correct: boolean; answer: string; duration_ms: number | null }) {
  if (current.value) {
    try {
      await api.recordPractice({ bank_id: bankId, question_id: current.value.id, user_answer: payload.answer, is_correct: payload.correct, duration_ms: payload.duration_ms })
    } catch (e) {
      console.error('记录练习失败：', e)
    }
  }
}
// 练习中取消收藏：移出队列继续下一题
async function onToggleFavorite() {
  if (!current.value) return
  try {
    await api.toggleFavorite(bankId, current.value.id)
    queue.value.splice(idx.value, 1)
    favoriteIds.value = await api.listFavorites(bankId)
    if (queue.value.length === 0) {
      practicing.value = false
      current.value = null
    } else {
      if (idx.value >= queue.value.length) idx.value = queue.value.length - 1
      loadCurrent()
    }
  } catch (e) {
    console.error('取消收藏失败：', e)
  }
}
// 列表中单项取消收藏
async function removeOne(id: number) {
  try {
    await api.toggleFavorite(bankId, id)
    favoriteIds.value = await api.listFavorites(bankId)
  } catch (e) {
    console.error('取消收藏失败：', e)
  }
}
async function clearAll() {
  if (!favoriteIds.value.length) return
  if (!confirm('确认清空该题库的所有收藏？')) return
  try {
    // P2-8: 使用批量清空命令，避免 N 次 IPC
    await api.clearFavorites(bankId)
    favoriteIds.value = []
    practicing.value = false
    current.value = null
  } catch (e) {
    toastError('清空收藏失败：' + (e instanceof Error ? e.message : String(e)))
  }
}
</script>

<style scoped>
.favorites { max-width: 800px; }
.toolbar { margin-bottom: 16px; }
.empty { text-align: center; padding: 48px; color: var(--color-text-tertiary); }
button { padding: 8px 16px; border: 1px solid var(--color-border); border-radius: 6px; cursor: pointer; margin-right: 8px; background: var(--color-card); }
button:hover { background: var(--color-border-light); }
.clear-btn { color: var(--color-danger); border-color: var(--color-danger); }
.clear-btn:hover { background: var(--color-danger-light); }

.fav-list { display: flex; flex-direction: column; gap: 8px; }
.fav-item { display: flex; align-items: center; gap: 8px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: 6px; padding: 10px 12px; }
.fav-item:hover { border-color: var(--color-warning-strong); background: var(--color-warning-light); }
.fav-main { flex: 1; cursor: pointer; display: flex; align-items: center; gap: 8px; min-width: 0; }
.fav-idx { font-weight: bold; color: var(--color-text-tertiary); flex-shrink: 0; }
.type-tag { background: var(--color-border-light); padding: 2px 8px; border-radius: 4px; font-size: 12px; flex-shrink: 0; }
.fav-stem { color: var(--color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.remove-btn { flex-shrink: 0; width: 28px; height: 28px; border: 1px solid var(--color-border); border-radius: 50%; background: var(--color-card); cursor: pointer; font-size: 16px; line-height: 1; color: var(--color-text-tertiary); padding: 0; margin: 0; }
.remove-btn:hover { background: var(--color-danger-light); color: var(--color-danger); border-color: var(--color-danger); }

/* 移动端适配 */
@media (max-width: 768px) {
  .fav-item { padding: 10px 8px; gap: 6px; }
  .fav-stem { font-size: 13px; }
  .toolbar button { margin-bottom: 6px; }
}
</style>
