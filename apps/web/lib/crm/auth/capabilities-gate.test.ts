/**
 * 능력 관문 — 판정이 맞는지와, **부르는 자리가 실제로 부르는지**를 함께 본다
 *
 * **왜 둘인가**: `quote.approve` 는 능력 목록에도 있고 화면에 뜨는 이름(`lib/terms/access.ts`)도
 * 있었는데 **부르는 자리가 0곳이었다**(실측 2026-09-22). 판정 함수만 있고 아무도 안 부르면
 * 그 능력은 문서일 뿐이다. 그래서 단정을 둘로 나눈다.
 *
 *   ① 관문이 맞게 판정하나 — 권한 없는 관람자를 막나
 *   ② 그 관문을 지나야 하는 창구가 실제로 부르나 — import 만 하고 안 부르는 판을 잡는다
 *
 * ②가 없으면 «선언만 하고 안 넘김»이 그대로 통과한다. 이 저장소에서 같은 결함이
 * 반복해서 나왔기 때문에(설정 카드 열넷 중 둘만 권한을 받던 것) 값이 가는지를 센다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { requireQuoteApprove, requireCostEdit, requireCostView } from './capabilities-gate.ts'
import { ROLE_CAPABILITIES, capabilitiesOf, type Viewer } from '../security/sensitivity.ts'
import { CAPABILITIES, type Capability } from '../../access/capabilities.ts'
import { CrmError } from '../domain/errors.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..', '..', '..')

/** 역할 기본값만 가진 관람자 — 개별 부여가 없는 보통 상태다 */
function viewerOfRole(role: string): Viewer {
  return { role, capabilities: [] }
}

/** 던진 오류가 FORBIDDEN 인가 */
function forbidden(fn: () => void): boolean {
  try {
    fn()
    return false
  } catch (e) {
    return e instanceof CrmError && e.code === 'FORBIDDEN'
  }
}

// ── ① 판정 ────────────────────────────────────────────────

test('견적 승인: 역할 기본값으로는 ADMIN 이상만 통과한다', () => {
  // 통과해야 하는 쪽
  assert.doesNotThrow(() => requireQuoteApprove(viewerOfRole('OWNER')))
  assert.doesNotThrow(() => requireQuoteApprove(viewerOfRole('ADMIN')))

  // 막아야 하는 쪽 — MEMBER 는 quote.send 만 가진다
  assert.ok(forbidden(() => requireQuoteApprove(viewerOfRole('MEMBER'))),
    'MEMBER 가 승인할 수 있으면 할인 임계가 뜻을 잃는다')
  assert.ok(forbidden(() => requireQuoteApprove(viewerOfRole('READONLY'))),
    'READONLY 가 승인할 수 있으면 안 된다')
  assert.ok(forbidden(() => requireQuoteApprove(null)), '관람자가 없으면 막는다')
})

test('견적 승인: 능력을 개별로 받은 멤버는 통과한다', () => {
  // 역할을 올리지 않고 능력만 더하는 길이 열려 있어야 한다(역할 수를 늘리지 않으려는 설계)
  const 멤버플러스: Viewer = { role: 'MEMBER', capabilities: ['quote.approve'] }
  assert.doesNotThrow(() => requireQuoteApprove(멤버플러스))
})

test('역할 기본값 표가 견적 승인을 ADMIN 이상에만 준다', () => {
  // 관문이 아니라 표 자체를 본다 — 표가 바뀌면 관문 시험이 조용히 뜻을 잃기 때문
  assert.ok(ROLE_CAPABILITIES.OWNER.includes('quote.approve'))
  assert.ok(ROLE_CAPABILITIES.ADMIN.includes('quote.approve'))
  assert.ok(!ROLE_CAPABILITIES.MEMBER.includes('quote.approve'))
  assert.ok(!ROLE_CAPABILITIES.READONLY.includes('quote.approve'))
})

test('담당자 변경: 팀장에게 역할을 안 올리고 권한만 줄 수 있다', () => {
  /*
    이 설계의 요점이다 — 관리자로 올리면 원가와 마진까지 열린다.
    담당자 변경에는 **관문 함수를 두지 않는다.** 「내 담당을 남에게 넘기기」는 권한 없이 되고
    「남의 담당 건드리기」는 필요해서, 무조건 부르는 관문으로는 둘을 못 가른다.
    판정은 `owner-decide.ts` 가 하고 여기서는 권한이 붙고 떨어지는 것만 본다.
  */
  const 팀장: Viewer = { role: 'MEMBER', capabilities: ['owner.reassign'] }
  assert.ok(capabilitiesOf(팀장).includes('owner.reassign'))
  // 권한만 줬으니 원가는 여전히 막혀야 한다
  assert.ok(forbidden(() => requireCostView(팀장)), '담당자 권한이 원가까지 열면 안 된다')
})

