<template>
  <div class="app">
    <!-- 移动端顶部导航条 -->
    <header class="mobile-header">
      <button class="hamburger" @click="sidebarOpen = true" aria-label="打开菜单">☰</button>
      <div class="mobile-logo">
        <img :src="currentLogoV" class="mobile-logo-img" alt="小兔错题本" @error="onLogoError" />
        <span>小兔错题本</span>
      </div>
      <div class="mobile-header-actions">
        <RouterLink to="/" class="mobile-nav-link" :class="{ active: route.path === '/' }"><span>📖</span></RouterLink>
        <RouterLink to="/settings" class="mobile-nav-link" :class="{ active: route.path === '/settings' }"><span>⚙️</span></RouterLink>
        <button class="mobile-nav-btn" @click="handleShare" aria-label="分享页面">📤</button>
        <button class="mobile-nav-btn" @click="handleRestart" aria-label="刷新页面">🔄</button>
      </div>
    </header>

    <!-- 移动端抽屉遮罩 -->
    <div v-if="sidebarOpen" class="drawer-mask" @click="sidebarOpen = false"></div>

    <aside class="sidebar" :class="{ open: sidebarOpen }">
      <div class="logo">
        <img :src="currentLogoV" class="logo-img" alt="小兔错题本" @error="onLogoError" />
        <span>小兔错题本</span>
      </div>

      <div class="nav-group">
        <div class="nav-group-title">全局</div>
        <nav>
          <RouterLink to="/" @click="sidebarOpen = false"><span class="nav-icon">📖</span><span>题库</span></RouterLink>
          <RouterLink to="/settings" @click="sidebarOpen = false"><span class="nav-icon">⚙️</span><span>设置</span></RouterLink>
        </nav>
      </div>

      <div v-if="currentBank" class="nav-group">
        <div class="nav-group-title">当前题库</div>
        <div class="bank-name">{{ currentBank.name }}</div>
        <nav>
          <RouterLink :to="`/practice/${currentBank.id}`" @click="sidebarOpen = false"><span class="nav-icon">✏️</span><span>练习</span></RouterLink>
          <RouterLink :to="`/wrong/${currentBank.id}`" @click="sidebarOpen = false"><span class="nav-icon">❌</span><span>错题本</span></RouterLink>
          <RouterLink :to="`/favorites/${currentBank.id}`" @click="sidebarOpen = false"><span class="nav-icon">⭐</span><span>收藏</span></RouterLink>
          <RouterLink :to="`/stats/${currentBank.id}`" @click="sidebarOpen = false"><span class="nav-icon">📊</span><span>统计</span></RouterLink>
        </nav>
      </div>

      <div class="sidebar-footer">
        <div class="contact-me" @click="showContact = true">
          <img src="/contact-avatar.png?v=0.2.0" class="contact-avatar" alt="联系我"
               @error="fallbackToPlaceholder($event, '/placeholders/contact-avatar.png')" />
          <span class="contact-text">联系我</span>
        </div>
        <div class="app-actions">
          <button class="app-action-btn share-btn" @click="handleShare">
            <span class="share-icon">📤</span>
            <span class="share-label">分享</span>
          </button>
          <button class="app-action-btn restart-btn" @click="handleRestart">
            <span class="restart-icon">🔄</span>
            <span class="restart-label">刷新</span>
          </button>
        </div>
        <p class="restart-tip">加载不全或卡顿，点此刷新</p>
        <a v-if="icpNumber" class="beian-link" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">{{ icpNumber }}</a>
        <a v-if="gaNumber" class="beian-link" :href="gaLink" target="_blank" rel="noreferrer">
          <img src="/beian-icon.png" class="beian-icon" width="18" height="20" alt="公安备案" />{{ gaNumber }}
        </a>
      </div>
    </aside>
    <main class="content"><RouterView :key="route.fullPath" /></main>

    <!-- 2026-09-25（rabbit 实测停在 1.2.48 旧壳后要求）：发现新版本横幅。
         PWA 的 Service Worker 会连 index.html 一起预缓存，用户会长期停在旧壳里——
         这里定时拿线上 index.html 的入口哈希跟当前页面的比，不一致就提示一次；
         点「刷新」走的是同一套「注销 SW + 清缓存 + reload」。 -->
    <div v-if="updateReady" class="update-bar">
      <span class="update-bar-text">🔔 小兔错题本有新版本</span>
      <button class="update-bar-btn" @click="applyUpdate">点此刷新</button>
      <button class="update-bar-x" title="稍后再说（本次不再提示）" @click="updateReady = false">稍后</button>
    </div>

    <Toast />

    <!-- 联系我二维码弹窗 -->
    <div v-if="showContact" class="contact-modal" @click="showContact = false">
      <div class="contact-modal-content" @click.stop>
        <button class="contact-modal-close" @click="showContact = false">✕</button>
        <div class="qr-placeholder">
          <!-- ⚠️ 二维码不走 fallbackToPlaceholder：那是把一张假码摆给访客扫，比不显示更糟。
               真图缺失（构建时未补入 / 线上 404）时整块收起，只提示不可用。头像那侧仍可兜底。 -->
          <template v-if="qrAvailable">
            <img src="/wechat-qr.png?v=0.3.0" class="qr-avatar" alt="微信二维码"
                 @error="qrAvailable = false" />
            <p>扫码添加 rabbit 微信</p>
          </template>
          <p v-else>二维码暂不可用，请刷新页面重试</p>
        </div>
        <!-- 小程序码：手机端入口。桌面访客扫不了自己的屏幕，所以它是并列项、不是替代品。 -->
        <div class="qr-placeholder">
          <template v-if="mpQrAvailable">
            <img :src="mpQrSrc" class="qr-avatar" alt="小程序码" @error="mpQrAvailable = false" />
            <p>小程序版 · 微信扫码打开</p>
          </template>
          <p v-else>小程序码暂不可用</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { RouterView, RouterLink, useRoute } from 'vue-router'
