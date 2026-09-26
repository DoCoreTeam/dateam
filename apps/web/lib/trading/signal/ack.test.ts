/**
 * 신호 확인 — **버튼 셋뿐이고 주문은 우리가 안 한다**
 *
 * 「지금 주문」 버튼을 하나 두면 그 버튼은 언젠가 진짜로 주문한다. 그것이 Release 4 다(C1 · M1).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ACK_ACTIONS, ACK_LABEL, decideAck, resultFor, parseStopPrice,
  type AckAction, type AckState,
} from './ack-policy.ts'
import { TRADING_APP_DIR } from '../../policy/app-dirs.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const TRADING_APP = join(HERE, '..', '..', '..', TRADING_APP_DIR)
const FRESH: AckState = { result: null, ackedAt: null, expired: false }

test('★ 버튼이 명세 §12 의 셋뿐이다', () => {
  assert.deepEqual([...ACK_ACTIONS], ['ordered', 'skipped', 'stop_reported'])
  assert.deepEqual(ACK_ACTIONS.map((a) => ACK_LABEL[a]), ['주문함', '건너뜀', '손절 설정함'])
})

test('아직 아무것도 안 누른 신호에는 셋 다 된다', () => {
  for (const a of ACK_ACTIONS) assert.deepEqual(decideAck(a, FRESH), { allowed: true })
})

test('★ 이미 결과가 적힌 신호는 다시 안 바꾼다 — 고치면 지연 통계가 거짓이 된다', () => {
  const done: AckState = { ...FRESH, result: 'followed' }
  assert.equal(decideAck('ordered', done).allowed, false)
  assert.equal(decideAck('skipped', done).allowed, false)
  assert.match(decideAck('skipped', done).allowed === false ? decideAck('skipped', done).reason : '', /already_followed/)
})

test('★ 손절 입력만 예외다 — 포지션이 살아 있는 동안 손절가는 바뀐다', () => {
  assert.deepEqual(decideAck('stop_reported', { ...FRESH, result: 'followed' }), { allowed: true })
  assert.deepEqual(decideAck('stop_reported', { ...FRESH, result: 'late' }), { allowed: true })
  // 건너뛴 신호는 포지션이 없다
  assert.equal(decideAck('stop_reported', { ...FRESH, result: 'skipped' }).allowed, false)
})

test('★ 만료 뒤 주문을 막지 않는다 — 늦게 따른 것도 사실이다', () => {
  assert.deepEqual(decideAck('ordered', { ...FRESH, expired: true }), { allowed: true })
})

test('★ 「주문함」이 결과를 안 정한다 — 결과는 체결을 봐야 안다 (D-32)', () => {
  assert.equal(resultFor('ordered'), null)
  assert.equal(resultFor('stop_reported'), null)
  assert.equal(resultFor('skipped'), 'skipped')
})

// ── 손절가 읽기 ──────────────────────────────────────────

test('손절가를 숫자로 읽는다', () => {
  assert.deepEqual(parseStopPrice({ direction: 'long', referencePrice: 300, value: '298.5' }),
    { ok: true, stopPrice: 298.5 })
  assert.deepEqual(parseStopPrice({ direction: 'short', referencePrice: 300, value: 301.5 }),
    { ok: true, stopPrice: 301.5 })
})

test('★ 방향에 안 맞는 손절가를 거절한다 — 진입 즉시 이탈이 켜진다', () => {
  const longUp = parseStopPrice({ direction: 'long', referencePrice: 300, value: 301 })
  assert.equal(longUp.ok, false)
  assert.equal(longUp.ok === false && longUp.reason, 'wrong_side')
  const shortDown = parseStopPrice({ direction: 'short', referencePrice: 300, value: 299 })
  assert.equal(shortDown.ok, false)
  // 기준가와 같은 값도 손절이 아니다
  assert.equal(parseStopPrice({ direction: 'long', referencePrice: 300, value: 300 }).ok, false)
})

test('숫자가 아니면 사람이 읽을 문장으로 거절한다', () => {
  for (const v of ['', '   ', 'abc', null, undefined, 0, -1]) {
    const r = parseStopPrice({ direction: 'long', referencePrice: 300, value: v })
    assert.equal(r.ok, false, `${String(v)} 를 받았다`)
    assert.ok(r.ok === false && r.userMessage.length > 0)
  }
})

// ── 창구와 화면 (보안 S2 · M1) ───────────────────────────

test('★ 확인 창구가 기존 소유자 확인을 지난다 — 새 인증을 안 만든다', () => {
  const src = readFileSync(join(TRADING_APP, 'actions.ts'), 'utf8')
  assert.equal(/createServerClient|auth\.getUser|from\('profiles'\)/.test(src), false,
    '서버 액션이 제 나름의 인증을 만든다 — 판정이 두 곳으로 갈린다')

  /**
   * 내보낸 액션 **하나하나**가 `tradingAccess()` 를 먼저 지나야 한다.
   *
   * 파일 어딘가에 있으면 통과시키면 안 된다 — 액션이 셋인데 둘만 확인을 부르는
   * 상태가 초록이 된다. 그리고 `getRequestUser` 는 누가 눌렀는지를 적을 때 쓰는 값이라
   * 금지가 아니라 **순서**가 규칙이다: 소유자 확인이 먼저다.
   */
  const actions = [...src.matchAll(/export async function (\w+)/g)].map((m) => m[1])
  assert.ok(actions.length >= 2, `창구를 ${actions.length}개밖에 못 읽었다`)
  for (const name of actions) {
    const start = src.indexOf(`export async function ${name}`)
    const next = actions
      .map((n) => src.indexOf(`export async function ${n}`))
      .filter((i) => i > start)
      .sort((a, b) => a - b)[0] ?? src.length
    const body = src.slice(start, next)
    const gateAt = body.indexOf('tradingAccess()')
    assert.ok(gateAt > 0, `${name} 이 소유자 확인을 안 부른다`)
    const userAt = body.indexOf('getRequestUser(')
    if (userAt > 0) {
      assert.ok(gateAt < userAt, `${name} 이 소유자 확인보다 먼저 사용자를 읽는다`)
    }
  }
})

