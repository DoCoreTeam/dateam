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
/*
  채우기(말로·파일로)는 **옆 파일**에 있다(v0.10.x). 단추와 열리는 상자가 같은 상태를 보므로
  둘을 나누면 「어느 것이 열려 있나」를 두 곳이 알아야 하고, 그때부터 갈린다.
*/
const FILL = read('components/ui/crm/QuoteFillPanel.tsx')
const TOTALS = read('components/ui/crm/QuoteTotals.tsx')
/** 딜 화면의 「파일로 가져오기」 — 건마다 도착지를 고르는 창 */
const IMPORT = read('components/ui/crm/QuoteFromFileModal.tsx')
const DEAL_PANEL = read('components/ui/crm/QuotePanel.tsx')
const SHAPE = read('components/ui/crm/quote-draft-shape.ts')

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

/* ── ⑤ 항목 줄 머리의 단추 배치 ──────────────────── */

/*
  사용자 지적(2026-09-19): 「견적서 화면자체에 말로채우기 묶음추가 항목추가 버튼의 배치가 왜이렇지?」

  원인은 `.linesHead` 의 `justify-content: space-between` 하나였다. 자식이
  「항목」 + 단추 셋이라 980px 을 넷으로 갈라 **단추 사이에 200px 짜리 빈 자리**가 생겼고,
  셋이 전부 같은 ghost 라 성격이 다른 일(채우기 / 추가)이 같은 일로 읽혔다.
*/

test('★ 머리가 자식을 균등 분배하지 않는다 — 그것이 단추가 흩어진 원인이었다', () => {
  const m = PANEL.match(/\.linesHead \{[^}]*\}/)
  assert.ok(m, '.linesHead 규칙이 사라졌다')
  assert.ok(
    !/justify-content:\s*space-between/.test(m[0]),
    'space-between 으로 되돌리면 단추 사이가 다시 벌어진다(실측 980px / 4)',
  )
})

test('★ 단추는 오른쪽 한 덩어리다 — 좁아지면 접힌다', () => {
  const m = PANEL.match(/\.lineActions \{[^}]*\}/)
  assert.ok(m, '.lineActions 규칙이 사라졌다')
  assert.match(m[0], /margin-left: auto/, '제목과 단추가 붙으면 제목이 단추에 밀린다')
  assert.match(m[0], /flex-wrap: wrap/, '안 접히면 「항목 추가」가 화면 밖으로 나간다')
  assert.match(MODAL, /styles\.lineActions/, '화면이 그 묶음을 안 쓴다')
})

