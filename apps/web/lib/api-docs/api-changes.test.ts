// lib/api-docs/api-changes.test.ts - 개발자센터 「API 변경 내역」이 업데이트 내역과 갈라지지 않게
//
// 목록은 entries.ts 의 developer 태그 하나로 정해진다.
// 그래서 태그를 빠뜨리면 그 변경이 개발자에게 영영 안 보인다. 아래 가드가 그 빠짐을 센다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CHANGELOG } from '../changelog/entries.ts'
import { selectApiChanges } from './api-changes.ts'

// AI 같은 말에 걸리지 않게 영문자 경계를 본다 (OpenAPI, APIs 도 걸리지 않음)
const DEVELOPER_WORDS = /개발자 ?센터|(?<![A-Za-z])(?:API|CLI)(?![A-Za-z])|teamda/

test('API 변경 내역은 developer: true 인 줄만 싣는다', () => {
  const changes = selectApiChanges()
  assert.ok(changes.length > 0, '실린 업데이트가 0개')
  for (const change of changes) {
    assert.ok(change.items.length > 0, `${change.version} 이 빈 묶음으로 실렸다`)
    for (const item of change.items) assert.equal(item.developer, true, item.headline)
  }
  const tagged = CHANGELOG.flatMap((note) => note.items).filter((item) => item.developer === true)
  assert.equal(changes.flatMap((c) => c.items).length, tagged.length)
})

test('API 변경 내역은 최신 버전이 위이고 limit 를 지킨다', () => {
  const changes = selectApiChanges()
  const first = changes[0]?.version
  assert.ok(first)
  assert.equal(selectApiChanges(CHANGELOG, 2).length, Math.min(2, changes.length))
  assert.equal(selectApiChanges(CHANGELOG, 2)[0]?.version, first)
  const reversed = [...CHANGELOG].reverse()
  assert.equal(selectApiChanges(reversed)[0]?.version, first)
  assert.ok(changes.some((c) => c.version === '0.11.61'), 'teamda CLI 가 생긴 0.11.61 이 없다')
})

test('API, CLI, teamda, 개발자센터를 말하는 줄은 developer 를 정해 둔다', () => {
  const missing = CHANGELOG.flatMap((note) =>
    note.items
      .filter((item) => DEVELOPER_WORDS.test(`${item.headline} ${item.detail}`))
      .filter((item) => typeof item.developer !== 'boolean')
      .map((item) => `${note.version} ${item.headline}`),
  )
  assert.deepEqual(missing, [], '개발자용이면 developer: true, 그 말만 나오면 developer: false 를 적는다')
})

test('가드 정규식이 AI 와 OpenAPI 에 걸리지 않는다', () => {
  assert.equal(DEVELOPER_WORDS.test('AI 로 요약해요'), false)
  assert.equal(DEVELOPER_WORDS.test('OpenAPI 문서'), false)
  assert.equal(DEVELOPER_WORDS.test('API 키를 만들어요'), true)
  assert.equal(DEVELOPER_WORDS.test('teamda sync'), true)
  assert.equal(DEVELOPER_WORDS.test('개발자 센터'), true)
})
