/**
 * 브리핑 — **조용한 날과 죽은 날을 가른다**
 *
 * 「특별한 일 없었습니다」만 적으면 정말 없었던 날과 수집이 죽어서 아무것도 못 본 날이
 * 똑같아 보인다. 둘은 정반대다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  computeBriefing, briefingLines, buildBriefingPrompt, type BriefingInput,
} from './briefing-core.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

const DAY: BriefingInput = {
  tradeDate: '2026-09-25',
  barsCollected: 380, judgments: 42, signals: 2,
  notificationsSent: 2, notificationsPending: 0,
  checksOk: 8, checksWarn: 0, checksFail: 0, checksUnknown: 0,
  actionsApplied: 0, actionsHandedOff: 0,
  realizedPnlKrw: 120000,
}

test('숫자를 그대로 옮기고 손볼 것을 센다', () => {
  const m = computeBriefing({ ...DAY, checksWarn: 1, checksFail: 2, checksUnknown: 1 })
  assert.equal(m.needsAttention, 4)
  assert.equal(m.barsCollected, 380)
})

test('★ 조용한 날과 죽은 날이 다르다', () => {
  const quiet = computeBriefing({ ...DAY, signals: 0 })
  assert.equal(quiet.quiet, true)
  assert.equal(quiet.silent, false)

  const dead = computeBriefing({ ...DAY, signals: 0, barsCollected: 0 })
  assert.equal(dead.silent, true, '봉이 0인데 조용한 날로 읽었다')
  assert.equal(dead.quiet, false, '수집이 안 돈 날을 조용한 날로 읽었다')
})

test('조치가 있었으면 조용한 날이 아니다', () => {
  assert.equal(computeBriefing({ ...DAY, signals: 0, actionsApplied: 1 }).quiet, false)
  assert.equal(computeBriefing({ ...DAY, signals: 0, actionsHandedOff: 1 }).quiet, false)
})

test('★ 아무 일 없던 날에도 숫자가 적힌다 — 빈 브리핑 0건', () => {
  const lines = briefingLines(computeBriefing({
    ...DAY, signals: 0, judgments: 0, notificationsSent: 0, realizedPnlKrw: 0,
  }))
  assert.ok(lines.some((l) => l.includes('봉 380개')))
  assert.ok(lines.some((l) => l.includes('신호: 0건')), '0 을 안 적었다')
  assert.ok(lines.some((l) => l.includes('판단 0번')))
  assert.ok(lines.some((l) => l.includes('신호도 조치도 없었습니다. 수집은 돌았습니다')))
})

test('★ 수집이 안 돈 날은 그렇게 말한다', () => {
  const lines = briefingLines(computeBriefing({ ...DAY, barsCollected: 0, signals: 0 }))
  assert.ok(lines.some((l) => l.includes('수집이 안 돈 날입니다')))
  assert.equal(lines.some((l) => l.includes('조용한 날이 아니라') === false && l.includes('수집은 돌았습니다')), false)
})

test('★ 손익을 모르면 0원이 아니라 「아직 없음」이다', () => {
  const lines = briefingLines(computeBriefing({ ...DAY, realizedPnlKrw: null }))
  assert.ok(lines.some((l) => l === '실현 손익: 아직 없음'))
  assert.equal(lines.some((l) => l.includes('0원')), false)
  // 진짜 0 이면 0 이라고 적는다
  assert.ok(briefingLines(computeBriefing({ ...DAY, realizedPnlKrw: 0 })).some((l) => l.includes('+0원')))
})

test('프롬프트가 지어내기와 예측을 막는다', () => {
  const p = buildBriefingPrompt(briefingLines(computeBriefing(DAY)))
  assert.ok(p.includes('있는 숫자만'))
  assert.ok(p.includes('예측하지 않는다'))
  assert.ok(p.includes('설정을 바꾸라고 말하지 않는다'))
  assert.ok(p.includes('안 돈 날이라고 말한다'))
})

// ── 숫자는 코드가 ────────────────────────────────────────

test('★ 셈이 AI 를 안 부른다', () => {
  const src = readFileSync(join(HERE, 'briefing-core.ts'), 'utf8')
  assert.equal(/callKnowledge|callGemini|fetch\(|createAdminClient/.test(src), false,
    '셈 하는 자리가 AI 나 DB 를 부른다')
})

test('★ AI 응답이 숫자 칸으로 가는 길이 없다', () => {
  const src = readFileSync(join(HERE, 'briefing.ts'), 'utf8')
  const insertAt = src.indexOf('.insert({')
  const body = src.slice(insertAt, src.indexOf('})', insertAt))
  assert.ok(body.includes('metrics,'), 'metrics 를 안 적는다')
  assert.ok(body.includes('narrative: call.ok ? call.text : null'))
  assert.equal(/trade_date:\s*call|metrics:\s*call/.test(body), false, 'AI 응답이 숫자 칸에 들어간다')
})

test('★ AI 가 죽어도 숫자는 남는다', () => {
  const src = readFileSync(join(HERE, 'briefing.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export async function makeBriefing'))
  const afterCall = fn.slice(fn.indexOf('const call = await callKnowledge'))
  const beforeInsert = afterCall.slice(0, afterCall.indexOf('.insert({'))
  assert.equal(/if \(!call\.ok\) return/.test(beforeInsert), false,
    'AI 가 실패하면 브리핑을 버린다 — 그날 기록이 사라진다')
})

test('★ 하루 한 번만 — 거래일이 기본 키다', () => {
  const sql = readFileSync(
    join(HERE, '..', '..', '..', '..', '..', 'supabase', 'migrations', '286_trading_operator.sql'), 'utf8')
  assert.ok(sql.includes('trade_date    DATE        PRIMARY KEY'), '거래일이 기본 키가 아니다')
  const src = readFileSync(join(HERE, 'briefing.ts'), 'utf8')
  assert.ok(src.includes("reason: 'already_made'"), '두 번째를 오류로 다룬다')
})

test('★ 브리핑이 설정을 안 바꾸고 알림을 안 만든다', () => {
  for (const f of ['briefing-core.ts', 'briefing.ts']) {
    const src = readFileSync(join(HERE, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
    for (const banned of ['saveTradingSetting', 'trading_settings', 'queueNotification', 'saveSignal']) {
      assert.equal(src.includes(banned), false, `${f} 가 ${banned} 에 닿는다`)
    }
  }
})

test('★ 쓰는 표가 브리핑 하나뿐이다', () => {
  const src = readFileSync(join(HERE, 'briefing.ts'), 'utf8')
  const tables = [...src.matchAll(/\.from\('(\w+)'\)/g)].map((m) => m[1])
  assert.deepEqual([...new Set(tables)], ['trading_briefings'])
})
