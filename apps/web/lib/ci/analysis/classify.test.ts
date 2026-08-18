// lib/ci/analysis/classify.test.ts — 주제 분류 사다리 가드
//
// 이 파일이 지키는 것은 단 하나다: **각 단은 서로 다른 증거를 본다.**
//
// 예전 판이 무너진 자리는 둘이었고 둘 다 여기서 잠근다.
//   ① 콜드스타트 조항 — "주제가 하나뿐이면 그것으로 둔다"가 305건을 판정 없이 밀어 넣었다
//   ② 같은 증거 두 번 — 규칙과 AI가 둘 다 제목만 봐서 2단 깔때기가 사실상 1단이었다
// (진단: docs/2026-08-17-ci-topic-classification-replan/00-REPORT.md)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyByRules, shouldAutoConfirm, shouldCallAi,
  topicState, buildClassifyPrompt, parseLlmVerdict,
  type TopicCandidate, type ClassifyInput,
} from './classify.ts'
import { computeChannelIdentity, type ChannelSignalSample } from './channel-identity.ts'

function topic(p: Partial<TopicCandidate> & { id: string; name: string }): TopicCandidate {
  return { includePatterns: [], excludePatterns: [], signalPatterns: [], categoryPatterns: [], ...p }
}

function sample(p: Partial<ChannelSignalSample>): ChannelSignalSample {
  return { platformCategory: null, topicSignals: [], keywords: [], ...p }
}

function input(p: Partial<ClassifyInput>): ClassifyInput {
  return { title: null, caption: null, channelTopicId: null, topics: [], ...p }
}

const MUSIC = topic({ id: 't-music', name: '음악', signalPatterns: ['음악'], includePatterns: ['음악'] })
const COOK = topic({ id: 't-cook', name: '요리', includePatterns: ['레시피'], categoryPatterns: ['26'] })
const TRAVEL = topic({ id: 't-travel', name: '여행', signalPatterns: ['여행'] })

// ── ① 콜드스타트 조항 제거 (305건 사고) ──────────────────────────

test('★ 주제가 하나뿐이어도 근거가 없으면 미분류다 — 이 한 줄이 305건을 요리로 만들었다', () => {
  const v = classifyByRules(input({
    title: '오늘의 브이로그', topics: [COOK],
  }))
  assert.equal(v.topicId, null)
  assert.equal(v.confidence, 0)
  assert.match(v.reason, /근거를 찾지 못했습니다/)
})

test('★ 미분류를 검토 큐로 보내지 않는다 — 근거가 없는 것은 사람이 봐도 근거가 없다', () => {
  const v = classifyByRules(input({ title: '아무 말', topics: [COOK] }))
  assert.equal(v.needsHuman, false)
})

test('신호는 있는데 맞는 주제가 없으면 그 사실을 그대로 말한다', () => {
  const v = classifyByRules(input({
    topics: [COOK], signals: sample({ topicSignals: ['Music'] }),
  }))
  assert.equal(v.topicId, null)
  assert.match(v.reason, /음악/)
})

test('주제가 하나도 없으면 판정하지 않는다', () => {
  const v = classifyByRules(input({ title: '음악', topics: [] }))
  assert.equal(v.topicId, null)
  assert.match(v.reason, /주제가 없습니다/)
})

// ── ② 서로 다른 증거 (2단이 진짜 2단인가) ────────────────────────

test('★ 신호(L0)와 제목(L2)이 같은 주제를 가리키면 가장 강한 확정이다', () => {
  const v = classifyByRules(input({
    title: '음악 커버 모음', topics: [MUSIC, COOK],
    signals: sample({ platformCategory: '10', topicSignals: ['Music'] }),
  }))
  assert.equal(v.topicId, MUSIC.id)
  assert.equal(v.confidence, 0.95)
  assert.equal(v.needsHuman, false)
})

