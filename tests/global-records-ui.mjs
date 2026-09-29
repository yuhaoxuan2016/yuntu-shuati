// 跨库聚合的**真浏览器**验收（2026-09-29）。
//
// 为什么不能只靠离线断言：`records-aggregate.test.cjs` 证的是纯函数；
// 而「聚合页到底渲不渲染、单库入口会不会被改坏、学习计划选库列表到底有没有订阅库」
// 是 Vue 渲染 + IndexedDB + 路由三件事的接缝，只有真浏览器说了算（本仓一贯口径）。
//
// 全程只碰 localhost 与**只读**的云端公共题库，不写你的云数据、不需要登录。
// 写法注意：本文件一律用 if/else 断言 —— 行首以 `/` 或 `(` 开头的续行会被 ASI 当成运算符
// （这个坑本仓已栽四次）。
//
// 用法: node tests/global-records-ui.mjs      （需要先 `npm run build`）
// 退出码: 0 = 全绿；1 = 有失败
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(HERE, '../dist')
const PORT = Number(process.env.PROBE_PORT || 8351)
const CDP_PORT = Number(process.env.PROBE_CDP || 9351)
const BASE = `http://127.0.0.1:${PORT}/`
const sleep = ms => new Promise(r => setTimeout(r, ms))
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }

if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error('✗ 没有 dist/index.html，先 npm run build'); process.exit(2) }

// 用云端**真实存在**的订阅库与题号（_local_id），保证「订阅库题目从云端取」这一条是真走通
const PUB_REF = 'lquiz_banks_16'        // 中级2026
const PUB_QIDS = [501777, 501776]
const LOCAL_BANK = { id: 6, name: '测试本地库', question_count: 2 }
const LOCAL_QIDS = [1, 2]

let failed = 0
const ok = m => console.log('   ✓ ' + m)
const bad = m => { console.log('   ✗ ' + m); failed++ }
const check = (cond, passMsg, failMsg) => { if (cond) ok(passMsg); else bad(failMsg) }

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0])
  const f = path.join(DIST, url === '/' ? 'index.html' : url.replace(/^\/+/, ''))
  if (!f.startsWith(DIST)) { res.writeHead(403).end(); return }
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404).end('nf'); return }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' })
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
      if (msg.error) reject(new Error(method + ': ' + JSON.stringify(msg.error)))
      else resolve(msg.result)
    }
    ws.addEventListener('message', onMsg)
    ws.send(JSON.stringify({ id, method, params }))
  })
}
async function evalJs (ws, expression) {
  const r = await cdp(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error('页面脚本抛错：' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails))
  return r.result.value
}

const SEED = `(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('shuati-bao-pwa'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
  const put = (store, val) => new Promise((res, rej) => {
    const t = db.transaction(store, 'readwrite'); const s = t.objectStore(store)
    const q = (val && val.id !== undefined) ? s.put(val) : s.add(val)
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error)
  })
  const clear = (store) => new Promise((res) => { const t = db.transaction(store, 'readwrite'); t.objectStore(store).clear(); t.oncomplete = () => res() })
  for (const s of ['settings', 'quiz_banks', 'questions', 'wrong_questions', 'favorites', 'mastered_questions']) await clear(s)
  await put('settings', { key: 'subscriptions', value: JSON.stringify(['${PUB_REF}']) })
  await put('quiz_banks', { id: ${LOCAL_BANK.id}, name: '${LOCAL_BANK.name}', description: null, visibility: 'private', question_count: ${LOCAL_BANK.question_count}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
  for (const id of ${JSON.stringify(LOCAL_QIDS)}) await put('questions', { id, bank_id: ${LOCAL_BANK.id}, stem: '本地题干 ' + id, type: 'single', options: ['A','B'], answer: 'A' })
  const iso = (d) => new Date(d).toISOString()
  await put('wrong_questions', { bank_id: '${PUB_REF}', question_id: ${PUB_QIDS[0]}, created_at: iso('2026-09-26'), total_wrong: 4, correct_streak: 0 })
  await put('wrong_questions', { bank_id: '${PUB_REF}', question_id: ${PUB_QIDS[1]}, created_at: iso('2026-09-20'), total_wrong: 1, correct_streak: 1 })
  await put('wrong_questions', { bank_id: ${LOCAL_BANK.id}, question_id: ${LOCAL_QIDS[0]}, created_at: iso('2026-09-28'), total_wrong: 2, correct_streak: 0 })
  await put('favorites', { bank_id: '${PUB_REF}', question_id: ${PUB_QIDS[0]}, created_at: iso('2026-09-27') })
  await put('favorites', { bank_id: ${LOCAL_BANK.id}, question_id: ${LOCAL_QIDS[1]}, created_at: iso('2026-09-28') })
  db.close(); return 'seeded'
})()`

