// 题目解析器：从 Rust structure.rs 移植的核心正则逻辑
// 支持：单选题/多选题/判断题/填空题/问答题 + 章节/小节 + 答案区 + 解析
// 修复：BUG-001 判断题被误判为填空（RE_BLANK 优先级过高 + 判断答案未归一化）

export type QType = 'single' | 'multi' | 'judge' | 'blank' | 'qa'

export interface ParsedQuestion {
  type: QType
  stem: string
  options: string[]
  answer: string | null
  analysis: string | null
  source_index: number
  confidence: number
  chapter?: number
  section?: number
}

// === 正则（与 Rust 版一致） ===
// 2026-09-15 修复(P1-7)：分隔符后加紧邻负向预查 (?!\d)——`1.5 米` 这种小数续行
// 分隔符 `.` 后紧跟数字 `5`，整体不再匹配题号；而 `1. 5G 网络的说法正确的是` 的 `.` 后是空格，
// 仍正常匹配为新题（紧邻预查只挡「分隔符后立刻是数字」，不挡「余下文本以数字开头」）。
const RE_NUM_START = /^\s*[\(（]?(\d+)[\.、．)）](?!\d)\s*(.+)/
const RE_NUM_STRIP = /^\s*[\(（]?\d+[\.、．)）](?!\d)\s*(.+)/
// 选项识别：A-H（支持 5-8 选项多选，对齐真实题库 E/F/G/H 选项）
// 2026-08-15 增强：支持 A. / A、 / A．/ A) / A） / A: / A： 等分隔符
// 2026-09-15 修复(P2-26)：加 `[\(（]?` 前缀 + `[\)）]?` 收尾，支持 `(A) 正确`/`（A）正确` 式选项标签。
// `)` 本身可充当分隔符；可选收尾靠正则回溯同时覆盖 `(A) text`（`)` 当分隔符）与 `(A). text`（`)` 收尾、`.` 当分隔符）。
// 分隔符仍为必选，故 `A text`（字母后无分隔符的续行）不会被误判成选项。
const RE_OPT = /^\s*[\(（]?([A-H])[\)）]?\s*[\.、．)）:：]\s*(.+)/
const RE_ANS = /^\s*(答案|正确答案|【答案】)\s*[:：]?\s*(.+)/i
const RE_ANA = /^\s*(解析|答案解析|【解析】)\s*[:：]?\s*(.+)/i
const RE_BLANK = /_{2,}|（\s*）|\(\s*\)|【\s*】/
// 2026-09-15 修复(P2-26)：RE_OPT_MARK 真正接上——用于拆分与题干同行的内联选项
// （`1. 下列… A. x B. y C. z D. w`，PDF 文本提取的常态），此前它只定义未引用，此类题产出 options:[] 与 type:'qa'。
// 加 `[\(（]?` 前缀以同时识别 `(A)` 式内联标记。原 RE_ANS_HEADER 是死代码（isAnswerHeader 另行实现），已删除。
const RE_OPT_MARK = /[\(（]?([A-H])[\.、．)）:：]\s*/
const RE_ANS_EXTRACT = /(\d+)[\.、．)]\s*\(?([A-Ha-h](?:[、,，]*[A-Ha-h]){0,7}|正确|错误|对|错|√|×|true|false)\)?/
// 2026-09-15(P0-9/GC11)：整行恰好是「题号 + 一个答案 token」、其后无散文（^…$ 锚定，token 同 RE_ANS_EXTRACT）。
// 用于答案区守卫区分逐题判断答案 `1. 对`/`1. 正确`（整行就是答案 → 消费）与题干 `3. 对于某系统…`
// （「对」后还有散文 → 拒绝、走退出检查）。没有它，中文判断词答案会因 hasChinese 被守卫误拒，削弱既有导入行为。
// 2026-09-15 修复(评审 Minor)：允许**一个可选的句末标点**（`。`/`．`/`.`）。中文文档里逐题判断答案
// 常写成 `1. 对。`，而原先 `\)?\s*$` 不接受句点 → 第三析取项落空 → 该行掉到退出检查、
// 反而产生伪题「对。」，比修复前（无守卫时会直接消费）更差。加标点后 `3. 对于某系统…` 仍被拒
// （「对」之后是「于某系统…」而非单个句点，`$` 锚定不成立）。
const RE_PURE_ANS_LINE = /^\s*[\(（]?\d+[\.、．)）]\s*\(?(?:[A-Ha-h](?:[、,，]*[A-Ha-h]){0,7}|正确|错误|对|错|√|×|true|false)\)?[。．.]?\s*$/i
const RE_PAREN_ANS = /[\(（]\s*([A-Ha-h](?:[、,，][A-Ha-h]){0,7})\s*[\)）]/
const RE_CHAPTER = /^\s*第([一二三四五六七八九十百千零\d]+)\s*章/
// 2026-09-15 修复(P1-6)：小节标题扩展 填空/问答/简答/论述/案例——原正则只认 单项选择|多项选择|单选|多选|判断，
// 故 `四、简答题` 不被识别 → section 停在上一节的 3（判断），兜底再把后续简答题全部强改成 judge。
const RE_SECTION = /^\s*[一二三四五六七八九十]+\s*[、,，]\s*(单项选择|多项选择|单选|多选|判断|填空|问答|简答|论述|案例)/
const RE_SECTION_SOLO = /^\s*(单项选择题|多项选择题|单选题|多选题|判断题|填空题|问答题|简答题|论述题|案例题)\s*$/
// 2026-09-15 修复(P1-6)：兜底章节头——任何「中文序号 + 、/，/,」行（如 `五、其他`、`一、绪论`）都当章节/分区头，
// flush + reset，绝不拼进上一题选项（原实现漏识别时会拼出 `D. 以上都不对四、简答题`）。
const RE_SECTION_GENERIC = /^\s*[一二三四五六七八九十]+\s*[、,，]/
const RE_RANGE = /(\d+)\s*[-—–~～]+\s*(\d+)\s*[.、．:：]?/
const RE_JUDGE_WORD = /正确|错误|true|false|对|错|√|×|T|F/i
const RE_INTRO = /^\s*导论\s*$/

