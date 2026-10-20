#!/usr/bin/env node
// admin-api 鉴权纯函数守卫（2026-10-20，P1-41）。
// 从 functions/admin-api/index.js 切真源码（decideAuth / hashPassword / hashMatches + 三个常量），
// 不 import 云 SDK、不连云端。跑法：node tests/admin-auth.test.cjs
'use strict'
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

let pass = 0
let fail = 0
function eq(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) { pass++; console.log('✓', name) } else { fail++; console.log('✗', name, '\n  实际:', JSON.stringify(actual), '\n  期望:', JSON.stringify(expected)) }
}

const src = fs.readFileSync(path.join(__dirname, '..', 'functions', 'admin-api', 'index.js'), 'utf8').replace(/\r\n/g, '\n')
function pick(re, label) {
  const m = src.match(re)
  if (!m) { console.error(`❌ 切片锚点漂移：${label}`); process.exit(2) }
  return m[0]
}
const parts = [
  pick(/const FAIL_LIMIT = \d+/, 'FAIL_LIMIT'),
  pick(/const FAIL_WINDOW_MS = [^\n]+/, 'FAIL_WINDOW_MS'),
  pick(/const LOCK_MS = [^\n]+/, 'LOCK_MS'),
  pick(/function decideAuth\(state, passwordOk, now\) \{[\s\S]*?\n\}/, 'decideAuth'),
  pick(/function hashPassword\(salt, given\) \{[\s\S]*?\n\}/, 'hashPassword'),
  pick(/function hashMatches\(salt, given, expected\) \{[\s\S]*?\n\}/, 'hashMatches'),
]
const factory = new Function(
  'crypto', 'Buffer',
  parts.join('\n') + '\nreturn { decideAuth, hashPassword, hashMatches, FAIL_LIMIT, FAIL_WINDOW_MS, LOCK_MS }',
)
const mod = factory(crypto, Buffer)

const salt = 'test-salt'
const good = mod.hashPassword(salt, 'correct horse battery')
eq('正确口令匹配', mod.hashMatches(salt, 'correct horse battery', good), true)
eq('错误口令不匹配', mod.hashMatches(salt, 'wrong', good), false)
eq('空 expected 一律不匹配', mod.hashMatches(salt, 'x', ''), false)

const now = 1700000000000
const r1 = mod.decideAuth(null, false, now)
eq('首次失败：计数 1、不锁', [r1.outcome, r1.nextState.fail_count, r1.nextState.locked_until], ['bad', 1, 0])

let st = null
let last = null
for (let i = 0; i < mod.FAIL_LIMIT; i++) { last = mod.decideAuth(st, false, now + i); st = last.nextState }
eq('第 FAIL_LIMIT 次失败触发锁定', [last.justLocked, last.nextState.fail_count, last.nextState.locked_until], [true, mod.FAIL_LIMIT, now + mod.FAIL_LIMIT - 1 + mod.LOCK_MS])

eq('锁定期内即使口令正确也拒', mod.decideAuth(st, true, now + 1000).outcome, 'locked')
eq('锁过期 + 窗口已过：计数重置为 1', (() => {
  const r = mod.decideAuth({ locked_until: now - 1, fail_count: 5, window_at: now - mod.FAIL_WINDOW_MS - 1 }, false, now)
  return [r.outcome, r.nextState.fail_count, r.nextState.locked_until]
})(), ['bad', 1, 0])
eq('成功后清零', (() => {
  const r = mod.decideAuth({ fail_count: 4, window_at: now, locked_until: 0 }, true, now)
  return [r.outcome, r.nextState.fail_count, r.nextState.locked_until]
})(), ['ok', 0, 0])

console.log(`\n${fail === 0 ? '全绿' : '有失败'}：${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
