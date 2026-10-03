#!/usr/bin/env node
// dbBackup 流式打包的离线断言（零依赖；被 functions/dbBackup/stream.js 的真实实现对拍）
//
// 为什么单独测：这段代码跑在云函数里，改错一次就是「备份静默残缺」——本地必须能先证死。
// 记法：node tests/dbbackup-stream.test.cjs
'use strict'
const zlib = require('zlib')
const path = require('node:path')
const { buildBackups } = require(path.resolve(__dirname, '../functions/dbBackup/stream.js'))

const ck = []
const t = (name, ok, got) => { ck.push(ok); console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : '  → ' + JSON.stringify(got)}`) }

const gunzipJson = (buf) => JSON.parse(zlib.gunzipSync(buf).toString('utf8'))

/** 假分页器：按 _id 升序吐页 */
function makeFetcher(docs, pageSize) {
  const calls = []
  return {
    calls,
    fetchPage(lastId, limit) {
      calls.push({ lastId, limit })
      const start = lastId === null ? 0 : docs.findIndex((d) => d._id > lastId)
      if (start < 0) return Promise.resolve([])
      return Promise.resolve(docs.slice(start, start + Math.min(limit, pageSize)).map((d) => ({ ...d })))
    },
  }
}

async function main() {
  // ① 基本形状：2500 条跨 3 页
  const docs = Array.from({ length: 2500 }, (_, i) => ({ _id: `id-${String(i).padStart(5, '0')}`, stem: `题 ${i}`, option: ['A', 'B', 'C'] }))
  const f1 = makeFetcher(docs, 1000)
  const r1 = await buildBackups({ fetchPage: f1.fetchPage, name: 'demo', dateIso: '2026-10-03T13:40:00.000Z' })
  t('条数＝实际行数', r1.count === 2500, r1.count)
  t('两个产物都是 gzip（magic 1f 8b）', r1.plainGz[0] === 0x1f && r1.plainGz[1] === 0x8b && r1.envelopeGz[0] === 0x1f && r1.envelopeGz[1] === 0x8b, [r1.plainGz[0], r1.plainGz[1]])
  const plain = gunzipJson(r1.plainGz)
  const env = gunzipJson(r1.envelopeGz)
  t('纯数组可解析且长度正确', Array.isArray(plain) && plain.length === 2500, plain.length)
  t('包络字段与历史一致（collection/date/count/rows）', env.collection === 'demo' && env.date === '2026-10-03T13:40:00.000Z' && env.count === 2500 && Array.isArray(env.rows), Object.keys(env))
  t('包络键序＝collection→date→count→rows（字节级）',
    zlib.gunzipSync(r1.envelopeGz).toString('utf8').startsWith('{"collection":"demo","date":"2026-10-03T13:40:00.000Z","count":2500,"rows":['),
    zlib.gunzipSync(r1.envelopeGz).toString('utf8').slice(0, 80))
  t('两遍 rows 结构等价', JSON.stringify(env.rows) === JSON.stringify(plain), '')
  // ② 游标纪律：不重不漏
  const ids = plain.map((d) => d._id)
  t('不重不漏（2500 个唯一 _id，且升序）', new Set(ids).size === 2500 && ids[0] === 'id-00000' && ids[2499] === 'id-02499', [new Set(ids).size, ids[0], ids[ids.length - 1]])
  t('游标分页调用序列正确（null→id-00999→id-01999）', f1.calls.length === 6 && f1.calls[0].lastId === null && f1.calls[1].lastId === 'id-00999' && f1.calls[2].lastId === 'id-01999', f1.calls.map((c) => c.lastId))
  t('每页 limit 透传（1000）', f1.calls.every((c) => c.limit === 1000), f1.calls[0])
  // ③ 空集合
  const r2 = await buildBackups({ fetchPage: makeFetcher([], 1000).fetchPage, name: 'empty', dateIso: 'x' })
  t('空集合：count=0、两个产物可解析', r2.count === 0 && gunzipJson(r2.plainGz).length === 0 && gunzipJson(r2.envelopeGz).rows.length === 0, r2.count)
  // ④ 两遍不一致只告警不中断：第一遍 2500 条（3 次调用），第二遍起多一条
  let warned = ''
  const origWarn = console.warn
  console.warn = (s) => { warned = String(s) }
  let calls = 0
  const flaky = (lastId, limit) => {
    calls++
    const all = calls <= 3 ? docs : [...docs, { _id: 'zzz-new', stem: '窗口内新增' }]
    return makeFetcher(all, 1000).fetchPage(lastId, limit)
  }
  const r3 = await buildBackups({ fetchPage: flaky, name: 'flaky', dateIso: 'x' })
  console.warn = origWarn
  t('窗口内新增：不抛错、第一遍条数为准、有告警留痕', r3.count === 2500 && warned.includes('两遍行数不一致'), { count: r3.count, warned: warned.slice(0, 40) })
  // ⑤ 内存硬判据：**在 192MB V8 堆上限下**跑完 3 万条 × 2.7KB（≈81MB 原始数据）。
  //    用子进程 + --max-old-space-size 而不是采样 rss——rss 是水位不是活集，GC 惰性回收会把它顶高（实测 504MB），
  //    而堆上限是硬墙：旧实现（两次全量序列化）在这条线上必死，流式实现应当稳过。
  const BIG_N = 30000
  const bigDocs = (start, n) => Array.from({ length: n }, (_, i) => ({
    _id: `b-${String(start + i).padStart(6, '0')}`,
    stem: '【判断题】' + '填'.repeat(60),
    knowledge: '考'.repeat(2400),
    analysis: '解'.repeat(700),
    options: '["正确","错误"]',
  }))
  const bigFetch = (lastId, limit) => {
    const start = lastId === null ? 0 : Number(String(lastId).slice(2)) + 1
    if (start >= BIG_N) return Promise.resolve([])
    return Promise.resolve(bigDocs(start, Math.min(limit, BIG_N - start)))
  }
  if (process.argv.includes('--bigmem-child')) {
    const r4 = await buildBackups({ fetchPage: bigFetch, name: 'big', dateIso: 'x' })
    console.log(`CHILD_OK count=${r4.count} heapUsed=${Math.round(process.memoryUsage().heapUsed / 1048576)}MB`)
    return
  }
  const { spawnSync } = require('node:child_process')
  const child = spawnSync(process.execPath, ['--max-old-space-size=192', __filename, '--bigmem-child'], { encoding: 'utf8' })
  t('192MB 堆上限下跑完 3 万条 × 2.7KB（旧实现在这条线上必死）', child.status === 0 && /CHILD_OK count=30000/.test(child.stdout), { status: child.status, out: (child.stdout || '').trim().slice(-80), err: (child.stderr || '').trim().split('\n').slice(-2).join(' | ').slice(0, 200) })
  const bad = ck.filter((x) => !x).length
  console.log(`\n${bad === 0 ? '✅ 全部通过' : '❌ 有失败'} ${ck.length - bad}/${ck.length}`)
  process.exit(bad === 0 ? 0 : 1)
}

main().catch((e) => { console.error('❌ 测试自身抛错：', e); process.exit(1) })
