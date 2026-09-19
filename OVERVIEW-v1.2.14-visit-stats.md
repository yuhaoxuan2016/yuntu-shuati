# v1.2.14 访问统计功能交付概览

## 做了什么
在刷题宝首页顶部新增「👁 累计访问次数 · 今日访问次数」展示条（方案 A：访问次数 / 设备级 UV，本设备按天去重）。

## 改动文件
- **`src/lib/visit.ts`**（新增）：独立访问统计模块
  - 照抄 `exam.ts` 的 `ensureCloud()` 无配置回退逻辑 —— 新访客（零配置、只收到链接）也用默认 envId `YOUR_ENV_ID` 匿名登录，**任何人打开页面都能贡献计数**，不写 localStorage、不触发云同步推送。
  - 集合 `visit_stats`：文档 `_id='global'`（字段 `total` 累计）/ 本地日期（字段 `today` 今日），均带 `key` 字段，`where({key})` 读取（避开 ACL 下 `doc(id).get()` 被拒）。
  - 计数用 `db.command.inc(1)` 原子自增，文档不存在时降级 `set` 创建。
  - 本设备按天 localStorage（`visit_last_day`）去重，刷新不重复计。
- **`src/views/HomeView.vue`**：import `recordVisit/getVisitStats`；`onMounted` 内先 `recordVisit()` 再 `getVisitStats()` 回填 `visitStats`；模板在 header 下方插入 `.visit-bar` 展示条；新增 `.visit-bar` 样式。读写失败全部静默，绝不影响首页渲染。
- **版本号三处对齐到 v1.2.14**：`package.json`、`SettingsView.vue` 的 `currentVersion` 两处、更新日志模块插入 v1.2.14 条目、`CHANGELOG.md` 插入 v1.2.14。

## 构建部署
- 构建成功（HomeView chunk 重建 `HomeView-1GOvA-22.js`）。
- 部署 59 文件到 COS。
- 线上校验：`HomeView-1GOvA-22.js` 含 `累计访问` / `visit-bar` ✅

## ⚠️ 必须手动做的步骤（唯一的人工操作）
CloudBase 控制台需**新建集合 `visit_stats` 并把 ACL 设为「所有用户可读写」**：
- 原因：新访客（不同匿名 uid）去 `update` 一个由 rabbit 创建的固定文档，会被默认 ACL（仅创建者可写）拒绝 —— 正是此前分析过的隐患 B。
- 影响：若未设，统计功能降级为**仅 rabbit 本人可计数**（别人打开页面不计数），但页面不会崩。
- 为什么不能代码自动建：CloudBase JS SDK 无法直接创建集合，只能在控制台操作。
- 该集合是独立的，与私人数据集合隔离，设「所有人可读写」不影响你的题库/错题/收藏安全。

## 重要说明
- 这是「访问次数(PV) / 设备级 UV」，不是「真·独立自然人」统计。换浏览器、清缓存、用隐身模式会算作新设备（计数 +1）。要做到精确的「真人去重」需引入账号体系（方案 B，未做）。
- 并发极小概率少计 1（计数器初始化竞态），统计展示场景可忽略。

## 线上地址
https://YOUR_ENV_ID-YOUR_APPID.tcloudbaseapp.com
