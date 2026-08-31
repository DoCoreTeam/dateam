// lib/ci/jobs/drain-policy.ts — 큐 드레인 정책 (순수 함수)
//
// 왜 파일을 나누는가: 이 정책은 **브라우저와 서버가 함께** 쓴다.
// 브라우저 구동기(QueueDriver)가 다음 호출 간격을 정할 때와, 서버가 좀비 잡을
// 판정할 때 같은 숫자를 봐야 한다. drain.ts는 supabase 서버 클라이언트를 임포트하므로
// 클라이언트 번들에 들어갈 수 없다 — snapshot.ts / snapshot-policy.ts와 같은 분리다.

/**
 * 이 시간이 지나도록 running인 잡은 죽은 것으로 본다.
 *
 * 왜 필요한가: 브라우저가 큐를 돌리면 **사용자가 탭을 닫는 순간 잡이 running으로 죽는다.**
 * 크론은 한 프로세스가 끝까지 돌지만 접속자는 언제든 이탈한다.
 * 회수 장치가 없으면 그 잡은 아무도 다시 집지 않는 영구 좀비가 되고 큐가 막힌다.
 *
 * 5분: 서버리스 함수 상한(60~300초)보다 넉넉하다. 살아 있는 잡을 뺏으면
 * 같은 일이 두 번 실행되므로, 짧게 잡는 것보다 늦게 회수하는 편이 안전하다.
 * (기존 analyze-drain의 STALL_MS 10분과 같은 계통이되, CI 잡은 배치가 작아 더 짧다)
 */
export const STALE_LOCK_MS = 5 * 60 * 1000

/** 한 번의 드레인에서 회수할 좀비 상한. 회수만 하다 예산을 다 쓰지 않게. */
export const RECOVER_MAX_PER_PASS = 50

/** 한 번에 집을 잡 수. 작게 집고 여러 번 도는 편이 예산 초과를 덜 넘긴다. */
export const CLAIM_BATCH = 2

/** 브라우저 드레인 1회의 잡 상한. 첫 접속자가 기다리지 않도록 소량만. */
export const WEB_DRAIN_LIMIT = 6
/** 브라우저 드레인 1회의 시간 예산. 넘으면 남은 건 다음 틱이 가져간다. */
export const WEB_DRAIN_BUDGET_MS = 8_000

/** 크론 백스톱 1회의 상한. 사람이 없을 때 밀린 것을 메우므로 더 넉넉하다. */
export const CRON_DRAIN_LIMIT = 20
export const CRON_DRAIN_BUDGET_MS = 60_000

/** 잠금이 만료됐는가. */
export function isStaleLock(
  lockedAt: string | null | undefined,
  now: number,
  staleMs: number = STALE_LOCK_MS,
): boolean {
  if (!lockedAt) return true      // running인데 잠금 시각이 없다 = 이미 비정상
  const t = Date.parse(lockedAt)
  if (!Number.isFinite(t)) return true
  return now - t > staleMs
}

/** 브라우저 구동기가 멈추는 연속 실패 횟수. 서버가 죽었는데 계속 때리지 않는다. */
export const DRIVER_MAX_ERRORS = 5

/** 남은 잡이 없을 때의 확인 간격. 화면을 열어두기만 해도 이 주기로 새 일감을 본다. */
export const DRIVER_IDLE_MS = 45_000
/** 남은 잡이 있을 때의 간격. 몰아쳐서 비운다. */
export const DRIVER_BUSY_MS = 2_000

/**
 * 서버가 "너무 빨리 다시 왔다"(too_soon)고 돌려보냈을 때 다시 물을 간격.
 *
 * 왜 별도 상수인가: too_soon 응답에는 남은 잡 수가 없다(remaining=null).
 * 그것을 0으로 읽으면 **큐가 빈 것으로 오해**해 idle 간격(45초)을 자 버린다.
 * 탭을 두 개 열어두면 서로를 too_soon으로 밀어내므로 이 오독이 상시화되고,
 * 처리량이 6건/2초에서 **6건/47초로 떨어진다**(실측 v0.7.565: 분당 6건, 큐 38건이
 * 5분 동안 안 줄었다 — 링크를 넣어도 '수집 중'에서 멈춘 것처럼 보인 실제 원인).
 *
 * 서버 문턱(MIN_INTERVAL_MS 1.5초)보다 커야 곧바로 또 튕기지 않는다.
 */
export const DRIVER_TOO_SOON_MS = 2_000

/**
 * 다음 드레인까지 기다릴 시간.
 *
 * - 연속 실패 중이면 지수 백오프(5s → 10s → 20s …, 상한 60s).
 *   서버가 아플 때 브라우저가 몰아치면 더 아프게 만든다.
 * - 남은 잡이 있으면 짧게, 없으면 길게.
 *
 * `null`이면 구동을 멈춘다(연속 실패 한도 초과).
 */
export function nextDriverDelayMs(input: {
  remaining: number
  consecutiveErrors: number
  /** 서버가 too_soon으로 돌려보냈는가. 남은 잡 수를 모르는 상태다 */
  throttled?: boolean
}): number | null {
  if (input.consecutiveErrors >= DRIVER_MAX_ERRORS) return null
  if (input.consecutiveErrors > 0) {
    return Math.min(60_000, 5_000 * 2 ** (input.consecutiveErrors - 1))
  }
  // 문턱에 걸린 것은 "일이 없다"가 아니라 "방금 누가 돌렸다"다. 곧 다시 묻는다.
  if (input.throttled) return DRIVER_TOO_SOON_MS
  return input.remaining > 0 ? DRIVER_BUSY_MS : DRIVER_IDLE_MS
}

/**
 * 크론 백스톱을 실제로 돌릴 것인가.
 *
 * 사장님 결정 ⓐ의 취지는 "사람이 볼 때는 브라우저가 하고, 크론은 최소한만"이다.
 * 시간 게이트(예: 15분마다)로 막으면 **사람이 없을 때 처리가 최대 15분 늦어지는데**
 * 정작 아낄 비용은 조회 몇 건뿐이라 손해가 더 크다.
 * 그래서 시간이 아니라 **할 일 유무**로 끊는다 — 일이 없으면 즉시 반환(사실상 0원),
 * 일이 있으면 그때만 처리한다. 브라우저가 이미 처리 중이어도 잡 임대가 원자적이라
 * 같은 잡을 두 번 실행하지 않는다.
 */
export function shouldRunBackstop(input: {
  dueJobs: number
  dueSnapshots: number
  stalledJobs: number
  /** 다시 훑을 때가 된 관심 채널. 사람이 없는 동안에도 이게 밀리면 모니터링이 멈춘다. */
  dueSweeps?: number
  /**
   * 이슈를 다시 훑을 때가 된 워크스페이스.
   *
   * 이걸 안 세면 사람이 화면을 열어 둔 동안에만 이슈가 모인다 —
   * 뉴스는 밤에도 나므로 그건 자동 수집이라고 부를 수 없다.
   */
  dueSignalSweeps?: number
}): boolean {
  return input.dueJobs > 0
    || input.dueSnapshots > 0
    || input.stalledJobs > 0
    || (input.dueSweeps ?? 0) > 0
    || (input.dueSignalSweeps ?? 0) > 0
}
