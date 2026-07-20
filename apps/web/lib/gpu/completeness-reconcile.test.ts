import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scanMoneyTokens, reconcile } from './completeness-reconcile.ts'

const SNAPSHOT = '月額 ￥4,569,000 ¥2,500,000 ¥1,500,000 月額基本料金 30,000円 GPU利用料金 7.2円/1分 1,000円/100GB メモリ 640 GB 通信 400Gbps 契約 7日間'

test('통화토큰만 스캔(스펙숫자 640GB·400Gbps·7日 제외)', () => {
  const t = scanMoneyTokens(SNAPSHOT)
  assert.ok(t.includes(4_569_000) && t.includes(2_500_000) && t.includes(30_000) && t.includes(7.2) && t.includes(1000))
  assert.ok(!t.includes(640) && !t.includes(400) && !t.includes(7), '스펙숫자 오탐 0')
})

test('추출이 시간제 성분(30,000·7.2·1000) 놓치면 미커버로 노출(은폐 0)', () => {
  // 월정액 3개만 추출 → 시간제 3성분 미커버
  const r = reconcile(SNAPSHOT, [4_569_000, 2_500_000, 1_500_000])
  assert.equal(r.complete, false)
  assert.ok(r.uncovered.includes(30_000) && r.uncovered.includes(7.2) && r.uncovered.includes(1000))
})

test('전량 추출 시 complete=true', () => {
  const r = reconcile(SNAPSHOT, [4_569_000, 2_500_000, 1_500_000, 30_000, 7.2, 1000])
  assert.equal(r.complete, true)
  assert.equal(r.uncovered.length, 0)
})
