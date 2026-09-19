import { createRouter, createWebHashHistory } from 'vue-router'
import { setPageMeta } from '../lib/share'

const routes = [
  { path: '/', name: 'home', component: () => import('../views/HomeView.vue') },
  { path: '/import/:bankId?', name: 'import', component: () => import('../views/ImportView.vue') },
  { path: '/practice/:bankId', name: 'practice', component: () => import('../views/PracticeView.vue') },
  { path: '/wrong/:bankId', name: 'wrong', component: () => import('../views/WrongView.vue') },
  { path: '/favorites/:bankId', name: 'favorites', component: () => import('../views/FavoritesView.vue') },
  { path: '/stats/:bankId', name: 'stats', component: () => import('../views/StatsView.vue') },
  { path: '/mix-exam', name: 'mix-exam', component: () => import('../views/MixExamView.vue') },
  { path: '/compose-exam', name: 'compose-exam', component: () => import('../views/ComposeExamView.vue') },
  { path: '/public-practice/:bankId/:bankName?', name: 'public-practice', component: () => import('../views/PublicPracticeView.vue') },
  { path: '/exams', name: 'exams', component: () => import('../views/ExamListView.vue') },
  { path: '/exam/create', name: 'exam-create', component: () => import('../views/ExamCreateView.vue') },
  { path: '/exam/:examId', name: 'exam-take', component: () => import('../views/ExamTakeView.vue') },
  { path: '/exam/:examId/results', name: 'exam-results', component: () => import('../views/ExamResultsView.vue') },
  { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue') },
  { path: '/study-plan', name: 'study-plan', component: () => import('../views/StudyPlanView.vue') },
  { path: '/memory-review', name: 'memory-review', component: () => import('../views/MemoryReviewView.vue') },
  // 404 兜底：未知路径回首页（2026-08-15 修复）
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({ history: createWebHashHistory(), routes })

// 动态设置分享卡片标题（服务系统分享面板 / 桌面浏览器；微信粘贴预览由 index.html 固定卡兜底）
const ROUTE_META: Record<string, { title: string; desc: string }> = {
  exams: { title: '考试管理 - 小兔错题本', desc: '创建考试、分享链接给考生答题、实时查看成绩' },
  'exam-take': { title: '考试答题 - 小兔错题本', desc: '正在作答考试' },
  'exam-results': { title: '考试成绩 - 小兔错题本', desc: '查看考试答题成绩' },
  'exam-create': { title: '创建考试 - 小兔错题本', desc: '手动创建考试或智能组卷 220 题综合大考' },
  settings: { title: '设置 - 小兔错题本', desc: '小兔错题本应用设置' },
  'public-practice': { title: '练习 - 小兔错题本', desc: '公共题库在线练习' },
  'mix-exam': { title: '混合抽题 - 小兔错题本', desc: '从多个题库随机抽题练习' },
  'compose-exam': { title: '智能组卷 - 小兔错题本', desc: '按等级×题型配额随机组卷 220 题综合大考' },
  'memory-review': { title: '记忆复习 - 小兔错题本', desc: '基于遗忘曲线的间隔重复，自动评估记忆强度，按计划复习' },
}

router.afterEach((to) => {
  const m = ROUTE_META[to.name as string]
  setPageMeta(m ? { title: m.title, desc: m.desc } : { title: '小兔错题本', desc: '导题 刷题 考试，就用小兔错题本' })
})

export default router
