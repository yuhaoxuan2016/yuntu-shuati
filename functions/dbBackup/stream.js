// dbBackup 的流式打包（2026-10-03）
//
// 背景：原实现把整个集合读进数组再 JSON.stringify——questions 单条平均 2.76KB（knowledge 占六成），
// 3.3 万条时解压后 92MB，对象图 + 序列化 + 包络串 + Buffer 峰值把 512MB 容器顶到 482.6MB。
// 改为「分页取 → 逐条写 gzip 流」，全程只驻留一页（1000 条 ≈ 2.7MB）与压缩输出。
//
// 两遍走同一个分页器：
//   第一遍 packArray    → 纯 rows 数组（异地推送用，格式与历史一致）
//   第二遍 packEnvelope → {collection,date,count,rows}（云存储用，**键序与历史一致**，count 取第一遍的实测条数）
// fetchPage 由调用方注入（真实实现见 index.js 的 cloudPageFetcher），这样本文件可离线单测。
'use strict'
const zlib = require('zlib')

function sink() {
  const chunks = []
  const gz = zlib.createGzip()
  gz.on('data', (c) => chunks.push(c))
  const finish = () => new Promise((resolve, reject) => {
    gz.on('end', () => resolve(Buffer.concat(chunks)))
    gz.on('error', reject)
    gz.end()
  })
  return { gz, finish }
}

// _id 游标分页（与历史实现同一判据：游标必须单调前进，异常即抛错而不是转圈）
async function* pages(fetchPage, pageSize) {
  let lastId = null
  for (let page = 0; ; page++) {
    if (page > 500) throw new Error(`分页超过 500 页，游标疑似未推进（lastId=${String(lastId)}）`)
    const rows = await fetchPage(lastId, pageSize)
    if (!rows || !rows.length) return
    yield rows
    lastId = rows[rows.length - 1]._id
    if (rows.length < pageSize) return
  }
}

async function packArray(fetchPage, pageSize) {
  const { gz, finish } = sink()
  let count = 0
  gz.write('[')
  for await (const rows of pages(fetchPage, pageSize)) {
    for (const row of rows) {
      gz.write((count ? ',' : '') + JSON.stringify(row))
      count++
    }
  }
  gz.write(']')
  return { count, buf: await finish() }
}

async function packEnvelope(fetchPage, name, dateIso, count, pageSize) {
  const { gz, finish } = sink()
  gz.write(`{"collection":${JSON.stringify(name)},"date":${JSON.stringify(dateIso)},"count":${count},"rows":[`)
  let n = 0
  for await (const rows of pages(fetchPage, pageSize)) {
    for (const row of rows) {
      gz.write((n ? ',' : '') + JSON.stringify(row))
      n++
    }
  }
  gz.write(']}')
  if (n !== count) {
    // 备份窗口内有人写入时两遍条数可能不同——不阻断，但必须留痕（元数据里的 count 是第一遍的数）
    console.warn(`[dbBackup] ⚠️ ${name} 两遍行数不一致：第一遍 ${count}、第二遍 ${n}（窗口内有写入）`)
  }
  return finish()
}

async function buildBackups({ fetchPage, name, dateIso, pageSize = 1000 }) {
  const plain = await packArray(fetchPage, pageSize)
  const envelopeGz = await packEnvelope(fetchPage, name, dateIso, plain.count, pageSize)
  return { count: plain.count, plainGz: plain.buf, envelopeGz }
}

module.exports = { buildBackups, pages }
