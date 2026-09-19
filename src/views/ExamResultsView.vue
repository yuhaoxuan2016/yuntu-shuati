<template>
  <div class="exam-results">
    <button class="back-btn" @click="$router.push('/exams')">← 返回考试列表</button>

    <div v-if="loading" class="center">加载中...</div>

    <div v-else-if="noPermission" class="center">
      <p>🔒 无权限查看该考试的成绩</p>
      <p class="perm-tip">只有考试创建者可以看到成绩（含考生姓名与分数）</p>
    </div>

    <div v-else-if="!exam" class="center">
      <p>考试不存在</p>
    </div>

    <div v-else>
      <div class="header">
        <div>
          <h2>{{ exam.title }}</h2>
          <p class="sub">
            {{ exam.description || '（无描述）' }} · {{ exam.questions.length }} 题 · {{ exam.duration_minutes }} 分钟 ·
            {{ results.length }} 人已交卷
          </p>
        </div>
        <button class="copy-btn" @click="shareExam">📤 分享考试</button>
      </div>

      <!-- 汇总统计 -->
      <div v-if="results.length" class="summary">
        <div class="sum-card"><div class="sum-num">{{ avgScore }}</div><div class="sum-label">平均分</div></div>
        <div class="sum-card"><div class="sum-num">{{ maxScore }}</div><div class="sum-label">最高分</div></div>
        <div class="sum-card"><div class="sum-num">{{ results.length }}</div><div class="sum-label">参考人数</div></div>
      </div>

      <!-- 成绩表格 -->
      <div v-if="results.length" class="table-wrap">
        <table class="score-table">
          <thead>
            <tr>
              <th>排名</th>
              <th>姓名</th>
              <th>得分</th>
              <th>正确率</th>
              <th>答对</th>
              <th>答错</th>
              <th>未答</th>
              <th>用时</th>
              <th>交卷时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in results" :key="r._id || i">
              <td class="rank" :class="{ top: i === 0 }">{{ i + 1 }}</td>
              <td class="name">{{ r.student_name }}</td>
              <td class="score" :class="{ high: r.score >= 80, mid: r.score >= 60 && r.score < 80, low: r.score < 60 }">
                {{ r.score }}
              </td>
              <td>{{ r.accuracy }}%</td>
              <td class="good">{{ r.correct }}</td>
              <td class="bad">{{ r.wrong }}</td>
              <td>{{ r.unanswered }}</td>
              <td>{{ formatDuration(r.duration_ms) }}</td>
              <td>{{ formatTime(r.submitted_at) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="center empty-results">
        <div class="empty-icon">📭</div>
        <p>还没有考生交卷</p>
        <p class="tip">分享考试链接发给考生，成绩会自动出现在这里</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { getExam, getCurrentUid, isExamOwner, listExamResults, examShareUrl, errMsg, type Exam, type ExamResult } from '../lib/exam'
import { toastError, toastSuccess } from '../utils/toast'
import { sharePage, setPageMeta } from '../lib/share'

const route = useRoute()
const examId = String(route.params.examId)
const exam = ref<Exam | null>(null)
const results = ref<ExamResult[]>([])
const loading = ref(true)
// P1-28：非属主不展示成绩（成绩表含全班考生姓名与分数）
const noPermission = ref(false)

const avgScore = computed(() => results.value.length ? Math.round(results.value.reduce((s, r) => s + r.score, 0) / results.value.length) : 0)
const maxScore = computed(() => results.value.length ? Math.max(...results.value.map(r => r.score)) : 0)

onMounted(async () => {
  try {
    const [ex, uid] = await Promise.all([getExam(examId), getCurrentUid()])
    exam.value = ex
    if (!ex) return // 模板显示「考试不存在」
    // P1-28（2026-09-15）：属主校验。旧版任何拿到考试 id 的人（= 所有考生，链接就在分享卡片里）
    // 都能打开 /exam/:id/results 看到全班姓名与分数。属主判据统一走 exam.ts isExamOwner
    // （只认 `_openid`；考生快照 **不是** 属主证据，与 ExamListView.isMine 同一口径）。
    if (!isExamOwner(ex, uid)) { noPermission.value = true; return }
    setPageMeta({ title: `【考试】${ex.title}`, desc: ex.description || '查看考试答题成绩' })
    results.value = await listExamResults(examId)
  } catch (e) {
    toastError('加载失败：' + errMsg(e))
  } finally {
    loading.value = false
  }
})

// 分享考试：动态标题=考试名，手机端调系统面板选微信（卡片动态），桌面端降级复制
async function shareExam() {
  if (!exam.value) return
  const url = examShareUrl(examId)
  const title = `【考试】${exam.value.title}`
  const text = exam.value.description || '邀你参加一场考试，快来答题吧！'
  const res = await sharePage({ title, text, url })
  if (res === 'copied') toastSuccess('考试链接已复制：' + url)
  else if (res === 'failed') toastError('分享失败，请手动复制地址栏链接')
}
function formatDuration(ms: number | null) {
  if (!ms) return '—'
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000)
  return `${m}分${s}秒`
}
function formatTime(iso: string) {
  try {
    const d = new Date(iso)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch { return '' }
}
</script>

<style scoped>
.back-btn { padding: 6px 14px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); cursor: pointer; font-size: 13px; margin-bottom: 16px; color: var(--color-text); }
.back-btn:hover { background: var(--color-border-light); }
.header { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-bottom: 18px; flex-wrap: wrap; }
.header h2 { margin: 0 0 4px 0; }
.sub { font-size: 13px; color: var(--color-text-secondary); margin: 0; }
.copy-btn { padding: 8px 18px; background: var(--color-primary); color: #fff; border: none; border-radius: var(--radius-md); font-size: 13px; font-weight: 500; cursor: pointer; white-space: nowrap; }
.copy-btn:hover { background: var(--color-primary-dark); }
.summary { display: flex; gap: 14px; margin-bottom: 18px; flex-wrap: wrap; }
.sum-card { flex: 1; min-width: 110px; padding: 14px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-md); text-align: center; }
.sum-num { font-size: 26px; font-weight: 700; color: var(--color-primary); }
.sum-label { font-size: 12px; color: var(--color-text-tertiary); margin-top: 4px; }
.table-wrap { overflow-x: auto; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-lg); }
.score-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 640px; }
.score-table th { text-align: left; padding: 12px 14px; background: var(--color-bg); color: var(--color-text-secondary); font-weight: 600; font-size: 12px; border-bottom: 1px solid var(--color-border); white-space: nowrap; }
.score-table td { padding: 10px 14px; border-bottom: 1px solid var(--color-border-light); color: var(--color-text); }
.score-table tr:last-child td { border-bottom: none; }
.score-table tr:hover td { background: var(--color-primary-light); }
.rank { font-weight: 600; color: var(--color-text-tertiary); }
.rank.top { color: var(--color-warning-strong); }
.name { font-weight: 600; }
.score { font-weight: 700; font-size: 15px; }
.score.high { color: var(--color-success-strong); }
.score.mid { color: var(--color-warning-deep); }
.score.low { color: var(--color-danger-strong); }
.good { color: var(--color-success-strong); }
.bad { color: var(--color-danger-strong); }
.center { text-align: center; padding: 60px 24px; color: var(--color-text-tertiary); }
.empty-icon { font-size: 56px; margin-bottom: 12px; opacity: 0.5; }
.empty-results p { margin: 4px 0; }
.empty-results .tip { font-size: 13px; color: var(--color-text-tertiary); }
.perm-tip { font-size: 13px; color: var(--color-text-tertiary); }

/* 移动端适配 */
@media (max-width: 768px) {
  .header { flex-direction: column; align-items: stretch; }
  .copy-btn { width: 100%; }
  .sum-card { min-width: calc(50% - 8px); }
  .score-table { font-size: 12px; }
  .score-table th, .score-table td { padding: 8px 10px; }
}
</style>
