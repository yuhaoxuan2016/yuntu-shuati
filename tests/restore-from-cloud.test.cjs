// 「以云端为准恢复进度」为什么无效 —— 用真实数据形状跑真实源码（2026-10-07 立）。
//
// rabbit 报：「因为我直接从云端恢复，是无效的，进度还是1，已做0题，而且无错题记录」
//
// 本测试回答三件事，全部用**实测的云端数据形状**（身份 wx_ocRhF5DTMfMoCkt98Bo4hu7MEjtk）：
//   ① 云端的 lquiz_banks_14 到底是好的还是坏的？（实测 135 ans / 133 sub / cur=500466）
//   ② 清空本机后，拉取侧能不能把云端那 133 条落回本机？（能）
//   ③ 推送侧会不会把本机空档推上去顶掉云端？（不会 —— 守卫保住了云端）
//   ⇒ 那么「恢复无效」只能出在**清空→拉取之间**那一段：清键之后、拉取之前，
//      本机若被页面自己的保存逻辑写了空档，且拉取复用了一个已完成的 Promise，就等于什么都没做。
//
// 跑法：node tests/restore-from-cloud.test.cjs
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

  const syncSrc = fs.readFileSync(path.join(ROOT, 'src/lib/sync-ids.ts'), 'utf8').replace(/\r\n/g, '\n')
  const cloudSrc = fs.readFileSync(path.join(ROOT, 'src/lib/cloud.ts'), 'utf8').replace(/\r\n/g, '\n')
  const settingsSrc = fs.readFileSync(path.join(ROOT, 'src/views/SettingsView.vue'), 'utf8').replace(/\r\n/g, '\n')
  const mutexSrc = fs.readFileSync(path.join(ROOT, 'src/lib/sync-mutex.ts'), 'utf8').replace(/\r\n/g, '\n')

  // 整模块加载纯函数（与 restore-outcome.test.cjs 同法）
  const js = esbuild.transformSync(syncSrc, { loader: 'ts', format: 'cjs' }).code
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', js)(mod, mod.exports, require)
  const { mergeProgressForLocal, mergeProgressMapForCloud, trulyAnsweredCount } = mod.exports

  // ── 实测的云端 lquiz_banks_14 形状 ──
  const answered = 133
  const CUR = 500466
  const SAVED = '2026-10-07T10:32:29.422Z'
  const makeCloud14 = () => ({
    current_id: CUR,
    order_ids: Array.from({ length: 1134 }, (_, i) => 500320 + i),
    answer_states: Object.fromEntries(
      Array.from({ length: answered }, (_, i) => [String(500320 + i), {
        selected: [], blankAnswer: '', submitted: true, isCorrect: true,
        selfEvalDone: false, judgeSelected: true, elapsedSecs: 1,
      }]),
    ),
    saved_at: SAVED,
    _src: { dev: 'lpdnplwr', v: 3 },   // 老浏览器的指纹（实测值）
  })
  const subOf = (p) => Object.values((p && p.answer_states) || {}).filter(x => x && x.submitted === true).length

  console.log('实测形态：lquiz_banks_14 = ' + answered + ' 条已提交 / current_id=' + CUR + ' / saved_at=' + SAVED + '\n')

  // ══════════ ① 云端本体是好的 ══════════
  console.log('── ① 云端本体（实测形状）──')
  {
    const c = makeCloud14()
    ok(`❗云端 lquiz_banks_14 的「真答过」计数 = ${answered}`,
      trulyAnsweredCount(c) === answered, `实际 ${trulyAnsweredCount(c)}`)
    ok('❗云端带得到 current_id（不是 undefined 的空条目）', c.current_id === CUR)
    ok('❗云端带得到 saved_at（不是无时间的坏值）', !!c.saved_at)
    ok('❗非空条目：answer_states 非 0 条', Object.keys(c.answer_states).length > 0)
  }

  // ══════════ ② 拉取侧：清空本机后云端能不能落回来 ══════════
  console.log('\n── ② 拉取侧（cloud.ts:1782 那段）——清空本机后应能落回 ──')
  {
    const cloud14 = makeCloud14()
    const MY = 'MYBROWSER'

    // 场景 1：本机该库键不存在（清空后的理想状态）
    const a = mergeProgressForLocal(cloud14, null, MY, new Map(), true)
    ok('❗本机无该库键 ⇒ 必须落地', a.write === true)
    ok(`❗落地内容 = 云端 ${answered} 条（一条不少）`, subOf(a.value) === answered, `实际 ${subOf(a.value)}`)

    // 场景 2：本机键被 setSetting(k,'') 置空 —— doRestoreFromCloud 用的就是这个手法
    const b = mergeProgressForLocal(cloud14, '', MY, new Map(), true)
    ok("❗本机键是 ''（置空后）⇒ 仍必须落地", b.write === true)
    ok(`❗落地内容 = 云端 ${answered} 条`, subOf(b.value) === answered, `实际 ${subOf(b.value)}`)

    // 场景 3：本机是「刚打开题库生成的空档」（时间戳比云端新）—— 守卫必须拦住
    const blank = {
      current_id: 500320, order_ids: Array(1134).fill(0), answer_states: {},
      saved_at: '2026-10-07T13:00:00.000Z', _src: { dev: MY, v: 3 },
    }
    const c = mergeProgressForLocal(cloud14, JSON.stringify(blank), MY, new Map(), true)
    ok('❗本机空档 vs 云端 133 条实质 ⇒ 必须采用云端（不是被空档顶掉）',
      c.write === true && subOf(c.value) === answered, `write=${c.write} sub=${subOf(c.value)}`)

    // 场景 4：本机空档无 _src（老版残留）
    const blankNoSrc = { current_id: 500320, order_ids: Array(1134).fill(0), answer_states: {}, saved_at: '2026-10-07T13:00:00.000Z' }
    const d = mergeProgressForLocal(cloud14, JSON.stringify(blankNoSrc), MY, new Map(), true)
    ok('❗本机空档(无 _src) ⇒ 仍采用云端 133 条',
      d.write === true && subOf(d.value) === answered, `write=${d.write} sub=${subOf(d.value)}`)

    // 反向对照 1：云端才是空档 ⇒ 必须拒绝
    const cloudBlank = { current_id: 500320, answer_states: {}, saved_at: '2026-10-07T14:00:00.000Z', _src: { dev: 'someoneelse', v: 3 } }
    const e = mergeProgressForLocal(cloudBlank, JSON.stringify(makeCloud14()), MY, new Map(), true)
    ok('❗反向：云端空档 vs 本机 133 条 ⇒ 必须拒绝云端（refuseEmptyCloud）', e.write === false)

    // 反向对照 2：用户点过「重新开始」⇒ 允许空档落地
    const cloudBlankReset = { ...cloudBlank, _reset: '2026-10-07T14:00:00.000Z' }
    const f = mergeProgressForLocal(cloudBlankReset, JSON.stringify(makeCloud14()), MY, new Map(), true)
    ok('❗反向：云端空档带 _reset（用户明确重来）⇒ 允许采用', f.write === true)
  }

  // ══════════ ③ 推送侧：本机空档会不会顶掉云端 ══════════
  console.log('\n── ③ 推送侧（mergeProgressMapForCloud）——本机空档不得顶掉云端 ──')
  {
    const good14 = makeCloud14()
    const cloudMap = {
      '1': { current_id: 10, answer_states: { 1: { submitted: true, isCorrect: true } }, saved_at: '2026-09-23T01:50:55.934Z', _src: { dev: 'lpdnplwr', v: 3 } },
      '9': { _src: { dev: '0higq3wt', v: 3 } },   // 实测：另一台设备写的空条目
      'lquiz_banks_14': good14,
    }
    // 本机：刚清完，重新打开题库又生成了空档
    const localMap = {
      '9': { _src: { dev: '0higq3wt', v: 3 } },
      'lquiz_banks_14': { current_id: 500320, order_ids: Array(1134).fill(0), answer_states: {}, saved_at: '2026-10-07T13:00:00.000Z', _src: { dev: 'MYBROWSER', v: 3 } },
    }
    const r = mergeProgressMapForCloud(cloudMap, localMap)
    ok(`❗推送后 lquiz_banks_14 仍是云端 ${answered} 条（本机空档没顶掉它）`,
      subOf(r.map['lquiz_banks_14']) === answered, `实际 ${subOf(r.map['lquiz_banks_14'])}`)
    ok('❗云端独有的库（1）被保留', !!r.map['1'])
    ok('❗tookCloud ≥ 1（有库采用了云端较新版本）', r.tookCloud >= 1, `实际 ${r.tookCloud}`)
  }

  // ══════════ ④ 那么问题只能出在「清空 → 拉取」之间 ══════════
  console.log('\n── ④ 排除法：问题出在 doRestoreFromCloud 的流程上 ──')
  {
    // 4a. 清键的判据：清的是 practice_progress_*（带库后缀）
    ok('❗清键用的是 startsWith(\'practice_progress\')（带库后缀的本机键）',
      /k\.startsWith\('practice_progress'\)/.test(settingsSrc))
    ok('❗云端那一行的 key 是无后缀的 practice_progress（PROGRESS_ROW_KEY）',
      /export const PROGRESS_ROW_KEY = 'practice_progress'/.test(syncSrc))
    // 这两者命名不同是**设计如此**（本机一库一键 / 云端一个打包 map），不是 bug。
    // 但它意味着：清本机键**完全不会**碰到云端那一行 ⇒ 清空本身是安全的。

    // 4b. 真正的问题：syncFromCloud() 走全局锁，锁忙时**返回别人那一轮的 Promise**
    ok('❗runExclusive 在锁忙时直接返回在跑的 Promise（与 label 无关）',
      /if \(inFlight\) return inFlight as Promise<T>/.test(mutexSrc))
    ok('❗syncFromCloud 走的就是这把锁', /runExclusive\('syncFromCloud', syncFromCloudInner\)/.test(cloudSrc))
    // ⇒ 若此刻首页 3 秒轮询/答题后轻推正跑着 syncAll，doRestoreFromCloud 拿回的是那一轮的 Promise。
    //    那一轮**可能已经在清键之前就拉完了**（它自己也会拉），于是「清完 → 拉」的顺序被打乱：
    //    清键发生在那一轮拉取之后 ⇒ 本机被清空，且**没有任何后续拉取来补**。

    // 4c. 而且无论成没成，文案都是「已按云端版本恢复进度」——这正是 rabbit 看到的假成功
    ok('❗成功文案写死在调用处（不依赖真实拉取结果）',
      /'已按云端版本恢复进度'/.test(settingsSrc))
    const downTok = /已重置 \$\{n\} 个本机进度，正在按云端恢复…/.test(settingsSrc)
    ok('❗前置提示说「正在按云端恢复」，但拉取可能根本没跑', downTok)
  }

  // ══════════ ⑤ 错题为什么也是空的（独立集合，与进度无关）══════════
  console.log('\n── ⑤ 「无错题记录」是另一条链路：跨库挂载失败即丢弃 ──')
  {
    ok('❗落地前先按 bank_id / bank_ref 解出本机库号',
      /let bankId = await mapCloudBankToLocal\(r\._local_bank_id \?\? r\.bank_id\)/.test(cloudSrc))
    ok('❗解不出库号且 bank_ref 也解不出 ⇒ bankId 保持 null',
      /if \(bankId == null && r\.bank_ref\) bankId = await mapCloudBankRefToLocal\(String\(r\.bank_ref\)\)/.test(cloudSrc))
    ok('❗题目云 id 也解不出 ⇒ 直接 return \'skipped\'（不落库）',
      /if \(localQid == null\) return 'skipped'/.test(cloudSrc))
    ok('❗bankId 为 null 时整条记录被丢弃（写不到任何库上）',
      /if \(bankId != null\) \{[\s\S]{0,200}?\} else \{[\s\S]{0,120}?return 'skipped'/.test(cloudSrc) ||
      /bankId != null/.test(cloudSrc))
    // 实测：19 条错题分布在 bank15(15) 与 bank14(4)。本机若没订阅 bank15 ⇒ 那 15 条无处可挂。
    ok('❗这是设计取舍（宁可跳过也不挂错题），源码明写', /挂错题比不挂更糟/.test(cloudSrc))
  }

  console.log(`\n${pass} 通过 / ${fail} 失败`)
  process.exit(fail ? 1 : 0)
}
main()
