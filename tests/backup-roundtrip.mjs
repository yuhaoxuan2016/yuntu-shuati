// 本地备份「导出 → 导入恢复」端到端探针（2026-10-05）
// 验的是真实链路：走设置页按钮导出 → 造数据 → 走设置页 input 导入 → 验恢复结果。
// 有头 Edge（默认），独立端口 + 独立 user-data-dir。
//
// 断言：
//   A. 导出：点「立即备份」能产生下载，文件是合法 JSON、含预期集合
//   B. 导出文件不含 AI 凭据（ai_api_key / ai_base_url / ai_base_url_ack）
//   C. 导入：能读回文件、覆盖式恢复（删掉的数据回来了）
//   D. 导入后 AI 凭据仍是本机值（未被文件覆盖）
//
// 用法: node tests/backup-roundtrip.mjs [--url http://127.0.0.1:4173/]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const argOf = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const URL_ = argOf('--url', 'http://127.0.0.1:4173/')
const PORT = Number(argOf('--port', '9351'))

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p))
if (!EDGE) { console.error('找不到 Edge'); process.exit(2) }

const WORK = path.join(os.tmpdir(), 'bk-probe-' + Date.now())
const PROFILE = path.join(WORK, 'profile')
const DL = path.join(WORK, 'downloads')
fs.mkdirSync(DL, { recursive: true })

const FIXTURE = [
  '1、【单选题】备份验收题一：SF6 设备室风口应设在（ ）。',
  'A、上部', 'B、中部', 'C、底部', 'D、顶部', '答案：C',
  '',
  '2、【单选题】备份验收题二：工作票应记录在平台的（ ）中。',
  'A、其他站内记录登记', 'B、站内例行工作登记', 'C、维护检修管理', '答案：A',
].join('\n')

const sleep = ms => new Promise(r => setTimeout(r, ms))

// 页面内：进设置页 → 导出 / 导入，并把结果挂到 window 供外部读
async function SETUP_FLOW (fixtureText) {
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
  const setV = (el, v) => {
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  try {
    // 建库 + 导题
    await until(() => document.querySelector('.new-bank-btn, .empty-action'), '首页')
    ;(document.querySelector('.new-bank-btn') || document.querySelector('.empty-action')).click()
    const inp = await until(() => document.querySelector('input[placeholder*="题库名称"]'), '名称框')
    setV(inp, '备份验收库')
    await sleep(150)
    ;[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '确定').click()
    await until(() => location.hash.startsWith('#/import/'), '导入页')
    const file = new File([fixtureText], 'demo.md', { type: 'text/markdown' })
    const dt = new DataTransfer(); dt.items.add(file)
    const t = await until(() => document.querySelector('.import'), '导入容器')
    t.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
    const cf = await until(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('确认导入')), '确认导入', 45000)
    cf.click()
    await until(() => document.body.innerText.includes('导入成功'), '导入完成', 45000)
    log.push('题库与题目已就绪')

    // 写一条「AI 凭据」到本机，供稍后验「未被备份覆盖」
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('shuati-bao-pwa')
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
    })
    const markKey = 'ai_api_key'
    await new Promise((res, rej) => {
      const tx = db.transaction('settings', 'readwrite')
      tx.objectStore('settings').put({ key: markKey, value: 'LOCAL-SECRET-DO-NOT-SYNC' })
      tx.objectStore('settings').put({ key: 'ai_base_url', value: 'https://api.deepseek.com/v1' })
      // 同时塞一条**非敏感**设置，让导出的 settings 非空（否则验不到 settings 的覆盖语义）
      tx.objectStore('settings').put({ key: 'theme', value: 'feiyu' })
      tx.objectStore('settings').put({ key: 'daily_records', value: '{"2026-10-05":3}' })
      tx.oncomplete = res; tx.onerror = () => rej(tx.error)
    })
    // 立刻读回确认写进去了（否则后面的观测全建立在空 settings 上）
    const verify = await new Promise((res) => {
      const tx = db.transaction('settings', 'readonly')
      const q = tx.objectStore('settings').getAll()
      q.onsuccess = () => res(q.result.map(r => r.key))
      q.onerror = () => res(['__ERR__'])
    })
    log.push('settings 写入后 key 列表: ' + JSON.stringify(verify))

    // 进设置页
    location.hash = '#/settings'
    await until(() => document.body.innerText.includes('立即备份'), '设置页')
    await sleep(800)
    log.push('设置页就绪')

    window.__readSetting = async (k) => {
      const d = await new Promise((res, rej) => {
        const r = indexedDB.open('shuati-bao-pwa')
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
      })
      return await new Promise((res) => {
        const tx = d.transaction('settings', 'readonly')
        const q = tx.objectStore('settings').get(k)
        q.onsuccess = () => res(q.result ? q.result.value : null)
        q.onerror = () => res('__ERR__')
      })
    }
    window.__countBanks = async () => {
      const d = await new Promise((res, rej) => {
        const r = indexedDB.open('shuati-bao-pwa')
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
      })
      return await new Promise((res) => {
        const tx = d.transaction('quiz_banks', 'readonly')
        const q = tx.objectStore('quiz_banks').count()
        q.onsuccess = () => res(q.result); q.onerror = () => res(-1)
      })
    }
    window.__clickBackup = () => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('立即备份'))
      if (!b) return false
      b.click(); return true
    }
    return { ok: true, log }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), log, tail: document.body ? document.body.innerText.slice(0, 300) : '' }
  }
}

