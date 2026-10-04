// 冒烟（2026-10-03）：错题本「错次降序 + 只看顽固」在真实渲染里的行为。
// 单测只能证纯函数；这里在无头 Edge 里往 IndexedDB 造 5 条错题（次数 5/4/3/2/1），
// 断言：① 列表按次数降序 ② 次数标签与顽固红标 ③ 「只看顽固」筛选进/出 ④ 无页面异常。
// 用法: 先起 `npm run preview`（默认 http://localhost:4173），然后 node tests/wrong-order-ui.mjs
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const BASE = process.env.SMOKE_URL || 'http://localhost:4173'
const PORT = Number(process.env.SMOKE_PORT || '9446')

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p))
if (!EDGE) { console.error('找不到 Edge'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
let failed = 0
const bad = m => { console.log('   ✗ ' + m); failed++ }
const ok = m => console.log('   ✓ ' + m)
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : bad(`${m}｜实得 ${JSON.stringify(a)} 期望 ${JSON.stringify(b)}`))

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

const SEED_JS = `(async () => {
  const openDb = () => new Promise((res, rej) => { const r = indexedDB.open('shuati-bao-pwa'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
  let db = null
  for (let i = 0; i < 20 && !db; i++) {
    try { db = await openDb() } catch { await new Promise(r => setTimeout(r, 300)) }
    // 库存在但还没有对象仓库（版本 0）时再等一次
    if (db && !db.objectStoreNames.contains('wrong_questions')) { db.close(); db = null; await new Promise(r => setTimeout(r, 300)) }
  }
  if (!db) throw new Error('DB 未就绪')
  const counts = { 101: 1, 102: 5, 103: 3, 104: 2, 105: 4 }
  const names = { 101: 'Q-一错', 102: 'Q-五连错', 103: 'Q-三连错', 104: 'Q-二错', 105: 'Q-四连错' }
  await new Promise((res, rej) => {
    const tx = db.transaction(['questions', 'wrong_questions'], 'readwrite')
    tx.oncomplete = res; tx.onerror = () => rej(tx.error)
    const qs = tx.objectStore('questions'), ws = tx.objectStore('wrong_questions')
    for (const id of [101, 102, 103, 104, 105]) {
      qs.put({ id, bank_id: 1, stem: names[id], type: 'single', options: JSON.stringify(['A', 'B']), answer: 'A' })
      ws.add({ bank_id: 1, question_id: id, total_wrong: counts[id], correct_streak: 0, created_at: '2026-10-03T00:00:00.000Z' })
    }
  })
  db.close()
  return 'seeded'
})()`

const READ_JS = `(() => {
  const items = Array.from(document.querySelectorAll('.wrong-list .wrong-item'))
  return {
    previews: items.map(e => (e.querySelector('.item-preview') || {}).textContent?.trim()),
    tags: items.map(e => { const t = e.querySelector('.wrong-count-tag'); return t ? t.textContent.replace('🔁', '').trim() : null }),
    stubbornFlags: items.map(e => !!e.querySelector('.wrong-count-tag.stubborn')),
    filterBtn: (document.querySelector('.stubborn-row button') || {}).textContent?.trim(),
    statWrong: (document.querySelector('.wrong-stats .stat-value') || {}).textContent?.trim(),
    empty: !!document.querySelector('.empty'),
  }
})()`

const userDataDir = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'edge-wrong-'))
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`,
  '--window-size=500,900', 'about:blank',
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
  const page = targets.find(t => t.type === 'page')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
  const consoleErrors = []
  ws.addEventListener('message', ev => {
    let msg
    try { msg = JSON.parse(ev.data) } catch { return }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
      consoleErrors.push((msg.params.args || []).map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200))
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push('EXCEPTION: ' + String(msg.params?.exceptionDetails?.exception?.description || '').slice(0, 200))
    }
  })
  await cdp(ws, 'Page.enable')
  await cdp(ws, 'Runtime.enable')
  await cdp(ws, 'Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })

  await cdp(ws, 'Page.navigate', { url: BASE + '/#/' })
  await sleep(2500)
  const seeded = await evalJs(ws, SEED_JS)
  ok('造数：' + seeded)

  await evalJs(ws, `location.hash = '#/wrong/1'`)
  await sleep(900)

  console.log('== ① 排序与标签 ==')
  const r1 = await evalJs(ws, READ_JS)
  eq(r1.previews, ['Q-五连错', 'Q-四连错', 'Q-三连错', 'Q-二错', 'Q-一错'], '列表按错次降序')
  eq(r1.tags, ['做错 5 次', '做错 4 次', '做错 3 次', '做错 2 次', '做错 1 次'], '每条都显示次数（含错 1 次）')
  eq(r1.stubbornFlags, [true, true, true, false, false], '≥3 次挂顽固红标')
  eq(r1.statWrong, '5', '错题数=5')
  eq(r1.filterBtn, '🔥 只看顽固（3）', '筛选按钮显示顽固数')

  console.log('== ② 只看顽固 ==')
  await evalJs(ws, `document.querySelector('.stubborn-row button').click()`)
  await sleep(400)
  const r2 = await evalJs(ws, READ_JS)
  eq(r2.previews, ['Q-五连错', 'Q-四连错', 'Q-三连错'], '筛选后只剩 ≥3 次的三道（仍降序）')
  eq(r2.statWrong, '3', '筛选后统计联动')
  eq(r2.filterBtn, '✓ 只看顽固 · 再点取消', '按钮进入选中态')

  console.log('== ③ 取消筛选 ==')
  await evalJs(ws, `document.querySelector('.stubborn-row button').click()`)
  await sleep(400)
  const r3 = await evalJs(ws, READ_JS)
  eq(r3.previews.length, 5, '取消后回到全部 5 条')

  const shot = await cdp(ws, 'Page.captureScreenshot', { format: 'png' })
  const shotPath = path.join(process.env.TEMP || '/tmp', 'wrong-order-ui.png')
  fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))
  console.log('截图: ' + shotPath)

  console.log('== ④ 页面异常 ==')
  eq(consoleErrors, [], '无 console.error / 未捕获异常')
} catch (e) {
  bad('探针执行失败：' + (e && e.message))
} finally {
  try { ws && ws.close() } catch {}
  try { edge.kill() } catch {}
}

console.log(failed ? `\n✗ ${failed} 项失败` : '\n全绿')
process.exit(failed ? 1 : 0)
