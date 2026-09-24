// 못 하는 동작의 버튼을 안 그리는가 — 설정 화면
//
// **왜 이 가드가 있나**: 설정 카드가 열넷인데 권한을 받는 카드가 **둘뿐**이었다.
// 나머지 열둘은 관리자가 아닌 사람에게도 「추가」·「저장」·「삭제」를 그려 놓고,
// 누르면 서버가 403 을 돌려줬다. 못 하는 일을 할 수 있는 것처럼 그려 놓고 거절하는 것은
// 안내가 아니라 함정이다 — 사람은 자기가 뭘 잘못했는지부터 찾는다.
//
// **감추는 것으로 권한을 대신하지 않는다**(LOOP.md 7절 S2). 서버 판정은 그대로 두고,
// 화면은 «못 누를 버튼을 그리지 않는 것»만 한다. 그래서 여기서 세는 것은
// 「쓰기를 하는 카드가 권한을 받아 **조건으로 쓰는가**」이지 「서버가 막는가」가 아니다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const DIR = new URL('../../app/(crm)/crm/settings/', import.meta.url)
const read = (name: string) => readFileSync(new URL(name, DIR), 'utf8')

/** 쓰기 창구를 부르는가 — 이름이 아니라 **요청 모양**으로 센다 */
const WRITES = /method:\s*'(POST|PATCH|PUT|DELETE)'/

/** 권한을 받는 세 갈래. 카드마다 서버가 요구하는 것이 달라 하나로 못 묶는다 */
const HOOKS = /use(CanEdit|CanWrite|CanExport)\(\)/

/**
 * 받은 값을 **조건으로 쓰는가.**
 *
 * 받아 놓고 안 쓰면 아무것도 안 감춘 것이다 — 이 저장소에서 「선언만 하고 안 넘기는」
 * 결함이 네 번 반복됐다. 그리는 자리(`{canEdit &&`, `canEdit ?`)와
 * 잠그는 자리(`disabled={!canEdit`)를 둘 다 받는다 — 값을 보여야 하는 칸은 감추면 안 된다.
 */
const USED = /\{\s*can(Edit|Write|Export)\s*&&|can(Edit|Write|Export)\s*\?|disabled=\{!can(Edit|Write|Export)|!can(Edit|Write|Export)\s*\?/

function cards(): string[] {
  return readdirSync(DIR).filter((f) => f.endsWith('.tsx') && f !== 'page.tsx')
}

test('쓰기를 하는 설정 카드는 전부 권한을 받는다', () => {
  const missing = cards().filter((f) => WRITES.test(read(f)) && !HOOKS.test(read(f)))
  assert.deepEqual(missing, [], `권한을 안 받는 카드: ${missing.join(', ')}`)
})

test('받은 권한을 실제로 조건으로 쓴다 — 받아만 두면 아무것도 안 감춘다', () => {
  const unused = cards().filter((f) => HOOKS.test(read(f)) && !USED.test(read(f)))
  assert.deepEqual(unused, [], `권한을 받고 안 쓰는 카드: ${unused.join(', ')}`)
})

test('권한은 화면이 계산하지 않는다 — 문맥에서 받는다', () => {
  for (const f of cards()) {
    const src = read(f)
    if (!HOOKS.test(src)) continue
    assert.ok(
      src.includes("from '@/lib/crm/ui/can-edit'"),
      `${f}: 권한 판정을 화면이 따로 만들면 규칙이 두 벌이 된다`,
    )
    assert.ok(
      !/hasCrmRole\s*\(/.test(src),
      `${f}: 등급 비교를 화면이 다시 적었다 — 서버가 한 판정을 받아 쓴다`,
    )
  }
})

test('설정 화면이 권한을 한 번만 내려 준다', () => {
  const page = read('page.tsx')
  assert.match(page, /<CanEditProvider value=\{ability\}>/, '권한을 문맥에 안 싣는다')
  // 세 갈래를 서버가 계산한다 — 카드가 저마다 다른 창구를 부르기 때문이다
  assert.match(page, /canEdit:.*hasCrmRole\(access\.session\.role, 'ADMIN'\)/, 'ADMIN 판정이 없다')
  assert.match(page, /canWrite:.*hasCrmRole\(access\.session\.role, 'MEMBER'\)/, 'MEMBER 판정이 없다')
  assert.match(page, /canExport:.*canExport\('\/crm'\)/, '내보내기 부여 판정이 없다')
})

/**
 * **문맥 밖에서는 아무것도 못 한다.**
 *
 * 기본값이 `true` 면 감싸는 것을 잊은 화면이 조용히 전원에게 단추를 그린다.
 * 빠뜨렸을 때 안전한 쪽으로 기울어야 한다.
 */
test('권한 기본값은 못 하는 사람이다', () => {
  const src = readFileSync(new URL('../crm/ui/can-edit.tsx', import.meta.url), 'utf8')
  assert.match(
    src,
    /const NOTHING: CrmSettingsAbility = \{ canEdit: false, canWrite: false, canExport: false \}/,
    '기본값이 못 하는 사람이 아니다',
  )
  assert.match(src, /createContext<CrmSettingsAbility>\(NOTHING\)/, '기본값을 문맥이 안 쓴다')
})
