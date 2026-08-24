import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  readShareState, planShareState, needsConfirm,
  CHOOSABLE_SHARE_STATES, SHARE_STATE_LABEL, SHARE_STATE_HINT,
  type MeetingShareState,
} from './share-state.ts'
import { NOTE_VISIBILITY } from './note-visibility.ts'
import { read, stripComments } from '../ui/component-scan.ts'

test('CRM에 미팅이 없으면 나만 보기다 — 발행하지 않은 회의노트의 기본 상태', () => {
  assert.equal(
    readShareState({ hasLiveMeeting: false, hasNoteLink: false, visibility: null }),
    'PRIVATE',
  )
  // 미팅이 없으면 visibility 가 무엇이든 팀은 볼 수 없다 — 연결된 CRM 자체가 없다
  assert.equal(
    readShareState({ hasLiveMeeting: false, hasNoteLink: true, visibility: NOTE_VISIBILITY.CRM }),
    'PRIVATE',
  )
})

test('미팅 + 영업팀 공개 = 팀 공개', () => {
  assert.equal(
    readShareState({ hasLiveMeeting: true, hasNoteLink: true, visibility: NOTE_VISIBILITY.CRM }),
    'TEAM',
  )
})

test('★ 미팅은 있는데 원본이 잠겼으면 "기록만"이다 — 예전엔 이걸 "나만 보기"라고 불렀다', () => {
  // 사용자 지적의 핵심: 팀은 요약·전사 사본을 그대로 본다. "나만 보기"가 아니다.
  assert.equal(
    readShareState({ hasLiveMeeting: true, hasNoteLink: true, visibility: NOTE_VISIBILITY.PRIVATE }),
    'RECORD_ONLY',
  )
})

test('★ 원본 링크가 없는 미팅은 고를 수 없는 상태다 — 옛 CRM 미팅이 여기 온다', () => {
  assert.equal(
    readShareState({ hasLiveMeeting: true, hasNoteLink: false, visibility: null }),
    'NO_SOURCE',
  )
  assert.ok(!CHOOSABLE_SHARE_STATES.includes('NO_SOURCE'), '스위치에 넣지 않는다')
})

test('★ "기록만"은 링크를 끊지 않는다 — 끊으면 재발행이 같은 회의를 두 벌 만든다', () => {
  const plan = planShareState('RECORD_ONLY')
  assert.equal(plan.wantMeeting, true, '미팅은 그대로 살아 있어야 한다')
  assert.equal(plan.visibility, NOTE_VISIBILITY.PRIVATE, '원본만 잠근다')
  // 계획 어디에도 "링크를 끊어라"가 없다 — 그게 이 재설계의 요점이다
  assert.ok(!Object.keys(plan).includes('noteId'), '계획이 noteId 를 만지지 않는다')
})

test('팀 공개는 미팅을 두고 원본을 연다', () => {
  assert.deepEqual(planShareState('TEAM'), { wantMeeting: true, visibility: NOTE_VISIBILITY.CRM })
})

test('나만 보기로 내리면 미팅을 없애고 원본도 잠근다 — 둘 다 해야 진짜 나만 보기다', () => {
  assert.deepEqual(planShareState('PRIVATE'), { wantMeeting: false, visibility: NOTE_VISIBILITY.PRIVATE })
})

test('★ 고를 수 없는 상태를 넘기면 던진다 — 조용히 넘기면 사용자는 바뀐 줄 안다', () => {
  assert.throws(() => planShareState('NO_SOURCE'), /고를 수 없는/)
})

test('읽기와 쓰기가 왕복한다 — 고른 상태로 계획을 세워 적용하면 그 상태가 다시 읽힌다', () => {
  for (const s of CHOOSABLE_SHARE_STATES) {
    const plan = planShareState(s)
    const back = readShareState({
      hasLiveMeeting: plan.wantMeeting,
      // 링크는 발행하면 늘 생기고, 이제 지우는 경로가 없다
      hasNoteLink: plan.wantMeeting,
      visibility: plan.visibility,
    })
    assert.equal(back, s, `${s} 로 옮기면 ${s} 로 읽혀야 한다`)
  }
})

test('★ 되돌릴 수 없는 일이 섞일 때만 확인을 받는다 — 매번 물으면 아무도 안 읽는다', () => {
  assert.equal(needsConfirm('TEAM', 'PRIVATE'), true, '팀이 보던 것이 사라진다')
  assert.equal(needsConfirm('RECORD_ONLY', 'PRIVATE'), true)
  assert.equal(needsConfirm('TEAM', 'RECORD_ONLY'), false, '읽기 범위만 좁힌다')
  assert.equal(needsConfirm('RECORD_ONLY', 'TEAM'), false)
  assert.equal(needsConfirm('PRIVATE', 'TEAM'), false, '새로 올리는 것은 되돌릴 수 있다')
  assert.equal(needsConfirm('PRIVATE', 'PRIVATE'), false, '같은 상태는 전이가 아니다')
})

