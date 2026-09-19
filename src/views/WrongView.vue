<template>
  <div class="wrong">
    <h2>错题本（{{ wrongIds.length }} 题）</h2>

    <div class="tabs">
      <button :class="{ active: tab === 'pending' }" @click="tab = 'pending'">待重练（{{ wrongIds.length }}）</button>
      <button :class="{ active: tab === 'mastered' }" @click="tab = 'mastered'">已掌握（{{ masteredIds.length }}）</button>
    </div>

    <div v-if="tab === 'pending'">
      <!-- 错题分类筛选 -->
      <div class="wrong-filter">
        <div class="filter-label">按题型筛选：</div>
        <div class="filter-tags">
          <button 
            v-for="type in questionTypes" 
            :key="type.value"
            :class="{ active: selectedType === type.value }"
            @click="selectedType = type.value"
          >
            {{ type.label }} ({{ type.count }})
          </button>
        </div>
      </div>

      <!-- 错题统计 -->
      <div class="wrong-stats">
        <div class="stat-item">
          <span class="stat-value">{{ filteredWrongIds.length }}</span>
          <span class="stat-label">错题数</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{{ masteredIds.length }}</span>
          <span class="stat-label">已掌握</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{{ masteryRate }}%</span>
          <span class="stat-label">掌握率</span>
        </div>
      </div>

      <div class="actions-bar">
        <button v-if="filteredWrongIds.length && !practicing" @click="start">错题重练</button>
        <button v-if="practicing" @click="exitPractice">退出重练</button>
      </div>

      <QuestionCard
        v-if="practicing && current"
        :key="current.id"
        :question="current"
        :index="idx"
        :favorited="favoriteIds.has(current.id)"
        @answered="onAnswered"
        @next="next"
        @toggle-favorite="onToggleFavorite"
      />

      <div v-if="practicing && current" class="quick-actions">
        <button class="master-btn" @click="markMastered(current.id)">标记已掌握</button>
      </div>

      <div v-else-if="!wrongIds.length" class="empty">暂无错题，继续加油！</div>

      <!-- 错题列表 -->
      <ul v-else class="wrong-list">
        <li
          v-for="(id, index) in filteredWrongIds"
          :key="id"
          @click="jumpToQuestion(id)"
          class="wrong-item"
          :class="{ active: practicing && current && current.id === id }"
        >
          <span class="item-index">{{ index + 1 }}</span>
          <span class="item-preview">{{ getQuestionPreview(id) }}</span>
          <span v-if="totalWrongMap.get(id)" class="wrong-count-tag" :class="{ stubborn: (totalWrongMap.get(id) || 0) >= 3 }">🔁 做错 {{ totalWrongMap.get(id) }} 次</span>
          <span v-if="threshold > 0 && streakMap.get(id)" class="streak-tag" :class="{ near: (streakMap.get(id) || 0) >= threshold - 1 }">✅ 连对 {{ streakMap.get(id) }}/{{ threshold }}</span>
          <button class="quick-master-btn" title="标记已掌握" @click.stop="markMastered(id)">✓ 掌握</button>
          <button class="quick-del-btn" title="删除记录" @click.stop="removeWrong(id)">🗑</button>
        </li>
      </ul>
    </div>

    <div v-else>
      <div v-if="!masteredIds.length" class="empty">还没有已掌握的错题</div>
      <template v-else>
        <div class="actions-bar">
          <button v-if="!practicing" @click="startMastered">已掌握重练</button>
          <button v-if="practicing" @click="exitPractice">退出重练</button>
        </div>

        <QuestionCard
          v-if="practicing && current"
          :key="current.id"
          :question="current"
          :index="idx"
          :favorited="favoriteIds.has(current.id)"
          @answered="onAnswered"
          @next="next"
          @toggle-favorite="onToggleFavorite"
        />

        <div v-if="practicing && current" v-show="practiceMode === 'pending'" class="quick-actions">
          <button class="master-btn" @click="markMastered(current.id)">标记已掌握</button>
        </div>

        <p v-if="!practicing" class="hint">已掌握 {{ masteredIds.length }} 题 · 点击题目可重做（答错会自动移回错题本）</p>
        <ul v-if="!practicing" class="mastered-list">
          <li v-for="id in masteredIds" :key="id" @click="jumpToMastered(id)" class="mastered-item">
            <span>{{ getQuestionPreview(id) }}</span>
            <span v-if="totalWrongMap.get(id)" class="wrong-count-tag" :class="{ stubborn: (totalWrongMap.get(id) || 0) >= 3 }">🔁 曾错 {{ totalWrongMap.get(id) }} 次</span>
            <button class="restore-btn" @click.stop="restoreToPending(id)">放回错题</button>
            <button class="quick-del-btn" title="删除记录" @click.stop="removeMastered(id)">🗑</button>
          </li>
        </ul>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { api, Question } from '../utils/api'
