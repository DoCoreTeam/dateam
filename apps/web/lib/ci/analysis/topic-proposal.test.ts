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

test('규칙(신호·카테고리)을 함께 만든다 — 규칙 없는 주제는 다음 게시물부터 못 알아본다', () => {
  const r = proposeTopics([channel('가수', 10, ['Music'], '10')])
  assert.deepEqual(r.proposals[0].signalPatterns, ['음악'])
  assert.deepEqual(r.proposals[0].categoryPatterns, ['10'])
})

test('신호가 범용뿐이면 그 이름이라도 쓰되 규칙은 비우지 않는다', () => {
  const r = proposeTopics([channel('예능', 10, ['Entertainment'], '24')])
  assert.equal(r.proposals[0].name, '엔터테인먼트')
  assert.ok(r.proposals[0].signalPatterns.length > 0)
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
