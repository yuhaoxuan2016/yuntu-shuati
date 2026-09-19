// AI 模块：浏览器端直连 OpenAI 兼容 API（百炼/DeepSeek 等）
// 从 Rust ai.rs 移植核心逻辑

import { idb } from './db'

const PROMPT_TEMPLATE = `你是题目解析专家。请把下面的文本解析成 JSON 数组，每道题包含：
- "index": 题目原始题号（整数，从文本中读取，不要编造。若文本无题号则从 1 开始递增）
- "type": "single"（单选）| "multi"（多选）| "judge"（判断）| "blank"（填空）| "qa"（问答）
- "stem": 题干（不含题号）
- "options": 选项数组（无选项则为空数组）
- "answer": 答案（选择题为字母如"A"或"AC"，判断题为"正确"/"错误"，填空/问答为文本）
- "analysis": 解析（没有则为 null）

要求：
1. 只输出 JSON，不要任何其他文字
2. 保留题目顺序
3. 选项用 "A. 内容" 格式
4. 无法识别的行跳过

文本内容：
`;

export interface AiConfig {
  apiKey: string
  baseUrl: string
  model: string
}

export async function getAiConfig(): Promise<AiConfig> {
  const apiKey = (await idb.getSetting('ai_api_key')) || ''
  const baseUrl = (await idb.getSetting('ai_base_url')) || 'https://api.deepseek.com/v1'
  const model = (await idb.getSetting('ai_model')) || 'deepseek-flash'
  return { apiKey, baseUrl, model }
}

// P1-11：BYOK 密钥以 Bearer 头发往 baseUrl，而 ai_base_url 只是一个普通设置项，
// 会被云同步/备份恢复改写。发送前必须校验，否则等于「密钥发往任意地址」。
// 两道闸：① 必须 https；② host 必须命中已知服务商白名单，否则需要一份「与同步值分开存储」
// 的本机确认记录（ai_base_url_ack，只在设置页由用户显式确认时写入，不进备份、不进云同步），
// 且确认值必须与当前 baseUrl 逐字一致。
// 白名单覆盖本应用自身预置/推荐的入口：DeepSeek、阿里云百炼（dashscope / *.maas.aliyuncs.com）、
// 硅基流动、opencode.ai（Go/Zen）、Moonshot、智谱、OpenAI。只列具体服务域名，
// 不整域放行（例如不用裸 aliyuncs.com）。
const TRUSTED_AI_HOSTS = [
  'api.deepseek.com',
  'dashscope.aliyuncs.com',
  'maas.aliyuncs.com',
  'api.siliconflow.cn',
  'opencode.ai',
  'api.moonshot.cn',
  'open.bigmodel.cn',
  'api.openai.com',
]

export function isTrustedAiHost(baseUrl: string): boolean {
  let host: string
  try { host = new URL(String(baseUrl || '')).hostname.toLowerCase() } catch { return false }
  return TRUSTED_AI_HOSTS.some(d => host === d || host.endsWith('.' + d))
}

// 端点校验：不通过即抛错（错误信息会直接显示给用户），绝不静默降级
export async function assertBaseUrlAllowed(baseUrl: string): Promise<void> {
  const raw = String(baseUrl || '').trim()
  if (!raw) throw new Error('AI Base URL 为空，请到设置页填写')
  let u: URL
  try { u = new URL(raw) } catch { throw new Error(`AI Base URL 不是合法 URL：${raw}`) }
  if (u.protocol !== 'https:') {
    throw new Error(`AI Base URL 必须是 https（当前 ${u.protocol}//${u.host}），已拒绝发送 API Key`)
  }
  if (isTrustedAiHost(raw)) return
  const ack = ((await idb.getSetting('ai_base_url_ack')) || '').trim()
  if (ack && ack === raw) return
  throw new Error(`AI Base URL 不在已知服务商白名单内（${u.host}），已拒绝发送 API Key。若确需使用该端点，请在设置页重新保存该地址并明确确认。`)
}

