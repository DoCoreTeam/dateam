import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMeetingExportHtml, type MeetingExportInput } from './export-html.ts'

const base: MeetingExportInput = {
  title: '테스트 회의',
  meetingAtLabel: '2026-07-22 14:02',
  authorName: '김도현',
  memberAttendees: ['김도현'],
  externalAttendees: ['이기용 교수'],
  view: 'refined',
  summary: '요약 내용',
  decisions: '결정 내용',
  bodyHtml: '<p>원본 본문</p>',
}

test('회의록 서식: 표제 + 라벨-값 메타표(작성일시·작성자·참석자)', () => {
  const html = buildMeetingExportHtml(base)
  assert.match(html, /class="doctype">회 의 록</)
  assert.match(html, /<h1>테스트 회의<\/h1>/)
  assert.match(html, /<th>작성일시<\/th><td>2026-07-22 14:02<\/td>/)
  assert.match(html, /<th>작성자<\/th><td>김도현<\/td>/)
  assert.match(html, /<td>김도현, 이기용 교수<\/td>/) // 참석자는 한 줄로 — 시스템 칩이 아니라 문서 표기
})

test('상태(작성중/확정)는 문서에 넣지 않는다 — 내부 작업 상태지 회의 사실이 아니다', () => {
  const html = buildMeetingExportHtml(base)
  assert.doesNotMatch(html, /작성중|작성완료|보관/)
})

test('시스템 UI 흔적(칩·AI 정제본 머리말)이 문서에 남지 않는다', () => {
  const html = buildMeetingExportHtml(base)
  assert.doesNotMatch(html, /chip-mem|chip-ext/)
  assert.doesNotMatch(html, /AI 정제본/)
})

test('본문은 번호 붙은 절로 렌더된다 (요약=회의 내용, 결정사항)', () => {
  const html = buildMeetingExportHtml(base)
  assert.match(html, /<h2><span class="no">1<\/span>회의 내용<\/h2>/)
  assert.match(html, /<h2><span class="no">2<\/span>결정사항<\/h2>/)
  assert.match(html, /요약 내용/)
  assert.match(html, /결정 내용/)
})

test('요약이 없으면 결정사항이 1번이 된다 (빈 번호 남기지 않음)', () => {
  const html = buildMeetingExportHtml({ ...base, summary: '' })
  assert.match(html, /<h2><span class="no">1<\/span>결정사항<\/h2>/)
  assert.doesNotMatch(html, /<span class="no">2<\/span>결정사항/)
})

test('개조식("- 항목") 줄은 실제 글머리표 목록으로 렌더된다', () => {
  const html = buildMeetingExportHtml({ ...base, summary: '- 첫째 항목\n- 둘째 항목', decisions: '' })
  assert.match(html, /<ul class="bullets"><li>첫째 항목<\/li><li>둘째 항목<\/li><\/ul>/)
})

test('줄글 요약은 목록으로 바꾸지 않고 원문 그대로 둔다', () => {
  const html = buildMeetingExportHtml({ ...base, summary: '한 문단으로 쓴 요약입니다.', decisions: '' })
  assert.match(html, /<p class="pre">한 문단으로 쓴 요약입니다\.<\/p>/)
})

test('작성자를 모르면 그 행 자체를 만들지 않는다 (빈 칸을 남기지 않는다)', () => {
  const html = buildMeetingExportHtml({ ...base, authorName: '' })
  assert.doesNotMatch(html, /<th>작성자<\/th>/)
  assert.match(html, /<th>작성일시<\/th>/) // 있는 것은 그대로
})

test('부서는 표에 넣지 않는다 — 하단 발행 주체가 이미 밝힌다', () => {
  const html = buildMeetingExportHtml(base)
  assert.doesNotMatch(html, /<th>부/)
})

test('참석자 없으면 참석자 행을 생략한다', () => {
  const html = buildMeetingExportHtml({ ...base, memberAttendees: [], externalAttendees: [] })
  assert.doesNotMatch(html, /참 석 자/)
})

test('원본 뷰는 소독된 bodyHtml을 회의 내용 절에 주입한다', () => {
  const html = buildMeetingExportHtml({ ...base, view: 'original', bodyHtml: '<ul><li>항목</li></ul>' })
  assert.match(html, /<h2><span class="no">1<\/span>회의 내용<\/h2>/)
  assert.match(html, /<div class="rich"><ul><li>항목<\/li><\/ul><\/div>/)
})

test('plain text 필드는 이스케이프되어 마크업 주입을 막는다', () => {
  const html = buildMeetingExportHtml({
    ...base, title: '<img src=x onerror=alert(1)>', summary: '<script>bad()</script>', authorName: '<b>김</b>',
  })
  assert.doesNotMatch(html, /<img src=x/)
  assert.doesNotMatch(html, /<script>bad\(\)/)
  assert.doesNotMatch(html, /<b>김<\/b>/)
  assert.match(html, /&lt;img src=x/)
})

test('정제본이 비면 안내 문구를 렌더한다', () => {
  const html = buildMeetingExportHtml({ ...base, summary: '', decisions: '' })
  assert.match(html, /AI 정제본이 없습니다/)
})

test('제목 없으면 (제목 없음)으로 대체한다', () => {
  const html = buildMeetingExportHtml({ ...base, title: '   ' })
  assert.match(html, /\(제목 없음\)/)
})

test('문서의 끝을 알리고 발행 주체를 밝힌다', () => {
  const html = buildMeetingExportHtml(base)
  assert.match(html, /— 이 상 —/)
  assert.match(html, /데이터얼라이언스 · AX사업본부/)
})