async function main () {
  const child = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check',
    '--remote-allow-origins=*', '--window-size=900,1200',
    '--no-proxy-server', '--proxy-bypass-list=*',
    'about:blank',
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
  if (!page) { cleanup(); throw new Error('CDP 没就绪') }

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws 连不上')) })
  let seq = 0
  const pend = new Map()
  let loadResolve = null
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return }
    if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {})
    if (m.method === 'Page.loadEventFired' && loadResolve) { loadResolve(); loadResolve = null }
  }
  function send (method, params = {}) {
    return new Promise((res, rej) => {
      const id = ++seq
      pend.set(id, m => m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result))
      ws.send(JSON.stringify({ id, method, params }))
    })
  }
  const evalIn = (expr, awaitPromise = false) =>
    send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true })
      .then(r => r.result && r.result.value)
  function cleanup () {
    try { ws.close() } catch (e) {}
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch (e) {}
    try { fs.rmSync(WORK, { recursive: true, force: true }) } catch (e) {}
  }

  await send('Page.enable')
  await send('Runtime.enable')
  // 允许下载到指定目录并读到路径
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL }).catch(() => {})
  await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL }).catch(() => {})

  const loaded = new Promise(res => { loadResolve = res })
  await send('Page.navigate', { url: URL_ })
  await Promise.race([loaded, sleep(15000)])
  await sleep(1500)

  const setup = await evalIn(`(${SETUP_FLOW.toString()})(${JSON.stringify(FIXTURE)})`, true)
  console.log('== 本地备份 导出→导入 验收 ==')
  console.log('准备:', JSON.stringify(setup))
  if (!setup || !setup.ok) { cleanup(); process.exit(2) }

  const failures = []
  const beforeBanks = await evalIn('window.__countBanks()', true)
  console.log('\n导出前：题库数 =', beforeBanks)

  // ===== A. 点「立即备份」→ 产生下载文件 =====
  console.log('\n--- A. 导出 ---')
  // 诊断：先直接问一次 db 层拿到的 settings（绕过 UI 与 filterBackupSettings）
  const rawSettings = await evalIn(`(async () => {
    const db = await new Promise((res,rej)=>{const r=indexedDB.open('shuati-bao-pwa');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})
    return await new Promise(res=>{const tx=db.transaction('settings','readonly');const q=tx.objectStore('settings').getAll();q.onsuccess=()=>res(q.result.map(r=>r.key));q.onerror=()=>res(['__ERR__'])})
  })()`, true)
  console.log('导出前 IndexedDB 里的 settings keys:', JSON.stringify(rawSettings))
  const clicked = await evalIn('window.__clickBackup()')
  console.log('点击「立即备份」:', clicked)
  let files = []
  for (let i = 0; i < 40; i++) {
    files = fs.readdirSync(DL).filter(f => f.endsWith('.json'))
    if (files.length) break
    await sleep(500)
  }
  console.log('下载目录文件:', files)
  if (!files.length) { failures.push('A: 点备份后没有产生 .json 下载文件') }
  let exported = null
  if (files.length) {
    const p = path.join(DL, files[0])
    await sleep(500)
    try {
      exported = JSON.parse(fs.readFileSync(p, 'utf8'))
      console.log('文件名:', files[0])
      console.log('顶层键:', Object.keys(exported).join(', '))
      console.log('各集合条数:', Object.entries(exported).filter(([k, v]) => Array.isArray(v)).map(([k, v]) => `${k}=${v.length}`).join(' '))
    } catch (e) { failures.push('A: 导出的 JSON 解析失败 ' + e.message) }
  }

  // ===== B. 导出文件不得含 AI 凭据 =====
  console.log('\n--- B. 凭据不外泄 ---')
  if (exported) {
    const s = JSON.stringify(exported)
    const leaked = ['ai_api_key', 'ai_base_url_ack'].filter(k => s.includes(k))
    // settings 导出形态是**对象** {key: value}
    const st = exported.settings
    const stKeys = st && typeof st === 'object' && !Array.isArray(st) ? Object.keys(st) : []
    console.log('备份 settings 形态:', Array.isArray(st) ? '数组' : typeof st, '| key:', stKeys.join(', ') || '(空)')
    console.log('整文件含 ai_api_key/ai_base_url_ack:', leaked.length ? leaked.join(',') : '否')
    if (stKeys.some(k => ['ai_api_key', 'ai_base_url', 'ai_base_url_ack'].includes(k))) {
      failures.push('B: 备份 settings 里含敏感键 ' + stKeys.join(','))
    }
    if (s.includes('LOCAL-SECRET-DO-NOT-SYNC')) failures.push('B: 本机密钥字面量出现在备份文件里！')
    else console.log('本机密钥字面量未出现在备份文件 ✅')
    // 普通设置必须被导出（否则谈不上恢复）
    const missing = ['theme', 'daily_records'].filter(k => !stKeys.includes(k))
    if (missing.length) failures.push('B: 备份漏掉了普通设置 ' + missing.join(','))
    else console.log('普通设置 theme/daily_records 已写入备份 ✅')
  }

  // ===== C. 导入覆盖恢复（模拟换设备：题库与普通设置全清，只留 AI 凭据）=====
  console.log('\n--- C. 导入恢复（换设备场景）---')
  const delInfo = await evalIn(`(async () => {
    const db = await new Promise((res,rej)=>{const r=indexedDB.open('shuati-bao-pwa');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})
    const names = ['quiz_banks','questions']
    for (const n of names) { await new Promise(res=>{const tx=db.transaction(n,'readwrite');tx.objectStore(n).clear();tx.oncomplete=res;tx.onerror=res}) }
    // 模拟新设备：把「普通设置」也清掉，只保留 ai_api_key（真实设备上密钥本就只存本机）
    const keep = ['ai_api_key','ai_base_url']
    await new Promise(res=>{
      const tx=db.transaction('settings','readwrite'); const os=tx.objectStore('settings')
      const all = os.getAll()
      all.onsuccess = () => { for (const r of all.result) if (!keep.includes(r.key)) os.delete(r.key) }
      tx.oncomplete=res; tx.onerror=res
    })
    const c = await new Promise(res=>{const tx=db.transaction('quiz_banks','readonly');const q=tx.objectStore('quiz_banks').count();q.onsuccess=()=>res(q.result);q.onerror=()=>res(-1)})
    const st = await new Promise(res=>{const tx=db.transaction('settings','readonly');const q=tx.objectStore('settings').getAll();q.onsuccess=()=>res(q.result.map(r=>r.key));q.onerror=()=>res(['__ERR__'])})
    return { banks: c, settings: st }
  })()`, true)
  console.log('清空后：题库数 =', delInfo && delInfo.banks, '| settings keys =', JSON.stringify(delInfo && delInfo.settings))
  if (delInfo && delInfo.banks !== 0) failures.push('C: 前置清空失败（题库数 ' + delInfo.banks + '）')
  const stCleared = delInfo && Array.isArray(delInfo.settings) && !delInfo.settings.includes('theme')
  if (!stCleared) failures.push('C: 前置未清掉 theme（新设备模拟不成立），当前 ' + JSON.stringify(delInfo && delInfo.settings))

  // 用 DataTransfer 往 <input type=file> 塞备份文件（走真实 change 流程）
  const imported = await evalIn(`(async () => {
    const txt = ${JSON.stringify(exported ? JSON.stringify(exported) : '')}
    const inp = document.querySelector('input[type=file][accept*="json"]')
    if (!inp) return 'no-input'
    const f = new File([txt], 'backup.json', { type: 'application/json' })
    const dt = new DataTransfer(); dt.items.add(f)
    inp.files = dt.files
    inp.dispatchEvent(new Event('change', { bubbles: true }))
    return 'dispatched'
  })()`, true)
  console.log('触发导入:', imported)
  await sleep(3500)
  // 读恢复状态文案
  const statusText = await evalIn(`(() => {
    const t = document.body.innerText
    const m = t.match(/(恢复成功|恢复失败[^\\n]*|已取消恢复|正在恢复[^\\n]*)/)
    return m ? m[0] : '(未捕获状态文案)'
  })()`)
  console.log('恢复状态文案:', statusText)

  const afterBanks = await evalIn('window.__countBanks()', true)
  const afterQs = await evalIn(`(async () => {
    const d = await new Promise((res,rej)=>{const r=indexedDB.open('shuati-bao-pwa');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})
    return await new Promise(res=>{const tx=d.transaction('questions','readonly');const q=tx.objectStore('questions').count();q.onsuccess=()=>res(q.result);q.onerror=()=>res(-1)})
  })()`, true)
  console.log('恢复后：题库数 =', afterBanks, '| 题目数 =', afterQs)
  if (afterBanks !== beforeBanks) failures.push(`C: 恢复后题库数 ${afterBanks} ≠ 导出前 ${beforeBanks}`)
  if (!(afterQs >= 2)) failures.push(`C: 恢复后题目数 ${afterQs} 异常（期望 ≥2）`)
  if (/恢复失败/.test(statusText)) failures.push('C: 页面报了恢复失败：' + statusText)

  // 关键：设置必须也回来了（这是本次修的 bug）
  const themeAfter = await evalIn('window.__readSetting("theme")', true)
  const dailyAfter = await evalIn('window.__readSetting("daily_records")', true)
  console.log('恢复后 theme =', JSON.stringify(themeAfter), '| daily_records =', JSON.stringify(dailyAfter))
  if (themeAfter !== 'feiyu') failures.push(`C: 设置没恢复 —— theme 期望 "feiyu"，实际 ${JSON.stringify(themeAfter)}（就是那个 settings 被静默跳过的 bug）`)
  if (dailyAfter == null) failures.push('C: 设置没恢复 —— daily_records 为空')

  // ===== D. 本机 AI 凭据未被文件覆盖（备份里本就无凭据，这里再验一次双保险）=====
  console.log('\n--- D. 本机凭据保留 ---')
  const keyAfter = await evalIn('window.__readSetting("ai_api_key")', true)
  const urlAfter = await evalIn('window.__readSetting("ai_base_url")', true)
  console.log('恢复后 ai_api_key =', JSON.stringify(keyAfter))
  console.log('恢复后 ai_base_url =', JSON.stringify(urlAfter))
  if (keyAfter !== 'LOCAL-SECRET-DO-NOT-SYNC') failures.push('D: 恢复后本机 ai_api_key 被改动/丢失（当前 ' + JSON.stringify(keyAfter) + '）')
  // 再验一次「恶意备份」场景：文件里塞入伪造的凭据，不得覆盖本机
  await evalIn(`(async () => {
    const evil = { app:'shuati-bao-pwa', version:2, banks:[], questions:[],
      settings:{ ai_api_key:'EVIL-KEY', ai_base_url:'https://attacker.example', theme:'evil-theme' } }
    const inp = document.querySelector('input[type=file][accept*="json"]')
    const f = new File([JSON.stringify(evil)], 'evil.json', { type:'application/json' })
    const dt = new DataTransfer(); dt.items.add(f)
    inp.files = dt.files
    inp.dispatchEvent(new Event('change', { bubbles: true }))
    return 'dispatched'
  })()`, true)
  await sleep(3500)
  const keyAfterEvil = await evalIn('window.__readSetting("ai_api_key")', true)
  const urlAfterEvil = await evalIn('window.__readSetting("ai_base_url")', true)
  const themeAfterEvil = await evalIn('window.__readSetting("theme")', true)
  console.log('导入「恶意备份」后：ai_api_key =', JSON.stringify(keyAfterEvil), '| ai_base_url =', JSON.stringify(urlAfterEvil), '| theme =', JSON.stringify(themeAfterEvil))
  if (keyAfterEvil !== 'LOCAL-SECRET-DO-NOT-SYNC') failures.push('D: 恶意备份覆盖了本机 ai_api_key（' + JSON.stringify(keyAfterEvil) + '）')
  if (urlAfterEvil !== 'https://api.deepseek.com/v1') failures.push('D: 恶意备份覆盖了本机 ai_base_url（' + JSON.stringify(urlAfterEvil) + '）')
  if (themeAfterEvil !== 'evil-theme') console.log('  ℹ️ 普通设置 theme 被恶意备份改写为', JSON.stringify(themeAfterEvil), '（这是覆盖式恢复的预期行为）')
  else console.log('  ℹ️ 普通设置 theme 已被恶意备份改写（预期：普通设置本就随备份走）')
  if (keyAfterEvil === 'LOCAL-SECRET-DO-NOT-SYNC' && urlAfterEvil === 'https://api.deepseek.com/v1') console.log('恶意备份的凭据被拒绝 ✅')

  // ===== E. settings 合并语义：本机独有设置不被清空 =====
  console.log('\n--- E. settings 合并语义（本机独有键保留）---')
  await evalIn(`(async () => {
    const db = await new Promise((res,rej)=>{const r=indexedDB.open('shuati-bao-pwa');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})
    await new Promise(res=>{const tx=db.transaction('settings','readwrite');tx.objectStore('settings').put({key:'__probe_local_only',value:'KEEP-ME'});tx.oncomplete=res;tx.onerror=res})
    return 'written'
  })()`, true)
  // 二次导入（备份里不含 __probe_local_only）
  await evalIn(`(async () => {
    const txt = ${JSON.stringify(exported ? JSON.stringify(exported) : '')}
    const inp = document.querySelector('input[type=file][accept*="json"]')
    if (!inp) return 'no-input'
    const f = new File([txt], 'backup2.json', { type: 'application/json' })
    const dt = new DataTransfer(); dt.items.add(f)
    inp.files = dt.files
    inp.dispatchEvent(new Event('change', { bubbles: true }))
    return 'dispatched'
  })()`, true)
  await sleep(3500)
  const localOnlyAfter = await evalIn('window.__readSetting("__probe_local_only")', true)
  console.log('二次导入（备份不含该键）后 __probe_local_only =', JSON.stringify(localOnlyAfter))
  if (localOnlyAfter !== 'KEEP-ME') failures.push('E: 本机独有设置被清空（期望 KEEP-ME，实际 ' + JSON.stringify(localOnlyAfter) + '）——合并语义失效')
  else console.log('本机独有设置被保留 ✅（合并而非覆盖）')

  cleanup()
  console.log('')
  if (!failures.length) {
    console.log('✅ 通过：导出可用 · 不含凭据 · 导入覆盖恢复成功 · 本机凭据未被覆盖')
    process.exit(0)
  }
  console.log('✗ 失败：')
  failures.forEach(f => console.log('   · ' + f))
  process.exit(1)
}

main().catch(e => { console.error('环境错误:', e.message); process.exit(2) })
