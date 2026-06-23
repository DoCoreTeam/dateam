import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTranscriptionPrompt, parseTranscription } from './transcription.ts'

test('buildTranscriptionPrompt — verbatim 지시 + 가격없는 행 포함 + 카탈로그 미주입', () => {
  const p = buildTranscriptionPrompt()
  assert.match(p, /verbatim/i)
  assert.match(p, /Contact us/)
  assert.match(p, /매핑·환산·해석·정규화·생략/)
  // 편향 제거: 카탈로그/표준 모델 매핑 지시가 없어야 함
  assert.doesNotMatch(p, /표준 model_name으로 매핑/)
  assert.doesNotMatch(p, /보유 모델 카탈로그/)
})

test('parseTranscription — 정상 JSON: rows + source_row_count', () => {
  const r = parseTranscription(JSON.stringify({
    rows: [
      { raw_label: 'HGX B300', cells: ['4.30', '7.85'], price_text: '4.30' },
      { raw_label: 'GB200', cells: ['Contact us'], price_text: null },
    ],
    source_row_count: 2,
  }))
  assert.equal(r.source_row_count, 2)
  assert.equal(r.rows.length, 2)
  assert.equal(r.rows[0].raw_label, 'HGX B300')
  assert.equal(r.rows[1].price_text, null)
})

test('parseTranscription — 가격없는 행도 보존(null price_text)', () => {
  const r = parseTranscription(JSON.stringify({
    rows: [{ raw_label: 'GB300', cells: ['문의'], price_text: '문의' }],
    source_row_count: 1,
  }))
  assert.equal(r.rows.length, 1)
  assert.equal(r.rows[0].price_text, '문의')
})

test('parseTranscription — 코드펜스 감싼 JSON 관용 처리', () => {
  const r = parseTranscription('```json\n{"rows":[{"raw_label":"H100","cells":["2.15"],"price_text":"2.15"}],"source_row_count":1}\n```')
  assert.equal(r.rows.length, 1)
  assert.equal(r.rows[0].raw_label, 'H100')
})

test('parseTranscription — 파싱 실패/비문자열 → 빈 결과', () => {
  assert.deepEqual(parseTranscription('not json'), { rows: [], source_row_count: 0 })
  assert.deepEqual(parseTranscription(''), { rows: [], source_row_count: 0 })
  assert.deepEqual(parseTranscription(null), { rows: [], source_row_count: 0 })
  assert.deepEqual(parseTranscription(undefined), { rows: [], source_row_count: 0 })
})

test('parseTranscription — source_row_count는 rows 길이보다 작아지지 않음', () => {
  const r = parseTranscription(JSON.stringify({
    rows: [{ raw_label: 'A', cells: [], price_text: null }, { raw_label: 'B', cells: [], price_text: null }],
    source_row_count: 1, // 거짓 과소 → rows 길이로 보정
  }))
  assert.equal(r.source_row_count, 2)
})

test('parseTranscription — source_row_count 없으면 rows 길이로 폴백', () => {
  const r = parseTranscription(JSON.stringify({
    rows: [{ raw_label: 'A', cells: [], price_text: null }],
  }))
  assert.equal(r.source_row_count, 1)
})

test('parseTranscription — 완전 빈 행(라벨·셀 모두 공백)은 스킵', () => {
  const r = parseTranscription(JSON.stringify({
    rows: [
      { raw_label: '', cells: ['', '  '], price_text: null },
      { raw_label: 'B200', cells: ['3.95'], price_text: '3.95' },
    ],
    source_row_count: 2,
  }))
  assert.equal(r.rows.length, 1)
  assert.equal(r.rows[0].raw_label, 'B200')
})

test('parseTranscription — 잡 필드 방어(비배열 cells, 비문자 label)', () => {
  const r = parseTranscription(JSON.stringify({
    rows: [{ raw_label: 123, cells: 'oops', price_text: 5 }],
    source_row_count: 1,
  }))
  // raw_label 비문자→'', cells 비배열→[], price_text 비문자→null → 완전 빈 행으로 스킵
  assert.equal(r.rows.length, 0)
})
