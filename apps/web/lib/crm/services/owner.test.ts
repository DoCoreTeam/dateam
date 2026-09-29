/**
 * 담당자 변경이 세 개체에서 **같은 판정 한 곳**을 지난다
 *
 * **왜** (실측 2026-09-29)
 *
 *   담당자를 바꾸는 창구가 딜에만 있었고 거래처·고객에는 없었다. 없는 쪽을 붙이면서
 *   딜의 판정 블록을 복사하는 것이 제일 쉬운 길인데, 복사하면 그날부터 두 벌이 되고
 *   한쪽만 고쳐지는 날 **권한이 개체마다 다르게 걸린다.** 그건 화면에서 안 보인다.
 *
 *   그래서 이 가드가 보는 것은 「함수가 있느냐」가 아니라 **「판정이 한 벌이냐」**다.
 *   `decideReassign` 호출이 둘이 되는 순간 실패한다.
 *
 *   되는지 안 되는지의 규칙 자체(이관·인수·재배정)는 `owner-decide.test.ts` 가 16건으로
 *   이미 본다. 여기서 또 보지 않는다. 여기는 **그 규칙에 실제로 닿는지**만 본다 —
 *   단위 시험이 초록인데 그 함수가 안 불리는 자리를 여러 번 겪었다.
 *
 * DB 없이는 못 돌려 보는 자리라 소스를 읽는다. 주석은 지우고 센다 — 주석이 통과시키면 가드가 아니다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 주석을 지운 owner.ts — 주석에 남은 글자가 가드를 통과시키면 안 된다 */
const SRC = readFileSync(join(HERE, 'owner.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

/** `name(` 부터 괄호가 균형을 이루는 자리까지 — 인자를 통째로 꺼낸다 */
function callArgs(src: string, name: string, from = 0): string | null {
  const at = src.indexOf(`${name}(`, from)
  if (at < 0) return null
  let depth = 0
  for (let i = at + name.length; i < src.length; i += 1) {
    if (src[i] === '(') depth += 1
    else if (src[i] === ')') {
      depth -= 1
      if (depth === 0) return src.slice(at + name.length + 1, i)
    }
  }
  return null
}

function countOf(name: string): number {
  return SRC.split(`${name}(`).length - 1
}

test('판정은 한 벌이다 — decideReassign 을 부르는 자리가 하나뿐', () => {
  assert.equal(
    countOf('decideReassign'),
    1,
    '개체마다 판정을 복사하면 권한이 개체마다 달라진다. decideOwnerChange 를 부를 것',
  )
})

test('세 개체의 담당자 변경 함수가 전부 있다', () => {
  for (const fn of ['reassignDealOwner', 'reassignCompanyOwner', 'reassignPersonOwner']) {
    assert.ok(
      new RegExp(`export (async )?function ${fn}\\b`).test(SRC),
      `${fn} 이 없다 — 창구를 열어도 부를 것이 없다`,
    )
  }
})

test('거래처와 고객은 딜과 같은 몸통을 쓴다', () => {
  // 둘 다 reassignSimpleOwner 로 내려가야 한다. 각자 트랜잭션을 또 쓰면 몸통이 갈린 것이다
  for (const fn of ['reassignCompanyOwner', 'reassignPersonOwner']) {
    const body = SRC.slice(SRC.indexOf(`function ${fn}`))
    const head = body.slice(0, body.indexOf('\n}'))
    assert.match(head, /reassignSimpleOwner\(/, `${fn} 이 공용 몸통을 안 쓴다`)
  }
})

test('담당자를 쓰기 전에 판정을 지난다', () => {
  // 세 몸통(딜 · 공용) 각각에서 decideOwnerChange 가 ownerId 쓰기보다 앞에 와야 한다
  for (const fn of ['reassignDealOwner', 'reassignSimpleOwner']) {
    const body = SRC.slice(SRC.indexOf(`function ${fn}`))
    const end = body.indexOf('\nexport ', 1)
    const scope = end > 0 ? body.slice(0, end) : body
    const decided = scope.indexOf('decideOwnerChange(')
    const wrote = scope.indexOf('ownerId: nextOwnerMemberId')
    assert.ok(decided >= 0, `${fn} 이 판정을 안 부른다`)
    assert.ok(wrote >= 0, `${fn} 에 담당자 쓰는 자리가 없다`)
    assert.ok(decided < wrote, `${fn} 이 판정보다 먼저 쓴다`)
  }
})

test('권한은 값으로 넘어간다 — 고정값으로 박히지 않는다', () => {
  // canReassign 에 true 를 박으면 판정은 통과하는데 권한은 사라진다.
  // 선언만 하고 안 넘기는 자리도 같이 막는다
  assert.doesNotMatch(
    SRC,
    /canReassign:\s*(true|false)\b/,
    '권한을 고정값으로 넘기면 owner.reassign 이 아무 일도 안 한다',
  )
  const args = callArgs(SRC, 'decideOwnerChange', SRC.indexOf('function reassignDealOwner'))
  assert.ok(args, '딜이 판정을 안 부른다')
  assert.match(args, /canReassign,|canReassign:/, '딜이 권한을 안 넘긴다')

  const simple = callArgs(SRC, 'decideOwnerChange', SRC.indexOf('function reassignSimpleOwner'))
  assert.ok(simple, '거래처·고객이 판정을 안 부른다')
  assert.match(simple, /canReassign,|canReassign:/, '거래처·고객이 권한을 안 넘긴다')
})

test('판정이 지금 담당자와 새 담당자를 둘 다 받는다', () => {
  const args = callArgs(SRC, 'decideReassign')
  assert.ok(args, 'decideReassign 호출을 못 찾았다')
  // 하나라도 빠지면 이관과 인수가 안 갈린다
  for (const field of ['currentOwnerUserId', 'nextOwnerUserId', 'nextIsActiveMember', 'reach']) {
    assert.match(args, new RegExp(`${field}:`), `판정에 ${field} 가 안 간다`)
  }
})

test('나간 멤버는 새 담당자가 될 수 없다', () => {
  // active 집합이 살아 있는 멤버로만 만들어져야 한다
  assert.ok(SRC.includes('deletedAt: null'), '멤버를 읽을 때 나간 사람을 안 거른다')
  assert.match(
    callArgs(SRC, 'decideReassign')!,
    /nextIsActiveMember:\s*members\.active\.has\(/,
    '새 담당자가 살아 있는 멤버인지를 안 본다',
  )
})

test('세 개체 모두 낙관적 잠금을 건다', () => {
  // version 없이 쓰면 두 사람이 동시에 바꿀 때 나중 것이 앞 것을 조용히 덮는다
  assert.equal(
    countOf('lockWhere'),
    2,
    '딜 몸통과 공용 몸통 둘 다 lockWhere 로 잠가야 한다',
  )
  assert.doesNotMatch(SRC, /lockWhere\([^)]*\b(0|1)\b\s*\)/, '잠금 값을 고정값으로 박았다')
})

test('바뀐 것이 기록에 남는다 — 개체마다 다른 이름으로', () => {
  for (const action of ['deal.owner_changed', 'company.owner_changed', 'person.owner_changed']) {
    assert.ok(SRC.includes(action), `${action} 기록이 없다 — 누가 바꿨는지 물을 자리가 없어진다`)
  }
  // 바꾸기 전 값이 있어야 되돌릴 수 있다
  assert.match(SRC, /beforeJson:\s*\{\s*ownerId:/, '바꾸기 전 담당자를 안 남긴다')
})