const PAGE_STATE = `(async () => {
  const txt = document.body.innerText
  const groups = [...document.querySelectorAll('.bank-group')].map(g => ({
    head: (g.querySelector('.group-name') || {}).innerText || '',
    unreachable: !!g.querySelector('.hint'),
    items: [...g.querySelectorAll('li, .fav-item')].map(n => (n.innerText || '').replace(/\\s+/g, ' ').trim()).filter(Boolean),
  }))
  return { url: location.hash, title: (document.querySelector('h2') || {}).innerText || '', groups, mounted: !!document.querySelector('#app > *'), txt }
})()`

const CLICK_CREATE = `(async () => { const b=[...document.querySelectorAll('button')].find(x=>/创建计划/.test(x.textContent||'')); if(b) b.click(); return !!b })()`
const CLICK_FIRST_REMOVE = `(async () => {
  const g = [...document.querySelectorAll('.bank-group')].find(x => /测试本地库/.test(x.innerText))
  const b = g && g.querySelector('.remove-btn'); if (!b) return 'no-btn'; b.click(); return 'clicked'
})()`
const CLEAR_SUBS = `(async () => { const db=await new Promise((res)=>{const r=indexedDB.open('shuati-bao-pwa');r.onsuccess=()=>res(r.result)});
  const t=db.transaction('settings','readwrite'); t.objectStore('settings').put({key:'subscriptions', value:'[]'});
  await new Promise(r=>{t.oncomplete=r}); db.close(); return 'ok' })()`

async function goto (ws, hash) {
  await cdp(ws, 'Page.navigate', { url: BASE + hash })
  let st = null
  for (let i = 0; i < 30; i++) {
    await sleep(500)
    try { st = await evalJs(ws, PAGE_STATE) } catch { continue }
    if (st && st.mounted && st.txt.length > 20) return st
    if (st && st.txt.length > 20) return st
  }
  return st || { groups: [], txt: '', title: '' }
}

