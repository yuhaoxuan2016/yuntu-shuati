// examGate 云函数：考试流程的**服务端闸门**（T18-2d 加固，2026-09-16）
//
// 为什么存在：题目与答案同存于 `exams.questions[]`，而 `exams` 必须对 public 可读（否则考生打不开考试）
// ⇒ 任何考生都能在控制台执行 `where({visibility:'public'}).get()` 拿到全部答案（生产实测过）。
// CloudBase 安全规则是**文档级**的（不支持只放行文档内某些字段），所以唯一的真解法是：
// **考生不再直接读集合**，取卷（剥答案）与判分都走这里；规则随后收紧为「仅属主可读」。
//
// ⚠️ 部署顺序（两步，第二步必须等小程序正式版带上本改造之后，否则旧客户端考试功能会坏）：
//   ① 本函数 + 两端客户端改造先上（此时功能与旧版完全等价，规则未变、F12 仍可读）；
//   ② 小程序发布后执行：把 `exams` 的 read 规则改为 `doc._openid == auth.openid`
//      （`managePermissions(updateResourcePermission, noSqlDatabase, exams, CUSTOM, ...)`）。
//      届时 F12 直查返回 DATABASE_PERMISSION_DENIED，考生只能通过本函数拿到「无答案的卷」。
//
// 动作（action）：
//   list          公共考试列表（字段白名单，不含 questions）
//   paper         取卷：入参 examId → 返回**剥离 answer/analysis** 的题目 + 考试信息
//   grade         判分：入参 examId + answers → 服务端比对 → 返回成绩 + 答案表（供交卷后回看错题）
//   reviewByCode  凭查询码回看：入参 code → 返回该场考试（含答案）+ 该次成绩
//
// 判分逻辑是网页端 `src/lib/exam.ts` 的 `checkAnswer` / `gradeExam` 的**逐字移植**（P0-7 / P0-8 的口径
// 都在其中：选择题两侧排序后比较、判断题答案走 judgeAnswerBool 的剥前缀双查）。改动任一实现都要同步另一侧，
// 并跑 `tmp-verify/t18-2d-grade-parity.cjs` 的对拍夹具。
const cloudbase = require('@cloudbase/node-sdk')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()

// ⚠️ node-sdk 的 `get()` 回执 `data` 是**数组**（客户端 SDK 是对象）——读单文档必须取首元素。
function firstDoc(res) {
  const d = res && res.data
  if (Array.isArray(d)) return d[0] || null
  return d || null
}

// ===== 判分（网页端 exam.ts 的移植，保持逐字等价）=====
// 2026-09-18 修复（G-2/D-03）第二半：词集比小程序端**窄两档**——原集合缺 `是`/`否`，
//   而 yuntu-mp/src/lib/quiz.ts:18-19 的 JUDGE_TRUE/JUDGE_FALSE 一直含它们。
//   只补 isJudgeLike（上一半改动）不够：`["是","否"]` 能被识别成判断题后，`judgeAnswerBool` 里
//   `trueFirst = isJudgeWord(options[0], JUDGE_TRUE_WORDS)` 仍会把「是」当非真值词 ⇒ **真值反向**，
//   实测「点真」与「点假」都判错。两半都补齐才与小程序端同口径。
const JUDGE_TRUE_WORDS = new Set(['正确', '对', '√', 'true', 'TRUE', 'True', 't', 'T', '是'])
const JUDGE_FALSE_WORDS = new Set(['错误', '错', '×', 'false', 'FALSE', 'False', 'f', 'F', '否'])
// 2026-09-18 补：判断词全集（与网页端 exam.ts:29、小程序 quiz.ts:21 同口径）
const JUDGE_WORDS = new Set([...JUDGE_TRUE_WORDS, ...JUDGE_FALSE_WORDS])
const RE_OPT_PREFIX = /^[A-H][.、:：)]?\s*/i

function stripOptionPrefix(opt) {
  return String(opt == null ? '' : opt).replace(RE_OPT_PREFIX, '').trim()
}

function isJudgeWord(opt, set) {
  const raw = String(opt == null ? '' : opt).trim()
  return set.has(raw) || set.has(stripOptionPrefix(raw))
}

function judgeAnswerBool(ans, options) {
  const trueFirst = !!options && options.length >= 1 && isJudgeWord(options[0], JUDGE_TRUE_WORDS)
  const v = String(ans == null ? '' : ans).trim().toUpperCase()
  if (!v) return ''
  if (v === 'A') return trueFirst ? 'true' : 'false'
  if (v === 'B') return trueFirst ? 'false' : 'true'
  const raw = String(ans == null ? '' : ans).trim()
  if (JUDGE_TRUE_WORDS.has(raw)) return 'true'
  if (JUDGE_FALSE_WORDS.has(raw)) return 'false'
  return ''
}

function judgeOptionsOf(q) {
  try {
    const p = JSON.parse(q.options || '[]')
    if (Array.isArray(p)) return p.map(o => String(o))
  } catch (e) { /* ignore */ }
  return null
}

