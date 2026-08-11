import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computePatterns, PATTERN_RULES, type PatternSample } from './patterns.ts'
import { classifyByRules, shouldAutoConfirm, parseLlmVerdict } from './classify.ts'

function sample(i: number, p: Partial<PatternSample> = {}): PatternSample {
  return {
    contentId: `c${i}`,
    channelId: `ch${i % 7}`,
    title: `영상 ${i}`,
    durationSec: 300,
    publishedAt: '2026-08-05T03:00:00Z',   // 수요일 KST
    outlierIndex: 1,
    baselineN: 10,
    ...p,
  }
}

test('표본이 20건 미만이면 공식을 만들지 않는다', () => {
  const few = Array.from({ length: 19 }, (_, i) => sample(i))
  assert.deepEqual(computePatterns(few), [])
})

test('채널이 5곳 미만이면 공식으로 승격하지 않는다 (한 채널의 우연 차단)', () => {
  // 숫자 제목이 40건이지만 전부 채널 3곳
  const rows = Array.from({ length: 40 }, (_, i) => sample(i, {
    channelId: `ch${i % 3}`,
    title: i % 2 === 0 ? `비법 ${i}가지` : '설명 영상',
    outlierIndex: i % 2 === 0 ? 3 : 1,
  }))
  const found = computePatterns(rows).find((p) => p.key === 'title.number')
  assert.equal(found, undefined)
})

test('근거와 채널이 충분하고 효과가 있으면 공식이 나온다', () => {
  const rows = Array.from({ length: 60 }, (_, i) => sample(i, {
    channelId: `ch${i % 10}`,
    title: i % 2 === 0 ? `${i}가지 방법` : '오늘의 이야기',
    outlierIndex: i % 2 === 0 ? 3 : 1,
  }))
  const found = computePatterns(rows).find((p) => p.key === 'title.number')
  assert.ok(found, '숫자 제목 공식이 나와야 한다')
  assert.ok(found!.lift > 1.2)
  assert.ok(found!.evidenceCount >= 20)
  assert.ok(found!.channelCount >= 5)
})

test('효과가 미미하면(1.2배 미만) 공식으로 치지 않는다', () => {
  const rows = Array.from({ length: 60 }, (_, i) => sample(i, {
    channelId: `ch${i % 10}`,
    title: i % 2 === 0 ? `${i}가지 방법` : '오늘의 이야기',
    outlierIndex: i % 2 === 0 ? 1.05 : 1,
  }))
  assert.equal(computePatterns(rows).find((p) => p.key === 'title.number'), undefined)
})

test('배수가 없는 표본은 계산에서 빠진다', () => {
  const rows = Array.from({ length: 60 }, (_, i) => sample(i, { outlierIndex: null }))
  assert.deepEqual(computePatterns(rows), [])
})

test('주말 규칙은 KST 기준으로 판정한다', () => {
  const rule = PATTERN_RULES.find((r) => r.key === 'timing.weekend')!
  // 2026-08-08은 토요일. UTC 16시 = KST 일요일 01시 → 주말
  assert.equal(rule.test(sample(1, { publishedAt: '2026-08-08T16:00:00Z' })), true)
  // 2026-08-05 수요일
  assert.equal(rule.test(sample(1, { publishedAt: '2026-08-05T03:00:00Z' })), false)
})

// ── 분류 ─────────────────────────────────────────────────────────

const TOPICS = [
  { id: 't1', name: '요리', includePatterns: ['레시피', '요리'], excludePatterns: ['리뷰'] },
  { id: 't2', name: '게임', includePatterns: ['공략', '게임'], excludePatterns: [] },
]

test('포함 규칙이 여러 개 맞으면 확신도가 올라간다', () => {
  const one = classifyByRules({ title: '간단 요리', caption: null, channelTopicId: null, topics: TOPICS })
  const two = classifyByRules({ title: '요리 레시피', caption: null, channelTopicId: null, topics: TOPICS })
  assert.equal(one.topicId, 't1')
  assert.ok(two.confidence > one.confidence)
})

test('제외 규칙에 걸리면 그 주제는 후보에서 빠진다', () => {
  const v = classifyByRules({ title: '요리 리뷰', caption: null, channelTopicId: null, topics: TOPICS })
  assert.notEqual(v.topicId, 't1')
})

test('근거가 없으면 채널 주제를 약한 확신으로 따른다', () => {
  const v = classifyByRules({ title: '무제', caption: null, channelTopicId: 't2', topics: TOPICS })
  assert.equal(v.topicId, 't2')
  assert.ok(v.confidence < 0.85)
  assert.ok(v.reason.includes('채널'))
})

test('판단 근거가 전혀 없으면 주제를 억지로 고르지 않는다', () => {
  const v = classifyByRules({ title: '무제', caption: null, channelTopicId: null, topics: TOPICS })
  assert.equal(v.topicId, null)
  assert.equal(v.confidence, 0)
})

test('자동 확정은 임계 이상일 때만', () => {
  assert.equal(shouldAutoConfirm(0.85, 0.85), true)
  assert.equal(shouldAutoConfirm(0.84, 0.85), false)
})

test('LLM 응답이 깨졌거나 없는 주제를 고르면 채택하지 않는다', () => {
  assert.equal(parseLlmVerdict('설명만 있고 JSON 없음', ['t1']), null)
  const v = parseLlmVerdict('{"topicId":"없는주제","confidence":0.9,"reason":"x"}', ['t1'])
  assert.equal(v?.topicId, null)
})

test('정상 LLM 응답은 그대로 채택한다', () => {
  const v = parseLlmVerdict('앞말 {"topicId":"t1","confidence":0.92,"reason":"레시피 언급"} 뒷말', ['t1'])
  assert.equal(v?.topicId, 't1')
  assert.equal(v?.confidence, 0.92)
})