test('★ 채우기와 추가를 구분선이 가른다 — 넷이 한 무리로 보이면 성격이 안 읽힌다', () => {
  assert.match(PANEL, /\.actionSep \{/, '.actionSep 규칙이 사라졌다')
  assert.match(MODAL, /styles\.actionSep/, '화면이 구분선을 안 쓴다')
})

test('★ 테두리는 「항목 추가」 하나뿐 — 전부 강조하면 아무것도 강조되지 않는다', () => {
  const secondary = MODAL.match(/variant="secondary"/g) ?? []
  assert.equal(secondary.length, 1, `모달에 secondary 가 ${secondary.length}개다`)
  // 그 하나가 「항목 추가」인지 — 단추 블록 안에 QUOTE.addLine 이 함께 있어야 한다
  const block = MODAL.match(/variant="secondary"[\s\S]{0,400}?<\/NbButton>/)
  assert.ok(block && /QUOTE\.addLine/.test(block[0]), 'secondary 가 「항목 추가」가 아니다')
})

test('★ 단추 이름은 용어집에서 온다 — 화면이 한글을 직접 적지 않는다', () => {
  assert.match(FILL, /QUOTE\.fillBySpeech/)
  assert.match(FILL, /QUOTE\.fillByFile/)
  assert.match(MODAL, /QUOTE\.addSection/)
  assert.ok(
    !/> ?말로 채우기|> ?묶음 추가|> ?파일로 채우기/.test(MODAL + FILL),
    '리터럴로 되돌리면 같은 말이 화면마다 갈린다',
  )
})

test('★ 채우기 단추 둘이 한 자리에 선다 — 말과 파일은 같은 성격이다', () => {
  assert.match(MODAL, /<QuoteFillButtons/, '모달이 채우기 단추를 안 그린다')
  assert.match(FILL, /export function QuoteFillButtons/)
  // 단추와 상자가 같은 파일이라야 «어느 것이 열려 있나»를 한 곳이 안다
  assert.match(FILL, /export default function QuoteFillPanel/)
})

/* ── ⑥ 한 파일이 한 가지 일을 한다 ───────────────── */

/*
  파일로 채우기·검수가 붙으면서 모달이 1,157줄이 됐다. 그 안에서 «폼 그리기»와
  «폼 채우기»와 «합계 계산 보이기»가 섞여 있었고, 절사를 고치러 온 사람이
  항목 스무 줄을 지나쳐 내려가야 했다. 그래서 셋으로 나눴다.
*/

test('★ 편집 모달이 800줄을 넘지 않는다 — 한 파일이 세 가지 일을 하면 고칠 자리를 못 찾는다', () => {
  const n = MODAL.split('\n').length
  assert.ok(n <= 800, `${n}줄이다. 새 기능은 옆 파일로 뺀다`)
})

test('모양은 화면이 아니다 — 서버도 부를 수 있게 순수 모듈로 둔다', () => {
  const shape = read('components/ui/crm/quote-draft-shape.ts')
  assert.ok(!/'use client'/.test(shape), '모양 파일에 화면이 들어왔다')
  assert.match(MODAL, /from '\.\/quote-draft-shape'/)
})

test('합계는 받은 값을 그릴 뿐 — 계산을 두 곳에서 하지 않는다', () => {
  assert.ok(!/computeTotals\(/.test(TOTALS), '합계 부품이 스스로 계산한다')
  assert.match(MODAL, /<QuoteTotals/)
})

/* ── ⑦ 순서 조정이 공용 부품을 쓴다 ──────────────── */

test('★ 항목 순서는 공용 부품으로 — 같은 성격을 두 번 만들지 않는다(§0)', () => {
  assert.match(MODAL, /<ReorderList/, '견적 항목 순서 조정이 사라졌다')
  assert.ok(
    !/aria-label="위로"|aria-label="아래로"/.test(MODAL),
    '자작 화살표를 되살리면 크기·경계 처리가 또 갈린다',
  )
})

/* ── ⑧ 파일에서 가져오기 — 두 화면이 같은 모양을 쓴다 ─── */

/*
  줄을 **서버가 받는 모양**으로 바꾸는 매핑이 두 벌이면, 칸이 하나 늘 때 한쪽에만 붙는다.
  그러면 그 화면에서 넣은 값은 저장하는 순간 조용히 사라진다 —
  `quoteToDraft` 가 이 파일로 올라온 것과 같은 사고다.
*/
test('★ 줄을 서버 모양으로 바꾸는 곳이 하나다', () => {
  assert.match(SHAPE, /export function toLinePayload/, '매핑이 모양 파일에 없다')
  for (const [name, src] of [['편집 모달', MODAL], ['가져오기 창', IMPORT]] as const) {
    assert.match(src, /toLinePayload/, `${name} 이 공용 매핑을 안 쓴다`)
    /*
      «또 적었나»는 **payload 에만 있는 줄**로 본다. 합계 미리보기도 비슷한 모양을 만드는데
      그것은 서버로 안 가는 계산 입력이라 여기서 세면 안 된다 — 처음 판이 그것을 세어
      틀린 곳을 가리켰다.
    */
    assert.ok(!/sectionIndex: typeof l\.sectionIndex === 'number'/.test(src),
      `${name} 이 매핑을 또 적었다`)
  }
})

/*
  **기본 도착지는 늘 「새 견적으로」다.** 읽은 것이 원가인지 우리 견적인지는 우리가 모른다.
  모르는 채로 원가를 기본값으로 두면, 아닌 경우에 사람은 되돌리는 일부터 해야 한다 —
  새 견적은 초안이라 지우기도 고치기도 쉽다. 되돌리기 싼 쪽이 기본값이다.
*/
test('★ 도착지 기본값은 새 견적, 건 카드는 접힌 채로 시작', () => {
  assert.match(IMPORT, /key: 'new' as ImportDestKey/, '기본 도착지가 새 견적이 아니다')
  assert.match(IMPORT, /setOpenIndex\(null\)/, '건 카드가 펴진 채로 시작한다')
  // 도착지는 뜻이 다른 셋이라 라디오다 — 체크박스면 둘을 동시에 고를 수 있다
  assert.match(IMPORT, /type="radio"/, '도착지가 라디오가 아니다')
})

/*
  **있던 항목을 지우지 않는다.** 새 줄만 보내면 서버의 syncLines 가
  「이번에 안 온 항목」을 지운 것으로 보고 있던 항목이 통째로 사라진다.
*/
test('★ 있는 견적에 붙일 때 앞 항목을 먼저 싣는다', () => {
  const append = IMPORT.slice(IMPORT.indexOf('const appendOne'), IMPORT.indexOf('const submit'))
  assert.match(append, /\[\.\.\.kept, \.\.\.lines\]/, '앞 항목을 안 싣는다 — 붙이면 있던 것이 사라진다')
  assert.match(append, /version: draft\.version/, '판 번호를 안 보낸다 — 남의 수정을 덮는다')
})

test('★ 딜 화면에 파일로 가져오기 길이 있다 — 빈 상태에서도', () => {
  assert.match(DEAL_PANEL, /<QuoteFromFileModal/, '딜 화면이 가져오기 창을 안 연다')
  const empty = DEAL_PANEL.slice(DEAL_PANEL.indexOf('아직 견적이 없어요'))
  assert.match(empty.slice(0, 900), /setImporting\(true\)/,
    '빈 상태에 가져오기 길이 없다 — 견적이 없는 딜에서 가장 필요한 길이다')
})

/* ── ⑨ 원가로 보내는 길 — 고른 사람에게만 열린다 ─── */

/*
  원가 칸(갈래·시점·마진)은 원가로 보낼 때만 뜻이 있다. 늘 세워 두면 새 견적 하나
  만들려던 사람이 안 쓰는 칸 셋을 지나쳐야 하고, 지나치는 칸에는 결국 아무 값이나 남는다.
*/
test('★ 원가 도착지는 넣을 수 있는 사람에게만 선다', () => {
  assert.match(IMPORT, /k !== 'cost' \|\| canCost/, '원가 길이 늘 서 있다')
  assert.ok(!/IMPORT_DEST\.cost/.test(IMPORT),
    '원가 라벨을 조건 밖에서 직접 그리면 못 넣는 사람에게도 보인다')
})

test('★ 갈래·시점 칸은 원가를 고른 건에만 나타난다', () => {
  assert.match(IMPORT, /d\?\.key === 'cost' && \(/, '원가 칸이 조건 없이 그려진다')
  const cost = IMPORT.slice(IMPORT.indexOf("d?.key === 'cost' && ("))
  assert.match(cost.slice(0, 2400), /COST\.category/, '갈래 칸 이름이 용어집에서 안 온다')
  assert.match(cost.slice(0, 2400), /COST\.stage/, '시점 칸 이름이 용어집에서 안 온다')
})

test('★ 시점 기본값은 추정 — 화면이 숫자 대신 값을 박으면 두 곳이 갈린다', () => {
  assert.match(IMPORT, /stage: INTAKE_DEFAULT_STAGE/, '기본 시점을 화면이 따로 정한다')
  assert.match(IMPORT, /category: INTAKE_DEFAULT_CATEGORY/, '기본 갈래를 화면이 따로 정한다')
})

/*
  **원본은 기본으로 남는다**(사용자 지시 2026-09-20, 앞 판에서 뒤집힌 규칙이다).
  읽은 값이 맞는지는 나중에 원본과 대조해야 알 수 있는데, 그때 파일이 없으면
  대조할 방법이 아예 없다 — 끄는 것은 한 번 누르면 되지만 안 남긴 파일은 다시 만들 수 없다.
  도착지도 안 가린다: 「이 숫자 어디서 왔지」는 원가에서만 생기는 질문이 아니다.
*/
test('★ 「원본 파일도 함께 남기기」는 기본 켜짐이고 견적이 생기면 그 견적에 붙는다', () => {
  assert.match(IMPORT, /const \[keepFile, setKeepFile\] = useState\(true\)/, '원본 남기기가 기본 꺼짐이다')
  // 원가로만 간 경우에도 남는다 — 예전 조건(costed > 0)이면 견적만 만든 경우가 빠진다
  assert.match(
    IMPORT, /if \(keepFile && picked && \(quoteIds\.length > 0 \|\| costed > 0\)\)/,
    '견적만 만든 경우에 원본이 안 남는다',
  )
  const attach = IMPORT.slice(IMPORT.indexOf('const attachSource'), IMPORT.indexOf('const submit'))
  assert.match(attach, /'SUPPLY_QUOTE'/, '종류를 안 주면 대외비 등급이 안 붙는다')
  // 붙는 자리가 딜로 박혀 있으면 견적 열 개가 달린 딜에서 어느 파일이 이 견적의 것인지 모른다
  assert.match(attach, /form\.append\('target', target\)/, '첨부 대상이 딜로 박혀 있다')
  assert.match(
    IMPORT, /quoteIds\.map\(\(id\) => \['QUOTE', id\]/,
    '견적이 생겼는데 그 견적에 안 붙는다',
  )
})

test('★ 판매 견적 함께 만들기도 기본 꺼짐 — 켜면 견적번호가 하나 나간다', () => {
  assert.match(IMPORT, /alsoQuote: false/, '기본으로 견적이 함께 만들어진다')
  assert.match(IMPORT, /withQuoteLineIds/, '원가 줄과 판매 줄을 잇지 않는다')
})

test('★ 가져오기 창의 머리말이 건수를 말한다 — 화면이 조수사를 직접 고르지 않는다', () => {
  assert.match(IMPORT, /fillFoundQuotesLine\(/, '건수를 말하는 문장을 안 쓴다')
  assert.ok(!/fillFoundLine\(/.test(IMPORT),
    '항목 수만 말하는 옛 문장으로 되돌아갔다 — 두 건짜리 파일이 한 건으로 읽힌다')
  /*
    편집 모달의 「파일로 채우기」는 **한 건만 쓰는 자리**라 그대로 둔다.
    거기까지 건수를 붙이면 늘 「견적 1건」이 붙어 군말이 된다.
  */
  assert.ok(!/fillFoundQuotesLine\(/.test(FILL),
    '한 건만 쓰는 자리에 건수 문장을 붙였다 — 늘 「견적 1건」이 붙어 군말이 된다')
})


/* ── 비고 열 (v0.10.34x) ─────────────────────────── */

/*
  **왜**: 열 폭은 비율이고 합은 늘 100 이어야 한다. 모자라거나 남으면 브라우저가
  남는 폭을 제 마음대로 나눠 화면과 종이의 배치가 달라진다. 비고 열이 서면서
  경우가 둘에서 넷으로 늘었으므로, 넷 다 세어 본다.
*/

/*
  **셈은 옆으로 옮겼다**(`lib/ui/quote-columns.ts`). 경우가 여덟으로 늘면서(할인 × 비고 ×
  긴 비고) 가드가 같은 식을 베껴 들고 있으면 둘이 갈린다 — 베낀 쪽이 틀려도 통과한다.
  합이 100 인지는 `quote-columns.test.ts` 가 여덟 경우를 다 세고, 여기서는
  **화면이 그 셈을 실제로 부르는지**만 본다.
*/

test('\u2605 화면 부품이 폭을 제 손으로 안 정한다 — 셈은 한 곳에서만 난다', () => {
  const src = read('app/(crm)/crm/quotes/[id]/QuoteSheet.tsx')
  assert.match(src, /quoteColumnWidths\(\{ showDiscount, showRemark, longRemark \}\)/,
    '화면이 폭 셈을 안 부른다')
  assert.match(src, /const longRemark = showRemark && hasLongRemark\(doc\.lines\)/,
    '긴 비고를 안 센다 — 영문 한 문장이 10% 칸에서 낱말 가운데서 끊긴다')
  /*
    **colgroup 안에 고정 퍼센트가 남아 있으면** 셈을 옮긴 뜻이 없다. 한 칸만 손으로
    적혀 있어도 합이 100 에서 어긋나고, 그 어긋남은 가드가 아니라 종이에서 드러난다.
  */
  const colgroup = src.slice(src.indexOf('<colgroup>'), src.indexOf('</colgroup>'))
  assert.ok(!/width: '\d+%'/.test(colgroup),
    `colgroup 에 손으로 적은 폭이 남아 있다\n${colgroup.match(/width: '\d+%'/g)?.join(' ')}`)
  for (const k of ['no', 'name', 'unit', 'quantity', 'unitPrice', 'discount', 'amount', 'remark']) {
    assert.ok(colgroup.includes(`pct(colWidths.${k})`), `${k} 열이 셈을 안 쓴다`)
  }
})

test('\u2605 비고 열은 쓰는 견적에만 선다 — 빈 열이 품목 이름을 좁힌다', () => {
  const src = read('app/(crm)/crm/quotes/[id]/QuoteSheet.tsx')
  assert.match(src, /const showRemark = hasRemark\(doc\)/, '열을 세울지 안 묻는다')
  assert.match(src, /\{showRemark && <th[^>]*>\{QUOTE\.lineRemark\}<\/th>\}/, '제목 칸이 조건부가 아니다')
  assert.match(src, /\{showRemark && <td className=\{styles\.remark\}>\{l\.remark \?\? ''\}<\/td>\}/,
    '값 칸이 조건부가 아니거나 값을 안 그린다')
  assert.match(src, /const cols = \(showDiscount \? 7 : 6\) \+ \(showRemark \? 1 : 0\)/,
    'colSpan 이 비고 열을 안 센다 — 묶음 머리와 소계가 한 칸 밀린다')
})

/* ── ⑨ 합계는 금액 열에 선다, 표의 마지막 열이 아니다 ───────── */

/*
  사용자 지적(2026-10-03, 「금액부분 짤림」): 비고가 있는 견적서에서
  「합계 금액 2,198,592원」이 「2,198,」에서 끊겼고 공급가액은 「원」을 잃었다.

  금액 열은 25% 그대로였다 — 금액이 거기 없었을 뿐이다. 합계 줄은 모두
  「빈 칸 + 라벨 + 금액」 세 덩어리로 끝나는데, 비고 열이 서면 표의 마지막 칸이
  비고(10%)라 그 셋의 마지막이 비고 칸에 앉는다. 열 수(cols)는 이미 비고를 세고
  있었으므로 colSpan 합은 맞았고, 그래서 아무 가드도 안 걸렸다.

  열 폭을 늘려 막는 방식이 내용 길이에 다시 깨지듯, 「cols 만 맞으면 된다」도
  열이 하나 더 설 때 다시 깨진다. 그래서 **줄 끝에 빈 칸이 붙는지**를 센다.

  엑셀은 이 일을 안 겪었다 — 금액 열을 G 로 못 박고 비고를 그 뒤에 세웠다
  (quote-xlsx.ts 의 AMOUNT_COL_INDEX). 화면만 틀렸다.
*/

test('★ 합계 줄 끝에 비고 열만큼의 빈 칸이 있다 — 없으면 금액이 10% 칸으로 밀려 잘린다', () => {
  assert.match(SHEET, /const tailSpan = showRemark \? 1 : 0/,
    '비고 열만큼의 꼬리 칸을 안 센다')
  assert.match(SHEET, /const padSpan = cols - labelSpan - 1 - tailSpan/,
    '앞 빈 칸이 꼬리 칸을 안 빼서 colSpan 합이 열 수를 넘는다')
  assert.match(SHEET, /const tailCell = showRemark \? <td \/> : null/,
    '꼬리 칸을 그리는 자리가 없다')
})

test('★ 모든 합계 줄이 그 빈 칸을 실제로 붙인다 — 선언만 하고 안 쓰면 그대로 잘린다', () => {
  const foot = SHEET.slice(SHEET.indexOf('<tfoot>'), SHEET.indexOf('</tfoot>'))
  assert.ok(foot.length > 0, 'tfoot 을 못 찾았다')
  /*
    **줄마다 센다.** 한 줄만 고쳐 놓고 나머지를 두면 합계는 제자리인데
    부가세만 잘리는, 더 알아채기 어려운 모습이 된다.
  */
  const rows = foot.split('</tr>').filter((r) => r.includes('styles.num'))
  assert.ok(rows.length >= 4, `합계 줄을 ${rows.length}개만 찾았다 — 세는 방법이 틀렸다`)
  for (const row of rows) {
    assert.ok(row.includes('{tailCell}'),
      `금액이 든 합계 줄 하나가 꼬리 칸을 안 붙였다: ${row.replace(/\s+/g, ' ').trim().slice(0, 90)}`)
  }
})

test('★ 묶음 소계도 금액 열에 선다 — 진하게 칠하는 자리도 금액 칸이다', () => {
  assert.match(SHEET, /<td colSpan=\{cols - 1 - tailSpan\}>\{g\.section\.name\} \{QUOTE\.subtotal\}<\/td>/,
    '소계 라벨이 꼬리 칸을 안 빼서 금액이 비고 칸으로 밀린다')
  assert.match(
    SHEET,
    /<td className=\{styles\.num\}>\{money\(g\.section\.subtotalMinor\)\}<\/td>\s*\{tailCell\}/,
    '소계 금액 뒤에 꼬리 칸이 없다',
  )
  assert.match(DOC, /\.sectionSum \.num \{ color: var\(--text\); \}/,
    '소계 금액 색이 :last-child 로 돌아갔다 — 비고 열이 서면 빈 칸을 칠하고 금액은 흐리게 남는다')
})

test('★ 비고 칸은 띄어쓰기 없는 긴 값도 칸 안에서 접는다', () => {
  /*
    받은 견적서의 비고에 「(0.83*0.95*1440*1500)」 같은 셈식이 그대로 실려 온다.
    낱말이 아니라 한 덩어리라 `keep-all` 만으로는 칸을 넘어가 오른쪽 끝에서 잘렸다.
  */
  const remark = DOC.match(/\.remark \{[^}]*\}/)
  assert.ok(remark, '.remark 규칙을 못 찾았다')
  assert.match(remark[0], /word-break: keep-all/,
    '한글 낱말이 글자 단위로 쪼개진다(「스토리지」→「스토」/「리지」)')
  assert.match(remark[0], /overflow-wrap: break-word/,
    '띄어쓰기 없는 긴 값이 칸 밖으로 나가 잘린다')
})

// ── 금액 표시 선택이 되돌려지는 것을 막는다 ──────────────────────────────────
//
// 이 묶음은 **P0109 에서 실제로 난 사고 넷**을 그대로 잠근다.
// 셋은 구현 중에 잡혔고 하나는 앞 판의 교훈이다. 넷 다 「화면은 멀쩡한데
// 고른 것이 어딘가에서 조용히 사라지는」 종류라, 눈으로는 안 보인다.

const DRAFT_SHAPE = read('components/ui/crm/quote-draft-shape.ts')
const XLSX = read('lib/crm/services/quote-xlsx.ts')

test('★ 편집 모달이 표시 선택 넷을 저장 몸통에 싣는다 — 안 실으면 고른 것이 저장하는 순간 사라진다', () => {
  // 끝 표시를 **이 저장에만 있는 글자**로 잡는다 — 「await fetch」는 이 파일에 여럿이다
  const body = MODAL.slice(MODAL.indexOf('const payload = {'), MODAL.indexOf('const res = await fetch(isEdit'))
  assert.ok(body.length > 100, '저장 몸통을 못 찾았다 — 가드가 엉뚱한 자리를 보고 있다')
  for (const key of ['rateAxisKeys', 'lineNoteKeys', 'totalConvKeys', 'rateHoursPerMonth']) {
    assert.match(body, new RegExp(`${key}:`),
      `저장 몸통에 ${key} 가 없다. 화면에서 고른 것이 저장하는 순간 사라진다`)
  }
})

test('★ 초안이 표시 선택 넷을 되읽는다 — 안 읽으면 다시 열 때마다 빈 상태로 돌아간다', () => {
  const back = DRAFT_SHAPE.slice(DRAFT_SHAPE.indexOf('export function quoteToDraft'))
  assert.ok(back.length > 100, 'quoteToDraft 를 못 찾았다')
  for (const key of ['rateAxisKeys', 'lineNoteKeys', 'totalConvKeys', 'rateHoursPerMonth']) {
    assert.match(back, new RegExp(`${key}:`), `quoteToDraft 가 ${key} 를 안 읽는다`)
  }
  // 품목 기간도 같다 — 안 읽으면 기간이 사라져 금액 축이 설 근거가 없어진다
  for (const key of ['startDate', 'endDate']) {
    assert.match(back, new RegExp(`${key}:`), `quoteToDraft 가 품목 ${key} 를 안 읽는다`)
  }
})

test('★ 화면과 엑셀이 글을 각자 짓지 않는다 — 둘 다 quote-rate-text 를 읽는다', () => {
  /*
    셋이 같은 `QuoteDocument` 를 읽어도 **글을 각자 지으면 서서히 다른 문서가 된다.**
    「약」을 붙이는 규칙이 한쪽에만 고쳐지면 화면과 파일이 다른 숫자를 말하고,
    그건 고객이 둘을 나란히 놓는 순간 들킨다.
  */
  for (const [name, code] of [['견적서 화면', SHEET], ['엑셀', XLSX]] as const) {
    // 경로를 **닫는 따옴표까지** 본다 — 부분 일치면 quote-rate-text2 도 통과한다(실측)
    // 도메인은 상대 경로 + .ts 로 읽고(node --test 가 별칭을 모른다) 화면은 별칭으로 읽는다
    assert.match(code, /quote-rate-text(\.ts)?['"]/, `${name} 이 글 짓는 곳을 안 읽는다`)
    assert.match(code, /axisTexts|convTexts/, `${name} 이 축·환산 글을 자기가 짓고 있다`)
  }
  // 「약」을 붙일지는 **한 곳에서만** 정한다 — 두 곳에 있으면 한쪽만 고쳐진다
  for (const [name, code] of [['견적서 화면', SHEET], ['엑셀', XLSX]] as const) {
    assert.ok(!/APPROX_PREFIX/.test(code), `${name} 이 「약」 규칙을 따로 들고 있다`)
  }
})

test('★ 「직접」은 값으로만 판정하지 않는다 — 값으로 보면 누른 순간 730 으로 되읽힌다', () => {
  /*
    실측(2026-10-04): 「직접」을 누르면 월 기준 시간이 빈 문자열이 되는데, 빈 값은
    **기본값(730)** 이라 바로 730 으로 되읽혔다. 라디오가 제자리로 튀고 적을 칸이
    영영 안 열렸다. 그래서 「눌렀다」는 사실을 화면이 따로 들고 있어야 한다.
  */
  // **선언과 쓰는 자리를 둘 다 본다.** 이름만 찾으면 `setCustomOn` 한 줄만 남아도 통과한다(실측)
  assert.match(TOTALS, /const \[customOn, setCustomOn\] = useState/,
    '「직접」을 누른 사실을 들고 있는 자리가 없다 — 값으로만 보면 누른 순간 730 으로 되읽힌다')
  assert.match(TOTALS, /customOn\s*\?/, '들고는 있는데 판정에 안 쓴다')
  assert.match(TOTALS, /basis === 'custom'/, '적는 칸이 basis 가 아니라 값으로 열린다')
})

test('★ 미리보기는 견적서가 나눌 그 금액을 나눈다 — 계를 나누면 인쇄된 숫자와 갈린다', () => {
  /*
    실측(2026-10-04): 미리보기가 계(세금 포함)를 나눠 시간당 1,506원을 보였는데
    견적서는 품목 금액의 합을 나눠 1,369원을 인쇄했다. 고르는 사람이 본 숫자와
    고객이 받는 숫자가 다르면 그 미리보기는 거짓말이다.
  */
  assert.match(TOTALS, /subtotalMinor\s*-\s*totals\.discountMinor/,
    '미리보기가 품목 금액의 합이 아닌 것을 나눈다')
  assert.ok(!/netTotalMinor/.test(TOTALS.slice(TOTALS.indexOf('hourlyAt'), TOTALS.indexOf('const toggle'))),
    '미리보기가 계(세금 포함)를 나눈다 — 견적서는 품목 합을 나눈다')
})

test('★ 금액 칸의 축 줄은 식이 통째로 붙어 다닌다 — 「× 2개월」만 넘어가면 곱셈이 아무것도 안 가리킨다', () => {
  const body = DOC.match(/\.axisBody \{[^}]*\}/)
  assert.ok(body, '.axisBody 규칙을 못 찾았다')
  assert.match(body[0], /white-space: nowrap/, '곱셈식이 줄 안에서 끊긴다')
  // 근거 줄은 반대다 — 사실 둘이라 그 사이에서 접혀야 칸을 안 넘는다(390 에서 60px 넘쳤다)
  const note = DOC.match(/\.convNote \{[^}]*\}/)
  assert.ok(note, '.convNote 규칙을 못 찾았다')
  assert.ok(!/white-space: nowrap/.test(note[0]),
    '환산 근거가 nowrap 이라 좁은 칸에서 밖으로 삐져나간다')
})

/*
  ── 기간을 안 적은 시간 품목 ───────────────────────────────────────────────

  실측 2026-10-05: 견적 DA-2026-1003-01 은 금액 축 셋과 근거 셋을 다 고른 채
  저장돼 있었는데 품목에 날짜가 없어 견적서에 **한 줄도 안 그려졌다.** 수량 칸은
  「1,440 Hours」였고 단가는 1,388원이라 셀 것은 다 있었다.

  고친 뒤에는 그 줄들이 인쇄되므로, 모달이 아직도 「기간을 적어야 시간당과 월 금액을
  쓸 수 있다」고 말하면 **되는 것을 안 된다고 읽게 만든다.**
*/

test('★ 안내는 못 그리는 것만 말한다 — 수량이 시간이면 시간당을 못 쓴다고 하지 않는다', () => {
  assert.match(TOTALS, /rateAnyHours \? RATE_PERIOD_MISSING : RATE_HOURS_MISSING/,
    '안내가 기간 유무 하나로만 갈린다 — 수량이 시간인 경우를 안 가른다')
  assert.ok(TOTALS.includes('RATE_HOURS_MISSING,') || /RATE_HOURS_MISSING[,\s}]/.test(TOTALS),
    '새 안내 문구를 용어집에서 안 가져온다')
})

test('★ 안내 문구는 용어집에 있다 — 화면에 한글을 직접 안 적는다', () => {
  const TERMS = read('lib/terms/quote.ts')
  assert.match(TERMS, /export const RATE_HOURS_MISSING/, '용어집에 문구가 없다')
  // 기간만 비었을 때의 말이 아직도 시간당·월 금액을 못 쓴다고 하면 거짓말이다
  const line = TERMS.split('\n').find((l) => l.startsWith('export const RATE_PERIOD_MISSING')) ?? ''
  assert.ok(!line.includes('시간당'),
    '기간만 비었을 때 안내가 아직도 시간당을 못 쓴다고 말한다')
})

test('★ 미리보기도 수량이 센 시간을 본다 — 고를 때 빈칸이면 고른 결과를 모른다', () => {
  const slice = TOTALS.slice(TOTALS.indexOf('const hourlyAt'), TOTALS.indexOf('const toggle'))
  assert.match(slice, /: rateHours\b/,
    '미리보기가 기간만 본다 — 날짜 없는 시간 품목에서는 아무 숫자도 안 보인다')
  assert.ok(!/if \(!ratePeriod\) return null/.test(slice),
    '기간이 없다는 이유로 미리보기를 접는다')
})

test('★ 모달이 그 값을 실제로 세어서 넘긴다 — 선언만 하고 안 넘기면 아무 일도 안 난다', () => {
  assert.match(MODAL, /sharedRateHours\(draft\.lines\)/, '총 시간을 세는 자리가 없다')
  assert.match(MODAL, /rateHours=\{sharedHours\}/, '세어 놓고 합계 부품에 안 넘긴다')
  const SHAPE = read('components/ui/crm/quote-draft-shape.ts')
  assert.match(SHAPE, /export function sharedRateHours/, '세는 함수가 없다')
  assert.match(SHAPE, /hoursFromQuantity\(l\.unit, l\.quantity\)/,
    '수량을 시간으로 읽는 규칙이 문서 조립과 다른 자리에서 다시 쓰였다')
})

test('★ 견적서 화면은 환산 유무로 축을 접지 않는다 — 글 짓는 자리 한 곳만 본다', () => {
  /*
    화면·인쇄·엑셀 셋이 `domain/quote-rate-text` 에서 글을 받는다. 화면이 거기에 더해
    제 나름의 조건(`l.rate` 가 있나)을 하나 더 걸면, 기간 총액처럼 **환산이 필요 없는
    줄까지** 화면에서만 사라져 파일과 다른 문서가 된다.
  */
  assert.ok(!/\bl\.rate\b/.test(SHEET),
    '화면이 환산 유무를 직접 보고 축을 접는다 — 판단은 글 짓는 자리 한 곳에만 있어야 한다')
  assert.match(SHEET, /axisTexts\(l, doc\.meta\.rateAxisKeys/, '화면이 축 글을 안 받아 온다')
  assert.match(SHEET, /lineNoteText\(l, doc\.meta\.lineNoteKeys/, '화면이 근거 글을 안 받아 온다')
})

test('★ 월 기준 시간 선택지는 실제로 달라지는 것을 보여 준다', () => {
  /*
    수량이 센 시간은 기준이 730 이든 720 이든 안 움직인다. 그래서 시간당 환산값을
    그대로 붙이면 두 선택지 옆에 **같은 숫자**가 서고, 고르는 사람은 무엇을 고르는지
    알 수 없다(실측 2026-10-05: 둘 다 1,388원). 그때 갈리는 것은 개월이다.
  */
  assert.match(TOTALS, /const resultAt = \(hours: number\)/,
    '선택지 옆 결과를 고르는 자리가 없다 — 시간당 하나만 붙인다')
  assert.match(TOTALS, /if \(ratePeriod\) return hourlyAt\(hours\)/,
    '기간이 셀 때도 시간당을 안 보여 준다')
  assert.match(TOTALS, /monthsFromHours\(rateHours, hours\)/,
    '수량이 셀 때 개월을 안 센다')
  assert.match(TOTALS, /HOURS_BASIS_NO_MONTHS/,
    '개월이 안 떨어질 때 왜 못 적는지 안 말한다')
  assert.ok(!/\{HOURS_BASIS_HINT\[k\]\}/.test(TOTALS) || /result \?\? HOURS_BASIS_HINT\[k\]/.test(TOTALS),
    '결과가 있어도 설명만 보여 준다')
  assert.match(TOTALS, /ratePeriod \? HOURS_BASIS_NOTE : rateHours \? HOURS_BASIS_NOTE_HOURS/,
    '아래 안내가 경우에 상관없이 「시간당 숫자만 달라진다」고 말한다')
})

test('★ 그 두 문장도 용어집에 있다', () => {
  const TERMS = read('lib/terms/quote.ts')
  assert.match(TERMS, /export const HOURS_BASIS_NOTE_HOURS/, '수량이 셀 때의 안내가 용어집에 없다')
  assert.match(TERMS, /export const HOURS_BASIS_NO_MONTHS/, '개월이 안 맞는다는 말이 용어집에 없다')
})

test('★ 한 줄이라도 환산이 되면 못 한다고 말하지 않는다', () => {
  /*
    실측 2026-10-05: 「식」 한 줄과 「Hours 1,440」 한 줄이 섞인 견적에서 견적서에는
    시간당 금액이 인쇄되는데, 모달은 「기간을 적거나 수량을 시간 단위로 적어야
    시간당과 월 금액을 인쇄할 수 있어요」라고 적었다. **되는 것을 안 된다고 말했다.**

    원인은 한 신호를 두 질문에 쓴 것이다 — 합계 환산은 모든 줄이 같은 축일 때만 서고,
    금액 칸 줄은 줄마다 따로 선다.
  */
  const SHAPE = read('components/ui/crm/quote-draft-shape.ts')
  assert.match(SHAPE, /export function anyRateHours/, '「한 줄이라도 되나」를 세는 자리가 없다')
  assert.match(SHAPE, /lines\.some\(/, '모든 줄이 맞아야 한다는 규칙을 그대로 쓴다')
  assert.match(TOTALS, /rateAnyHours \? RATE_PERIOD_MISSING : RATE_HOURS_MISSING/,
    '안내가 아직 합계 환산용 신호로 갈린다')
  assert.match(MODAL, /anyRateHours\(draft\.lines\)/, '세는 함수를 안 부른다')
  assert.match(MODAL, /rateAnyHours=\{anyHours\}/, '세어 놓고 합계 부품에 안 넘긴다')
  // 미리보기는 여전히 공통 시간을 본다 — 줄마다 다르면 한 숫자를 적을 수 없다
  assert.match(TOTALS, /: rateHours\b/, '미리보기까지 「한 줄이라도」로 바꿔 버렸다')
})

test('★ 줄마다 근거가 다르면 빈칸으로 넘기지 않는다', () => {
  /*
    실측 2026-10-05: 「식」과 「Hours 1,440」이 섞인 견적에서 730시간·720시간 옆이
    둘 다 빈칸이었다. 빈칸은 「이 선택이 아무것도 안 바꾼다」로 읽히는데,
    실제로는 줄마다 바꾼다 — 못 적는 이유를 그 자리에 적는다.
  */
  assert.match(TOTALS, /return rateAnyHours \? HOURS_BASIS_PER_LINE : null/,
    '근거가 섞였을 때 아무 말도 안 하고 넘어간다')
  // 셋이 다른 말을 한다 — 기간이 셀 때·수량이 셀 때·줄마다 다를 때
  assert.match(TOTALS, /if \(ratePeriod\) return hourlyAt\(hours\)/, '기간이 셀 때 시간당을 안 보여 준다')
  assert.match(TOTALS, /monthsFromHours\(rateHours, hours\)/, '수량이 셀 때 개월을 안 센다')
  const TERMS = read('lib/terms/quote.ts')
  assert.match(TERMS, /export const HOURS_BASIS_PER_LINE/, '그 말이 용어집에 없다')
})

/* ── 옆으로 밀 수 있다는 것이 보이나 (v0.10.93x) ───────── */

test('★ 표가 실제로 넘칠 때만 밀어 보라고 한다', () => {
  /*
    실측 2026-10-05: 390px 에서 금액 칸이 x=403 에서 시작해 첫 화면 밖이었다.
    표는 가로로 넘어가는데(min-width 34rem) macOS·iOS 가 스크롤 막대를 숨겨서
    **거기 뭔가 더 있다는 사실 자체가 안 보였다.**

    안 넘치는데 밀어 보라고 하면 없는 것을 찾게 만든다 — 그래서 **재서 정한다.**
  */
  assert.match(SHEET, /el\.scrollWidth - el\.clientWidth > 1/,
    '넘치는지 안 재고 폭이나 기기로 짐작한다')
  assert.match(SHEET, /new ResizeObserver\(measure\)/,
    '한 번만 재고 만다 — 창을 줄이면 안내가 안 따라온다')
  assert.match(SHEET, /\{overflows && surface === 'screen' && \(/,
    '종이에도 안내가 실린다 — 우리 사정이 고객 문서에 찍힌다')
  assert.match(SHEET, /\{TABLE_SCROLL_HINT\}/, '문구를 용어집에서 안 가져온다')
  const TERMS = read('lib/terms/quote.ts')
  assert.match(TERMS, /export const TABLE_SCROLL_HINT/, '그 말이 용어집에 없다')
})

test('★ 인쇄에도 그 안내는 안 나간다 — 종이는 밀 수 없다', () => {
  assert.match(DOC, /@media print \{ \.tableHint \{ display: none; \} \}/,
    '인쇄에서 안내를 안 지운다')
})

test('★ 태블릿 폭에서도 표가 눌리지 않고 넘어간다', () => {
  /*
    문턱이 767px 이었을 때 **768px 에서만** 일곱 열이 426px 안에 눌려, 품목 이름이
    두 줄로 부서지고 비고 안쪽이 40px 이 되어 「providin/g」처럼 낱말이 끊겼다
    (실측 2026-10-05). 눌러서 맞추느니 넘겨서 읽는 편이 낫다.
  */
  assert.match(DOC, /@media screen and \(max-width: 1023px\) \{\s*\.table \{ min-width: 34rem; \}/,
    '표 최소 폭이 태블릿까지 안 걸린다')
})
