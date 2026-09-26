/**
 * AI 트레이딩 소유자 지정 — **문을 여는 값이 문 안에 갇히지 않게**
 *
 * **왜**: 2026-09-26 실측. `access_grant` 에 AI 트레이딩을 관리자에게 여는 줄이 이미 있었는데도
 *   아무도 못 들어갔다. `decideTradingAccess` 는 `owner_user_id` 가 비면 **아무도** 안
 *   들여보내는데, 그 값을 정하는 화면이 `/trading` **안에** 있었기 때문이다.
 *   값을 정해야 들어가고, 들어가야 값을 정한다 — 화면에는 오류 한 줄 안 떴다.
 *
 * 그래서 지정은 접근권한 화면(관리자 전용)으로 꺼냈다. 이 가드가 지키는 것은 넷이다.
 *
 * 1. 창구 위에 **사람 확인**이 있다 (서비스롤은 RLS 를 통째로 지나간다)
 * 2. 밖에서 온 id 는 **실제 사람과 대조한 뒤에만** 저장된다
 * 3. 저장은 `saveTradingSetting` 을 지난다 — 표에 직접 쓰지 않는다(판이 안 쌓인다)
 * 4. 화면에 그 칸이 **실제로 선다** — 모듈만 있고 부르는 자리가 없으면 고친 것이 아니다
 *
 * 그리고 판정 자체(빈 값이면 아무도 못 들어간다)는 문자열이 아니라 **함수를 불러** 확인한다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decideTradingAccess } from '../trading/access-decide.ts'

const WEB = join(import.meta.dirname, '..', '..')
const read = (rel: string): string => readFileSync(join(WEB, rel), 'utf8')

const ROUTE = 'app/api/admin/trading-owner/route.ts'
const MODULE = 'lib/trading/owner-admin.ts'
const ACTIONS = 'app/admin/access/actions.ts'
const CLIENT = 'app/admin/access/AccessClient.tsx'

test('소유자 창구는 사람 확인을 지난 뒤에만 서비스롤에 닿는다', () => {
  const src = read(ROUTE)

  assert.match(src, /requireAdminApi/, `${ROUTE} 가 인증 장치를 안 부른다 — 로그인한 아무나 자기를 소유자로 적는다`)
  assert.match(src, /if \(auth\.error\) return auth\.error/, '403 을 그대로 돌려보내지 않는다')

  /**
   * **순서를 본다.** 이름만 찾으면 import 만 남기고 호출을 지워도 통과한다(실측 v0.10.193).
   * 확인이 저장보다 뒤에 있으면 확인은 확인이 아니다.
   */
  const gate = src.indexOf('await requireAdminApi()')
  const write = src.indexOf('setTradingOwner(')
  assert.ok(gate > -1, '창구가 requireAdminApi 를 실제로 부르지 않는다')
  assert.ok(write > -1, '창구가 setTradingOwner 를 부르지 않는다')
  assert.ok(gate < write, '사람 확인이 저장보다 뒤에 있다 — 그 확인은 아무것도 막지 않는다')
})

test('소유자 모듈은 서버에만 있다', () => {
  const first = read(MODULE).split('\n').find((l) => l.trim() !== '')
  assert.equal(
    first?.trim(),
    "import 'server-only'",
    `${MODULE} 첫 줄이 import 'server-only' 가 아니다 — 서비스롤 키가 클라이언트 번들로 샐 수 있다`,
  )
})

