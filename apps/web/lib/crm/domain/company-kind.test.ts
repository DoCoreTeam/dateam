// lib/crm/domain/company-kind.test.ts — 규칙이 공짜로 답하는 자리 가드
//
// **왜 이 가드가 필요한가**: 회사 보강 37건이 전부 할당량 초과로 실패했다(마지막 2026-08-24).
// 그중 상당수는 **AI 를 부를 이유가 없던 것**이다 — `ac.kr` 이 학교라는 건 규칙이다.
// 이 판정이 틀리면 다시 AI 에 기대게 되고, 그러면 한도에 다시 막힌다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { kindFromDomain, countRuleAnswerable, COMPANY_KIND_LABEL } from './company-kind.ts'
import { readFileSync } from 'node:fs'

/** 실측 앵커 — 운영 DB 의 실제 도메인(2026-09-09). 화면에서 본 값과 같아야 한다 */
test('실측 도메인이 규칙으로 판정된다', () => {
  assert.equal(kindFromDomain('sookmyung.ac.kr')?.kind, 'school')
  assert.equal(kindFromDomain('kicox.or.kr')?.kind, 'public')
  assert.equal(kindFromDomain('konai.com')?.kind, 'company')
})

test('긴 꼬리를 먼저 본다 — ac.kr 이 kr 로 먹히면 학교가 전부 기업이 된다', () => {
  const g = kindFromDomain('snu.ac.kr')
  assert.equal(g?.kind, 'school', 'ac.kr 이 .kr 보다 먼저 걸려야 한다')
  assert.equal(g?.confident, true)
})

test('꼬리가 뜻을 보장하는 것만 confident 다', () => {
  assert.equal(kindFromDomain('acme.co.kr')?.confident, true, 'co.kr 은 법인만 받는다')
  assert.equal(kindFromDomain('acme.com')?.confident, false, 'com 은 누구나 받는다')
  assert.equal(kindFromDomain('acme.org')?.kind, 'nonprofit')
  assert.equal(kindFromDomain('acme.org')?.confident, false)
})

test('모르면 null — 「기타」로 접지 않는다', () => {
  assert.equal(kindFromDomain(null), null)
  assert.equal(kindFromDomain(''), null)
  assert.equal(kindFromDomain('   '), null)
  assert.equal(kindFromDomain('점없음'), null, '점이 없으면 도메인이 아니다')
  assert.equal(kindFromDomain('acme.xyz'), null, '모르는 꼬리는 값을 만들지 않는다')
})

test('앞에 붙은 것을 떼고 본다 — 모델이 주소를 통째로 주는 일이 흔하다', () => {
  assert.equal(kindFromDomain('https://www.sookmyung.ac.kr/about')?.kind, 'school')
  assert.equal(kindFromDomain('WWW.KICOX.OR.KR')?.kind, 'public')
})

test('세는 함수가 셋을 나눈다 — AI 없이 어디까지 되는지 먼저 보여주려고 있다', () => {
  const got = countRuleAnswerable([
    { domain: 'a.ac.kr' }, { domain: 'b.go.kr' }, { domain: 'c.co.kr' }, // 확신 3
    { domain: 'd.com' }, { domain: 'e.org' },                             // 추정 2
    { domain: null }, { domain: 'f.xyz' },                                // 모름 2
  ])
  assert.deepEqual(got, { confident: 3, weak: 2, unknown: 2 })
})

test('모든 종류에 이름이 있다 — 축에 영문 키가 찍히면 안 된다', () => {
  for (const [key, label] of Object.entries(COMPANY_KIND_LABEL)) {
    assert.ok(label.length > 0, `${key} 에 이름이 없다`)
    assert.ok(!/^[a-z_]+$/.test(label), `${key} 의 이름이 영문 키 그대로다`)
  }
})

/**
 * P-1 가드 — 이 파일에 «영업 구분»이 들어오면 막는다.
 *
 * 기관 종류는 **도메인 규칙이 말해 주는 사실**이라 코드에 있어도 된다.
 * 그런데 여기에 「B2B」·「B2G」 같은 **우리가 정하는 구분**을 적기 시작하면
 * 그 순간 P-1(대상을 코드에 나열하지 않는다)을 어긴 것이다 — 그건 데이터에서 와야 한다.
 */
test('영업 구분을 코드에 적지 않는다', () => {
  const src = readFileSync(new URL('./company-kind.ts', import.meta.url), 'utf8')
  const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const banned of ['B2B', 'B2G', 'B2C', '엔터프라이즈']) {
    assert.ok(!body.includes(banned), `영업 구분 「${banned}」이 코드에 있다 — 그건 데이터에서 와야 한다`)
  }
})
