/**
 * 아직 서버에 안 간 글을 **누구든 밀어 넣을 수 있게** 하는 자리 — SSOT
 *
 * ## 왜 생겼나 (사용자 지시 2026-09-09)
 *
 * *"먼저 내용을 저장한 후 정리를 시작하면 된다는 말이고"*
 *
 * 회의 메모는 **5초 디바운스 자동저장**이다(`MeetingMemoEditor`). 좋은 계약이지만
 * 「미팅 끝내기」와 겹치면 사고가 된다 — 마지막 문장을 치고 곧바로 끝내기를 누르면
 * 그 5초어치가 아직 서버에 없고, 정리는 **그 문장이 빠진 글**을 읽는다.
 * 사용자는 자기가 적은 말이 정리에서 빠졌다는 사실을 알 방법이 없다.
 *
 * ## 왜 부모가 자식을 직접 부르지 않나
 *
 * 편집기는 미팅 상세 기준으로 **네 겹 아래**에 있다
 * (`MeetingDetail` → `MeetingWorkbench` → `SegmentedTabs` → `MeetingMemoEditor`).
 * ref 를 네 겹 내리면 중간 부품 셋이 전부 «저장을 아는 부품»이 된다 — 관계없는 일이다.
 * 게다가 근거가 접혀 있으면 편집기는 **렌더되지도 않는다**(`{evidenceOpen && …}`).
 * 그때 ref 는 `null` 이고, 부르는 쪽은 「편집기가 없다」와 「저장할 게 없다」를 구분할 수 없다.
 *
 * 등록제로 두면 셋 다 풀린다 — 중간 부품은 아무것도 몰라도 되고,
 * 안 그려진 편집기는 등록이 없으니 자동으로 «저장할 것 없음»이 되며,
 * 같은 편집기를 쓰는 다른 화면(회의노트 상세)도 그대로 혜택을 본다.
 *
 * ## 왜 컴포넌트 밖인가
 *
 * 저장 대기·시간 초과·부분 실패는 실브라우저에서 재현하기 어려운 상태다(정책 E-6).
 * 순수 모듈로 두면 가짜 밀어넣기 함수로 그 순간을 그대로 만들어 검증할 수 있다.
 */

/** 밀어 넣은 결과. **「할 게 없었다」와 「실패했다」를 절대 같은 값으로 두지 않는다** */
export type FlushOutcome = 'saved' | 'nothing' | 'failed'

/** 등록하는 쪽이 주는 함수. 던져도 된다 — 여기서 `failed` 로 받는다 */
export type PendingSaveFlush = () => Promise<FlushOutcome>

export interface FlushSummary {
  /** 실제로 서버에 보낸 것 */
  saved: number
  /** 이미 저장돼 있어 보낼 게 없던 것 */
  nothing: number
  /** 실패하거나 시간 안에 못 끝낸 것 */
  failed: number
}

/**
 * 저장이 이 시간을 넘으면 실패로 본다.
 *
 * 무한정 기다리지 않는 이유: 저장이 매달리면 **끝내기 전체가 매달린다.**
 * 그러면 이 모듈이 고치려던 것과 똑같은 화면이 된다(정책 B-4 ① 시간 제한).
 * 5초 디바운스 한 판을 밀어 넣는 요청이라 8초면 넉넉하다.
 */
export const FLUSH_TIMEOUT_MS = 8_000

const flushers = new Map<string, PendingSaveFlush>()

/**
 * 미저장 글을 가진 부품이 자기를 등록한다. **돌려주는 함수를 정리 때 반드시 부른다.**
 *
 * 같은 키로 다시 등록하면 덮어쓴다 — 편집기가 다시 그려질 때 옛 함수가 남으면
 * 이미 사라진 화면의 값을 저장하게 된다.
 */
export function registerPendingSave(key: string, flush: PendingSaveFlush): () => void {
  flushers.set(key, flush)
  return () => {
    // 그 사이 같은 키로 다른 부품이 등록했으면 그건 내 것이 아니다 — 지우면 남의 저장이 사라진다
    if (flushers.get(key) === flush) flushers.delete(key)
  }
}

/** 지금 밀어 넣을 곳이 있나. 없으면 `flushPendingSaves` 를 부를 필요도 없다 */
export function hasPendingSaves(): boolean {
  return flushers.size > 0
}

/** 시험용 — 등록을 전부 비운다. 화면 코드는 부르지 않는다 */
export function clearPendingSaves(): void {
  flushers.clear()
}

function withTimeout(p: Promise<FlushOutcome>, ms: number): Promise<FlushOutcome> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve('failed'), ms)
    p.then(
      (out) => { clearTimeout(t); resolve(out) },
      () => { clearTimeout(t); resolve('failed') },
    )
  })
}

/**
 * 등록된 것을 **전부, 한꺼번에** 밀어 넣고 끝날 때까지 기다린다.
 *
 * 하나가 실패해도 나머지는 간다 — 그리고 **실패를 숨기지 않는다.**
 * 부르는 쪽이 `failed > 0` 을 보고 「옛 내용으로 정리할 것인가」를 정할 수 있어야 한다.
 * 조용히 성공으로 넘기면 사용자는 자기 글이 빠진 정리본을 사실로 읽는다.
 */
export async function flushPendingSaves(
  timeoutMs: number = FLUSH_TIMEOUT_MS,
): Promise<FlushSummary> {
  // 도는 동안 등록이 바뀔 수 있으니 지금 것을 떠 둔다
  // Array.from — 전개 구문은 이 저장소의 tsconfig target 에서 downlevelIteration 을 요구한다
  const running = Array.from(flushers.values()).map((fn) => {
    let started: Promise<FlushOutcome>
    try {
      started = fn()
    } catch {
      // 동기적으로 던지는 경우 — Promise 로 감싸기 전에 터진다
      return Promise.resolve<FlushOutcome>('failed')
    }
    return withTimeout(started, timeoutMs)
  })

  const outcomes = await Promise.all(running)
  return {
    saved: outcomes.filter((o) => o === 'saved').length,
    nothing: outcomes.filter((o) => o === 'nothing').length,
    failed: outcomes.filter((o) => o === 'failed').length,
  }
}