export async function callChatCompletion(
  apiKey: string,
  baseUrl: string,
  model: string,
  messages: { role: string; content: string }[],
  maxTokens = 4000,
  timeoutMs = 120000
): Promise<string> {
  if (!apiKey) throw new Error('未配置 API Key，请到设置页填写')
  await assertBaseUrlAllowed(baseUrl)
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`
  // 组装请求体
  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature: 0.1,
  }
  // 阿里云百炼（MaaS）推理模型默认开启思考（thinking），思考内容会占用输出预算，
  // 导致 max_tokens 耗尽时 content 为空（finish_reason=length）。我们的任务是严格 JSON 解析，无需思考，主动关闭。
  if (/aliyuncs\.com|\.maas\./i.test(baseUrl)) {
    body.enable_thinking = false
  }
  // 超时控制：防止 AI 请求挂起导致页面无限转圈（AbortController）
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let resp: Response
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (e) {
    throw new Error(`AI 请求超时或网络错误（超过 ${Math.round(timeoutMs / 1000)} 秒）：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    clearTimeout(timer)
  }
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '')
    throw new Error(`AI 请求失败 (${resp.status}): ${errText.slice(0, 300)}`)
  }
  const data = await resp.json()
  const choice = data.choices?.[0]
  const message = choice?.message || {}
  const content = message.content
  if (!content) {
    // —— 详细诊断：帮用户定位「AI 返回为空」的根因 ——
    const bits: string[] = []
    if (choice?.finish_reason) bits.push(`finish_reason=${choice.finish_reason}`)
    if (data.usage) bits.push(`usage=${JSON.stringify(data.usage)}`)
    const msgKeys = Object.keys(message).join(',')
    bits.push(`message字段=[${msgKeys || '空'}]`)
    const hasReasoning = 'reasoning_content' in message || 'reasoning' in message
    if (hasReasoning) bits.push('含思考内容(reasoning)')

    let hint = '请检查模型名是否正确。'
    if (hasReasoning) {
      hint = '当前是推理模型，思考可能占满输出预算导致 content 为空。建议：① 换成非推理模型（如 deepseek-flash / qwen-turbo）；② 或减少单次上传文本量（当前每块约6000字）。'
    } else if (choice?.finish_reason === 'length') {
      hint = '输出达到 max_tokens 上限但未产出内容，请减少文本量或调大 max_tokens。'
    }
    throw new Error(`AI 返回为空（${bits.join('；')}）${hint}`)
  }
  return content
}

// 测试连接（不依赖模型返回具体内容，只验证 API 可用）
export async function testConnection(): Promise<void> {
  const cfg = await getAiConfig()
  if (!cfg.apiKey) throw new Error('未配置 API Key')
  const content = await callChatCompletion(cfg.apiKey, cfg.baseUrl, cfg.model, [
    { role: 'user', content: '你好，请只回复两个字：ok' },
  ], 50)
  if (!content) throw new Error('连接测试失败')
}

