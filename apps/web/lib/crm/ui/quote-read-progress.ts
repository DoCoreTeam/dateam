/**
 * 견적 파일을 읽고 가져오는 동안 화면이 무슨 말을 할지 — **컴포넌트 밖 순수 함수**
 *
 * ## 왜 생겼나 (사용자 지적 2026-09-20)
 *
 * *"우리 정책상 이런식으로 작업이 오래 걸리는거는 사용자 눈에 정확하게 어떤 동작중인지
 * 보이게 하는게 있을텐데?"*
 *
 * 있었다. `lib/meeting/digest-progress.ts` 가 그것이고, 미팅 끝내기는 이미
 * `lib/crm/ui/finish-progress.ts` 로 그 모듈에 위임하고 있었다.
 * 그런데 견적 쪽은 단추 라벨이 처음부터 끝까지 **「읽는 중…」 한 마디**였다.
 * 파일 읽기 창구의 상한은 180초다 — 3분 동안 화면에서 움직이는 것이 없으면
 * 사람이 고장으로 읽는 것이 정상이다.
 *
 * 규칙이 **코드 한 곳에만** 있고 정책 문서에 없어서 옆 화면이 그것을 못 봤다.
 * 버전 규칙이 열일곱 판 동안 안 지켜진 것과 같은 구멍이다.
 *
 * ## 왜 새로 짓지 않고 위임하나
 *
 * 시간 문턱과 경과 표기를 여기서 다시 정하면 화면마다 다른 말이 나온다.
 * 그래서 `digest-progress` 의 `formatElapsed` 와 문턱 셋을 **그대로 가져다 쓴다.**
 * 이 파일이 새로 정하는 것은 «무엇을 하는 중인가» 한 줄뿐이다.
 *
 * ## 왜 컴포넌트 밖인가
 *
 * `useEffect` 안의 식은 실브라우저 말고는 검증할 수단이 없다.
 * 45초·120초 분기는 브라우저로 밟기 어려운 자리라 더욱 그렇다.
 * 순수 함수로 두면 경과 시간을 인자로 넘겨 그 순간을 그대로 재현할 수 있다.
 */

import {
  formatElapsed, DIGEST_START_MS, DIGEST_LONG_MS, DIGEST_VERY_LONG_MS,
} from '../../meeting/digest-progress.ts'
import {
  FILL_READ_START, FILL_READ_LONG, FILL_READ_VERY_LONG,
  fillReadingLine, importProgressLine,
} from '../../terms/quote.ts'

/** 기다리는 두 자리. 하는 일이 다르므로 같은 말로 덮지 않는다 */
export type QuoteWaitPhase = 'reading' | 'importing'

export interface QuoteWaitInput {
  phase: QuoteWaitPhase
  /** 누른 뒤 흐른 시간 */
  elapsedMs: number
  /** 읽는 중일 때 — 올린 파일. 모르면 빈 문자열과 0 */
  fileName?: string
  fileBytes?: number
  /** 가져오는 중일 때 — 보낼 건 수와 지금까지 끝난 수 */
  total?: number
  done?: number
}

export interface QuoteWaitView {
  /** 지금 무엇을 하는 중인지 — 한 문장 */
  message: string
  /** 경과 시간. 첫 몇 초는 `null` — 1~2초짜리에 초를 세면 그게 더 불안하다 */
  elapsedLabel: string | null
  /** 오래 걸릴 때만 붙는 덧말 */
  reassure: string | null
}

export function quoteWaitProgress(input: QuoteWaitInput): QuoteWaitView {
  const { elapsedMs } = input

  if (input.phase === 'importing') {
    /*
      **건마다 따로 보내므로 몇 번째인지 말할 수 있다.** 남은 일이 얼마인지까지 말하는 쪽이
      경과 시간만 세는 것보다 낫다. 시간은 오래 걸릴 때만 덧붙인다.
    */
    return {
      message: importProgressLine(input.done ?? 0, input.total ?? 0),
      elapsedLabel: elapsedMs >= DIGEST_START_MS ? formatElapsed(elapsedMs) : null,
      reassure: null,
    }
  }

  // 첫 몇 초는 «시작했다»고만 한다 — 곧바로 상세를 말하면 깜빡임으로 읽힌다
  if (elapsedMs < DIGEST_START_MS) {
    return { message: FILL_READ_START, elapsedLabel: null, reassure: null }
  }

  const message = fillReadingLine(input.fileName ?? '', input.fileBytes ?? 0)
  const elapsedLabel = formatElapsed(elapsedMs)

  if (elapsedMs >= DIGEST_VERY_LONG_MS) {
    return { message, elapsedLabel, reassure: FILL_READ_VERY_LONG }
  }
  if (elapsedMs >= DIGEST_LONG_MS) {
    return { message, elapsedLabel, reassure: FILL_READ_LONG }
  }
  return { message, elapsedLabel, reassure: null }
}

/** 화면에 찍는 한 줄 — 시간이 없는 구간이면 문장만 (「· null」 이 나가지 않게) */
export function quoteWaitLine(view: QuoteWaitView): string {
  return view.elapsedLabel ? `${view.message} · ${view.elapsedLabel}` : view.message
}

export { formatElapsed }