import { useBankStore } from './stores/bank'
import { autoCheckOnStartup } from './utils/updater'
import { sharePage } from './lib/share'
import { toastSuccess, toastError } from './utils/toast'
import { checkForUpdate } from './lib/update-check'
import Toast from './components/Toast.vue'

const route = useRoute()
const bankStore = useBankStore()
const currentBank = ref<{ id: number; name: string } | null>(null)
const sidebarOpen = ref(false)
const showContact = ref(false)
const qrAvailable = ref(true)
const mpQrAvailable = ref(true)
// 走动态绑定：静态 src 会被构建期当成模块解析，素材不在仓库里会直接构建失败
const mpQrSrc = '/mp-qr.png'

// P2-33：/contact-avatar.png、/wechat-qr.png 是维护者本地素材，被 .gitignore 忽略、
// 不在仓库里 —— 克隆者构建出的站点上它们必然 404。这里回落到随仓库发布的占位件
// （public/placeholders/*.png，被跟踪）。维护者本地放了真图则本段永不触发。
function fallbackToPlaceholder(e: Event, placeholder: string) {
  const img = e.target as HTMLImageElement
  if (img.dataset.fallbackApplied === '1') return // 占位件也失败时不要死循环
  img.dataset.fallbackApplied = '1'
  img.src = placeholder
}

// ICP 备案号：构建时从 .env 注入（VITE_ICP_NUMBER），源码不含真实备案号
const icpNumber = (import.meta.env.VITE_ICP_NUMBER as string) || ''

// 公安备案号同上（VITE_GA_BEIAN_NUMBER，如「X公网安备00000000000000号」）。
// 查询链接由编号里的数字拼出，避免第二个变量与展示文案漂移。
const gaNumber = (import.meta.env.VITE_GA_BEIAN_NUMBER as string) || ''
const gaLink = gaNumber
  ? `https://beian.mps.gov.cn/#/query/webSearch?code=${gaNumber.replace(/\D/g, "")}`
  : ''

// logo 随主题色切换（2026-08-23）：读取 documentElement 的 data-theme-color 选对应主题色版动画 GIF
const themeColor = ref('green')
const logoList: Record<string, string> = {
  green: '/icons/logo-green.gif',
  blue: '/icons/logo-blue.gif',
  purple: '/icons/logo-purple.gif',
  pink: '/icons/logo-pink.gif',
  orange: '/icons/logo-orange.gif',
  teal: '/icons/logo-teal.gif',
  tech: '/icons/logo-tech.gif',
  forest: '/icons/logo-forest.gif',
  space: '/icons/logo-space.gif',
  cloud: '/icons/logo-cloud.gif',
}
const currentLogo = computed(() => logoList[themeColor.value] || logoList.green)
const currentLogoV = computed(() => `${currentLogo.value}?v=0.2.0`)

// 品牌图缺失时收起图片，只留站名（克隆者的构建里没有这些素材）
function onLogoError(e: Event) {
  const img = e.target as HTMLImageElement
  img.style.display = 'none'
}

