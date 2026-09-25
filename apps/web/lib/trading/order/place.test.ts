/**
 * 주문 보내기 — **재시도하지 않는다**
 *
 * 응답을 못 받았을 때 「안 나갔겠지」로 다시 부르면 두 번 나간다.
 * 그리고 두 번 나간 사실은 체결이 돌아와야 안다 — 그때는 이미 2계약이다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS = join(HERE, '..', '..', '..', '..', '..', 'supabase', 'migrations')

/** 주석을 지운 원본. 설명이 위반으로 세어지면 설명을 지우게 된다 */
function src(): string {
  return readFileSync(join(HERE, 'place.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
}

/** 함수 하나를 다음 `export` 까지 자른다. `\n}` 로 끊으면 중첩 괄호에 걸린다 */
function fnOf(name: string): string {
  const raw = src()
  const start = raw.indexOf(name)
  assert.ok(start > 0, `${name} 을 못 찾았다`)
  const next = raw.indexOf('\nexport ', start + 1)
  const body = raw.slice(start, next > 0 ? next : raw.length)
  assert.ok(body.length > 100, `${name} 을 너무 짧게 잘랐다`)
  return body
}

test('★ 주문 호출에 재시도 루프가 0개다', () => {
  const fn = fnOf('export async function placeOrder')
  for (const loop of ['for (', 'while (', 'retry', 'attempt']) {
    assert.equal(fn.includes(loop), false, `주문에 ${loop} 가 있다 — 두 번 나갈 수 있다`)
  }
  // `fetch` 가 정확히 한 번만 나온다
  const fetches = [...fn.matchAll(/\bfetch\s*\(/g)].length
  assert.equal(fetches, 1, `주문이 fetch 를 ${fetches}번 부른다`)
})

test('★ 순서가 규칙이다 — 무장 → 관문 → 선점 → 호출', () => {
  const fn = fnOf('export async function placeOrder')
  const armedAt = fn.indexOf('armedNow(')
  const gateAt = fn.indexOf('checkArming(')
  const claimAt = fn.indexOf('claimOrder(')
  const callAt = fn.indexOf('fetch(')
  assert.ok(armedAt > 0 && gateAt > 0 && claimAt > 0 && callAt > 0, '넷 중 하나가 없다')
  assert.ok(armedAt < gateAt, '무장보다 관문을 먼저 잰다')
  assert.ok(gateAt < claimAt, '관문보다 선점을 먼저 한다')
  assert.ok(claimAt < callAt, '선점보다 먼저 부른다 — 두 크론이 같은 신호를 두 번 낸다')
})

test('★ 무장 안 되면 아무것도 안 한다', () => {
  const fn = fnOf('export async function placeOrder')
  /**
   * 사유 문자열이 있는 것과 **조건이 실제로 무장을 보는 것**은 다르다.
   * 실측: `if (false)` 로 바꿨는데 사유가 남아 있어 이 시험이 초록이었다
   */
  assert.ok(fn.includes('if (!(await armedNow(input.env, input.now)))'),
    '무장 확인이 조건에서 빠졌다')
  assert.ok(fn.includes("reason: 'not_armed'"))
  const notArmedAt = fn.indexOf("reason: 'not_armed'")
  const callAt = fn.indexOf('fetch(')
  assert.ok(notArmedAt < callAt, '무장 확인이 호출 뒤에 있다')
})

test('★ 관문을 주문 직전에 다시 잰다 — 무장은 하루를 간다', () => {
  const fn = fnOf('export async function placeOrder')
  assert.ok(fn.includes('checkArming(input.armCtx)'), '관문을 다시 안 잰다')
})

test('★ 불확실하면 unknown 이고 다시 안 부른다', () => {
  const fn = fnOf('export async function placeOrder')
  // 연결 실패·HTTP 실패·번호 없음 셋 다 unknown
  const unknowns = [...fn.matchAll(/status: 'unknown'/g)].length
  assert.equal(unknowns, 3, `불확실한 경우를 ${unknowns}가지만 unknown 으로 둔다`)
  assert.ok(fn.includes("reason: 'unknown'"), 'unknown 을 안 돌려준다')
})

test('★ KIS 가 거절한 것만 failed 다 — 거절 응답은 안 들어갔다는 뜻이다', () => {
  const fn = fnOf('export async function placeOrder')
  assert.ok(fn.includes("body.rt_cd !== '0'"), '거절을 안 가린다')
  assert.ok(fn.includes("status: 'failed'"), '거절을 failed 로 안 적는다')
})

test('★ unknown 은 미체결 조회로만 풀린다 — 다시 주문해서 확인하지 않는다', () => {
  const fn = fnOf('export async function resolveUnknown')
  assert.ok(fn.includes('confirmed_by_open_orders'))
  assert.equal(/fetch\s*\(|placeOrder\s*\(/.test(fn), false,
    'unknown 을 풀려고 다시 주문한다')
})

test('★ 선점 실패는 오류가 아니다 — 크론이 겹쳤다는 뜻이다', () => {
  const fn = fnOf('async function claimOrder')
  assert.ok(fn.includes("error.code === '23505'"), '유일 키 충돌을 오류로 던진다')
  assert.ok(fn.includes('return null'))
})

test('★ 주문 수량이 늘 1 이다 — 코드와 DB 둘 다', () => {
  assert.ok(src().includes('quantity: 1'))
  const sql = readFileSync(join(MIGRATIONS, '287_trading_order.sql'), 'utf8')
  assert.ok(sql.includes('CHECK (quantity = 1)'))
})

test('★ 같은 신호에 같은 종류 주문이 두 번 안 나간다 — DB 유일 키', () => {
  const sql = readFileSync(join(MIGRATIONS, '287_trading_order.sql'), 'utf8')
  assert.ok(sql.includes('UNIQUE (signal_id, order_kind)'))
})

test('★ 주문이 늘 신호를 물고 나간다 — 신호 없는 임의 주문이 없다', () => {
  const sql = readFileSync(join(MIGRATIONS, '287_trading_order.sql'), 'utf8')
  assert.ok(sql.includes('signal_id     UUID        NOT NULL REFERENCES public.trading_signals(id)'))
  const fn = fnOf('async function claimOrder')
  assert.ok(fn.includes('signal_id: input.signalId'))
})

test('★ 멈추는 장치가 볼 값을 여기서 센다', () => {
  assert.ok(src().includes('export async function orderFailureStreak'))
  assert.ok(src().includes('export async function ordersToday'))
  // 연속 실패는 성공을 만나면 멈춘다 — 누적으로 세면 어제 실패가 오늘을 막는다
  const fn = fnOf('export async function orderFailureStreak')
  assert.ok(fn.includes("if (row.status === 'sent') break"))
  assert.ok(fn.includes("row.status === 'unknown'"), 'unknown 을 실패로 안 센다 — 나갔는지 모르는 것도 실패다')
})

test('★ 시장가로 낸다 — 사람 지연이 없어졌고 진입 한계가는 신호가 정했다', () => {
  const fn = fnOf('export async function placeOrder')
  assert.ok(fn.includes("priceType: 'market'"))
  assert.ok(fn.includes('unitPrice: 0'))
})
