<template>
  <div class="practice">
    <!-- 第一排：题库名 + 进度条 + 模式 -->
    <div class="topbar main-bar">
      <div class="main-left">
        <span class="bank-name">{{ bankName }}</span>
      </div>
      <div class="main-progress">
        <span class="progress-text">{{ current + 1 }} / {{ order.length }}</span>
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: ((current + 1) / Math.max(order.length, 1) * 100) + '%' }"></div>
        </div>
      </div>
      <div class="main-right">
        <select v-model="mode" class="mode-select">
          <option value="order">顺序练习</option>
          <option value="random">随机练习</option>
          <option value="wrong">错题重练</option>
        </select>
        <!-- 2026-09-28：订阅库练习页的「同步」——多端切换时不必回设置页（双向：先推后拉） -->
        <button v-if="canSyncHere" class="sync-btn" :disabled="syncingCloud" title="同步（上传本机改动 + 拉取云端最新）" @click="doPageSync">
          {{ syncingCloud ? '☁️ 同步中…' : '⇅ 同步' }}
        </button>
        <button class="help-btn" title="快捷键帮助 (?)" @click="showHelp = true">?</button>
      </div>
    </div>

    <!-- 第二排：搜索 / 类型筛选 / 自动下一题 / 重置 / 交卷 -->
    <div class="topbar tool-bar">
      <div class="search-box">
        <input v-model="searchQuery" placeholder="搜索题目..." @keyup.enter="doSearch" />
        <button v-if="searchQuery" class="search-btn" @click="doSearch">搜索</button>
        <button v-if="searchResults" class="clear-search-btn" @click="clearSearch">✕</button>
      </div>
      <div class="type-filter" v-if="availableTypes.length > 1">
        <span class="filter-label">题型:</span>
        <button
          v-for="t in availableTypes"
          :key="t"
          class="type-chip-btn"
          :class="{ active: !typeFilter.includes(t) }"
          @click="toggleTypeFilter(t)"
        >{{ t }}</button>
      </div>
      <label class="auto-next-toggle">
        <input type="checkbox" v-model="autoNext" />
        答对自动下一题
      </label>
      <label class="auto-next-toggle">
        <input type="checkbox" v-model="shuffleOptions" />
        🔀 选项乱序
      </label>
      <button class="restart-btn" @click="restart">重新开始</button>
      <!-- 2026-10-05：进度历史回滚入口。进度只留「当前值」时，被空档覆盖即永久丢失
           （10-04、10-05 各实测一次）⇒ 每库留最近 5 版可回滚。按钮仅在有历史时出现。 -->
      <!-- 2026-10-07：显示条件必须**两套数据取或** —— 历史栈走云端参与（关同步/没配云时为空），
           硬存档纯本机（正是那批用户唯一能救命的东西）。只挂历史栈 ⇒ 存档存了却没入口。 -->
      <button v-if="historyList.length || archiveList.length" class="restart-btn history-btn" @click="openHistory">
        🕘 历史版本（{{ historyList.length + archiveList.length }}）
      </button>
      <!-- 2026-10-03：同步状态（断网/失败可见，可点重试）；2026-10-07 晚图标分态 + 动效（同步中 ↻ 转、完成 ✓ 轻弹） -->
      <span class="sync-chip" :class="{ syncing: syncStat.state === 'syncing', ok: syncStat.state === 'ok', fail: syncStat.state === 'fail', pop: justSynced }" :title="syncStat.msg || ''" @click="onSyncChipTap"><span class="sc-ico">☁</span><span class="sc-mark">{{ syncChipMark }}</span>{{ syncChipText }}</span>
    </div>

    <!-- 2026-10-03：存档守望的可见出口（写不进去/落盘校验不过时出现，点一下补存）＋计划模式提示 -->
    <div v-if="saveWarn" class="save-warn" @click="retrySave">{{ saveWarn }}</div>
    <div v-if="isPlanMode" class="plan-hint">计划模式：本次练习不更新这道库的「练习进度」（错题/统计照常记录）</div>

    <div v-if="searchResults" class="search-result-banner">
      搜索到 <b>{{ searchResults.length }}</b> 道包含"<b>{{ searchQuery }}</b>"的题目，点击跳转
      <button class="close-btn" @click="clearSearch">✕</button>
    </div>
    <div v-if="searchResults && searchResults.length" class="search-result-list">
      <div
        v-for="(r, ri) in searchResults.slice(0, 30)"
        :key="r.id"
        class="search-result-item"
        @click="jumpToQuestion(r.id)"
      >
        <span class="search-result-idx">{{ ri + 1 }}.</span>
        <span class="search-result-text" v-html="highlightText(r.stem, searchQuery)"></span>
        <span class="search-result-types">
          <span class="type-chip">{{ r.type }}</span>
        </span>
      </div>
      <div v-if="searchResults.length > 30" class="search-result-overflow">仅显示前 30 条，共 {{ searchResults.length }} 条匹配</div>
    </div>

    <!-- 快捷键帮助浮窗 -->
    <Teleport to="body">
      <div v-if="showHelp" class="help-overlay" @click.self="showHelp = false">
        <div class="help-modal">
          <div class="help-header">
            <h3>⌨️ 快捷键</h3>
            <button class="close-btn" @click="showHelp = false">×</button>
          </div>
          <div class="help-list">
            <div class="help-item"><kbd>←</kbd> / <kbd>→</kbd><span>上一题 / 下一题</span></div>
            <div class="help-item"><kbd>A</kbd> <kbd>B</kbd> <kbd>C</kbd> <kbd>D</kbd><span>选择对应选项</span></div>
            <div class="help-item"><kbd>Enter</kbd><span>确认 / 下一题</span></div>
            <div class="help-item"><kbd>F</kbd><span>收藏 / 取消收藏</span></div>
            <div class="help-item"><kbd>R</kbd><span>切换 AI 解析</span></div>
            <div class="help-item"><kbd>?</kbd><span>显示 / 隐藏本帮助</span></div>
            <div class="help-item"><kbd>Esc</kbd><span>关闭弹窗</span></div>
          </div>
          <p class="help-tip">提示：快捷键在输入框内不生效</p>
        </div>
      </div>
    </Teleport>

    <!-- 2026-10-07：进库提醒**下沉到练习页**——检查点放在「页面打开那一刻」，
         任何入口进来都覆盖（首页那 4 个入口的 toast 保留，但不拦）。同步跑完自动消失。 -->
    <div v-if="syncingHint" class="restored-banner syncing-warn">
      ⚠ 云同步还没完成：现在可能读不到上次进度，建议退出等几秒重进
    </div>

    <div v-if="restoredBanner" class="restored-banner">
      已从上次进度恢复，当前第 {{ current + 1 }} 题
      <button class="close-btn" @click="restoredBanner = false">×</button>
    </div>

    <div v-if="syncBanner" class="restored-banner">
      {{ syncBanner }}
      <button class="close-btn" @click="syncBanner = ''">×</button>
    </div>

    <!-- 2026-10-05：进度历史面板（回滚入口）。滚动快照按时间倒序列出，
         每行显示「时间 + 已答数」；点回滚后重新加载本页进度。 -->
    <Teleport to="body">
      <div v-if="showHistory" class="hist-mask" @click.self="showHistory = false">
        <div class="hist-panel">
          <div class="hist-head">
            <span>进度历史版本</span>
            <button class="close-btn" @click="showHistory = false">×</button>
          </div>
          <p class="hist-tip">每次实质作答都会自动留一版，最多保留最近 {{ HISTORY_MAX }} 版。若进度被意外清空，可从这里恢复到先前版本。</p>
          <div v-for="h in historyList" :key="h.saved_at" class="hist-row">
            <div class="hist-info">
              <div class="hist-time">{{ fmtHistTime(h.saved_at) }}</div>
              <div class="hist-meta">已答 {{ h.answered }} 题<template v-if="h.finished"> · 已完成</template><template v-if="h.marked"> · 含「重新开始」标记</template></div>
            </div>
            <button class="hist-btn2" :disabled="rollingBack" @click="onRollback(h)">恢复此版本</button>
          </div>
          <div v-if="!historyList.length" class="hist-empty">暂无历史版本（答过题后会自动记录）</div>

          <!-- 2026-10-07：本机硬存档 —— 与上面那组**数据独立**：它只在本机保存成功时写入，
               云端拉取/上传/恢复都不碰它 ⇒ 云端被写坏时这里仍有可恢复的版本。 -->
          <div class="hist-subhead">🛡 本机硬存档（最多 {{ ARCHIVE_MAX }} 版 · 不受云端影响）</div>
          <p class="hist-tip">只在本地保存成功时写入，任何云端读写都不碰它——没配云、关掉同步也照记。</p>
          <div v-for="h in archiveList" :key="'a-' + h.saved_at" class="hist-row">
            <div class="hist-info">
              <div class="hist-time">{{ fmtHistTime(h.saved_at) }}</div>
              <div class="hist-meta">已答 {{ h.answered }} 题<template v-if="h.finished"> · 已完成</template><template v-if="h.marked"> · 含「重新开始」标记</template></div>
            </div>
            <button class="hist-btn2" :disabled="rollingBack" @click="onRestoreArchive(h)">恢复此版本</button>
          </div>
          <div v-if="!archiveList.length" class="hist-empty">暂无硬存档（答过题后会自动记录）</div>
        </div>
      </div>
    </Teleport>

    <div v-if="!loaded" class="loading">加载中...</div>
    <div v-else-if="finished" class="finished">
      <h3>练习完成！</h3>
      <p>共完成 {{ order.length }} 题</p>
      <button @click="restart">🔄 再练一次</button>
      <button @click="$router.push('/')">返回题库</button>
      <button @click="$router.push(`/wrong/${bankId}`)">查看错题</button>
    </div>
    <!-- 全题型被排除：不渲染题目卡，避免 currentQuestion 显示被排除的题 -->
    <div v-else-if="questions.length && !displayQuestions.length" class="empty-filter">
      <div class="empty-icon">🔎</div>
      <p>当前筛选条件下没有题目</p>
      <button class="restart-btn" @click="clearTypeFilter">清除筛选</button>
    </div>
    <!-- 2026-08-16 修复：错题重练/随机等模式下 order 为空（如暂无错题）时，
         此前会兜底显示题库第一题（currentQuestion 的 || questions[0]），用户误以为是错题 -->
    <div v-else-if="questions.length && !order.length" class="empty-filter">
      <div class="empty-icon">{{ mode === 'wrong' ? '🎉' : '📭' }}</div>
      <p>{{ mode === 'wrong' ? '暂无错题，先去刷题积累错题吧！' : '当前没有可练习的题目' }}</p>
      <button class="restart-btn" @click="$router.push(mode === 'wrong' ? '/' : '/')">返回题库</button>
    </div>
    <div v-else-if="questions.length && current >= 0 && displayQuestions.length">
      <QuestionCard
        :key="`${currentQuestion.id}-${reloadKey}`"
        :question="currentQuestion"
        :index="current"
        :auto-next="autoNext"
        :has-prev="current > 0"
        :saved-state="answerStates.get(currentQuestion.id) || null"
        :favorited="favoriteIds.has(currentQuestion.id)"
        :shuffle-options="shuffleOptions"
        :hide-edit="isSubscribedBank"
        @answered="onAnswered"
        @state-change="onStateChange"
        @next="next"
        @prev="prev"
        @toggle-favorite="onToggleFavorite"
        @question-updated="onQuestionUpdated"
      />
      <!-- 2026-08-23：记忆自评标签（自动评估，可点击手动覆盖） -->
      <div v-if="memoryReviewMap.has(currentQuestion.id)" class="memory-review-bar">
        <span class="memory-label">记忆自评</span>
        <div class="memory-quality-btns">
          <button
            v-for="opt in MEMORY_OPTIONS"
            :key="opt.label"
            class="memory-quality-btn"
            :class="{ active: currentMemoryLabel === opt.label }"
            :title="opt.hint"
            @click="overrideMemory(opt.label)"
          >{{ opt.label }}</button>
        </div>
        <span class="memory-next" title="下次复习时间">{{ memoryNextText }}</span>
      </div>
      <!-- 题目导航条 -->
      <div v-if="displayQuestions.length > 1" class="question-nav">
        <div class="nav-header">
          <span class="nav-title">题目导航 <span v-if="typeFilter.length" class="filter-hint">（已过滤 {{ typeFilter.length }} 类）</span></span>
          <span class="nav-stats">
            <span class="dot-stat correct">✓ {{ correctCount }}</span>
            <span class="dot-stat wrong">✗ {{ wrongCount }}</span>
            <span class="dot-stat unanswered">○ {{ unansweredCount }}</span>
          </span>
        </div>
        <div class="nav-groups">
          <div v-for="g in navGroups" :key="g.cat" class="nav-group">
            <button class="nav-group-title" @click="goToQuestion(g.first)">{{ g.label }} · {{ g.count }} 题</button>
            <div class="nav-dots">
              <button
                v-for="i in g.indexes"
                :key="i"
                class="nav-dot"
                :class="getDotClass(i, displayQuestions[i]?.id)"
                :title="`第 ${i + 1} 题`"
                @click="goToQuestion(i)"
              >{{ i + 1 }}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-else>暂无题目，请先导入。</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { api, Question, resolveBankId } from '../utils/api'
