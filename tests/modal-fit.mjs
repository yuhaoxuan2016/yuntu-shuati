// 弹窗「放不下」探针（2026-09-25）：手机视口下，弹窗面板必须完整落在可视区内，底部按钮必须够得着。
//
// 背景（rabbit 的截图）：移动端 `100vh` 是**最大视口**（地址栏收起时的高度），比眼前能看见的区域高；
// 用 vh 定高 + 垂直居中的弹窗，会把底部按钮推到屏幕外，而遮罩自己不滚 ⇒ 按钮**彻底够不着**。
//
// 为什么用「故障注入」：无头模拟里 `vh` 恒等于 `innerHeight`（没有地址栏这回事），真实那种
// 「vh > 可视高」的错配**在模拟环境里天然复现不出来**。所以这里把面板高度强行放大到 200vh
// 来制造同一个几何后果，再断言「遮罩能不能滚到底、按钮能不能点到」——这才是能证伪的判据。
//
// 用法: node tests/modal-fit.mjs [--url http://localhost:1420/#/settings] [--shot 输出.png]
// 退出码: 0 = 全绿；1 = 有失败（附截图）
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const argOf = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const URL_ = argOf('--url', 'http://localhost:1420/#/settings')
const SHOT = argOf('--shot', path.join(process.env.TEMP || '/tmp', 'modal-fit.png'))
const PORT = Number(argOf('--port', '9334'))

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p))
if (!EDGE) { console.error('找不到 Edge'); process.exit(2) }

// 手机档：320×568（最窄在售）/ 360×640（安卓常见 + 应用内浏览器被工具条吃掉高度）/ 390×844
const SIZES = [[320, 568], [360, 640], [390, 844]]

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

// 在弹窗里量一圈几何：面板/头部/正文/底部各自的位置，以及「提交按钮点得到吗」
const MEASURE_JS = `(() => {
  const R = el => { const r = el.getBoundingClientRect(); return { top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), h: +r.height.toFixed(1), left: +r.left.toFixed(1), right: +r.right.toFixed(1) } }
  const dlg = document.querySelector('.feedback-dialog')
  const bd = document.querySelector('.modal-backdrop')
  const body = document.querySelector('.feedback-dialog .modal-body')
  const foot = document.querySelector('.feedback-dialog .modal-foot')
  const submit = document.querySelector('.feedback-dialog button.btn-primary')
  if (!dlg || !bd || !body || !foot || !submit) return { missing: true }
  const sr = submit.getBoundingClientRect()
  const hit = document.elementFromPoint(Math.round(sr.left + sr.width / 2), Math.round(sr.top + sr.height / 2))
  const lastField = Array.from(body.querySelectorAll('.field')).pop()
  const btns = Array.from(foot.querySelectorAll('button'))
  const lastBtn = btns[btns.length - 1]
  // 行为判定「遮罩到底能不能滚」：scrollHeight>clientHeight 只说明内容溢出，
  // overflow:visible 的元素照样报溢出却一格都滚不动（2026-09-25 踩过：据此报过假绿）。
  const keep = bd.scrollTop
  bd.scrollTop = 99999
  const canReallyScroll = bd.scrollTop > 0
  bd.scrollTop = keep
  return {
    vw: window.innerWidth, vh: window.innerHeight,
    dlg: R(dlg), body: R(body), foot: R(foot), submit: R(submit), bdRect: R(bd),
    lastBtn: lastBtn ? R(lastBtn) : null, lastBtnText: lastBtn ? lastBtn.textContent.trim() : '',
    bdCanScrollReal: canReallyScroll,
    bodyScroll: { sh: body.scrollHeight, ch: body.clientHeight, canScroll: body.scrollHeight > body.clientHeight + 2 },
    bdScroll: { sh: bd.scrollHeight, ch: bd.clientHeight, top: bd.scrollTop },
    submitHittable: hit === submit || submit.contains(hit),
    hitTag: hit ? (hit.tagName + '.' + String(hit.className || '').split(' ')[0]) : 'null',
    lastFieldBottom: lastField ? +lastField.getBoundingClientRect().bottom.toFixed(1) : null,
    // 横向：面板必须在视口内，正文不许横向溢出（2026-09-25 第一次跑漏了这条，截图里才看出输入框被切在右边）
    hOverflow: {
      docScrollW: document.documentElement.scrollWidth,
      bodyScrollW: body.scrollWidth, bodyClientW: body.clientWidth,
      dlgScrollW: dlg.scrollWidth,
      widest: (() => {
        let w = null
        for (const el of body.querySelectorAll('*')) {
          const r = el.getBoundingClientRect()
          if (!w || r.right > w.right) w = { right: +r.right.toFixed(1), sel: el.tagName.toLowerCase() + '.' + String(el.className || '').split(' ')[0] }
        }
        return w
      })(),
    },
    // 谁比谁宽：面板／正文／底栏的实测宽度与关键计算样式（排「正文比面板还宽」这类怪事用）
    dbg: {
      dlgW: +dlg.getBoundingClientRect().width.toFixed(1), dlgClient: dlg.clientWidth, dlgPad: getComputedStyle(dlg).padding,
      bodyW: +body.getBoundingClientRect().width.toFixed(1), bodyClient: body.clientWidth,
      bodyPad: getComputedStyle(body).padding, bodyCssW: getComputedStyle(body).width, bodyMinW: getComputedStyle(body).minWidth, bodyBox: getComputedStyle(body).boxSizing,
      footW: +foot.getBoundingClientRect().width.toFixed(1),
      bdPad: getComputedStyle(bd).padding, bdClient: bd.clientWidth,
    },
  }
})()`

