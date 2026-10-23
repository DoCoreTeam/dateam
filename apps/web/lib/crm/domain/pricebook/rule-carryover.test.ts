import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findMissingRules, ruleKey, splitCarryover, type ExistingRule } from './rule-carryover.ts'
import type { PriceRule } from './types.ts'

// 기존 제품은 실제 id, 새 초안은 초안 id 로 같은 품목을 가리킨다
const oldNames: Record<string, string> = { c1: 'STD 기본 금액', c2: 'ENT 기본 금액', c3: 'ENT 전환 구축', c4: '추가 교육', c5: '지정 시간 GPU' }
const newNames: Record<string, string> = { d1: 'STD 기본 금액', d2: 'ENT 기본 금액', d3: 'ENT 전환 구축', d4: '추가 교육', d5: '지정 시간 GPU' }
const oldOf = (id: string) => oldNames[id] ?? null
const newOf = (id: string) => newNames[id] ?? null

// 서로 다른 규칙 16개 — CAP 12개(품목 둘 × 변수 여섯) + QTY_FROM 4개(품목 둘 × 변수 둘)
const VARS = ['gpu.total', 'gpu.dc', 'gpu.ws', 'gpu.timed', 'nodes', 'training'] as const
const sixteen: ExistingRule[] = [
  ...['c1', 'c2'].flatMap((item) => VARS.map((varKey) => ({ kind: 'CAP', item, varKey, max: 100 }) as PriceRule)),
  ...['c1', 'c2'].flatMap((item) => (['gpu.total', 'nodes'] as const).map((varKey) => ({ kind: 'QTY_FROM', item, varKey }) as PriceRule)),
].map((rule, i) => ({ id: `r${i}`, rule }))
const lost: ExistingRule[] = [
  { id: 'x1', rule: { kind: 'QTY_FROM', item: 'c4', varKey: 'training' } },
  { id: 'x2', rule: { kind: 'ELIGIBLE', item: 'c5', classes: ['WS', 'CONSUMER'] } },
  { id: 'x3', rule: { kind: 'UPGRADE', item: 'c3', from: 'c1', to: 'c2' } },
]
const toDraft = (r: PriceRule): PriceRule => JSON.parse(JSON.stringify(r).replace(/"c(\d)"/g, '"d$1"'))

test('★ 기존 19개 중 새 파일에 없는 3개를 찾는다 (gcube edge DH 100 재현)', () => {
  const existing = [...sixteen, ...lost]
  assert.equal(new Set(existing.map((e) => ruleKey(e.rule, oldOf))).size, 19, '시험 데이터가 19개 서로 다른 규칙')
  const incoming = sixteen.map((e) => toDraft(e.rule))
  const missing = findMissingRules(existing, oldOf, incoming, newOf)
  assert.deepEqual(missing.map((m) => m.id), ['x1', 'x2', 'x3'])
})

test('숫자만 바뀐 규칙은 빠진 것이 아니다', () => {
  const existing: ExistingRule[] = [{ id: 'a', rule: { kind: 'CAP', item: 'c1', varKey: 'gpu.total', max: 300 } }]
  const incoming: PriceRule[] = [{ kind: 'CAP', item: 'd1', varKey: 'gpu.total', max: 400 }]
  assert.deepEqual(findMissingRules(existing, oldOf, incoming, newOf), [])
})

test('목록 순서가 달라도 같은 규칙', () => {
  const existing: ExistingRule[] = [{ id: 'a', rule: { kind: 'ONE_OF', items: ['c1', 'c2'] } }]
  assert.deepEqual(findMissingRules(existing, oldOf, [{ kind: 'ONE_OF', items: ['d2', 'd1'] }], newOf), [])
})

test('★ 기본은 이어받기, 버린다고 고른 것만 빠진다', () => {
  const { kept, dropped } = splitCarryover(lost, ['x2'])
  assert.deepEqual(kept.map((k) => k.id), ['x1', 'x3'])
  assert.deepEqual(dropped.map((k) => k.id), ['x2'])
  assert.equal(splitCarryover(lost, []).kept.length, 3)
})

test('이 제품의 빠진 규칙이 아닌 id 는 버리기 목록에 있어도 아무것도 안 지운다', () => {
  const { kept, dropped } = splitCarryover(lost, ['남의-규칙-id'])
  assert.equal(kept.length, 3)
  assert.equal(dropped.length, 0)
})
