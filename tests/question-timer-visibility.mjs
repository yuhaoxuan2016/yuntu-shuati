// 单题计时「切后台暂停」探针（2026-10-05）
// 判别式：进入练习页 → 记录计时器读数 → 用 CDP 把页面切到 hidden（真实触发 visibilitychange）
//   → 等 5 秒 → 切回 visible → 再读计时器。
//   修好后 = 读数增量 ≈ 0~1 秒（后台 5 秒没被计入）；修好前 = 增量 ≈ 5 秒（墙钟差照算）。
//
// 关键：不能靠 `document.visibilityState` 手动伪造——那骗得到代码、骗不到真实链路。
//   本探针跑**有头** Edge，用 `Target.createTarget` 真开一个第二个标签页（原标签被系统置为 hidden）
//   + `Target.activateTarget` 真切回来（变回 visible），从而拿到双向都真实的 visibilitychange。
//
// ⚠️ 为什么不用 headless（2026-10-05 实测 Edge 154）：`Page.setWebLifecycleState` 只能单向触发
//   「hidden」，**无法**还原成 visible（`active` 与 `Target.activateTarget` 都实测无效，
//   `Emulation.setPageVisibilityOverride` 在该版本不存在）⇒ 恢复方向验不了。有头模式下标签页
//   切换是真实事件，hidden/visible 双向都能触发。
// ⚠️ 有头窗口会真的弹出来（约 10 秒）。用**独立端口 + 独立 user-data-dir**，收工只结束自己 spawn
//   的进程树（`taskkill /PID <自己的> /T /F`）——绝不碰 rabbit 正在用的浏览器。
//
// 反向对照（防空转假绿）：探针同时验证「前台时计时器确实在走」——
//   若只验「后台不动」而不验「前台会走」，一个坏掉的计时器（永远不动）也会被判通过。
//
// 用法: node tests/question-timer-visibility.mjs [--url http://localhost:4173/] [--headless]
// 前置: 目标站点在跑（静态伺服 dist，例如 `python -m http.server 4173 -d dist`）
// 退出码: 0 = 通过；1 = 断言失败（计时没暂停）；2 = 环境问题（找不到 Edge / 站点不通 / 选题失败）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const argOf = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const URL_ = argOf('--url', 'http://localhost:4173/')
const PORT = Number(argOf('--port', '9347'))
const HEADLESS = args.includes('--headless')

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
].find(p => fs.existsSync(p))
if (!EDGE) { console.error('找不到 Edge'); process.exit(2) }

const PROFILE = path.join(os.tmpdir(), 'q-timer-e2e-' + Date.now())

const FIXTURE = [
  '1、【单选题】装有SF6设备的配电装置室和SF6气体实验室，应装设强力通风装置，风口应设置在室内（ ），排风口不应朝向（ ）。',
  'A、上部户外设备区',
  'B、中部居民住宅或户外设备区',
  'C、底部居民住宅或行人',
  'D、顶部户外设备区或行人',
  '答案：C',
  '',
  '2、【单选题】手工办理的工作票、调度许可的工作、站内设备的异常情况，应记录在生产精益化平台的（ ）中。',
  'A、其他站内记录登记',
  'B、站内例行工作登记',
  'C、维护检修管理',
  '答案：A',
].join('\n')