// AI 结构化解析（移植 ai.rs ai_structurize 优化版）
// 优化点（对齐原版 Rust 实现）：
// 1. 按题号分块（每块 ≤15 题），而非按字符数 —— 单块输出更小、更快、更不易截断
// 2. 并发 6 路（原版按平台 4-16，浏览器端取安全值 6）
// 3. max_tokens 2048（原版结论：输出 token 与响应时间近似线性，2048 比 4096 省 ~50% 时间）
// 4. 本地答案表回填：先提取文末答案表，AI 漏的答案用本地答案补全
// 5. 每块失败自动重试 1 次（防网络抖动丢题）
export async function aiStructurize(
  text: string,
  bankId: number,
  onProgress?: (done: number, total: number) => void
): Promise<{ questions: any[]; failedChunks: number; totalChunks: number }> {
  const cfg = await getAiConfig()
  if (!cfg.apiKey) throw new Error('未配置 API Key，请到设置页填写')

  // 1. 本地提取全局答案表（文末答案表 / 题号+答案模式）
  // P1-9：同一题号可能有多条答案（分章节文档里各章题号都从 1 开始），按文档顺序排成队列
  const answerQueues = extractAnswerQueues(text)
  if (answerQueues.size > 0) console.log(`[AI] 本地答案表提取到 ${answerQueues.size} 个题号的答案`)
  // P1-9：题号 → 该题号在文档中已出现过的题目次数（回填时据此取队列里的第几条）
  const answerSeen = new Map<number, number>()

  // 2. 按题号边界分块（每块最多 15 题）；无题号时按 8000 字符兜底
  // BUG-002 修复：splitIntoChunks 返回 { text, startNum }，记录每块起始题号
  // 供收集时把 AI 返回的题号映射回 answerMap 的 key（原始题号）
  const chunks = splitIntoChunks(text, 15)
  const allQuestions: any[] = []
  let sourceIndex = 0
  const CONCURRENCY = 6 // 并发数：6 路并行（对齐原版默认并发）
  const MAX_TOKENS = 2048 // 每块输出上限（原版优化值）
  let finished = 0
  if (onProgress) onProgress(0, chunks.length)

  // 并发执行器：最多 CONCURRENCY 个请求同时进行
  const results: any[] = new Array(chunks.length).fill(null)
  let cursor = 0
  let failed = 0

  async function worker() {
    while (true) {
      const ci = cursor++
      if (ci >= chunks.length) break
      // 失败重试 1 次
      let content: string | null = null
      let lastErr: unknown = null
      for (let attempt = 1; attempt <= 2 && content === null; attempt++) {
        try {
          content = await callChatCompletion(cfg.apiKey, cfg.baseUrl, cfg.model, [
            { role: 'system', content: '你是一个严格的 JSON 输出器，只输出合法 JSON 数组。' },
            { role: 'user', content: PROMPT_TEMPLATE + chunks[ci].text },
          ], MAX_TOKENS)
        } catch (e) {
          lastErr = e
          if (attempt === 1) await new Promise(r => setTimeout(r, 1000)) // 重试前等 1 秒
        }
      }
      try {
        if (content === null) throw lastErr ?? new Error('重试后仍失败')
        const parsed = extractJson(content)
        if (Array.isArray(parsed)) {
          results[ci] = parsed.filter(item => item && typeof item === 'object' && item.stem)
        }
      } catch (e) {
        failed++
        console.warn(`AI 分块 ${ci + 1}/${chunks.length} 失败，跳过:`, e instanceof Error ? e.message : String(e))
      } finally {
        finished++
        if (onProgress) onProgress(finished, chunks.length)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, () => worker()))

  // 按块顺序收集（保持题目顺序）
  for (let ci = 0; ci < results.length; ci++) {
    const parsed = results[ci]
    if (!parsed) continue
    const chunkStartNum = chunks[ci].startNum // 本块起始题号（无题号时为 null）
    // 2026-09-18 修复（重审 A-22）：`chunkStartNum + offset` 这个兜底**只有在「本块原文的题号数 == AI 返回的条目数」
    //   时才可信**。`parsed` 上游已经 `filter(item => … && item.stem)` 丢掉过没读出题干的条目，
    //   提示词自己也写着「无法识别的行跳过」⇒ 少一条，其后**所有 offset 全部前移一位**，
    //   把上一题的答案配给本题；而 confidence 是硬编码 0.95，导入预览的置信度筛选也挑不出来。
    //   现在先数一遍本块原文里的题号行：对得上才用偏移兜底；对不上就**不回填**并告警
    //   —— 宁可少一个答案（用户看得见缺失），也不静默写错一个答案。
    const chunkNumCount = estimateQuestionCount(chunks[ci].text)
    const offsetBackfillSafe = chunkStartNum !== null && chunkNumCount > 0 && chunkNumCount === parsed.length
    if (chunkStartNum !== null && chunkNumCount > 0 && chunkNumCount !== parsed.length) {
      console.warn(`[AI] 第 ${ci + 1} 块：原文题号 ${chunkNumCount} 个、AI 返回 ${parsed.length} 条 ⇒ 位置无法逐条对齐，本块不做按题号偏移回填（避免把邻题答案配错）`)
    }
    for (let offset = 0; offset < parsed.length; offset++) {
      const item = parsed[offset]
      const qi = {
        bank_id: bankId,
        type: normalizeType(item.type),
        stem: String(item.stem),
        options: Array.isArray(item.options) && item.options.length > 0 ? JSON.stringify(item.options) : null,
        answer: item.answer ? String(item.answer) : null,
        analysis: item.analysis ? String(item.analysis) : null,
        source_index: sourceIndex++,
        confidence: 0.95,
      }
      // 3. 本地答案回填（BUG-002 修复）：按原始题号查答案
      // P1-9：分章节文档里各章题号都从 1 开始，裸题号做全局键会互相覆盖（第三章 1..N 盖掉第一章）。
      // 改为「文档顺序对齐」：同号题目按出现次序取该题号的第 k 条答案，从而按章节隔离。
      // 原始题号 = AI 返回的 index 字段优先；否则用 块起始题号 + 块内偏移
      let originalNum: number | null = null
      const aiIndex = item.index !== undefined ? parseInt(item.index, 10) : NaN
      if (!Number.isNaN(aiIndex)) originalNum = aiIndex
      else if (offsetBackfillSafe) originalNum = chunkStartNum + offset
      if (originalNum !== null) {
        if (!qi.answer) {
          const queue = answerQueues.get(originalNum)
          if (queue && queue.length > 0) {
            const nth = answerSeen.get(originalNum) ?? 0
            // 第 k 次出现取第 k 条；队列不够长时回退最后一条（与修复前「后写覆盖」同结果，不劣化）
            qi.answer = queue[Math.min(nth, queue.length - 1)]
          }
        }
        // 计数无条件推进：AI 已给答案的题也要占掉队列里对应的位置
        answerSeen.set(originalNum, (answerSeen.get(originalNum) ?? 0) + 1)
      }
      // 归一化答案（对齐前端消费格式）：
      // 判断题 → true/false；选择题 → 紧凑字母串（AC）
      qi.answer = normalizeAiAnswer(qi.type, qi.answer)
      // 类型校正：答案归一到 true/false 但 AI 判成 blank/qa → 强制 judge
      // （对齐原版 Rust post_process_questions：判断题 answer=true/false 应为 judge）
      if (qi.answer === 'true' || qi.answer === 'false') qi.type = 'judge'
      allQuestions.push(qi)
    }
  }

  if (chunks.length > 1 && failed > 0) {
    console.warn(`AI 解析完成，${failed}/${chunks.length} 块失败被跳过`)
  }
  // 2026-09-18 修复（重审 A-21）：把「失败块数」**报给调用方**，不再只写进 console。
  //   原实现只 return 题目数组 ⇒ 一次「成功」的 AI 导入可以静静少掉任意多个整块的题目，
  //   导入页看到的只是「题数偏少」，无从判断是 AI 输出截断还是分块失败。
  return { questions: allQuestions, failedChunks: failed, totalChunks: chunks.length }
}

// 2026-09-18 新增（重审 A-23）：文档侧题数预估——数「行首题号」的行（`1.` / `2、` / `（3）` …）。
//   它**独立于 AI**，所以能当参照物；`importWithAi` 原先直接把 `count` 当 `expected` 返回，
//   于是导入页那条「识别题数明显少于预期就告警」的安全网**永远不可能触发**（自己和自己比）。
//   说明：文档没有题号时返回 0，调用方按「无法预估」处理（不告警），不做猜测。
export function estimateQuestionCount(text: string): number {
  const lines = String(text || '').split(/\r?\n/)
  let n = 0
  for (const l of lines) if (/^\s*[（(]?\d{1,4}\s*[.、．)）]/.test(l)) n++
  return n
}

// 单题 AI 解析（练习页的"AI 解析"按钮）
// 移植桌面版 import/ai.rs analyze_question：结构化 JSON prompt，前端 QuestionCard 按字段渲染
// 修复 2026-08-16：此前 prompt 无 JSON 要求，AI 返回散文 → 前端 JSON.parse 失败显示"格式异常"
const ANALYZE_SYSTEM = `你是一位经验丰富的题目解析老师。请对给出的题目进行**详细解析**，**只输出一个 JSON 对象**，格式如下：

{
  "knowledge_point": "考查的知识点（说明属于哪个学科领域、什么主题，2-3 句话，必要时引用相关概念或原理）",
  "background": "相关背景知识（解释题目涉及的概念、原理、历史背景或现实意义，帮助用户理解为什么这么考，3-5 句话）",
  "option_analysis": [
    {"letter": "A", "verdict": "正确"或"错误", "reason": "该选项为什么对/错，结合相关知识点详细说明，2-3 句话"},
    {"letter": "B", "verdict": "...", "reason": "..."},
    {"letter": "C", "verdict": "...", "reason": "..."},
    {"letter": "D", "verdict": "...", "reason": "..."}
  ],
  "reference_explanation": "为什么参考答案是正确的（结合背景知识和题干关键信息，引用相关原理/概念，详细说明判断依据，3-5 句话）",
  "common_mistakes": "常见错误（考生在此题上容易选错的选项及原因，1-2 句话）",
  "solving_skill": "此类题目的通用解题技巧（包含识别题型的方法、解题步骤、记忆口诀或易混点对比，3-5 句话，要实用好记）"
}

要求：
1. 严格 JSON，不要任何解释文字、不要 markdown 代码块标记
2. 选项解析只针对选择题（single/multi），其他题型 option_analysis 留空数组 []
3. **内容要详细充实**：每个字段都要有实质内容，不要一两句话草草了事
4. 举例说明、数据支撑、对比分析都可以用上
5. 用中文回答`

export async function analyzeQuestion(q: { stem: string; options: string | null; answer: string | null; type?: string | null }): Promise<string> {
  const cfg = await getAiConfig()
  if (!cfg.apiKey) throw new Error('未配置 API Key')
  // 组装用户消息（对齐桌面版）：题型/题干/选项/参考答案
  const typeLabel = ({ single: '单选题', multi: '多选题', judge: '判断题', blank: '填空题', qa: '问答题' } as Record<string, string>)[String(q.type || '')] || ''
  let user = `题型：${typeLabel}\n题干：${q.stem}\n`
  if (q.options) {
    try {
      const opts = JSON.parse(q.options) as string[]
      if (opts.length) {
        user += '选项：\n' + opts.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n') + '\n'
      }
    } catch { /* ignore */ }
  }
  user += `参考答案：${q.answer || '（无）'}\n请按要求输出详细 JSON 解析。`
  return callChatCompletion(cfg.apiKey, cfg.baseUrl, cfg.model, [
    { role: 'system', content: ANALYZE_SYSTEM },
    { role: 'user', content: user },
  ], 3000)
}

// === 工具函数 ===

// 按题号边界分块：每块不超过 maxQuestions 个题目（对齐原版 ai.rs split_into_chunks）
// BUG-002 修复：返回 { text, startNum }，startNum = 块内第一道题的原始题号（无题号时为 null）
// 题号行：行首数字后跟 . 、 ． ) ） 或 (1) （1） 格式
const RE_QUESTION_NUM = /^\s*[\(（]?\d+[\.、．)）]\s*/
// 无题号时按字符数分块（对齐原版 Rust split_by_chars：按字符硬切，防止超长单行整块超限）
function splitByChars(text: string, maxChars: number): { text: string; startNum: number | null }[] {
  const chunks: { text: string; startNum: number | null }[] = []
  const lines = text.split('\n')
  let current = ''
  for (const line of lines) {
    if (line.length > maxChars) {
      // 单行超长：先 flush 当前，再把超长行按字符硬切（对齐原版，防止单行超 8000 整块塞入）
      if (current.trim()) { chunks.push({ text: current, startNum: null }); current = '' }
      for (let i = 0; i < line.length; i += maxChars) {
        chunks.push({ text: line.slice(i, i + maxChars), startNum: null })
      }
      continue
    }
    if (current.length + line.length > maxChars && current.length > 0) {
      chunks.push({ text: current, startNum: null })
      current = ''
    }
    current += line + '\n'
  }
  if (current.trim()) chunks.push({ text: current, startNum: null })
  return chunks
}

function splitIntoChunks(text: string, maxQuestions: number): { text: string; startNum: number | null }[] {
  const lines = text.split('\n')
  // 找所有题号行的行索引 + 题号值
  const boundaries: { lineIdx: number; num: number }[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(RE_QUESTION_NUM)
    if (m) boundaries.push({ lineIdx: i, num: parseInt(m[0].replace(/[\(（\.、．)）\s]/g, ''), 10) })
  }
  if (boundaries.length === 0) {
    // 无题号，按字符数分块（每块 8000 字符）
    return splitByChars(text, 8000)
  }
  const chunks: { text: string; startNum: number | null }[] = []
  let start = 0
  while (start < boundaries.length) {
    const end = Math.min(start + maxQuestions, boundaries.length)
    const lineStart = boundaries[start].lineIdx
    const lineEnd = end < boundaries.length ? boundaries[end].lineIdx : lines.length
    const chunk = lines.slice(lineStart, lineEnd).join('\n')
    if (chunk.trim()) chunks.push({ text: chunk, startNum: boundaries[start].num })
    start = end
  }
  return chunks
}

// 提取本地答案表：支持 "题号. 答案" 逐题格式（1.A / 1. A / 1.(A) / 1. AC）
// 以及 range 格式（1-5 ABCCA / 1—5 对对对对对）
// 移植自原版 structure.rs extract_answers_from_text + re_ans_extract + re_range
const RE_ANS_ITEM = /(\d+)[\.、．)]\s*\(?([A-Ha-h](?:[、,，]*[A-Ha-h]){0,7}|正确|错误|对|错|√|×|true|false)\)?/g
const RE_RANGE = /(\d+)\s*[-—–~～]+\s*(\d+)\s*[.、．:：]?/g
//
// P1-9：返回值由 Map<题号, 答案> 改为 Map<题号, 答案队列>，队列按条目在文档中的出现顺序排列。
// 取舍：修法选「按题号在文档中的出现次序对齐」而不是把键改成 chapter:section:num 复合键。
//   - 复合键要求 AI 路径自己追踪章节/小节（parser.ts 用的是章节标题扫描 + section 推导），
//     那等于把 parser.ts 的键逻辑复制成第三份，与 GC3「parser 只 import 不编辑」和简报
//     「不要复制 parser 键逻辑」的意图相悖；且 ai.ts 只有网页端有，两端口径反而会分叉。
//   - 文档顺序对齐同样能让分章节文档（各章题号都从 1 开始、答案表随章节依次出现）不串扰：
//     第 k 次出现的同号题目取该题号的第 k 条答案。
//   - 已知不覆盖：全卷只有一张答案表却把同一题号写了两次（本身就是歧义数据），
//     以及 AI 自报 index 与原文题号不一致的情况 —— 这两类在修复前同样错，本改动不劣化。
function extractAnswerQueues(text: string): Map<number, string[]> {
  // 两种格式的条目按文档位置收集，最后统一排序（range 与逐题可以交错出现）
  const entries: { num: number; answer: string; at: number }[] = []
  // range 格式已覆盖的题号集合：逐题格式对这些题号保持「跳过」优先级（与修复前 covered 集合同义）
  const rangeNums = new Set<number>()
  // range 格式：1-5 ABCCA（答案串跟在 range 匹配之后，直到下一个 range 或行尾）
  const rangeMatches = Array.from(text.matchAll(RE_RANGE))
  for (let i = 0; i < rangeMatches.length; i++) {
    const m = rangeMatches[i]
    const startNum = parseInt(m[1], 10)
    const endNum = parseInt(m[2], 10)
    if (endNum < startNum || Number.isNaN(startNum) || Number.isNaN(endNum)) continue
    const expected = endNum - startNum + 1
    const ansStart = (m.index ?? 0) + m[0].length
    const ansEnd = i + 1 < rangeMatches.length ? (rangeMatches[i + 1].index ?? 0) : text.length
    let ansText = text.slice(ansStart, ansEnd)
    // 答案串取到行尾
    const newlineIdx = ansText.indexOf('\n')
    if (newlineIdx >= 0) ansText = ansText.slice(0, newlineIdx)
    ansText = ansText.trim()
    // 过滤答案串里的非答案字符（只保留字母/对错符号）
    const letters = ansText.match(/[A-Ha-h]/g)
    const judgeWords = ansText.match(/正确|错误|对|错|√|×|true|false/g)
    let answers: string[]
    if (judgeWords && judgeWords.length >= expected) {
      answers = judgeWords
    } else if (letters && letters.length >= expected) {
      answers = letters.map(l => l.toUpperCase())
    } else {
      continue // 答案串太短，跳过
    }
    for (let k = 0; k < expected; k++) {
      entries.push({ num: startNum + k, answer: answers[k], at: m.index ?? 0 })
      rangeNums.add(startNum + k)
    }
  }
  // 逐题格式：1. A 2. B（全局匹配，跳过已被 range 覆盖的题号）
  for (const m of text.matchAll(RE_ANS_ITEM)) {
    const idx = parseInt(m[1], 10)
    if (rangeNums.has(idx)) continue
    let ans = m[2].trim().toUpperCase()
    // 判断题答案归一化
    if (/(正确|对|√|true)/i.test(ans)) ans = '正确'
    else if (/(错误|错|×|false)/i.test(ans)) ans = '错误'
    entries.push({ num: idx, answer: ans, at: m.index ?? 0 })
  }
  // 按文档位置排序 → 每个题号得到一条「按出现顺序」的答案队列
  entries.sort((a, b) => a.at - b.at)
  const queues = new Map<number, string[]>()
  for (const e of entries) {
    const q = queues.get(e.num)
    if (q) q.push(e.answer)
    else queues.set(e.num, [e.answer])
  }
  return queues
}

