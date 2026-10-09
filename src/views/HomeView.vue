<template>
  <div class="home">
    <div class="header">
      <div>
        <h2>我的题库</h2>
        <div class="header-sub">
          共 <b>{{ bankStore.banks.length }}</b> 个题库 ·
          <b>{{ totalQuestions }}</b> 道题 ·
          已掌握 <b>{{ totalMastered }}</b> 道
        </div>
        <!-- 2026-10-07：同步状态胶囊（四态；未配云 = 灰显「未开启」，点击去设置）
             2026-10-07 晚：☁ 常驻 + 状态随行符（↻ 转=同步中、✓ 落定轻弹），动效在 .sc-mark 上 -->
        <button
          class="sync-chip"
          :class="['ss-' + (syncEnabled ? homeSync.state : 'off'), { 'ss-pop': justSynced }]"
          :title="syncEnabled ? (homeSync.msg || '点一下立即全量同步（上传 + 下载）') : '去设置里开启云同步'"
          @click="doHomeSync"
        ><span class="sc-ico">☁</span><span class="sc-mark">{{ homeSyncMark }}</span>{{ homeSyncText }}</button>
      </div>
      <div class="header-btns">
        <button class="exam-btn" @click="$router.push('/exams')"><img class="btn-icon" src="/icons/exam.gif" alt="考试" /> 考试</button>
        <button class="mix-exam-btn" @click="$router.push('/mix-exam')"><img class="btn-icon" src="/icons/mix.gif" alt="综合抽题" /> 综合抽题</button>
        <a class="calc-btn" href="/calc/" target="_blank" rel="noopener">🧮 计算器</a>
        <button class="new-bank-btn" @click="showNew = true">+ 新建题库</button>
      </div>
      <!-- 跨库聚合入口（2026-09-29）：订阅库不落本地行，原先错题/收藏只有库卡上的入口
           ⇒ 取消订阅后记录虽然还在，却没有任何地方能看到。这两个入口就是补那一刀。 -->
      <div class="header-btns records-btns">
        <button class="record-btn" @click="$router.push('/wrong')">📕 错题本<template v-if="recordCounts.wrong"> · {{ recordCounts.wrong }}</template></button>
        <button class="record-btn" @click="$router.push('/favorites')">⭐ 收藏<template v-if="recordCounts.fav"> · {{ recordCounts.fav }}</template></button>
      </div>
    </div>

    <!-- 新手指引（2026-09-28）：新用户首开弹一次；判定在 onMounted 的 bankStore.load 回调里 -->
    <OnboardingTour v-if="showTour" />

    <!-- 云朵彩蛋欢迎条（触发过彩蛋后显示） -->
    <div v-if="cloudEgg" class="cloud-welcome-bar">☁️ 小兔错题本 已经准备就绪，旅行者请开始今天的练习 ⭐</div>

    <!-- 本机存储提醒（有数据但没配云同步时显示；2026-10-04 起改为常驻，「知道了」只收起当天） -->
    <div v-if="showCacheTip" class="local-tip">
      <span class="local-tip-icon">⚠️</span>
      <span class="local-tip-text">
        你的题库与进度只存在<b>本机浏览器</b>：清缓存、换浏览器或换设备都会丢。
        去设置里开一次<b>云同步</b>（两分钟），或定期用「导出备份」留一份。
      </span>
      <button class="local-tip-btn" @click="$router.push('/settings')">去设置</button>
      <button class="local-tip-x" title="今天先不提示，明天会再提醒" @click="dismissCacheTip">知道了</button>
    </div>

    <!-- 访问统计 -->
    <div v-if="visitStats" class="visit-bar">
      👁 累计访问 <b>{{ visitStats.total }}</b> 次 · 今日 <b>{{ visitStats.today }}</b> 次
    </div>

    <!-- 每日一诗 -->
    <div v-if="dailyPoem" class="poem-card">
      <div class="poem-head">📜 每日一诗 · {{ todayText }}</div>
      <div class="poem-content">{{ dailyPoem.content }}</div>
      <div class="poem-meta">—— {{ dailyPoem.dynasty }}·{{ dailyPoem.author }}《{{ dailyPoem.title }}》</div>
    </div>

    <!-- 每日学习卡片（学习类 App 常见激励） -->
    <div v-if="todayStats.total > 0" class="daily-card">
      <div class="daily-left">
        <img class="daily-icon" src="/icons/flame.gif" alt="🔥" />
        <div>
          <div class="daily-title">{{ myName }}，今天已刷 <b>{{ todayStats.total }}</b> 题</div>
          <div class="daily-sub">正确率 {{ todayStats.accuracy }}% · 连续刷题 <b>{{ streakDays }}</b> 天<template v-if="hasTodayDuration"> · 用时 {{ todayDurationText }}</template></div>
        </div>
      </div>
      <div class="daily-progress">
        <div class="daily-progress-bar">
          <div class="daily-progress-fill" :style="{ width: todayStats.accuracy + '%' }"></div>
        </div>
        <div class="daily-progress-label">今日正确率</div>
      </div>
    </div>

    <!-- 学习计划入口：有计划→进度卡；没有→创建入口。
         2026-09-25（rabbit 发现手机端没有按钮）：原先整块是 `v-if="studyPlan"`，而侧栏里也没有这一项、
         手机端侧栏还是抽屉 ⇒ **没计划的人全站找不到入口**（只能自己敲 #/study-plan）。 -->
    <div v-if="studyPlan" class="study-plan-card" @click="$router.push('/study-plan')">
      <div class="sp-left">
        <img class="sp-icon" src="/icons/plan.gif" alt="📋" />
        <div>
          <div class="sp-title">{{ studyPlan.name }}</div>
          <div class="sp-sub">今日目标：{{ studyPlan.dailyGoal }}题 · 已完成 {{ todayCompleted }}题</div>
        </div>
      </div>
      <div class="sp-progress">
        <div class="sp-progress-bar">
          <div class="sp-progress-fill" :style="{ width: todayProgress + '%' }"></div>
        </div>
        <div class="sp-progress-text">{{ todayProgress }}%</div>
      </div>
      <div class="sp-arrow">›</div>
    </div>
    <div v-else class="study-plan-card" @click="$router.push('/study-plan')">
      <div class="sp-left">
        <img class="sp-icon" src="/icons/plan.gif" alt="📋" />
        <div>
          <div class="sp-title">智能学习计划</div>
          <div class="sp-sub">按遗忘曲线安排复习 · 点此创建</div>
        </div>
      </div>
      <div class="sp-arrow">›</div>
    </div>

    <!-- 记忆复习入口（2026-08-23 新增） -->
    <div v-if="memoryDueCount >= 0" class="memory-entry-card" @click="$router.push('/memory-review')">
      <div class="me-left">
        <img src="/icons/study.gif" class="me-icon-img" alt="记忆复习" />
        <div>
          <div class="me-title">记忆复习</div>
          <div class="me-sub" v-if="memoryDueCount > 0">今日建议复习 <b>{{ memoryDueCount }}</b> 题<template v-if="memoryDeferredCount > 0"> · <span class="me-fast">{{ memoryDeferredCount }} 题顺延</span></template> · 健康度 {{ memoryHealth }}%</div>
          <div class="me-sub" v-else>今日无待复习，去刷题积累记忆</div>
          <div v-if="memoryDaysToExam !== null" class="me-exam">⏰ 距最近考试 <b>{{ memoryDaysToExam }}</b> 天，{{ memoryPhaseLabel }}节奏</div>
        </div>
      </div>
      <div class="me-right">
        <div v-if="memoryHealth > 0" class="me-health-wrap"><div class="me-health-fill" :style="{ width: memoryHealth + '%' }"></div></div>
        <div class="me-arrow">›</div>
      </div>
    </div>

    <div v-if="lastPractice" class="resume-card" @click="resumePractice">
      <div class="resume-info">
        <div class="resume-label">继续刷题</div>
        <div class="resume-title">{{ lastPractice.bank_name }}</div>
        <div class="resume-meta">第 {{ lastPractice.position }} / {{ lastPractice.total }} 题 · {{ formatTime(lastPractice.saved_at) }}</div>
      </div>
      <div class="resume-arrow">›</div>
    </div>

    <!-- 公共考试入口（新用户开箱即用） -->
    <div v-if="publicExams.length" class="public-exam-banner" @click="$router.push('/exams')">
      <div class="pe-left">
        <img class="pe-icon" src="/icons/exam.gif" alt="📝" />
        <div>
          <div class="pe-title">公共考试</div>
          <div class="pe-sub">{{ publicExams.length }} 场考试，点此直接开考</div>
        </div>
      </div>
      <div class="pe-arrow">›</div>
    </div>

    <!-- 2026-09-27 订阅模式：**订阅的公共题库** —— 与本地库并列（同属"我的题库"的实现），
         但它是**引用云端**（不复制题目、不占本机空间），点进去用同一套完整界面。
         操作集刻意与本地库一致（刷题/错题本/收藏/统计），但**不给**「导入题目/提交/删除」：
         订阅的是公共库，内容不可改；要退出就「取消订阅」。 -->
    <div v-if="subscribedBanks.length" class="subscribed-section">
      <div class="section-header">
        <h3>🌍 订阅的公共题库（{{ subscribedBanks.length }}）</h3>
        <span class="section-sub">在线引用 · 练习会记录错题与统计 · 不占用本机空间</span>
      </div>
      <div class="grid public-grid">
        <div v-for="b in subscribedBanks" :key="b._id" class="card public-card">
          <div class="card-header">
            <h3>{{ b.name }} <span class="vis-badge public">🌍</span></h3>
          </div>
          <div class="card-meta">
            <span v-if="b.creator_name" class="creator-pill">👤 {{ b.creator_name }}</span>
            <span class="count-pill">📝 {{ b.question_count || 0 }} 题</span>
          </div>
          <!-- 2026-09-28：订阅库的练习进度条（与本地库卡片同款式） -->
          <div v-if="subsProgress[String(b._id)]" class="progress-row">
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: subsPct(b) + '%' }"></div>
            </div>
            <div class="progress-text">
              已答 {{ subsProgress[String(b._id)].answered }} / {{ b.question_count || '?' }}<template v-if="subsProgress[String(b._id)].finished"> · 已完成</template>
            </div>
          </div>
          <div class="actions">
            <button class="primary-btn" @click="guardEnterPractice(b.mode === 'recite' ? `/recite/${b._id}?name=${encodeURIComponent(b.name)}` : `/practice/${b._id}?name=${encodeURIComponent(b.name)}`)">{{ b.mode === 'recite' ? '开始背题' : '开始刷题' }}</button>
            <div class="pub-actions-row">
              <button class="import-btn" @click.stop="$router.push(`/wrong/${b._id}`)">📕 错题本</button>
              <button class="import-btn" @click.stop="$router.push(`/favorites/${b._id}`)">⭐ 收藏</button>
            </div>
            <div class="pub-actions-row">
              <button class="import-btn" @click.stop="$router.push(`/stats/${b._id}`)">📊 统计</button>
              <button class="import-btn" @click.stop="onToggleSub(b)">✕ 取消订阅</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 公共题库区块（云端直读，无需同步/导入） -->
    <div v-if="publicBanks.length" class="public-section">
      <!-- 2026-09-23：旧题库沉底并默认折叠 -->
      <div v-if="oldBankCount" class="old-toggle" @click="showOldBanks = !showOldBanks">{{ showOldBanks ? '收起已归档' : `展开已归档 (${oldBankCount})` }}</div>
      <div class="section-header">
        <h3>🌍 公共题库</h3>
        <span class="section-sub">云端官方题库 · 可直接练习（未订阅时不写错题与统计）；订阅后享错题本 / 收藏 / 掌握度 / 统计</span>
      </div>
      <div class="grid public-grid">
        <div v-for="b in sortedBanks" :key="b._id" class="card public-card">
          <div class="card-header">
            <h3>
              {{ b.name }}
              <span class="vis-badge public">🌍</span>
            </h3>
          </div>
          <div class="card-meta">
            <span v-if="b.creator_name" class="creator-pill">👤 {{ b.creator_name }}</span>
            <span class="count-pill">📝 {{ b.question_count || 0 }} 题</span>
            <!-- 展开归档组时得让用户看懂它为什么沉在这儿：状态写在卡片上，不靠分组标题猜 -->
            <span v-if="b.archived === true" class="archived-pill">📦 已归档 · 不再更新</span>
          </div>
          <div class="actions">
            <!-- 2026-09-27 订阅模式：公共库用**完整练习界面**（bankRef 作字符串 id ⇒ api 层读云端、不落本地）。
                 未订阅只练不留痕；订阅后才记录错题/统计。
                 下方两个次要操作**并排一行**（订阅 / 添加到本地）—— 二者是不同需求，都要保留：
                   · 订阅     = 引用云端，省空间，在线读（离线用不了）
                   · 添加到本地 = 复制一份到本机，离线可用
                 ⚠️ 不再显示「✓ 已添加到我的题库」这类独立标记（会与订阅状态堆叠、语义打架）；
                    已导入状态改为由按钮自身文案表达。 -->
            <button class="primary-btn" @click="guardEnterPractice(b.mode === 'recite' ? `/recite/${b._id}?name=${encodeURIComponent(b.name)}` : `/practice/${b._id}?name=${encodeURIComponent(b.name)}`)">{{ b.mode === 'recite' ? '开始背题' : '开始刷题' }}</button>
            <!-- 2026-09-27：**背题库（计算题）不显示订阅与添加到本地** —— 计算题没有「对错」概念，
                 既不存在错题也没什么可订阅；整库内容只走在线读取（与下方提示一致）。 -->
            <div v-if="b.mode !== 'recite'" class="pub-actions-row">
              <button v-if="subs.includes(String(b._id))" class="import-btn" @click.stop="onToggleSub(b)">✓ 已订阅</button>
              <button v-else class="import-btn" @click.stop="onToggleSub(b)">☆ 订阅</button>
              <button class="import-btn" :disabled="importingId === b._id" @click.stop="importPublicBank(b)">
                <span v-if="importingId === b._id">导入中… {{ importProgress?.done }}/{{ importProgress?.total }}</span>
                <span v-else-if="isImported(b.name)">✓ 已添加到本地</span>
                <span v-else>＋ 添加到本地</span>
              </button>
            </div>
            <div v-if="b.mode === 'recite'" class="imported-tag">仅在线背题 · 不下载到本地</div>
            <div v-if="importingId === b._id && importProgress && importProgress.total" class="import-progress">
              <div class="import-bar"><div class="import-fill" :style="{ width: (importProgress.done / importProgress.total * 100) + '%' }"></div></div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="bankStore.loading" class="skeleton-grid">
      <div v-for="i in 3" :key="i" class="skeleton-card"></div>
    </div>
    <!-- 空状态：**本地库与订阅都为空**才算空 —— 否则订阅了库却显示"还没有题库"（2026-09-27） -->
    <div v-else-if="bankStore.banks.length === 0 && !subscribedBanks.length" class="empty">
      <img class="empty-icon" src="/icons/study.gif" alt="📚" />
      <p class="empty-title">还没有题库</p>
      <p class="empty-tip">点击右上角"新建题库"开始你的刷题之旅</p>
      <button class="empty-action" @click="showNew = true">+ 新建第一个题库</button>
    </div>
    <div v-else class="grid">
      <div v-for="b in bankStore.banks" :key="b.id" class="card" :class="{ 'has-progress': statsFor(b.id)?.practiced, 'open': openMenuId === b.id }">
        <div class="card-header">
          <h3>
            {{ b.name }}
            <span class="vis-badge" :class="b.visibility === 'private' ? 'private' : (b.visibility === 'pending' ? 'pending' : 'public')">
              {{ b.visibility === 'private' ? '🔒' : (b.visibility === 'pending' ? '⏳' : '🌍') }}
            </span>
          </h3>
          <button class="more-btn" @click.stop="toggleMenu(b.id)">⋯</button>
        </div>
        <div class="card-meta">
          <span v-if="b.creator_name" class="creator-pill">👤 {{ b.creator_name }}</span>
          <span class="count-pill">📝 {{ b.question_count }} 题</span>
          <span v-if="statsFor(b.id)" class="accuracy-pill" :class="accuracyClass(statsFor(b.id)!.accuracy)">
            ✓ {{ statsFor(b.id)!.accuracy }}%
          </span>
        </div>

        <!-- 进度条 -->
        <div v-if="statsFor(b.id)?.practiced" class="progress-row">
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: progressPct(b.id) + '%' }"></div>
          </div>
          <div class="progress-text">{{ statsFor(b.id)!.practiced }} / {{ b.question_count }}</div>
        </div>

        <div class="actions">
          <button class="primary-btn" @click="guardEnterPractice(`/practice/${b.id}`)">开始刷题</button>
        </div>

        <!-- 2026-09-25（rabbit）：「导入的副本能从公共题库更新」这件事原先只藏在 ⋯ 菜单里，很多人不知道 ⇒
             在卡片上给一条可点的提示。动作本身有兜底：公共库列表没加载出来时会 toast「找不到对应的公共题库」。
             更新只补解析／知识点／难度／配图，不动题面、作答进度、错题、收藏（见 updateFromPublicBank）。 -->
        <div v-if="isImportedCopy(b)" class="pub-sync-hint" @click.stop="updateFromPublicBank(b)">
          <span v-if="updatingId === b.id">🔄 更新中 {{ updateProgress?.done ?? 0 }}/{{ updateProgress?.total ?? 0 }}</span>
          <span v-else>🔄 本库来自公共题库 · 点此更新解析/知识点</span>
        </div>

        <div v-if="openMenuId === b.id" class="dropdown-menu" @click.stop>
          <button @click="$router.push(`/wrong/${b.id}`)">📕 错题本</button>
          <button @click="$router.push(`/favorites/${b.id}`)">⭐ 收藏夹</button>
          <button @click="$router.push(`/import/${b.id}`)">📥 导入题目</button>
          <!-- 2026-09-25（rabbit）：从公共题库导入到本地的副本**不给**「提交到公共题库」——内容本来就是
               公开的，再提交只会制造一份重复的待审核题库。判据 isImportedCopy：origin_ref（导入时写的
               本地标记，不依赖网络）优先，老副本才退回按题库名匹配。 -->
          <button v-if="!isImportedCopy(b) && b.visibility !== 'public' && b.visibility !== 'pending'" @click="submitForReview(b)">
            🌍 提交到公共题库（待审核）
          </button>
          <button v-else-if="b.visibility === 'pending'" disabled>⏳ 已提交，待管理员审核</button>
          <button v-if="isImportedCopy(b)" :disabled="updatingId === b.id" @click="updateFromPublicBank(b)">
            <span v-if="updatingId === b.id">🔄 更新中 {{ updateProgress?.done ?? 0 }}/{{ updateProgress?.total ?? 0 }}</span>
            <span v-else>🔄 从公共题库更新</span>
          </button>
          <button @click="exportBank(b)">📤 导出题库</button>
          <button class="danger" @click="del(b.id)">🗑 删除题库</button>
        </div>
      </div>
    </div>

    <!-- 免责声明（2026-09-07） -->
    <p class="site-disclaimer">本站为个人自用的非经营性学习工具，题库内容仅供个人学习交流参考；本站不向公众提供生成式人工智能服务（AI 功能需自行配置个人密钥）。</p>

    <!-- 备案标识：桌面在侧栏（App.vue），小屏侧栏是抽屉、不点开看不见，故在首页底部补一份 -->
    <div v-if="icpNumber || gaNumber" class="site-beian">
      <a v-if="icpNumber" class="beian-link" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">{{ icpNumber }}</a>
      <a v-if="gaNumber" class="beian-link" :href="gaLink" target="_blank" rel="noreferrer"><img src="/beian-icon.png" class="beian-icon" width="18" height="20" alt="公安备案" />{{ gaNumber }}</a>
    </div>

    <div v-if="showNew" class="modal" @click.self="showNew = false">
      <div class="modal-body">
        <h3>新建题库</h3>
        <input v-model="newName" placeholder="题库名称" @keyup.enter="create" />
        <input v-model="newCreator" placeholder="创建人（可选，显示在卡片上）" />
        <textarea v-model="newDesc" placeholder="描述（可选）"></textarea>
        <div class="vis-options">
          <label class="vis-option active">
            <span>🔒</span>
            <div>
              <div class="vis-name">自建题库（私人）</div>
              <div class="vis-desc">仅自己可见，默认私人。完成导入后可点题库卡片「提交到公共题库」申请公开（需管理员审核）</div>
            </div>
          </label>
        </div>
        <div class="modal-actions">
          <button @click="create">确定</button>
          <button @click="showNew = false">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useBankStore } from '../stores/bank'
