// 恢复历史版本（report B：「恢复历史版本进度完全没有用」）三处缺陷的回归守卫。
// 2026-10-07 立。方法：切片 PracticeView.vue 的**真实** restoreProgress / reportRestore，
// 以及 cloud.ts 的 recordHistoryFromLocal，配桩跑；每条结论都配反向对照。
//
// 缺陷①：历史入栈只挂在推送链上（8s 防抖 + 30s 最小间隔 + 自动同步开关之后）
//        ⇒ 窗口外保存的版本永不进栈。修法：saveProgressInner 直连 recordHistoryFromLocal。
// 缺陷②：restoreProgress 失败时完全静默（不 toast、不改画面）⇒ 观感就是「点了没用」。
//        修法：返回 RestoreOutcome，由 reportRestore 如实措辞。
// 缺陷③：恢复到**同一题**时 `:key="id-reloadKey"` 不变 ⇒ QuestionCard 的 setup 期 ref
//        （selected/submitted/isCorrect）保持旧值 ⇒ 对错永远刷不出来。
//        修法：restoreProgress 应用成功后 reloadKey++。
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

  const S = (() => {
    const js = esbuild.transformSync(fs.readFileSync(path.join(ROOT, 'src/lib/sync-ids.ts'), 'utf8'), { loader: 'ts', format: 'cjs' }).code
    const mod = { exports: {} }
    new Function('module', 'exports', 'require', js)(mod, mod.exports, require)
    return mod.exports
  })()

  const pvSrc = fs.readFileSync(path.join(ROOT, 'src/views/PracticeView.vue'), 'utf8')
  const lines = pvSrc.split(/\r?\n/)
  const sliceFn = (name) => {
    const start = lines.findIndex(l => new RegExp(`^(async )?function ${name}\\s*\\(`).test(l))
    if (start < 0) throw new Error(`找不到 ${name}`)
    let end = -1
    for (let i = start + 1; i < lines.length; i++) { if (/^\}/.test(lines[i])) { end = i; break } }
    if (end < 0) throw new Error(`找不到 ${name} 结尾`)
    return esbuild.transformSync(lines.slice(start, end + 1).join('\n'), { loader: 'ts', format: 'cjs' }).code
      .replace(/^exports\.[A-Za-z_$]+\s*=\s*[A-Za-z_$]+;?$/gm, '').trim()
  }
  // 2026-10-09：restoreProgress 里新增了 `suppressRestoredBanner`（页内同步后重读进度时不弹
  // 「已从上次进度恢复」横幅的临时标）。整段被切片出来跑 ⇒ 该变量必须在 runRestore 里补上，
  // 否则 ReferenceError。**注意**：它落在 `currentOrderIdx >= 0 && !suppressRestoredBanner`
  // 这一支 ⇒ 下面断言 restoredBanner 时同理要显式给值。
  const body = sliceFn('restoreProgress')
  const reportBody = sliceFn('reportRestore')

  // ══════════ 缺陷② / ③：restoreProgress 的返回值与重挂载 ══════════
  function makeEnv (savedJson) {
    const questions = Array.from({ length: 1134 }, (_, i) => ({ id: 500001 + i, cloud_qid: 'lqdoc_' + (500001 + i) }))
    const env = {
      values: { current: 0, answerStates: new Map() },
      reloadKey: { value: 0 },
      restoring: { value: false },
      restoreUnsettled: { value: false },
      resetMarked: { value: null },
      restoredBanner: { value: false },
      finished: { value: false },
      mode: { value: 'order' },
      order: { value: questions.map((_, i) => i) },
      current: { get value () { return env.values.current }, set value (v) { env.values.current = v } },
      answerStates: { get value () { return env.values.answerStates }, set value (v) { env.values.answerStates = v } },
      questions: { value: questions },
      progressKey: { value: 'practice_progress_lquiz_banks_14' },
      api: { async getSetting () { return savedJson } },
      S, nextTick: async () => {}, toastError: () => {}, shuffle: (a) => a,
    }
    return env
  }
  function runRestore (env) {
    const fn = new Function('env', `
      const { restoring, restoreUnsettled, resetMarked, restoredBanner, finished, mode, order, current,
              answerStates, questions, progressKey, api, S, nextTick, toastError, shuffle, reloadKey } = env
      const buildProgressRefMaps = S.buildProgressRefMaps
      const resolveProgressRef = S.resolveProgressRef
      let suppressRestoredBanner = !!env.suppressRestoredBanner
      ${body}
      return restoreProgress
    `)(env)
    return fn()
  }
  function runReport () {
    const toasts = []
    const fn = new Function('env', `
      const toastSuccess = (m) => env.toasts.push(['ok', m])
      const toastError = (m) => env.toasts.push(['err', m])
      ${reportBody}
      return reportRestore
    `)({ toasts })
    return { call: (r, okText) => fn(r, okText), toasts }
  }

  const mkProgress = (n, curId) => ({
    mode: 'order',
    order_ids: Array.from({ length: 1134 }, (_, i) => 500001 + i),
    current_id: curId,
    answer_states: Object.fromEntries(Array.from({ length: n }, (_, i) => [
      String(500001 + i),
      { selected: [], blankAnswer: '', submitted: true, isCorrect: i % 3 !== 0, selfEvalDone: false, judgeSelected: null, elapsedSecs: 6 },
    ])),
    finished: false, saved_at: '2026-10-07T09:00:00.000Z',
    _src: { dev: 'mordev', v: S.PROG_SCHEMA_V },
  })

  console.log('── ① 正常恢复：返回 applied，状态确实变，且强制重挂题目卡 ──')
  {
    const e = makeEnv(JSON.stringify(mkProgress(60, 500060)))
    e.values.current = 300
    e.values.answerStates = new Map([[500001, { submitted: true, isCorrect: true }]])
    const r = await runRestore(e)
    ok("返回 'applied'", r === 'applied', `实际 ${r}`)
    ok('❗current 300 → 59（第 60 题）', e.values.current === 59, `实际 ${e.values.current}`)
    ok('❗answerStates 1 条 → 60 条', e.values.answerStates.size === 60, `实际 ${e.values.answerStates.size}`)
    ok('❗缺陷③：reloadKey 自增 ⇒ 题目卡重挂载，对错能刷出来', e.reloadKey.value === 1, `实际 ${e.reloadKey.value}`)
    ok('未就绪闸门未被误挂', e.restoreUnsettled.value === false)
  }

  console.log('\n── ② 反向对照：不同版本 ⇒ 结果不同（证明恢复真在生效，不是"没反应"）──')
  {
    const e2 = makeEnv(JSON.stringify(mkProgress(128, 500128)))
    e2.values.current = 300
    await runRestore(e2)
    ok('128 题版本 ⇒ current = 127', e2.values.current === 127, `实际 ${e2.values.current}`)
    ok('128 题版本 ⇒ answerStates = 128 条', e2.values.answerStates.size === 128, `实际 ${e2.values.answerStates.size}`)
    ok('❗两版本结果不同 ⇒ 恢复**确实生效**', e2.values.current !== 59)
    ok('❗每次恢复都各自重挂一次', e2.reloadKey.value === 1)
  }

  console.log('\n── ③ 缺陷②：引用解析不出来 ⇒ 返回 refs-unresolved（而非静默）──')
  {
    const e3 = makeEnv(JSON.stringify(mkProgress(60, 500060)))
    e3.questions.value = Array.from({ length: 1134 }, (_, i) => ({ id: String(500001 + i), cloud_qid: null }))
    const before = e3.values.current
    const r = await runRestore(e3)
    ok("返回 'refs-unresolved'", r === 'refs-unresolved', `实际 ${r}`)
    ok('状态原样不动（不装作恢复成功）', e3.values.current === before)
    ok('未就绪闸门挂上（保住续练指针不被写坏）', e3.restoreUnsettled.value === true)
    ok('❗这条路径不再在函数内 toast —— 措辞交调用方', !/toastError|toastSuccess/.test(body.replace(/^\/\/.*$/gm, '')))
  }

  console.log('\n── ④ 缺陷②：其余三个提前返回也都如实汇报 ──')
  {
    const eNone = makeEnv(null)
    ok("读不到存档 ⇒ 'no-saved'", (await runRestore(eNone)) === 'no-saved')
    const eBad = makeEnv('{不是 JSON')
    ok("存档损坏 ⇒ 'unparsable'", (await runRestore(eBad)) === 'unparsable')
    const eNoCur = makeEnv(JSON.stringify({ mode: 'order', answer_states: {} }))
    ok("缺 current_id ⇒ 'unparsable'", (await runRestore(eNoCur)) === 'unparsable')
    const eNoQ = makeEnv(JSON.stringify(mkProgress(60, 500060)))
    eNoQ.questions.value = []
    ok("题目未加载 ⇒ 'not-loaded'", (await runRestore(eNoQ)) === 'not-loaded')
  }

  console.log('\n── ⑤ 缺陷②：reportRestore 措辞 —— 成功说成功，失败说失败（反向对照）──')
  {
    const a = runReport(); a.call('applied', '已恢复该版本进度')
    ok('applied ⇒ 只有一条成功提示', a.toasts.length === 1 && a.toasts[0][0] === 'ok', JSON.stringify(a.toasts))
    for (const [r, why] of [['refs-unresolved', '题目对不上'], ['no-saved', '读不出来'], ['unparsable', '读不出来'], ['not-loaded', '未加载']]) {
      const t = runReport(); t.call(r, '已恢复该版本进度')
      ok(`${r} ⇒ 报错且文案含「失败」（${why}）`, t.toasts.length === 1 && t.toasts[0][0] === 'err' && t.toasts[0][1].includes('恢复失败'), JSON.stringify(t.toasts))
      ok(`❗${r} 时**绝不**说「已恢复」`, !t.toasts.some(x => x[1].includes('已恢复')), JSON.stringify(t.toasts))
    }
  }

  console.log('\n── ⑥ 缺陷①：历史入栈脱离推送链（源码级）──')
  {
    const cloudSrc = fs.readFileSync(path.join(ROOT, 'src/lib/cloud.ts'), 'utf8')
    const pv = fs.readFileSync(path.join(ROOT, 'src/views/PracticeView.vue'), 'utf8')
    ok('cloud.ts 导出 recordHistoryFromLocal', /export async function recordHistoryFromLocal\s*\(/.test(cloudSrc))
    ok('❗saveProgressInner 里直连 recordHistoryFromLocal',
      /saveProgressInner[\s\S]{0,4000}?recordHistoryFromLocal/.test(pv))
    ok('❗该调用点不依赖 pushProgress 开关（不在 pushProgressLightInner 内）',
      !/pushProgressLightInner[\s\S]{0,600}?recordHistoryFromLocal/.test(cloudSrc) ||
      /saveProgressInner[\s\S]{0,4000}?recordHistoryFromLocal/.test(pv))
    const m = cloudSrc.match(/export async function recordHistoryFromLocal[\s\S]*?\n\}/)
    ok('recordHistoryFromLocal 内部用 pushHistory + idb 落盘', !!m && /pushHistory\(/.test(m[0]) && /setSetting\(/.test(m[0]))
    ok('❗无变化时不写盘（避免刷屏版本）', !!m && /JSON\.stringify\(after\) === JSON\.stringify\(before\)/.test(m[0]))
  }

  console.log(`\n${pass} 通过 / ${fail} 失败`)
  process.exit(fail ? 1 : 0)
}
main()
