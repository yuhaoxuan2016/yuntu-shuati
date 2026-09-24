// 窄屏（手机）布局探针：用本机 Edge 无头 + CDP 设备模拟，在**真实视口**里量元素尺寸。
//
// 为什么要这么麻烦：in-app 浏览器没有可见表面时 `window.innerWidth` 与 `getBoundingClientRect`
// 会成片归零（2026-09-24 踩过：据此差点报一个不存在的 CSS bug）。量宽度必须先有真视口——
// `Emulation.setDeviceMetricsOverride` 给的就是真视口。
//
// 用法：
//   node tests/narrow-width.mjs                        # 默认对 http://localhost:1420/#/ 三档宽度体检
//   node tests/narrow-width.mjs --url http://localhost:1420/#/ --shot out.png
//
// 退出码：0 = 全部断言通过；1 = 有失败（附加一张截图便于肉眼复核）。
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const argOf = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const URL_ = argOf('--url', 'http://localhost:1420/#/')
const SHOT = argOf('--shot', path.join(process.env.TEMP || '/tmp', 'narrow-width.png'))
const NO_HEADER = args.includes('--no-header')   // 别的页面（如设置页）没有 .section-header，只跑普查
const PORT = Number(argOf('--port', '9333'))

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p))
if (!EDGE) { console.error('找不到 Edge'); process.exit(2) }

// 手机宽度档：320（最窄在售） / 360（安卓常见） / 390（iPhone 14/15） / 414（Plus）
const WIDTHS = [320, 360, 390, 414]
// 再加一档桌面：防止「为了修窄屏把宽屏也改坏」（flex-wrap 加错就会把描述挤到第二行）
const DESKTOP_WIDTH = 1280
const HEIGHT = 844

// 行数判据：按**去重后的 rect top** 数行数，不能数 getClientRects() 的个数——
// 一个含内联子元素（如 .ai-tag）的单行文本本来就会返回多个矩形，那样会把「1 行」误判成 3 行。
// 要体检的元素：选择器 + 断言（中文标点按字换行是合法行为，但**标题这种短标签被折成多行就是布局事故**）
const CHECKS = NO_HEADER ? [] : [
  { sel: '.section-header h3', name: '「🌍 公共题库」标题', maxLines: 1 },
  { sel: '.old-toggle', name: '「展开已归档」开关', maxLines: 1 },
]
// 允许临时加检查项：--check "选择器=最多行数[:说明]"，例如体检练习页的难度徽章
for (const a of args) {
  if (!a.startsWith('--check')) continue
  const raw = a.includes('=') ? a.slice(a.indexOf('=') + 1) : args[args.indexOf(a) + 1]
  const [spec, name] = String(raw || '').split(':')
  const [sel, n] = String(spec || '').split('=')
  if (sel) CHECKS.push({ sel, name: name || sel, maxLines: Number(n) || 1 })
}

// 顺带做一次「短文本被折成多行」的普查：正文段落折行是正常的，短标签被折成 3 行以上一定是事故。
// 判据刻意保守（≤10 字 且 ≥3 行），且**只看真的画在视口里的元素**——
// 侧栏抽屉是靠 translateX 挪出屏外的，它照样有 layout，不过滤就会报出一堆假阳性。
const AUDIT_JS = `(() => {
  const lines = el => { const r = document.createRange(); r.selectNodeContents(el); const ys = new Set(); for (const b of r.getClientRects()) ys.add(Math.round(b.top)); return ys.size };
  const inView = el => {
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const rc = el.getBoundingClientRect();
    return rc.width > 0 && rc.right > 0 && rc.left < window.innerWidth && rc.bottom > 0 && rc.top < window.innerHeight;
  };
  const bad = [];
  for (const el of document.querySelectorAll('h1,h2,h3,h4,span,div,a,button,label')) {
    if (el.children.length) continue;                       // 只看纯文本节点，避免整块容器误报
    const txt = (el.textContent || '').trim();
    if (!txt || txt.length > 10) continue;
    if (!inView(el)) continue;
    const n = lines(el);
    if (n >= 3) bad.push({ sel: el.className ? '.' + String(el.className).split(' ')[0] : el.tagName.toLowerCase(), text: txt.slice(0, 12), lines: n, w: Math.round(el.getBoundingClientRect().width) });
  }
  return bad;
})()`