test('★ 신호와 제목이 다른 주제를 가리키면 그때가 사람을 부를 자리다', () => {
  const v = classifyByRules(input({
    title: '레시피 공개', topics: [MUSIC, COOK],
    signals: sample({ topicSignals: ['Music'] }),
  }))
  assert.equal(v.topicId, MUSIC.id)
  assert.equal(v.needsHuman, true)
  assert.deepEqual(v.secondaryTopicIds, [COOK.id])
  assert.match(v.reason, /갈립니다/)
})

test('신호 규칙은 원문(Music)과 한국어 이름(음악) 양쪽으로 맞춰본다', () => {
  const byRaw = classifyByRules(input({
    topics: [topic({ id: 't1', name: '음악', signalPatterns: ['Music'] })],
    signals: sample({ topicSignals: ['Music'] }),
  }))
  const byKo = classifyByRules(input({
    topics: [topic({ id: 't1', name: '음악', signalPatterns: ['음악'] })],
    signals: sample({ topicSignals: ['Music'] }),
  }))
  assert.equal(byRaw.topicId, 't1')
  assert.equal(byKo.topicId, 't1')
})

test('카테고리와 신호가 함께 맞으면 신호 하나보다 강하다', () => {
  const both = classifyByRules(input({
    topics: [topic({ id: 't1', name: '음악', signalPatterns: ['음악'], categoryPatterns: ['10'] })],
    signals: sample({ platformCategory: '10', topicSignals: ['Music'] }),
  }))
  const one = classifyByRules(input({
    topics: [topic({ id: 't1', name: '음악', signalPatterns: ['음악'] })],
    signals: sample({ platformCategory: '10', topicSignals: ['Music'] }),
  }))
  assert.ok(both.confidence > one.confidence)
})

test('제외 규칙에 걸리면 그 주제는 후보에서 빠진다', () => {
  const v = classifyByRules(input({
    title: '레시피 광고입니다',
    topics: [topic({ id: 't-cook', name: '요리', includePatterns: ['레시피'], excludePatterns: ['광고'] })],
  }))
  assert.equal(v.topicId, null)
})

test('제목 규칙이 동점이면 억지로 고르지 않고 묻는다', () => {
  const v = classifyByRules(input({
    title: '레시피와 음악',
    topics: [
      topic({ id: 't1', name: '요리', includePatterns: ['레시피'] }),
      topic({ id: 't2', name: '음악', includePatterns: ['음악'] }),
    ],
  }))
  assert.equal(v.needsHuman, true)
  assert.equal(v.confidence, 0.6)
})

// ── L1 상속 — 채널 하나를 확정하면 게시물이 함께 풀린다 ──────────

function travelChannel() {
  return computeChannelIdentity('youtube', [
    sample({ platformCategory: '19', topicSignals: ['Tourism'] }),
    sample({ platformCategory: '19', topicSignals: ['Tourism'] }),
    sample({ platformCategory: '19', topicSignals: ['Tourism'] }),
  ])
}

test('★ 근거가 없으면 채널 주제를 상속한다 — 311건이 한 번에 풀리는 자리다', () => {
  const v = classifyByRules(input({
    title: '어제 있었던 일', topics: [TRAVEL],
    channelTopicId: TRAVEL.id, channelTopicConfidence: 0.9,
    channelIdentity: travelChannel(),
    signals: sample({ platformCategory: '19', topicSignals: ['Tourism'] }),
  }))
  assert.equal(v.topicId, TRAVEL.id)
  assert.equal(v.needsHuman, false)
  // 상속이므로 채널 확신도보다 한 단계 낮다 — 직접 근거와 같은 값이면 구분이 사라진다
  assert.ok(v.confidence < 0.9)
})

