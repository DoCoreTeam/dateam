import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  seasonOf, dayPartOf, resolveCountry, buildTemporalContext, describeContext,
} from './temporal.ts'

test('북반구 계절', () => {
  assert.equal(seasonOf(1, 'north'), 'winter')
  assert.equal(seasonOf(4, 'north'), 'spring')
  assert.equal(seasonOf(7, 'north'), 'summer')
  assert.equal(seasonOf(10, 'north'), 'autumn')
  assert.equal(seasonOf(12, 'north'), 'winter')
})

test('남반구는 계절이 반대다 — 한쪽만 맞추면 절반이 틀린다', () => {
  assert.equal(seasonOf(1, 'south'), 'summer')
  assert.equal(seasonOf(7, 'south'), 'winter')
  assert.equal(seasonOf(4, 'south'), 'autumn')
  assert.equal(seasonOf(10, 'south'), 'spring')
})

test('이상한 월 값도 예외 없이 접힌다', () => {
  assert.equal(seasonOf(13, 'north'), 'winter')  // 13 → 1월
  assert.equal(seasonOf(0, 'north'), 'winter')   // 0 → 12월
  assert.equal(seasonOf(-2, 'north'), 'autumn')  // -2 → 10월
})

test('시간대 구간', () => {
  assert.equal(dayPartOf(3), 'dawn')
  assert.equal(dayPartOf(9), 'morning')
  assert.equal(dayPartOf(14), 'afternoon')
  assert.equal(dayPartOf(19), 'evening')
  assert.equal(dayPartOf(23), 'night')
  assert.equal(dayPartOf(0), 'dawn')
  assert.equal(dayPartOf(25), 'dawn')   // 방어
})

test('국가는 채널 정보를 언어보다 신뢰한다', () => {
  const r = resolveCountry({ channelCountry: 'JP', language: 'ko' })
  assert.equal(r?.code, 'JP')
  assert.equal(r?.source, 'channel')
})

test('채널 국가가 없으면 언어로 추정하되 출처를 남긴다', () => {
  const r = resolveCountry({ language: 'ko' })
  assert.equal(r?.code, 'KR')
  assert.equal(r?.source, 'language')
})

test('여러 나라가 쓰는 언어(영어)로는 국가를 추정하지 않는다', () => {
  assert.equal(resolveCountry({ language: 'en' }), null)
  assert.equal(resolveCountry({}), null)
  // 모르는 국가 코드도 지어내지 않는다
  assert.equal(resolveCountry({ channelCountry: 'ZZ' }), null)
})

test('한국 채널의 게시 시각을 한국 벽시계로 읽는다', () => {
  // 2026-08-11T13:00:00Z = KST 2026-08-11 22:00 (화요일)
  const c = buildTemporalContext({
    publishedAtIso: '2026-08-11T13:00:00Z', channelCountry: 'KR',
  })
  assert.ok(c)
  assert.equal(c.localDate, '2026-08-11')
  assert.equal(c.hour, 22)
  assert.equal(c.dayPart, 'night')
  assert.equal(c.season, 'summer')
  assert.equal(c.weekdayLabel, '화')
  assert.equal(c.isWeekend, false)
  assert.equal(c.regionKnown, true)
})

test('같은 순간도 지역이 다르면 다른 사건이다', () => {
  const iso = '2026-08-11T13:00:00Z'
  const kr = buildTemporalContext({ publishedAtIso: iso, channelCountry: 'KR' })
  const us = buildTemporalContext({ publishedAtIso: iso, channelCountry: 'US' })
  assert.equal(kr?.hour, 22)      // 한국 밤
  assert.equal(us?.hour, 6)       // 미국 서부 아침
  assert.notEqual(kr?.dayPart, us?.dayPart)
})

test('남반구 채널은 같은 달이 다른 계절이다', () => {
  const iso = '2026-08-11T13:00:00Z'   // 8월
  assert.equal(buildTemporalContext({ publishedAtIso: iso, channelCountry: 'KR' })?.season, 'summer')
  assert.equal(buildTemporalContext({ publishedAtIso: iso, channelCountry: 'AU' })?.season, 'winter')
})

test('지역을 모르면 UTC로 읽되 모른다고 표시한다', () => {
  const c = buildTemporalContext({ publishedAtIso: '2026-08-11T13:00:00Z' })
  assert.ok(c)
  assert.equal(c.regionKnown, false)
  assert.equal(c.countryCode, null)
  assert.equal(c.timeZone, 'UTC')
  assert.equal(c.hour, 13)
})

test('게시 시각이 없으면 맥락도 없다 — 지어내지 않는다', () => {
  assert.equal(buildTemporalContext({ publishedAtIso: null }), null)
  assert.equal(buildTemporalContext({ publishedAtIso: '말도 안 되는 값' }), null)
})

test('주말 판정', () => {
  // 2026-08-15는 토요일
  const sat = buildTemporalContext({ publishedAtIso: '2026-08-15T03:00:00Z', channelCountry: 'KR' })
  assert.equal(sat?.weekdayLabel, '토')
  assert.equal(sat?.isWeekend, true)
})

test('요약 문장에 지역·계절·요일·시간대가 들어간다', () => {
  const c = buildTemporalContext({ publishedAtIso: '2026-08-11T13:00:00Z', channelCountry: 'KR' })!
  const s = describeContext(c)
  assert.ok(s.includes('한국'))
  assert.ok(s.includes('여름'))
  assert.ok(s.includes('화'))
  assert.ok(s.includes('밤'))
})

test('지역 미상은 요약에서도 미상이라고 말한다', () => {
  const c = buildTemporalContext({ publishedAtIso: '2026-08-11T13:00:00Z' })!
  assert.ok(describeContext(c).includes('지역 미상'))
})
