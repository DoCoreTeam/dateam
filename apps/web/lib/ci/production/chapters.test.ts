import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseChapters, timestampToSec } from './chapters.ts'

test('분:초와 시:분:초를 자릿수로 구분한다', () => {
  assert.equal(timestampToSec('1:23'), 83)
  assert.equal(timestampToSec('01:23'), 83)
  assert.equal(timestampToSec('1:02:03'), 3723)
  assert.equal(timestampToSec('0:00'), 0)
})

test('타임코드가 아닌 숫자는 거른다 — 60을 넘는 분·초는 시각이 아니다', () => {
  assert.equal(timestampToSec('1:99'), null)
  assert.equal(timestampToSec('12'), null)
  assert.equal(timestampToSec('1:2:3:4'), null)
  assert.equal(timestampToSec('a:bc'), null)
})

test('설명문에서 챕터를 순서대로 뽑는다', () => {
  const desc = [
    '이번 영상에서는 GPU 가격을 다룹니다.',
    '',
    '0:00 인트로',
    '1:30 시세 확인하는 법',
    '5:45 실제 견적 비교',
    '',
    '구독 부탁드립니다 #GPU',
  ].join('\n')

  const out = parseChapters(desc)
  assert.equal(out.length, 3)
  assert.deepEqual(out[0], { atSec: 0, label: '인트로' })
  assert.equal(out[1].atSec, 90)
  assert.equal(out[2].label, '실제 견적 비교')
})

test('장식 문자를 걷어내고 라벨만 남긴다', () => {
  const out = parseChapters('00:00 - 오프닝\n02:10 — 본론')
  assert.equal(out[0].label, '오프닝')
  assert.equal(out[1].label, '본론')
})

test('시각이 되돌아가는 목록은 목차가 아니다 — 앞선 것만 남긴다', () => {
  const out = parseChapters('0:00 시작\n5:00 중간\n1:00 이건 목차가 아님\n9:00 끝')
  assert.deepEqual(out.map((c) => c.atSec), [0, 300, 540])
})

test('라벨 없는 타임코드는 챕터가 아니다', () => {
  assert.deepEqual(parseChapters('0:00\n1:00\n2:00'), [])
})

test('한 개짜리는 목차가 아니라 우연히 적힌 시각이다', () => {
  assert.deepEqual(parseChapters('영상 길이는 3:21 입니다'), [])
})

test('설명문이 없으면 빈 배열 — 없는 구간을 지어내지 않는다', () => {
  assert.deepEqual(parseChapters(null), [])
  assert.deepEqual(parseChapters(''), [])
  assert.deepEqual(parseChapters(undefined), [])
})
