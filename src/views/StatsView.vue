<template>
  <div class="stats">
    <h2>学习统计</h2>

    <div v-if="!loaded" class="loading">加载中...</div>

    <div v-else>
      <!-- 基础统计卡片 -->
      <div class="cards">
        <div class="stat-card">
          <span class="num">{{ stats.total }}</span>
          <label>总题数</label>
        </div>
        <div class="stat-card">
          <span class="num">{{ stats.practiced }}</span>
          <label>已练习</label>
        </div>
        <div class="stat-card highlight">
          <span class="num">{{ accuracy }}%</span>
          <label>正确率</label>
        </div>
        <div class="stat-card">
          <span class="num">{{ correct }}</span>
          <label>答对</label>
        </div>
        <div class="stat-card">
          <span class="num">{{ wrong }}</span>
          <label>答错</label>
        </div>
        <div class="stat-card">
          <span class="num">{{ remaining }}</span>
          <label>未练习</label>
        </div>
      </div>

      <!-- 进度条 -->
      <div class="progress-section">
        <h3>练习进度</h3>
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: progressPct + '%' }"></div>
        </div>
        <p class="progress-text">已完成 {{ stats.practiced }} / {{ stats.total }} 题（{{ progressPct }}%）</p>
      </div>

      <!-- 学习热力图（365天） -->
      <div class="heatmap-section">
        <h3>学习热力图（最近 365 天）</h3>
        <div class="heatmap-wrap">
          <div class="heatmap-months">
            <span v-for="m in heatmap.months" :key="m.label" :style="{ gridColumn: m.col + ' / span ' + m.span }">{{ m.label }}</span>
          </div>
          <div class="heatmap-grid">
            <div class="weekday-labels">
              <span></span><span>一</span><span></span><span>三</span><span></span><span>五</span><span></span>
            </div>
            <div v-for="(week, wi) in heatmap.weeks" :key="wi" class="heatmap-week">
              <div
                v-for="(cell, ci) in week"
                :key="ci"
                class="heatmap-cell"
                :class="['level-' + cell.level, { 'today': cell.isToday }]"
                :title="cell.date ? `${cell.date}：${cell.total} 题（对 ${cell.correct}）` : ''"
              ></div>
            </div>
          </div>
          <div class="heatmap-legend">
            <span>少</span>
            <span class="legend-cell level-0"></span>
            <span class="legend-cell level-1"></span>
            <span class="legend-cell level-2"></span>
            <span class="legend-cell level-3"></span>
            <span class="legend-cell level-4"></span>
            <span>多</span>
          </div>
        </div>
        <div class="heatmap-summary">
          共刷题 <b>{{ heatmap.totalCount }}</b> 次 · 连续 <b>{{ heatmap.streakDays }}</b> 天 · 最长 <b>{{ heatmap.maxStreak }}</b> 天
        </div>
      </div>

      <!-- 错题统计图表 -->
      <div class="wrong-chart-section">
        <h3>错题分析</h3>
        <div class="wrong-chart-container">
          <div class="wrong-chart">
            <canvas ref="wrongChartRef" width="400" height="200"></canvas>
          </div>
          <div class="wrong-summary">
            <div class="wrong-stat">
              <span class="wrong-label">总错题</span>
              <span class="wrong-value">{{ wrongStats.total }}</span>
            </div>
            <div class="wrong-stat">
              <span class="wrong-label">已掌握</span>
              <span class="wrong-value success">{{ wrongStats.mastered }}</span>
            </div>
            <div class="wrong-stat">
              <span class="wrong-label">待强化</span>
              <span class="wrong-value warning">{{ wrongStats.pending }}</span>
            </div>
            <div class="wrong-stat">
              <span class="wrong-label">掌握率</span>
              <span class="wrong-value">{{ wrongStats.masteryRate }}%</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 学习趋势图表 -->
      <div class="trend-section">
        <h3>学习趋势（最近30天）</h3>
        <div class="trend-chart-container">
          <canvas ref="trendChartRef" width="600" height="250"></canvas>
        </div>
        <div class="trend-summary">
          <div class="trend-stat">
            <span class="trend-label">日均刷题</span>
            <span class="trend-value">{{ dailyAverage }}</span>
          </div>
          <div class="trend-stat">
            <span class="trend-label">最高单日</span>
            <span class="trend-value">{{ maxDaily }}</span>
          </div>
          <div class="trend-stat">
            <span class="trend-label">学习天数</span>
            <span class="trend-value">{{ studyDays }}</span>
          </div>
        </div>
      </div>

      <!-- 学习建议 -->
      <div class="tips">
        <h3>学习建议</h3>
        <div v-if="stats.total === 0" class="tip-item">暂无题目，请先导入题库</div>
        <div v-else-if="progressPct < 30" class="tip-item">刚开始练习，加油！建议每天坚持 30 分钟以上</div>
        <div v-else-if="progressPct < 70" class="tip-item">进度过半，继续保持节奏</div>
        <div v-else-if="progressPct < 100" class="tip-item">即将完成全部题目，可重点攻克剩余错题</div>
        <div v-else class="tip-item">已完成全部题目！建议进入错题本复习</div>

        <div v-if="wrong > 0" class="tip-item warn">
          有 {{ wrong }} 题答错过，建议进入
          <RouterLink :to="`/wrong/${bankId}`" class="link">错题本</RouterLink>
          复习
        </div>
        <div v-if="accuracy < 60 && stats.practiced > 10" class="tip-item warn">
          正确率偏低（{{ accuracy }}%），建议放慢节奏，仔细看解析
        </div>
        <div v-if="accuracy >= 90 && stats.practiced > 10" class="tip-item success">
          正确率优秀！可以尝试模拟考试模式挑战自己
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { api, toLocalDateStr, addDays } from '../utils/api'
import { toastError } from '../utils/toast'