import { toastError, toastSuccess, toastInfo } from '../utils/toast'
import { useBankStore } from '../stores/bank'
import { idb } from '../lib/db'
import QuestionCard, { type QuestionState } from '../components/QuestionCard.vue'
import { classifyQuestionType, TYPE_LABELS, groupQuestionsByCategory } from '../lib/exam'
import { calculateAutoQuality, calculateNextReview, qualityLabel, labelToQuality, formatDate, computeNextReviewTs, toReviewTs, type QualityLabel } from '../lib/spaced-repetition'
import { formatSyncDetail } from '../lib/sync-format'
import { getWebSyncStatus, getLastPullAt, isPullInFlight, listProgressHistory, rollbackProgress, isCloudEnabled, autoPullDueOnOpen } from '../lib/cloud'
import { shouldWarnOnEnter } from '../lib/sync-notice'
// 2026-10-07：本机硬存档——独立于云端的最后一道保险（关掉同步、没配云也照记）
import { recordLocalArchive, listLocalArchive, restoreLocalArchive, ARCHIVE_MAX } from '../lib/local-archive'
import { HISTORY_MAX, buildProgressRefMaps, resolveProgressRef } from '../lib/sync-ids'
import { msToSecs } from '../lib/duration'

interface SavedProgress {
  mode: string
  order_ids: number[]
  current_id: number
  answer_states: Record<string, QuestionState>
  finished: boolean
  saved_at: string
  /** 2026-09-28：本机点过「重新开始」的标记——同步守卫据此区分「故意的空」与
   *  「打开页面自动生成的新进度」，避免重置被云端旧进度顶回来（见 sync-ids 的守卫）。 */
  _reset?: string
}

const route = useRoute()
const bankStore = useBankStore()
// 2026-09-27 订阅模式：路由参数既可能是本地题库的数字 id，也可能是**公共题库的 bankRef**（云端 _id，
// 形如 `lquiz_banks_7` / 32 位十六进制串）。**不能再无条件 Number()** —— 那会把 bankRef 变成 NaN。
// 判据：纯数字 ⇒ 本地库（number）；否则 ⇒ 订阅库（string bankRef），题目由 api 层直接读云端、不落本地。
const bankId = resolveBankId(route.params.bankId)
// 2026-08-22：智能学习计划模式——队列来自 StudyPlanView 写入的 localStorage（study_plan_questions）
// 修复前：计划跳转路由错误 404，且 mode=plan / study_plan_questions 无消费方，计划功能完全断裂
const isPlanMode = route.query.mode === 'plan'
const planItems = ref<{ id: number; bankId: number }[]>([])
const planId = ref<string | null>(null)
const planQueueReady = ref(false)
// 2026-09-27 订阅模式：`canTrack` = 本次练习是否「留痕」（写错题/收藏/统计、进度上云）。
//   · 数字 bankId（本地库） ⇒ 恒 true
//   · 字符串 bankId（公共题库） ⇒ **仅当已订阅** 才 true
// 未订阅的公共库仍可用完整界面练，但**只练不留痕** —— 防止"随手点进别的库、做错几题却删不掉"的污染。
// 订阅记录存 settings（`api.listSubscriptions`），与进度同机制，跨端一致。
const subscribedRef = ref(false)
const canTrack = computed(() => typeof bankId === 'number' || subscribedRef.value)
// 2026-10-05：订阅库（bankId 是字符串 bankRef，题目在云端在线读、本地无行）隐藏 ✎ 编辑入口。
//   原因：保存走 api.updateQuestion → idb.updateQuestion 无条件 put，而订阅题 id 是云端 `_local_id`，
//   与本地自增 id 同域时（旧包 1~4746）会覆盖本地同号题；且写出的行 `bank_id` 是 bankRef 字符串，
//   listAllQuestions 遍历不到 ⇒ 改动永远推不上云，纯属污染。本地库（数字 bankId）行为不变。
//   与小程序端对齐（其 `canEdit` = `_id && visibility !== 'public'`，见 P2-57）；网页端的订阅题对象
//   经 PUBLIC_Q_FIELDS 裁剪后**不带 visibility**，故只能按路由形态判 —— 这也是 api.resolveBankId
//   唯一承认的判据（数字=本地库 / 其它=公共 bankRef）。
const isSubscribedBank = computed(() => typeof bankId === 'string')
if (typeof bankId === 'string') {
  api.listSubscriptions().then(list => { subscribedRef.value = list.indexOf(bankId) >= 0 }).catch(() => { /* 读失败按未订阅处理 */ })
}

// 2026-09-28：订阅库练习页的「同步」按钮（多端切换用）——只对「已订阅的公共库」显示。
// 跑双向（syncAll：先推后拉），完成后用顶部横幅显示明细（复用 restored-banner 样式）。
const syncingCloud = ref(false)
const syncBanner = ref('')
const canSyncHere = computed(() => typeof bankId === 'string' && subscribedRef.value)
async function doPageSync () {
  if (syncingCloud.value) return
  syncingCloud.value = true
  try {
    const mod = await import('../lib/cloud')
    const res = await mod.syncAll()
    const st = mod.getCloudStatus()
    if (!st.authed) { syncBanner.value = '尚未配置云同步（请到设置页配置后重试）'; return }
    if (st.error) { toastError('同步未完成：' + st.error); return }
    syncBanner.value = `✓ 同步完成 · ⬆ ${formatSyncDetail(res.pushDetail)} · ⬇ ${formatSyncDetail(res.pullDetail)}`
    setTimeout(() => { if (syncBanner.value) syncBanner.value = '' }, 8000)
  } catch (e) {
    toastError('同步失败：' + (e instanceof Error ? e.message : String(e)))
  } finally {
    syncingCloud.value = false
  }
}

// 2026-09-27：订阅库不在 bankStore（那是本地库列表）⇒ 名字优先取路由 query 里的 name（公共库入口会带上）。
// 2026-10-07（rabbit 事故加固）：入口**不带 name** 时（首页续练卡、错题本/收藏/统计跳回练习等），
//   订阅库的 bankName 会退化成空串，而空串会被写进续练指针 `last_practice.bank_name` 并上行。
//   续练指针跨端认库只有「库名 + bank_id」两条线索，名字缺失时判错库的概率显著升高（当日 08:14 事故：
//   云端 bank_name 为空 + 两端 bank_id 形态不同 ⇒ 判成两个库 ⇒ 防倒退闸门失效 ⇒ 指针被顶成第 1 题）。
//   ⇒ 这里补一条**云端兜底**：订阅库（字符串 bankId）名字拿不到时，直接查题库元信息；
//     本地库不变（它本来就在 bankStore 里）。异步补齐，拿到后自动更新（写入侧读的是 computed）。
const bankNameResolved = ref('')
const bankName = computed(() => String(route.query.name || '') || bankStore.banks.find(b => b.id === bankId)?.name || bankNameResolved.value || '')
if (typeof bankId === 'string') {
  // 已有名字就不查云端（公共库入口都带 name，这条只为「不带 name 的入口」兜底）
  if (!String(route.query.name || '')) {
    import('../lib/exam').then(m => m.fetchPublicBankName(String(bankId)))
      .then(n => { if (n) bankNameResolved.value = n })
      .catch(() => { /* 拿不到名字不阻断练习，只是指针少一条线索 */ })
  }
}
const questions = ref<Question[]>([])
const order = ref<number[]>([])
const current = ref(0)
const mode = ref('order')
const finished = ref(false)
const autoNext = ref(localStorage.getItem('practice_auto_next') === '1')
watch(autoNext, (v) => {
  localStorage.setItem('practice_auto_next', v ? '1' : '0')
})
// 选项乱序：打乱选择题选项展示顺序（localStorage 持久化，默认为关）
const shuffleOptions = ref(localStorage.getItem('practice_shuffle_options') === '1')
watch(shuffleOptions, (v) => {
  localStorage.setItem('practice_shuffle_options', v ? '1' : '0')
  reloadKey.value++ // 强制重挂载当前题，重新随机打乱
})
// 保存每道题的答题状态（按题目 id），切换题目时恢复
const answerStates = ref<Map<number, QuestionState>>(new Map())
// 收藏题目 id 集合
const favoriteIds = ref<Set<number>>(new Set())

const loaded = ref(false)
const restoring = ref(false)
const restoredBanner = ref(false)
const reloadKey = ref(0)
// 「重新开始」标记（随进度落盘，同步守卫读它；云端版本一旦覆盖本机，标记自然消失）
const resetMarked = ref<string | null>(null)

