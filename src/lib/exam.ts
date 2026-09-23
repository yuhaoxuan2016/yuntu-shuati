// 多人考试模块：创建考试 / 答题 / 成绩管理（基于 CloudBase 云数据库）
// 数据模型：
//   exams        考试配置（题目清单/时长/创建者/状态）
//   exam_results 考生答卷（exam_id/姓名/答案/成绩/时间）
//
// 未配置 CloudBase 时自动降级为"本地演示模式"（仅本机可用，方便开发测试）

import { idb, readPublicQuestionCache, writePublicQuestionCache } from './db'

// 统一错误格式化：CloudBase 常抛普通对象（非 Error 实例），直接 String() 会得到 "[object Object]"
export function errMsg(e: any): string {
  if (e == null) return '未知错误'
  if (e instanceof Error) return e.message
  if (typeof e === 'object') {
    try {
      return (e as any).message || (e as any).errMsg || (e as any).error || JSON.stringify(e)
    } catch {
      return String(e)
    }
  }
  return String(e)
}

// ===== 题型识别（统一 content-based） =====
// 关键：云端判断题实际存储为 type:'single' + options["正确","错误"] + answer "A"/"B"，
// 直接按 q.type 过滤会把判断题当单选、且永远抽不到 type:'judge'。这里按内容判定。
// 2026-09-18 修复（G-2/D-03）第二半：原集合缺 `是`/`否`，而小程序 yuntu-mp/src/lib/quiz.ts:18-19
//   的 JUDGE_TRUE/JUDGE_FALSE 一直含它们 ⇒ 端之间第二处不同口径。只补 isJudgeLike 不够：
//   `["是","否"]` 被识别成判断题后，`judgeAnswerBool` 里 `trueFirst = isJudgeWord(options[0], JUDGE_TRUE_WORDS)`
//   仍把「是」当非真值词 ⇒ **真值反向**（实测点真、点假都判错）。两半都补齐才与小程序端一致。
const JUDGE_TRUE_WORDS = new Set(['正确', '对', '√', 'true', 'TRUE', 'True', 't', 'T', '是'])
const JUDGE_FALSE_WORDS = new Set(['错误', '错', '×', 'false', 'FALSE', 'False', 'f', 'F', '否'])
const JUDGE_WORDS = new Set([...JUDGE_TRUE_WORDS, ...JUDGE_FALSE_WORDS])

// 剥离选项的字母前缀："A. 正确" → "正确"
// 2026-09-14 抽出(P1-5)：解析器存选项时写成 `${字母}. ${文本}`（parser.ts:471），此前只有
// isJudgeLike 剥前缀、classifyQuestionType 不剥，于是同一道带前缀的判断题在**同一个文件里**
// 被判成两种题型（组卷时 judge 配额静默欠填、single 桶被污染）。两处共用这一个 helper。
const RE_OPT_PREFIX = /^[A-H][.、:：)]?\s*/i
export function stripOptionPrefix(opt: any): string {
  return String(opt ?? '').replace(RE_OPT_PREFIX, '').trim()
}

// 判断词命中判定：**原值**或**剥字母前缀后**任一命中即算命中。
// 2026-09-15 修复(评审 Important)：RE_OPT_PREFIX 的分隔符是**可选**的（`[.、:：)]?`），故裸的 F/f 也会被
// 剥掉——`"false"→"alse"`、`"F"`/`"f"→""`。只查剥前缀后的值，会让 ["true","false"]、["T","F"] 这类
// **英文判断词选项对**从 judge 掉回 single。而 Task 2 之前网页端查的是原值（`JUDGE_WORDS.has(o)`）、
// 小程序端查的是拼接子串（`/…|true|false/i`），两端都判 judge → 这是本次修复引入的 GC11 回归
// （不得削弱现有行为）：小程序端 isAnswerCorrect 的 judge 分支以 classifyType 为门，掉回 single 后
// 该题以 A/B 选项列表渲染而非 √/×，答案写 "F" 时更是永远判不对。
// 改成「原值 or 剥前缀」是**纯粹放宽**，不会识别掉任何原本能识别的形态：
//   P1-5 要的 "A. 正确"  → 原值不命中、剥前缀后命中 ✓
//   P1-1 排除的 ["A. 面向对象","B. 面向过程"] → 两条都不命中 ✓（仍不是判断题）
function isJudgeWord(opt: any, set: Set<string>): boolean {
  const raw = String(opt ?? '').trim()
  return set.has(raw) || set.has(stripOptionPrefix(raw))
}

// 多选答案归一：剥掉分隔符（`,`、`，`、`、`、`;`、空白、`/`、`-` 等一切非字母数字字符，
// 中文也在此列）与英文口水词，得到「只剩答案本体」的串。
// 2026-09-14 新增(P1-4 修复轮，控制器裁定)：P1-4 要求把字母计数收窄为整体锚定的 /^[A-Ha-h]{2,}$/，
// 但 P1-3 又要求 "AB都对"、"A,B" 这类真实写法仍识别为 multi——两者对**原始串**互斥。
// 先归一再锚定即可同时满足：
//   "AB都对" → "AB"  → multi          "A,B" → "AB" → multi
//   "CH4"    → "CH4" → 含数字，不命中  "NaOH" → 含 N/O（A-H 之外），不命中
// 安全性：归一只做删除，故归一后含 ≥2 个 A-H 字母 ⇒ 归一前必然也含 ≥2 个。即新判据是旧判据
// （match(/[A-Ha-h]/g).length > 1）的**真子集**，只会少判 multi、绝不会新造 multi。
// and/or/both/all 四个英文词每个都含 A-H 之外的字母（n/r/t/l），剥掉不可能误伤纯字母答案。
const RE_MULTI_NOISE = /[^A-Za-z0-9]+/g
const RE_MULTI_FILLER = /and|or|both|all/gi
export function normalizeMultiAnswer(ans: any): string {
  return String(ans ?? '').replace(RE_MULTI_NOISE, '').replace(RE_MULTI_FILLER, '')
}

export function classifyQuestionType(q: { type?: string | null; options?: string | null; answer?: string | null }): 'single' | 'multi' | 'judge' | 'blank' | 'qa' {
  let opts: string[] | null = null
  try {
    const p = JSON.parse(q.options || '[]')
    if (Array.isArray(p)) opts = p.map((o: any) => String(o).trim())
  } catch { opts = null }
  // 判断题：选项恰为「正确/错误」类二元组（P1-5 剥字母前缀 + 原值双查，见 isJudgeWord），或答案本身是判断词
  if (opts && opts.length === 2 && opts.every(o => isJudgeWord(o, JUDGE_WORDS))) return 'judge'
  const ans = String(q.answer ?? '').trim()
  if (JUDGE_WORDS.has(ans)) return 'judge'
  const t = String(q.type ?? '').toLowerCase()
  if (t.includes('multi') || t === '多选') return 'multi'
  // 2026-09-14 修复(P1-4)：声明类型的判断必须**先于**兜底启发式。原顺序下填空题答案只要
  // 含 2 个以上 a-h 字母就被归入 multi——真实触发值 CH4(C,H)、DNA(D,A)、NaOH(a,H)、CaCO3、
  // Fe2O3（[A-Ha-h] 刻意含小写，化学/生物答案最易中招），后果是组卷 blank 配额饿死。
  // P1-4 的第二半（把启发式收窄为整体锚定）见函数末尾的 normalizeMultiAnswer + /^[A-Ha-h]{2,}$/；
  // 两道防线都要在：声明类型挡住「已标 blank/qa 的题」，收窄挡住「未标类型的历史题」。
  if (t.includes('judge') || t === '判断') return 'judge'
  // 2026-08-15 修复：qa 独立于 blank（此前合并为 blank，问答题显示成填空）
  if (t.includes('blank') || t === '填空') return 'blank'
  if (t.includes('qa') || t === '问答' || t === '简答') return 'qa'
  // 无声明类型时的兜底启发式（P1-4 修复轮：先归一再整体锚定，见 normalizeMultiAnswer 注释）。
  // 收窄后 CH4/DNA/NaOH/CaCO3/Fe2O3 这类填空答案不再落入 multi（组卷 blank 配额不再被偷），
  // 而 "AB都对"/"A,B"/"ab" 仍是 multi（P1-3 的要求）。小程序端 quiz.ts 用逐字相同的归一与正则，
  // 两端才对得齐。
  // **已知残留（2026-09-15 评审 Minor，勿当成 P1-4 已完全关闭）**：锚定正则是**大小写不敏感**的，
  // 故「只由 a-h 字母构成的双字母化学元素符号」在未声明题型时仍会被判成 multi —— Ca、Fe、Ba、He、Be。
  // 这个歧义是**固有**的：要把元素 "Ca" 与选项对 "CA" 分开，就必须区分大小写，而那会打破 P1-3
  // 强制要求的 "ab"（小写）仍是 multi。二者不可兼得，此处选择保住 P1-3。
  // 后续任务（尤其组卷/healQuestion）**不要**假设 P1-4 已彻底修完。
  if (/^[A-Ha-h]{2,}$/.test(normalizeMultiAnswer(ans))) return 'multi'
  return 'single'
}

