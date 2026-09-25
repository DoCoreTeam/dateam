/**
 * **주문 폴더 안을 본다** (Release 4 설계 §9)
 *
 * `trading-no-order-guard.test.ts` 는 `lib/trading/order/**` 밖에 주문이 0건임을 센다.
 * 이 파일은 그 **안**을 본다 — 주문 코드가 있어도 되는 자리지만, 있어도 되는 것과
 * 아무렇게나 해도 되는 것은 다르다.
 *
 * 무엇을 세나
 *   ① 무장 확인을 안 지나고 주문하는 길
 *   ② AI 가 무장하는 길
 *   ③ 재시도
 *   ④ 수량 2 이상
 *   ⑤ 주문 폴더 밖으로 새는 주문
 *   ⑥ 기본이 무장인 채로 배포되는 길
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ORDER_TR, FIXED_QUANTITY } from '../trading/order/order-request.ts'
import { DISARM_TRIGGERS } from '../trading/order/disarm.ts'
import { ARM_CHECKS } from '../trading/order/arming-policy.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ORDER = join(WEB, 'lib', 'trading', 'order')
const MIGRATIONS = join(WEB, '..', '..', 'supabase', 'migrations')

function walk(dir: string): string[] {
  let out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { out = out.concat(walk(full)); continue }
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue
    out.push(full)
  }
  return out
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
}

function orderSources(): { file: string; src: string }[] {
  return walk(ORDER).map((file) => ({
    file: relative(WEB, file),
    src: stripComments(readFileSync(file, 'utf8')),
  }))
}

test('★ 검사 대상이 있다 — 0개면 아래 단정은 언제나 초록이다', () => {
  const files = orderSources()
  assert.ok(files.length >= 5, `주문 폴더에 파일이 ${files.length}개뿐이다`)
  assert.ok(files.some((f) => f.src.includes('fetch(')), '주문을 실제로 부르는 자리가 없다')
})

// ── ① 무장 없이 주문하지 않는다 ─────────────────────────

test('★ 벤더를 부르는 자리가 전부 무장 확인을 지난다', () => {
  const offenders: string[] = []
  for (const { file, src } of orderSources()) {
    if (!/\bfetch\s*\(/.test(src)) continue
    if (!/armedNow\s*\(/.test(src)) offenders.push(`${file} — armedNow 없음`)
    if (!/checkArming\s*\(/.test(src)) offenders.push(`${file} — checkArming 없음`)
  }
  assert.deepEqual(offenders, [],
    `무장 확인 없이 주문한다:\n  ${offenders.join('\n  ')}`)
})

test('★ 무장 확인이 호출보다 먼저다', () => {
  for (const { file, src } of orderSources()) {
    if (!/\bfetch\s*\(/.test(src)) continue
    const armedAt = src.indexOf('armedNow(')
    const callAt = src.indexOf('fetch(')
    assert.ok(armedAt < callAt, `${file} 이 무장 확인보다 먼저 부른다`)
  }
})

// ── ② AI 가 무장하지 않는다 ─────────────────────────────

test('★ 무장에 사람 ID 가 필수다 (§15.3 실행 방식)', () => {
  const src = readFileSync(join(ORDER, 'arming.ts'), 'utf8')
  const start = src.indexOf('export async function arm(')
  const body = src.slice(start, src.indexOf('\nexport ', start + 1))
  assert.ok(body.includes('if (!input.actorUserId)'), '사람 없이 무장된다')
  assert.ok(body.includes('actorKind: \'human\''), '무장 기록에 사람이 안 적힌다')
})

test('★ DB 도 「무장은 사람만」을 지킨다', () => {
  const sql = readFileSync(join(MIGRATIONS, '287_trading_order.sql'), 'utf8')
  assert.ok(sql.includes("CHECK (action = 'disarm' OR actor_kind = 'human')"))
})

test('★ 주문 폴더가 AI 계층을 안 부른다 — AI 가 주문 판단에 안 낀다', () => {
  for (const { file, src } of orderSources()) {
    for (const banned of ['callKnowledge', 'callGemini', 'guardedText', 'judgeExitShadow']) {
      assert.equal(src.includes(banned), false, `${file} 이 ${banned} 에 닿는다`)
    }
  }
})

// ── ③ 재시도가 없다 ─────────────────────────────────────

test('★ 벤더를 부르는 함수에 반복문이 0개다', () => {
  for (const { file, src } of orderSources()) {
    if (!/\bfetch\s*\(/.test(src)) continue
    const start = src.indexOf('export async function placeOrder')
    assert.ok(start > 0, `${file} 에서 주문 함수를 못 찾았다`)
    const body = src.slice(start, src.indexOf('\nexport ', start + 1))
    for (const loop of ['for (', 'while (']) {
      assert.equal(body.includes(loop), false, `${file} 의 주문에 ${loop} 가 있다`)
    }
    assert.equal([...body.matchAll(/\bfetch\s*\(/g)].length, 1, `${file} 이 여러 번 부른다`)
  }
})

// ── ④ 수량 ──────────────────────────────────────────────

test('★ 수량이 늘 1 이다 — 코드·형·DB 세 겹', () => {
  assert.equal(FIXED_QUANTITY, 1)
  const request = readFileSync(join(ORDER, 'order-request.ts'), 'utf8')
  assert.ok(request.includes('input.quantity !== FIXED_QUANTITY'), '코드가 안 막는다')
  assert.ok(request.includes('ORD_QTY: String(FIXED_QUANTITY)'), '본문에 다른 수량이 갈 수 있다')
  const sql = readFileSync(join(MIGRATIONS, '287_trading_order.sql'), 'utf8')
  assert.ok(sql.includes('CHECK (quantity = 1)'), 'DB 가 안 막는다')
})

// ── ⑤ 주문이 폴더 밖으로 안 샌다 ────────────────────────

test('★ 주문 TR·경로가 주문 폴더 밖에 0건이다', () => {
  const roots = [join(WEB, 'lib', 'trading'), join(WEB, 'app')]
  const offenders: string[] = []
  for (const root of roots) {
    for (const file of walk(root)) {
      const rel = relative(WEB, file).replace(/\\/g, '/')
      if (rel.startsWith('lib/trading/order/')) continue
      const src = stripComments(readFileSync(file, 'utf8'))
      if (/\b[A-Z]{4}\d{4}U\b/.test(src)) offenders.push(`${rel} — 주문 TR`)
      if (/\/uapi\/domestic-futureoption\/v1\/trading\/(ngt-)?order(?![a-z-])/.test(src)) {
        offenders.push(`${rel} — 주문 경로`)
      }
    }
  }
  assert.deepEqual(offenders, [], `주문이 폴더 밖으로 샜다:\n  ${offenders.join('\n  ')}`)
})

test('★ 주문 TR 여섯이 전부 끝이 U 다', () => {
  for (const api of ['place', 'reviseCancel'] as const) {
    for (const v of Object.values(ORDER_TR[api])) {
      if (v === null) continue
      assert.match(v, /^[A-Z]{4}\d{4}U$/)
    }
  }
})

// ── ⑥ 기본이 해제다 ─────────────────────────────────────

test('★ 배포 기본이 해제다 — DB 기본값과 심는 값 둘 다', () => {
  const sql = readFileSync(join(MIGRATIONS, '287_trading_order.sql'), 'utf8')
  assert.ok(sql.includes('armed         BOOLEAN     NOT NULL DEFAULT FALSE'))
  assert.ok(sql.includes("VALUES ('paper', FALSE, now() - interval '1 day')"))
  /**
   * **DB 에 무장을 쓰는 자리**는 무장 함수 하나뿐이다.
   *
   * 형 선언(`| { armed: true; ... }`)까지 세면 안 된다 — 그것은 반환값의 꼴이지
   * 무장을 켜는 것이 아니다. `.upsert(`·`.insert(` 인자 덩어리만 잘라 본다
   */
  for (const { file, src } of orderSources()) {
    for (const m of src.matchAll(/\.(upsert|insert)\s*\(/g)) {
      const start = (m.index ?? 0) + m[0].length - 1
      let depth = 0
      let i = start
      for (; i < src.length; i += 1) {
        if (src[i] === '(') depth += 1
        else if (src[i] === ')') { depth -= 1; if (depth === 0) break }
      }
      const body = src.slice(start, i + 1)
      if (!/armed:\s*true/.test(body)) continue
      assert.equal(file, 'lib/trading/order/arming.ts', `${file} 이 무장을 켠다`)
      const armStart = src.indexOf('export async function arm(')
      const armEnd = src.indexOf('\nexport ', armStart + 1)
      assert.ok(start > armStart && start < armEnd,
        '무장 함수 밖에서 무장을 켠다 — 관문을 안 지나고 무장된다')
    }
  }
})

test('★ 멈추는 장치 여섯과 관문 일곱이 그대로다', () => {
  assert.equal(DISARM_TRIGGERS.length, 6)
  assert.equal(ARM_CHECKS.length, 7)
})
