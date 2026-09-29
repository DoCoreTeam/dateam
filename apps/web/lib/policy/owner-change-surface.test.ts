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

/* ── 화면 셋이 같은 자리를 갖는가 ─────────────────────────── */

/** 개체 → (상세 화면, OwnerPicker 에 넘길 entity 값) */
const SCREENS: ReadonlyArray<readonly [string, string, string]> = [
  ['딜', 'app/(crm)/crm/deals/[id]/DealDetail.tsx', 'deal'],
  ['거래처', 'app/(crm)/crm/companies/[id]/CompanyDetail.tsx', 'company'],
  ['고객', 'app/(crm)/crm/people/[id]/PersonDetail.tsx', 'person'],
]

/** `<OwnerPicker` 부터 여는 태그가 닫힐 때까지 — 넘기는 값을 통째로 꺼낸다 */
function pickerTag(src: string): string | null {
  const at = src.indexOf('<OwnerPicker')
  if (at < 0) return null
  let depth = 0
  for (let i = at; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') depth -= 1
    else if (src[i] === '>' && depth === 0) return src.slice(at, i + 1)
  }
  return null
}

for (const [label, screen, entity] of SCREENS) {
  test(`${label} 상세에 담당자를 바꾸는 자리가 있다`, () => {
    const src = code(screen)
    const tag = pickerTag(src)
    assert.ok(tag, `${label} 상세가 OwnerPicker 를 안 쓴다 — 창구는 열려 있는데 부르는 화면이 없어진다`)

    // 이름만 있으면 안 된다. **값이 실제로 가는지**를 본다 —
    // import 만 남기거나 고정값을 박아도 통과하면 가드가 아니다
    assert.match(tag, new RegExp(`entity=["']${entity}["']`), `${label} 이 잘못된 개체로 부른다`)
    for (const prop of ['id=', 'version=', 'owner=', 'onChanged=']) {
      assert.ok(tag.includes(prop), `${label} 이 ${prop} 를 안 넘긴다`)
    }
    // 버전을 고정값으로 박으면 낙관적 잠금이 죽는다
    assert.doesNotMatch(tag, /version=\{\s*\d+\s*\}/, `${label} 이 버전을 고정값으로 넘긴다`)
    // 담당자를 고정으로 null 로 넘기면 「담당자 없음」만 뜬다
    assert.doesNotMatch(tag, /owner=\{\s*null\s*\}/, `${label} 이 담당자를 고정값으로 넘긴다`)
  })

  test(`${label} 상세는 작성자 옆에 바꾸는 자리를 안 만든다`, () => {
    const src = code(screen)
    // 작성자 칸 안에 OwnerPicker 가 있으면 안 된다 — 작성자는 기록이라 안 바뀐다
    const at = src.indexOf('label="작성자"')
    assert.ok(at > 0, `${label} 상세에 작성자 칸이 없다`)
    const field = src.slice(at, at + 600)
    const end = field.indexOf('</RecordField>')
    assert.ok(end > 0, `${label} 작성자 칸이 안 닫힌다`)
    assert.ok(
      !field.slice(0, end).includes('<OwnerPicker'),
      `${label} 이 작성자를 바꿀 수 있게 그린다 — 바꿀 수 있으면 이력이 아니다`,
    )
  })

  test(`${label} 상세에 담당자 칸이 있다`, () => {
    assert.ok(code(screen).includes('label="담당자"'), `${label} 상세에 담당자 칸이 없다`)
  })
}

test('상세 창구 셋이 담당자와 작성자를 사람으로 펴서 준다', () => {
  // 화면이 그릴 값이 없으면 칸만 있고 늘 비어 보인다(실측 2026-09-29: 상세가 날 행만 줬다)
  for (const [label, service] of [
    ['거래처', 'lib/crm/services/company.ts'],
    ['고객', 'lib/crm/services/person.ts'],
  ] as const) {
    const src = code(service)
    const at = src.search(/export async function get[A-Za-z]*\(/)
    assert.ok(at >= 0, `${label} 상세 함수를 못 찾았다`)
    const body = src.slice(at, at + 900)
    assert.match(body, /owner:\s*toPersonJson\(/, `${label} 상세가 담당자를 안 붙인다`)
    assert.match(body, /creator:\s*toPersonJson\(/, `${label} 상세가 작성자를 안 붙인다`)
  }
})
