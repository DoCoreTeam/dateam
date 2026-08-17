// lib/ci/analysis/topic-proposal.test.ts — 주제 자동 제안 가드
//
// 왜: 온보딩이 빈칸을 주고 "주제를 만드세요"라고 했다. 사용자는 '요리' 하나를 넣었고
// 그때부터 시스템은 세상을 그 하나로 봤다. 사람이 맨손으로 분류 체계를 설계할 이유가 없다 —
// 채널을 등록하는 순간 플랫폼이 이미 답을 주고 있기 때문이다.
//
// 이 가드가 지키는 것: 제안이 **다시 한 덩어리로 뭉치지 않는가**. 범용 신호로 묶으면
// 모든 채널이 '엔터테인먼트' 하나가 되고, 그건 지금 전부 '요리'인 것과 같은 실패다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  proposeTopics, describeProposals,
  type ChannelForProposal,
} from './topic-proposal.ts'
import { computeChannelIdentity, type ChannelSignalSample } from './channel-identity.ts'

function sample(p: Partial<ChannelSignalSample>): ChannelSignalSample {
  return { platformCategory: null, topicSignals: [], keywords: [], ...p }
}

/** 같은 신호를 n번 낸 채널 하나 */
function channel(
  name: string, contentCount: number,
  signals: string[], category: string | null,
): ChannelForProposal {
  return {
    channelId: `ch-${name}`,
    displayName: name,
    contentCount,
    identity: computeChannelIdentity('youtube', [
      sample({ platformCategory: category, topicSignals: signals }),
      sample({ platformCategory: category, topicSignals: signals }),
      sample({ platformCategory: category, topicSignals: signals }),
    ]),
  }
}

/**
 * 신호가 섞인 채널 하나. `signals`에 [라벨, 건수]를 주면 그만큼만 그 신호를 갖고,
 * 나머지 표본은 범용 신호로 채운다 — 실제 채널이 그렇다.
 *
 * 채우는 이유: `sampleSize`는 "신호를 하나라도 가진 표본 수"다. 나머지를 비워 두면
 * 71건이 표본 71건의 100%가 되어 "23%가 채널을 대표한 사고"를 재현할 수 없다.
 */
function mixed(
  name: string, total: number,
  signals: readonly (readonly [string, number])[], category: string | null,
): ChannelForProposal {
  const samples: ChannelSignalSample[] = []
  for (const [label, count] of signals) {
    for (let i = 0; i < count; i++) {
      samples.push(sample({ platformCategory: category, topicSignals: [label] }))
    }
  }
  while (samples.length < total) {
    samples.push(sample({ platformCategory: category, topicSignals: ['Entertainment'] }))
  }
  return {
    channelId: `ch-${name}`,
    displayName: name,
    contentCount: total,
    identity: computeChannelIdentity('youtube', samples),
  }
}

test('★ 구체 신호로 묶는다 — 카테고리로만 묶으면 성격이 다른 채널이 한 덩어리가 된다', () => {
  // 둘 다 YouTube 카테고리는 '인물·블로그'(22)지만 실제 성격은 음악과 음식으로 다르다.
  const r = proposeTopics([
    channel('가수', 10, ['Music'], '22'),
    channel('먹방러', 20, ['Food'], '22'),
  ])
  assert.equal(r.proposals.length, 2)
  assert.deepEqual(r.proposals.map((p) => p.name).sort(), ['음식', '음악'])
})

test('같은 신호를 내는 채널들은 한 주제로 합쳐지고 건수도 합산된다', () => {
  const r = proposeTopics([
    channel('가수A', 8, ['Music'], '10'),
    channel('가수B', 12, ['Pop_music'], '10'),
  ])
  assert.equal(r.proposals.length, 1)
  assert.equal(r.proposals[0].name, '음악')
  assert.equal(r.proposals[0].contentCount, 20)
  assert.equal(r.proposals[0].channelIds.length, 2)
})

test('★ 신호가 하나도 없는 채널은 어디에도 밀어 넣지 않는다 — 억지 배정이 곧 요리 사고다', () => {
  const r = proposeTopics([
    channel('가수', 10, ['Music'], '10'),
    {
      channelId: 'ch-blank', displayName: '미상', contentCount: 5,
      identity: computeChannelIdentity('youtube', [sample({}), sample({}), sample({})]),
    },
  ])
  assert.equal(r.proposals.length, 1)
  assert.deepEqual(r.unassigned.map((u) => u.channelId), ['ch-blank'])
})

test('건수가 많은 제안이 위에 온다 — 화면은 위에서 아래로 읽힌다', () => {
  const r = proposeTopics([
    channel('소형', 3, ['Music'], '10'),
    channel('대형', 311, ['Food'], '26'),
  ])
  assert.deepEqual(r.proposals.map((p) => p.name), ['음식', '음악'])
})

test('★ 제안마다 왜 이렇게 묶었는지 근거가 붙는다 — 근거 없이 물으면 사용자가 답할 수 없다', () => {
  const r = proposeTopics([channel('추성훈', 311, ['Food'], '22')])
  assert.match(r.proposals[0].reason, /추성훈/)
  assert.match(r.proposals[0].reason, /311건/)
})