function syncThemeColor() {
  themeColor.value = (document.documentElement.getAttribute('data-theme-color') || 'green')
}
// 监听 data-theme-color 变化，logo 即时切换
let themeObserver: MutationObserver | null = null
onMounted(() => {
  syncThemeColor()
  // 2026-09-07 修复：刷新后恢复已保存的外观（明暗/主题色/字号），
  // 此前只在设置页 onMounted 恢复，导致不进设置页就一直停在默认绿
  import('./lib/theme').then(m => m.restoreAppearance()).catch(() => {})
  themeObserver = new MutationObserver(syncThemeColor)
  themeObserver.observe(document.documentElement, {
    attributes: true, attributeFilter: ['data-theme-color'],
  })
})
onBeforeUnmount(() => { themeObserver?.disconnect() })

// 路由变化自动关闭抽屉（移动端点击导航后）
watch(() => route.fullPath, () => { sidebarOpen.value = false })

async function refreshBankNav() {
  const bankId = Number(route.params.bankId)
  if (!bankId) {
    currentBank.value = null
    return
  }
  // 确保题库列表已加载
  if (!bankStore.banks.length) {
    try { await bankStore.load() } catch (e) { /* ignore */ }
  }
  const bank = bankStore.banks.find(b => b.id === bankId)
  currentBank.value = bank ? { id: bank.id, name: bank.name } : null
}

watch(() => route.params.bankId, refreshBankNav, { immediate: true })

// 启动 3 秒后后台检查更新
onMounted(() => {
  autoCheckOnStartup().catch(e => console.error('启动检查更新失败：', e))
})

// 新版本检测的排程（dev 不启：入口没哈希）。装载后 20 秒首查，之后每 20 分钟；
// 切回前台/窗口聚焦再查一次——手机端「切回来」是最常见的时机。
onMounted(() => {
  if (import.meta.env.DEV) return
  updateTimer = window.setTimeout(() => { pokeUpdate(); updateTimer = window.setInterval(pokeUpdate, 20 * 60 * 1000) }, 20000)
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('focus', onFocus)
})
onBeforeUnmount(() => {
  if (updateTimer !== null) { window.clearTimeout(updateTimer); window.clearInterval(updateTimer) }
  document.removeEventListener('visibilitychange', onVisible)
  window.removeEventListener('focus', onFocus)
})

// 全局分享：读当前页面动态标题（考试页会覆盖为考试名），手机端调系统面板、桌面端复制链接
async function handleShare() {
  const url = location.href
  const title = document.title || '小兔错题本'
  const res = await sharePage({ title, text: '导题 刷题 考试，就用小兔错题本', url })
  if (res === 'copied') toastSuccess('链接已复制，去粘贴分享吧~')
  else if (res === 'failed') toastError('分享失败，请手动复制地址栏链接')
}

// @ts-ignore
async function handleRestart() {
  if (!confirm('确认重启应用吗？（将强制刷新并清除缓存）')) return
  await forceRefresh()
}

// 强刷：注销所有 Service Worker + 清 CacheStorage → reload。刷新按钮与新版本横幅共用这一条路。
async function forceRefresh() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map(r => r.unregister()))
      if (window.caches && typeof caches.keys === 'function') {
        const keys = await caches.keys()
        await Promise.all(keys.map(k => caches.delete(k)))
      }
    }
    location.reload()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg) {
      const div = document.createElement('div')
      div.style.cssText = 'position:fixed;top:24px;right:24px;padding:10px 16px;background:#fee2e2;color:#b91c1c;border-radius:6px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.15);max-width:340px;'
      div.textContent = '刷新失败：' + msg + '。请手动关闭并重新打开应用。'
      document.body.appendChild(div)
      setTimeout(() => div.remove(), 5000)
    }
  }
}

// ===== 新版本检测（2026-09-25）=====
// 判据在 lib/update-check.ts（拿线上 index.html 的入口哈希与当前页面的对比）。
// 频率：装载后 20 秒查一次（首屏别抢带宽），此后每 20 分钟一次，另外切回前台/窗口聚焦时各查一次
// （手机端切回来是最常见的时机）。dev 下不查——入口是 /src/main.ts，没有哈希可比。
const updateReady = ref(false)
let updateTimer: number | null = null

async function pokeUpdate() {
  try {
    const outdated = await checkForUpdate()
    if (outdated) updateReady.value = true
  } catch { /* 检查失败就当没有新版，别打扰用户 */ }
}