test('★ 채널 성격과 어긋난 게시물만 사람에게 온다 — 이것이 "검토 1만 건"을 막는 구조다', () => {
  const v = classifyByRules(input({
    topics: [TRAVEL],
    channelTopicId: TRAVEL.id,
    channelIdentity: travelChannel(),
    signals: sample({ platformCategory: '10', topicSignals: ['Music'] }),
  }))
  assert.equal(v.topicId, TRAVEL.id)
  assert.equal(v.needsHuman, true)
  assert.equal(v.confidence, 0.5)
})

test('신호가 채널 주제와 다르고 이탈이면 묻되, 판정 자체는 신호를 따른다', () => {
  const v = classifyByRules(input({
    topics: [MUSIC, TRAVEL],
    channelTopicId: TRAVEL.id,
    channelIdentity: travelChannel(),
    signals: sample({ platformCategory: '10', topicSignals: ['Music'] }),
  }))
  assert.equal(v.topicId, MUSIC.id)
  assert.equal(v.needsHuman, true)
})

test('사다리 기록(rungs)에 L0·L1·L2·LM이 모두 남는다 — 화면이 근거로 그대로 쓴다', () => {
  const v = classifyByRules(input({
    title: '음악', topics: [MUSIC],
    signals: sample({ topicSignals: ['Music'] }),
  }))
  assert.deepEqual(v.rungs.map((r) => r.level).sort(), ['L0', 'L1', 'L2', 'LM'])
  assert.ok(v.rungs.every((r) => r.detail.length > 0))
})

test('영상을 안 읽었으면 LM 단이 그렇게 말한다 — 빈 칸은 고장으로 읽힌다', () => {
  const v = classifyByRules(input({
    title: '음악', topics: [MUSIC], signals: sample({ topicSignals: ['Music'] }),
  }))
  const lm = v.rungs.find((r) => r.level === 'LM')
  assert.equal(lm?.ok, false)
  assert.match(lm?.detail ?? '', /아직 읽지 않았습니다/)
})

// ── LM · 영상 실체 (숏폼이 굶던 자리) ──────────────────────────
//
// 왜 이 단이 생겼나: 숏폼은 플랫폼이 설명을 주지 않는다(실측 423건 중 227건 설명문 없음,
// 키워드 전 건 0개). 그래서 L2(제목·설명)도 L3(AI)도 **같은 빈 상자**를 봤고,
// 2단 깔때기가 아니라 0단이었다. 영상 안에서 오간 말은 완전히 다른 증거다.

test('★ 제목이 무의미해도 영상 대사로 주제를 정한다 — 숏폼이 굶던 바로 그 자리', () => {
  const v = classifyByRules(input({
    title: '유치뽕짝', caption: null, topics: [COOK, MUSIC],
    mediaText: '오늘은 집에서 간단한 레시피 하나 알려드릴게요',
  }))
  assert.equal(v.topicId, COOK.id)
  assert.equal(v.needsHuman, false)
  assert.match(v.reason, /영상 내용/)
})

test('★ 영상과 제목이 어긋나면 영상을 따르되 사람에게 알린다 — 제목은 낚시일 수 있다', () => {
  const v = classifyByRules(input({
    title: '레시피 대공개', topics: [COOK, MUSIC],
    mediaText: '이번에 발매한 신곡 음악 들려드릴게요',
  }))
  assert.equal(v.topicId, MUSIC.id)
  assert.equal(v.needsHuman, true)
  assert.ok(v.secondaryTopicIds.includes(COOK.id))
  assert.ok(v.confidence <= 0.72, '갈렸는데 확신도가 높으면 사용자가 검토할 이유를 못 느낀다')
})

