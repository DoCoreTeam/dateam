/**
 * 담당자는 **전용 창구에서만** 바뀐다
 *
 * **왜** (실측 2026-09-29)
 *
 *   담당자 변경에는 권한(`owner.reassign`)과 조직 범위 판정이 붙어 있다. 그런데 수정 창구가
 *   본문을 `{ ...body }` 로 그대로 흘려서, `PATCH /api/crm/companies/[id]` 에 `ownerId` 를
 *   실어 보내면 **그 판정을 통째로 건너뛰고 담당자가 바뀌었다.** 거래처·고객·딜 셋 다였다.
 *   딜은 전용 창구를 만들어 둔 개체라 더 나빴다 — 권한이 걸린 줄 알았던 자리다.
 *
 *   **형으로는 못 막는다.** 라우트가 `as UpdateCompanyInput` 로 넘겨서 타입 검사가 안 걸린다.
 *   그래서 값을 지우는 줄이 있어야 하고, 이 가드는 **그 줄이 있는지**를 본다.
 *
 * 주석은 지우고 센다 — 주석이 통과시키면 가드가 아니다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function code(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** 개체 → (서비스 파일, 수정 입력 형, 전용 창구) */
const ENTITIES: ReadonlyArray<readonly [string, string, string, string]> = [
  ['거래처', 'lib/crm/services/company.ts', 'UpdateCompanyInput', 'app/api/crm/companies/[id]/owner/route.ts'],
  ['고객', 'lib/crm/services/person.ts', 'UpdatePersonInput', 'app/api/crm/people/[id]/owner/route.ts'],
  ['딜', 'lib/crm/services/deal.ts', 'UpdateDealInput', 'app/api/crm/deals/[id]/owner/route.ts'],
]

/** `export async function updateX(` 부터 다음 최상위 선언 전까지 */
function updateBody(src: string): string {
  const m = /export async function update[A-Za-z]*\(/.exec(src)
  assert.ok(m, '고치는 함수를 못 찾았다')
  const rest = src.slice(m.index)
  const next = /\nexport (async function|function|interface|const|type) /.exec(rest.slice(1))
  return next ? rest.slice(0, next.index + 1) : rest
}

for (const [label, service, inputType, route] of ENTITIES) {
  test(`${label} 수정 창구는 담당자를 안 쓴다`, () => {
    const body = updateBody(code(service))
    assert.match(
      body,
      /delete\s+data\.ownerId\b/,
      `${label} 의 고치는 길이 담당자를 지우지 않는다 — 수정 창구로 권한 판정을 건너뛸 수 있다`,
    )
  })

  test(`${label} 수정 입력 형이 담당자를 뺀다`, () => {
    const src = code(service)
    const m = new RegExp(`export interface ${inputType} extends ([^{]+)\\{`).exec(src)
    assert.ok(m, `${inputType} 을 못 찾았다`)
    // `Omit<Partial<XInput>, 'ownerId'>` — 안쪽 제네릭에 `>` 가 있어 좁은 문자군으로는 못 센다
    const extendsClause = m[1]
    assert.ok(
      extendsClause.includes('Omit<') && extendsClause.includes("'ownerId'"),
      `${inputType} 이 담당자를 그대로 물려받는다 — 형이라도 «여기 아님»을 말해야 한다`,
    )
  })

  test(`${label} 에 담당자 전용 창구가 있다`, () => {
    const src = code(route)
    // 창구가 비어 있으면 「막았는데 바꿀 길이 없는」 상태가 된다
    assert.match(src, /export async function POST\(/, `${label} 전용 창구에 POST 가 없다`)
    assert.match(src, /withCrmApi\(/, `${label} 전용 창구가 인증을 안 지난다`)
    assert.match(
      src,
      /canReassign:\s*hasCapability\(/,
      `${label} 전용 창구가 권한을 판정에 안 넘긴다`,
    )
  })
}

test('담당자를 바꾸는 서비스는 셋뿐이고 전부 한 판정을 지난다', () => {
  const owner = code('lib/crm/services/owner.ts')
  for (const fn of ['reassignDealOwner', 'reassignCompanyOwner', 'reassignPersonOwner']) {
    assert.ok(new RegExp(`export (async )?function ${fn}\\b`).test(owner), `${fn} 이 없다`)
  }
  assert.equal(
    owner.split('decideReassign(').length - 1,
    1,
    '판정이 두 벌이 되면 개체마다 권한이 달라진다',
  )
})

test('만드는 길은 계속 담당자를 받는다', () => {
  // 막는 것은 «고치는 길»이다. 만들 때까지 막으면 담당자 없는 행이 다시 쌓인다 —
  // 그게 거래처 382건이 전부 빈 칸이던 상태이고 목록이 통째로 비던 원인이다
  for (const [label, service] of ENTITIES.map((e) => [e[0], e[1]] as const)) {
    const src = code(service)
    const m = /export async function create[A-Za-z]*\(/.exec(src)
    assert.ok(m, `${label} 만드는 함수를 못 찾았다`)
    const rest = src.slice(m.index)
    const next = /\nexport (async function|function|interface|const|type) /.exec(rest.slice(1))
    const body = next ? rest.slice(0, next.index + 1) : rest
    assert.match(
      body,
      /data\.ownerId\s*=\s*actorId/,
      `${label} 을 만들 때 담당자가 안 붙는다`,
    )
    assert.doesNotMatch(body, /delete\s+data\.ownerId\b/, `${label} 만드는 길에서 담당자를 지운다`)
  }
})
