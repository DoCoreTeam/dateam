// lib/ci/analysis/channel-identity.test.ts — 채널 정체성·신호 사전 가드
//
// 왜 이 가드가 있는가: 수집함 321건이 전부 '요리'였다. 사람에게 물어야 할 질문은
// "이 영상 주제 뭐예요?" ×321이 아니라 "이 채널 뭐 하는 채널이에요?" ×5였다.
// 그 전환이 성립하려면 **채널 판정이 믿을 만해야** 한다 — 그 믿음을 여기서 지킨다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseTopicCategories, foldSignals, pickDominantSignal,
  signalLabel, categoryLabel, isGenericSignal,
} from './signal-taxonomy.ts'
import {
  computeChannelIdentity, judgeIdentity, identityConfidence,
  describeIdentity, detectDivergence, describeSample,
  IDENTITY_MIN_SAMPLES,
  type ChannelSignalSample, type ChannelIdentity,
} from './channel-identity.ts'

function sample(p: Partial<ChannelSignalSample>): ChannelSignalSample {
  return { platformCategory: null, topicSignals: [], keywords: [], ...p }
}

// ── 신호 사전 ────────────────────────────────────────────────────

test('위키 URL에서 말단 조각만 뽑고 중복은 접는다 — 같은 주제가 여러 URL로 온다', () => {
  const got = parseTopicCategories([
    'https://en.wikipedia.org/wiki/Music',
    'https://en.wikipedia.org/wiki/Pop_music',
    'https://en.wikipedia.org/wiki/Music',
  ])
  assert.deepEqual(got, ['Music', 'Pop_music'])
})

test('URL 인코딩된 말단도 사람이 읽는 원문으로 되돌린다', () => {
  assert.deepEqual(
    parseTopicCategories(['https://en.wikipedia.org/wiki/Lifestyle_%28sociology%29']),
    ['Lifestyle_(sociology)'],
  )
})

test('빈 입력·null은 예외 없이 빈 배열', () => {
  assert.deepEqual(parseTopicCategories(null), [])
  assert.deepEqual(parseTopicCategories(undefined), [])
  assert.deepEqual(parseTopicCategories([]), [])
})

test('★ 한 영상이 Music·Pop_music을 함께 가져도 음악 하나다 — 영상 하나가 둘인 척하면 안 된다', () => {
  assert.deepEqual(foldSignals(['Music', 'Pop_music', 'Jazz']), ['음악'])
})

test('모르는 신호는 번역하지 않고 원문을 밝힌다 — 아는 척하지 않는다', () => {
  assert.equal(signalLabel('Underwater_basket_weaving'), 'Underwater basket weaving')
  assert.equal(categoryLabel('youtube', '999'), '카테고리 999')
  assert.equal(categoryLabel('youtube', null), null)
})

test('★ 범용 신호는 구체 신호를 이기지 못한다 — 이기면 모든 채널이 엔터테인먼트가 된다', () => {
  const counts = new Map([['엔터테인먼트', 9], ['음악', 2]])
  assert.equal(pickDominantSignal(counts)?.label, '음악')
  assert.equal(isGenericSignal('엔터테인먼트'), true)
  assert.equal(isGenericSignal('음악'), false)
})

test('구체 신호가 하나도 없으면 범용 중 최빈값을 쓴다 (억지로 비우지 않는다)', () => {
  assert.equal(pickDominantSignal(new Map([['엔터테인먼트', 3], ['사회', 1]]))?.label, '엔터테인먼트')
})

test('동점이면 이름순으로 끊는다 — 같은 입력이 매번 다른 답을 내면 안 된다', () => {
  const a = pickDominantSignal(new Map([['음악', 2], ['게임', 2]]))
  const b = pickDominantSignal(new Map([['게임', 2], ['음악', 2]]))
  assert.equal(a?.label, b?.label)
})

test('신호가 하나도 없으면 null — 없는 주제를 지어내지 않는다', () => {
  assert.equal(pickDominantSignal(new Map()), null)
})

// ── 채널 정체성 집계 ─────────────────────────────────────────────