test('★ 신호·제목이 갈려 사람을 부르던 자리를 영상이 깬다 — 검토 큐가 줄어드는 지점', () => {
  const withoutMedia = classifyByRules(input({
    title: '레시피 공개', topics: [MUSIC, COOK],
    signals: sample({ topicSignals: ['Music'] }),
  }))
  assert.equal(withoutMedia.needsHuman, true)   // 예전 동작

  const withMedia = classifyByRules(input({
    title: '레시피 공개', topics: [MUSIC, COOK],
    signals: sample({ topicSignals: ['Music'] }),
    mediaText: '오늘 레시피는 이렇게 만듭니다',
  }))
  assert.equal(withMedia.topicId, COOK.id)
  assert.equal(withMedia.needsHuman, false)
  assert.ok(withMedia.confidence >= 0.95)
})

test('세 증거가 전부 갈리면 그때는 여전히 사람의 일이다 — 영상이 만능이 아니다', () => {
  // TRAVEL은 signalPatterns만 있어 텍스트 규칙에 안 걸린다 — LM은 텍스트 단이므로 별도 후보를 쓴다
  const TRIP = topic({ id: 't-trip', name: '여행', includePatterns: ['여행'] })
  const v = classifyByRules(input({
    title: '레시피 공개', topics: [MUSIC, COOK, TRIP],
    signals: sample({ topicSignals: ['Music'] }),
    mediaText: '이번 여행 코스를 소개합니다',
  }))
  assert.equal(v.topicId, TRIP.id)
  assert.equal(v.needsHuman, true)
  assert.match(v.reason, /셋이 갈립니다/)
})

test('셋이 모두 같으면 가장 강하다', () => {
  const v = classifyByRules(input({
    title: '음악 커버', topics: [MUSIC, COOK],
    signals: sample({ topicSignals: ['Music'] }),
    mediaText: '오늘 부를 음악은 이겁니다',
  }))
  assert.equal(v.confidence, 0.97)
  assert.equal(v.needsHuman, false)
})

test('영상이 스스로 말한 주제(topicGuess)도 증거로 쓴다', () => {
  const v = classifyByRules(input({
    title: '무제', topics: [COOK],
    mediaText: null, mediaTopicGuess: '레시피',
  }))
  assert.equal(v.topicId, COOK.id)
})

test('영상 증거가 없으면 예전 판정이 한 글자도 안 바뀐다 — 회귀 방지', () => {
  const before = classifyByRules(input({
    title: '레시피 공개', topics: [MUSIC, COOK],
    signals: sample({ topicSignals: ['Music'] }),
  }))
  const withEmpty = classifyByRules(input({
    title: '레시피 공개', topics: [MUSIC, COOK],
    signals: sample({ topicSignals: ['Music'] }),
    mediaText: '   ', mediaTopicGuess: null,
  }))
  assert.equal(before.topicId, withEmpty.topicId)
  assert.equal(before.confidence, withEmpty.confidence)
  assert.equal(before.needsHuman, withEmpty.needsHuman)
})

test('영상을 읽었지만 맞는 주제가 없으면 그 사실을 남기고 다른 단으로 내려간다', () => {
  const v = classifyByRules(input({
    title: '음악 커버', topics: [MUSIC],
    mediaText: '완전히 관계없는 이야기입니다',
  }))
  assert.equal(v.topicId, MUSIC.id)          // L2가 받는다
  const lm = v.rungs.find((r) => r.level === 'LM')
  assert.equal(lm?.ok, false)
  assert.match(lm?.detail ?? '', /맞는 주제 규칙을 찾지 못했습니다/)
})

// ── 표시 3구간 — "55%"는 사용자에게 아무 뜻이 없다 ────────────────

test('사람이 확정한 것은 확신도와 무관하게 확정이다', () => {
  assert.equal(topicState('t1', 0.1, 'user', 0.8), 'confirmed')
})

test('임계 미만은 추정, 이상은 확정, 주제가 없으면 미분류', () => {
  assert.equal(topicState('t1', 0.55, 'auto', 0.8), 'estimated')
  assert.equal(topicState('t1', 0.9, 'auto', 0.8), 'confirmed')
  assert.equal(topicState(null, 0.9, 'auto', 0.8), 'unclassified')
})

