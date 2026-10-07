// 「以云端为准恢复进度」无效 + 同步自锁死循环 —— 守卫（2026-10-08 立）
//
// rabbit 报：「因为我直接从云端恢复，是无效的，进度还是1，已做0题」
//
// 查实两块（都由 2026-10-07 引入同步互斥的 cd00ee8 带来）：
//   ① P0 自锁死循环：`maybeAutoSyncOnOpen` 持着 `auto-pull` 锁，函数体内第 1344 行又调
//      会**再抢同一把锁**的 `syncFromCloud()` ⇒ 拿回来的是**自己的 promise** ⇒ 等自己
//      ⇒ 锁永不释放 ⇒ 此后该页面会话里**所有同步全部失效**（三行改法见组①）。
//      触发条件：距上次自动拉取 ≥10 分钟（或当天首次打开）+ 开着自动同步（已绑定账号默认开）。
//   ② P1 恢复按钮：`runExclusive` 第 46 行「谁在跑就把谁的 promise 交出去，标签都不看」
//      ⇒ 恢复依赖的「清完本机键之后**我自己**拉一遍」被打破 —— 清键与拉取之间被别人插队，
//      或干脆复用了一个**早已读完本地数据**的轮次 ⇒ 界面弹「已按云端版本恢复进度」但什么都没恢复。
//
// 跑法：node tests/sync-restore.test.cjs
const fs = require('fs')
const path = require('path')

