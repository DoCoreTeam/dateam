/**
 * 형성 중인 봉을 움직이는 길의 보안·동시성·화면 배선을 함께 잠근다.
 * 어느 한 층만 나머지면 가격은 받아도 봉이 안 움직이거나, 탭 수만큼 KIS 호출이 부풀어 오른다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROUTE = readFileSync(join(HERE, '../../app/api/trading/price/stream/route.ts'), 'utf8')
const SERVICE = readFileSync(join(HERE, '../trading/bars/live-price.ts'), 'utf8')
const CLIENT = readFileSync(join(HERE, '../trading/broker/kis-client.ts'), 'utf8')
const TOKEN = readFileSync(join(HERE, '../trading/broker/token.ts'), 'utf8')
const HOOK = readFileSync(join(HERE, '../../app/(trading)/trading/useLivePrice.ts'), 'utf8')
const PANEL = readFileSync(join(HERE, '../../app/(trading)/trading/ChartPanel.tsx'), 'utf8')
const CSS = readFileSync(join(HERE, '../../app/(trading)/trading/ChartPanel.module.css'), 'utf8')

function assertAuthenticatedRoute(source: string): void {
  assert.match(source, /await requireMemberApi\(\)/, '임직원 인증을 실제로 기다리지 않는다')
  assert.match(source, /await tradingAccess\(\)/, '트레이딩 소유자 권한을 실제로 기다리지 않는다')
}

test('★ SSE 창구는 회원과 트레이딩 소유자 문을 둘 다 지난다 (S2)', () => {
  assertAuthenticatedRoute(ROUTE)
  assert.match(ROUTE, /await readLivePrice\(context, now, runId\)/)
})

test('★ 동시 탭은 원자적 분산 슬롯을 이긴 하나만 KIS 를 부른다', () => {
  assert.match(SERVICE, /await admin\.rpc\('record_public_hit'/, '원자적 슬롯이 아니다')
  assert.match(SERVICE, /if \(error\)[\s\S]*return false/, 'DB 장애 때 외부 호출을 닫지 않는다')
  const claimAt = SERVICE.indexOf('await claimLivePriceSlot(context)')
  const brokerAt = SERVICE.indexOf('await kis.price(context.contractCode)')
  assert.ok(claimAt >= 0 && brokerAt > claimAt, '슬롯을 선점하기 전에 KIS 를 부른다')
})

test('★ 외부 요청과 스트림은 무한히 기다리지 않고 실패를 로그에 남긴다 (B4·B5)', () => {
  assert.match(CLIENT, /signal: AbortSignal\.timeout\(requestTimeoutMs\)/)
  assert.match(TOKEN, /signal: AbortSignal\.timeout\(10_000\)/)
  assert.match(SERVICE, /requestTimeoutMs: 5_000/)
  assert.match(ROUTE, /export const maxDuration = 60/)
  assert.match(ROUTE, /STREAM_LIFETIME_MS = 50_000/)
  assert.match(ROUTE, /await recordSystemEvent\(/)
  assert.match(ROUTE, /'Cache-Control': 'no-cache, no-transform'/)
})

test('★ 숨은 탭은 연결을 닫고 보이면 다시 연다', () => {
  assert.match(HOOK, /document\.hidden/)
  assert.match(HOOK, /new EventSource\('\/api\/trading\/price\/stream'\)/)
  assert.match(HOOK, /source\?\.close\(\)/)
  assert.match(HOOK, /addEventListener\('visibilitychange', onVisibility\)/)
  assert.match(HOOK, /removeEventListener\('visibilitychange', onVisibility\)/)
})

test('★ 받은 가격은 현재가·형성 봉·주문 판정 세 곳에 같이 쓰인다', () => {
  assert.match(PANEL, /nowPriceLine\(livePrice/)
  assert.match(PANEL, /buildDisplayBars\([\s\S]*livePrice/)
  assert.match(PANEL, /<OrderBlock[\s\S]*nowPrice=\{livePrice/)
})

test('★ 첫 가격이 없어도 연결 재시도를 사람에게 말한다', () => {
  const missingAt = PANEL.indexOf(': <span className={styles.nowPriceMissing}>')
  const retryAt = PANEL.indexOf("livePrice.connection === 'retrying'")
  assert.ok(missingAt >= 0 && retryAt > missingAt, '가격이 있는 분기 안에만 실패 표시가 있다')
})

test('★ 지난 계획은 색만이 아닌 점선으로, 390px 폭은 한 열로 구분한다', () => {
  const past = CSS.slice(CSS.indexOf('.planPast'), CSS.indexOf('@media screen and (max-width: 560px)'))
  assert.match(past, /border[^;]*dashed/)
  assert.doesNotMatch(past, /opacity\s*:/, '지난 계획의 글자까지 흐려진다')
  assert.match(CSS, /@media screen and \(max-width: 560px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\)/)
})

test('★ 가드를 실제로 깨 본다 — 인증 await 제거와 투명도 회귀를 잡는다 (S6)', () => {
  const noAwait = ROUTE.replace('await requireMemberApi()', 'requireMemberApi()')
  assert.throws(() => assertAuthenticatedRoute(noAwait), /인증/)

  const badCss = '.planPast { border-style: dashed; opacity: 0.45; }\n@media screen and (max-width: 560px) {}'
  const past = badCss.slice(badCss.indexOf('.planPast'), badCss.indexOf('@media screen'))
  assert.throws(() => assert.doesNotMatch(past, /opacity\s*:/), /match/)
})
