// lib/meeting/workbench-wiring.test.ts — 회의 작업대 배선 가드
//
// **왜 이 가드가 필요한가.** 이 저장소가 같은 사고를 반복했다:
// 만들어 놓고 **안 꽂아서** 없는 기능이 되는 것.
//   · v0.7.588 실측: `MeetingCapture` 가 `?record=1` 을 붙여 상세로 보내는데
//     그 쿼리를 읽는 코드가 **어디에도 없었다** — 미팅은 생기고 녹음은 시작되지 않았다.
//   · 같은 판: 전사가 DB 에 쌓이는데 `(member)/meeting-notes/` 에 `transcript` 참조 0건.
//   · 같은 판: `crm_meeting.summaryMd` 를 타입으로만 받고 화면에 안 그렸다.
// 셋 다 tsc·단위테스트·리뷰가 전부 초록이었다. 정적 배선 검사만이 잡는 부류다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { read, stripComments } from '../ui/component-scan.ts'

/** 주석 속 사고 기록을 위반으로 세지 않는다 — 왜 그랬는지를 못 적게 되면 다음 사람이 또 한다 */
function code(file: string): string { return stripComments(read(file)) }

const CAPTURE = 'app/(crm)/crm/meetings/new/MeetingCapture.tsx'
const CRM_DETAIL = 'app/(crm)/crm/meetings/[id]/MeetingDetail.tsx'
const NOTE_DETAIL = 'app/(member)/meeting-notes/MeetingDetailClient.tsx'
const SHELL = 'components/ui/shell/AppShell.tsx'
const WORKBENCH = 'components/meeting/MeetingWorkbench.tsx'

test('★ 녹음 제공자가 셸에 실제로 마운트돼 있다 — 없으면 라우트 이동에 녹음이 죽는다', () => {
  const src = read(SHELL)
  assert.ok(src.includes('RecordingProvider'), '셸이 RecordingProvider 를 감싸야 한다')
  assert.ok(src.includes('<RecordingBar />'), '녹음 중임을 어느 화면에서든 보여 줘야 한다')
})

test('★ 죽은 ?record= 쿼리가 되살아나지 않는다 — 읽는 곳이 없는 신호를 붙이지 않는다', () => {
  const src = code(CAPTURE)
  assert.ok(!/record=1/.test(src), '쿼리로 다른 화면에 "녹음해라"를 시키지 않는다 — 여기서 켠다')
  assert.ok(src.includes('rec.start('), '녹음은 이 화면에서 직접 시작한다')
})

test('★ 녹음 시작이 주소 교체보다 먼저다 — 순서가 뒤집히면 예전 사고로 되돌아간다', () => {
  const src = code(CAPTURE)
  const startAt = src.indexOf('await rec.start(')
  const replaceAt = src.indexOf('router.replace', startAt)
  assert.ok(startAt > 0, 'rec.start 호출이 있어야 한다')
  assert.ok(replaceAt > startAt, 'router.replace 는 rec.start 뒤에 와야 한다')
})

test('★ 두 셸이 같은 작업대를 쓴다 — 가운데가 갈리면 "같은 플랫폼 공유"가 깨진다', () => {
  for (const f of [CRM_DETAIL, NOTE_DETAIL]) {
    assert.ok(read(f).includes('MeetingWorkbench'), `${f} 가 작업대를 써야 한다`)
  }
})

test('★ 진입 넷이 다 있다 — 쓰기가 빠져 사용자가 다른 셸로 나가야 했다', () => {
  const src = read(CAPTURE)
  for (const label of ['녹음 시작', '직접 쓰기', '회의 내용 붙여넣기', '회의노트에서 가져오기']) {
    assert.ok(src.includes(label), `진입 "${label}" 이 있어야 한다`)
  }
})

test('★ 붙여넣기는 원본(회의노트)으로 간다 — CRM 에만 넣으면 노트가 빈 껍데기로 남는다', () => {
  const src = code(CAPTURE)
  assert.ok(
    /\/api\/meeting-notes\/\$\{[^}]*noteId\}\/transcript/.test(src),
    '붙여넣기가 회의노트 전사 API 로 가야 한다',
  )
})

