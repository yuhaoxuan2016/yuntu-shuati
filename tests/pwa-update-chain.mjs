// PWA 更新链探针（2026-09-28）：新 SW 接管后，页面必须**自己刷新一次**，不能再停在旧壳里。
//
// 背景：sw.js 开着 skipWaiting + clientsClaim ⇒ 新版一装上就立刻接管页面，但正在跑的 JS 还是旧包
// （旧 index 引的 chunk 名带 hash，新版服务器上已不存在）⇒ 点进懒加载路由就 404/白屏。
// 修法在 src/main.ts：监听 controllerchange，接管时 reload 一次（首次安装不刷）。
//
// 为什么必须真浏览器：SW 的安装/接管/controllerchange 是浏览器行为，node 里没有这一层；
// 离线断言只能证明「监听器写在那儿」，证明不了「新版来了真的会刷」。
//
// 判据（两条，缺一不可）：
//   A. **反向对照**：sw.js 没变时点 update() → 不许刷新（防「随便什么都会让它刷」的假绿）；
//   B. 主判据：sw.js 改一个字节 → 新 SW 接管 → 页面必须在窗口内自己重新加载。
// 用法: node tests/pwa-update-chain.mjs        （需要先 `npm run build`，dist/ 存在）
// 退出码: 0 = 全绿；1 = 有失败
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const DIST = path.join(ROOT, 'dist')
const SW = path.join(DIST, 'sw.js')
if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error('✗ 没有 dist/index.html，先 npm run build'); process.exit(2) }

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p))
if (!EDGE) { console.error('找不到 Edge'); process.exit(2) }

const PORT = Number(process.env.PROBE_PORT || 8331)
const CDP_PORT = Number(process.env.PROBE_CDP || 9335)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain', '.woff2': 'font/woff2' }

let failed = 0
const ok = m => console.log('   ✓ ' + m)
const bad = m => { console.log('   ✗ ' + m); failed++ }

// ── 自给自足的静态服务：只服务 dist/（不依赖 vite preview 的行为）
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0])
  let f = path.join(DIST, url === '/' ? 'index.html' : url)
  if (!f.startsWith(DIST)) { res.writeHead(403).end(); return }
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404).end('nf'); return }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' })
  res.end(fs.readFileSync(f))
})

async function cdp (ws, method, params = {}) {
  const id = Math.floor(Math.random() * 1e9)
  return new Promise((resolve, reject) => {
    const onMsg = ev => {
      let msg
      try { msg = JSON.parse(ev.data) } catch { return }
      if (msg.id !== id) return
      ws.removeEventListener('message', onMsg)
      msg.error ? reject(new Error(method + ': ' + JSON.stringify(msg.error))) : resolve(msg.result)
    }
    ws.addEventListener('message', onMsg)
    ws.send(JSON.stringify({ id, method, params }))
  })
}
const evalJs = async (ws, expr) => {
  const r = await cdp(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error('页面脚本抛错：' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails))
  return r.result.value
}

// 每次文档加载都把计数器 +1（同一个标签页内 sessionStorage 跨刷新保留）
const COUNT_ON_LOAD = `try { sessionStorage.setItem('probeLoads', String(Number(sessionStorage.getItem('probeLoads') || 0) + 1)) } catch {}`
// 页面里的探针：加载序号 + SW 控制状态 + 有没有注册
const STATE_JS = `(async () => {
  const reg = navigator.serviceWorker ? await navigator.serviceWorker.getRegistration() : null
  return { loads: Number(sessionStorage.getItem('probeLoads') || 0), controlled: !!navigator.serviceWorker.controller, hasReg: !!reg, appMounted: !!document.querySelector('#app > *') }
})()`

