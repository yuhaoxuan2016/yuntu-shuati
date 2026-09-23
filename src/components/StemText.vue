<script setup lang="ts">
// 题面渲染：把题干里的图片标记切成「文字段 + 图片段」。
// 认识的三种写法（题库里历史数据三种都出现过）：
//   1) [IMG:n]      —— 规范化占位符，配合题目文档的 images 数组（下标对应）
//   2) {xxx.png}    —— 2026 新包计算题用的花括号写法
//   3) <img src=""> —— 旧包 /resource/major/... 路径写法
// 图取不到时**不阻塞作答**：显示「图片待补：文件名」占位（线上已有这类残缺题，只能等图源）。
import { computed } from 'vue'

const props = defineProps<{
  stem: string
  images?: string[] | null
}>()

type Part =
  | { kind: 'text'; text: string }
  | { kind: 'img'; src: string | null; label: string }

const TOKEN = /\[IMG:(\d+)\]|\{[^{}\n]{1,80}\.(?:png|jpg|jpeg|gif|bmp)\}|<img[^>]{0,300}>/gi

const parts = computed<Part[]>(() => {
  const s = props.stem || ''
  const list: Part[] = []
  let last = 0
  let m: RegExpExecArray | null
  TOKEN.lastIndex = 0
  while ((m = TOKEN.exec(s)) !== null) {
    if (m.index > last) list.push({ kind: 'text', text: s.slice(last, m.index) })
    const tok = m[0]
    if (tok.startsWith('[IMG:')) {
      const n = Number(m[1])
      const src = (props.images && props.images[n]) || null
      list.push({ kind: 'img', src, label: `图${n + 1}` })
    } else if (tok.startsWith('{')) {
      const name = tok.slice(1, -1)
      list.push({ kind: 'img', src: null, label: name })
    } else {
      const sm = /src\s*=\s*['"]{1,2}([^'"]+)/i.exec(tok)
      const raw = sm ? sm[1] : ''
      list.push({ kind: 'img', src: null, label: raw ? raw.split('/').pop() || raw : '图片' })
    }
    last = m.index + tok.length
  }
  if (last < s.length) list.push({ kind: 'text', text: s.slice(last) })
  return list.length ? list : [{ kind: 'text', text: s }]
})
</script>

<template>
  <span class="stem-rich">
    <template v-for="(p, i) in parts" :key="i">
      <span v-if="p.kind === 'text'">{{ p.text }}</span>
      <span v-else-if="p.src" class="stem-img">
        <img :src="p.src" :alt="p.label" loading="lazy" />
      </span>
      <span v-else class="stem-img-missing" :title="'图片待补：' + p.label">［图片待补：{{ p.label }}］</span>
    </template>
  </span>
</template>

<style scoped>
.stem-rich { white-space: pre-wrap; }
.stem-img { display: block; margin: 6px 0; }
.stem-img img { max-width: 100%; height: auto; border-radius: 6px; }
.stem-img-missing {
  display: inline-block;
  margin: 4px 0;
  padding: 2px 8px;
  border: 1px dashed var(--border-color, #d0d5dd);
  border-radius: 6px;
  color: var(--text-secondary, #8a94a6);
  font-size: 0.88em;
}
</style>