test('★ 작업대가 세 층을 전부 그린다 — 하나라도 빠지면 그 층이 화면에서 사라진다', () => {
  const src = read(WORKBENCH)
  for (const part of ['MeetingMemoEditor', 'MeetingTranscriptView', 'MeetingDigestPanel', 'RecordingPanel']) {
    assert.ok(src.includes(part), `${part} 가 배선돼야 한다`)
  }
})

test('★ 정리 패널이 정리 API 를 실제로 부른다 — 만들고 안 부르면 버튼이 장식이다', () => {
  const src = read('components/meeting/MeetingDigestPanel.tsx')
  assert.ok(src.includes('/digest'), '정리 API 를 불러야 한다')
  assert.ok(src.includes("method: 'POST'"), '실행은 POST 다')
})

test('★ 공개범위 스위치가 작업대에 붙어 있다 — 컬럼·정책만 있고 화면이 없던 자리다', () => {
  assert.ok(read(WORKBENCH).includes('NoteVisibilitySwitch'))
  assert.ok(read('components/meeting/NoteVisibilitySwitch.tsx').includes("method: 'PATCH'"))
})

test('★ 발행해 온 요약을 CRM 상세가 그린다 — 타입으로만 받고 안 그리던 자리다(F-6)', () => {
  const src = read(CRM_DETAIL)
  assert.ok(/\{m\.summaryMd/.test(src), 'summaryMd 를 화면에 그려야 한다')
})

test('★ 전사를 볼 화면이 있다 — 쌓기만 하고 볼 곳이 없던 자리다(F-4)', () => {
  const src = read('components/meeting/MeetingTranscriptView.tsx')
  assert.ok(src.includes('/transcript'), '전사 API 를 불러야 한다')
  assert.ok(src.includes('formatSegmentTime'), '시각을 함께 보여 줘야 한다')
})

test('본문 자동저장이 실제로 서버로 간다 — 로컬에만 남으면 다른 기기에서 사라진다', () => {
  const src = read('components/meeting/MeetingMemoEditor.tsx')
  assert.ok(src.includes("method: 'PATCH'"), '서버 저장이 있어야 한다')
  assert.ok(src.includes('useDraftPersist'), '로컬 임시저장은 두 번째 방어선이다')
  assert.ok(src.includes('keepalive'), '떠날 때 마지막 한 번을 밀어 넣어야 한다')
})

test('녹음은 주인만 — 남의 회의노트에서 「녹음 시작」이 보이면 안 된다', () => {
  // 실측 v0.7.593: 남의 노트를 열었는데 녹음 버튼이 눌렸다. 서버는 403 으로 막지만,
  // 회의를 다 녹음한 뒤 저장이 실패하면 그 회의는 통째로 사라진다.
  const wb = code('components/meeting/MeetingWorkbench.tsx')
  assert.match(wb, /canEdit\s*&&\s*\(\s*<RecordingPanel/,
    'RecordingPanel 이 canEdit 게이트 밖에 있다')
})

test('탭 렌더러는 밖에서 바뀐 주소를 따라간다 — 「근거」가 전사로 못 넘어가던 결함', () => {
  // 실측 v0.7.593: URL 은 ?wb=transcript 로 바뀌는데 화면은 정리 탭 그대로였다.
  // SegmentedTabs 가 URL 을 마운트 때 한 번만 읽고 그 뒤로는 쓰기만 했다.
  const st = code('components/ui/SegmentedTabs.tsx')
  assert.match(st, /if\s*\(fromUrl\s*!==\s*seenUrl\)/,
    'SegmentedTabs 가 외부 URL 변화를 따라가지 않는다')
  // 그리고 이동은 라우터를 거쳐야 한다 — history.pushState 로는 useSearchParams 가 안 깨어난다
  const wb = code('components/meeting/MeetingWorkbench.tsx')
  assert.ok(!/pushState/.test(wb), '근거 이동에 history.pushState 를 쓰면 탭이 안 넘어간다')
  assert.match(wb, /router\.replace\(/, '근거 이동이 라우터를 거치지 않는다')
})
