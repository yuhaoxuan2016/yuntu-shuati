// 练习页存档链边界守卫（2026-10-03）：把「进度停写」事故的两个已知形态钉成回归断言。
//
// 背景：rabbit 实况——「普通练习」做完单选、进多选段后，练习进度（已答 N / 红绿块的数据源）
// 从某一笔起**一笔都没再写**（错题/已掌握线却活着）；且练到整库末尾后进度会被**故意清零**
// （"完成即清零"），"完成记录"永远同步不出去。沙盒复现表明边界/体积非确定性凶手，
// 故这里守两件**确定性可断言**的事：
//   ① 沿「单选尾 → 多选头」逐题作答时，每一步进度都必须落盘（saved_at 前进、状态数 +1）；
//   ② 练到整库末尾「完成」后，进度**不得被清空**——必须留痕为 finished:true（可同步的完成记录）。
//
// 用法: node tests/practice-save-boundary.mjs [--url http://localhost:1420/]
// 前置: 目标站点在跑（`npm run dev` 或 `npm run preview` 起的 dist）。
// 退出码: 0 = 全绿；1 = 断言失败；2 = 环境问题。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const argOf = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const URL_ = argOf('--url', 'http://localhost:1420/')
const PORT = Number(argOf('--port', '9348'))
const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p))
if (!EDGE) { console.error('找不到 Edge'); process.exit(2) }
const PROFILE = path.join(os.tmpdir(), 'practice-save-boundary-' + Date.now())

function makeFixture () {
  const lines = []
  for (let i = 1; i <= 800; i++) lines.push(`${i}、【单选题】单选中继题 ${i}（  ）。`, 'A、甲', 'B、乙', '答案：A', '')
  for (let i = 801; i <= 806; i++) lines.push(`${i}、【多选题】多选边界题 ${i}（  ）。`, 'A、甲', 'B、乙', 'C、丙', '答案：AB', '')
  return lines.join('\n')
}