// 判断题答案统一为 'true'/'false'（A=首个选项对应的真值，兼容 answer 直接存判断词）
// 2026-08-23 修复：空答案默认返回 '' 而非 'true'，避免误判为正确
export function judgeAnswerBool(ans: string | null, options: string[] | null): string {
  // 2026-09-14 修复(P0-8 修复轮，Item 1)：选项可能是解析器产出的 "A. 正确"（parser.ts:471），
  // 直接拿整串查 JUDGE_TRUE_WORDS 必然落空 → trueFirst=false → 字母答案 "A" 被算成 'false'，真值反向。
  // 后果是网页端「考试判分」（checkAnswer/gradeByState 走这里）与「练习卡片」判分相反
  // ——练习卡片当时另有一份剥前缀的局部实现。⚠️ 该局部副本已在 Task 6 被删除（QuestionCard
  // 现直接调用本文件导出的 judgeAnswerBool），故此处**不再有第二份实现**，也不要按行号去找它。
  // 复用本文件已抽出的 stripOptionPrefix()（P1-5），不再新增第二份前缀正则；
  // 小程序端 quiz.ts 的 judgeAnswerBool（同名函数）用同一口径。
  // 2026-09-15 修复(评审 Important)：改用 isJudgeWord（原值 or 剥前缀双查）。此前只查剥前缀后的值，
  // 首选项是无前缀英文假值词时靠**巧合**得到正确结果——"false" 被剥成 "alse"、两个集合都不命中，
  // trueFirst 退化为 false，而「假值词在前」的正确答案恰好就是 false。放宽后不再依赖这个巧合。
  const trueFirst = !!options && options.length >= 1 && isJudgeWord(options[0], JUDGE_TRUE_WORDS)
  const v = String(ans ?? '').trim().toUpperCase()
  if (!v) return ''  // 空答案不默认判对
  if (v === 'A') return trueFirst ? 'true' : 'false'
  if (v === 'B') return trueFirst ? 'false' : 'true'
  if (JUDGE_TRUE_WORDS.has(String(ans ?? '').trim())) return 'true'
  if (JUDGE_FALSE_WORDS.has(String(ans ?? '').trim())) return 'false'
  return ''  // 无法识别的判断词不默认判对
}

// 智能组卷配额模板已迁到 src/lib/compose-template.ts（题库 ID 由 VITE_PUBLIC_BANKS 注入，
// 不写死在代码里）。原 COMPOSE_SPEC 常量已无引用，2026-09-23 删除。

export interface ExamQuestion {
  // 题目身份键。本地题目库是数字 id；云端公共题库的题目走 listPublicBankQuestions 映射，
  // 取值顺序是 `_local_id ?? id ?? _id`。
  //
  // 2026-09-15 实测（scripts/all-questions.json：真实云端导出 7049 条，导出于 2026-08-08）：
  //   · **全部 7049 条都没有 `id` 字段** —— 印证 `cloud.ts:317`「push 时 id 被删、只留 _id + _local_id」；
  //   · **全部 7049 条都有 `_local_id`**，defaultSpec() 五库（初级/中级/高级/技师/安规）无一例外，
  //     安规库的 1147 条也全带。
  // 所以今天 `id` 实际总是解析成 `_local_id`（数字），最后那个 `?? _id` 兜底**并未被触发**。
  // ⚠️ 更正一条曾经写在这里的错误断言：`cloud.ts:548` 那句「云端题库无 _local_id（如某安规库）」
  // 说的是 **`quiz_banks` 集合里的题库文档**（`cloud.ts:11-19` 的 `CLOUD_COLLECTIONS` 里根本没有
  // 题库 ID 那个前缀的集合；它是**题库文档的 `_id`**，被题目文档用作 `bank_ref`），
  // 不是 `questions` 集合里的题目文档；把它当成「安规的题目没有 _local_id」是误读，实测相反。
  //
  // 尽管如此，`_id` 兜底与 dedupKeyOf 的退化键仍然保留：一旦将来有任何一批题目文档两个键都缺，
  // `String(q.id)` 会让整库塌成同一个键（`String(undefined)` = `"undefined"`；注意 `String(null)`
  // 是 `"null"`，两者不同但同样是「整库共用一个键」），配额 30 题只入卷 1 题，且 1 ≠ 0 能绕过
  // 「0 题拒绝发布」门禁。这是**防御性加固**，不是对已观测到的线上故障的修复。
  //
  // 另外：`_id` 是**字符串**，所以原先的 `number` 在兜底真的触发时是不诚实的。
  // 2026-09-15 评审 fix round 第一次试着放宽，门禁当场抓到 **12 条新增错误**、全部落在**没有编辑过**的
  // 文件里，于是回退，并把「放宽 + 修完消费方」转交给拥有这些视图的任务（见 Task 5 报告 §9.7）。
  // 那 12 条的**准确分布**（复审实测纠正过本注释的初版——初版把 `ExamCreateView.vue` 也算了进去，
  // 而该文件**根本没有 `q.id`**，它的 3 条 TS2365 是 `poolIds: (number|string)[]` 造成的**既有基线错误**）：
  //   · `ExamTakeView.vue` —— 原列 5 条：传参(TS2345)、算术(TS2362)、数组下标(TS7015)×3
  //   · `PublicPracticeView.vue` —— 原列 7 条：其中三处里含**一条 TS2345 传参 + 两条 TS7015 数组下标**，
  //     其余为 TS7015 数组下标
  //   ⚠️ **不要按行号去找它们**：Task 6/7 改写过这些视图，行号已整体漂移，条数也可能随之变化。
  //   消费方清单**只能以 `npx vue-tsc --noEmit` 现取**为准（T8b 的对账结果见 `.superpowers/sdd/
  //   audit-fix-20260914/task-8b-report.md` 第 1 节）。
  //
  // **T8b（2026-09-16）已如实放宽为 `number | string`，且全部消费方在同一个提交里改完**——
  // 因为放宽与修消费方拆开任何一个中间状态都过不了类型门禁，这正是它当初被回退的原因。
  // 修法边界（越界就是改行为）：对象键用 `String(id)`；数组下标一律走**显式索引表或
  // `findIndex(x => x.id === q.id)`**，**禁止 `Number(id)`**（`_id` 是 32 位十六进制串 → `Number()` 得
  // `NaN`，等于把「类型不诚实」换成「运行时静默错位」）；`@ts-ignore` / `as any` 一律算没修。
  //
  // ⚠️ 消费方**不得对 id 做算术**（放宽前后都成立：`_id` 兜底触发时那是十六进制串，算术得 `NaN`）。
  // 曾有一处违反（`ExamTakeView.vue` 的选项乱序种子
  // 形如 `seed = q?.id || 0` 后对该值做 LCG 乘法）——**已由 Task 6 修好**（改为字符串哈希
  // `simpleHash(... + String(q?.id ?? ''))`，不再对 id 做算术），此处仅留档说明「为什么必须有这条禁令」。
  // 该缺陷当时的**实测**症状（控制端裁定原先写的「只剩第一个选项」是**错的**，本任务 harness 反驳）：
  // 字符串 id → hash 变 NaN → j = NaN → 解构交换只产生**一个** undefined、恒在**最后一个下标**，
  // 于是渲染端**少一个选项并整体错位**（4 选项活 3 个），并非只剩一个选项。
  // 其余用法（去重键、`answers` 的对象键）在 string 下仍正确，因为对象键会被自动字符串化
  // ——但**不要据此以为 id 只被这样用**，上面那个反例就是。
  id: number | string
  bank_id: number
  stem: string
  type: string
  options: string | null
  answer: string | null
  analysis: string | null
  source_index?: number | null
  // 题干插图。stem 里用 [IMG:n] 占位指向本数组下标（见 components/StemText.vue）。
  // 云端存的是绝对 URL（图放在部署方自己的静态目录下），本地导入的题库是 data URI。
  images?: string[] | null
  // 由解析推算出来、**不是题库标准答案**的空值。标准答案才是考试判分依据，两者在 UI 上分开显示。
  answer_derived?: string | null
  // 标准答案与解析算出的结果对不上时的标记：'value' | 'unit' | 'rounding' | ''（一致）。
  // 题库标准答案无论对错都保留，所以这里只做提示、不改答案。
  answer_conflict?: string | null
  answer_conflict_note?: string | null
  // 知识点总结：不针对本题、而是这一类题的通用规律（公式／易混点／变体／常见错），
  // 比 analysis 长，默认折叠，供举一反三用。
  knowledge?: string | null
  // 难易度：'easy' | 'mid' | 'hard'，空 = 未判定
  difficulty?: string | null
  difficulty_why?: string | null
}

export interface Exam {
  _id?: string
  title: string
  description: string
  duration_minutes: number
  questions: ExamQuestion[]   // 考试题目的完整快照（含答案，供判分）
  status: 'draft' | 'published' | 'closed'
  visibility?: 'public' | 'private'   // 公共考试（所有人可考）/ 自建考试（仅自己可见）
  deadline?: string | null     // 截止时间 ISO 字符串；为空表示不限时
  shuffle_options?: boolean    // 答题时是否乱序选项（默认 true；false = 按原顺序展示）
  created_at: string
  creator_name?: string        // 创建人（用户可自定义填写）
  _openid?: string             // 云数据库创建者标识（服务端自动写入）
  // T18-2d（2026-09-16）：**列表行**不再下发 `questions`（走 examGate 的字段白名单），
  // 由服务端补一个题数进来供列表渲染；详情/取卷仍是完整 Exam（含 questions）。
  question_count?: number
}

export interface ExamResult {
  _id?: string
  exam_id: string
  student_name: string
  answers: Record<string, { selected: number[]; blank: string; judge: boolean | null }>
  correct: number
  wrong: number
  unanswered: number
  score: number
  accuracy: number
  duration_ms: number | null
  submitted_at: string
  query_code?: string | null   // 查询码：交卷后生成，凭码回看错题
}