async function main () {
  const esbuild = (() => {
    for (const c of ['esbuild', path.resolve(__dirname, '../node_modules/esbuild')]) {
      try { const m = require(c); m.transformSync('const a: number = 1; export {};', { loader: 'ts' }); return m } catch {}
    }
    console.error('❌ 没有可用的 esbuild'); process.exit(2)
  })()
  const ROOT = path.resolve(__dirname, '..')
  let pass = 0, fail = 0
  const ok = (n, c, extra = '') => { if (c) { pass++; console.log('✓', n) } else { fail++; console.log('✗', n, extra) } }
  const wait = (ms) => new Promise(r => setTimeout(r, ms))

  const cloudSrc = fs.readFileSync(path.join(ROOT, 'src/lib/cloud.ts'), 'utf8').replace(/\r\n/g, '\n')
  const mutexSrc = fs.readFileSync(path.join(ROOT, 'src/lib/sync-mutex.ts'), 'utf8').replace(/\r\n/g, '\n')
  const idsSrc = fs.readFileSync(path.join(ROOT, 'src/lib/sync-ids.ts'), 'utf8').replace(/\r\n/g, '\n')
  const settingsSrc = fs.readFileSync(path.join(ROOT, 'src/views/SettingsView.vue'), 'utf8').replace(/\r\n/g, '\n')

  // 取顶层函数体：从声明行到下一个顶格 `}`。比手写大括号配对稳（本仓顶层函数都顶格收尾）。
  const bodyOf = (src, name) => {
    const re = new RegExp('^(?:export )?(?:async )?function ' + name + '\\b', 'm')
    const m = re.exec(src)
    if (!m) return null
    const end = src.indexOf('\n}', m.index)
    return end < 0 ? null : src.slice(m.index, end + 2)
  }
  // 静态断言前先去掉注释：注释里**提到**某个函数名是正常的散文，
  // 不该被「不得出现 X」这类断言误伤（不这么做就只能把注释写得扭曲）。
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

  // 每次拿一份**全新的**锁状态（模块有单例状态，测试间会互相污染）
  const freshMutex = () => {
    const js = esbuild.transformSync(mutexSrc, { loader: 'ts', format: 'cjs' }).code
    const mod = { exports: {} }
    new Function('module', 'exports', js)(mod, mod.exports)
    return mod.exports
  }
  const freshIds = () => {
    const js = esbuild.transformSync(idsSrc, { loader: 'ts', format: 'cjs' }).code
    const mod = { exports: {} }
    new Function('module', 'exports', 'require', js)(mod, mod.exports, require)
    return mod.exports
  }

  // ══════════ ① 持锁函数体内不得再抢同一把锁（静态，钉住三行改法） ══════════
  console.log('── ① 持锁函数体内不得再调会抢锁的导出版本 ──')
  {
    const autoBody = stripComments(bodyOf(cloudSrc, 'maybeAutoSyncOnOpenInner') || '')
    const allBody = stripComments(bodyOf(cloudSrc, 'syncAllInner') || '')
    const recoverBody = stripComments(bodyOf(cloudSrc, 'consumeRecoverPendingPull') || '')

    ok('❗两个函数体都取到了（切片器可用）', !!autoBody && !!allBody && !!recoverBody)

    ok('❗auto-pull：持锁的体里改成调内层 syncFromCloudInner()',
      !!autoBody && /await syncFromCloudInner\(\)/.test(autoBody))
    ok('❗auto-pull：体里**不再**出现会抢锁的 await syncFromCloud()',
      !!autoBody && !/await syncFromCloud\(\)/.test(autoBody))

    ok('❗syncAll：拉取改成调内层',
      !!allBody && /await syncFromCloudInner\(\)/.test(allBody) && !/await syncFromCloud\(\)/.test(allBody))
    ok('❗syncAll：推送也改成调内层',
      !!allBody && /await pushToCloudInner\(\)/.test(allBody) && !/await pushToCloud\(\)/.test(allBody))

    // 反向对照：不持锁的 consumeRecoverPendingPull **必须**保留调用导出版本 ——
    // 一刀切全改成 Inner 会让它绕开互斥（它本来就该正常抢锁）。
    ok('❗❗反向：不持锁的 consumeRecoverPendingPull 必须仍调导出版本（不能一刀切）',
      !!recoverBody && /await syncFromCloud\(\)/.test(recoverBody) && !/syncFromCloudInner\(\)/.test(recoverBody))

    // 反向对照：被切进去的两个函数**确实**是持锁的（否则上面几条没意义）
    ok('❗反向：这两个函数确实是持锁的（runExclusive 包裹）',
      /runExclusive\('auto-pull', maybeAutoSyncOnOpenInner\)/.test(cloudSrc) &&
      /runExclusive\('syncAll', syncAllInner\)/.test(cloudSrc))
  }

  // ══════════ ② 死锁机制本身（动态：跑真实 sync-mutex.ts） ══════════
  console.log('\n── ② 死锁机制与修好后的形状（真跑）──')
  {
    // 坏结构：持锁 + 前置 await + 体内再抢同一把锁 ⇒ 必须挂死
    {
      const M = freshMutex()
      const bad = M.runExclusive('auto-pull', async () => {
        await wait(1)                                     // ← 复刻 await getAutoSyncEnabled()
        await M.runExclusive('syncFromCloud', async () => 'x')   // ← 1344 行原样
        return 'done'
      })
      const r = await Promise.race([bad.then(() => '完成').catch(() => '抛错'), wait(300).then(() => 'TIMEOUT')])
      ok('❗❗坏结构（持锁里再抢锁）确实会挂死 —— 证明这个坑是真的', r === 'TIMEOUT', `实际 ${r}`)
      ok('❗❗坏结构会把锁永久占住（此后所有同步全废）', M.isSyncBusy() === true)
      const later = await Promise.race([M.runExclusive('progress-light', async () => 'x').then(() => '完成'), wait(200).then(() => 'TIMEOUT')])
      ok('❗❗坏结构之后，轻推也永远拿不到锁', later === 'TIMEOUT', `实际 ${later}`)
    }
    // 好结构：持锁 + 前置 await + 体内直接跑**内层**（不再抢锁）⇒ 必须完成且锁释放
    {
      const M = freshMutex()
      const good = M.runExclusive('auto-pull', async () => {
        await wait(1)
        return '内层直接跑，没抢锁'
      })
      const r = await Promise.race([good.then(() => '完成').catch(() => '抛错'), wait(300).then(() => 'TIMEOUT')])
      ok('❗好结构（持锁里只跑内层）能正常完成', r === '完成', `实际 ${r}`)
      ok('❗好结构跑完释放锁', M.isSyncBusy() === false)
    }
  }

  // ══════════ ③ waitForIdle：等轮空再独占，绝不复用别人的 promise ══════════
  console.log('\n── ③ 恢复要「等轮空」，不能复用别人的结果 ──')
  {
    // 反向对照：不传 opts ⇒ 必须**仍然复用**（5 个既有调用点靠这个行为，不能改坏）
    {
      const M = freshMutex()
      const a = M.runExclusive('progress-light', async () => { await wait(30); return 'A' })
      const b = M.runExclusive('syncFromCloud', async () => 'B')
      ok('❗❗反向：不传 opts 时仍然是复用（既有 5 个调用点的行为不变）', a === b)
      await a
    }
    // 传 waitForIdle ⇒ 必须**不是**同一个 promise，且要等到 A 结束后才跑
    {
      const M = freshMutex()
      let order = []
      const a = M.runExclusive('progress-light', async () => { await wait(60); order.push('A'); return 'A' })
      const b = M.runExclusive('syncFromCloud', async () => { order.push('B'); return 'B' }, { waitForIdle: true })
      ok('❗传 waitForIdle 时不再复用别人的 promise', a !== b)
      const rb = await Promise.race([b.then(v => v).catch(() => '抛错'), wait(500).then(() => 'TIMEOUT')])
      ok('❗等轮空后自己的那一轮真的跑了', rb === 'B', `实际 ${rb}`)
      ok('❗顺序正确：先别人那轮结束，再自己跑', order.join(',') === 'A,B', `实际 ${order.join(',')}`)
      ok('❗跑完释放锁', M.isSyncBusy() === false)
    }
    // 等不到（超时）⇒ 必须**如实抛错**，绝不复用、绝不静默
    {
      const M = freshMutex()
      const a = M.runExclusive('syncAll', async () => { await wait(300); return 'A' })
      let threw = false
      try { await M.runExclusive('restore', async () => 'R', { waitForIdle: true, waitMaxMs: 50 }) }
      catch { threw = true }
      ok('❗等超时必须抛错（不复用别人的结果、不静默）', threw)
      const ra = await a
      ok('❗抛错不影响在飞的那一轮', ra === 'A')
    }
  }

  // ══════════ ④ 恢复话术：rebuilt=0 就不许说「已恢复」 ══════════
  console.log('\n── ④ 恢复话术必须与事实挂钩 ──')
  {
    const { restoreOutcomeText } = freshIds()
    ok('❗纯判据 restoreOutcomeText 已导出（可直测）', typeof restoreOutcomeText === 'function')
    if (typeof restoreOutcomeText === 'function') {
      const a = restoreOutcomeText(3, 2)
      ok('❗真恢复了 ⇒ 说恢复，且带上数量', a.kind === 'ok' && /恢复/.test(a.text) && /2/.test(a.text), JSON.stringify(a))
      const b = restoreOutcomeText(3, 0)
      ok('❗❗清空了但云端没得恢复 ⇒ **不许**说「已按云端版本恢复进度」',
        b.kind === 'info' && !/已按云端版本恢复/.test(b.text), JSON.stringify(b))
      const c = restoreOutcomeText(0, 0)
      ok('❗❗本机云端都空 ⇒ 也不许说「已恢复」',
        c.kind === 'info' && !/已按云端版本恢复/.test(c.text), JSON.stringify(c))
      // 反向对照：三支必须互不相同（别写成恒返回一句）
      ok('❗反向：三种结果文案互不相同', new Set([a.text, b.text, c.text]).size === 3)
    }
  }

  // ══════════ ⑤ 清键与拉取必须是**一把锁内的原子动作** ══════════
  console.log('\n── ⑤ 清键与拉取不得被别人插队 ──')
  {
    ok('❗cloud.ts 导出 restoreProgressFromCloud', /export async function restoreProgressFromCloud \(/.test(cloudSrc) ||
      /export function restoreProgressFromCloud \(/.test(cloudSrc))
    const rb = stripComments(bodyOf(cloudSrc, 'restoreProgressFromCloud') || '')
    ok('❗该函数体取到了', !!rb)
    if (rb) {
      ok('❗它把「清键 + 拉取」包在**同一个** runExclusive 里',
        /runExclusive\(/.test(rb) && /syncFromCloudInner\(\)/.test(rb))
      ok('❗清键用的是 practice_progress_ 前缀（与练习页读的那个键一致）',
        /'practice_progress_'/.test(rb))
      ok('❗返回 rebuilt（拉完之后**数出来**的本机非空进度键个数），不是猜的',
        /rebuilt/.test(rb))
      // 反向对照：绝不能去动无后缀的打包键（那是「所有库的打包 map」，语义不同）
      ok('❗❗反向：不碰无后缀的 practice_progress（那是打包 map，不是单库进度）',
        !/setSetting\('practice_progress'/.test(rb))
    }
    // 视图层：改成调新 API，不再自己清键、不再直接调 syncFromCloud
    const viewBody = bodyOf(settingsSrc, 'doRestoreFromCloud')
    ok('❗设置页函数体取到了', !!viewBody)
    if (viewBody) {
      const code = stripComments(viewBody)   // 只断言**代码**，不含注释散文
      ok('❗视图改调 restoreProgressFromCloud()', /restoreProgressFromCloud\(\)/.test(code))
      ok('❗视图不再自己清键（逻辑已搬进 lib）', !/setSetting\(k, ''\)/.test(code))
      ok('❗视图不再直接调 syncFromCloud()', !/\bsyncFromCloud\(\)/.test(code))
      ok('❗视图话术走 restoreOutcomeText，不再写死那句旧文案',
        /restoreOutcomeText\(/.test(code) && !/已按云端版本恢复进度/.test(code))
      // 反向对照：新 API 的返回值必须被真的用上（别调了却把 cleared/rebuilt 丢掉）
      ok('❗❗反向：cleared 与 rebuilt 都传进了话术判据（不是调了不用）',
        /restoreOutcomeText\([^)]*cleared[^)]*rebuilt/.test(code))
    }
  }

  console.log(`\n${pass} 通过 / ${fail} 失败`)
  process.exit(fail ? 1 : 0)
}
main()
