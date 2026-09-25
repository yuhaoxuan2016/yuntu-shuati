// 真浏览器验证（2026-09-25）：卡片菜单里「提交到公共题库」对**导入副本**必须不出现、对**自建库**照旧出现。
//
// 手法：CDP 起 Edge → 打开首页（先让应用自己建好 IndexedDB 的库与 store）→ 直接往 quiz_banks 塞两个库
//       （901 不带 origin_ref＝自建；902 带 origin_ref＝导入副本）→ 重载让应用读出来 →
//       逐张卡片点开 ⋯ 菜单，读按钮文案 + 截图。
// 依赖: 先在 shuati-pwa 跑 `npm run dev`（1420）。用法: node tests/bank-menu-submit.mjs
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const URL_ = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:1420/#/'
const SHOT_DIR = process.env.TEMP || '/tmp'
const PORT = 9335

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p))
if (!EDGE) { console.error('找不到 Edge'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
let failed = 0
const ok = m => console.log('   ✓ ' + m)
const bad = m => { console.log('   ✗ ' + m); failed++ }

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

const userDataDir = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'edge-bankmenu-'))
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`, '--window-size=500,900', 'about:blank',
], { stdio: 'ignore' })

let ws
try {
  let targets = null
  for (let i = 0; i < 40 && !targets; i++) {
    await sleep(250)
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      if (list.some(t => t.type === 'page')) targets = list
    } catch { /* 还没起来 */ }
  }
  if (!targets) throw new Error('Edge CDP 没起来')
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
  await cdp(ws, 'Page.enable'); await cdp(ws, 'Runtime.enable')
  await cdp(ws, 'Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 2, mobile: true })
  await cdp(ws, 'Page.navigate', { url: URL_ })

  // ① 等应用把首页渲染出来（新手档 = 空态；这条同时证明「探针确实测到了东西」）
  let ready = false
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(400)
    ready = await evalJs(ws, `!!(document.querySelector('.empty-action') || document.querySelector('.card'))`)
  }
  if (!ready) throw new Error('首页没渲染出来：' + await evalJs(ws, `document.body.innerText.slice(0, 160).replace(/\\n/g, ' | ')`))
  console.log('首页就绪，塞两个测试题库进 IndexedDB')

  // ② 塞数据（应用已经建好库与 store；这里只写不改结构）
  const seeded = await evalJs(ws, `(async () => {
    const open = () => new Promise((res, rej) => { const r = indexedDB.open('shuati-bao-pwa', 5); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    const db = await open()
    const has = db.objectStoreNames.contains('quiz_banks')
    if (!has) { db.close(); return 'no-store' }
    const now = new Date().toISOString()
    await new Promise((res, rej) => {
      const tx = db.transaction('quiz_banks', 'readwrite')
      const st = tx.objectStore('quiz_banks')
      st.put({ id: 901, name: '自建测试库', description: '', visibility: 'private', created_at: now, updated_at: now })
      st.put({ id: 902, name: '导入副本测试库', description: '来自公共题库：变电安规', visibility: 'private', origin_ref: 'lquiz_banks_14', created_at: now, updated_at: now })
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error)
    })
    db.close(); return 'ok'
  })()`)
  if (seeded !== 'ok') throw new Error('塞数据失败：' + seeded)

  // ③ 重载，等两张卡片都出来
  await cdp(ws, 'Page.reload')
  let both = false
  for (let i = 0; i < 40 && !both; i++) {
    await sleep(400)
    both = await evalJs(ws, `!(document.body.innerText.includes('自建测试库') && document.body.innerText.includes('导入副本测试库') ) ? false : true`)
  }
  if (!both) throw new Error('两个测试题库没同时出现在列表里')
  console.log('两张卡片都在')

  // ④ 逐张点开 ⋯ 菜单读按钮
  async function menuOf (name) {
    await evalJs(ws, `(() => { const c = [...document.querySelectorAll('.card')].find(x => x.querySelector('h3') && x.querySelector('h3').textContent.includes(${JSON.stringify(name)})); if (c) c.querySelector('.more-btn').click(); return 1 })()`)
    await sleep(250)
    const labels = await evalJs(ws, `(() => {
      const c = [...document.querySelectorAll('.card')].find(x => x.querySelector('h3') && x.querySelector('h3').textContent.includes(${JSON.stringify(name)}))
      const m = c && c.querySelector('.dropdown-menu')
      return m ? [...m.querySelectorAll('button')].map(b => b.textContent.trim()) : null
    })()`)
    return labels
  }

  const importedLabels = await menuOf('导入副本测试库')
  console.log(`\n— 导入副本（origin_ref=lquiz_banks_14）菜单：\n   ${importedLabels ? importedLabels.join(' / ') : '(没打开)'}`)
  if (!importedLabels) bad('菜单没打开，本节未测到东西')
  else {
    importedLabels.some(l => l.includes('提交到公共题库'))
      ? bad('导入副本**仍然**显示「提交到公共题库」')
      : ok('导入副本没有「提交到公共题库」')
    importedLabels.some(l => l.includes('删除题库'))
      ? ok('其余菜单项照旧（删除题库在）')
      : bad('菜单项少了，可能整体没渲染')
    fs.writeFileSync(path.join(SHOT_DIR, 'bank-menu-imported.png'), Buffer.from((await cdp(ws, 'Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  }
  await evalJs(ws, `(() => { const c = [...document.querySelectorAll('.card')].find(x => x.querySelector('h3') && x.querySelector('h3').textContent.includes('导入副本测试库')); if (c) c.querySelector('.more-btn').click(); return 1 })()`)
  await sleep(200)

  const mineLabels = await menuOf('自建测试库')
  console.log(`\n— 自建库（无 origin_ref）菜单：\n   ${mineLabels ? mineLabels.join(' / ') : '(没打开)'}`)
  if (!mineLabels) bad('菜单没打开，本节未测到东西')
  else {
    mineLabels.some(l => l.includes('提交到公共题库'))
      ? ok('自建库照旧有「提交到公共题库」（没有被误伤）')
      : bad('自建库的「提交到公共题库」不见了 —— 误伤')
    fs.writeFileSync(path.join(SHOT_DIR, 'bank-menu-mine.png'), Buffer.from((await cdp(ws, 'Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  }
  // ⑤ 卡片上的「可从公共题库更新」提示（2026-09-25 新增）
  const hints = await evalJs(ws, `(() => {
    const cards = [...document.querySelectorAll('.card')]
    const pick = n => { const c = cards.find(x => x.querySelector('h3') && x.querySelector('h3').textContent.includes(n)); const h = c && c.querySelector('.pub-sync-hint'); return h ? h.textContent.replace(/\\s+/g, ' ').trim() : null }
    return { imported: pick('导入副本测试库'), mine: pick('自建测试库') }
  })()`)
  console.log(`\n— 卡片更新提示：导入副本「${hints.imported || '(无)'}」／自建库「${hints.mine || '(无)'}」`)
  hints.imported && hints.imported.includes('公共题库') ? ok('导入副本卡片上有「可从公共题库更新」提示') : bad('导入副本卡片上没有更新提示')
  hints.mine === null ? ok('自建库没有这条提示（没被误伤）') : bad(`自建库也挂了提示：${hints.mine}`)
  // 点一下：本档案没有公共库列表 ⇒ sourceOf 解析不到来源 ⇒ 应当走「找不到对应的公共题库」兜底（不弹 confirm）
  await evalJs(ws, `(() => { window.__toasts = []; window.addEventListener('app-toast', e => window.__toasts.push(e.detail && e.detail.message)); return 1 })()`)
  await evalJs(ws, `(() => { const c = [...document.querySelectorAll('.card')].find(x => x.querySelector('h3').textContent.includes('导入副本测试库')); c.querySelector('.pub-sync-hint').click(); return 1 })()`)
  await sleep(400)
  const toasts = await evalJs(ws, `window.__toasts`)
  console.log(`   点提示后的 toast：${JSON.stringify(toasts)}`)
  toasts.some(t => String(t).includes('找不到对应的公共题库'))
    ? ok('点击已接到更新流程，源解析不到时如实兜底')
    : bad(`点提示后没有兜底 toast（拿到 ${JSON.stringify(toasts)}）`)

  // ⑥ 学习计划入口：没有计划时也必须有（2026-09-25 修的就是这个）
  const planCards = await evalJs(ws, `[...document.querySelectorAll('.study-plan-card')].map(x => x.textContent.replace(/\\s+/g, ' ').trim())`)
  console.log(`\n— 学习计划卡（本档案没有计划）：${planCards.length ? planCards.join(' | ') : '(无)'}`)
  planCards.length ? ok(`没计划时也有创建入口：「${planCards[0]}」`) : bad('没计划时首页没有任何学习计划入口 —— 就是「手机端没有按钮」')
  await evalJs(ws, `(() => { const c = document.querySelector('.study-plan-card'); if (c) c.click(); return 1 })()`)
  await sleep(600)
  const hash = await evalJs(ws, `location.hash`)
  hash.includes('study-plan') ? ok(`点入口跳到「${hash}」`) : bad(`点入口没跳到学习计划页（hash=${hash}）`)
  fs.writeFileSync(path.join(SHOT_DIR, 'home-plan-entry.png'), Buffer.from((await cdp(ws, 'Page.captureScreenshot', { format: 'png' })).data, 'base64'))

  console.log(`\n截图：${path.join(SHOT_DIR, 'bank-menu-imported.png')} / ${path.join(SHOT_DIR, 'bank-menu-mine.png')} / ${path.join(SHOT_DIR, 'home-plan-entry.png')}`)
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