// ===== 本地演示模式（未配置云） =====

const LOCAL_EXAMS_KEY = 'local_exams'
const LOCAL_RESULTS_KEY = 'local_exam_results'
const LOCAL_EXAM_SNAPSHOTS_KEY = 'local_exam_snapshots'   // 创建/作答过的考试快照（云端兜底）

function getLocalExams(): Exam[] {
  try { return JSON.parse(localStorage.getItem(LOCAL_EXAMS_KEY) || '[]') } catch { return [] }
}
function saveLocalExams(exams: Exam[]) {
  localStorage.setItem(LOCAL_EXAMS_KEY, JSON.stringify(exams))
}
function getLocalResults(): ExamResult[] {
  try { return JSON.parse(localStorage.getItem(LOCAL_RESULTS_KEY) || '[]') } catch { return [] }
}
function saveLocalResults(results: ExamResult[]) {
  localStorage.setItem(LOCAL_RESULTS_KEY, JSON.stringify(results))
}
// 考生快照里问题的形状：answer/analysis **两个键都不存在**。
// 刻意删键而不是置 null —— 置 `null` 仍会在 localStorage 里留下 `"answer":null`，
// 一眼就能看出这道题原本有答案（简报的验收口径也是「JSON.stringify 后 grep 不含这两个字段」）。
type TakerExamQuestion = Omit<ExamQuestion, 'answer' | 'analysis'>

// 考生快照的答案剥离（P0-5）：只保留展示/作答必需字段（stem/options/type/id/bank_id）。
// 必须**返回新对象**（含新的 question 对象）——原地改写会污染调用方内存中的整卷，
// 而考生端这份整卷随后仍要用于判分（gradeExam / ExamTakeView.doSubmit）。
// 也刻意保留 options/stem/type：考生重进考试（云端查不到时靠快照兜底）仍需正常作答。
function stripAnswersForTaker(exam: Exam): TakerExamQuestion[] {
  const questions = Array.isArray(exam.questions) ? exam.questions : []
  return questions.map(({ answer: _answer, analysis: _analysis, ...rest }) => rest)
}

// 保存考试快照（用于云端查询失败/网络异常时兜底展示，避免误报"考试不存在"）
// P0-5（2026-09-15）：考生路径必须传 `{ forTaker: true }` —— 快照里**不得**出现 answer/analysis。
// 旧实现把整卷（含全部答案与解析）明文写进 localStorage：考生**开考前**打开 devtools 就能读到答案。
// 方向（别搞反）：
//   · 创建者（getExam 的本人分支 / createExam）→ 完整快照；
//   · 考生**开考前** → 剥离版；
//   · 考生**交卷成功后** → 由 ExamTakeView.doSubmit 再存一份完整快照（已交卷，按查询码回看错题
//     本来就要展示正确答案与解析；同时这也修好了「交卷后重进 + 云端查不到」的兜底回归）。
export function saveExamSnapshot(exam: Exam, opts?: { forTaker?: boolean }): void {
  if (!exam?._id) return
  try {
    const snapshots = getExamSnapshots()
    // as Exam：剥离后的问题没有 answer/analysis 键，这里只是把形状收窄回存储类型。
    // 读取侧对「键缺失」与「null」的处理一致（都是 falsy），故剥离版快照不会让兜底展示或判分崩掉：
    //   · checkAnswer 的判断/填空分支开头都是 `if (!q.answer) return false`（缺键与 null 同样返回 false）；
    //   · getWrongQuestions 用 `q.answer || ''`、`analysis: q.analysis || null`（缺键退化成空/ null）。
    // 刻意不写行号：本段上方任何增删都会让行号漂移（本仓库已多次因此产生失实注释）。
    const stored: Exam = opts?.forTaker ? ({ ...exam, questions: stripAnswersForTaker(exam) } as Exam) : exam
    snapshots[exam._id] = { ...stored, _snapshot_at: new Date().toISOString() }
    // 最多保留 50 场，防止无限膨胀
    const ids = Object.keys(snapshots)
    if (ids.length > 50) {
      const sorted = ids.sort((a, b) => String(snapshots[b]._snapshot_at || '').localeCompare(String(snapshots[a]._snapshot_at || '')))
      for (const old of sorted.slice(50)) delete snapshots[old]
    }
    localStorage.setItem(LOCAL_EXAM_SNAPSHOTS_KEY, JSON.stringify(snapshots))
  } catch (e) { console.warn('保存考试快照失败：', errMsg(e)) }
}
function getExamSnapshots(): Record<string, Exam> {
  try { return JSON.parse(localStorage.getItem(LOCAL_EXAM_SNAPSHOTS_KEY) || '{}') } catch { return {} }
}
// 考试属主判定（P1-28，2026-09-15）：只认云端写入的 `_openid`。
// 旧判据是「本设备有该考试的快照」（原 hasLocalSnapshot）——**那不是属主证据**：
// 考生也会留下快照（P0-5 之后仍留有一份剥离版），且与创建者的快照无法区分；
// 拿它当"我的"会让考生在考试列表里看到「成绩 / 删除」按钮，成绩页也能看到全班姓名与分数。
// 例外：纯本地演示模式（未配置 CloudBase）下 uid 恒为 null、考试也没有 `_openid`
// （createExam 本地分支只生成本机 id），这类考试只存在于本设备 localStorage，视为本人创建，
// 否则本地演示模式的「我的考试」会永远为空。
export function isExamOwner(exam: { _openid?: string } | null | undefined, uid: string | null): boolean {
  if (!exam) return false
  if (exam._openid) return !!uid && exam._openid === uid
  return !uid
}
function getExamSnapshot(id: string): Exam | null {
  return getExamSnapshots()[id] || null
}
function removeExamSnapshot(id: string): void {
  try {
    const snapshots = getExamSnapshots()
    if (snapshots[id]) { delete snapshots[id]; localStorage.setItem(LOCAL_EXAM_SNAPSHOTS_KEY, JSON.stringify(snapshots)) }
  } catch { /* ignore */ }
}

// ===== CloudBase 访问（懒加载） =====

let cloudApp: any = null
let cloudDb: any = null
let cloudReady = false
let cachedUid: string | null = null

// 默认云端环境 ID：网页版访客未配置云同步时，用此 envId 只读访问公共题库/公共考试
// 来源：构建时由 .env 的 VITE_DEFAULT_CLOUD_ENV_ID 注入（该文件不进 git 仓库）。
// 为空 = 纯本地模式（无默认云端环境，用户需在设置页自行填写 envId 才能用公共数据）
const DEFAULT_CLOUD_ENV_ID = (import.meta.env.VITE_DEFAULT_CLOUD_ENV_ID as string) || ''

async function ensureCloud(): Promise<boolean> {
  if (cloudReady) return true
  try {
    const cfgRaw = localStorage.getItem('cloudbase_config')
    let envId: string | null = null
    if (cfgRaw) {
      try {
        const cfg = JSON.parse(cfgRaw)
        if (cfg.envId && cfg.enabled) envId = cfg.envId
      } catch { /* 配置损坏则回退默认 */ }
    }
    // 未配置或配置关闭 → 用默认 envId 只读访问公共数据（不写入 localStorage）
    if (!envId) envId = DEFAULT_CLOUD_ENV_ID
    if (!envId) return false  // 无默认环境且用户未配置 → 纯本地模式（不连云端）
    const mod = await import('@cloudbase/js-sdk')
    const tcb = mod.default
    cloudApp = tcb.init({ env: envId })
    // 必须先匿名登录，否则 ACL（auth != null）会拒绝所有读写
    const auth = cloudApp.auth({ persistence: 'local' })
    let state = null
    try { state = await auth.getLoginState() } catch { state = null }
    if (!state) {
      await auth.anonymousAuthProvider().signIn()
      // signIn() 返回可能不带 uid，重新取登录态
      try { state = await auth.getLoginState() } catch { state = null }
    }
    cloudDb = cloudApp.database()
    cachedUid = state?.user?.uid || state?.uid || null
    cloudReady = true
    return true
  } catch (e) {
    console.warn('考试模块 CloudBase 初始化失败：', e)
    return false
  }
}

function isCloud(): boolean { return cloudReady && !!cloudDb }

/** 刷新匿名登录态（token 过期时调用，重置 cloudReady 强制重新登录） */
async function refreshAuth(): Promise<boolean> {
  if (!cloudApp) return false
  try {
    const auth = cloudApp.auth({ persistence: 'local' })
    // 先尝试 signOut 清除过期态，再重新匿名登录
    try { await auth.signOut() } catch { /* ignore */ }
    await auth.anonymousAuthProvider().signIn()
    const state = await auth.getLoginState()
    cachedUid = state?.user?.uid || state?.uid || null
    cloudReady = true
    return true
  } catch (e) {
    console.warn('刷新匿名登录态失败：', e)
    cloudReady = false
    return false
  }
}

/** 判断错误是否为权限/认证类（需要刷新登录态重试） */
function isAuthError(e: any): boolean {
  const msg = String(e?.message || e?.code || e || '').toLowerCase()
  return msg.includes('permission denied') || msg.includes('security rules')
    || msg.includes('unauthorized') || msg.includes('auth') || msg.includes('token')
}

