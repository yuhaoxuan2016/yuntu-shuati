# 刷题宝 PWA v1.2.13 — 数据备份/恢复补全

## 解决的问题
旧版「💾 立即备份」只导出 `题库列表 + 设置`，**漏掉了题目、错题、收藏、练习记录**；且只有备份按钮、**没有导入恢复入口**。用户本地全部刷题成果无法完整备份与恢复。

## 改动清单
| 文件 | 改动 |
|------|------|
| `src/lib/db.ts` | 新增底层辅助 `listAll(store)` / `clearStore(store)` / `bulkPut(store, rows)`（`bulkPut` 用 `put` 保留对象自带 keyPath，autoIncrement 的 `id` 照原值写回，跨表引用不丢） |
| `src/utils/api.ts` | `exportAll()` 升级为全量（v2）：题库 + 题目 + 错题库 + 收藏 + 练习记录 + 设置；新增 `restoreBackup(data, onProgress)` 覆盖式恢复 |
| `src/views/SettingsView.vue` | 数据区新增「📥 导入恢复」按钮 + 隐藏文件选择；二次确认 + 进度反馈 + 成功后刷新 |
| `package.json` / `currentVersion` / `CHANGELOG.md` | 版本号三处对齐至 v1.2.13，更新日志补条目 |

## 关键设计
- **备份**：一次导出 6 张表全套数据（JSON，带 `app/version/exported_at` 元信息）。
- **恢复**：按 `banks→quiz_banks` 等映射遍历，仅清空并写回备份中存在的集合；JSON 非法/空则先校验抛错，避免清空后失败。
- **向后兼容**：旧 v1 格式（仅 banks+settings）恢复时只动这两个集合，其余保留。
- **引用一致性**：恢复时保留原 autoIncrement `id`，`wrong_questions/favorites/practice_records` 中的 `question_id/bank_id` 外键照样成立。

## 验证
- 构建成功（SettingsView chunk 27.29 kB 重建），部署 59 文件到 COS。
- 线上核对：`SettingsView-BQw0ht4E.js` 含 `导入恢复/restoreBackup`；`index-BWZNf0h-.js` 含 `practice_records/wrong_questions/favorites/quiz_banks/bulkPut/clearStore/listAll`。

## 线上地址
https://YOUR_ENV_ID-YOUR_APPID.tcloudbaseapp.com
