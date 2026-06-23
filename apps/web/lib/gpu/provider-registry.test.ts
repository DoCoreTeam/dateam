import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isCompetitorProvider, detectCompetitorProviders, classifyByIntent, resolveClassification,
} from './provider-registry.ts'

test('isCompetitorProvider: Nebius=true', () => {
  assert.equal(isCompetitorProvider('Nebius H100 pricing'), true)
  assert.equal(isCompetitorProvider('nebius.ai'), true)
})

test('isCompetitorProvider: 우리회사/일반텍스트=false', () => {
  assert.equal(isCompetitorProvider('우리 공급사 정준홍 견적'), false)
  assert.equal(isCompetitorProvider('H100 80GB $1.99'), false)
})

test('detectCompetitorProviders: 여러 경쟁사 인식', () => {
  const found = detectCompetitorProviders('RunPod and Lambda Labs and CoreWeave')
  assert.ok(found.includes('RunPod'))
  assert.ok(found.includes('Lambda'))
  assert.ok(found.includes('CoreWeave'))
})

test('detectCompetitorProviders: AWS/GCP/Azure 변형', () => {
  assert.ok(detectCompetitorProviders('Amazon Web Services EC2').includes('AWS'))
  assert.ok(detectCompetitorProviders('Google Cloud Platform').includes('GCP'))
  assert.ok(detectCompetitorProviders('Microsoft Azure').includes('Azure'))
})

test('detectCompetitorProviders: 한국 클라우드', () => {
  assert.ok(detectCompetitorProviders('NHN Cloud').includes('NHN Cloud'))
  assert.ok(detectCompetitorProviders('NAVER Cloud').includes('NAVER Cloud'))
  assert.ok(detectCompetitorProviders('네이버 클라우드').includes('NAVER Cloud'))
})

test('classifyByIntent: 경쟁사 키워드 → competitor', () => {
  assert.equal(classifyByIntent('이건 경쟁사 가격입니다'), 'competitor')
  assert.equal(classifyByIntent('시장가 참고'), 'competitor')
})

test('classifyByIntent: 공급가 키워드 → supplier', () => {
  assert.equal(classifyByIntent('공급가 견적'), 'supplier')
  assert.equal(classifyByIntent('매입가 등록'), 'supplier')
})

test('classifyByIntent: competitor가 supplier보다 우선', () => {
  assert.equal(classifyByIntent('경쟁사 공급가 비교'), 'competitor')
})

test('classifyByIntent: 키워드 없음 → null', () => {
  assert.equal(classifyByIntent('H100 80GB'), null)
})

test('resolveClassification: 사용자 의도 최우선', () => {
  const r = resolveClassification({ text: '경쟁사 가격', aiType: 'supplier' })
  assert.equal(r.decision, 'competitor')
  assert.equal(r.reason, 'intent')
})

test('resolveClassification: AI supplier + 화이트리스트 → competitor 승격', () => {
  const r = resolveClassification({ text: 'Nebius H100 $1.99', aiType: 'supplier' })
  assert.equal(r.decision, 'competitor')
  assert.equal(r.reason, 'whitelist')
})

test('resolveClassification: AI competitor 그대로', () => {
  const r = resolveClassification({ text: 'some prices', aiType: 'competitor', aiSupplierPresent: true })
  assert.equal(r.decision, 'competitor')
  assert.equal(r.reason, 'ai')
  assert.equal(r.supplierPresent, true)
})

test('resolveClassification: 근거 없으면 supplier 폴백(과교정 방지)', () => {
  const r = resolveClassification({ text: '정준홍 공급 견적 H100', aiType: 'supplier' })
  assert.equal(r.decision, 'supplier')
})

test('resolveClassification: supplier 의도 → 화이트리스트 무시', () => {
  // 공급가 의도가 명시되면 텍스트에 Nebius가 있어도 supplier(사용자 결정권 우선)
  const r = resolveClassification({ text: '공급가: Nebius 대비 견적', aiType: 'competitor' })
  assert.equal(r.decision, 'supplier')
  assert.equal(r.reason, 'intent')
})
