// 备份恢复：settings 合并式恢复的回归测试（2026-10-05）
//
// 背景 bug：exportAll() 把 settings 存成**对象** `{key: value}`，
// 而 restoreBackup() 的判据是 `Array.isArray(data[k])` ⇒ settings 从来进不了恢复循环，
// 备份里的设置一条都不会回来（静默跳过）。项目第一版（dc5c654）起就存在。
//
// 本测试用 esbuild 现场编译真源码的 restoreBackup，配假的 idb 后端，
// 断言四条语义：
//   ① 对象格式的 settings 能被恢复；
//   ② 老格式（[{key,value}] 数组）也能恢复（向后兼容）；
//   3 敏感键（ai_api_key / ai_base_url / ai_base_url_ack）始终被跳过；
//   ④ 本机独有设置**不被清空**（合并而非覆盖）。
//
// 用法: node tests/backup-restore-settings.test.mjs
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const require = createRequire(import.meta.url)
// 复用项目自带的 esbuild 做 TS→JS 转换（transformSync 纯内存，不 spawn 子进程、不读文件系统）
const esbuild = require('esbuild')

let failures = 0
function check (name, cond, detail) {
  if (cond) { console.log('  ✓ ' + name) } else { failures++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')) }
}

// —— 从源码抽出 restoreBackup 的行为（避免依赖完整模块图）——
// 直接读源文件，取出 restoreBackup 函数体，注入假 m（idb）后执行。
const srcPath = path.join(ROOT, 'src/utils/api.ts')
const src = fs.readFileSync(srcPath, 'utf8')

const fnStart = src.indexOf('export async function restoreBackup')
if (fnStart < 0) { console.error('找不到 restoreBackup'); process.exit(2) }
// 花括号配平取函数体
let i = src.indexOf('{', fnStart), depth = 0, end = -1
for (; i < src.length; i++) {
  if (src[i] === '{') depth++
  else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break } }
}
const fnSrc = src.slice(fnStart, end)

// 依赖：BACKUP_PROTECTED_SETTING_KEYS 常量
const constMatch = src.match(/const BACKUP_PROTECTED_SETTING_KEYS = \[[^\]]*\]/)
if (!constMatch) { console.error('找不到 BACKUP_PROTECTED_SETTING_KEYS'); process.exit(2) }

// 把 restoreBackup 改造成可注入 m 的形式：
// 原实现里 `const db = await import('../lib/db'); const m = (db as any).idb`
// ⇒ 替换成 `const m = globalThis.__FAKE_IDB__`
const patched = fnSrc
  .replace("const db = await import('../lib/db')", 'const db = null')
  .replace('const m = (db as any).idb', 'const m = globalThis.__FAKE_IDB__')

// 去掉 TS 语法（类型注解）——用 esbuild transform（纯内存，不落中间文件）
const jsSrc = esbuild.transformSync(`
${constMatch[0]}
${patched.replace('export async function restoreBackup', 'async function restoreBackup')}
export { restoreBackup }
`, { loader: 'ts', format: 'esm' }).code
const tmp = path.join(ROOT, '.tmp-backup-test.mjs')
fs.writeFileSync(tmp, jsSrc, 'utf8')

const { restoreBackup } = await import('file://' + tmp.replace(/\\/g, '/'))

// —— 假 idb：用普通 Map 模拟各 store ——
function makeFakeIdb (seed = {}) {
  const stores = {}
  for (const [k, v] of Object.entries(seed)) stores[k] = new Map(v)
  return {
    stores,
    async getSetting (k) { return this.stores.settings?.get(k) ?? null },
    async setSetting (k, v) { (this.stores.settings ||= new Map()).set(k, v) },
    async clearStore (name) { this.stores[name] = new Map() },
    async bulkPut (name, rows) {
      this.stores[name] ||= new Map()
      for (const r of rows) this.stores[name].set(r.id ?? r.key, r)
    },
  }
}

console.log('== 备份恢复 · settings 合并语义 ==')

// ===== ① 对象格式（当前导出形态）能被恢复 =====
{
  const idb = makeFakeIdb({ settings: [['ui_theme', 'dark'], ['__local_only', 'KEEP']] })
  globalThis.__FAKE_IDB__ = idb
  await restoreBackup({
    banks: [{ id: 1, name: 'b' }],
    questions: [{ id: 1 }],
    settings: { ui_theme: 'light', ai_model: 'deepseek-chat' },
  })
  check('① 对象格式 settings：ui_theme 被备份值覆盖', idb.stores.settings.get('ui_theme') === 'light',
    'got ' + idb.stores.settings.get('ui_theme'))
  check('① 对象格式 settings：新增键 ai_model 被写入', idb.stores.settings.get('ai_model') === 'deepseek-chat',
    'got ' + idb.stores.settings.get('ai_model'))
  check('① 本机独有键 __local_only 未被清空', idb.stores.settings.get('__local_only') === 'KEEP',
    'got ' + idb.stores.settings.get('__local_only'))
}

