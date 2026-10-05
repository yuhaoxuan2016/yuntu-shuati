// 回归测试（2026-10-05）：api.updateQuestion 的订阅库只读护栏
//
// 背景：订阅/公共库的题（bank_id 是 bankRef 字符串）不该落本地 questions 表 —— 写出的行
//   listAllQuestions 遍历不到（推不上云 ⇒ 改动丢失），且订阅题 id 是云端 `_local_id`，
//   put 按 key 会覆盖本地自增 id 相同的自建题库题目（旧包 1~4746 同域）。
//   入口侧已用 QuestionCard 的 hideEdit 隐藏 ✎，本测试锁住底层兜底：明确是字符串 bank_id 时抛错。
//
// 源码级断言（不跑运行时 IndexedDB），锁住这层护栏不被删掉。

const fs = require('fs')
const path = require('path')
const assert = require('assert')
const esbuild = require('esbuild')

const ROOT = path.join(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

function main() {
  const api = read('src/utils/api.ts')

  // 1) 护栏存在：判字符串 bank_id 并抛错
  assert.match(api, /typeof\s+\(q as any\)\?\.bank_id\s*===\s*'string'/,
    'api.updateQuestion 应判 `typeof (q as any)?.bank_id === \'string\'`')
  assert.match(api, /throw new Error\('公共题库的题目不可编辑'\)/,
    '订阅库题目应抛出「公共题库的题目不可编辑」')

  // 2) 护栏必须在写库之前（否则拦了个寂寞）
  const guardIdx = api.indexOf("=== 'string'")
  const putIdx = api.indexOf('await idb.updateQuestion(rest)')
  assert.ok(guardIdx > 0 && putIdx > 0, '应同时找到护栏与写库语句')
  assert.ok(guardIdx < putIdx, '护栏必须在 idb.updateQuestion 之前')

  // 3) 只在明确是字符串时拦 —— 数字 bank_id（本地库）与非题库对象不受影响
  assert.ok(!/bank_id\s*===\s*'string'\s*\|\|/.test(api.split('async updateQuestion')[1].slice(0, 1200)),
    '护栏不得放宽为「非数字即拦」等更宽的条件')

  // 4) 脚本块可编译
  const m = api.match(/<script[^>]*lang="ts"[^>]*>([\s\S]*?)<\/script>/)
  const code = m ? m[1] : api   // .ts 文件无 <script> 包裹，整文件即代码
  esbuild.transformSync(code, { loader: 'ts', target: 'es2020' })

  // 5) 文案与小程序端一致（同一产品同一提示）
  const mp = read('../yuntu-mp/src/pages/practice/practice.vue')
  assert.match(mp, /公共题库的题目不可编辑/, '小程序端应有同款文案（本产品两端一致）')

  // 6) 三个可能承载订阅题的页面仍保留 hideEdit 入口隐藏（与本护栏双保险）
  for (const f of ['src/views/PracticeView.vue', 'src/views/FavoritesView.vue', 'src/views/WrongView.vue']) {
    assert.match(read(f), /:hide-edit=/, `${f} 应保留 :hide-edit`)
  }

  console.log('✓ 订阅库只读护栏：6 组断言全部通过')
  console.log('  · api.updateQuestion 在写库前拦下字符串 bank_id')
  console.log('  · 文案与小程序端一致；本地库（数字 bank_id）不受影响')
  console.log('  · 与入口侧 hideEdit 构成双保险')
}

main()