// 2026-10-05：进度历史（回滚）。listProgressHistory 读本机/云端并集，
// 由保存链与同步拉取两侧共同维护（见 cloud.ts 的 recordProgressHistory / PRACTICE_HISTORY_KEY）。
// ⚠️ bankRef 必须从 progressKey 推导（= 云端 cloud_id 优先的那套标尺）：
//   直接用页面参数 bankId 会在本地库上写出 `practice_progress_1` 这种本机号，
//   而练习页读的是 cloud_id 键 ⇒ 回滚看似成功、实则写到了没人读的键上（正是本页历史上踩过的坑）。
const historyBankRef = computed(() => String(progressKey.value).replace(/^practice_progress_/, ''))
const showHistory = ref(false)
const historyList = ref<any[]>([])
const rollingBack = ref(false)
const archiveList = ref<any[]>([])
// 硬存档单独刷：答题落盘后只重读这一份（历史栈那份可能带云端读，不跟着每次保存跑）
async function refreshArchive () {
  try { archiveList.value = await listLocalArchive(historyBankRef.value) } catch { archiveList.value = [] }
}
async function refreshHistory () {
  try { historyList.value = await listProgressHistory(historyBankRef.value) } catch { historyList.value = [] }
  await refreshArchive()
}
// 打开面板前必须现读一次：否则用户答完题打开，看到的还是进页那一刻的旧列表（可能还是空的）
async function openHistory () {
  await refreshHistory()
  showHistory.value = true
}
// 2026-10-07：恢复结果如实措辞。此前两条手动恢复路径都无条件 toast「已恢复」，
// 而 apply 失败（引用解析不出来）时画面纹丝不动 —— rabbit 报的「点了恢复完全没用」有一半是这句话造成的。
function reportRestore (r: RestoreOutcome, okText: string) {
  if (r === 'applied') { toastSuccess(okText); return }
  if (r === 'no-saved' || r === 'unparsable') {
    toastError('恢复失败：这版进度读不出来（数据可能已损坏）')
    return
  }
  if (r === 'not-loaded') {
    toastError('恢复失败：题目还没加载完，请稍后重试')
    return
  }
  toastError('恢复失败：这版进度里的题目对不上当前题库（可能题库已更新）。当前进度未改动')
}
async function onRestoreArchive (h: any) {
  if (rollingBack.value) return
  const okToGo = window.confirm(`从本机硬存档恢复到 ${fmtHistTime(h.saved_at)} 的版本（已答 ${h.answered} 题）？\n\n当前进度会被这一版替换。`)
  if (!okToGo) return
  rollingBack.value = true
  try {
    const done = await restoreLocalArchive(historyBankRef.value, h.saved_at)
    if (!done) { toastError('恢复失败：该版本已不在硬存档里'); return }
    showHistory.value = false
    reportRestore(await restoreProgress(), '已从本机硬存档恢复该版本')
    await refreshHistory()
  } catch (e: any) {
    toastError('恢复失败：' + String((e && e.message) || e))
  } finally {
    rollingBack.value = false
  }
}
function fmtHistTime (iso: string): string {
  const t = Date.parse(String(iso || ''))
  if (!Number.isFinite(t)) return String(iso || '')
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
async function onRollback (h: any) {
  if (rollingBack.value) return
  const okToGo = window.confirm(`恢复到 ${fmtHistTime(h.saved_at)} 的版本（已答 ${h.answered} 题）？\n\n当前进度会被这一版替换。`)
  if (!okToGo) return
  rollingBack.value = true
  try {
    const done = await rollbackProgress(historyBankRef.value, h.saved_at)
    if (!done) { toastError('恢复失败：该版本已不在历史里'); return }
    showHistory.value = false
    reportRestore(await restoreProgress(), '已恢复该版本进度')   // 就地重载，用户立刻看到题号回退
    await refreshHistory()
  } catch (e: any) {
    toastError('恢复失败：' + String((e && e.message) || e))
  } finally {
    rollingBack.value = false
  }
}

// 搜索相关
const searchQuery = ref('')
const searchResults = ref<Question[] | null>(null)

// 快捷键帮助浮窗
const showHelp = ref(false)

// 题目类型筛选：typeFilter 存储**被排除**的题型（默认全选=空数组）
const typeFilter = ref<string[]>([])
// 2026-10-02：TYPE_LABELS 升到 lib/exam.ts（题号栏分组三处共用一份），这里直接 import
// 2026-08-16 修复：题型归类必须内容识别（判断题在库里是 type:'single' + ["正确","错误"]，
// 裸用 q.type 会把判断题并进"单选"，筛选框只剩单选/多选）
function questionTypeLabel(q: Question): string {
  const t = classifyQuestionType(q)
  return TYPE_LABELS[t] || t
}
const availableTypes = computed(() => {
  const set = new Set<string>()
  for (const q of questions.value) set.add(questionTypeLabel(q))
  return Array.from(set)
})
function toggleTypeFilter(t: string) {
  const idx = typeFilter.value.indexOf(t)
  if (idx >= 0) typeFilter.value.splice(idx, 1)
  else typeFilter.value.push(t)
  // 筛选变化时立即重建答题顺序并回到第一题
  rebuildOrderFromFilter()
}
function clearTypeFilter() {
  typeFilter.value = []
  rebuildOrderFromFilter()
}
// 按筛选重建 order（保留当前模式逻辑：顺序/随机/错题）
function rebuildOrderFromFilter() {
  // 2026-08-16 修复卡死：一次构建 id→下标 Map，避免每题 findIndex 的 O(N²)
  const idxMap = new Map(questions.value.map((q, i) => [q.id, i]))
  const filtered = displayQuestions.value
  if (mode.value === 'random') {
    order.value = shuffle(filtered.map(q => q.id).map(id => idxMap.get(id)).filter((i): i is number => i !== undefined && i >= 0))
  } else if (mode.value === 'wrong') {
    // 错题重练 + 筛选：从错题中再按筛选过滤（简单场景：直接过滤错题）
    const allowed = new Set(filtered.map(q => q.id))
    order.value = order.value.filter(i => allowed.has(questions.value[i]?.id))
  } else {
    order.value = filtered.map(q => idxMap.get(q.id)).filter((i): i is number => i !== undefined && i >= 0)
  }
  current.value = 0
  scheduleSave()
}

// 类型过滤后的题目列表（影响 order）
const displayQuestions = computed(() => {
  if (typeFilter.value.length === 0) return questions.value
  return questions.value.filter(q => {
    return !typeFilter.value.includes(questionTypeLabel(q))
  })
})
// 2026-10-02：题号栏按题型分段（组序=首次出现序；first=组内第一题的展示下标，供组头跳转）
const navGroups = computed(() => groupQuestionsByCategory(displayQuestions.value))

// 2026-08-16：单题库「模拟考试」已取消（功能与「创建考试」重叠，且存在切模式计时器泄漏等缺陷）

// 2026-09-27 统一「进度标尺」——此前是本轮同步不通的根因：
//   · 订阅库：bankId 已是 bankRef（云端 quiz_banks._id）⇒ 直接用 ✓
//   · 本地库：原用**本机自增 id**（`practice_progress_1`）⇒ 换设备/换浏览器后这个 id 毫无意义，
//     而另一台设备对同一个题库用的是**云端 id**（`practice_progress_lquiz_banks_14`）⇒ **两端标尺不同 ⇒ 进度永远对不上**。
//   现在：本地库**优先用它已上云的 `cloud_id`（= 云端 _id，与其它设备一致）**；
//   仅当该库从未上云（无 cloud_id）时才退回本地 id（此时本就无法跨端，属合理降级）。
const progressKey = computed(() => {
  if (typeof bankId === 'string') return `practice_progress_${bankId}`
  const bank: any = bankStore.banks.find((b: any) => b.id === bankId)
  const ref = bank && bank.cloud_id ? String(bank.cloud_id) : String(bankId)
  return `practice_progress_${ref}`
})
// 全局最近练习记录（供首页"继续刷题"使用）
const LAST_PRACTICE_KEY = 'last_practice'

const currentQuestion = computed(() => questions.value[order.value[current.value]] || questions.value[0])

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

onMounted(async () => {
  // 全局快捷键
  window.addEventListener('keydown', onKeydown)
  try {
    questions.value = await api.listQuestions(bankId)
    if (isPlanMode) {
      // 计划模式：读取 StudyPlanView 写入的今日任务队列，过滤出属于当前题库的题
      try {
        const raw = localStorage.getItem('study_plan_questions')
        planId.value = localStorage.getItem('study_plan_id')
        if (raw) {
          const items = JSON.parse(raw) as { id: number; bankId: number }[]
          const bankIdSet = new Set(items.map(i => i.bankId))
          if (!bankIdSet.has(bankId) && bankIdSet.size > 1) {
            // 队列里没有当前题库的题（跨题库计划），提示并回退普通练习
            toastInfo('今日计划中没有本题库的题目，已进入普通练习')
          }
          const allowed = new Set(items.filter(i => i.bankId === bankId).map(i => i.id))
          if (allowed.size > 0) {
            const idxMap = new Map(questions.value.map((q, i) => [q.id, i]))
            const planOrder = Array.from(allowed)
              .map(id => idxMap.get(id))
              .filter((i): i is number => i !== undefined)
            if (planOrder.length > 0) {
              order.value = planOrder
              planQueueReady.value = true
            }
          }
        }
      } catch (e) {
        console.error('读取计划队列失败：', e)
      }
    }
    if (!planQueueReady.value) {
      order.value = questions.value.map((_, i) => i)
    }
    // 加载收藏列表
    try {
      const favIds = await api.listFavorites(bankId)
      favoriteIds.value = new Set(favIds)
    } catch (e) {
      console.error('加载收藏列表失败：', e)
    }
    if (!isPlanMode) {
      // 计划模式不恢复普通练习进度（避免计划队列污染/被污染）
      await restoreProgress()
      await refreshHistory()   // 2026-10-05：同时载入历史版本（按钮仅在非空时出现）
    }
  } catch (e) {
    toastError('加载题目失败：' + (e instanceof Error ? e.message : String(e)))
  } finally {
    loaded.value = true
    // 2026-08-23：进入页面加载记忆标签（已有答题状态的题）
    loadMemoryReviews()
  }
})

// 2026-10-07：恢复未就绪闸门。有过进度但没能恢复上时（引用解析不出来），禁止把「空进度/第 1 题」
// 写回存储与续练指针——事故：网页版恢复被静默放弃后，首存把 last_practice 写成 position=1 上行，
// 把两端「继续刷题」位置顶掉（02:10 实测）。用户真答了题或按「重新开始」即解除。
const restoreUnsettled = ref(false)

// 从后端恢复上次进度。
// 2026-10-07：返回值改为如实汇报结果，供「恢复历史版本」调用方给用户一个明确交代——
//   此前无论成功失败都返回 undefined，调用方只能一律 toast「已恢复该版本」，
//   失败时（引用解析不出来）用户看到的就是「提示说恢复了、画面毫无变化」。
type RestoreOutcome = 'applied' | 'no-saved' | 'unparsable' | 'refs-unresolved' | 'not-loaded'
async function restoreProgress(): Promise<RestoreOutcome> {
  const saved = await api.getSetting(progressKey.value)
  if (!saved) return 'no-saved'
  let progress: SavedProgress
  try {
    progress = JSON.parse(saved)
  } catch {
    return 'unparsable'
  }
  if (!progress || progress.current_id == null) return 'unparsable'
  if (!questions.value.length) return 'not-loaded'

  // 沿用落盘的「重新开始」标记（云端版本覆盖本机后此处自然读不到）
  resetMarked.value = progress._reset ? String(progress._reset) : null

  restoring.value = true
  // 2026-10-04：复位挪进 finally —— 恢复途中任何一次抛错都会让 restoring 永久停在 true，
  // 那会连锁静默关掉「保存 → 推送 → 存档守望」整条链（页面毫无异样、照常答题）。
  try {
    // 恢复练习模式
    if (progress.mode === 'order' || progress.mode === 'random') {
      mode.value = progress.mode
    }

    // 2026-10-07：引用解析统一走 resolveProgressRef —— 数字本机 id / src_local_id /
    // 小程序 qid 字符串（`bankRef::id:<云题 _id>`，订阅库经桥推来的进度就是这一形态）。
    // 此前只认数字两个来源 ⇒ 小程序推来的进度被静默放弃（02:10 事故根因之一）。
    const refMaps = buildProgressRefMaps(questions.value as any[])
    const idxOf = (ref: unknown): number | undefined => resolveProgressRef(ref, refMaps)

    // 恢复题目顺序
    if (progress.order_ids && progress.order_ids.length === questions.value.length) {
      const restoredOrder: number[] = []
      let valid = true
      for (const id of progress.order_ids) {
        const idx = idxOf(id)
        if (idx === undefined) { valid = false; break }
        restoredOrder.push(idx)
      }
      if (valid) {
        order.value = restoredOrder
      } else if (mode.value === 'random') {
        order.value = shuffle(questions.value.map((_, i) => i))
      }
      // 顺序模式下 order.value 已是 [0,1,...,n-1]
    } else if (mode.value === 'random') {
      order.value = shuffle(questions.value.map((_, i) => i))
    }

    // 恢复当前题号（按题目引用定位，避免题目列表变化导致错位）
    const curIdx = idxOf(progress.current_id)
    if (curIdx === undefined) {
      // 有进度却解析不出当前位置 ⇒ 不装作恢复成功；挂闸门，直到用户真答题/重新开始
      restoreUnsettled.value = true
      // 2026-10-07（rabbit：「恢复历史版本完全没用」）：此处原先**完全静默**——不弹提示、不改画面，
      // 用户在界面上看到的就是「点了恢复，什么都没发生」。改为把结果如实交回调用方，
      // 由调用方决定措辞（自动恢复路径不打扰用户，手动恢复路径必须明说失败）。
      return 'refs-unresolved'
    }
    const currentOrderIdx = order.value.findIndex(i => i === curIdx)
    current.value = currentOrderIdx >= 0 ? currentOrderIdx : 0
    // 2026-10-07：**必须强制重挂载题目卡**。此前只有 `currentQuestion.id` 变（换题）时才靠 :key 重建，
    // 而「恢复到与当前同一题」时 key 不变 ⇒ QuestionCard 的 selected/submitted/isCorrect 那些
    // setup 期一次性的 ref 保持旧值 ⇒ **对错永远刷不出来**（rabbit 报的「题目对错也无法恢复」）。
    reloadKey.value++

    // 恢复各题答题状态
    if (progress.answer_states) {
      const map = new Map<number, QuestionState>()
      for (const [idRef, state] of Object.entries(progress.answer_states)) {
        const idx = idxOf(idRef)
        if (idx !== undefined) {
          // 统一按「本机题号」落 map（消费方按 currentQuestion.id 读）
          const localId = Number((questions.value[idx] as any)?.id)
          if (Number.isFinite(localId)) map.set(localId, state as QuestionState)
        }
      }
      answerStates.value = map
    }

    if (progress.finished) {
      finished.value = true
    } else if (currentOrderIdx >= 0 && !suppressRestoredBanner) {
      restoredBanner.value = true
      setTimeout(() => { restoredBanner.value = false }, 5000)
    }

    await nextTick()
    return 'applied'
  } finally {
    restoring.value = false
  }
}

// 模式切换：重新生成顺序并回到第一题（恢复阶段跳过）
watch(mode, async (m) => {
  if (restoring.value) return
  // 2026-08-16 修复卡死：此前每题 findIndex 扫全表 O(N²)，题库 3000+ 题切换随机/顺序会卡死。
  // 一次构建 id→下标 Map（O(N)），后续全部 O(1) 查表。
  const idxMap = new Map(questions.value.map((q, i) => [q.id, i]))
  const filtered = displayQuestions.value
  if (m === 'random') {
    const ids = shuffle(filtered.map(q => q.id))
    order.value = ids.map(id => idxMap.get(id)).filter((i): i is number => i !== undefined && i >= 0)
  } else if (m === 'wrong') {
    // 错题重练：加载错题 ID，按错题顺序生成 order（再叠加题型筛选）
    try {
      const wrongIds = await api.listWrong(bankId)
      const allowed = new Set(filtered.map(q => q.id))
      order.value = wrongIds.filter(id => allowed.has(id)).map(id => idxMap.get(id)).filter((i): i is number => i !== undefined)
    } catch (e) {
      console.error('加载错题失败：', e)
      order.value = []
    }
  } else {
    order.value = filtered.map(q => idxMap.get(q.id)).filter((i): i is number => i !== undefined && i >= 0)
  }
  current.value = 0
  scheduleSave()
})

// 防抖保存进度
let saveTimer: ReturnType<typeof setTimeout> | null = null
// 2026-10-03：存档守望（防「静默停写」）——实况：某场会话的进度在某一笔之后**一笔没再写**、页面毫无异样
//（错题/已掌握线却正常），用户对着旧进度干瞪眼。口径：有改动置 dirty、落盘成功清 dirty；
// 守望每 45s 与「切回前台」时体检：仍脏且无在途定时器 ⇒ 立即补存；写入/落盘校验失败 ⇒ 页面出横幅可重试。
const dirtySince = ref(0)
const saveWarn = ref('')
let lastSaveTry = 0
let saveWatchTimer: ReturnType<typeof setInterval> | null = null
function scheduleSave() {
  if (restoring.value) return
  if (!loaded.value) return
  // 2026-08-22：计划模式不写入普通练习进度（队列来自计划，避免下次普通练习被计划队列污染）
  if (isPlanMode) return
  dirtySince.value = dirtySince.value || Date.now()
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveProgress, 500)
}
function checkSaveHealth() {
  if (!dirtySince.value) return
  if (restoring.value || !loaded.value || isPlanMode) return
  if (saveTimer) return
  if (Date.now() - lastSaveTry < 8000) return
  console.warn('[practice] 存档守望补存：进度已挂 ' + Math.round((Date.now() - dirtySince.value) / 1000) + 's 未落盘')
  void saveProgress()
}
function onVisibilityChange() {
  // 切后台/可能被冻结或回收前，先硬存一笔；切回前台立即体检
  if (document.visibilityState === 'hidden') { if (dirtySince.value) void saveProgress() }
  else checkSaveHealth()
}
function retrySave() { void saveProgress() }