test('역할 기본값 표가 담당자 변경을 ADMIN 이상에만 준다', () => {
  assert.ok(ROLE_CAPABILITIES.OWNER.includes('owner.reassign'))
  assert.ok(ROLE_CAPABILITIES.ADMIN.includes('owner.reassign'))
  assert.ok(!ROLE_CAPABILITIES.MEMBER.includes('owner.reassign'))
  assert.ok(!ROLE_CAPABILITIES.READONLY.includes('owner.reassign'))
})

test('개별 부여를 거르는 기준은 역할 기본값이 아니라 이름 등록부다', () => {
  /*
    역할 기본값을 펼쳐 거르면 **어느 역할도 기본으로 안 가진 권한은 개별로 줘도 버려진다.**
    관리자는 준 줄 알고 받은 사람은 안 되고 기록도 없다 — 조용한 무시다.
    그래서 거르는 기준이 이름 등록부(CAPABILITIES)여야 한다.
  */
  const src = readFileSync(join(HERE, 'capabilities.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.ok(!/Object\.values\(ROLE_CAPABILITIES\)/.test(src),
    '역할 기본값으로 거르면 기본값에 없는 권한을 개별로 못 준다')
  assert.match(src, /new Set<string>\(CAPABILITIES\)/,
    '이름 등록부로 걸러야 오타는 막고 개별 부여는 산다')

  // 등록부에 새 이름이 실제로 들어 있는가 — 안 들어 있으면 위 필터가 그 권한을 버린다
  const known: readonly Capability[] = CAPABILITIES
  assert.ok(known.includes('owner.reassign'), 'owner.reassign 이 이름 등록부에 없다')
})

test('원가 관문 둘도 같은 기준으로 막는다', () => {
  // 새로 붙인 관문만 보고 기존 둘이 느슨해진 것을 놓치지 않게 함께 센다
  assert.ok(forbidden(() => requireCostEdit(viewerOfRole('MEMBER'))))
  assert.ok(forbidden(() => requireCostView(viewerOfRole('MEMBER'))))
  assert.doesNotThrow(() => requireCostEdit(viewerOfRole('ADMIN')))
  assert.doesNotThrow(() => requireCostView(viewerOfRole('ADMIN')))
})

// ── ② 부르는 자리 ─────────────────────────────────────────

/** 주석을 지운다 — 주석에 남은 이름이 가드를 통과시키면 가드가 아니다 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

/**
 * 관문을 지나야 하는 서비스 함수 → 같은 파일에 있어야 하는 관문.
 *
 * 새 동작에 능력을 걸면 여기 한 줄을 더한다. 안 더하면 그 동작은 능력 없이 열린 채로 남고,
 * 그 사실을 아무도 모른다 — 지금까지 `quote.approve` 가 그랬다.
 */
const MUST_GATE: ReadonlyArray<readonly [string, string]> = [
  ['approveQuote', 'requireQuoteApprove'],
  ['addInKind', 'requireCostEdit'],
]

test('능력이 걸린 서비스를 부르는 자리는 관문도 부른다', () => {
  const files = walk(join(WEB, 'app', 'api')).concat(walk(join(WEB, 'app', 'admin')))
  const missing: string[] = []

  for (const file of files) {
    const src = stripComments(readFileSync(file, 'utf8'))
    for (const [service, gate] of MUST_GATE) {
      // 호출 자리를 본다. `import { approveQuote }` 만 있는 파일은 대상이 아니다
      const calls = new RegExp(`(?<!function\\s)\\b${service}\\s*\\(`).test(src)
      if (!calls) continue
      // 관문도 **부르는지** 본다 — import 줄만 있으면 안 센다
      const gated = new RegExp(`\\b${gate}\\s*\\(`).test(src)
      if (!gated) missing.push(`${relative(WEB, file)} 가 ${service} 를 부르면서 ${gate} 를 안 부른다`)
    }
  }

  assert.deepEqual(missing, [], missing.join('\n'))
})

test('관문 대조표에 적힌 관문은 전부 실제로 있는 함수다', () => {
  // 오타가 나면 그 줄이 «아무도 안 걸리는 규칙»이 되어 조용히 통과한다
  const gateSrc = readFileSync(join(HERE, 'capabilities-gate.ts'), 'utf8')
  for (const [, gate] of MUST_GATE) {
    assert.ok(new RegExp(`export function ${gate}\\b`).test(gateSrc),
      `${gate} 가 capabilities-gate.ts 에 없다`)
  }
})
