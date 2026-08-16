/**
 * 낙관적 잠금 (구현명세서 2.4 / DI-18)
 *
 *   "update 는 반드시 where { id, version } + data { version: { increment: 1 } },
 *    영향 행 0이면 409 CONFLICT 반환"
 *
 * 왜 필요한가: 두 사람이 같은 회사를 동시에 열어 각자 고치면, 나중에 저장한 쪽이
 * 앞사람의 수정을 **말없이 덮는다.** 덮인 쪽은 자기 글이 사라진 걸 나중에야 안다.
 * version 을 걸면 두 번째 저장이 0건이 되고, 화면이 "누가 먼저 고쳤다"고 말할 수 있다.
 *
 * ⚠️ updateMany 를 쓴다. update 는 조건이 안 맞으면 예외를 던지는데,
 *    그러면 "없는 레코드"와 "버전 충돌"을 구분할 수 없다 — 둘은 사용자에게 다른 말이다.
 */

import { CrmError } from '../domain/errors.ts'

/** update 대상을 못 찾았을 때, 왜인지 가려내기 위한 현재 상태 */
export interface CurrentState {
  exists: boolean
  version?: number
}

/**
 * updateMany 결과를 보고 성공/충돌/없음을 가른다.
 *
 * count > 0        → 성공
 * count 0 + 행 있음 → 버전 충돌(409). 화면이 현재 버전을 알려 다시 시도하게 한다.
 * count 0 + 행 없음 → 404. 남의 워크스페이스 레코드도 여기로 떨어진다(존재 여부 비노출, DI-01)
 */
export function assertUpdated(count: number, current: CurrentState, entity: string): void {
  if (count > 0) return

  if (current.exists) {
    throw new CrmError('CONFLICT', `${entity}을(를) 다른 사람이 먼저 수정했습니다. 새로고침 후 다시 시도해 주세요.`, {
      currentVersion: current.version,
    })
  }
  throw new CrmError('NOT_FOUND', `${entity}을(를) 찾을 수 없습니다.`)
}

/** where 절 — id + version. 이 둘이 함께 걸려야 잠금이 성립한다 */
export function lockWhere(id: string, version: number): { id: string; version: number } {
  return { id, version }
}

/** data 절에 항상 붙는 version 증가 */
export const BUMP_VERSION = { version: { increment: 1 } } as const
