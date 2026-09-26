/**
 * 추가 문 — **숨기는 쪽과 막는 쪽이 같은 답을 하나**
 *
 * **왜**: 표면 판정(`decide.ts`)은 관리자를 맨 먼저 통과시킨다. AI 트레이딩은 축이 달라서
 *   소유자 한 사람만 본다(명세 M11). 두 규칙을 그냥 두면 소유자가 아닌 관리자의 메뉴에
 *   「AI 트레이딩」이 서고, 누르면 막힌다 — **죽은 문**이다.
 *
 * 이 가드가 보는 것은 셋이다.
 *
 * 1. 세 경우의 답 — 소유자 · 소유자가 아닌 관리자 · 일반 사용자
 * 2. 그 답이 **문과 같은 함수**(`decideTradingAccess`)에서 나온다
 * 3. 추가 문은 **숨기기만 한다** — 진짜 막는 자리를 안 대신한다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EXTRA_GATED, hasExtraGate, passesExtraGate } from './extra-gate.ts'
import { decideTradingAccess } from '../trading/access-decide.ts'
import { SURFACES } from './surfaces.ts'
import { TRADING_APP_DIR } from '../policy/app-dirs.ts'

const WEB = join(import.meta.dirname, '..', '..')
const read = (rel: string): string => readFileSync(join(WEB, rel), 'utf8')

const OWNER = 'owner-1111'
const OTHER = 'other-2222'

test('소유자·비소유자 관리자·일반 사용자 — 셋의 답이 갈린다', () => {
  const ctx = { tradingOwnerUserId: OWNER }

  // 소유자: 관리자가 아니어도 본다. 문을 여는 것은 역할이 아니라 소유다
  assert.equal(passesExtraGate('trading', { userId: OWNER, isAdmin: false }, ctx), true)

  // 소유자가 아닌 관리자: 막힌다. 관리자라는 이유로 남의 매매 기록이 열리지 않는다
  assert.equal(passesExtraGate('trading', { userId: OTHER, isAdmin: true }, ctx), false)

  // 일반 사용자: 막힌다
  assert.equal(passesExtraGate('trading', { userId: OTHER, isAdmin: false }, ctx), false)

  // 로그인 안 한 요청도 막힌다
  assert.equal(passesExtraGate('trading', { userId: null, isAdmin: false }, ctx), false)
})

test('소유자를 아직 안 정했으면 아무에게도 안 그린다', () => {
  for (const owner of ['', '   ', null]) {
    const ctx = { tradingOwnerUserId: owner }
    assert.equal(passesExtraGate('trading', { userId: OWNER, isAdmin: true }, ctx), false,
      '소유자가 빈 값인데 메뉴에 줄이 선다 — 눌러도 no_owner 로 막힌다')
  }
})

test('추가 문이 안 걸린 표면은 그대로 지나간다 — 새 문을 만들지 않는다', () => {
  const ctx = { tradingOwnerUserId: OWNER }
  for (const s of SURFACES) {
    if (hasExtraGate(s.key)) continue
    assert.equal(passesExtraGate(s.key, { userId: OTHER, isAdmin: false }, ctx), true,
      `${s.key} 가 추가 문에서 닫혔다 — 이 판정은 닫기만 하고 새로 닫을 자리를 늘리지 않는다`)
  }
})

test('추가 문의 답이 문과 같은 함수에서 나온다', () => {
  /**
   * 값을 대조한다. 「같은 함수를 부른다」를 글자로만 보면 import 만 남기고
   * 조건을 따로 적어도 통과한다(실측 v0.10.193 의 모양).
   */
  const cases = [
    { viewer: { userId: OWNER, isAdmin: false }, owner: OWNER },
    { viewer: { userId: OTHER, isAdmin: true }, owner: OWNER },
    { viewer: { userId: OTHER, isAdmin: false }, owner: '' },
    { viewer: { userId: null, isAdmin: false }, owner: OWNER },
  ]
  for (const c of cases) {
    assert.equal(
      passesExtraGate('trading', c.viewer, { tradingOwnerUserId: c.owner }),
      decideTradingAccess(c.viewer, c.owner).allowed,
      '메뉴가 문과 다른 답을 한다',
    )
  }
})

test('등재된 추가 문은 실제 표면이고 사유가 적혀 있다', () => {
  const keys = new Set(SURFACES.map((s) => s.key))
  for (const [key, why] of Object.entries(EXTRA_GATED)) {
    assert.ok(keys.has(key), `${key} 는 등재부에 없는 표면이다 — 아무것도 안 막는 줄이다`)
    assert.ok(why.length > 20, `${key} 에 왜 걸렸는지가 안 적혀 있다 — 다음 사람이 고장으로 보고 지운다`)
  }
  assert.ok(Object.keys(EXTRA_GATED).length > 0, '추가 문 목록이 비었다 — 규칙이 헛돈다')
})

test('숨기는 쪽이 막는 쪽을 대신하지 않는다', () => {
  /**
   * 진짜 막는 자리는 그 화면의 레이아웃이다. 주소는 손으로 칠 수 있으므로
   * 메뉴에서 지운 것만으로는 아무것도 안 막힌다.
   */
  const layout = read(`${TRADING_APP_DIR}/layout.tsx`)
  assert.match(layout, /await tradingAccess\(\)/, '트레이딩 레이아웃이 소유자 확인을 안 한다')
  assert.match(layout, /if \(!decision\.allowed\)/, '확인해 놓고 결과를 안 쓴다')
  assert.match(layout, /AccessDenied/, '막으면서 사유를 안 말한다')

  /**
   * 그리고 추가 문은 **메뉴 쪽 두 함수**에만 붙는다. 라우트 판정(`deniedSurfaceName`)에
   * 붙이면 트레이딩이 자기 사유로 말하던 자리를 일반 문구가 가로챈다.
   */
  const guard = read('lib/access/guard.ts')
  const openSurfaces = guard.slice(guard.indexOf('export async function openSurfaces'), guard.indexOf('export async function deniedSurfaceName'))
  const openMap = guard.slice(guard.indexOf('export async function openMap'))
  const denied = guard.slice(guard.indexOf('export async function deniedSurfaceName'), guard.indexOf('export async function canDo'))

  assert.match(openSurfaces, /passesExtraGate\(/, '사이드바·전체 메뉴가 추가 문을 안 본다')
  assert.match(openMap, /passesExtraGate\(/, '셸이 내려보내는 판정표가 추가 문을 안 본다')
  assert.doesNotMatch(denied, /passesExtraGate\(/, '라우트 판정이 추가 문을 대신 막는다 — 트레이딩의 사유가 안 나온다')
})