import { toastError, toastSuccess, toastInfo } from '../utils/toast'
import QuestionCard from '../components/QuestionCard.vue'
import { classifyQuestionType } from '../lib/exam'

const route = useRoute()
const bankId = Number(route.params.bankId)
const allQuestions = ref<Question[]>([])
const wrongIds = ref<number[]>([])
const masteredIds = ref<number[]>([])
const favoriteIds = ref<Set<number>>(new Set())
const streakMap = ref<Map<number, number>>(new Map())  // 错题 id → 连续答对次数
const totalWrongMap = ref<Map<number, number>>(new Map())  // 错题/已掌握 id → 累计做错次数（顽固错题统计）
const threshold = ref(0)                               // 自动掌握阈值（0=关闭）
const practicing = ref(false)
const queue = ref<number[]>([])
const idx = ref(0)
// 2026-09-15 修复(P1-35)：已掌握重练答错时当前项会被移出队列，但后面的题随之前移补位——
// 此时「下一题」不能照旧 idx++（队列 [A,B,C]、idx=0 答错 A → 队列 [B,C] → idx++ → 1 → C，
// B 被静默跳过）。用标志在 next() 里跳过这一次自增。
let currentRemovedFromQueue = false
const current = ref<Question | null>(null)
const tab = ref<'pending' | 'mastered'>('pending')
const practiceMode = ref<'pending' | 'mastered'>('pending')  // 当前练习队列来源：待重练 / 已掌握重练
const selectedType = ref<string>('all')  // 选中的题型筛选

// 计算题型分类
// 2026-08-22 修复：此前用 q.type 判断——云端判断题存 type:'single' + ["正确","错误"]（历史格式），
// 「判断题」筛选永远 0 题。改用 classifyQuestionType 内容识别（与练习页/PracticeView 一致）
const questionTypes = computed(() => {
  const types: { value: string; label: string; count: number }[] = [
    { value: 'all', label: '全部', count: wrongIds.value.length }
  ]

  const typeMap = new Map<string, number>()
  for (const id of wrongIds.value) {
    const q = allQuestions.value.find(q => q.id === id)
    if (q) {
      const type = classifyQuestionType(q)
      typeMap.set(type, (typeMap.get(type) || 0) + 1)
    }
  }

  const typeLabels: Record<string, string> = {
    'single': '单选题',
    'multi': '多选题',
    'judge': '判断题',
    'blank': '填空题',
    'qa': '问答题'
  }

  for (const [type, count] of typeMap) {
    types.push({
      value: type,
      label: typeLabels[type] || type,
      count
    })
  }

  return types
})

// 筛选后的错题ID
const filteredWrongIds = computed(() => {
  if (selectedType.value === 'all') {
    return wrongIds.value
  }
  return wrongIds.value.filter(id => {
    const q = allQuestions.value.find(q => q.id === id)
    return q && classifyQuestionType(q) === selectedType.value
  })
})

// 掌握率
const masteryRate = computed(() => {
  const total = wrongIds.value.length + masteredIds.value.length
  return total > 0 ? Math.round((masteredIds.value.length / total) * 100) : 0
})

onMounted(async () => {
  await loadData()
})

