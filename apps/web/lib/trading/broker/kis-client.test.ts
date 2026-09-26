/**
 * KIS 조회의 세 가지를 잠근다
 *
 *   ① 주문 경로가 없다 (M1)              — 있으면 이 저장소가 돈을 움직일 수 있게 된다
 *   ② 주소에 바깥 값이 안 섞인다 (S4)    — 섞이면 사설망·메타데이터 주소를 물릴 수 있다
 *   ③ 실패가 조용하지 않다               — 사유와 사람이 읽을 문장이 둘 다 있다
 *
 * 그리고 이어 조회 커서 — 이것이 틀리면 같은 102건을 영원히 다시 받는다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KIS_QUOTATIONS, kisHost, KIS_HOST_REAL, KIS_HOST_PAPER } from './endpoints.ts'
import {
  buildUrl, buildHeaders, minuteBarParams, symbolParams,
  parseMinuteBars, nextMinuteCursor, readEnvelope, seoulStampToDate, seoulDateTimeParts,
} from './kis-request.ts'
import { createRateQueue } from './rate-queue.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const AUTH = { accessToken: 'token-value', appKey: 'app-key', appSecret: 'app-secret' }

// ── ① 주문 경로가 없다 (M1) ──────────────────────────────

/**
 * 선물옵션이 아닌 영역을 쓰는 창구. **이름과 이유를 함께 적는다** —
 * 「조회니까 괜찮다」로 열어 두면 다음에 무엇이 들어와도 괜찮아진다.
 */
const NON_FUTURES_PATH: Record<string, string> = {
  // 휴장일은 시장 전체의 것이라 상품별로 나뉘지 않는다. 선물옵션 영역에 같은 창구가 없다
  holidays: '/uapi/domestic-stock/v1/quotations/',
}

test('★ 부를 수 있는 것은 조회 다섯뿐이고 주문 경로가 없다', () => {
  const entries = Object.entries(KIS_QUOTATIONS)
  assert.equal(entries.length, 5, `조회 창구가 ${entries.length}개다. 지금은 다섯이다`)

  const expected: Record<string, string> = {
    minuteChart: 'FHKIF03020200',
    price: 'FHMIF10000000',
    askingPrice: 'FHMIF10010000',
    dailyChart: 'FHKIF03020100',
    holidays: 'CTCA0903R',
  }
  for (const [key, spec] of entries) {
    assert.equal(spec.trId, expected[key], `${key} 의 TR ID 가 명세 §20 과 다르다`)
    const allowed = NON_FUTURES_PATH[key] ?? '/uapi/domestic-futureoption/v1/quotations/'
    assert.ok(spec.path.startsWith(allowed),
      `${key} 가 허용된 조회 경로가 아니다: ${spec.path} (기대 ${allowed})`)
    // 주문 계열 경로 조각. 하나라도 들어오면 이 저장소가 돈을 움직일 수 있게 된다
    for (const banned of ['order', 'trading/', 'ccnl-notice', 'cancel', 'revise']) {
      assert.equal(spec.path.includes(banned), false, `${key} 경로에 「${banned}」가 있다`)
    }
  }
})

test('★ 분봉조회는 모의투자 미지원이라는 사실이 값으로 적혀 있다', () => {
  assert.equal(KIS_QUOTATIONS.minuteChart.paperSupported, false)
  assert.equal(KIS_QUOTATIONS.minuteChart.maxRowsPerCall, 102)
})

// ── ② 주소에 바깥 값이 안 섞인다 (S4) ────────────────────

test('★ 종목코드가 호스트나 경로를 바꾸지 못한다', () => {
  // 주소를 갈아타게 하려는 값들. 전부 질의 문자열 안에 갇혀야 한다
  const attacks = [
    '../../../etc/passwd',
    'http://169.254.169.254/latest/meta-data/',
    '101T12@evil.example.com',
    '101T12#fragment',
    'localhost:1234',
  ]
  for (const code of attacks) {
    const url = new URL(buildUrl('real', 'price', symbolParams(code)))
    assert.equal(url.origin, new URL(KIS_HOST_REAL).origin, `호스트가 바뀌었다: ${code}`)
    assert.equal(url.pathname, KIS_QUOTATIONS.price.path, `경로가 바뀌었다: ${code}`)
    assert.equal(url.searchParams.get('FID_INPUT_ISCD'), code, '값이 질의에 안 실렸다')
  }
})