// 2026-10-03：顶栏同步状态（断网/失败可见、可点重试）——只读云同步模块的内存状态，每 3s 刷一次
const syncStat = ref(getWebSyncStatus())
// 2026-10-07：上次成功**拉取**的时刻 —— 「本机数据有多新」的真值（`state.at` 含只推不拉的轻推，
// 拿它判新鲜度会把「刚推了一条进度」误当成「本机已是最新」）。每次 refreshSyncStat 同步刷新。
const lastPullAtRef = ref(getLastPullAt())
let syncStatTimer: number | null = null
// 状态符（2026-10-07 晚）：☁ 常驻（与首页胶囊同一套）；同步中 ↻ 转、完成 ✓ 轻弹、失败 !、待同步只有云
const syncChipMark = computed(() => {
  const s = syncStat.value
  if (s.state === 'syncing') return '↻'
  if (s.state === 'fail') return '!'
  if (s.state === 'ok') return '✓'
  return ''
})
// 2026-10-07：进库横幅 —— 判据改成「本机可能还没有云端最新进度」（见 lib/sync-notice.ts）。
// 原先判 `state === 'syncing'`，而进页面时同步不启动 ⇒ 那条件几乎凑不出来，横幅一次都没出现过。
// 口径（rabbit 2026-10-07 纠正）：**首次进入练习页时提示一次**，不是每次同步都跳；下次进页面重新判。
// 2026-10-08（rabbit 实测：进库约 1 分钟后横幅会自己冒出来）：评估必须**只在进页面那一刻做一次并冻结**——
// 此前它挂在 3 秒轮询里反复求值，而「距上次拉取 >60s 算可能不最新」会随时间自然翻真 ⇒ 横幅迟到。
// 另：因「正在拉取」弹的横幅，拉完自动收掉（注释一直这么承诺，本版把它做实）。
let noticeEvaluated = false
const noticeShouldShow = ref(false)
let noticeHideWhenPullDone = false
// 2026-10-09：本轮**拉取**开始时的拉取时刻快照。拉取把某一轮「可能读到旧进度」真正解决了 ⇒
// 横幅该收掉；而「拉取前时刻变了」就是这件事的唯一可观测证据（不依赖 isPullInFlight 那一瞬间）。
let pullAtAtEvaluated = 0
function evaluateNotice () {
  if (noticeEvaluated) return                     // 本次进页面只评估一次（进页面那一刻），评完冻结
  noticeEvaluated = true
  pullAtAtEvaluated = lastPullAtRef.value          // 记下评估时刻的拉取点，供 refreshSyncStat 识别「拉完了」
  // 2026-10-08：未配云没有云可同步，判据里「从未成功同步」那条对他们恒真 ⇒ 每次进库都弹、纯添乱。
  // 闸在调用方（与 mp「未打通不提示」对齐；判据本身保持纯函数）。isCloudEnabled 每次现读配置，无缓存。
  if (!isCloudEnabled()) return
  // 2026-10-09（rabbit：要考虑自动拉的 10 分钟冷却，近期同步过就别弹）：本轮**不会**自动拉时
  // （被节流跳过 / 自动同步开关关着），本机数据其实还是刚拉过的样子 ⇒ 不按 1 分钟陈旧窗口抱怨。
  // 用 `.then()` 而不是 await：本函数被 refreshSyncStat 同步调用（3 秒轮询里），不该把它变成 async。
  void autoPullDueOnOpen().then((due) => {
    const st = syncStat.value
    const ok = st.state === 'ok'
    const pulling = isPullInFlight()
    const warn = shouldWarnOnEnter({
      synced: ok,
      // 2026-10-07：判「本机有多新」要用**上次成功拉取**的时刻（`at` 含只推不拉的轻推，会误判成「刚同步过」）
      lastOkAt: ok ? lastPullAtRef.value : 0,
      lastFail: st.state === 'fail',
      // 2026-10-07：用「**拉取**在飞」而不是「任意同步在飞」——只推不拉的轻推也会把 state 点成 syncing，
      // 拿它判「可能读不到上次进度」等于把「正在上传」误报成「正在下载」。
      pullBusy: pulling,
      // 2026-10-09：本轮会不会自动拉（tick 本地累计口径）——不会则本机大概率刚拉过，不必抱怨
      autoPullDue: due,
      now: Date.now(),
    })
    if (warn) {
      noticeShouldShow.value = true
      noticeHideWhenPullDone = pulling               // 仅「因拉取而弹」的：拉完自动收；其余原因留到手动关
    }
  }).catch(() => { /* 判定失败就当作不提示（宁可少说，不可多说） */ })
}
const syncingHint = computed(() => noticeShouldShow.value)
const syncChipText = computed(() => {
  const s = syncStat.value
  if (s.state === 'syncing') return '同步中…'
  if (s.state === 'fail') return '同步失败·点重试'
  // 2026-10-07：与首页胶囊同口径 —— 只推不拉的轻推不算「已同步」，真值取上次成功拉取的时刻。
  const pullAt = lastPullAtRef.value
  if (!pullAt) return '未同步'
  const d = new Date(pullAt)
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `已同步 ${p2(d.getHours())}:${p2(d.getMinutes())}`
})
// 完成轻弹：只在「转变为 ok」那一刻挂 500ms（页面刚打开时已是 ok 不弹）
const justSynced = ref(false)
let justSyncedTimer: number | null = null
function markJustSynced() {
  justSynced.value = true
  if (justSyncedTimer) window.clearTimeout(justSyncedTimer)
  justSyncedTimer = window.setTimeout(() => { justSynced.value = false }, 500)
}
function refreshSyncStat () {
  const prevState = syncStat.value.state
  const next = getWebSyncStatus()
  syncStat.value = next
  lastPullAtRef.value = getLastPullAt()
  if (prevState !== 'ok' && next.state === 'ok') markJustSynced()
  evaluateNotice()   // 只在进页面那一刻评估一次（见 evaluateNotice 注释），之后冻结
  // 2026-10-09（rabbit 实测：点云朵催同步后，横幅照旧杵着）：横幅的两条自动收口，都以
  // **拉取**为准，而不是以「任意同步成功」为准。
  //   ① 因「正在拉取」弹的：拉完（`isPullInFlight()` 转假）就收；
  //   ② 「本机可能没有云端最新」弹的：判据在页面打开那一刻**冻结**了，而此刻真的拉完了
  //      —— 那句「可能读不到上次进度」已经不成立。用「拉取时刻前进」识别这件事：
  //      它在拉取成功时写入（markPulled），且**只推不拉的轻推不写**，所以不会被误判为已拉。
  //   ⚠️ 快照 `pullAtAtEvaluated` 必须**在评估那一刻**取（见 evaluateNotice），不能在轮询里现取
  //      —— 否则快照永远等于当前值，条件恒假、横幅永远收不掉。
  const pulledSinceEval = lastPullAtRef.value !== pullAtAtEvaluated
  const pullSettled = !isPullInFlight()
  if (noticeShouldShow.value && (pullSettled && pulledSinceEval)) {
    noticeShouldShow.value = false
    noticeHideWhenPullDone = false
  } else if (noticeShouldShow.value && noticeHideWhenPullDone && pullSettled) {
    noticeShouldShow.value = false
    noticeHideWhenPullDone = false
  }
}
// 2026-10-09（rabbit 实测：「点云朵 → 文字还是未同步、云朵却变绿了」）。原先这里调的是
// 进度轻推（`pushProgressLight(force)`，只上行、不拉取），两个后果：
//   ① 胶囊文案的真值是「上次成功**拉取**」（webSyncPull.at），轻推不写它
//      ⇒ 点一次云朵，同步确实成功了、云朵也 `state='ok'` 变绿了，可文案**永远停在「未同步」**
//      （默认绿主题下 `--color-primary` 与 `--color-success-strong` 都是绿色 ⇒ 看着就是"没同步却变绿"）；
//   ② 用户在练习页点云朵的动机是「横幅说可能读不到上次进度」——那正是**下行**问题，
//      而轻推只有上行 ⇒ 点完警告还在，问题一点没解决。
// 现口径：点云朵 = **全量双向同步**（与首页胶囊 doHomeSync 同一动作，就是它 title 里写的
// 「点一下立即全量同步（上传+下载）」——练习页此前跟自己的 tooltip 说的不是一回事）。
async function onSyncChipTap () {
  // 已有全量同步在跑：如实提示等待即可，不叠加请求（完成时 3 秒轮询会接住状态与拉取时刻）
  if (syncStat.value.state === 'syncing') { toastInfo('云同步正在进行，稍等几秒'); return }
  refreshSyncStat()
  try {
    const m = await import('../lib/cloud')
    await m.syncAll()
    const st = m.getWebSyncStatus()
    if (st.state === 'fail') { toastError('同步失败：' + (st.msg || '网络或云端异常')); return }
    // 这轮真的拉完了 ⇒ 由 refreshSyncStat 收掉那条「可能读不到上次进度」的横幅
    refreshSyncStat()
    // 云端可能比本机新：把本页进度重读一次，否则界面还停在打开时的旧数字
    await reloadProgressAfterSync()
  } catch (e: any) {
    toastError('同步失败：' + ((e && e.message) || String(e)))
  } finally {
    refreshSyncStat()
  }
}
// 同步后重读本页进度：复用 `restoreProgress()`（它已处理重挂载、答对状态回填、引用解析失败闸门），
// 只是**不该再弹一次「已从上次进度恢复」横幅**——用户此刻在页内，不是刚进页面。故临时置标跳过。
let reloadAfterSyncBusy = false
async function reloadProgressAfterSync () {
  if (reloadAfterSyncBusy) return
  reloadAfterSyncBusy = true
  try {
    if (!questions.value.length) return          // 题目还没载完（与 restoreProgress 的 'not-loaded' 同口径）
    suppressRestoredBanner = true
    await restoreProgress()
  } catch (e: any) {
    console.warn('[practice] 同步后重读进度失败（界面保持原样）', e)
  } finally {
    suppressRestoredBanner = false
    reloadAfterSyncBusy = false
  }
}
let suppressRestoredBanner = false

