<template>
  <div class="exam-list">
    <div class="header">
      <div>
        <h2>📝 考试管理</h2>
        <p class="header-sub">创建考试，分享链接给考生答题，实时查看成绩</p>
      </div>
      <button class="create-btn" @click="$router.push('/exam/create')">+ 创建考试</button>
    </div>

    <div class="tabs">
      <button class="tab" :class="{ active: tab === 'public' }" @click="tab = 'public'">
        🌍 公共考试<span class="tab-count">{{ publicExams.length }}</span>
      </button>
      <button class="tab" :class="{ active: tab === 'mine' }" @click="tab = 'mine'">
        🔒 我的考试<span class="tab-count">{{ myExams.length }}</span>
      </button>
    </div>

    <div v-if="loading" class="loading">加载中...</div>
    <!-- 2026-09-27：列表为空但还有已归档的 ⇒ 直接说清"东西还在"，避免被理解成数据没了 -->
    <div v-else-if="!shownExams.length && archivedExams.length && !showArchived" class="empty">
      <div class="empty-icon">📦</div>
      <p class="empty-title">暂无进行中的考试</p>
      <p class="empty-tip">你还有 <b>{{ archivedExams.length }}</b> 场已归档的考试，点下面展开看看</p>
      <button class="empty-action" @click="showArchived = true">展开已归档（{{ archivedExams.length }}）</button>
    </div>
    <div v-else-if="!shownExams.length" class="empty">
      <div class="empty-icon">📋</div>
      <p class="empty-title">{{ tab === 'public' ? '还没有公共考试' : '你还没有创建考试' }}</p>
      <p class="empty-tip">{{ tab === 'public' ? '创建一场考试并选择"公共考试"即可让所有人看到' : '创建考试后这里会显示你的所有考试（含自建）' }}</p>
      <button class="empty-action" @click="$router.push('/exam/create')">+ 创建考试</button>
    </div>
    <div v-else class="exam-cards">
      <!-- 2026-09-27：归档区开关（归档的考试默认撤下，打开可查看并取消归档） -->
      <div v-if="archivedExams.length" class="arch-toggle" @click="showArchived = !showArchived">
        {{ showArchived ? '收起已归档' : `显示已归档（${archivedExams.length}）` }}
      </div>
      <div v-for="e in shownExams" :key="e._id" class="exam-card" :class="{ 'is-archived': e.archived }">
        <div class="card-top">
          <div class="card-title">
            {{ e.title }}
            <span class="vis-badge" :class="e.visibility === 'private' ? 'private' : 'public'">
              {{ e.visibility === 'private' ? '🔒 自建' : '🌍 公共' }}
            </span>
          </div>
          <span class="status-badge" :class="e.status">{{ statusText(e.status) }}</span>
          <span v-if="e.archived" class="status-badge">📦 已归档</span>
          <!-- 归档/取消归档：只对「我的考试」里自己创建的开放（公共列表里别人的考试不显示） -->
          <button v-if="tab === 'mine' && isMine(e)" class="act-btn" @click.stop="toggleArchived(e)">
            {{ e.archived ? '取消归档' : '归档' }}
          </button>
        </div>
        <p class="card-desc">{{ e.description || '（无描述）' }}</p>
        <div class="card-meta">
          <span v-if="e.creator_name">👤 {{ e.creator_name }}</span>
          <!-- T18-2d：题数改读服务端给的 `question_count`（列表不再下发 questions）。
               原先读 `e.questions?.length`——收窄白名单后列表里没有 questions，会恒显 0 题。 -->
          <span>📚 {{ e.question_count ?? e.questions?.length ?? 0 }} 题</span>
          <span>⏱ {{ e.duration_minutes }} 分钟</span>
          <span v-if="e.deadline" :class="{ expired: isExpired(e.deadline) }">⏰ {{ formatDeadline(e.deadline) }}</span>
          <span>📅 {{ formatDate(e.created_at) }}</span>
        </div>
        <div class="card-actions">
          <button class="act-btn primary" @click="shareExam(e)">📤 分享考试</button>
          <button class="act-btn" @click="$router.push(`/exam/${e._id}`)">📖 进入</button>
          <template v-if="isMine(e)">
            <button class="act-btn" @click="$router.push(`/exam/${e._id}/results`)">📊 成绩</button>
            <button class="act-btn danger" @click="remove(e._id!)">🗑</button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { listExams, deleteExam, setExamArchived, getCurrentUid, isExamOwner, errMsg, examShareUrl, type Exam } from '../lib/exam'