test('확신도가 없으면(null) 추정으로 떨어진다 — 없는 값을 확정으로 올리지 않는다', () => {
  assert.equal(topicState('t1', null, 'auto', 0.8), 'estimated')
  assert.equal(shouldAutoConfirm(0.8, 0.8), true)
  assert.equal(shouldAutoConfirm(0.79, 0.8), false)
})

// ── L3 · AI ─────────────────────────────────────────────────────

test('★ 주제가 1개 이하면 AI를 부르지 않는다 — 정답지에 하나만 놓고 묻는 셈이다(실측 15건 낭비)', () => {
  const weak = classifyByRules(input({ title: 'x', topics: [COOK] }))
  assert.equal(shouldCallAi(1, weak, 0.8), false)
  assert.equal(shouldCallAi(0, weak, 0.8), false)
  assert.equal(shouldCallAi(2, weak, 0.8), true)
})

test('이미 자동 확정된 판정에는 AI를 부르지 않는다 — 돈만 쓰고 답이 같다', () => {
  const strong = classifyByRules(input({
    title: '음악', topics: [MUSIC, COOK],
    signals: sample({ platformCategory: '10', topicSignals: ['Music'] }),
  }))
  assert.equal(shouldCallAi(2, strong, 0.8), false)
})

test('★ AI 프롬프트에 채널 맥락과 플랫폼 신호가 들어간다 — 예전엔 통째로 빠져 규칙과 같은 것을 봤다', () => {
  const p = buildClassifyPrompt({
    title: '오늘의 영상', caption: '설명',
    topics: [{ id: 't1', name: '음악' }],
    channel: { name: '추성훈', description: '격투기 선수', identityText: '인물·블로그 100%' },
    signalText: '카테고리 음악 / 주제 신호 음악',
  })
  assert.match(p, /추성훈/)
  assert.match(p, /격투기 선수/)
  assert.match(p, /인물·블로그 100%/)
  assert.match(p, /카테고리 음악/)
})

test('프롬프트가 "모르면 null"을 못 박는다 — 억지로 고르면 그게 다시 요리 사고가 된다', () => {
  const p = buildClassifyPrompt({ title: 'x', caption: null, topics: [{ id: 't1', name: '음악' }] })
  assert.match(p, /억지로 고르지 마세요/)
  assert.match(p, /null/)
})

test('정정 사례가 있으면 프롬프트에 실린다 — 사람이 고친 것을 다시 틀리면 안 된다', () => {
  const p = buildClassifyPrompt({
    title: 'x', caption: null, topics: [{ id: 't1', name: '음악' }],
    correctionExamples: ['"기타 커버" → 음악'],
  })
  assert.match(p, /기타 커버/)
})

test('★ 후보에 없는 id를 AI가 고르면 버린다 — 환각 주제가 그대로 저장되면 안 된다', () => {
  const v = parseLlmVerdict('{"topicId":"t-ghost","confidence":0.9,"reason":"x"}', ['t1'])
  assert.equal(v?.topicId, null)
})

test('정상 응답은 그대로 채택하고, 코드펜스로 감싸 와도 읽는다', () => {
  const v = parseLlmVerdict('```json\n{"topicId":"t1","confidence":0.8,"reason":"근거"}\n```', ['t1'])
  assert.deepEqual(v, { topicId: 't1', confidence: 0.8, reason: '근거' })
})

test('깨진 응답은 null — 억지로 해석하지 않는다', () => {
  assert.equal(parseLlmVerdict('음… 잘 모르겠어요', ['t1']), null)
  assert.equal(parseLlmVerdict('{깨진 json', ['t1']), null)
})

test('범위 밖 확신도는 0으로 접는다 — 1.5를 받아 확정으로 올리면 안 된다', () => {
  assert.equal(parseLlmVerdict('{"topicId":"t1","confidence":1.5}', ['t1'])?.confidence, 0)
})
