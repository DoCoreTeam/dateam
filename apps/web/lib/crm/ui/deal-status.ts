// 딜 상태 → 의미색 — StatusKey 매핑의 자리(용어집 §0-2)
//
// **말과 색을 한 파일에 두지 않는다.** 말은 용어집(`terms/ledger`)이 정하고,
// 여기서는 그 말이 어느 색으로 서는지만 정한다. 색을 화면이 고르면
// 「수주」가 화면마다 다른 색이 되고, 그건 사용자가 색으로 뜻을 읽지 못하게 만든다.
import type { DealStatusKey } from '@/lib/terms'
import type { StatusKey } from '@/lib/tokens/status-colors'

export const DEAL_STATUS_TONE: Record<DealStatusKey, StatusKey> = {
  OPEN: 'doing',
  WON: 'done',
  /** 놓친 건은 «막힌 것»으로 본다 — 빨강은 기한·손실에만 쓴다(배지 규칙) */
  LOST: 'blocker',
}
