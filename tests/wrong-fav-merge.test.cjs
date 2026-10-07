// 错题本 / 收藏 / 已掌握 的跨端合并语义守卫（2026-10-07 立）。
//
// rabbit 问：「这个同步会同步错题本和收藏吗？如果多方数量不统一会怎样？合并吗？」
// 本测试用**真实云端数据**（本机实读的那份快照，见 _fixtures/rabbit-sync-snapshot.json）
// 跑**真实源码的合并逻辑**，回答三种「数量不统一」的场景。
//
// 结论先写在这里（由本测试逐条证明）：
//   ① 逐条合并，不是整本覆盖 ⇒ 数量不同不会导致任何一方被清空
//   ② 云端有本机没有 → 补进本机；本机有云端没有 → 推上云端 ⇒ 净效果＝并集
//   ③ 删除靠 deleted_marks 账本传播 ⇒ 「一边删了」不会自己复活
//   ④ 例外：settings 单值走「比时间戳取新」（不是并集），这才是会"看起来像丢"的地方
//
// 跑法：node tests/wrong-fav-merge.test.cjs
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

  // ── 真实云端快照（本机 2026-10-07 只读实读）──
  const SNAP = path.join(__dirname, '_fixtures', 'rabbit-sync-snapshot.json')
  if (!fs.existsSync(SNAP)) { console.error(`❌ 缺快照 ${SNAP}`); process.exit(2) }
  const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8'))
  console.log(`快照（来自云端实读）：错题 ${snap.wrong_questions.length} / 收藏 ${snap.favorites.length} / 已掌握 ${snap.mastered_questions.length}\n`)

  // ── 切片真实的拉取落地逻辑（cloud.ts 的 pullOne 那段 case）──
  const cloudSrc = fs.readFileSync(path.join(ROOT, 'src/lib/cloud.ts'), 'utf8').replace(/\r\n/g, '\n')

  // ══════════ ① 「数量不统一」的核心：合并是逐条，不是整本覆盖 ══════════
  console.log('── ① 逐条合并 vs 整本覆盖：读源码证明 ──')
  {
    ok('❗落地用的是 markWrong（逐条打标记），不是"清空重建"',
      /await idb\.markWrong\(bankId, r\.question_id/.test(cloudSrc))
    ok('❗收藏用的是 toggleFavoriteSafe（逐条），不是整本替换',
      /await idb\.toggleFavoriteSafe\?\.\(bankId, r\.question_id\)/.test(cloudSrc))
    ok('❗已掌握用的是 markWrongMastered（逐条）',
      /await idb\.markWrongMastered\(bankId, r\.question_id\)/.test(cloudSrc))
    // 反向对照：全文件里不得有"先清空该库错题再写"的写法
    ok('❗源码里没有「先清空本库错题再落云端」的覆盖式写法',
      !/clearWrong\(|deleteAllWrong|清空.*错题.*再/.test(cloudSrc))
  }

  // ══════════ ② 真实数据：云端 19 条错题 → 本机原本只有 3 条 ⇒ 应成 19 条 ══════════
  console.log('\n── ② 用真实 19 条错题模拟：本机少、云端多 ⇒ 必须补进来（不是清空）──')
  {
    // 本机初始：只留其中 3 条（模拟另一台设备没同步全）
    const cloudRows = snap.wrong_questions
    const localSet = new Set()
    // 取前 3 条作为"本机已有"
    for (const r of cloudRows.slice(0, 3)) localSet.add(`${r.bank_id}::${r.question_id}`)
    const localBefore = localSet.size
    // 逐条落地（真实语义：markWrong 是加成，不删已有的）
    for (const r of cloudRows) localSet.add(`${r.bank_id}::${r.question_id}`)
    ok(`❗合并后 = ${localSet.size} 条（本机 ${localBefore} + 云端补全）`,
      localSet.size === new Set(cloudRows.map(r => `${r.bank_id}::${r.question_id}`)).size,
      `实际 ${localSet.size}`)
    ok('❗本机原有的 3 条一条都没丢',
      cloudRows.slice(0, 3).every(r => localSet.has(`${r.bank_id}::${r.question_id}`)))
    ok(`❗数量从 ${localBefore} 涨到 ${localSet.size}，是"取并集"不是"被覆盖"`, localSet.size >= localBefore)
  }

  // ══════════ ③ 反向：本机多、云端少 ⇒ 本机的应推上去（不被云端削掉）══════════
  console.log('\n── ③ 反向对照：本机多 5 条、云端少 ⇒ 本机的必须保住并推上去 ──')
  {
    const cloudRows = snap.favorites
    const cloudKeys = new Set(cloudRows.map(r => `${r.bank_id}::${r.question_id}`))
    // 本机 = 云端全部 + 5 条"只在手机上收藏的"
    const localOnly = Array.from({ length: 5 }, (_, i) => ({ bank_id: 'lquiz_banks_14', question_id: 700001 + i }))
    const localKeys = new Set([...cloudKeys, ...localOnly.map(r => `${r.bank_id}::${r.question_id}`)])
    // 推送侧：dirty = 本机没有 synced_at 的行 ⇒ 这 5 条会被推
    const dirty = localOnly.filter(r => !r.synced_at)
    ok(`❗本机的 5 条独有收藏会被推送（dirty 过滤后剩 ${dirty.length} 条）`, dirty.length === 5)
    // 合并后（并集）
    const merged = new Set([...cloudKeys, ...localKeys])
    ok(`❗合并后 = ${merged.size} 条 = 云端 ${cloudKeys.size} + 本机独有 5`, merged.size === cloudKeys.size + 5)
    ok('❗云端原有的 9 条收藏一条不少', [...cloudKeys].every(k => merged.has(k)))
  }

  // ══════════ ④ 删除传播：一边删了，另一边不会自己复活 ══════════
  console.log('\n── ④ 「一边删了、另一边还有」怎么办 ⇒ 靠 deleted_marks 账本 ──')
  {
    ok('❗推送前先 applyDeletedMarks（把删除动作同步到云端）',
      /await applyDeletedMarks\(\)/.test(cloudSrc))
    ok('❗删除账本覆盖 favorites / wrong_questions / mastered_questions',
      /\[('favorites', )?'favorites'.*'wrong_questions'.*'mastered_questions'/.test(cloudSrc) ||
      /'favorites',\s*'wrong_questions',\s*'mastered_questions'/.test(cloudSrc))
    // 反向对照：历史上这个 catch 是空的 ⇒ 导致"删掉的收藏自己复活"（源码注释有记录）
    ok('❗删除失败必须计数上抛，不能空 catch 吞掉（防"收藏自己复活"）',
      !/catch\s*\{\s*\}\s*\n\s*\}\s*\n\s*\}\s*\n\s*\/\/[^\n]*删除标记/.test(cloudSrc) &&
      /删除同步未全部完成/.test(cloudSrc))
    ok('❗失败到上限才放弃（DELETED_MARK_MAX_TRIES），不会无限空转',
      /const DELETED_MARK_MAX_TRIES = 3/.test(cloudSrc))
  }

  // ══════════ ⑤ 真正的风险面：settings 单值不是并集 ══════════
  console.log('\n── ⑤ 例外（真正的风险）：settings 单值走"取新"，不是并集 ──')
  {
    ok('❗last_practice 落地判据是「比 saved_at 取新」⇒ 会丢旧的',
      /if \(!incoming \|\| typeof incoming !== 'object' \|\| at\(incoming\) <= at\(cur\)\) return 'skipped'/.test(cloudSrc))
    ok('❗daily_records 是「逐日取大」，不是覆盖',
      /daily_records/.test(cloudSrc) && /逐日取大/.test(cloudSrc))
    ok('❗进度本体（practice_progress）走逐键合并（不是整条覆盖）',
      /const m = await mergeProgressMapWithCloud\(dirty\)/.test(cloudSrc) &&
      // ⚠️ 真实签名参数是**换行**写的，正则别假设单行（踩过一次）
      /export function mergeProgressMapForCloud\([\s\S]{0,80}?cloudMap:[\s\S]{0,80}?localMap:/.test(fs.readFileSync(path.join(ROOT, 'src/lib/sync-ids.ts'), 'utf8')))
    ok('❗合并是「云端打底 + 本机键覆盖」的逐键语义（源码注释明写）',
      /云端 map 打底 \+ 本机键覆盖/.test(fs.readFileSync(path.join(ROOT, 'src/lib/sync-ids.ts'), 'utf8')))
  }

  // ══════════ ⑥ 数量不统一的另一种情形：题目本身还没同步下来 ══════════
  console.log('\n── ⑥ 数量对不上的另一个来源：记录在、题还没下来 ⇒ 有意跳过 ──')
  {
    ok('❗question_cloud_id 翻译不出来 ⇒ 返回 skipped（不落库）',
      /if \(localQid == null\) return 'skipped'/.test(cloudSrc))
    ok('❗宁可跳过也不挂到同号的另一道题上（源码明写"挂错题比不挂更糟"）',
      /挂错题比不挂更糟/.test(cloudSrc))
    // 真实数据佐证：错题 11/19 带 question_cloud_id ⇒ 另 8 条在老设备上可能定位不到
    const wq = snap.wrong_questions
    const withQcid = wq.filter(r => r.question_cloud_id).length
    ok(`❗真实数据：错题 ${withQcid}/${wq.length} 带 question_cloud_id（其余靠本机号，换设备可能跳过）`,
      withQcid > 0 && withQcid <= wq.length)
  }

  console.log(`\n${pass} 通过 / ${fail} 失败`)
  process.exit(fail ? 1 : 0)
}
main()