// 超时保护：CloudBase 请求异常挂起时避免页面永远卡在"加载中"
function withTimeout<T>(p: Promise<T>, ms = 15000, label = '请求'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}超时（${ms / 1000}s），请检查网络后重试`)), ms)
    p.then(
      v => { clearTimeout(timer); resolve(v) },
      e => { clearTimeout(timer); reject(e) },
    )
  })
}

// ===== 题目数据自愈（2026-08-16） =====
// 背景：公共题库历史导入 bug——多选题第 5 个及以后的选项被错误拼进题干（stem 尾带 "E. xxx"/"F. xxx"），
// 而 answer 仍含越界字母（如 ["A","B","C","D","E"]），导致选项区只有 A-D、怎么选都判错。
// 自愈：从题干尾部提取 E/F 选项块补回 options，题干回归干净。幂等，仅内存级（不写云端）。
export function healQuestion(q: ExamQuestion): ExamQuestion {
  let optsRaw: string[] | null = null
  try {
    const p = JSON.parse(q.options || '[]')
    if (Array.isArray(p)) optsRaw = p.map((o: any) => String(o))
  } catch { optsRaw = null }
  if (!optsRaw || !optsRaw.length) return q
  // 判断题跳过：answer 为 true/false 会被字母解析误判成 E，且判断题无选项残留问题
  const judgeLike = q.type === 'judge' || (optsRaw.length === 2 && ((optsRaw[0] === '正确' && optsRaw[1] === '错误') || (optsRaw[0] === '对' && optsRaw[1] === '错')))
  if (judgeLike) return q
  // 去掉选项误带的编号前缀（如 "E.防止误分" → "防止误分"）
  const opts = optsRaw.map(o => o.replace(/^[A-Ha-h][.、．:：]\s*/, '').trim())
  if (opts.some(o => !o)) return q
  const letters = parseAnswerLetters(q.answer)
  const maxIdx = letters.length ? Math.max(...letters) : -1
  const broken = maxIdx >= opts.length
  // 2026-09-15 修复(P2-27)：不破损一律原样返回——「修复」只对真缺选项的题有意义。
  // 旧代码是 `if (!broken && !tail) return q`，只要题干碰巧命中尾部正则就会继续走改写路径，
  // 而所有保护检查（"提取不够不动手"）都挂在 broken 分支里，健康题反而不设防。
  // 触发输入："根据（GB 4789.2）标准，E. coli 超标的处理方法是"——正则把 `E. coli` 的 `E.`
  // 当成残留选项起点，题干被截成"根据（GB 4789.2）标准，"、追加伪选项"coli 超标的处理方法是"。
  // 同类误报：H. pylori / F. Scott / G. 7。healQuestion 在建卷与每次读取时都跑，撕裂会写进考试快照。
  if (!broken) return q
  const stem = q.stem || ''
  const m = stem.match(/（[^（）]*）[\s\S]*?([EＥFＦGＧHＨ][.、．:：][\s\S]*)$/)
  const tail = m ? m[1] : null
  if (!tail) return q
  // 2026-09-15 修复(P2-27 加固)：tail 必须是「从 opts.length 对应字母开始的连续字母选项串」——
  // 4 个选项(A-D)须从 E 起、5 个选项须从 F 起，且逐块递增不许跳号、不许有非选项残渣；
  // 否则视为题干拉丁文名的误命中（如破损题的题干同时含 "E. coli"），宁可不修也不撕裂。
  const healLetterIdx = (ch: string): number => 'EFGH'.indexOf(ch) >= 0 ? 'EFGH'.indexOf(ch) : 'ＥＦＧＨ'.indexOf(ch)
  const newOpts: string[] = []
  let expect = opts.length - 4  // E 对应第 5 个选项（下标 4）：opts.length=4 → 期望首块字母 E
  if (expect < 0) return q      // 选项不足 4 个时 E-H 尾串不可能与之连续，不修
  for (const b of tail.split(/(?=[EＥFＦGＧHＨ][.、．:：])/)) {
    const lm = b.match(/^([EＥFＦGＧHＨ])[.、．:：]\s*/)
    if (!lm) return q                       // 出现不带字母标点的残渣块 → 不是纯选项串
    if (healLetterIdx(lm[1]) !== expect) return q  // 起点不对或不连续 → 误命中
    const t = b.slice(lm[0].length).trim()
    if (!t) return q                        // 空选项文本 → 不是真选项
    newOpts.push(t)
    expect++
  }
  // 必须提取足够选项补齐越界字母，否则不动（避免拆错题干）
  const need = maxIdx - opts.length + 1
  if (newOpts.length < need) return q
  return {
    ...q,
    stem: stem.slice(0, (m?.index ?? 0) + ((m?.[0].length ?? 0) - tail.length)).replace(/[\s，,。]+$/, ''),
    options: JSON.stringify([...opts, ...newOpts]),
  }
}
function healExam(exam: Exam | null): Exam | null {
  if (!exam?.questions?.length) return exam
  return { ...exam, questions: exam.questions.map(healQuestion) }
}

// ===== 创建考试 =====

// 抽题池配置：按题库抽固定数量，或按题型配比抽题
export interface ExamPoolItem {
  bank_id: number | string
  count?: number                    // 自由模式：该题库抽几道
  counts?: Partial<Record<'single' | 'multi' | 'judge' | 'blank' | 'qa', number>>  // 题型配比模式
}

// P1-25（2026-09-15）：配额欠填不再静默。旧版 createExam 只返回 Exam，题库不足时
// Math.min 悄悄少给（如请求 220 题实得 40 题），调用方无从得知缺口；全桶为空时甚至
// 产出 0 题试卷仍以 status:'published' 发布（gradeExam 靠 questions.length || 1 防除零，
// 考生得 0 分而非报错）。现返回 { exam, shortfalls }，0 题时直接抛错拒绝发布。
export interface ExamShortfall {
  bank_id: number | string
  requested: number   // 该题库请求的题数（counts 模式为各题型之和；自由模式为 count）
  actual: number      // 实际入卷数（按 P1-24 去重后计数——两行同选一个库时后一行会被去重吃掉）
}
export interface CreateExamResult {
  exam: Exam
  shortfalls: ExamShortfall[]
}

// 2026-09-15 修复(评审 Important，防御侧)：组卷去重键必须**对 id 缺失免疫**。
// 原式 `String(q.id)` 在 id 缺失时得到的是一个**常量字符串**（`String(undefined)` = `"undefined"`、
// `String(null)` = `"null"`）——于是该来源的**所有题目共用一个键**，
// `seen` 只放行第一道：配额 30 题的库只入卷 1 题；单库组卷更会产出一份**1 题试卷**，
// 而它还能顺利通过 `!uniq.length` 的「0 题拒绝发布」门禁（1 ≠ 0），用户拿到近乎空白的卷子。
// 兜底顺序是刻意的：**优先用「库 + 题干」这种内容派生的稳定键**，这样「同一道题经两个模板行到达」
// 仍然能被正确去重；只有在题干也为空时才退到「库 + 位置序号」保证位置唯一。
// 取舍原则：**宁可漏掉一次去重**（同题重复入卷，用户看得见但无害），
// **也绝不能把整个库塌成一道题**（用户拿到近乎空白的试卷，且门禁发现不了）。
// 根因侧的加固见 listPublicBankQuestions 里补的 `?? q._id`；两层都要在。
//
// 可达性（2026-09-15 实测，不夸大）：本函数防的是「id 缺失」这一类输入。机制已用可执行断言证明
// ——harness 的 E9/Q1 在 Task 5 已提交状态（`String(q.id)`）上实测塌成 **1 题**、修复后 5 题全入卷。
// 但触发条件在现有云端数据上**未出现**：scripts/all-questions.json（真实导出 7049 条）里
// 每条公共题都带 `_local_id`（只是都没有 `id`），故映射后 id 恒为数字。取证脚本
// tmp-verify/t5/probe-cloud-shape.mjs。即：这是**防御性加固**，不是对已观测线上故障的修复。
function dedupKeyOf(q: any, idx: number): string {
  if (q?.id != null) return String(q.id)
  const bank = q?.bank_id ?? '?'
  const stem = String(q?.stem ?? '').trim()
  // 2026-09-15：两个退化分支必须用**互不相交的命名空间**。原先位置分支写 `noid:${bank}:#${idx}`，
  // 而题干分支写 `noid:${bank}:${stem}`——于是一道题干恰好是 `#0` 的题与「下标 0 的空题干题」
  // 产出**逐字节相同**的键，两道本来不同的题被当成同一道、其中一道被静默丢弃。
  // 那正是本函数注释里明令禁止的后果（宁可漏掉一次去重，也绝不能少给一道题且无人察觉）。
  // `pos:` 前缀保证任何题干都不可能拼出位置键。
  return stem ? `stem:${bank}:${stem}` : `pos:${bank}:${idx}`
}

