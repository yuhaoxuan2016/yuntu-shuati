// 单题计时「切题/跳题」行为探针（2026-10-05）
// 回答三个问题：① 切到别的题，原题的计时会停吗？② 切回原题，计时恢复吗？③ 跳着做题呢？
//
// 机制（读码得出，本探针负责证伪/证实）：
//   PracticeView 里 `<QuestionCard :key="currentQuestion.id + '-' + reloadKey">` ⇒ 换题 = key 变 =
//   组件**销毁重建**。saved-state 由父组件 answerStates Map 回传，QuestionCard 用
//   `baseSecs = saved?.elapsedSecs ?? 0` 恢复读秒，然后**继续累加**（不是墙钟差）。
//   ⇒ 预期：切走的题计时冻结在切走那一刻；切回来从那个数接着走。
//
// 用法: node tests/question-timer-nav.mjs [--url http://127.0.0.1:4173/] [--headless]
// 退出码: 0 = 通过；1 = 断言失败；2 = 环境问题
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const argOf = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const URL_ = argOf('--url', 'http://127.0.0.1:4173/')
const PORT = Number(argOf('--port', '9349'))
const HEADLESS = args.includes('--headless')

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
].find(p => fs.existsSync(p))
if (!EDGE) { console.error('找不到 Edge'); process.exit(2) }

const PROFILE = path.join(os.tmpdir(), 'q-timer-nav-' + Date.now())

// 4 道题：足够做「下一题 → 上一题 → 跳题」三种动作
const FIXTURE = [
  '1、【单选题】第一题：SF6 配电装置室通风风口应设置在室内（ ）。',
  'A、上部',
  'B、中部',
  'C、底部',
  'D、顶部',
  '答案：C',
  '',
  '2、【单选题】第二题：工作票应记录在生产精益化平台的（ ）中。',
  'A、其他站内记录登记',
  'B、站内例行工作登记',
  'C、维护检修管理',
  '答案：A',
  '',
  '3、【单选题】第三题：电气设备着火时应使用（ ）灭火。',
  'A、水',
  'B、泡沫灭火器',
  'C、干粉灭火器',
  'D、二氧化碳灭火器',
  '答案：D',
  '',
  '4、【单选题】第四题：接地线应用多股软铜线，其截面不得小于（ ）mm²。',
  'A、16',
  'B、25',
  'C、35',
  'D、50',
  '答案：B',
].join('\n')

