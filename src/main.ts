import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './style.css'

// 2026-09-15 P2-19 / 复审 MF-1：console 环形缓冲**不在启动路径安装**。
// 原先这里调用 `installLogCapture()`，但它唯一的消费者 `components/FeedbackDialog.vue` 是
// **孤儿组件**（全仓 `grep -rn FeedbackDialog src/` 只剩 log-buffer 的注释，无任何 import/路由/
// 动态组件引用，自 Initial commit 起如此）⇒ 等于为一条用户走不到的路径常驻包装 console.*
// 并长期持有 100 行。现改为由 FeedbackDialog 首次打开时自行安装（见该组件）。
// ⚠️ 「该弹窗要不要挂载/是否删除」是产品决定，已交给控制端→用户裁定，不在本次修复授权内。

createApp(App).use(createPinia()).use(router).mount('#app')

// 2026-09-28（PWA 更新链根治）：sw.js 开着 skipWaiting + clientsClaim ⇒ 新版一装上就**立刻接管本页**，
// 但页面里已经跑着的仍是旧包（旧 index 引的 chunk 名带 hash）。此后再点进任何懒加载路由，浏览器会去
// 取一个**在新版本里已不存在**的 chunk 文件名 ⇒ 404、页面白屏 —— 表现为「刚部署完的改动偶发打不开」。
// 修法：新 SW 接管后刷新一次，让页面与缓存对齐。
//   · 只在「本页加载时已有 controller」时刷（首次安装不刷，省掉一次无意义重载）；
//   · reloaded 闸门防重复触发（controllerchange 可能多次）。
// 代价：部署后正在浏览的用户会被自动刷新一次 —— 与「偶发白屏」比，这是更轻的代价。
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller
  let reloaded = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return
    reloaded = true
    window.location.reload()
  })
}