export async function createExam(
  title: string,
  description: string,
  durationMinutes: number,
  questionPool: ExamPoolItem[],
  deadline?: string | null,
  visibility?: 'public' | 'private',
  creatorName?: string | null,
  shuffleOptions?: boolean,
): Promise<CreateExamResult> {
  // 从题库抽题（支持本地题库数字 id 与云端公共题库字符串 id 混合）
  const questions: ExamQuestion[] = []
  const shortfalls: ExamShortfall[] = []
  // 2026-09-15 修复(P1-24)：跨题库去重。触发场景：智能组卷模板每行可独立选题库，
  // 两行同选一个库时各自 shuffle 抽题，同一题 id 会在一张卷里出现两次；
  // ExamResult.answers 以题 id 为键，两份副本共用一个槽位 → gradeExam 把该题计两次
  // （total 虚高），且答对其一即算答对其二。写法参照同文件 listExams 已有的 seen 集合。
  const seen = new Set<string>()
  for (const pool of questionPool) {
    // 读题库全部题目
    let all: any[] = []
    if (typeof pool.bank_id === 'string') {
      // 云端公共题库：直接读云端题目
      all = await listPublicBankQuestions(pool.bank_id)
    } else {
      all = await idb.listQuestions(pool.bank_id)
    }
    let picked: any[] = []
    let requested = 0
    if (pool.counts && Object.values(pool.counts).some(n => (n || 0) > 0)) {
      // 题型配比模式：按题型分别抽足（不足按实际数量）
      // 注意：用 classifyQuestionType 内容识别（云端判断题是 type:'single' + ["正确","错误"]，
      // 直接按 q.type 过滤会抽 0 道判断）
      const want = { single: 0, multi: 0, judge: 0, blank: 0, qa: 0, ...pool.counts }
      requested = (['single', 'multi', 'judge', 'blank', 'qa'] as const)
        .reduce((s, t) => s + Math.max(0, want[t] || 0), 0)
      for (const t of ['single', 'multi', 'judge', 'blank', 'qa'] as const) {
        const bucket = all.filter(q => classifyQuestionType(q) === t)
        const n = Math.min(want[t] || 0, bucket.length)
        picked.push(...shuffle(bucket).slice(0, n))
      }
    } else {
      // 自由模式：随机抽 count 道
      requested = Math.max(0, pool.count || 0)
      picked = shuffle(all).slice(0, Math.min(pool.count || 0, all.length))
    }
    let actual = 0
    for (const [pi, q] of picked.entries()) {
      // P1-24：该题 id 已入卷（两行同选一个库 / 同一题同时存在于本地库与云端库）→ 跳过副本
      // 2026-09-15：键改走 dedupKeyOf，对 id 缺失免疫（见该函数注释）
      const seenKey = dedupKeyOf(q, pi)
      if (seen.has(seenKey)) continue
      seen.add(seenKey)
      actual++
      const t = classifyQuestionType(q)
      if (t === 'judge') {
        // 判断题规范化：统一 type/options/answer（云端判断题存为 single + ["正确","错误"]）
        let opts: string[] = []
        try { const p = JSON.parse(q.options || '[]'); if (Array.isArray(p)) opts = p.map((o: any) => String(o)) } catch { /* ignore */ }
        questions.push({
          id: q.id,
          bank_id: typeof pool.bank_id === 'number' ? pool.bank_id : (q.bank_id ?? 0),
          stem: q.stem,
          type: 'judge',
          options: JSON.stringify(['正确', '错误']),
          answer: judgeAnswerBool(q.answer, opts.length ? opts : null),
          analysis: q.analysis,
          source_index: q.source_index ?? null,
        })
      } else {
        questions.push({
          id: q.id,
          bank_id: typeof pool.bank_id === 'number' ? pool.bank_id : (q.bank_id ?? 0),
          stem: q.stem,
          type: t,
          options: q.options,
          answer: q.answer,
          analysis: q.analysis,
          source_index: q.source_index ?? null,
        })
      }
    }
    // P1-25：记录该题库「请求 vs 实际入卷」缺口（题库题量不足，或配额撞上 P1-24 去重）
    if (actual < requested) shortfalls.push({ bank_id: pool.bank_id, requested, actual })
  }
  // 数据自愈：私人题库/历史数据可能带 E/F 选项残留，出题时统一修复（幂等）
  for (let i = 0; i < questions.length; i++) questions[i] = healQuestion(questions[i])
  // 2026-09-15 修复(P1-24 第二道防线)：排序前再按 id 去重一次——上方 seen 已在入卷时挡住重复，
  // 此处兜底保证即使未来改动绕过 seen，卷内也不会出现重复 id（answers 映射撞键的根源）。
  const uniq: ExamQuestion[] = []
  const uniqIds = new Set<string>()
  // 2026-09-15：与上方入卷时的 seen 共用同一个 dedupKeyOf，两道防线对「什么算同一道题」不会各说各话
  for (const [i, q] of questions.entries()) {
    const k = dedupKeyOf(q, i)
    if (uniqIds.has(k)) continue
    uniqIds.add(k)
    uniq.push(q)
  }
  // 按题型排序：单选 → 多选 → 判断 → 其他（不打乱，保持有序）
  const typeOrder: Record<string, number> = { single: 0, multi: 1, judge: 2 }
  uniq.sort((a, b) => (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9))
  // 2026-09-15 修复(P1-25)：0 题试卷拒绝发布——旧代码在所有题库为空/拉取全失败时仍会以
  // status:'published' 写入空卷，考生拿到白卷、gradeExam 靠 questions.length || 1 防除零判 0 分。
  // 抛错发生在任何写入之前 → 不写云端、不写本地、不存快照，由调用方 catch 展示原因。
  if (!uniq.length) {
    // 2026-09-15(评审 Minor)：去掉内层的「已取消创建：」——两个调用方都已前缀「创建失败：」，
    // 原文案会渲染成「创建失败：未抽到任何题目，已取消创建：请检查…」，同一件事说两遍（GC10 要求文案简洁）
    throw new Error('未抽到任何题目，请检查所选题库是否有题目、各题型配额是否超过题库实际题量')
  }

  const exam: Exam = {
    title,
    description,
    duration_minutes: Math.max(1, durationMinutes),
    questions: uniq,   // P1-24：去重+按题型排序后的最终卷面
    status: 'published',
    visibility: visibility || 'public',
    deadline: deadline || null,
    shuffle_options: shuffleOptions !== false, // 默认开启乱序；仅显式传 false 时关闭
    created_at: new Date().toISOString(),
    creator_name: creatorName?.trim() || null,
  }

  if (await ensureCloud() && isCloud()) {
    const res = await cloudDb.collection('exams').add(exam)
    exam._id = res.id
  } else {
    // 本地演示
    const exams = getLocalExams()
    exam._id = 'local_' + Date.now().toString(36)
    exams.unshift(exam)
    saveLocalExams(exams)
  }
  // 保存快照：云端考试创建后立即缓存，供后续 getExam 兜底（网络抖动/ACL 异常时仍可作答）
  saveExamSnapshot(exam)
  // P1-25：连同缺口一起返回，由调用方决定如何向用户展示
  return { exam, shortfalls }
}

// T18-2d（2026-09-16）：考试流程的服务端闸门。
// 为什么需要它：题目与答案同存于 `exams.questions[]`，而 exams 必须对 public 可读 ⇒ 任何考生都能在
// 控制台直查拿到全部答案（生产实测）。CloudBase 规则是文档级的、无法只放行文档内某些字段，所以
// 唯一真解法是**考生不再直接读集合**：列表/取卷/判分/查询码回看都走本函数（服务端剥答案、服务端判分）。
// ⚠️ 生效分两步：本改造先上（功能与旧版等价）；**exams 读规则收紧为「仅属主可读」要等小程序正式版
//    带上本改造之后**（否则旧客户端立刻打不开考试）。收紧后 F12 直查会被规则拒绝。
async function examGate(action: string, payload: Record<string, any> = {}): Promise<any> {
  if (!(await ensureCloud()) || !isCloud() || !cloudApp) {
    return { ok: false, code: 'NO_CLOUD', message: '云环境未连接' }
  }
  try {
    const res: any = await withTimeout<any>(cloudApp.callFunction({ name: 'examGate', data: { action, payload } }), 30000, '考试闸门')
    // js-sdk 见到返回对象带 `code` 会平铺到响应本身；两种形态都吃（同 cloud-parse.ts 的口径）
    const out: any = res?.result ?? res
    return out && typeof out === 'object' ? out : { ok: false, code: 'BAD_RESPONSE', message: '响应异常' }
  } catch (e: any) {
    console.warn('examGate 调用失败：', errMsg(e))
    return { ok: false, code: 'CALL_FAILED', message: '无法调用考试服务（可能尚未部署或权限未放通）' }
  }
}

/**
 * T18-2d：交卷时由**服务端判分**（客户端不再持有答案）。
 * 返回 { ok, score, correct, wrong, unanswered, accuracy, total, key }，其中 `key` 是**交卷后**才下发的
 * 答案表 `{ [qid]: { answer, analysis } }`，供调用方合并回卷对象以渲染错题回顾/写错题本/存本地快照。
 * 判分口径与服务端逐字对齐，已由 `tmp-verify/t18-2d-grade-parity.cjs` 对拍（26/26）。
 */
export async function gradeExamViaServer(examId: string, answers: ExamResult['answers']): Promise<any> {
  return await examGate('grade', { examId, answers })
}

/**
 * T18-2d：凭查询码回看（跨会话/跨设备）。返回 { ok, result, exam }，exam 含答案与解析——
 * 这是**唯一**在考生端拿到答案的路径，且必须持有查询码。（原先直接 getExam 拿公开整卷。）
 */
export async function reviewByCode(code: string): Promise<any> {
  return await examGate('reviewByCode', { code })
}

