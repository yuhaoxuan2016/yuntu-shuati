#!/usr/bin/env node
// 题目解析器行为守卫（2026-10-13）
//
// 守三组行为：
//   ① 页脚/分值杂行过滤：`第 N 页…` / `…共 N 页` / `（本题 N 分）` 不再被拼进题干或选项；
//   ② htmlToParagraphs 的 HTML 判据：`<pre>`/`<path` 这类「以 `<p` 开头」的其它标签不再被
//      误判成 HTML 路径（整篇被当空文档）；真正的 `<p>` 仍走 HTML 路径；
//   ③ 既有正确行为的钉子（空行、超长题干、无选项题、判断词 range 回填）——本轮改动不得碰坏。
//
// 本测试从 src/lib/parser.ts **切真源码**（esbuild 去 TS → new Function），不手抄逻辑。
// 跑法（cwd=shuati-pwa）：node tests/parser-behavior.test.cjs
'use strict'
const fs = require('fs')
const path = require('path')

let esbuild = null
try { esbuild = require('esbuild') } catch { esbuild = null }
if (!esbuild || typeof esbuild.transformSync !== 'function') {
  console.error('❌ 取不到 esbuild.transformSync——请在 shuati-pwa 下跑（devDependency 已装）')
  process.exit(1)
}

const ROOT = path.join(__dirname, '..')
let failed = 0
const ok = (m) => console.log('   ✓ ' + m)
const bad = (m) => { console.log('   ✗ ' + m); failed++ }
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : bad(`${m}｜实得 ${JSON.stringify(a)} 期望 ${JSON.stringify(b)}`))

// 先剥 `export ` 再 transform（transformSync 输出按模块处理，顶层 return 会报错；与既有守卫同法）
const src = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'parser.ts'), 'utf8').replace(/\r\n/g, '\n')
const code = esbuild.transformSync(src.replace(/\bexport\s+/g, ''), { loader: 'ts' }).code
const mod = new Function(`${code}\nreturn { parseQuestions, htmlToParagraphs }`)()
if (typeof mod.parseQuestions !== 'function' || typeof mod.htmlToParagraphs !== 'function') {
  console.error('❌ 切片锚点漂移：取到的不是函数，需要更新本测试')
  process.exit(1)
}

console.log('== ① 页码/分值行不进选项（也不进题干） ==')
{
  const dirty = mod.parseQuestions([
    '1. 题干一', 'A. 甲', 'B. 乙', '答案：A',
    '第 3 页 共 10 页',
    '2. 题干二', 'A. 丙', 'B. 丁', '答案：B',
  ])
  eq(dirty.length, 2, '两个题号 → 2 道题')
  eq(dirty[0].options, ['A. 甲', 'B. 乙'], '页码行不再拼进 Q1 选项（“第 3 页 共 10 页”被跳过）')
  eq(dirty[1].options, ['A. 丙', 'B. 丁'], 'Q2 选项不受影响')
  eq([dirty[0].answer, dirty[1].answer], ['A', 'B'], '答案回填照常')

  const score = mod.parseQuestions([
    '1. 题干一', 'A. 甲', '（本题 2 分）', 'B. 乙', '答案：A',
    '2. 题干二', 'A. 丙', 'B. 丁', '答案：B',
  ])
  eq(score[0].options, ['A. 甲', 'B. 乙'], '分值行（本题 2 分）不再拼进 Q1 选项')
  eq(score[0].stem, '题干一', '分值行也未混进题干')

  // 反向对照：无杂行时与「修复前应得的结果」一致（行为不变的基线）
  const clean = mod.parseQuestions([
    '1. 题干一', 'A. 甲', 'B. 乙', '答案：A',
    '2. 题干二', 'A. 丙', 'B. 丁', '答案：B',
  ])
  eq(clean.length, 2, '反向对照：无杂行 → 题数 2')
  eq(clean[0].options, ['A. 甲', 'B. 乙'], '反向对照：无杂行 → Q1 选项不变')
  // 反向对照：类似但**不是**页脚的行不得被误滤（保守判据的边界）
  const notFooter = mod.parseQuestions(['1. 第 3 章讲了什么', 'A. 甲', 'B. 乙', '答案：A'])
  eq(notFooter[0].stem, '第 3 章讲了什么', '反向对照：“第 3 章…”不是页脚样式，题干照常保留')

  // 反向对照（2026-10-13 验收修复）：题干里**合法出现**「共 N 页」字样时整行必须保留——
  // 中段分支曾未锚行首，`1. 本规程全书共 500 页` 会被当页脚行吃掉（stem 变空）。
  const keepCorpus = mod.parseQuestions(['1. 本规程全书共 500 页', 'A. 甲', 'B. 乙', '答案：A'])
  eq(keepCorpus[0].stem, '本规程全书共 500 页', '反向对照：题干“本规程全书共 500 页”整行保留（不再按“共 N 页”误滤）')
  eq(keepCorpus[0].options, ['A. 甲', 'B. 乙'], '反向对照：“共 N 页”字样的题干行旁选项解析照常')
  // 同一文本作为题干续行（不走新题号起始行）也必须保留
  const keepCorpusMid = mod.parseQuestions(['1. 题干第一行', '本规程全书共 500 页', 'A. 甲', 'B. 乙', '答案：A'])
  eq(keepCorpusMid[0].stem.includes('本规程全书共 500 页'), true, '反向对照：题干续行“本规程全书共 500 页”同样保留在题干')
}

