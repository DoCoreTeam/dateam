// 커밋 문맥에서 "어느 파일의 작업트리 내용을 믿을 수 있는가" — 가드 공용 판정 (SSOT)
//
// 왜: 이 저장소는 세션 N개가 **작업 트리 하나**를 공유한다(§다중 세션 정책). 가드는 디스크를
//   훑으므로, 내가 커밋할 때 **남이 진행 중인 파일까지 함께 판정**한다. 실제로 두 사고가 났다.
//
//   ① 남의 미커밋 위반이 **내 커밋을 막는다** — 내가 만들지도 않은 위반 때문에 멈춘다.
//   ② 더 나쁜 쪽: 남의 미커밋 파일이 위반을 **가려서** ratchet baseline이 자동 하향된다.
//      그 파일이 사라지면 아무도 만들지 않은 위반이 되살아나 **트리 전체가 막힌다**(시한폭탄).
//      (실측 2026-08-16 v0.7.493: 다른 세션의 untracked 컴포넌트가 `ci-*` 클래스를 쓰기 시작하자
//       globals.css의 `cssdomain::ci-*` 5곳이 baseline에서 0으로 내려갔다.)
//
// 그래서 커밋 문맥의 판정 대상은 **커밋된 상태 + 이번 커밋에 담기는 파일**이다.
//   (CLAUDE.md §커밋 범위 정책: "검증 판정은 내 변경 범위로 한다")
//
// pre-commit 훅 안에서는 `git commit -- <경로>`(M-1 pathspec 커밋)여도
// `git diff --cached`가 **이번 커밋의 파일만** 보여준다(임시 인덱스). 실측으로 확인함.

import { execFileSync } from 'node:child_process'

/** NUL 구분 git 출력 → 항목 배열. 실패하면 빈 배열(가드가 git 없이도 죽지 않게). */
export function gitZ(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\0')
      .filter(Boolean)
  } catch {
    return []
  }
}

/**
 * 순수 함수 — git 출력만 받아 판정한다(테스트 가능하게 I/O와 분리).
 *
 * @param staged `git diff --cached --name-only -z` 항목 — 이번 커밋에 담기는 파일
 * @param status `git status --porcelain -z` 항목 — `XY path`, 이름변경은 다음 항목이 원본 경로
 * @returns {{ skip: Set<string>, fromHead: Set<string> }}
 *   skip     = 남의 untracked. **커밋된 내용이 없으므로 판정 대상이 아니다**
 *   fromHead = 남의 수정. 작업트리 대신 **HEAD(커밋된) 내용**으로 판정한다
 */
export function parseCommitScope(staged, status) {
  const inCommit = new Set(staged)
  const skip = new Set()
  const fromHead = new Set()

  for (let i = 0; i < status.length; i++) {
    const entry = status[i]
    const code = entry.slice(0, 2)
    const path = entry.slice(3)
    // 이름변경/복사는 다음 항목이 **원본 경로**다. 같이 소비하지 않으면
    // 원본 경로를 상태코드로 잘못 읽어 엉뚱한 경로가 판정에서 빠진다.
    if (code[0] === 'R' || code[0] === 'C') i++
    if (!path || inCommit.has(path)) continue
    if (code === '??') skip.add(path)
    else fromHead.add(path)
  }
  return { skip, fromHead }
}

/** 이번 커밋에 담기는 파일. pathspec 커밋(M-1)이어도 임시 인덱스라 정확하다. */
export const STAGED_ARGS = ['diff', '--cached', '--name-only', '-z']

/**
 * 작업 트리의 더러운 파일.
 * ⚠️ `-uall` 필수 — 기본값은 untracked **디렉터리를 한 줄로 뭉쳐서** 보고한다(`.domangcha/`).
 *    그러면 그 안의 **파일 경로가 목록에 없어** 제외가 걸리지 않는다(실측으로 확인한 버그).
 * ⚠️ `-z` 필수 — 기본값은 비ASCII 경로를 따옴표로 감싸 이스케이프한다(한글 파일명이 안 맞는다).
 */
export const STATUS_ARGS = ['status', '--porcelain', '-z', '-uall']

/** 실제 git을 읽어 판정 범위를 만든다. */
export function commitScope() {
  return parseCommitScope(gitZ(STAGED_ARGS), gitZ(STATUS_ARGS))
}

/** HEAD에 담긴 파일 내용. 없으면 null(= 커밋된 것이 없다). */
export function readFromHead(path) {
  try {
    return execFileSync('git', ['show', `HEAD:${path}`], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch {
    return null
  }
}
