/**
 * CRM 쓰기 트랜잭션 래퍼 (구현명세서 2.4, CLAUDE_dacrm 절대규칙 6)
 *
 *   "쓰기 트랜잭션은 withCrmTx 를 사용하고 audit_log 를 같은 트랜잭션에서 기록한다"
 *
 * 순서가 곧 계약이다:
 *   1) SET LOCAL app.workspace_id   — RLS 가 판정에 쓰는 값. 반드시 업무 쓰기보다 먼저.
 *   2) 업무 쓰기
 *   3) audit_log 기록 (같은 트랜잭션)
 * 하나라도 실패하면 전부 롤백된다. 부분 반영이 없다는 것이 이 래퍼의 존재 이유다.
 *
 * ⚠️ set_config 의 세 번째 인자가 true 여야 **트랜잭션 로컬**이다.
 *    false 로 두면 세션 전역이 되어, 커넥션 풀에서 그 커넥션을 물려받은 다음 요청이
 *    남의 워크스페이스 값을 그대로 들고 시작한다. pgbouncer transaction mode 에서는
 *    커넥션 재사용이 기본이므로 이건 이론적 위험이 아니라 실제 사고 경로다.
 */

import { getCrmDb, type CrmDb } from './client.ts'
import { CrmError } from '../domain/errors.ts'

/** withCrmTx 콜백이 받는 클라이언트 — 확장(워크스페이스 가드)이 적용된 트랜잭션 클라이언트 */
export type CrmTxClient = Parameters<Parameters<CrmDb['$transaction']>[0]>[0]

/** 테스트에서 가짜 클라이언트를 넣기 위한 최소 계약 */
export interface TxCapableClient<TTx> {
  $transaction: <R>(fn: (tx: TTx) => Promise<R>) => Promise<R>
}

export interface TxLike {
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<number>
}

/**
 * 워크스페이스가 못 박힌 트랜잭션을 연다.
 *
 * @param workspaceId 세션에서 해석한 값. 클라이언트가 보낸 값을 그대로 넣지 않는다(명세 5장).
 * @param fn          업무 쓰기 + audit 기록. 던지면 전부 롤백된다.
 * @param db          주입용. 생략하면 getCrmDb(workspaceId).
 */
export async function withCrmTx<T, TTx extends TxLike = CrmTxClient>(
  workspaceId: string,
  fn: (tx: TTx) => Promise<T>,
  db?: TxCapableClient<TTx>,
): Promise<T> {
  if (!workspaceId) {
    // 트랜잭션을 열기 전에 막는다. 열고 나서 막으면 빈 트랜잭션이 커넥션을 잡는다.
    throw new CrmError('WORKSPACE_MISMATCH', '요청을 처리할 수 없습니다.', {
      reason: 'workspaceId 가 비어 있다',
    })
  }

  const client = (db ?? (getCrmDb(workspaceId) as unknown as TxCapableClient<TTx>))

  return client.$transaction(async (tx) => {
    // 파라미터 바인딩으로 넘긴다. 문자열 결합으로 만들면 workspaceId 가 SQL 로 해석될 여지가 생긴다.
    await tx.$executeRawUnsafe(`SELECT set_config('app.workspace_id', $1, true)`, workspaceId)
    return fn(tx)
  })
}