const route = useRoute()
const bankId = Number(route.params.bankId)
const stats = ref({ total: 0, practiced: 0, correct: 0 })
const loaded = ref(false)
const wrongChartRef = ref<HTMLCanvasElement | null>(null)
const wrongStats = ref({ total: 0, mastered: 0, pending: 0, masteryRate: 0 })
const trendChartRef = ref<HTMLCanvasElement | null>(null)
const dailyAverage = ref(0)
const maxDaily = ref(0)
const studyDays = ref(0)

// 2026-08-21 修复：correct 按「答对次数」统计（同题多次答对都计），可大于 practiced（题目数）——
// 正确率必须钳制到 100，否则显示 120% 这类异常值；答错数同理钳制到 0，避免负数
const accuracy = computed(() => stats.value.practiced ? Math.min(100, Math.round(stats.value.correct / stats.value.practiced * 100)) : 0)
const correct = computed(() => stats.value.correct)
const wrong = computed(() => Math.max(0, stats.value.practiced - stats.value.correct))
const remaining = computed(() => Math.max(0, stats.value.total - stats.value.practiced))
const progressPct = computed(() => stats.value.total ? Math.round(stats.value.practiced / stats.value.total * 100) : 0)

// 加载错题统计
async function loadWrongStats() {
  try {
    const [wrongRecords, mastered] = await Promise.all([
      api.listWrongRecords(bankId),
      api.listMastered(bankId)
    ])
    
    const total = wrongRecords.length + mastered.length
    const masteredCount = mastered.length
    const pending = wrongRecords.length
    
    wrongStats.value = {
      total,
      mastered: masteredCount,
      pending,
      masteryRate: total > 0 ? Math.round((masteredCount / total) * 100) : 0
    }
    
    // 绘制错题图表（2026-08-22：仅当 loaded 后才画，canvas 已挂载；否则交给 watch(loaded) 补画）
    if (loaded.value) drawWrongChart()
  } catch (e) {
    console.error('加载错题统计失败：', e)
  }
}

