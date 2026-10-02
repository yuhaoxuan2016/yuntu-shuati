// 回归测试：IndexedDB 写入不得因「响应式 Proxy」抛 DataCloneError。
// 背景（2026-10-02 rabbit 报）：创建学习计划失败，报
//   `Failed to execute 'add' on 'IDBObjectStore': [object Array] could not be cloned.`
// 机制：订阅库的 key 是「响应式数组 `subs[i]` 的元素」，经 `v-model="form.bankIds"` 收进表单后
// 原样落库；IndexedDB 用结构化克隆，而 Proxy 不可克隆。
// 本测试同时钉住 src/lib/db.ts 的 `plain()` 兜底语义（按值还原，不把包装对象降级成 {}）。
let fails = 0
function check (name, cond) {
  if (cond) console.log('  PASS ' + name)
  else { console.log('  FAIL ' + name); fails++ }
}

// 极简 Proxy 包裹，模拟 Vue 的 reactive 数组：
// 只要 `subs` 是 reactive 数组，读 `subs[i]` 拿到的就是 Proxy（Vue 3 的 get 会 wrap 返回值）。
function reactiveArray (arr) {
  const wrap = (v) => {
    if (v !== null && typeof v === 'object') return new Proxy(v, { get: (t, k) => t[k] })
    // 模拟 Vue：原始值也被包成带 valueOf/toString 的代理对象
    return new Proxy({ valueOf: () => v, toString: () => String(v) }, { get: (t, k) => t[k] })
  }
  return new Proxy(arr.map(wrap), {
    get: (t, k) => (k === 'length' ? t.length : wrap(t[k])),
  })
}

// ---- 第一组：机制确认 ----
const cleanBankIds = ['lquiz_banks_abc']
let cleanOk = true
try { structuredClone({ bankIds: cleanBankIds }) } catch { cleanOk = false }
check('纯字符串 bankIds 可 structuredClone', cleanOk)

const subs = reactiveArray(['lquiz_banks_abc', 'lquiz_banks_def'])
const dirtyBankIds = [subs[0]]            // 模拟 v-model="form.bankIds" :value="bank.key"
let dirtyOk = true
try { structuredClone({ bankIds: dirtyBankIds }) } catch { dirtyOk = false }
check('含 Proxy 元素的 bankIds 会 DataCloneError', dirtyOk === false)

let numOk = true
try { structuredClone({ bankIds: [1, 2, 3] }) } catch { numOk = false }
check('数字 key（本地库）不会 DataCloneError', numOk)

// ---- 第二组：src/lib/db.ts 的 plain() / normalize() 兜底语义（逐字复刻）----
function normalize (v) {
  if (v === null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map(normalize)
  // 判据用 typeof valueOf，**不能**用 instanceof —— Vue 的 Proxy 让 `proxy instanceof Number` 为 false
  try {
    if (typeof v.valueOf === 'function') {
      const prim = v.valueOf()
      if (prim !== v && (prim === null || typeof prim !== 'object')) return prim
    }
  } catch { /* 取不到原始值就按普通对象继续降级 */ }
  const out = {}
  for (const k of Object.keys(v)) {
    try { out[k] = normalize(v[k]) } catch { /* 单字段失败不影响其余 */ }
  }
  return out
}
function plain (d) {
  if (d === null || typeof d !== 'object') return d
  try { structuredClone(d); return d } catch { /* 见 db.ts */ }
  return normalize(d)
}

check('plain() 把字符串包装还原成原始字符串', plain({ bankIds: [subs[0]] }).bankIds[0] === 'lquiz_banks_abc')
check('plain() 后整个对象可 structuredClone', (() => {
  try { structuredClone(plain({ bankIds: [subs[0], subs[1]] })); return true } catch { return false }
})())
check('plain() 不误伤纯对象', JSON.stringify(plain({ o: { k: 'v' } })) === '{"o":{"k":"v"}}')
const cleanFixture = { a: 1, b: 's', c: [1, 2], d: { e: true }, f: null }
check('plain() 对纯 JSON 数据零改动', JSON.stringify(plain(cleanFixture)) === JSON.stringify(cleanFixture))
check('plain() 对非对象入参原样返回', plain(42) === 42 && plain(null) === null && plain('x') === 'x')

console.log(fails ? `\n${fails} 项断言失败` : '\n全部通过')
process.exit(fails ? 1 : 0)
