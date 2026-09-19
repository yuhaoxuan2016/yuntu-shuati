// P0-6（2026-09-15）：导入相关的两个派生量的纯函数，抽出来是为了能离线直接断言。
//
// ⚠️ 危害描述经复审核正（本段初版**说错了**，且错的那句还流进了确认文案与报告 §2）：
//   · `api.importFromHtml` / `api.importWithAi` 本身就是「先清空题库再写入」（`api.ts:108` / `:117`），
//     也就是说**导入这一步就已经把题库原有题目删掉了**——目前只由 step 1 的文案警告提示，
//     没有结构性防护（这是本发现里**唯一仍然敞着**的破坏力，见报告 concerns）。
//   · 因此用户走到 step 3 的「重新选择」时，题库里**只剩本次导入的题**。旧版那次无确认的
//     `clearBankQuestions`（整库清空）删掉的正是「重新选择」本来就该删的那批题，
//     **并不会**误删用户原有题目。初版那句「原有题目会被一并删掉」与确认文案里的
//     「题库原有题目保留」**两句都是错的**，只是方向相反。
//   · 旧版的真实缺陷是：**不可逆的批量删除没有任何确认**，一次误点即丢掉整卷。
//     **确认门禁才是本次真正的修复**；下面的差集只是把「删多少」算准，属**未来防护**——
//     一旦将来导入不再先清空，它才成为承重层。
//
// 差集的语义：导入前对题库 id 做快照、导入后取差集，「重新选择」只删本次新增的那些。

// 本次导入新产生的题目 id = 导入后的 id 集合减去导入前的快照。
// 比较按 String 归一化：若某处 id 出现 number / string 两种表示（题库 id 就有 number|string 联合），
// 用严格 === 会把「其实同一道题」判成新题 → 于是它会被「重新选择」删掉 = 数据丢失。
// 归一化只会让结果更保守（少删），不会把真正的新题判成旧题，故这是安全方向的取舍。
// 泛型 T 只为保留 after 的元素类型（调用方是 number[] 就得到 number[]），与归一化无关。
export function newQuestionIds<T extends number | string>(
  before: Array<number | string>,
  after: T[],
): T[] {
  const seen = new Set(before.map(id => String(id)))
  return after.filter(id => !seen.has(String(id)))
}

// 导入将替换的题量：导入是先清空再写入，故题库现有的每一题都会被替换掉。
export function replacedCount(before: Array<number | string>): number {
  return before.length
}
