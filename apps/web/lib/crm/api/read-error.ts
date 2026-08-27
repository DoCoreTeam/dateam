/**
 * API 오류 봉투에서 사람이 읽을 문장을 꺼낸다 (SSOT).
 *
 * **왜 한 곳인가**: 봉투는 `{ error: { code, message, details } }` 인데
 * 화면마다 `body.message` 를 읽으면 **서버가 준 이유가 통째로 버려진다** —
 * 사용자는 「잠시 후 다시 시도해 주세요」만 보고 같은 값을 다시 넣는다.
 * (실브라우저에서 잡았다: 현물이 사업비를 넘어 막혔는데 그 사실이 화면에 안 떴다)
 */

export interface CrmErrorBody {
  error?: { code?: string; message?: string; details?: Record<string, unknown> }
  /** 옛 라우트가 평평하게 보내는 경우도 받아 준다 */
  message?: string
}

export function readApiError(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const b = body as CrmErrorBody
    const m = b.error?.message ?? b.message
    if (typeof m === 'string' && m.trim() !== '') return m
  }
  return fallback
}

/** 코드로 분기해야 할 때 — 기계는 코드를 읽고 사람은 문장을 읽는다 */
export function readApiErrorCode(body: unknown): string | null {
  if (body && typeof body === 'object') {
    const c = (body as CrmErrorBody).error?.code
    if (typeof c === 'string') return c
  }
  return null
}