test('환경에 따라 호스트가 둘 중 하나다 — 그 밖의 주소는 나올 수 없다', () => {
  assert.equal(kisHost('real'), KIS_HOST_REAL)
  assert.equal(kisHost('paper'), KIS_HOST_PAPER)
  assert.equal(new URL(buildUrl('paper', 'price', symbolParams('101T12'))).origin,
    new URL(KIS_HOST_PAPER).origin)
})

test('요청 머리에 토큰과 TR 이 실린다', () => {
  const headers = buildHeaders(AUTH, 'minuteChart')
  assert.equal(headers.authorization, 'Bearer token-value')
  assert.equal(headers.tr_id, 'FHKIF03020200')
  assert.equal(headers.custtype, 'P')
  assert.equal(headers.appkey, 'app-key')
})

test('분봉 요청 인자가 공식 예제와 같다', () => {
  const params = minuteBarParams({
    contractCode: '101W12',
    until: new Date('2026-09-26T01:23:45Z'), // 서울 10:23:45
    includePast: false,
  })
  assert.equal(params.FID_COND_MRKT_DIV_CODE, 'F', '지수선물 코드가 F 가 아니다(예제 확인값)')
  assert.equal(params.FID_HOUR_CLS_CODE, '60', '1분 봉 코드가 60 이 아니다')
  assert.equal(params.FID_FAKE_TICK_INCU_YN, 'N', '허봉을 받으면 거래량 0 인 진짜 봉과 섞인다')
  assert.equal(params.FID_INPUT_DATE_1, '20260926')
  assert.equal(params.FID_INPUT_HOUR_1, '102345')
})

test('자정 직후 시각이 24시로 나가지 않는다', () => {
  const { date, time } = seoulDateTimeParts(new Date('2026-09-25T15:00:30Z')) // 서울 00:00:30
  assert.equal(date, '20260926')
  assert.equal(time, '000030', `자정을 ${time} 로 보냈다 — KIS 가 거부한다`)
})

// ── ③ 실패가 조용하지 않다 ───────────────────────────────

test('★ 실패마다 사유와 사람이 읽을 문장이 둘 다 있다', () => {
  const cases = [
    readEnvelope(null, 500),
    readEnvelope({ rt_cd: '0' }, 503),
    readEnvelope({ rt_cd: '1', msg_cd: 'EGW00201', msg1: '초당 거래건수를 초과' }, 200),
  ]
  for (const failure of cases) {
    assert.ok(failure, '실패를 성공으로 읽었다')
    assert.ok(failure.reason.length > 0, '기계가 읽을 사유가 없다')
    assert.ok(failure.userMessage.length > 0, '사람이 읽을 문장이 없다')
  }
  // 성공은 null
  assert.equal(readEnvelope({ rt_cd: '0', output: {} }, 200), null)
})

test('오류 문장에 증권사 원문을 그대로 싣지 않는다 — 내부 구조가 샌다', () => {
  const failure = readEnvelope({ rt_cd: '1', msg_cd: 'EGW00201', msg1: '계좌 12345678-01 오류' }, 200)
  assert.ok(failure)
  assert.equal(failure.userMessage.includes('12345678'), false)
  assert.equal(failure.reason, 'kis_EGW00201')
})

// ── 봉 읽기와 이어 조회 ──────────────────────────────────

const rawBar = (hour: string, over: Record<string, string> = {}) => ({
  stck_bsop_date: '20260926',
  stck_cntg_hour: hour,
  futs_oprc: '1100.00', futs_hgpr: '1101.00', futs_lwpr: '1099.50', futs_prpr: '1100.50',
  cntg_vol: '120',
  ...over,
})

test('거래량 0 인 분도 봉으로 읽는다 — 거래가 없었던 것이지 값이 없는 것이 아니다', () => {
  const { bars, dropped } = parseMinuteBars([rawBar('091500', { cntg_vol: '0' })])
  assert.equal(dropped, 0)
  assert.equal(bars.length, 1)
  assert.equal(bars[0].volume, 0)
})

test('읽을 수 없는 줄은 조용히 빠지지 않고 세어진다', () => {
  const { bars, dropped } = parseMinuteBars([
    rawBar('091500'),
    { stck_bsop_date: '20260926', stck_cntg_hour: '', futs_prpr: '1100' },
    { stck_bsop_date: 'oops', stck_cntg_hour: '091700', futs_prpr: '1100' },
  ])
  assert.equal(bars.length, 1)
  assert.equal(dropped, 2, '못 읽은 줄이 결측과 구분되지 않는다')
})