export async function listExams(): Promise<Exam[]> {
  if (await ensureCloud() && isCloud()) {
    // ACL 已保证：非创建者只能读到 public 考试；创建者可读到自己的（含 private）
    // 注意：CloudBase ACL 下「无条件查询」返回空（实测），必须带 where 条件！
    // 因此分两次查：本人（含 private）+ 公共，合并去重
    const uid = await getCurrentUid()
    const all: any[] = []
    const seen = new Set<string>()
    if (uid) {
      // 注意：uid 为 null 时 where({_openid:null}) 会返回 undefined data（实测），必须跳过
      try {
        const mine = await cloudDb.collection('exams')
          .where({ _openid: uid })
          .orderBy('created_at', 'desc')
          .limit(500)
          .get()
        const rows = Array.isArray(mine.data) ? mine.data : []
        for (const r of rows) {
          const k = String(r._id ?? r.id)
          if (!seen.has(k)) { seen.add(k); all.push(r) }
        }
      } catch (e) { console.warn('listExams 查询本人考试失败：', errMsg(e)) }
    }
    try {
      // T18-2d：公共考试改走闸门（只回字段白名单，不含 questions/答案）。
      // 原先直查 `where({visibility:'public'})` 会把**每场公共考试的整卷含答案**拉到设备上。
      const gate = await examGate('list')
      if (gate?.ok && Array.isArray(gate.exams)) {
        for (const r of gate.exams) {
          const k = String(r._id ?? r.id)
          if (!seen.has(k)) { seen.add(k); all.push(r) }
        }
      } else if (!gate?.ok) {
        console.warn('listExams 闸门取公共考试失败：', gate?.message || gate?.code)
      }
    } catch (e) { console.warn('listExams 查询公共考试失败：', errMsg(e)) }
    // 补充本地快照：云端查询失败时也能看到自己创建过的考试（用快照合并）
    const snapshots = getExamSnapshots()
    for (const s of Object.values(snapshots)) {
      const k = String(s._id)
      if (!seen.has(k)) { seen.add(k); all.push(s) }
    }
    return all
  }
  return getLocalExams()
}

export async function getExam(id: string): Promise<Exam | null> {
  if (await ensureCloud() && isCloud()) {
    // doc(id).get() 在 ACL 下会被拒绝（实测 DATABASE_PERMISSION_DENIED）；
    // where({_id}) 也查不到（_id 是保留字段）。正确做法：查询列表后内存匹配。
    const uid = await getCurrentUid()
    if (uid) {
      // uid 为 null 时 where({_openid:null}) 返回 undefined（实测），必须跳过本人查询
      try {
        const mine = await cloudDb.collection('exams')
          .where({ _openid: uid })
          .limit(500)
          .get()
        const mineRows = Array.isArray(mine.data) ? mine.data : []
        const found = mineRows.find((r: any) => String(r._id ?? r.id) === id)
        // 本人分支：查询条件已限定 `_openid: uid`，故这里一定是创建者 → 完整快照（含答案）
        if (found) { saveExamSnapshot(found); return healExam(found) }
      } catch (e) { console.warn('getExam 查询本人考试失败：', errMsg(e)) }
    }
    try {
      // T18-2d：公共考试改走闸门 `paper`——服务端**剥离 answer/analysis** 后下发。
      // 原先直查 `where({visibility:'public'})` 虽把快照剥了答案，但**内存里的对象仍是完整卷**
      // （F12/断点可见）；现在连内存里都拿不到答案，判分也改由服务端做（见 submitExamResult）。
      const gate = await examGate('paper', { examId: id })
      const found = gate?.ok ? gate.exam : null
      // 公共分支：读者通常**不是**创建者（考生）→ 服务端已剥离，快照同口径存剥离版（P0-5 第二扇门）
      if (found) { saveExamSnapshot(found, { forTaker: !isExamOwner(found, uid) }); return healExam(found) }
      if (gate && !gate.ok && gate.code !== 'NOT_PUBLIC') {
        console.warn('getExam 闸门取卷失败：', gate.message || gate.code)
      }
    } catch (e) { console.warn('getExam 查询公共考试失败：', errMsg(e)) }
    // 兜底：云端查不到时用本地快照（创建过/作答过该考试则一定有快照）。
    // 注意：考生快照是**剥离版**（P0-5），故这里兜底展示的题目没有答案/解析；
    // 考生交卷成功后 ExamTakeView 会补存完整快照，交卷后的回看不受影响。
    const snapshot = getExamSnapshot(id)
    if (snapshot) return healExam(snapshot)
    return null
  }
  return healExam(getLocalExams().find(e => e._id === id) || null)
}

// 获取当前登录用户 openid（用于区分「我的考试/我的题库」）
let uidPromise: Promise<string | null> | null = null
export async function getCurrentUid(): Promise<string | null> {
  if (cachedUid) return cachedUid
  if (!(await ensureCloud()) || !isCloud()) return null
  // 并发调用只查一次
  if (!uidPromise) {
    uidPromise = (async () => {
      try {
        const auth = cloudApp.auth({ persistence: 'local' })
        let state = await auth.getLoginState()
        if (!state) {
          // 登录态丢失（如 local 持久化被清）→ 重新匿名登录
          await auth.anonymousAuthProvider().signIn()
          state = await auth.getLoginState()
        }
        const uid = state?.user?.uid || state?.uid || null
        cachedUid = uid
        return uid
      } catch (e) {
        console.warn('获取当前 uid 失败：', errMsg(e))
        return null
      } finally {
        uidPromise = null
      }
    })()
  }
  return uidPromise
}

// 读取云端公共题库（用于出卷/刷题；不写入本地"我的题库"）
export async function listPublicBanks(): Promise<any[]> {
  if (await ensureCloud() && isCloud()) {
    try {
      const res = await withTimeout<any>(cloudDb.collection('quiz_banks')
        .where({ visibility: 'public' })
        .orderBy('created_at', 'desc')
        .limit(100)
        .get(), 15000, '读取公共题库')
      const banks = res.data || []
      // 加载优化档1（2026-09-23）：题库文档已有 question_count 就直接用，缺失的才回退 count 查询。
      // 实测原来每次进首页都会为 12 个库各发一次 count（12 次请求）；新库灌入时已写入该字段。
      await Promise.all(banks.map(async (b: any) => {
        if (typeof b.question_count === 'number' && b.question_count > 0) return
        try {
          const cnt = await withTimeout<any>(cloudDb.collection('questions')
            .where({ visibility: 'public', bank_ref: b._id })
            .count(), 15000, '统计题目数')
          b.question_count = cnt.total
        } catch { b.question_count = 0 }
      }))
      return banks
    } catch (e) {
      console.warn('读取公共题库失败：', errMsg(e))
      return []
    }
  }
  return []
}

// 读取云端公共题库的题目（用于抽题出卷；按题库云端 _id / bank_ref 关联）
// 注意：云端题目可能超过 500 道（如合集 2951 题），必须分页拉全量，不能 limit(500) 截断
// 公共题字段裁剪（加载优化档1，2026-09-23）：实测整库原始 624KB，前端实际只用其中 386KB，
// 这里把不用的 name/_openid/visibility/bank_ref/_id 排除掉，由服务端裁剪后再下发。
const PUBLIC_Q_FIELDS = {
  _local_id: true, _local_bank_id: true, bank_id: true, stem: true,
  type: true, options: true, answer: true, analysis: true, source_index: true,
  images: true, answer_derived: true, answer_conflict: true, answer_conflict_note: true,
  knowledge: true, difficulty: true, difficulty_why: true,
}
const PUBLIC_Q_PAGE = 200
// 缓存有效期：即使题数没变，超过这个时间也重拉一次（兜住「题数不变但内容被改」的情形）
const PUBLIC_Q_CACHE_TTL = 24 * 3600 * 1000

function mapPublicQuestion(q: any): ExamQuestion {
  // 2026-09-15 加固(评审 Important #1，根因侧)：补 `?? q._id` 兜底。
  // 机制是真实的：若某个云端公共题文档既无 `_local_id` 也无 `id`，映射出的 id 就是 undefined，
  // 该库**所有题**在去重时塌成同一个键 "undefined"（配额 30 题只入卷 1 题，且 1 ≠ 0 能绕过
  // 「0 题拒绝发布」门禁），在 `answers[q.id]` 里也塌成同一个下标（判分互相覆盖）。
  // 实测 scripts/all-questions.json（云端导出 7049 条，2026-08-08）：全部都有 `_local_id`，故本行是
  // 防御性加固，不是对已观测线上故障的修复。详见 ExamQuestion 的注释。
  return {
    id: q._local_id ?? q.id ?? q._id,
    bank_id: q._local_bank_id ?? q.bank_id ?? 0,
    stem: q.stem,
    type: q.type,
    options: q.options,
    answer: q.answer,
    analysis: q.analysis,
    source_index: q.source_index ?? null,
    images: Array.isArray(q.images) ? q.images : null,
    answer_derived: q.answer_derived || null,
    answer_conflict: q.answer_conflict || '',
    answer_conflict_note: q.answer_conflict_note || null,
    knowledge: q.knowledge || null,
    difficulty: q.difficulty || '',
    difficulty_why: q.difficulty_why || null,
  }
}

async function fetchPublicQuestionPage(bankRef: string, skip: number): Promise<any[]> {
  const res = await withTimeout<any>(cloudDb.collection('questions')
    .where({ visibility: 'public', bank_ref: bankRef })
    .field(PUBLIC_Q_FIELDS)
    .skip(skip)
    .limit(PUBLIC_Q_PAGE)
    .get(), 20000, '读取公共题库题目')
  return Array.isArray(res.data) ? res.data : []
}

