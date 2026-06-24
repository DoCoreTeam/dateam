import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeDomain,
  normalizeCompanyName,
  resolveCompetitorId,
  findMergeSuggestions,
  planCompetitorMerge,
  type CompetitorIdentity,
  type MappingLite,
} from './resolve-competitor.ts'

test('normalizeDomain — scheme·www·경로·포트 제거', () => {
  assert.equal(normalizeDomain('https://www.lambdalabs.com/pricing'), 'lambdalabs.com')
  assert.equal(normalizeDomain('http://lambdalabs.com'), 'lambdalabs.com')
  assert.equal(normalizeDomain('lambdalabs.com:443'), 'lambdalabs.com')
  assert.equal(normalizeDomain('  WWW.RunPod.IO  '), 'runpod.io')
})

test('normalizeDomain — 2단계 TLD(co.kr)는 라벨 1개 더 보존', () => {
  assert.equal(normalizeDomain('https://cloud.naver.co.kr'), 'naver.co.kr')
  assert.equal(normalizeDomain('nhncloud.com'), 'nhncloud.com')
})

test('normalizeDomain — 판정 불가 시 null', () => {
  assert.equal(normalizeDomain(''), null)
  assert.equal(normalizeDomain(null), null)
  assert.equal(normalizeDomain('localhost'), null)
})

test('normalizeCompanyName — 괄호내용 제거로 CLOUDV 동일 판정', () => {
  assert.equal(normalizeCompanyName('CLOUDV (Smileserv)'), 'cloudv')
  assert.equal(normalizeCompanyName('CLOUDV'), 'cloudv')
  assert.equal(normalizeCompanyName('CLOUDV (Smileserv)'), normalizeCompanyName('CLOUDV'))
})

test('normalizeCompanyName — Lambda 와 Lambda Labs 는 다름(도메인/수동으로만 병합)', () => {
  assert.notEqual(normalizeCompanyName('Lambda'), normalizeCompanyName('Lambda Labs'))
})

const COMPS: CompetitorIdentity[] = [
  { id: 'cloudv', name: 'CLOUDV', website_url: 'https://cloudv.kr' },
  { id: 'lambda', name: 'Lambda', website_url: 'https://lambdalabs.com' },
  { id: 'lambdalabs', name: 'Lambda Labs', short_name: 'LMB', website_url: 'https://www.lambdalabs.com/service' },
  { id: 'elice', name: 'Elice Cloud', website_url: 'https://elice.io' },
  { id: 'kakao', name: 'KakaoCloud', website_url: 'https://kakaocloud.com' },
  { id: 'nhn', name: 'NHN Cloud', website_url: 'https://nhncloud.com' },
  { id: 'salad', name: 'SaladCloud', website_url: 'https://salad.com' },
]

test('resolveCompetitorId — 도메인 일치 우선(Lambda Labs 새 견적 → 기존 Lambda)', () => {
  assert.equal(
    resolveCompetitorId({ name: '람다 (신규표기)', website_url: 'lambdalabs.com/foo' }, COMPS),
    'lambda',
  )
})

test('resolveCompetitorId — 괄호 변형은 정규화 이름으로 해소(CLOUDV)', () => {
  assert.equal(
    resolveCompetitorId({ name: 'CLOUDV (Smileserv)', website_url: null }, COMPS),
    'cloudv',
  )
})

test('resolveCompetitorId — 별칭으로 해소', () => {
  const withAlias: CompetitorIdentity[] = [
    { id: 'lambdalabs', name: 'Lambda Labs', aliases: ['Lambda', 'LMB'] },
  ]
  assert.equal(resolveCompetitorId({ name: 'lambda' }, withAlias), 'lambdalabs')
  assert.equal(resolveCompetitorId({ name: 'LMB' }, withAlias), 'lambdalabs')
})

test('과병합 방지 — Cloud 토큰만 겹치는 회사들은 해소 안 됨', () => {
  // Elice Cloud 로 들어와도 KakaoCloud/NHN Cloud/SaladCloud 로 해소되면 안 됨
  assert.equal(resolveCompetitorId({ name: '완전신규 Cloud사', website_url: 'https://brandnew.ai' }, COMPS), null)
})