console.log('== ② htmlToParagraphs 的 HTML 判据（标签边界） ==')
{
  const pre = mod.htmlToParagraphs('<pre>1. 题干 A. 甲</pre>')
  eq(pre.paragraphs, ['1. 题干 A. 甲'], "<pre> 走纯文本路径、段落非空（不再整篇判空）")

  const pathHtml = mod.htmlToParagraphs('<path d="M0 0"/>1. 题干')
  eq(pathHtml.paragraphs, ['1. 题干'], '<path …/> 走纯文本路径、段落非空')

  // 反向对照：真正的 <p>（含属性/自闭合/大写）仍走 HTML 路径
  const p = mod.htmlToParagraphs('<p>一号题干</p><p>二号题干</p>')
  eq(p.paragraphs, ['一号题干', '二号题干'], '反向对照：<p>…</p> 仍走 HTML 路径（两段分别成段）')
  const pAttr = mod.htmlToParagraphs('<p class="x">带属性的段落</p>')
  eq(pAttr.paragraphs, ['带属性的段落'], '反向对照：<p class="x"> 仍认（属性形态）')
  // 反向对照：判据大小写不敏感仍认 <P>（走 HTML 分支）。⚠️ 正文解析对全大写标签的既有行为
  // 与改前逐字一致（不改行为，只钉住「判据仍认」）：全大写标签不进门，结果为空。
  // 若将来正文也支持大写标签，本断言会红，需同步更新——这正是它的用途。
  const pUpper = mod.htmlToParagraphs('<P>大写段落</P>')
  eq(pUpper.paragraphs, [], '反向下界：<P> 仍走 HTML 分支（大小写不敏感）；全大写正文的既有行为不变')
}

console.log('== ③ 既有正确行为钉子（本轮改动不得碰坏） ==')
{
  // 空行夹在题干/选项之间
  const withBlank = mod.parseQuestions(['1. 题干一', '', 'A. 甲', 'B. 乙', '答案：A'])
  const noBlank = mod.parseQuestions(['1. 题干一', 'A. 甲', 'B. 乙', '答案：A'])
  eq(withBlank[0].options, ['A. 甲', 'B. 乙'], '空行夹层：选项照常')
  eq(JSON.stringify(withBlank), JSON.stringify(noBlank), '反向对照：有无空行结果逐字段一致')

  // 超长题干（3000 字）不截断
  const longStem = '长'.repeat(3000)
  const longQ = mod.parseQuestions(['1. ' + longStem, 'A. 甲', 'B. 乙', '答案：A'])
  eq(longQ[0].stem.length, 3000, '超长题干 3000 字完整保留')
  eq(longQ[0].options, ['A. 甲', 'B. 乙'], '超长题干下选项照常')

  // 无选项题 → qa
  const qa = mod.parseQuestions(['1. 请简述操作系统的作用。', '答案：管理系统资源'])
  eq(qa[0].type, 'qa', '无选项 + 普通文本答案 → qa')
  eq(qa[0].answer, '管理系统资源', 'qa 答案带回填')
  // 反向对照：同一文本但答案是判断词 → judge（不许把判断词答案也当 qa）
  const judgeAns = mod.parseQuestions(['1. 该说法是否正确（ ）', '答案：对'])
  eq(judgeAns[0].type, 'judge', '反向对照：判断词答案仍判 judge（不被 qa 规则抢走）')

  // 判断题「1-3 对对错」range 回填
  const rng = mod.parseQuestions([
    '1. 题目一（ ）', '2. 题目二（ ）', '3. 题目三（ ）',
    '答案：1-3 对对错',
  ])
  eq(rng.length, 3, 'range 答案：3 道题')
  eq(rng.map((q) => q.type), ['judge', 'judge', 'judge'], 'range 判断词回填后题型判为 judge')
  eq(rng.map((q) => q.answer), ['true', 'true', 'false'], 'range「对对错」逐题对位回填')
  // 反向对照：换一组词序，禁止按位置硬编码
  const rng2 = mod.parseQuestions([
    '1. 题目一（ ）', '2. 题目二（ ）', '3. 题目三（ ）',
    '答案：1-3 错错对',
  ])
  eq(rng2.map((q) => q.answer), ['false', 'false', 'true'], '反向对照：range「错错对」不是按字面/位置硬编码')
}

console.log(`\n${failed === 0 ? '✅ 全部通过' : '❌ 有失败'}（失败 ${failed}）`)
process.exit(failed ? 1 : 0)
