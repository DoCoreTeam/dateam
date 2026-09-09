// lib/crm/domain/domain-guess.test.ts — 「AI 를 안 불러도 되는 것」 가드
//
// **막는 것**: 모델이 필요 없는 사실까지 모델에 맡겨 할당량에 죽는 일.
// 회사 보강 37건이 전부 할당량 초과로 실패했는데(마지막 2026-08-24),
// 상당수는 그 회사 사람의 이메일 호스트가 곧 도메인인 경우였다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hostOfEmail, isPublicMailHost, guessCompanyDomain, countFillable } from './domain-guess.ts'
import { kindFromDomain } from './company-kind.ts'

test('이메일에서 호스트를 읽는다 — 못 읽으면 null', () => {
  assert.equal(hostOfEmail('hunkim@upstage.ai'), 'upstage.ai')
  assert.equal(hostOfEmail('  CMHS@Korea.KR  '), 'korea.kr')
  assert.equal(hostOfEmail('골뱅이없음'), null)
  assert.equal(hostOfEmail('@only.com'), null)
  assert.equal(hostOfEmail('a@'), null)
  assert.equal(hostOfEmail('a@점없음'), null, '점이 없으면 도메인이 아니다')
  assert.equal(hostOfEmail(null), null)
})

test('★ 공개 메일은 회사 도메인이 아니다', () => {
  assert.equal(isPublicMailHost('gmail.com'), true)
  assert.equal(isPublicMailHost('NAVER.COM'), true)
  assert.equal(isPublicMailHost('upstage.ai'), false)
  assert.equal(guessCompanyDomain(['a@gmail.com', 'b@naver.com']), null,
    '공개 메일만 있으면 아무것도 모른다 — 지어내지 않는다')
})

test('★ 실측 이메일에서 도메인을 뽑는다 (운영 DB 2026-09-09)', () => {
  const g = guessCompanyDomain(['cmhs@korea.kr', 'sewook@korea.kr', 'wonjoonlee@korea.kr'])
  assert.equal(g?.domain, 'korea.kr')
  assert.equal(g?.from, 3)
  assert.equal(g?.confident, true)
})

test('★ 도메인이 잡히면 기관 종류가 공짜로 따라온다 — 이게 이 규칙의 목적이다', () => {
  const g = guessCompanyDomain(['a@sookmyung.ac.kr'])
  assert.equal(g?.domain, 'sookmyung.ac.kr')
  assert.equal(kindFromDomain(g!.domain)?.kind, 'school')
})

test('★ 반반이면 확신하지 않는다 — 협력사 메일이 섞이면 엉뚱한 도메인이 박힌다', () => {
  const g = guessCompanyDomain(['a@alpha.com', 'b@beta.com'])
  assert.equal(g?.confident, false, '동점이면 사람이 봐야 한다')
  const g2 = guessCompanyDomain(['a@alpha.com', 'b@alpha.com', 'c@beta.com'])
  assert.equal(g2?.domain, 'alpha.com')
  assert.equal(g2?.confident, true, '혼자 과반이면 확신한다')
})

test('과반이 아니면 확신하지 않는다', () => {
  const g = guessCompanyDomain(['a@x.com', 'b@y.com', 'c@z.com'])
  assert.equal(g?.confident, false, '셋이 하나씩이면 어느 것도 과반이 아니다')
})

test('공개 메일이 섞여도 회사 메일만 센다', () => {
  const g = guessCompanyDomain(['a@gmail.com', 'b@acme.co.kr', 'c@gmail.com'])
  assert.equal(g?.domain, 'acme.co.kr')
  assert.equal(g?.confident, true, '공개 메일은 분모에서도 빠진다')
})

test('세는 함수가 셋을 나눈다 — 실행 전에 몇 곳이 되는지 보여주려고 있다', () => {
  const got = countFillable([
    { domain: null, emails: ['a@acme.co.kr'] },              // 채울 수 있음
    { domain: null, emails: ['a@x.com', 'b@y.com'] },         // 애매함
    { domain: null, emails: ['a@gmail.com'] },                // 근거 없음
    { domain: 'have.com', emails: ['a@other.com'] },          // 이미 있음 — 안 센다
  ])
  assert.deepEqual(got, { fillable: 1, unsure: 1, noSignal: 1 })
})

test('P-1 — 영업 구분을 코드에 적지 않는다', () => {
  const src = readFileSync(new URL('./domain-guess.ts', import.meta.url), 'utf8')
  const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const v of ['B2B', 'B2G', '공공', '대학', '제조']) {
    assert.ok(!body.includes(v), `코드에 값 「${v}」이 박혀 있다(P-1)`)
  }
})

test('순수하다 — DB 도 모델도 모른다', () => {
  const src = readFileSync(new URL('./domain-guess.ts', import.meta.url), 'utf8')
  for (const banned of ['@prisma/client', 'getCrmDb', 'runAi', 'fetch(']) {
    assert.ok(!src.includes(banned), `${banned} 를 안다 — 할당량이 막히면 같이 죽는다`)
  }
})