// === 判断题精确匹配（对齐 Rust is_judge_answer，避免子串误判如"FTP"含F） ===
// 2026-09-18 修复（重审 A-18 / G-2 同族）：补 `是`/`否`——运行时三端（quiz.ts:18-19、
// exam.ts:27-28、examGate:36-37）的判断词集一直含它们，只有解析器这份没跟上，
// 于是「无选项 + 答案 是」在导入时被判成问答，而运行时的题型判据又认它是判断题（端间不一致）。
const JUDGE_TRUE = new Set(['正确', '对', '√', 'T', 't', 'true', 'True', 'TRUE', '是'])
const JUDGE_FALSE = new Set(['错误', '错', '×', 'F', 'f', 'false', 'False', 'FALSE', '否'])

// 判断题选项行：A. 正确 / B. 错误（首选项匹配，用于选项式判断题）
const RE_JUDGE_OPT = /^\s*[A-D]\s*[\.、．)）:：]\s*(正确|错误|对|错|√|×|true|false)\s*$/i

// 2026-09-15 修复(P2-26)：全角选项字母/分隔符归一化为 ASCII 后再走所有识别正则。
// CJK 文字处理器转 docx 常见 `Ａ．正确`/`（A）正确` 全角形态，原正则 ASCII-only 全部漏识别。
// **准确说明影响面（2026-09-15 评审 Minor 更正：原注释称「保留题干原貌」言过其实）**：
// - 会被改写：全角字母 `Ａ-Ｈ`/`ａ-ｈ`，以及全角 `．）（：` —— 后者是**无差别**替换，
//   散文里的也会被改，例如题干 `操作系统（OS）：…` 会变成 `操作系统(OS):…`。这是**肉眼可见**的改写。
// - 不会被改写：中文标点 `，。？、；`、全角数字、汉字。其中全角 `？` 是**故意**保留的，
//   否则 P1-6 的「题干像陈述句（不含 `？`）」回落判断会失效。
// - 上述散文改写**功能上无害**：`RE_BLANK` 同时列了 `（\s*）` 与 `\(\s*\)` 两种空括号形态，
//   故归一后填空检测照常工作；其余识别正则对 ASCII 与全角分隔符都能匹配。
// - **诚实记录**：严格需要的只有全角**字母**归一——`RE_OPT`/`RE_NUM_START`/`RE_OPT_MARK`/`RE_ANS_EXTRACT`
//   的字符类里本来就已收录 `．）（：` 的全角形态，故分隔符那一半**基本是冗余**的，此处保留只为口径统一。
//   把它收窄成「仅字母」可减少对题干外观的改写，属 Task 17 终审的清理候选（本轮按裁定只改注释、不改行为）。
function normalizeFullWidth(line: string): string {
  return line.replace(/[Ａ-Ｈａ-ｈ．）（：]/g, c => {
    const code = c.charCodeAt(0)
    // 全角字母 Ａ-Ｈ(FF21-FF28) / ａ-ｈ(FF41-FF48) → ASCII（差值 0xFEE0）
    if ((code >= 0xff21 && code <= 0xff28) || (code >= 0xff41 && code <= 0xff48)) {
      return String.fromCharCode(code - 0xfee0)
    }
    // 全角分隔符 → ASCII
    if (c === '．') return '.'
    if (c === '）') return ')'
    if (c === '（') return '('
    if (c === '：') return ':'
    return c
  })
}

// 2026-09-15 修复(P1-6)：小节标题关键词 → section 编码（1=单选 2=多选 3=判断 4=填空 5=问答/简答/论述/案例）。
// RE_SECTION 与 RE_SECTION_SOLO 两个分支共用此映射，避免新增编码时两处走样。
function sectionFromKeyword(kw: string): number {
  if (kw.includes('判断')) return 3
  // 2026-09-15 修复(P0-10 的前置条件)：`二、多项选择题` 经 RE_SECTION 捕获到的是 `多项选择`，
  // 经 RE_SECTION_SOLO 捕获到的是 `多项选择题`——两者都**不含连续的「多选」二字**（「多」后面跟的是「项」），
  // 故原判据 `includes('多选')` 落空、掉到末尾 `return 1` 被当成**单选**。
  // 后果是 P0-10 的多选答案分组（只在 `section === 2` 时生效）对最常见的正式小节头**完全不触发**：
  // `二、多项选择题` 下的 `21-25 ABD ACD ABC AB AC` 仍被扁平成 5 个单字母。补 `多项` 才算真修好 P0-10。
  // 无误判风险：`单项选择`/`单选题` 含的是「单项」而非「多项」，不会命中本分支。
  if (kw.includes('多选') || kw.includes('多项')) return 2
  if (kw.includes('填空')) return 4
  if (kw.includes('问答') || kw.includes('简答') || kw.includes('论述') || kw.includes('案例')) return 5
  return 1
}

export function isJudgeAnswer(ans: string | null | undefined): boolean {
  if (!ans) return false
  const v = ans.trim().toLowerCase()
  return JUDGE_TRUE.has(v) || JUDGE_FALSE.has(v)
}