import { api, toLocalDateStr, addDays } from '../utils/api'
import { listPublicBanks, listExams, listPublicBankQuestions, classifyQuestionType, judgeAnswerBool, type Exam } from '../lib/exam'
import { toastSuccess, toastError, toastInfo } from '../utils/toast'
import { recordVisit, getVisitStats } from '../lib/visit'
import { poemOfTheDay, todayLabel, type Poem } from '../lib/poems'
import { idb, normalizeTs } from '../lib/db'
import { formatDate } from '../lib/spaced-repetition'
import OnboardingTour from '../components/OnboardingTour.vue'
import { findSourceBank, isPublicCopy } from '../lib/bank-provenance'
import { formatDuration, hasDuration } from '../lib/duration'
import { shouldWarnOnEnter } from '../lib/sync-notice'

interface LastPractice {
  bank_id: number
  bank_name: string
  position: number
  total: number
  saved_at: string
}
interface Stats { total: number; practiced: number; correct: number; mastered: number; accuracy: number }
interface TodayStats { total: number; correct: number; accuracy: number; duration?: number }
// 2026-10-03：duration（当日练习时长，秒）是**可选字段**——本项上线前的历史行没有它。
interface DailyRecord { date: string; total: number; correct: number; duration?: number }

const router = useRouter()
const bankStore = useBankStore()
// 新手指引的显示开关（判定逻辑在 onMounted 的 bankStore.load 回调里）
const showTour = ref(false)
const showNew = ref(false)

// 备案标识：与 App.vue 侧栏那份同源（都只读 .env 注入值），改口径时两处一起改
const icpNumber = (import.meta.env.VITE_ICP_NUMBER as string) || ''
const gaNumber = (import.meta.env.VITE_GA_BEIAN_NUMBER as string) || ''
const gaLink = gaNumber
  ? `https://beian.mps.gov.cn/#/query/webSearch?code=${gaNumber.replace(/\D/g, "")}`
  : ''

// 云朵彩蛋欢迎条（在设置页连点云朵主题触发过彩蛋后，首页常显欢迎语）
const cloudEgg = (() => {
  try { return localStorage.getItem('cloud_egg_triggered') === '1' } catch { return false }
})()

