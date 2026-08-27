/**
 * 회의 모드 가드 — 새 금액 렌더가 생겨도 안 새게
 *
 * **왜 정적 가드인가**: 회의 모드는 **빠뜨리면 아무도 모르는** 종류의 기능이다.
 * 금액을 새로 그리는 화면이 하나 늘어도 화면은 멀쩡히 뜨고, 켜 놓아도 그 자리만 안 가려진다.
 * 그 사실은 **고객 앞에서** 알게 된다.
 *
 * 그래서 `formatAmount` 를 그리는 자리를 세고, 그중 `Sensitive` 로 감싸지 않은 것을 막는다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { walkFiles, read, stripComments } from '../../ui/component-scan.ts'

const LAYOUT = readFileSync(new URL('../../../app/(crm)/layout.tsx', import.meta.url), 'utf8')
const TOGGLE = readFileSync(new URL('../../../components/crm/MeetingModeToggle.tsx', import.meta.url), 'utf8')
const SENSITIVE = readFileSync(new URL('../../../components/crm/Sensitive.tsx', import.meta.url), 'utf8')
const MODE = readFileSync(new URL('./meeting-mode.tsx', import.meta.url), 'utf8')

test('★ 배선 — 프로바이더와 토글이 CRM 레이아웃에 실제로 꽂혀 있다', () => {
  assert.match(LAYOUT, /<MeetingModeProvider>/, '프로바이더가 없다 — 토글을 눌러도 아무 일도 안 난다')
  assert.match(LAYOUT, /<MeetingModeToggle \/>/, '토글이 헤더에 없다 — 켤 방법이 없다')
})

test('★ 금액을 그리는 자리는 전부 Sensitive 를 거친다', () => {
  const offenders: string[] = []
  for (const file of walkFiles('app/(crm)')) {
    if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue
    const src = stripComments(read(file))
    if (!/formatAmount\(/.test(src)) continue
    // 포매터를 **정의**만 하는 파일은 렌더가 아니다
    if (/export function formatAmount/.test(src) && !/<[A-Z]/.test(src)) continue
    // 감싸는 방법은 둘이다 — 부품(`Sensitive`)이거나, 문장 안이면 훅(`useMaskAmount`)
    if (!/Sensitive|useMaskAmount/.test(src)) offenders.push(file)
  }
  assert.deepEqual(offenders, [],
    '금액을 그리는데 회의 모드를 안 거칩니다.\n' +
    '<Sensitive>{formatAmount(...)}</Sensitive> 로 감싸세요 — 고객 앞에서 그 자리만 안 가려집니다.')
})

test('가리는 것이지 지우는 것이 아니다 — 자리는 남는다', () => {
  assert.match(SENSITIVE, /placeholder/, '가린 자리에 대체 표시가 없다')
  assert.ok(!/return null/.test(SENSITIVE), '값을 지우면 줄이 접혀 화면이 흔들린다')
})

test('★ 회의 모드는 서버에 저장하지 않는다 — 다음 날에도 켜져 있으면 안 된다', () => {
  assert.match(MODE, /sessionStorage/, '탭 수명으로 두어야 한다')
  assert.ok(!/ui_preferences|fetch\(/.test(MODE), '서버에 저장하면 사무실에서도 금액이 안 보인다')
})

test('hydration 을 깨지 않는다 — 서버 렌더는 언제나 꺼짐으로 시작', () => {
  assert.match(MODE, /useState\(false\)/, '초기값을 저장소에서 읽으면 서버·클라이언트가 갈린다')
  assert.match(MODE, /useEffect\(/, '마운트 뒤에 복원해야 한다')
})

test('켜져 있음이 눈에 보인다 — 꺼졌는데 켜진 줄 알면 그게 더 위험하다', () => {
  assert.match(TOGGLE, /aria-pressed/, '상태를 보조기술이 못 읽는다')
  assert.match(TOGGLE, /data-on=/, '켜짐/꺼짐을 시각으로 구분하지 않는다')
})
