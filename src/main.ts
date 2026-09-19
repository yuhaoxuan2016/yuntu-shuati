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
