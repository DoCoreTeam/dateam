/**
 * 문서 출처 라벨 가드
 *
 * **이 라벨은 알림이지 판정이 아니다.** 여기서 지키는 것 둘:
 *   ① 같은 회사를 다르게 적은 것을 다른 회사로 보지 않는다
 *   ② 라벨이 무엇이든 **기본 도착지는 안 바뀐다**
 *
 * ②가 깨지면 사용자가 고르기 전에 시스템이 정하는 것이 되고,
 * 아닐 때마다 사람이 되돌려야 한다(사용자 지시 2026-09-19).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  judgeQuoteOrigin, isSameCompany, normalizeCompanyName,
  defaultDestination, DEFAULT_DESTINATION,
  type QuoteOrigin,
} from './quote-origin.ts'

const OURS = '주식회사 데이터얼라이언스'

/* ── 라벨 ───────────────────────────────────────── */

test('★ 공급자가 우리 상호면 ours — 우리가 낸 견적서를 다시 올린 경우다', () => {
  assert.equal(judgeQuoteOrigin({
    documentSupplierName: '데이터얼라이언스', ourSupplierName: OURS,
  }), 'ours')
})

test('★ 공급자가 우리가 아니면 received — 받은 문서로 보인다고만 말한다', () => {
  assert.equal(judgeQuoteOrigin({
    documentSupplierName: '지코어', ourSupplierName: OURS,
  }), 'received')
})

test('★ 우리 상호 설정이 비면 unknown — 안 채운 워크스페이스에서 우리 견적이 전부 남의 것이 된다', () => {
  assert.equal(judgeQuoteOrigin({
    documentSupplierName: '지코어', ourSupplierName: '',
  }), 'unknown')
  assert.equal(judgeQuoteOrigin({
    documentSupplierName: '지코어', ourSupplierName: null,
  }), 'unknown')
})

test('문서에 공급자가 없으면 unknown — 견줄 것이 없다', () => {
  assert.equal(judgeQuoteOrigin({
    documentSupplierName: null, ourSupplierName: OURS,
  }), 'unknown')
})

/* ── 같은 회사를 다르게 적은 것 ──────────────────── */

test('★ 법인 표기는 표기일 뿐이다 — (주)·주식회사·㈜ 를 걷어내고 견준다', () => {
  for (const name of ['(주)데이터얼라이언스', '데이터얼라이언스(주)', '㈜ 데이터얼라이언스', '데이터얼라이언스 주식회사']) {
    assert.equal(isSameCompany(name, OURS), true, `${name} 이 다른 회사로 읽힌다`)
  }
})

test('띄어쓰기와 대소문자와 구두점 차이는 같은 이름이다', () => {
  assert.equal(isSameCompany('Data Alliance Co., Ltd.', 'DATA-ALLIANCE'), true)
  assert.equal(isSameCompany('데이터 얼라이언스', '데이터얼라이언스'), true)
})

test('한쪽이 다른 쪽을 품으면 같은 회사로 본다 — 사업본부 이름이 붙어 오는 일이 흔하다', () => {
  assert.equal(isSameCompany('데이터얼라이언스 AX사업본부', OURS), true)
})

test('★ 두 글자 조각으로 같다고 하지 않는다 — 남의 상호에도 흔히 들어 있다', () => {
  assert.equal(isSameCompany('가나', '가나다라마바'), false)
})

test('법인 표기만 남은 값은 이름이 아니다 — 그러면 아무 회사나 우리 회사가 된다', () => {
  assert.equal(normalizeCompanyName('(주)'), '')
  assert.equal(isSameCompany('(주)', '주식회사'), false)
  assert.equal(judgeQuoteOrigin({ documentSupplierName: '(주)', ourSupplierName: OURS }), 'unknown')
})

/* ── 라벨이 아무것도 바꾸지 않는다 ───────────────── */

test('★ 라벨이 무엇이든 기본 도착지는 새 견적이다 — 시스템이 대신 정하지 않는다', () => {
  const labels: QuoteOrigin[] = ['ours', 'received', 'unknown']
  for (const _label of labels) {
    assert.equal(defaultDestination(), 'new_quote')
  }
  assert.equal(DEFAULT_DESTINATION, 'new_quote')
})

test('★ 기본 도착지 함수가 라벨을 받지 않는다 — 인자를 받는 순간 분기가 들어온다', () => {
  assert.equal(defaultDestination.length, 0, '인자가 생겼다. 라벨로 도착지를 정하려는 것이다')
})

test('★ 출처 모듈에 도착지 분기가 없다 — 「받은 문서면 원가로」가 코드에 들어오면 깨진다', () => {
  const src = readFileSync(new URL('./quote-origin.ts', import.meta.url), 'utf-8')
  const body = src.slice(src.indexOf('export function defaultDestination'))
  assert.ok(
    !/'cost'|'append'|'skip'/.test(body),
    '기본 도착지 아래에서 다른 도착지를 고르고 있다',
  )
})
