import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  KST_OFFSET,
  kstWallToIso,
  kstDateOnlyToIso,
  normalizeKstWallString,
  formatKstTime,
  kstDateKey,
  kstParts,
  kstTodayKey,
  kstRangeToUtc,
  formatKstDateTimeShort,
} from './kst.ts'

// 핵심 회귀: 사용자가 13:00 선택 → 22:00 표시 사고. 라운드트립이 13:00을 보존해야 한다.
test('kstWallToIso: KST 벽시계를 +09:00 앵커 ISO로 (UTC 적재 정확)', () => {
  assert.equal(kstWallToIso('2026-06-25', '13:00'), `2026-06-25T13:00:00${KST_OFFSET}`)
  // 절대시각으로는 04:00 UTC — timestamptz가 저장하는 값
  assert.equal(new Date(kstWallToIso('2026-06-25', '13:00')).toISOString(), '2026-06-25T04:00:00.000Z')
})

test('write→read 라운드트립: 13:00 입력이 13:00으로 다시 표시된다(+9h 사고 방지)', () => {
  const stored = new Date(kstWallToIso('2026-06-25', '13:00')).toISOString() // DB 저장값(UTC)
  assert.equal(formatKstTime(stored), '13:00')
})

test('formatKstTime: UTC ISO를 KST로 변환', () => {
  assert.equal(formatKstTime('2026-06-25T04:00:00.000Z'), '13:00')
  assert.equal(formatKstTime('2026-06-25T15:00:00.000Z'), '00:00') // 자정 보정(24:00→00:00)
  assert.equal(formatKstTime('not-a-date'), '')
})

test('kstDateKey: KST 자정 경계에서 올바른 날짜', () => {
  // KST 2026-06-25 00:30 = UTC 2026-06-24 15:30 — raw slice면 24일로 오분류되는 케이스
  assert.equal(kstDateKey('2026-06-24T15:30:00.000Z'), '2026-06-25')
  assert.equal(kstDateKey('2026-06-25'), '2026-06-25') // 날짜만 입력은 그대로
})

test('kstDateOnlyToIso + kstDateKey: 종일 일정 날짜 보존', () => {
  const iso = kstDateOnlyToIso('2026-06-25')
  assert.equal(kstDateKey(new Date(iso).toISOString()), '2026-06-25')
})

test('normalizeKstWallString: naive는 +09:00 부착, 시간대 있으면 불변', () => {
  assert.equal(normalizeKstWallString('2026-06-25T13:00:00'), `2026-06-25T13:00:00${KST_OFFSET}`)
  assert.equal(normalizeKstWallString('2026-06-25T13:00'), `2026-06-25T13:00:00${KST_OFFSET}`)
  assert.equal(normalizeKstWallString('2026-06-25T13:00:00Z'), '2026-06-25T13:00:00Z')
  assert.equal(normalizeKstWallString('2026-06-25T13:00:00+09:00'), '2026-06-25T13:00:00+09:00')
})

test('kstRangeToUtc: KST 월 경계를 UTC로', () => {
  const { fromIso, toIso } = kstRangeToUtc('2026-06-01', '2026-06-30')
  assert.equal(fromIso, '2026-05-31T15:00:00.000Z') // KST 06-01 00:00 = UTC 05-31 15:00
  assert.equal(toIso, '2026-06-30T14:59:59.999Z')   // KST 06-30 23:59:59.999
})

test('kstParts + formatKstDateTimeShort', () => {
  const iso = '2026-06-25T04:00:00.000Z' // KST 13:00
  const p = kstParts(iso)!
  assert.deepEqual(p, { year: 2026, month: 6, day: 25, hour: 13, minute: 0 })
  assert.equal(formatKstDateTimeShort(iso), '6/25 13:00')
  // 종일(KST 00:00) → 시각 생략
  assert.equal(formatKstDateTimeShort(new Date(kstDateOnlyToIso('2026-06-25')).toISOString()), '6/25')
})

test('kstTodayKey: 고정 시각에서 KST 날짜', () => {
  // UTC 2026-06-24 15:30 = KST 2026-06-25 00:30
  assert.equal(kstTodayKey(new Date('2026-06-24T15:30:00.000Z')), '2026-06-25')
})

test('kstWallToIso: 잘못된 입력은 throw(우회 방지)', () => {
  assert.throws(() => kstWallToIso('2026/06/25', '13:00'))
  assert.throws(() => kstWallToIso('2026-06-25', '1:00'))
})