let failed = 0
const bad = m => { console.log('   ✗ ' + m); failed++ }
const ok = m => console.log('   ✓ ' + m)

const userDataDir = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'edge-modal-'))
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
  await cdp(ws, 'Page.enable')
  await cdp(ws, 'Runtime.enable')

  await cdp(ws, 'Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await cdp(ws, 'Page.navigate', { url: URL_ })

  // 等设置页渲染出反馈入口（别用固定 sleep —— 那会量到空页面还报绿）
  let ready = false
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(400)
    ready = await evalJs(ws, `[...document.querySelectorAll('span')].some(s => s.textContent.includes('点此提交问题或建议'))`)
  }
  if (!ready) {
    const digest = await evalJs(ws, `document.body.innerText.slice(0, 160).replace(/\\n/g, ' | ')`)
    throw new Error('等不到设置页的反馈入口。页面文字：' + digest)
  }
  console.log('设置页已就绪，点击「点此提交问题或建议」打开弹窗')
  await evalJs(ws, `[...document.querySelectorAll('span')].find(s => s.textContent.includes('点此提交问题或建议')).click()`)
  let opened = false
  for (let i = 0; i < 20 && !opened; i++) { await sleep(200); opened = await evalJs(ws, `!!document.querySelector('.feedback-dialog')`) }
  if (!opened) throw new Error('弹窗没打开（.feedback-dialog 不存在）——本次探针什么都没测到，判失败')

  // ===== 一、常规档：面板必须完整落在视口里、底部按钮够得着 =====
  for (const [w, h] of SIZES) {
    await cdp(ws, 'Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true })
    await sleep(350)
    const m = await evalJs(ws, MEASURE_JS)
    console.log(`\n— 视口 ${w}×${h}`)
    if (m.missing) { bad('弹窗结构缺元素，未测到'); continue }
    console.log(`   面板 ${m.dlg.top}~${m.dlg.bottom}（视口高 ${m.vh}）· 正文 ${m.body.h}px（可滚=${m.bodyScroll.canScroll}）· 底栏 ${m.foot.top}~${m.foot.bottom}`)
    console.log(`   宽度：面板 ${m.dbg.dlgW}(client ${m.dbg.dlgClient}, pad ${m.dbg.dlgPad}) ／ 正文 ${m.dbg.bodyW}(client ${m.dbg.bodyClient}, css ${m.dbg.bodyCssW}, pad ${m.dbg.bodyPad}, minW ${m.dbg.bodyMinW}, box ${m.dbg.bodyBox}) ／ 底栏 ${m.dbg.footW} ／ 遮罩 client ${m.dbg.bdClient} pad ${m.dbg.bdPad}`)
    m.dlg.top >= -0.5 ? ok('面板顶部没被切掉') : bad(`面板顶部越界 ${m.dlg.top}px`)
    m.dlg.bottom <= m.vh + 0.5 ? ok('面板底部在视口内') : bad(`面板底部越界 ${(m.dlg.bottom - m.vh).toFixed(1)}px`)
    m.foot.bottom <= m.dlg.bottom + 0.5 ? ok('底栏在面板内') : bad('底栏超出面板')
    m.foot.top >= m.body.bottom - 0.5 ? ok('底栏与正文不重叠') : bad(`底栏压住正文 ${(m.body.bottom - m.foot.top).toFixed(1)}px`)
    m.submit.bottom <= m.vh + 0.5 && m.submit.top >= 0 ? ok('提交按钮完整在视口内') : bad('提交按钮不在视口内')
    m.dlg.left >= -0.5 && m.dlg.right <= m.vw + 0.5
      ? ok(`面板横向在视口内（${m.dlg.left}~${m.dlg.right}，视口宽 ${m.vw}）`)
      : bad(`面板横向越界（${m.dlg.left}~${m.dlg.right}，视口宽 ${m.vw}）`)
    m.hOverflow.bodyScrollW <= m.hOverflow.bodyClientW + 1
      ? ok(`正文自身无横向溢出（${m.hOverflow.bodyScrollW} / ${m.hOverflow.bodyClientW}）`)
      : bad(`正文自身横向溢出 ${m.hOverflow.bodyScrollW - m.hOverflow.bodyClientW}px`)
    // 真正的判据：正文不许比面板宽、面板内最宽的元素不许伸出面板右沿
    // （2026-09-25 第一次写的判据是「正文 vs 正文自己」，恒真 —— 假绿；截图里才看出被切在右边）
    m.dbg.bodyW <= m.dbg.dlgW + 0.5
      ? ok(`正文没比面板宽（${m.dbg.bodyW} ≤ ${m.dbg.dlgW}）`)
      : bad(`正文比面板宽 ${(m.dbg.bodyW - m.dbg.dlgW).toFixed(1)}px（正文 ${m.dbg.bodyW} vs 面板 ${m.dbg.dlgW}，padding ${m.dbg.bodyPad} / ${m.dbg.bodyBox}）`)
    m.hOverflow.widest && m.hOverflow.widest.right <= m.dlg.right + 0.5
      ? ok(`面板内最宽元素没越出右沿（${m.hOverflow.widest ? m.hOverflow.widest.sel + ' 右沿 ' + m.hOverflow.widest.right : '-'} ≤ ${m.dlg.right}）`)
      : bad(`面板内有元素越出右沿：${m.hOverflow.widest && m.hOverflow.widest.sel} 右沿 ${m.hOverflow.widest && m.hOverflow.widest.right} > 面板 ${m.dlg.right}`)
    m.lastBtn && m.lastBtn.bottom <= m.vh + 0.5 && m.lastBtn.top >= 0
      ? ok(`底栏末位按钮「${m.lastBtnText}」完整在视口内`)
      : bad(`底栏末位按钮「${m.lastBtnText}」不在视口内（${m.lastBtn ? m.lastBtn.top + '~' + m.lastBtn.bottom : '缺失'}）`)
    m.submitHittable ? ok(`提交按钮可点到（命中 ${m.hitTag}）`) : bad(`提交按钮被遮挡（命中 ${m.hitTag}）`)
    // 正文内容高于可视区时，必须能滚到底看到最后一个字段
    if (m.bodyScroll.canScroll) {
      await evalJs(ws, `(() => { const b = document.querySelector('.feedback-dialog .modal-body'); b.scrollTop = b.scrollHeight; return b.scrollTop })()`)
      await sleep(200)
      const m2 = await evalJs(ws, MEASURE_JS)
      m2.lastFieldBottom <= m2.body.bottom + 0.5 ? ok('正文可滚到底（最后一个字段能看到）') : bad(`滚到底仍有内容看不到（末字段底 ${m2.lastFieldBottom} vs 正文底 ${m2.body.bottom}）`)
    } else {
      ok('正文不需要滚动')
    }
  }

  // ===== 二、故障注入：把「可视区」压小，模拟真实手机上 vh 高于可视区的那段错配 =====
  // 手法：面板仍按 vh 定高（90vh），但把遮罩高度压到 700px —— 真实手机上是「遮罩=屏幕可视区，
  // 而 vh 按地址栏收起后的高度算」。判据是**几何可达性**：按钮必须落在遮罩（=可视区）之内，
  // 或者遮罩能滚到它。模拟环境里 vh 恒等于 innerHeight，这是唯一能造出该错配的办法。
  await cdp(ws, 'Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await sleep(300)
  await evalJs(ws, `(() => { const s = document.createElement('style'); s.id = 'inject-short'; s.textContent = '.modal-backdrop{height:640px !important}'; document.head.appendChild(s); return 1 })()`)
  await sleep(300)
  console.log('\n— 故障注入：遮罩（=手机上真正看得见的那块）只有 640px，面板仍按 vh 算')
  const f1 = await evalJs(ws, MEASURE_JS)
  if (f1.missing) bad('注入后弹窗结构缺元素')
  else {
    console.log(`   面板 ${f1.dlg.top}~${f1.dlg.bottom}（可视区 ${f1.bdRect.top}~${f1.bdRect.bottom}，vh=${f1.vh}）`)
    console.log(`   底栏 ${f1.foot.top}~${f1.foot.bottom} · 末位按钮「${f1.lastBtnText}」${f1.lastBtn.top}~${f1.lastBtn.bottom} · 遮罩真能滚=${f1.bdCanScrollReal}`)
    f1.dlg.bottom > f1.bdRect.bottom + 0.5 ? ok('注入生效：面板越过了可视区下沿') : bad('注入没生效，本节未测到真东西')
    f1.lastBtn.bottom > f1.bdRect.bottom + 0.5
      ? ok(`未滚动时「${f1.lastBtnText}」在可视区外 ${(f1.lastBtn.bottom - f1.bdRect.bottom).toFixed(1)}px（= 用户截图里被切掉的那一排）`)
      : bad('按钮本来就在可视区内，本节没有区分度')
    f1.bdCanScrollReal ? ok('遮罩自身真能滚动（够得着的前提）') : bad('遮罩滚不动 ⇒ 底部按钮永远够不着')
    // 滚到遮罩底部，再验按钮进没进可视区
    await evalJs(ws, `(() => { const b = document.querySelector('.modal-backdrop'); b.scrollTop = b.scrollHeight; return b.scrollTop })()`)
    await sleep(250)
    const f2 = await evalJs(ws, MEASURE_JS)
    console.log(`   滚动后：遮罩 scrollTop=${f2.bdScroll.top}，末位按钮 ${f2.lastBtn.top}~${f2.lastBtn.bottom}`)
    f2.lastBtn.bottom <= f2.bdRect.bottom + 0.5 && f2.lastBtn.top >= f2.bdRect.top - 0.5
      ? ok('滚到底后末位按钮完整落在可视区内 ⇒ 够得着')
      : bad(`滚到底按钮仍在可视区外（按钮底 ${f2.lastBtn.bottom} vs 可视区底 ${f2.bdRect.bottom}）`)
  }
  const fshot = SHOT.replace(/\.png$/, '-tall.png')
  fs.writeFileSync(fshot, Buffer.from((await cdp(ws, 'Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  console.log(`   注入态截图：${fshot}`)
  await evalJs(ws, `(() => { const s = document.getElementById('inject-short'); if (s) s.remove(); const b = document.querySelector('.modal-backdrop'); if (b) b.scrollTop = 0; return 1 })()`)

  // ===== 三、常态截图（肉眼复核） =====
  await sleep(250)
  fs.writeFileSync(SHOT, Buffer.from((await cdp(ws, 'Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  console.log(`\n常态截图：${SHOT}`)
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
