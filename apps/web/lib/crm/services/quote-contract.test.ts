// 견적 목록·생성 계약 가드
//
// **왜 이 파일이 생겼나**: G3 실사용 검증(v0.7.556)에서 관찰 2건이 나왔다.
// 둘 다 "틀린 요청·틀린 조합이 **성공처럼 보인다**"는 같은 성격이다.
//
//   ① '보냄' 필터와 '기한 지남' 필터가 **같은 견적을 둘 다** 돌려줬다.
//      목록의 배지는 '기한 지남'인데 그걸 뽑아낸 필터는 '보냄'이었다 — 화면이 자기 말을 뒤집는다.
//   ② `unitPriceMinor` 를 `unitPrice` 로 한 글자 틀리면 단가가 0 으로 들어가고 **200** 이 떨어졌다.
//      0원 견적이 아무 말 없이 생긴다(G3 가 본인 입력 오류로 겪었다).
//
// 그리고 ①을 고치다 **더 조용한 것**을 하나 더 찾았다 — 상태 필터가 쓰는 `where.OR` 를
// 검색어가 그대로 덮어써서, "보냄 + 검색어"가 조용히 "검색어만"이 되고 있었다.
// 필터를 걸었는데 안 걸린 결과가 나오는 것이라 사용자는 알아챌 방법이 없다.
//
// 서비스는 DB 가 있어야 돌아가므로 여기서는 **소스를 읽어** 계약이 살아 있는지 본다.
// (실동작은 :3120 실브라우저에서 확인했다 — 보냄 1건 / 기한 지남 1건 / 겹침 0)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  QUOTE_STATUS_META, QUOTE_STATUS_ORDER, quoteStatusKey, quoteStatusMeta,
} from '../ui/quote-status.ts'

const SRC = readFileSync(new URL('./quote.ts', import.meta.url), 'utf8')
const LIST = SRC.slice(SRC.indexOf('export async function listQuotes'))

test('★ 모르는 필드는 거절한다 — unitPrice 오타가 0원 견적을 200 으로 만들었다', () => {
  /**
   * **정의가 아니라 호출을 센다.**
   * 처음엔 `SRC.includes('rejectUnknownKeys')` 로 봤는데, 호출을 전부 지워도
   * 함수 정의가 남아 있어 **가드가 통과했다**(일부러 깨서 확인하다 잡았다).
   * 쓰이지 않는 방어는 없는 방어다.
   */
  const calls = SRC.match(/rejectUnknownKeys\(/g) ?? []
  assert.ok(calls.length >= 3, `호출이 ${calls.length}곳뿐이다 — 정의 1 + 항목·견적 호출 2 이상이어야 한다`)
  assert.ok(/rejectUnknownKeys\(line, LINE_KEYS/.test(SRC), '항목에서 안 부른다')
  assert.ok(/rejectUnknownKeys\(input, QUOTE_KEYS/.test(SRC), '견적에서 안 부른다')
  // 진짜 쓰는 이름이 화이트리스트에 빠지면 정상 요청이 막힌다 — 그게 더 큰 사고다
  for (const key of ['unitPriceMinor', 'discountPercent', 'taxRate', 'quantity', 'name']) {
    assert.ok(SRC.includes(`'${key}'`), `항목 필드 ${key} 가 화이트리스트에 없다`)
  }
})

test('★ 0원 항목 자체는 막지 않는다 — 무상 제공은 정당하다. 막는 것은 오타다', () => {
  // toMinor 가 빈 값을 0 으로 두는 동작은 그대로여야 한다
  assert.ok(SRC.includes("if (v === null || v === undefined || v === '') return BigInt(0)"),
    '0원을 막아 버렸다 — 무상 제공 항목을 쓸 수 없게 된다')
})

test("★ '보냄'과 '기한 지남'은 겹치지 않는다 — 배지와 필터가 다른 말을 했다", () => {
  assert.ok(LIST.includes("status === 'SENT'"), "'보냄' 을 따로 다루지 않는다")
  assert.ok(LIST.includes("status === 'EXPIRED'"), "'기한 지남' 을 따로 다루지 않는다")
  // 보냄에서 기한 지난 것을 빼지 않으면 두 필터가 다시 겹친다
  assert.ok(LIST.includes('where.NOT'), "'보냄' 에서 기한 지난 것을 빼지 않는다")
  // 옛 코드: SENT 를 그냥 통과시켰다
  assert.ok(
    !/if \(status && status !== 'EXPIRED'\) where\.status = status/.test(LIST),
    "'보냄' 이 기한 지난 것까지 그대로 돌려준다",
  )
})

test('★ 검색어가 상태 조건을 덮어쓰지 않는다 — "보냄+검색"이 조용히 "검색만"이 됐다', () => {
  // 상태도 검색도 OR 를 쓴다. 같은 키에 두 번 대입하면 뒤엣것만 남는다
  assert.ok(LIST.includes('const search = q'), '검색을 따로 묶지 않는다')
  assert.ok(!/if \(q\) \{\s*where\.OR =/.test(LIST), '검색이 where.OR 를 덮어쓴다')
  assert.ok(LIST.includes('AND: parts'), '상태·검색·커서를 AND 로 합치지 않는다')
})

test('총 건수도 검색 조건을 본다 — 안 그러면 "3건 중 1건"처럼 화면이 어긋난다', () => {
  assert.ok(
    LIST.includes('countIfFirstPage((db as any).crmQuote, search ? { AND: [where, search] } : where'),
    '총 건수가 검색을 빼고 센다',
  )
})

test('상태 표시는 SSOT 하나가 정한다 — 딜 상세와 목록이 같은 말을 쓴다', () => {
  // 기한이 지난 SENT 는 화면에서 '기한 지남'이다(저장된 상태는 SENT 그대로)
  assert.equal(quoteStatusKey({ status: 'SENT', expired: true }), 'EXPIRED')
  assert.equal(quoteStatusKey({ status: 'SENT', expired: false }), 'SENT')
  // 초안은 기한이라는 말이 성립하지 않는다
  assert.equal(quoteStatusKey({ status: 'DRAFT', expired: true }), 'DRAFT')

  assert.equal(quoteStatusMeta({ status: 'SENT', expired: true }).label, '기한 지남')
  assert.equal(quoteStatusMeta({ status: 'ACCEPTED' }).label, '수락')
  // 모르는 상태가 와도 화면이 비지 않는다 — 코드값이라도 보여 준다
  assert.equal(quoteStatusMeta({ status: 'WEIRD' }).label, 'WEIRD')

  for (const s of QUOTE_STATUS_ORDER) {
    assert.ok(QUOTE_STATUS_META[s], `${s} 의 말이 없다 — 필터 선택지가 비어 보인다`)
  }
})
