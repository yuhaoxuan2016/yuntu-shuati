<template>
  <div class="study-plan">
    <h2>智能学习计划</h2>
    
    <!-- 创建计划 -->
    <div class="plan-form" v-if="showForm">
      <h3>创建学习计划</h3>
      <div class="form-group">
        <label>计划名称</label>
        <input v-model="form.name" placeholder="例如：考研数学复习" />
      </div>
      <div class="form-group">
        <label>选择题库</label>
        <div class="bank-list">
          <label v-for="bank in banks" :key="bank.id" class="bank-item">
            <input type="checkbox" v-model="form.bankIds" :value="bank.id" />
            <span>{{ bank.name }} ({{ bank.question_count }}题)</span>
          </label>
        </div>
      </div>
      <div class="form-group">
        <label>每日目标题数</label>
        <input v-model.number="form.dailyGoal" type="number" min="10" max="200" />
      </div>
      <div class="form-group">
        <label>目标考试日期（可选）</label>
        <input v-model="form.examDate" type="date" />
      </div>
      <div class="form-actions">
        <button @click="createPlan" :disabled="!canSubmit">创建计划</button>
        <button @click="showForm = false" class="cancel">取消</button>
      </div>
    </div>

    <!-- 计划列表 -->
    <div class="plan-list" v-else>
      <div class="plan-header">
        <h3>我的学习计划</h3>
        <button @click="showForm = true" class="create-btn">+ 创建计划</button>
      </div>
      
      <div v-if="plans.length === 0" class="empty">
        <p>暂无学习计划</p>
        <p class="hint">创建计划后，系统会根据遗忘曲线自动安排复习</p>
      </div>

      <div v-else class="plans">
        <div v-for="plan in plans" :key="plan.id" class="plan-card">
          <div class="plan-info">
            <h4>{{ plan.name }}</h4>
            <p>每日目标：{{ plan.dailyGoal }}题</p>
            <p>题库：{{ getBankNames(plan.bankIds) }}</p>
            <p v-if="plan.examDate">目标考试：{{ plan.examDate }}</p>
          </div>
          <div class="plan-actions">
            <button @click="startPlan(plan)" class="start">开始学习</button>
            <button @click="deletePlan(plan.id)" class="delete">删除</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 今日任务 -->
    <div v-if="currentPlan" class="today-task">
      <h3>今日学习任务</h3>
      <div class="task-summary">
        <div class="task-item">
          <span class="label">复习题目</span>
          <span class="value">{{ todayTask.reviewQuestions.length }}题</span>
        </div>
        <div class="task-item">
          <span class="label">新题目</span>
          <span class="value">{{ todayTask.newQuestions.length }}题</span>
        </div>
        <div class="task-item">
          <span class="label">已完成</span>
          <span class="value">{{ completedCount }}题</span>
        </div>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: progressPercentage + '%' }"></div>
      </div>
      <div class="progress-text">{{ progressPercentage }}%</div>
      <button @click="startPractice" class="practice-btn">
        {{ completedCount > 0 ? '继续学习' : '开始学习' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../utils/api'
import { idb } from '../lib/db'
import { calculateDailyTask, formatDate } from '../lib/spaced-repetition'
import { toastSuccess, toastError, toastInfo } from '../utils/toast'

const router = useRouter()

// 状态
const showForm = ref(false)
const plans = ref<any[]>([])
const banks = ref<any[]>([])
const currentPlan = ref<any>(null)
const todayTask = ref<any>({ reviewQuestions: [], newQuestions: [], totalGoal: 0 })
const completedQuestions = ref<number[]>([])
// 2026-08-22：题目 id → 所属题库 id 映射（计划跨题库时，练习页需要按题库过滤队列）
const planQuestionBankMap = ref<Map<number, number>>(new Map())

// 表单
const form = ref({
  name: '',
  bankIds: [] as number[],
  dailyGoal: 50,
  examDate: ''
})

// 计算属性
const canSubmit = computed(() => {
  return form.value.name && form.value.bankIds.length > 0 && form.value.dailyGoal > 0
})

const completedCount = computed(() => {
  return completedQuestions.value.filter(id => 
    todayTask.value.reviewQuestions.includes(id) || 
    todayTask.value.newQuestions.includes(id)
  ).length
})

const progressPercentage = computed(() => {
  const total = todayTask.value.reviewQuestions.length + todayTask.value.newQuestions.length
  return total > 0 ? Math.round((completedCount.value / total) * 100) : 0
})

// 加载数据
async function loadData() {
  try {
    // 加载题库
    banks.value = await api.listBanks()
    
    // 加载计划
    plans.value = await idb.listPlans()
    
    // 如果有计划，加载今日任务
    if (plans.value.length > 0) {
      currentPlan.value = plans.value[0]
      await loadTodayTask()
    }
  } catch (e) {
    console.error('加载数据失败：', e)
  }
}

// 加载今日任务
async function loadTodayTask() {
  if (!currentPlan.value) return
  
  try {
    // 获取计划中的所有题目
    const allQuestions: { id: number; bankId: number }[] = []
    planQuestionBankMap.value.clear()
    for (const bankId of currentPlan.value.bankIds) {
      const questions = await api.listQuestions(bankId)
      for (const q of questions) {
        planQuestionBankMap.value.set(q.id, q.bank_id)
        allQuestions.push({ id: q.id, bankId: q.bank_id })
      }
    }
    
    // 获取复习记录
    const reviewRecords = await idb.listReviewRecords()
    
    // 计算今日任务
    todayTask.value = calculateDailyTask(currentPlan.value, reviewRecords, allQuestions)
    
    // 获取已完成的题目（从本地存储）
    const stored = localStorage.getItem(`completed_${currentPlan.value.id}_${formatDate(new Date())}`)
    completedQuestions.value = stored ? JSON.parse(stored) : []
  } catch (e) {
    console.error('加载今日任务失败：', e)
  }
}

// 创建计划
async function createPlan() {
  if (!canSubmit.value) return
  
  try {
    const plan = {
      name: form.value.name,
      bankIds: form.value.bankIds,
      dailyGoal: form.value.dailyGoal,
      examDate: form.value.examDate || null,
      createdAt: new Date().toISOString()
    }
    
    await idb.createPlan(plan)
    toastSuccess('学习计划创建成功')
    
    // 重置表单
    form.value = { name: '', bankIds: [], dailyGoal: 50, examDate: '' }
    showForm.value = false
    
    // 重新加载
    await loadData()
  } catch (e) {
    toastError('创建失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

// 删除计划
async function deletePlan(id: number) {
  if (!confirm('确定删除这个学习计划吗？')) return
  
  try {
    await idb.deletePlan(id)
    toastSuccess('计划已删除')
    
    if (currentPlan.value?.id === id) {
      currentPlan.value = null
      todayTask.value = { reviewQuestions: [], newQuestions: [], totalGoal: 0 }
    }
    
    await loadData()
  } catch (e) {
    toastError('删除失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

// 开始计划
function startPlan(plan: any) {
  currentPlan.value = plan
  loadTodayTask()
}

// 开始练习
// 2026-08-22 修复：
// 1. 路由错误：/bank/:id/practice 不存在（404 回首页），改为实际路由 /practice/:bankId?mode=plan
// 2. 队列带 bankId：PracticeView 计划模式按 (id, bankId) 过滤出属于当前题库的题
// 3. 任务总数落盘：首页进度条需要知道今日任务总数（completed/dailyGoal 口径不对）
function startPractice() {
  if (!currentPlan.value) return

  // 将今日任务的题目ID + 题库ID 存储到本地（按 id → bankId 映射，跨题库计划可正确过滤）
  const questionIds = [
    ...todayTask.value.reviewQuestions,
    ...todayTask.value.newQuestions
  ]
  const planItems = questionIds.map(id => ({
    id,
    bankId: planQuestionBankMap.value.get(id) ?? currentPlan.value.bankIds[0]
  }))
  localStorage.setItem('study_plan_questions', JSON.stringify(planItems))
  localStorage.setItem('study_plan_id', currentPlan.value.id.toString())
  // 今日任务总数（供首页进度计算）
  const today = formatDate(new Date())
  const taskTotal = todayTask.value.reviewQuestions.length + todayTask.value.newQuestions.length
  localStorage.setItem(`task_total_${currentPlan.value.id}_${today}`, String(taskTotal))

  if (currentPlan.value.bankIds.length > 1) {
    const firstName = getBankNames([currentPlan.value.bankIds[0]])
    toastInfo(`本次练习仅包含「${firstName}」的题目，其余题库请在对应题库中练习`)
  }

  // 2026-08-22 修复：实际路由是 /practice/:bankId（此前 /bank/:id/practice 404 回首页）
  router.push(`/practice/${currentPlan.value.bankIds[0]}?mode=plan`)
}

// 获取题库名称
function getBankNames(bankIds: number[]): string {
  return bankIds.map(id => {
    const bank = banks.value.find(b => b.id === id)
    return bank ? bank.name : '未知题库'
  }).join('、')
}

onMounted(loadData)
</script>

<style scoped>
.study-plan {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
}

h2 {
  margin-bottom: 24px;
  color: var(--color-text);
}

.plan-form {
  background: var(--color-card);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  padding: 24px;
  margin-bottom: 24px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
  color: var(--color-text);
}

.form-group input,
.form-group select {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
}

.bank-list {
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 12px;
}

.bank-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  cursor: pointer;
}

.bank-item input[type="checkbox"] {
  width: auto;
}

.form-actions {
  display: flex;
  gap: 12px;
  margin-top: 20px;
}

.form-actions button {
  flex: 1;
  padding: 12px;
  border: none;
  border-radius: var(--radius-md);
  font-weight: 500;
  cursor: pointer;
}

.form-actions button:first-child {
  background: var(--color-primary);
  color: #fff;
}

.form-actions button.cancel {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
}

.plan-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.create-btn {
  padding: 10px 16px;
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
}

.empty {
  text-align: center;
  padding: 40px;
  color: var(--color-text-tertiary);
}

.empty .hint {
  font-size: 14px;
  margin-top: 8px;
}

.plans {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.plan-card {
  background: var(--color-card);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  padding: 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.plan-info h4 {
  margin: 0 0 8px 0;
  color: var(--color-text);
}

.plan-info p {
  margin: 4px 0;
  color: var(--color-text-secondary);
  font-size: 14px;
}

.plan-actions {
  display: flex;
  gap: 8px;
}

.plan-actions button {
  padding: 8px 16px;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
}

.plan-actions button.start {
  background: var(--color-primary);
  color: #fff;
}

.plan-actions button.delete {
  background: var(--color-bg);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
}

.today-task {
  background: var(--color-card);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  padding: 24px;
  margin-top: 24px;
}

.task-summary {
  display: flex;
  gap: 24px;
  margin-bottom: 20px;
}

.task-item {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.task-item .label {
  font-size: 14px;
  color: var(--color-text-secondary);
}

.task-item .value {
  font-size: 24px;
  font-weight: 600;
  color: var(--color-primary);
}

.progress-bar {
  height: 12px;
  background: var(--color-bg);
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 8px;
}

.progress-fill {
  height: 100%;
  background: var(--color-primary);
  border-radius: 6px;
  transition: width 0.3s ease;
}

.progress-text {
  text-align: center;
  font-weight: 500;
  color: var(--color-text);
  margin-bottom: 16px;
}

.practice-btn {
  width: 100%;
  padding: 14px;
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
}

.practice-btn:hover {
  opacity: 0.9;
}
</style>