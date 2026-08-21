/**
 * 회사 웹 보강 가드
 *
 * 이 기능의 안전장치는 둘뿐이다 — **스키마**와 **신뢰도 판정**.
 * 스키마가 새면 "산업: 알 수 없음"이 진짜 산업군처럼 목록에 남고,
 * 신뢰도가 어긋나면 이름만으로 찾은 남의 회사 정보가 **사람 확인 없이 채워진다.**
 * 둘 다 정적 분석으로는 안 보이므로 여기서 잠근다.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCompanyEnrich, ENRICHABLE_FIELDS } from './company-enrich.ts'
import {
  enrichConfidence, CONFIDENCE_BY_DOMAIN, CONFIDENCE_BY_NAME, ENRICH_BULK_MAX,
} from '../../domain/enrich-limits.ts'
import { DEFAULT_MIN_CONFIDENCE, NEVER_AUTO_APPLY_FIELDS } from '../apply-policy.ts'

const FULL = {
  matched: true, matchReason: '도메인 acme.co.kr 운영사 확인',
  domain: 'acme.co.kr', industry: '물류 SaaS', region: '서울',
  employeeRange: '51-200', descriptionMd: '화주와 차주를 잇는 운송 중개 서비스를 운영한다.',
}

test('정상 JSON 을 그대로 통과시킨다', () => {
  const out = parseCompanyEnrich(JSON.stringify(FULL))
  assert.equal(out.matched, true)
  assert.equal(out.industry, '물류 SaaS')
  assert.equal(out.employeeRange, '51-200')
})

test('코드펜스와 앞뒤 산문을 벗긴다 — 웹 검색을 켜면 모델이 설명을 붙인다', () => {
  const noisy = '검색해 보니 다음과 같습니다.\n```json\n' + JSON.stringify(FULL) + '\n```\n출처: 회사 홈페이지'
  const out = parseCompanyEnrich(noisy)
  assert.equal(out.domain, 'acme.co.kr')
})

test('도메인은 호스트만 남긴다 — 경로째 저장되면 중복 판정이 깨진다', () => {
  for (const raw of ['https://www.acme.co.kr/about', 'HTTP://Acme.co.kr', 'www.acme.co.kr/']) {
    const out = parseCompanyEnrich(JSON.stringify({ ...FULL, domain: raw }))
    assert.equal(out.domain, 'acme.co.kr', `입력: ${raw}`)
  }
})

test('도메인이 아닌 말은 null 로 접는다 — "홈페이지없음"이 도메인이 되면 안 된다', () => {
  for (const raw of ['모름', '없음', '홈페이지없음', '-', '']) {
    const out = parseCompanyEnrich(JSON.stringify({ ...FULL, domain: raw }))
    assert.equal(out.domain, null, `입력: ${raw}`)
  }
})

test('"알 수 없음"류는 값이 아니라 null 이다', () => {
  const out = parseCompanyEnrich(JSON.stringify({
    ...FULL, industry: '알 수 없음', region: 'N/A', descriptionMd: '  ',
  }))
  assert.equal(out.industry, null)
  assert.equal(out.region, null)
  assert.equal(out.descriptionMd, null)
})

test('구간 밖 직원 수는 버린다 — 추정을 우리 손으로 확정값으로 만들지 않는다', () => {
  for (const raw of ['약 50명', '50~100', '중소기업', '100', '']) {
    const out = parseCompanyEnrich(JSON.stringify({ ...FULL, employeeRange: raw }))
    assert.equal(out.employeeRange, null, `입력: ${raw}`)
  }
})

test('특정 실패는 그대로 전달된다 — 서비스가 여기서 끊는다', () => {
  const out = parseCompanyEnrich(JSON.stringify({
    matched: false, matchReason: '같은 이름 후보가 셋이라 고르지 못했다',
    domain: null, industry: null, region: null, employeeRange: null, descriptionMd: null,
  }))
  assert.equal(out.matched, false)
  assert.match(out.matchReason ?? '', /고르지 못했다/)
})

test('JSON 이 아니면 통과시키지 않는다 — 러너가 한 번 더 묻는다', () => {
  assert.throws(() => parseCompanyEnrich('회사를 찾지 못했습니다.'))
  assert.throws(() => parseCompanyEnrich('```json\n{ 깨진 }\n```'))
})

test('빠진 필드는 null 이 된다 — 반쯤 읽은 값이 회사에 채워지지 않는다', () => {
  // 모델이 지시를 절반만 지켜 필드를 빠뜨리는 일은 흔하다.
  // 그때 파싱을 실패시키면 멀쩡한 나머지까지 버리게 되고, 값을 지어내면 더 나쁘다.
  // null 로 두면 enrichFromText 가 그 칸을 그냥 건너뛴다 — 아무 일도 일어나지 않는 게 맞다.
  const out = parseCompanyEnrich(JSON.stringify({ matched: true }))
  for (const f of ENRICHABLE_FIELDS) {
    assert.equal(out[f], null, `${f} 가 null 이 아니다`)
  }
})

test('matched 가 없으면 false 다 — 특정했다고 우리가 대신 단정하지 않는다', () => {
  const out = parseCompanyEnrich(JSON.stringify({ industry: '물류 SaaS' }))
  assert.equal(out.matched, false)
})

test('보강 대상 필드에 자동 반영 금지 필드가 섞이지 않는다', () => {
  for (const f of ENRICHABLE_FIELDS) {
    assert.equal(NEVER_AUTO_APPLY_FIELDS.has(f), false, `${f} 는 자동 반영 금지 필드다`)
  }
})

test('도메인으로 찾으면 자동 반영 문턱을 넘고, 이름만이면 못 넘는다', () => {
  // 이 두 줄이 "바로 채움"과 "인박스"를 가른다. 문턱이 움직이면 여기서 깨져야 한다.
  assert.ok(enrichConfidence(true) >= DEFAULT_MIN_CONFIDENCE,
    `도메인 기준(${CONFIDENCE_BY_DOMAIN})이 문턱(${DEFAULT_MIN_CONFIDENCE}) 아래로 내려갔다`)
  assert.ok(enrichConfidence(false) < DEFAULT_MIN_CONFIDENCE,
    `이름 기준(${CONFIDENCE_BY_NAME})이 문턱(${DEFAULT_MIN_CONFIDENCE})을 넘어 사람 확인 없이 채워진다`)
})

test('이름만으로 찾은 값도 저장은 된다 — 문턱보다는 낮고 폐기선(0.6)보다는 높다', () => {
  assert.ok(CONFIDENCE_BY_NAME >= 0.6)
})

test('일괄 상한은 화면과 서버가 같은 수를 본다', () => {
  assert.equal(ENRICH_BULK_MAX, 20)
  assert.ok(ENRICH_BULK_MAX > 0)
})
