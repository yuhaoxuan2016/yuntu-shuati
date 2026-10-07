// 订阅库记录（错题 / 收藏 / 已掌握 / 练习记录）落不了地的守卫（2026-10-08 立）
//
// rabbit 报：「进度还是1，已做0题，而且无错题记录」→ 进度那条已修（见 sync-restore.test.cjs），
// 错题这条查实是**两个独立的丢弃点**：
//
//   本机对订阅库记录的正确形状（源码证明）：`bank_id = "lquiz_banks_14"`（bankRef 字符串）+
//   `question_id = 云端 _local_id`。`api.listQuestions` 对字符串 bankId 走 listPublicBankQuestions
//   直读云端、**不落本地题行**，产出的 `id` 就是云端 `_local_id` ⇒ 这个形状本来就跨端稳定。
//
//   实测 rabbit 账号（错题 19 条，两批镜像、样本题号完全相同）：
//     · 网页推的  8 条：bank_id="lquiz_banks_14/15"，**无** bank_ref、**无** question_cloud_id
//     · 小程序推的 11 条：bank_id=21/22/23，**有** bank_ref + question_cloud_id
//   （21/22/23 是小程序侧编号 —— 订阅库两端编号不同：网页 14/15/16，小程序 21/22/23）
//
//   两批各死在不同的地方：
//     ① 网页那批：mapCloudBankToLocal("lquiz_banks_14") 只查本机题库表的 cloud_id，订阅库没有
//        本机库行 ⇒ null；兜底只试 r.bank_ref，而这批没这字段 ⇒ null ⇒ 整条静默丢弃。
//     ② 小程序那批：库能解，但题号走 mapCloudQuestionToLocal —— 它读**本机题目行**建索引，
//        订阅库题行不存在 ⇒ 必然 null ⇒ 跳过。
//
// 跑法：node tests/wrong-landing.test.cjs
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

  const idsSrc = fs.readFileSync(path.join(ROOT, 'src/lib/sync-ids.ts'), 'utf8').replace(/\r\n/g, '\n')
  const cloudSrc = fs.readFileSync(path.join(ROOT, 'src/lib/cloud.ts'), 'utf8').replace(/\r\n/g, '\n')

  // 整模块加载纯判据（与 restore-from-cloud.test.cjs 同法）
  const mod = { exports: {} }
  new Function('module', 'exports', 'require',
    esbuild.transformSync(idsSrc, { loader: 'ts', format: 'cjs' }).code)(mod, mod.exports, require)
  const { recordBankRefFallback, planRecordQuestionRef } = mod.exports

  // 取顶层函数体：从声明行到下一个顶格 `}`。静态断言前去掉注释（注释里提到函数名是正常散文）。
  const bodyOf = (src, name) => {
    const re = new RegExp('^(?:export )?(?:async )?function ' + name + '\\b', 'm')
    const m = re.exec(src)
    if (!m) return null
    const end = src.indexOf('\n}', m.index)
    return end < 0 ? null : src.slice(m.index, end + 2)
  }
  const stripComments = (s) => (s || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

  // ── 实测的云端两批形状（照 2026-10-08 只读探针的读数） ──
  const WEB_ROW = { bank_id: 'lquiz_banks_14', question_id: 500149 }                       // 网页推：无 bank_ref / 无 cloud id
  const MP_ROW = { bank_id: 21, bank_ref: 'lquiz_banks_14', question_id: 500149, question_cloud_id: 'cld_q_500149' } // 小程序推

  // ══════════ ① 库解析兜底判据 ══════════
  console.log('── ① 库解析兜底：bank_id 本身是 bankRef 时还能再试一次 ──')
  {
    ok('❗判据已导出（可直测）', typeof recordBankRefFallback === 'function')
    if (typeof recordBankRefFallback === 'function') {
      // 核心：网页那批——库没解出、bank_id 是字符串 ⇒ 必须返回该字符串去当 bankRef 再试
      ok('❗❗网页推的订阅库行：库没解出 + bank_id 是字符串 ⇒ 拿它当 bankRef 再试',
        recordBankRefFallback(null, WEB_ROW.bank_id) === 'lquiz_banks_14')
      // 反向对照：已经解出来了就别再兜（否则可能把已认对的库覆盖成别的）
      ok('❗反向：库已解出（数字，本地库）⇒ 不兜底',
        recordBankRefFallback(16, 21) === null)
      ok('❗反向：库已解出（字符串，订阅库）⇒ 也不兜底',
        recordBankRefFallback('lquiz_banks_14', 'lquiz_banks_14') === null)
      // 反向对照：数字 bank_id 解不出就是解不出 —— 别把「本地库号」误当 bankRef 去乱认库
      ok('❗❗反向：bank_id 是数字且没解出 ⇒ 不得拿它当 bankRef',
        recordBankRefFallback(null, MP_ROW.bank_id) === null)
      ok('❗反向：bank_id 缺失/异形 ⇒ 不兜底',
        recordBankRefFallback(null, undefined) === null && recordBankRefFallback(null, {}) === null)
    }
  }

  // ══════════ ② 题号决策（本组最要紧） ══════════
  console.log('\n── ② 题号决策：订阅库不翻译，本地库必须翻译 ──')
  {
    ok('❗判据已导出（可直测）', typeof planRecordQuestionRef === 'function')
    if (typeof planRecordQuestionRef === 'function') {
      const P = (bankId, row) => planRecordQuestionRef({ bankId, questionCloudId: row.question_cloud_id, questionId: row.question_id })

      // 核心两条：两批镜像都该「原样采用」
      ok('❗❗网页那批（订阅库 + 无 cloud id）⇒ 原样采用', P('lquiz_banks_14', WEB_ROW) === 'as-is', P('lquiz_banks_14', WEB_ROW))
      ok('❗❗小程序那批（订阅库 + 有 cloud id）⇒ **原样采用**，不是 translate、更不是 skip',
        P('lquiz_banks_14', MP_ROW) === 'as-is', P('lquiz_banks_14', MP_ROW))

      // 🔴 反向对照（最危险的回归）：本地库**必须仍走翻译**
      ok('❗❗反向：本地库 + 有 cloud id ⇒ 必须仍是 translate（一刀切跳过会把题挂错号）',
        planRecordQuestionRef({ bankId: 16, questionCloudId: 'cld_x', questionId: 100 }) === 'translate')
      ok('❗反向：本地库 + 无 cloud id + 正数题号 ⇒ 原样采用',
        planRecordQuestionRef({ bankId: 16, questionCloudId: null, questionId: 100 }) === 'as-is')
      ok('❗反向：本地库 + 无 cloud id + 非正题号 ⇒ 跳过（不许挂到 0 号题）',
        planRecordQuestionRef({ bankId: 16, questionCloudId: null, questionId: 0 }) === 'skip' &&
        planRecordQuestionRef({ bankId: 16, questionCloudId: null, questionId: undefined }) === 'skip')

      // 订阅库侧的边界
      ok('❗订阅库 + 题号非正数 ⇒ 跳过（没有可用的稳定号就别挂）',
        planRecordQuestionRef({ bankId: 'lquiz_banks_14', questionCloudId: 'cld_x', questionId: 0 }) === 'skip' &&
        planRecordQuestionRef({ bankId: 'lquiz_banks_14', questionCloudId: null, questionId: undefined }) === 'skip')
      ok('❗订阅库 + 字符串数字题号 ⇒ 原样采用',
        planRecordQuestionRef({ bankId: 'lquiz_banks_14', questionCloudId: null, questionId: '500149' }) === 'as-is')
      ok('❗库没解出来（null）⇒ 一律跳过',
        planRecordQuestionRef({ bankId: null, questionCloudId: 'cld_x', questionId: 100 }) === 'skip' &&
        planRecordQuestionRef({ bankId: undefined, questionCloudId: null, questionId: 100 }) === 'skip')

      // 反向对照：三种取值互不相同（别写成恒返回一种）
      const set = new Set([
        planRecordQuestionRef({ bankId: 16, questionCloudId: 'c', questionId: 1 }),
        planRecordQuestionRef({ bankId: 'lquiz_banks_14', questionCloudId: 'c', questionId: 1 }),
        planRecordQuestionRef({ bankId: 16, questionCloudId: null, questionId: 0 }),
      ])
      ok('❗反向：三种结果确实互不相同', set.size === 3, [...set].join('/'))
    }
  }

  // ══════════ ③ 口径只有一处：cloud.ts 真的调用这两个判据 ══════════
  console.log('\n── ③ 口径只有一处（cloud.ts 真调用，不另抄一份）──')
  {
    const code = stripComments(cloudSrc)
    ok('❗cloud.ts 调用了 recordBankRefFallback', /recordBankRefFallback\(/.test(code))
    ok('❗cloud.ts 调用了 planRecordQuestionRef', /planRecordQuestionRef\(/.test(code))
    ok('❗两个判据都从 sync-ids 导入（不是本地又定义一份）',
      /import \{[^}]*recordBankRefFallback[^}]*\} from '\.\/sync-ids'/.test(cloudSrc) &&
      /import \{[^}]*planRecordQuestionRef[^}]*\} from '\.\/sync-ids'/.test(cloudSrc) &&
      !/function recordBankRefFallback/.test(cloudSrc) &&
      !/function planRecordQuestionRef/.test(cloudSrc))

    // 反向对照：本地库那条翻译路**不能删**
    const wl = stripComments(bodyOf(cloudSrc, 'writeLocal') || '')
    ok('❗反向：writeLocal 仍保留 mapCloudQuestionToLocal 调用（本地库那条路没被删）',
      /mapCloudQuestionToLocal\(/.test(wl))
    ok('❗反向：翻译失败仍返回 skipped（宁可不挂）',
      /localQid == null\)\s*return 'skipped'/.test(wl))
  }

  // ══════════ ④ 订阅守卫仍在（别把「放宽」做成「谁都能挂」） ══════════
  console.log('\n── ④ 订阅守卫仍在 ──')
  {
    const refBody = stripComments(bodyOf(cloudSrc, 'mapCloudBankRefToLocal') || '')
    ok('❗函数体取到了', !!refBody)
    ok('❗❗订阅库必须真的订阅过才认（读本机 subscriptions 列表）',
      /getSetting\('subscriptions'\)/.test(refBody) && /some\(/.test(refBody))
    ok('❗读不到/坏值时不认这个库（不猜）', /catch \{[\s\S]{0,80}?\}/.test(refBody) && /return null/.test(refBody))
  }

  // ══════════ ⑤ 推送侧：订阅库也带 bank_ref，本地库保持原样 ══════════
  console.log('\n── ⑤ 推送侧标识统一 ──')
  {
    const code = stripComments(cloudSrc)
    // 订阅库那支：把 bank_id（bankRef 字符串）并写进 bank_ref
    ok('❗❗推送侧给订阅库记录写 bank_ref（此前一个标识都不带）',
      /typeof\s+doc\.bank_id\s*===\s*'string'[\s\S]{0,120}?doc\.bank_ref\s*=/.test(code))
    // 反向对照：本地库那支仍只写 _local_bank_id，不得顺手也写 bank_ref
    ok('❗反向：本地库那支仍只写 _local_bank_id（不写 bank_ref）',
      /typeof\s+doc\.bank_id\s*===\s*'number'[\s\S]{0,80}?doc\._local_bank_id\s*=\s*doc\.bank_id/.test(code))
  }

  console.log(`\n${pass} 通过 / ${fail} 失败`)
  process.exit(fail ? 1 : 0)
}
main()
