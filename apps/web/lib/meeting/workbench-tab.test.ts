// lib/meeting/workbench-tab.test.ts — 작업대 기본 탭 + 회의노트↔CRM 한 벌 계약 가드
//
// **왜 이 가드가 필요한가** (사용자 지적 2026-08-31):
//   「제목부터가 다르고 … 작성된 내용이 먼저 나와야 하는곳에서는 녹음 전사가 갑자기 나오고 …
//    데이터도 같은 DB에서 가져오는게 아닌가보다」
//
// 세 결함이 전부 tsc·단위테스트·리뷰를 통과하고 있었다. 정적 배선 검사만이 잡는 부류다:
//   ① 목록 링크가 `?wb=transcript` 를 조건 없이 붙였다 → 빈 전사 탭이 열렸다
//   ② 재동기화가 `title` 을 덮었다 → 사용자가 고친 제목이 조용히 사라졌다
//   ③ AI 가 CRM 전사 사본만 봤다 → 원본에 있는 193자를 「없다」고 답했다

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { read, stripComments } from '../ui/component-scan.ts'
import {
  WORKBENCH_TABS, hasBodyContent, isWorkbenchTab, pickDefaultWorkbenchTab,
} from './workbench-tab.ts'

/** 주석 속 사고 기록을 위반으로 세지 않는다 — 왜 그랬는지를 못 적게 되면 다음 사람이 또 한다 */
function code(file: string): string { return stripComments(read(file)) }

const INTAKE = 'components/crm/MeetingIntakeBox.tsx'
const WORKBENCH = 'components/meeting/MeetingWorkbench.tsx'
const TABS = 'components/ui/SegmentedTabs.tsx'
const NOTE_API = 'app/api/meeting-notes/[id]/route.ts'
const CRM_API = 'app/api/crm/meetings/[id]/route.ts'
const EXTRACT_API = 'app/api/crm/meetings/[id]/extract/route.ts'
const FINISH_API = 'app/api/crm/meetings/[id]/finish/route.ts'
const FINISH_SVC = 'lib/crm/services/meeting-finish.ts'
const MEETING_SVC = 'lib/crm/services/meeting.ts'
const PUBLISH = 'lib/crm/services/meeting-publish.ts'
const CRM_DETAIL = 'app/(crm)/crm/meetings/[id]/MeetingDetail.tsx'
const FACTS = 'app/(crm)/crm/meetings/[id]/MeetingFacts.tsx'
const NOTE_PAGE = 'app/(member)/meeting-notes/[id]/page.tsx'
const NOTE_DETAIL = 'app/(member)/meeting-notes/MeetingDetailClient.tsx'

// ─────────────────────────────── 판정 자체 ───────────────────────────────

test('사람이 쓴 본문이 있으면 「작성」이 먼저다 — 사용자가 방금 쓴 것을 못 찾는 일이 없어야 한다', () => {
  assert.equal(pickDefaultWorkbenchTab({ hasBody: true, hasTranscript: false }), 'memo')
  assert.equal(pickDefaultWorkbenchTab({ hasBody: true, hasTranscript: true }), 'memo')
})

test('★ 본문이 없고 전사만 있으면 전사다 — 방향만 바꾼 같은 사고를 막는다', () => {
  assert.equal(pickDefaultWorkbenchTab({ hasBody: false, hasTranscript: true }), 'transcript')
})

test('둘 다 없으면 「작성」 — 빈 화면에서 할 일은 쓰기다(빈 전사 탭은 할 일이 없다)', () => {
  assert.equal(pickDefaultWorkbenchTab({ hasBody: false, hasTranscript: false }), 'memo')
})

test('「정리」는 절대 기본값이 되지 않는다 — 결과물만 열리면 원문을 볼 수 없다', () => {
  for (const hasBody of [true, false]) {
    for (const hasTranscript of [true, false]) {
      assert.notEqual(pickDefaultWorkbenchTab({ hasBody, hasTranscript }), 'digest')
    }
  }
})

test('★ 빈 Tiptap 본문을 「있다」로 세지 않는다 — <p></p> 는 한 글자도 안 쓴 상태다', () => {
  assert.equal(hasBodyContent(''), false)
  assert.equal(hasBodyContent('   \n  '), false)
  assert.equal(hasBodyContent(null), false)
  assert.equal(hasBodyContent(undefined), false)
  assert.equal(hasBodyContent('전자영수증, 다회용기'), true)
})