async function main () {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r))
  const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p))
  if (!EDGE) throw new Error('找不到 Edge')
  const userDataDir = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'edge-global-'))
  const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${userDataDir}`, '--window-size=900,1200', 'about:blank'], { stdio: 'ignore' })
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
    await cdp(ws, 'Page.enable')
    await cdp(ws, 'Runtime.enable')

    console.log('— 装载 + 灌数据')
    await cdp(ws, 'Page.navigate', { url: BASE })
    await sleep(3500)
    const seeded = await evalJs(ws, SEED)
    check(seeded === 'seeded', 'IndexedDB 已灌：订阅库 2 条错题 + 本地库 1 条错题，收藏各 1 条', '灌数据失败：' + seeded)

    console.log('\n— ⓪ 静态前置：订阅进度必须在「公共库列表回来之后」再算一次')
    // 这条是 rabbit 报的「已订阅卡片缺进度条」的根因守卫：loadSubs() 在 setup 阶段跑，
    // 那时 subscribedBanks（＝publicBanks ∩ subs）还是空的 ⇒ 进度 map 恒为空。
    // 只查行为（⑥）容易被"数据刚好先到"骗过，所以补一条文本守卫看那个调用点在不在。
    {
      const homeSrc = fs.readFileSync(path.resolve(HERE, '../src/views/HomeView.vue'), 'utf8')
      const hasCall = /if \(banks\.status === 'fulfilled'\)[\s\S]{0,900}loadSubsProgress\(\)/.test(homeSrc)
      check(hasCall, 'loadPublicData 里补算了订阅进度（两处都调，谁后完成都能补上）',
        'loadPublicData 里没有 loadSubsProgress() ⇒ 订阅卡进度条会重新变成永远空白')
    }

    console.log('\n— ① 首页两个入口')
    // 灌数据发生在首屏加载之后 ⇒ 必须重新加载一次，入口计数才会读到新库（这是测试的顺序，不是产品行为）
    await evalJs(ws, 'location.reload()')
    await sleep(2500)
    const home = await goto(ws, '#/')
    check(home.txt.includes('错题本') && home.txt.includes('收藏'), '首页全局按钮行下方出现「📕 错题本」「⭐ 收藏」', '首页没有两个入口：' + home.txt.slice(0, 200))
    check(home.txt.includes('错题本 · 3') && home.txt.includes('收藏 · 2'), '入口上的跨库计数对（错题 3 · 收藏 2）',
      `计数不对：${(home.txt.match(/错题本[^\n]*/) || [''])[0]} / ${(home.txt.match(/收藏[^\n]*/) || [''])[0]}`)

    console.log('\n— ② 聚合错题本（/wrong，不带库号）')
    // 读数：先确认记录还在库里（不然是测试顺序问题），再看页面（不然是渲染/取数问题）
    const dump = await evalJs(ws, `(async () => { const db=await new Promise(r=>{const x=indexedDB.open('shuati-bao-pwa');x.onsuccess=()=>r(x.result)});
      const all=(s)=>new Promise(r=>{const t=db.transaction(s,'readonly');const q=t.objectStore(s).getAll();q.onsuccess=()=>r(q.result)});
      const w=await all('wrong_questions'), f=await all('favorites'); db.close()
      return { wrong: w.map(x=>String(x.bank_id)+':'+x.question_id), fav: f.map(x=>String(x.bank_id)+':'+x.question_id) } })()`)
    console.log('   （读数）IndexedDB 错题 =', JSON.stringify(dump.wrong), ' 收藏 =', JSON.stringify(dump.fav))
    const w0 = await goto(ws, '#/wrong')
    console.log('   （读数）页面尾部 =', String(w0.txt).slice(-260).replace(/\n/g, ' ⎯ '))
    // 聚合页要等云端取题完成才有组（订阅库不落本地）⇒ 轮询到出组为止，别拿首帧的空态当结论
    let w = w0
    for (let i = 0; i < 24 && !w.groups.length; i++) { await sleep(600); w = await evalJs(ws, PAGE_STATE) }
    check(w.groups.length === 2, '两组（订阅库 + 本地库）都在',
      `组数 ${w.groups.length}，期望 2：${JSON.stringify(w.groups.map(g => g.head))} ｜页面正文：${String(w.txt).slice(0, 420)}`)
    const sub = w.groups.find(g => g.head.includes('中级2026'))
    const loc = w.groups.find(g => g.head.includes('测试本地库'))
    check(!!sub, '订阅库组出现，名字来自云端公共库列表', '没有订阅库组 ⇒ 聚合漏了订阅库（就是原先那个病）')
    check(!!loc, '本地库组出现', '没有本地库组')
    // 组头「库名 + 数量」不能粘在一起（首版写成 `{{ g.name }} {{ g.count }}`，
    // Vue 模板会裁掉元素边界处的空白 ⇒ 线上渲染成「中级20268」，真机一眼就看出是坏的）
    const heads = w.groups.map(g => g.head)
    const SEP = /·\s*\d+$/
    check(heads.every(h => SEP.test(h)), '组头是「库名 · 数量」，没粘连', `组头粘连：${JSON.stringify(heads)}`)
    check(!!sub && sub.items.length === 2, '订阅库组内 2 道题', `订阅库组内 ${sub ? sub.items.length : '—'} 道`)
    check(!!sub && sub.items.some(t => t.includes('做错 4 次')), '顽固错题徽章（做错 4 次）在聚合态也渲染', '缺做错次数徽章')
    if (sub && sub.items.some(t => /第 501\d{3} 题/.test(t))) {
      bad('订阅库题干没渲染出来（显示成「第 N 题」）⇒ 云端取题或 bankRef 映射有问题')
    } else if (sub && sub.unreachable) {
      bad('订阅库组走了降级（题目取不到），聚合页看不到题干')
    } else if (sub) {
      ok('订阅库的题干从云端取到了（订阅不落本地行这条走通）')
    } else {
      bad('订阅库组不存在，题干断言无从判断（别让它落进 ok 分支）')
    }
    check(w.title.includes('3 题'), '标题总数 3 题', '标题：' + w.title)

    console.log('\n— ③ 组头「只看这个库」＝单库视图没被改坏')
    const one = await goto(ws, '#/wrong/' + PUB_REF)
    check(one.txt.includes('错题重练'), '单库视图仍在（有「错题重练」按钮，聚合分支没抢它的渲染）', '单库视图缺「错题重练」⇒ 回归：' + one.txt.slice(0, 200))
    check(one.txt.includes('按题型筛选'), '单库的题型筛选/统计仍在', '单库筛选区不见了')

    console.log('\n— ④ 聚合收藏（/favorites）+ 行内取消收藏真的写库')
    const f = await goto(ws, '#/favorites')
    check(f.groups.length === 2, '收藏也是两组', `收藏组数 ${f.groups.length}`)
    const before = ((f.groups.find(g => g.head.includes('测试本地库')) || {}).items || []).length
    const clicked = await evalJs(ws, CLICK_FIRST_REMOVE)
    check(clicked === 'clicked', '组内有「×」取消收藏按钮', '找不到取消收藏按钮：' + clicked)
    await sleep(1500)
    const f2 = await goto(ws, '#/favorites')
    const after = ((f2.groups.find(g => g.head.includes('测试本地库')) || {}).items || []).length
    check(after !== before, `取消收藏后该组从 ${before} 条变成 ${after} 条（真的写了 IndexedDB）`, `点了没生效（仍 ${after} 条）`)

    console.log('\n— ⑤ 学习计划：只剩订阅库时也必须有得选（空壳的反证）')
    const p = await goto(ws, '#/study-plan')
    await evalJs(ws, CLICK_CREATE)
    await sleep(1500)
    const p2 = await goto(ws, '#/study-plan')
    check(p2.txt.includes('中级2026'), '选库列表里出现订阅库（原先只有 api.listBanks() ⇒ 列表空 ⇒ 按钮永远点不动）',
      '选库列表仍没有订阅库：' + p2.txt.slice(0, 300))
    check(p2.txt.includes('测试本地库'), '本地库仍在列表里', '本地库从列表里消失了（回归）')
    check(p2.txt.includes('· 订阅'), '订阅库带「· 订阅」标记', '没有订阅标记')

    console.log('\n— ⑥ 订阅卡的进度条（rabbit 报「已订阅卡片缺进度条」）')
    // 先灌一条订阅库的本机进度，再看首页那张卡上有没有进度行（同一份数据本地库卡片是有的）
    await evalJs(ws, `(async () => {
      const db = await new Promise(res => { const r = indexedDB.open('shuati-bao-pwa'); r.onsuccess = () => res(r.result) })
      const t = db.transaction('settings', 'readwrite')
      t.objectStore('settings').put({ key: 'practice_progress_${PUB_REF}', value: JSON.stringify({
        mode: 'order', order_ids: [1,2,3], answer_states: { 1: true, 2: false, 3: true }, saved_at: new Date().toISOString(),
      }) })
      await new Promise(r => { t.oncomplete = r })
      db.close(); return 'seeded'
    })()`)
    await evalJs(ws, 'location.reload()')
    await sleep(3500)
    const home2 = await goto(ws, '#/')
    // 订阅卡来自云端公共库列表（异步）⇒ 轮询等它出现，别拿首帧当结论（上一轮就假红在这）
    let subCard = { found: false }
    for (let i = 0; i < 24; i++) {
      await sleep(500)
      subCard = await evalJs(ws, `(() => {
        const sec = document.querySelector('.subscribed-section'); if (!sec) return { found: false }
        const card = [...sec.querySelectorAll('.card')].find(c => /中级2026/.test(c.innerText))
        if (!card) return { found: false }
        const row = card.querySelector('.progress-row')
        return { found: true, hasBar: !!row, text: row ? row.innerText.replace(/\\s+/g,' ').trim() : '' }
      })()`)
      if (subCard.found) break
    }
    check(subCard.found, '订阅卡片在位（中级2026）', '首页找不到订阅卡：' + JSON.stringify(subCard))
    check(!!subCard.hasBar, '订阅卡上有进度条（已答 3 题，本地库卡片同款）',
      `订阅卡没有进度条 ⇒ rabbit 报的就是这条（卡片文本：${String(home2.txt).slice(0, 120)}）`)
    if (subCard.hasBar) {
      check(/已答\s*3/.test(subCard.text), `进度条文案对（${subCard.text}）`, `进度条文案不对：${subCard.text}`)
    }

    // 反向对照：清空订阅后列表应只剩本地库 ⇒ 证明上面那条命中来自真实数据，不是写死的文案。
    // 必须**整页重载**：#/study-plan → #/study-plan 是同文档跳转，组件不会重新 loadData（上一轮就假红在这）。
    await evalJs(ws, CLEAR_SUBS)
    await evalJs(ws, 'location.reload()')
    await sleep(3000)
    await goto(ws, '#/study-plan')
    await evalJs(ws, CLICK_CREATE)
    await sleep(1500)
    const p3 = await evalJs(ws, PAGE_STATE)
    check(!p3.txt.includes('中级2026') && p3.txt.includes('测试本地库'),
      '反证：清空订阅后列表只剩本地库 ⇒ 命中来自真实数据',
      '反证失败（取消订阅后中级2026 还在列表里）：' + p3.txt.slice(0, 200))

    ws.close()
  } finally {
    edge.kill('SIGTERM')
    await sleep(1200)
    fs.rmSync(userDataDir, { recursive: true, force: true })
    server.close()
  }
  console.log(failed ? `\n有失败：${failed} 项` : '\n全绿')
  process.exit(failed ? 1 : 0)
}
main().catch(e => { console.error('致命：', e?.message || e); process.exit(1) })