// 2026-09-25（rabbit 开放给团队后要求）：**本机存储提醒**。
// 网页版的题库/进度/错题/收藏全在本机 IndexedDB —— 清缓存、换浏览器、换设备就没了。
// 只在「有数据 且 没配过云同步」时提示；判据直接读 cloudbase_config（避免把 cloud.ts 拉进首页 chunk）。
// 2026-10-04（rabbit）：原实现「点过『知道了』永久不再出现」对最该看它的人（一直点掉的人）失效，
// 改为**常驻**——「知道了」只收起当天，次日再现；换 v2 键让已点掉的老用户重新见到。
const CACHE_TIP_KEY = 'local_cache_tip_dismissed_v2'
const showCacheTip = ref(false)
// 2026-10-04：问候行用名字（纯网名）。同样直接读 localStorage，理由同上（不拉 cloud.ts 进首页 chunk）。
const myName = (() => {
  try { return String(localStorage.getItem('sync_nickname') || '兔子') } catch { return '兔子' }
})()
function todayStamp(): string {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}
function cloudConfigured(): boolean {
  try {
    const raw = localStorage.getItem('cloudbase_config')
    if (!raw) return false
    const cfg = JSON.parse(raw)
    return Boolean(cfg && cfg.enabled && cfg.envId)
  } catch { return false }
}
function updateCacheTip(): void {
  let dismissedToday = false
  try { dismissedToday = localStorage.getItem(CACHE_TIP_KEY) === todayStamp() } catch { /* 存储被禁：照常提示 */ }
  showCacheTip.value = !dismissedToday && bankStore.banks.length > 0 && !cloudConfigured()
}
function dismissCacheTip(): void {
  try { localStorage.setItem(CACHE_TIP_KEY, todayStamp()) } catch { /* ignore */ }
  showCacheTip.value = false
}
const newName = ref('')
const newDesc = ref('')
const newCreator = ref('')
const newVisibility = ref<'public' | 'private' | 'pending'>('private')
const lastPractice = ref<LastPractice | null>(null)
const openMenuId = ref<number | null>(null)
const bankStatsMap = ref<Map<number, Stats>>(new Map())
const todayStats = ref<TodayStats>({ total: 0, correct: 0, accuracy: 0 })
// 2026-10-03：当日练习时长。历史行/其它端写入的行可能没有 duration，一律按 0 兜底；
// 为 0 时整段不渲染（避免首页出现「用时 00:00:00」这种没信息量的噪声）。
const hasTodayDuration = computed(() => hasDuration(todayStats.value.duration))
const todayDurationText = computed(() => formatDuration(todayStats.value.duration))
const streakDays = ref(0)
const publicBanks = ref<any[]>([])

// 2026-09-23：题库列表排序——2026 新库在上，名字带 (旧) 的沉底并默认折叠。
const showOldBanks = ref(false)
// 折叠判据**只看云端的 archived 字段**（09-24 收敛）：名字正则 `/(旧)/` 已删除——
// 留着它等于两套真值，谁改了题库名就会突然从归档组浮回顶部。
// 6 个 (旧) 库与「变电运维教材」都已打 archived:true（脚本 set-bank-archived.cjs --all-legacy）。
// ⇒ 以后归档/取消归档只改云，零代码。
const isOldBank = (b: any) => b?.archived === true
const oldBankCount = computed(() => publicBanks.value.filter(isOldBank).length)
// 2026-09-27 订阅模式：「我的题库」= 本地库（实体）+ 订阅的公共库（引用）。
// 订阅只存 bankRef（settings.subscriptions），元数据（名称/题数）从已加载的公共库列表里取，
// **不复制题目**。点进去走 /practice/<bankRef>，与本地库用同一套完整界面。
const subscribedBanks = computed(() => {
  if (!subs.value.length) return []
  const set = new Set(subs.value.map(String))
  return publicBanks.value.filter((b: any) => set.has(String(b && b._id)))
})

// 2026-09-28（rabbit）：订阅库卡片也显示练习进度 —— 读 `practice_progress_<bankRef>`
// （订阅库的进度以 bankRef 为键；已答题数 = answer_states 的条目数）。
const subsProgress = ref<Record<string, { answered: number; total: number; finished: boolean }>>({})
async function loadSubsProgress () {
  const out: Record<string, { answered: number; total: number; finished: boolean }> = {}
  for (const b of subscribedBanks.value) {
    const ref_ = String(b && b._id)
    if (!ref_) continue
    try {
      const raw = await api.getSetting('practice_progress_' + ref_)
      if (!raw) continue
      const p = JSON.parse(raw)
      const answered = p && p.answer_states ? Object.keys(p.answer_states).length : 0
      if (!answered && !p?.finished) continue
      out[ref_] = { answered: answered || (Number(p?.order_ids?.length) || 0), total: Number(b.question_count) || 0, finished: !!p?.finished }
    } catch { /* 单库失败跳过 */ }
  }
  subsProgress.value = out
}
// ⚠️ 2026-09-28 白屏事故（发生两次）的定论：**Vue 的 `watch(source, cb)` 即使不 immediate，
// 注册时也会对 source 求值一次**（取初值用于比对）⇒ watch 的**注册位置**同样受 TDZ 约束。
// 本文件 `subs` 的声明在本块之后，故这里**不能**用 watch —— 进度刷新改由 `loadSubs()` 完成时显式调用。
function subsPct (b: any): number {
  const x = subsProgress.value[String(b && b._id)]
  if (!x || !x.total) return 0
  return Math.min(100, Math.round((x.answered / x.total) * 100))
}

const sortedBanks = computed(() => {
  const arr = [...publicBanks.value].sort((a: any, b: any) => {
    const ao = isOldBank(a) ? 1 : 0
    const bo = isOldBank(b) ? 1 : 0
    if (ao !== bo) return ao - bo
    return String(b?.created_at || '').localeCompare(String(a?.created_at || ''))
  })
  return showOldBanks.value ? arr : arr.filter((b: any) => !isOldBank(b))
})
const publicExams = ref<Exam[]>([])
const importingId = ref<string | null>(null)
const importProgress = ref<{ done: number; total: number } | null>(null)

// 2026-09-27 订阅模式：订阅列表（存 settings，跨端一致）。订阅 = 引用公共题库，**不复制题目**。
// 订阅后：① 出现在「我的题库」② 练习时记错题/统计。未订阅也可用完整界面练，但只练不留痕。
const subs = ref<string[]>([])
async function loadSubs () {
  try { subs.value = await api.listSubscriptions() } catch { subs.value = [] }
  // 2026-09-28：订阅列表就绪 → 刷新订阅卡进度（原先靠 watch，因 TDZ 白屏事故改为显式调用；
  // 此处已过 await，模块顶层同步代码必然全部执行完，`subs` 早已初始化，无 TDZ 风险）
  loadSubsProgress()
}
loadSubs()

// 跨库聚合入口上的计数（本地 IndexedDB 整表读，量级小；失败就只显示按钮不显示数字）
const recordCounts = ref({ wrong: 0, fav: 0 })
async function loadRecordCounts () {
  try {
    const [w, f] = await Promise.all([api.listAllWrongRecords(), api.listAllFavorites()])
    recordCounts.value = { wrong: (w || []).length, fav: (f || []).length }
  } catch { /* 计数拿不到不影响首页 */ }
}
loadRecordCounts()

