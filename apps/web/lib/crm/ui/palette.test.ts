// 커맨드 팔레트 (dacrm FR-10)
//
// **왜 이 가드가 있는가**: 팔레트는 키보드로만 쓰는 물건이라, 눈으로 보면 멀쩡한데
// 손으로 쓰면 안 되는 결함이 잘 생긴다 — 특히 두 가지가 반복된다.
//
// ① **한글 조합 중 엔터.** 조합 중 엔터는 글자를 확정하는 키인데 그걸 실행으로 받으면
//    "삼성"을 치다가 엉뚱한 화면으로 이동한다(호스트에서 실제로 겪은 사고).
// ② **검색을 두 벌로 만드는 것.** 팔레트가 자기 검색을 짜면 여기서 찾은 것과
//    검색 화면에서 찾은 것이 달라지고, 사람은 어느 쪽을 믿을지 알 수 없다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  STATIC_COMMANDS, filterCommands, moveCursor, hitToCommand, KIND_LABEL,
} from './palette.ts'

const UI = readFileSync(
  new URL('../../../components/crm/CommandPalette.tsx', import.meta.url), 'utf8')

test('검색어가 없으면 전부 보여 준다 — 열자마자 무엇을 할 수 있는지 보여야 한다', () => {
  assert.equal(filterCommands(STATIC_COMMANDS, '').length, STATIC_COMMANDS.length)
  assert.equal(filterCommands(STATIC_COMMANDS, '   ').length, STATIC_COMMANDS.length)
})

test('★ 앞에서 맞은 것이 먼저 온다 — 뒤에 있어도 앞으로 끌어올린다', () => {
  /**
   * 실제 목록으로는 이 규칙을 검증할 수 없다 — 지금은 앞맞춤인 것이 마침 배열에서도 앞이라
   * 규칙을 지워도 결과가 같다(이 가드를 처음 쓸 때 실제로 그래서 헛돌았다).
   * 그래서 **뒤에 있는 앞맞춤**을 일부러 만들어 계약 자체를 본다.
   */
  const list = [
    { id: 'a', kind: 'go' as const, label: '딴것', href: '/a', keywords: ['회사'] },
    { id: 'b', kind: 'go' as const, label: '회사', href: '/b' },
  ]
  const r = filterCommands(list, '회사')
  assert.equal(r[0].id, 'b', '앞맞춤이 뒤로 밀렸다')
  assert.equal(r[1].id, 'a', '별칭으로 걸린 것이 사라졌다')
})

test('실제 목록에서도 "회"를 치면 "회사"가 맨 위다 (실브라우저 확인값)', () => {
  const r = filterCommands(STATIC_COMMANDS, '회')
  assert.equal(r[0].label, '회사')
  assert.ok(r.some((c) => c.label === '미팅'), '별칭으로 걸린 것이 사라졌다')
})

test('별칭으로도 찾는다 — 사람은 "거래처"라고 부르는데 화면은 "회사"다', () => {
  assert.ok(filterCommands(STATIC_COMMANDS, '거래처').some((c) => c.href === '/crm/companies'))
  assert.ok(filterCommands(STATIC_COMMANDS, 'todo').some((c) => c.href === '/crm/tasks'))
  assert.ok(filterCommands(STATIC_COMMANDS, '성사율').some((c) => c.href === '/crm/reports'))
})

test('영문 대소문자를 가리지 않는다', () => {
  assert.ok(filterCommands(STATIC_COMMANDS, 'DEAL').some((c) => c.href === '/crm/deals'))
})

test('★ 순위를 점수로 매기지 않는다 — 같은 걸 쳐도 순서가 달라지면 손이 위치를 못 외운다', () => {
  const a = filterCommands(STATIC_COMMANDS, '만들').map((c) => c.id)
  const b = filterCommands(STATIC_COMMANDS, '만들').map((c) => c.id)
  assert.deepEqual(a, b)
})

test('커서는 끝에서 반대편으로 돈다 — 막히면 사용자가 방향키를 계속 누른다', () => {
  assert.equal(moveCursor(0, -1, 3), 2)
  assert.equal(moveCursor(2, 1, 3), 0)
  assert.equal(moveCursor(0, 1, 3), 1)
})

test('목록이 비면 커서는 0 — 음수나 NaN 이 되면 렌더가 터진다', () => {
  assert.equal(moveCursor(5, 1, 0), 0)
  assert.equal(moveCursor(0, -1, 0), 0)
})

