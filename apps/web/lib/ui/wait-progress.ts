/**
 * 기다리는 동안 화면이 할 말 — **화면 종류를 안 가리는 일반형**
 *
 * 견적 쪽은 말할 거리가 많아 제 함수를 갖는다(`lib/crm/ui/quote-read-progress.ts`:
 * 파일 이름·크기, 몇 건 중 몇 건째). 나머지 화면은 «무엇을 하는 중인가» 한 문장뿐이라
 * 화면마다 함수를 만들 이유가 없다 — 그 한 문장만 받고 나머지는 여기서 같게 한다.
 *
 * 문턱과 경과 표기는 **회의노트 모듈에 위임한다.** 여기서 다시 정하면 같은 일에
 * 화면마다 다른 말이 나온다 (정책 B-7).
 */

import {
  formatElapsed, DIGEST_START_MS, DIGEST_LONG_MS, DIGEST_VERY_LONG_MS,
} from '../meeting/digest-progress.ts'
import { WAIT_LONG, WAIT_VERY_LONG, WAIT_START } from '../terms/wait.ts'

export interface WaitView {
  message: string
  elapsedLabel: string | null
  reassure: string | null
}

/**
 * @param doing 지금 무엇을 하는 중인지 한 문장. `lib/terms/wait.ts` 가 정한다
 */
export function waitProgress(elapsedMs: number, doing: string): WaitView {
  // 첫 몇 초는 «시작했다»고만 한다 — 곧바로 상세를 말하면 깜빡임으로 읽힌다
  if (elapsedMs < DIGEST_START_MS) {
    return { message: WAIT_START, elapsedLabel: null, reassure: null }
  }
  const elapsedLabel = formatElapsed(elapsedMs)
  if (elapsedMs >= DIGEST_VERY_LONG_MS) return { message: doing, elapsedLabel, reassure: WAIT_VERY_LONG }
  if (elapsedMs >= DIGEST_LONG_MS) return { message: doing, elapsedLabel, reassure: WAIT_LONG }
  return { message: doing, elapsedLabel, reassure: null }
}
