// 목록이 담당자 범위를 **실제로 쓰는가** — 값이 가는지를 본다
//
// **왜 이름만 보면 안 되나**(이 저장소의 단골 결함): 선언은 했는데 안 넘기는 일이
// 네 번 반복됐다. 그래서 여기서 세는 것은 「ownerMemberIds 라는 말이 파일에 있나」가 아니라
// **① 서비스의 조건 조립부가 그 값으로 질의 조건을 만드는가 ② 창구가 그 값을 목록 호출에 넘기는가**다.
//
// 값 자체의 판정은 lib/crm/services/my-scope-decide.test.ts 가 본다.
// 여기는 그 판정이 세 목록에 **연결됐는지만** 본다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')

/** 서비스 셋 — 목록과 합계가 **같은 조건**을 보도록 조건은 한 곳에서만 만든다 */
const SERVICES = [
  '../crm/services/deal.ts',
  '../crm/services/company.ts',
  '../crm/services/person.ts',
]

/** 창구 셋 — 세 목록이 같은 규칙을 쓴다 */
const ROUTES = [
  '../../app/api/crm/deals/route.ts',
  '../../app/api/crm/companies/route.ts',
  '../../app/api/crm/people/route.ts',
]

test('세 목록 서비스가 담당자 값으로 질의 조건을 만든다', () => {
  for (const rel of SERVICES) {
    const src = read(rel)
    assert.match(
      src,
      /where\.ownerId\s*=\s*\{\s*in:\s*\[\.\.\.input\.ownerMemberIds\]\s*\}/,
      `${rel}: 담당자 값이 질의 조건까지 안 간다`,
    )
  }
})

/**
 * 호출의 **인자 덩어리**를 괄호 균형으로 잘라 낸다.
 *
 * 왜 이렇게까지 하나: 이름만 찾으면 `const { ownerMemberIds } = ...` 한 줄이 남아 있는 것만으로
 * 통과한다 — 정작 목록 호출에는 안 넘겨도. 실제로 이 가드를 그렇게 썼다가
 * 일부러 깨뜨린 판이 **그대로 통과**했다(2026-09-23). 값이 가는 자리를 봐야 한다.
 */
function argsOf(src: string, callee: string): string {
  const at = src.indexOf(`${callee}(`)
  assert.notEqual(at, -1, `${callee} 호출이 없다`)
  let depth = 0
  for (let i = at + callee.length; i < src.length; i += 1) {
    if (src[i] === '(') depth += 1
    else if (src[i] === ')') {
      depth -= 1
      if (depth === 0) return src.slice(at, i + 1)
    }
  }
  throw new Error(`${callee} 호출의 괄호가 안 닫힌다`)
}

test('세 창구가 서버가 만든 범위를 목록 호출에 넘긴다', () => {
  for (const rel of ROUTES) {
    const src = read(rel)
    assert.match(src, /loadMyScope\(db,\s*session\.memberId,\s*session\.role\)/, `${rel}: 범위를 세션에서 안 만든다`)
    assert.match(src, /listScopeOf\(my,\s*sp\.get\('scope'\)\)/, `${rel}: 탭 이름을 범위로 안 바꾼다`)
  }

  // 거래처·고객 담당자는 목록 호출에 바로 넣는다
  assert.match(
    argsOf(read('../../app/api/crm/companies/route.ts'), 'listCompanies'),
    /ownerMemberIds/, '거래처 목록 호출에 범위가 안 들어간다',
  )
  assert.match(
    argsOf(read('../../app/api/crm/people/route.ts'), 'listPeople'),
    /ownerMemberIds/, '고객 담당자 목록 호출에 범위가 안 들어간다',
  )

  /*
    딜은 조건 묶음(`filter`)을 목록과 합계가 **함께** 쓴다.
    그래서 ① 묶음 안에 범위가 있고 ② 목록과 합계 **둘 다** 그 묶음을 펼치는지를 본다 —
    하나만 펼치면 「내 담당 3건, 합계 40억」이 된다.
  */
  const deals = read('../../app/api/crm/deals/route.ts')
  assert.match(deals, /const filter = \{[^}]*ownerMemberIds[^}]*\}/s, '딜 조건 묶음에 범위가 없다')
  assert.match(argsOf(deals, 'listDeals'), /\.\.\.filter/, '딜 목록이 조건 묶음을 안 쓴다')
  assert.match(argsOf(deals, 'sumDeals'), /filter/, '딜 합계가 목록과 다른 조건을 본다')
})

test('세 창구가 그릴 수 있는 탭을 화면에 실어 보낸다', () => {
  for (const rel of ROUTES) {
    assert.match(read(rel), /listTabs\(my\)/, `${rel}: 탭 목록을 안 준다 — 화면이 세면 권한과 어긋난다`)
  }
})

/**
 * 화면이 범위를 **주소에** 남기는가.
 *
 * 남기지 않으면 새로고침과 공유가 다른 화면을 연다 — 「전체로 보세요」라고 보낸 주소가
 * 받는 쪽에서는 내 담당으로 열린다.
 */
test('네 목록 화면이 범위를 주소에 남긴다', () => {
  const urlBacked = [
    '../../app/(crm)/crm/deals/DealTableView.tsx',
    '../../app/(crm)/crm/companies/CompanyListView.tsx',
    '../../app/(crm)/crm/people/PersonListView.tsx',
  ]
  for (const rel of urlBacked) {
    const src = read(rel)
    assert.match(src, /filterKeys:\s*\['scope'/, `${rel}: scope 가 주소에 안 실린다`)
    assert.match(src, /sp\.set\('scope',\s*scope\)/, `${rel}: 고른 범위를 서버에 안 보낸다`)
  }

  // 보드는 useListQuery 를 안 쓴다 — 자기 손으로 주소에 쓴다
  const board = read('../../app/(crm)/crm/deals/DealBoard.tsx')
  assert.match(board, /searchParams\.get\('scope'\)/, '보드가 주소에서 범위를 안 읽는다')
  assert.match(board, /scope=\$\{encodeURIComponent\(who\)\}/, '보드가 범위를 서버에 안 보낸다')
})
