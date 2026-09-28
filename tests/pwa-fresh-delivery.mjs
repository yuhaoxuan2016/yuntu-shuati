// 交付链探针（2026-09-28）：部署之后，**一次普通刷新**能不能拿到新包。
//
// 病灶（当晚实测到的）：浏览器加载的是 `index-Y88-AYhA.js`（旧入口），而 origin 上只有
// `index-BkE9Oxo7.js`；缓存里那份 index.html 引用的是新入口，但正在跑的文档是旧的 ——
// 旧版把 index.html 也 precache 了、并用 navigateFallback 把导航绑到它，
// 于是「导航」这个动作拿到的是**缓存里的旧文档**。用户不点「有新版本·点此刷新」就出不去新包。
// （当晚那次「上传」因此走的还是旧的整条覆盖推送，把云端进度 map 写小了 —— 就是这么引出来的。）
//
// 改法：index.html 不进 precache（globIgnores），导航改走 NetworkFirst（3s 超时，断网仍回落缓存）。
//
// 判据（两条一起才算数）：
//   A 反证：用**旧配置生成的 sw.js**跑同一套文件 ⇒ 刷新后仍是旧入口（证明这台机器真的能复现病灶，
//     否则 B 是恒绿的）。
//   B 主判据：用**本仓新构建的 dist/sw.js** ⇒ 同样的刷新动作直接拿到新入口。
//   C 顺带：断网时刷新仍应出页面（NetworkFirst 回落缓存）——这是我为「导航走网络」付出的取舍，得能兜住。
//
// 用法: node tests/pwa-fresh-delivery.mjs      （需要先 `npm run build`）
// 退出码: 0 = 全绿；1 = 有失败
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { generateSW } from 'workbox-build'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const DIST = path.join(ROOT, 'dist')
const PORT = Number(process.env.PROBE_PORT || 8341)
const CDP_PORT = Number(process.env.PROBE_CDP || 9345)
const BASE = `http://127.0.0.1:${PORT}/`
const sleep = ms => new Promise(r => setTimeout(r, ms))
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }

let failed = 0
const ok = m => console.log('   ✓ ' + m)
const bad = m => { console.log('   ✗ ' + m); failed++ }
const warn = m => console.log('   ⚠️ ' + m)

if (!fs.existsSync(path.join(DIST, 'sw.js'))) { console.error('✗ 没有 dist/sw.js，先 npm run build'); process.exit(2) }

// ── 站点暂存：把 dist 拷出来，用「改名 + 改写 index.html」模拟一次部署（内容不重要，入口 hash 才重要）
const SITE = fs.mkdtempSync(path.join(os.tmpdir(), 'shuati-site-'))
function copyDir (src, dst) {
  fs.mkdirSync(dst, { recursive: true })
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name)
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d)
  }
}
copyDir(DIST, SITE)

function entryOfIndex (htmlPath) {
  const m = fs.readFileSync(htmlPath, 'utf8').match(/assets\/(index-[A-Za-z0-9_-]+\.js)/)
  if (!m) throw new Error('index.html 里找不到入口 chunk')
  return m[1]
}
const H1 = entryOfIndex(path.join(SITE, 'index.html'))

/** 造一次「部署」：入口换成另一个文件名（内容照旧），文档引用跟着改 */
function deployV2 () {
  const target = path.join(SITE, 'assets', 'index-V2DEPLOYED.js')
  fs.copyFileSync(path.join(SITE, 'assets', H1), target)
  const html = path.join(SITE, 'index.html')
  fs.writeFileSync(html, fs.readFileSync(html, 'utf8').split(H1).join('index-V2DEPLOYED.js'))
  return 'index-V2DEPLOYED.js'
}
function restoreV1 () {
  const html = path.join(SITE, 'index.html')
  fs.writeFileSync(html, fs.readFileSync(html, 'utf8').split('index-V2DEPLOYED.js').join(H1))
  fs.rmSync(path.join(SITE, 'assets', 'index-V2DEPLOYED.js'), { force: true })
}