// 题库元信息（用 question_count 作缓存版本戳）。
// 注意查询形状：客户端读必须让 where 是安全规则的子集，所以带上 visibility 而不是 doc(id).get()。
async function fetchPublicBankMeta(bankRef: string): Promise<any | null> {
  try {
    const res = await withTimeout<any>(cloudDb.collection('quiz_banks')
      .where({ _id: bankRef, visibility: 'public' })
      .limit(1)
      .get(), 15000, '读取题库信息')
    const rows = Array.isArray(res.data) ? res.data : []
    return rows[0] || null
  } catch {
    return null
  }
}

// 读取云端公共题库的题目（用于抽题出卷与刷题；按题库云端 _id / bank_ref 关联）
// 加载优化（2026-09-23，档1+档2）：
//   档1 = 字段裁剪（服务端只下发要用的字段）+ 分页并行（原来是 200 条一页串行，1134 题要 6 个来回）
//   档2 = 本地缓存（IndexedDB，keyPath=bank_ref）。命中判据：题库 question_count 未变 且 未超 TTL。
// 缓存未命中时仍走全量拉取，失败返回 []（与原行为一致）。
export async function listPublicBankQuestions(bankId: string | number): Promise<ExamQuestion[]> {
  if (!(await ensureCloud()) || !isCloud()) return []
  const bankRef = String(bankId)
  try {
    const meta = await fetchPublicBankMeta(bankRef)
    const cloudCount = meta && typeof meta.question_count === 'number' ? meta.question_count : -1
    // 背题模式的库（计算题）**不落本地**：整库题目、题图和长知识点都只走在线读取。
    // 这类库体积大、且属于「看一次算一次」的内容，缓存到用户机器上等于把题库搬走。
    const noLocalCopy = String(meta?.mode || '') === 'recite'

    // 档2：缓存命中直接返回，0 次题目请求
    if (!noLocalCopy && cloudCount > 0) {
      const cached = await readPublicQuestionCache(bankRef)
      if (cached && cached.count === cloudCount
        && Array.isArray(cached.questions) && cached.questions.length === cloudCount
        && Date.now() - cached.fetched_at < PUBLIC_Q_CACHE_TTL) {
        return cached.questions as ExamQuestion[]
      }
    }

    // 档1：并行分页拉取（先拿到总数，再一次性并发请求所有页）
    let total = cloudCount
    if (total <= 0) {
      try {
        const cnt = await withTimeout<any>(cloudDb.collection('questions')
          .where({ visibility: 'public', bank_ref: bankRef })
          .count(), 15000, '统计题目数')
        total = cnt.total || 0
      } catch { total = 0 }
    }
    const pages = total > 0 ? Math.ceil(total / PUBLIC_Q_PAGE) : 1
    const chunks = await Promise.all(
      Array.from({ length: pages }, (_, i) => fetchPublicQuestionPage(bankRef, i * PUBLIC_Q_PAGE)),
    )
    const rows = chunks.flat()
    const mapped = rows.map(mapPublicQuestion)

    // 档2：写缓存（失败不影响返回）；背题库不写
    if (!noLocalCopy && mapped.length) {
      await writePublicQuestionCache({
        bank_ref: bankRef, count: mapped.length, fetched_at: Date.now(), questions: mapped,
      })
    }
    return mapped
  } catch (e) {
    console.warn('读取公共题库题目失败：', errMsg(e))
    return []
  }
}
export async function updateExamStatus(id: string, status: Exam['status']): Promise<void> {
  if (await ensureCloud() && isCloud()) {
    // T18-2a（2026-09-16）：`doc(id).update()` 改 `where({_id, _openid})`——属主规则下
    // doc(id) 写形态连属主自己都被拒（客户端查询条件必须是规则子集）。
    // uid 取不到时退回 doc(id) 旧形态（匿名登录下本来就写不进属主集合，行为等价于失败）。
    const uid = await getCurrentUid()
    if (uid) {
      await cloudDb.collection('exams').where({ _id: id, _openid: uid }).update({ status })
    } else {
      await cloudDb.collection('exams').doc(id).update({ status })
    }
    return
  }
  const exams = getLocalExams()
  const e = exams.find(x => x._id === id)
  if (e) { e.status = status; saveLocalExams(exams) }
}

export async function deleteExam(id: string): Promise<void> {
  if (await ensureCloud() && isCloud()) {
    // T18-2a（2026-09-16）：同上，`doc(id).remove()` 改 `where({_id, _openid}).remove()`。
    const uid = await getCurrentUid()
    if (uid) {
      await cloudDb.collection('exams').where({ _id: id, _openid: uid }).remove()
    } else {
      await cloudDb.collection('exams').doc(id).remove()
    }
    removeExamSnapshot(id)
    return
  }
  saveLocalExams(getLocalExams().filter(e => e._id !== id))
  removeExamSnapshot(id)
}

// ===== 成绩 =====

export async function submitExamResult(result: ExamResult): Promise<void> {
  // 生成查询码（若没有）：考试ID后4位 + 6位随机字符，大写字母数字
  // 2026-09-18 修复（重审 D-05）：随机部分从 **4 位加长到 6 位**。
  //   原为 4 位（32^4 ≈ 105 万），且前半段「考试ID后4位」是**可推出**的（知道考试就知道种子）
  //   ⇒ 查询码可被爆破，而 `examGate.reviewByCode` 凭码即回整卷答案与解析（码本身就是凭据，无其它鉴权）。
  //   32^6 ≈ 10.7 亿，配合「按码全局查 + 无枚举提示」已不实用。
  //   ⚠️ 旧码不受影响：查找是**精确匹配**（不做格式校验），历史 4 位码照常可用。
  if (!result.query_code) {
    const seed = (result.exam_id || 'XXXX').slice(-4).toUpperCase()
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    let rand = ''
    for (let i = 0; i < 6; i++) rand += chars[Math.floor(Math.random() * chars.length)]
    result.query_code = seed + '-' + rand
  }
  if (await ensureCloud() && isCloud()) {
    // 云端写入封装：碰到 auth 错误时刷新登录态重试一次
    const writeToCloud = async (): Promise<boolean> => {
      const uid = await getCurrentUid()
      if (uid) {
        const existing = await cloudDb.collection('exam_results')
          .where({ exam_id: result.exam_id, student_name: result.student_name, _openid: uid })
          .get()
        if (existing.data?.length) {
          // T18-2a（2026-09-16）：`doc(id).update()` 改 `where({_id, _openid})`（同文件两条 Exam
          // 写路径的同一形态）。existing 来自上面带 `_openid: uid` 的查询，双条件命中至多一行。
          await cloudDb.collection('exam_results').where({ _id: existing.data[0]._id, _openid: uid }).update({
            answers: result.answers, correct: result.correct, wrong: result.wrong,
            unanswered: result.unanswered, score: result.score, accuracy: result.accuracy,
            duration_ms: result.duration_ms, submitted_at: result.submitted_at, query_code: result.query_code,
          })
          return true
        }
      }
      await cloudDb.collection('exam_results').add(result)
      return true
    }
    try {
      await writeToCloud()
      return
    } catch (e) {
      if (isAuthError(e)) {
        console.warn('交卷遇到权限错误，尝试刷新登录态重试…')
        if (await refreshAuth()) {
          try {
            await writeToCloud()
            return
          } catch (e2) {
            // 重试仍失败，抛出第二次错误
            throw e2
          }
        }
      }
      // 非 auth 错误或刷新失败，抛出原始错误
      throw e
    }
  }
  const results = getLocalResults()
  const idx = results.findIndex(r => r.exam_id === result.exam_id && r.student_name === result.student_name)
  if (idx >= 0) results[idx] = result
  else results.push(result)
  saveLocalResults(results)
}

// 按查询码查找答卷（用于错题回看）
export async function findResultByCode(examId: string, code: string): Promise<ExamResult | null> {
  const normalized = code.trim().toUpperCase()
  if (!normalized) return null
  if (await ensureCloud() && isCloud()) {
    const res = await cloudDb.collection('exam_results')
      .where({ exam_id: examId, query_code: normalized })
      .limit(1)
      .get()
    return res.data?.[0] || null
  }
  return getLocalResults().find(r => r.exam_id === examId && (r.query_code || '').toUpperCase() === normalized) || null
}

// 获取答卷中的错题明细（题干 + 选项 + 我的答案 + 正确答案 + 解析）
// myRaw/correctRaw：选择题=字母字符串（如 "B"/"A、C"），判断题='true'/'false'，填空=文本；供前端渲染选项高亮
export function getWrongQuestions(
  exam: Exam,
  result: ExamResult,
): { question: ExamQuestion; myAnswer: string; correctAnswer: string; analysis: string | null; myRaw: string | null; correctRaw: string | null }[] {
  const wrongs: { question: ExamQuestion; myAnswer: string; correctAnswer: string; analysis: string | null; myRaw: string | null; correctRaw: string | null }[] = []
  for (const q of exam.questions) {
    const a = result.answers[q.id]
    if (!a || (a.selected.length === 0 && !a.blank && a.judge === null)) continue // 未答不算错题
    const isCorrect = checkAnswer(q, a)
    if (isCorrect) continue
    const correctAnswerShape = { selected: parseAnswerLetters(q.answer), blank: q.answer || '', judge: q.type === 'judge' ? (judgeAnswerBool(q.answer, judgeOptionsOf(q)) === 'true') : null }
    wrongs.push({
      question: q,
      myAnswer: formatAnswer(q, a),
      correctAnswer: formatAnswer(q, correctAnswerShape),
      analysis: q.analysis || null,
      myRaw: formatAnswerRaw(q, a),
      correctRaw: formatAnswerRaw(q, correctAnswerShape),
    })
  }
  return wrongs
}

