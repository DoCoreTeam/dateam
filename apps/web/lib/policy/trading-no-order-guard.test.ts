/**
 * **이 저장소는 돈을 움직이지 않는다** (명세 M1)
 *
 * 시스템은 판단하고, 알리고, 기록하고, 배운다. 주문은 사람이 자기 수단으로 한다.
 * 그 경계를 지키는 것이 문서가 아니라 이 파일이다 — 문서만 있으면 언젠가
 * 「조회 하나 더」처럼 보이는 줄이 들어오고, 그 줄은 화면에서 아무 일도 안 일어난 것처럼 보인다.
 *
 * Release 4 에서 자동 주문을 열었다. **가드를 푼 것이 아니라 경계를 옮겼다** —
 * 주문 코드는 `lib/trading/order/**` 안에서만 있고, 밖에서는 지금까지처럼 0건을 센다.
 * 그 폴더 안을 보는 것은 `lib/policy/trading-order-guard.test.ts` 다.
 *
 * 경계를 옮긴 이유: 통째로 풀면 「조회 하나 더」처럼 보이는 줄이 엉뚱한 곳에 생기고,
 * 그 줄은 화면에서 아무 일도 안 일어난 것처럼 보인다.
 *
 * 무엇을 세나
 *   ① 주문 계열 KIS 경로 — **경로 넷만.** 계좌 조회도 같은 `/trading/` 아래 살아서
 *      경로를 통째로 막으면 1-C 의 잔고·체결 조회까지 같이 막힌다
 *   ② 주문 계열 TR ID — **끝 글자로 판정한다.** 조회는 `R`, 주문은 `U` 다.
 *      앞 네 글자로 판정하면 안 된다: `TTTO5201R` 은 조회이고 `TTTO1101U` 는 주문이며,
 *      실전 야간 주문 `STTN1101U` 와 정정취소 `TTTN1103U` 는 앞머리 목록에 아예 없었다
 *      (2026-09-26 공식 예제 `order.py`·`order_rvsecncl.py` 에서 확인, 그때까지 이 가드의 구멍이었다)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KIS_ACCOUNT_QUERIES } from '../trading/broker/endpoints.ts'
import { TRADING_APP_DIR } from './app-dirs.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 트레이딩 코드가 사는 곳 전부. 새 폴더가 생기면 여기 더한다 */
const ROOTS = [
  join(WEB, 'lib', 'trading'),
  join(WEB, 'app', 'api', 'trading'),
  join(WEB, TRADING_APP_DIR),
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

/**
 * 주석을 지운다.
 *
 * 주석은 API 를 못 부른다. 그런데 「조회와 주문을 어떻게 가르는가」를 설명하려면
 * 주문 TR 을 예로 적어야 하고, 주석까지 세면 **설명이 위반이 된다** — 그러면 설명을 지우게 되고
 * 다음 사람은 왜 이렇게 갈랐는지 모른다. 값이 가는 자리만 센다.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
}

/**
 * 주문 코드가 사는 자리. **여기 하나뿐이다** (Release 4 설계 §0).
 *
 * 이 폴더 안은 이 가드가 안 보고, `trading-order-guard.test.ts` 가 따로 본다 —
 * 무장 없이 주문하는 길·재시도·수량 2 같은 것을 거기서 센다.
 */
const ORDER_DIR = 'lib/trading/order/'

function sources(): { file: string; src: string }[] {
  return ROOTS.flatMap(walk)
    .map((file) => ({
      file: relative(WEB, file),
      src: stripComments(readFileSync(file, 'utf8')),
    }))
    .filter(({ file }) => !file.replace(/\\/g, '/').startsWith(ORDER_DIR))
}

const ORDER_PATTERNS: { re: RegExp; why: string }[] = [
  // 주문 경로는 이 넷뿐이다. `inquire-` 로 시작하는 것은 조회다
  { re: /\/uapi\/domestic-futureoption\/v1\/trading\/(ngt-)?order(?![a-z-])/, why: '선물옵션 주문 경로' },
  { re: /\/uapi\/domestic-futureoption\/v1\/trading\/(ngt-)?order-rvsecncl/, why: '선물옵션 정정취소 경로' },
  { re: /\/uapi\/domestic-stock\/v1\/trading\//, why: '주식 주문 계열 경로' },
  // **끝 U 가 주문이다.** 앞 네 글자로 가르면 TTTO5201R(조회)를 막고 STTN1101U(야간 주문)를 놓친다
  { re: /\b[A-Z]{4}\d{4}U\b/, why: '주문 TR ID (끝이 U)' },
  { re: /order-cash|order-credit/, why: '현금·신용 주문 경로' },
]

/**
 * 계좌 조회 — **1-C 부터 허용**이다(§3.2).
 *
 * 허용했다고 아무것이나 되는 것이 아니다. 조회 TR 은 끝이 `R` 이어야 하고,
 * 그 규칙을 아래 시험이 `KIS_ACCOUNT_QUERIES` 표에 대고 확인한다.
 */
const ACCOUNT_QUERY_PATHS = [
  'inquire-balance', 'inquire-ccnl', 'inquire-deposit', 'inquire-psbl-order',
  'inquire-ngt-balance', 'inquire-ngt-ccnl', 'ngt-margin-detail',
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

test('★ 계좌 조회 TR 은 전부 끝이 R 이다 — 하나라도 U 면 그것은 주문이다', () => {
  const bad: string[] = []
  for (const [key, spec] of Object.entries(KIS_ACCOUNT_QUERIES)) {
    for (const trId of [spec.trId, spec.paperTrId]) {
      if (!trId) continue
      if (!/^[A-Z]{4}\d{4}R$/.test(trId)) bad.push(`${key} — ${trId}`)
    }
    if (!ACCOUNT_QUERY_PATHS.some((p) => spec.path.endsWith(p))) {
      bad.push(`${key} — 허용 목록에 없는 경로 ${spec.path}`)
    }
  }
  assert.deepEqual(bad, [], `조회 표에 조회가 아닌 것이 있다:\n  ${bad.join('\n  ')}`)
})

test('★ 실전 야간 주문 TR 도 잡힌다 — 앞머리 목록에는 없던 값들이다', () => {
  // 공식 예제에서 읽은 실제 주문 TR 전부. 하나라도 안 걸리면 그 길이 열려 있다
  const orderTrIds = ['TTTO1101U', 'STTN1101U', 'VTTO1101U', 'TTTO1103U', 'TTTN1103U', 'VTTO1103U']
  const rule = ORDER_PATTERNS.find((p) => p.why.startsWith('주문 TR ID'))
  assert.ok(rule)
  for (const trId of orderTrIds) {
    assert.equal(rule.re.test(`const x = '${trId}'`), true, `${trId} 를 안 잡는다`)
  }
  // 조회 TR 은 안 걸려야 한다 — 걸리면 1-C 가 아예 못 돈다
  for (const trId of ['TTTO5201R', 'VTTO5201R', 'CTFO6118R', 'STTN5201R']) {
    assert.equal(rule.re.test(`const x = '${trId}'`), false, `${trId} 는 조회인데 막혔다`)
  }
})

test('★ 주문 경로는 막고 조회 경로는 통과시킨다', () => {
  const pathRules = ORDER_PATTERNS.filter((p) => p.why.includes('경로'))
  const hits = (line: string) => pathRules.some((p) => p.re.test(line))
  for (const p of [
    '/uapi/domestic-futureoption/v1/trading/order',
    '/uapi/domestic-futureoption/v1/trading/order-rvsecncl',
    '/uapi/domestic-futureoption/v1/trading/ngt-order',
    '/uapi/domestic-stock/v1/trading/order-cash',
  ]) assert.equal(hits(p), true, `주문 경로 ${p} 를 안 막는다`)
  for (const key of Object.keys(KIS_ACCOUNT_QUERIES) as (keyof typeof KIS_ACCOUNT_QUERIES)[]) {
    assert.equal(hits(KIS_ACCOUNT_QUERIES[key].path), false, `조회 경로 ${key} 가 막혔다`)
  }
})

test('★ 주문 폴더가 실제로 있고, 그 안에 주문 코드가 있다', () => {
  // 예외를 뒀는데 그 폴더가 비어 있으면 이 가드는 아무것도 안 지킨다
  const orderFiles = walk(join(WEB, 'lib', 'trading', 'order'))
  assert.ok(orderFiles.length >= 4, `주문 폴더에 파일이 ${orderFiles.length}개뿐이다`)
  const joined = orderFiles.map((f) => readFileSync(f, 'utf8')).join('\n')
  assert.ok(/\b[A-Z]{4}\d{4}U\b/.test(joined), '주문 폴더에 주문 TR 이 없다')
  assert.ok(joined.includes('/uapi/domestic-futureoption/v1/trading/order'), '주문 경로가 없다')
})

test('★ 주문 폴더 밖은 예전 그대로 0건이다', () => {
  const outside = sources()
  assert.ok(outside.length >= 60, `밖의 파일이 ${outside.length}개뿐이다`)
  for (const { file } of outside) {
    assert.equal(file.replace(/\\/g, '/').startsWith(ORDER_DIR), false,
      `${file} 이 예외 안에 있는데 밖으로 세어졌다`)
  }
})

test('규칙이 실제로 도는 대상이 있다 — 파일이 0개면 위 단정은 언제나 초록이다', () => {
  const files = sources()
  assert.ok(files.length >= 20, `검사 대상이 ${files.length}개뿐이다. 경로가 바뀌었는지 확인한다`)
  // 조회는 있어야 한다. 조회마저 0이면 스캔이 엉뚱한 곳을 보고 있는 것이다
  const hasQuotation = files.some((f) => /inquire-time-fuopchartprice/.test(f.src))
  assert.ok(hasQuotation, '분봉 조회 경로를 못 찾았다 — 스캔 대상이 트레이딩 코드가 맞는지 확인한다')
})