import { toastSuccess, toastError } from '../utils/toast'
import { sharePage } from '../lib/share'

const exams = ref<Exam[]>([])
const loading = ref(true)
const tab = ref<'public' | 'mine'>('public')
const myUid = ref<string | null>(null)

// 是否我创建的考试（P1-28，2026-09-15）：只认云端写入的 `_openid`（见 exam.ts isExamOwner）。
// 旧判据「本设备有该考试的快照」（hasLocalSnapshot）**不成立**：考生也会留下该考试的快照
// （P0-5 之后仍留一份剥离版），拿快照当"我的"会让考生看到本不该有的「📊 成绩 / 🗑 删除」按钮。
// 纯本地演示模式的考试（无 `_openid`）仍视为本人创建，理由见 isExamOwner 注释。
const isMine = (e: Exam) => isExamOwner(e, myUid.value)

// 公共考试：visibility 为 public（非创建者看到的都是 public）
// 2026-09-27：已归档（exams.archived === true）的考试不再出现在列表里 —— 归档＝从视图撤下，
// 数据与成绩都保留（管理端仍可查、可取消归档）。与题库的 archived 折叠同语义。
const publicExams = computed(() => exams.value.filter(e => e.visibility !== 'private' && !(e as any).archived))
// 我的考试：自己创建的（含 private 自建）
const myExams = computed(() => exams.value.filter(e => isMine(e) && !(e as any).archived))
// 归档区（2026-09-27）：已归档的默认不显示；开关打开后追加在列表末尾，可在卡片上取消归档
const showArchived = ref(false)
const archivedExams = computed(() => exams.value.filter(e =>
  (e as any).archived && (tab.value === 'public' ? e.visibility !== 'private' : isMine(e))))
const shownExams = computed(() => {
  const base = tab.value === 'public' ? publicExams.value : myExams.value
  return showArchived.value ? [...base, ...archivedExams.value] : base
})
async function toggleArchived(e: any) {
  const next = !(e as any).archived
  // 公共考试的归档影响面是「所有人」——每个考生的列表里都会消失，不只是自己。
  // 属主仍可自助归档（写规则允许），但必须先把后果讲明白。
  const isPublic = e.visibility !== 'private'
  const tip = next
    ? (isPublic
      ? `归档公共考试「${e.title}」？\n\n⚠️ 这会让它对所有人下架——其他考生的列表里也会消失。\n考试数据与成绩都会保留，可随时取消归档。`
      : `归档「${e.title}」？归档后从列表撤下，数据与成绩保留。`)
    : `取消归档「${e.title}」？取消后重新出现在列表里。`
  if (!window.confirm(tip)) return
  const ok = await setExamArchived(e._id, next)
  if (ok) { (e as any).archived = next } else { alert('操作失败，请重试') }
}

onMounted(async () => {
  try {
    const [list, uid] = await Promise.all([listExams(), getCurrentUid()])
    exams.value = list
    myUid.value = uid
  } catch (e) {
    toastError('加载考试失败：' + errMsg(e))
  } finally {
    loading.value = false
  }
})