function extractJson(s: string): any {
  // 去掉代码块包裹
  let t = s.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1].trim()
  // 找第一个 [ 到最后一个 ]
  const start = t.indexOf('[')
  const end = t.lastIndexOf(']')
  if (start >= 0 && end > start) {
    t = t.slice(start, end + 1)
  }
  try {
    return JSON.parse(t)
  } catch {
    // 尝试修复：截断到最后一个完整对象
    const objEnd = t.lastIndexOf('}')
    if (objEnd > start) {
      try {
        return JSON.parse(t.slice(start, objEnd + 1) + ']')
      } catch { /* ignore */ }
    }
    throw new Error('AI 返回的 JSON 无法解析')
  }
}

function normalizeType(t: string): string {
  const v = String(t || '').trim().toLowerCase()
  if (v.includes('multi') || v.includes('多选')) return 'multi'
  if (v.includes('judge') || v.includes('判断')) return 'judge'
  if (v.includes('blank') || v.includes('填空')) return 'blank'
  if (v.includes('qa') || v.includes('问答') || v.includes('简答')) return 'qa'
  return 'single'
}

// 归一化 AI 答案（对齐前端消费格式）
// 判断题 → true/false；选择题 → 紧凑字母串（AC，兼容旧 JSON 数组数据）
function normalizeAiAnswer(type: string, answer: string | null): string | null {
  if (!answer) return null
  const v = String(answer).trim()
  if (!v) return null
  // 判断词答案（无论 AI 判的什么题型，答案若是判断词就归一化）：
  // 处理 AI 把判断题判成 blank/qa 但答案给"正确/错误"的情况
  const judgeTrue = /^(正确|对|√|true)$/i.test(v) || v === '√'
  const judgeFalse = /^(错误|错|×|false)$/i.test(v) || v === '×'
  if (judgeTrue) return 'true'
  if (judgeFalse) return 'false'
  if (type === 'single' || type === 'multi') {
    // 选择题：JSON 数组（["A","C"]）或紧凑（AC）或分隔符（A、C）→ 统一紧凑
    let letters: string[] = []
    try {
      const arr = JSON.parse(v)
      if (Array.isArray(arr)) letters = arr.map((s: unknown) => String(s).trim()).filter(s => /^[A-H]$/i.test(s)).map(s => s.toUpperCase())
    } catch { /* not JSON */ }
    if (letters.length === 0) {
      letters = (v.match(/[A-Ha-h]/g) || []).map(c => c.toUpperCase())
    }
    if (letters.length > 0) return letters.join('')
  }
  return v
}
