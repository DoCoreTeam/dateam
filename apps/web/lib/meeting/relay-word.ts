// lib/meeting/relay-word.ts — 뽑은 할 일이 **딜까지 갔는지** 한 줄로 말하는 SSOT
//
// 왜 컴포넌트 밖인가: 이 문장은 «안 갔다»를 말해야 쓸모가 있다. 조용히 닫으면
// 사용자는 딜 화면에서 「왜 안 보이지」로 겪는다(실측 2026-09-17: 뽑은 할 일 40건,
// 딜에 선 것 0건). 문장이 컴포넌트 안에 있으면 그 «안 갔다» 갈래를 검증할 수단이 없다(E-6).

import type { RelaySkip } from '../crm/services/note-task-relay.ts'

export interface RelayWord {
  created: number
  skipped: RelaySkip | null
}

/** 안 간 이유마다 **다음 손**이 다르다 — 그래서 한 문장으로 뭉뚱그리지 않는다 */
const SKIP_LINE: Record<RelaySkip, string> = {
  'no-access': '영업 CRM을 쓰는 계정이 아니라 딜에는 세우지 않았어요.',
  'not-published': '이 회의를 영업 CRM에 올리면 딜에도 세울 수 있어요. 제목 옆 공개 범위에서 올려 주세요.',
  'no-anchor': '이 회의에 붙은 딜·회사가 없어 딜에는 세우지 않았어요. 제목 옆 공개 범위에서 딜을 붙여 주세요.',
}

export function relayLine(relay: RelayWord | null): string {
  if (!relay) return '개인 일일업무에 넣었어요.'
  if (relay.created > 0) return `개인 일일업무와 딜 양쪽에 ${relay.created}건 세웠어요.`
  if (relay.skipped) return `개인 일일업무에 넣었어요. ${SKIP_LINE[relay.skipped]}`
  // 갈 곳은 있는데 만든 것이 0 — 같은 회의에서 이미 세운 것들이다
  return '개인 일일업무에 넣었어요. 딜에는 같은 할 일이 이미 서 있어요.'
}
