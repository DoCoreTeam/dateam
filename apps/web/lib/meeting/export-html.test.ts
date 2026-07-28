import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMeetingExportHtml, type MeetingExportInput } from './export-html.ts'

function base(overrides: Partial<MeetingExportInput> = {}): MeetingExportInput {
  return {
    title: '테스트 회의',
    meetingAtLabel: '2026-07-22 14:02',
    statusLabel: '작성중',
    memberAttendees: ['김도현'],
    externalAttendees: ['이기용 교수'],
    view: 'refined',
    summary: '요약 내용',
    decisions: '결정 내용',
    bodyHtml: '<p>본문</p>',
    ...overrides,
  }
}

test('정제본 뷰는 요약·결정사항을 렌더한다', () => {
  const html = buildMeetingExportHtml(base({ view: 'refined' }))
  assert.match(html, /요약/)
  assert.match(html, /요약 내용/)
  assert.match(html, /결정사항/)
  assert.match(html, /결정 내용/)
  assert.match(html, /AI 정제본/)
})

test('원본 뷰는 소독된 bodyHtml을 주입한다', () => {
  const html = buildMeetingExportHtml(base({ view: 'original', bodyHtml: '<ul><li>항목</li></ul>' }))
  assert.match(html, /<ul><li>항목<\/li><\/ul>/)
  assert.match(html, /원본/)
  // 정제본 텍스트는 원본 뷰에 나오지 않음
  assert.ok(!html.includes('요약 내용'))
})

test('plain text 필드는 이스케이프되어 마크업 주입을 막는다', () => {
  const html = buildMeetingExportHtml(base({ title: '<script>alert(1)</script>', summary: '<b>x</b>' }))
  assert.ok(!html.includes('<script>alert(1)</script>'))
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/)
})

test('참석자 없으면 참석자 섹션을 생략한다', () => {
  const html = buildMeetingExportHtml(base({ memberAttendees: [], externalAttendees: [] }))
  assert.ok(!html.includes('class="attendees"'))
})

test('참석자 chip은 멤버·외부로 구분 렌더한다', () => {
  const html = buildMeetingExportHtml(base({ memberAttendees: ['김도현'], externalAttendees: ['이기용 교수'] }))
  assert.match(html, /chip-mem[^>]*>김도현/)
  assert.match(html, /chip-ext[^>]*>이기용 교수/)
})

test('정제본이 비면 안내 문구를 렌더한다', () => {
  const html = buildMeetingExportHtml(base({ view: 'refined', summary: '', decisions: '' }))
  assert.match(html, /AI 정제본이 없습니다/)
})

test('제목 없으면 (제목 없음)으로 대체한다', () => {
  const html = buildMeetingExportHtml(base({ title: '   ' }))
  assert.match(html, /\(제목 없음\)/)
})
