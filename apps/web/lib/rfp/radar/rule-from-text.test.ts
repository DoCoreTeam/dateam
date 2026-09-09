import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseKrw, parseBudgetRange, draftByRules, unfilledParts,
  buildRulePrompt, parseRuleDraft, mergeRuleDraft, keywordsFallback, shortName, EMPTY_DRAFT, MAX_KEYWORDS,
} from './rule-from-text.ts'

test('금액을 원 단위로 읽는다 — AI 에게 맡기면 회차마다 자릿수가 달라진다', () => {
  assert.equal(parseKrw('3억'), 300_000_000)
  assert.equal(parseKrw('12억'), 1_200_000_000)
  assert.equal(parseKrw('5천만'), 50_000_000)
  assert.equal(parseKrw('3000만'), 30_000_000)
  assert.equal(parseKrw('300000000'), 300_000_000)
  assert.equal(parseKrw(''), null)
})

test('이상은 하한, 이하는 상한', () => {
  assert.deepEqual(parseBudgetRange('AI 관련 3억 이상 사업'), { min: 300_000_000, max: null })
  assert.deepEqual(parseBudgetRange('10억 이하만'), { min: null, max: 1_000_000_000 })
  assert.deepEqual(parseBudgetRange('5억 미만'), { min: null, max: 500_000_000 })
})

test('범위 표기가 먼저다 — 3억~10억 에서 상한을 잃으면 안 된다', () => {
  assert.deepEqual(parseBudgetRange('3억~10억 사업'), { min: 300_000_000, max: 1_000_000_000 })
  assert.deepEqual(parseBudgetRange('5억에서 20억'), { min: 500_000_000, max: 2_000_000_000 })
})

test('금액이 없으면 둘 다 null — 억지로 추측하면 조건이 조용히 좁아진다', () => {
  assert.deepEqual(parseBudgetRange('클라우드 사업 찾아줘'), { min: null, max: null })
})

test('규칙은 금액만 푼다 — 나머지는 뜻을 알아야 한다', () => {
  const d = draftByRules('AI 관련 3억 이상 공공기관 사업')
  assert.equal(d.budgetMin, 300_000_000)
  assert.deepEqual(d.keywords, [])
})

test('규칙이 푼 것은 AI 에게 안 묻는다', () => {
  assert.deepEqual(unfilledParts(draftByRules('3억 이상')), ['name', 'keywords', 'agencies'])
  assert.deepEqual(unfilledParts(EMPTY_DRAFT), ['name', 'keywords', 'agencies', 'budget'])
})

test('프롬프트에 채울 것과 사람의 말이 들어간다', () => {
  const p = buildRulePrompt('AI 사업 찾아줘', ['name', 'keywords'])
  assert.ok(p.includes('name, keywords'))
  assert.ok(p.includes('AI 사업 찾아줘'))
  assert.ok(p.includes('말에 없는 조건을 만들지 않는다'))
})

test('AI 답을 조건으로 옮긴다', () => {
  const d = parseRuleDraft(JSON.stringify({
    name: 'AI 공공사업', keywords: ['인공지능', 'AI'], agencies: [], budgetMin: 300000000,
  }))
  assert.equal(d.name, 'AI 공공사업')
  assert.deepEqual(d.keywords, ['인공지능', 'AI'])
  assert.equal(d.budgetMin, 300000000)
})

test('키워드가 너무 많으면 자른다 — 조건이 넓으면 알림이 소음이 된다', () => {
  const many = Array.from({ length: 50 }, (_, i) => `k${i}`)
  assert.equal(parseRuleDraft(JSON.stringify({ keywords: many })).keywords?.length, MAX_KEYWORDS)
})

test('JSON 이 아니면 아무것도 안 준다 — 규칙 결과는 살아 있어야 한다', () => {
  assert.deepEqual(parseRuleDraft('못 하겠습니다'), {})
})

test('규칙이 푼 금액을 AI 가 안 덮는다', () => {
  const merged = mergeRuleDraft(
    { ...EMPTY_DRAFT, budgetMin: 300_000_000 },
    { budgetMin: 999, keywords: ['AI'] },
  )
  assert.equal(merged.budgetMin, 300_000_000)
  assert.deepEqual(merged.keywords, ['AI'])
})

test('하한이 상한보다 크면 뒤집는다 — 그대로 두면 늘 0건이고 이유가 안 보인다', () => {
  const merged = mergeRuleDraft({ ...EMPTY_DRAFT, budgetMin: 1_000_000_000, budgetMax: 300_000_000 }, {})
  assert.equal(merged.budgetMin, 300_000_000)
  assert.equal(merged.budgetMax, 1_000_000_000)
})

test('이름이 없으면 사람이 한 말을 이름으로 쓴다 — 이름 없는 조건은 목록에서 구분이 안 된다', () => {
  assert.equal(mergeRuleDraft(EMPTY_DRAFT, {}, '3억 이상 AI 사업').name, '3억 이상 AI 사업')
})

test('긴 말은 잘라서 이름으로 쓴다 — 목록이 한 줄로 보여야 한다', () => {
  const long = 'AI 관련 3억 이상 공공기관 데이터 플랫폼 구축 사업 전부 찾아줘'
  const name = mergeRuleDraft(EMPTY_DRAFT, {}, long).name
  assert.ok(name.length <= 25, name)
  assert.ok(name.endsWith('…'))
  assert.equal(shortName('짧은 말'), '짧은 말')
})

test('AI 가 죽어도 낱말은 뽑는다 — 「아무것도 안 됨」이 되면 안 된다', () => {
  const words = keywordsFallback('AI 관련 3억 이상 공공기관 사업 찾아줘')
  assert.ok(words.includes('AI'))
  assert.ok(words.includes('공공기관'))
  // 군더더기는 뺀다
  assert.equal(words.includes('관련'), false)
  assert.equal(words.includes('사업'), false)
  assert.equal(words.includes('이상'), false)
  // 금액은 낱말이 아니다
  assert.equal(words.some((w) => /[0-9]/.test(w)), false)
})