// 归一化判断题答案（对齐 Rust normalize_answer：true/false）
export function normalizeJudgeAnswer(ans: string): string {
  const v = ans.trim().toLowerCase()
  if (JUDGE_TRUE.has(v)) return 'true'
  if (JUDGE_FALSE.has(v)) return 'false'
  return ans.trim()
}

// 归一化选择题答案：AC 紧凑格式（前端 parseAnswerLetters 兼容紧凑和 ["A","C"] 两种）
export function normalizeChoiceAnswer(ans: string): string {
  const letters = ans.split('').filter(c => /[A-H]/i.test(c)).map(c => c.toUpperCase())
  return letters.join('')
}

function parseChineseNum(s: string): number {
  const n = parseInt(s)
  if (!isNaN(n)) return n
  let total = 0, current = 0
  for (const c of s) {
    let v = 0
    switch (c) {
      case '零': v = 0; break
      case '一': v = 1; break
      case '二': v = 2; break
      case '三': v = 3; break
      case '四': v = 4; break
      case '五': v = 5; break
      case '六': v = 6; break
      case '七': v = 7; break
      case '八': v = 8; break
      case '九': v = 9; break
      case '十': v = current === 0 ? 10 : current * 10; break
      case '百': v = current * 100; break
      case '千': v = current * 1000; break
      default: v = 0
    }
    if (c === '十' || c === '百' || c === '千') {
      total += v
      current = 0
    } else {
      current = v
    }
  }
  return total + current
}

