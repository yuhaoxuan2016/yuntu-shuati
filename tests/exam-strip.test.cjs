#!/usr/bin/env node
// 考试数据下发「答案剥离」守卫（2026-10-13）
//
// 病：考生拿到的考卷/快照里除了 answer/analysis，还漏着两个**同样等于答案**的字段——
//   · answer_derived（计算题推算答案；真实题库 39 条非空，值即等于答案本身）
//   · answer_conflict_note（口径备注，样本含「本题取D」「本题取85%」＝直接泄漏答案值）
// 两处剥离实现各守一端：云函数 functions/examGate/index.js 的 stripForTaker（取卷），
// 网页端 src/lib/exam.ts 的 stripAnswersForTaker（本地快照）。
//
// 本测试**切片真源码直跑**，不手抄逻辑（手抄副本会随源码漂移，守护力归零）：
//   · examGate 是纯 JS —— 锚点行截到顶格 `}` 即可；
//   · exam.ts 是 TS —— 先 esbuild 去类型再包 new Function（与仓库既有守卫同法）。
// 每组都带反向对照：干净对象过境不得被误删字段。
// 沿用既有验收口径：JSON.stringify 后 grep 不含 answer_derived / answer_conflict_note。
//
// 跑法（cwd=shuati-pwa）：node tests/exam-strip.test.cjs
'use strict'
const fs = require('fs')
const path = require('path')

let esbuild = null
try { esbuild = require('esbuild') } catch { esbuild = null }

const ROOT = path.join(__dirname, '..')
let failed = 0
const ok = (m) => console.log('   ✓ ' + m)
const bad = (m) => { console.log('   ✗ ' + m); failed++ }
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : bad(`${m}｜实得 ${JSON.stringify(a)} 期望 ${JSON.stringify(b)}`))

// —— 从源码切函数：锚点行 → 顶格 `}` 行 ——
function extractFn(src, anchor) {
  const lines = src.split('\n')
  const start = lines.findIndex((l) => l.startsWith(anchor))
  if (start < 0) throw new Error('找不到函数锚点：' + anchor)
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === '}') return lines.slice(start, i + 1).join('\n')
  }
  throw new Error('函数未闭合：' + anchor)
}

// —— 云函数侧：stripForTaker（纯 JS，切片即可） ——
const gateSrc = fs.readFileSync(path.join(ROOT, 'functions', 'examGate', 'index.js'), 'utf8').replace(/\r\n/g, '\n')
const gateStrip = new Function(extractFn(gateSrc, 'function stripForTaker(') + '\nreturn stripForTaker')()

// —— 网页端：stripAnswersForTaker（TS，esbuild 去类型） ——
if (!esbuild || typeof esbuild.transformSync !== 'function') {
  console.error('❌ 取不到 esbuild.transformSync（网页端剥离实现需要去 TS）——请在 shuati-pwa 下跑（devDependency 已装）')
  process.exit(1)
}
const examSrc = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'exam.ts'), 'utf8').replace(/\r\n/g, '\n')
const takerSrc = extractFn(examSrc, 'function stripAnswersForTaker(')
const webStrip = new Function(esbuild.transformSync(takerSrc, { loader: 'ts' }).code + '\nreturn stripAnswersForTaker')()

// 脏题：四个「答案类」字段齐全 + 展示字段
const dirtyQuestion = () => ({
  id: 7, bank_id: 1, stem: '一个干净的题干', type: 'single',
  options: '["甲","乙"]', answer: 'A', analysis: '解析文本',
  answer_derived: '42', answer_conflict: 'value', answer_conflict_note: '本题取D',
  difficulty: 'easy',
})
const BANNED4 = ['answer', 'analysis', 'answer_derived', 'answer_conflict_note']

