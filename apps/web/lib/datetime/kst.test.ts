import test from 'node:test'
import assert from 'node:assert/strict'
import {
  KST_OFFSET,
  kstWallToIso,
  kstDateOnlyToIso,
  normalizeKstWallString,
  formatKstTime,
  formatKstDateTimeKorean,
  kstDateKey,
  kstParts,
  kstTodayKey,
  kstRangeToUtc,
  formatKstDateTimeShort,
  formatKstDateTimeExact,
  formatKstTimeExact,
  formatKstAgo,} from './kst.ts'

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

test('formatKstDateTimeKorean: 문서용 전체 표기 — 2026년 8월 12일 14시 20분', () => {
  // 05:20 UTC = 14:20 KST
  assert.equal(formatKstDateTimeKorean('2026-08-12T05:20:00Z'), '2026년 8월 12일 14시 20분')
  // 자정이면 시각을 붙이지 않는다 — 미지정을 00시로 단정해 보이지 않게
  assert.equal(formatKstDateTimeKorean('2026-08-11T15:00:00Z'), '2026년 8월 12일')
  assert.equal(formatKstDateTimeKorean('bad'), '')
})


// ── 로그용 정확 시각 (v0.7.596) ────────────────────────────────
// 왜: 로그 화면이 '8/24 14:15'까지만 보여 줬다. 같은 분에 여러 번 난 실패가 같은 시각으로 보이고,
// 연도가 없어 언제 것인지 알 수 없었다(사용자 지적: "시간이 완전 핵심인데 정확한 시간으로 안 나오네").

test('★ 로그 시각은 초까지·연도까지 KST로 준다', () => {
  // 2026-08-24T06:57:52Z = KST 15:57:52
  assert.equal(formatKstDateTimeExact('2026-08-24T06:57:52.068Z'), '2026-08-24 15:57:52')
  assert.equal(formatKstTimeExact('2026-08-24T06:57:52.068Z'), '15:57:52')
})

test('★ 자정을 넘는 시각도 KST 날짜로 맞게 넘어간다', () => {
  // 2026-08-24T15:30:05Z = KST 다음날 00:30:05
  assert.equal(formatKstDateTimeExact('2026-08-24T15:30:05Z'), '2026-08-25 00:30:05')
  assert.equal(formatKstTimeExact('2026-08-24T15:30:05Z'), '00:30:05')
})

test('★ 같은 분 안의 두 사건이 다른 시각으로 구분된다 — 이게 안 되면 로그가 아니다', () => {
  const a = formatKstDateTimeExact('2026-08-24T06:57:02Z')
  const b = formatKstDateTimeExact('2026-08-24T06:57:52Z')
  assert.notEqual(a, b)
})

test('잘못된 값에서 터지지 않는다', () => {
  assert.equal(formatKstDateTimeExact('아무말'), '')
  assert.equal(formatKstTimeExact(''), '')
  assert.equal(formatKstAgo('아무말'), '')
})

test('★ 경과 시간은 "아직도 나고 있나"에 답한다', () => {
  const now = new Date('2026-08-24T10:00:00Z')
  assert.equal(formatKstAgo('2026-08-24T09:59:30Z', now), '방금')
  assert.equal(formatKstAgo('2026-08-24T09:45:00Z', now), '15분 전')
  assert.equal(formatKstAgo('2026-08-24T07:00:00Z', now), '3시간 전')
  assert.equal(formatKstAgo('2026-08-22T10:00:00Z', now), '2일 전')
  assert.equal(formatKstAgo('2026-08-24T10:00:30Z', now), '방금', '미래 시각도 터지지 않는다')
})