function onVisible() {
  if (document.visibilityState === 'visible') pokeUpdate()
}

// focus 单独一支：窗口重新聚焦本身就意味着「回到前台」，不再要求 visibilityState（那条判据在
// 无头/隐藏页里恒为 hidden，会让这个入口永远测不到）。
function onFocus() { pokeUpdate() }

function applyUpdate() {
  updateReady.value = false
  forceRefresh()
}
</script>

<style>
.app { display: flex; height: 100vh; }
.sidebar { width: 200px; background: var(--color-sidebar-bg); padding: 16px; border-right: 1px solid var(--color-border); overflow-y: auto; display: flex; flex-direction: column; }
.logo { display: flex; align-items: center; gap: 8px; font-size: 18px; margin: 0 0 20px 0; color: var(--color-primary); padding: 4px 12px; font-weight: 700; letter-spacing: 0.5px; }
.logo-img { width: 32px; height: 32px; border-radius: 6px; object-fit: cover; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1); }
.logo-icon { font-size: 22px; }
.nav-icon { display: inline-block; width: 18px; text-align: center; margin-right: 4px; font-size: 14px; }

.nav-group { margin-bottom: 20px; }
.nav-group-title { font-size: 11px; color: var(--color-text-tertiary); margin-bottom: 6px; padding: 0 12px; letter-spacing: 1px; text-transform: uppercase; font-weight: 600; }
.bank-name { font-size: 13px; color: var(--color-text-secondary); margin-bottom: 6px; padding: 0 12px; word-break: break-all; font-weight: 500; }

.sidebar nav { display: flex; flex-direction: column; gap: 2px; }
.sidebar nav a { text-decoration: none; color: var(--color-text); padding: 7px 12px; border-radius: var(--radius-md); font-size: 14px; transition: background 0.12s; }
.sidebar nav a:hover { background: var(--color-border-light); }
.sidebar nav a.router-link-active { background: var(--color-primary); color: #fff; }

.content { flex: 1; overflow: auto; padding: 24px; }

.sidebar-footer {
  margin-top: auto;
  padding: 12px 12px 4px;
  border-top: 1px solid var(--color-border-light);
}
.app-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.app-action-btn {
  flex: 1;
  padding: 6px 0;
  border: 1px solid var(--color-border-light);
  background: var(--color-card);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: 16px;
  color: var(--color-text-secondary);
  transition: all 0.15s;
}
.app-action-btn:hover {
  background: var(--color-primary-light);
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.share-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.share-icon { font-size: 16px; }
.share-label { font-size: 14px; font-weight: 600; }
.restart-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.restart-icon { font-size: 16px; }
.restart-label { font-size: 14px; font-weight: 600; }
.restart-tip {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--color-text-tertiary);
  text-align: center;
}

/* 备案号（ICP / 公安备案） */
.beian-link {
  display: block;
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--color-text-tertiary);
  text-align: center;
  text-decoration: none;
}
.beian-link:hover { color: var(--color-text-secondary); text-decoration: underline; }
.beian-icon { width: 18px; height: 20px; margin-right: 4px; vertical-align: -5px; }

/* 联系我 */
.contact-me {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  margin-bottom: 8px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 0.15s;
  color: var(--color-text-secondary);
}
.contact-me:hover {
  background: var(--color-primary-light);
  color: var(--color-primary);
}
.contact-avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid var(--color-primary);
  background: #fff;
}
.contact-text {
  font-size: 14px;
  font-weight: 600;
}