console.log('== ① examGate.stripForTaker：四字段剥离 + 展示字段保留 ==')
{
  const q = dirtyQuestion()
  const out = gateStrip(q)
  const leaked = BANNED4.filter((k) => k in out)
  leaked.length === 0 ? ok('四个答案类字段都不在输出（answer/analysis/answer_derived/answer_conflict_note）')
    : bad('仍有字段泄漏：' + leaked.join(','))
  out.stem === q.stem && out.options === q.options && out.difficulty === q.difficulty && out.id === q.id
    ? ok('stem/options/difficulty/id 原样保留') : bad('展示字段被误动')
  out.answer_conflict === 'value' ? ok('answer_conflict（比对标记，不含答案值）保留下发') : bad('answer_conflict 不应被剥离')
  const s = JSON.stringify(out)
  !s.includes('answer_derived') && !s.includes('answer_conflict_note') ? ok('JSON.stringify 后 grep 不含 answer_derived / answer_conflict_note')
    : bad('stringify 里仍出现禁止字段名')

  // 反向对照：干净对象过境不被误删任何字段
  const clean = { id: 8, stem: '干净题干', options: null, answer_conflict: '', difficulty: '' }
  eq(gateStrip(clean), clean, '反向对照：干净对象过境逐字段不变')
}

console.log('== ② stripAnswersForTaker：四字段剥离 + 返回新对象（防原地改写污染判分整卷） ==')
{
  const q = dirtyQuestion()
  const exam = { _id: 'e1', title: 't', questions: [q] }
  const out = webStrip(exam)
  const leaked = BANNED4.filter((k) => k in out[0])
  leaked.length === 0 ? ok('四个答案类字段都不在输出') : bad('仍有字段泄漏：' + leaked.join(','))
  out[0].stem === q.stem && out[0].options === q.options && out[0].difficulty === q.difficulty
    ? ok('stem/options/difficulty 原样保留') : bad('展示字段被误动')
  out[0].answer_conflict === 'value' ? ok('answer_conflict 保留（只剥答案值类字段）') : bad('answer_conflict 不应被剥离')

  // 返回新对象：数组/题目对象都不是原引用，且原对象未被改动（判分整卷靠这份）
  out !== exam.questions && out[0] !== q ? ok('返回新的数组与新的题目对象') : bad('返回了原引用（存在原地风险）')
  q.answer === 'A' && q.analysis === '解析文本' && q.answer_derived === '42' && q.answer_conflict_note === '本题取D'
    ? ok('原题对象未被改动（四个字段都还在，判分可用）') : bad('原对象被原地改写（污染判分整卷）')

  const s = JSON.stringify(out)
  !s.includes('answer_derived') && !s.includes('answer_conflict_note') ? ok('JSON.stringify 后 grep 不含 answer_derived / answer_conflict_note')
    : bad('stringify 里仍出现禁止字段名')

  // 反向对照：干净对象过境不被误删字段
  const clean = { id: 9, stem: '干净题干', options: null, answer_conflict: '', difficulty: '' }
  const out2 = webStrip({ _id: 'e2', title: 't', questions: [clean] })
  eq(out2[0], clean, '反向对照：干净对象过境逐字段不变')

  // 空卷不炸
  eq(webStrip({ _id: 'e3', title: 't', questions: [] }), [], '空卷 → 空数组')
  eq(webStrip({ _id: 'e4', title: 't', questions: null }), [], 'questions 为 null → 空数组（防御）')
}

console.log('== ③ 类型与实现去重的静态钉（防切片过了、源码又漂回） ==')
{
  const omitOk = /Omit<ExamQuestion, 'answer' \| 'analysis' \| 'answer_derived' \| 'answer_conflict_note'>/.test(examSrc)
  omitOk ? ok("TakerExamQuestion 的 Omit 含四个字段") : bad('TakerExamQuestion 的 Omit 缺字段（类型与实现分叉）')
  const implCount = (examSrc.match(/function stripAnswersForTaker\(/g) || []).length
  implCount === 1 ? ok('exam.ts 里剥离实现只有一处（无第二份手写副本）') : bad(`exam.ts 里 stripAnswersForTaker 出现 ${implCount} 处`)
  ;['answer_derived', 'answer_conflict_note'].every((k) => gateSrc.includes('delete out.' + k))
    ? ok('examGate 的 delete 清单含两个新字段') : bad('examGate 剥离线缺 delete')
}

console.log(`\n${failed === 0 ? '✅ 全部通过' : '❌ 有失败'}（失败 ${failed}）`)
process.exit(failed ? 1 : 0)