test('★ 찾은 것에 종류를 밝힌다 — "삼성"이 회사인지 딜인지 모르면 잘못 연다', () => {
  const c = hitToCommand({ kind: 'company', id: 'c1', title: '삼성SDS', sub: 'IT', href: '/crm/companies/c1' })
  assert.equal(c.label, '삼성SDS')
  assert.match(c.hint ?? '', /회사/)
  assert.equal(c.kind, 'record')

  const d = hitToCommand({ kind: 'deal', id: 'd1', title: '신규 협력', sub: null, href: '/crm/deals/d1' })
  assert.equal(d.hint, '딜')
})

test('CRM 밖으로 나가는 길이 있다 — 사이드바가 통째로 CRM 이라 없으면 갇힌 것처럼 느낀다', () => {
  assert.ok(STATIC_COMMANDS.some((c) => c.href === '/home'))
  assert.ok(STATIC_COMMANDS.some((c) => c.href === '/work'))
})

test('명령 id 가 겹치지 않는다 — 겹치면 리액트가 목록을 잘못 그린다', () => {
  const ids = STATIC_COMMANDS.map((c) => c.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('세 종류에 사람이 읽는 이름이 있다', () => {
  assert.equal(KIND_LABEL.go, '이동')
  assert.equal(KIND_LABEL.create, '만들기')
  assert.equal(KIND_LABEL.record, '찾은 것')
})

test('★ 한글 조합 중 엔터를 실행으로 받지 않는다 — "삼성" 치다가 엉뚱한 데로 간다', () => {
  assert.ok(UI.includes('isEnterKey(e)'), 'IME SSOT 를 쓰지 않는다')
  assert.ok(!/e\.key === 'Enter'/.test(UI), '생 Enter 비교가 남아 있다')
})

test('★ 검색을 새로 만들지 않고 CRM 검색 API 를 쓴다 — 두 벌이면 답이 갈린다', () => {
  assert.ok(UI.includes('/api/crm/search?q='), '자체 검색을 쓴다')
})

test('★ 매 글자마다 서버를 때리지 않는다 — 손가락 속도가 서버 부하가 되면 안 된다', () => {
  assert.ok(UI.includes('DEBOUNCE_MS'), '디바운스가 없다')
  assert.ok(UI.includes('setTimeout'), '지연 없이 바로 부른다')
})

test('★ 한 글자로는 레코드를 찾지 않는다 — 거의 전부가 걸려 목록이 쓸모없어진다', () => {
  assert.ok(UI.includes('term.length < 2'), '두 글자 기준이 없다')
})

test('★ Cmd+K 와 Ctrl+K 를 둘 다 받는다 — 맥과 윈도우가 다르다', () => {
  assert.ok(UI.includes('e.metaKey || e.ctrlKey'), '한쪽 키만 받는다')
  assert.ok(UI.includes("e.key.toLowerCase() === 'k'"), '대문자 K 를 놓친다')
})

test('ESC 와 바깥 클릭으로 닫힌다 — 여는 법만 있고 닫는 법이 없으면 갇힌다', () => {
  assert.ok(UI.includes("e.key === 'Escape'"), 'ESC 로 못 닫는다')
  assert.ok(UI.includes('onClick={() => setOpen(false)}'), '바깥을 눌러도 안 닫힌다')
})

test('★ 대화상자로 선언한다 — 안 그러면 화면 낭독기가 배경을 계속 읽는다', () => {
  assert.ok(UI.includes("role=\"dialog\""), 'dialog 가 아니다')
  assert.ok(UI.includes('aria-modal="true"'), '모달임을 알리지 않는다')
})

test('★ 검색이 실패해도 팔레트는 열린 채다 — 못 여는 것보다 고정 명령만이라도 나은 게 낫다', () => {
  assert.ok(UI.includes('catch'), '검색 실패를 삼키지 않는다')
  assert.ok(UI.includes('res.ok ?'), '실패 응답을 결과로 쓴다')
})

test('★ 모든 CRM 화면에서 열린다 — 한 화면에만 붙이면 사람이 안 쓴다', () => {
  const layout = readFileSync(
    new URL('../../../app/(crm)/layout.tsx', import.meta.url), 'utf8')
  assert.ok(layout.includes('<CommandPalette />'), 'CRM 셸에 안 붙었다')
})

test('폼 표준을 지킨다 — 팔레트라고 input-field 를 건너뛰면 테마 전환에서 이것만 남는다', () => {
  assert.ok(UI.includes('input-field'), '표준 클래스를 안 쓴다')
})