async function PAGE_FLOW (fixtureText) {
  const log = []
  const fails = []
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  async function until (fn, name, timeout = 60000) {
    const t0 = Date.now()
    for (;;) {
      try { const v = fn(); if (v) return v } catch (e) {}
      if (Date.now() - t0 > timeout) throw new Error('等待超时: ' + name)
      await sleep(250)
    }
  }
  const DB = 'shuati-bao-pwa'
  const openDB = () => new Promise((res, rej) => { const r = indexedDB.open(DB); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
  const idbGet = async (store, key) => { const db = await openDB(); return new Promise((res, rej) => { const g = db.transaction(store, 'readonly').objectStore(store).get(key); g.onsuccess = () => res(g.result); g.onerror = () => rej(g.error) }) }
  const idbAll = async (store) => { const db = await openDB(); return new Promise((res, rej) => { const g = db.transaction(store, 'readonly').objectStore(store).getAll(); g.onsuccess = () => res(g.result); g.onerror = () => rej(g.error) }) }
  const idbPut = async (store, val) => { const db = await openDB(); return new Promise((res, rej) => { const t = db.transaction(store, 'readwrite'); t.objectStore(store).put(val); t.oncomplete = () => res(true); t.onerror = () => rej(t.error) }) }
  const btn = (t) => [...document.querySelectorAll('button')].find(b => b.textContent.includes(t))
  const check = (cond, msg) => { (cond ? log.push('✓ ' + msg) : (fails.push('✗ ' + msg), log.push('✗ ' + msg))) }
  const snapshots = []
  try {
    // ① 建库 + 导入（800 单选 + 6 多选）
    await until(() => document.querySelector('.new-bank-btn, .empty-action'), '首页')
    ;(document.querySelector('.new-bank-btn') || document.querySelector('.empty-action')).click()
    const inp = await until(() => document.querySelector('input[placeholder*="题库名称"]'), '名称输入框')
    const setV = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setV.call(inp, '存档边界守卫')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    await sleep(150)
    btn('确定').click()
    await until(() => location.hash.startsWith('#/import/'), '导入页')
    const bankId = location.hash.split('/')[2]
    const file = new File([fixtureText], 'demo.md', { type: 'text/markdown' })
    const dt = new DataTransfer(); dt.items.add(file)
    const target = await until(() => document.querySelector('.import'), '导入页容器')
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
    const confirmBtn = await until(() => btn('确认导入'), '确认导入按钮', 90000)
    confirmBtn.click()
    await until(() => document.body.innerText.includes('导入成功'), '导入完成', 120000)
    btn('开始刷题').click()
    await until(() => location.hash.startsWith('#/practice/'), '进练习页')
    await until(() => document.querySelectorAll('.qcard .options .option').length >= 2, '题目卡')

    const qs = (await idbAll('questions')).sort((a, b) => Number(a.id) - Number(b.id))
    const ids = qs.map(q => Number(q.id))
    log.push(`题目总数=${qs.length} 多选=${qs.filter(q => q.type === 'multi').length}`)
    if (ids.length !== 806) throw new Error('题目数不对: ' + ids.length)

    // ② 先正常答一题以创建进度键，离开页面（等卸载自动保存落完）再种入 795 题的中途进度
    await sleep(600)
    document.querySelector('.qcard .options .option').click()
    await sleep(300)
    { const c = btn('确认答案'); if (c) c.click() }
    await sleep(400)
    const nb = btn('下一题'); if (nb) nb.click()
    await sleep(1000)
    const allSettings = await idbAll('settings')
    const pk = allSettings.map(s => s.key).find(k => k.startsWith('practice_progress_'))
    if (!pk) throw new Error('没找到 practice_progress 键')
    log.push('进度键=' + pk)
    location.hash = '#/'
    await sleep(1200)
    const states = {}
    for (let i = 0; i < 795; i++) states[String(ids[i])] = { selected: [0], blank: '', judge: null, submitted: true, isCorrect: true, selfEvalDone: true }
    const seedStr = JSON.stringify({ mode: 'order', order_ids: ids, current_id: ids[795], answer_states: states, finished: false, saved_at: new Date().toISOString() })
    await idbPut('settings', { key: pk, value: seedStr })
    log.push(`种子进度: current=${ids[795]} states=795 载荷=${(seedStr.length / 1024).toFixed(1)}KB`)
    location.hash = '#/practice/' + bankId
    await until(() => document.querySelectorAll('.qcard .options .option').length >= 2, '恢复后的题目卡')
    await sleep(1200)

    const read = async (label) => {
      const row = await idbGet('settings', pk)
      const p = row ? JSON.parse(row.value || '{}') : {}
      const snap = { label, current_id: p.current_id, nStates: Object.keys(p.answer_states || {}).length, finished: p.finished === true, saved_at: String(p.saved_at || '').slice(11, 23), len: row ? row.value.length : 0 }
      snapshots.push(snap)
      return snap
    }
    const cur = () => { const el = document.querySelector('.qcard .q-idx'); return el ? el.textContent.trim() : location.hash }

    // ③ 沿边界逐题作答：3 道单选 → 4 道多选，每一步都必须落盘（① 号断言）
    const answerSingle = async () => {
      await until(() => document.querySelectorAll('.qcard .options .option').length >= 2, '单选卡')
      document.querySelector('.qcard .options .option').click()
      await sleep(300)
      { const c = btn('确认答案'); if (!c) throw new Error('单选无确认答案按钮 pos=' + cur()); c.click() }
      await sleep(500)
      const b = btn('下一题'); if (!b) throw new Error('单选后无下一题按钮 pos=' + cur())
      b.click(); await sleep(900)
    }
    const answerMulti = async () => {
      await until(() => document.querySelectorAll('.qcard .options .option').length >= 2, '多选卡')
      const opts = [...document.querySelectorAll('.qcard .options .option')]
      opts[0].click(); await sleep(200); opts[1].click(); await sleep(300)
      const c = btn('确认答案'); if (!c) throw new Error('多选无确认答案按钮 pos=' + cur())
      c.click(); await sleep(500)
      const b = btn('下一题'); if (!b) throw new Error('多选后无下一题按钮 pos=' + cur())
      b.click(); await sleep(900)
    }
    let s0 = await read('恢复后')
    check(s0.current_id === ids[795] && s0.nStates === 795, `恢复位：current=${s0.current_id} states=${s0.nStates}`)
    let prev = s0
    const stepCheck = (snap, msg) => {
      check(snap && snap.nStates === prev.nStates + 1 && snap.saved_at !== prev.saved_at, msg + `（${prev.nStates}→${snap && snap.nStates}，${prev.saved_at}→${snap && snap.saved_at}）`)
      if (snap) prev = snap
    }
    for (let i = 0; i < 3; i++) { await answerSingle(); stepCheck(await read('单选' + i + '后'), '单选第 ' + (i + 1) + ' 步落盘') }
    for (let i = 0; i < 4; i++) { await answerMulti(); stepCheck(await read('多选' + i + '后'), '多选第 ' + (i + 1) + ' 步落盘') }

    // ④ 一路做到整库末尾（② 号断言：完成不留痕为 finished，绝不清空）
    //    注意：未答题只有「确认答案」没有「下一题」，必须先答再跳（初版守卫在这里误 break 过）。
    for (let i = 0; i < 14; i++) {
      if (btn('确认答案')) { await answerMulti(); await read('尾声' + i); continue }
      const nxt = btn('下一题')
      if (nxt) { nxt.click(); await sleep(1200); continue }
      break
    }
    await sleep(800)
    const fin = await read('完成后')
    check(fin && fin.finished === true, `完成后进度保留且 finished=true（len=${fin && fin.len}）`)
    check(fin && fin.nStates === 806, `完成后状态数=806（实得 ${fin && fin.nStates}）`)
    return { ok: fails.length === 0, fails, log, snapshots }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), fails, log, snapshots, tail: document.body ? document.body.innerText.slice(0, 300) : '' }
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
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); const list = await r.json(); page = list.find(t => t.type === 'page'); if (page) break } catch (e) {}
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
    expression: `(${PAGE_FLOW.toString()})(${JSON.stringify(makeFixture())})`,
    awaitPromise: true, returnByValue: true,
  })
  const result = ev.result && ev.result.value
  console.log('== 练习页存档链边界守卫 ==')
  if (result && result.log) for (const l of result.log) console.log('  ' + l)
  if (result && result.snapshots) console.log('  快照: ' + JSON.stringify(result.snapshots))
  if (result && result.fails && result.fails.length) console.log('  失败项: ' + JSON.stringify(result.fails))
  if (result && result.error) console.log('  异常: ' + result.error)
  if (result && result.tail) console.log('  页面摘录: ' + result.tail.replace(/\n/g, ' '))
  cleanup()
  if (!result) process.exit(2)
  if (result.ok) { console.log('\n✅ 全绿：边界步步落盘 + 完成留痕'); process.exit(0) }
  console.error('\n✗ 未通过')
  process.exit(1)
}
main().catch(e => { console.error('异常:', e.message); process.exit(2) })
