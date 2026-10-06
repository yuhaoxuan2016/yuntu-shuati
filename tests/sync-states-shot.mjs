// 同步状态四态动效 截图+断言探针（2026-10-07 v1.2.85）
// 目的：在真实构建产物上验证——① .sc-ico 动画在四态下的 computed 行为（转/弹/静）
//       ② 四态颜色/透明度确实可辨 ③ 留四张截图供人工目检。
// 做法：打开首页 → 对胶囊**注入类名与字形**（只改 DOM，不点按钮、不改 Vue 状态、零同步副作用）逐态断言+截图。
// 用法: node tests/sync-states-shot.mjs [--url http://localhost:4173/] [--out 输出目录]
// 前置: 目标站点在跑（preview 起的 dist）
// 退出码: 0 = 全绿；1 = 断言失败；2 = 环境问题（找不到 Edge / CDP 起不来）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const argOf = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const URL_ = argOf('--url', 'http://localhost:4173/')
const OUT = argOf('--out', path.join(process.env.TEMP || '/tmp'))
const PORT = Number(argOf('--port', '9337'))

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p))
if (!EDGE) { console.error('找不到 Edge'); process.exit(2) }
const PROFILE = path.join(os.tmpdir(), 'sync-states-shot-' + Date.now())

// 页面内（字符串化注入）：强制某态并回报 computed 证据。动画名可能被 scoped 加后缀 ⇒ 用 includes 判。
// ⚠️ .sync-chip 有 150ms 颜色过渡：注入类后必须等过渡落定（320ms）再读，否则读到的是中间色
//    （2026-10-07 实测：不等会把 fail 读成绿、idle 读成红——全是过渡插值）。
// 2026-10-07 晚二版：☁ 常驻（.sc-ico 固定）+ 状态随行符（.sc-mark）——强制态时改的是 .sc-mark。
async function FORCE_STATE (cls, mark) {
  const chip = document.querySelector('.sync-chip')
  if (!chip) return { ok: false, error: '胶囊不在 DOM' }
  chip.className = 'sync-chip ' + cls
  const ico = chip.querySelector('.sc-ico')
  const markEl = chip.querySelector('.sc-mark')
  if (!ico || !markEl) return { ok: false, error: '.sc-ico/.sc-mark 不在 DOM' }
  ico.textContent = '☁'
  markEl.textContent = mark
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  await new Promise(r => setTimeout(r, 320))
  const csMark = getComputedStyle(markEl)
  const csChip = getComputedStyle(chip)
  const r = chip.getBoundingClientRect()
  return {
    ok: true,
    anim: csMark.animationName, animDur: csMark.animationDuration,
    color: csChip.color, border: csChip.borderColor, opacity: csChip.opacity,
    rect: { x: Math.floor(r.x) - 6, y: Math.floor(r.y) - 6, width: Math.ceil(r.width) + 12, height: Math.ceil(r.height) + 12 },
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const fail = []

async function main () {
  fs.mkdirSync(OUT, { recursive: true })
  const child = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--remote-allow-origins=*', '--window-size=520,1200', 'about:blank',
  ], { stdio: 'ignore' })

  let page = null
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
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
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pend.has(msg.id)) { pend.get(msg.id)(msg); pend.delete(msg.id) }
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
  await send('Page.navigate', { url: URL_ })
  await sleep(2500)

  const STATES = [
    ['syncing', 'ss-syncing', '↻', r => r.anim.includes('spin')],
    ['ok', 'ss-ok ss-pop', '✓', r => r.anim.includes('pop')],
    ['fail', 'ss-fail', '!', r => true],
    ['idle', 'ss-idle', '', r => r.anim === 'none'],
    ['off', 'ss-off', '', r => r.opacity === '0.6'],
  ]
  const seen = { color: [], border: [] }
  for (const [name, cls, glyph, check] of STATES) {
    const ev = await send('Runtime.evaluate', {
      expression: `(${FORCE_STATE.toString()})(${JSON.stringify(cls)}, ${JSON.stringify(glyph)})`,
      awaitPromise: true, returnByValue: true,
    })
    const r = ev.result && ev.result.value
    if (!r || !r.ok) { fail.push(`${name}: ${r && r.error}`); continue }
    seen.color.push(r.color); seen.border.push(r.border)
    if (!check(r)) fail.push(`${name}: computed 不符（anim=${r.anim} dur=${r.animDur} opacity=${r.opacity}）`)
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...r.rect, scale: 2 } })
    const file = path.join(OUT, `sync-${name}.png`)
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'))
    console.log(`[${name}] anim=${r.anim}(${r.animDur}) color=${r.color} border=${r.border} opacity=${r.opacity} → ${file}`)
  }
  // 去重计数：syncing/ok/fail/idle/off 里至少 3 种不同文字色（off 与 idle 靠透明度再区分）
  const uniq = new Set(seen.color)
  if (uniq.size < 3) fail.push(`四态颜色区分不足：仅 ${uniq.size} 种（${[...uniq].join(' / ')}）`)
  cleanup()
  if (fail.length) {
    console.error('❌ 四态动效探针失败：')
    fail.forEach(f => console.error('   ' + f))
    process.exit(1)
  }
  console.log(`✅ 四态动效探针通过：5 态已截图（syncing 转 / ok 弹 / fail / idle / off），文字色 ${uniq.size} 种可辨`)
  process.exit(0)
}

main().catch(e => { console.error('fatal:', e.message); process.exit(2) })