// HTML 转段落（移植 docx.rs parse_html）
export function htmlToParagraphs(html: string): { paragraphs: string[]; images: string[] } {
  const paragraphs: string[] = []
  const images: string[] = []
  if (!html.toLowerCase().includes('<p')) {
    const plain = stripTags(html)
    return {
      paragraphs: plain.split('\n').map(s => s.trim()).filter(s => s.length > 0),
      images: []
    }
  }
  let current = ''
  let inP = false
  let i = 0
  while (i < html.length) {
    if (html[i] === '<' && html[i + 1] === 'p') {
      const next = html[i + 2] || '>'
      if (next === '>' || next === ' ') {
        inP = true
        while (i < html.length && html[i] !== '>') i++
        i++
        continue
      }
    }
    if (html[i] === '<' && html[i + 1] === '/' && html[i + 2] === 'p' && html[i + 3] === '>') {
      inP = false
      const text = stripTags(current).trim()
      if (text) paragraphs.push(text)
      current = ''
      i += 4
      continue
    }
    if (html[i] === '<' && html[i + 1] === 'i' && html[i + 2] === 'm' && html[i + 3] === 'g') {
      let end = i
      while (end < html.length && html[end] !== '>') end++
      const imgTag = html.slice(i, end)
      const b64Idx = imgTag.indexOf('base64,')
      if (b64Idx >= 0) {
        const after = imgTag.slice(b64Idx + 7)
        const b64 = after.split(/["\s]/)[0]
        if (b64) {
          images.push(b64)
          current += `[IMG:${images.length - 1}]`
        }
      }
      i = end
      continue
    }
    if (inP) current += html[i]
    i++
  }
  if (paragraphs.length === 0 && current.trim()) {
    for (const line of stripTags(current).split('\n')) {
      const t = line.trim()
      if (t) paragraphs.push(t)
    }
  }
  return { paragraphs, images }
}

function stripTags(s: string): string {
  let out = ''
  let inTag = false
  for (const c of s) {
    if (c === '<') inTag = true
    else if (c === '>') inTag = false
    else if (!inTag) out += c
  }
  return out
}

// === 主解析（移植 structure.rs parse_questions） ===
// 支持：章节/小节跟踪 + 答案区识别 + 答案回填
export function parseQuestions(paragraphs: string[]): ParsedQuestion[] {
  const questions: ParsedQuestion[] = []
  // 题目元信息（chapter, section, original_num）与 questions 一一对应
  const questionsMeta: { chapter: number; section: number; num: number }[] = []
  let chapter = 0
  let section = 0
  let blocks: string[] = []
  let sourceIndex = 0
  let inAnswerSection = false
  // 答案表：key = "ch:sec:num"，避免多章节题号重复串扰
  const answerMap = new Map<string, string>()
  // 当前题的原始题号（题号行解析，可能每章重复）
  let currentNum = 0
  // 2026-09-15 修复(P1-7)：题号是否已可信。false = 尚未接受过任何题（bootstrap）或刚过章节/小节重置，
  // 此时无条件接受下一个题号；true = 已接受过题，后续题号须满足 num === currentNum + 1 才起新题，
  // 否则当题干续行（避免小数/括号子项/非单调题号产出伪题）。
  let numTrusted = false

  const pushQuestion = () => {
    const pq = buildQuestion(blocks, sourceIndex, chapter, section)
    if (pq) {
      // 题型完全由内容判定（对齐原版 structure.rs：build_question 用 detect_type 独立判定）
      // 小节标题只影响答案 key 的 section，不强制题型（原网页版强行强制导致跨小节误判）
      questions.push(pq)
      questionsMeta.push({ chapter, section, num: currentNum })
      sourceIndex++
    }
    blocks = []
  }

  const flush = () => {
    if (blocks.length > 0) pushQuestion()
  }

  for (const line of paragraphs) {
    // 2026-09-15 修复(P2-26)：先做全角归一化，后续所有识别正则都在 ASCII 选项字母/分隔符上工作
    const t = normalizeFullWidth(line.trim())
    if (!t) continue

    // 章节标题（题目区和答案区都要检测，答案区也按章节分组）
    const ch = t.match(RE_CHAPTER)
    if (ch && t.length < 50) {
      flush()
      chapter = parseChineseNum(ch[1])
      section = 0
      numTrusted = false   // P1-7：新章节题号可能重启，放行下一个题号
      // 章节切换不影响 inAnswerSection（答案区可能跨章节）
      continue
    }
    // 导论
    if (RE_INTRO.test(t)) {
      flush()
      chapter = 0
      section = 0
      numTrusted = false   // P1-7：分区重置，放行下一个题号
      continue
    }
    // 小节标题（section 语义对齐 Rust：1=单选 2=多选 3=判断，P1-6 新增 4=填空 5=问答/简答/论述/案例，0=未知）
    const sec = t.match(RE_SECTION)
    if (sec) {
      flush()
      section = sectionFromKeyword(sec[1])
      numTrusted = false   // P1-7：小节重置，放行新分区首题号（等价 bootstrap）
      continue
    }
    const secSolo = t.match(RE_SECTION_SOLO)
    if (secSolo) {
      flush()
      section = sectionFromKeyword(secSolo[1])
      numTrusted = false   // P1-7：小节重置
      continue
    }
    // 2026-09-15 修复(P1-6)：兜底章节头——任何其余「中文序号 + 、/，/,」行都当章节/分区头，
    // flush + reset，绝不拼进上一题选项。chapter 不在此重置：这类行不携带明确章号语义，
    // 保持原 chapter 可让答案键在两侧一致（题侧与答案侧读到同一个 chapter）。
    if (RE_SECTION_GENERIC.test(t)) {
      flush()
      section = 0
      numTrusted = false
      continue
    }

    // === 答案区识别（移植 structure.rs） ===
    if (!inAnswerSection) {
      // 答案区标题：行含"答案"关键词且非内联答案（"答案：A" 是内联，不进答案区）
      if (isAnswerHeader(t)) {
        flush()
        inAnswerSection = true
        continue
      }
      // 启发式：无标题但直接是答案行（如 "1-5 ABCCA" / "1.ABC"），≥2 个答案时进答案区
      const tmp = new Map<string, string>()
      if (extractAnswers(t, chapter, section, tmp)) {
        const count = tmp.size
        const hasChinese = /[\u4e00-\u9fff]/.test(t)
        if (count >= 2 || (count >= 1 && !hasChinese)) {
          flush()
          // 2026-09-15 修复(P0-11)：删掉 answerMap.clear()。回填只在整篇解析完后执行一次，分章节文档里
          // 每次有编号题干行退出答案块（如 `第一章 … 1-20 ABCCA… / 第二章 …`）都会重进本启发式；原实现第二次
          // 进入时在第一章尚未回填前就抹掉了它的答案 → 第一章题产出 answer:null、confidence 降到 0.6、被视作不可作答。
          // 复合键 ch:sec:num 的 map.set 本身就是按键覆盖，合并 tmp 安全（带标题路径原本就不清空，两条入口现已一致）。
          for (const [k, v] of tmp) answerMap.set(k, v)
          inAnswerSection = true
          continue
        }
      }
    } else {
      // === 答案区内 ===
      // 2026-09-15 修复(P0-9)：由守卫决定谁是答案行——先喂给 extractAnswers 到临时 map，满足与启发式入口
      // 同款守卫（count>=2 || (count>=1 && !hasChinese)）才当答案消费；守卫不成立才走 RE_NUM_START 退出检查。
      // 原实现无条件先跑 extractAnswers 并直接写 answerMap，故 `3. 对于某系统，下列说法正确的是`（提到「对」）
      // 被当答案吃掉、inAnswerSection 恒为 true，此后所有选项行落到末尾 continue 被静默丢弃，文档剩余产出 0 道题。
      // 三种形态分流：`3. A`(count=1、无中文 → 守卫成立 → 当答案消费)、
      // `3. 对于某系统…`(提到「对」count=1、含中文 → 守卫不成立 → 退出答案区开新题)、
      // `21-25 ABD ACD ABC AB AC`(count=5 → 守卫成立 → 当答案消费)。
      const tmp = new Map<string, string>()
      if (extractAnswers(t, chapter, section, tmp)) {
        const count = tmp.size
        const hasChinese = /[\u4e00-\u9fff]/.test(t)
        // P0-9 守卫：多答案、或单个非中文答案（如 `3. A`）→ 直接当答案消费。
        // GC11 补充：单个中文答案但整行恰为「题号+答案 token」无尾部散文（`1. 对`/`1. 正确` 逐题判断答案）→
        // 同样消费；否则中文判断词答案会因 hasChinese 被误拒、退出答案区产假题且答案丢失，削弱既有导入行为
        // （实测：`参考答案 / 1. 对 / 2. 错` 修复前正常回填，字面守卫下判断答案全丢并多出「对」「错」两道伪题）。
        // 仅当有尾部散文（`3. 对于某系统…`）才拒绝并走下面的退出检查——那才是 P0-9 要修的吞题干场景。
        if (count >= 2 || (count >= 1 && !hasChinese) || (count === 1 && RE_PURE_ANS_LINE.test(t))) {
          for (const [k, v] of tmp) answerMap.set(k, v)
          continue
        }
      }
      if (t === '.' || t === ',' || t === '、' || t === '．' || t === '：') continue
      // 非答案行：若为新题号则答案区结束，重新开始题目解析
      const numMatch = t.match(RE_NUM_START)
      if (numMatch) {
        inAnswerSection = false
        currentNum = parseInt(numMatch[1], 10)
        numTrusted = true   // P1-7：退出答案区起题，标记可信，后续题号须 +1 才另起新题
        flush()
        blocks = splitInlineOptions(t)   // P2-26：新题起始行同样拆分同行内联选项
        continue
      }
      // 其余行（如解析文字）忽略，留在答案区
      continue
    }

    // 新题开始（以数字开头）
    const numMatch = t.match(RE_NUM_START)
    if (numMatch) {
      const num = parseInt(numMatch[1], 10)
      // 2026-09-15 修复(P1-7)：题号可信才起新题——首题（bootstrap，numTrusted=false）或单调 +1（num===currentNum+1）。
      // 章节/小节/分区重置后 numTrusted=false，放行新分区首题号（等价 bootstrap），避免首题编号非 1 时整篇被清空。
      // 不可信（已接受过题且非 +1，如题号 7→1→2→8）则当题干续行，避免小数/括号子项/非单调题号产出伪题。
      if (numTrusted && num !== currentNum + 1) {
        if (blocks.length > 0) blocks.push(...splitInlineOptions(t))
        continue
      }
      flush()
      currentNum = num
      numTrusted = true
      // P2-26：拆分同行内联选项（如 `1. 下列… A. x B. y C. z D. w`，PDF 提取常态）
      blocks = splitInlineOptions(t)
      continue
    }

    // 答案/解析/选项等归属当前题
    if (blocks.length > 0) {
      // P2-26：续行也可能同行携带内联选项（如整行 `A. x B. y C. z D. w`），同样拆分；无标记时原样入块
      blocks.push(...splitInlineOptions(t))
    } else if (RE_ANS.test(t) || RE_ANA.test(t)) {
      // 游离答案/解析，开启新块
      blocks = [t]
    }
  }
  flush()

  // === 回填缺失答案（对齐 structure.rs：按 (chapter, section, num) 精确匹配） ===
  let filled = 0
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]
    if (q.answer) continue
    const meta = questionsMeta[i]
    // 精确匹配 (chapter, section, num)
    let ans = answerMap.get(`${meta.chapter}:${meta.section}:${meta.num}`)
    // 2026-09-15 修复(P1-8)：section===0 时写入端已按答案 token 自身推导有效 section（1/2/3），
    // 故这里再按题目已定型的 qType 映射到同一编码（judge→3、multi→2、single→1）查一次，
    // 消除「单选第 1 题」与「判断第 1 题」共用 `ch:0:1` 互相覆盖。section 非 0 时不走此路（键里已有真实 section）。
    if (!ans && meta.section === 0) {
      const typeSec = q.type === 'judge' ? 3 : q.type === 'multi' ? 2 : q.type === 'single' ? 1 : 0
      if (typeSec !== 0) ans = answerMap.get(`${meta.chapter}:${typeSec}:${meta.num}`)
    }
    // 题目区 section 未被识别（section=0）时，跨 section 查找同 chapter 同 num
    if (!ans && meta.section === 0) {
      const candidates: { sec: number; ans: string }[] = []
      for (const [k, v] of answerMap) {
        const [c, s, n] = k.split(':').map(Number)
        if (c === meta.chapter && n === meta.num && s !== 0) candidates.push({ sec: s, ans: v })
      }
      if (candidates.length === 1) ans = candidates[0].ans
      else if (candidates.length > 1) {
        // 多候选：无选项 → sec=3（判断题）；有选项 → 单选(1) 优先，其次多选(2)
        const preferred = q.options.length === 0 ? 3 : 1
        const hit = candidates.find(c => c.sec === preferred) || candidates.find(c => c.sec === 2)
        if (hit) ans = hit.ans
      }
    }
    if (ans) {
      q.answer = normalizeAnswer(ans)
      // 回填后重判题型（判断题答案 true/false → judge，选择题答案多字母 → multi）
      const detected = detectType(q.stem, q.options, q.answer)
      if (detected !== q.type) q.type = detected
      filled++
    }
  }
  if (filled > 0) console.log(`[parser] 答案回填 ${filled}/${questions.length} 题`)

  return questions
}