onMounted(() => {
  saveWatchTimer = setInterval(checkSaveHealth, 45000)
  document.addEventListener('visibilitychange', onVisibilityChange)
  // 本次进页面重新判一次（上次看过的提示不该阻止这次提示）：复位冻结 → 立即评估一次
  noticeEvaluated = false
  noticeShouldShow.value = false
  noticeHideWhenPullDone = false
  refreshSyncStat()
  syncStatTimer = window.setInterval(refreshSyncStat, 3000)
})
onBeforeUnmount(() => {
  if (saveWatchTimer) clearInterval(saveWatchTimer)
  saveWatchTimer = null
  document.removeEventListener('visibilitychange', onVisibilityChange)
  if (syncStatTimer) { window.clearInterval(syncStatTimer); syncStatTimer = null }
})

async function saveProgress() {
  if (!questions.value.length || !order.value.length) return
  // 防重入：守望/切后台的补存可能与防抖保存并发——两次写、后一次赢，先写的那次「落盘校验」会误报失败
  if (saveInFlight) return
  saveInFlight = true
  try {
    await saveProgressInner()
  } finally {
    saveInFlight = false
  }
}
let saveInFlight = false

async function saveProgressInner() {
  const cur = order.value[current.value]
  if (cur === undefined) return
  // 2026-10-07：未就绪闸门 —— 恢复没上、用户也还没答题时不落任何盘（见 restoreUnsettled 注释）。
  // 答出第一题即解除；「重新开始」也在 restart() 里显式解除。
  if (restoreUnsettled.value) {
    if (answerStates.value.size === 0) { dirtySince.value = 0; return }
    restoreUnsettled.value = false
  }
  const progress: SavedProgress = {
    mode: mode.value,
    order_ids: order.value
      .map(i => questions.value[i]?.id)
      .filter((id): id is number => id !== undefined),
    current_id: questions.value[cur].id,
    answer_states: Object.fromEntries(answerStates.value.entries()),
    // 2026-10-03（rabbit 口径）：练到末尾**不再清零**——「做完了」要留下可同步的完成记录。
    // 旧行为（完成即写空串、"下次从头"）会在完成的一瞬把整库进度抹掉，跨端永远等不到"完成"
    //（沙盒实况：完成后落盘 84755 → 0 字节，守卫 tests/practice-save-boundary.mjs 钉住此行为）。
    finished: finished.value,
    saved_at: new Date().toISOString(),
  }
  // 保留「重新开始」标记：本机是故意的空，同步守卫不得用云端旧进度把它顶回来
  if (resetMarked.value) progress._reset = resetMarked.value
  lastSaveTry = Date.now()
  const body = JSON.stringify(progress)
  try {
    if (canTrack.value) {
      await api.setSetting(progressKey.value, body)
      // 落盘校验（2026-10-03）：写成功再读回比对 saved_at——"写丢了还当成功"是静默停写最隐蔽的形态
      const back = await api.getSetting(progressKey.value)
      let landed = false
      try { const p = JSON.parse(back || 'null'); landed = !!(p && p.saved_at === progress.saved_at) } catch { landed = false }
      if (!landed) throw new Error('落盘校验不过（读回与本次不符）')
      // 同步更新全局最近练习记录（首页"继续刷题"卡片使用）
      // 2026-10-07：`_reset` 要跟着指针走——推送侧的防倒退闸门靠它区分「用户点了重新开始」
      // 与「进度被意外写退」（不带标记且位置回到开头 ⇒ 不推，见 sync-ids.ts shouldPushLastPractice）。
      const lastPractice = {
        bank_id: bankId,
        bank_name: bankName.value,
        position: current.value + 1,
        total: questions.value.length,
        saved_at: progress.saved_at,
        ...(resetMarked.value ? { _reset: resetMarked.value } : {}),
      }
      await api.setSetting(LAST_PRACTICE_KEY, JSON.stringify(lastPractice))
    } else {
      // 未订阅的公共库：进度直写 idb，且**不改首页"继续刷题"指向**
      // 2026-10-04 更正：原注释写「不触发云推送」，与代码不符——下面那句轻推是共用的，而进度包是
      // **整包上传**（collectPracticeProgressRow 收所有 practice_progress_* 键），所以这个库的进度
      // 也会随下一次轻推上云。行为照旧，只把话说准（要不要改成"真的不推"是产品口径，另议）。
      await idb.setSetting(progressKey.value, body)
    }
    dirtySince.value = 0
    saveWarn.value = ''
    // 2026-10-07：本机硬存档——落盘成功才写，与网络/同步开关彻底解耦（云端路径不读不写它）
    // 2026-10-07：只有真的入栈了才刷新列表（存档变化 ⇒ 面板计数与按钮可见性要跟上）
    void recordLocalArchive(historyBankRef.value, progress)
      .then((changed) => { if (changed) void refreshArchive() })
      .catch(() => {})
    // 2026-10-07（rabbit：「恢复历史版本完全没用」，实读云端发现最新版本只有 128 题、而他已答 337）：
    // 「进度历史版本」这组的入栈时机原先**只挂在轻推链上**（cloud.ts 的 pushProgressLight →
    // recordProgressHistory），而轻推有 8 秒防抖 + 30 秒最小间隔 + 「自动同步开关」三重闸门
    // ⇒ 关掉自动同步、或保存密集时被防抖吃掉的那一版，**永远不进历史栈**。
    // 结果就是：用户在历史面板里看到的版本比他真实走到的最远处**旧得多**，恢复过去自然像「没用」。
    // 现在改成**与保存同步入栈**（本地写，不依赖网络/开关），轻推那条保留（负责把栈带上云）。
    void import('../lib/cloud').then(m => m.recordHistoryFromLocal(historyBankRef.value, progress))
      .then((changed) => { if (changed) void refreshHistory() })
      .catch(() => {})
    // 2026-10-03：落盘成功后防抖轻推（只推进度/当天统计/续练指针三条设置行；可在设置里关）
    void import('../lib/cloud').then(m => m.scheduleProgressPush()).catch(() => {})
  } catch (e) {
    console.error('保存进度失败：', e)
    saveWarn.value = '⚠️ 进度可能没存上（' + String((e && e.message) || e) + '）——点此立即重试'
  }
}