// 2026-10-07（rabbit）：首页**同步状态胶囊**。此前首次打开页面时云同步静默启动（App.vue 挂载后 4 秒），
// 用户看不到任何信号就点进题库开答——拉取还没回来时页面数据可能是旧的；同步完成后首页也不会更新
// （数据只在 onMounted 装载一次），表现为「必须手动刷新或切页才显示同步后的信息」。
// 现在：四态胶囊（未同步/同步中/已同步 HH:MM/失败可点重试）+ 3 秒轮询内存态；
// 捕捉「同步中→已完成」转变 → 自动重跑首页数据；点胶囊 = 立即全量双向同步（syncAll）。
type HomeSyncState = { state: 'idle' | 'syncing' | 'ok' | 'fail'; at: number; msg?: string }
const syncEnabled = ref(cloudConfigured())
const homeSync = ref<HomeSyncState>({ state: 'idle', at: 0 })
// 上次成功**拉取**的时刻（0 = 还没成功拉过）。首页重跑与进库守卫以它为真值。
const homeSyncAt = ref(0)
// 2026-10-09：胶囊**显示**专用的「最近一次同步成功」（任向，含上传；与小程序同口径）。
// 判事（进库守卫、数据重跑）仍走 homeSyncAt（拉取口径）——两把钥匙别混。
const homeSyncOkAt = ref(0)
// 状态符（2026-10-07 晚，rabbit：「云哪去了，是不是不能加原来的云」）：☁ 常驻在场，
// 状态用随行小符 + 动效表达——同步中 ↻ 转、完成 ✓ 轻弹、失败 !、未开启/待同步只有云（靠颜色区分）
const homeSyncMark = computed(() => {
  if (!syncEnabled.value) return ''
  const s = homeSync.value
  if (s.state === 'syncing') return '↻'
  if (s.state === 'fail') return '!'
  if (s.state === 'ok') return '✓'
  return ''
})
// 完成轻弹：只在「转变为 ok」那一刻挂 500ms（首次装载时已是 ok 不弹）
const justSynced = ref(false)
let justSyncedTimer: number | null = null
function markJustSynced() {
  justSynced.value = true
  if (justSyncedTimer) window.clearTimeout(justSyncedTimer)
  justSyncedTimer = window.setTimeout(() => { justSynced.value = false }, 500)
}
const homeSyncText = computed(() => {
  if (!syncEnabled.value) return '云同步未开启'
  const s = homeSync.value
  if (s.state === 'syncing') return '同步中…'
  if (s.state === 'fail') return '同步失败 · 点重试'
  // 2026-10-09：显示取「最近一次同步成功」（任向，含上传）——不再只认拉取时刻，
  // 否则答题时那次次的轻推成功都不动时间，看起来像"没同步"。判事口径见 homeSyncAt/homeSyncOkAt 声明处。
  const okAt = homeSyncOkAt.value
  if (!okAt) return '未同步 · 点一下同步'
  const d = new Date(okAt)
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `已同步 ${p2(d.getHours())}:${p2(d.getMinutes())}`
})
// 动态 import（首页 chunk 刻意不静态引 cloud.ts，见上方 cloudConfigured 注释）；只取一次，与 App.vue 那份同一实例
let homeCloudMod: Promise<typeof import('../lib/cloud')> | null = null
function getHomeCloudMod() {
  if (!homeCloudMod) homeCloudMod = import('../lib/cloud')
  return homeCloudMod
}
// 同步完成后的数据重跑：只重跑「会被云同步改变」的面；**不**重跑 recordVisit（防重复计数）/
// 每日一诗 / 新手指引 / 空公共壳清理（后者是破坏性动作，只留在 onMounted 首次装载）。
let refreshAfterSyncBusy = false
async function refreshAfterSync() {
  if (refreshAfterSyncBusy) return
  refreshAfterSyncBusy = true
  try {
    await Promise.allSettled([
      loadPublicData(),
      loadStudyPlan(),
      loadMemoryReviewStats(),
      loadSubs(),
      loadRecordCounts(),
      bankStore.load().then(() => loadBankStatsAndTip()),
    ])
    await loadTodayAndLast()
  } finally { refreshAfterSyncBusy = false }
}
let homeSyncBusy = false
async function doHomeSync() {
  if (!syncEnabled.value) { router.push('/settings'); return }
  if (homeSyncBusy) return
  homeSyncBusy = true
  try {
    const m = await getHomeCloudMod()
    // 已有一轮在跑（如 App.vue 打开自动同步）：不叠加请求，只提示等待，完成时轮询会接住转变
    if (m.getWebSyncStatus().state === 'syncing') { toastInfo('云同步正在进行，稍等几秒'); return }
    homeSync.value = { state: 'syncing', at: Date.now() }
    await m.syncAll()
    const st = m.getWebSyncStatus()
    if (st.state === 'fail') {
      homeSync.value = { state: 'fail', at: st.at || Date.now(), msg: st.msg }
      toastError('同步失败：' + (st.msg || '网络或云端异常') + '，可点胶囊重试')
    } else {
      homeSync.value = { state: 'ok', at: st.at || Date.now() }
      markJustSynced()
      // 本函数自己拉过了（syncAll 先推后拉）：把这笔记成已重跑，免得轮询再触发一次
      lastReloadedPullAt = m.getLastPullAt()
      homeSyncAt.value = lastReloadedPullAt
      toastSuccess('云同步完成')
      await refreshAfterSync()
    }
  } catch (e: any) {
    homeSync.value = { state: 'fail', at: Date.now(), msg: (e && e.message) || String(e) }
    toastError('同步失败：' + homeSync.value.msg)
  } finally { homeSyncBusy = false }
}
// 3 秒轮询：刷新四态；捕捉「真实拉取完成」→ 自动重跑首页数据（覆盖 App.vue 那次打开自动同步）。
// 2026-10-07 修正判定基准：此前看 `at`（任何状态变更，含只推不拉的轻推）⇒ 推完一条进度就重跑首页
// （白跑），且胶囊会显示「已同步」而本机并没有拿到云端最新。现在以「上次成功**拉取**」为准。
const homeMountedAt = Date.now()
let lastPullAt = 0            // 云端最后一次成功拉取的时刻（来自 cloud.ts）
let lastReloadedPullAt = 0    // 本地已据此重跑过首页数据的那次拉取（防重复重跑）
// 2026-10-09：原先这里缓存了 homePullBusy（拉取在飞），供进库 toast 用。
// 现已改为在 guardEnterPractice 里**点击那一刻现读**（冷启动前 3 秒轮询还没跑过，缓存值一律是假的）
// ⇒ 这个缓存变量连同 autoPullDueNow 一并撤掉，只留一个真值来源（cloud 模块本身）。
let syncPollTimer: number | null = null
function pollHomeSync() {
  syncEnabled.value = cloudConfigured()
  getHomeCloudMod().then(m => {
    const s = m.getWebSyncStatus()
    const prevState = homeSync.value.state
    homeSync.value = { state: s.state, at: s.at, msg: s.msg }
    // 2026-10-07（rabbit 事故 #2）：上次成功**拉取**的时刻才是「本机数据有多新」的真值。
    // 原先用 `s.at`（任何状态变更，含只推不拉的轻推）⇒ 推完一条进度就重跑一次首页数据（白跑），
    // 且胶囊会显示「已同步」而本机其实没拿到云端最新。现在文案与重跑都以 pullAt 为准。
    lastPullAt = m.getLastPullAt()
    homeSyncAt.value = lastPullAt
    homeSyncOkAt.value = m.getLastSyncOkAt()
    if (prevState !== 'ok' && s.state === 'ok') markJustSynced()
    if (lastPullAt && lastPullAt !== lastReloadedPullAt) {
      lastReloadedPullAt = lastPullAt
      if (lastPullAt >= homeMountedAt && !homeSyncBusy) void refreshAfterSync()
    }
  }).catch(() => { /* cloud 模块加载失败：保持原状态 */ })
}
// 可能读不到上次进度时进库：给一句明确警示（2026-10-07 02:10 事故——恢复未就绪时进库会把续练位写退到第 1 题）。
// 仍不拦（进度守卫 + 未就绪闸门兜底），但必须让人知道。
// 2026-10-07：判据与练习页横幅统一（shouldWarnOnEnter）——原先只看 `state === 'syncing'`，
// 而点题库那一刻同步早已跑完或压根没跑 ⇒ **这条 toast 从来没弹过**。现在改成「本机可能不是最新的」。
// 另加本次进页面只提示一次，避免每次点题库都冒一句。
// 2026-10-08：未配云不提示（syncEnabled 由 3s 轮询现刷；没配云＝判据里「从未成功同步」恒真、纯添乱；
// 与 mp「未打通不提示」对齐）。
// 2026-10-09（rabbit：真实路径就是开页面直接点进题库）：判定依据**必须在点击那一刻现取**，
//   不能等 3 秒轮询——冷启动首 3 秒里 homeSyncAt 还是 0（内存口径刷新即归零），
//   那会被判成「从没成功同步过」⇒ 近期刚同步过也照弹 toast。
//   故本函数改为 async：等 cloud 模块（已缓存则只是微任务）后**现读**四个信号；取不到就不提示、不拦路。
//   注意：这里刻意不静态 import cloud（首页 chunk 保持轻），所以只能等动态 import。
let enterToastOnce = false
async function guardEnterPractice (url: string) {
  if (syncEnabled.value && !enterToastOnce) {
    try {
      const m = await getHomeCloudMod()
      const s = m.getWebSyncStatus()
      // 「有没有成功拉取记录」以**持久化**的拉取时刻为准（内存 state 刷新即归零，判不出"刚同步过"）
      const lastPull = m.getLastPullAt()
      const hasSynced = lastPull > 0
      homeSyncAt.value = lastPull          // 顺手把守卫判据的真值刷新（别让它在冷启动那几秒说谎）
      homeSyncOkAt.value = m.getLastSyncOkAt()   // 胶囊显示用的「最近一次同步成功」一并现读
      if (shouldWarnOnEnter({
        synced: hasSynced,
        // 2026-10-07：给「本机有多新」判定的是**上次成功拉取**的时刻，不是上次状态变更（只推不拉也算）。
        lastOkAt: hasSynced ? lastPull : 0,
        lastFail: s.state === 'fail',
        // 2026-10-07：同上 —— 用精确的「拉取在飞」，别拿全局锁状态（轻推也算 busy）误报成"正在下载"。
        pullBusy: m.isPullInFlight(),
        // 2026-10-09：本轮会不会自动拉（不会 ⇒ 本机大概率刚拉过，不必抱怨；真陈旧则照报）
        autoPullDue: await m.autoPullDueOnOpen(),
        now: Date.now(),
      })) {
        enterToastOnce = true
        toastInfo('云同步还没完成：现在进去可能读不到上次进度，建议稍等几秒再进')
      }
    } catch { /* 判定依据取不到就不提示（宁可少说，不可多说），导航照走 */ }
  }
  router.push(url)
}

async function onToggleSub (b: any) {
  const bankRef = String((b && b._id) || '')
  if (!bankRef) return
  try {
    const nowOn = await api.toggleSubscription(bankRef)
    await loadSubs()
    if (nowOn) toastSuccess(`已订阅「${b.name}」：练习会记录错题与统计`)
    else toastSuccess(`已取消订阅「${b.name}」：练习将不再留痕`)
  } catch (e: any) {
    toastError('订阅操作失败：' + (e?.message || String(e)))
  }
}
// 「从公共题库更新」的进度（2026-09-24）
const updatingId = ref<number | null>(null)
const updateProgress = ref<{ done: number; total: number } | null>(null)
const visitStats = ref<{ total: number; today: number } | null>(null)
const dailyPoem = ref<Poem | null>(null)
const todayText = ref('')
const studyPlan = ref<any>(null)
const todayCompleted = ref(0)
const todayProgress = ref(0)
// 2026-08-23：记忆复习入口数据（今日待复习数 + 记忆健康度）；初始 -1 表示未加载
const memoryDueCount = ref(-1)
const memoryHealth = ref(0)
// 2026-08-23 防堆积：超出每日配额、顺延到后天的到期题数
const memoryDeferredCount = ref(0)
// 2026-08-23：备考驱动——距最近考试天数（null=未设考试日期）
const memoryDaysToExam = ref<number | null>(null)
// 距考阶段标签（用于首页卡片提示）
const memoryPhaseLabel = computed(() => {
  const d = memoryDaysToExam.value
  if (d === null) return ''
  if (d <= 3) return '冲刺极限'
  if (d <= 8) return '冲刺加量'
  if (d <= 30) return '加量复习'
  return '常规'
})

const totalQuestions = computed(() => bankStore.banks.reduce((s, b) => s + b.question_count, 0))
// 已掌握 = 错题本里标记「已掌握」的真实数量（2026-08-15 修复：此前用已练习数近似）
const totalMastered = computed(() => {
  let m = 0
  for (const s of bankStatsMap.value.values()) m += s.mastered || 0
  return m
})

function toggleMenu(id: number) {
  openMenuId.value = openMenuId.value === id ? null : id
}
function closeMenu() { openMenuId.value = null }

function statsFor(id: number): Stats | undefined {
  return bankStatsMap.value.get(id)
}

// 是否已导入到本地（按题库名匹配；公共题库与本地题库同名即视为已导入）
function isImported(name: string): boolean {
  return bankStore.banks.some(x => x.name === name)
}

function progressPct(id: number): number {
  const b = bankStore.banks.find(x => x.id === id)
  const s = bankStatsMap.value.get(id)
  if (!b || !s || b.question_count === 0) return 0
  return Math.min(100, Math.round((s.practiced / b.question_count) * 100))
}

function accuracyClass(accuracy: number): string {
  if (accuracy >= 80) return 'high'
  if (accuracy >= 60) return 'mid'
  return 'low'
}

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 2026-08-21 修复：此前在 onMounted 里注册匿名函数、onBeforeUnmount 里移除 closeMenu，
// removeEventListener 永远匹配不上 → 每次进出首页泄漏监听器。提升到 setup 顶层，注册/移除用同一函数。
// 手机端 click 事件可能不冒泡到 document（尤其微信内置浏览器），加 touchstart 兼容
// 2026-08-16 修复：touchstart 无差别 closeMenu 会在手机端吞掉菜单按钮的 click——
// touchstart 先冒泡关菜单 → v-if 卸载菜单 DOM → 按钮 click 不再触发 → 删除/导出/跳转全没反应。
// 现在点击目标在菜单 / ⋮ 按钮内部时不关闭。
const inMenu = (e: Event): boolean => {
  const t = e.target as HTMLElement | null
  return !!t && !!t.closest && !!t.closest('.dropdown-menu, .more-btn')
}
const onDocClick = (e: Event) => { if (!inMenu(e)) closeMenu() }

// 加载学习计划
async function loadStudyPlan() {
  try {
    const plans = await idb.listPlans()
    if (plans.length > 0) {
      studyPlan.value = plans[0]
      // 计算今日完成情况
      const today = formatDate(new Date())
      const stored = localStorage.getItem(`completed_${studyPlan.value.id}_${today}`)
      const completed = stored ? JSON.parse(stored) : []
      todayCompleted.value = completed.length
      // 2026-08-22 修复：进度分母用「今日任务总数」（StudyPlanView 落盘 task_total_*），
      // 此前用 dailyGoal 导致任务 10 题/目标 50 题时进度只显示 20%，与计划页口径不一致
      const taskTotalRaw = localStorage.getItem(`task_total_${studyPlan.value.id}_${today}`)
      const taskTotal = taskTotalRaw ? parseInt(taskTotalRaw, 10) : 0
      const denominator = taskTotal > 0 ? taskTotal : (studyPlan.value.dailyGoal || 1)
      todayProgress.value = Math.min(100, Math.round((completed.length / denominator) * 100))
    }
  } catch (e) {
    console.error('加载学习计划失败：', e)
  }
}