// === 答案区工具（对齐 structure.rs） ===

// 2026-09-15 修复(P1-8)：无章节标题文档里 section 恒为 0，单选 1..30 与判断 1..20 同写 `ch:0:1..20`，
// 判断答案覆盖选择答案 → 单选第 1 题拿到「对」→ 归一成 'true' → parseAnswerLetters 误判 → 该题永久无法作答。
// 这里在 section===0 时由答案 token 自身推导有效 section（编码同小节语义：判断词→3、≥2 字母→2、1 字母→1），
// 写键与读键同口径即可消除碰撞。判断词用精确集合 JUDGE_TRUE/JUDGE_FALSE，不用 RE_JUDGE_WORD
// （后者含 T/F 子串，会把带 T/F 字母的选择答案误判成判断题）。section 非 0 时行为不变。
function deriveSectionFromAnswer(token: string, section: number): number {
  if (section !== 0) return section
  const v = token.trim().toLowerCase()
  if (JUDGE_TRUE.has(v) || JUDGE_FALSE.has(v)) return 3
  const letters = token.match(/[A-Ha-h]/g) || []
  if (letters.length >= 2) return 2
  if (letters.length === 1) return 1
  return section
}

// 2026-09-15 修复(P2-26)：拆分与题干同行的内联选项（`1. 下列… A. x B. y C. z D. w`，PDF 文本提取常态）。
// 强守卫避免误拆普通正文：① 标记须位于行首或其前为空白；② ≥2 个标记；③ 字母从 A 起严格 +1 升序。
// 命中则返回 [题干段, 选项A, 选项B, …]（题干段为空时丢弃），否则原样返回 [line]。
function splitInlineOptions(line: string): string[] {
  const re = new RegExp(RE_OPT_MARK.source, 'g')
  const marks: { idx: number; letter: string }[] = []
  for (const m of line.matchAll(re)) {
    const idx = m.index ?? 0
    if (idx > 0 && !/\s/.test(line[idx - 1])) continue   // 标记前必须是空白（或行首），排除词内误命中
    marks.push({ idx, letter: m[1] })
  }
  if (marks.length < 2) return [line]
  if (marks[0].letter !== 'A') return [line]
  for (let i = 1; i < marks.length; i++) {
    if (marks[i].letter.charCodeAt(0) !== marks[i - 1].letter.charCodeAt(0) + 1) return [line]
  }
  // 2026-09-15 修复(评审 Minor)：要求**每个**选项标记后面都有实际文本，否则放弃拆分。
  // 反例：`1. 人类的血型有 A. B. O. AB 四种` —— 标记序列是 [A,B]（`O` 不在 A-H 内，升序校验止于 2），
  // 于是切出**退化片段** `A.`（标记后为空）与 `B. O. AB 四种`；而 `A.` 又不匹配 RE_OPT，
  // 会被拼回题干成 `人类的血型有A.`——一道本来干净的问答题被撕裂。修复前该行根本不进这条路径
  // （P2-26 才把 RE_OPT_MARK 接上），故这是新启用路径上的新行为，必须自带这道保护。
  const optSlices: string[] = []
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].idx : line.length
    const slice = line.slice(marks[i].idx, end).trim()
    if (!slice.replace(RE_OPT_MARK, '').trim()) return [line]   // 只有标记没有文本 → 不是内联选项行
    optSlices.push(slice)
  }
  const parts: string[] = []
  const stem = line.slice(0, marks[0].idx).trim()
  if (stem) parts.push(stem)
  for (const s of optSlices) parts.push(s)
  return parts
}

