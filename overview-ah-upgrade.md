# 5-8 选项多选（A-H）升级 — 完成总结

## 任务背景

rabbit 提供真实电力行业题库（`D:/普考题库合并/技师_题库.txt`、`高级_题库.txt`）并要求验证解析器，同时追问「超过四个选项的多选能正常识别吗？」。

## 一、真实题库验证结论（任务 #32）

| 题库 | 总题数 | 单选 | 多选 | 判断 | 缺失答案 | 未识别题型 |
|------|--------|------|------|------|---------|-----------|
| 技师 | 820 | 292 | 192 | 336 | 0 | 0 |
| 高级 | 793 | 283 | 177 | 333 | 0 | 0 |

- 题型分布与题库分区标题（「单选题（共292题）」等）**完全吻合**
- **发现 BUG**：技师 9 处 + 高级 11 处题目答案含 E/F/G/H（如「轻瓦斯动作的原因可能是」答案=`ABCDEF`），但原题有 A-F **六个选项**——旧解析器 `RE_OPT` 只认 A-D，**E/F 选项行被丢弃**，导致选项缺失 + 判分必错

## 二、A-H 升级修复（任务 #33）

4 处 A-D 硬编码放宽到 A-H：

| 文件 | 位置 | 改动 |
|------|------|------|
| `src/lib/parser.ts` | RE_OPT / RE_OPT_MARK / RE_ANS_EXTRACT / RE_PAREN_ANS | `[A-D]` → `[A-H]`，答案字母 `{0,3}` → `{0,7}` |
| `src/components/QuestionCard.vue` | parseAnswerLetters（练习判分） | `/[A-D]/i` → `/[A-H]/i` |
| `src/lib/exam.ts` | parseAnswerLetters（考试判分） | `/[A-Da-d]/` → `/[A-Ha-h]/` |
| `src/lib/ai.ts` | RE_ANS_ITEM + extractAnswerMap | `[A-Da-d]` → `[A-Ha-h]` |

修复后真实题库复测：技师 E-H 选项题 0→11，高级 0→13，选项全部完整保留。

## 三、测试与部署

- `scripts/test-parser.mjs`：39 → **50 断言**全绿（新增 6 选项 ABCDEF、8 选项 A-H 场景）
- `scripts/test-ai.mjs`：31 → **39 断言**全绿（新增 E-H 答案提取场景）
- `scripts/test-real-banks.mjs`：新增真实题库验证脚本（可复用）
- 构建：前台执行（后台+管道会 hang），产物含 A-H 已确认
- 部署：46 文件上线，19 旧文件清理
- 线上地址：https://YOUR_ENV_ID-YOUR_APPID.tcloudbaseapp.com

## 遗留事项

- 判断题选项式 `RE_JUDGE_OPT` 保持 A-D（判断题固定 2 选项）
- 用户强刷（Ctrl+Shift+R）即可加载新版本（PWA 缓存）
