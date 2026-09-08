// lib/ui/quote-layout.test.ts — 견적 화면이 «폭에 기대다 깨지는» 것을 막는 가드
//
// 사용자 지적(2026-09-08):
//   · 「견적 수정화면에 폼이 다 틀어졌는데 레이어 레벨도 다 안맞고 폼 레벨도 안 맞고」
//   · 「여기 화면도 깨지네 1번에 금액 봐봐 이거 좀 능동적으로 되야 하는거 아닌가?」
//
// 실측 원인은 셋이었고 전부 **폭·정렬을 손으로 맞춰 온 자리**다:
//   ① 첫 행이 `align-items: flex-end` 라, 「종류」에만 붙은 도움말 때문에
//      품목·규격이 통째로 36px 아래로 밀렸다
//   ② `colTotal` 에 `min-width: 0` 이 없어 내용이 **왼쪽으로 112px 흘러** 부가세 칸을 덮었다
//   ③ 견적서 표는 `nowrap` + 열 폭 늘리기로 막아 왔는데(13%→16%, 21%→25%),
//      금액이 길어지자 또 잘렸다
//
// 폭을 늘려 막는 방식은 내용이 길어질 때마다 다시 깨진다. 그래서 **접히게** 바꿨고,
// 이 가드는 그 결정이 되돌려지는 것을 막는다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf-8')

/**
 * **주석을 벗기고 검사한다.**
 *
 * 처음 판은 원문 그대로 봤다가, `min-width: 0` 선언을 지워도 통과했다 —
 * 바로 위 주석에 「`min-width: 0` 이 없으면…」이라고 적어 둔 그 글자를 세고 있었다.
 * 이 저장소는 «왜 그랬는지»를 주석에 길게 남기므로, 규칙 이름이 주석에 나오는 일이 흔하다.
 * 벗기지 않으면 **설명이 잘 달린 파일일수록 가드가 헐거워진다.**
 */
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

const PANEL = strip(read('components/ui/crm/quote-panel.module.css'))
const DOC = strip(read('app/(crm)/crm/quotes/[id]/quote-document.module.css'))
const SHEET = read('app/(crm)/crm/quotes/[id]/QuoteSheet.tsx')
const MODAL = read('components/ui/crm/QuoteEditorModal.tsx')

/* ── ① 라벨 기준선 ────────────────────────────────── */

test('★ 항목 첫 행은 위를 맞춘다 — 「종류」의 도움말이 옆 칸을 밀어내지 않게', () => {
  assert.match(
    PANEL,
    /\.colSection, \.colKind, \.colRole, \.colName, \.colSpec \{ align-self: start; \}/,
    '첫 행이 바닥 정렬로 돌아가면 라벨 기준선이 36px 어긋난다(실측)',
  )
})

/* ── ② 금액 칸이 옆 칸을 덮지 않는다 ─────────────── */

test('★ 금액 칸에 min-width: 0 이 있다 — 없으면 내용이 밖으로 흘러 부가세 칸을 덮는다', () => {
  const m = PANEL.match(/\.colTotal \{[^}]*\}/)
  assert.ok(m, '.colTotal 규칙이 사라졌다')
  assert.match(m[0], /min-width: 0/, 'grid 아이템의 기본 최소 폭은 «내용 폭»이라 넘치면 밖으로 나간다')
})

test('★ 금액 셋이 한 덩어리다 — 형제로 흩어지면 칸 밖으로 나란히 늘어선다', () => {
  assert.match(MODAL, /styles\.lineMoney/, '금액 묶음이 사라졌다')
  assert.match(MODAL, /styles\.lineFrom/, '원가와 화살표 묶음이 사라졌다')
  const m = PANEL.match(/\.lineMoney \{[^}]*\}/)
  assert.ok(m && /flex-wrap: wrap/.test(m[0]), '접히지 않으면 칸을 넘어간다')
})

test('한 금액은 통째로 — 「266,000,000 / 원」으로 끊기면 파편으로 읽힌다', () => {
  assert.match(PANEL, /\.lineMoney > \* \{ white-space: nowrap; \}/)
})

/* ── ③ 견적서 문서: 폭에 기대지 않는다 ───────────── */

test('★ 견적서 금액이 접힌다 — 폭을 늘려 막는 방식은 내용이 길어지면 또 깨진다', () => {
  const m = DOC.match(/\.priceFlow \{[^}]*\}/)
  assert.ok(m, '.priceFlow 가 사라졌다')
  assert.match(m[0], /flex-wrap: wrap/, 'nowrap 으로 되돌리면 긴 금액이 잘린다(실측)')
  assert.match(m[0], /min-width: 0/, '칸보다 넓어지려 할 때 줄어들 수 있어야 한다')
})

test('★ 원가와 화살표는 떨어지지 않는다 — 화살표만 다음 줄로 가면 아무것도 안 가리킨다', () => {
  assert.match(DOC, /\.priceFrom \{/, '원가+화살표 묶음이 사라졌다')
  assert.match(SHEET, /styles\.priceFrom/, '견적서가 그 묶음을 안 쓴다')
  const m = DOC.match(/\.priceFrom \{[^}]*\}/)
  assert.ok(m && /white-space: nowrap/.test(m[0]), '묶음 안에서 접히면 묶은 의미가 없다')
})

/* ── ④ 순서 조정이 12칼럼을 깨지 않는다 ──────────── */

test('★ 순서 칸은 첫 행에만 — 두 행을 가로지르면 금액이 다음 줄로 밀린다', () => {
  const m = PANEL.match(/\.colOrder \{ grid-column[^}]*\}/)
  assert.ok(m, '.colOrder 규칙이 사라졌다')
  assert.ok(!/grid-row/.test(m[0]), '두 행을 차지하면 둘째 행이 10칸이 되어 합이 넘친다(실측)')
})

test('★ 두 행 모두 정확히 12칸이다 — 하나라도 어긋나면 그 칸이 다음 줄로 떨어진다', () => {
  const span = (cls: string) => {
    const m = PANEL.match(new RegExp(`\\.${cls}\\s*\\{[^}]*grid-column: span (\\d+)`))
    assert.ok(m, `${cls} 의 span 을 못 찾았다`)
    return Number(m[1])
  }
  const first = span('colOrder') + span('colKind') + span('colName') + span('colSpec')
  const second = span('colQty') + span('colUnit') + span('colPrice')
    + span('colDisc') + span('colSpecial') + span('colTax') + span('colTotal')
  assert.equal(first, 12, `첫 행이 ${first}칸이다`)
  assert.equal(second, 12, `둘째 행이 ${second}칸이다`)
})

/* ── ⑤ 순서 조정이 공용 부품을 쓴다 ──────────────── */

test('★ 항목 순서는 공용 부품으로 — 같은 성격을 두 번 만들지 않는다(§0)', () => {
  assert.match(MODAL, /<ReorderList/, '견적 항목 순서 조정이 사라졌다')
  assert.ok(
    !/aria-label="위로"|aria-label="아래로"/.test(MODAL),
    '자작 화살표를 되살리면 크기·경계 처리가 또 갈린다',
  )
})