/**
 * 화면 폴더 **전체**를 훑는다.
 *
 * 예전엔 맨 위 칸만 읽었다(`readdirSync` 한 번). 그때는 화면이 한 장이라 그걸로 충분했는데,
 * 2026-09-27 에 화면을 경로로 나누면서 하위 폴더가 생겼다 — 확장자 필터가 폴더를 건너뛰므로
 * **그 안의 새 화면들은 이 규칙 밖으로 나갔다.** 규칙이 깨진 것도 아니고 실패하지도 않는다.
 * 그냥 안 보게 되는 것이고, 그게 잠든 가드다.
 */
function sourcesUnder(dir: string, out: { name: string; src: string }[] = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { sourcesUnder(full, out); continue }
    if (!name.endsWith('.ts') && !name.endsWith('.tsx')) continue
    out.push({ name: relative(TRADING_APP, full), src: readFileSync(full, 'utf8') })
  }
  return out
}

test('★ 화면과 창구에 주문을 부르는 자리가 없다 (M1)', () => {
  const files = sourcesUnder(TRADING_APP)
  assert.ok(files.length > 12, `화면 파일을 ${files.length}개밖에 못 찾았다 — 규칙이 헛돈다`)
  for (const { name, src: raw } of files) {
    const src = raw
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
    assert.equal(/\b[A-Z]{4}\d{4}U\b/.test(src), false, `${name} 에 주문 TR 이 있다`)
    assert.equal(/uapi\/domestic/.test(src), false, `${name} 이 증권사를 직접 부른다`)
  }
})

test('★ 화면에 셋 말고 다른 조작 단추가 없다', () => {
  const panel = readFileSync(join(TRADING_APP, 'SignalPanel.tsx'), 'utf8')
  for (const banned of ['지금 주문', '자동 주문', '청산하기', '매수', '매도하기']) {
    assert.equal(panel.includes(`>${banned}<`), false, `단추 「${banned}」 가 있다`)
  }
  // 셋이 **전부** 화면에 있어야 한다. 「ACK_LABEL 이 어딘가 있다」로 통과시키면
  // 단추 하나를 지워도 초록이다
  for (const a of ACK_ACTIONS) {
    assert.ok(
      panel.includes(`ACK_LABEL.${a}`) || panel.includes(ACK_LABEL[a]),
      `${a}(${ACK_LABEL[a]}) 단추가 화면에 없다`,
    )
  }
})

test('★ 열람 시각을 한 번만 적는다 — 다시 볼 때마다 갱신하면 그 값이 마지막 본 때가 된다', () => {
  const src = readFileSync(join(HERE, 'ack.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export async function markOpened'))
  assert.ok(fn.includes(".is('opened_at', null)"), '열람 시각을 조건 없이 덮어쓴다')
})

test('★ 확인 시각이 셋 모두에서 찍힌다', () => {
  const src = readFileSync(join(HERE, 'ack.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export async function applyAck'))
  assert.ok(fn.includes('ack_at: input.now.toISOString()'))
  // 주문함은 주문 시각도 찍는다
  assert.ok(fn.includes('patch.order_at'))
})
