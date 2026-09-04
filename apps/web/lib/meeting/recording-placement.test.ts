// lib/meeting/recording-placement.test.ts — 녹음 버튼 자리 가드
//
// 사용자 지적(2026-09-05): *"이미 작성 완료 된거에 녹음시작이 떡하니 있는게 이상하지 않나?"*
// 실측: 확정 7건 중 6건이 녹음 없는 회의인데, 그 전부가 맨 위에 「녹음 시작」을 띄우고 있었다.
//
// 이 가드가 막는 것은 **양방향**이다 —
//   ① 끝난 회의가 다시 녹음 화면처럼 보이는 것 (지금의 결함)
//   ② 회의 중에 녹음 버튼이 접혀 한 번 더 눌러야 하는 것 (반대로 고쳤을 때의 사고)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isRecordingPinned, isFinishedNote } from './recording-placement.ts'

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf-8')

/* ── 판정 ────────────────────────────────────────────── */

test('작성 중인 회의는 녹음이 맨 위다 — 회의는 기다려 주지 않는다', () => {
  assert.equal(isRecordingPinned('draft'), true)
})

test('★ 확정·보관된 회의는 녹음을 접기 안으로 내린다 — 지적받은 그 자리', () => {
  assert.equal(isRecordingPinned('final'), false)
  assert.equal(isRecordingPinned('archived'), false)
})

test('모르는 상태에서는 고정한다 — 판정 불가로 회의 중 녹음을 막지 않는다(회귀 0)', () => {
  assert.equal(isRecordingPinned(null), true)
  assert.equal(isRecordingPinned(undefined), true)
  assert.equal(isRecordingPinned(''), true)
  assert.equal(isRecordingPinned('알 수 없는 값'), true)
})

test('끝난 회의 판정은 상태 SSOT의 값만 쓴다 — 화면이 문자열을 새로 짓지 않게', () => {
  assert.equal(isFinishedNote('final'), true)
  assert.equal(isFinishedNote('archived'), true)
  assert.equal(isFinishedNote('draft'), false)
})

/* ── 배선 — 만들고 안 쓰면 없는 규칙이다 ─────────────── */

const WORKBENCH = 'components/meeting/MeetingWorkbench.tsx'

test('★ 작업대가 이 판정을 실제로 쓴다 — JSX 안에서 status 를 직접 비교하지 않는다', () => {
  const src = read(WORKBENCH)
  assert.ok(src.includes('isRecordingPinned'), '판정 SSOT 를 부르지 않으면 만든 의미가 없다')
  assert.ok(
    !/status\s*===\s*['"]final['"]/.test(src),
    '컴포넌트 안의 조건식은 실브라우저 말고 검증 수단이 없다(E-6)',
  )
})

// 처음 쓴 판은 `<RecordingPanel` 개수만 셌다. 그래서 조건을 `{false && (` 로 바꿔도 통과했다
// — 부품은 그대로 있고 렌더만 죽은 상태를 못 본 것이다(정책 §4 「일부러 깨서 확인」에서 잡힘).
// 세어야 할 것은 부품이 아니라 **그 부품이 어떤 조건 아래 있는가**다.
test('★ 녹음 패널이 두 자리에, 각각 반대 조건 아래 있다', () => {
  const src = read(WORKBENCH)
  const count = (src.match(/<RecordingPanel/g) ?? []).length
  assert.equal(count, 2, '고정 자리와 접기 안 자리, 둘 다 있어야 한다')

  assert.ok(
    /canEdit && recordingPinned &&/.test(src),
    '고정 자리가 recordingPinned 조건을 잃으면 끝난 회의에 다시 녹음 버튼이 뜬다',
  )
  assert.ok(
    /canEdit && !recordingPinned &&/.test(src),
    '접기 안이 조건을 잃으면 확정 회의에서 녹음을 아예 못 한다',
  )
})

test('★ 접기 안의 녹음은 재료 탭보다 위다 — 재료끼리의 순서는 「무엇으로 남기나」가 먼저다', () => {
  const src = read(WORKBENCH)
  const foldStart = src.indexOf('evidenceBody')
  const recInFold = src.indexOf('<RecordingPanel', foldStart)
  const tabs = src.indexOf('<SegmentedTabs', foldStart)
  assert.ok(foldStart > 0 && recInFold > 0 && tabs > 0, '접기 안 구조를 못 찾았다')
  assert.ok(recInFold < tabs, '녹음이 탭 아래로 가면 스크롤 끝에 묻힌다')
})

test('작업대가 노트 상태를 서버에서 받아 온다 — 없으면 판정할 재료가 없다', () => {
  const src = read(WORKBENCH)
  assert.ok(/status/.test(src), '상태를 안 읽으면 위 판정이 영원히 기본값이다')
  const api = read('app/api/meeting-notes/[id]/route.ts')
  assert.ok(/status:\s*data\.status/.test(api), 'API 가 상태를 안 주면 화면이 알 길이 없다')
})
