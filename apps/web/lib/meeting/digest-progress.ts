/**
 * 정리가 도는 동안 화면이 무슨 말을 할지 — **컴포넌트 밖 순수 함수로 둔다.**
 *
 * ## 왜 이 파일이 생겼나 (실측 v0.7.684)
 *
 * 사용자 지적 원문: *"이렇게 아무 반응없다가 … 이렇게 나오네?"*
 *
 * 진행 표시를 가진 버튼이 **정리 결과가 이미 있을 때만** 그려지고 있었다.
 * 첫 정리는 빈 상태 화면(`EmptyState`)의 버튼을 누르는데, 그 버튼은 `running` 을 받지 않아
 * 라벨도 그대로였고 잠기지도 않았다. 그 사이 화면은 **최대 5분**(`digest/route.ts` maxDuration=300)
 * 동안 아무 말도 하지 않았다 — 사용자가 「고장」으로 읽는 것이 정상이다.
 *
 * 게다가 잠기지 않으므로 **여러 번 눌러 같은 정리가 여러 번 돈다.** AI 호출이 그만큼 낭비된다.
 *
 * ## 왜 컴포넌트 밖인가
 *
 * `useEffect` 나 JSX 안에 넣은 식은 **실브라우저 말고는 검증할 수단이 없다**(정책 E-6).
 * 5분짜리 작업의 45초·120초 분기는 브라우저로 밟기 어려운 상태라 더욱 그렇다.
 * 순수 함수로 두면 시간을 인자로 넘겨 그 순간을 그대로 재현할 수 있다.
 */

/** 이 시간까지는 «시작했다»고만 말한다. 곧바로 상세를 말하면 깜빡임으로 읽힌다 */
export const DIGEST_START_MS = 2_500
/** 이 시간을 넘으면 «오래 걸리는 중»이라고 밝힌다 — 침묵은 고장으로 읽힌다 */
export const DIGEST_LONG_MS = 45_000
/** 이 시간을 넘으면 곧 끝난다고 말한다. 상한(5분)에 가까워지는 구간이다 */
export const DIGEST_VERY_LONG_MS = 120_000

export interface DigestProgressInput {
  /** 실행을 누른 뒤 흐른 시간 */
  elapsedMs: number
  /** 메모 글자수 — 0 이면 메모가 없는 회의다 */
  memoChars: number
  /** 전사 줄수 — 0 이면 녹음이 없는 회의다 */
  segmentCount: number
}

export interface DigestProgressView {
  /** 지금 무엇을 하는 중인지 — 한 문장 */
  message: string
  /** 경과 시간 — 화면에 그대로 찍는다 */
  elapsedLabel: string
  /** 오래 걸리는 중일 때만 붙는 덧말. 평소에는 null */
  reassure: string | null
}

/** 「12초」 · 「1분 20초」 — 분이 0이면 분을 적지 않는다 */
export function formatElapsed(elapsedMs: number): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1000))
  const min = Math.floor(total / 60)
  const sec = total % 60
  return min > 0 ? `${min}분 ${sec}초` : `${sec}초`
}

/**
 * 무엇을 읽고 있는지 — **가진 것만 말한다.**
 * 없는 것을 세어 「녹음 0줄」이라고 말하면 사용자는 녹음이 실패했다고 읽는다.
 */
export function readingWhat(memoChars: number, segmentCount: number): string {
  const memo = memoChars > 0 ? `메모 ${memoChars.toLocaleString()}자` : null
  const rec = segmentCount > 0 ? `녹음 ${segmentCount.toLocaleString()}줄` : null
  if (memo && rec) return `${memo}와 ${rec}을 함께 읽고 있어요`
  if (memo) return `${memo}를 읽고 있어요`
  if (rec) return `${rec}을 읽고 있어요`
  // 둘 다 0 — 세어 둔 값이 아직 안 왔을 뿐이다. 숫자를 지어내지 않는다
  return '회의 내용을 읽고 있어요'
}

export function digestProgress(input: DigestProgressInput): DigestProgressView {
  const { elapsedMs, memoChars, segmentCount } = input
  const elapsedLabel = formatElapsed(elapsedMs)

  if (elapsedMs < DIGEST_START_MS) {
    return { message: '정리를 시작했어요', elapsedLabel, reassure: null }
  }

  const message = readingWhat(memoChars, segmentCount)

  if (elapsedMs >= DIGEST_VERY_LONG_MS) {
    return { message, elapsedLabel, reassure: '거의 다 됐어요. 조금만 더 기다려 주세요.' }
  }
  if (elapsedMs >= DIGEST_LONG_MS) {
    return { message, elapsedLabel, reassure: '내용이 길어 나눠 읽고 있어요. 조금 더 걸립니다.' }
  }
  return { message, elapsedLabel, reassure: null }
}
