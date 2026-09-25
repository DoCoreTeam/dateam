/**
 * 세션 줄을 **없으면 세우는가**, 있으면 **안 건드리는가**
 *
 * 실측 2026-09-26: 세션 캘린더를 채우는 함수는 있었는데 아무도 안 불렀다.
 * 캘린더가 영원히 비었고 크론은 매분 「세션 정보가 없어 건너뜁니다」로 끝났다 —
 * 봉이 한 줄도 안 쌓이는데 오류는 한 건도 안 났다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decideEnsureSession } from './seed-window.ts'
import { buildRegularSession, sameDayExitAt } from './session.ts'
import { contractsOf, parseIndexFutureMaster } from '../contracts/contract-rules.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const EXPIRY = new Set(['2026-09-10', '2026-10-08'])

test('★ 줄이 없으면 세운다 — 이것이 없어서 봉이 한 줄도 안 쌓였다', () => {
  const action = decideEnsureSession({
    tradeDate: '2026-09-25', exists: false, isWeekend: false, lastTradingDays: EXPIRY,
  })
  assert.equal(action.kind, 'create')
  assert.equal(action.kind === 'create' && action.isExpiryDay, false)
})

test('★ 이미 있는 줄은 절대 안 건드린다 — 관리자가 고친 개장 시간이 되돌아가면 그날이 통째로 어긋난다', () => {
  for (const isWeekend of [false, true]) {
    const action = decideEnsureSession({
      tradeDate: '2026-09-25', exists: true, isWeekend, lastTradingDays: EXPIRY,
    })
    assert.equal(action.kind, 'use', '있는 줄을 덮으려 한다')
  }
})

test('주말은 안 세운다 — 단, 관리자가 세워 뒀으면 그 판단을 존중한다', () => {
  const weekend = decideEnsureSession({
    tradeDate: '2026-09-26', exists: false, isWeekend: true, lastTradingDays: EXPIRY,
  })
  assert.equal(weekend.kind, 'skip')
  assert.equal(weekend.kind === 'skip' && weekend.reason, 'weekend')
})

test('★ 만기일이면 만기일 창으로 세운다 — 월물 최종거래일이 여기까지 흘러와야 한다', () => {
  const action = decideEnsureSession({
    tradeDate: '2026-09-10', exists: false, isWeekend: false, lastTradingDays: EXPIRY,
  })
  assert.equal(action.kind, 'create')
  assert.equal(action.kind === 'create' && action.isExpiryDay, true)

  // 그 값으로 실제 창을 세우면 접속매매가 15:20 에 끝나고 청산은 15:05 가 된다
  const window = buildRegularSession({ tradeDate: '2026-09-10', isExpiryDay: true })
  const hhmm = (d: Date) => new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d)
  assert.equal(hhmm(window.continuousEnd), '15:20')
  assert.equal(hhmm(sameDayExitAt(window, 15)), '15:05')
})

test('★ 월물이 최종거래일을 들고 온다 — 두 곳에서 따로 계산하면 언젠가 갈린다', () => {
  // 실제 마스터에서 옮긴 줄 (2026-09-26 실측)
  const { rows } = parseIndexFutureMaster([
    '1|A01612|KR4A016C0004|F 202612| |00000.00|1|2001|KOSPI200',
    'B|A05610|KR4A056A0007|미니F 202610| |00000.00|1|2001|KOSPI200',
  ].join('\n'))

  const regular = contractsOf(rows, 'KOSPI200')
  assert.equal(regular[0].lastTradingDay, '2026-12-10', '2026년 12월 둘째 목요일')

  const mini = contractsOf(rows, 'MINI_KOSPI200')
  assert.equal(mini[0].lastTradingDay, '2026-10-08', '2026년 10월 둘째 목요일')

  // 휴장일을 주면 앞당겨진 값이 그대로 실린다
  const shifted = contractsOf(rows, 'MINI_KOSPI200', new Set(['2026-10-08']))
  assert.equal(shifted[0].lastTradingDay, '2026-10-07')
})

test('★ 크론이 세션 줄을 세우는 길을 실제로 부른다 — 만들어만 두지 않는다', () => {
  const tick = readFileSync(join(HERE, '..', 'jobs', 'tick.ts'), 'utf8')
  assert.match(tick, /ensureSessionWindow\(/, '크론이 세션을 마련하지 않는다 — 캘린더가 영원히 빈다')
  assert.doesNotMatch(tick, /no_session_row/, '아직도 「세션 없음」으로 끝내는 길이 남아 있다')

  // 월물을 먼저 알아야 만기일 여부가 세션 시각에 반영된다
  const contractAt = tick.indexOf('syncContracts(')
  const sessionAt = tick.indexOf('ensureSessionWindow(')
  assert.ok(contractAt > 0 && sessionAt > contractAt,
    '세션을 월물보다 먼저 세운다 — 만기일마다 15분 늦은 창이 선다')
})

test('★ 종목정보 마스터를 매분 받지 않는다 — 하루 1,440번은 남의 서버에 할 짓이 아니다', () => {
  const tick = readFileSync(join(HERE, '..', 'jobs', 'tick.ts'), 'utf8')
  assert.match(tick, /loadDayConfig\(/, '그날 굳혀 둔 값을 안 읽는다')
  assert.match(tick, /freezeDayConfig\(/, '굳히지 않으면 다음 실행도 또 받는다')

  // 굳은 값이 있으면 syncContracts 를 안 부르는 구조여야 한다 —
  // 조건 없이 부르면 굳혀 둔 의미가 없다
  const body = tick.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const frozenBranch = body.indexOf('if (frozen)')
  const syncCall = body.indexOf('syncContracts({')
  assert.ok(frozenBranch > 0 && syncCall > frozenBranch,
    'syncContracts 가 굳음 여부와 무관하게 불린다 — 마스터를 매분 받게 된다')
})

test('★ 굳은 값을 덮지 않는다 — 장중 배포가 그날 기준을 조용히 갈아치우면 안 된다', () => {
  const src = readFileSync(join(HERE, '..', 'jobs', 'day-config.ts'), 'utf8')
  assert.doesNotMatch(src, /\.upsert\(/, 'upsert 는 이미 굳은 값을 덮는다')
  assert.match(src, /logicChangedToday/, '로직이 바뀐 사실을 말해 주는 길이 없다')
})
