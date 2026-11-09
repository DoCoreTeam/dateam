/**
 * 성적 관문 — **쌓인 판단이 비용을 넘겨 벌었을 때만 신호가 나간다**
 *
 * 실측 2026-11-05 비용 포함 합계 -17,758,418원인데 신호를 막던 것은 성적이 아니라
 * 보정 모델이 없다는 사실이었다. 보정이 생기는 날 성적과 무관하게 나간다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { trackRecordOf, trackRecordGate, trackRecordThresholdsOf } from './track-record.ts'
import type { JudgmentScore } from './score.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

const score = (outcome: JudgmentScore['outcome'], r: number | null, krw: number | null = r === null ? null : r * 100_000): JudgmentScore => ({
  judgmentId: 'j', judge: 'rule', direction: 'long', barAt: '2026-11-05T01:00:00.000Z',
  referencePrice: 1000, stopPrice: 999, targetPrice: 1002, outcome, netPnlKrw: krw, netPnlR: r, reason: outcome,
})

const TH = { minTrades: 4, minProfitFactor: 1.25 }

test('결판이 안 난 판단은 성적에 안 든다 — 아직과 빗나감은 다르다', () => {
  const rec = trackRecordOf([score('target', 1), score('stop', -1), score('pending', null), score('not_filled', 0), score('no_plan', null)])
  assert.equal(rec.settled, 2)
  assert.equal(rec.profitFactor, 1)
  assert.equal(rec.netKrw, 0)
})

test('★ 건수가 모자라면 미달이 아니라 아직 못 잼이다', () => {
  const gate = trackRecordGate(trackRecordOf([score('target', 2), score('stop', -1)]), TH)
  assert.equal(gate.status, 'insufficient')
  assert.match(gate.code, /2<4/)
})

test('★ 손익비가 기준 아래면 미달이고, 얼마인지 말한다', () => {
  const gate = trackRecordGate(trackRecordOf([score('target', 1), score('stop', -1), score('stop', -1), score('target', 1.1)]), TH)
  assert.equal(gate.status, 'fail')
  assert.match(gate.code, /pf=1\.05<1\.25/)
})

test('★ 잃은 것이 0이면 손익비가 없다 — 무한으로 보고 통과시키지 않는다', () => {
  const gate = trackRecordGate(trackRecordOf([score('target', 1), score('target', 1), score('time', 0.2), score('target', 1)]), TH)
  assert.equal(gate.record.profitFactor, null)
  assert.equal(gate.status, 'fail')
})

test('건수와 손익비를 모두 넘으면 통과', () => {
  const gate = trackRecordGate(trackRecordOf([score('target', 1.5), score('stop', -1), score('target', 1.5), score('stop', -1)]), TH)
  assert.equal(gate.status, 'pass')
})

test('기준은 검증 관문과 같은 설정을 읽는다', () => {
  assert.deepEqual(trackRecordThresholdsOf({ gate_min_validate_trades: 300, gate_min_profit_factor: 1.4 }), { minTrades: 300, minProfitFactor: 1.4 })
  assert.deepEqual(trackRecordThresholdsOf({}), { minTrades: 500, minProfitFactor: 1.25 })
})

test('★ tick 이 신호를 내기 전에 성적 관문을 지난다 — 통과가 아니면 emitSignal 에 안 닿는다', () => {
  const src = readFileSync(join(HERE, '../jobs/tick.ts'), 'utf8')
  const gateAt = src.indexOf('trackRecordGate(trackRecordOf(recent.scores)')
  const blockAt = src.indexOf("if (gate.status !== 'pass') return")
  const emitAt = src.indexOf('await emitSignal(')
  assert.ok(gateAt > 0, 'tick 이 성적 관문을 안 부른다')
  assert.ok(blockAt > gateAt, '관문 결과로 막지 않는다')
  assert.ok(emitAt > blockAt, '관문보다 신호 발행이 먼저 있다')
  // 현황 화면과 같은 채점을 읽는다
  const overview = readFileSync(join(HERE, '../overview.ts'), 'utf8')
  assert.match(overview, /scoreRecentJudgments\(/, '현황이 다른 채점을 읽는다')
})

test('★ 관문은 규칙 판단만 센다 — AI 판단을 같이 세면 같은 거래를 두 번 센다', () => {
  const jev = (o: JudgmentScore['outcome'], r: number) => ({ ...score(o, r), judge: 'jev' })
  const rec = trackRecordOf([score('target', 1), score('stop', -1), jev('target', 1), jev('stop', -1)])
  assert.equal(rec.settled, 2)
})