/* 联系我弹窗 */
.contact-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  padding: 20px;
}
.contact-modal-content {
  position: relative;
  background: var(--color-card, #fff);
  border-radius: var(--radius-lg, 12px);
  padding: 28px 24px;
  width: 320px;
  max-width: 90vw;
  /* 2026-09-18：并列放进小程序码之后框变高了。矮屏（横屏手机/小窗）上两张码会顶出可视区，
     而 .contact-modal 是 flex 居中、没有滚动兜底 ⇒ 这里给内容框自己加滚动。 */
  max-height: 90vh;
  overflow-y: auto;
  text-align: center;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
}
.contact-modal-close {
  position: absolute;
  top: 10px;
  right: 12px;
  background: none;
  border: none;
  font-size: 18px;
  color: var(--color-text-tertiary);
  cursor: pointer;
  padding: 4px;
  line-height: 1;
}
.contact-modal-close:hover {
  color: var(--color-text);
}
.qr-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 16px;
  border: 2px dashed var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg, #f8f9fa);
}
/* 两张码并列时的间距（微信码 / 小程序码） */
.qr-placeholder + .qr-placeholder {
  margin-top: 12px;
}
/* 2026-09-18 修复（重审 B-06）：下面这条规则曾把二维码按**头像样式**渲染，扫码必失败，三重叠加：
   ① `width/height:120px` 把一张 **1094×1625 的竖图**压进正方形框（原图实测，且它其实是 JPEG 冒名 .png）；
   ② `object-fit: cover` 于是只保留中间一块、上下各裁掉约三分之一；
   ③ `border-radius:50%` 再切成圆，**正好吃掉二维码的三个定位角**——那是扫码识别唯一依赖的东西。
   ⇒ 全站「唯一的用户联系入口」实际不可用（用户只能手动输微信号）。
   改法：不强制正方形，让图**按自身比例**缩放（`width:100% + height:auto`），
   并给 `max-height` 做小屏兜底（弹窗 .contact-modal 是 flex 居中、没有滚动兜底，撑破就看不到内容）。 */
.qr-avatar {
  width: 100%;
  max-width: 236px;
  height: auto;
  max-height: 36vh;
  border-radius: 8px;
  border: 3px solid var(--color-primary);
  background: #fff;
}
.qr-placeholder p {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
}

/* ============ 移动端适配（≤768px） ============ */
.mobile-header { display: none; }
.drawer-mask { display: none; }

@media (max-width: 768px) {
  .mobile-header {
    display: flex;
    align-items: center;
    gap: 10px;
    position: sticky;
    top: 0;
    z-index: 60;
    height: 52px;
    padding: 0 12px;
    background: var(--color-sidebar-bg);
    border-bottom: 1px solid var(--color-border);
  }
  .hamburger {
    font-size: 20px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 6px 8px;
    color: var(--color-text);
    border-radius: var(--radius-sm);
  }
  .hamburger:active { background: var(--color-border-light); }
  /* 2026-09-24：同一类事故的第二个实例——320px 宽的机器上，品牌名被右侧动作按钮挤成
     「小/兔错/题本」三行（窄屏普查扫出来的）。既然这一行不能换行，就让品牌名自己省略号收尾：
     允许收缩（min-width:0，否则 flex 会顶掉右侧按钮），单行 + 溢出省略。 */
  .mobile-logo { display: flex; align-items: center; gap: 6px; font-size: 16px; font-weight: 700; color: var(--color-primary); flex: 1; min-width: 0; }
  .mobile-logo span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mobile-logo-img { width: 26px; height: 26px; border-radius: 5px; }
  .mobile-header-actions { display: flex; gap: 4px; }
  .mobile-nav-link {
    text-decoration: none;
    font-size: 18px;
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
  }
  .mobile-nav-link.active { background: var(--color-primary-light); }
  .mobile-nav-btn {
    font-size: 18px;
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    background: none;
    border: none;
    cursor: pointer;
    color: var(--color-text-secondary);
    line-height: 1;
  }
  .mobile-nav-btn:active { background: var(--color-border-light); }

  .app { flex-direction: column; height: 100vh; }
  .sidebar {
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    z-index: 70;
    width: 240px;
    transform: translateX(-100%);
    transition: transform 0.25s ease;
    box-shadow: 4px 0 16px rgba(0, 0, 0, 0.12);
  }
  .sidebar.open { transform: translateX(0); }
  .drawer-mask {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 65;
  }
  .content { padding: 14px; }
  .content { overflow-y: auto; -webkit-overflow-scrolling: touch; }
}

/* 2026-09-25：新版本横幅（固定底部居中，不遮移动端顶部导航） */
.update-bar {
  position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%);
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  max-width: calc(100vw - 24px); padding: 10px 14px; z-index: 95;
  background: var(--color-card, #fff); color: var(--color-text);
  border: 1px solid var(--color-border, #e5e7eb); border-radius: 999px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.14);
}
.update-bar-text { font-size: 13px; }
.update-bar-btn {
  padding: 5px 14px; font-size: 13px; cursor: pointer; color: #fff;
  background: var(--color-primary); border: none; border-radius: 999px;
}
.update-bar-btn:hover { background: var(--color-primary-dark); }
.update-bar-x {
  padding: 4px 8px; font-size: 12px; cursor: pointer; color: var(--color-text-muted, #6b7280);
  background: transparent; border: none;
}
</style>