let serve = true
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0])
  if (!serve) { res.writeHead(502).end(); return }        // C：模拟断网
  let f = path.join(SITE, url === '/' ? 'index.html' : url.replace(/^\/+/, ''))
  if (!f.startsWith(SITE)) { res.writeHead(403).end(); return }
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404).end('nf'); return }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' })
  res.end(fs.readFileSync(f))
})

async function cdp (ws, method, params = {}) {
  const id = Math.floor(Math.random() * 1e9)
  return new Promise((resolve, reject) => {
    const onMsg = ev => {
      let msg; try { msg = JSON.parse(ev.data) } catch { return }
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
const STATE_JS = `(async () => {
  const reg = navigator.serviceWorker ? await navigator.serviceWorker.getRegistration() : null
  const src = [...document.querySelectorAll('script[src]')].map(s => s.src.split('/').pop())
  return { controlled: !!navigator.serviceWorker.controller, swState: reg && reg.active ? reg.active.state : 'none',
    entries: src.filter(s => /^index-.*\\.js$/.test(s)), mounted: !!document.querySelector('#app > *') }
})()`

/** 一轮完整采样：干净 profile → 装 v1 的 SW → 部署 v2 → 普通刷新 → 看拿到哪个入口；extra 在同一会话里再跑一步 */
async function probe (label, swFile, opts) {
  // 传成函数＝上一版签名漏改的形态，会让这一步**静默不跑**（假绿），一律直接中止
  if (typeof opts === "function") throw new Error("probe 第三参必须是 { beforeDeploy, afterReload }，不能再传函数")
  const { beforeDeploy, afterReload } = opts || {}
  console.log(`\n— ${label}（用 ${path.basename(swFile)}）`)
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-delivery-'))
  const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
    .find(p => fs.existsSync(p))
  if (!EDGE) throw new Error('找不到 Edge')
  restoreV1()
  const swReal = path.join(SITE, 'sw.js')
  const swKeep = fs.readFileSync(swReal)   // Buffer：只能 writeFileSync，不能当 copyFileSync 的源
  fs.copyFileSync(swFile, swReal)
  serve = true
  const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${userDataDir}`, '--window-size=414,900', 'about:blank'], { stdio: 'ignore' })
  try {
    let target = null
    for (let i = 0; i < 40 && !target; i++) {
      await sleep(500)
      try {
        const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
        target = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl)
      } catch { /* 还没起来 */ }
    }
    if (!target) throw new Error('CDP 没起来')
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
    await cdp(ws, 'Page.enable'); await cdp(ws, 'Runtime.enable')

    await cdp(ws, 'Page.navigate', { url: BASE })
    let st = null
    for (let i = 0; i < 40; i++) { await sleep(500); try { st = await evalJs(ws, STATE_JS) } catch { continue } if (st?.controlled && st.mounted) break }
    if (!st?.controlled) { warn(`${label}：样本 SW 没接管（本机没复现出这一路），该轮的结论不采信`); return null }
    if (st.entries[0] !== H1) { bad(`${label}：装载阶段就该是 v1 入口，实际 ${st.entries.join(',')}`); return null }
    ok(`装载：v1 入口 ${H1}、SW 已接管（${st.swState}）`)

    // 断网兜底要在「还没换包」的时候测：换包后的新入口是我临时改名的，不在任何 precache 清单里，
    // 拿它验离线必然失败 —— 那是测试自己的破绽，不是产品行为（上一轮就栽在这）。
    if (beforeDeploy) {
      await beforeDeploy({ ws, evalJsFn: evalJs, cdpFn: cdp })
      const back = await evalJs(ws, STATE_JS).catch(() => null)
      if (!back?.mounted) bad(`离线之后回到在线，页面应还能挂载（实际 ${JSON.stringify(back)}）`)
    }

    const H2 = deployV2()
    ok(`已「部署」v2（origin 现在只给 ${H2}）`)
    await sleep(1500)                        // 给 SW 一次更新检查的机会（真实部署也一定有这个间隔）
    await cdp(ws, 'Page.navigate', { url: BASE })   // 用户动作＝再进一次/刷一次，不点任何「刷新版本」按钮
    let st2 = null
    for (let i = 0; i < 30; i++) { await sleep(500); try { st2 = await evalJs(ws, STATE_JS) } catch { continue } if (st2?.mounted && st2.entries.length) break }
    const got = st2 ? st2.entries.join(',') : '(没读到)'
    fs.writeFileSync(swReal, swKeep)
    if (afterReload) await afterReload({ ws, got, H2 })
    return { H2, got, st2 }
  } finally {
    edge.kill('SIGTERM')
    await sleep(1200)
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
}

async function main () {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r))

  // —— 静态：新构建的 sw.js 该长什么样
  console.log('— 静态断言（dist/sw.js）')
  const swNew = fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8')

  // （正则一律先命名再用 —— 行首裸写 /re/ 会被 ASI 当除号，本仓已栽三次）
  const RE_MANIFEST_INDEX = /url:\s*["']index\.html["']\s*,\s*revision:/
  const RE_NETWORK_FIRST = /NetworkFirst/
  const RE_PAGES_CACHE = /"pages"|'pages'/
  const RE_BOUND_TO_INDEX = /NavigationRoute[\s\S]{0,120}createHandlerBoundToURL\("[^"]*index\.html"\)/
  RE_MANIFEST_INDEX.test(swNew) ? bad('新 sw.js 的 precache 清单里还有 index.html ⇒ 导航仍会吃到缓存旧文档') : ok('index.html 不在 precache 清单里');
  (RE_NETWORK_FIRST.test(swNew) && RE_PAGES_CACHE.test(swNew)) ? ok('导航有 NetworkFirst(cacheName=pages) 路由') : bad('缺 NetworkFirst 路由');
  const reBound = RE_BOUND_TO_INDEX
  reBound.test(swNew) ? bad('还有 navigateFallback 绑到 precached index.html') : ok('没有 navigateFallback 绑到 precached index.html');

  // —— 反证用的旧配置 sw：用同一套 dist 现场生成（不是凭印象手写）
  // 必须生成在**站点目录里**：workbox-build 会把它依赖的 workbox-*.js 复制到 swDest 所在目录，
  // 放到 tmp 就导致站点里缺这些 chunk ⇒ SW 加载失败 ⇒ 反证样本「因为别的原因不接管」，等于没测。
  const OLD_SW = path.join(SITE, 'sw-old-config.js')
  await generateSW({
    swDest: OLD_SW, globDirectory: DIST, globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
    navigateFallback: '/index.html', maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
  })
  // workbox-build 在 Windows 上会把清单里的 url 写成反斜杠（"assets\x.js"）⇒ 这些 URL 请求 404、
  // precache 装不上、SW 根本不激活 —— 反证样本会「因为别的原因失败」，那样 A 的结论一点不算数。
  let swOld = fs.readFileSync(OLD_SW, 'utf8')
  const RE_BS_URL = /url:"[^"]*\\+"/g
  const nBackslash = (swOld.match(RE_BS_URL) || []).length
  swOld = swOld.replace(/url:"([^"]*\\+)"/g, (m, u) => 'url:"' + u.replace(/\\/g, '/') + '"')
  fs.writeFileSync(OLD_SW, swOld)
  console.log(`   （对照样本已把 ${nBackslash} 条反斜杠 URL 归一成正斜杠）`)
  RE_MANIFEST_INDEX.test(swOld)
    ? ok('（对照）旧配置生成的清单里确实含 index.html —— 反证样本成立')
    : bad('（对照）旧配置清单里没有 index.html ⇒ 反证样本无效，下面 A 的结论不能算')
  // 静态反证：旧配置把「导航」钉死在 precached index.html 上 —— 这就是「部署完也不换新包」的机制本体
  RE_BOUND_TO_INDEX.test(swOld)
    ? ok('（对照）旧配置确有 NavigationRoute→createHandlerBoundToURL(index.html) ⇒ 导航只会拿缓存文档')
    : bad('（对照）旧配置里没有那条绑定 ⇒ 病灶机制不成立，A/B 的对照关系作废')

  // A 反证（浏览器路）。样本 SW 若在本地起不来，probe 自己会报 ⚠️ 并返回 null —— 该轮不采信，
  // 但病灶机制已由上面两条静态断言 + 当晚生产实测（页面跑 index-Y88-AYhA.js，origin 只有 index-BkE9Oxo7.js）钉住。
  const a = await probe('A 反证：旧配置', OLD_SW)
  if (a) {
    a.got === a.H2 ? bad('旧配置下刷新竟然拿到了新入口 ⇒ 病灶复现失败，本测试的反证失效（别把 B 当证据）')
      : ok(`旧配置：刷新后仍是旧入口 ${a.got}（病灶复现 ✓）`)
  }
  // B 主判据（同一个会话里顺手做 C：断网再刷一次，验 NetworkFirst 的回落）
  const b = await probe('B 主判据：本仓新配置', path.join(DIST, 'sw.js'), { beforeDeploy: async ({ ws, evalJsFn, cdpFn }) => {
    console.log('  — C 断网兜底（先在线刷一次让 SW 真的缓存过文档，再关服务）')
    // 第一次进站点时**还没有 SW 控制**（SW 是这次加载才装的），那份文档从没进过 pages 缓存；
    // 直接断网刷新必然没得回落 —— 那是取样顺序的问题，不是产品行为（上一轮就误判在这）。
    await cdpFn(ws, 'Page.navigate', { url: BASE })
    let primed = null
    for (let i = 0; i < 20; i++) { await sleep(500); try { primed = await evalJsFn(ws, STATE_JS) } catch { continue } if (primed && primed.mounted) break }
    primed && primed.mounted ? ok('  （前置）在线刷新一次，文档已进 SW 缓存') : bad(`  （前置）在线刷新没出页面：${JSON.stringify(primed)}`)
    serve = false                       // 真断网：直接关监听（502 是「服务端报错」，不是「拿不到」）
    await new Promise(r => server.close(r))
    await sleep(400)
    await cdpFn(ws, 'Page.navigate', { url: BASE })
    let st3 = null, where = ''
    for (let i = 0; i < 24; i++) {
      await sleep(500)
      try { st3 = await evalJsFn(ws, STATE_JS) } catch { where = await evalJsFn(ws, 'location.href').catch(() => '读不到 href'); continue }
      if (st3 && st3.mounted) break
    }
    await new Promise(r => server.listen(PORT, '127.0.0.1', r))
    serve = true
    st3 && st3.mounted
      ? ok(`断网刷新仍出页面（SW 回落缓存，入口 ${st3.entries.join(',')}）`)
      : bad(`断网刷新没出页面 ⇒ NetworkFirst 的回落没兜住（状态 ${JSON.stringify(st3)}，地址 ${where || '(未读到)'}）`)
  } })
  if (b) {
    b.got === b.H2 ? ok(`新配置：刷新即拿到新入口 ${b.got}`)
      : bad(`新配置：刷新后拿到的还是 ${b.got}（应为 ${b.H2}）⇒ 交付链没修好`)
  }

  server.close()
  fs.rmSync(SITE, { recursive: true, force: true })
  console.log(failed ? `\n有失败：${failed} 项` : '\n全绿')
  process.exit(failed ? 1 : 0)
}
main().catch(e => { console.error('致命：', e?.message || e); server.close(); process.exit(1) })
