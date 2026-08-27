// lib/ci/analysis/signal-discrimination.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeChannelIdentity, type ChannelSignalSample } from './channel-identity.ts'
import {
  discriminatingSample, describeDiscrimination, stripBoilerplate, SIGNAL_UBIQUITY_THRESHOLD,
} from './signal-discrimination.ts'

/** 「장사의 신」 실측을 축소 재현: 카테고리 22가 전건 동일, 신호는 게시물마다 다름 */
function jangsaSamples(): ChannelSignalSample[] {
  const mk = (sig: string[]): ChannelSignalSample => ({
    platformCategory: '22', topicSignals: sig, keywords: ['은현장', '골목식당'],
  })
  return [
    mk(['Food']), mk(['Food']), mk(['Politics']), mk(['Society']),
    mk(['Politics']), mk(['Lifestyle_(sociology)']), mk(['Food']), mk(['Society']),
  ]
}

test('채널 전건에 같은 카테고리면 그 카테고리는 게시물 판정에서 빠진다', () => {
  const id = computeChannelIdentity('youtube', jangsaSamples())
  assert.equal(id.categoryAgreement, 1)

  const d = discriminatingSample(id, { platformCategory: '22', topicSignals: ['Politics'], keywords: [] })
  assert.equal(d.sample.platformCategory, null, '전건 동일 카테고리는 변별력이 없다')
  assert.equal(d.droppedCategory, '22')
  assert.deepEqual(d.sample.topicSignals, ['Politics'], '게시물마다 다른 신호는 남는다')
})

test('소수 게시물에만 붙는 신호는 남는다 — 그것이 변별 신호다', () => {
  const id = computeChannelIdentity('youtube', jangsaSamples())
  // Food 3/8 = 0.375 < 0.8
  const d = discriminatingSample(id, { platformCategory: '22', topicSignals: ['Food'], keywords: [] })
  assert.deepEqual(d.sample.topicSignals, ['Food'])
})

test('채널 대부분에 붙는 신호는 빠진다', () => {
  const all: ChannelSignalSample[] = Array.from({ length: 10 }, (_, i) => ({
    platformCategory: i === 0 ? '1' : '22',
    topicSignals: i < 9 ? ['Food', 'Society'] : ['Society'],
    keywords: [],
  }))
  const id = computeChannelIdentity('youtube', all)
  // Society 10/10 = 1.0 → 제외 · Food 9/10 = 0.9 → 제외
  const d = discriminatingSample(id, { platformCategory: '22', topicSignals: ['Food', 'Society'], keywords: [] })
  assert.deepEqual(d.sample.topicSignals, [], '전부 퍼진 신호만 있으면 L0이 설 자리가 없다')
  assert.equal(d.droppedSignals.length, 2)
})

test('남들과 다른 카테고리를 가진 게시물은 그것이 가장 강한 신호다 — 빼지 않는다', () => {
  const id = computeChannelIdentity('youtube', jangsaSamples())
  const d = discriminatingSample(id, { platformCategory: '25', topicSignals: [], keywords: [] })
  assert.equal(d.sample.platformCategory, '25')
  assert.equal(d.droppedCategory, null)
})

test('표본이 적으면 걷어내지 않는다 — 3건 중 3건으로 범용이라 단정하지 않는다', () => {
  const id = computeChannelIdentity('youtube', [
    { platformCategory: '22', topicSignals: ['Food'], keywords: [] },
    { platformCategory: '22', topicSignals: ['Food'], keywords: [] },
  ])
  const d = discriminatingSample(id, { platformCategory: '22', topicSignals: ['Food'], keywords: [] })
  assert.equal(d.filtered, false)
  assert.equal(d.sample.platformCategory, '22')
})

test('채널 정체성이 없으면 원본을 그대로 쓴다', () => {
  const s: ChannelSignalSample = { platformCategory: '22', topicSignals: ['Food'], keywords: [] }
  assert.equal(discriminatingSample(null, s).sample, s)
  assert.equal(discriminatingSample(undefined, s).filtered, false)
})

test('무엇을 왜 뺐는지 사람 말로 설명한다 · 조사를 문장에 박지 않는다', () => {
  const id = computeChannelIdentity('youtube', jangsaSamples())
  const d = discriminatingSample(id, { platformCategory: '22', topicSignals: ['Politics'], keywords: [] })
  const msg = describeDiscrimination(d)
  assert.ok(msg.includes('플랫폼 분류'), msg)
  assert.ok(!/[은는이가]\(/.test(msg), '«은(는)» 같은 조사 회피 표기가 없어야 한다')
  assert.equal(describeDiscrimination({ ...d, filtered: false }), '', '뺀 것이 없으면 말하지 않는다')
})

test('임계는 상수로만 바꾼다', () => {
  assert.ok(SIGNAL_UBIQUITY_THRESHOLD > 0.5 && SIGNAL_UBIQUITY_THRESHOLD <= 1)
})

// ── 설명문 보일러플레이트 ────────────────────────────────────────

test('채널 전건에 반복되는 설명문 줄은 걷어낸다 — 이 게시물만의 줄이 남는다', () => {
  const notice = '이 영상은 비평·패러디·풍자·교육적 설명의 목적으로 제작되었습니다'
  const promo = '📌 장신몰 전제품 할인중! https://example.com/link'
  const samples: ChannelSignalSample[] = Array.from({ length: 8 }, (_, i) => ({
    platformCategory: '22', topicSignals: [], keywords: [],
    caption: `오늘은 ${i}번째 가게에 다녀왔습니다\n${promo}\n${notice}`,
  }))
  const id = computeChannelIdentity('youtube', samples)
  assert.ok(id.captionBoilerplate?.includes(notice), '법적 고지는 전건 반복이다')
  assert.ok(id.captionBoilerplate?.includes(promo))

  const own = stripBoilerplate(`김세의 가압류 이야기\n${promo}\n${notice}`, id.captionBoilerplate)
  assert.equal(own, '김세의 가압류 이야기', "'교육'이라는 글자가 사라져야 이 게시물이 교육이 되지 않는다")
})

test('설명문이 게시물마다 다르면 아무것도 걷어내지 않는다', () => {
  const samples: ChannelSignalSample[] = Array.from({ length: 8 }, (_, i) => ({
    platformCategory: '22', topicSignals: [], keywords: [], caption: `서로 다른 설명 ${i}번째입니다`,
  }))
  const id = computeChannelIdentity('youtube', samples)
  assert.deepEqual(id.captionBoilerplate, [])
  assert.equal(stripBoilerplate('내 설명', id.captionBoilerplate), '내 설명')
})

test('설명문 표본이 적으면 반복인지 우연인지 가리지 않는다', () => {
  const samples: ChannelSignalSample[] = Array.from({ length: 3 }, () => ({
    platformCategory: '22', topicSignals: [], keywords: [], caption: '똑같은 설명문이 반복됩니다',
  }))
  assert.deepEqual(computeChannelIdentity('youtube', samples).captionBoilerplate, [])
})

test('예전에 저장된 정체성에는 보일러플레이트가 없다 — 그때는 걷어내지 않는다', () => {
  assert.equal(stripBoilerplate('설명문', undefined), '설명문')
  assert.equal(stripBoilerplate('설명문', []), '설명문')
  assert.equal(stripBoilerplate(null, ['x']), null)
})

test('전부 걷어내면 설명문이 없는 것과 같다 — 빈 문자열이 규칙에 걸리지 않게', () => {
  assert.equal(stripBoilerplate('공지 한 줄뿐입니다', ['공지 한 줄뿐입니다']), null)
})