// 切换当前题目收藏状态
async function onToggleFavorite() {
  const q = currentQuestion.value
  if (!q) return
  // 未订阅的公共库：不记收藏（只练不留痕，防污染）
  if (!canTrack.value) { toastInfo('未订阅的题库不记录收藏与错题'); return }
  try {
    const nowFav = await api.toggleFavorite(bankId, q.id)
    const next = new Set(favoriteIds.value)
    if (nowFav) next.add(q.id)
    else next.delete(q.id)
    favoriteIds.value = next
  } catch (e) {
    console.error('切换收藏失败：', e)
  }
}

// 题目编辑保存后，更新本地 questions 数组并强制重渲染当前题
function onQuestionUpdated(updated: Question) {
  const idx = questions.value.findIndex(q => q.id === updated.id)
  if (idx >= 0) {
    questions.value[idx] = updated
  }
  reloadKey.value++  // 强制 QuestionCard 重新挂载，加载新数据
}

watch([current, finished], scheduleSave)
watch(order, scheduleSave, { deep: true })
// 2026-08-23：切换题目时刷新记忆标签（自动评估基于已答题状态）
watch(current, () => { loadMemoryReviews() })

// 组件卸载前立即保存一次，避免导航离开时丢失最后一次进度
// 全局快捷键处理
function onKeydown(e: KeyboardEvent) {
  // 在输入框/textarea 中不响应
  const t = e.target as HTMLElement
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  if (e.key === '?' || (e.shiftKey && e.key === '/')) {
    e.preventDefault()
    showHelp.value = !showHelp.value
  } else if (e.key === 'Escape') {
    showHelp.value = false
  }
  // BUG-005 修复：移除 F 键分支，由 QuestionCard 单独处理避免双触发
  // 旧实现：父组件 onKeydown + 子组件 handleKeydown 都监听 window keydown，
  // 按一次 F 收藏被切换两次，净效果为未变化
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
    void saveProgress()
  }
})

async function onAnswered(payload: { correct: boolean; answer: string; duration_ms: number | null }) {
  const q = currentQuestion.value
  // 未订阅的公共库：不记练习记录/错题/已掌握/每日统计（只练不留痕，防污染）
  if (!canTrack.value) return
  try {
    const res = await api.recordPractice({ bank_id: bankId, question_id: q.id, user_answer: payload.answer, is_correct: payload.correct, duration_ms: payload.duration_ms })
    // 2026-08-19：连续答对达到阈值 → 自动移入「已掌握」
    if (res?.autoMastered) toastSuccess(`🎉 连续答对 ${res.streak} 次，该题已自动移入「已掌握」`)
    // 累计每日统计（用于热力图）；2026-10-03 起同时累加本题用时
    await bumpDailyRecord(payload.correct, payload.duration_ms)
  } catch (e) {
    console.error('记录练习失败：', e)
  }
  // 2026-08-23：记忆复习全局写入——任何练习模式都更新 SM-2 复习记录（计划模式用同一函数，避免双写冲突）
  try {
    await updateMemoryReview(q.id, payload.correct, payload.duration_ms)
    // 计划模式额外记录今日完成
    if (isPlanMode) {
      await markPlanCompleted(q.id)
    }
  } catch (e) {
    console.error('更新记忆复习记录失败：', e)
  }
}

// 2026-08-23 记忆复习相关状态
// ============================================================
// 记忆自评：自动评估（对错+耗时）→ 显示标签 → 可手动覆盖
// 任何练习模式都写 review_records（此前仅计划模式写）
// ============================================================
// 2026-09-15 修复(P2-10)：标签集合必须与 qualityLabel 的值域**一一对应**。
// 此前只有四个按钮且「模糊」的 q 写 3，而 qualityLabel(2) 也返回「模糊」、labelToQuality('模糊') 返回 3
// → 存为 quality:2 的记录被用户点同一个标签确认后重写成 3，跨越 quality<3 的及格线（失败改判为成功）。
// 标签拆分后若**不补**「勉强」按钮，quality:3 的记录会显示一个没有对应按钮的标签，
// 用户只能点相邻的「模糊」→ 3 被降成 2，同一个缺陷换个方向重现。故这里是五个按钮。
const MEMORY_OPTIONS = [
  { label: '认识', q: 5, hint: '熟练，可拉长复习间隔' },
  { label: '一般', q: 4, hint: '会但不熟' },
  { label: '勉强', q: 3, hint: '想很久才答对' },
  { label: '模糊', q: 2, hint: '接近但没答对' },
  { label: '不认识', q: 1, hint: '完全不会，须尽快复习' },
] as const

// 当前题的记忆记录（questionId → review_record 摘要，供标签展示）
// 2026-09-15(P1-21)：next_review 现在写**纪元毫秒数字**，但用户 IndexedDB 里的历史记录仍是 ISO 串，
// 故类型放宽为 string | number | null，读取一律走 toReviewTs
const memoryReviewMap = ref<Map<number, { quality: number; next_review: string | number | null; interval: number; ease_factor: number }>>(new Map())

const currentMemoryLabel = computed(() => {
  const rec = memoryReviewMap.value.get(currentQuestion.value?.id)
  if (!rec) return null
  return qualityLabel(rec.quality)
})

const memoryNextText = computed(() => {
  const rec = memoryReviewMap.value.get(currentQuestion.value?.id)
  if (!rec) return ''
  // 2026-09-15 修复(P1-21)：原式 `new Date(rec.next_review)` 对数字与 ISO 串都能解析，
  // 但对损坏值会得 Invalid Date 再靠 Number.isNaN 兜；改用 toReviewTs 后与全项目共用同一个解析口径
  //（对历史 ISO 串产出与 new Date(v).getTime() 完全相同的数字，展示不会漂移）
  const ts = rec.next_review ? toReviewTs(rec.next_review) : null
  if (ts === null) return ''
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const due = new Date(ts); due.setHours(0, 0, 0, 0)
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000)
  if (diffDays <= 0) return '今日已到期'
  return `${diffDays} 天后复习`
})

