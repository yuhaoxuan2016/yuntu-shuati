// lib/update-check 的正反例断言（与 sync-ledger 同一套写法：esbuild 现场编译真实现 → require 再跑）
//   node tests/update-check.test.cjs
//
// 为什么这份要单独存在：这是「提示用户刷新」的判据，**宁可漏报也不能误报**——
// 误报会让所有人被一条假横幅催着刷新，漏报只是回到今天这样（用户停在旧壳里）。
const fs = require('fs')
const os = require('os')
const path = require('path')
const esbuild = require('esbuild')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src', 'lib', 'update-check.ts')
if (!fs.existsSync(SRC)) { console.error(`✗ 找不到被测实现：${SRC}`); process.exit(1) }

const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'update-check-')), 'update-check.cjs')
esbuild.buildSync({ entryPoints: [SRC], outfile: outFile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning' })
const U = require(outFile)

let fail = 0, pass = 0
function t (name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? pass++ : fail++
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  得到 ${JSON.stringify(got)} 期望 ${JSON.stringify(want)}`}`)
}

console.log('— entrySrcOf：从 index.html 文本里抠入口')
t('标准构建产物', U.entrySrcOf('<script type="module" crossorigin src="/assets/index-DtnPEJxf.js"></script>'), 'index-DtnPEJxf.js')
t('相对路径也认', U.entrySrcOf('<script src="./assets/index-abc12345.js">'), 'index-abc12345.js')
t('dev 的 /src/main.ts 抠不到（返回空）', U.entrySrcOf('<script type="module" src="/src/main.ts"></script>'), '')
t('空文本返回空', U.entrySrcOf(''), '')
t('undefined 不炸', U.entrySrcOf(undefined), '')
t('CSS 引用不会被误当入口', U.entrySrcOf('<link rel="stylesheet" href="/assets/index-zzz.css">'), '')

console.log('— isOutdated：两边都有且不同才算新版')
t('哈希不同 → true', U.isOutdated('index-old11111.js', 'index-new22222.js'), true)
t('相同 → false', U.isOutdated('index-same.js', 'index-same.js'), false)
t('当前拿不到 → false（宁可漏报）', U.isOutdated('', 'index-new22222.js'), false)
t('远端拿不到 → false（网络失败不该催人刷新）', U.isOutdated('index-old11111.js', ''), false)
t('两边都拿不到 → false', U.isOutdated('', ''), false)

console.log('— currentEntrySrc：无 DOM 环境下必须安全返回空串（node 里就这么跑）')
t('无 document 不抛', (() => { try { return U.currentEntrySrc() } catch (e) { return 'THREW:' + e.message } })(), '')

console.log(`\n${fail === 0 ? '全绿' : '有失败'}：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