async function PAGE_FLOW (fixtureText) {
  const log = []
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  async function until (fn, name, timeout = 30000) {
    const t0 = Date.now()
    for (;;) {
      try { const v = fn(); if (v) return v } catch (e) {}
      if (Date.now() - t0 > timeout) throw new Error('等待超时: ' + name)
      await sleep(250)
    }
  }
  try {
    await until(() => document.querySelector('.new-bank-btn, .empty-action'), '首页')
    ;(document.querySelector('.new-bank-btn') || document.querySelector('.empty-action')).click()
    const inp = await until(() => document.querySelector('input[placeholder*="题库名称"]'), '名称输入框')
    const setV = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setV.call(inp, '切题计时验收')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    await sleep(150)
    const okBtn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '确定')
    okBtn.click()
    await until(() => location.hash.startsWith('#/import/'), '跳转导入页')
    const file = new File([fixtureText], 'demo.md', { type: 'text/markdown' })
    const dt = new DataTransfer()
    dt.items.add(file)
    const target = await until(() => document.querySelector('.import'), '导入页容器')
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
    const confirmBtn = await until(
      () => [...document.querySelectorAll('button')].find(b => b.textContent.includes('确认导入')),
      '确认导入按钮', 45000)
    confirmBtn.click()
    await until(() => document.body.innerText.includes('导入成功'), '导入完成', 45000)
    const go = [...document.querySelectorAll('button')].find(b => b.textContent.includes('开始刷题'))
    go.click()
    await until(() => location.hash.startsWith('#/practice/'), '进练习页')
    await until(() => document.querySelectorAll('.qcard .options .option').length >= 2, '题目卡')

    // 读计时器（.qcard .timer，MM:SS）
    window.__readSecs = () => {
      const el = document.querySelector('.qcard .timer')
      if (!el) return null
      const m = el.textContent.trim().match(/^(\d+):(\d+)$/)
      return m ? Number(m[1]) * 60 + Number(m[2]) : null
    }
    // 当前题号（.qcard .idx 形如 "1."）
    window.__curIdx = () => {
      const el = document.querySelector('.qcard .idx')
      if (!el) return null
      const m = el.textContent.trim().match(/^(\d+)/)
      return m ? Number(m[1]) : null
    }
    // 答题流程：点选项 → 点「确认答案」→ 出现「下一题 →」
    // ⚠️ 「下一题」按钮只在 submitted 后才渲染（QuestionCard.vue L77/78 的 v-if），
    //    所以「切下一题」的真实用户路径是：先答题 → 再点下一题。
    window.__answerAndNext = () => {
      const opt = document.querySelector('.qcard .options .option')
      if (!opt) return 'no-option'
      opt.click()
      const confirm = [...document.querySelectorAll('.qcard button')].find(x => /确认答案/.test(x.textContent))
      if (!confirm) return 'no-confirm'
      confirm.click()
      return 'answered'
    }
    window.__clickNext = () => {
      const b = [...document.querySelectorAll('.qcard button')].find(x => /下一题/.test(x.textContent))
      if (!b) return false
      b.click(); return true
    }
    window.__clickPrev = () => {
      const b = [...document.querySelectorAll('.qcard button')].find(x => /上一题/.test(x.textContent))
      if (!b) return false
      b.click(); return true
    }
    // 点第 n 个导航点（.nav-dot，真选择器）
    window.__clickDot = (n) => {
      const dots = [...document.querySelectorAll('.nav-dot')]
      const d = dots[n - 1]
      if (!d) return 'no-dot:' + dots.length
      d.click(); return 'ok:' + dots.length
    }

    await until(() => window.__readSecs() !== null, '计时器挂载')
    const qpos = window.__curIdx()
    log.push('进练习页，计时器=' + window.__readSecs() + '，题号=' + qpos)
    return { ok: true, log, qpos, dotCount: document.querySelectorAll('.nav-dot').length }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), log, tail: document.body ? document.body.innerText.slice(0, 400) : '' }
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function main () {
  const launchArgs = [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--remote-allow-origins=*', '--window-size=520,1200',
    '--no-proxy-server', '--proxy-bypass-list=*',
    'about:blank',
  ]
  if (HEADLESS) launchArgs.unshift('--headless=new')
  const child = spawn(EDGE, launchArgs, { stdio: 'ignore' })

  let page = null
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await r.json()
      page = list.find(t => t.type === 'page')
      if (page) break
    } catch (e) {}
    await sleep(400)
  }
  if (!page) { cleanup(); throw new Error('CDP 端口没就绪') }

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws 连不上')) })
  let seq = 0
  const pend = new Map()
  let loadResolve = null
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pend.has(msg.id)) { pend.get(msg.id)(msg); pend.delete(msg.id); return }
    if (msg.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {})
    if (msg.method === 'Page.loadEventFired' && loadResolve) { loadResolve(); loadResolve = null }
  }
  function send (method, params = {}) {
    return new Promise((res, rej) => {
      const id = ++seq
      pend.set(id, (m) => m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result))
      ws.send(JSON.stringify({ id, method, params }))
    })
  }
  function evalIn (expr, awaitPromise = false) {
    return send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true })
      .then(r => r.result && r.result.value)
  }
  function cleanup () {
    try { ws.close() } catch (e) {}
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch (e) {}
    try { fs.rmSync(PROFILE, { recursive: true, force: true }) } catch (e) {}
  }

  await send('Page.enable')
  await send('Runtime.enable')
  const loaded = new Promise(res => { loadResolve = res })
  await send('Page.navigate', { url: URL_ })
  await Promise.race([loaded, sleep(15000)])
  await sleep(1200)

  const setup = await evalIn(`(${PAGE_FLOW.toString()})(${JSON.stringify(FIXTURE)})`, true)
  console.log('== 单题计时·切题/跳题 行为验收 ==')
  console.log('准备阶段:', JSON.stringify(setup))
  if (!setup || !setup.ok) { cleanup(); process.exit(2) }

  const failures = []
  const rd = () => evalIn('window.__readSecs()')
  const idx = () => evalIn('window.__curIdx()')

  // ===== 场景 A：第 1 题走 3 秒 → 用导航点切到第 3 题 → 停 4 秒 → 切回第 1 题 =====
  // 为什么用导航点而不是「下一题」按钮：后者只在答题后才渲染，一答题计时就停了，
  // 验不出「切走时冻结」。导航点切题是**唯一不答题就能换题**的真实路径（也是"跳着做题"本身）。
  console.log('\n--- 场景 A：切走再切回（不答题，用导航点）---')
  const a0 = await rd()
  await sleep(3000)
  const a1 = await rd()
  console.log(`第1题走 3 秒：${a0} → ${a1}（增量 ${a1 - a0}，期望 ≥2）`)
  if (a1 - a0 < 2) failures.push(`A: 前台计时器没走（${a0}→${a1}）`)

  await evalIn('window.__clickDot(3)')
  await sleep(900)
  const idxB = await idx()
  const bStart = await rd()
  console.log(`切到第3题：题号=${idxB}（期望 3），计时器=${bStart}（新题应从 0 起）`)
  if (idxB !== 3) failures.push(`A: 没切到第3题（题号=${idxB}）——切题动作失败，后续断言无意义`)

  await sleep(4000)
  const bEnd = await rd()
  console.log(`在第3题停留 4 秒：${bStart} → ${bEnd}（增量 ${bEnd - bStart}，新题应自己在走）`)

  await evalIn('window.__clickDot(1)')
  await sleep(900)
  const idxC = await idx()
  const back0 = await rd()
  console.log(`切回第1题：题号=${idxC}（期望 1），计时器=${back0}`)
  if (idxC !== 1) failures.push(`A: 没切回第1题（题号=${idxC}）`)
  const frozenDelta = back0 - a1
  console.log(`  第1题读数相对切走时（${a1}）的变化：${frozenDelta}（期望 0~1，切走期间不该继续涨）`)
  if (frozenDelta > 2) failures.push(`A: 切走的题在别处继续计时（${a1}→${back0}，增量 ${frozenDelta}）`)

  // ===== 场景 B：切回后第 1 题必须能继续走 =====
  await sleep(3000)
  const back1 = await rd()
  const resumeDelta = back1 - back0
  console.log(`切回后再走 3 秒：${back0} → ${back1}（增量 ${resumeDelta}，期望 ≥2）`)
  if (resumeDelta < 2) failures.push(`B: 切回后第1题计时没恢复（${back0}→${back1}）`)

  // ===== 场景 C：答题 → 点「下一题」→ 切回看原题（真实路径；已答题的计时冻结）=====
  console.log('\n--- 场景 C：答题后走「下一题」按钮 ---')
  // 第1题此刻正在走（back0 起）。先答题让它 submitted，计时 stopTimer。
  const cAns = await evalIn('window.__answerAndNext()')
  console.log('答题动作:', cAns)
  await sleep(600)
  const cFrozen = await rd()
  await sleep(2500)
  const cFrozen2 = await rd()
  console.log(`答题后静置 2.5 秒：${cFrozen} → ${cFrozen2}（增量应为 0——已提交的题计时必须停）`)
  if (cFrozen2 - cFrozen > 1) failures.push(`C: 答题后计时器还在走（${cFrozen}→${cFrozen2}）——提交未停表`)

  const btnOk = await evalIn('window.__clickNext()')
  await sleep(900)
  const idxD = await idx()
  const dStart = await rd()
  console.log(`点「下一题」=${btnOk}，题号=${idxD}（期望 2），计时器=${dStart}（新题从 0 起）`)
  if (!btnOk) failures.push('C: 找不到「下一题」按钮（答题后应出现）')
  if (idxD !== 2) failures.push(`C: 「下一题」没切到第2题（题号=${idxD}）`)

  // 新题应自己在走
  await sleep(2500)
  const dEnd = await rd()
  console.log(`第2题停留 2.5 秒：${dStart} → ${dEnd}（增量 ≥1）`)
  if (dEnd - dStart < 1) failures.push(`C: 切到的新题计时器没在走（${dStart}→${dEnd}）`)

  // 切回第 1 题（已答题）——它的读数必须是答题时冻结的那个数
  await evalIn('window.__clickDot(1)')
  await sleep(900)
  const idxE = await idx()
  const e0 = await rd()
  console.log(`切回已答题第1题：题号=${idxE}，计时器=${e0}（应等于答题时冻结值 ${cFrozen2}）`)
  if (e0 !== cFrozen2) failures.push(`C: 已答题的读数变了（冻结值 ${cFrozen2} → 现在 ${e0}）`)
  await sleep(2500)
  const e1 = await rd()
  console.log(`已答题静置 2.5 秒：${e0} → ${e1}（增量应为 0——已答题不该重新走动）`)
  if (e1 - e0 > 1) failures.push(`C: 切回已答题后计时又走了（${e0}→${e1}）`)

  cleanup()
  console.log('')
  if (!failures.length) {
    console.log('✅ 通过：切题冻结 · 切回恢复 · 跳题同样冻结/恢复（各题计时互相独立、按各自可见时长累计）')
    process.exit(0)
  }
  console.log('✗ 失败：')
  failures.forEach(f => console.log('   · ' + f))
  process.exit(1)
}

main().catch(e => { console.error('环境错误:', e.message); process.exit(2) })