// 绘制错题图表
function drawWrongChart() {
  const canvas = wrongChartRef.value
  if (!canvas) return
  
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  
  // 清空画布
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  
  // 绘制饼图
  const centerX = canvas.width / 2
  const centerY = canvas.height / 2
  const radius = 80
  
  const total = wrongStats.value.total
  if (total === 0) return
  
  const masteredAngle = (wrongStats.value.mastered / total) * 2 * Math.PI
  const pendingAngle = (wrongStats.value.pending / total) * 2 * Math.PI
  
  // 绘制已掌握部分（绿色）
  ctx.beginPath()
  ctx.moveTo(centerX, centerY)
  ctx.arc(centerX, centerY, radius, 0, masteredAngle)
  ctx.fillStyle = '#10B981'
  ctx.fill()
  
  // 绘制待强化部分（橙色）
  ctx.beginPath()
  ctx.moveTo(centerX, centerY)
  ctx.arc(centerX, centerY, radius, masteredAngle, masteredAngle + pendingAngle)
  ctx.fillStyle = '#F59E0B'
  ctx.fill()
  
  // 绘制中心圆（环形图效果）——读取 CSS 变量适配暗色主题
  const root = document.documentElement
  const cs = getComputedStyle(root)
  const bgColor = cs.getPropertyValue('--color-card').trim() || '#ffffff'
  const textColor = cs.getPropertyValue('--color-text').trim() || '#374151'
  const subColor = cs.getPropertyValue('--color-text-secondary').trim() || '#6B7280'

  ctx.beginPath()
  ctx.arc(centerX, centerY, radius * 0.6, 0, 2 * Math.PI)
  ctx.fillStyle = bgColor
  ctx.fill()

  // 绘制中心文字
  ctx.fillStyle = textColor
  ctx.font = 'bold 24px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(`${wrongStats.value.masteryRate}%`, centerX, centerY - 10)
  ctx.font = '12px sans-serif'
  ctx.fillStyle = subColor
  ctx.fillText('掌握率', centerX, centerY + 15)
}

// 加载学习趋势数据
async function loadTrendData() {
  try {
    const raw = await api.getSetting('daily_records')
    if (!raw) return

    // 2026-08-22 修复：JSON.parse 加兜底（数据损坏时降级为空，不再整块崩溃）
    let records: { date: string; total: number; correct: number }[] = []
    try {
      records = JSON.parse(raw) as { date: string; total: number; correct: number }[]
    } catch (e) {
      console.error('daily_records 解析失败，趋势图降级为空：', e)
      return
    }
    const last30Days = records.slice(-30)

    if (last30Days.length === 0) return

    // 计算统计数据
    const totalQuestions = last30Days.reduce((sum, r) => sum + r.total, 0)
    // 2026-08-22 修复：日均 = 总题数 / 有学习的天数（此前除以 30，
    // 只学了几天的用户日均被严重拉低，与「学习天数」并列展示口径不一致）
    const studyDaysCount = last30Days.filter(r => r.total > 0).length
    dailyAverage.value = studyDaysCount > 0 ? Math.round(totalQuestions / studyDaysCount) : 0
    maxDaily.value = Math.max(...last30Days.map(r => r.total))
    studyDays.value = studyDaysCount

    // 绘制趋势图（2026-08-22：仅当 loaded 后才画，canvas 已挂载；否则交给 watch(loaded) 补画）
    if (loaded.value) drawTrendChart(last30Days)
  } catch (e) {
    console.error('加载学习趋势失败：', e)
  }
}