// 2026-09-18 修复（重审 G-2 / D-03，控制端复核 V-9）：原判据只认两对字面值（正确/错误、对/错），
// 而本函数的**答案侧**（judgeAnswerBool）早就用的是宽集合 JUDGE_TRUE/FALSE_WORDS。
// 判据窄一档的后果（控制端逐个推过，命中就是真金白银的分数错）：
//   · `["√","×"]` + 答案 `A` → 落字母分支，考生交的却是 `{selected:[], judge:bool}` ⇒ **恒判错**；
//   · `["T","F"]` + 答案 `T` → `parseAnswerLetters` 的过滤是 `/[A-Ha-h]/`，`T` 不在内 ⇒ 返回 `[]`，
//     与考生那份空的 `selected` 相等 ⇒ **恒判对（白送分）**；
//   · `["是","否"]` → 按 judge 布尔值对字母下标 ⇒ **真值反向**。
// 现与网页端 exam.ts:isJudgeLike、小程序 quiz.ts:classifyType 同口径：两选项皆为判断词即视为判断题。
// ⚠️ 网页端 exam.ts 里那份是**逐字相同的另一份**，两处必须同改（本提交两处都改了）。
// 2026-09-18 修复（重审 C-13）：补上第三条规则，使本判据与客户端 `quiz.ts:classifyType` **结构一致**
// （前两条已随 G-2/D-03 对齐）。第三条原文：答案本身是判断词、且选项数为 0 或 2 ⇒ 判断题。
// 触发面在**存量快照**：类型被写成非 judge（老分类器的锅，见 C-06）而答案仍是判断词的题，
// 小程序按判断题渲染并提交 `{selected:[], judge:bool}`，而闸门不认 ⇒ 走字母/填空分支 ⇒ 该题必判错。
// 注意：新快照不会踩到（两端建卷时 type 已被正确写成 'judge'，第一条规则即命中）——这条是给旧数据兜底。
function isJudgeLike(q) {
  if (q.type === 'judge') return true
  const opts = judgeOptionsOf(q) || []
  if (opts.length === 2 && opts.every(o => isJudgeWord(o, JUDGE_WORDS))) return true
  const ans = String(q.answer == null ? '' : q.answer).trim()
  if (ans && (JUDGE_TRUE_WORDS.has(ans) || JUDGE_FALSE_WORDS.has(ans)) && (opts.length === 2 || opts.length === 0)) return true
  return false
}

function parseAnswerLetters(answer) {
  if (!answer) return []
  try {
    const arr = JSON.parse(answer)
    return arr.map(s => String(s).trim().toUpperCase().charCodeAt(0) - 65)
  } catch (e) {
    return String(answer).split('').filter(c => /[A-Ha-h]/.test(c)).map(c => c.toUpperCase().charCodeAt(0) - 65)
  }
}

function checkAnswer(q, a) {
  if (isJudgeLike(q)) {
    if (!q.answer) return false
    const ans = judgeAnswerBool(q.answer, judgeOptionsOf(q)) === 'true'
    const picked = (a && a.judge !== null && a.judge !== undefined) ? a.judge : ((a && a.selected && a.selected.length) ? (a.selected[0] === 0) : null)
    if (picked === null) return false
    return picked === ans
  }
  if (q.type === 'single' || q.type === 'multi') {
    const correctLetters = parseAnswerLetters(q.answer).sort((x, y) => x - y)
    const picked = [...((a && a.selected) || [])].sort((x, y) => x - y)
    return JSON.stringify(picked) === JSON.stringify(correctLetters)
  }
  if (!q.answer) return false
  const norm = s => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, '')
  return norm(a && a.blank) === norm(q.answer)
}

function gradeAll(questions, answers) {
  let correct = 0, wrong = 0, unanswered = 0
  for (const q of questions) {
    const a = answers ? answers[q.id] : null
    if (!a || ((a.selected || []).length === 0 && !a.blank && (a.judge === null || a.judge === undefined))) {
      unanswered++
      continue
    }
    if (checkAnswer(q, a)) correct++
    else wrong++
  }
  const total = questions.length || 1
  const accuracy = Math.round((correct / total) * 100)
  return { correct, wrong, unanswered, score: accuracy, accuracy, total: questions.length }
}

// ===== 动作实现 =====
const LIST_FIELDS = ['_id', 'title', 'description', 'duration_minutes', 'deadline', 'created_at', 'question_count']

async function fetchAll(collection, where, max = 2000) {
  const all = []
  const PAGE = 100
  for (let skip = 0; skip < max; skip += PAGE) {
    const q = where ? db.collection(collection).where(where) : db.collection(collection)
    const res = await q.skip(skip).limit(PAGE).get()
    const rows = (res && res.data) || []
    all.push(...rows)
    if (rows.length < PAGE) break
  }
  return all
}

function stripForTaker(q) {
  const out = { ...q }
  delete out.answer
  delete out.analysis
  return out
}

