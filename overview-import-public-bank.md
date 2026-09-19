# 公共题库「添加到我的题库」功能

> 日期：2026-08-09 · 项目：刷题宝 PWA（shuati-pwa）

## 需求
首页公共题库原本只能「开始刷题」（进度仅会话内，无持久化），用户希望获得进度/收藏/错题能力。
经确认采用 **方案 A：导入到我的题库** —— 一次导入后自动获得本地全套功能。

## 改动文件
- `src/utils/api.ts`：新增 `addQuestions(bankId, qs)` 对外批量写入入口（包装 `idb.addQuestions` + `scheduleCloudPush`）
- `src/views/HomeView.vue`：
  - 公共卡片加「＋ 添加到我的题库」按钮 + 导入进度条
  - 新增 `importPublicBank(b)`：拉全量公共题 → 建本地 private 副本 → 剥离公共 `id/bank_id` 分批写入
  - 新增 `isImported(name)`：导入后卡片显示「✓ 已添加到我的题库」绿色标签

## 关键约定
- 导入副本一律 `visibility:'private'`，避免被云同步当成公开题库推到云端污染公共库
- 写入前**必须剥离**公共题的 `id` 与 `bank_id`（与本地自增 keyPath 冲突）
- 大题库（合集 2951 题）分批 250/批写入 + 实时进度，避免单事务过大卡死
- 题目只需 `type/stem/options/answer/analysis/source_index` 字段

## 验证
- `vite build` ✓ 4.24s，HomeView chunk 更新
- `node scripts/deploy-hosting.mjs` ✓ 59 文件部署，清理 19 旧文件
- 线上：`index.html` 200、`HomeView-DsiCBdjY.js` 200
- 线上地址：https://YOUR_ENV_ID-YOUR_APPID.tcloudbaseapp.com
