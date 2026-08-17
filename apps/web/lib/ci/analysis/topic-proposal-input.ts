// lib/ci/analysis/topic-proposal-input.ts — 주제 확정 요청의 입력 계약 + 실패 문구 (SSOT)
//
// 왜 문구를 따로 두는가: 검증 실패 5종(이름 비었음 · 공백만 · 잘못된 채널 id · 고른 주제 0개 ·
// 이름 40자 초과)이 전부 **"제안 내용을 확인해 주세요"** 하나로 나갔다. 무엇이 틀렸는지
// 사용자가 구분할 수 없다 — 틀린 곳을 모르면 고칠 수도 없다(G3 관찰 C).
// zod의 issues는 details로 실려 나가지만 화면은 message만 읽는다.
//
// 한계도 같이 둔다: 스키마와 문구가 같은 숫자를 각자 적으면 한쪽만 고쳐져 "40자까지"라고
// 안내하면서 39자에서 막는 화면이 된다.

import { z } from 'zod'

/** 입력 한계 — 스키마와 문구가 **같은 값**을 본다 */
export const TOPIC_PROPOSAL_LIMITS = {
  /** 주제 이름 최대 길이 */
  nameMax: 40,
  /** 한 번에 만들 수 있는 주제 수. 이보다 많으면 체계가 아니라 목록이다 */
  createMax: 12,
  /** 한 주제에 붙일 수 있는 채널 수 */
  channelMax: 200,
  /** 한 주제의 규칙 수 */
  patternMax: 8,
} as const

/**
 * 확정 요청 본문.
 *
 * 왜 라우트가 아니라 여기 있는가: 문구가 이 스키마의 실패를 설명하는데, 스키마가 라우트 안에
 * 있으면 문구 테스트가 **가짜 issue를 손으로 만들어** 검사하게 된다 — zod가 실제로 내는 모양과
 * 어긋나도 초록이 뜬다. 같은 파일에 두면 테스트가 진짜 issue로 문구를 검증할 수 있다.
 */
export const TopicProposalBody = z.object({
  proposals: z.array(z.object({
    name: z.string().trim().min(1).max(TOPIC_PROPOSAL_LIMITS.nameMax),
    channelIds: z.array(z.string().uuid()).max(TOPIC_PROPOSAL_LIMITS.channelMax),
    signalPatterns: z.array(z.string().trim().min(1).max(60)).max(TOPIC_PROPOSAL_LIMITS.patternMax),
    categoryPatterns: z.array(z.string().trim().min(1).max(20)).max(TOPIC_PROPOSAL_LIMITS.patternMax),
  })).min(1).max(TOPIC_PROPOSAL_LIMITS.createMax),
})

/** zod issue에서 우리가 보는 부분만. zod 버전이 바뀌어도 이 모양은 유지된다. */
export interface InputIssue {
  code?: string
  path?: (string | number)[]
  message?: string
}

const FALLBACK = '제안 내용을 확인해 주세요'

/**
 * 검증 실패를 사용자가 읽고 **고칠 수 있는 말**로 바꾼다.
 *
 * 첫 번째 문제만 말한다 — 다섯 개를 한 번에 늘어놓으면 어디부터 볼지 알 수 없다.
 * 판정은 `path`(어느 칸인가) + `code`(어떻게 틀렸나) 둘을 함께 본다.
 */
export function topicProposalInputMessage(issues: readonly InputIssue[]): string {
  const first = issues[0]
  if (!first) return FALLBACK

  const path = first.path ?? []
  const field = path.length > 0 ? String(path[path.length - 1]) : ''
  const code = first.code ?? ''
  const tooSmall = code === 'too_small'
  const tooBig = code === 'too_big'

  // 배열 자체가 비었거나 넘쳤다 — 칸 하나의 문제가 아니라 고른 개수의 문제다
  if (field === 'proposals' || path.length === 0) {
    if (tooSmall) return '만들 주제를 하나도 고르지 않았습니다. 하나 이상 선택해 주세요'
    if (tooBig) return `한 번에 만들 수 있는 주제는 ${TOPIC_PROPOSAL_LIMITS.createMax}개까지입니다`
    return FALLBACK
  }

  if (field === 'name') {
    // 공백만 넣은 경우도 여기로 온다(trim 후 min(1))
    if (tooSmall) return '주제 이름을 입력해 주세요'
    if (tooBig) return `주제 이름은 ${TOPIC_PROPOSAL_LIMITS.nameMax}자까지 넣을 수 있습니다`
    return '주제 이름을 확인해 주세요'
  }

  // channelIds 안의 항목은 path가 [..., 'channelIds', 0]이라 마지막이 숫자다
  if (path.includes('channelIds')) {
    return '채널 정보가 올바르지 않습니다. 화면을 새로고침한 뒤 다시 시도해 주세요'
  }

  if (path.includes('signalPatterns') || path.includes('categoryPatterns')) {
    return `주제 하나에 넣을 수 있는 규칙은 ${TOPIC_PROPOSAL_LIMITS.patternMax}개까지입니다`
  }

  return FALLBACK
}