// 绘制趋势图
function drawTrendChart(records: { date: string; total: number; correct: number }[]) {
  const canvas = trendChartRef.value
  if (!canvas) return
  
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  
  // 清空画布
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  
  const padding = { top: 20, right: 20, bottom: 40, left: 50 }
  const chartWidth = canvas.width - padding.left - padding.right
  const chartHeight = canvas.height - padding.top - padding.bottom
  
  if (records.length === 0) return

  // 2026-08-22 修复：只有 1 条记录时 records.length-1=0 导致 x=Infinity/NaN（画不出图）
  const xStep = records.length > 1 ? records.length - 1 : 1

  // 找到最大值
  const maxValue = Math.max(...records.map(r => r.total), 1)
  
  // 绘制网格线
  ctx.strokeStyle = '#E5E7EB'
  ctx.lineWidth = 1
  for (let i = 0; i <= 5; i++) {
    const y = padding.top + (chartHeight / 5) * i
    ctx.beginPath()
    ctx.moveTo(padding.left, y)
    ctx.lineTo(canvas.width - padding.right, y)
    ctx.stroke()
  }
  
  // 绘制Y轴标签
  ctx.fillStyle = '#6B7280'
  ctx.font = '12px sans-serif'
  ctx.textAlign = 'right'
  for (let i = 0; i <= 5; i++) {
    const value = Math.round((maxValue / 5) * (5 - i))
    const y = padding.top + (chartHeight / 5) * i
    ctx.fillText(value.toString(), padding.left - 10, y + 4)
  }
  
  // 绘制X轴标签（每隔几天显示一个）
  ctx.textAlign = 'center'
  const step = Math.max(1, Math.floor(records.length / 7))
  for (let i = 0; i < records.length; i += step) {
    const x = padding.left + (chartWidth / xStep) * i
    const date = records[i].date.slice(5) // 只显示月-日
    ctx.fillText(date, x, canvas.height - 10)
  }
  
  // 绘制折线
  ctx.strokeStyle = '#3B82F6'
  ctx.lineWidth = 2
  ctx.beginPath()
  
  for (let i = 0; i < records.length; i++) {
    const x = padding.left + (chartWidth / xStep) * i
    const y = padding.top + chartHeight - (records[i].total / maxValue) * chartHeight
    
    if (i === 0) {
      ctx.moveTo(x, y)
    } else {
      ctx.lineTo(x, y)
    }
  }
  ctx.stroke()
  
  // 绘制数据点
  ctx.fillStyle = '#3B82F6'
  for (let i = 0; i < records.length; i++) {
    const x = padding.left + (chartWidth / xStep) * i
    const y = padding.top + chartHeight - (records[i].total / maxValue) * chartHeight
    
    ctx.beginPath()
    ctx.arc(x, y, 4, 0, 2 * Math.PI)
    ctx.fill()
  }
  
  // 绘制正确率折线（如果有的话）
  if (records.some(r => r.correct > 0)) {
    ctx.strokeStyle = '#10B981'
    ctx.lineWidth = 2
    ctx.setLineDash([5, 5])
    ctx.beginPath()
    
    for (let i = 0; i < records.length; i++) {
      if (records[i].total === 0) continue
      
      const x = padding.left + (chartWidth / xStep) * i
      const accuracy = records[i].correct / records[i].total
      const y = padding.top + chartHeight - accuracy * chartHeight
      
      if (i === 0 || records[i - 1].total === 0) {
        ctx.moveTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
    }
    ctx.stroke()
    ctx.setLineDash([])
  }
}

onMounted(async () => {
  try {
    stats.value = await api.bankStats(bankId)
  } catch (e) {
    toastError('加载统计失败：' + (e instanceof Error ? e.message : String(e)))
  }
  try {
    await loadHeatmap()
    await loadWrongStats()
    await loadTrendData()
  } catch (e) {
    console.error('加载数据失败：', e)
  } finally {
    loaded.value = true
  }
})

// 2026-08-22 修复：图表空白 bug。此前 loadWrongStats/loadTrendData 在 loaded=true 之前执行，
// 此时 canvas 尚未渲染（v-if="!loaded" 分支），wrongChartRef/trendChartRef 为 null → 图表函数直接 return，
// 数据其实已加载（统计数字正常）但图永远不会画出来。
// 修复：loaded 置 true 后 nextTick 等待 DOM 挂载，再补画两个图表；并 watch loaded 兜底确保重渲染。
watch(loaded, async (val) => {
  if (val) {
    await nextTick()
    // 数据已在 loadWrongStats/loadTrendData 里算好，这里只需真正画出来
    drawWrongChart()
    // 趋势图需要数据，重新读取并绘制
    try {
      const raw = await api.getSetting('daily_records')
      let records: { date: string; total: number; correct: number }[] = []
      try {
        records = raw ? JSON.parse(raw) : []
      } catch { /* ignore */ }
      if (records.length) drawTrendChart(records.slice(-30))
    } catch (e) {
      console.error('补画趋势图失败：', e)
    }
  }
})

// 热力图数据
interface HeatCell { date: string | null; level: number; total: number; correct: number; isToday: boolean }
interface HeatmapData {
  weeks: HeatCell[][]
  months: { label: string; col: number; span: number }[]
  totalCount: number
  streakDays: number
  maxStreak: number
}
const heatmap = ref<HeatmapData>({ weeks: [], months: [], totalCount: 0, streakDays: 0, maxStreak: 0 })

async function loadHeatmap() {
  const raw = await api.getSetting('daily_records')
  let records: { date: string; total: number; correct: number }[] = []
  try {
    records = raw ? JSON.parse(raw) : []
  } catch (e) {
    // 2026-08-21：daily_records 损坏时降级为空热力图，不阻塞页面
    console.error('daily_records 解析失败，已降级为空热力图：', e)
  }
  const map = new Map(records.map(r => [r.date, r]))

  // 计算 365 天范围：从今天往回数 52 周 + 今天的星期
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayDow = (today.getDay() + 6) % 7 // 周一=0
  // 起点：本周日（一周从周日开始，但格子从周一开始排）
  // 我们采用"53 周前开始，每周 7 格（周一到周日）"
  const start = new Date(today)
  start.setDate(today.getDate() - 52 * 7 - todayDow)

  // 找出最大 total 以分 5 档
  let maxTotal = 0
  for (const r of records) if (r.total > maxTotal) maxTotal = r.total

  // 构建 weeks 数组（53 周）
  const weeks: HeatCell[][] = []
  const cursor = new Date(start)
  let col = 0
  let prevMonth = -1
  const months: { label: string; col: number; span: number }[] = []
  while (cursor <= today || col < 53) {
    if (col >= 53) break
    const week: HeatCell[] = []
    for (let dow = 0; dow < 7; dow++) {
      if (cursor > today) {
        week.push({ date: null, level: 0, total: 0, correct: 0, isToday: false })
      } else {
        const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
        const rec = map.get(iso)
        const total = rec?.total ?? 0
        let level = 0
        if (total > 0 && maxTotal > 0) {
          const ratio = total / maxTotal
          if (ratio >= 0.75) level = 4
          else if (ratio >= 0.5) level = 3
          else if (ratio >= 0.25) level = 2
          else level = 1
        }
        const isToday = cursor.getTime() === today.getTime()
        week.push({ date: iso, level, total, correct: rec?.correct ?? 0, isToday })
        if (cursor.getDate() === 1 || (col === 0 && dow === 0)) {
          const label = `${cursor.getMonth() + 1}月`
          if (prevMonth !== cursor.getMonth()) {
            const span = col === 0 ? Math.max(1, col + 1) : 1
            months.push({ label, col: col + 1, span })
            prevMonth = cursor.getMonth()
          }
        }
      }
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
    col++
  }
  // 简化月份标签：每跨月就标一次
  const monthLabels: { label: string; col: number; span: number }[] = []
  let lastSeen = -1
  for (let i = 0; i < weeks.length; i++) {
    const firstDay = weeks[i].find(c => c.date)
    if (firstDay?.date) {
      const m = Number(firstDay.date.split('-')[1])
      if (m !== lastSeen) {
        monthLabels.push({ label: m + '月', col: i + 1, span: 1 })
        lastSeen = m
      } else if (monthLabels.length) {
        monthLabels[monthLabels.length - 1].span++
      }
    }
  }

  // 统计
  let totalCount = 0
  for (const r of records) totalCount += r.total
  // 连续天数（从今天往回数）
  // 2026-09-15 修复(P1-29)：map 的键是 "YYYY-MM-DD" 字符串（见上面 iso 的拼法），而 streakCursor
  // 原是 Date 对象 → map.get(Date) 恒 undefined → 循环立即 break，连续天数恒显示 0。
  // 改为本地日期串；addDays(string, n) 返回的也是 string（utils/api.ts），光标全程保持同口径。
  // 同一指标在 HomeView.vue（连续刷题天数）正是用 toLocalDateStr + addDays 字符串光标实现的。
  let streak = 0
  let streakCursor = toLocalDateStr(today)
  while (true) {
    const r = map.get(streakCursor)
    if (r && r.total > 0) {
      streak++
      streakCursor = addDays(streakCursor, -1)
    } else {
      break
    }
  }
  // 最长连续
  const sortedDates = records.filter(r => r.total > 0).map(r => r.date).sort()
  let maxStreak = 0
  let cur = 0
  let prevDateStr: string | null = null
  for (const ds of sortedDates) {
    if (prevDateStr) {
      const expected = addDays(prevDateStr, 1)
      if (ds === expected) {
        cur++
      } else {
        cur = 1
      }
    } else {
      cur = 1
    }
    if (cur > maxStreak) maxStreak = cur
    prevDateStr = ds
  }

  heatmap.value = { weeks, months: monthLabels, totalCount, streakDays: streak, maxStreak }
}
</script>

<style scoped>
.stats { max-width: 800px; }
.loading { text-align: center; padding: 48px; color: var(--color-text-tertiary); }
.cards { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 24px; }
.stat-card { background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-lg); padding: 20px 24px; text-align: center; min-width: 110px; flex: 1; }
.stat-card.highlight { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
.stat-card .num { display: block; font-size: 28px; font-weight: 600; color: var(--color-primary); }
.stat-card.highlight .num { color: #fff; }
.stat-card label { display: block; font-size: 12px; color: var(--color-text-tertiary); margin-top: 6px; }
.stat-card.highlight label { color: rgba(255,255,255,0.8); }

.progress-section { background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-lg); padding: 16px; margin-bottom: 16px; }
.progress-section h3 { margin: 0 0 12px 0; font-size: 14px; color: var(--color-text-secondary); }
.progress-bar { width: 100%; height: 12px; background: var(--color-border-light); border-radius: 6px; overflow: hidden; }
.progress-fill { height: 100%; background: var(--color-primary); border-radius: 6px; transition: width 0.3s; }
.progress-text { margin: 8px 0 0; font-size: 13px; color: var(--color-text-secondary); }

/* 错题统计图表 */
.wrong-chart-section { background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-lg); padding: 16px 20px; margin-bottom: 16px; }
.wrong-chart-section h3 { margin: 0 0 12px 0; font-size: 15px; }
.wrong-chart-container { display: flex; align-items: center; gap: 24px; }
.wrong-chart { flex-shrink: 0; }
.wrong-chart canvas { display: block; }
.wrong-summary { display: flex; flex-direction: column; gap: 12px; }
.wrong-stat { display: flex; justify-content: space-between; align-items: center; min-width: 120px; }
.wrong-label { font-size: 14px; color: var(--color-text-secondary); }
.wrong-value { font-size: 18px; font-weight: 600; color: var(--color-text); }
.wrong-value.success { color: var(--color-success-strong); }
.wrong-value.warning { color: var(--color-warning-strong); }

/* 学习趋势图表 */
.trend-section { background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-lg); padding: 16px 20px; margin-bottom: 16px; }
.trend-section h3 { margin: 0 0 12px 0; font-size: 15px; }
.trend-chart-container { margin-bottom: 16px; }
.trend-chart-container canvas { display: block; width: 100%; height: auto; }
.trend-summary { display: flex; justify-content: space-around; }
.trend-stat { display: flex; flex-direction: column; align-items: center; }
.trend-label { font-size: 12px; color: var(--color-text-secondary); }
.trend-value { font-size: 20px; font-weight: 600; color: var(--color-primary); }

