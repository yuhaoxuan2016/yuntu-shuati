#!/usr/bin/env node
// 2026-10-20（P1-40）：零依赖测试总入口。
// 跑 tests/*.test.cjs 与 tests/*.test.ts；退出码 0=通过、2=缺夹具跳过、其它=失败。
// 需要先 build 或真实浏览器的 .mjs 探针不在本入口（见 package.json 的 pwa-* 说明）。
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TEST_DIR = path.join(ROOT, 'tests')
const TMP = path.join(ROOT, '.tmp-esbuild')
fs.mkdirSync(TMP, { recursive: true })

const files = fs.readdirSync(TEST_DIR)
  .filter(f => /\.test\.(cjs|ts)$/.test(f))
  .sort()

let pass = 0
let skip = 0
const failures = []
for (const f of files) {
  const full = path.join(TEST_DIR, f)
  const started = Date.now()
  const r = spawnSync(process.execPath, [full], {
    cwd: ROOT,
    env: { ...process.env, TEMP: TMP, TMP },
    encoding: 'utf8',
    timeout: 180000,
  })
  const ms = Date.now() - started
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim()
  if (r.status === 0) {
    pass++
    console.log(`PASS ${f} (${ms}ms)`)
  } else if (r.status === 2) {
    skip++
    console.log(`SKIP ${f}${out ? ' | ' + out.split('\n').pop() : ''}`)
  } else {
    failures.push({ f, status: r.status, out })
    console.log(`FAIL ${f} (rc=${r.status}, ${ms}ms)`)
  }
}

console.log(`\n合计 ${files.length}：通过 ${pass} / 跳过 ${skip} / 失败 ${failures.length}`)
for (const x of failures) {
  console.log(`\n===== ${x.f} rc=${x.status} =====\n${x.out.slice(-2000)}`)
}
process.exit(failures.length ? 1 : 0)
