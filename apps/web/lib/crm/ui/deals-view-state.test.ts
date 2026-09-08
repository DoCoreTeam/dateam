// lib/crm/ui/deals-view-state.test.ts — 「딜을 누르면 전체가 먼저」 + 「뒤로가기가 되돌아간다」 가드
//
// 사용자 지적(2026-09-08): *"딜을 누르면 전체가 먼저 나와야 하는데 특정 파이프라인이 나오는게
// 이상해 그리고 뒤로가기 하면 이전 상태로 뒤로 가는거 유지하고"*
//
// 두 가지를 막는다:
//   ① 주소에 아무것도 없을 때 파이프라인 하나만 그리는 것 (딜이 사라진 것처럼 보인다)
//   ② 화면 이동을 replace 로 덮어써 뒤로가기가 화면 밖으로 나가 버리는 것

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolvePipelineParam, pipelineParamOf, ALL_PIPELINES } from './deals-view-state.ts'

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf-8')
const CLIENT = 'app/(crm)/crm/deals/DealsClient.tsx'

/* ── 판정 ────────────────────────────────────────────── */

test('★ 주소에 아무것도 없으면 전체다 — 「딜」을 눌렀는데 일부만 나오면 안 된다', () => {
  assert.equal(resolvePipelineParam(null), '', '사이드바로 막 들어온 상태')
  assert.equal(resolvePipelineParam(undefined), '')
  assert.equal(resolvePipelineParam(''), '', '빈 값도 «지정 안 함»이다')
})

test('all 은 전체 — 명시적으로 고른 것과 안 고른 것의 결과가 같다', () => {
  assert.equal(resolvePipelineParam(ALL_PIPELINES), '')
})

test('그 밖의 값은 그 파이프라인 — 공유한 링크가 같은 화면을 연다', () => {
  assert.equal(resolvePipelineParam('cmtciz30m000vz9z60yy1bmco'), 'cmtciz30m000vz9z60yy1bmco')
})

test('전체를 주소에 적을 때는 all 로 — 빈 문자열은 «지정 안 함»과 구분이 안 된다', () => {
  assert.equal(pipelineParamOf(''), 'all')
  assert.equal(pipelineParamOf('abc'), 'abc')
  // 왕복해도 뜻이 보존된다
  assert.equal(resolvePipelineParam(pipelineParamOf('')), '')
  assert.equal(resolvePipelineParam(pipelineParamOf('abc')), 'abc')
})

/* ── 배선 — 만들고 안 쓰면 없는 규칙이다 ─────────────── */

test('★ 화면이 이 판정을 쓴다 — 기본 파이프라인으로 되돌아가지 않는다', () => {
  const src = read(CLIENT)
  assert.match(src, /resolvePipelineParam\(searchParams\.get\('pipeline'\)\)/,
    '판정 SSOT 를 안 거치면 검증 수단이 실브라우저뿐이다(E-6)')
  assert.ok(
    !/defaultPipelineId/.test(src),
    '기본 파이프라인으로 좁히는 상태가 되살아났다 — 「딜」을 눌렀는데 일부만 나온다',
  )
})

test('★ 화면 이동이 이력에 남는다 — replace 면 뒤로가기가 화면 밖으로 나간다', () => {
  const src = read(CLIENT)
  assert.ok(
    !/router\.replace\(/.test(src),
    '파이프라인·보기 전환은 «이동»이다. replace 로 덮어쓰면 되돌아갈 자리가 사라진다',
  )
  // 두 자리 모두 — 파이프라인 고르기와 보기 전환
  assert.equal((src.match(/router\.push\(/g) ?? []).length, 2,
    '파이프라인 선택과 보기 전환 둘 다 이력에 남아야 한다')
})

test('스크롤은 되돌리지 않는다 — 보던 자리에서 눈만 바꾼 것이다', () => {
  const src = read(CLIENT)
  // 인자 안에 `sp.toString()` 이 있어 «괄호까지» 로 자르면 중간에서 끊긴다 —
  // 호출 뒤 한 줄 범위에서 옵션을 확인한다
  const spots = [...src.matchAll(/router\.push\(/g)]
  assert.equal(spots.length, 2)
  for (const m of spots) {
    const line = src.slice(m.index, src.indexOf('\n', m.index))
    assert.match(line, /scroll: false/, `${line.trim()} 가 맨 위로 튄다`)
  }
})