test('탭 id 는 작업대가 실제로 그리는 세 층과 같다 — 갈리면 조용히 빈 탭이 열린다', () => {
  assert.deepEqual([...WORKBENCH_TABS], ['memo', 'transcript', 'digest'])
  const src = code(WORKBENCH)
  for (const id of WORKBENCH_TABS) {
    assert.ok(src.includes(`id: '${id}'`), `작업대에 ${id} 탭이 있어야 한다`)
  }
  assert.ok(isWorkbenchTab('memo') && !isWorkbenchTab('nope'))
})

// ────────────────────── ① 열리는 탭 (사용자 증상 ②) ──────────────────────

test('★ 목록 링크가 탭을 강제하지 않는다 — 이 한 줄이 「전사가 갑자기 나온다」의 전부였다', () => {
  const src = code(INTAKE)
  /**
   * 금지하는 것은 **리터럴로 박은 탭**이다.
   *
   * 진입 버튼(녹음·직접 작성·붙여넣기)의 `?wb=${ENTRY[entry].wb}` 는 남긴다 —
   * 그건 사용자가 **무엇을 하려고 눌렀는지**가 곧 탭이라 정당하다.
   * 사고는 «아무 의도 없이 눌렀는데 탭이 강제된» 목록 링크에서 났다.
   */
  const hardcoded = src.match(/\?wb=(?!\$\{)[a-z]+/g) ?? []
  assert.deepEqual(
    hardcoded, [],
    `${INTAKE}: 링크에 탭을 리터럴로 박지 않는다. 작업대가 내용이 있는 곳을 연다`,
  )
})

test('녹음·붙여넣기 진입은 여전히 전사 탭을 지정한다 — 그때는 그것이 목적이다', () => {
  const src = code(INTAKE)
  assert.ok(src.includes("wb: 'transcript'"), '녹음/붙여넣기 진입은 전사 탭이 맞다')
  assert.ok(src.includes("wb: 'memo'"), '직접 작성 진입은 작성 탭이 맞다')
})

test('★ 작업대가 기본 탭을 SSOT 로 정한다 — 컴포넌트 안의 조건식은 실브라우저 말고 검증 수단이 없다(E-6)', () => {
  const src = code(WORKBENCH)
  assert.ok(src.includes('pickDefaultWorkbenchTab('), '작업대가 판정 SSOT 를 불러야 한다')
  assert.ok(src.includes('defaultId={'), 'SegmentedTabs 에 실제로 넘겨야 한다')
  assert.ok(src.includes('hasBodyContent('), '본문 유무도 SSOT 로 판정해야 한다')
})

test('탭 부품이 defaultId 를 실제로 쓴다 — 받아 놓고 안 쓰면 없는 기능이다', () => {
  const src = code(TABS)
  assert.ok(src.includes('defaultId'), 'Props 에 defaultId 가 있어야 한다')
  assert.ok(/fallbackId/.test(src), '주소가 없을 때 defaultId 로 떨어져야 한다')
})

test('노트 API 가 전사 유무를 준다 — 없으면 작업대가 판정할 재료가 없다', () => {
  const src = code(NOTE_API)
  assert.ok(src.includes('hasTranscript'), 'GET 응답에 hasTranscript 가 있어야 한다')
  assert.ok(src.includes('meeting_transcript_segment'), '노트 쪽 전사 표(마이그 217)를 본다')
})

// ────────────────────── ② 제목 한 벌 (사용자 증상 ①) ──────────────────────

test('★ 재동기화가 제목을 덮지 않는다 — 사용자가 고친 「8/31 김해사업 미팅」이 사라졌다', () => {
  const src = code(PUBLISH)
  const body = src.slice(src.indexOf('export async function resyncFromNote'))
  const end = body.indexOf('\nexport ', 10)
  const fn = end > 0 ? body.slice(0, end) : body
  assert.ok(
    !/\btitle:\s*normalizeText\(note\.title\)/.test(fn),
    'resyncFromNote 가 title 을 쓰면 사람이 손으로 넣은 제목이 파괴된다',
  )
  // 파생값은 계속 따라잡아야 한다 — 과하게 막아 기능을 없애면 안 된다
  assert.ok(fn.includes('summaryMd,'), '요약은 따라잡는다')
  assert.ok(fn.includes('attendeesJson,'), '참석자는 따라잡는다')
})

test('★ CRM 에서 제목을 고치면 원본도 함께 고친다 — 저장 경로가 갈려 있던 것이 원인이다', () => {
  const api = code(CRM_API)
  assert.ok(api.includes('syncNoteTitle('), 'PATCH 가 원본 제목을 함께 고쳐야 한다')
  assert.ok(api.includes('titleSync'), '결과를 화면이 알 수 있게 실어 보낸다')
})

test('제목 동기화는 주인만 — 남의 개인 노트를 팀원이 바꾸지 않는다', () => {
  const src = code(PUBLISH)
  const at = src.indexOf('export async function syncNoteTitle')
  assert.ok(at > 0, 'syncNoteTitle 이 있어야 한다')
  const fn = src.slice(at, at + 3000)
  assert.ok(fn.includes("return 'not_owner'"), '주인이 아니면 아무것도 쓰지 않는다')
  assert.ok(fn.includes(".eq('user_id', hostUserId)"), 'service_role 이라 소유 조건을 코드가 건다')
  assert.ok(fn.includes('wasStale'), '내가 방금 고친 것을 「원본이 수정됐어요」로 띄우지 않는다')
})

test('화면도 같은 경계를 그린다 — 못 하는 일은 누르기 전에 안 보인다', () => {
  assert.ok(code(CRM_DETAIL).includes('canEditTitle='), '상세가 권한을 내려보낸다')
  const facts = code(FACTS)
  assert.ok(facts.includes('canEditTitle'), '입력이 그 권한을 받는다')
  assert.ok(facts.includes('readOnly={!canEditTitle}'), '주인이 아니면 못 고친다')
})

test('이미 갈린 제목은 덮지 않고 사람에게 묻는다 — 어느 쪽이 의도인지 코드는 모른다', () => {
  const src = code(CRM_DETAIL)
  assert.ok(src.includes('titleDiffers'), '어긋남을 화면이 말해야 한다')
  assert.ok(src.includes('adoptNoteTitle('), '한 번 눌러 맞출 길이 있어야 한다')
})

// ─────────────── ③ AI 가 본문도 읽는다 (사용자 증상 ③) ───────────────

test('★ 본문 폴백은 **병목 안**에 있다 — 라우트에만 꽂으면 주 경로가 지나가지 않는다', () => {
  /**
   * 실측 v0.7.666: 처음에는 `/extract` 라우트에 꽂았다. 그런데 사용자가 실제로 누르는 버튼은
   * 「미팅 끝내기」이고, 그 경로(`finishMeeting`)는 `extractFiveAxis` 를 **직접** 부른다.
   * 브라우저에서 눌러 보고서야 알았다 — tsc·단위테스트·리뷰는 전부 초록이었다.
   * 그래서 두 경로가 다 지나가는 자리에 있는지를 가드가 본다.
   */
  const meeting = code(MEETING_SVC)
  const at = meeting.indexOf('export async function extractFiveAxis')
  assert.ok(at > 0, 'extractFiveAxis 가 있어야 한다')
  const fn = meeting.slice(at, at + 2200)
  assert.ok(
    fn.includes('snapshotNoteBodyForExtract('),
    'extractFiveAxis 안에서 본문 폴백을 불러야 한다 — 라우트에 두면 /finish 가 건너뛴다',
  )

  // 라우트에 두 벌로 남아 있지 않다 — 두 번 부르면 같은 본문이 두 번 들어간다
  assert.ok(
    !code(EXTRACT_API).includes('snapshotNoteBodyForExtract('),
    `${EXTRACT_API}: 폴백은 병목 한 곳에만 있다`,
  )

  // 두 경로가 모두 판정 재료(hostUserId)를 넘긴다 — 안 넘기면 폴백이 조용히 안 돈다
  // 중첩 괄호(`await adapterFromSetting(db)`)가 있어 정규식으로 인자를 세지 않는다 —
  // 계측이 문법을 흉내내면 없는 위반을 잡는다. 두 토큰이 함께 있는지만 본다.
  const extractRoute = code(EXTRACT_API)
  assert.ok(
    extractRoute.includes('extractFiveAxis(') && extractRoute.includes('session.hostUserId'),
    `${EXTRACT_API}: hostUserId 를 넘겨야 한다`,
  )
  assert.ok(
    code(FINISH_API).includes('hostUserId: session.hostUserId'),
    `${FINISH_API}: hostUserId 를 넘겨야 한다`,
  )
  assert.ok(
    code(FINISH_SVC).includes('deps.hostUserId'),
    `${FINISH_SVC}: 받은 hostUserId 를 추출로 흘려야 한다`,
  )
})

test('새 AI 경로를 만들지 않는다 — 기존 스냅샷 경로를 그대로 쓴다(§재사용·단일구현)', () => {
  const src = code(PUBLISH)
  const at = src.indexOf('export async function snapshotNoteBodyForExtract')
  assert.ok(at > 0, 'snapshotNoteBodyForExtract 가 있어야 한다')
  const fn = src.slice(at, at + 2600)
  assert.ok(fn.includes('pickTranscriptSource('), '본문 선택은 기존 SSOT 를 쓴다')
  assert.ok(fn.includes('pastedTranscriptAdapter('), '세그먼트 변환도 기존 것을 쓴다')
  assert.ok(fn.includes('NOTE_SNAPSHOT_VENDOR'), '출처를 남겨 사람이 붙여넣은 것과 구분한다')
  assert.ok(fn.includes("status: 'TRANSCRIBED'"), '이미 읽을 것이 있으면 손대지 않는다')
  assert.ok(fn.includes('loadReadableNote('), '볼 수 있는 노트만 읽는다(canOpen 과 같은 규칙)')
  assert.ok(/catch\s*\{/.test(fn), '재료를 못 구한 것이 추출을 막지 않는다')
})

test('화면 게이트가 전사 사본만 보지 않는다 — 원본 본문도 재료로 센다', () => {
  const src = code(CRM_DETAIL)
  assert.ok(src.includes('const readable ='), '읽을 재료 판정이 있어야 한다')
  assert.ok(src.includes('hasBody'), '원본 본문 유무를 봐야 한다')
  assert.ok(
    src.includes('m.note.canOpen && m.note.hasBody'),
    '화면 게이트와 서버 폴백의 권한 규칙이 같아야 한다 — 다르면 눌러 보고서야 안다',
  )
  assert.ok(
    !/action=\{transcribed \?/.test(src),
    'AI 버튼이 전사 사본만 보고 열리면 안 된다',
  )
})

test('원본 상태에 hasBody 가 실려 온다 — 없으면 위 게이트가 판정할 수 없다', () => {
  assert.ok(code(PUBLISH).includes('hasBody: Boolean('), 'loadNoteMeta 가 본문 유무를 준다')
})

// ─────────────── 노트 화면이 회사·딜을 안다 (사용자 증상 ③의 다른 축) ───────────────

test('★ 노트 화면이 「이건 어느 회사 건」인지 말한다 — 표시 코드가 0줄이었다', () => {
  assert.ok(code(NOTE_PAGE).includes('loadCrmFactsForNote('), '서버가 CRM 사실을 붙여 준다')
  const detail = code(NOTE_DETAIL)
  assert.ok(detail.includes('crm.companyName'), '회사 이름을 그린다')
  assert.ok(detail.includes('/crm/meetings/'), 'CRM 미팅으로 가는 길이 있다')
})

test('역방향 창구는 좁다 — 목록·검색·집계를 열지 않는다(권한 경계)', () => {
  const src = code(PUBLISH)
  const at = src.indexOf('export async function loadCrmFactsForNote')
  assert.ok(at > 0, 'loadCrmFactsForNote 가 있어야 한다')
  const fn = src.slice(at, at + 2600)
  assert.ok(fn.includes('findFirst('), '한 건만 읽는다')
  assert.ok(!fn.includes('findMany('), '목록을 열지 않는다')
  assert.ok(fn.includes('resolveCrmAccessForUser('), '워크스페이스 멤버십을 확인한다')
  assert.ok(/catch\s*\{/.test(fn), '부가 정보가 회의노트 화면을 죽이지 않는다')
})