// 答案区标题：行含"答案"关键词，且非内联答案（"答案：A" 不算）、非题号行
function isAnswerHeader(line: string): boolean {
  const lower = line.toLowerCase()
  const hasKw = lower.includes('参考答案') || lower.includes('标准答案')
    || lower.includes('正确答案') || lower.includes('试题答案')
    || lower.includes('答案') || lower.includes('answer')
  if (!hasKw) return false
  // 内联答案："答案：A"（after 含字母/判断词）→ 不算标题
  const ansMatch = line.match(RE_ANS)
  if (ansMatch) {
    const after = ansMatch[2].trim()
    if (/[A-Za-z0-9\u4e00-\u9fff]/.test(after) || RE_JUDGE_WORD.test(after)) return false
  }
  // 题号行："1. 答案是..." → 不算标题
  if (RE_NUM_START.test(line)) return false
  return true
}

// 从一行提取答案，写入 map（key = "ch:sec:num"）。支持 range 和逐题格式。
// 返回是否提取到任何答案。
function extractAnswers(line: string, chapter: number, section: number, map: Map<string, string>): boolean {
  const t = line.trim()
  if (!t) return false
  let found = false

  // range 格式：1-5 ABCCA / 1—5 对对对对对 / 1-5 ABCCA 6-10 BBDCC
  // RE_RANGE 非 global，matchAll 需要 global 正则，这里动态创建
  const reRangeGlobal = new RegExp(RE_RANGE.source, 'g')
  const rangeMatches = Array.from(t.matchAll(reRangeGlobal))
  for (let i = 0; i < rangeMatches.length; i++) {
    const m = rangeMatches[i]
    const startNum = parseInt(m[1], 10)
    const endNum = parseInt(m[2], 10)
    if (endNum < startNum || Number.isNaN(startNum) || Number.isNaN(endNum)) continue
    const expected = endNum - startNum + 1
    // 答案文本：从 range 结束到下一个 range 开始（或行尾）
    const ansStart = (m.index ?? 0) + m[0].length
    const ansEnd = i + 1 < rangeMatches.length ? (rangeMatches[i + 1].index ?? 0) : t.length
    const ansText = t.slice(ansStart, ansEnd).trim()
    // 按 section 类型分割答案
    let answers: string[]
    if (section === 3) {
      answers = ansText.match(/正确|错误|对|错|√|×|true|false/gi) || []
    } else if (section === 2) {
      // 2026-09-15 修复(P0-10)：多选按组切分（每题一组 1-8 字母），不扁平成单字母。原实现扁平后
      // `21-25 ABD ACD ABC AB AC` 得到 13 个单字母、`<` 守卫截取前 5 → 多选答案全错（Q21=A、Q22=B…），
      // 且 detectType 把这 5 题重新分类成单选。分组只用于 section===2；section===1（单选）保持扁平取字母，
      // 不顺手统一（否则最常见的连续写法 `1-5 ABCCA` 会被当成一个 5 字母分组 → 数量不等被整行拒绝、单选答案全丢）。
      answers = (ansText.match(/[A-Ha-h]{1,8}/g) || []).map(s => s.toUpperCase())
    } else if (section === 1) {
      answers = (ansText.match(/[A-Ha-h]/g) || []).map(c => c.toUpperCase())
    } else {
      // 未知 section：先试字母，数量够就截取；否则判断词
      const letters = (ansText.match(/[A-Ha-h]/g) || []).map(c => c.toUpperCase())
      answers = letters.length >= expected ? letters : (ansText.match(/正确|错误|对|错|√|×|true|false/gi) || [])
    }
    // 2026-09-15 修复(P0-10)：多选（section===2）数量不等就拒绝（不截断——截断会静默产出错误答案）；
    // 其余 section 保持 `<`（判断/单选每题 1 答案，多于 expected 时截取，维持原行为）。
    if (section === 2 ? answers.length !== expected : answers.length < expected) continue
    for (let k = 0; k < expected; k++) {
      // P1-8：section===0 时由答案 token 自身推导有效 section（判断词→3、≥2 字母→2、1 字母→1），非 0 时原样
      const effSec = deriveSectionFromAnswer(answers[k], section)
      map.set(`${chapter}:${effSec}:${startNum + k}`, answers[k])
    }
    found = true
  }

  // 逐题格式：1. A / 1.(A) / 2. AC / 3. 正确（跳过被 range 覆盖的题号）
  const coveredNums = new Set<number>()
  for (const m of t.matchAll(reRangeGlobal)) {
    const s = parseInt(m[1], 10), e = parseInt(m[2], 10)
    if (!Number.isNaN(s) && !Number.isNaN(e)) for (let n = s; n <= e; n++) coveredNums.add(n)
  }
  for (const m of t.matchAll(new RegExp(RE_ANS_EXTRACT.source, 'g'))) {
    const num = parseInt(m[1], 10)
    if (Number.isNaN(num) || coveredNums.has(num)) continue
    // 2026-09-15 修复(P1-8)：section===0 时由答案 token 自身推导有效 section（判断词→3、≥2 字母→2、1 字母→1），
    // 与 range 分支、回填读键同口径，消除无章节标题文档里单选/判断同写 `ch:0:num` 的覆盖。
    const ansToken = m[2].trim()
    const effSec = deriveSectionFromAnswer(ansToken, section)
    map.set(`${chapter}:${effSec}:${num}`, ansToken)
    found = true
  }
  return found
}

