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

/**
 * 서버에서 쓰는 기본 원장.
 *
 * ## 왜 기본값을 두게 됐나
 *
 * 처음에는 원장을 반드시 주게 했다 — 아무것도 안 하는 창구가 끼면 기록이 조용히
 * 0건이 되기 때문이다. 그 걱정은 **안 쓰는 창구**에 대한 것이지 창구를 건네는
 * 수고에 대한 것이 아니었다.
 *
 * 실제로는 그 수고가 이관을 막았다. 벤더를 직접 부르는 길 스물넷을 옮기려면
 * 라우트마다 관리자 클라이언트를 만들어 아래로 내려보내야 했고, 그래서 넷만
 * 옮기고 스물이 남아 있었다(실측 2026-09-16).
 *
 * 그래서 방향을 뒤집는다. **진짜로 적는** 기본값을 두면 안 주고 부를 수 있는 길이
 * 곧 적히는 길이 된다. 아무것도 안 하는 창구는 여전히 만들지 않는다.
 */
export function serverAiLedger(): AiLedger {
  let cached: Promise<LedgerClient> | null = null
  const client = () => {
    // 모듈 맨 위에서 끌면 화면 묶음에 서버 전용 코드가 딸려 들어간다
    cached ??= import('../supabase/server.ts')
      .then((m) => m.createAdminClient() as never as LedgerClient)
    return cached
  }
  return {
    async recordCall(row: CallLogRow) {
      const { error } = await (await client()).from('ai_llm_calls').insert(row)
      if (error) console.error('[ai] 호출 기록 실패', error.message ?? error)
    },
    async recordTransfer(row: TransferLogRow) {
      const { error } = await (await client()).from('ai_external_transfers').insert(row)
      if (error) console.error('[ai] 전송 기록 실패', error.message ?? error)
    },
  }
}
