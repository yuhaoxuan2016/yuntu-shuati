<template>
  <Teleport to="body">
    <div v-if="open" class="tour-overlay">
      <div class="tour-box">
        <div class="tour-title">{{ step.title }}</div>
        <div class="tour-body">{{ step.body }}</div>
        <div class="tour-foot">
          <span class="tour-dots">
            <span v-for="i in steps.length" :key="i" class="tour-dot" :class="{ on: i - 1 === idx }" />
          </span>
          <span class="tour-btns">
            <button v-if="idx > 0" class="tour-btn ghost" @click="idx--">上一步</button>
            <button class="tour-btn" @click="next">{{ idx === steps.length - 1 ? '开始使用' : '下一步' }}</button>
            <button class="tour-btn ghost" @click="finish">跳过</button>
          </span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// 新手指引（2026-09-28）：形态对齐 rabbit-web 的「新手导航」——浮层分步 + 圆点 + 看过即记（不再弹）。
// 由 HomeView 判定「新用户（无标记 + 没题库 + 没配云同步）」后挂载；本组件只管展示与收尾。
import { ref, computed } from 'vue'

const TOUR_KEY = 'shuati-tour-done-v1'
const steps = [
  { title: '👋 欢迎使用小兔错题本', body: '刷题 + 错题本 + AI 解析，数据默认只存在本机浏览器。三步带你上手～' },
  { title: '📚 第一步 · 先有题库', body: '「题库」页里的公共题库可直接订阅（引用式，不占空间）；自己的题用「新建题库」或「导入」。订阅后错题、收藏、统计全记录。' },
  { title: '☁️ 第二步 · 开云同步', body: '设置页填一个「同步昵称」→ 点「上传」，数据就备份到云端。手机与电脑接同一账号：在小程序「我的 → 与网页版打通」生成绑定码，填进网页端设置页。' },
  { title: '⭐ 准备就绪', body: '刷题去吧！本引导只出现这一次，跳过或看完都会记下。' },
]
const open = ref(true)
const idx = ref(0)
const step = computed(() => steps[idx.value])
function next () { if (idx.value >= steps.length - 1) finish(); else idx.value += 1 }
function finish () {
  try { localStorage.setItem(TOUR_KEY, '1') } catch { /* 隐私模式：本次内不再弹即可 */ }
  open.value = false
}
</script>

<style scoped>
.tour-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 300; animation: tourFade 0.15s; padding: 16px; }
.tour-box { background: var(--color-card); border-radius: var(--radius-lg); padding: 24px; max-width: 420px; width: 100%; color: var(--color-text); box-shadow: 0 16px 48px rgba(0,0,0,0.25); }
.tour-title { font-size: 17px; font-weight: 700; margin-bottom: 10px; }
.tour-body { font-size: 14px; line-height: 1.7; color: var(--color-text-secondary); min-height: 66px; }
.tour-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 18px; }
.tour-dots { display: flex; gap: 6px; }
.tour-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--color-border); }
.tour-dot.on { background: var(--color-primary); }
.tour-btns { display: flex; gap: 8px; }
.tour-btn { padding: 7px 14px; border: 1px solid var(--color-primary); background: var(--color-primary); color: #fff; border-radius: 8px; font-size: 13px; cursor: pointer; }
.tour-btn.ghost { background: var(--color-card); color: var(--color-text-secondary); border-color: var(--color-border); }
@keyframes tourFade { from { opacity: 0 } to { opacity: 1 } }
</style>