// 归一化答案（对齐 Rust normalize_answer）
export function normalizeAnswer(ans: string): string {
  const trimmed = ans.trim()
  // 判断题归一 true/false
  if (JUDGE_TRUE.has(trimmed) || JUDGE_FALSE.has(trimmed)) return normalizeJudgeAnswer(trimmed)
  // 多选答案 AC / A、C / A,C / ["A","C"] → 紧凑格式
  const letters = (trimmed.match(/[A-Ha-h]/g) || []).map(c => c.toUpperCase())
  if (letters.length > 1) return letters.join('')
  return trimmed
}

// 类型检测（对齐 Rust detect_type）
export function detectType(stem: string, options: string[], answer: string | null): QType {
  if (options.length === 0) {
    // 判断题：答案为 true/false → 一定是判断题（必须在填空检测之前）
    if (answer && (answer === 'true' || answer === 'false')) return 'judge'
    // 填空：题干含 ___ 或 （ ） 或 【 】
    if (RE_BLANK.test(stem)) return 'blank'
    // 判断题：答案为其他判断词
    if (answer && isJudgeAnswer(answer)) return 'judge'
    return 'qa'
  }
  // 选择题：按答案字母数区分单选/多选
  if (answer) {
    const letters = (answer.match(/[A-H]/gi) || []).map(c => c.toUpperCase())
    if (letters.length > 1) return 'multi'
  }
  return 'single'
}

