// lib/ui/design-guard-scope.test.ts — 가드의 "판정 범위"가 남의 작업을 섞지 않는지 본다
//
// 왜: 세션 N개가 작업 트리 하나를 공유하는데 `design:check`는 디스크를 훑는다. 그래서
//   ① 남의 미커밋 위반이 **내 커밋을 막고**,
//   ② 남의 미커밋 파일이 위반을 **가려서** ratchet baseline이 자동 하향됐다.
//   ②가 더 나쁘다 — 그 파일이 사라지면 **아무도 만들지 않은 위반**이 되살아나 트리 전체가 막힌다.
//   (실측 2026-08-16 v0.7.493: 다른 세션의 untracked 컴포넌트가 `ci-*` 클래스를 쓰기 시작하자
//    globals.css의 `cssdomain::ci-*` 5곳이 baseline에서 조용히 사라졌다.)
//
// 그래서 pre-commit은 `--commit-scope`로 **커밋된 상태 + 이번 커밋의 파일**만 본다.
//   (CLAUDE.md §커밋 범위 정책: "검증 판정은 내 변경 범위로 한다")
// 이 테스트는 그 범위 판정(순수 함수)을 고정한다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCommitScope, STAGED_ARGS, STATUS_ARGS } from '../../../../scripts/git-scope.mjs'

const MINE = 'apps/web/components/ui/Mine.tsx'
const THEIRS = 'apps/web/components/ci/Theirs.tsx'

test('남의 untracked 파일은 판정 대상이 아니다 (커밋된 내용이 없다)', () => {
  const { skip, fromHead } = parseCommitScope([MINE], [`?? ${THEIRS}`, `M  ${MINE}`])
  assert.deepEqual([...skip], [THEIRS])
  assert.deepEqual([...fromHead], [])
})

test('남의 수정 파일은 HEAD(커밋된) 내용으로 판정한다 — 통째로 빼면 baseline이 잘못 내려간다', () => {
  const { skip, fromHead } = parseCommitScope([MINE], [` M ${THEIRS}`, `M  ${MINE}`])
  assert.deepEqual([...fromHead], [THEIRS],
    '남의 수정 파일을 스캔에서 통째로 빼면, 그 파일의 커밋된 위반까지 사라져 baseline이 조여진다')
  assert.deepEqual([...skip], [])
})

test('이번 커밋에 담기는 파일은 제외하지 않는다 (내 위반은 정확히 막혀야 한다)', () => {
  // 스테이지 후 또 고친 상태(MM)도 이번 커밋 대상이다 — pathspec 커밋은 작업트리 내용을 담는다.
  const { skip, fromHead } = parseCommitScope([MINE], [`MM ${MINE}`, `?? ${THEIRS}`])
  assert.ok(!skip.has(MINE) && !fromHead.has(MINE), '내 파일이 판정에서 빠지면 가드가 무력해진다')
  assert.ok(skip.has(THEIRS))
})

test('남의 삭제 파일은 HEAD로 판정한다 (아직 커밋 안 된 삭제는 없던 일이다)', () => {
  const { fromHead } = parseCommitScope([], [` D ${THEIRS}`])
  assert.deepEqual([...fromHead], [THEIRS])
})

test('이름변경 항목은 원본 경로를 함께 소비한다 (안 하면 경로를 상태코드로 잘못 읽는다)', () => {
  const OLD = 'apps/web/components/ci/Old.tsx'
  // porcelain -z 의 이름변경: `R  <새경로>` 다음 항목이 `<원본경로>`(상태코드 없음).
  // 원본 경로를 소비하지 않으면 그 줄의 앞 3글자를 상태코드로 읽어 `s/web/…` 같은
  // **잘린 쓰레기 경로**가 판정 집합에 들어간다 → 집합을 통째로 비교해야 잡힌다.
  const { skip, fromHead } = parseCommitScope([], [`R  ${THEIRS}`, OLD, `?? ${MINE}`])
  assert.deepEqual([...fromHead], [THEIRS], '이름변경 새 경로 하나만 남아야 한다(잘린 경로가 섞이면 안 된다)')
  assert.deepEqual([...skip], [MINE], '원본 경로는 디스크에 없다 — 어느 집합에도 들어가면 안 된다')
})

test('아무것도 더럽지 않으면 아무것도 제외하지 않는다', () => {
  const { skip, fromHead } = parseCommitScope([MINE], [])
  assert.equal(skip.size, 0)
  assert.equal(fromHead.size, 0)
})

test('git 인자에 -uall / -z 가 살아 있다 (빠지면 제외가 조용히 새어 나간다)', () => {
  // -uall 없으면 untracked '디렉터리'를 한 줄로 뭉쳐 보고해 그 안의 파일 경로가 목록에 없다.
  // -z 없으면 한글 경로가 따옴표+이스케이프로 나와 파일 경로와 안 맞는다. 둘 다 실측으로 확인한 버그다.
  assert.ok(STATUS_ARGS.includes('-uall'), 'untracked 디렉터리 안의 파일이 제외되지 않는다')
  assert.ok(STATUS_ARGS.includes('-z'), '한글 경로가 이스케이프되어 매칭에 실패한다')
  assert.ok(STAGED_ARGS.includes('-z'), '한글 경로가 이스케이프되어 매칭에 실패한다')
})