// 判断题选项数组（用于 A/B ↔ true/false 换算；云端判断题 options 为 ["正确","错误"]）
function judgeOptionsOf(q: ExamQuestion): string[] | null {
  try {
    const p = JSON.parse(q.options || '[]')
    if (Array.isArray(p)) return p.map((o: any) => String(o))
  } catch { /* ignore */ }
  return null
}

// 把答案格式化为可读文本（选择题转字母，判断题转对/错）
function formatAnswer(q: ExamQuestion, a: { selected: number[]; blank: string; judge: boolean | null }): string {
  if (isJudgeLike(q)) {
    if (a.judge === null) {
      // 旧快照曾被当选择题答（selected 下标 0=正确 1=错误）
      if (a.selected.length) return a.selected[0] === 0 ? '√ 正确' : '× 错误'
      return '（未答）'
    }
    return a.judge ? '√ 正确' : '× 错误'
  }
  if (q.type === 'single' || q.type === 'multi') {
    if (!a.selected.length) return '（未选）'
    return a.selected.map(i => String.fromCharCode(65 + i)).join('、')
  }
  return a.blank || '（未答）'
}

// 机器可读的答案（选择题=字母；判断题='true'/'false'；填空=文本）
function formatAnswerRaw(q: ExamQuestion, a: { selected: number[]; blank: string; judge: boolean | null }): string | null {
  if (isJudgeLike(q)) {
    if (a.judge !== null) return a.judge ? 'true' : 'false'
    if (a.selected.length) return a.selected[0] === 0 ? 'true' : 'false'
    return null
  }
  if (q.type === 'single' || q.type === 'multi') {
    if (!a.selected.length) return null
    return a.selected.map(i => String.fromCharCode(65 + i)).join('、')
  }
  return a.blank || null
}

export async function listExamResults(examId: string): Promise<ExamResult[]> {
  if (await ensureCloud() && isCloud()) {
    const res = await cloudDb.collection('exam_results')
      .where({ exam_id: examId })
      .orderBy('score', 'desc')
      .limit(500)
      .get()
    return res.data || []
  }
  return getLocalResults().filter(r => r.exam_id === examId).sort((a, b) => b.score - a.score)
}

// ===== 工具 =====

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// 判分：根据考生答案计算成绩
export function gradeExam(
  questions: ExamQuestion[],
  answers: ExamResult['answers'],
): { correct: number; wrong: number; unanswered: number; score: number; accuracy: number } {
  let correct = 0, wrong = 0, unanswered = 0
  for (const q of questions) {
    const a = answers[q.id]
    if (!a || (a.selected.length === 0 && !a.blank && a.judge === null)) {
      unanswered++
      continue
    }
    const isCorrect = checkAnswer(q, a)
    if (isCorrect) correct++
    else wrong++
  }
  const total = questions.length || 1
  const accuracy = Math.round((correct / total) * 100)
  const score = Math.round((correct / total) * 100)
  return { correct, wrong, unanswered, score, accuracy }
}

// 判断题内容识别：type='judge'，或选项恰为「正确/错误」类二元组的 single/multi 旧快照
// 2026-09-18 修复（重审 G-2 / D-03，控制端复核 V-9）：原判据只认**两对字面值**
//   （`t[0]==='正确' && t[1]==='错误'` 或 `对/错`），而本文件 `classifyQuestionType`（:78）与小程序
//   `quiz.ts:classifyType` 用的是「两个选项**都**是判断词（isJudgeWord 原值/剥前缀双查）」的宽集合
//   （含 √ × 是 否 true/false T/F）。于是**同一道题在「题型识别」与「判分分支」上用两套口径**，
//   后果分三种（控制端逐个推过）：
//     · `["√","×"]` + 答案 `A` → 落字母分支，而考生交的是 `{selected:[], judge:bool}` ⇒ **恒判错**；
//     · `["T","F"]` + 答案 `T` → `parseAnswerLetters` 的过滤器是 `/[A-Ha-h]/`，`T` 不在范围内
//       ⇒ 返回 `[]`，与考生那份空的 `selected` 相等 ⇒ **恒判对（白送分）**；
//     · `["是","否"]` → 按 judge 布尔值去对字母下标 ⇒ **真值反向**。
//   ⚠️ 答案侧（judgeAnswerBool）早就用的是宽集合，只有这个「题型是不是判断题」的判据没跟上——
//   所以修法不是"再加几个词"，而是与 classifyQuestionType 同口径复用 isJudgeWord + JUDGE_WORDS。
// 2026-09-18 修复（重审 C-13，第二半）：补上第三条规则，使本判据与客户端 `quiz.ts:classifyType`
//   **结构一致**（前两条随 G-2/D-03 对齐）。第三条原文：答案本身是判断词、且选项数为 0 或 2 ⇒ 判断题。
//   触发面在**存量快照**：类型被写成非 judge（老分类器的锅，见 C-06）而答案仍是判断词的题，
//   小程序按判断题渲染并提交 `{selected:[], judge:bool}`，而此处不认 ⇒ 走字母/填空分支 ⇒ 必判错。
//   新快照不会踩到（建卷时 type 已正确写成 'judge'，第一条即命中）——这条是给旧数据兜底。
export function isJudgeLike(q: { type?: string; options?: string | null; answer?: string | null }): boolean {
  if (q.type === 'judge') return true
  let opts: string[] = []
  try {
    const p = JSON.parse(q.options || '[]')
    if (Array.isArray(p)) opts = p.map((o: any) => String(o))
  } catch { /* 选项不是 JSON：按空处理，走下面的答案规则 */ }
  if (opts.length === 2 && opts.every((o: any) => isJudgeWord(o, JUDGE_WORDS))) return true
  const ans = String(q.answer == null ? '' : q.answer).trim()
  if (ans && (JUDGE_TRUE_WORDS.has(ans) || JUDGE_FALSE_WORDS.has(ans)) && (opts.length === 2 || opts.length === 0)) return true
  return false
}

function checkAnswer(q: ExamQuestion, a: { selected: number[]; blank: string; judge: boolean | null }): boolean {
  if (isJudgeLike(q)) {
    if (!q.answer) return false
    // 兼容新旧判断题 answer：新快照 'true'/'false'；旧快照 'A'/'B'（options=["正确","错误"]）
    const ans = judgeAnswerBool(q.answer, judgeOptionsOf(q)) === 'true'
    // 新答题存 judge；旧快照曾被当选择题答（存 selected 下标 0=正确 1=错误）
    const picked = a.judge ?? (a.selected.length ? (a.selected[0] === 0) : null)
    if (picked === null) return false
    return picked === ans
  }
  if (q.type === 'single' || q.type === 'multi') {
    // 2026-09-14 修复(P0-7)：两边都要排序。存储侧全链路无排序（parser.ts 的 normalizeChoiceAnswer
    // 只做 split→filter→upper→join），答案键写作 "CA" 时 correctLetters=[2,0] 而 picked=[0,2]，
    // JSON 串比较必然不等 → 选对了也恒判错，且用户无法通过任何操作选对。
    const correctLetters = parseAnswerLetters(q.answer).sort((x, y) => x - y)
    const picked = [...a.selected].sort((x, y) => x - y)
    return JSON.stringify(picked) === JSON.stringify(correctLetters)
  }
  // 填空/问答：粗略匹配（去空白 + 大小写不敏感）
  if (!q.answer) return false
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '')
  return norm(a.blank) === norm(q.answer)
}

// 2026-08-20：考试模式「交卷统一判分」——基于 QuestionCard 的暂存状态（deferSubmit 模式）
// st.selected 为原始下标（QuestionCard emitState 已转回），与 ExamResult.answers 判分口径一致
export function gradeByState(
  q: ExamQuestion,
  st: { selected: number[]; judgeSelected: boolean | null; blankAnswer?: string | null },
): boolean {
  if (isJudgeLike(q)) {
    if (st.judgeSelected == null) return false
    const ans = judgeAnswerBool(q.answer, judgeOptionsOf(q)) === 'true'
    return st.judgeSelected === ans
  }
  if (q.type === 'single' || q.type === 'multi') {
    if (!st.selected.length) return false
    const picked = [...st.selected].sort((x, y) => x - y)
    // 2026-09-14 修复(P0-7)：与 checkAnswer 同因——答案侧也要排序，否则 "CA" 这类存储顺序
    // 非字母序的答案键在「交卷统一判分」路径下同样恒判错
    return JSON.stringify(picked) === JSON.stringify(parseAnswerLetters(q.answer).sort((x, y) => x - y))
  }
  // 填空/问答
  if (!q.answer) return false
  const norm = (s: string) => (s || '').trim().toLowerCase().replace(/\s+/g, '')
  return norm(st.blankAnswer || '') === norm(q.answer)
}

function parseAnswerLetters(answer: string | null): number[] {
  if (!answer) return []
  try {
    const arr = JSON.parse(answer) as string[]
    return arr.map(s => s.trim().toUpperCase().charCodeAt(0) - 65)
  } catch {
    return answer.split('').filter(c => /[A-Ha-h]/.test(c)).map(c => c.toUpperCase().charCodeAt(0) - 65)
  }
}

// 分享链接（带 exam id 的 hash 路由）
export function examShareUrl(examId: string): string {
  const base = location.origin + location.pathname
  return `${base}#/exam/${examId}`
}
