/**
 * AI 원장 기록기 (마이그 253)
 *
 * ## 조용히 0건이 되지 않게
 *
 * `supabase-js` 는 insert 오류를 **던지지 않고 돌려준다.** 칸 이름을 한 글자 틀리면
 * 아무 일도 안 일어난 것처럼 지나가고, 원장은 비어 있는데 아무도 모른다.
 * 이 저장소가 그 방식으로 기록 셋을 잃은 적이 있다. 그래서 error 를 읽고 남긴다.
 *
 * ## 기록 실패가 호출을 막지는 않는다
 *
 * 원장을 못 적었다고 사용자의 일을 멈추지 않는다. 다만 조용히 넘어가지도 않는다 —
 * 콘솔에 남겨 시스템 로그가 줍게 한다.
 */

import type { AiLedger, CallLogRow, TransferLogRow } from './guarded-call.ts'

/** 이 모듈이 쓰는 최소한. 테스트가 가짜를 끼울 수 있게 좁게 잡는다 */
export interface LedgerClient {
  from(table: string): {
    insert(row: unknown): Promise<{ error: { message?: string } | null }>
  }
}

export function createAiLedger(db: LedgerClient): AiLedger {
  return {
    async recordCall(row: CallLogRow) {
      const { error } = await db.from('ai_llm_calls').insert(row)
      if (error) console.error('[ai] 호출 기록 실패', error.message ?? error)
    },
    async recordTransfer(row: TransferLogRow) {
      const { error } = await db.from('ai_external_transfers').insert(row)
      if (error) console.error('[ai] 전송 기록 실패', error.message ?? error)
    },
  }
}
