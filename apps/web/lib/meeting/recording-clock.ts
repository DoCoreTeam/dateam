/**
 * 녹음 시계 — **멈춘 시간을 빼고 센다.**
 *
 * ## 왜 컴포넌트 밖인가 (완료 조건 E-6)
 *
 * 일시정지가 생기면 「경과 시간」과 「구간 회전까지 남은 시간」이 더는 벽시계가 아니다.
 * 멈춘 만큼을 빼야 하는데, 이 뺄셈이 틀려도 화면은 멀쩡해 보인다 —
 * 타이머가 조금 빨리 가거나, 10분 구간이 7분에서 끊길 뿐이다.
 * 둘 다 **회의가 끝난 뒤에야** 드러나고, 그때는 되돌릴 수 없다.
 *
 * 그래서 계산만 여기로 뺀다. 시각을 인자로 받으므로 「3분 멈췄다 10분 뒤」를 그 자리에서 센다.
 */

/** 지금 녹음 시계가 어디까지 왔나 — 시작 시각과 멈춘 시간의 합으로만 말한다 */
export interface PauseClock {
  /** 녹음을 시작한 시각(ms) */
  startedAtMs: number
  /** 지금까지 **끝난** 멈춤의 합(ms) */
  pausedTotalMs: number
  /** 지금 멈춰 있다면 그 멈춤이 시작된 시각(ms), 돌고 있으면 null */
  pausedAtMs: number | null
}

/**
 * 지금 시점에서 «멈춰 있던 시간»의 총합(ms).
 *
 * 멈춰 있는 동안에는 진행 중인 멈춤까지 더한다 — 그래야 경과 시간이 **그 자리에 선다.**
 * 안 더하면 멈춘 동안에도 타이머가 계속 올라가서, 화면이 멈췄다고 말하면서 숫자는 돈다.
 */
export function pausedMsAt(clock: PauseClock, nowMs: number): number {
  const running = clock.pausedAtMs === null ? 0 : Math.max(0, nowMs - clock.pausedAtMs)
  return Math.max(0, clock.pausedTotalMs) + running
}

/** 화면에 띄우는 경과(초). 멈춘 시간은 빠지고, 음수로는 내려가지 않는다 */
export function elapsedSecAt(clock: PauseClock, nowMs: number): number {
  const live = nowMs - clock.startedAtMs - pausedMsAt(clock, nowMs)
  return Math.max(0, Math.round(live / 1000))
}

/**
 * 구간 회전까지 남은 시간(ms).
 *
 * 멈출 때 이 값을 적어 두고, 이어할 때 그만큼으로 타이머를 다시 건다.
 * 멈춘 동안 타이머를 그냥 두면 **멈춘 채로 구간이 끊기고**, 다음 구간이 혼자 돌기 시작한다.
 */
export function remainingMs(deadlineAtMs: number, nowMs: number): number {
  return Math.max(0, deadlineAtMs - nowMs)
}

/**
 * 이 구간에 실제로 **녹음된** 길이(초).
 *
 * 구간 길이는 전사 시간축의 기준이다(`partOffsetMs`). 벽시계로 재면
 * 멈춘 시간까지 들어가서, 뒤 구간의 자막이 통째로 밀린다.
 */
export function partDurationSec(partStartedAtMs: number, pausedMsInPart: number, nowMs: number): number {
  const live = nowMs - partStartedAtMs - Math.max(0, pausedMsInPart)
  return Math.max(0, Math.round(live / 1000))
}