function publicExamView(e, withQuestions, stripAnswers) {
  const view = {}
  for (const f of LIST_FIELDS) view[f] = e[f]
  const qs = Array.isArray(e.questions) ? e.questions : []
  // 题目数：**服务端算**。网页端建卷时并不写 `question_count` 字段（只有小程序端写），
  // 若只回白名单字段，网页端建的考试在列表里会显示「0 题」（收窄白名单后实测到的回归）。
  // 这里只回数量、不回题目本身，与「不下发答案」不矛盾。
  view.question_count = Number(e.question_count) || qs.length || 0
  if (withQuestions) {
    view.questions = stripAnswers ? qs.map(stripForTaker) : qs
  }
  return view
}

async function loadExam(examId) {
  const res = await db.collection('exams').doc(examId).get()
  return firstDoc(res)
}

async function actList() {
  const rows = await fetchAll('exams', { visibility: 'public' })
  const exams = rows.map(e => publicExamView(e, false, false))
  return { ok: true, total: exams.length, exams }
}

async function actPaper(payload) {
  const examId = String((payload && payload.examId) || '')
  if (!examId) return { ok: false, message: '缺少 examId' }
  const exam = await loadExam(examId)
  if (!exam) return { ok: false, message: '考试不存在或已被删除' }
  // 只服务公共考试：私有考试不通过本函数下发（属主直接按规则读自己的文档）
  if (exam.visibility !== 'public') return { ok: false, code: 'NOT_PUBLIC', message: '该考试不是公共考试' }
  return { ok: true, exam: publicExamView(exam, true, true) }
}

async function actGrade(payload) {
  const examId = String((payload && payload.examId) || '')
  const answers = (payload && payload.answers) || {}
  if (!examId) return { ok: false, message: '缺少 examId' }
  const exam = await loadExam(examId)
  if (!exam) return { ok: false, message: '考试不存在或已被删除' }
  // 2026-09-18 修复（重审 D-01，控制端复核 V-6）：**答案键只对公共考试下发**。
  //   此前本动作一道门都没有：传任意 examId（包括看不到的私有考试）即可取到**整卷答案键**，
  //   而上一轮刚把 `exams` 的读规则收紧为仅属主（F12 直查已封）⇒ 这里成了答案的旁路出口，
  //   等于那次加固没封死。
  //   ⚠️ 为什么不是像 `actPaper` 那样直接拒私有考试：网页端**所有**考试（含属主自己的私有考试）
  //   都走本动作判分（`ExamTakeView.doSubmit` → `gradeExamViaServer`），硬拒会把属主自测打断。
  //   所以按「判分继续、答案不给」处理：私有考试只回成绩，不回 key。
  const isPublic = exam.visibility === 'public'
  const questions = Array.isArray(exam.questions) ? exam.questions : []
  const result = gradeAll(questions, answers)
  // 答案表：**交卷后**才通过本动作下发（考前只有 actPaper 的无答案卷）。
  // 2026-09-18 修复（重审 D-02）：**没有任何实际作答时也不下发答案键**。
  //   原实现无条件把整卷 key 返回 ⇒ 传一个空 `answers` 就能零成本取走整卷答案与解析（还能反复刷分）。
  //   以「全卷未答」为界（直接用 gradeAll 的 unanswered 判定，与判分口径一致、不自造第二套）：
  //   交卷场景必然有作答；真的一题未答就交卷时只回成绩，回看页不显示正确答案——这是应得的（确实没答）。
  const key = {}
  for (const q of questions) key[String(q.id)] = { answer: q.answer ?? null, analysis: q.analysis ?? null }
  const hasAnswer = result.unanswered < questions.length
  return { ok: true, ...result, key: (isPublic && hasAnswer) ? key : null }
}

async function actReviewByCode(payload) {
  const code = String((payload && payload.code) || '').trim().toUpperCase()
  if (!code) return { ok: false, message: '缺少查询码' }
  const res = await db.collection('exam_results').where({ query_code: code }).limit(1).get()
  const result = firstDoc(res)
  if (!result) return { ok: false, code: 'NOT_FOUND', message: '未找到该查询码的成绩' }
  const exam = await loadExam(result.exam_id)
  if (!exam) return { ok: false, code: 'NOT_FOUND', message: '考试不存在或已被删除' }
  return { ok: true, result, exam: publicExamView(exam, true, false) }
}

exports.main = async (event = {}) => {
  const { action, payload = {} } = event
  try {
    switch (action) {
      case 'list': return await actList()
      case 'paper': return await actPaper(payload)
      case 'grade': return await actGrade(payload)
      case 'reviewByCode': return await actReviewByCode(payload)
      default: return { ok: false, code: 'UNKNOWN_ACTION', message: '未知操作: ' + action }
    }
  } catch (e) {
    // 原始错误不外发（与 admin-api 同纪律）；原文进日志
    console.error('[examGate]', action, e)
    return { ok: false, code: 'ERROR', message: '操作失败，请稍后重试' }
  }
}
