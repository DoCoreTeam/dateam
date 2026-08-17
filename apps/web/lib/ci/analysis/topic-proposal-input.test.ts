// lib/ci/analysis/topic-proposal-input.test.ts — 주제 확정 실패 문구
//
// 왜: 검증 실패 5종이 전부 "제안 내용을 확인해 주세요" 하나로 나갔다(G3 관찰 C).
//   사용자는 이름이 비었는지·너무 긴지·채널 id가 틀렸는지 구분할 수 없다.
//
// ★ 손으로 만든 가짜 issue를 쓰지 않는다. zod가 **실제로 내는** issue를 그대로 넣는다 —
//   가짜로 검사하면 zod 출력 모양이 바뀌어도 초록이 뜨고, 정작 화면 문구는 폴백으로 떨어진다.
//   (같은 교훈: 계산을 잠글 땐 실측값을 앵커로 박는다 — E-6)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TopicProposalBody, topicProposalInputMessage, TOPIC_PROPOSAL_LIMITS as LIMIT,
} from './topic-proposal-input.ts'

const UUID = '11111111-2222-4333-8444-555555555555'

/** 실제 검증을 돌려 issue를 얻는다 — 이 파이프라인이 화면 문구가 만들어지는 경로 그대로다 */
function messageFor(body: unknown): string {
  const parsed = TopicProposalBody.safeParse(body)
  assert.equal(parsed.success, false, '이 입력은 반드시 실패해야 한다 (테스트 전제)')
  return topicProposalInputMessage((parsed as { error: { issues: unknown[] } }).error.issues as never)
}

const one = (over: Record<string, unknown> = {}) => ({
  proposals: [{
    name: '음악', channelIds: [UUID], signalPatterns: [], categoryPatterns: [], ...over,
  }],
})

test('★ G3가 밟은 실패 5종이 서로 다른 문구를 낸다', () => {
  const msgs = {
    emptyName: messageFor(one({ name: '' })),
    blankName: messageFor(one({ name: '   ' })),
    badUuid: messageFor(one({ channelIds: ['not-a-uuid'] })),
    zeroPicked: messageFor({ proposals: [] }),
    longName: messageFor(one({ name: 'ㄱ'.repeat(LIMIT.nameMax + 1) })),
  }

  // 빈 이름과 공백만은 같은 원인(trim 후 빈 문자열)이라 같은 문구가 맞다
  assert.equal(msgs.emptyName, msgs.blankName)

  const distinct = new Set([msgs.emptyName, msgs.badUuid, msgs.zeroPicked, msgs.longName])
  assert.equal(distinct.size, 4, `원인이 다른데 문구가 겹친다: ${JSON.stringify(msgs, null, 2)}`)

  // 폴백으로 떨어지면 zod 출력 모양을 잘못 읽고 있다는 뜻이다
  for (const [k, v] of Object.entries(msgs)) {
    assert.notEqual(v, '제안 내용을 확인해 주세요', `${k}가 폴백 문구로 떨어졌다`)
  }
})

test('문구가 사용자가 고칠 수 있는 말인가 — 무엇을 어떻게', () => {
  assert.match(messageFor(one({ name: '' })), /이름을 입력/)
  assert.match(messageFor({ proposals: [] }), /하나도 고르지 않/)
  assert.match(messageFor(one({ channelIds: ['x'] })), /새로고침/)
})

test('한계 숫자는 스키마와 문구가 같은 값을 본다 — 40자까지라며 39자에서 막지 않는다', () => {
  const msg = messageFor(one({ name: 'ㄱ'.repeat(LIMIT.nameMax + 1) }))
  assert.match(msg, new RegExp(String(LIMIT.nameMax)))
  // 경계값은 통과해야 한다
  assert.equal(TopicProposalBody.safeParse(one({ name: 'ㄱ'.repeat(LIMIT.nameMax) })).success, true)

  const many = { proposals: Array.from({ length: LIMIT.createMax + 1 }, () => one().proposals[0]) }
  assert.match(messageFor(many), new RegExp(String(LIMIT.createMax)))
})

test('규칙이 너무 많으면 그 사실을 말한다', () => {
  const msg = messageFor(one({ signalPatterns: Array.from({ length: LIMIT.patternMax + 1 }, (_, i) => `s${i}`) }))
  assert.match(msg, /규칙/)
  assert.match(msg, new RegExp(String(LIMIT.patternMax)))
})

test('issue가 비어 있으면 폴백 — 침묵하지 않는다', () => {
  assert.equal(topicProposalInputMessage([]), '제안 내용을 확인해 주세요')
})
