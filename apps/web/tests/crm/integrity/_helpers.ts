/**
 * 정합성 테스트 공용 (dacrm T0-08 / T0-09)
 *
 * ⚠️ 이 테스트들은 **실제 DB** 를 친다. 단위 테스트가 아니다.
 *    격리·유니크·FK·CHECK 는 DB 가 판정하는 것이라 가짜 클라이언트로는 검증할 수 없다.
 *    그래서 `pnpm test`(단위) 가 아니라 `pnpm test:integrity` 로 분리한다 —
 *    DATABASE_URL 없는 환경에서 단위 테스트가 통째로 죽으면 안 되기 때문이다.
 *
 * 흔적을 남기지 않는 방법: 모든 쓰기는 트랜잭션 안에서 하고 마지막에 반드시 던져 롤백시킨다.
 * 운영 DB 라서 "테스트가 만든 행이 남아 있다"가 곧 사고다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getCrmDb } from '../../../lib/crm/db/client.ts'

export function loadEnv(): void {
  if (process.env.DATABASE_URL) return
  const path = join(import.meta.dirname, '..', '..', '..', '.env.local')
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

// PrismaClient 는 첫 쿼리 때 DATABASE_URL 을 읽는다(getCrmDb 호출 시점).
// 그래서 정적 import 뒤에 env 를 채워도 늦지 않다 — top-level await 를 쓰지 않는 이유다.
loadEnv()

/** 시드가 만든 실제 워크스페이스 */
export const WS_A = 'ws_dataalliance'
/** 테스트 안에서만 존재하는 두 번째 워크스페이스(항상 롤백된다) */
export const WS_B = 'ws_integrity_b'

export const dbA = getCrmDb(WS_A)
export const dbB = getCrmDb(WS_B)

/** 롤백 전용 신호 — 이 오류는 테스트 실패가 아니다 */
class Rollback extends Error {
  constructor() { super('__rollback__') }
}

/**
 * 트랜잭션 안에서 fn 을 실행하고 **무조건 롤백**한다.
 * fn 이 던진 진짜 오류는 그대로 밖으로 전달한다.
 */
export async function inRollback<T>(
  db: { $transaction: (fn: (tx: any) => Promise<unknown>, opts?: unknown) => Promise<unknown> },
  fn: (tx: any) => Promise<T>,
): Promise<T> {
  let result!: T
  try {
    await db.$transaction(async (tx: any) => {
      result = await fn(tx)
      throw new Rollback()
    }, { timeout: 20000 })
  } catch (e) {
    if (!(e instanceof Rollback)) throw e
  }
  return result
}

/** 최소한의 회사 한 건 */
export function companyData(id: string, over: Record<string, unknown> = {}) {
  return { id, name: `테스트회사_${id}`, ...over }
}

/** 던져야 정상인 블록 — 던지면 오류를 돌려주고, 안 던지면 null */
export async function catchError(fn: () => Promise<unknown>): Promise<any | null> {
  try { await fn(); return null } catch (e) { return e }
}

/** Postgres 오류 코드(23505 유니크, 23503 FK, 23514 CHECK) 또는 Prisma 코드 추출 */
export function errCode(e: any): string {
  return e?.code ?? e?.meta?.code ?? e?.name ?? 'UNKNOWN'
}
