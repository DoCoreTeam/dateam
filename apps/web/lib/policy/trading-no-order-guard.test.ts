/**
 * **이 저장소는 돈을 움직이지 않는다** (명세 M1)
 *
 * 시스템은 판단하고, 알리고, 기록하고, 배운다. 주문은 사람이 자기 수단으로 한다.
 * 그 경계를 지키는 것이 문서가 아니라 이 파일이다 — 문서만 있으면 언젠가
 * 「조회 하나 더」처럼 보이는 줄이 들어오고, 그 줄은 화면에서 아무 일도 안 일어난 것처럼 보인다.
 *
 * Release 4 에서 자동 주문을 별도 설계·승인으로 열 때 이 가드를 함께 푼다.
 * 그때까지는 **푸는 것이 곧 결정**이라 조용히 못 지나간다.
 *
 * 무엇을 세나
 *   ① 주문 계열 KIS 경로 (`/uapi/…/trading/…` · 야간 주문)
 *   ② 주문 계열 TR ID (국내선물옵션 주문은 끝이 `U`, 실전 `TTTO`·`JTCE`, 모의 `VTTO`)
 *   ③ 계좌 조회 TR — 1-A 범위 밖이다(§3.2, 1-C 에서 확정한다)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 트레이딩 코드가 사는 곳 전부. 새 폴더가 생기면 여기 더한다 */
const ROOTS = [
  join(WEB, 'lib', 'trading'),
  join(WEB, 'app', 'api', 'trading'),
  join(WEB, 'app', '(member)', 'trading'),
]

function walk(dir: string): string[] {
  let out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { out = out.concat(walk(full)); continue }
    if (!name.endsWith('.ts') && !name.endsWith('.tsx')) continue
    // 가드 자신은 금지어를 적어야 한다. 자기를 세면 영원히 빨갛다
    if (name.endsWith('.test.ts')) continue
    out.push(full)
  }
  return out
}

function sources(): { file: string; src: string }[] {
  return ROOTS.flatMap(walk).map((file) => ({ file: relative(WEB, file), src: readFileSync(file, 'utf8') }))
}

const ORDER_PATTERNS: { re: RegExp; why: string }[] = [
  { re: /\/uapi\/domestic-futureoption\/v1\/trading\//, why: '국내선물옵션 주문 계열 경로' },
  { re: /\/uapi\/domestic-stock\/v1\/trading\//, why: '주식 주문 계열 경로' },
  // 국내선물옵션 주문 TR 은 끝이 U 다. 실전 TTTO·JTCE, 모의 VTTO
  { re: /\b(TTTO|JTCE|VTTO)\d{4}U\b/, why: '주문 TR ID' },
  { re: /order-?rvsecncl|order-cash|order-credit/, why: '정정·취소·현금주문 경로' },
]

/** 계좌 조회 TR — 1-A 가 아니다(§3.2). 1-C 에서 이 목록을 줄인다 */
const ACCOUNT_TR_PATTERNS: { re: RegExp; why: string }[] = [
  { re: /inquire-balance/, why: '잔고 조회 (1-C)' },
  { re: /inquire-ccnl/, why: '체결 조회 (1-C)' },
  { re: /inquire-psbl-order/, why: '주문가능 조회 (1-C)' },
  { re: /inquire-deposit/, why: '예수금 조회 (1-C)' },
]

test('★ 트레이딩 코드에 주문을 부르는 자리가 없다 (M1)', () => {
  const offenders: string[] = []
  for (const { file, src } of sources()) {
    for (const { re, why } of ORDER_PATTERNS) {
      if (re.test(src)) offenders.push(`${file} — ${why} (${re.source})`)
    }
  }
  assert.deepEqual(
    offenders, [],
    `주문을 부를 수 있는 자리가 생겼다:\n  ${offenders.join('\n  ')}\n\n` +
      `이 시스템은 판단하고 알리고 기록한다. 주문은 사람이 한다(명세 C1·M1).\n` +
      `Release 4 에서 자동 주문을 열 때 이 가드를 함께 푼다 — 그때는 그것이 결정이다.`,
  )
})

test('★ 1-A 는 계좌를 조회하지 않는다 — 그것은 1-C 다', () => {
  const offenders: string[] = []
  for (const { file, src } of sources()) {
    for (const { re, why } of ACCOUNT_TR_PATTERNS) {
      if (re.test(src)) offenders.push(`${file} — ${why}`)
    }
  }
  assert.deepEqual(
    offenders, [],
    `계좌 조회가 들어왔다:\n  ${offenders.join('\n  ')}\n` +
      `명세 「구현 범위 잠금」이 1-A 에서 계좌 조회를 만들지 말라고 한다.`,
  )
})

test('규칙이 실제로 도는 대상이 있다 — 파일이 0개면 위 단정은 언제나 초록이다', () => {
  const files = sources()
  assert.ok(files.length >= 20, `검사 대상이 ${files.length}개뿐이다. 경로가 바뀌었는지 확인한다`)
  // 조회는 있어야 한다. 조회마저 0이면 스캔이 엉뚱한 곳을 보고 있는 것이다
  const hasQuotation = files.some((f) => /inquire-time-fuopchartprice/.test(f.src))
  assert.ok(hasQuotation, '분봉 조회 경로를 못 찾았다 — 스캔 대상이 트레이딩 코드가 맞는지 확인한다')
})
