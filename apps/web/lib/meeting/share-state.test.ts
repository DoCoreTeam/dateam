import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  readShareState, visibilityFor,
  CHOOSABLE_SHARE_STATES, SHARE_STATE_LABEL, SHARE_STATE_HINT,
} from './share-state.ts'
import { NOTE_VISIBILITY, NOTE_VISIBILITY_VALUES, toNoteVisibility } from './note-visibility.ts'
import { read, stripComments, walkFiles } from '../ui/component-scan.ts'

test('공개 상태는 나만 보기와 팀 공개 둘이다 (사용자 결정 2026-10-27)', () => {
  assert.deepEqual(CHOOSABLE_SHARE_STATES, ['PRIVATE', 'TEAM'], '좁은 것에서 넓은 것으로')
})

test('★ 코드의 공개 범위 값이 마이그 321 의 CHECK 와 같다', () => {
  const sql = readFileSync(join(process.cwd(), '../../supabase/migrations/321_meeting_note_team_visibility.sql'), 'utf8')
  const m = sql.match(/check \(visibility in \(([^)]*)\)\)/i)
  assert.ok(m, '321 에 visibility CHECK 가 있어야 한다')
  const dbValues = m[1].split(',').map((v) => v.trim().replace(/'/g, '')).sort()
  assert.deepEqual([...NOTE_VISIBILITY_VALUES].sort(), dbValues)
})

test('읽기: 팀 공개만 TEAM, 나머지는 더 닫힌 PRIVATE 로 읽는다', () => {
  assert.equal(readShareState(NOTE_VISIBILITY.TEAM), 'TEAM')
  assert.equal(readShareState(NOTE_VISIBILITY.PRIVATE), 'PRIVATE')
  assert.equal(readShareState(null), 'PRIVATE')
  assert.equal(readShareState('crm'), 'PRIVATE', '모르는 값으로 넓히지 않는다')
  assert.equal(toNoteVisibility(undefined), NOTE_VISIBILITY.PRIVATE)
})

test('읽기와 쓰기가 왕복한다', () => {
  for (const s of CHOOSABLE_SHARE_STATES) {
    assert.equal(readShareState(visibilityFor(s)), s)
  }
})

test('모든 상태에 이름과 「누가 보는지」가 있다', () => {
  for (const s of CHOOSABLE_SHARE_STATES) {
    assert.ok(SHARE_STATE_LABEL[s]?.length > 0, `${s} 에 이름이 있어야 한다`)
    assert.ok(SHARE_STATE_HINT[s]?.length > 0, `${s} 에 설명이 있어야 한다`)
  }
})

test('★ 팀 공개 설명은 조직도 기준(내 팀과 상위 팀장)을 말하고 영업 워크스페이스를 말하지 않는다', () => {
  const hint = SHARE_STATE_HINT.TEAM
  assert.match(hint, /내 팀/)
  assert.match(hint, /상위 팀장/)
  assert.doesNotMatch(hint, /영업|워크스페이스/)
})

test('★ 「기록만」 상태가 코드에 남아 있지 않다', () => {
  const hits: string[] = []
  for (const dir of ['lib', 'components', 'app']) {
    for (const f of walkFiles(dir)) {
      if (f.endsWith('share-state.test.ts')) continue
      if (/'RECORD_ONLY'|\bRECORD_ONLY\b/.test(stripComments(read(f)))) hits.push(f)
    }
  }
  assert.deepEqual(hits, [])
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
  assert.ok(src.includes('visibilityFor('), '무엇을 바꿀지는 SSOT 가 정한다')
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

test('★ 나가는 문은 관리자 조건 안에 있지 않다 — 일반 멤버가 갇히던 자리', () => {
  /**
   * **문이 옮겨졌다**(v0.7.610 · §2-3-3 N-2): 계정 메뉴 → **사이드바 하단 `ShellExit`**.
   * 예전엔 CI 사이드바(「사내 업무로」)와 계정 메뉴(「홈으로 나가기」) **두 자리**에 있었고
   * 문구가 셋이었다 — 셋 다 `/home` 으로 간다. 같은 곳으로 가는 문이 둘이면 다른 곳으로 읽힌다.
   *
   * **지키는 것은 그대로다**: 일반 멤버가 CRM·CI 에서 갇히면 안 된다.
   * 그래서 ①판정은 SSOT 가 하고 ②관리자 조건 안에 있지 않은지를 본다.
   */
  const src = stripComments(read('components/ui/shell/ShellExit.tsx'))
  assert.ok(src.includes('surfaceOf('), '판정은 SSOT 가 한다')
  assert.ok(!/isAdmin/.test(src), '나가는 문에 관리자 조건이 붙으면 일반 멤버가 다시 갇힌다')
  assert.ok(
    !/const inAdmin = pathname/.test(src),
    '/admin 한 줄 판정이 되돌아오면 CRM·CI 에서 다시 나갈 길이 사라진다',
  )
})
