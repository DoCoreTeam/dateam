/**
 * AI 판단을 이 화면에서 못 부를 때 쓰는 말 — **화면 파일 안에 두지 않는다**
 *
 * ## 왜 다시 썼나 (사용자 지적 2026-09-28 「키는 다 넣었는데 무슨소린지」)
 *
 * 화면이 「이 판에서 쓸 AI 키가 따로 등록되지 않았습니다」라고 적고 있었다.
 * 그런데 실측하니 `META.jev_api_key` 에 **60자짜리 키가 들어 있었다.** 넣은 사람에게
 * 안 넣었다고 말한 것이다. 그리고 조치라고 적은 「이 판에서 쓸 키를 등록하면」은
 * `ai_provider_keys` 에 판 칼럼이 없어 **등록할 칸 자체가 없는 일**이었다(마이그264).
 *
 * 같은 사실을 두고 설정 화면은 「키는 있지만 이 판에서는 쓰지 않습니다」라고 맞게 말했다.
 * 한 앱의 두 화면이 서로 다른 말을 하면 사용자는 어느 쪽이 참인지 고를 수 없다.
 *
 * ## 무엇이 참인가
 *
 * META 의 키는 운영 설정이라 운영이 아닌 판은 안 집는다(`chooseKey`). 막힌 것은
 * **이 화면**이지 기능이 아니다 — 운영에서는 그대로 돌고, 오늘 쌓인 AI 판단이 그 증거다.
 * 그래서 「꺼져 있다」가 아니라 「이 화면에서는 안 쓴다」라고 적고, 오늘 몇 건이 쌓였는지
 * 같이 적는다. 안 적으면 사용자는 멀쩡한 키를 또 넣는다.
 *
 * ## 조치는 되는 것만 적는다
 *
 * 키 목록(`ai_provider_keys`)에 등록한 키는 `chooseKey` 가 **판을 안 보고 먼저 쓴다.**
 * 그러니 조치는 「키 목록에 등록하기」다. 없는 칸을 가리키지 않는다.
 */

/**
 * 왜 AI 판단을 못 부르나. **부르는 쪽과 같은 순서로 가른다** —
 * `jobs/tick.ts` 는 모델 이름을 먼저 보고, 그 다음에 키를 찾는다.
 * 화면이 다른 순서로 말하면 실행 기록과 화면이 서로 다른 이유를 댄다.
 */
export type JevOffReason = 'model_missing' | 'key_missing' | 'env_blocked'

/**
 * 제목. `env_blocked` 만 다른 말을 쓴다 — 나머지 둘은 정말로 꺼진 것이고,
 * 이쪽은 **개발 화면만 안 쓰는 것**이라 같은 제목을 달면 또 거짓말이 된다.
 *
 * **「이 화면에서는」으로 시작하지 않는다**(정책 U-1). 그 말로 여는 문장은 거의 언제나
 * 구현 사정을 설명하는 말이고, 사용자는 자기가 어느 화면에 있는지 이미 안다.
 * 말할 것은 **어디가 무엇을 안 쓰는지**뿐이다 — 어떻게 쓰게 하는지는 아래 사유 줄이 말한다.
 *
 * **「꺼져」라고도 하지 않는다.** 키는 멀쩡히 등록돼 있고 운영에서는 그대로 돈다 —
 * 꺼졌다고 하면 사용자는 없는 고장을 찾으러 간다. 가드 `jev-labels.test.ts`
 * 「제목이 「꺼짐」과 「이 화면만 안 씀」을 가른다」.
 */
export const JEV_OFF_TITLE = 'AI 판단이 꺼져 있습니다'
export const JEV_OFF_TITLE_ENV_BLOCKED = '개발 화면은 AI 판단을 쓰지 않습니다'

export function jevOffTitle(reason: JevOffReason): string {
  return reason === 'env_blocked' ? JEV_OFF_TITLE_ENV_BLOCKED : JEV_OFF_TITLE
}

export const JEV_OFF_REASON_LABEL: Record<JevOffReason, string> = {
  model_missing: 'AI 판단에 쓸 모델을 아직 안 골랐습니다',
  key_missing: '고른 곳의 AI 키가 등록되지 않았습니다',
  // 넣어 둔 키를 「없다」고 하지 않는다. 있는데 이 화면이 안 쓰는 것이다
  env_blocked: '등록해 두신 AI 키는 운영 설정에 있어 개발 화면에서는 쓰지 않습니다',
}

/** 무엇을 하면 켜지나. **되는 일만 적는다** — 없는 칸을 가리키지 않는다 */
export const JEV_OFF_REMEDY_LABEL: Record<JevOffReason, string> = {
  model_missing: '트레이딩 설정의 「AI 판단에 쓸 모델」에서 하나 고르면 켜집니다',
  key_missing: '시스템 설정의 AI 공급자 키에 그 곳의 키를 등록하면 켜집니다',
  env_blocked: '이 화면에서도 쓰려면 시스템 설정의 AI 공급자 키 목록에 그 곳의 키를 한 줄 등록하면 됩니다. 목록에 등록한 키는 화면을 가리지 않고 쓰입니다',
}

/** 꺼져 있는 동안 무슨 일이 벌어지나. 「아무 일도 없다」가 아니라 「표본이 안 쌓인다」이다 */
export const JEV_OFF_CONSEQUENCE =
  '그동안은 규칙 판단만 기록됩니다. AI 판단 점수가 안 쌓이면 보정도 판단기 비교도 시작할 수 없습니다'

/**
 * 오늘 AI 판단이 실제로 쌓였을 때 그 자리에 적는 말.
 *
 * 「규칙 판단만 기록됩니다」를 그대로 두면 **화면이 바로 위에 그린 AI 판단과 모순된다.**
 * 표본이 쌓이고 있다는 사실이 더 중요하다 — 사용자가 고칠 일이 없다는 뜻이기 때문이다.
 */
export function jevRunningElsewhere(todayCount: number): string {
  return `운영에서는 그대로 돌고 있습니다. 오늘 AI 판단이 ${todayCount}건 쌓였고, 이 화면에 보이는 판단이 그것입니다`
}

/**
 * 결과 줄을 고른다 — 기록이 있으면 사실을, 없으면 앞으로 벌어질 일을.
 * 고르는 규칙을 화면에 두면 화면마다 다르게 고른다.
 */
export function jevConsequenceLine(input: { reason: JevOffReason; todayCount: number }): string {
  if (input.reason === 'env_blocked' && input.todayCount > 0) return jevRunningElsewhere(input.todayCount)
  return JEV_OFF_CONSEQUENCE
}
