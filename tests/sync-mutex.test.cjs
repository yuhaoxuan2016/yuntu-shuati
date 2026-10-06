// 2026-10-07 · 同步全局互斥（断言 + 反向对照）
// 用法（cwd = shuati-pwa）：node tests/sync-mutex.test.cjs
//
// 起因（07:09 rabbit 问「网页版页面变化会改变同步状态吗？会不会出现多次同步」）：
//   `cloudState.syncing` 全仓**只写不读** ⇒ 无重入守卫。页面切换本身安全（唯一自动入口是
//   App.vue 启动钩子），但**跨入口并发**真实存在：首页胶囊 / 练习页按钮 / 设置页 4 处 / 轻推，
//   彼此无互斥 ⇒ 两个 syncAll 可同时跑、同身份并发推拉，最坏**两份进度互相覆盖**；
//   且 pushToCloud / syncFromCloud 各自收尾写 syncing=false ⇒ 先结束的那个会把还在跑的那轮
//   标成「已完成」，状态显示也会骗人。
//
// 语义（本文件钉死）：同一时刻只跑一轮；后来者**复用同一 Promise**（不重复请求、不排队开第二轮）。
// 本文件用**真实源码切片**（exclude 掉 IO 相关的 import，只测互斥壳）。
const fs = require('fs')
const path = require('path')
const esbuild = require('esbuild')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src', 'lib', 'sync-mutex.ts')
if (!fs.existsSync(SRC)) { console.error('✗ 找不到被测实现：' + SRC); process.exit(1) }

const raw = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n')
const noImports = raw.replace(/^import[^\n]*\n/gm, '').replace(/^export /gm, '')
const code = esbuild.transformSync(noImports, { loader: 'ts', format: 'cjs' }).code

const M = new Function('module', 'exports',
  code + '\nreturn { runExclusive, isSyncBusy, onSyncBusyChange, __resetSyncMutex }'
)({ exports: {} }, {})

let pass = 0, fail = 0
function ok (name, cond, extra) {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; console.log('✗', name, extra ? '\n   ' + extra : '') }
}
function eq (name, actual, expected) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected),
    '实际:' + JSON.stringify(actual) + ' 期望:' + JSON.stringify(expected))
}
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))

async function main () {
console.log('── ① 同一时刻只跑一轮：第二个调用复用第一个的 Promise ──')
{
  M.__resetSyncMutex()
  let runs = 0
  const fn = async () => { runs++; await tick(20); return 'done' }
  const p1 = M.runExclusive('syncAll', fn)
  const p2 = M.runExclusive('syncAll', fn)
  ok('两个调用返回同一个 Promise（不排队开第二轮）', p1 === p2)
  ok('忙碌中 isSyncBusy() 为真', M.isSyncBusy() === true)
  const r = await Promise.all([p1, p2])
  eq('实际只执行了一次', runs, 1)
  eq('两个调用都拿到同一结果', r, ['done', 'done'])
  ok('结束后 isSyncBusy() 为假', M.isSyncBusy() === false)
}

console.log('\n── ② 结束后可再跑（互斥不是"只跑一次"）──')
{
  M.__resetSyncMutex()
  let runs = 0
  const fn = async () => { runs++; await tick(5); return runs }
  eq('第一次', await M.runExclusive('syncAll', fn), 1)
  eq('第二次（互斥已释放）', await M.runExclusive('syncAll', fn), 2)
  eq('确实跑了两轮', runs, 2)
}

console.log('\n── ③ 失败也要释放锁（否则一次报错会永久卡死同步）──')
{
  M.__resetSyncMutex()
  let calls = 0
  const boom = async () => { calls++; throw new Error('network down') }
  let caught = ''
  try { await M.runExclusive('syncAll', boom) } catch (e) { caught = e.message }
  eq('异常如实抛出（不吞）', caught, 'network down')
  ok('❗锁已释放（失败后仍能再跑）', M.isSyncBusy() === false)
  eq('还能再跑一次（反向对照：锁没卡死）', await M.runExclusive('syncAll', async () => 'ok2'), 'ok2')
  eq('失败那次确实执行了', calls, 1)
}

console.log('\n── ④ 不同 label 也走同一把锁（跨入口必须互斥）──')
{
  M.__resetSyncMutex()
  let runs = 0
  const fn = async () => { runs++; await tick(15); return 'x' }
  const a = M.runExclusive('home-chip', fn)
  const b = M.runExclusive('settings-btn', fn)
  ok('首页胶囊 与 设置页按钮 复用同一 Promise', a === b)
  await Promise.all([a, b])
  eq('只跑了一次（跨入口互斥）', runs, 1)
}

console.log('\n── ⑤ 并发三个也只跑一次 ──')
{
  M.__resetSyncMutex()
  let runs = 0
  const fn = async () => { runs++; await tick(10); return 1 }
  const ps = [M.runExclusive('a', fn), M.runExclusive('b', fn), M.runExclusive('c', fn)]
  ok('三个 Promise 全等', ps[0] === ps[1] && ps[1] === ps[2])
  await Promise.all(ps)
  eq('只执行一次', runs, 1)
}

console.log('\n── ⑥ 源码级：入口函数真的用了这把锁 ──')
{
  const cloud = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'cloud.ts'), 'utf8')
  ok('cloud.ts import 了 runExclusive', /import[^\n]*runExclusive[^\n]*from '\.\/sync-mutex'/.test(cloud))
  ok('❗反向对照：syncAll 的实体被包进 runExclusive（不是只 import 不用）',
    /runExclusive\(\s*'syncAll'/.test(cloud))
  ok('❗反向对照：pushToCloud 与 syncFromCloud 也各自上锁',
    /runExclusive\(\s*'pushToCloud'/.test(cloud) && /runExclusive\(\s*'syncFromCloud'/.test(cloud))
  ok('轻推/自动拉这两个静默路径同样上锁',
    /runExclusive\(\s*'progress-light'/.test(cloud) && /runExclusive\(\s*'auto-pull'/.test(cloud))
  const busyReads = (cloud.match(/isSyncBusy\(\)/g) || []).length
  ok('cloudState.syncing 不再是"只写不读"（有 isSyncBusy 读它）', busyReads >= 1, '实际读处:' + busyReads)
  ok('syncing 由锁驱动（订阅 onSyncBusyChange，不再各处手写）', /onSyncBusyChange\(/.test(cloud))
  ok('❗反向对照：cloud.ts 里已无手写的 syncing = true', !/cloudState\.syncing = true/.test(cloud))
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
}
main()