test('★ 카테고리 일치도를 낸다 — 5건 중 4건이 같으면 0.8', () => {
  const id = computeChannelIdentity('youtube', [
    sample({ platformCategory: '22' }), sample({ platformCategory: '22' }),
    sample({ platformCategory: '22' }), sample({ platformCategory: '22' }),
    sample({ platformCategory: '10' }),
  ])
  assert.equal(id.dominantCategory, '22')
  assert.equal(id.dominantCategoryLabel, '인물·블로그')
  assert.equal(id.categoryAgreement, 0.8)
  assert.equal(id.sampleSize, 5)
})

test('★ 신호는 콘텐츠 단위로 한 번만 센다 — 영상 2편이 음악 4건이 되면 집계가 거짓이다', () => {
  const id = computeChannelIdentity('youtube', [
    sample({ topicSignals: ['Music', 'Pop_music'] }),
    sample({ topicSignals: ['Music', 'Jazz'] }),
  ])
  assert.deepEqual(id.topSignals, [{ label: '음악', count: 2 }])
})

test('한 번만 나온 태그는 채널 성격이 아니라 그 영상의 사정이다 — 프로필에서 뺀다', () => {
  const id = computeChannelIdentity('youtube', [
    sample({ topicSignals: ['Food'], keywords: ['먹방', '일회성'] }),
    sample({ topicSignals: ['Food'], keywords: ['먹방'] }),
  ])
  assert.deepEqual(id.keywordProfile, ['먹방'])
})

test('같은 영상이 같은 태그를 두 번 달아도 한 번만 센다', () => {
  const id = computeChannelIdentity('youtube', [
    sample({ topicSignals: ['Food'], keywords: ['먹방', '먹방', '먹방'] }),
  ])
  assert.deepEqual(id.keywordProfile, [])
})

test('신호가 아예 없는 표본은 판정 표본에서 빠지고 그 수를 밝힌다', () => {
  const id = computeChannelIdentity('youtube', [
    sample({ platformCategory: '10' }),
    sample({}), sample({}),
  ])
  assert.equal(id.sampleSize, 1)
  assert.equal(id.unknownCount, 2)
})

// ── 판정 ────────────────────────────────────────────────────────

test('★ 표본이 모자라면 판정을 미룬다 — 1건으로 채널 성격을 단정하지 않는다', () => {
  const id = computeChannelIdentity('youtube', [sample({ platformCategory: '10', topicSignals: ['Music'] })])
  assert.equal(judgeIdentity(id), 'insufficient')
  assert.equal(identityConfidence(id), 0)
  assert.match(describeIdentity(id), new RegExp(`최소 ${IDENTITY_MIN_SAMPLES}건`))
})

test('신호가 한 방향이면 자동 확정한다 — 이것이 311건을 한 번에 푸는 자리다', () => {
  const id = computeChannelIdentity('youtube', [
    sample({ platformCategory: '10', topicSignals: ['Music'] }),
    sample({ platformCategory: '10', topicSignals: ['Pop_music'] }),
    sample({ platformCategory: '10', topicSignals: ['Jazz'] }),
  ])
  assert.equal(id.categoryAgreement, 1)
  assert.equal(judgeIdentity(id), 'auto')
})

test('★ 갈리면 사람에게 묻는다 — 검토는 이렇게 어려운 것만 와야 한다', () => {
  const id = computeChannelIdentity('youtube', [
    sample({ platformCategory: '10', topicSignals: ['Music'] }),
    sample({ platformCategory: '20', topicSignals: ['Sport'] }),
    sample({ platformCategory: '26', topicSignals: ['Food'] }),
  ])
  assert.ok(id.categoryAgreement < 0.8)
  assert.equal(judgeIdentity(id), 'ask')
})

test('★ 기계 판정은 0.95를 넘지 않는다 — 사람이 확정한 1.0과 같은 값이면 구분이 사라진다', () => {
  const id = computeChannelIdentity('youtube', [
    sample({ platformCategory: '10', topicSignals: ['Music'], keywords: ['커버', '기타', '보컬'] }),
    sample({ platformCategory: '10', topicSignals: ['Music'], keywords: ['커버', '기타', '보컬'] }),
    sample({ platformCategory: '10', topicSignals: ['Music'], keywords: ['커버', '기타', '보컬'] }),
  ])
  assert.equal(id.categoryAgreement, 1)
  assert.equal(identityConfidence(id), 0.95)
})