const sleep = ms => new Promise(r => setTimeout(r, ms))

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

const userDataDir = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'edge-probe-'))
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`,
  '--window-size=500,900', 'about:blank',
], { stdio: 'ignore' })

let ws
let failed = 0
try {
  // 等 CDP 端点起来
  let targets = null
  for (let i = 0; i < 40 && !targets; i++) {
    await sleep(250)
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      if (list.some(t => t.type === 'page')) targets = list
    } catch { /* 还没起来 */ }
  }
  if (!targets) throw new Error('Edge CDP 没起来')
  const page = targets.find(t => t.type === 'page')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })

  await cdp(ws, 'Page.enable')
  await cdp(ws, 'Runtime.enable')

  // 先按 iPhone 尺寸把页面装进来（真视口），页面自己会用手机媒体查询
  await cdp(ws, 'Emulation.setDeviceMetricsOverride', { width: 390, height: HEIGHT, deviceScaleFactor: 2, mobile: true })
  await cdp(ws, 'Page.navigate', { url: URL_ })

  // 条件等待：公共题库列表来自云端（匿名登录 + 拉列表），别用固定 sleep——它偶然会慢过 5 秒，
  // 结果探针「什么都没测」还报绿（这正是探针自己最容易犯的错）。
  let ready = NO_HEADER
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(500)
    ready = await evalJs(ws, `!!document.querySelector('.section-header')`)
  }
  // --no-header 时（体检别的页面）没有「等哪个元素」的判据，给一个固定的装载等待——
  // 否则量到的是空页面，检查项全被静默跳过，等于没测（假绿）。
  if (NO_HEADER) await sleep(6000)

  // 可选的前置动作：有些体检对象要**答完题**才渲染（知识点折叠块、难度徽章、解析块），
  // 传一段 JS 在这里跑完再量。例：--pre "document.querySelectorAll('.option').pop().click()"
  const pre = argOf('--pre', '')
  if (pre) {
    await evalJs(ws, pre)
    await sleep(1200)
    await evalJs(ws, "(() => { const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim() === '确认答案'); if (b) b.click(); return 1; })()")
    await sleep(1800)
  }
  if (!ready) {
    console.error('✗ 等不到 .section-header（公共题库没加载出来）——本次探针没有测到东西，判失败，不报绿。')
    console.error('  页面文字摘要：' + await evalJs(ws, `document.body.innerText.slice(0, 200).replace(/\\n/g, ' | ')`))
    failed++
  }

  for (const w of WIDTHS) {
    await cdp(ws, 'Emulation.setDeviceMetricsOverride', { width: w, height: HEIGHT, deviceScaleFactor: 2, mobile: true })
    await sleep(400)
    const got = await evalJs(ws, `(() => {
      const out = { vw: window.innerWidth, items: [] };
      const lines = el => { const r = document.createRange(); r.selectNodeContents(el); const ys = new Set(); for (const b of r.getClientRects()) ys.add(Math.round(b.top)); return ys.size };
      for (const sel of ${JSON.stringify(CHECKS.map(c => c.sel))}) {
        const el = document.querySelector(sel);
        if (!el) { out.items.push({ sel, missing: true }); continue }
        const rc = el.getBoundingClientRect();
        out.items.push({ sel, w: Math.round(rc.width), h: Math.round(rc.height), lines: lines(el), text: (el.textContent || '').trim().slice(0, 20) });
      }
      return out;
    })()`)

    console.log(`\n— 视口 ${got.vw}px`)
    for (const c of CHECKS) {
      const it = got.items.find(i => i.sel === c.sel)
      if (!it || it.missing) {
        // 元素没找到 = 这一档**什么都没测**，不能默默跳过（那正是假绿的形状）
        console.log(`   ✗ ${c.name}：页面上找不到 ${c.sel}（本次未测到）`)
        failed++
        continue
      }
      const ok = it.lines <= c.maxLines
      if (!ok) failed++
      console.log(`   ${ok ? '✓' : '✗'} ${c.name}：${it.w}×${it.h}px，占 ${it.lines} 行（上限 ${c.maxLines}）`)
    }
    const audit = await evalJs(ws, AUDIT_JS)
    if (audit.length) {
      failed += audit.length
      console.log(`   ✗ 短文本被折成多行 ${audit.length} 处：`)
      for (const a of audit.slice(0, 8)) console.log(`      · ${a.sel}「${a.text}」${a.w}px / ${a.lines} 行`)
    } else {
      console.log('   ✓ 短文本普查：没有「≤10 字却排成 3 行以上」的元素')
    }
  }

  // 桌面档：标题与描述应当仍在同一行（整块高度 ≈ 单行），且窄屏普查同样干净
  {
    await cdp(ws, 'Emulation.setDeviceMetricsOverride', { width: DESKTOP_WIDTH, height: 900, deviceScaleFactor: 1, mobile: false })
    await sleep(400)
    const d = await evalJs(ws, `(() => {
      const hdr = document.querySelector('.section-header');
      if (!hdr) return { missing: true };
      const lines = el => { const r = document.createRange(); r.selectNodeContents(el); const ys = new Set(); for (const b of r.getClientRects()) ys.add(Math.round(b.top)); return ys.size };
      const h3 = hdr.querySelector('h3'), sub = hdr.querySelector('.section-sub');
      return { hdrH: Math.round(hdr.getBoundingClientRect().height), h3Lines: lines(h3), subLines: lines(sub), h3Top: Math.round(h3.getBoundingClientRect().top), subTop: Math.round(sub.getBoundingClientRect().top) };
    })()`)
    console.log(`\n— 桌面 ${DESKTOP_WIDTH}px（防回归：别把宽屏也改坏）`)
    if (d.missing) { console.log('   · .section-header 不存在（跳过）') } else {
      const sameRow = Math.abs(d.h3Top - d.subTop) <= 6
      const ok = sameRow && d.h3Lines === 1
      if (!ok) failed++
      console.log(`   ${ok ? '✓' : '✗'} 标题与描述同一行：头部高 ${d.hdrH}px，标题 ${d.h3Lines} 行、描述 ${d.subLines} 行，顶差 ${d.h3Top - d.subTop}px`)
    }
  }

  // 全页普查（390 宽 × 2400 高）：上面几档只普查了「视口内」的元素，长页面要一次装下才不会漏。
  {
    await cdp(ws, 'Emulation.setDeviceMetricsOverride', { width: 390, height: 2400, deviceScaleFactor: 1, mobile: true })
    await sleep(600)
    const audit = await evalJs(ws, AUDIT_JS)
    console.log('\n— 全页普查（390×2400，一次装下整页）')
    if (audit.length) {
      failed += audit.length
      console.log(`   ✗ 短文本被折成多行 ${audit.length} 处：`)
      for (const a of audit.slice(0, 10)) console.log(`      · ${a.sel}「${a.text}」${a.w}px / ${a.lines} 行`)
    } else {
      console.log('   ✓ 没有「≤10 字却排成 3 行以上」的元素')
    }
  }

  // 肉眼复核用截图（390 宽，最常用的那档）
  await cdp(ws, 'Emulation.setDeviceMetricsOverride', { width: 390, height: HEIGHT, deviceScaleFactor: 2, mobile: true })
  await sleep(300)
  const shot = await cdp(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  fs.writeFileSync(SHOT, Buffer.from(shot.data, 'base64'))
  console.log(`\n截图：${SHOT}`)
} catch (e) {
  console.error('探针失败：', e?.message || e)
  failed++
} finally {
  try { ws && ws.close() } catch { /* ignore */ }
  edge.kill()
  await sleep(500)
  try { fs.rmSync(userDataDir, { recursive: true, force: true }) } catch { /* ignore */ }
}

console.log(failed ? `\n有失败：${failed} 项` : '\n全绿')
process.exit(failed ? 1 : 0)