async function main () {
  const backup = fs.readFileSync(SW)
  await new Promise(r => server.listen(PORT, '127.0.0.1', r))
  const userDataDir = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'edge-pwa-'))
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${userDataDir}`,
    '--window-size=414,900', 'about:blank',
  ], { stdio: 'ignore' })

  let ws = null
  try {
    // 等 CDP 起来
    let targets = null
    for (let i = 0; i < 40 && !targets; i++) {
      await sleep(500)
      try {
        const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
        const list = await r.json()
        const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl)
        if (page) targets = page
      } catch { /* 还没起来 */ }
    }
    if (!targets) throw new Error('CDP 没起来')
    ws = new WebSocket(targets.webSocketDebuggerUrl)
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
    await cdp(ws, 'Page.enable')
    await cdp(ws, 'Runtime.enable')
    await cdp(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: COUNT_ON_LOAD })

    console.log('— 装载：第一次打开页面（含首次注册 SW）')
    await cdp(ws, 'Page.navigate', { url: `http://127.0.0.1:${PORT}/` })
    let st = null
    for (let i = 0; i < 40; i++) {   // 等 SW 接管（首次安装 → activate → claim）
      await sleep(500)
      try { st = await evalJs(ws, STATE_JS) } catch { continue }
      if (st && st.controlled && st.appMounted) break
    }
    if (!st || !st.controlled) throw new Error('首次打开后 SW 没接管：' + JSON.stringify(st))
    ok(`首次打开：SW 已接管、应用已挂载（加载序号 ${st.loads}）`)
    if (st.loads !== 1) bad(`首次打开不该有额外刷新（加载序号 ${st.loads}，期望 1；首装不刷是设计）`)
    else ok('首装不触发刷新（hadController=false 的守卫生效）')

    // ⚠️ 关键前置：**首装那个页面实例的 hadController 天然是 false**（boot 时还没有 SW 控制它）
    // ⇒ 拿它验「新版接管会不会刷」等于让守卫自己把自己挡住（第一次跑就栽在这里）。
    // 真实用户是「带着已有 SW 再打开」的形态，所以先重载一次，让新实例 boot 时 controller 已在。
    console.log('— 前置：带着已有 SW 重载一次（真实用户的常态）')
    await cdp(ws, 'Page.reload')
    let L0 = 0
    for (let i = 0; i < 40; i++) {
      await sleep(500)
      try { st = await evalJs(ws, STATE_JS) } catch { continue }
      if (st && st.loads === 2 && st.controlled && st.appMounted) break
    }
    if (!st || st.loads !== 2) throw new Error('重载后状态不对：' + JSON.stringify(st))
    L0 = st.loads
    ok(`重载完成：boot 时已有 controller、应用已挂载（加载序号 ${L0}）`)

    console.log('— 反向对照：sw.js 未变 → 主动 update() 也不许刷新')
    await evalJs(ws, `navigator.serviceWorker.getRegistration().then(r => r.update()).then(() => 'done')`)
    await sleep(6000)
    st = await evalJs(ws, STATE_JS)
    if (st.loads !== L0) bad(`sw.js 未变却刷新了（加载序号 ${L0} → ${st.loads}）—— 说明刷新与「真有新版」无关`)
    else ok('没有新版时不刷新（判定确实挂在 controllerchange 上）')

    console.log('— 主判据：sw.js 改一个字节 → 新 SW 接管 → 页面必须自刷')
    fs.appendFileSync(SW, '\n// pwa-update-chain probe bump\n')
    await evalJs(ws, `navigator.serviceWorker.getRegistration().then(r => r.update()).then(() => 'done')`)
    let reloaded = false
    for (let i = 0; i < 40; i++) {
      await sleep(500)
      try { st = await evalJs(ws, STATE_JS) } catch { continue }   // 刷新瞬间取值会失败，属正常
      if (st && st.loads > L0) { reloaded = true; break }
    }
    if (reloaded) ok(`新版接管后页面自己刷新了（加载序号 ${L0} → ${st.loads}）`)
    else bad(`新版接管后没刷新（加载序号仍是 ${st && st.loads}）`)

    if (reloaded) {
      // 刷完必须还能用：应用挂载 + 仍是新 SW 在管
      for (let i = 0; i < 20 && !(st && st.appMounted); i++) { await sleep(500); try { st = await evalJs(ws, STATE_JS) } catch {} }
      st && st.appMounted ? ok('刷新后应用正常挂载（没白屏）') : bad('刷新后应用没挂载：' + JSON.stringify(st))
      st && st.controlled ? ok('刷新后仍由 SW 控制（正常状态）') : bad('刷新后失去 SW 控制：' + JSON.stringify(st))
    }
  } finally {
    fs.writeFileSync(SW, backup)          // 还原被改的构建产物
    try { ws && ws.close() } catch {}
    edge.kill()
    server.close()
  }
  console.log(`\n${failed === 0 ? '全绿' : '有失败'}：${failed} 项失败`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(e => { console.error('异常：', e && (e.message || e)); process.exit(1) })
