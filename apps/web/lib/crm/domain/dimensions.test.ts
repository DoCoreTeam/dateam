// lib/crm/domain/dimensions.test.ts — 「대상을 코드에 나열하지 않는다」 가드 (P-1)
//
// **이 가드가 이 판의 핵심 규칙을 지킨다.** 사용자 지시(2026-09-09):
// *"우리가 가진 데이터 기준으로 뭔가 하드코딩으로 대상을 정의하지 않도록
//  나는 정책화 하고 있으니깐 그걸 정확히 반영해 확장성 있게"*
//
// 축에 「공공」·「B2B」 같은 값을 적는 순간, 새 파이프라인을 만들어도 축이 안 늘고
// 배포를 해야 는다. 사업 유형이 enum 여덟이라 「유지보수」를 「기타」로 적을 수밖에
// 없었던 것과 똑같은 사고가 축에서 반복된다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DIMENSIONS, dimensionOf, isKnownDimension, dimensionCatalog,
  isHiddenPipelineName, companyKindLabel, isThin, DIMENSION_THIN_RATIO,
} from './dimensions.ts'

test('축 키가 겹치지 않는다', () => {
  const keys = DIMENSIONS.map((d) => d.key)
  assert.equal(new Set(keys).size, keys.length)
})

test('모든 축에 이름·뜻·빈 줄 이름이 있다', () => {
  for (const d of DIMENSIONS) {
    assert.ok(d.label.length > 0, `${d.key} 에 이름이 없다`)
    assert.ok(d.hint.length > 0, `${d.key} 에 뜻이 없다`)
    assert.ok(d.emptyLabel.length > 0, `${d.key} 에 빈 줄 이름이 없다 — 숨기면 합이 안 맞는다`)
  }
})

/**
 * P-1 가드 — **일부러 깨서 확인한 것이 이 검사다.**
 *
 * 축 선언에 값이 하나라도 들어오면 실패한다. 기관 종류처럼 «도메인 규칙이 말해 주는
 * 사실»은 `company-kind.ts` 에 있고, 여기서는 그 이름을 함수로 받아 온다.
 */
test('축 선언에 값 목록이 없다 — 값은 데이터에서 온다', () => {
  const src = readFileSync(new URL('./dimensions.ts', import.meta.url), 'utf8')
  // 주석은 설명이라 봐준다. 코드에 있는지만 본다
  const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const banned = [
    'B2B', 'B2G', 'B2C',
    '공공', '대학', '해외', '파트너', '엔터프라이즈',
    'GPU 인프라', 'KDC', 'MSP',
    '제조', '금융', '유통', '의료',
    '서울', '경기', '부산',
  ]
  for (const v of banned) {
    assert.ok(!body.includes(v), `축 선언에 값 「${v}」이 박혀 있다 — 그 값은 데이터에서 와야 한다(P-1)`)
  }
})

test('축이 실제로 이어진 경로만 쓴다', () => {
  const ok = new Set([
    'deal.stage', 'deal.pipeline', 'deal.businessType', 'deal.owner',
    'company', 'company.industry', 'company.region', 'company.employeeRange', 'company.kind',
  ])
  for (const d of DIMENSIONS) {
    assert.ok(ok.has(d.source), `${d.key} 의 경로 ${d.source} 가 목록에 없다`)
  }
})

test('id 로 저장되는 축은 이름을 따로 읽는다 — 축에 영문 키가 찍히면 안 된다', () => {
  for (const key of ['stage', 'pipeline', 'businessType', 'owner', 'company']) {
    const d = dimensionOf(key)
    assert.ok(d, `${key} 축이 없다`)
    assert.equal(d?.needsLookup, true, `${key} 는 id 로 저장되는데 이름을 안 읽는다`)
  }
  for (const key of ['industry', 'region', 'employeeRange', 'companyKind']) {
    assert.equal(dimensionOf(key)?.needsLookup, false, `${key} 는 값이 곧 이름이라 조회가 필요 없다`)
  }
})

test('모르는 축은 막는다 — AI 도우미의 안전선', () => {
  assert.equal(isKnownDimension('pipeline'), true)
  assert.equal(isKnownDimension('고객군'), false, '없는 축을 통과시키면 엉뚱한 표가 나온다')
  assert.equal(isKnownDimension(''), false)
  assert.equal(dimensionOf('없는축'), null)
})

test('검증용 파이프라인은 축에서 숨긴다 — 지우지는 않는다', () => {
  assert.equal(isHiddenPipelineName('__검증 파이프라인2'), true)
  assert.equal(isHiddenPipelineName('__화면검증'), true)
  assert.equal(isHiddenPipelineName('공공'), false)
  assert.equal(isHiddenPipelineName('_한개'), false, '밑줄 하나는 숨기지 않는다')
})

test('기관 종류 이름을 축이 읽어 온다 — 여기서 다시 적지 않는다', () => {
  assert.equal(companyKindLabel('school'), '학교')
  assert.equal(companyKindLabel('company'), '기업')
  assert.equal(companyKindLabel(null), null)
  assert.equal(companyKindLabel('없는종류'), null, '모르는 값에 이름을 지어내지 않는다')
})

test('채움이 얇은 축을 판정한다 — 숨기지는 않고 먼저 말한다', () => {
  assert.equal(isThin(2, 381), true, '381곳 중 2곳이면 얇다')
  assert.equal(isThin(8, 8), false, '다 채워졌으면 얇지 않다')
  assert.equal(isThin(0, 0), false, '대상이 없으면 얇다고 하지 않는다')
  assert.ok(DIMENSION_THIN_RATIO > 0 && DIMENSION_THIN_RATIO < 1)
})

test('목록 함수가 이름과 뜻을 준다 — 도우미가 이걸 읽고 고른다', () => {
  const cat = dimensionCatalog()
  assert.equal(cat.length, DIMENSIONS.length)
  assert.ok(cat.every((c) => c.label && c.hint))
})

test('축 선언은 순수하다 — DB 를 모른다', () => {
  const src = readFileSync(new URL('./dimensions.ts', import.meta.url), 'utf8')
  for (const banned of ['@prisma/client', 'db/client', 'getCrmDb', 'findMany']) {
    assert.ok(!src.includes(banned), `축 선언이 ${banned} 를 안다 — 화면에서 못 읽게 된다`)
  }
})
