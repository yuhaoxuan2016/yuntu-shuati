// 回归测试（2026-10-05）：订阅库不得出现 ✎ 编辑入口
//
// 背景：订阅库题目在云端在线读、本地无行。旧版 PracticeView / FavoritesView / WrongView 渲染
//   QuestionCard 时不区分订阅与本地 ⇒ 订阅模式也能点 ✎ 保存 ⇒ api.updateQuestion 无条件 put 到本地
//   questions 表（订阅题 id 是云端 `_local_id`，与本地自增 id 同域时会覆盖本地同号题；且写出的行
//   `bank_id` 是 bankRef 字符串，listAllQuestions 遍历不到 ⇒ 改动推不上云）。
//   修法：QuestionCard 加 `hideEdit` prop（默认 falsy ⇒ 显示），订阅库三个页面按
//   `typeof bankId === 'string'` 传 true。
//
// 本测试是**源码级断言**（不跑运行时）：锁住这四处契约，防止将来被误删。
const fs = require('fs')
const path = require('path')
const assert = require('assert')

const ROOT = path.join(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

function main() {
  const card = read('src/components/QuestionCard.vue')

  // 1) 卡片侧：prop 定义 + 按钮条件
  assert.match(card, /hideEdit\?:\s*boolean/, 'QuestionCard 应声明 hideEdit?: boolean')
  assert.match(card, /v-if="!hideEdit"[\s\S]{0,80}编辑本题/, '✎ 按钮应受 !hideEdit 控制')
  assert.match(card, /title="编辑本题"/, '✎ 按钮仍在（只是条件化）')

  // 2) 三个可能承载订阅题的页面：都要传 :hide-edit
  const cases = [
    { f: 'src/views/PracticeView.vue', judge: /isSubscribedBank/, want: 1 },
    { f: 'src/views/FavoritesView.vue', judge: /const hideEdit = typeof bankId === 'string'/, want: 1 },
    { f: 'src/views/WrongView.vue', judge: /const hideEdit = typeof bankId === 'string'/, want: 2 },
  ]
  for (const c of cases) {
    const s = read(c.f)
    const n = (s.match(/:hide-edit=/g) || []).length
    assert.strictEqual(n, c.want, `${c.f} 应有 ${c.want} 处 :hide-edit（实际 ${n}）`)
    assert.match(s, c.judge, `${c.f} 应有订阅判据`)
  }

  // 3) 判据必须是「字符串 bankId = 订阅库」——不得写成数字取反等反义
  const pv = read('src/views/PracticeView.vue')
  assert.match(pv, /const isSubscribedBank = computed\(\(\) => typeof bankId === 'string'\)/,
    'PracticeView 判据应为 typeof bankId === \'string\'')

  // 4) 交卷回顾态仍走 readOnly（考试页不该有编辑入口，二者互不替代）
  for (const f of ['src/views/ComposeExamView.vue', 'src/views/MixExamView.vue']) {
    assert.match(read(f), /:read-only="true"/, `${f} 回顾态应保持 read-only`)
  }

  console.log('✓ 订阅库隐藏编辑入口：4 组断言全部通过')
  console.log('  · QuestionCard 定义 hideEdit prop，✎ 受 !hideEdit 控制')
  console.log('  · PracticeView / FavoritesView / WrongView 均按字符串 bankId 传 :hide-edit')
  console.log('  · 考试回顾态仍走 read-only（两条路径互不替代）')
}

main()