// 2026-08-23：加载记忆复习入口数据（今日待复习数 + 记忆健康度）
// 用全量题目 + 复习记录在本地计算，失败静默不影响首页
// 2026-08-23 防堆积：卡片显示「今日份（配额内）」而非全量到期；超过配额记为顺延数
async function loadMemoryReviewStats() {
  try {
    const { idb } = await import('../lib/db')
    const { getMemoryStrength, strengthLevel, calculateDailyReviewCap, calculateDaysToExam, toReviewTs } = await import('../lib/spaced-repetition')
    const allQ = await idb.listAll('questions')
    const allRev = await idb.listAll('review_records')
    // 每题取最新记录
    const revMap = new Map<number, any>()
    for (const r of allRev) {
      if (r.question_id == null) continue
      const ex = revMap.get(r.question_id)
      // T10b（2026-09-15）修复：原为 `String(r.last_review) > String(ex.last_review)` 的字符串比较。
      // last_review 是混合类型（网页端 ISO 串 / 小程序端纪元数字，restoreBackup 会让 ISO 行回流），
      // 字典序下 `"2026-…" > "1789…"` 恒成立 ⇒ 会把历史 ISO 记录无条件当成「最新」。
      // 统一走 normalizeTs 归一后比较（不统一存储类型）。
      if (!ex || normalizeTs(r.last_review) > normalizeTs(ex.last_review)) revMap.set(r.question_id, r)
    }
    // 每日复习配额（联动学习计划，至少 50 保底）+ 距考天数动态
    const plans = await idb.listPlans()
    const cap = calculateDailyReviewCap(plans)
    const examDates = plans.map(p => p.examDate).filter((d): d is string => !!d).sort()
    memoryDaysToExam.value = calculateDaysToExam(examDates[0] || null)
    // 今日到期数（全量）+ 健康度（有记录题目的平均权重分）
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999)
    let allDue = 0, score = 0, tracked = 0
    for (const q of allQ) {
      const r = revMap.get(q.id)
      if (!r) continue
      tracked++
      const strength = getMemoryStrength(r.ease_factor ?? 2.5, r.interval ?? 0)
      const lvl = strengthLevel(strength)
      if (lvl === '强') score += 1
      else if (lvl === '中') score += 0.6
      else score += 0.3
      // 2026-09-15 修复(P1-21)：next_review 现在是纪元毫秒数字，历史数据仍是 ISO 串，一律走 toReviewTs
      //（对历史 ISO 串产出与 new Date(v).getTime() 完全相同的数字，首页到期数不会漂移）。
      // 三个分支与修复前逐条对应，不合并；下面既有的 `!Number.isNaN(next)` 守卫继续负责跳过损坏值。
      const nextTs = r.next_review ? toReviewTs(r.next_review) : null
      const lastTs = r.last_review ? toReviewTs(r.last_review) : null
      const next = r.next_review
        ? (nextTs === null ? NaN : nextTs)
        : (r.last_review ? (lastTs === null ? NaN : lastTs) + (r.interval ?? 0) * 86400000 : 0)
      if (!Number.isNaN(next) && next <= todayEnd.getTime()) allDue++
    }
    // 今日份 = 全量到期但截断在配额内；超出记为顺延
    memoryDueCount.value = Math.min(allDue, cap)
    memoryDeferredCount.value = Math.max(0, allDue - cap)
    memoryHealth.value = tracked > 0 ? Math.round((score / tracked) * 100) : 0
  } catch (e) {
    console.error('加载记忆复习统计失败：', e)
  }
}

// 题库统计 + 本机存储提醒（onMounted 与同步完成后的自动刷新共用）。
// 返回 statsOk：只有统计**确实成功**的库才可能被判空壳（2026-09-15 修复 P2-13）。
async function loadBankStatsAndTip(): Promise<Set<number>> {
  const statsOk = new Set<number>()
  await Promise.all(bankStore.banks.map(async b => {
    try {
      const s = await api.bankStats(b.id)
      bankStatsMap.value.set(b.id, { ...s, accuracy: s.practiced > 0 ? Math.min(100, Math.round((s.correct / s.practiced) * 100)) : 0 })
      statsOk.add(b.id)
    } catch { /* ignore */ }
  }))
  // 题库加载完才知道「有没有数据可丢」——本机存储提醒在这里判一次
  updateCacheTip()
  return statsOk
}

// 今日统计 / 连续天数 / 最近练习（onMounted 与同步完成后的自动刷新共用）
async function loadTodayAndLast() {
  // 计算今日统计 & 连续天数
  try {
    const raw = await api.getSetting('daily_records')
    const records: DailyRecord[] = raw ? JSON.parse(raw) : []
    const today = todayISO()
    const todayRec = records.find(r => r.date === today)
    if (todayRec) {
      todayStats.value = {
        total: todayRec.total,
        correct: todayRec.correct,
        accuracy: todayRec.total > 0 ? Math.round((todayRec.correct / todayRec.total) * 100) : 0,
        duration: Number(todayRec.duration) || 0,
      }
    }
    // 连续天数：从今天往回数，每天都有记录
    let streak = 0
    const sorted = [...records].sort((a, b) => b.date.localeCompare(a.date))
    let cursor = toLocalDateStr(new Date())
    for (const r of sorted) {
      if (r.date === cursor && r.total > 0) {
        streak++
        cursor = addDays(cursor, -1)
      } else if (r.date < cursor) {
        break
      }
    }
    streakDays.value = streak
  } catch (e) { console.error('加载每日统计失败：', e) }
  // 加载最近练习记录
  try {
    const raw = await api.getSetting('last_practice')
    if (raw) {
      const parsed = JSON.parse(raw) as LastPractice
      if (parsed && typeof parsed.bank_id === 'number' && bankStore.banks.some(b => b.id === parsed.bank_id)) {
        lastPractice.value = parsed
      }
    }
  } catch (e) { console.error('加载最近练习记录失败：', e) }
}

onMounted(async () => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('touchstart', onDocClick, { passive: true })
  // 2026-10-07：同步胶囊 3 秒轮询（转换检测 + 自动重跑，见 pollHomeSync）
  syncPollTimer = window.setInterval(pollHomeSync, 3000)
  // 并行加载：本地题库 + 云端公共数据 + 学习计划（公共部分失败不影响本地使用）
  await Promise.allSettled([
    loadPublicData(),
    loadStudyPlan(),
    loadMemoryReviewStats(),
    bankStore.load().then(async () => {
      // 2026-09-28：新手指引——新用户（无标记 + 没题库 + 没配云同步）首开弹一次
      if (!localStorage.getItem('shuati-tour-done-v1') && bankStore.banks.length === 0 && !cloudConfigured()) {
        setTimeout(() => { showTour.value = true }, 600)
      }
      // 加载每个题库统计（提取成函数：同步完成后的自动刷新也走它）
      const statsOk = await loadBankStatsAndTip()
      // 2026-08-23：清理「我的题库」里的空公共壳（cloud_shared=true 且 0 题）。
      // 这类题库是早期同步误拉进来的公共题库空壳（公共题目不进本地缓存），仅占位无内容，
      // 且公共题库现在是云端直读（listPublicBanks），本地无需保留。删除仅限本地，不影响云端公共数据。
      // 2026-09-15 修复(P2-13)：原实现把「统计失败」当「统计为 0」——bankStats 抛错时该库不在
      // map 里，`?? 0` 判空成立 ⇒ 一次统计读取失败就能让有数据的 cloud_shared 题库在每次访问
      // 首页时被无确认删除。破坏性决定不能由可能缺失的证据驱动：只删「统计确实成功且为 0」的库，
      // 且删除前再用 idb 直接数一次。
      // ⚠️ 两处措辞由复审 MF-3 更正（原先写错了，别照抄回去）：
      //   ① 不是「网络抖动」——`api.bankStats` 全链路只读本地 IndexedDB
      //      （`src/utils/api.ts:203` → `src/lib/db.ts:594` 的 listQuestions + practice_records 索引），
      //      不触网。能抛的是 IDB 自身的问题（事务错误、配额、库被关闭/版本升级中）。
      //   ② 复核**不是**「另一个更可信的数据源」：`total` 本来就等于 `listQuestions(bankId).length`
      //      （`db.ts:595` + `:616`），与被调的 listQuestions 同源。复核的实际价值只有两条——
      //      在**执行删除的那一刻**重新读一次（防 bankStatsMap 是本轮早先算的、期间题目被加回来了），
      //      以及绕开 `bankStatsMap` 这层缓存。复审据此指出：只有「统计与删除之间发生了写入」
      //      这一种情形能被它拦住，同源失真它拦不住。
      //
      // 2026-09-24（**随「删掉别再回来」一起收口**）：判据补 `visibility === 'public'`。
      //   这段清理的原文承诺是「删除仅限本地，不影响云端公共数据」，可 `cloud_shared` 这个代用判据
      //   对**私人题库也是 true**（writeLocal 拉下来的每一行都标 cloud_shared）⇒ 它其实会删掉
      //   「自己建的、还没加题的私人题库」。此前删了也就本地少一行（云端那份还在，下次同步再拉回来）；
      //   现在删除会随上传落到云端 + 进删除账本，等于把一次静默的本地清理升级成**永久删云端**。
      //   口径回到它原本要清的「空公共壳」：只有 visibility=public 的才算（那类文档客户端本就无权删，
      //   云端删除会被 ACL 拒掉，账本也不影响——公共题库的拉取本来就被 pullCollection 跳过）。
      const emptyPublicShells = bankStore.banks.filter(b => b.cloud_shared && b.visibility === 'public' && statsOk.has(b.id) && bankStatsMap.value.get(b.id)?.total === 0)
      for (const shell of emptyPublicShells) {
        try {
          const localCount = (await idb.listQuestions(shell.id)).length
          if (localCount > 0) {
            console.warn('[云同步] 跳过清理：本地仍有', localCount, '道题，统计口径可能失真：', shell.name)
            continue
          }
          await bankStore.remove(shell.id)
          console.info('[云同步] 已清理空公共题库壳：', shell.name)
        } catch (e) { console.warn('清理空公共题库壳失败：', shell.name, e) }
      }
    }),
  ])
  await loadTodayAndLast()
  // 访问统计（累计/今日）；失败静默，不影响首页
  try {
    await recordVisit()
    const s = await getVisitStats()
    if (s) visitStats.value = s
  } catch { /* 统计失败不影响首页 */ }
  // 每日一诗（按日期确定性取一首，当天稳定）
  try { dailyPoem.value = poemOfTheDay(); todayText.value = todayLabel() } catch { /* 不影响首页 */ }
})

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch { return '' }
}