test('밖에서 온 id 는 실제 사람과 대조한 뒤에만 저장된다', () => {
  const src = read(MODULE)

  assert.match(src, /\.from\('profiles'\)/, '소유자로 적을 사람을 profiles 에서 안 찾는다')
  assert.match(src, /\.is\('deleted_at', null\)/, '지워진 사람도 소유자가 될 수 있다')
  assert.match(src, /if \(!data\) return \{ ok: false/, '못 찾았는데 저장을 멈추지 않는다')

  const lookup = src.indexOf(".from('profiles')")
  const save = src.indexOf('saveTradingSetting({')
  assert.ok(save > -1, 'saveTradingSetting 을 부르는 자리를 못 찾았다')
  assert.ok(
    lookup > -1 && lookup < save,
    '대조가 저장보다 뒤에 있다 — 오타 한 글자가 「아무도 아닌 소유자」로 저장되고 그 상태는 화면에서 「지정됨」으로 보인다',
  )
})

test('소유자 저장은 설정 저장기를 지난다', () => {
  const src = read(MODULE)

  /**
   * 표에 직접 쓰면 `(key, version)` 판이 안 쌓이고 「그날 무엇이었나」가 사라진다.
   * 읽기(`loadTradingSettings`)도 저장기를 지나므로 이 모듈에는 그 표 이름이 나올 일이 없다.
   */
  assert.doesNotMatch(
    src,
    /from\(\s*'trading_settings'\s*\)/,
    `${MODULE} 가 trading_settings 를 직접 다룬다 — 판이 안 쌓여 이전 소유자가 사라진다`,
  )
  assert.match(src, /saveTradingSetting\(/, '저장이 설정 저장기를 안 지난다')
})

test('소유자를 바꾼 일이 누가·언제와 함께 남는다', () => {
  const src = read(MODULE)
  const call = src.slice(src.indexOf('saveTradingSetting({'))

  // 누구(changed_by)
  assert.match(call, /changedBy: actorId/, '바꾼 사람이 판에 안 남는다')
  // 무엇이 무엇으로 — 언제는 changed_at 칼럼이 기본값으로 박는다
  assert.match(call, /reason: ownerChangeReason\(/, '무엇이 무엇으로 바뀌었는지가 판에 안 남는다')
  assert.match(src, /function ownerChangeReason\(before: string, next: string\)/, '사유 문장을 만드는 자리가 없다')
  assert.match(src, /const before = await loadTradingOwner\(\)/, '이전 값을 안 잡으면 사유에 적을 수 없다')
})

test('접근권한 화면에 소유자 칸이 실제로 선다', () => {
  const actions = read(ACTIONS)
  const client = read(CLIENT)

  // 서버가 값을 싣는다
  assert.match(actions, /loadTradingOwner/, '접근권한 화면이 소유자를 안 읽는다')
  assert.match(actions, /owner: await readTradingOwner\(\)/, '읽은 소유자를 화면으로 안 넘긴다')
  assert.match(actions, /owner: SurfaceOwner/, 'AccessAdminData 에 소유자 자리가 없다')

  // 화면이 그린다
  assert.match(client, /owner\.surfaceKey === s\.key/, '어느 표면 줄에 소유자 칸을 세울지 화면이 안 가린다')
  assert.match(client, /RecordPickerField/, '소유자를 고르는 자리가 모달 피커가 아니다')
  assert.match(client, /'\/api\/admin\/trading-owner'/, '화면이 소유자 창구를 안 부른다')
  assert.match(client, /valueName=\{ownerName\}/, '지금 소유자 이름을 안 그린다 — id 만 보이면 누구인지 모른다')

  /**
   * 표면 키를 화면에 직접 적으면 키가 바뀌는 날 칸이 **조용히 사라진다.**
   * 사라진 칸은 오류를 안 내고, 그러면 처음 상태로 되돌아간다.
   */
  assert.doesNotMatch(client, /'trading'/, "화면이 표면 키 'trading' 을 직접 적는다 — 서버가 준 owner.surfaceKey 를 써야 한다")
})

test('소유자 키와 표면 키가 등재부와 같은 글자다', () => {
  const src = read(MODULE)

  const key = /export const TRADING_OWNER_KEY = '([^']+)'/.exec(src)?.[1]
  const surface = /export const TRADING_OWNER_SURFACE = '([^']+)'/.exec(src)?.[1]
  assert.ok(key && surface, '소유자 키와 표면 키를 상수로 안 내놓는다')

  assert.match(
    read('lib/trading/settings/registry.ts'),
    new RegExp(`key: '${key}'`),
    `설정 등재부에 ${key} 가 없다 — 저장이 「모르는 설정입니다」로 거절된다`,
  )
  assert.match(
    read('lib/access/surfaces.ts'),
    new RegExp(`key: '${surface}'`),
    `표면 등재부에 ${surface} 가 없다 — 소유자 칸이 어느 줄에도 안 선다`,
  )
})

test('소유자를 정하기 전에는 아무도 못 들어가고, 정한 뒤에는 그 사람만 들어간다', () => {
  const ownerId = '11111111-1111-1111-1111-111111111111'
  const otherAdmin = { userId: '22222222-2222-2222-2222-222222222222', isAdmin: true }

  // 지정 전 — 관리자도 막힌다. 「아직 안 정했다」는 「아무나 봐도 된다」가 아니다
  for (const empty of ['', '   ', null, undefined]) {
    const before = decideTradingAccess(otherAdmin, empty)
    assert.equal(before.allowed, false)
    assert.equal(before.reason, 'no_owner')
    assert.ok(before.userMessage, '막으면서 사유를 안 말한다 — 조용히 빈 화면을 주지 않는다')
  }

  // 지정 후 — 그 사람은 들어간다
  const owner = decideTradingAccess({ userId: ownerId, isAdmin: false }, ownerId)
  assert.equal(owner.allowed, true)
  assert.equal(owner.reason, 'owner')

  // 지정 후 — 다른 관리자는 여전히 막힌다. 관리자라는 이유로 남의 매매 기록이 열리지 않는다
  const notOwner = decideTradingAccess(otherAdmin, ownerId)
  assert.equal(notOwner.allowed, false)
  assert.equal(notOwner.reason, 'not_owner')
})
