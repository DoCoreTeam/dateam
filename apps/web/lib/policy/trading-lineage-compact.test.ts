import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 계보는 **접혀 있어야 한다**
 *
 * 사용자 지적 2026-09-30: 「이거 무슨말인지 하나도 모르겠네 (…) 자리 너무 많이 차지해
 * 로그는 접었다폈다 할 수 있어야 하고 이 부분 자체를 하나의 박스에서 다 보여지게 해줘
 * 내용도 축약하고 실제 명령은 접었다 폈다」.
 *
 * 전에는 걸음마다 「참조 / 한 것 / 낸 것」 세 줄에 물음 원문까지 펼쳐 놓아 여덟 걸음이
 * 화면 여러 장을 먹었다. 늘 펼쳐져 있는 글은 아무도 안 읽는다.
 *
 * 이 가드는 **다시 펼쳐지는 것**을 막는다. 화면 파일은 고치기 쉽고, 한 번 고치고 나면
 * 왜 접었는지는 잊힌다.
 */
const PANEL = new URL('../../app/(trading)/trading/LineagePanel.tsx', import.meta.url)

/** 주석은 통과시키지 않는다 — 이름만 찾으면 왜 접었는지 적은 글이 가드를 속인다 */
function drawnOnly(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

test('원문(pre)은 반드시 details 안에 있다', () => {
  const drawn = drawnOnly(readFileSync(PANEL, 'utf8'))
  const preAt = drawn.indexOf('<pre')
  assert.ok(preAt > 0, '원문을 아예 안 그린다 — 접는 것과 없애는 것은 다르다')

  /*
    `<pre` 앞에 열린 `<details>` 가 닫히지 않고 남아 있어야 한다.
    여는 것과 닫는 것을 세어 비교하면 자리까지 본다 — 이름만 찾으면
    화면 아무 데나 `<details>` 를 하나 두고 `<pre>` 를 밖에 꺼내도 통과한다.
  */
  const before = drawn.slice(0, preAt)
  const opened = (before.match(/<details/g) ?? []).length
  const closed = (before.match(/<\/details>/g) ?? []).length
  assert.ok(opened - closed >= 1, '원문이 details 밖에 있다 — 늘 펼쳐진 채로 뜬다')
})

test('details 에 open 을 안 건다 — 기본은 닫힘이다', () => {
  const drawn = drawnOnly(readFileSync(PANEL, 'utf8'))
  assert.equal(/<details[^>]*\sopen\b/.test(drawn), false, '접는 자리가 처음부터 펴져 있다')
})

test('한 줄에 보이는 것은 번호·종류·이름·낸 것 넷뿐이다', () => {
  const drawn = drawnOnly(readFileSync(PANEL, 'utf8'))
  const summaryAt = drawn.indexOf('<details')
  assert.ok(summaryAt > 0, '접는 자리가 없다')
  const head = drawn.slice(0, summaryAt)
  for (const field of ['step.no', 'step.name', 'step.produced']) {
    assert.ok(head.includes(field), `한 줄에 ${field} 가 없다`)
  }
  /*
    **참조와 한 것과 어디는 접힌 자리에만 있어야 한다.** 접는 자리 앞에 나오면
    한 걸음이 다시 여러 줄이 되고, 여덟 걸음이 화면을 다시 먹는다.
  */
  for (const field of ['step.referenced', 'step.did', 'step.where']) {
    assert.equal(head.includes(field), false, `${field} 가 아직 한 줄 자리에 있다`)
  }
})

test('계보는 카드 하나다 — 같은 주제로 칸을 또 세우지 않는다', () => {
  const drawn = drawnOnly(readFileSync(PANEL, 'utf8'))
  const sections = (drawn.match(/<section/g) ?? []).length
  assert.equal(sections, 1, `계보 화면이 section 을 ${sections}개 세운다`)
})
