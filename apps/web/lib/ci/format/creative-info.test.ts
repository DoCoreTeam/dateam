import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toCreativeInfo, type CreativeRow } from './creative-info.ts'

function row(over: Partial<CreativeRow> = {}): CreativeRow {
  return {
    content_id: 'c1',
    thumbnail_text: null,
    thumbnail_style: null,
    thumbnail_summary: null,
    hook_message: null,
    hook_type: null,
    title_pattern: null,
    evidence: null,
    model: null,
    analyzed_at: null,
    ...over,
  }
}

test('model이 있으면 썸네일을 실제로 읽은 결과로 표시한다', () => {
  assert.equal(toCreativeInfo(row({ model: 'gemini-2.5-flash' })).source, 'ai')
})

test('model이 없으면 규칙 결과임을 숨기지 않는다', () => {
  assert.equal(toCreativeInfo(row({ model: null })).source, 'rules')
})

test('배열 컬럼이 null이어도 빈 배열로 내려 화면이 깨지지 않는다', () => {
  const info = toCreativeInfo(row())
  assert.deepEqual(info.thumbnailStyle, [])
  assert.deepEqual(info.titlePattern, [])
})

test('한계 고지(note)를 그대로 전달한다', () => {
  const note = 'AI 키가 없어 제목 규칙만으로 분석했습니다'
  assert.equal(toCreativeInfo(row({ evidence: { note } })).note, note)
})

test('빈 note는 없는 것으로 본다 — 빈 줄을 화면에 남기지 않는다', () => {
  assert.equal(toCreativeInfo(row({ evidence: { note: '   ' } })).note, null)
  assert.equal(toCreativeInfo(row({ evidence: {} })).note, null)
})

test('분석 시각이 없으면 null — 없는 시각을 지어내지 않는다', () => {
  assert.equal(toCreativeInfo(row()).analyzedAtText, null)
})

test('분석 시각은 KST로 변환해 내려보낸다', () => {
  // 2026-08-11T13:00:00Z = KST 22:00
  const text = toCreativeInfo(row({ analyzed_at: '2026-08-11T13:00:00Z' })).analyzedAtText
  assert.ok(text && text.includes('22:00'), `KST 변환 실패: ${text}`)
})
