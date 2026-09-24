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

// bankId 必须由路由给出（题库 ID 属于部署方配置，代码里不留默认库）
const bankId = String(route.params.bankId || '')
const bankName = String(route.query.name || '计算题')
const loading = ref(true)
const loadError = ref('')
const all = ref<ExamQuestion[]>([])
const subject = ref<string>('全部')
// 默认折叠：背题时先自己回忆，再展开对答案
const revealAll = ref(false)

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

// 题库标准答案是考试判分依据，即使与解析算出的结果对不上也照样保留 —— 这种情况在这里显著标出来
function conflictText(q: any): string {
  const v = String(q?.answer_conflict || '')
  if (v === 'value') return '⚠ 答案与解析不一致'
  if (v === 'unit') return '⚠ 单位口径不一致'
  if (v === 'rounding') return '取整口径不同'
  if (v === 'doubt') return '⚠ 口径与现行规程有别'
  return ''
}

function diffText(q: any): string {
  const v = String(q?.difficulty || '')
  if (v === 'easy') return '易'
  if (v === 'mid') return '中'
  if (v === 'hard') return '难'
  return ''
}

async function load() {
  loading.value = true
  loadError.value = ''
  if (!bankId) {
    all.value = []
    loadError.value = '没有指定题库'
    loading.value = false
    return
  }
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
            <span
              v-if="diffText(q)"
              class="diff"
              :class="'d-' + ((q as any).difficulty || '')"
              :title="(q as any).difficulty_why || ''"
            >{{ diffText(q) }}</span>
            <span
              v-if="(q as any).answer_conflict"
              class="warn"
              :class="{ soft: (q as any).answer_conflict === 'rounding' }"
            >{{ conflictText(q) }}</span>
          </div>
          <div class="stem">
            <StemText :stem="q.stem" :images="(q as any).images || null" />
          </div>

          <!-- 默认折叠：答案与解析各一条，可分别展开；顶部「直接显示」可一键全开 -->
          <details v-if="!revealAll" class="fold">
            <summary>标准答案</summary>
            <p class="ans">{{ q.answer || '（本题库未给出标准答案）' }}</p>
            <p v-if="(q as any).answer_derived" class="derived">
              <span class="derived-tag">推算</span>{{ (q as any).answer_derived }}
            </p>
            <p v-if="(q as any).answer_conflict_note" class="warn-note">{{ (q as any).answer_conflict_note }}</p>
          </details>
          <details v-if="!revealAll && q.analysis" class="fold">
            <summary>看解析<span class="ai-tag">AI 生成，仅供参考</span></summary>
            <p class="ana">{{ q.analysis }}</p>
          </details>
          <!-- 知识点总结：不针对本题而是这一类题的通用规律，比解析长，单独折叠 -->
          <details v-if="!revealAll && (q as any).knowledge" class="fold">
            <summary>知识点总结（举一反三用）<span class="ai-tag">AI 生成，仅供参考</span></summary>
            <p class="kno">{{ (q as any).knowledge }}</p>
          </details>

          <template v-if="revealAll">
            <p class="ans">{{ q.answer || '（本题库未给出标准答案）' }}</p>
            <p v-if="(q as any).answer_derived" class="derived">
              <span class="derived-tag">推算</span>{{ (q as any).answer_derived }}
            </p>
            <p v-if="(q as any).answer_conflict_note" class="warn-note">{{ (q as any).answer_conflict_note }}</p>
            <p v-if="q.analysis || (q as any).knowledge" class="ai-foot">解析与知识点总结由 AI 批量生成，仅供参考；答案以题库原文为准。</p>
            <p v-if="q.analysis" class="ana">{{ q.analysis }}</p>
            <p v-if="(q as any).knowledge" class="kno">{{ (q as any).knowledge }}</p>
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
/* 标准答案（题库原始值）与「推算」值必须一眼分得开——前者是考试判分依据 */
.derived {
  margin: 6px 0 0; padding: 6px 12px; border-radius: 8px;
  background: #f4f6fb; color: #46506b; font-size: 0.92rem; white-space: pre-wrap;
}
.derived-tag {
  display: inline-block; margin-right: 6px; padding: 0 6px; border-radius: 4px;
  background: #dde3f5; color: #2f5597; font-size: 0.74rem; font-weight: 700;
}
.warn {
  font-size: 0.74rem; padding: 1px 8px; border-radius: 999px;
  background: #fde8e8; color: #b42318; font-weight: 700; border: 1px solid #f5b5b0;
}
.warn.soft { background: #fff6e5; color: #8a5a00; border-color: #f0d49b; font-weight: 600; }
.warn-note {
  margin: 6px 0 0; padding: 6px 10px; border-radius: 6px;
  background: #fff6e5; border-left: 3px solid #e0a800; color: #7a5200; font-size: 0.84rem;
}
.fold { margin-top: 8px; }
.fold summary { cursor: pointer; color: #2f5597; font-size: 0.88rem; }
.diff {
  font-size: 0.74rem; padding: 1px 9px; border-radius: 999px; font-weight: 700;
  border: 1px solid transparent;
}
.d-easy { background: #eaf6ec; color: #1b6b2f; border-color: #bfe3c6; }
.d-mid { background: #fff4e2; color: #8a5a00; border-color: #f0d49b; }
.d-hard { background: #fdecec; color: #b42318; border-color: #f3bdbc; }
.kno {
  margin: 6px 0 0; padding: 10px 12px; border-radius: 8px; font-size: 0.86rem;
  background: #f7f9fc; border-left: 3px solid #2f5597; color: #33384a;
  white-space: pre-wrap; line-height: 1.8;
}
.ai-tag { display: inline-block; margin-left: 6px; padding: 1px 6px; font-size: 0.75em;
  font-weight: 600; color: var(--color-text-muted, #6b7280); background: var(--color-bg-soft, #f3f4f6);
  border: 1px solid var(--border-color, #d0d5dd); border-radius: 10px; }
.ai-foot { margin: 8px 0 4px; font-size: 0.786em; color: var(--color-text-muted, #6b7280); }
</style>
