/**
 * 안전 게이트 이름 목록 — **시험이 읽으려고 따로 둔다**
 *
 * `gate/safety.ts` 는 이름을 형(union type)으로만 갖고 있어서 시험이 개수를 못 센다.
 * 형은 컴파일 뒤에 사라지므로 「열둘이 다 있나」를 물을 수 없고, 못 묻는 것은
 * 야간용으로 줄인 판이 들어와도 모른다.
 */

import type { GateId } from '../gate/safety.ts'

/** 값으로 둔 열둘. 형과 어긋나면 형 검사가 잡는다 */
export const GATE_IDS_FOR_TEST: readonly GateId[] = [
  'SG-01', 'SG-02', 'SG-03', 'SG-04', 'SG-05', 'SG-06',
  'SG-07', 'SG-08', 'SG-09', 'SG-10', 'SG-11', 'SG-12',
]
