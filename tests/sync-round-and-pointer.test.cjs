// 同步触发链三处加固的守卫（2026-10-07 立）。
//
// rabbit 报：「有的时候是一点进去就开始同步，有的时候是不同步，还有一直转圈的情况。
//   此时点进去，里面也是一直转圈，而且有提示，但实际已经同步上去了」
//
// 三个独立缺陷，各修一处，本测试逐条钉住（都带反向对照）：
//   ① 全量同步推 last_practice 无防倒退闸门 ⇒ 换设备/清缓存后本机 position=1 顶掉云端 466
//   ② 状态写回无代次 ⇒ 后收尾的轮覆盖先收尾的轮 ⇒ 转圈图标被强行改成「已同步」/ 反之
//   ③ 进库横幅用「全局锁 busy」判「正在下载」⇒ 只推不拉的轻推也触发 ⇒ 提示赖着不走
//
// 跑法：node tests/sync-round-and-pointer.test.cjs
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

  const cloudSrc = fs.readFileSync(path.join(ROOT, 'src/lib/cloud.ts'), 'utf8').replace(/\r\n/g, '\n')
  const noticeSrc = fs.readFileSync(path.join(ROOT, 'src/lib/sync-notice.ts'), 'utf8').replace(/\r\n/g, '\n')
  const homeSrc = fs.readFileSync(path.join(ROOT, 'src/views/HomeView.vue'), 'utf8').replace(/\r\n/g, '\n')
  const pracSrc = fs.readFileSync(path.join(ROOT, 'src/views/PracticeView.vue'), 'utf8').replace(/\r\n/g, '\n')

  // 纯判据直接跑（sync-notice 无 IO）
  const noticeJs = esbuild.transformSync(noticeSrc, { loader: 'ts', format: 'cjs' }).code
  const noticeMod = { exports: {} }
  new Function('module', 'exports', noticeJs)(noticeMod, noticeMod.exports)
  const { shouldWarnOnEnter, STALE_PULL_MS } = noticeMod.exports

  const NOW = 1_800_000_000_000

  // ══════════ ① last_practice 防倒退闸门 ══════════
  console.log('── ① 全量同步推 last_practice 必须有防倒退闸门 ──')
  {
    ok('❗轻推链有闸门（原有）',
      /if \(shouldPushLastPractice\(localLp, cloudLp\.value, \{ readFailed: cloudLp\.readFailed \}\)\)/.test(cloudSrc))
    ok('❗全量同步（listAllSettings）也有闸门了',
      /const lpIdx = out\.findIndex\(r => r && r\.key === 'last_practice'\)/.test(cloudSrc) &&
      /if \(!shouldPushLastPractice\(localLp, cloudLp\.value, \{ readFailed: cloudLp\.readFailed \}\)\)/.test(cloudSrc))
    ok('❗闸门不通过时是「把该行摘掉」而不是「整轮不推」',
      /out\.splice\(lpIdx, 1\)/.test(cloudSrc))
    // 反向对照：不是无条件摘行 —— splice 必须**在** `if (!shouldPush...)` 块内。
    // 判法：取 splice 前 260 字符，必须能看到那条否定判据（不猜缩进/括号形状，直接看内容）。
    {
      const sp = cloudSrc.indexOf('out.splice(lpIdx, 1)')
      const before = sp >= 0 ? cloudSrc.slice(Math.max(0, sp - 260), sp) : ''
      ok('❗反向：不是无条件删（splice 必须在「闸门不通过」分支内）',
        sp >= 0 && /if \(!shouldPushLastPractice\(/.test(before))
    }
    // 口径只有一处：纯判据**调用点**恰好 2 处（轻推链 + 全量同步）。
    // 注意 import 是裸标识符、不带 `(`，不会被这个正则计入 —— 所以要**另外**单独钉住 import。
    {
      const calls = cloudSrc.match(/shouldPushLastPractice\(/g) || []
      ok(`❗两条链共用同一个纯函数判据（调用点 ${calls.length} 处，期望 2）`, calls.length === 2, `实际 ${calls.length}`)
      ok('❗判据确实是从 sync-ids 导入的（不是本地又抄了一份）',
        /import \{[^}]*\bshouldPushLastPractice\b[^}]*\} from '\.\/sync-ids'/.test(cloudSrc) &&
        !/function shouldPushLastPractice/.test(cloudSrc))
    }
  }

  // ══════════ ② 状态写回代次 ══════════
  console.log('\n── ② 同步状态写回必须有代次，防跨轮覆盖 ──')
  {
    ok('❗有代次计数器与归属校验',
      /let syncRoundSeq = 0/.test(cloudSrc) && /function beginSyncRound \(\): number/.test(cloudSrc) &&
      /function isMySyncRound \(round: number\): boolean/.test(cloudSrc))
    ok('❗setWebSyncStatus 带可选 round 参数',
      /function setWebSyncStatus \(state: WebSyncState, msg = '', round\?: number\): void/.test(cloudSrc))
    ok('❗代次不符时**丢弃**写入（不是照写）',
      /if \(round !== undefined && !isMySyncRound\(round\)\) \{[\s\S]{0,160}?return\s*\}/.test(cloudSrc))
    // 四条同步链都必须认领代次
    const begins = (cloudSrc.match(/const round = beginSyncRound\(\)/g) || []).length
    ok(`❗四条链都认领了代次（找到 ${begins} 处，期望 ≥4）`, begins >= 4, `实际 ${begins}`)
    // 反向对照：收尾写状态必须带 round（否则代次形同虚设）
    ok('❗syncAll 收尾带 round',
      /if \(cloudState\.error\) setWebSyncStatus\('fail', cloudState\.error, round\)/.test(cloudSrc) &&
      /else setWebSyncStatus\('ok', '', round\)/.test(cloudSrc))
    ok('❗轻推收尾带 round',
      /setWebSyncStatus\('ok', '', round\)/.test(cloudSrc) &&
      /setWebSyncStatus\('fail', '推送未生效（网络或权限）', round\)/.test(cloudSrc))
    // 反向对照：真失败必须永远可见 ⇒ 只有「try/catch 兜底」那一类不带 round。
    // 数字以实读为准，不按链数推：`syncAllInner` **压根没有 try/catch**（返回结果对象、由调用方判定），
    //   所以「4 条链」≠「4 处裸写法」。实读为 3 处裸（consumeRecover + 打开自动拉 + 全量推的 catch）。
    {
      const bare = cloudSrc.match(/setWebSyncStatus\('fail', \(e && e\.message\)/g) || []
      const tokened = cloudSrc.match(/setWebSyncStatus\('fail', \(e && e\.message\) \|\| String\(e\), round\)/g) || []
      ok('❗裸 catch 写法恰好 3 处（实读值，不按链数推）', bare.length === 3, `实际 ${bare.length}`)
      ok('❗反向：轻推链的 catch **带** round（它在本轮内收尾，代次仍有效）', tokened.length === 1, `实际 ${tokened.length}`)
      // 所有 'syncing' 写回都必须带 round —— 认领动作本身不能漏
      const syncingBare = cloudSrc.match(/setWebSyncStatus\('syncing', ''\)/g) || []
      ok('❗反向：没有一处 syncing 漏掉 round', syncingBare.length === 0, `实际 ${syncingBare.length}`)
    }
  }

  // ══════════ ③ 进库横幅用「拉取在飞」而非「全局 busy」 ══════════
  console.log('\n── ③ 进库横幅必须区分「正在下载」与「正在上传」──')
  {
    ok('❗cloud.ts 导出 isPullInFlight（精确信号）',
      /export function isPullInFlight \(\): boolean/.test(cloudSrc))
    ok('❗syncFromCloud 里标记拉取在飞（try 之前 ++）',
      /pullInFlight\+\+/.test(cloudSrc))
    ok('❗finally 里无论如何都复位（抛错也不漏）',
      /finally \{\s*pullInFlight--/.test(cloudSrc))
    ok('❗两个调用方都改成传 pullBusy',
      /pullBusy: isPullInFlight\(\)/.test(pracSrc) && /pullBusy: homePullBusy/.test(homeSrc))
    ok('❗反向：调用方不再传旧的 busy',
      !/busy: st\.state === 'syncing'/.test(pracSrc) && !/busy: st\.state === 'syncing'/.test(homeSrc))
    ok('❗首页每 3 秒轮询里刷新 homePullBusy',
      /homePullBusy = m\.isPullInFlight\(\)/.test(homeSrc))
  }

  // ══════════ ③-b shouldWarnOnEnter 的行为（真跑纯函数）══════════
  console.log('\n── ③-b shouldWarnOnEnter 行为（含反向对照）──')
  {
    // 关键新行为：只推不拉的轻推在跑（busy=true）但没在拉（pullBusy=false）⇒ 不该提示
    ok('❗❗只推不拉（busy 真 / pullBusy 假）⇒ **不提示**',
      shouldWarnOnEnter({ synced: true, lastOkAt: NOW - 5_000, busy: true, pullBusy: false, now: NOW }) === false)
    // 真的在拉 ⇒ 提示
    ok('❗真在拉（pullBusy 真）⇒ 提示',
      shouldWarnOnEnter({ synced: true, lastOkAt: NOW - 5_000, pullBusy: true, now: NOW }) === true)
    // 兼容：不传 pullBusy 时退回旧 busy 口径（既有调用方/测试不受影响）
    ok('❗兼容：不传 pullBusy 时仍按 busy 判（旧口径不变）',
      shouldWarnOnEnter({ synced: true, lastOkAt: NOW - 5_000, busy: true, now: NOW }) === true)
    // 陈旧窗口仍然生效
    ok('❗超过陈旧窗口 ⇒ 提示（与 busy 无关）',
      shouldWarnOnEnter({ synced: true, lastOkAt: NOW - STALE_PULL_MS - 1, busy: false, pullBusy: false, now: NOW }) === true)
    ok('❗刚拉过且没在拉 ⇒ 不提示',
      shouldWarnOnEnter({ synced: true, lastOkAt: NOW - 1_000, busy: false, pullBusy: false, now: NOW }) === false)
    ok('❗从未同步过 ⇒ 提示',
      shouldWarnOnEnter({ synced: false, lastOkAt: 0, pullBusy: false, now: NOW }) === true)
    ok('❗上次失败 ⇒ 提示',
      shouldWarnOnEnter({ synced: false, lastOkAt: 0, lastFail: true, pullBusy: false, now: NOW }) === true)
  }

  console.log(`\n${pass} 通过 / ${fail} 失败`)
  process.exit(fail ? 1 : 0)
}
main()
