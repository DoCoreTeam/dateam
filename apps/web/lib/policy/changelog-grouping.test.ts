// lib/policy/changelog-grouping.test.ts — 한 판 번호에 커밋이 여럿이어도 하나도 안 떨어진다
//
// 왜 이 가드가 있나: 「플랜 하나가 판 하나」 셈법(LOOP.md 부록 「버전 규칙」)은 한 판 번호에
//   항목 커밋 여럿과 완료 커밋 하나가 같이 달리는 것을 전제로 한다. 그 전제가 깨지면
//   플랜의 일 가운데 일부가 업데이트 내역에 영영 안 실리고, 실패가 아니라 **아무 신호도 안 난다** —
//   화면에서는 정상과 구분되지 않는다. v0.8.0 을 17번 복사해 17판이 조용히 멎은 사고가 그 모양이었다.
//
//   그 사고의 진범은 번호를 같이 쓴 것이 아니라 **package.json 이 한 번도 안 움직인 것**이었다.
//   같은 번호 자체는 발행기가 제대로 다룬다 — 실측 2026-10-09: 같은 판 번호 커밋 3개를 먹여
//   묶음 1개와 메시지 3개가 나왔다. 이 시험이 그 사실을 이력으로 고정한다.
//
// 검사 4개
//   1) 같은 판 번호 커밋 셋이 묶음 하나와 메시지 셋이 된다
//   2) 서로 다른 판 번호는 따로 묶이고 최신이 위에 온다
//   3) 이미 게시된 판(lastVersion 이하)과 아직 안 올린 판(currentVersion 초과)은 빠진다
//   4) 같은 문장이 두 번 와도 한 번만 남는다 (버전 파일만 다른 중복 커밋)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collectMissingCommits, LOG_SEP } from '../../scripts/changelog-gen.mjs'

/** git log --pretty=format:%ad<SEP>%s 가 주는 모양 그대로 만든다 */
const log = (...rows: [string, string][]) =>
  rows.map(([date, subject]) => `${date}${LOG_SEP}${subject}`).join('\n')

test('같은 판 번호 커밋 셋이 묶음 하나와 메시지 셋이 된다', () => {
  const groups = collectMissingCommits('0.11.6', '0.11.7', log(
    ['2026-10-09', 'v0.11.7: 플랜 제목'],
    ['2026-10-09', 'v0.11.7: 둘째 항목이 한 일'],
    ['2026-10-08', 'v0.11.7: 첫째 항목이 한 일'],
  ))

  assert.equal(groups.length, 1, `묶음이 하나여야 한다: ${JSON.stringify(groups)}`)
  assert.equal(groups[0].version, '0.11.7')
  assert.deepEqual(
    [...groups[0].messages].sort(),
    ['둘째 항목이 한 일', '첫째 항목이 한 일', '플랜 제목'].sort(),
    '같은 판의 커밋 메시지가 하나라도 떨어졌다 — 그 항목의 일은 사용자에게 안 보인다',
  )
  assert.equal(groups[0].date, '2026-10-09', 'git log 는 최신이 먼저라 첫 등장 날짜가 대표일이다')
})

test('서로 다른 판 번호는 따로 묶이고 최신이 위에 온다', () => {
  const groups = collectMissingCommits('0.11.5', '0.11.8', log(
    ['2026-10-09', 'v0.11.8: 다음 플랜'],
    ['2026-10-09', 'v0.11.7: 이번 플랜 둘째'],
    ['2026-10-08', 'v0.11.7: 이번 플랜 첫째'],
    ['2026-10-07', 'v0.11.6: 지난 플랜'],
  ))

  assert.deepEqual(groups.map((g) => g.version), ['0.11.8', '0.11.7', '0.11.6'])
  assert.deepEqual(groups.map((g) => g.messages.length), [1, 2, 1])
})

test('이미 게시된 판과 아직 안 올린 판은 빠진다', () => {
  const groups = collectMissingCommits('0.11.6', '0.11.7', log(
    ['2026-10-09', 'v0.11.9: 아직 package.json 이 안 올라간 판'],
    ['2026-10-09', 'v0.11.7: 이번 판'],
    ['2026-10-08', 'v0.11.6: 이미 게시된 판'],
    ['2026-10-07', 'v0.11.5: 더 지난 판'],
  ))

  assert.deepEqual(groups.map((g) => g.version), ['0.11.7'],
    '게시 구간 밖의 판이 섞였다 — 발행기가 같은 글을 두 번 올리거나 미래를 올린다')
})

test('같은 문장이 두 번 와도 한 번만 남는다', () => {
  const groups = collectMissingCommits('0.11.6', '0.11.7', log(
    ['2026-10-09', 'v0.11.7: 같은 제목'],
    ['2026-10-09', 'v0.11.7: 같은 제목'],
    ['2026-10-09', 'v0.11.7: [skip changelog] 같은 제목'],
  ))

  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0].messages, ['같은 제목'],
    '같은 문장이 여러 줄로 남으면 발행기 프롬프트가 같은 말을 반복한다')
})