test('서울 시각 문자열이 UTC 로 제대로 바뀐다', () => {
  const at = seoulStampToDate('20260926', '091500')
  assert.equal(at?.toISOString(), '2026-09-26T00:15:00.000Z')
  assert.equal(seoulStampToDate('2026', '0915'), null)
})

test('★ 이어 조회 커서가 반드시 뒤로 간다 — 같은 곳을 다시 물으면 안 끝난다', () => {
  const { bars } = parseMinuteBars([rawBar('091500'), rawBar('091600'), rawBar('091700')])
  const wantFrom = new Date('2026-09-26T00:00:00.000Z') // 서울 09:00
  const cursor = nextMinuteCursor(bars, wantFrom)
  assert.ok(cursor)
  assert.ok(cursor.getTime() < bars[0].startAt.getTime(), '커서가 앞으로 안 갔다 — 같은 102건을 또 받는다')
  assert.equal(cursor.toISOString(), '2026-09-26T00:14:00.000Z')
})

test('원하는 구간을 다 받았으면 더 안 묻는다', () => {
  const { bars } = parseMinuteBars([rawBar('091500'), rawBar('091600')])
  assert.equal(nextMinuteCursor(bars, new Date('2026-09-26T00:20:00.000Z')), null)
  assert.equal(nextMinuteCursor([], new Date('2026-09-26T00:00:00.000Z')), null)
})

// ── 순차 큐 ──────────────────────────────────────────────

test('★ 동시에 다섯을 불러도 순차로, 최소 간격을 지켜 나간다', async () => {
  let clock = 0
  const slept: number[] = []
  const queue = createRateQueue({
    minIntervalMs: 200,
    now: () => clock,
    sleep: async (ms) => { slept.push(ms); clock += ms },
  })

  const order: number[] = []
  const started: number[] = []
  await Promise.all([1, 2, 3, 4, 5].map((n) => queue.run(async () => {
    started.push(clock)
    order.push(n)
    clock += 10 // 호출 자체에 걸리는 시간
    return n
  })))

  assert.deepEqual(order, [1, 2, 3, 4, 5], '줄 순서가 깨졌다')
  for (let i = 1; i < started.length; i += 1) {
    assert.ok(started[i] - started[i - 1] >= 200,
      `${i}번째가 ${started[i] - started[i - 1]}ms 만에 나갔다 — 한도에 걸린다`)
  }
  assert.equal(slept.length, 4, '첫 호출은 기다리지 않아야 한다')
})

test('앞 호출이 실패해도 줄이 끊기지 않는다', async () => {
  let clock = 0
  const queue = createRateQueue({ minIntervalMs: 0, now: () => clock, sleep: async () => {} })
  const failed = queue.run(async () => { throw new Error('boom') })
  await assert.rejects(failed)
  assert.equal(await queue.run(async () => 'ok'), 'ok', '실패 하나가 뒤의 조회를 전부 막았다')
})

// ── 파일 전체를 훑는 가드 ────────────────────────────────

test('★ broker 폴더 어디에도 주문 TR·주문 경로가 없다', () => {
  // 1-C 부터 계좌 조회가 같은 `/trading/` 아래로 들어온다. 경로를 통째로 막으면 조회까지 막히므로
  // 주문 경로 이름만 막고, TR 은 **끝 글자**로 가른다 — 조회 R, 주문 U.
  // 앞 네 글자로 가르면 TTTO5201R(조회)을 막고 STTN1101U(야간 주문)를 놓친다
  const banned = [
    /\/uapi\/domestic-futureoption\/v1\/trading\/(ngt-)?order(-rvsecncl)?(?![a-z-])/,
    /\b[A-Z]{4}\d{4}U\b/,
  ]
  // broker 폴더에는 여전히 주문이 0건이다. 주문은 lib/trading/order 에만 산다
  for (const name of readdirSync(HERE)) {
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue
    const src = readFileSync(join(HERE, name), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
    for (const pattern of banned) {
      assert.equal(pattern.test(src), false, `${name} 에 주문 흔적이 있다: ${pattern}`)
    }
  }
})
