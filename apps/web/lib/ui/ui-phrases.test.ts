// lib/ui/ui-phrases.test.ts — 상태 문구 판정(SSOT)이 실제로 맞는지 본다
//
// 왜: `scripts/ui-phrases.mjs`는 디자인 가드와 화면 스캐너가 **공유하는 판정 기준**인데,
//   이 기준 자체를 검증하는 테스트가 **0개**였다. 그래서 `EMPTY`의 제외 목록이
//   `(?<!되돌릴 )없습니다`로 적혀 **한 번도 동작하지 않는 상태**로 오래 살아 있었다 —
//   한국어 능력부정은 '되돌릴 **수** 없습니다'라 `없습니다` 바로 앞은 언제나 `수 `다.
//   그 결과 경고문을 쓴 화면이 전부 '빈 상태 문구 자작'으로 잡혔고,
//   가드가 트리 전체를 스캔하는 탓에 **다른 세션의 커밋까지 막았다**(v0.7.493 실측).
//
// 지표(스캐너·가드)가 틀리면 진척을 잴 수 없고, 있지도 않은 위반을 쫓게 된다.
//   그래서 부품을 재는 자를 먼저 잰다. 판정을 바꾸려면 여기 사례부터 고친다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY, ERROR, LOADING, isSelfMadeStateText, stripComments } from '../../../../scripts/ui-phrases.mjs'

/** 화면에 직접 찍은 자작 문구 = 위반 / 공용 부품 props·문자열 인자 = 정상 */
const EMPTY_CASES: readonly [line: string, selfMade: boolean, why: string][] = [
  // ── 잡아야 하는 것 (JSX 텍스트 노드로 직접 찍은 빈 상태)
  ['        <div>등록된 거래처가 없습니다</div>', true, '자작 빈 상태'],
  ['        <p>데이터가 없어요</p>', true, '자작 빈 상태(없어요)'],
  ['          목록이 비어 있습니다', true, '태그 없는 줄의 텍스트 노드'],
  ['        <span>찾을 수 없습니다</span>', true, 'not found는 빈 상태가 맞다(제외 목록에 없다)'],

  // ── 잡으면 안 되는 것 ① 능력부정 경고문 — 빈 상태가 아니다
  ['          되돌릴 수 없습니다', false, '삭제 경고문'],
  ['        <p>삭제할 수 없습니다</p>', false, '능력부정 경고문'],
  ['          복구할 수 없어요', false, '능력부정 + 없어요'],
  ['          변경할 수 없습니다', false, '능력부정 경고문'],

  // ── 잡으면 안 되는 것 ② 공용 부품을 제대로 쓴 코드
  ['      <EmptyState title="등록된 거래처가 없습니다" />', false, '공용 부품 props'],
  ["      setError('불러온 항목이 없습니다')", false, '문자열 인자'],
  ['      const label = isEmpty ? "없어요" : name', false, '문자열 리터럴'],
]

test('EMPTY: 자작 빈 상태만 잡고, 능력부정 경고문과 공용 부품 사용은 통과시킨다', () => {
  const wrong = EMPTY_CASES
    .filter(([line, want]) => isSelfMadeStateText(line, EMPTY) !== want)
    .map(([line, want, why]) => `${want ? '놓침' : '오탐'}: ${line.trim()}  (${why})`)

  assert.deepEqual(wrong, [],
    '상태 문구 판정이 틀렸다. scripts/ui-phrases.mjs의 EMPTY를 고칠 것:\n  ' + wrong.join('\n  '))
})

test('EMPTY: 능력부정 제외가 없습니다·없어요 양쪽에 걸린다 (한쪽만 걸리면 어형 따라 결과가 갈린다)', () => {
  const verbs = ['되돌릴', '취소할', '삭제할', '변경할', '사용할', '수정할', '복구할', '입력할', '선택할']
  const leaked = verbs.flatMap((v) =>
    ['없습니다', '없어요']
      .filter((tail) => isSelfMadeStateText(`          ${v} 수 ${tail}`, EMPTY))
      .map((tail) => `${v} 수 ${tail}`))

  assert.deepEqual(leaked, [], `능력부정 경고문이 빈 상태로 잡힌다:\n  ${leaked.join('\n  ')}`)
})

test('LOADING / ERROR: 자작 문구는 잡고 공용 부품 props는 통과시킨다', () => {
  assert.equal(isSelfMadeStateText('        <div>불러오는 중…</div>', LOADING), true, '자작 로딩 문구를 놓쳤다')
  assert.equal(isSelfMadeStateText('        <div>로딩 중</div>', LOADING), true, '자작 로딩 문구를 놓쳤다')
  assert.equal(isSelfMadeStateText('      <SkelList label="불러오는 중" />', LOADING), false, '공용 부품 props를 오탐했다')

  assert.equal(isSelfMadeStateText('        <p>저장에 실패했습니다</p>', ERROR), true, '자작 오류 문구를 놓쳤다')
  assert.equal(isSelfMadeStateText("      toast('저장에 실패했습니다')", ERROR), false, '문자열 인자를 오탐했다')
})

test('stripComments: 주석 속 예시 문구를 위반으로 세지 않는다', () => {
  const src = [
    '// <div>없습니다</div> 처럼 쓰지 말 것',
    '/* 예시: <p>없어요</p> */',
    '<div>정말로 없습니다</div>',
  ].join('\n')

  const kept = stripComments(src).split('\n').filter((l: string) => isSelfMadeStateText(l, EMPTY))
  assert.equal(kept.length, 1, `주석까지 세고 있다:\n  ${kept.join('\n  ')}`)
  assert.match(kept[0], /정말로/, '주석이 아니라 실제 코드 줄이 남아야 한다')
})