test('findMergeSuggestions — 도메인 같은 Lambda/Lambda Labs 만 묶고, Cloud 류는 안 묶음', () => {
  const sugs = findMergeSuggestions(COMPS)
  assert.equal(sugs.length, 1)
  assert.equal(sugs[0].reason, 'domain')
  assert.deepEqual([...sugs[0].competitor_ids].sort(), ['lambda', 'lambdalabs'])
})

test('findMergeSuggestions — 도메인 없고 괄호 변형(정규화 이름 동일)은 name 사유로 묶음', () => {
  const comps: CompetitorIdentity[] = [
    { id: 'a', name: 'CLOUDV', website_url: null },
    { id: 'b', name: 'CLOUDV (Smileserv)', website_url: null },
    { id: 'c', name: 'Elice Cloud', website_url: null },
  ]
  const sugs = findMergeSuggestions(comps)
  assert.equal(sugs.length, 1)
  assert.equal(sugs[0].reason, 'name')
  assert.deepEqual([...sugs[0].competitor_ids].sort(), ['a', 'b'])
})

const CANON: CompetitorIdentity = { id: 'lambdalabs', name: 'Lambda Labs', aliases: ['LMB'] }
const ABSORB: CompetitorIdentity[] = [{ id: 'lambda', name: 'Lambda', short_name: 'Lam' }]

test('planCompetitorMerge — 충돌 없는 매핑은 이관(repoint)', () => {
  const mappings: MappingLite[] = [
    { id: 'm1', competitor_id: 'lambdalabs', gpu_product_id: 'h100', pricing_model: 'ondemand' },
    { id: 'm2', competitor_id: 'lambda', gpu_product_id: 'a100', pricing_model: 'ondemand' },
  ]
  const plan = planCompetitorMerge(CANON, ABSORB, mappings)
  assert.deepEqual(plan.repointMappingIds, ['m2'])
  assert.equal(plan.collisions.length, 0)
  assert.deepEqual(plan.absorbedIds, ['lambda'])
})

test('planCompetitorMerge — 같은 (product, pricing_model) 충돌은 시세 이관 후 비활성', () => {
  const mappings: MappingLite[] = [
    { id: 'm1', competitor_id: 'lambdalabs', gpu_product_id: 'h100', pricing_model: 'ondemand' },
    { id: 'm2', competitor_id: 'lambda', gpu_product_id: 'h100', pricing_model: 'ondemand' }, // 충돌
    { id: 'm3', competitor_id: 'lambda', gpu_product_id: 'h100', pricing_model: 'spot' },      // 비충돌
  ]
  const plan = planCompetitorMerge(CANON, ABSORB, mappings)
  assert.deepEqual(plan.repointMappingIds, ['m3'])
  assert.deepEqual(plan.collisions, [{ fromMappingId: 'm2', toMappingId: 'm1' }])
  assert.deepEqual(plan.deactivateMappingIds, ['m2'])
})

test('planCompetitorMerge — 흡수 회사 이름·약칭이 별칭으로 보존(캐노니컬 이름 제외)', () => {
  const plan = planCompetitorMerge(CANON, ABSORB, [])
  assert.ok(plan.aliases.includes('Lambda'))
  assert.ok(plan.aliases.includes('Lam'))
  assert.ok(plan.aliases.includes('LMB')) // 기존 캐노니컬 별칭 유지
  assert.ok(!plan.aliases.includes('Lambda Labs')) // 캐노니컬 이름은 별칭 아님
})

test('planCompetitorMerge — 흡수 회사끼리 같은 매핑이면 하나만 이관, 나머지 비활성', () => {
  const canon: CompetitorIdentity = { id: 'c', name: 'Canon' }
  const absorb: CompetitorIdentity[] = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]
  const mappings: MappingLite[] = [
    { id: 'ma', competitor_id: 'a', gpu_product_id: 'h100', pricing_model: 'ondemand' },
    { id: 'mb', competitor_id: 'b', gpu_product_id: 'h100', pricing_model: 'ondemand' }, // a와 충돌
  ]
  const plan = planCompetitorMerge(canon, absorb, mappings)
  assert.equal(plan.repointMappingIds.length, 1)
  assert.equal(plan.deactivateMappingIds.length, 1)
  assert.equal(plan.collisions.length, 1)
})
