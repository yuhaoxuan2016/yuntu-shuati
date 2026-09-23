<script setup lang="ts">
// 背题模式：给「计算题」这类没有选项、不适合自动判分的题用。
// 只展示「题干（含图）+ 答案 + 解析」，不进考试/组卷抽取。
// 数据来自公共题库（listPublicBankQuestions 已带缓存与字段裁剪）。
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { listPublicBankQuestions, type ExamQuestion } from '../lib/exam'
import StemText from '../components/StemText.vue'

const route = useRoute()
const router = useRouter()

const bankId = String(route.params.bankId || 'lquiz_banks_19')
const bankName = String(route.query.name || '计算题')
const loading = ref(true)
const loadError = ref('')
const all = ref<ExamQuestion[]>([])
const subject = ref<string>('全部')
const revealAll = ref(true)

const subjects = computed(() => {
  const set = new Set<string>()
  for (const q of all.value) {
    const tag = (q as any).subject || ''
    if (tag) set.add(tag)
  }
  return ['全部', ...Array.from(set)]
})

const list = computed(() => {
  if (subject.value === '全部') return all.value
  return all.value.filter(q => ((q as any).subject || '') === subject.value)
})

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const qs = await listPublicBankQuestions(bankId)
    all.value = qs
    if (!qs.length) loadError.value = '这个库里还没有题目（或云端不可用）'
  } catch (e: any) {
    loadError.value = e?.message || '加载失败，请检查网络后重试'
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>

<template>
  <div class="recite">
    <header class="head">
      <button class="back" @click="router.back()">← 返回</button>
      <div class="title">
        <h2>{{ bankName }}</h2>
        <p class="sub">背题模式 · 只给答案与解析，不判分、不进考试抽取</p>
      </div>
      <button class="refresh" @click="load">刷新</button>
    </header>

    <div v-if="subjects.length > 1" class="filters">
      <button
        v-for="s in subjects"
        :key="s"
        class="chip"
        :class="{ active: subject === s }"
        @click="subject = s"
      >{{ s }}</button>
      <label class="toggle">
        <input v-model="revealAll" type="checkbox" />
        <span>直接显示答案</span>
      </label>
    </div>

    <p v-if="loading" class="hint">加载中…</p>
    <p v-else-if="loadError" class="hint err">{{ loadError }}</p>
    <p v-else class="hint">共 {{ list.length }} 题</p>

    <ol class="cards">
      <li v-for="(q, i) in list" :key="q.id ?? i">
        <article class="card">
          <div class="meta">
            <span class="idx">第 {{ i + 1 }} 题</span>
            <span v-if="(q as any).subject" class="tag">{{ (q as any).subject }}</span>
          </div>
          <div class="stem">
            <StemText :stem="q.stem" :images="(q as any).images || null" />
          </div>
          <details v-if="!revealAll" class="ans-fold">
            <summary>看答案</summary>
            <p class="ans">{{ q.answer || '（源数据未给出答案）' }}</p>
            <p v-if="q.analysis" class="ana">{{ q.analysis }}</p>
          </details>
          <template v-else>
            <p class="ans">{{ q.answer || '（源数据未给出答案）' }}</p>
            <p v-if="q.analysis" class="ana">{{ q.analysis }}</p>
          </template>
        </article>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.recite { max-width: 860px; margin: 0 auto; padding: 16px 14px 60px; }
.head { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 10px; }
.back, .refresh {
  border: 1px solid var(--border-color, #d0d5dd); background: var(--bg-card, #fff);
  border-radius: 8px; padding: 6px 10px; cursor: pointer; color: inherit;
}
.title { flex: 1; }
.title h2 { margin: 0; font-size: 1.2rem; }
.sub { margin: 4px 0 0; font-size: 0.82rem; color: var(--text-secondary, #8a94a6); }
.filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 10px 0; }
.chip {
  border: 1px solid var(--border-color, #d0d5dd); background: transparent;
  border-radius: 999px; padding: 4px 12px; cursor: pointer; color: inherit; font-size: 0.86rem;
}
.chip.active { background: #2f5597; border-color: #2f5597; color: #fff; }
.toggle { margin-left: auto; font-size: 0.84rem; color: var(--text-secondary, #8a94a6); display: flex; align-items: center; gap: 4px; }
.hint { color: var(--text-secondary, #8a94a6); font-size: 0.86rem; }
.hint.err { color: #c00; }
.cards { list-style: none; padding: 0; margin: 12px 0 0; display: flex; flex-direction: column; gap: 12px; }
.card {
  border: 1px solid var(--border-color, #e4e7ec); border-radius: 12px;
  padding: 14px; background: var(--bg-card, #fff);
}
.meta { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.idx { font-size: 0.78rem; color: var(--text-secondary, #8a94a6); }
.tag {
  font-size: 0.74rem; padding: 1px 8px; border-radius: 999px;
  background: #eef2ff; color: #2f5597;
}
.stem { line-height: 1.75; font-size: 1rem; }
.ans {
  margin: 10px 0 0; padding: 8px 12px; border-radius: 8px;
  background: #f0f7f0; color: #1b6b2f; font-weight: 600; font-size: 1.02rem;
  white-space: pre-wrap;
}
.ana { margin: 6px 0 0; font-size: 0.84rem; color: #8a6d1f; white-space: pre-wrap; }
.ans-fold summary { cursor: pointer; color: #2f5597; font-size: 0.88rem; margin-top: 8px; }
</style>