// 加载云端公共数据（公共题库 + 公共考试）；任何失败都静默，不影响首页
async function loadPublicData() {
  try {
    const [banks, exams] = await Promise.allSettled([listPublicBanks(), listExams()])
    if (banks.status === 'fulfilled') {
      // 按题目数降序，过滤 0 题题库
      publicBanks.value = (banks.value || [])
        .filter(b => (b.question_count || 0) > 0)
        .sort((a, b) => (b.question_count || 0) - (a.question_count || 0))
      // 🔴 2026-09-29：订阅卡的进度条必须**在这里**再算一次。
      // `loadSubs()` 是 setup 阶段调用（早于 onMounted），那一刻 `subscribedBanks` 还是空的
      // （它 = publicBanks ∩ subs，而 publicBanks 要等这次云端请求回来）⇒ 进度 map 恒为空
      // ⇒ 订阅卡永远没有进度条（rabbit 报的「已订阅卡片缺进度条」就是这么来的）。
      // 两处都调：谁后完成都能把进度补上（不做 watch —— 见本文件 TDZ 白屏事故的注释）。
      loadSubsProgress()
    }
    if (exams.status === 'fulfilled') {
      publicExams.value = (exams.value || []).filter(e => e.visibility !== 'private' && (e.questions?.length || 0) > 0)
    }
  } catch { /* 公共数据加载失败不影响首页 */ }
}

function resumePractice() {
  if (lastPractice.value) guardEnterPractice(`/practice/${lastPractice.value.bank_id}`)
}

// 判据本体搬去 lib/bank-provenance.ts（纯函数、可离线直测，见 tests/bank-provenance.test.cjs）：
// 这里只把「当前已加载的公共库列表」喂进去。2026-09-28 起两件事分开：
//   · sourceOf = 定位内容来源（origin_ref 精确 → 名字兜底），只用于「取内容」；
//   · isImportedCopy = 决定要不要给入口（🔴 名字兜底**排除 visibility='public' 的文件导入库**，
//     否则一份恰好与公共库同名的自建库会被认成副本，卡片谎称来源、更新还会把公共库的解析写进它）。
function sourceOf(b: any): any | null {
  return findSourceBank(b, publicBanks.value)
}

function isImportedCopy(b: any): boolean {
  return isPublicCopy(b, publicBanks.value)
}

// 「从公共题库更新」：只补题库给的内容字段（解析／知识点／难度／配图）。
// 刻意**不碰** stem/options/answer —— 那几项用户可能自己改过，覆盖了就找不回来。
async function updateFromPublicBank(b: any) {
  if (updatingId.value) return
  const src = sourceOf(b)
  if (!src) { toastError('找不到对应的公共题库，无法更新'); return }
  if (!confirm(`从「${src.name}」更新内容？\n会补齐解析／知识点／难度／配图；不动你的作答进度、错题、收藏。`)) return
  updatingId.value = b.id
  try {
    const pub = await listPublicBankQuestions(src._id)
    const local = await api.listQuestions(b.id)
    if (!pub.length || !local.length) { toastError('没有可更新的题目'); return }
    updateProgress.value = { done: 0, total: local.length }
    const byIdx = new Map<number, any>()
    for (const q of pub) if (typeof q.source_index === 'number') byIdx.set(q.source_index, q)
    let changed = 0, missing = 0
    for (let i = 0; i < local.length; i++) {
      const lq: any = local[i]
      const pq: any = (typeof lq.source_index === 'number' ? byIdx.get(lq.source_index) : undefined) || pub[i]
      if (!pq) { missing++; continue }
      const next = {
        // 一律用 `||` 而不是 `??`：公共库那道题若还没有解析（空串），要把本地已有的留着，
        // 不能被空串覆盖掉。其余字段同理。
        analysis: pq.analysis || lq.analysis || '',
        knowledge: pq.knowledge || lq.knowledge || '',
        difficulty: pq.difficulty || lq.difficulty || '',
        difficulty_why: pq.difficulty_why || lq.difficulty_why || '',
        // 09-24：A 类存疑题的标记也要跟着更新，否则公共库打了标、本地副本永远是哑的
        answer_conflict: pq.answer_conflict || lq.answer_conflict || '',
        answer_conflict_note: pq.answer_conflict_note || lq.answer_conflict_note || '',
        images: (Array.isArray(pq.images) && pq.images.length) ? pq.images : (lq.images || []),
      }
      const same = ['analysis', 'knowledge', 'difficulty', 'difficulty_why', 'answer_conflict', 'answer_conflict_note']
        .every(k => String(lq[k] ?? '') === String(next[k as keyof typeof next] ?? ''))
        && JSON.stringify(lq.images || []) === JSON.stringify(next.images)
      if (same) continue
      await api.updateQuestion({ ...lq, ...next })
      changed++
      updateProgress.value = { done: changed, total: local.length }
    }
    toastSuccess(`已更新「${b.name}」：${changed} 题补齐${missing ? `，${missing} 题没匹配上` : ''}`)
  } catch (e) {
    toastError('更新失败：' + (e instanceof Error ? e.message : String(e)))
  } finally {
    updatingId.value = null
    updateProgress.value = null
  }
}

async function importPublicBank(b: any) {
  if (importingId.value) return
  // 背题模式的库（计算题）不提供本地副本，按钮已隐藏，这里再拦一道防异常路径
  if (b?.mode === 'recite') {
    toastError('该题库仅支持在线背题，不下载到本地')
    return
  }
  // 2026-08-21：按钮已 v-else 隐藏，这里再拦一道防止异常路径重复导入建副本
  if (isImported(b.name)) {
    toastError(`「${b.name}」已在你的题库中，无需重复导入`)
    return
  }
  const total = b.question_count || 0
  if (!confirm(`将「${b.name}」导入到我的题库？\n共 ${total} 题，导入后可享进度 / 收藏 / 错题功能。`)) return
  importingId.value = b._id
  importProgress.value = { done: 0, total }
  try {
    const qs = await listPublicBankQuestions(b._id)
    if (!qs.length) {
      toastError('该公共题库暂无可导入的题目')
      importingId.value = null
      importProgress.value = null
      return
    }
    // 2026-09-25（rabbit 报「导入不完整」）：抓取可能短（某页少回），导入前如实核对一次，
    // 少了就让用户自己决定——别默默导一份残缺副本进去（页面里已有「重取缺页」的兜底，这里是第二道）。
    const expect = Number(b.question_count) || 0
    if (expect > 0 && qs.length < expect) {
      const go = confirm(`云端「${b.name}」共 ${expect} 题，本次只取到 ${qs.length} 题（有页面没拉全）。\n仍要导入这 ${qs.length} 题吗？\n点「取消」可稍后重试。`)
      if (!go) {
        importingId.value = null
        importProgress.value = null
        return
      }
    }
    importProgress.value = { done: 0, total: qs.length }
    // 建本地私人副本（private 避免被云同步当成公开题库重复发布）
    const created = await bankStore.create(b.name, b.description || `来自公共题库：${b.name}`, 'private', b.creator_name || null, b._id)
    if (!created?.id) throw new Error('创建本地题库失败')
    // 剥离公共 id/bank_id，分批写入（大题库避免单事务过大 + 实时进度）
    // 判断题归一：云端存为 type:'single' + ["正确","错误"]，导入时统一为 type:'judge' + answer true/false（2026-08-15 修复）
    // 题库内容字段：解析 / 知识点 / 难度 / 图。
    // 2026-09-23 之前这里只带了 analysis，导致导入后的本地副本看不到知识点与难度，
    // 连图都会显示「图片待补」——因为 images 没跟着过来。
    const contentOf = (q: any) => ({
      analysis: q.analysis,
      knowledge: q.knowledge || '',
      difficulty: q.difficulty || '',
      difficulty_why: q.difficulty_why || '',
      answer_conflict: q.answer_conflict || '',
      answer_conflict_note: q.answer_conflict_note || '',
      images: Array.isArray(q.images) ? q.images : [],
    })
    const clean = qs.map(q => {
      const t = classifyQuestionType(q)
      if (t === 'judge') {
        let opts: string[] = []
        try { const p = JSON.parse(q.options || '[]'); if (Array.isArray(p)) opts = p.map((o: any) => String(o)) } catch { /* ignore */ }
        return {
          type: 'judge',
          stem: q.stem,
          options: JSON.stringify(['正确', '错误']),
          answer: judgeAnswerBool(q.answer, opts.length ? opts : null),
          ...contentOf(q),
          source_index: q.source_index ?? null,
        }
      }
      return {
        type: t,
        stem: q.stem,
        options: q.options,
        answer: q.answer,
        ...contentOf(q),
        source_index: q.source_index ?? null,
      }
    })
    const CHUNK = 250
    for (let i = 0; i < clean.length; i += CHUNK) {
      const slice = clean.slice(i, i + CHUNK)
      await api.addQuestions(created.id, slice)
      importProgress.value = { done: Math.min(i + CHUNK, clean.length), total: clean.length }
    }
    const s = await api.bankStats(created.id)
    bankStatsMap.value.set(created.id, { ...s, accuracy: 0 })
    toastSuccess(`已导入「${b.name}」${clean.length} 题到我的题库`)
  } catch (e) {
    toastError('导入失败：' + (e instanceof Error ? e.message : String(e)))
  } finally {
    setTimeout(() => { importingId.value = null; importProgress.value = null }, 500)
  }
}