function statusText(s: string) {
  return { draft: '草稿', published: '进行中', closed: '已结束' }[s] || s
}
function formatDate(iso: string) {
  try {
    const d = new Date(iso)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch { return '' }
}
function formatDeadline(iso: string) {
  try {
    return '截止 ' + new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
}
function isExpired(iso: string): boolean {
  return Date.now() >= new Date(iso).getTime()
}
// 分享考试：动态标题=考试名，手机端调系统面板选微信（卡片动态），桌面端降级复制
async function shareExam(e: Exam) {
  const url = examShareUrl(e._id!)
  const title = `【考试】${e.title}`
  const text = e.description || '邀你参加一场考试，快来答题吧！'
  const res = await sharePage({ title, text, url })
  if (res === 'copied') toastSuccess('考试链接已复制：' + url)
  else if (res === 'failed') toastError('分享失败，请手动复制地址栏链接')
}
async function remove(id: string) {
  // 2026-09-18 修复（重审 A-09，用户裁定「改文案」）：原文案写「考生成绩也会一并删除」，
  // 但 `deleteExam` 根本不碰 `exam_results`（只有管理员面板那条路才清成绩）⇒ 文案作了假承诺。
  // 现按实际行为陈述：考试本身从列表消失并禁止再进入；已交卷的成绩仍然留着、查询码仍可查。
  // 若将来改为真删成绩，需同步改回这句话（属生产写，另议）。
  if (!confirm('确认删除这场考试？删除后考生将无法再进入或提交。已交卷的成绩不会被删除，仍可用查询码查看。')) return
  try {
    await deleteExam(id)
    exams.value = exams.value.filter(e => e._id !== id)
    toastSuccess('已删除')
  } catch (e) {
    toastError('删除失败：' + errMsg(e))
  }
}
</script>

<style scoped>
.header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 16px; gap: 16px; }
.header h2 { margin: 0 0 4px 0; }
.header-sub { font-size: 13px; color: var(--color-text-secondary); margin: 0; }
.create-btn { padding: 9px 18px; background: linear-gradient(135deg, var(--color-primary), var(--color-primary-dark)); color: #fff; border: none; border-radius: var(--radius-md); font-size: 14px; font-weight: 500; cursor: pointer; white-space: nowrap; }
.create-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(79, 70, 229, 0.3); }
.tabs { display: flex; gap: 8px; margin-bottom: 16px; border-bottom: 1px solid var(--color-border); }
.tab { padding: 8px 16px; border: none; background: none; cursor: pointer; font-size: 14px; color: var(--color-text-tertiary); border-bottom: 2px solid transparent; transition: all 0.15s; }
.tab:hover { color: var(--color-text-secondary); }
.tab.active { color: var(--color-primary); border-bottom-color: var(--color-primary); font-weight: 600; }
.tab-count { margin-left: 6px; font-size: 12px; background: var(--color-border-light); border-radius: 10px; padding: 1px 8px; }
.tab.active .tab-count { background: var(--color-primary-light); color: var(--color-primary); }
.exam-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
.exam-card { padding: 18px; background: var(--color-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg); transition: transform 0.15s, box-shadow 0.15s; }
.exam-card:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,0.07); }
.card-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 8px; }
.card-title { font-weight: 600; font-size: 16px; word-break: break-all; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.vis-badge { font-size: 11px; font-weight: 500; padding: 2px 8px; border-radius: 10px; white-space: nowrap; }
.vis-badge.public { background: var(--color-info-bg); color: var(--color-info-deep); }
.vis-badge.private { background: var(--color-warning-bg); color: var(--color-warning-text); }
.status-badge { padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; flex-shrink: 0; }
.status-badge.published { background: var(--color-success-bg); color: var(--color-success-deep); }
.status-badge.closed { background: var(--color-danger-bg); color: var(--color-danger-deep); }
.status-badge.draft { background: var(--color-border-light); color: var(--color-text-secondary); }
.card-desc { font-size: 13px; color: var(--color-text-secondary); margin: 0 0 10px 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.card-meta { display: flex; gap: 12px; font-size: 12px; color: var(--color-text-tertiary); margin-bottom: 14px; flex-wrap: wrap; }
.card-meta .expired { color: var(--color-danger); font-weight: 600; }
.card-actions { display: flex; gap: 8px; flex-wrap: wrap; }
/* 2026-09-27：归档区开关（原先只有类名没有样式，手机上会渲染成浏览器默认样子） */
.arch-toggle {
  display: block; text-align: center; padding: 10px 14px; margin-bottom: 12px;
  border: 1px dashed var(--color-border); border-radius: var(--radius-md);
  background: var(--color-card); color: var(--color-text-secondary);
  font-size: 13px; cursor: pointer;
}
.arch-toggle:hover { background: var(--color-border-light); }
.exam-card.is-archived { opacity: 0.62; }
.act-btn { padding: 6px 14px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); cursor: pointer; font-size: 13px; color: var(--color-text); }
.act-btn:hover { background: var(--color-border-light); }
.act-btn.primary { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
.act-btn.primary:hover { background: var(--color-primary-dark); }
.act-btn.danger { color: var(--color-danger); border-color: var(--color-danger); }
.loading, .empty { text-align: center; padding: 60px 24px; color: var(--color-text-tertiary); }
.empty-icon { font-size: 64px; margin-bottom: 12px; opacity: 0.5; }
.empty-title { font-size: 18px; color: var(--color-text-secondary); margin: 0 0 8px 0; }
.empty-tip { font-size: 14px; margin: 0 0 18px 0; }
.empty-action { padding: 10px 24px; background: linear-gradient(135deg, var(--color-primary), var(--color-primary-dark)); color: #fff; border: none; border-radius: var(--radius-md); font-size: 14px; cursor: pointer; }

/* 移动端适配 */
@media (max-width: 768px) {
  .header { flex-direction: column; align-items: stretch; gap: 10px; }
  .create-btn { width: 100%; }
  .exam-cards { grid-template-columns: 1fr; }
  .tabs { overflow-x: auto; }
  .tab { white-space: nowrap; }
}
</style>
