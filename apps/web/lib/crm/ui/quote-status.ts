/**
 * 견적 상태의 말과 색 — SSOT
 *
 * **왜 파일로 뺐나**: 이 표가 `QuotePanel.tsx` 안에만 있었다. 딜 상세에서는 '초안·보냄·수락'인데
 * 견적 목록을 새로 만들면서 그 화면이 자기 표를 또 쓰면, 같은 상태가 화면마다 다른 말이 된다
 * (§2-5 동종 UI 통일 — 골격·용어·기능이 갈리면 사용자는 다른 기능이라고 읽는다).
 *
 * **'기한 지남'은 저장된 상태가 아니다.** DB 의 status 는 SENT 인 채로 유효기간만 지난 것을
 * 읽는 시점에 판정한다(quote.ts markExpired). 그래서 표시용 키를 고르는 일도 여기서 한다 —
 * 화면마다 `q.expired && q.status === 'SENT'` 를 다시 쓰면 한 곳이 빠진다.
 */

import type { StatusKey } from '../../tokens/status-colors.ts'

export const QUOTE_STATUS_META: Record<string, { label: string; status: StatusKey }> = {
  DRAFT: { label: '초안', status: 'note' },
  SENT: { label: '보냄', status: 'doing' },
  ACCEPTED: { label: '수락', status: 'done' },
  REJECTED: { label: '거절', status: 'blocker' },
  EXPIRED: { label: '기한 지남', status: 'blocker' },
}

/** 필터·선택지에 쓰는 순서. 영업이 겪는 순서 그대로다(쓴다 → 보낸다 → 결판난다) */
export const QUOTE_STATUS_ORDER = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'] as const

/** 이 견적을 화면에서 뭐라고 부를 것인가 — 기한 지난 SENT 는 '기한 지남'이다 */
export function quoteStatusKey(row: { status: string; expired?: boolean }): string {
  return row.expired && row.status === 'SENT' ? 'EXPIRED' : row.status
}

/** 모르는 상태가 와도 화면이 비지 않게 — 코드값이라도 보여 준다 */
export function quoteStatusMeta(row: { status: string; expired?: boolean }): {
  label: string
  status: StatusKey
} {
  const key = quoteStatusKey(row)
  return QUOTE_STATUS_META[key] ?? { label: key, status: 'note' }
}