test('★ 규칙은 이름을 만든 축 하나만 쓴다 — 축을 섞으면 그 카테고리 전체가 주제로 빨려 들어온다', () => {
  // 실측 사고: 이름은 신호('음식')에서, 규칙은 카테고리('인물·블로그' 전체)에서 왔다.
  // 그래서 브이로그·반려동물·여행 영상이 전부 '음식'이 됐다. 규칙 없는 주제도 안 되지만,
  // **이름과 다른 축의 규칙**은 그보다 나쁘다 — 틀린 것을 자동으로 늘린다.
  const bySignal = proposeTopics([channel('가수', 10, ['Music'], '10')])
  assert.deepEqual(bySignal.proposals[0].signalPatterns, ['음악'])
  assert.deepEqual(bySignal.proposals[0].categoryPatterns, [], '신호가 이름을 만들면 카테고리 규칙은 비운다')

  // 반대 방향: 지배 신호가 없어 카테고리가 이름을 만들면 규칙도 카테고리 하나뿐이다
  const byCategory = proposeTopics([mixed('잡탕', 100, [['Food', 20], ['Pets', 15]], '22')])
  assert.equal(byCategory.proposals[0].name, '인물·블로그')
  assert.deepEqual(byCategory.proposals[0].categoryPatterns, ['22'])
  assert.deepEqual(byCategory.proposals[0].signalPatterns, [], '카테고리가 이름을 만들면 신호 규칙은 비운다')
})

test('★ 소수 신호는 채널을 대표하지 못한다 — 23%가 311건 전부에 붙은 것이 이 사고였다', () => {
  // 실측(2026-08-17): 추성훈 채널 표본 311건 중 '음식' 신호는 71건(23%)뿐인데
  // 채널 주제가 '음식'이 되어 311건 전부에 붙었다. 이름만 '요리'에서 '음식'으로 바뀐 셈이었다.
  const r = proposeTopics([mixed('추성훈', 311, [['Food', 71]], '22')])
  assert.notEqual(r.proposals[0]?.name, '음식', '과반이 안 되는 신호로 채널을 대표하지 않는다')
  assert.ok(
    !r.proposals.some((p) => p.signalPatterns.includes('음식')),
    '대표하지 못한 신호가 규칙으로도 새어 나가지 않는다',
  )
})

test('★ 지배 신호도 없고 카테고리도 흩어져 있으면 제안하지 않는다 — 억지로 묶는 것이 사고의 시작이다', () => {
  const r = proposeTopics([
    {
      channelId: 'ch-scatter', displayName: '잡탕', contentCount: 40,
      identity: computeChannelIdentity('youtube', [
        sample({ platformCategory: '22', topicSignals: ['Food'] }),
        sample({ platformCategory: '10', topicSignals: ['Music'] }),
        sample({ platformCategory: '24', topicSignals: ['Pets'] }),
        sample({ platformCategory: '17', topicSignals: ['Sport'] }),
      ]),
    },
  ])
  assert.equal(r.proposals.length, 0)
  assert.deepEqual(r.unassigned.map((u) => u.channelId), ['ch-scatter'])
})

test('신호가 범용뿐이면 카테고리가 이름을 만들고, 규칙도 그 카테고리 하나다', () => {
  // 범용 신호(Entertainment)는 지배 신호로 인정하지 않으므로 카테고리 축으로 넘어간다.
  // 예전엔 이름을 신호 규칙에 그대로 넣어(`[name]`) 규칙 없는 주제를 막았는데,
  // 그게 곧 축 섞기였다. 규칙은 여전히 비지 않는다 — 카테고리 쪽이 채운다.
  const r = proposeTopics([channel('예능', 10, ['Entertainment'], '24')])
  assert.equal(r.proposals[0].name, '엔터테인먼트')
  assert.deepEqual(r.proposals[0].categoryPatterns, ['24'])
  assert.deepEqual(r.proposals[0].signalPatterns, [])
  assert.ok(
    r.proposals[0].signalPatterns.length + r.proposals[0].categoryPatterns.length > 0,
    '규칙이 하나도 없는 주제는 제안하지 않는다',
  )
})

// 제안에서 빼는 기준은 "이름이 이미 있는가"가 아니라 **채널에 주제가 붙었는가**로 바뀌었다
// (propose GET이 topic_id로 거른다). 이름으로 걸렀더니 "주제는 있는데 채널이 안 붙은"
// 상태에서 제안이 0개가 되어 화면에서 고칠 길이 사라졌다 — excludeExisting과 함께 삭제했다.

test('제안이 없으면 없다고 말한다 — 0을 발견처럼 그리지 않는다', () => {
  assert.match(describeProposals({ proposals: [], unassigned: [] }), /신호가 모이지 않았습니다/)
})

test('요약 문장에 채널 수와 건수가 함께 들어간다 — 건수만 보이면 한 채널 311건이 여러 채널처럼 읽힌다', () => {
  const r = proposeTopics([
    channel('가수', 8, ['Music'], '10'),
    channel('먹방러', 311, ['Food'], '26'),
  ])
  const text = describeProposals(r)
  assert.match(text, /음식 1채널 311건/)
  assert.match(text, /음악 1채널 8건/)
})

test('신호 없는 채널 수도 요약에 밝힌다 — 숨기면 "왜 제안이 적지"의 답이 없다', () => {
  const r = proposeTopics([
    channel('가수', 8, ['Music'], '10'),
    {
      channelId: 'ch-blank', displayName: null, contentCount: 0,
      identity: computeChannelIdentity('youtube', [sample({})]),
    },
  ])
  assert.match(describeProposals(r), /신호 없음 1채널/)
})

test('채널이 하나도 없어도 예외 없이 빈 결과', () => {
  const r = proposeTopics([])
  assert.deepEqual(r.proposals, [])
  assert.deepEqual(r.unassigned, [])
})