async function create() {
  if (!newName.value.trim()) return
  try {
    const created = await bankStore.create(newName.value.trim(), newDesc.value || null, newVisibility.value, newCreator.value.trim() || null)
    showNew.value = false
    newName.value = ''
    newDesc.value = ''
    newCreator.value = ''
    newVisibility.value = 'private'
    if (created && created.id) {
      if (confirm('题库创建成功！是否立即导入题目？\n（点"取消"稍后从题库卡片 ⋯ 菜单里导入）')) {
        router.push(`/import/${created.id}`)
      }
    }
  } catch (e) {
    toastError('创建题库失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

async function del(id: number) {
  if (!confirm('确认删除该题库？此操作不可恢复。')) return
  try {
    await bankStore.remove(id)
    openMenuId.value = null
    bankStatsMap.value.delete(id)
    if (lastPractice.value && lastPractice.value.bank_id === id) {
      lastPractice.value = null
      try { await api.setSetting('last_practice', '') } catch {}
    }
    toastSuccess('题库已删除')
  } catch (e) {
    toastError('删除题库失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

async function exportBank(b: { id: number; name: string }) {
  openMenuId.value = null
  try {
    const jsonStr = await api.exportBank(b.id)
    const defaultName = `${b.name}_导出_${new Date().toISOString().slice(0, 10)}.json`
    const blob = new Blob([jsonStr], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = defaultName
    a.click()
    URL.revokeObjectURL(url)
    toastSuccess('导出成功')
  } catch (e) {
    toastError('导出失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

// 2026-08-23：提交题库到公共题库审核（visibility=private → pending）
async function submitForReview(b: { id: number; name: string }) {
  if (!confirm(`将「${b.name}」提交到公共题库审核？\n提交后需管理员审核通过才会在首页公开展示（审核前仅自己可见）。`)) return
  openMenuId.value = null
  try {
    await api.updateBankVisibility(b.id, 'pending')
    // 刷新该题库统计（visibility 变化影响展示）
    const s = await api.bankStats(b.id)
    bankStatsMap.value.set(b.id, { ...s, accuracy: s.practiced > 0 ? Math.min(100, Math.round((s.correct / s.practiced) * 100)) : 0 })
    // 刷新题库列表（badge 状态更新）
    await bankStore.load()
    toastSuccess('已提交审核，管理员审核通过后将公开')
  } catch (e) {
    toastError('提交失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('touchstart', onDocClick)
  if (syncPollTimer !== null) { window.clearInterval(syncPollTimer); syncPollTimer = null }
})
</script>

<style scoped>
.header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 20px; gap: 16px; }
.header h2 { margin: 0 0 4px 0; font-size: 24px; }
.header-sub { font-size: 13px; color: var(--color-text-secondary); }
.header-sub b { color: var(--color-primary); font-weight: 600; }

/* 2026-10-07：同步状态胶囊（四态 + 未开启灰显；点击 = 立即全量同步；未开启 = 去设置）
   2026-10-07 晚：☁ 常驻在场（rabbit：云哪去了）+ 状态随行符挂动效——同步中 ↻ 持续旋转；
   完成 ✓ 轻弹（justSynced 500ms 闸门，只在转变为 ok 那一刻挂 ss-pop）；待同步接主题色 */
.sync-chip {
  display: inline-block; margin-top: 8px; padding: 3px 12px;
  border-radius: 999px; border: 1px solid var(--color-border, #e3e6eb);
  background: var(--color-card, #fff); font-size: 12px;
  color: var(--color-text-secondary); cursor: pointer;
  transition: color .15s, border-color .15s;
}
.sync-chip .sc-ico, .sync-chip .sc-mark { display: inline-block; }
@keyframes sync-spin { to { transform: rotate(360deg); } }
@keyframes sync-pop { 0% { transform: scale(1); } 50% { transform: scale(1.35); } 100% { transform: scale(1); } }
.sync-chip.ss-idle { color: var(--color-primary); border-color: var(--color-primary); }
.sync-chip.ss-syncing { color: var(--color-primary); border-color: var(--color-primary); }
.sync-chip.ss-syncing .sc-mark { animation: sync-spin 1s linear infinite; }
.sync-chip.ss-ok { color: var(--color-success-strong); border-color: var(--color-success-strong); }
.sync-chip.ss-ok.ss-pop .sc-mark { animation: sync-pop .3s ease; }
.sync-chip.ss-fail { color: var(--color-danger-deep); border-color: var(--color-danger-deep); font-weight: 600; }
.sync-chip.ss-off { opacity: .6; }

/* 访问统计条 */
.visit-bar { margin-bottom: 16px; font-size: 13px; color: var(--color-text-secondary); padding: 8px 14px; background: var(--color-surface, #f7f8fa); border: 1px solid var(--color-border, #eee); border-radius: var(--radius-md); }

/* 云朵彩蛋欢迎条 */
.cloud-welcome-bar {
  margin-bottom: 16px;
  padding: 9px 14px;
  font-size: 13px;
  color: var(--color-text-secondary);
  background: linear-gradient(90deg, var(--tc-light, #f0f9ff) 0%, transparent 85%);
  border: 1px dashed var(--color-border, #e5e7eb);
  border-radius: var(--radius-md);
}
.visit-bar b { color: var(--color-primary); font-weight: 600; }

/* 本机存储提醒（2026-09-25）：注意 flex-wrap——容器窄时让按钮换行，别把文字挤成一行一个字 */
.local-tip {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px;
  margin-bottom: 16px; padding: 10px 14px; font-size: 13px; line-height: 1.6;
  color: var(--color-text-secondary);
  background: var(--color-warning-light, #fffbeb);
  border: 1px solid var(--color-warning-strong, #f0d49b);
  border-radius: var(--radius-md);
}
.local-tip-icon { flex: 0 0 auto; }
.local-tip-text { flex: 1 1 220px; min-width: 0; }
.local-tip-text b { color: var(--color-text); font-weight: 600; }
.local-tip-btn {
  flex: 0 0 auto; padding: 4px 12px; font-size: 13px; cursor: pointer;
  color: #fff; background: var(--color-primary); border: none; border-radius: var(--radius-md);
}
.local-tip-btn:hover { background: var(--color-primary-dark); }
.local-tip-x {
  flex: 0 0 auto; padding: 4px 10px; font-size: 13px; cursor: pointer;
  color: var(--color-text-muted, #6b7280); background: transparent;
  border: 1px solid var(--color-border, #e5e7eb); border-radius: var(--radius-md);
}
.local-tip-x:hover { background: var(--color-border-light, #f5f6f8); }

/* 每日一诗卡 */
.poem-card { margin-bottom: 16px; padding: 14px 16px; background: linear-gradient(135deg, var(--color-surface) 0%, var(--color-surface) 100%); border: 1px solid var(--color-border, #eee); border-left: 3px solid var(--color-primary); border-radius: var(--radius-md); }
.poem-head { font-size: 12px; color: var(--color-primary); font-weight: 600; margin-bottom: 8px; letter-spacing: 0.5px; }
.poem-content { font-size: 15px; line-height: 1.8; color: var(--color-text); white-space: pre-line; letter-spacing: 0.5px; }
.poem-meta { margin-top: 8px; font-size: 12px; color: var(--color-text-secondary); text-align: right; }

.new-bank-btn { padding: 9px 18px; background: var(--color-primary); color: #fff; border: none; border-radius: var(--radius-md); font-size: 14px; cursor: pointer; font-weight: 500; transition: background 0.15s, transform 0.1s; white-space: nowrap; }
.new-bank-btn:hover { background: var(--color-primary-dark); transform: translateY(-1px); }
.header-btns { display: flex; gap: 8px; align-items: center; }
/* 跨库聚合入口那一行（比主按钮轻一档，别抢「考试/综合抽题」的位置） */
.records-btns { margin-top: 8px; }
.record-btn { padding: 6px 12px; background: transparent; color: var(--color-text-secondary, #666); border: 1px solid var(--color-border, #ddd); border-radius: var(--radius-md); font-size: 13px; cursor: pointer; white-space: nowrap; }
.record-btn:hover { color: var(--color-primary); border-color: var(--color-primary); }
.btn-icon { width: 18px; height: 18px; vertical-align: -3px; margin-right: 4px; }
.exam-btn, .mix-exam-btn { display: inline-flex; align-items: center; justify-content: center; }
.exam-btn { padding: 9px 18px; background: linear-gradient(135deg, var(--color-warning-strong) 0%, var(--color-warning-deep) 100%); color: #fff; border: none; border-radius: var(--radius-md); font-size: 14px; cursor: pointer; font-weight: 500; transition: background 0.15s, transform 0.1s; white-space: nowrap; box-shadow: 0 2px 6px rgba(245, 158, 11, 0.3); }
.exam-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4); }
.mix-exam-btn { padding: 9px 18px; background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%); color: #fff; border: none; border-radius: var(--radius-md); font-size: 14px; cursor: pointer; font-weight: 500; transition: background 0.15s, transform 0.1s; white-space: nowrap; box-shadow: 0 2px 6px rgba(79, 70, 229, 0.3); }
.mix-exam-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(79, 70, 229, 0.4); }
.calc-btn { padding: 9px 18px; background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%); color: #fff; border: none; border-radius: var(--radius-md); font-size: 14px; cursor: pointer; font-weight: 500; transition: background 0.15s, transform 0.1s; white-space: nowrap; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18); text-decoration: none; display: inline-flex; align-items: center; justify-content: center; }
.calc-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.22); }

/* 每日激励卡 */
.daily-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
  margin-bottom: 16px;
  background: linear-gradient(135deg, var(--color-warning-light) 0%, var(--color-warning-bg) 100%);
  border: 1px solid var(--color-warning-light);
  border-radius: var(--radius-lg);
  box-shadow: 0 2px 6px rgba(245, 158, 11, 0.08);
}
.daily-left { display: flex; align-items: center; gap: 14px; }
.daily-icon { width: 40px; height: 40px; }
.daily-title { font-size: 16px; color: var(--color-warning-deep); font-weight: 600; }
.daily-title b { color: var(--color-warning-deep); font-size: 18px; }
.daily-sub { font-size: 13px; color: var(--color-warning-text); margin-top: 4px; }
.daily-sub b { color: var(--color-warning-deep); }
.daily-progress { min-width: 160px; }
.daily-progress-bar { height: 6px; background: rgba(146, 64, 14, 0.15); border-radius: 3px; overflow: hidden; }
.daily-progress-fill { height: 100%; background: linear-gradient(90deg, var(--color-warning-strong), var(--color-warning-strong)); border-radius: 3px; transition: width 0.4s; }
.daily-progress-label { font-size: 11px; color: var(--color-warning-text); margin-top: 4px; text-align: right; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 18px; }
.card { position: relative; border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 18px; background: var(--color-card); transition: transform 0.18s, box-shadow 0.18s, border-color 0.18s; cursor: default; display: flex; flex-direction: column; }
.card:hover { transform: translateY(-3px); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08); border-color: var(--color-primary-light); }
.card.has-progress { border-left: 3px solid var(--color-primary); }
.card.open { z-index: 60; }
.card-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 8px; }
.card-header h3 { margin: 0; flex: 1; font-size: 16px; line-height: 1.4; word-break: break-all; }
.more-btn { padding: 4px 8px; border: none; background: none; cursor: pointer; color: var(--color-text-secondary); font-size: 20px; line-height: 1; border-radius: var(--radius-sm); transition: background 0.12s; }
.more-btn:hover { background: var(--color-border-light); }
.card-meta { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
.count-pill, .accuracy-pill, .creator-pill {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 3px 10px; border-radius: 12px;
  font-size: 12px; font-weight: 500;
}
.count-pill { background: var(--color-primary-light); color: var(--color-primary); }
.accuracy-pill { background: var(--color-success-bg); color: var(--color-success-deep); }
.creator-pill { background: var(--tc-light); color: var(--color-primary); }
.accuracy-pill.mid { background: var(--color-warning-bg); color: var(--color-warning-text); }
.accuracy-pill.low { background: var(--color-danger-bg); color: var(--color-danger-deep); }

.progress-row { margin-bottom: 14px; }
.progress-bar { height: 6px; background: var(--color-border-light); border-radius: 3px; overflow: hidden; }
.progress-fill { height: 100%; background: linear-gradient(90deg, var(--color-primary), var(--color-primary-dark)); border-radius: 3px; transition: width 0.4s; }
.progress-text { font-size: 11px; color: var(--color-text-tertiary); margin-top: 4px; text-align: right; }

.actions { margin-top: auto; }
.primary-btn { width: 100%; padding: 10px 12px; border: none; border-radius: var(--radius-md); background: var(--color-primary); color: #fff; cursor: pointer; font-size: 14px; font-weight: 500; transition: background 0.15s, transform 0.1s; }
.primary-btn:hover { background: var(--color-primary-dark); transform: translateY(-1px); }

.dropdown-menu { position: absolute; top: 50px; right: 12px; min-width: 160px; background: var(--color-card); border: 1px solid var(--color-border); border-radius: var(--radius-md); box-shadow: 0 4px 16px rgba(0,0,0,0.15); padding: 4px; z-index: 80; }
.dropdown-menu button { display: flex; align-items: center; width: 100%; text-align: left; padding: 8px 12px; border: none; background: none; cursor: pointer; color: var(--color-text); font-size: 13px; border-radius: var(--radius-sm); gap: 8px; }
.dropdown-menu button:hover { background: var(--color-border-light); }
.dropdown-menu button.danger { color: var(--color-danger); }
.dropdown-menu button.danger:hover { background: var(--color-danger-light); }

.modal { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 100; animation: fadeIn 0.15s; }
.modal-body { background: var(--color-card); padding: 24px; border-radius: var(--radius-lg); min-width: 340px; display: flex; flex-direction: column; gap: 10px; color: var(--color-text); box-shadow: 0 8px 32px rgba(0,0,0,0.2); }
.modal-body h3 { margin: 0 0 4px 0; }
.modal-body input, .modal-body textarea { padding: 8px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg); color: var(--color-text); font-family: inherit; font-size: 14px; }
.modal-body textarea { min-height: 60px; resize: vertical; }
.modal-body input:focus, .modal-body textarea:focus { outline: none; border-color: var(--color-primary); }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
.modal-actions button { padding: 7px 16px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); cursor: pointer; font-size: 14px; }
.modal-actions button:first-child { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
.modal-actions button:first-child:hover { background: var(--color-primary-dark); }
.vis-options { display: flex; gap: 8px; }
.vis-option { flex: 1; display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: 1.5px solid var(--color-border); border-radius: var(--radius-md); cursor: pointer; background: var(--color-bg); }
.vis-option.active { border-color: var(--color-primary); background: var(--color-primary-light); }
.vis-option > span { font-size: 18px; }
.vis-name { font-size: 13px; font-weight: 600; color: var(--color-text); }
.vis-desc { font-size: 11px; color: var(--color-text-tertiary); }
.vis-badge { font-size: 11px; margin-left: 6px; }
.vis-badge.public { color: var(--color-info-deep); }
.vis-badge.private { color: var(--color-warning-text); }
.vis-badge.pending { color: var(--color-warning-text); }

.empty { text-align: center; padding: 80px 24px; color: var(--color-text-tertiary); }
.empty-icon { width: 88px; height: 88px; margin-bottom: 16px; opacity: 0.75; }
.empty-title { font-size: 18px; color: var(--color-text-secondary); margin: 0 0 8px 0; }
.empty-tip { font-size: 14px; margin: 0 0 20px 0; }
.empty-action { padding: 10px 24px; background: var(--color-primary); color: #fff; border: none; border-radius: var(--radius-md); font-size: 14px; cursor: pointer; font-weight: 500; }
.empty-action:hover { background: var(--color-primary-dark); }

/* 公共考试入口 banner */
.public-exam-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  margin-bottom: 18px;
  background: linear-gradient(135deg, var(--color-warning-strong) 0%, var(--color-warning-deep) 100%);
  color: #fff;
  border-radius: var(--radius-lg);
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
  transition: transform 0.15s, box-shadow 0.15s;
}
.public-exam-banner:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(245, 158, 11, 0.4); }
.pe-left { display: flex; align-items: center; gap: 14px; }
.pe-icon { width: 36px; height: 36px; }
.pe-title { font-size: 16px; font-weight: 700; }
.pe-sub { font-size: 12px; opacity: 0.9; margin-top: 2px; }
.pe-arrow { font-size: 30px; opacity: 0.8; line-height: 1; }

/* 公共题库区块 */
.public-section { margin-bottom: 24px; }
/* 2026-09-24（rabbit 手机端截图：标题被折成「公」「共题」「库」三行）：
   `display:flex` 默认不换行，也没有 `flex-wrap`，于是**短标题被长描述挤到 min-content**
   —— 中文的 min-content 就是「一个字一行」。桌面够宽看不见，手机必现（320~414px 实测都是 3 行）。
   ⇒ 让整行可以换行（描述自己另起一行），并禁止标题自身收缩/折行。
   （注：style 块里只能用这种注释——写 `//` 会让 SFC 编译直接报 Unexpected '/'，2026-09-24 踩过） */
.section-header { display: flex; align-items: baseline; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.section-header h3 { margin: 0; font-size: 17px; flex: 0 0 auto; white-space: nowrap; }
.section-sub { font-size: 12px; color: var(--color-text-tertiary); }
.public-grid { margin-top: 0; }
.public-card { border-color: var(--color-primary-light); background: linear-gradient(180deg, var(--color-card) 0%, rgba(124, 58, 237, 0.03) 100%); }
.public-card:hover { border-color: var(--color-primary); }

/* 添加到我的题库 */
.import-btn { width: 100%; margin-top: 8px; padding: 8px 12px; border: 1px dashed var(--color-primary); border-radius: var(--radius-md); background: var(--color-primary-light); color: var(--color-primary); cursor: pointer; font-size: 13px; font-weight: 500; transition: background 0.15s, transform 0.1s; }
.import-btn:hover:not(:disabled) { background: var(--color-primary); color: #fff; transform: translateY(-1px); }
.import-btn:disabled { cursor: default; opacity: 0.7; }
/* 2026-09-27 订阅模式：卡片上的两个次要操作**并排一行**（订阅 / 添加到本地），
   避免竖排堆叠把卡片撑高（rabbit 指出过"堆成三层"）。
   ⚠️ 必须覆盖 .import-btn 的 width:100%，否则 flex 布局下会被撑满整行。 */
.pub-actions-row { display: flex; gap: 8px; margin-top: 8px; }
.pub-actions-row .import-btn { flex: 1 1 0; min-width: 0; width: auto; margin-top: 0; }
.imported-tag { margin-top: 8px; font-size: 12px; color: var(--color-success-deep); background: var(--color-success-bg); padding: 4px 10px; border-radius: 12px; text-align: center; }
/* 「本库来自公共题库 · 点此更新」（2026-09-25）：可点的胶囊提示，沿用 imported-tag 的观感 */
.pub-sync-hint { margin-top: 8px; padding: 6px 10px; border-radius: 12px; text-align: center; font-size: 12px; cursor: pointer; color: var(--color-info-strong); background: rgba(37, 99, 235, 0.08); transition: background 0.15s; }
.pub-sync-hint:hover { background: rgba(37, 99, 235, 0.15); }
.import-progress { margin-top: 8px; }
.import-bar { height: 6px; background: var(--color-border-light); border-radius: 3px; overflow: hidden; }
.import-fill { height: 100%; background: linear-gradient(90deg, var(--color-primary), var(--color-primary-dark)); border-radius: 3px; transition: width 0.2s; }

/* 移动端适配 */
@media (max-width: 768px) {
  .header { flex-direction: column; align-items: stretch; gap: 12px; }
  .header-btns { flex-wrap: wrap; }
  .header-btns button, .header-btns .calc-btn { flex: 1; min-width: 100px; padding: 9px 10px; font-size: 13px; }
  .new-bank-btn { flex: 1 1 100% !important; }
  .grid { grid-template-columns: 1fr; }
  .daily-card { flex-direction: column; align-items: stretch; gap: 10px; }
  .daily-progress { min-width: 0; }
  .dropdown-menu { right: 8px; }
  .resume-card { padding: 14px 16px; }
  .modal-body { min-width: 0; }
  /* 记忆复习入口卡片移动端 */
  .memory-entry-card { flex-direction: column; align-items: stretch; gap: 10px; padding: 14px 16px; }
  .me-right { min-width: 0; }
  .me-health-wrap { width: 100%; }
  .me-arrow { display: none; }
  .me-sub { font-size: 12px; }
  .me-exam { font-size: 11px; }
  /* 学习计划卡片移动端 */
  .study-plan-card { flex-direction: column; align-items: stretch; gap: 10px; padding: 14px 16px; }
  .sp-progress { min-width: 0; }
  .sp-arrow { display: none; }
}

/* 学习计划卡片 */
.study-plan-card { display: flex; align-items: center; justify-content: space-between; padding: 18px 22px; margin-bottom: 16px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff; border-radius: var(--radius-xl); cursor: pointer; box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3); transition: transform 0.15s, box-shadow 0.15s; }
.study-plan-card:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(102, 126, 234, 0.4); }
.sp-left { display: flex; align-items: center; gap: 12px; }
.sp-icon { width: 32px; height: 32px; }
.sp-title { font-size: 18px; font-weight: bold; }
.sp-sub { font-size: 13px; opacity: 0.9; margin-top: 4px; }
.sp-progress { min-width: 100px; }
.sp-progress-bar { height: 8px; background: rgba(255, 255, 255, 0.3); border-radius: 4px; overflow: hidden; margin-bottom: 4px; }
.sp-progress-fill { height: 100%; background: #fff; border-radius: 4px; transition: width 0.3s ease; }
.sp-progress-text { text-align: center; font-size: 14px; font-weight: 500; }
.sp-arrow { font-size: 32px; line-height: 1; opacity: 0.8; }

/* 记忆复习入口卡片（2026-08-23） */
.memory-entry-card { display: flex; align-items: center; justify-content: space-between; padding: 18px 22px; margin-bottom: 16px; background: linear-gradient(135deg, var(--color-primary) 0%, var(--tc-strong) 100%); color: #fff; border-radius: var(--radius-xl); cursor: pointer; box-shadow: 0 4px 12px rgba(124, 58, 237, 0.3); transition: transform 0.15s, box-shadow 0.15s; }
.memory-entry-card:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(124, 58, 237, 0.4); }
.me-left { display: flex; align-items: center; gap: 12px; }
.me-icon-img { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; flex-shrink: 0; background: #fff; padding: 4px; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15); }
.me-title { font-size: 18px; font-weight: bold; }
.me-sub { font-size: 13px; opacity: 0.9; margin-top: 4px; }
.me-sub b { color: #fde68a; }
.me-fast { color: #fcd34d; font-weight: 600; }
.me-exam { font-size: 12px; color: #fde68a; margin-top: 4px; }
.me-exam b { color: #fff; }
.me-right { display: flex; align-items: center; gap: 12px; }
.me-health-wrap { width: 90px; height: 8px; background: rgba(255, 255, 255, 0.3); border-radius: 4px; overflow: hidden; }
.me-health-fill { height: 100%; background: #fff; border-radius: 4px; transition: width 0.3s ease; }
.me-arrow { font-size: 32px; line-height: 1; opacity: 0.8; }

.resume-card { display: flex; align-items: center; justify-content: space-between; padding: 18px 22px; margin-bottom: 16px; background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%); color: #fff; border-radius: var(--radius-xl); cursor: pointer; box-shadow: 0 4px 12px rgba(66, 184, 131, 0.3); transition: transform 0.15s, box-shadow 0.15s; }
.resume-card:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(66, 184, 131, 0.4); }
.resume-label { font-size: 12px; opacity: 0.9; margin-bottom: 4px; letter-spacing: 1px; }
.resume-title { font-size: 18px; font-weight: bold; }
.resume-meta { font-size: 13px; opacity: 0.9; margin-top: 4px; }
.resume-arrow { font-size: 32px; line-height: 1; opacity: 0.8; }

/* 加载骨架 */
.skeleton-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 18px; }
.skeleton-card { height: 160px; background: linear-gradient(90deg, var(--color-border-light) 0%, var(--color-card) 50%, var(--color-border-light) 100%); background-size: 200% 100%; border-radius: var(--radius-lg); animation: shimmer 1.4s infinite; }

@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

/* 免责声明 */
.site-disclaimer {
  margin: 26px auto 8px;
  max-width: 720px;
  text-align: center;
  font-size: 11px;
  line-height: 1.6;
  color: var(--color-text-tertiary);
}

/* 小屏才显示，链接本身的样式在 App.vue（非 scoped，全局生效） */
.site-beian { display: none; margin: 0 auto 20px; }
@media (max-width: 768px) { .site-beian { display: block; } }

.old-toggle {
  display: inline-block;
  margin: 4px 0 10px;
  padding: 4px 12px;
  font-size: 0.82rem;
  color: #2f5597;
  border: 1px solid var(--border-color, #d0d5dd);
  border-radius: 999px;
  cursor: pointer;
}
.archived-pill { padding: 2px 8px; border-radius: 10px; font-size: 11px;
  color: #6b7280; background: #f3f4f6; border: 1px dashed #b6bcc6; }
</style>