// 手动覆盖记忆质量（写入 SM-2）
async function overrideMemory(label: QualityLabel) {
  const q = currentQuestion.value
  if (!q) return
  try {
    await updateMemoryReview(q.id, undefined, undefined, labelToQuality(label))
    toastInfo(`已标记「${label}」`)
  } catch (e) {
    toastError('标记失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

// 更新单题的 SM-2 复习记录（合并计划模式的 updatePlanReview，全局统一）
// 参数说明：quality 优先级最高；无 quality 时用自动评估（correct + durationMs 推断）
async function updateMemoryReview(questionId: number, correct?: boolean, durationMs?: number | null, explicitQuality?: number) {
  const record = await idb.getReviewRecordByQuestionId(questionId)
  const now = new Date()
  // 记忆评估：显式指定 > 自动评估（对错+耗时） > 兜底（对/错 → 4/1）
  const quality = explicitQuality ?? (correct !== undefined ? calculateAutoQuality(correct, durationMs) : (record?.quality ?? 4))
  const result = calculateNextReview(
    record?.last_review ? new Date(record.last_review) : now,
    quality,
    record?.repetitions ?? 0,
    record?.ease_factor ?? 2.5,
    record?.interval ?? 0
  )
  const data = {
    question_id: questionId,
    bank_id: bankId,
    last_review: now.toISOString(),   // 本次复习时间（2026-08-23 修复：此前误存为 nextReview，导致 isStaleReview 判断失效）
    quality,
    repetitions: result.newRepetitions,
    ease_factor: result.newEaseFactor,
    interval: result.newInterval,
    // 2026-09-15 修复(P1-21)：原为 `result.nextReview.toISOString()`，即「ISO 串 + 锚定上次复习日 +
    // 日历日算术」，与小程序端 practice.vue/review.vue 的「纪元数字 + 锚定当下 + 固定 24h」三处都不同：
    // 迟到 20 天再复习时两端相差 20 天，且锚定上次复习日会算出**已经过去**的日期使该题永远到期；
    // 跨端读取时 `Number("2026-01-01T…")` = NaN，小程序 dueReviews() 的 `<= now` 恒 false。
    // 现统一走 computeNextReviewTs：纪元毫秒数字、锚定本次复习的当下（与 last_review 同一时刻）、
    // 日历日算术、间隔钳在 MAX_INTERVAL_DAYS 内。历史 ISO 串由 toReviewTs 继续读得动。
    next_review: computeNextReviewTs(result.newInterval, now.getTime()),
  }
  if (record?.id != null) {
    await idb.updateReviewRecord(record.id, data)
  } else {
    await idb.addReviewRecord(data)
  }
  // 更新本地标签缓存
  memoryReviewMap.value.set(questionId, { quality, next_review: data.next_review, interval: data.interval, ease_factor: data.ease_factor })
}

// 加载已答题的记忆记录（进入页面/切换题时刷新标签）——仅带已提交答题状态的题
async function loadMemoryReviews() {
  const submittedIds = Array.from(answerStates.value.entries())
    .filter(([, s]) => s.submitted)
    .map(([id]) => id)
  if (!submittedIds.length) return
  try {
    const records = await idb.getReviewRecordsByQuestionIds(submittedIds)
    for (const [id, rec] of records) {
      memoryReviewMap.value.set(id, {
        quality: rec.quality,
        next_review: rec.next_review ?? rec.last_review ?? null,
        interval: rec.interval ?? 0,
        ease_factor: rec.ease_factor ?? 2.5,
      })
    }
    // 对新提交但尚无记录的题，用上次答题状态推断（避免标签空白）
    for (const id of submittedIds) {
      if (!memoryReviewMap.value.has(id)) {
        const st = answerStates.value.get(id)
        if (st) {
          const qc = calculateAutoQuality(st.isCorrect !== false, st.elapsedSecs ? st.elapsedSecs * 1000 : null)
          memoryReviewMap.value.set(id, { quality: qc, next_review: null, interval: 0, ease_factor: 2.5 })
        }
      }
    }
  } catch (e) {
    console.error('加载记忆复习记录失败：', e)
  }
}

// 计划模式：记录今日完成（completed_<planId>_<date>，供 StudyPlanView/首页进度展示）
async function markPlanCompleted(questionId: number) {
  if (!planId.value) return
  const key = `completed_${planId.value}_${formatDate(new Date())}`
  try {
    const raw = localStorage.getItem(key)
    const list: number[] = raw ? JSON.parse(raw) : []
    if (!list.includes(questionId)) {
      list.push(questionId)
      localStorage.setItem(key, JSON.stringify(list))
    }
  } catch (e) {
    console.error('记录计划完成失败：', e)
  }
}

// 累加今日刷题记录到 settings.daily_records
// BUG-008 修复：加前端互斥锁，避免连续答题时 read-modify-write 竞态导致统计丢失
// 旧实现：两次并发 bumpDailyRecord 都读到同一份 records，各自 +1 后写回，后写覆盖先写
let bumpDailyRecordChain: Promise<void> = Promise.resolve()
function bumpDailyRecord(correct: boolean, durationMs: number | null = null): Promise<void> {
  // 串行化：将每次调用接到 chain 末尾，保证不并发
  const run = async () => {
    try {
      const raw = await api.getSetting('daily_records')
      const records: { date: string; total: number; correct: number; duration?: number }[] = raw ? JSON.parse(raw) : []
      const d = new Date()
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      // 2026-10-03：累加本题用时（秒）。duration 是**可选字段**——历史行没有它，
      // 读取侧一律按 0 兜底；只在有值时累加，避免把 null 写进去污染类型。
      const addSecs = msToSecs(durationMs)
      const idx = records.findIndex(r => r.date === today)
      if (idx >= 0) {
        records[idx].total++
        if (correct) records[idx].correct++
        if (addSecs > 0) records[idx].duration = (Number(records[idx].duration) || 0) + addSecs
      } else {
        records.push({ date: today, total: 1, correct: correct ? 1 : 0, ...(addSecs > 0 ? { duration: addSecs } : {}) })
      }
      // 只保留最近 400 天
      const sorted = records.sort((a, b) => a.date.localeCompare(b.date))
      const trimmed = sorted.slice(-400)
      await api.setSetting('daily_records', JSON.stringify(trimmed))
    } catch (e) {
      console.error('更新每日统计失败：', e)
    }
  }
  bumpDailyRecordChain = bumpDailyRecordChain.then(run)
  return bumpDailyRecordChain
}

// P1-10: 搜索题目，跳转到第一个匹配
async function doSearch() {
  const q = searchQuery.value.trim()
  if (!q) {
    clearSearch()
    return
  }
  try {
    const results = await api.searchQuestions(bankId, q, 50)
    searchResults.value = results
    if (results.length > 0) {
      // 跳到第一个匹配的题目
      const firstId = results[0].id
      const idx = order.value.findIndex(i => questions.value[i]?.id === firstId)
      if (idx >= 0) {
        current.value = idx
      }
    }
  } catch (e) {
    toastError('搜索失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

function clearSearch() {
  searchResults.value = null
  searchQuery.value = ''
}

// 高亮关键词：转义 HTML 后用 <mark> 包裹
function highlightText(text: string, keyword: string): string {
  if (!text) return ''
  const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  if (!keyword.trim()) return safe
  const escapedKw = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return safe.replace(new RegExp(escapedKw, 'gi'), m => `<mark>${m}</mark>`)
}

// 跳转到指定题目
function jumpToQuestion(qid: number) {
  const orderIdx = order.value.findIndex(i => questions.value[i]?.id === qid)
  if (orderIdx >= 0) {
    current.value = orderIdx
    nextTick(() => {
      const el = document.querySelector('.qcard')
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }
}

// QuestionCard 状态变化时保存到 Map（切换题目/返回上一题时仍可恢复）
function onStateChange(state: QuestionState) {
  const q = currentQuestion.value
  answerStates.value.set(q.id, state)
  scheduleSave()
}

function next() {
  if (current.value < order.value.length - 1) {
    current.value++
  } else {
    finished.value = true
  }
}

function prev() {
  if (current.value > 0) {
    current.value--
  }
}

function goToQuestion(displayIndex: number) {
  // displayIndex 是 displayQuestions 的下标，需要找到对应 qid，再找到 order 中的 current 位置
  const target = displayQuestions.value[displayIndex]
  if (!target) return
  const orderIdx = order.value.findIndex(i => questions.value[i]?.id === target.id)
  if (orderIdx >= 0) {
    current.value = orderIdx
  }
}

// 导航点状态：current/submitted/correct/wrong/fav
function getDotClass(_listIndex: number, qid: number): string {
  const classes: string[] = []
  // current 通过 qid 比较（因为 listIndex 是 displayQuestions 下标，current 是 order 下标）
  const currentQid = currentQuestion.value?.id
  if (qid === currentQid) classes.push('current')
  const state = answerStates.value.get(qid)
  if (state?.submitted) {
    if (state.isCorrect === true) classes.push('correct')
    else if (state.isCorrect === false) classes.push('wrong')
    else classes.push('submitted')
  }
  if (favoriteIds.value.has(qid)) classes.push('fav')
  return classes.join(' ')
}

const correctCount = computed(() => {
  let c = 0
  for (const s of answerStates.value.values()) if (s.submitted && s.isCorrect === true) c++
  return c
})
const wrongCount = computed(() => {
  let c = 0
  for (const s of answerStates.value.values()) if (s.submitted && s.isCorrect === false) c++
  return c
})
const unansweredCount = computed(() => {
  const submitted = correctCount.value + wrongCount.value
  return Math.max(0, questions.value.length - submitted)
})

// 重新开始：清除进度并重置（练习中点击弹确认；练习完成页点击直接重练）
async function restart() {
  if (!finished.value && !confirm('确定要重新开始吗？当前进度将被清除。')) return
  // 打标：这是**故意的**重置，同步时不把它当成「异常空进度」用云端旧值顶回来
  resetMarked.value = new Date().toISOString()
  // 2026-10-07：用户明确要求重来 ⇒ 解除未就绪闸门（允许随后的保存落盘与指针更新）
  restoreUnsettled.value = false
  restoring.value = true
  current.value = 0
  mode.value = 'order'
  // 2026-08-16：Map 查表避免 O(N²) 卡死
  const idxMap = new Map(questions.value.map((q, i) => [q.id, i]))
  order.value = displayQuestions.value.map(q => idxMap.get(q.id)).filter((i): i is number => i !== undefined && i >= 0)
  answerStates.value = new Map()
  finished.value = false
  restoredBanner.value = false
  reloadKey.value++
  await nextTick()
  restoring.value = false
  await saveProgress()
}
</script>

<style scoped>
/* topbar 合并两排布局 */
.topbar { display: flex; gap: 12px; align-items: center; margin-bottom: 10px; flex-wrap: wrap; padding: 10px 14px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-md); }
.main-bar { padding: 12px 16px; }
.main-left { display: flex; align-items: center; gap: 10px; }
.main-left .bank-name { font-weight: 600; color: var(--color-text); font-size: 15px; }
.main-progress { flex: 1; display: flex; align-items: center; gap: 10px; min-width: 160px; }
.main-progress .progress-text { color: var(--color-text-secondary); font-size: 13px; font-family: monospace; white-space: nowrap; }
.progress-track { flex: 1; height: 6px; background: var(--color-border-light); border-radius: 3px; overflow: hidden; }
.progress-fill { height: 100%; background: linear-gradient(90deg, var(--color-primary), var(--color-primary-dark)); border-radius: 3px; transition: width 0.3s; }
.main-right { display: flex; align-items: center; gap: 8px; }
.tool-bar { font-size: 13px; padding: 8px 14px; }
.info-bar { font-size: 15px; }
.info-bar .bank-name { font-weight: 600; color: var(--color-text); }
.info-bar .progress { color: var(--color-text-secondary); padding: 2px 10px; background: var(--color-border-light); border-radius: var(--radius-sm); font-size: 13px; font-family: monospace; }
.control-bar { padding-bottom: 8px; border-bottom: 1px solid var(--color-border-light); }
.action-bar { justify-content: flex-end; margin-top: 4px; }

.mode-select { padding: 5px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); color: var(--color-text); font-size: 13px; cursor: pointer; }
.help-btn { width: 28px; height: 28px; border-radius: 50%; border: 1px solid var(--color-border); background: var(--color-card); cursor: pointer; font-size: 14px; font-weight: 700; color: var(--color-text-secondary); }
.sync-btn { height: 28px; padding: 0 10px; border-radius: 14px; border: 1px solid var(--color-border); background: var(--color-card); cursor: pointer; font-size: 12px; font-weight: 600; color: var(--color-text-secondary); white-space: nowrap; }
.sync-btn:hover:not(:disabled) { background: var(--color-primary-light); color: var(--color-primary); border-color: var(--color-primary); }
.sync-btn:disabled { opacity: 0.6; cursor: default; }
.help-btn:hover { background: var(--color-primary-light); color: var(--color-primary); border-color: var(--color-primary); }

.type-filter { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.filter-label { font-size: 12px; color: var(--color-text-tertiary); margin-right: 2px; }
.type-chip-btn { padding: 3px 10px; border: 1px solid var(--color-border); border-radius: 12px; background: var(--color-bg); color: var(--color-text-tertiary); font-size: 12px; cursor: pointer; transition: all 0.12s; opacity: 0.5; }
.type-chip-btn.active { background: var(--color-primary-light); color: var(--color-primary); border-color: var(--color-primary); opacity: 1; }
.type-chip-btn:hover { transform: translateY(-1px); }
.filter-hint { font-size: 11px; color: var(--color-warning); margin-left: 6px; }

.help-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 200; animation: helpFadeIn 0.15s; }
.help-modal { background: var(--color-card); border-radius: var(--radius-lg); padding: 24px; min-width: 360px; max-width: 90vw; color: var(--color-text); box-shadow: 0 16px 48px rgba(0,0,0,0.25); }
.help-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.help-header h3 { margin: 0; }
.help-list { display: flex; flex-direction: column; gap: 10px; }
.help-item { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.help-item span { margin-left: auto; color: var(--color-text-secondary); }
.help-item kbd { display: inline-block; padding: 2px 8px; background: var(--color-bg); border: 1px solid var(--color-border); border-bottom-width: 2px; border-radius: 4px; font-family: ui-monospace, Consolas, monospace; font-size: 12px; color: var(--color-text); }
.help-tip { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--color-border-light); color: var(--color-text-tertiary); font-size: 12px; }

@keyframes helpFadeIn { from { opacity: 0; } to { opacity: 1; } }

/* 记忆自评栏 */
.memory-review-bar { margin-top: 12px; padding: 10px 14px; background: var(--color-card); border: 1px dashed var(--color-border); border-radius: var(--radius-md); display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.memory-label { font-size: 12px; color: var(--color-text-secondary); font-weight: 600; }
.memory-quality-btns { display: flex; gap: 6px; flex-wrap: wrap; }
.memory-quality-btn { padding: 4px 12px; border: 1px solid var(--color-border); border-radius: 12px; background: var(--color-bg); color: var(--color-text-secondary); font-size: 12px; cursor: pointer; transition: all 0.12s; }
.memory-quality-btn:hover { transform: translateY(-1px); border-color: var(--color-primary); color: var(--color-primary); }
.memory-quality-btn.active { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
.memory-next { margin-left: auto; font-size: 12px; color: var(--color-text-tertiary); }

/* 2026-10-03：存档守望横幅 + 计划模式提示 */
.save-warn { margin: 8px 0; padding: 9px 12px; border-radius: var(--radius-md); background: var(--color-danger-bg); color: var(--color-danger-deep); font-size: 13px; cursor: pointer; }
.plan-hint { margin: 8px 0; padding: 8px 12px; border-radius: var(--radius-md); background: var(--color-warning-bg); color: var(--color-warning-text); font-size: 12.5px; }

/* 题目导航条 */
.question-nav { margin-top: 18px; padding: 14px 16px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-md); }
.nav-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.nav-title { font-size: 13px; font-weight: 600; color: var(--color-text); }
.nav-stats { display: flex; gap: 10px; font-size: 12px; }
.dot-stat { padding: 1px 8px; border-radius: 10px; }
.dot-stat.correct { background: var(--color-success-bg); color: var(--color-success-deep); }
.dot-stat.wrong { background: var(--color-danger-bg); color: var(--color-danger-deep); }
.dot-stat.unanswered { background: var(--color-border-light); color: var(--color-text-secondary); }
/* 2026-10-02：题号栏按题型分段——滚动容器从 .nav-dots 换成 .nav-groups（外层），每组自带标题行 */
.nav-groups { max-height: 180px; overflow-y: auto; padding: 2px; }
.nav-group { margin-bottom: 6px; }
.nav-group:last-child { margin-bottom: 0; }
.nav-group-title { font-size: 12px; color: var(--color-text-secondary); background: none; border: none; padding: 2px 4px; margin: 2px 0 4px; cursor: pointer; }
.nav-group-title:hover { color: var(--color-primary); }
.nav-dots { display: flex; flex-wrap: wrap; gap: 4px; }
.nav-dot { min-width: 28px; height: 28px; padding: 0 4px; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-card); color: var(--color-text-secondary); font-size: 11px; cursor: pointer; transition: all 0.12s; display: inline-flex; align-items: center; justify-content: center; font-weight: 500; }
.nav-dot:hover { transform: translateY(-1px); box-shadow: 0 2px 6px rgba(0,0,0,0.1); border-color: var(--color-primary); color: var(--color-primary); }
.nav-dot.current { background: var(--color-primary); color: #fff; border-color: var(--color-primary); box-shadow: 0 0 0 2px var(--color-primary-light); }
.nav-dot.correct { background: var(--color-success-bg); color: var(--color-success-deep); border-color: var(--color-success-bg); }
.nav-dot.wrong { background: var(--color-danger-bg); color: var(--color-danger-deep); border-color: var(--color-danger-bg); }
.nav-dot.submitted { background: var(--color-warning-bg); color: var(--color-warning-text); border-color: var(--color-warning-light); }
.nav-dot.fav::after { content: "★"; color: var(--color-warning-strong); font-size: 8px; margin-left: 2px; }
.search-box { display: flex; gap: 4px; align-items: center; }
.search-box input { padding: 5px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-md); width: 200px; max-width: 100%; box-sizing: border-box; background: var(--color-card); color: var(--color-text); font-size: 13px; }
.search-btn { padding: 5px 12px; border: 1px solid var(--color-primary); background: var(--color-primary); color: #fff; border-radius: var(--radius-md); cursor: pointer; font-size: 12px; }
.clear-search-btn { padding: 5px 8px; border: 1px solid var(--color-border); background: var(--color-card); color: var(--color-text-secondary); border-radius: var(--radius-md); cursor: pointer; font-size: 12px; }
.auto-next-toggle { display: flex; align-items: center; gap: 4px; font-size: 13px; cursor: pointer; color: var(--color-text-secondary); }
.auto-next-toggle input { cursor: pointer; }

.restart-btn { padding: 5px 14px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); cursor: pointer; font-size: 13px; color: var(--color-text); }
/* 2026-10-03：同步状态小片（顶栏第二排） */
/* 2026-10-07 晚：☁ 常驻 + 状态随行符（.sc-mark）——「同步中」接主题色 + ↻ 旋转；
   完成轻弹由 pop（justSynced 500ms 闸门）控制；已同步 ✓ 接成功色 */
.sync-chip { padding: 4px 10px; border-radius: 999px; font-size: 12px; color: var(--color-text-secondary); }
.sync-chip .sc-ico, .sync-chip .sc-mark { display: inline-block; }
@keyframes sync-spin { to { transform: rotate(360deg); } }
@keyframes sync-pop { 0% { transform: scale(1); } 50% { transform: scale(1.35); } 100% { transform: scale(1); } }
.sync-chip.syncing { color: var(--color-primary); }
.sync-chip.syncing .sc-mark { animation: sync-spin 1s linear infinite; }
.sync-chip.ok { color: var(--color-success-strong); }
.sync-chip.pop .sc-mark { animation: sync-pop .3s ease; }
.sync-chip.fail { color: var(--color-danger-deep); font-weight: 600; cursor: pointer; }
.restart-btn:hover { background: var(--color-border-light); }

/* 2026-10-05：进度历史入口与面板（回滚）。样式沿用既有 token，无硬编码色值。 */
.history-btn { color: var(--color-primary); border-color: var(--color-primary); }
.hist-mask { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45); display: flex; align-items: center; justify-content: center; z-index: 3000; padding: 20px; }
.hist-panel { background: var(--color-card); border-radius: var(--radius-lg, 12px); padding: 18px 20px; width: 100%; max-width: 480px; max-height: 80vh; overflow-y: auto; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2); }
.hist-head { display: flex; justify-content: space-between; align-items: center; font-size: 15px; font-weight: 600; color: var(--color-text); margin-bottom: 8px; }
.hist-head .close-btn { background: none; border: none; font-size: 20px; cursor: pointer; color: var(--color-text-secondary); padding: 0 4px; line-height: 1; }
.hist-tip { font-size: 12px; color: var(--color-text-secondary); line-height: 1.6; margin: 0 0 14px; }
.hist-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--color-border-light); }
.hist-time { font-size: 14px; color: var(--color-text); }
.hist-meta { font-size: 12px; color: var(--color-text-secondary); margin-top: 2px; }
.hist-btn2 { padding: 5px 12px; border: 1px solid var(--color-primary); border-radius: var(--radius-md); background: var(--color-card); color: var(--color-primary); cursor: pointer; font-size: 12px; white-space: nowrap; }
.hist-btn2:hover:not(:disabled) { background: var(--color-primary-light); }
.hist-btn2:disabled { opacity: 0.5; cursor: not-allowed; }
.hist-empty { font-size: 13px; color: var(--color-text-secondary); padding: 12px 0; }
/* 2026-10-07：硬存档分组标题（与「进度历史版本」区分开，两组数据互相独立） */
.hist-subhead { font-size: 13px; font-weight: 600; color: var(--color-text); margin: 16px 0 6px; padding-top: 12px; border-top: 2px solid var(--color-border-light); }

.search-result-banner { background: var(--color-info-light); color: var(--color-info); padding: 8px 16px; border-radius: var(--radius-md); margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
.search-result-banner b { color: var(--color-primary); font-weight: 600; }
.search-result-list { max-height: 360px; overflow-y: auto; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-md); margin-bottom: 16px; }
.search-result-item { display: flex; align-items: flex-start; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--color-border-light); cursor: pointer; transition: background 0.12s; }
.search-result-item:last-child { border-bottom: none; }
.search-result-item:hover { background: var(--color-primary-light); }
.search-result-idx { color: var(--color-text-tertiary); font-size: 13px; flex-shrink: 0; }
.search-result-text { flex: 1; font-size: 13px; line-height: 1.5; color: var(--color-text); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.search-result-text :deep(mark) { background: var(--color-warning-bg); color: var(--color-warning-text); padding: 0 2px; border-radius: 2px; font-weight: 600; }
.search-result-types { display: flex; gap: 4px; flex-shrink: 0; }
.type-chip { padding: 1px 6px; background: var(--color-border-light); color: var(--color-text-secondary); border-radius: 3px; font-size: 11px; }
.search-result-overflow { padding: 8px 14px; font-size: 12px; color: var(--color-text-tertiary); text-align: center; background: var(--color-bg); border-top: 1px solid var(--color-border-light); }
.restored-banner { background: var(--color-success-light); border: 1px solid var(--color-success); color: var(--color-success); padding: 8px 16px; border-radius: var(--radius-md); margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; font-size: 14px; }
.restored-banner .close-btn { background: none; border: none; font-size: 18px; cursor: pointer; color: var(--color-success); padding: 0 4px; line-height: 1; }
/* 2026-10-07：同步未完成横幅——用警示色与「恢复成功」的绿色横幅区分开 */
.restored-banner.syncing-warn { background: var(--color-warning-light, #fff7e6); border-color: var(--color-warning, #d48806); color: var(--color-warning, #d48806); }
.loading { text-align: center; padding: 48px; color: var(--color-text-tertiary); }
.empty-filter { text-align: center; padding: 48px; color: var(--color-text-tertiary); }
.empty-filter .empty-icon { font-size: 56px; margin-bottom: 10px; opacity: 0.5; }
.empty-filter p { margin-bottom: 16px; }
.finished { text-align: center; padding: 48px; }
.finished button { margin: 8px; padding: 8px 16px; }

/* 移动端适配 */
@media (max-width: 768px) {
  .main-progress { min-width: 100%; }
  .search-box { flex: 1; }
  .search-box input { flex: 1; width: auto; min-width: 0; }
  .help-modal { min-width: 0; width: 92vw; padding: 18px; }
  .main-bar .main-right { flex-wrap: wrap; }
  .topbar { gap: 8px; }
  /* 2026-08-16：手机端隐藏快捷键帮助按钮（无键盘，纯桌面功能） */
  .help-btn { display: none; }
}
</style>
