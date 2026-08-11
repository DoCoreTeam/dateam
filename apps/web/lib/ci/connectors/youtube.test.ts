import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseIsoDuration, judgeFormat, completenessOf } from './youtube.ts'

test('ISO8601 기간을 초로 바꾼다', () => {
  assert.equal(parseIsoDuration('PT1M30S'), 90)
  assert.equal(parseIsoDuration('PT2H5M3S'), 7503)
  assert.equal(parseIsoDuration('PT45S'), 45)
  assert.equal(parseIsoDuration('P1DT2H'), 93600)
})

test('파싱할 수 없는 기간은 0이 아니라 null이다 (없는 값을 0으로 위장하지 않는다)', () => {
  assert.equal(parseIsoDuration(undefined), null)
  assert.equal(parseIsoDuration(''), null)
  assert.equal(parseIsoDuration('garbage'), null)
})

test('180초 이하는 숏폼으로 본다', () => {
  assert.equal(judgeFormat(45, null), 'short')
  assert.equal(judgeFormat(180, null), 'short')
  assert.equal(judgeFormat(181, null), 'long')
})

test('URL 힌트가 있으면 길이보다 우선한다 (쇼츠·라이브는 확정 정보)', () => {
  assert.equal(judgeFormat(600, 'short'), 'short')
  assert.equal(judgeFormat(30, 'live'), 'live')
})

test('길이를 모르면 long으로 떨어진다 (숏폼 통계 오염 방지)', () => {
  assert.equal(judgeFormat(null, null), 'long')
})

test('완전도는 확보한 필수 필드 비율이다', () => {
  assert.equal(completenessOf([]), 1)
  assert.equal(completenessOf(['views', 'likes', 'comments', 'duration_sec', 'published_at', 'title', 'thumbnail_url']), 0)
  const partial = completenessOf(['views', 'likes'])
  assert.ok(partial > 0.7 && partial < 0.8, `기대: 5/7 ≈ 0.714, 실제: ${partial}`)
})
