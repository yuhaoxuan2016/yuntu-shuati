// 首页「同步状态胶囊」冒烟（2026-10-07）：一把守两件事——
//   ① 首页能挂载：TDZ 白屏历史撞过三次（Vue watch 注册即求值 source），本批 HomeView 新增了
//      响应式 + 轮询代码，属高危回归点；白屏时本探针第一项就失败。
//   ② 「同步状态胶囊」存在于 DOM：状态类 ∈ ss-{off,idle,syncing,ok,fail}、☁ 常驻（.sc-ico === '☁'）、
//      状态随行符 .sc-mark ∈ {'', ↻, ✓, !}（2026-10-07 晚二版：☁ 常驻 + 随行符，rabbit「云哪去了」）、元素是 button。
//      四态由真实同步状态驱动，本探针只验「存在且形态合法」，不赌具体态（新建 profile 无数据，
//      可能停在 off/idle，也可能已跑完自动同步变 ok/fail——都以正则放行）。
//   ③ 点击接线：off 态点胶囊应跳设置页（syncEnabled=false 分支，零网络副作用）；
//      非 off 态跳过并注明（避免在探针里触发真实同步）。
// 无头 Edge（独立端口 + 独立临时 profile，不碰用户浏览器）。
// 用法: node tests/home-sync-chip.mjs [--url http://localhost:4173/] [--shot 输出.png]
// 前置: 目标站点在跑（preview 起的 dist 或开发服务器）
// 退出码: 0 = 全绿；1 = 断言失败；2 = 环境问题（找不到 Edge / CDP 起不来）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const argOf = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const URL_ = argOf('--url', 'http://localhost:4173/')
const SHOT = argOf('--shot', path.join(process.env.TEMP || '/tmp', 'home-sync-chip.png'))
const PORT = Number(argOf('--port', '9336'))

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
].find(p => fs.existsSync(p))
if (!EDGE) { console.error('找不到 Edge'); process.exit(2) }

const PROFILE = path.join(os.tmpdir(), 'home-sync-chip-e2e-' + Date.now())

// 页面内主流程（字符串化后注入执行）
async function PAGE_FLOW () {
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
    // ① 挂载证据（顺序从严到宽）：header 标题最直接；空态/新建按钮做兜底
    await until(
      () => document.querySelector('.header h2') || document.querySelector('.new-bank-btn') || document.querySelector('.empty-action'),
      '首页挂载', 45000)
    const chip = await until(() => document.querySelector('.sync-chip'), '同步胶囊', 10000)
    await sleep(300)
    const cls = chip.className || ''
    const state = (cls.match(/ss-(off|idle|syncing|ok|fail)/) || [])[1] || ''
    // 2026-10-07 晚二版：☁ 常驻（.sc-ico）+ 状态随行符（.sc-mark）——按两节点分别校验
    const icoEl = chip.querySelector('.sc-ico')
    const markEl = chip.querySelector('.sc-mark')
    const ico = icoEl ? (icoEl.textContent || '').trim() : ''
    const mark = markEl ? (markEl.textContent || '').trim() : ''
    const text = (chip.textContent || '').trim()
    const h2 = ((document.querySelector('.header h2') || {}).textContent || '').trim()
    const appChildren = ((document.querySelector('#app') || {}).children || []).length
    return {
      ok: true,
      tagName: chip.tagName, cls, state, ico, mark, text,
      title: chip.getAttribute('title') || '',
      h2, appChildren,
      bodyHead: document.body.innerText.slice(0, 200),
      pass: Boolean(
        state && ico === '☁' && ['', '↻', '✓', '!'].includes(mark) && chip.tagName === 'BUTTON' &&
        h2 === '我的题库' && appChildren > 0
      ),
    }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), tail: document.body ? document.body.innerText.slice(0, 300) : '(no body)' }
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// 点击接线检查（仅 off 态调用；整段字符串化注入）
async function CLICK_FLOW () {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  try {
    const chip = document.querySelector('.sync-chip')
    if (!chip) return { ok: false, error: '胶囊不在 DOM' }
    chip.click()
    const t0 = Date.now()
    while (Date.now() - t0 < 5000) {
      if (location.hash.startsWith('#/settings')) return { ok: true, hash: location.hash }
      await sleep(200)
    }
    return { ok: false, hash: location.hash, error: '点击后 5s 内未跳到设置页' }
  } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
}

async function main () {
  const child = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--remote-allow-origins=*', '--window-size=520,1200', 'about:blank',
  ], { stdio: 'ignore' })

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

  const ev = await send('Runtime.evaluate', {
    expression: `(${PAGE_FLOW.toString()})()`,
    awaitPromise: true, returnByValue: true,
  })
  const result = ev.result && ev.result.value
  console.log('== 首页同步胶囊冒烟 ==')
  console.log(JSON.stringify(result, null, 2))
  try {
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(SHOT, Buffer.from(shot.data, 'base64'))
    console.log('截图: ' + SHOT)
  } catch (e) { console.log('截图失败: ' + e.message) }
  // ③ 点击接线（仅 off 态；截图之后再点，避免截图落到设置页）
  let click = null
  if (result && result.pass) {
    if (result.state === 'off') {
      const ev2 = await send('Runtime.evaluate', {
        expression: `(${CLICK_FLOW.toString()})()`,
        awaitPromise: true, returnByValue: true,
      })
      click = ev2.result && ev2.result.value
      console.log('点击接线: ' + JSON.stringify(click))
    } else {
      click = { skipped: true, reason: 'state=' + result.state + '，不在探针里触发真实同步' }
      console.log('点击接线: 跳过（' + click.reason + '）')
    }
  }
  cleanup()
  const clickOk = !click || click.ok || click.skipped
  if (!result) process.exit(2)
  if (result.pass && clickOk) { console.log('✅ 通过：首页挂载正常，同步胶囊在 DOM（四态类 + ☁ 常驻/随行符 + button' + (click && click.ok ? '，off 态点击跳设置页' : '') + '）'); process.exit(0) }
  console.error('✗ 未通过')
  process.exit(1)
}

main().catch(e => { console.error('fatal:', e.message); process.exit(2) })
