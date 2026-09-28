// bank-provenance 的正反例断言（与 update-check 同一套写法：esbuild 现场编译真实现 → require 再跑）
//   node tests/bank-provenance.test.cjs
//
// 为什么这份要单独存在：这个判据同时管着「卡片上那条 🔄 提示」「⋯ 菜单里的更新项」和
// 「提交到公共题库」三个入口，而它的**反面**（把文件导入的库误判成副本）会让公共库的解析
// 被写进用户自己导入的题里。宁可漏认（少个入口），不能错认。
const fs = require('fs')
const os = require('os')
const path = require('path')
const esbuild = require('esbuild')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src', 'lib', 'bank-provenance.ts')
if (!fs.existsSync(SRC)) { console.error(`✗ 找不到被测实现：${SRC}`); process.exit(1) }

const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bank-provenance-')), 'bank-provenance.cjs')
esbuild.buildSync({ entryPoints: [SRC], outfile: outFile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning' })
const P = require(outFile)

let pass = 0, fail = 0
function t (name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? pass++ : fail++
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  得到 ${JSON.stringify(got)} 期望 ${JSON.stringify(want)}`}`)
}

// 公共库列表（照线上形态：2026 五库都有 description、creator 都是 rabbit）
const PUB = [
  { _id: 'lquiz_banks_16', name: '中级2026' },
  { _id: 'lquiz_banks_15', name: '初级2026' },
]

console.log('— findSourceBank：定位来源')
t('origin_ref 精确命中', P.findSourceBank({ name: '改名过的副本', origin_ref: 'lquiz_banks_16' }, PUB)._id, 'lquiz_banks_16')
t('origin_ref 查无 → 退回名字兜底', P.findSourceBank({ name: '初级2026', origin_ref: 'lquiz_banks_999' }, PUB)._id, 'lquiz_banks_15')
t('无 origin_ref 按名字命中（老副本路径）', P.findSourceBank({ name: '中级2026' }, PUB)._id, 'lquiz_banks_16')
t('名字也不命中 → null', P.findSourceBank({ name: '我自己出的题' }, PUB), null)
t('空名 → null（不是拿空串去撞）', P.findSourceBank({ name: '' }, PUB), null)

console.log('— isPublicCopy：要不要给「从公共题库更新」入口')
t('① origin_ref 在 → true（不依赖网络，公共库列表空也算）', [P.isPublicCopy({ origin_ref: 'lquiz_banks_16' }, []), P.isPublicCopy({ origin_ref: 'lquiz_banks_16' }, PUB)], [true, true])
t('② 老副本（无 origin_ref + 名字命中 + private）→ true', P.isPublicCopy({ name: '中级2026', visibility: 'private' }, PUB), true)
t('③ 文件导入的私人库（名字撞车 + visibility=public）→ **false**（本次修的就是它）', P.isPublicCopy({ name: '中级2026', visibility: 'public' }, PUB), false)
t('④ 名字不撞 → false', P.isPublicCopy({ name: '我的题库', visibility: 'private' }, PUB), false)
t('⑤ 兜底不因 visibility=private 就放行：名字不撞仍是 false', P.isPublicCopy({ name: '另一份', visibility: 'private' }, PUB), false)
t('⑥ 脏输入不炸', [P.isPublicCopy(null, null), P.isPublicCopy({}, []), P.isPublicCopy({ name: 'x' }, null)], [false, false, false])

console.log('— 反向对照：③ 与 ② 只差 visibility 一个字段')
const fileImport = { name: '中级2026', visibility: 'public' }
const legacyCopy = { name: '中级2026', visibility: 'private' }
t('同一名字，仅 visibility 不同 ⇒ 结论相反', [P.isPublicCopy(fileImport, PUB), P.isPublicCopy(legacyCopy, PUB)], [false, true])

console.log(`\n${fail === 0 ? '全绿' : '有失败'}：${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
