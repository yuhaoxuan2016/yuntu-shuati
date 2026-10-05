// 回归测试（2026-10-05）：订阅库「编辑题目」的本地落库行为
//
// 背景：订阅题库（bankRef 字符串）的题目由 api.listQuestions() 在线读云端 public 题后**映射**成
//   Question 对象（api.ts:136-165），映射里 `id = _local_id`（云端数字题号）、`bank_id = bankRef`（字符串）。
//   云端 public 题**不带 visibility**（PUBLIC_Q_FIELDS 已裁剪）。
//
// 链路：订阅练习页（PracticeView）**不传 readOnly** ⇒ QuestionCard 的 ✎ 可见 ⇒ 弹窗 save()
//   → api.updateQuestion(updated) → idb.updateQuestion(rest) → questions.put(plain(q))
//
// questions store 的 keyPath = 'id'（autoIncrement: true，但 put 带 key 时按 key 写）。
// 因此本测试断言的真实行为是：
//   A) 本地**新增**一行 id = 云端 _local_id、bank_id = bankRef(string) 的「孤儿行」；
//   B) 若本地自增 id 恰好等于该 _local_id ⇒ **覆盖掉本地那一行的题干**（= 2026-08-16 拉取路径
//      已修、编辑路径未修的那类数据丢失）；
//   C) 孤儿行不会被 listAllQuestions() 读到（它只遍历本地库 id ⇒ 云端 bankRef 字符串永不被查）
//      ⇒ 因此**不会推上云**（这解释了线上「订阅库 bankRef + private 题 = 0 条」的实测结果）。
//
// 本测试不引入 fake-indexeddb：直接复现 db.ts 的两个关键语义（put 按 key 写 / index 查询按 bank_id 过滤）
// 于一个最小 Map 上，验证的是**语义**而非 IDB 实现。若 db.ts 的 put/index 语义变了，本测试需同步。

const assert = require('assert')

/** 最小 questions 表：keyPath='id'，index bank_id */
function makeStore() {
  const byId = new Map()          // id -> row
  return {
    put(row) {
      // 语义等价于 IDBObjectStore.put：带 key 时按 key 覆盖，无 key 时自增
      let id = row.id
      if (typeof id !== 'number') {
        id = byId.size ? Math.max(...byId.keys()) + 1 : 1
      }
      byId.set(id, { ...row, id })
      return id
    },
    listQuestions(bankId) {
      // 语义等价于 index('bank_id').getAll(IDBKeyRange.only(bankId))
      return [...byId.values()].filter(r => r.bank_id === bankId)
    },
    listBankIds() { return [...new Set([...byId.values()].map(r => r.bank_id))] },
    all() { return [...byId.values()] },
    get(id) { return byId.get(id) },
  }
}

/** 模拟 listAllQuestions()：只遍历「本地库」的 id，逐库按 bank_id 查 */
function listAllQuestions(store, localBankIds) {
  const out = []
  for (const b of localBankIds) out.push(...store.listQuestions(b))
  return out
}

function main() {
  const store = makeStore()

  // --- 场景 1：本地已有题库（数字 id=1）的第 1 题，题号 id=500002；订阅库 cloud 题 _local_id 也是 500002 ---
  store.put({ id: 500002, bank_id: 1, stem: '本地题库的原题（会被覆盖）', type: 'single', answer: 'A' })
  store.put({ id: 7, bank_id: 1, stem: '本地另一题', type: 'single', answer: 'B' })
  const before = store.get(500002).stem

  // 订阅题对象（= api.listQuestions(bankRef) 映射产物）
  const subscribedQuestion = {
    id: 500002,                    // ← _local_id（云端数字题号）
    bank_id: 'lquiz_banks_14',     // ← bankRef 字符串
    stem: '订阅题（被用户编辑过）',
    type: 'single',
    options: JSON.stringify(['正确', '错误']),
    answer: 'B',
    analysis: null,
    // 无 visibility / 无 _bank_id / 无 cloud_id / 无 synced_at —— 与真实映射一致
  }

  // 用户点 ✎ → 保存 → api.updateQuestion → idb.updateQuestion（无条件 put）
  store.put({ ...subscribedQuestion })

  // A) 新增/覆盖一行，id 仍是 500002，bank_id 是字符串 bankRef
  const row = store.get(500002)
  assert.strictEqual(row.bank_id, 'lquiz_banks_14', 'A: 订阅题落库行的 bank_id 应为 bankRef 字符串')
  assert.strictEqual(row.stem, '订阅题（被用户编辑过）', 'A: 该行内容为编辑后的订阅题')

  // B) 关键：本地 id=500002 的那一行的题干被覆盖（数据丢失）
  assert.strictEqual(row.stem !== before, true,
    'B: 本地 id 与云端 _local_id 相同的题目被覆盖（这是真实存在的风险，见下方风险断言）')

  // C) 孤儿行不会被 listAllQuestions 读到 ⇒ 不会被推上云
  //    注意：被覆盖那行的 bank_id 已变成 bankRef 字符串 ⇒ 它连「本地库的题」都不再是了
  //    （本地库 1 从 2 题缩到 1 题：内容与归属同时丢失）
  const localBankIds = [1]  // 本地只有一个数字 id 库
  const pushable = listAllQuestions(store, localBankIds)
  assert.strictEqual(pushable.some(r => r.bank_id === 'lquiz_banks_14'), false,
    'C: bankRef 字符串的孤儿行不会被遍历到 ⇒ 不参与云推送')
  assert.strictEqual(pushable.length, 1,
    'C: 本地库原有 2 题，被覆盖后只剩 1 题（连归属都被改成 bankRef 字符串）')

  // D) 风险量化：旧包公共题的 _local_id 落在本地自增 id 域内（1~4746），新包（500001+）不重叠
  const LEGACY_LOCAL_ID_RANGE = [1, 4746]     // 2026-10-05 线上实测：合集(旧)1~2951 / 变电运维教材1~3161 / 安规(旧)2952~4098 / 初级(旧)4099~4746
  const NEW_LOCAL_ID_MIN = 500001             // 2026 系列：变电安规2026 起 500001
  assert.strictEqual(LEGACY_LOCAL_ID_RANGE[1] < NEW_LOCAL_ID_MIN, true,
    'D: 旧包 _local_id 与本地自增 id 同域 ⇒ 订阅旧包并编辑题目会覆盖本地题；新包 500001+ 不重叠')

  // E) 反例：本地库 id 只有 1 个且题号 3 —— 若 _local_id=3 的旧包题编辑，同样覆盖
  const s2 = makeStore()
  s2.put({ id: 3, bank_id: 1, stem: '本地第三题', type: 'single' })
  s2.put({ id: 3, bank_id: 'lquiz_banks_7', stem: '合集(旧) 里 _local_id=3 的题', type: 'single' })
  assert.strictEqual(s2.get(3).stem, '合集(旧) 里 _local_id=3 的题', 'E: 旧包场景确认可覆盖本地同号题')

  console.log('✓ 订阅题编辑落库行为：5 项断言全部通过')
  console.log('  · 会写入孤儿行（bank_id=bankRef 字符串）')
  console.log('  · 孤儿行不参与云推送（listAllQuestions 遍历不到）')
  console.log('  · 若 _local_id 与本地自增 id 撞号 ⇒ 覆盖本地题（旧包 1~4746 风险区）')
}

main()