/* 热力图 */
.heatmap-section { background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-lg); padding: 16px 20px; margin-bottom: 16px; }
.heatmap-section h3 { margin: 0 0 12px 0; font-size: 15px; }
.heatmap-wrap { overflow-x: auto; padding-bottom: 4px; }
.heatmap-months { display: grid; grid-template-columns: 24px repeat(53, 12px); gap: 3px; font-size: 11px; color: var(--color-text-tertiary); margin-bottom: 4px; }
[data-theme="dark"] .heatmap-months { color: var(--color-text-secondary); }
.heatmap-months span { white-space: nowrap; }
.heatmap-grid { display: flex; gap: 3px; }
.weekday-labels { display: flex; flex-direction: column; gap: 3px; width: 24px; flex-shrink: 0; font-size: 10px; color: var(--color-text-tertiary); padding-top: 1px; }
[data-theme="dark"] .weekday-labels { color: var(--color-text-secondary); }
.weekday-labels span { height: 12px; line-height: 12px; }
.heatmap-week { display: flex; flex-direction: column; gap: 3px; }
.heatmap-cell { width: 12px; height: 12px; border-radius: 2px; background: var(--color-border-light); transition: transform 0.1s; }
.heatmap-cell:hover { transform: scale(1.4); outline: 1px solid var(--color-primary); }
.heatmap-cell.today { outline: 1.5px solid var(--color-info-strong); outline-offset: 1px; }
.heatmap-cell.level-0 { background: var(--color-surface); }
.heatmap-cell.level-1 { background: #c6e48b; }
.heatmap-cell.level-2 { background: #7bc96f; }
.heatmap-cell.level-3 { background: #239a3b; }
.heatmap-cell.level-4 { background: #196127; }
[data-theme="dark"] .heatmap-cell.level-0 { background: #2d333b; }
[data-theme="dark"] .heatmap-cell.level-1 { background: #0e4429; }
[data-theme="dark"] .heatmap-cell.level-2 { background: #006d32; }
[data-theme="dark"] .heatmap-cell.level-3 { background: #26a641; }
[data-theme="dark"] .heatmap-cell.level-4 { background: #39d353; }
.heatmap-legend { display: flex; align-items: center; gap: 4px; margin-top: 12px; font-size: 11px; color: var(--color-text-tertiary); }
.legend-cell { width: 12px; height: 12px; border-radius: 2px; display: inline-block; }
.legend-cell.level-0 { background: var(--color-surface); }
.legend-cell.level-1 { background: #c6e48b; }
.legend-cell.level-2 { background: #7bc96f; }
.legend-cell.level-3 { background: #239a3b; }
.legend-cell.level-4 { background: #196127; }
[data-theme="dark"] .legend-cell.level-0 { background: #2d333b; }
[data-theme="dark"] .legend-cell.level-1 { background: #0e4429; }
[data-theme="dark"] .legend-cell.level-2 { background: #006d32; }
[data-theme="dark"] .legend-cell.level-3 { background: #26a641; }
[data-theme="dark"] .legend-cell.level-4 { background: #39d353; }
.heatmap-summary { font-size: 12px; color: var(--color-text-secondary); margin-top: 8px; }
.heatmap-summary b { color: var(--color-primary); font-weight: 600; }

/* 移动端适配：缩小热力图格子，尽量一屏显示 */
@media (max-width: 768px) {
  .heatmap-months { grid-template-columns: 20px repeat(53, 10px); gap: 2px; }
  .heatmap-cell { width: 10px; height: 10px; }
  .heatmap-grid { gap: 2px; }
  .heatmap-week { gap: 2px; }
  .weekday-labels { width: 20px; gap: 2px; }
  .weekday-labels span { height: 10px; line-height: 10px; }
}

.tips { background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-lg); padding: 16px 20px; }
.tips h3 { margin: 0 0 12px 0; font-size: 14px; color: var(--color-text-secondary); }
.tip-item { padding: 10px 0; border-bottom: 1px solid var(--color-border-light); font-size: 14px; color: var(--color-text); }
.tip-item:last-child { border-bottom: none; }
.tip-item.warn { color: var(--color-warning); }
.tip-item.success { color: var(--color-success); }
.link { color: var(--color-primary); text-decoration: none; font-weight: 500; }
.link:hover { text-decoration: underline; }
</style>
