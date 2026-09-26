/**
 * Jev 판단이 꺼져 있을 때 쓰는 말 — **화면 파일 안에 두지 않는다**
 *
 * 라벨 표가 화면에 있으면 같은 개념이 화면마다 다른 말이 된다
 * (`lib/ui/glossary.test.ts` 가 화면 안 라벨 표가 늘어나는 것을 막는다).
 */

/**
 * 왜 Jev 판단을 못 부르나. **부르는 쪽과 같은 순서로 가른다** —
 * `jobs/tick.ts` 는 모델 이름을 먼저 보고, 그 다음에 키를 찾는다.
 * 화면이 다른 순서로 말하면 실행 기록과 화면이 서로 다른 이유를 댄다.
 */
export type JevOffReason = 'model_missing' | 'key_missing' | 'env_blocked'

export const JEV_OFF_TITLE = 'Jev 판단이 꺼져 있습니다'

export const JEV_OFF_REASON_LABEL: Record<JevOffReason, string> = {
  model_missing: '부를 모델 이름이 비어 있습니다',
  key_missing: 'Jev 공급자 키가 등록되지 않았습니다',
  env_blocked: '이 판에서 쓸 Jev 키가 따로 등록되지 않았습니다',
}

/** 무엇을 하면 켜지나. 사실만 적고 언제 될지는 약속하지 않는다 */
export const JEV_OFF_REMEDY_LABEL: Record<JevOffReason, string> = {
  model_missing: '트레이딩 설정의 「Jev 모델」에 관문 뒤에서 부를 모델 이름을 넣으면 켜집니다',
  key_missing: '시스템 설정의 AI 공급자 키에 Jev 키를 등록하면 켜집니다',
  env_blocked: '시스템 설정의 AI 공급자 키에 이 판에서 쓸 Jev 키를 등록하면 켜집니다',
}

/** 꺼져 있는 동안 무슨 일이 벌어지나. 「아무 일도 없다」가 아니라 「표본이 안 쌓인다」이다 */
export const JEV_OFF_CONSEQUENCE =
  '그동안은 규칙 판단만 기록됩니다. Jev 원점수가 안 쌓이면 보정도 판단기 비교도 시작할 수 없습니다'