async function loadData() {
  try {
    allQuestions.value = await api.listQuestions(bankId)
    const [wrongRecs, masteredRecs, favs] = await Promise.all([
      api.listWrongRecords(bankId),
      api.listMasteredRecords(bankId),
      api.listFavorites(bankId),
    ])
    wrongIds.value = wrongRecs.map((r: any) => r.question_id)
    streakMap.value = new Map(wrongRecs.map((r: any) => [r.question_id, r.correct_streak ?? 0]))
    // 累计做错次数（错题/已掌握都记录，供顽固错题徽章）
    totalWrongMap.value = new Map(wrongRecs.map((r: any) => [r.question_id, r.total_wrong ?? 0]))
    for (const m of masteredRecs) {
      if (!totalWrongMap.value.has(m.question_id)) totalWrongMap.value.set(m.question_id, m.total_wrong ?? 0)
    }
    masteredIds.value = masteredRecs.map((r: any) => r.question_id)
    favoriteIds.value = new Set(favs)
    threshold.value = await api.getWrongMasterThreshold()
  } catch (e) {
    toastError('加载错题失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

function start() {
  queue.value = [...filteredWrongIds.value]
  idx.value = 0
  practiceMode.value = 'pending'
  practicing.value = true
  loadCurrent()
}

// 2026-08-19：已掌握重练——把已掌握的题作为队列重新练习（答错自动移回错题本）
function startMastered() {
  queue.value = [...masteredIds.value]
  idx.value = 0
  practiceMode.value = 'mastered'
  practicing.value = true
  loadCurrent()
}

// 点击列表中的某道题，直接跳到该题练习
function jumpToQuestion(questionId: number) {
  // 2026-09-15 修复(P2-20)：与 start() 同口径用筛选后的队列——原用未筛选的 wrongIds，
  // 点列表项会从未筛选队列开始，与统计数字、重练按钮互相矛盾
  queue.value = [...filteredWrongIds.value]
  const pos = queue.value.indexOf(questionId)
  if (pos >= 0) {
    idx.value = pos
    practiceMode.value = 'pending'
    practicing.value = true
    loadCurrent()
  }
}

// 点击已掌握列表中的某道题，直接重做该题
function jumpToMastered(questionId: number) {
  queue.value = [...masteredIds.value]
  const pos = queue.value.indexOf(questionId)
  if (pos >= 0) {
    idx.value = pos
    practiceMode.value = 'mastered'
    practicing.value = true
    loadCurrent()
  }
}

function exitPractice() {
  practicing.value = false
  current.value = null
  practiceMode.value = 'pending'
}

function loadCurrent() {
  // 凡经本函数装载（start/startMastered/jump* 命中/next）都会消费掉「当前项已移除」标志。
  // ⚠️ 复审 MF-6：上一版写成「任何重新装载」，不准确——不走 loadCurrent 的两条路径
  //    （`jumpTo*` 在队列里找不到该题时提前 return、`exitPractice` 直接退出练习）**不会**清它。
  //    无害的理由：这两条路径要么整个会话已结束、要么下一次装载仍会经过本函数清掉；
  //    复审的 13 条序列夹具（末项/空队列/jump/重开/竞态 + 2000 组随机序列）未复现出问题。
  currentRemovedFromQueue = false
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
  toastInfo('题目数据异常或已删除，已退出练习模式')
}

async function next() {
  if (currentRemovedFromQueue) {
    // 当前项刚被移出队列，后面的题已前移补位，idx 不再 ++（P1-35）
    if (idx.value < queue.value.length) { loadCurrent(); return }
    // 移除的恰是末题：队列已走完，按完成收尾
    currentRemovedFromQueue = false
    practicing.value = false
    await loadData()
    return
  }
  if (idx.value < queue.value.length - 1) { idx.value++; loadCurrent() }
  else {
    practicing.value = false
    await loadData()
  }
}

async function onAnswered(payload: { correct: boolean; answer: string; duration_ms: number | null }) {
  if (current.value) {
    const qid = current.value.id
    try {
      const res = await api.recordPractice({ bank_id: bankId, question_id: qid, user_answer: payload.answer, is_correct: payload.correct, duration_ms: payload.duration_ms })
      // 连续答对达到阈值 → 自动移入「已掌握」
      if (res?.autoMastered) {
        toastSuccess(`🎉 连续答对 ${res.streak} 次，已自动移入「已掌握」`)
        await loadData()
      } else if (res?.streak) {
        // 更新本地连对计数展示（不重载列表，避免打断练习视图）
        streakMap.value = new Map(streakMap.value).set(qid, res.streak)
      }
      // 2026-08-19：已掌握重练答错 → 自动移回错题本（markWrong 内部已处理），从当前队列移除并刷新
      // 当前题保持展示解析不打断；2026-09-15 修复(P1-35)：原注释称「用户点下一题时队列已不含该题，
      // 自然跳过」——实际 idx++ 跳过的是前移补位的邻居题，改用「当前项已移除」标志让 next() 正确落在下一题
      if (!payload.correct && practiceMode.value === 'mastered') {
        toastSuccess('答错了，该题已移回错题本「待重练」')
        queue.value = queue.value.filter(id => id !== qid)
        currentRemovedFromQueue = true
        await loadData()
      }
    } catch (e) {
      console.error('记录练习失败：', e)
    }
  }
}

async function onToggleFavorite() {
  if (!current.value) return
  try {
    const nowFav = await api.toggleFavorite(bankId, current.value.id)
    const next = new Set(favoriteIds.value)
    if (nowFav) next.add(current.value.id)
    else next.delete(current.value.id)
    favoriteIds.value = next
  } catch (e) {
    console.error('切换收藏失败：', e)
  }
}

async function markMastered(questionId: number) {
  try {
    await api.markWrongMastered(bankId, questionId)
    await loadData()
    // 自动跳下一题
    if (practicing.value) {
      await next()
    }
  } catch (e) {
    toastError('标记失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

async function restoreToPending(questionId: number) {
  // BUG-011 修复：改用独立的 restore_wrong_to_pending 命令
  // 旧实现通过 recordPractice(is_correct=false) 实现，会写入 practice_records 表污染统计
  try {
    await api.restoreWrongToPending(bankId, questionId)
    await loadData()
  } catch (e) {
    toastError('放回失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

// 2026-08-16：从错题本直接删除记录（彻底移除，不标记掌握）
async function removeWrong(questionId: number) {
  if (!confirm('确定删除这条错题记录吗？（仅删除记录，不影响题目本身）')) return
  try {
    await api.removeWrongRecord(bankId, questionId)
    await loadData()
  } catch (e) {
    toastError('删除失败：' + (e instanceof Error ? e.message : String(e)))
  }
}
// 2026-08-16：从已掌握表直接删除记录
async function removeMastered(questionId: number) {
  if (!confirm('确定删除这条已掌握记录吗？（仅删除记录，不影响题目本身）')) return
  try {
    await api.removeMasteredRecord(bankId, questionId)
    await loadData()
  } catch (e) {
    toastError('删除失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

function getQuestionPreview(id: number): string {
  const q = allQuestions.value.find(q => q.id === id)
  if (!q) return `#${id}`
  return q.stem.length > 50 ? q.stem.slice(0, 50) + '...' : q.stem
}
</script>

<style scoped>
.wrong { max-width: 800px; }
.tabs { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid var(--color-border); }
.tabs button { background: none; border: none; padding: 8px 16px; cursor: pointer; color: var(--color-text-secondary); border-bottom: 2px solid transparent; }
.tabs button.active { color: var(--color-primary); border-bottom-color: var(--color-primary); }

/* 错题分类筛选 */
.wrong-filter { margin-bottom: 20px; }
.filter-label { font-size: 14px; color: var(--color-text-secondary); margin-bottom: 8px; }
.filter-tags { display: flex; flex-wrap: wrap; gap: 8px; }
.filter-tags button { padding: 6px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); color: var(--color-text-secondary); font-size: 13px; cursor: pointer; transition: all 0.15s; }
.filter-tags button:hover { border-color: var(--color-primary); color: var(--color-primary); }
.filter-tags button.active { background: var(--color-primary); border-color: var(--color-primary); color: #fff; }

/* 错题统计 */
.wrong-stats { display: flex; gap: 24px; margin-bottom: 20px; padding: 16px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-lg); }
.stat-item { display: flex; flex-direction: column; align-items: center; }
.stat-value { font-size: 24px; font-weight: 600; color: var(--color-primary); }
.stat-label { font-size: 12px; color: var(--color-text-secondary); margin-top: 4px; }

.actions-bar { margin-bottom: 16px; }
.empty { text-align: center; padding: 48px; color: var(--color-text-tertiary); }
.hint { color: var(--color-text-tertiary); font-size: 13px; padding: 16px 0; }
button { padding: 8px 16px; border: 1px solid var(--color-border); border-radius: var(--radius-md); cursor: pointer; background: var(--color-card); color: var(--color-text); }
button:hover { background: var(--color-border-light); }
.quick-actions { margin-top: 12px; }
.master-btn { background: var(--color-success-light); border-color: var(--color-success); color: var(--color-success); padding: 6px 14px; border-radius: var(--radius-md); cursor: pointer; }
.master-btn:hover { background: var(--color-success); color: #fff; }
.mastered-list { list-style: none; padding: 0; }
.mastered-item { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 12px; border: 1px solid var(--color-border-light); border-radius: var(--radius-md); margin-bottom: 8px; background: var(--color-card); cursor: pointer; transition: border-color 0.15s, background 0.15s; }
.mastered-item:hover { border-color: var(--color-primary); background: var(--color-primary-light); }
.mastered-item > span { flex: 1; font-size: 14px; color: var(--color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.restore-btn { background: var(--color-warning-light); border-color: var(--color-warning); color: var(--color-warning); padding: 4px 10px; font-size: 12px; }
.restore-btn:hover { background: var(--color-warning); color: #fff; }
/* 错题列表 */
.wrong-list { list-style: none; padding: 0; margin: 0; }
.wrong-item { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border: 1px solid var(--color-border-light); border-radius: var(--radius-md); margin-bottom: 8px; background: var(--color-card); cursor: pointer; transition: border-color 0.15s, background 0.15s; }
.wrong-item:hover { border-color: var(--color-primary); background: var(--color-primary-light); }
.wrong-item.active { border-color: var(--color-primary); background: var(--color-primary-light); }
.item-index { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 50%; background: var(--color-danger-light); color: var(--color-danger); font-size: 13px; font-weight: 600; flex-shrink: 0; }
.item-preview { flex: 1; font-size: 14px; color: var(--color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 2026-08-19：连续答对计数徽标 */
.streak-tag { padding: 2px 8px; border-radius: 10px; background: var(--color-success-light); color: var(--color-success-deep); font-size: 11px; font-weight: 600; white-space: nowrap; flex-shrink: 0; }
.wrong-count-tag { padding: 2px 8px; border-radius: 10px; background: var(--color-warning-bg, #fff8e1); color: var(--color-warning-text, #8a6d1a); font-size: 11px; font-weight: 600; white-space: nowrap; flex-shrink: 0; }
.wrong-count-tag.stubborn { background: var(--color-danger-light); color: var(--color-danger); border: 1px solid var(--color-danger); }
.streak-tag.near { background: var(--color-warning-bg); color: var(--color-warning-text); }
.quick-master-btn { padding: 4px 10px; border: 1px solid var(--color-success); border-radius: var(--radius-sm); background: var(--color-success-light); color: var(--color-success); cursor: pointer; font-size: 12px; white-space: nowrap; flex-shrink: 0; opacity: 0; transition: opacity 0.15s; }
.wrong-item:hover .quick-master-btn, .wrong-item.active .quick-master-btn { opacity: 1; }
.quick-master-btn:hover { background: var(--color-success); color: #fff; }
/* 2026-08-16：删除记录按钮（错题/已掌握列表） */
.quick-del-btn { padding: 4px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-card); color: var(--color-text-tertiary); cursor: pointer; font-size: 12px; white-space: nowrap; flex-shrink: 0; opacity: 0; transition: opacity 0.15s; }
.wrong-item:hover .quick-del-btn, .wrong-item.active .quick-del-btn { opacity: 1; }
.quick-del-btn:hover { background: var(--color-danger-light); border-color: var(--color-danger); color: var(--color-danger); }
.mastered-list .quick-del-btn { opacity: 1; }

/* 移动端适配 */
@media (max-width: 768px) {
  .tabs { overflow-x: auto; }
  .wrong-item { padding: 10px 12px; gap: 8px; }
  .quick-master-btn { opacity: 1; }
  .quick-del-btn { opacity: 1; }
}
</style>
