// 跨端进度引用解析守卫（2026-10-07 · 「指针被重置成第 1 题」事故的根因修复一部分）
//
// 事故链（云端实据）：小程序推上云的进度条目 order_ids/current_id/answer_states 用
//   qid 字符串（`bankRef::id:<云题 _id>`）；网页版拉取时对「本地没有的库」（订阅库）走
//   「直通不映射」分支原样存下 ⇒ 练习页 restoreProgress 只认数字 current_id ⇒ **静默放弃恢复**
//   ⇒ 从第 1 题开始 ⇒ 首存把 last_practice 指针改写成 position=1 ⇒ 轻推上云覆盖正确位置。
//
// 本测试钉住解析器：数字本机 id / 来源题号(src_local_id) / 小程序 qid 字符串（::id:<云题 _id>）
//   三类引用都能解析成本机索引；解析不了返回 undefined（绝不猜）。
// 跑法（cwd=shuati-pwa）: node tests/mp-progress-resolve.test.cjs
const fs = require('fs')
const path = require('path')
const esbuild = require('esbuild')

const ROOT = path.join(__dirname, '..')
let failed = 0
const ok = (m) => console.log('   ✓ ' + m)
const bad = (m) => { console.log('   ✗ ' + m); failed++ }
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : bad(`${m}｜实得 ${JSON.stringify(a)} 期望 ${JSON.stringify(b)}`))

// —— 从 sync-ids.ts 取真实现（先剥 export 再 transform，与既有守卫同法）——
const src = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'sync-ids.ts'), 'utf8').replace(/\r\n/g, '\n')
const code = esbuild.transformSync(src.replace(/\bexport\s+/g, ''), { loader: 'ts' }).code
const mod = new Function(`${code}\nreturn { buildProgressRefMaps, resolveProgressRef }`)()

console.log('== ① 映射表构建 + 三类引用解析 ==')
{
  const questions = [
    { id: 500461, cloud_qid: 'docA' },
    { id: 500462, cloud_qid: 'docB', src_local_id: 999 },
    { id: 500463, cloud_qid: 'docC' },
  ]
  const maps = mod.buildProgressRefMaps(questions)
  eq(mod.resolveProgressRef(500462, maps), 1, '数字本机 id → 索引')
  eq(mod.resolveProgressRef('500462', maps), 1, '数字型字符串（网页版 JSON 键）→ 索引')
  eq(mod.resolveProgressRef(999, maps), 1, '来源题号 src_local_id → 索引')
  eq(mod.resolveProgressRef('lquiz_banks_14::id:docC', maps), 2, '小程序 qid 字符串（::id:）→ 索引')
  eq(mod.resolveProgressRef('docA', maps), 0, '裸云题 _id → 索引（宽松兜底）')
  eq(mod.resolveProgressRef('lquiz_banks_14::id:不存在', maps), undefined, '解析不了 → undefined（绝不猜）')
  eq(mod.resolveProgressRef(undefined, maps), undefined, 'undefined → undefined')
  eq(mod.resolveProgressRef('e30', maps), undefined, '非 qid 字符串不硬当数字（防 NaN 索引）')
}

console.log('== ② 小程序形态整条进度端到端解析（模拟订阅库恢复）==')
{
  // 用整卷 order（1134 太长，用 4 题等价样例）模拟 mp 推上来的条目
  const questions = [
    { id: 11, cloud_qid: 'd1' }, { id: 12, cloud_qid: 'd2' },
    { id: 13, cloud_qid: 'd3' }, { id: 14, cloud_qid: 'd4' },
  ]
  const mpEntry = {
    mode: 'order',
    order_ids: ['b::id:d3', 'b::id:d1', 'b::id:d4', 'b::id:d2'],
    current_id: 'b::id:d4',
    answer_states: { 'b::id:d3': { picked: [0], correct: true }, 'b::id:d1': { picked: [1], correct: false } },
    finished: false,
    saved_at: '2026-10-07T02:04:18.000Z',
    _src: { dev: 'mp', v: 3 },
  }
  const maps = mod.buildProgressRefMaps(questions)
  const order = mpEntry.order_ids.map((r) => mod.resolveProgressRef(r, maps))
  eq(order, [2, 0, 3, 1], 'order 全部解析（且保持 mp 的乱序）')
  eq(order.includes(undefined), false, 'order 无解析缺口')
  eq(mod.resolveProgressRef(mpEntry.current_id, maps), 3, 'current_id（字符串）→ 题库数组索引（d4 在第 4 位）')
  eq(order.indexOf(3), 2, '恢复链据此在 order 里定位：current 位次 = 2')
  const states = Object.entries(mpEntry.answer_states).map(([k]) => mod.resolveProgressRef(k, maps))
  eq(states, [2, 0], 'answer_states 键解析')
}

console.log('== ③ 与既有数字形态互不干扰（网页版自产进度）==')
{
  const questions = [{ id: 7, cloud_qid: 'x1' }, { id: 8, cloud_qid: 'x2' }]
  const maps = mod.buildProgressRefMaps(questions)
  eq(mod.resolveProgressRef(8, maps), 1, '纯数字照常')
  eq(mod.resolveProgressRef(7, maps), 0, '纯数字照常(2)')
}

console.log('== ④ 接线守卫：练习页恢复链与未就绪闸门（PracticeView.vue）==')
{
  const view = fs.readFileSync(path.join(ROOT, 'src', 'views', 'PracticeView.vue'), 'utf8').replace(/\r\n/g, '\n')
  const has = (re, m) => (re.test(view) ? ok(m) : bad(m + '（源码缺失）'))
  const absent = (re, m) => (re.test(view) ? bad(m + '（旧形态残留）') : ok(m))
  has(/buildProgressRefMaps\(questions\.value/, '恢复链使用 buildProgressRefMaps')
  has(/resolveProgressRef\(ref, refMaps\)/, 'idxOf 走 resolveProgressRef')
  has(/restoreUnsettled\.value = true/, '解析不出当前位置时挂未就绪闸门')
  has(/if \(restoreUnsettled\.value\) \{[\s\S]{0,220}dirtySince\.value = 0; return/, '保存链受闸门拦截（不落盘、不推指针）')
  has(/async function restart[\s\S]{0,500}restoreUnsettled\.value = false/, '「重新开始」显式解除闸门')
  absent(/typeof progress\.current_id !== 'number'/, '旧的「只认数字 current_id」门槛已移除')
}

if (failed) { console.error(`\n❌ 失败 ${failed} 项`); process.exit(1) }
console.log('\n✅ 跨端进度引用解析：三类引用 + 缺口兜底 + 数字形态兼容，全部通过')
process.exit(0)
