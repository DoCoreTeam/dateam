// lib/ui/deal-section-refresh.test.ts — **쓴 자리를 안 읽는 것**을 막는 가드
//
// 사용자 지적(2026-10-03):
//   「자 이렇게 파일로 해서 데이터를 넣었는데 바로 확인이 안되고 새로고침을 눌러야 하는 버그 있어」
//
// 실측: 딜 화면의 「파일로 가져오기」는 **견적 절의 단추**지만, 고른 도착지에 따라
// ① 딜 원가에 줄을 넣고 ② 원본 파일을 딜 첨부로 올린다. 그런데 갱신을 부르는 쪽은
// 견적 절뿐이었다 — QuotePanel 이 자기 목록만 다시 읽고 onChanged 로 딜과 타임라인을
// 다시 읽혔다. 원가 절과 첨부 절은 자기가 한 일만 알고 다시 읽으므로, 원가 한 건을
// 넣고도 그 자리에는 「원가 항목 추가」 빈 상태가 그대로 서 있었다.
//
// 이것은 LOOP.md 9절 F-8(UI 부터 저장 결과까지 잇는다)이 끊긴 자리다.
// 저장은 됐고 화면만 안 따라왔기 때문에 단위 시험으로는 영영 안 잡힌다 —
// **값이 가는지**를 본다(선언만 하고 안 넘기는 판에서 걸려야 한다).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf-8')

const DEAL = read('app/(crm)/crm/deals/[id]/DealDetail.tsx')
const COST = read('components/ui/crm/CostPanel.tsx')
const ATTACH = read('components/ui/crm/AttachmentPanel.tsx')
const IMPORT = read('components/ui/crm/QuoteFromFileModal.tsx')

/**
 * `<Tag ... />` 한 덩어리를 꺼낸다.
 *
 * **속성 이름만 찾으면 안 된다.** 파일 어딘가에 `reloadKey` 라는 글자가 있다고
 * 그 값이 그 패널로 가는 것은 아니다 — 주석에도 있고 옆 패널에도 있다.
 */
function element(src: string, tag: string): string {
  const i = src.indexOf(`<${tag}`)
  assert.ok(i >= 0, `${tag} 을 딜 상세에서 못 찾았다`)
  const j = src.indexOf('/>', i)
  assert.ok(j > i, `${tag} 의 끝(/>)을 못 찾았다`)
  return src.slice(i, j + 2)
}

/** load 를 도는 effect 의 의존 배열 */
function loadDeps(src: string, file: string): string {
  const m = src.match(/useEffect\(\(\) => \{ void load\(\) \}, \[([^\]]*)\]\)/)
  assert.ok(m, `${file} 에서 목록을 읽는 effect 를 못 찾았다 — 모양이 바뀌었으면 가드도 고친다`)
  return m[1]
}

/* ── ① 쓰는 쪽이 정말 저 두 자리에 쓴다 ───────────────── */

test('★ 가져오기는 견적만이 아니라 원가와 딜 첨부에도 쓴다 — 이 가드가 서 있는 이유', () => {
  assert.match(IMPORT, /costOne\(/, '원가로 보내는 길이 사라졌다면 아래 단정들의 전제가 바뀐 것이다')
  assert.match(IMPORT, /\[\['DEAL', dealId\]\]/,
    '원가로만 보냈을 때 원본 파일이 딜 첨부로 가는 길이 사라졌다')
})

/* ── ② 받는 쪽이 「다시 읽어라」를 실제로 듣는다 ───────── */

test('★ 원가 절이 바깥의 다시 읽기를 듣는다', () => {
  assert.match(COST, /reloadKey\?: number/, '원가 절에 reloadKey 가 없다')
  assert.match(COST, /export default function CostPanel\(\{[^}]*\breloadKey\b[^}]*\}: Props\)/,
    'reloadKey 를 받기만 하고 안 꺼낸다')
  assert.ok(loadDeps(COST, 'CostPanel').includes('reloadKey'),
    '원가 목록을 읽는 effect 가 reloadKey 를 안 본다 — 값이 바뀌어도 다시 안 읽는다')
})

test('★ 첨부 절이 바깥의 다시 읽기를 듣는다', () => {
  assert.match(ATTACH, /reloadKey\?: number/, '첨부 절에 reloadKey 가 없다')
  assert.match(ATTACH, /export default function AttachmentPanel\(\{[^}]*\breloadKey\b[^}]*\}: Props\)/,
    'reloadKey 를 받기만 하고 안 꺼낸다')
  assert.ok(loadDeps(ATTACH, 'AttachmentPanel').includes('reloadKey'),
    '첨부 목록을 읽는 effect 가 reloadKey 를 안 본다 — 값이 바뀌어도 다시 안 읽는다')
})

/* ── ③ 딜 상세가 그 값을 **실제로 넘기고** 올린다 ──────── */

test('★ 딜 상세가 원가 절과 첨부 절에 같은 열쇠를 넘긴다 — 선언만 하고 안 넘기면 걸린다', () => {
  const cost = element(DEAL, 'CostPanel')
  const key = cost.match(/reloadKey=\{(\w+)\}/)
  assert.ok(key, '원가 절에 reloadKey 가 안 간다 — 넣은 원가가 새로고침 전까지 안 보인다')

  const attach = element(DEAL, 'AttachmentPanel')
  assert.match(attach, new RegExp(`reloadKey=\\{${key[1]}\\}`),
    `첨부 절이 원가 절과 다른 것을 본다 — 같은 ${key[1]} 을 넘겨야 한 번에 함께 읽는다`)

  /*
    **올리는 자리는 견적 절의 onChanged 다.** 열쇠를 넘겨 두고 아무도 안 올리면
    값이 영영 그대로라, 넘긴 것과 안 넘긴 것이 화면에서 똑같이 보인다.
  */
  const quote = element(DEAL, 'QuotePanel')
  const bump = `set${key[1][0].toUpperCase()}${key[1].slice(1)}`
  assert.ok(quote.includes(bump),
    `견적 절이 ${bump} 을 안 부른다 — 가져오기가 끝나도 옆 두 절이 옛 값을 그린다`)
})

/* ── ④ 다른 화면의 첨부 절은 안 바뀐다 ────────────────── */

test('★ reloadKey 는 선택 prop 이다 — 회사·인물·견적 상세의 첨부 절은 그대로다', () => {
  assert.match(ATTACH, /reloadKey\?: number/, '필수 prop 이 되면 세 화면이 전부 깨진다')
  for (const f of [
    'app/(crm)/crm/people/[id]/PersonDetail.tsx',
    'app/(crm)/crm/companies/[id]/CompanyDetail.tsx',
  ]) {
    assert.doesNotMatch(read(f), /reloadKey=/, `${f} 가 필요 없는 열쇠를 들었다`)
  }
})
