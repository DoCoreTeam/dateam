/**
 * 마이크 무음 판정 — **순간값으로 지속 상태를 말하지 않는다.**
 *
 * **왜 생겼나**(사용자 지적 2026-09-04: *"종료하고 정리 버튼 아래로 무슨 멘트가 자꾸 나와서
 * 화면이 떨려"*). 녹음 패널은 「소리가 거의 안 잡히고 있어요」를 `level < 0.02` 라는
 * **한 순간의 값**으로 판정했다. 그런데 그 문장이 뜻하는 것은 *지속되는 상태*(마이크 음소거)다.
 * 사람의 말은 원래 끊긴다 — 낱말 사이의 0.3초 정적도 0.02 아래로 내려간다.
 * 게다가 `level` 은 `requestAnimationFrame` 이 **초당 60번** 갱신하므로,
 * 그 문단은 초당 수십 번 붙었다 떨어졌고 아래 에디터가 통째로 밀렸다 — 그게 «떨림»이었다.
 *
 * 그래서 판정을 둘로 나눈다:
 *   1. **시간** — 연속으로 {@link QUIET_ENTER_MS} 이상 조용해야 «조용하다»고 말한다
 *   2. **슈미트 트리거** — 켜지는 문턱({@link QUIET_ENTER_LEVEL})과
 *      꺼지는 문턱({@link QUIET_EXIT_LEVEL})을 다르게 둔다. 문턱이 하나면 그 언저리에서
 *      값이 오르내릴 때 판정도 같이 오르내린다(= 떨림의 근본 형태)
 *
 * **컴포넌트 밖에 두는 이유**(E-6): `useEffect` 안의 식은 실브라우저 말고는 검증 수단이 없다.
 * 무음 판정은 마이크가 실제로 음소거된 상태를 재현해야 밟히는데, 그 상태는 화면으로 만들기 어렵다.
 * 순수 함수로 빼면 시간을 인자로 넣어 4초 뒤·8초 뒤를 그 자리에서 검증할 수 있다.
 */

/** 이 아래로 내려가면 «조용» 후보. 세기는 0~1 정규화 값이다 */
export const QUIET_ENTER_LEVEL = 0.02

/**
 * 이 위로 올라오면 소리가 확실히 들어온 것 — **즉시** 해제한다.
 *
 * 켜지는 문턱보다 높다. 같은 값이면 0.02 언저리에서 값이 오르내릴 때
 * 판정이 따라 오르내려 다시 떨린다.
 */
export const QUIET_EXIT_LEVEL = 0.05

/** 연속으로 이만큼 조용해야 말한다. 낱말 사이의 정적(≈0.3초)과 음소거를 가르는 선 */
export const QUIET_ENTER_MS = 4000

/**
 * 시작 직후 이만큼은 판정하지 않는다.
 *
 * `getUserMedia` 가 돌아온 뒤에도 오디오 그래프가 실제 소리를 싣기까지 시간이 걸린다.
 * 그 사이의 0 을 «음소거»로 읽으면 **녹음을 시작할 때마다** 경고가 뜬다.
 */
export const QUIET_WARMUP_MS = 8000

export interface MicSilenceState {
  /** 지금 «소리가 거의 안 잡힌다»고 말해야 하나 */
  quiet: boolean
  /** 조용해지기 시작한 시각(ms). 아직 후보가 아니면 null */
  since: number | null
}

/** 녹음 전·직후의 상태. 시작할 때마다 여기로 되돌린다 */
export const IDLE_MIC_SILENCE: MicSilenceState = { quiet: false, since: null }

export interface MicSample {
  /** 0~1 마이크 입력 세기 */
  level: number
  /** 지금 시각(ms) */
  nowMs: number
  /** 녹음이 시작된 시각(ms) — 준비 시간 판정에 쓴다 */
  startedAtMs: number
}

/**
 * 표본 하나를 먹고 다음 판정 상태를 돌려준다. 부수효과 없음.
 *
 * 규칙은 넷이고 순서가 곧 우선순위다:
 *   ① 준비 시간 안이면 무조건 조용하지 않다(오탐 차단)
 *   ② 해제 문턱 위면 소리가 들어온 것 — 즉시 해제하고 타이머도 지운다
 *   ③ 진입 문턱 아래면 조용 후보 — 타이머를 시작한다(이미 돌고 있으면 그대로)
 *   ④ 그 사이(불감대)는 **아무것도 바꾸지 않는다** — 여기서 판정을 바꾸면 떨림이 돌아온다
 */
export function nextMicSilence(prev: MicSilenceState, sample: MicSample): MicSilenceState {
  const { level, nowMs, startedAtMs } = sample

  if (nowMs - startedAtMs < QUIET_WARMUP_MS) return IDLE_MIC_SILENCE
  if (level >= QUIET_EXIT_LEVEL) return IDLE_MIC_SILENCE

  const since = level < QUIET_ENTER_LEVEL ? (prev.since ?? nowMs) : prev.since
  if (since === null) return IDLE_MIC_SILENCE

  return { quiet: nowMs - since >= QUIET_ENTER_MS, since }
}
