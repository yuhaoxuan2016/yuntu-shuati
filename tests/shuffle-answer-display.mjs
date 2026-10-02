// 「选项乱序」正确答案字母换算 探针（2026-10-02）：答错后「正确答案：X」的字母必须按**展示顺序**，
// 且与绿色高亮项、正确项所在展示位三处一致；若回显题库原始字母（旧行为），本探针会失败。
//
// 判别式设计：Q1 用 SF6 题（4 选项，题库原文答案 = C「底部居民住宅或行人」）。
//   本题在「该题库第 1 题」的身份下乱序排布固定为 [3,0,1,2] ⇒ 正确项落在展示位 D：
//   修好后界面 = 「正确答案：D」+ 绿标在 D；修好前 = 「正确答案：C」（与绿标 D 错位）——可鉴别。
//
// 流程：无头 Edge（独立端口 + 独立临时 profile，不碰用户浏览器）→ 新建题库（原生 confirm 由 CDP 自动 accept）
//   → 向导入页拖拽口注入内存 File → 确认导入 → 开始刷题 → 打开选项乱序 → 故意答错 → 三处比对。
//
// 用法: node tests/shuffle-answer-display.mjs [--url http://localhost:4173/] [--shot 输出.png]
// 前置: 目标站点在跑（开发服务器或 `npm run preview` 起的 dist）
// 退出码: 0 = 全绿；1 = 断言失败；2 = 环境问题（找不到 Edge / 站点不通）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const argOf = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const URL_ = argOf('--url', 'http://localhost:4173/')
const SHOT = argOf('--shot', path.join(process.env.TEMP || '/tmp', 'shuffle-answer-display.png'))
const PORT = Number(argOf('--port', '9335'))

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
].find(p => fs.existsSync(p))
if (!EDGE) { console.error('找不到 Edge'); process.exit(2) }

const PROFILE = path.join(os.tmpdir(), 'shuffle-answer-e2e-' + Date.now())

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

// 页面内主流程（字符串化后注入执行）
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
    setV.call(inp, '乱序显示验收')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    await sleep(150)
    const okBtn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '确定')
    if (!okBtn) throw new Error('找不到确定按钮')
    okBtn.click()
    await until(() => location.hash.startsWith('#/import/'), '跳转导入页')
    const bankId = location.hash.split('/')[2]
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
    // 打开选项乱序（开关触发重挂载，等首选项节点被替换）
    const label = [...document.querySelectorAll('label')].find(l => l.textContent.includes('选项乱序'))
    const cb = label && label.querySelector('input[type=checkbox]')
    if (!cb) throw new Error('找不到选项乱序开关')
    if (!cb.checked) {
      const oldFirst = document.querySelector('.qcard .options .option')
      cb.click()
      await until(() => {
        const f = document.querySelector('.qcard .options .option')
        return f && f !== oldFirst
      }, '乱序重挂载')
    }
    await sleep(300)
    // 故意答错，读三处字母
    const RIGHT = '底部居民住宅或行人'
    const RAW_LETTER = 'C'
    const opts = [...document.querySelectorAll('.qcard .options .option')]
    const rightOpt = opts.find(o => o.textContent.includes(RIGHT))
    if (!rightOpt) throw new Error('展示选项里找不到正确项文本: ' + opts.map(o => o.textContent.trim()).join(' | '))
    const wrongOpt = opts.find(o => !o.textContent.includes(RIGHT))
    const expectedLetter = String.fromCharCode(65 + opts.indexOf(rightOpt))
    wrongOpt.click()
    await sleep(200)
    ;[...document.querySelectorAll('button')].find(b => b.textContent.includes('确认答案')).click()
    const fb = await until(() => {
      const f = document.querySelector('.qcard .feedback')
      if (f && f.innerText.includes('正确答案')) return f
    }, '反馈框')
    await sleep(250)
    const lines = [...fb.querySelectorAll('p')].map(p => p.textContent.trim()).filter(Boolean)
    const ansLine = lines.find(t => t.includes('正确答案')) || ''
    const textLetter = ansLine.replace(/[^A-H]/g, '')
    const green = document.querySelector('.qcard .options .option.correct')
    const greenLetter = green ? (green.querySelector('.letter')?.textContent || '').trim() : '(none)'
    const wrongShown = fb.innerText.includes('回答错误')
    return {
      ok: true, bankId, expectedLetter, textLetter, greenLetter, rawLetter: RAW_LETTER,
      remapHappened: textLetter !== RAW_LETTER,
      wrongShown, ansLine, lines, log,
      pass: Boolean(wrongShown && textLetter === expectedLetter && greenLetter === expectedLetter && textLetter !== RAW_LETTER),
    }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), log, tail: document.body ? document.body.innerText.slice(0, 400) : '' }
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

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
    expression: `(${PAGE_FLOW.toString()})(${JSON.stringify(FIXTURE)})`,
    awaitPromise: true, returnByValue: true,
  })
  const result = ev.result && ev.result.value
  console.log('== 乱序字母换算 验收 ==')
  console.log(JSON.stringify(result, null, 2))
  try {
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(SHOT, Buffer.from(shot.data, 'base64'))
    console.log('截图: ' + SHOT)
  } catch (e) { console.log('截图失败: ' + e.message) }
  cleanup()
  if (!result) process.exit(2)
  if (result.pass) { console.log('✅ 通过：文字字母 = 绿标位 = 正确项展示位（且 ≠ 原始字母，换算真实发生）'); process.exit(0) }
  console.error('✗ 未通过')
  process.exit(1)
}

main().catch(e => { console.error('fatal:', e.message); process.exit(2) })
