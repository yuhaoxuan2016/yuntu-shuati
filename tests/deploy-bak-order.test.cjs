// 2026-09-28：服务器部署脚本（scripts/deploy-check.cjs，**gitignored**，仓库里看不到）里
// 「哪两个 bak 是最新的」这条判据的回归守卫。
//
// 为什么单独钉它：bak 目录名混着两种时间格式（`shuati.bak-20260927-020708` 旧式 5 段 /
// `shuati.bak-2026-09-28T05-55-46-819Z` ISO 新式）。按字符串 `.sort()` 排，第 16 位
// `2026-` 的 `-`(0x2D) 比 `20260` 的 `0`(0x30) 小 ⇒ **最新的那版排在最前**，
// reverse 后落到最后 —— 于是「保留最近两版 assets」取到的是最旧两版，
// 而「只留 2 个 bak」的 shift() 删掉的正是刚换下来的那一版。
// 今晚实测被吃掉一次：上一版构建的 cloud-DJUMhYca.js 因此已经取不回来了。
//
// 用法: node tests/deploy-bak-order.test.cjs
const fs = require('fs')
const path = require('path')

const SRC = path.resolve(__dirname, '../scripts/deploy-check.cjs')
if (!fs.existsSync(SRC)) {
  console.error(`❌ 找不到 ${SRC}\n   这脚本是服务器部署脚本的本地副本（被 gitignore），换机器要先从服务器 /opt/shuati-ops/deploy-check.cjs 拉回来。`)
  process.exit(2)
}
const lines = fs.readFileSync(SRC, 'utf8').split(/\r?\n/)

// 切片：bakKey（多行）+ sortBaksDesc（单行）在源文件里是**紧挨着的**，
// 所以取「bakKey 那一行 → sortBaksDesc 那一行（含）」这一整块即可 —— 不再到处找收尾花括号。
function findLine (re, label) {
  const i = lines.findIndex(l => re.test(l))
  if (i < 0) throw new Error(`切片失败：找不到 ${label}（源文件改过形状的话，判据要跟着改，别让守卫静默放行）`)
  return i
}
const s = findLine(/^\s*const bakKey = /, 'bakKey')
const e = findLine(/^\s*const sortBaksDesc = /, 'sortBaksDesc')
if (e < s) throw new Error('切片失败：sortBaksDesc 不在 bakKey 之后')
const code = lines.slice(s, e + 1).join('\n')
const { bakKey, sortBaksDesc } = new Function(`${code}\nreturn { bakKey, sortBaksDesc }`)()

let failed = 0
const ok = m => console.log('   ✓ ' + m)
const bad = m => { console.log('   ✗ ' + m); failed++ }

// 今晚服务器上真实存在过的那一坨名字（两种格式混在一起）
const DIRS = [
  'shuati.bak-20260927-020708',
  'shuati.bak-20260927-022851',
  'shuati.bak-2026-09-28T05-54-26-945Z',
  'shuati.bak-2026-09-28T05-55-46-819Z',
]

console.log('切片：bakKey + sortBaksDesc（真实源码，不是抄的）')
const desc = sortBaksDesc(DIRS)
desc[0] === 'shuati.bak-2026-09-28T05-55-46-819Z'
  ? ok('降序第一个＝最新那版')
  : bad(`降序第一个是 ${desc[0]}（应为 09-28T05-55-46）`)
desc[1] === 'shuati.bak-2026-09-28T05-54-26-945Z'
  ? ok('第二个＝次新那版')
  : bad(`第二个是 ${desc[1]}`)

// 反证：旧写法（字符串 sort + reverse）把**最新两版挤到队尾** ⇒ `slice(0,2)` 取到的全是陈年 bak。
// 今晚就是这么被吃掉的：合并取的是 09-27 那两版，刚换下来的 09-28 版反而没被并入。
const naive = DIRS.slice().sort().reverse()
const naiveTop2 = naive.slice(0, 2)
naiveTop2.every(d => !d.includes('2026-09-28'))
  ? ok(`反证：旧写法 slice(0,2)＝[${naiveTop2.join(', ')}] ⇒ 最新两版一个都没取到（病灶成立）`)
  : bad('反证失败：旧写法竟然取到了最新那版 ⇒ 本条判据不成立，别拿它当证据')
// 旧删法（升序 + shift）：删掉的正是最新两版
const naiveAsc = DIRS.slice().sort()
const naiveDoomed = [naiveAsc.shift(), naiveAsc.shift()]
naiveDoomed.every(d => d.includes('2026-09-28'))
  ? ok(`反证：旧写法 shift() 删掉的是 [${naiveDoomed.join(', ')}] ＝最新两版（所以旧 bak 越留越新）`)
  : bad('反证失败：旧删法没删到最新版')

// 「只留 2 个 bak」的删法：必须从最旧的删起
const doomed = []
const list = desc.slice()
while (list.length > 2) doomed.push(list.pop())
doomed.join(',') === ['shuati.bak-20260927-020708', 'shuati.bak-20260927-022851'].join(',')
  ? ok('新写法：保留最近 2 版、删掉更旧的两版（不再吃掉刚换下来的那一版）')
  : bad(`要删的是 ${doomed.join(', ')} —— 最新的被删就是回归`)

// 补齐位数：旧式 14 位 vs 新式 17 位，比的是同一个时间轴
bakKey('shuati.bak-20260927-020708') < bakKey('shuati.bak-2026-09-28T05-54-26-945Z')
  ? ok('位数补齐后跨格式可比（09-27 < 09-28）')
  : bad('跨格式比较仍失真')

console.log(failed ? `\n有失败：${failed} 项` : '\n全绿')
process.exit(failed ? 1 : 0)