// 构建单题（移植 structure.rs build_question）
function buildQuestion(blocks: string[], sourceIndex: number, chapter: number, section: number): ParsedQuestion | null {
  if (blocks.length === 0) return null
  let stem = ''
  const options: string[] = []
  let answer: string | null = null
  let analysis: string | null = null

  let i = 0
  // 处理题干（可能是多行）
  while (i < blocks.length) {
    const line = blocks[i]
    const optMatch = line.match(RE_OPT)
    if (optMatch) break
    const ansMatch = line.match(RE_ANS)
    if (ansMatch) break
    const anaMatch = line.match(RE_ANA)
    if (anaMatch) break
    // 题干（去掉题号前缀）
    const stripped = line.replace(RE_NUM_STRIP, '$1')
    // 2026-09-15 修复(P2-25)：多行题干拼接按 CJK 判断是否加空格——中文折行不加空格，拉丁/数学折行补一个空格
    // 保词边界（否则 "What is"+"the value?" → "What isthe value?"、"x ="+"1.5" → "x =1.5"；该结果还会喂给
    // AI 解析提示词与分享/导出文本）。判断口径：仅当拼接点两侧都不是汉字时才插空格。
    if (stem) {
      const needSpace = !/[\u4e00-\u9fff]/.test(stem.slice(-1)) && !/[\u4e00-\u9fff]/.test(stripped.slice(0, 1))
      stem = needSpace ? stem + ' ' + stripped : stem + stripped
    } else {
      stem = stripped
    }
    i++
  }

  // 选项
  let inOptions = false
  while (i < blocks.length) {
    const line = blocks[i]
    const optMatch = line.match(RE_OPT)
    if (optMatch) {
      inOptions = true
      options.push(`${optMatch[1]}. ${optMatch[2]}`)
      i++
      continue
    }
    const ansMatch = line.match(RE_ANS)
    if (ansMatch) {
      answer = ansMatch[2]
      i++
      continue
    }
    const anaMatch = line.match(RE_ANA)
    if (anaMatch) {
      analysis = anaMatch[2]
      i++
      continue
    }
    if (inOptions) {
      // 选项续行
      const lastIdx = options.length - 1
      if (lastIdx >= 0) options[lastIdx] += line
    }
    i++
  }

  if (!stem && options.length === 0) return null

  // === 类型识别（对齐 Rust structure.rs detect_type） ===
  // BUG-001 修复：原实现把 RE_BLANK 放第一位，判断题题干结尾的"（ ）"空括号
  // 直接命中 blank → 所有判断题被误判为填空。正确顺序：
  // 1) 无选项时：判断题答案(true/false) → 填空(题干空括号) → 判断题其他判断词 → 问答
  // 2) 有选项时：选择题按答案字母数区分单选/多选，不查题干空括号
  let qType: QType = 'single'
  // 判断题选项（A.正确 B.错误）先识别：选项式判断题不该被 blank 抢占
  if (options.length === 2 && options.every(o => RE_JUDGE_OPT.test(o))) {
    qType = 'judge'
    // 选项式判断题答案：按**选项文本**归一化，不再按字母位置硬编码
    // 2026-09-14 修复(P0-8)：原实现写死 A→true / B→false，不看选项文本。导入
    // 「1. 下列说法是否正确（ ） / A. 错误 / B. 正确 / 答案：A」时会把「错误」持久化成 'true'，
    // 此后 exam.ts 的 judgeAnswerBool 拿到 'true'（本身就在真值词集合里）已无从恢复 →
    // 「错误」被判为正确答案。这里改成先读首选项文本算 trueFirst，与网页端判分
    // exam.ts:54-63 的 judgeAnswerBool 完全同口径（两端 parser.ts 必须逐字节相同）
    const firstOpt = options[0].match(RE_JUDGE_OPT)
    const trueFirst = !!firstOpt && normalizeJudgeAnswer(firstOpt[1]) === 'true'
    if (answer && /^[A-B]$/i.test(answer.trim())) {
      const up = answer.trim().toUpperCase()
      if (up === 'A') answer = trueFirst ? 'true' : 'false'
      else answer = trueFirst ? 'false' : 'true'
    } else if (answer && isJudgeAnswer(answer)) {
      answer = normalizeJudgeAnswer(answer)
    }
  } else if (options.length === 0) {
    // 无选项：判断题答案优先（判断词精确匹配，对齐 Rust is_judge_answer）
    if (answer && isJudgeAnswer(answer)) {
      qType = 'judge'
      answer = normalizeJudgeAnswer(answer)
    }
    // 填空：题干含 ___ 或 （ ） 或 【 】（判断题题干也常带空括号，但判断题答案已在上面拦截）
    else if (RE_BLANK.test(stem)) qType = 'blank'
    // 2026-09-18 修复（重审 A-18）：此处原为 `else if (answer && RE_JUDGE_WORD.test(answer)) qType = 'judge'`
    //   ——子串匹配，且**答案没有被归一化**。后果：答案里只要含「对/错/T/F」就被当判断题，例如
    //   无选项 + 答案「对外开放」⇒ 判为 judge，而 answer 仍是「对外开放」；
    //   判分时 judgeAnswerBool('对外开放', 无选项) 走不进真/假词集 ⇒ 返回 '' ⇒ 期望值恒为「假」
    //   ⇒ **选「错误」恒判对、选「正确」恒判错**（判分口径整个反转）。
    //   而真正的判断词在第 1 个分支（`isJudgeAnswer` 精确匹配）就已经拦下了——本分支只剩误判，
    //   故直接删掉。归一化与精确匹配都在上面完成，行为只会变准。
    else qType = 'qa'
  } else {
    // 选择题：从题干括号提取答案（如"（A）..."，仅当题干非空括号）
    if (!answer) {
      const paren = stem.match(RE_PAREN_ANS)
      if (paren) {
        answer = paren[1].toUpperCase()
        stem = stem.replace(RE_PAREN_ANS, '')
      }
    }
    // 多选判断：答案含 2+ 字母 → multi；否则 single
    if (answer) {
      const letters = answer.match(/[A-H]/gi)
      qType = letters && letters.length > 1 ? 'multi' : 'single'
    }
  }

  // 答案归一化（对齐 Rust normalize_answer）
  if (answer) {
    if (qType === 'judge') answer = normalizeJudgeAnswer(answer)
    else if (qType === 'multi' || qType === 'single') answer = normalizeChoiceAnswer(answer)
  }

  // 小节类型兜底（2026-09-15 修复 P1-6：收窄——仅在判断小节(section===3) 且题干像陈述句(不含 ？/?) 时才强改 judge）。
  // 原实现把 section 1-3 下的 qa 题一律强改成对应类型；当章节头漏识别（如 `四、简答题` 未被 RE_SECTION 命中）
  // 导致 section 停在上一节的 3 时，后续简答题(qa)会被全部误存成 judge。现 section 1/2/4/5 不再兜底，
  // qa 保持原判（confidence 0.7），只有判断题小节里的陈述句才回落为 judge。
  if (qType === 'qa' && section === 3 && !stem.includes('？') && !stem.includes('?')) {
    qType = 'judge'
  }

  // 置信度
  let confidence = 0.9
  if (options.length === 0 && !answer) confidence = 0.6
  else if (qType === 'qa') confidence = 0.7

  return {
    type: qType,
    stem: stem.trim(),
    options,
    answer: answer?.trim() || null,
    analysis: analysis?.trim() || null,
    source_index: sourceIndex,
    confidence,
    chapter,
    section
  }
}

// 从 HTML 直接解析（pipeline.rs html_to_questions 的 JS 版）
export function parseHtml(html: string, bankId: number): any[] {
  const { paragraphs } = htmlToParagraphs(html)
  const parsed = parseQuestions(paragraphs)
  return parsed.map(pq => ({
    bank_id: bankId,
    type: pq.type,
    stem: pq.stem,
    options: pq.options.length > 0 ? JSON.stringify(pq.options) : null,
    answer: pq.answer,
    analysis: pq.analysis,
    source_index: pq.source_index,
    confidence: pq.confidence
  }))
}

// 纯文本导入（TXT/MD）：每行转 <p> 后复用解析
export function parseText(text: string, bankId: number): any[] {
  const html = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .map(l => `<p>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
    .join('\n')
  return parseHtml(html, bankId)
}