test('모든 상태에 사람이 읽는 이름과 "팀이 무엇을 보는지"가 있다', () => {
  const all: MeetingShareState[] = ['PRIVATE', 'RECORD_ONLY', 'TEAM', 'NO_SOURCE']
  for (const s of all) {
    assert.ok(SHARE_STATE_LABEL[s]?.length > 0, `${s} 에 이름이 있어야 한다`)
    assert.ok(SHARE_STATE_HINT[s]?.length > 0, `${s} 에 설명이 있어야 한다`)
  }
})

test('★ "기록만" 설명은 팀이 요약·전사를 본다고 분명히 말한다 — 이걸 숨긴 것이 사고였다', () => {
  const hint = SHARE_STATE_HINT.RECORD_ONLY
  assert.ok(/영업팀/.test(hint), '누가 보는지 밝힌다')
  assert.ok(/요약|전사/.test(hint), '무엇을 보는지 밝힌다')
  assert.ok(/원본/.test(hint), '무엇은 못 보는지 밝힌다')
})

test('스위치 순서는 좁은 것에서 넓은 것으로 — 사람이 범위로 읽는다', () => {
  assert.deepEqual(CHOOSABLE_SHARE_STATES, ['PRIVATE', 'RECORD_ONLY', 'TEAM'])
})

/* ────────────────────────────────────────────────────────────────────────────
 * 배선 가드 — 이 부류는 화면을 열어야만 보이고 tsc·단위테스트는 전부 초록이다
 * ──────────────────────────────────────────────────────────────────────────── */

test('★ 원본 링크(noteId)를 지우는 코드가 남아 있지 않다 — 그게 중복 미팅의 원인이었다', () => {
  const src = stripComments(read('lib/crm/services/meeting-publish.ts'))
  assert.ok(
    !/noteId:\s*null/.test(src),
    'noteId 를 null 로 만들면 재발행이 기존 미팅을 못 찾아 같은 회의가 두 벌이 된다',
  )
})

test('★ 상태 전환은 SSOT 를 거친다 — 화면이 visibility 와 미팅을 따로 만지면 손잡이가 다시 갈린다', () => {
  const src = stripComments(read('lib/crm/services/meeting-publish.ts'))
  assert.ok(src.includes('planShareState('), '무엇을 바꿀지는 SSOT 가 정한다')
  assert.ok(src.includes('readShareState('), '지금 상태도 SSOT 가 읽는다')
})

test('★ 회의노트 화면에 손잡이가 하나뿐이다 — 작업대 스위치는 꺼 둔다', () => {
  const src = stripComments(read('app/(member)/meeting-notes/MeetingDetailClient.tsx'))
  assert.ok(
    /showVisibility=\{false\}/.test(src),
    '하단 카드가 세 상태를 맡으므로 작업대에서 또 정하게 하지 않는다',
  )
})

test('★ 본문이 없으면 AI 카드를 그리지 않는다 — 제목만 남은 빈 상자가 되던 자리', () => {
  const src = stripComments(read('app/(member)/meeting-notes/MeetingDetailClient.tsx'))
  assert.ok(
    /body_plain[^\n]*\.trim\(\)\.length > 0 &&/.test(src),
    '본문이 있을 때만 MeetingReadBody 를 그린다',
  )
})

test('★ CRM 미팅 상세는 열어도 되는 원본일 때만 작업대를 그린다 — 아니면 오류 상자가 뜬다', () => {
  const src = stripComments(read('app/(crm)/crm/meetings/[id]/MeetingDetail.tsx'))
  assert.ok(
    /note\?\.exists && m\.note\.canOpen \? \(\s*<MeetingWorkbench/.test(src),
    'exists 만 보면 비공개 원본에서 404 를 받아 오류를 그린다',
  )
})

test('★ 화면이 공개 범위 문자열을 직접 짓지 않는다 — 말이 갈리면 같은 상태가 다르게 읽힌다', () => {
  for (const f of [
    'app/(member)/meeting-notes/CrmPublishCard.tsx',
    'components/meeting/NoteVisibilitySwitch.tsx',
  ]) {
    const src = stripComments(read(f))
    assert.ok(
      src.includes('SHARE_STATE_LABEL'),
      `${f}: 라벨은 손잡이 SSOT 에서 가져온다`,
    )
  }
})

test('★ "기록만"으로 가는 길이 확인창 안에 있다 — 내리기 말고 다른 수가 있다는 걸 알려야 한다', () => {
  const src = read('app/(member)/meeting-notes/CrmPublishCard.tsx')
  assert.ok(src.includes("apply('RECORD_ONLY')"), '확인창에서 기록만으로 두는 길을 준다')
})

test('★ 계정 메뉴의 나가는 문은 관리자 조건 안에 있지 않다 — 일반 멤버가 갇히던 자리', () => {
  const src = stripComments(read('components/ui/SidebarProfile.tsx'))
  assert.ok(src.includes('exitLinkFor('), '판정은 SSOT 가 한다')
  assert.ok(
    !/const inAdmin = pathname/.test(src),
    '/admin 한 줄 판정이 되돌아오면 CRM·CI 에서 다시 나갈 길이 사라진다',
  )
})