// 页面内主流程（字符串化后注入执行）：建库 → 导题 → 进练习页 → 把计时器读数挂到 window
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
    setV.call(inp, '计时暂停验收')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    await sleep(150)
    const okBtn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '确定')
    if (!okBtn) throw new Error('找不到确定按钮')
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

    // 读计时器：QuestionCard 模板里的 .timer（title="本题用时"）
    function readSecs () {
      const el = document.querySelector('.qcard .timer')
      if (!el) return null
      const m = el.textContent.trim().match(/^(\d+):(\d+)$/)
      return m ? Number(m[1]) * 60 + Number(m[2]) : null
    }
    // 等计时器出现（首帧落 00:00，第一次 tick 后才非零）
    await until(() => readSecs() !== null, '计时器挂载')
    window.__readTimerSecs = readSecs
    log.push('计时器就位，读数=' + readSecs())

    return { ok: true, log, initial: readSecs() }
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
    // 本机代理（Clash 62171）会拦 127.0.0.1 ⇒ 必须显式绕过，否则 ERR_CONNECTION_REFUSED
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
  console.log('== 单题计时·切后台暂停 验收 ==')
  console.log('准备阶段:', JSON.stringify(setup))
  if (!setup || !setup.ok) { cleanup(); process.exit(2) }

  let failures = []

  // 记录 visibilitychange 事件序列（证明链路真实，而非代码自说自话）
  await evalIn(`window.__visLog = []; document.addEventListener('visibilitychange', () => window.__visLog.push(document.visibilityState)); true`)
  const visOf = async () => await evalIn('document.visibilityState')
  console.log('初始 visibilityState:', await visOf(), '（有头模式=' + !HEADLESS + '）')

  // ===== 反向对照①：前台时计时器必须真的在走 =====
  // 只验「后台不动」会放过「坏了永远不动的计时器」——所以先证它会动。
  let t0 = await evalIn('window.__readTimerSecs()')
  await sleep(3000)
  let t1 = await evalIn('window.__readTimerSecs()')
  const frontDelta = t1 - t0
  console.log(`[对照①] 前台走 3 秒：${t0} → ${t1}（增量 ${frontDelta}）`)
  if (frontDelta < 2) {
    failures.push(`前台计时器没在走（增量 ${frontDelta}，期望 ≥2）——坏计时器会让后面的断言变成假绿`)
  }

  // ===== 主断言：切到别的标签 6 秒，读数不得涨 =====
  const before = await evalIn('window.__readTimerSecs()')
  let bg = null
  if (HEADLESS) {
    await send('Page.setWebLifecycleState', { state: 'frozen' })
    console.log('已切后台（setWebLifecycleState frozen），等待 6 秒…')
  } else {
    // 真开一个新标签页 ⇒ 原标签被系统置为 hidden（真实事件）
    bg = await send('Target.createTarget', { url: 'about:blank' })
    console.log('已新开标签页，等待 6 秒…')
  }
  await sleep(6000)
  const visInBg = await visOf()
  if (HEADLESS) {
    await send('Page.setWebLifecycleState', { state: 'active' })
  } else if (bg && bg.targetId) {
    await send('Target.activateTarget', { targetId: page.id })   // 真切回原标签
  }
  await sleep(700)
  const after = await evalIn('window.__readTimerSecs()')
  const delta = after - before
  console.log(`[主断言] 后台期间 visibilityState=${visInBg}；切后台 6 秒：${before} → ${after}（增量 ${delta}，期望 ≤2）`)
  if (visInBg !== 'hidden') {
    failures.push(`后台期间 visibilityState 不是 hidden（实测 ${visInBg}）——事件没真触发，断言无意义`)
  }
  if (delta > 2) failures.push(`后台那 6 秒被计入了（增量 ${delta}）——暂停没生效`)

  // ===== 反向对照②：切回前台后必须能继续走 =====
  const backVis = await visOf()
  if (backVis !== 'visible') {
    console.log(`[对照②] 跳过：当前 visibilityState=${backVis}，无法验证恢复方向`)
    if (HEADLESS) console.log('   ℹ️ headless 还原不了 visible——去掉 --headless 跑有头模式即可覆盖此断言')
  } else {
    const r0 = await evalIn('window.__readTimerSecs()')
    await sleep(3000)
    const r1 = await evalIn('window.__readTimerSecs()')
    const resumeDelta = r1 - r0
    console.log(`[对照②] 切回后再走 3 秒：${r0} → ${r1}（增量 ${resumeDelta}，期望 ≥2）`)
    if (resumeDelta < 2) failures.push(`切回前台后计时器没恢复（增量 ${resumeDelta}）——只暂停没恢复同样是坏的`)
  }

  const visLog = await evalIn('window.__visLog')
  console.log('visibilitychange 事件序列:', JSON.stringify(visLog))

  cleanup()
  if (!failures.length) {
    const full = !HEADLESS && backVis === 'visible'
    console.log(full
      ? '✅ 通过：前台会走 · 后台不走 · 切回继续走（三条全绿，真实标签页切换触发）'
      : '✅ 通过：前台会走 · 后台不走（恢复方向未覆盖，去掉 --headless 可全绿）')
    process.exit(0)
  }
  console.log('✗ 失败：')
  failures.forEach(f => console.log('   · ' + f))
  process.exit(1)
}

main().catch(e => { console.error('环境错误:', e.message); process.exit(2) })
