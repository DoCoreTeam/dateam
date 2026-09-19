import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  readApiError, readApiErrorCode, describeFetchFailure,
  readResponse, describeHttpFailure,
} from './read-error.ts'

test('서버가 준 이유를 그대로 쓴다 — 뭉개면 사용자는 같은 값을 다시 넣는다', () => {
  assert.equal(readApiError({ error: { message: '현물이 사업비를 넘습니다' } }, '실패'), '현물이 사업비를 넘습니다')
})

test('옛 라우트의 평평한 모양도 받는다', () => {
  assert.equal(readApiError({ message: '평평함' }, '실패'), '평평함')
})

test('이유가 없으면 준비된 말로', () => {
  for (const body of [null, undefined, {}, { error: {} }, { error: { message: '  ' } }, 'text'])
    assert.equal(readApiError(body, '견적서를 불러오지 못했습니다.'), '견적서를 불러오지 못했습니다.')
})

test('코드는 따로 읽는다 — 기계는 코드를, 사람은 문장을', () => {
  assert.equal(readApiErrorCode({ error: { code: 'DUPLICATE' } }), 'DUPLICATE')
  assert.equal(readApiErrorCode({}), null)
})

test('연결 실패는 «잠시 후 다시»라고 하지 않는다 — 다시 눌러도 똑같이 실패한다', () => {
  const msg = describeFetchFailure('딜')
  assert.match(msg, /서버에 연결하지 못해/)
  assert.match(msg, /관리자에게/)
  assert.ok(!msg.includes('잠시 후 다시 시도해 주세요.'), '서버 오류와 같은 말을 하고 있다')
})

test('받침에 따라 을/를 — 화면이 「딜을(를)」이라고 말하지 않게', () => {
  assert.match(describeFetchFailure('딜'), /딜을 /)
  assert.match(describeFetchFailure('견적서'), /견적서를 /)
  assert.match(describeFetchFailure('API'), /API을\(를\) /)
})

/* ── 응답을 끝까지 읽는다 — 본문이 JSON 이 아닐 수도 있다 ── */

const MODAL = readFileSync(
  new URL('../../../components/ui/crm/QuoteFromFileModal.tsx', import.meta.url), 'utf8')
const FILL = readFileSync(
  new URL('../../../components/ui/crm/QuoteFillPanel.tsx', import.meta.url), 'utf8')

test('★ 상태마다 다른 말을 한다 — 「읽지 못했습니다」 한 마디로 뭉개지 않는다', () => {
  const fallback = '견적서를 읽지 못했습니다.'
  const said = [401, 413, 429, 504, 503].map((s) => describeHttpFailure(s, fallback))
  assert.equal(new Set(said).size, said.length, `같은 말을 하는 상태가 있다: ${said.join(' / ')}`)
  for (const s of said) assert.notEqual(s, fallback, '준비된 말로 되돌아갔다')

  // 할 일이 다르면 문장도 달라야 한다
  assert.match(describeHttpFailure(413, fallback), /나눠|작은/, '파일이 큰 상황을 안 말한다')
  assert.match(describeHttpFailure(504, fallback), /오래|끊/, '시간이 걸린 상황을 안 말한다')
  assert.match(describeHttpFailure(401, fallback), /로그인|권한/, '로그인이 풀린 상황을 안 말한다')
  assert.match(describeHttpFailure(500, fallback), /500/, '알 수 없는 서버 오류의 번호를 안 남긴다')
})

test('★ 본문이 HTML 이어도 예외가 안 난다 — 그 줄에서 죽으면 catch 가 다 같은 말을 한다', async () => {
  const res = new Response('<!doctype html><title>Gateway Timeout</title>', { status: 504 })
  const got = await readResponse(res, '견적서를 읽지 못했습니다.')
  assert.equal(got.ok, false)
  assert.equal(got.body, null)
  assert.match(got.message ?? '', /오래|끊/)
})

test('★ 서버가 이유를 줬으면 그 이유가 먼저다 — AI 한도 문장이 화면까지 간다', async () => {
  const quota = { error: { code: 'PROVIDER_QUOTA', message: 'AI 사용량 한도를 초과했어요. 잠시 뒤 다시 시도해 주세요.' } }
  const res = new Response(JSON.stringify(quota), { status: 429 })
  const got = await readResponse(res, '견적서를 읽지 못했습니다.')
  assert.equal(got.message, quota.error.message, '서버가 준 한도 문장을 우리 말로 덮었다')
  assert.equal(got.status, 429)
})

test('성공하면 본문을 그대로 준다 — 빈 본문도 예외가 아니다', async () => {
  const ok = await readResponse(new Response(JSON.stringify({ quotes: [1] }), { status: 200 }), 'x')
  assert.equal(ok.ok, true)
  assert.equal(ok.message, null)
  assert.deepEqual(ok.body, { quotes: [1] })

  // 본문 없는 200 — JSON.parse 가 던지는 자리다
  const empty = await readResponse(new Response('', { status: 200 }), 'x')
  assert.equal(empty.ok, true)
  assert.equal(empty.body, null)
})

/* ── 두 화면이 같은 것을 쓴다 ─────────────────────── */

test('★ 파일을 읽는 두 화면이 같은 읽기를 쓴다 — 한쪽만 고치면 말이 갈린다', () => {
  for (const [name, src] of [['가져오기 창', MODAL], ['채우기 패널', FILL]] as const) {
    assert.match(src, /readResponse\(/, `${name} 이 공용 읽기를 안 쓴다`)
    assert.ok(!/await res\.json\(\)/.test(src), `${name} 이 응답을 직접 푼다 — JSON 이 아니면 그 줄에서 죽는다`)
    assert.match(src, /describeFetchFailure\(/, `${name} 이 연결 실패를 서버 오류와 같은 말로 덮는다`)
  }
})

test('★ 한 건이 실패해도 나머지는 간다 — 그리고 건수와 사유를 남긴다', () => {
  assert.match(MODAL, /fails\.push\(/, '실패한 건을 모으지 않는다')
  assert.match(MODAL, /importFailedLine\(/, '안 된 건을 사람에게 안 말한다')
  assert.match(MODAL, /if \(made \+ appended \+ costed === 0\)/,
    '하나도 안 됐는데 창을 닫으면 고른 것이 전부 사라진다')
  // 성공분은 목록에 반영돼야 한다 — 닫으면서 알린다
  assert.match(MODAL, /onDone\(`\$\{importMixedLine\(/, '된 것과 안 된 것을 함께 말하지 않는다')
})

test('★ 두 번 눌러도 한 벌만 — 그리기보다 먼저 잠긴다', () => {
  assert.match(MODAL, /if \(sending\.current\) return/, '두 번째 클릭이 그대로 지나간다')
  assert.match(MODAL, /sending\.current = true/)
  assert.match(MODAL, /sending\.current = false/, '잠그고 안 푼다 — 한 번 실패하면 영영 못 보낸다')
})
