/**
 * 회의 옆 패널.
 *
 * 사용자 지적(2026-10-21): 녹음하며 다른 미팅 기록을 보려면 새 탭을 열어야 했다.
 * 지키는 것: 주소가 패널을 쥐고, 같은 회사가 먼저 오고, 지금 회의는 목록에 없다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  SIDE_PARAM, appendParagraph, orderOtherRecords, parseSideTab, summaryLines,
  type CrmMeetingRow, type NoteRow,
} from './side-panel.ts'

const note = (id: string, at: string, title = id): NoteRow => ({
  id, title, meeting_at: at, created_at: at, summary: null,
})
const crm = (id: string, at: string, companyId: string | null, noteId: string | null = null): CrmMeetingRow => ({
  id, title: id, startedAt: at, companyId, companyName: companyId ? `회사 ${companyId}` : null, summaryMd: null, noteId,
})

test('주소 ?side= 값 중 아는 탭만 연다, 모르는 값과 빈 값은 닫힘', () => {
  assert.equal(SIDE_PARAM, 'side')
  assert.equal(parseSideTab('records'), 'records')
  assert.equal(parseSideTab('ask'), 'ask')
  assert.equal(parseSideTab(null), null)
  assert.equal(parseSideTab(''), null)
  assert.equal(parseSideTab('digest'), null)
})

test('같은 회사 기록이 더 오래됐어도 먼저 오고, 그 안에서는 최근 것이 먼저', () => {
  const rows = orderOtherRecords({
    notes: [note('n-new', '2026-10-20T00:00:00Z')],
    crmMeetings: [
      crm('m-other', '2026-10-19T00:00:00Z', 'B'),
      crm('m-same-old', '2026-01-01T00:00:00Z', 'A'),
      crm('m-same-new', '2026-05-01T00:00:00Z', 'A'),
    ],
    currentNoteId: 'cur', companyId: 'A', meetingMode: false,
  })
  assert.deepEqual(rows.map((r) => r.key), ['crm:m-same-new', 'crm:m-same-old', 'note:n-new', 'crm:m-other'])
  assert.deepEqual(rows.map((r) => r.sameCompany), [true, true, false, false])
})

test('지금 회의는 회의노트로 와도 CRM 미팅으로 와도 목록에서 빠진다', () => {
  const rows = orderOtherRecords({
    notes: [note('cur', '2026-10-20T00:00:00Z'), note('n1', '2026-10-19T00:00:00Z')],
    crmMeetings: [crm('m-cur', '2026-10-20T00:00:00Z', 'A', 'cur')],
    currentNoteId: 'cur', companyId: 'A', meetingMode: false,
  })
  assert.deepEqual(rows.map((r) => r.key), ['note:n1'])
})

test('같은 원본을 가리키는 CRM 미팅과 회의노트는 한 줄, 회사를 아는 CRM 쪽이 남는다', () => {
  const rows = orderOtherRecords({
    notes: [note('n1', '2026-10-19T00:00:00Z')],
    crmMeetings: [crm('m1', '2026-10-19T00:00:00Z', 'A', 'n1')],
    currentNoteId: 'cur', companyId: 'A', meetingMode: false,
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].key, 'crm:m1')
  assert.equal(rows[0].noteId, 'n1')
})

test('회사를 모르면 같은 회사 묶음이 없고 최근 순으로만 선다', () => {
  const rows = orderOtherRecords({
    notes: [note('n-old', '2026-01-01T00:00:00Z'), note('n-new', '2026-10-01T00:00:00Z')],
    crmMeetings: [crm('m', '2026-05-01T00:00:00Z', 'A')],
    currentNoteId: 'cur', companyId: null, meetingMode: false,
  })
  assert.deepEqual(rows.map((r) => r.key), ['note:n-new', 'crm:m', 'note:n-old'])
  assert.ok(rows.every((r) => !r.sameCompany))
})

test('제목 없는 회의노트는 빈 줄 대신 이름을 단다', () => {
  const rows = orderOtherRecords({
    notes: [note('n1', '2026-10-01T00:00:00Z', '  ')],
    crmMeetings: [], currentNoteId: 'cur', companyId: null, meetingMode: false,
  })
  assert.equal(rows[0].title, '제목 없는 회의')
})

test('요약 줄은 글머리표와 [절 제목]을 걷어 낸다', () => {
  assert.deepEqual(summaryLines('[결정]\n- 가격 확정\n• 다음 주 재방문\n\n'), ['가격 확정', '다음 주 재방문'])
  assert.deepEqual(summaryLines(null), [])
})

test('메모에 붙이는 줄은 마크업으로 읽히지 않고, 빈 메모는 그 자리를 채운다', () => {
  assert.equal(appendParagraph('<p></p>', '<b>견적</b>'), '<p>&lt;b&gt;견적&lt;/b&gt;</p>')
  assert.equal(appendParagraph('<p>앞</p>', '뒤'), '<p>앞</p><p>뒤</p>')
})

test('회의 화면이 옆 패널을 실제로 그리고 여는 단추가 있다', () => {
  const src = readFileSync(new URL('../../components/meeting/MeetingWorkbench.tsx', import.meta.url), 'utf8')
  assert.match(src, /<MeetingSidePanel tabs=\{\{\s*records: <OtherRecords noteId=\{noteId\}/)
  assert.match(src, /openSide\('records'\)/)
  // 묻기 탭도 같은 패널에 그리고, 여는 단추와 근거로 가는 길이 붙어 있다
  assert.match(src, /ask: <AskPanel noteId=\{noteId\}[^>]*onEvidence=\{onAskEvidence\}/)
  assert.match(src, /openSide\('ask'\)/)
})

test('패널은 모달이 아니다: 열려 있어도 본문이 비켜 서서 메모 칸이 가려지지 않는다', () => {
  const css = readFileSync(new URL('../../components/meeting/side-panel.module.css', import.meta.url), 'utf8')
  assert.match(css, /:global\(main\.page-inner\):has\(\.panel\) \{ padding-right:/)
  const panel = readFileSync(new URL('../../components/meeting/MeetingSidePanel.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(panel, /aria-modal/)
})

test('목록을 못 불러오면 「기록이 없어요」를 같이 그리지 않고 다시 시도를 준다', () => {
  const src = readFileSync(new URL('../../components/meeting/OtherRecords.tsx', import.meta.url), 'utf8')
  // 실패 갈래가 빈 목록 갈래보다 앞에서 끝나야 한다 — 같은 삼항 안의 첫 갈래
  assert.match(src, /\{error \? \([\s\S]*?ACTION\.retry[\s\S]*?\) : rows === null \?/)
  assert.doesNotMatch(src, /\{error && <InlineError/)
})

test('회의 모드면 다른 회사 기록과 회사 모르는 회의노트가 목록에서 빠진다', () => {
  const rows = orderOtherRecords({
    notes: [note('n1', '2026-10-21T09:00:00Z')],
    crmMeetings: [crm('a1', '2026-10-01T00:00:00Z', 'A'), crm('b1', '2026-10-20T00:00:00Z', 'B')],
    currentNoteId: 'cur', companyId: 'A', meetingMode: true,
  })
  assert.deepEqual(rows.map((r) => r.key), ['crm:a1'])
})

test('메모에 붙이기: 회의 화면이 고칠 수 있을 때만 넘기고, 편집기는 최신 글 끝에 붙인다', () => {
  const wb = readFileSync(new URL('../../components/meeting/MeetingWorkbench.tsx', import.meta.url), 'utf8')
  assert.match(wb, /<OtherRecords noteId=\{noteId\} onPickLine=\{canEdit \? pickLine : undefined\} \/>/)
  // 다시 그려질 때 처음 불러온 값이 아니라 이 화면에서 쓴 글로 열린다 — 옛 글에 붙여 저장하면 쓴 글이 사라진다
  assert.match(wb, /initialHtml=\{memoHtml\.current \?\? note\.bodyHtml\}/)
  const ed = readFileSync(new URL('../../components/meeting/MeetingMemoEditor.tsx', import.meta.url), 'utf8')
  assert.match(ed, /appendParagraph\(latest\.current, appendRequest\.text\)/)
  const rec = readFileSync(new URL('../../components/meeting/OtherRecords.tsx', import.meta.url), 'utf8')
  // 회의노트 기록에도 붙일 줄이 있다 — 정리본만 띄우면 목록 대부분에서 붙이기가 없다
  assert.match(rec, /메모에 붙일 줄 선택/)
})

test('같은 붙이기 요청은 한 번만 받는다 — 다시 그려질 때 같은 줄이 두 번 붙지 않게', () => {
  const ed = readFileSync(new URL('../../components/meeting/MeetingMemoEditor.tsx', import.meta.url), 'utf8')
  const body = ed.slice(ed.indexOf('const appendedId = useRef(0)'), ed.indexOf('appendParagraph(latest.current'))
  assert.match(body, /if \(appendRequest\.id <= appendedId\.current\) return/)
  assert.match(body, /appendedId\.current = appendRequest\.id/)
})

test('마크다운 제목 줄(## 결정사항)은 붙일 줄에서 빠진다', () => {
  assert.deepEqual(summaryLines('## 결정사항\n- 예산 13억 확정\n### 할 일\n자료 받기'), ['예산 13억 확정', '자료 받기'])
})