// ===== ② 老格式（数组）向后兼容 =====
{
  const idb = makeFakeIdb({ settings: [] })
  globalThis.__FAKE_IDB__ = idb
  await restoreBackup({
    banks: [{ id: 1 }],
    settings: [{ key: 'ui_theme', value: 'sepia' }],
  })
  check('② 老数组格式也能恢复', idb.stores.settings.get('ui_theme') === 'sepia',
    'got ' + idb.stores.settings.get('ui_theme'))
}

// ===== ③ 敏感键始终跳过，且本机值保留 =====
{
  const idb = makeFakeIdb({
    settings: [['ai_api_key', 'LOCAL-KEY'], ['ai_base_url', 'https://api.deepseek.com/v1'], ['ai_base_url_ack', '']],
  })
  globalThis.__FAKE_IDB__ = idb
  await restoreBackup({
    banks: [{ id: 1 }],
    settings: { ai_api_key: 'EVIL-KEY', ai_base_url: 'https://attacker.example', ui_theme: 'light' },
  })
  check('③ 备份里的 ai_api_key 没覆盖本机', idb.stores.settings.get('ai_api_key') === 'LOCAL-KEY',
    'got ' + idb.stores.settings.get('ai_api_key'))
  check('③ 备份里的 ai_base_url 没覆盖本机', idb.stores.settings.get('ai_base_url') === 'https://api.deepseek.com/v1',
    'got ' + idb.stores.settings.get('ai_base_url'))
  check('③ ai_base_url_ack 保持本机值', idb.stores.settings.get('ai_base_url_ack') === '',
    'got ' + idb.stores.settings.get('ai_base_url_ack'))
  check('③ 同批里的普通设置仍被恢复', idb.stores.settings.get('ui_theme') === 'light',
    'got ' + idb.stores.settings.get('ui_theme'))
}

// ===== ③b 本机原本没有密钥时，备份里的密钥也不该被写入 =====
{
  const idb = makeFakeIdb({ settings: [] })
  globalThis.__FAKE_IDB__ = idb
  await restoreBackup({
    banks: [{ id: 1 }],
    settings: { ai_api_key: 'EVIL-KEY' },
  })
  check('③b 本机无密钥时，备份密钥不写入', idb.stores.settings.get('ai_api_key') === undefined,
    'got ' + idb.stores.settings.get('ai_api_key'))
}

// ===== ④ 题库/题目仍走覆盖式（不受本次改动影响）=====
{
  const idb = makeFakeIdb({ quiz_banks: [[99, { id: 99, name: '旧库' }]], questions: [[99, { id: 99 }]] })
  globalThis.__FAKE_IDB__ = idb
  await restoreBackup({ banks: [{ id: 1, name: '新库' }], questions: [{ id: 1 }] })
  check('④ 题库为覆盖式（旧库被清）', idb.stores.quiz_banks.size === 1 && idb.stores.quiz_banks.get(1)?.name === '新库',
    'size=' + idb.stores.quiz_banks.size)
  check('④ 题目为覆盖式', idb.stores.questions.size === 1 && idb.stores.questions.has(1),
    'size=' + idb.stores.questions.size)
}

// ===== ⑤ 只有 settings 的备份也能恢复（不再被 keys.length===0 拦掉）=====
{
  const idb = makeFakeIdb({ settings: [] })
  globalThis.__FAKE_IDB__ = idb
  let threw = null
  try { await restoreBackup({ settings: { ui_theme: 'light' } }) } catch (e) { threw = e.message }
  check('⑤ 只含 settings 的备份不报「无可恢复数据」', threw === null, 'threw: ' + threw)
  check('⑤ 且实际恢复了设置', idb.stores.settings.get('ui_theme') === 'light',
    'got ' + idb.stores.settings.get('ui_theme'))
}

// ===== ⑥ 完全空的备份仍应报错 =====
{
  const idb = makeFakeIdb({})
  globalThis.__FAKE_IDB__ = idb
  let threw = null
  try { await restoreBackup({ app: 'x' }) } catch (e) { threw = e.message }
  check('⑥ 空备份仍报「无可恢复数据」', /未包含任何可恢复的数据/.test(threw || ''), 'got ' + threw)
}

try { fs.unlinkSync(tmp) } catch {}

console.log('')
if (failures === 0) { console.log('✅ 全部通过'); process.exit(0) }
console.log('✗ 失败 ' + failures + ' 项'); process.exit(1)