test('범용 신호뿐이면 확신도를 덜 올린다 — 근거의 세기가 다르다', () => {
  // 일치도를 0.75로 둔다. 1.0이면 둘 다 상한(0.95)에 눌려 차이가 안 보인다.
  const generic = computeChannelIdentity('youtube', [
    sample({ platformCategory: '24', topicSignals: ['Entertainment'] }),
    sample({ platformCategory: '24', topicSignals: ['Entertainment'] }),
    sample({ platformCategory: '24', topicSignals: ['Entertainment'] }),
    sample({ platformCategory: '10', topicSignals: ['Entertainment'] }),
  ])
  const specific = computeChannelIdentity('youtube', [
    sample({ platformCategory: '10', topicSignals: ['Music'] }),
    sample({ platformCategory: '10', topicSignals: ['Music'] }),
    sample({ platformCategory: '10', topicSignals: ['Music'] }),
    sample({ platformCategory: '24', topicSignals: ['Music'] }),
  ])
  assert.equal(generic.categoryAgreement, 0.75)
  assert.equal(specific.categoryAgreement, 0.75)
  assert.ok(identityConfidence(generic) < identityConfidence(specific))
})

// ── 이탈 감지 ────────────────────────────────────────────────────

function musicChannel(): ChannelIdentity {
  return computeChannelIdentity('youtube', [
    sample({ platformCategory: '10', topicSignals: ['Music'] }),
    sample({ platformCategory: '10', topicSignals: ['Pop_music'] }),
    sample({ platformCategory: '10', topicSignals: ['Jazz'] }),
    sample({ platformCategory: '10', topicSignals: ['Music'] }),
  ])
}

test('★ 채널이 평소 내는 신호면 이탈이 아니다 — 정상 스펙트럼을 이탈로 부르면 검토가 폭발한다', () => {
  const r = detectDivergence(musicChannel(), sample({ platformCategory: '10', topicSignals: ['Rock_music'] }))
  assert.equal(r.diverged, false)
})

test('채널에서 처음 나타난 신호는 이탈로 잡는다 — 이때가 개별 판정이 필요한 자리다', () => {
  const r = detectDivergence(musicChannel(), sample({ platformCategory: '10', topicSignals: ['Food'] }))
  assert.equal(r.diverged, true)
  assert.match(r.reason, /처음 나타납니다/)
})

test('카테고리가 채널 평소와 다르면 이탈이다', () => {
  const r = detectDivergence(musicChannel(), sample({ platformCategory: '26', topicSignals: ['Music'] }))
  assert.equal(r.diverged, true)
})

test('범용 신호만 다른 것은 이탈이 아니다 — 거의 모든 채널에 붙는 신호다', () => {
  const r = detectDivergence(musicChannel(), sample({ platformCategory: '10', topicSignals: ['Entertainment'] }))
  assert.equal(r.diverged, false)
})

test('채널 표본이 적으면 이탈을 판단하지 않는다 — 기준 자체가 없다', () => {
  const thin = computeChannelIdentity('youtube', [sample({ platformCategory: '10', topicSignals: ['Music'] })])
  const r = detectDivergence(thin, sample({ platformCategory: '26', topicSignals: ['Food'] }))
  assert.equal(r.diverged, false)
})

// ── 사람 말로 옮기기 ─────────────────────────────────────────────

test('근거 문장에 카테고리·일치도·신호가 들어간다 — 근거 없이 물으면 사용자가 답할 수 없다', () => {
  const text = describeIdentity(musicChannel())
  assert.match(text, /음악/)
  assert.match(text, /100%/)
})

test('신호를 못 찾았으면 그렇게 말한다 — 빈 문자열을 남기지 않는다', () => {
  assert.equal(describeSample('youtube', sample({})), '플랫폼이 주제 신호를 주지 않았습니다')
})

test('게시물 근거 줄에 카테고리·신호·태그를 사람 말로 담는다', () => {
  const text = describeSample('youtube', sample({
    platformCategory: '10', topicSignals: ['Music'], keywords: ['커버'],
  }))
  assert.match(text, /카테고리 음악/)
  assert.match(text, /주제 신호 음악/)
  assert.match(text, /태그 커버/)
})
